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

const json = async (r: Response) => {
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`)
  return j
}
// XHR rather than fetch, for upload progress events
const put = (url: string, body: Blob, onSent: (n: number) => void) =>
  new Promise<{ received: number }>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    x.upload.onprogress = (e) => onSent(e.loaded)
    x.onload = () => (x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(JSON.parse(x.responseText || '{}').error || `Upload failed (${x.status})`)))
    x.onerror = () => reject(new Error('Network error'))
    x.send(body)
  })

export type Progress = (stage: 'uploading' | 'processing', fraction?: number, secondsLeft?: number) => void

/** Upload a file in chunks through our server, which passes it to Farcaster's CDN (or keeps it).
 *  Authorized by a farcaster.xyz token request signed with the custody key. Returns the embed URL. */
export async function upload(file: Blob, progress: Progress = () => {}) {
  const ts = Date.now()
  const exp = ts + 3500e3
  const authRequest = { method: 'generateToken', params: { timestamp: ts, expiresAt: exp } }
  const msg = new TextEncoder().encode(`{"method":"generateToken","params":{"expiresAt":${exp},"timestamp":${ts}}}`)
  const { rs, v } = ecSign(keccak_256(concat(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`), msg)), custodyKey(account!.phrase))
  const headers = { 'content-type': file.type, authorization: `Bearer eip191:${btoa(String.fromCharCode(...rs, v + 27))}`, 'x-auth-request': JSON.stringify(authRequest), 'x-fid': String(account!.fid), 'x-size': String(file.size) }
  const { id, chunk: max } = await json(await fetch('/api/upload', { method: 'POST', headers }))
  progress('uploading', 0)
  // each request must finish well inside the proxy's 60 s, so chunks grow on fast links and shrink on slow ones
  let size = 512 * 1024
  const began = Date.now()
  for (let off = 0, tries = 0; off < file.size; ) {
    const t = Date.now()
    try {
      off = (await put(`/api/upload/${id}?offset=${off}`, file.slice(off, off + size), (n) => {
        const done = off + n
        const rate = done / Math.max(1, (Date.now() - began) / 1000)
        progress('uploading', Math.min(1, done / file.size), (file.size - done) / rate)
      })).received
      const took = (Date.now() - t) / 1000
      size = took < 5 ? Math.min(max, size * 2) : took > 20 ? Math.max(128 * 1024, size / 2) : size
      tries = 0
    } catch (e) {
      size = Math.max(128 * 1024, size / 2)
      if (++tries > 4) throw e
      await new Promise((r) => setTimeout(r, 1000 * tries))
    }
  }
  progress('processing')
  let st = await json(await fetch(`/api/upload/${id}/done`, { method: 'POST' }))
  while (st.state === 'sending' || st.state === 'processing') {
    await new Promise((r) => setTimeout(r, 1500))
    st = await json(await fetch(`/api/upload/${id}`))
  }
  if (st.state !== 'ready' || !st.url) throw new Error(st.error || 'Upload failed')
  return st.url as string
}

export const deleteCast = (hash: string) => send(MT.CAST_REMOVE, castRemoveBody(hash))
export const react = (type: 1 | 2, on: boolean, c: { author: { fid: number }; hash: string }) =>
  send(on ? MT.REACTION_ADD : MT.REACTION_REMOVE, reactionBody(type, c.author.fid, c.hash))
export const follow = (fid: number, on: boolean) => send(on ? MT.LINK_ADD : MT.LINK_REMOVE, followBody(fid))
export const setUserData = (type: number, value: string) => send(MT.USER_DATA_ADD, userDataBody(type, value))

