import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encrypt, validSubscription } from './push.mjs'

const u = (s) => Buffer.from(s, 'base64url')

test('encrypts exactly like the example in RFC 8291', () => {
  const body = encrypt('When I grow up, I want to be a watermelon',
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), u('DGv6ra1nlYgDCS1FRnbzlw'))
  assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')
})

test('only real push services take subscriptions', () => {
  const keys = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }
  assert.ok(validSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }))
  assert.ok(validSubscription({ endpoint: 'https://web.push.apple.com/QK', keys }))
  assert.ok(!validSubscription({ endpoint: 'https://evil.example/fcm.googleapis.com/', keys }))
  assert.ok(!validSubscription({ endpoint: 'https://fcm.googleapis.com.evil.example/x', keys }))
  assert.ok(!validSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys }))
  assert.ok(!validSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...keys, auth: 'AA' } }))
})
