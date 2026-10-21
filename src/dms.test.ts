import assert from 'node:assert/strict'
import { test } from 'node:test'

// dms.ts expects a browser; this is just enough of one
;(globalThis as any).addEventListener = () => {}
;(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} }

test('merge keeps messages in order, drops repeats, and hands back the same array when nothing changed', async () => {
  const { merge } = await import('./dms.ts')
  const m = (id: string, t: number, message = id) => ({ conversationId: 'c', messageId: id, senderFid: 1, serverTimestamp: t, type: 'text', message })
  const a = [m('a', 1), m('b', 2)]
  assert.equal(merge(a, [m('b', 2)]), a)
  assert.deepEqual(merge(a, [m('c', 3), m('a', 1)]).map((x) => x.messageId), ['a', 'b', 'c'])
  assert.equal(merge(a, [m('b', 2, 'edited')])[1].message, 'edited')
  assert.deepEqual(merge([], [m('z', 9), m('y', 1)]).map((x) => x.messageId), ['y', 'z'])
})
