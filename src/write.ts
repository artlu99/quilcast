// Signed writes: everything here needs the account's keys.
import { ed25519 } from '@noble/curves/ed25519.js'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { account, fidByName, setAccount, settings } from './api.ts'
import { castBody, castRemoveBody, envelope, followBody, hex, keyAdd, mentions, MT, reactionBody, unhex, userDataBody } from './fc.ts'

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

const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'"]/g
export async function post(text: string, parent?: { fid: number; hash: string }) {
  const m = await mentions(text, fidByName)
  return send(MT.CAST_ADD, castBody({ ...m, parent, embeds: [...new Set(m.text.match(URL_RE) || [])].slice(0, 2) }))
}

export const deleteCast = (hash: string) => send(MT.CAST_REMOVE, castRemoveBody(hash))
export const react = (type: 1 | 2, on: boolean, c: { author: { fid: number }; hash: string }) =>
  send(on ? MT.REACTION_ADD : MT.REACTION_REMOVE, reactionBody(type, c.author.fid, c.hash))
export const follow = (fid: number, on: boolean) => send(on ? MT.LINK_ADD : MT.LINK_REMOVE, followBody(fid))
export const setUserData = (type: number, value: string) => send(MT.USER_DATA_ADD, userDataBody(type, value))

