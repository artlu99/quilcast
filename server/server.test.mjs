// Starts the real server against a fake Hypersnap node and pokes the edges that matter:
// malformed URLs, meta-tag injection, SSRF through card images, Range, upload types, headers.
// Needs a build (dist/index.html): npm run build && npm test
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { address, ecSign } from '../src/fc.ts'

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))
let internalHits = 0
const internal = createServer((q, r) => (internalHits++, r.end('secret')))
const internalPort = await listen(internal)
const evil = '$& $\' $` "><script>alert(1)</script>'
const key = secp256k1.utils.randomSecretKey()
const node = createServer((q, r) => {
  const u = new URL(q.url, 'http://x')
  r.setHeader('content-type', 'application/json')
  if (u.pathname === '/v2/farcaster/cast')
    return r.end(JSON.stringify({ cast: { hash: u.searchParams.get('identifier'), text: evil, timestamp: '2026-01-01T00:00:00Z', embeds: [{ url: `http://127.0.0.1:${internalPort}/a.png` }], author: { fid: 1, username: 'x', display_name: evil, pfp_url: `http://127.0.0.1:${internalPort}/pfp.png` }, reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } } }))
  if (u.pathname.startsWith('/v2/farcaster/user')) return r.end(JSON.stringify({ user: { fid: 1, username: 'x', display_name: 'X', custody_address: address(key), profile: { bio: { text: evil } } } }))
  r.statusCode = 404
  r.end('{}')
})
const nodePort = await listen(node)
const media = await mkdtemp(join(tmpdir(), 'qc-media-'))
await writeFile(join(media, '0123456789abcdef01234567.png'), Buffer.from('0123456789'))
const port = 40000 + Math.floor(Math.random() * 20000)
const base = `http://127.0.0.1:${port}`
let srv
before(async () => {
  srv = spawn(process.execPath, [new URL('./index.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), NODE_URL: `http://127.0.0.1:${nodePort}`, FC_URL: `http://127.0.0.1:${nodePort}`, MEDIA_DIR: media, SITE_URL: 'https://quilcast.test' }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    if (await fetch(base + '/health').then((r) => r.ok, () => false)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})
after(() => (srv.kill(), internal.close(), node.close()))

test('malformed percent-encoding is a 400, not a crash', async () => {
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400)
  assert.equal(await (await fetch(base + '/health')).text(), 'ok')
})

test('security headers on every page', async () => {
  const r = await fetch(base + '/')
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/)
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
})

test('cast and profile meta tags escape user text, including $ replacement patterns', async () => {
  const hash = 'ab'.repeat(20)
  for (const path of [`/c/${hash}`, `/u/${encodeURIComponent('x"><script>alert(1)</script>')}`]) {
    const html = await (await fetch(base + path)).text()
    assert.ok(!html.includes('<script>alert'), path)
    assert.equal(html.match(/<title>/g).length, 1, path)
    assert.equal(html.match(/<meta property="og:title"/g).length, 1, path)
    assert.ok(!/canonical" href="[^"]*"[^ /]/.test(html), path)
  }
})

test('card images never reach private addresses', async () => {
  internalHits = 0
  const r = await fetch(`${base}/og/c/${'cd'.repeat(20)}.png`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.equal(internalHits, 0)
  assert.equal(await (await fetch(`${base}/api/unfurl?url=${encodeURIComponent(`http://127.0.0.1:${internalPort}/`)}`)).json(), null)
  assert.equal(internalHits, 0)
})

test('media is served inert, with sane ranges', async () => {
  const f = `${base}/m/0123456789abcdef01234567.png`
  const r = await fetch(f)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-security-policy'), /sandbox/)
  assert.equal((await fetch(f, { headers: { range: 'bytes=5-2' } })).status, 416)
  const tail = await fetch(f, { headers: { range: 'bytes=-3' } })
  assert.equal(tail.status, 206)
  assert.equal(await tail.text(), '789')
  assert.equal((await fetch(`${base}/m/0123456789abcdef01234567.html`)).status, 404)
})

test('upload start rejects prototype keys and unknown types', async () => {
  for (const type of ['__proto__', 'constructor', 'text/html', 'image/svg+xml'])
    assert.equal((await fetch(base + '/api/upload', { method: 'POST', headers: { 'content-type': type, 'x-size': '10' } })).status, 415, type)
})

// the farcaster.xyz login request uploads are signed with, as write.ts builds it
const login = (ts, highS = false) => {
  const exp = ts + 600e3
  const msg = Buffer.from(`{"method":"generateToken","params":{"expiresAt":${exp},"timestamp":${ts}}}`)
  let { rs, v } = ecSign(keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg])), key)
  if (highS) {
    // the same signature re-encoded: s → n - s with the other recovery bit, still valid for the same signer
    const n = secp256k1.Point.CURVE().n
    const s = (n - BigInt('0x' + Buffer.from(rs.slice(32)).toString('hex'))).toString(16).padStart(64, '0')
    rs = Buffer.concat([Buffer.from(rs.slice(0, 32)), Buffer.from(s, 'hex')])
    v ^= 1
  }
  return { authorization: `Bearer eip191:${Buffer.from([...rs, v + 27]).toString('base64')}`, 'x-auth-request': JSON.stringify({ method: 'generateToken', params: { timestamp: ts, expiresAt: exp } }) }
}

test('an upload signature works once, also when re-encoded, and the file lands on the volume', async () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]), Buffer.alloc(40)])
  const start = (auth) => fetch(base + '/api/upload', { method: 'POST', headers: { 'content-type': 'image/png', 'x-size': String(png.length), 'x-fid': '1', ...auth } })
  const ts = Date.now()
  const r = await start(login(ts))
  assert.equal(r.status, 200)
  const { id } = await r.json()
  assert.equal((await start(login(ts))).status, 401)
  assert.equal((await start(login(ts, true))).status, 401)
  assert.equal((await fetch(`${base}/api/upload/${id}?offset=0`, { method: 'PUT', body: png })).status, 200)
  let st = await (await fetch(`${base}/api/upload/${id}/done`, { method: 'POST' })).json()
  for (let i = 0; i < 50 && st.state === 'sending'; i++) await new Promise((r) => setTimeout(r, 100)), (st = await (await fetch(`${base}/api/upload/${id}`)).json())
  assert.equal(st.state, 'ready')
  assert.match(st.url, /^https:\/\/quilcast\.test\/m\/[0-9a-f]{24}\.png$/)
})
