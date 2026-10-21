// Direct casts (farcaster.xyz's DMs). Calls go through our relay (server/dm.mjs), since farcaster.xyz only
// answers its own site; live updates come straight from farcaster.xyz's websocket, so nothing polls.
// The Messages pages and the nav dot share the state kept here. Loaded only for accounts that opened messages.
import { account, getUser, setAccount } from './api.ts'

export type Person = { fid: number; username?: string; displayName?: string; pfp?: { url?: string } }
export type Msg = { conversationId: string; messageId: string; senderFid: number; serverTimestamp: number; type: string; message: string; isDeleted?: boolean; senderContext?: Person; state?: 'sending' | 'failed' }
export type Convo = { conversationId: string; name?: string; photoUrl?: string; isGroup: boolean; lastMessage?: Msg; participants?: Person[]; viewerContext: { category?: string; unreadCount?: number; muted?: boolean; counterParty?: Person } }

/** One relayed call. A 401 means the token is gone, so it's dropped and asked for again. */
export async function dm<T = any>(op: string, o: { query?: Record<string, string | number | undefined>; method?: string; body?: unknown } = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(o.query || {}).filter(([, v]) => v !== undefined) as [string, string][])
  const headers: Record<string, string> = account?.dm ? { authorization: `Bearer ${account.dm}` } : {}
  if (o.body) headers['content-type'] = 'application/json'
  const r = await fetch(`/api/dm/${op}?${qs}`, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 && account?.dm) setAccount({ ...account, dm: undefined })
  if (!r.ok) throw new Error(j.errors?.[0]?.message || j.error || `farcaster.xyz said ${r.status}`)
  return j
}

// --- state ---

export const store = {
  inbox: null as Convo[] | null, // newest first; muted ones too, the pages filter
  more: '', // cursor for older conversations
  requests: null as Convo[] | null,
  requestsCount: 0,
  unreadRequests: false,
  convos: new Map<string, Convo>(),
  chats: new Map<string, { msgs: Msg[]; older: string }>(),
  open: '', // the conversation on screen, which reads what arrives
}
export const unread = (c: Convo) => (c.viewerContext.unreadCount || 0) > 0
const subs = new Set<() => void>()
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))
let dot: boolean | undefined
function changed() {
  subs.forEach((f) => f())
  // the nav dot: unread messages that aren't muted, or a new request
  const now = store.unreadRequests || !!store.requests?.some(unread) || !!store.inbox?.some((c) => unread(c) && !c.viewerContext.muted)
  if (now !== dot) dispatchEvent(new CustomEvent('dms', { detail: (dot = now) }))
}

/** `a` plus whatever in `b` is new or changed, oldest first; `a` itself when nothing is. */
export function merge(a: Msg[], b: Msg[]) {
  const have = new Map(a.map((m) => [m.messageId, m]))
  const fresh = b.filter((m) => {
    const x = have.get(m.messageId)
    return !x || x.message !== m.message || x.isDeleted !== m.isDeleted
  })
  if (!fresh.length) return a
  for (const m of fresh) have.set(m.messageId, m)
  return [...have.values()].sort((x, y) => x.serverTimestamp - y.serverTimestamp)
}

const keep = (cs: Convo[]) => (cs.forEach((c) => store.convos.set(c.conversationId, c)), cs)

/** The inbox's first page (or the next one, with `more`); calls that overlap share one request. */
let loading: Promise<void> | undefined
export const loadInbox = (more = false): Promise<void> => (more ? fetchInbox(true) : (loading ||= fetchInbox(false).finally(() => (loading = undefined))))
async function fetchInbox(more: boolean) {
  const r = await dm('inbox', { query: { category: 'default', limit: 50, cursor: more ? store.more : undefined } })
  store.inbox = [...(more ? store.inbox || [] : []), ...keep(r.result.conversations)]
  store.more = r.next?.cursor || ''
  store.requestsCount = r.result.requestsCount || 0
  store.unreadRequests = !!r.result.hasUnreadRequests
  changed()
}

export async function loadRequests() {
  store.requests = keep((await dm('inbox', { query: { category: 'request', limit: 50 } })).result.conversations)
  changed()
}

/** A conversation's latest messages (20 when some are already here, which is all a refresh needs), or earlier ones. */
export async function loadChat(id: string, earlier = false) {
  const chat = store.chats.get(id) || { msgs: [], older: '' }
  const limit = earlier || !chat.msgs.length ? 50 : 20
  const r = await dm('messages', { query: { conversationId: id, limit, cursor: earlier ? chat.older : undefined } })
  const got: Msg[] = r.result.messages
  // a full page that doesn't reach what we have leaves a gap: start over from it
  const gap = !earlier && chat.msgs.length > 0 && got.length === limit && !got.some((m) => chat.msgs.some((x) => x.messageId === m.messageId))
  const msgs = merge(gap ? [] : chat.msgs, got)
  const older = earlier || gap || !chat.msgs.length ? r.next?.cursor || '' : chat.older
  if (msgs === chat.msgs && older === chat.older && store.chats.has(id)) return
  store.chats.set(id, { msgs, older })
  changed()
}

/** The conversation `id`, from the inbox or the network; a 1:1 nobody has written in yet is made up from its id (the two FIDs, sorted). */
export async function lookup(id: string) {
  if (store.convos.has(id)) return store.convos.get(id)!
  const me = account!.fid!
  let c: Convo
  try {
    c = (await dm('conversation', { query: { conversationId: id } })).result.conversation
  } catch (e) {
    const fid = /^\d+-\d+$/.test(id) && id.split('-').includes(String(me)) ? Number(id.split('-').find((f) => f !== String(me))) : 0
    if (!fid) throw e
    const u = await getUser(fid).catch(() => ({ fid }) as { fid: number; username?: string; display_name?: string; pfp_url?: string })
    c = { conversationId: id, isGroup: false, viewerContext: { category: 'default', counterParty: { fid, username: u.username, displayName: u.display_name, pfp: { url: u.pfp_url } } } }
  }
  store.convos.set(id, c)
  changed()
  return c
}

