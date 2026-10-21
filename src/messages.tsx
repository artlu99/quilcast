// Messages: farcaster.xyz's direct casts, drawn from the state in dms.ts, which the websocket keeps current.
import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { account, type User } from './api.ts'
import { loadChat, loadInbox, loadRequests, lookup, mute, read, send, store, subscribe, unread, type Convo, type Msg, type Person } from './dms.ts'
import { ago, Avatar, Header, Icon, nameOf, P, RichText, Tabs, toast, userPath, w } from './ui.tsx'

const person = (p?: Person): User => ({ fid: p?.fid || 0, username: p?.username, display_name: p?.displayName, pfp_url: p?.pfp?.url })
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const preview = (m: Msg) => (m.isDeleted ? 'Message deleted' : m.message || m.type.replace(/_/g, ' '))
const MUTED = `${P.bell}M3 3l18 18`
// the other person in a 1:1, else the group
const face = (c: Convo) => {
  const other = c.isGroup ? undefined : c.viewerContext.counterParty || c.participants?.find((p) => p.fid !== account!.fid)
  return other ? { name: nameOf(person(other)), user: person(other), one: true } : { name: c.name || 'Group', user: { fid: 0, display_name: c.name || 'Group', pfp_url: c.photoUrl }, one: false }
}
function useStore() {
  const [, force] = useState(0)
  useEffect(() => subscribe(() => force((x) => x + 1)), [])
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

type Tab = 'inbox' | 'unread' | 'requests' | 'muted'
const EMPTY: Record<Tab, string> = { inbox: 'No messages yet. Start one from someone’s profile.', unread: 'Nothing unread.', requests: 'No message requests.', muted: 'No muted conversations.' }

// Inbox, Unread and Muted are views of one inbox; Requests is its own list, fetched when first opened
function Inbox() {
  useStore()
  const [tab, setTab] = useState<Tab>('inbox')
  const [err, setErr] = useState('')
  const fail = (e: Error) => setErr(e.message)
  useEffect(() => void (store.inbox || loadInbox().catch(fail)), [])
  useEffect(() => void (tab === 'requests' && !store.requests && loadRequests().catch(fail)), [tab])
  const all = store.inbox || []
  const unreadN = all.filter((c) => unread(c) && !c.viewerContext.muted).length
  const list = tab === 'requests' ? store.requests : store.inbox && all.filter((c) => (tab === 'muted' ? c.viewerContext.muted : !c.viewerContext.muted && (tab === 'inbox' || unread(c))))
  return (
    <>
      <Header title="Messages">
        <Tabs tabs={[['inbox', 'Inbox'], ['unread', unreadN ? `Unread · ${unreadN}` : 'Unread'], ['requests', store.requestsCount ? `Requests · ${store.requestsCount}` : 'Requests'], ['muted', 'Muted']]} value={tab} set={setTab} />
      </Header>
      {err && <div class="note">Couldn't load messages: {err}</div>}
      {!list && !err && <div class="spinner" />}
      {list?.length === 0 && <div class="note">{EMPTY[tab]}</div>}
      {list?.map((c) => <Row c={c} />)}
      {/* older conversations can hold unread or muted ones too */}
      {tab !== 'requests' && store.more && <button class="link-btn more" onClick={() => loadInbox(true).catch((e) => toast(e.message))}>Older conversations</button>}
    </>
  )
}

function Row({ c }: { c: Convo }) {
  const { name, user } = face(c)
  const n = c.viewerContext.unreadCount || 0
  const m = c.lastMessage
  return (
    <a class={`row${n ? ' unread' : ''}`} href={`/messages/${c.conversationId}`}>
      <Avatar u={user} link={false} />
      <span class="row-main">
        <span class="row-top"><b>{name}</b>{c.viewerContext.muted && <Icon d={MUTED} size={14} />}{m && <span class="handle">· {ago(m.serverTimestamp)}</span>}</span>
        {m && <span class="row-sub">{m.senderFid === account!.fid ? 'You: ' : ''}{preview(m)}</span>}
      </span>
      {n > 0 && <span class={`unread-count${c.viewerContext.muted ? ' quiet' : ''}`}>{n}</span>}
    </a>
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
  useStore()
  const me = account!.fid!
  const c = store.convos.get(id)
  const chat = store.chats.get(id)
  const msgs = chat?.msgs || []
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const atBottom = useRef(true)
  useEffect(() => {
    // on screen, so what arrives here is read as it comes
    store.open = id
    lookup(id).then((c) => read(c.conversationId), () => setErr("This conversation isn't yours, or doesn't exist."))
    loadChat(id).catch(() => {})
    const scroll = () => (atBottom.current = innerHeight + scrollY >= document.documentElement.scrollHeight - 120)
    const back = () => document.visibilityState === 'visible' && read(id)
    addEventListener('scroll', scroll, { passive: true })
    document.addEventListener('visibilitychange', back)
    return () => {
      if (store.open === id) store.open = ''
      removeEventListener('scroll', scroll)
      document.removeEventListener('visibilitychange', back)
    }
  }, [])
  // follow new messages while at the bottom
  const last = msgs.at(-1)?.messageId
  useEffect(() => void (atBottom.current && scrollTo(0, document.documentElement.scrollHeight)), [msgs.length, last])
  const earlier = async () => {
    const h = document.documentElement.scrollHeight
    atBottom.current = false
    await loadChat(id, true).catch((e) => toast(e.message))
    // keep the messages on screen where they were
    requestAnimationFrame(() => scrollBy(0, document.documentElement.scrollHeight - h))
  }
  const submit = () => {
    const message = text.trim()
    if (!message || !c) return
    setText('')
    atBottom.current = true
    send(c, message).catch((e) => toast(`Couldn't send: ${e.message}`))
  }
  const f = c && face(c)
  const muted = !!c?.viewerContext.muted
  // a conversation exists once it has messages; only then can it be muted
  const action = c && msgs.length > 0 && (
    <button class="icon-btn" aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'} onClick={() => mute(c, !muted).catch((e) => toast(e.message))}>
      <Icon d={muted ? MUTED : P.bell} />
    </button>
  )
  return (
    <>
      <Header title={!f ? 'Messages' : f.one ? <a class="plain" href={userPath(f.user)}>{f.name}</a> : f.name} action={action} />
      {err && <div class="note">{err}</div>}
      {c?.viewerContext.category === 'request' && <div class="banner"><div><b>Message request</b><p>Replying moves this conversation to your inbox.</p></div></div>}
      <div class="chat">
        {chat?.older && <button class="link-btn earlier" onClick={earlier}>Earlier messages</button>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          return (
            <Fragment key={m.messageId}>
              {(!prev || m.serverTimestamp - prev.serverTimestamp > 3600e3) && <div class="msg-note">{when(m.serverTimestamp)}</div>}
              <Bubble m={m} mine={m.senderFid === me} who={c?.isGroup && m.senderFid !== me && prev?.senderFid !== m.senderFid ? m.senderContext : undefined} />
            </Fragment>
          )
        })}
        {!chat && !err && <div class="spinner" />}
        {chat && !msgs.length && f && <div class="note">{f.one ? `This is the start of your conversation with ${f.name}.` : 'No messages yet.'}</div>}
      </div>
      {!err && (
        <div class="dm-compose">
          <textarea rows={1} value={text} placeholder="Message" maxLength={1024} aria-label="Message"
            onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())} />
          <button class="btn small" disabled={!text.trim() || !c} onClick={submit}>Send</button>
        </div>
      )}
    </>
  )
}
