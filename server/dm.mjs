// /api/dm/<op>: farcaster.xyz direct casts. They aren't on the Farcaster network and farcaster.xyz's API
// only answers its own site, so the browser's requests pass through here. The browser holds a token that
// opens its direct casts and nothing else (minted from a custody-signed message, see write.ts); it rides
// along on each request and is never kept or logged, and only these endpoints are reachable.
import { randomUUID } from 'node:crypto'
import { fail } from './net.mjs'
import { FC, FC_HEADERS } from './upload.mjs'

const OPS = {
  nonce: ['GET', '/v2/get-dc-nonce'],
  inbox: ['GET', '/v2/direct-cast-inbox', ['category', 'cursor', 'limit']],
  conversation: ['GET', '/v2/direct-cast-conversation', ['conversationId']],
  messages: ['GET', '/v2/direct-cast-conversation-messages', ['conversationId', 'cursor', 'limit']],
  // sending goes through the newer /fc API, which takes this token (direct-cast-send wants a full session)
  send: ['PUT', '/fc/message'],
  read: ['POST', '/v2/direct-cast-mark-read'],
  category: ['POST', '/v2/direct-cast-conversation-categorization'],
}

async function json(req) {
  let s = ''
  for await (const c of req) if ((s += c).length > 16e3) throw fail(413, 'too long')
  try {
    return JSON.parse(s)
  } catch {
    throw fail(400, 'bad json')
  }
}

/** Relay one call; resolves { status, body } with farcaster.xyz's own answer. */
export async function dm(req, op, url) {
  // the token exchange takes the signed message in a body, so it never sits in a URL (or a proxy's log)
  if (op === 'token') {
    if (req.method !== 'POST') throw fail(405, 'POST only')
    const { message, signature } = await json(req)
    if (typeof message !== 'string' || message.length > 2000 || !/^0x[0-9a-f]{130}$/i.test(signature)) throw fail(400, 'bad signature')
    return call('GET', `/v2/get-dc-auth-token?${new URLSearchParams({ message, signature })}`)
  }
  if (!Object.hasOwn(OPS, op)) throw fail(404, 'not found')
  const [method, path, params = []] = OPS[op]
  if (req.method !== method) throw fail(405, `${method} only`)
  const qs = new URLSearchParams(params.flatMap((k) => (url.searchParams.has(k) ? [[k, url.searchParams.get(k).slice(0, 300)]] : [])))
  const token = String(req.headers.authorization || '').match(/^Bearer (\S{10,500})$/)?.[1]
  if (!token && op !== 'nonce') throw fail(401, 'Open messages first.')
  return call(method, path + (qs.size ? `?${qs}` : ''), token, method === 'GET' ? undefined : JSON.stringify(await json(req)))
}

async function call(method, path, token, body) {
  const headers = { ...FC_HEADERS, ...(token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json', 'idempotency-key': randomUUID() }) }
  const r = await fetch(FC + path, { method, headers, body, signal: AbortSignal.timeout(15000) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
