// Uploads, in small steps so no request outlives the proxy's 60 s limit:
//   POST /api/upload            start: checks the custody signature, returns { id }
//   PUT  /api/upload/<id>?offset=n   append one chunk (≤ 8 MB)
//   POST /api/upload/<id>/done  hand the file to Farcaster's CDN (or our volume) in the background
//   GET  /api/upload/<id>       { state: 'receiving' | 'processing' | 'ready' | 'failed', url?, error? }
// Farcaster's CDN takes uploads the way Quorum does it, with a farcaster.xyz token the browser
// signs with the custody key; it only serves accounts that have a Warpcast signer, so other
// accounts' files are kept on our volume and served from /m/<name>.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'

const FC = 'https://client.farcaster.xyz'
const FC_HEADERS = { origin: 'https://farcaster.xyz', referer: 'https://farcaster.xyz/', accept: 'application/json' }
export const MEDIA = process.env.MEDIA_DIR || '/data/media'
const TMP = join(MEDIA, '..', 'incoming')
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
const LIMIT = { image: 10e6, video: 100e6 }
const CHUNK = 8 * 1024 * 1024

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
  const r = await fetch(FC + path, { ...init, headers: { ...FC_HEADERS, 'content-type': 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw fail(r.status, j.errors?.[0]?.reason || j.errors?.[0]?.message || `farcaster.xyz ${r.status}`)
  return j.result
}

async function toCdn(job, body) {
  const { kind, type, token } = job
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
  if (!location) throw fail(502, `video upload failed (${created.status} ${(await created.text().catch(() => '')).slice(0, 120)})`)
  const patched = await fetch(new URL(location, prep.uploadUrl), { method: 'PATCH', headers: { ...prep.headers, 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' }, body })
  if (!patched.ok) throw fail(502, `video upload failed (${patched.status} ${(await patched.text().catch(() => '')).slice(0, 120)})`)
  job.state = 'processing'
  for (let i = 0; i < 150; i++) {
    const { video } = await fcJson(`/v1/uploaded-video?videoId=${encodeURIComponent(prep.videoId)}`, token)
    if (video.state === 'ready' && video.embed?.sourceUrl) return video.embed.sourceUrl
    if (video.state === 'failed') throw fail(502, 'video processing failed')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw fail(504, 'video processing timed out')
}

// ponytail: jobs live in memory, so a deploy mid-upload loses them; the browser just shows the error
const jobs = new Map()
setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.at > 3600e3) jobs.delete(id), rm(j.file, { force: true })
}, 600e3).unref()

/** POST /api/upload: verify who is uploading and decide where the file will go. */
export async function start(req, { node }) {
  const type = req.headers['content-type']
  const kind = type?.split('/')[0]
  if (!EXT[type]) throw fail(415, 'Use a JPEG, PNG, GIF, WebP, MP4, WebM or MOV file.')
  const size = Number(req.headers['x-size'])
  if (!(size > 0)) throw fail(400, 'missing size')
  if (size > LIMIT[kind]) throw fail(413, `Files are limited to ${LIMIT[kind] / 1e6} MB.`)
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
  const user = await fetch(`${node}/v2/farcaster/user?fid=${fid}`).then((r) => (r.ok ? r.json() : null))
  if (!user?.user?.custody_address || user.user.custody_address.toLowerCase() !== signerOf(authRequest, bearer)) throw fail(401, 'signature does not match this account')
  // a farcaster.xyz token means the CDN will take it; no token (no Warpcast signer) means our volume
  let token
  try {
    const r = await fetch(FC + '/v2/onboarding-state', { method: 'PUT', headers: { ...FC_HEADERS, 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ authRequest }), signal: AbortSignal.timeout(20000) })
    token = (await r.json()).result?.token?.secret
    if (token) await fcJson('/v1/generate-image-upload-url', token, { method: 'POST', body: '{}' }).catch((e) => e.message === 'missing_warpcast_signer' && (token = undefined))
  } catch {}
  const id = randomUUID()
  await mkdir(TMP, { recursive: true })
  jobs.set(id, { id, kind, type, size, token, file: join(TMP, id), received: 0, state: 'receiving', at: Date.now() })
  return { id, chunk: CHUNK }
}

/** PUT /api/upload/<id>?offset=n: append one chunk; offsets must line up so retries are safe. */
export async function chunk(req, id, offset) {
  const job = jobs.get(id)
  if (!job || job.state !== 'receiving') throw fail(404, 'unknown upload')
  if (offset !== job.received) return { received: job.received }
  const out = createWriteStream(job.file, { flags: 'a' })
  let n = 0
  try {
    for await (const c of req) {
      if ((n += c.length) > CHUNK || job.received + n > job.size) throw fail(413, 'chunk too large')
      if (!out.write(c)) await new Promise((r) => out.once('drain', r))
    }
    await new Promise((r, e) => out.end((err) => (err ? e(err) : r())))
  } catch (e) {
    // a chunk cut off halfway must not leave its bytes behind, or the retry would land after them
    await new Promise((r) => out.destroy() && out.once('close', r))
    await truncate(job.file, job.received).catch(() => {})
    throw e
  }
  job.received = (await stat(job.file)).size
  return { received: job.received }
}

/** POST /api/upload/<id>/done: process in the background; poll with GET. */
export function done(id, { site }) {
  const job = jobs.get(id)
  if (!job || job.state !== 'receiving') throw fail(404, 'unknown upload')
  if (job.received !== job.size) throw fail(400, 'upload incomplete')
  job.state = 'sending'
  ;(async () => {
    const body = await readFile(job.file)
    if (job.token) job.url = await toCdn(job, body)
    else {
      const name = `${createHash('sha256').update(body).digest('hex').slice(0, 24)}.${EXT[job.type]}`
      await mkdir(MEDIA, { recursive: true })
      await rename(job.file, join(MEDIA, name))
      job.url = `${site}/m/${name}`
    }
    job.state = 'ready'
  })()
    .catch((e) => {
      console.error('upload', id, e)
      job.state = 'failed'
      job.error = e.status ? e.message : 'Upload failed'
    })
    .finally(() => rm(job.file, { force: true }))
  return status(id)
}

export function status(id) {
  const j = jobs.get(id)
  if (!j) throw fail(404, 'unknown upload')
  return { state: j.state, received: j.received, size: j.size, url: j.url, error: j.error }
}
