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
