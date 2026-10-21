// Web Push without a library: the message is encrypted for the browser (RFC 8291, aes128gcm) and the request
// carries a VAPID token (RFC 8292) signed with this server's key, which lives in the data volume.
import { createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign, createCipheriv } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeGet } from './net.mjs'

const b64 = (b) => Buffer.from(b).toString('base64url')
const unb64 = (s) => Buffer.from(String(s), 'base64url')

/** The body for a push message: `plain` encrypted for the subscription's keys. `priv` and `salt` are fixed only in tests. */
export function encrypt(plain, { p256dh, auth }, priv, salt = randomBytes(16)) {
  const as = createECDH('prime256v1')
  priv ? as.setPrivateKey(priv) : as.generateKeys()
  const ua = unb64(p256dh)
  const asPublic = as.getPublicKey()
  const ikm = Buffer.from(hkdfSync('sha256', as.computeSecret(ua), unb64(auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]), 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12))
  const c = createCipheriv('aes-128-gcm', cek, nonce)
  // one record: the text, then the 0x02 "last record" delimiter
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(plain), Buffer.of(2)])), c.final(), c.getAuthTag()])
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.of(asPublic.length), asPublic, body])
}

let vapid
/** This server's VAPID key pair, made on first use and kept in `dir`. */
export function keys(dir) {
  if (vapid) return vapid
  const file = join(dir, 'vapid.json')
  let jwk
  try {
    jwk = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' })
    writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 })
  }
  const pub = createPublicKey(createPrivateKey({ key: jwk, format: 'jwk' })).export({ format: 'jwk' })
  return (vapid = { key: createPrivateKey({ key: jwk, format: 'jwk' }), public: b64(Buffer.concat([Buffer.of(4), unb64(pub.x), unb64(pub.y)])) })
}

// browsers' push services; the endpoint comes from the browser, so nothing else is ever contacted
const SERVICES = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|push\.services\.mozilla\.com)\//
export const validSubscription = (s) =>
  !!s && typeof s.endpoint === 'string' && s.endpoint.length < 1000 && SERVICES.test(s.endpoint) &&
  typeof s.keys?.p256dh === 'string' && unb64(s.keys.p256dh).length === 65 && typeof s.keys?.auth === 'string' && unb64(s.keys.auth).length === 16

/** Send one push. Resolves the push service's status (404/410 mean the subscription is gone). */
export async function push(dir, sub, data) {
  const { key, public: pub } = keys(dir)
  const head = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const claims = b64(JSON.stringify({ aud: new URL(sub.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://quilcast.com' }))
  const jwt = `${head}.${claims}.${b64(sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }))}`
  const body = encrypt(JSON.stringify(data), sub.keys)
  const r = await safeGet(sub.endpoint, {
    method: 'POST', body, max: 4000,
    headers: { authorization: `vapid t=${jwt}, k=${pub}`, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', 'content-length': body.length, ttl: '86400', urgency: 'normal' },
  })
  return r.status
}
