import assert from 'node:assert/strict'
import { test } from 'node:test'

// api.ts and write.ts expect a browser; this is just enough of one
;(globalThis as any).addEventListener = () => {}
import { rlp } from './eth.ts'
import { hex, mentions, pb } from './fc.ts'

const b = (s: string) => new TextEncoder().encode(s)

test('rlp matches the spec vectors', () => {
  assert.equal(hex(rlp(b('dog'))), '83646f67')
  assert.equal(hex(rlp([b('cat'), b('dog')])), 'c88363617483646f67')
  assert.equal(hex(rlp(new Uint8Array())), '80')
  assert.equal(hex(rlp(Uint8Array.of(0x0f))), '0f')
  assert.equal(hex(rlp([])), 'c0')
  assert.equal(hex(rlp(b('Lorem ipsum dolor sit amet, consectetur adipisicing elit'))).slice(0, 4), 'b838')
})

test('pb writes varints, strings and packed arrays', () => {
  assert.equal(hex(pb([1, 150])), '089601')
  assert.equal(hex(pb([2, 'hi'], [3, ''], [4, undefined])), '12026869')
  assert.equal(hex(pb([9, [1, 300]])), '4a03 01ac02'.replace(' ', ''))
})

test('mentions strip names and record utf-8 byte offsets', async () => {
  const fids: Record<string, number> = { alice: 1, 'bob.eth': 2 }
  const m = await mentions('héllo @alice and @bob.eth, not @nobody', async (n) => fids[n])
  assert.equal(m.text, 'héllo  and , not @nobody')
  assert.deepEqual(m.mentions, [1, 2])
  assert.deepEqual(m.positions, [7, 12])
})

test('castText puts mentions back at their byte offsets', async () => {
  ;(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { castText } = await import('./api.ts')
  const c = { text: 'hé  and ', mentioned_profiles: [{ fid: 1, username: 'a' }, { fid: 2, username: 'b.eth' }], mentioned_profiles_ranges: [{ start: 4, end: 4 }, { start: 9, end: 9 }] } as any
  assert.equal(castText(c), 'hé @a and @b.eth')
})

test('LINK_RE finds links people type, with or without a scheme', async () => {
  ;(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { LINK_RE } = await import('./api.ts')
  const m = (s: string) => s.match(LINK_RE) || []
  assert.deepEqual(m('yeah, quilcast.com, getting the launch video ready'), ['quilcast.com'])
  assert.deepEqual(m('see https://a.b/c?d=1.'), ['https://a.b/c?d=1'])
  assert.deepEqual(m('try x.com/foo/bar. ok'), ['x.com/foo/bar'])
  assert.deepEqual(m('@bob.eth and mail me at a@b.com, e.g. node.js'), [])
  assert.deepEqual(m('docs.github.io and sub.quilcast.com'), ['docs.github.io', 'sub.quilcast.com'])
})

test('custody key from WebCrypto PBKDF2 matches the BIP-39 reference derivation', async () => {
  ;(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { custodyKey } = await import('./write.ts')
  const { mnemonicToSeedSync } = await import('@scure/bip39')
  const { HDKey } = await import('@scure/bip32')
  for (const phrase of ['legal winner thank year wave sausage worth useful legal winner thank yellow', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about']) {
    const ref = HDKey.fromMasterSeed(mnemonicToSeedSync(phrase)).derive("m/44'/60'/0'/0/0").privateKey!
    assert.equal(hex(await custodyKey(`  ${phrase.toUpperCase().replace(/ /g, '   ')} `)), hex(ref))
  }
})

test('video metadata boxes become free boxes without moving any bytes', async () => {
  ;(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { stripVideoMeta } = await import('./write.ts')
  const box = (type: string, ...kids: Uint8Array[]) => {
    const body = kids.length ? Uint8Array.from(kids.flatMap((k) => [...k])) : new TextEncoder().encode(type === '©xyz' ? '+37.7749-122.4194/' : 'data')
    const out = new Uint8Array(8 + body.length)
    new DataView(out.buffer).setUint32(0, out.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(body, 8)
    return out
  }
  const file = Uint8Array.from([...box('ftyp'), ...box('moov', box('mvhd'), box('udta', box('©xyz')), box('trak', box('tkhd'), box('udta')), box('meta')), ...box('mdat')])
  const out = new Uint8Array(await (await stripVideoMeta(new Blob([file], { type: 'video/mp4' }))).arrayBuffer())
  const text = new TextDecoder('latin1').decode(out)
  assert.equal(out.length, file.length)
  assert.ok(!text.includes('udta') && !text.includes('meta') && !text.includes('+37.7749'))
  assert.ok(text.includes('ftyp') && text.includes('moov') && text.includes('mvhd') && text.includes('tkhd') && text.includes('mdat'))
})

test('safeUrl lets only public http(s) URLs through', async () => {
  ;(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { safeUrl } = await import('./api.ts')
  for (const bad of ['javascript:alert(document.cookie)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'blob:https://x.com/1', 'http://localhost:3000/', 'http://127.0.0.1/', 'http://192.168.1.1/reboot', 'http://10.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://router.local/', 'https://user:pw@example.com/', '//evil.com', '', undefined, null, 42 as any])
    assert.equal(safeUrl(bad), undefined, String(bad))
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(safeUrl('http://imagedelivery.net/x/original'), 'http://imagedelivery.net/x/original')
})
