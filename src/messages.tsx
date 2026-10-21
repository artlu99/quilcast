// Messages: farcaster.xyz's direct casts. They live on farcaster.xyz, not the Farcaster network, so they're
// read and sent through our relay (server/dm.mjs) with a token that opens them and nothing else.
import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { account, dm, getUser, type User } from './api.ts'
import { ago, Avatar, Header, nameOf, RichText, Tabs, toast, userPath, w } from './ui.tsx'

type Person = { fid: number; username?: string; displayName?: string; pfp?: { url?: string } }
type Msg = { messageId: string; senderFid: number; serverTimestamp: number; type: string; message: string; isDeleted?: boolean; senderContext?: Person; state?: 'sending' | 'failed' }
type Convo = { conversationId: string; name?: string; photoUrl?: string; isGroup: boolean; lastMessage?: Msg; participants?: Person[]; viewerContext: { category?: string; unreadCount?: number; counterParty?: Person } }

const person = (p?: Person): User => ({ fid: p?.fid || 0, username: p?.username, display_name: p?.displayName, pfp_url: p?.pfp?.url })
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
// newer copies of a message (the server's) replace older ones (ours, still sending)
const merge = (a: Msg[], b: Msg[]) => [...new Map([...a, ...b].map((m) => [m.messageId, m])).values()].sort((x, y) => x.serverTimestamp - y.serverTimestamp)

/** Load now and every `ms` while the tab is visible; changing `deps` starts over. */
function usePoll<T>(load: () => Promise<T>, use: (t: T) => void, ms: number, deps: unknown[], fail: (e: Error) => void = () => {}) {
  useEffect(() => {
    let live = true
    const run = () => load().then((t) => live && use(t), (e) => live && fail(e))
    run()
    const i = setInterval(() => document.visibilityState === 'visible' && run(), ms)
    return () => ((live = false), clearInterval(i))
  }, deps)
}

/** The inbox, or one conversation when `id` is given. */
export function Messages({ id }: { id?: string }) {
  if (!account?.done) return <><Header title="Messages" /><div class="note">Sign in to read your messages.</div></>
  if (!account.dm) return <Connect />
  return id ? <Chat key={id} id={id} /> : <Inbox />
}

function Connect() {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      await (await w()).connectMessages()
    } catch (e: any) {
      toast(e.message)
      setBusy(false)
    }
  }
  return (
    <>
      <Header title="Messages" />
      <div class="join">
        <p class="lede">Messages are farcaster.xyz's direct casts, which aren't on the Farcaster network itself. Quilcast opens them with a key from farcaster.xyz that reads and sends your messages and does nothing else.</p>
        <p class="muted">{account!.wallet ? 'Your wallet signs for that key once.' : 'Your recovery phrase signs for it here, with no prompt.'} farcaster.xyz only talks to its own site, so messages pass through Quilcast's server on the way; it doesn't keep them. As on farcaster.xyz, they aren't end-to-end encrypted.</p>
        <button class="btn wide" disabled={busy} onClick={open}>{busy ? (account!.wallet ? 'Check your wallet…' : 'Opening…') : 'Open messages'}</button>
      </div>
    </>
  )
}

const preview = (m: Msg) => (m.isDeleted ? 'Message deleted' : m.message || m.type.replace(/_/g, ' '))

// ponytail: the 50 most recent conversations per tab; page with `next.cursor` when someone needs more
function Inbox() {
  const [tab, setTab] = useState<'default' | 'request'>('default')
  const [list, setList] = useState<Convo[] | null>(null)
  const [requests, setRequests] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => setList(null), [tab])
  usePoll(() => dm('inbox', { query: { category: tab, limit: 50 } }), (r) => (setList(r.result.conversations), setRequests(r.result.requestsCount || 0), setErr('')), 15e3, [tab], (e) => setErr(e.message))
  return (
    <>
      <Header title="Messages">
        <Tabs tabs={[['default', 'Inbox'], ['request', requests ? `Requests · ${requests}` : 'Requests']]} value={tab} set={setTab} />
      </Header>
      {err && <div class="note">Couldn't load messages: {err}</div>}
      {!list && !err && <div class="spinner" />}
      {list?.length === 0 && <div class="note">{tab === 'request' ? 'No message requests.' : 'No messages yet. Start one from someone’s profile.'}</div>}
      {list?.map((c) => {
        const other = c.isGroup ? undefined : c.viewerContext.counterParty
        const name = other ? nameOf(person(other)) : c.name || 'Group'
        const unread = c.viewerContext.unreadCount || 0
        const last = c.lastMessage
        return (
          <a class={`row${unread ? ' unread' : ''}`} href={`/messages/${c.conversationId}`}>
            <Avatar u={other ? person(other) : { fid: 0, display_name: name, pfp_url: c.photoUrl }} link={false} />
            <span class="row-main">
              <span class="row-top"><b>{name}</b>{last && <span class="handle">· {ago(last.serverTimestamp)}</span>}</span>
              {last && <span class="row-sub">{last.senderFid === account!.fid ? 'You: ' : ''}{preview(last)}</span>}
            </span>
            {unread > 0 && <span class="unread-count">{unread}</span>}
          </a>
        )
      })}
    </>
  )
}

const Bubble = ({ m, mine, who }: { m: Msg; mine: boolean; who?: Person }) =>
  m.type !== 'text' ? <div class="msg-note">{preview(m)}</div> : (
    <div class={`msg${mine ? ' mine' : ''}`} title={when(m.serverTimestamp)}>
      {who && <span class="msg-who">{nameOf(person(who))}</span>}
      <div class={`bubble ${m.state || ''}`}>{m.isDeleted ? <i>Message deleted</i> : <RichText text={m.message} />}</div>
      {m.state === 'failed' && <small class="warn">Not sent</small>}
    </div>
  )

