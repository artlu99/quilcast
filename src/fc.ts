// Farcaster protocol bits: protobuf messages, signing, EIP-712.
// Field numbers follow hypersnap/proto/definitions/message.proto; the KEY_ADD
// layout is adapted from QuilibriumNetwork/quorum-shared (MIT).
import { ed25519 } from '@noble/curves/ed25519.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { blake3 } from '@noble/hashes/blake3.js'
import { keccak_256 } from '@noble/hashes/sha3.js'

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
export const unhex = (s: string) => {
  s = s.replace(/^0x/, '')
  return Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16))
}
const utf8 = (s: string) => new TextEncoder().encode(s)
export const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0))
  let o = 0
  for (const x of a) out.set(x, (o += x.length) - x.length)
  return out
}

// --- protobuf writer: varints and length-delimited fields are all we need ---

const varint = (v: number | bigint) => {
  let n = BigInt(v)
  const out: number[] = []
  while (n >= 0x80n) out.push(Number((n & 0x7fn) | 0x80n)), (n >>= 7n)
  out.push(Number(n))
  return Uint8Array.from(out)
}
type Field = [number, number | bigint | string | Uint8Array | number[] | undefined]
// numbers → varint, strings/bytes → length-delimited, arrays → packed varints
export const pb = (...fields: Field[]) =>
  concat(
    ...fields.flatMap(([f, v]) => {
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return []
      if (typeof v === 'number' || typeof v === 'bigint') return [varint(f << 3), varint(v)]
      const b = typeof v === 'string' ? utf8(v) : Array.isArray(v) ? concat(...v.map(varint)) : v
      return [varint((f << 3) | 2), varint(b.length), b]
    }),
  )

export const MT = { CAST_ADD: 1, CAST_REMOVE: 2, REACTION_ADD: 3, REACTION_REMOVE: 4, LINK_ADD: 5, LINK_REMOVE: 6, USER_DATA_ADD: 11, KEY_ADD: 16 }
// every message type a non-custody signer may sign (KEY_ADD/REMOVE excluded)
const SCOPES = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15]

const castId = (fid: number, hash: string) => pb([1, fid], [2, unhex(hash)])
const BODY_FIELD: Record<number, number> = { 1: 5, 2: 6, 3: 7, 4: 7, 5: 14, 6: 14, 11: 12, 16: 19 }
const FC_EPOCH = 1609459200

export type CastRef = { fid: number; hash: string }
// parent is a cast (reply) or a channel URL; embeds are URLs or a quoted cast
export const castBody = (c: { text: string; mentions?: number[]; positions?: number[]; embeds?: (string | CastRef)[]; parent?: CastRef | string }) =>
  pb(
    [2, c.mentions],
    [3, typeof c.parent === 'object' ? castId(c.parent.fid, c.parent.hash) : undefined],
    [7, typeof c.parent === 'string' ? c.parent : undefined], // same position as @farcaster/core's oneof
    [4, c.text],
    [5, c.positions],
    ...(c.embeds || []).map((e): Field => [6, typeof e === 'string' ? pb([1, e]) : pb([2, castId(e.fid, e.hash)])]),
    // over 320 bytes must be marked LONG_CAST (allowed up to 1024)
    [8, new TextEncoder().encode(c.text).length > 320 ? 1 : undefined],
  )
export const reactionBody = (type: 1 | 2, fid: number, hash: string) => pb([1, type], [2, castId(fid, hash)])
export const followBody = (fid: number) => pb([1, 'follow'], [3, fid])
export const userDataBody = (type: number, value: string) => pb([1, type], [2, value])
export const castRemoveBody = (hash: string) => pb([1, unhex(hash)])

/** Sign MessageData with an ed25519 key, return the Message envelope and its hash. */
export function envelope(type: number, fid: number, body: Uint8Array, signerPriv: Uint8Array) {
  const data = pb([1, type], [2, fid], [3, Math.floor(Date.now() / 1000) - FC_EPOCH], [4, 1], [BODY_FIELD[type], body])
  const hash = blake3(data, { dkLen: 20 })
  // hypersnap merges read `data` while hashing uses `data_bytes`: send both
  const msg = pb([1, data], [2, hash], [3, 1], [4, ed25519.sign(hash, signerPriv)], [5, 1], [6, ed25519.getPublicKey(signerPriv)], [7, data])
  return { msg, hash: hex(hash) }
}

