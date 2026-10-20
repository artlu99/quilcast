// Signed writes: everything here needs the account's keys.
import { ed25519 } from '@noble/curves/ed25519.js'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { account, fidByName, LINK_RE, setAccount, settings, toUrl } from './api.ts'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { castBody, castRemoveBody, concat, ecSign, envelope, followBody, hex, keyAdd, mentions, MT, reactionBody, unhex, userDataBody, type CastRef } from './fc.ts'

/** Custody key the same way Warpcast and Quorum derive it, so phrases move between apps. */
export const custodyKey = (phrase: string) => HDKey.fromMasterSeed(mnemonicToSeedSync(phrase.trim().toLowerCase())).derive("m/44'/60'/0'/0/0").privateKey!

async function submit(m: { msg: Uint8Array; hash: string }) {
  const r = await fetch(`${settings.node}/v1/submitMessage`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: m.msg as BodyInit })
  if (!r.ok) {
    const t = await r.text()
    let msg = t
    try {
      msg = JSON.parse(t).details || JSON.parse(t).message || t
    } catch {}
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return m.hash
}

const TTL = 90 * 86400
/** Make sure this browser holds a live Hypersnap signer for the account, adding or renewing one when needed. */
export async function ensureSigner(a = account!) {
  const now = Math.floor(Date.now() / 1000)
  if (a.signer && a.signerAt! + TTL - 7 * 86400 > now) return
  const priv = a.signer ? unhex(a.signer) : ed25519.utils.randomSecretKey()
  const nonce = Math.max((a.nonce || 0) + 1, now)
  await submit(keyAdd(a.fid!, custodyKey(a.phrase), priv, nonce))
  setAccount({ ...a, signer: hex(priv), signerAt: now, nonce })
}

const send = async (type: number, body: Uint8Array) => {
  await ensureSigner()
  return submit(envelope(type, account!.fid!, body, unhex(account!.signer!)))
}

/** A cast can carry two embeds: uploads and a quoted cast first, then links from the text. */
export async function post(text: string, o: { parent?: CastRef; channel?: string; quote?: CastRef; media?: string[] } = {}) {
  const m = await mentions(text, fidByName)
  const embeds: (string | CastRef)[] = [...(o.media || []), ...(o.quote ? [o.quote] : [])]
  for (const u of new Set((m.text.match(LINK_RE) || []).map(toUrl))) embeds.length < 2 && embeds.push(u)
  return send(MT.CAST_ADD, castBody({ ...m, parent: o.parent || o.channel, embeds: embeds.slice(0, 2) }))
}

/** Upload a file through our server to Farcaster's CDN (or our own storage), authorized by a
 *  10-minute farcaster.xyz token request signed with the custody key. Returns the embed URL. */
export async function upload(file: Blob) {
  const ts = Date.now()
  const authRequest = { method: 'generateToken', params: { timestamp: ts, expiresAt: ts + 600e3 } }
  const msg = new TextEncoder().encode(`{"method":"generateToken","params":{"expiresAt":${ts + 600e3},"timestamp":${ts}}}`)
  const { rs, v } = ecSign(keccak_256(concat(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`), msg)), custodyKey(account!.phrase))
  const bearer = 'eip191:' + btoa(String.fromCharCode(...rs, v + 27))
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': file.type, authorization: `Bearer ${bearer}`, 'x-auth-request': JSON.stringify(authRequest), 'x-fid': String(account!.fid) }, body: file })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.url) throw new Error(j.error || `Upload failed (${r.status})`)
  return j.url as string
}

export const deleteCast = (hash: string) => send(MT.CAST_REMOVE, castRemoveBody(hash))
export const react = (type: 1 | 2, on: boolean, c: { author: { fid: number }; hash: string }) =>
  send(on ? MT.REACTION_ADD : MT.REACTION_REMOVE, reactionBody(type, c.author.fid, c.hash))
export const follow = (fid: number, on: boolean) => send(on ? MT.LINK_ADD : MT.LINK_REMOVE, followBody(fid))
export const setUserData = (type: number, value: string) => send(MT.USER_DATA_ADD, userDataBody(type, value))

