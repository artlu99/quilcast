// POST /api/upload: puts an image or video on Farcaster's CDN the way Quorum does, using a
// short-lived farcaster.xyz token the browser signs with the custody key. Farcaster only issues
// upload URLs to accounts that have a Warpcast signer, so for everyone else the file is kept on
// our own volume and served from /m/<name>.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FC = 'https://client.farcaster.xyz'
const FC_HEADERS = { origin: 'https://farcaster.xyz', referer: 'https://farcaster.xyz/', accept: 'application/json' }
export const MEDIA = process.env.MEDIA_DIR || '/data/media'
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
const LIMIT = { image: 10e6, video: 100e6 }

const canon = (o) => (o === null || typeof o !== 'object' ? JSON.stringify(o) : Array.isArray(o) ? `[${o.map(canon).join(',')}]` : `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`)
const fail = (status, message) => Object.assign(new Error(message), { status })

/** Address that signed the farcaster.xyz bearer (EIP-191 over the canonical auth request). */
function signerOf(authRequest, bearer) {
  const sig = Buffer.from(bearer.replace(/^eip191:/, ''), 'base64')
  const msg = Buffer.from(canon(authRequest))
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]))
  const pub = secp256k1.Signature.fromBytes(sig.subarray(0, 64), 'compact').addRecoveryBit(sig[64] - 27).recoverPublicKey(digest).toBytes(false)
  return '0x' + Buffer.from(keccak_256(pub.subarray(1)).subarray(12)).toString('hex')
}

async function fcJson(path, token, init = {}) {
  const r = await fetch(FC + path, { ...init, headers: { ...FC_HEADERS, 'content-type': 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw fail(r.status, j.errors?.[0]?.reason || j.errors?.[0]?.message || `farcaster.xyz ${r.status}`)
  return j.result
}

async function toCdn(kind, type, body, authRequest, bearer) {
  // an address that isn't a known Farcaster custody gets no token: same fallback as a missing signer
  const token = (await fcJson('/v2/onboarding-state', bearer, { method: 'PUT', body: JSON.stringify({ authRequest }) })).token?.secret
  if (!token) throw fail(403, 'missing_warpcast_signer')
  if (kind === 'image') {
    const { url } = await fcJson('/v1/generate-image-upload-url', token, { method: 'POST', body: '{}' })
    const form = new FormData()
    form.append('file', new Blob([body], { type }), `image.${EXT[type]}`)
    const r = await (await fetch(url, { method: 'POST', body: form })).json()
    const original = r.result?.variants?.find((v) => v.endsWith('/original'))
    if (!original) throw fail(502, 'image upload failed')
    return original
  }
  const prep = await fcJson('/v1/prepare-video-upload', token, { method: 'POST', body: JSON.stringify({ videoSizeBytes: body.length, supportsDynamicUpload: true }) })
  // tus: create the upload, then send the bytes in one PATCH
  const meta = Object.entries({ filetype: type, name: 'cast-video', ...prep.metadata }).map(([k, v]) => `${k} ${Buffer.from(String(v)).toString('base64')}`).join(',')
  const created = await fetch(prep.uploadUrl, { method: 'POST', headers: { ...prep.headers, 'Tus-Resumable': '1.0.0', 'Upload-Length': String(body.length), 'Upload-Metadata': meta } })
  const location = created.headers.get('location')
  if (!location) throw fail(502, `video upload failed (${created.status})`)
  const patched = await fetch(new URL(location, prep.uploadUrl), { method: 'PATCH', headers: { ...prep.headers, 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' }, body })
  if (!patched.ok) throw fail(502, `video upload failed (${patched.status})`)
  for (let i = 0; i < 150; i++) {
    const { video } = await fcJson(`/v1/uploaded-video?videoId=${encodeURIComponent(prep.videoId)}`, token)
    if (video.state === 'ready' && video.embed?.sourceUrl) return video.embed.sourceUrl
    if (video.state === 'failed') throw fail(502, 'video processing failed')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw fail(504, 'video processing timed out')
}

export async function upload(req, { node, site }) {
  const type = req.headers['content-type']
  const kind = type?.split('/')[0]
  if (!EXT[type]) throw fail(415, 'Use a JPEG, PNG, GIF, WebP, MP4, WebM or MOV file.')
  let authRequest, fid
  try {
    authRequest = JSON.parse(req.headers['x-auth-request'])
    fid = Number(req.headers['x-fid'])
  } catch {
    throw fail(400, 'missing auth')
  }
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '')
  const { timestamp, expiresAt } = authRequest?.params || {}
  if (authRequest?.method !== 'generateToken' || Math.abs(Date.now() - timestamp) > 600e3 || expiresAt - timestamp > 3600e3) throw fail(401, 'stale auth')

  const chunks = []
  let size = 0
  for await (const c of req) {
    if ((size += c.length) > LIMIT[kind]) throw fail(413, `Files are limited to ${LIMIT[kind] / 1e6} MB.`)
    chunks.push(c)
  }
  const body = Buffer.concat(chunks)

  try {
    return await toCdn(kind, type, body, authRequest, bearer)
  } catch (e) {
    if (e.message !== 'missing_warpcast_signer') throw e
  }
  // our own copy: only for the account whose custody key signed the request
  const user = await fetch(`${node}/v2/farcaster/user?fid=${fid}`).then((r) => (r.ok ? r.json() : null))
  if (!user?.user?.custody_address || user.user.custody_address.toLowerCase() !== signerOf(authRequest, bearer)) throw fail(401, 'signature does not match this account')
  const name = `${createHash('sha256').update(body).digest('hex').slice(0, 24)}.${EXT[type]}`
  await mkdir(MEDIA, { recursive: true })
  await writeFile(join(MEDIA, name), body)
  return `${site}/m/${name}`
}