// --- Ethereum-style signing ---

const word = (v: number | bigint) => unhex(BigInt(v).toString(16).padStart(64, '0'))
const kstr = (s: string) => keccak_256(utf8(s))
export const address = (priv: Uint8Array) => '0x' + hex(keccak_256(secp256k1.getPublicKey(priv, false).slice(1)).slice(12))

export function ecSign(digest: Uint8Array, priv: Uint8Array) {
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(digest, priv, { prehash: false, format: 'recovered' }), 'recovered')
  return { rs: sig.toBytes('compact'), v: sig.recovery! }
}
const sign65 = (digest: Uint8Array, priv: Uint8Array) => {
  const { rs, v } = ecSign(digest, priv)
  return concat(rs, Uint8Array.of(v + 27))
}

const typed = (domain: Uint8Array, type: string, ...fields: Uint8Array[]) =>
  keccak_256(concat(Uint8Array.of(0x19, 1), domain, keccak_256(concat(kstr(type), ...fields))))
const domain = (name: string, chainId: number, contract?: string) =>
  contract
    ? keccak_256(concat(kstr('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), kstr(name), kstr('1'), word(chainId), word(BigInt(contract))))
    : keccak_256(concat(kstr('EIP712Domain(string name,string version,uint256 chainId)'), kstr(name), kstr('1'), word(chainId)))

/** KEY_ADD that registers `signerPriv` for `fid` without an on-chain tx (Hypersnap gasless signers). */
export function keyAdd(fid: number, custody: Uint8Array, signerPriv: Uint8Array, nonce: number) {
  const key = ed25519.getPublicKey(signerPriv)
  const deadline = Math.floor(Date.now() / 1000) + 3600
  const ttl = 90 * 86400
  const dom = domain('Farcaster KeyAdd', 1)
  const skr = sign65(typed(dom, 'SignedKeyRequest(uint256 requestFid,bytes key,uint256 deadline)', word(fid), keccak_256(key), word(deadline)), custody)
  // abi.encode((uint256 requestFid, address requestSigner, bytes signature, uint256 deadline))
  const metadata = concat(word(32), word(fid), word(BigInt(address(custody))), word(128), word(deadline), word(65), skr, new Uint8Array(31))
  const custodySig = sign65(
    typed(dom, 'KeyAdd(uint256 fid,bytes key,uint32 keyType,uint32[] scopes,uint32 ttl,uint32 nonce,uint256 deadline)',
      word(fid), keccak_256(key), word(1), keccak_256(concat(...SCOPES.map(word))), word(ttl), word(nonce), word(deadline)),
    custody,
  )
  return envelope(MT.KEY_ADD, fid, pb([1, key], [2, 1], [3, custodySig], [4, deadline], [5, nonce], [6, metadata], [7, 1], [9, SCOPES], [10, ttl]), signerPriv)
}

/** Signature the fname server wants to assign `name` to the custody address. */
export function fnameProof(name: string, timestamp: number, custody: Uint8Array) {
  const owner = address(custody)
  const dom = domain('Farcaster name verification', 1, '0xe3be01d99baa8db9905b33a3ca391238234b79d1')
  return { owner, signature: '0x' + hex(sign65(typed(dom, 'UserNameProof(string name,uint256 timestamp,address owner)', kstr(name), word(timestamp), word(BigInt(owner))), custody)) }
}

/** Turn "@alice hi" into mention-free text plus byte positions, resolving names via `lookup`. */
export async function mentions(text: string, lookup: (name: string) => Promise<number | undefined>) {
  const out = { text: '', mentions: [] as number[], positions: [] as number[] }
  let last = 0
  for (const m of text.matchAll(/(^|\s)@([a-z0-9][a-z0-9.-]*[a-z0-9])/gi)) {
    const fid = await lookup(m[2].toLowerCase())
    if (!fid) continue
    const at = m.index! + m[1].length
    out.text += text.slice(last, at)
    out.mentions.push(fid)
    out.positions.push(utf8(out.text).length)
    last = at + m[2].length + 1
  }
  out.text += text.slice(last)
  return out
}
