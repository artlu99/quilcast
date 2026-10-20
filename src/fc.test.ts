import assert from 'node:assert/strict'
import { test } from 'node:test'
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