// --- actions ---

export function read(id: string) {
  const c = store.convos.get(id)
  if (!c || !unread(c)) return
  c.viewerContext.unreadCount = 0
  changed()
  dm('read', { method: 'POST', body: { conversationId: id } }).catch(() => {})
}

export async function mute(c: Convo, muted: boolean) {
  c.viewerContext.muted = muted
  changed()
  try {
    await dm('mute', { method: 'POST', body: { conversationId: c.conversationId, muted } })
  } catch (e) {
    c.viewerContext.muted = !muted
    changed()
    throw e
  }
}

// newest conversation on top of the inbox, and out of requests once it's answered
function bump(c: Convo, m: Msg) {
  c.lastMessage = m
  if (c.viewerContext.category === 'request') return
  store.inbox = [c, ...(store.inbox || []).filter((x) => x.conversationId !== c.conversationId)]
}

/** Send `text`, shown right away and swapped for farcaster.xyz's copy once it's through. */
export async function send(c: Convo, text: string) {
  const me = account!.fid!
  const id = c.conversationId
  const chat = store.chats.get(id) || { msgs: [], older: '' }
  store.chats.set(id, chat)
  const temp: Msg = { conversationId: id, messageId: crypto.randomUUID(), senderFid: me, serverTimestamp: Date.now(), type: 'text', message: text, state: 'sending' }
  const settle = (m: Msg) => {
    // the websocket may have brought farcaster.xyz's copy first
    chat.msgs = chat.msgs.some((x) => x.messageId === m.messageId && x !== temp) ? chat.msgs.filter((x) => x !== temp) : chat.msgs.map((x) => (x === temp ? m : x))
    changed()
  }
  chat.msgs = [...chat.msgs, temp]
  changed()
  try {
    // replying to a request (or an archived conversation) moves it to the inbox, as farcaster.xyz does
    if (c.viewerContext.category && c.viewerContext.category !== 'default') {
      await dm('category', { method: 'POST', body: { conversationId: id, category: 'default' } })
      c.viewerContext.category = 'default'
      store.requests = store.requests?.filter((x) => x !== c) || null
      store.requestsCount = Math.max(0, store.requestsCount - 1)
    }
    const to = c.isGroup ? { groupId: id } : { recipientFid: c.viewerContext.counterParty?.fid || c.participants?.find((p) => p.fid !== me)?.fid }
    const r = await dm('send', { method: 'PUT', body: { ...to, message: text } })
    const sent = { ...temp, messageId: r.result?.messageId || temp.messageId, state: undefined }
    settle(sent)
    bump(c, sent)
    changed()
  } catch (e) {
    settle({ ...temp, state: 'failed' })
    throw e
  }
}

// --- live updates ---

type Event = { messageType: string; payload?: { conversationId?: string; message?: Msg } }
function handle({ messageType, payload }: Event) {
  const id = payload?.conversationId
  if (!id) return
  const c = store.convos.get(id)
  if (messageType === 'refresh-direct-cast-conversation' && payload!.message) {
    const m = payload!.message
    const chat = store.chats.get(id)
    if (chat) chat.msgs = merge(chat.msgs, [m])
    // a conversation we haven't seen (a new one, or a request) comes with the inbox
    if (!c) return void loadInbox().then(() => store.requests && loadRequests()).catch(() => {})
    bump(c, m)
    if (m.senderFid !== account?.fid) {
      // on screen it's read as it arrives; otherwise it counts
      if (store.open === id && document.visibilityState === 'visible') dm('read', { method: 'POST', body: { conversationId: id } }).catch(() => {})
      else c.viewerContext.unreadCount = (c.viewerContext.unreadCount || 0) + 1
    }
    changed()
  } else if (messageType === 'direct-cast-read' && c) {
    c.viewerContext.unreadCount = 0
    changed()
  } else if (messageType === 'refresh-self-direct-casts-inbox') loadInbox().catch(() => {})
}

let ws: WebSocket | undefined
let wsToken = ''
let wait = 1000
let dropped = false
export const stop = () => ((wsToken = ''), ws?.close())
/** Load the inbox and listen for changes; reconnects with backoff, and a 4001 means the token was revoked. */
export function start() {
  if (!account?.dm || (ws && wsToken === account.dm)) return
  ws?.close()
  const token = (wsToken = account.dm)
  // the nav dot needs the inbox before anyone opens Messages
  if (!store.inbox) loadInbox().catch(() => {})
  const socket = (ws = new WebSocket('wss://ws.farcaster.xyz/stream'))
  socket.onopen = () => {
    socket.send(JSON.stringify({ messageType: 'dc_authenticate', data: token }))
    wait = 1000
    // back after a drop: catch up on what happened while we weren't listening
    if (dropped) (dropped = false), loadInbox().catch(() => {}), store.open && loadChat(store.open).catch(() => {})
  }
  socket.onmessage = (e) => {
    if (wsToken !== token) return socket.close()
    try {
      handle(JSON.parse(e.data))
    } catch {}
  }
  socket.onclose = (e) => {
    if (ws === socket) ws = undefined
    if (wsToken !== token || account?.dm !== token) return
    if (e.code === 4001) return setAccount({ ...account, dm: undefined })
    dropped = true
    setTimeout(start, (wait = Math.min(wait * 2, 60e3)))
  }
}