function Chat({ id }: { id: string }) {
  const me = account!.fid!
  const [c, setC] = useState<Convo | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [older, setOlder] = useState('')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const first = useRef(true)
  const read = useRef('')
  const atBottom = useRef(true)
  useEffect(() => {
    // a conversation that doesn't exist yet is a first message to someone: a 1:1 id is the two FIDs, sorted
    dm('conversation', { query: { conversationId: id } }).then((r) => setC(r.result.conversation), async () => {
      const fid = /^\d+-\d+$/.test(id) ? id.split('-').map(Number).find((f) => f !== me) : undefined
      if (!fid || !id.split('-').includes(String(me))) return setErr("This conversation isn't yours, or doesn't exist.")
      const u = await getUser(fid).catch(() => ({ fid }) as User)
      setC({ conversationId: id, isGroup: false, participants: [{ fid: me }, { fid, username: u.username, displayName: u.display_name, pfp: { url: u.pfp_url } }], viewerContext: { category: 'default' } })
    })
    const f = () => (atBottom.current = innerHeight + scrollY >= document.documentElement.scrollHeight - 120)
    addEventListener('scroll', f, { passive: true })
    return () => removeEventListener('scroll', f)
  }, [])
  usePoll(() => dm('messages', { query: { conversationId: id, limit: 50 } }), (r) => {
    setMsgs((ms) => merge(ms, r.result.messages))
    if (first.current) (first.current = false), setOlder(r.next?.cursor || '')
  }, 5e3, [])
  // follow new messages while at the bottom, and tell farcaster.xyz they were read
  useEffect(() => {
    if (atBottom.current) scrollTo(0, document.documentElement.scrollHeight)
    const last = msgs.at(-1)
    if (!last || last.state || last.messageId === read.current) return
    read.current = last.messageId
    if (last.senderFid !== me) dm('read', { method: 'POST', body: { conversationId: id } }).then(() => dispatchEvent(new Event('dms')), () => {})
  }, [msgs])
  const earlier = async () => {
    const r = await dm('messages', { query: { conversationId: id, limit: 50, cursor: older } }).catch((e) => (toast(e.message), null))
    if (!r) return
    const h = document.documentElement.scrollHeight
    atBottom.current = false
    setMsgs((ms) => merge(r.result.messages, ms))
    setOlder(r.next?.cursor || '')
    // keep the messages on screen where they were
    requestAnimationFrame(() => scrollBy(0, document.documentElement.scrollHeight - h))
  }
  const others = (c?.participants || []).map((p) => p.fid).filter((f) => f !== me)
  const send = async () => {
    const message = text.trim()
    if (!message || !c) return
    // shown right away under a temporary id, swapped for farcaster.xyz's once it's sent
    const m: Msg = { messageId: crypto.randomUUID(), senderFid: me, serverTimestamp: Date.now(), type: 'text', message, state: 'sending' }
    const mark = (p: Partial<Msg>) => setMsgs((ms) => ms.map((x) => (x.messageId === m.messageId ? { ...x, ...p } : x)))
    atBottom.current = true
    setMsgs((ms) => [...ms, m])
    setText('')
    try {
      // replying to a request (or an archived conversation) moves it to the inbox, as farcaster.xyz does
      const moved = c.viewerContext.category && c.viewerContext.category !== 'default'
      if (moved) await dm('category', { method: 'POST', body: { conversationId: id, category: 'default' } })
      const r = await dm('send', { method: 'PUT', body: { ...(c.isGroup ? { groupId: id } : { recipientFid: others[0] }), message } })
      mark({ messageId: r.result?.messageId || m.messageId, state: undefined })
      if (moved) setC({ ...c, viewerContext: { ...c.viewerContext, category: 'default' } })
    } catch (e: any) {
      mark({ state: 'failed' })
      toast(`Couldn't send: ${e.message}`)
    }
  }
  const other = c && !c.isGroup ? c.participants?.find((p) => p.fid !== me) || c.viewerContext.counterParty : undefined
  const title = !c ? 'Messages' : other ? nameOf(person(other)) : c.name || 'Group'
  return (
    <>
      <Header title={other ? <a class="plain" href={userPath(person(other))}>{title}</a> : title} />
      {err && <div class="note">{err}</div>}
      {c?.viewerContext.category === 'request' && <div class="banner"><div><b>Message request</b><p>Replying moves this conversation to your inbox.</p></div></div>}
      <div class="chat">
        {older && <button class="link-btn earlier" onClick={earlier}>Earlier messages</button>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          return (
            <Fragment key={m.messageId}>
              {(!prev || m.serverTimestamp - prev.serverTimestamp > 3600e3) && <div class="msg-note">{when(m.serverTimestamp)}</div>}
              <Bubble m={m} mine={m.senderFid === me} who={c?.isGroup && m.senderFid !== me && prev?.senderFid !== m.senderFid ? m.senderContext : undefined} />
            </Fragment>
          )
        })}
        {!msgs.length && c && !err && <div class="note">{other ? `This is the start of your conversation with ${title}.` : 'No messages yet.'}</div>}
      </div>
      {!err && (
        <div class="dm-compose">
          <textarea rows={1} value={text} placeholder="Message" maxLength={1024} aria-label="Message"
            onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} />
          <button class="btn small" disabled={!text.trim() || !c} onClick={send}>Send</button>
        </div>
      )}
    </>
  )
}
