import { render, type ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { account, accounts, back, castText, get, go, hydrateParents, idOf, isFollowing, loadMine, posting, saveSettings, setAccount, settings, switchAccount, users, USER_DATA, type Cast, type User } from './api.ts'
import { Composer } from './compose.tsx'
import { ago, Avatar, CastCard, handle, Icon, Lightbox, Logo, n, P, RichText, shell, toast, UserRow, userPath, w } from './ui.tsx'
import './style.css'

function Join({ step }: { step?: string }) {
  const [C, setC] = useState<((p: { step?: string }) => any) | null>(null)
  useEffect(() => void import('./join.tsx').then((m) => setC(() => m.Join)), [])
  return C ? <C step={step} /> : <div class="spinner" />
}

// --- bits ---

function Toast() {
  const [m, setM] = useState('')
  const t = useRef(0)
  shell.toast = (x) => (setM(x), clearTimeout(t.current), (t.current = window.setTimeout(() => setM(''), 3500)))
  return m ? <div class="toast" role="status">{m}</div> : null
}

const Header = ({ title, back: showBack = true, children }: { title?: ComponentChildren; back?: boolean; children?: ComponentChildren }) => (
  <div class="phead">
    <div class="phead-row">
      {showBack ? <button class="icon-btn" aria-label="Back" onClick={back}><Icon d={P.back} /></button> : <a class="brand only-mobile" href="/" aria-label="Quilcast home"><Logo size={26} /></a>}
      <h1>{title}</h1>
    </div>
    {children}
  </div>
)

const Tabs = <T extends string>({ tabs, value, set }: { tabs: [T, string][]; value: T; set: (t: T) => void }) => (
  <nav class="tabs" role="tablist">
    {/* a list under tabs in the sticky header starts at its top, not wherever the previous one was scrolled to */}
    {tabs.map(([k, label]) => <button role="tab" aria-selected={value === k} class={value === k ? 'on' : ''} onClick={(e) => (e.currentTarget.closest('.phead') && scrollTo(0, 0), set(k))}>{label}</button>)}
  </nav>
)

// every saved account with a way to switch, plus "Add account"
function AccountList({ onDone }: { onDone?: () => void }) {
  const [, force] = useState(0)
  useEffect(() => {
    const fids = accounts.map((a) => a.fid).filter((f): f is number => !!f && !users.has(f))
    fids.length && get('/v2/farcaster/user/bulk', { fids: fids.join(',') }).then((r) => (r.users.forEach((u: User) => users.set(u.fid, u)), force((x) => x + 1)), () => {})
  }, [])
  return (
    <div class="accounts">
      {accounts.map((a) => {
        const u = (a.fid && users.get(a.fid)) || { fid: a.fid || 0, username: a.username }
        const on = !!account && idOf(a) === idOf(account)
        return (
          <button class={`acct${on ? ' on' : ''}`} onClick={() => (on ? onDone?.() : switchAccount(a))}>
            <Avatar u={u} size={32} link={false} />
            <span><b>{u.display_name || a.display || (a.username ? `@${a.username}` : 'New account')}</b><small>{a.done ? `@${handle(u)}` : 'Setting up'}</small></span>
            {on && <Icon d="M20 6 9 17l-5-5" />}
          </button>
        )
      })}
      <button class="acct add" onClick={() => (onDone?.(), go('/join'))}><span class="plus"><Icon d="M12 5v14M5 12h14" /></span><span><b>Add account</b></span></button>
    </div>
  )
}

function AccountMenu({ me }: { me: User }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => !(e.target as Element).closest('.me-wrap') && setOpen(false)
    addEventListener('click', f)
    return () => removeEventListener('click', f)
  }, [open])
  return (
    <div class="me-wrap">
      {open && <div class="menu up"><AccountList onDone={() => setOpen(false)} /></div>}
      <button class="me" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar u={me} size={34} link={false} />
        <span><b>{me.display_name || handle(me)}</b><small>@{handle(me)}</small></span>
        <Icon d={P.more} />
      </button>
    </div>
  )
}

// --- paginated list of casts ---

type Page = { casts: Cast[]; next?: { cursor?: string | null } }
type Chunk<T> = { items: T[]; cursor: string | null }

/** Cursor pagination with infinite scroll. `id` dedupes items across pages. */
function Pager<T>({ load, k, empty, id, row, initial }: { load: (cursor?: string) => Promise<Chunk<T>>; k: string; empty?: string; id: (t: T) => string; row: (items: T[]) => ComponentChildren; initial?: () => T[] }) {
  const [items, setItems] = useState<T[]>(() => initial?.() || [])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sentinel = useRef<HTMLDivElement>(null)
  const state = useRef({ busy: false, key: k })
  const more = async (reset = false) => {
    if ((state.current.busy && !reset) || (!reset && cursor === null)) return
    state.current.busy = true
    setBusy(true)
    setErr('')
    try {
      const r = await load(reset ? undefined : cursor || undefined)
      if (state.current.key !== k) return
      setItems((prev) => {
        const seen = new Set(reset ? [] : prev.map(id))
        return [...(reset ? [] : prev), ...r.items.filter((t) => !seen.has(id(t)))]
      })
      setCursor(r.cursor)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      state.current.busy = false
      setBusy(false)
    }
  }
  useEffect(() => {
    state.current.key = k
    // a cached first page shows instantly and is replaced when the fresh one arrives
    setItems(initial?.() || [])
    setCursor(undefined)
    more(true)
  }, [k])
  useEffect(() => {
    // re-armed after every render, so pages that filter down to nothing keep loading
    const o = new IntersectionObserver((e) => e[0].isIntersecting && cursor && more(), { rootMargin: '800px' })
    sentinel.current && o.observe(sentinel.current)
    return () => o.disconnect()
  })
  return (
    <>
      {row(items)}
      {err && <div class="note">Couldn't load: {err} <button class="link-btn" onClick={() => more()}>Retry</button></div>}
      {busy && (items.length ? <div class="spinner" aria-label="Loading" /> : <div aria-label="Loading">{[0, 1, 2, 3].map(() => <div class="skel"><i /><span><b /><b /><b /></span></div>)}</div>)}
      {cursor === null && !items.length && !err && !busy && <div class="note">{empty || 'Nothing here yet.'}</div>}
      <div ref={sentinel} />
    </>
  )
}

// first pages of the home feeds are kept per account, so a reload paints immediately
const stash = {
  get: (key?: string): Cast[] | undefined => {
    try {
      return key ? JSON.parse(localStorage.getItem(`quilcast:feed:${key}`) || 'null') || undefined : undefined
    } catch {}
  },
  set: (key: string | undefined, casts: Cast[]) => {
    try {
      key && localStorage.setItem(`quilcast:feed:${key}`, JSON.stringify(casts.slice(0, 20)))
    } catch {}
  },
}

const Feed = ({ load, k, empty, keep, cacheKey }: { load: (cursor?: string) => Promise<Page>; k: string; empty?: string; keep?: (c: Cast) => boolean; cacheKey?: string }) => (
  <Pager<Cast> k={k} empty={empty} id={(c) => c.hash} row={(cs) => cs.map((c) => <CastCard key={c.hash} c={c} />)} initial={() => stash.get(cacheKey) || []}
    load={async (cursor) => {
      const r = await load(cursor)
      const casts = keep ? r.casts.filter(keep) : r.casts
      await hydrateParents(casts)
      if (!cursor) stash.set(cacheKey, casts)
      return { items: casts, cursor: r.casts.length ? r.next?.cursor || null : null }
    }} />
)

/** Tapping the tab or nav item you're already on reloads the list from the top. */
function useReload(): [number, () => void] {
  const [round, setRound] = useState(0)
  const reload = () => (scrollTo(0, 0), setRound((r) => r + 1))
  useEffect(() => {
    addEventListener('refresh', reload)
    return () => removeEventListener('refresh', reload)
  }, [])
  return [round, reload]
}

// --- views ---

function Home() {
  const [tab, setTab] = useState<'following' | 'trending'>(account?.done ? 'following' : 'trending')
  const [round, reload] = useReload()
  return (
    <>
      <Header title="Home" back={false}>
        {account?.done && <Tabs tabs={[['following', 'Following'], ['trending', 'Trending']]} value={tab} set={(t) => (t === tab ? reload() : setTab(t))} />}
      </Header>
      {!account?.done && (
        <div class="banner">
          <div><b>Farcaster without the middlemen</b><p>Quilcast talks straight to the Hypersnap network, and your keys never leave this browser.</p></div>
          <a class="btn small" href="/join">Join</a>
        </div>
      )}
      {/* about half of a page is replies, which home leaves out, so pages are 50 */}
      <Feed k={`${tab}:${round}`} cacheKey={`${account?.fid || 0}:${tab}`} empty="Follow a few people and their casts will show up here." keep={(c) => !c.parent_hash}
        load={(cursor) => (tab === 'following' ? get('/v2/farcaster/feed/following', { fid: account!.fid, limit: 50, cursor }) : get('/v2/farcaster/feed/trending', { limit: 50, cursor }))} />
    </>
  )
}

type Note = { type: string; cast?: Cast | null; user: User; timestamp: string }
type Group = { key: string; type: string; cast?: Cast | null; users: User[]; timestamp: string }
const seenKey = () => `quilcast:seen:${account?.fid}`
const ACTS: Record<string, [string, string, string]> = {
  likes: ['liked your cast', P.like, 'lk'],
  recasts: ['recast your cast', P.recast, 'rc'],
  follows: ['followed you', P.user, 'fo'],
}
// `type` comes from the node, so only own keys count (no `__proto__` surprises)
const ACT = (t: string) => (Object.hasOwn(ACTS, t) ? ACTS[t] : undefined)

function NoteRow({ g }: { g: Group }) {
  if (g.cast && !ACT(g.type)) return <CastCard c={g.cast} />
  const [verb, icon, cls] = ACT(g.type) || [String(g.type), P.user, 'fo']
  const first = g.users[0]
  return (
    <a class="note-row" href={g.cast ? `/c/${g.cast.hash}` : userPath(first)}>
      <span class={`note-icon ${cls}`}><Icon d={icon} fill={g.type === 'likes'} size={20} /></span>
      <span class="note-body">
        <span class="note-avatars">{g.users.slice(0, 7).map((u) => <Avatar u={u} size={30} link={false} />)}</span>
        <span><b>{first.display_name || handle(first)}</b>{g.users.length > 1 && ` and ${g.users.length - 1} ${g.users.length === 2 ? 'other' : 'others'}`} {verb} <span class="muted">· {ago(g.timestamp)}</span></span>
        {g.cast && <span class="note-cast">{castText(g.cast) || 'Your cast'}</span>}
      </span>
    </a>
  )
}

// group likes/recasts per cast and follows per day; replies and mentions stay one per cast
const group = (notes: Note[]) => {
  const out = new Map<string, Group>()
  for (const n of notes) {
    const key = ACT(n.type) ? `${n.type}:${n.cast?.hash || String(n.timestamp).slice(0, 10)}` : `${n.type}:${n.cast?.hash}:${n.user.fid}`
    const g = out.get(key)
    if (g) !g.users.some((u) => u.fid === n.user.fid) && g.users.push(n.user)
    else out.set(key, { key, type: n.type, cast: n.cast, users: [n.user], timestamp: n.timestamp })
  }
  return [...out.values()]
}

// Hypersnap's notifications leave quotes out, so they're looked up per cast
// ponytail: only quotes of our 25 newest casts show up; quote notifications on the node would cover the rest
async function quotesOfMine(): Promise<Note[]> {
  const casts = (await get('/v2/farcaster/feed/user/casts', { fid: account!.fid, limit: 25 })).casts as Cast[]
  const lists = await Promise.all(casts.map((c) => get('/v2/farcaster/cast/quotes', { identifier: c.hash, type: 'hash', limit: 25 }).then((r) => r.casts as Cast[], () => [])))
  const quotes = new Map(lists.flat().filter((q) => q.author.fid !== account!.fid).map((q) => [q.hash, q]))
  return [...quotes.values()].map((q) => ({ type: 'quote', cast: q, user: q.author, timestamp: q.timestamp }))
}

function Notifications() {
  const [tab, setTab] = useState<'all' | 'replies'>('all')
  const [round, reload] = useReload()
  const held = useRef<Note[]>([])
  useEffect(() => {
    // opening the page marks everything up to now as seen
    localStorage.setItem(seenKey(), String(Date.now()))
    dispatchEvent(new Event('seen'))
  }, [])
  if (!account?.done) return <><Header title="Notifications" /><div class="note">Sign in to see who replied, liked and followed.</div></>
  return (
    <>
      <Header title="Notifications">
        <Tabs tabs={[['all', 'All'], ['replies', 'Replies & mentions']]} value={tab} set={(t) => (t === tab ? reload() : setTab(t))} />
      </Header>
      <Pager<Note> k={`${tab}:${round}`} empty="Nothing yet. When people reply, like or follow you, it shows up here."
        id={(n) => `${n.type}:${n.cast?.hash}:${n.user.fid}:${n.timestamp}`}
        row={(ns) => group(ns).map((g) => <NoteRow key={g.key} g={g} />)}
        load={async (cursor) => {
          const [r, quotes] = await Promise.all([get('/v2/farcaster/notifications', { fid: account!.fid, limit: 50, cursor }), cursor ? held.current : quotesOfMine().catch(() => [])])
          const notes = r.notifications as Note[]
          const next = notes.length ? r.next?.cursor || null : null
          // quotes slot in by time; ones older than this page wait for a later one
          const edge = next ? notes[notes.length - 1].timestamp : ''
          const seen = new Set(notes.map((n) => n.cast?.hash))
          held.current = quotes.filter((q) => q.timestamp < edge)
          const items = [...notes, ...quotes.filter((q) => q.timestamp >= edge && !seen.has(q.cast!.hash))]
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            .filter((n) => n.user && (tab === 'all' || (n.cast && !ACT(n.type))))
          await hydrateParents(items.flatMap((n) => (n.cast ? [n.cast] : [])))
          return { items, cursor: next }
        }} />
    </>
  )
}

/** True when the newest notification is newer than the last visit to /notifications. */
function useUnread() {
  const [unread, setUnread] = useState(false)
  useEffect(() => {
    if (!account?.done) return
    const check = () =>
      get('/v2/farcaster/notifications', { fid: account!.fid, limit: 1 }).then((r) => {
        const t = r.notifications[0] && Date.parse(r.notifications[0].timestamp)
        setUnread(!!t && t > Number(localStorage.getItem(seenKey()) || 0))
      }, () => {})
    check()
    const i = setInterval(check, 60000)
    const seen = () => setUnread(false)
    addEventListener('seen', seen)
    return () => (clearInterval(i), removeEventListener('seen', seen))
  }, [account?.fid])
  return unread
}

const WHO = { likes: 'Liked by', recasts: 'Recast by', quotes: 'Quotes' }
// ponytail: the node returns at most 100 reactions or quotes per cast and can't page them, so lists stop there
const quotesOf = async (hash: string) => (await get('/v2/farcaster/cast/quotes', { identifier: hash, type: 'hash', limit: 100 })).casts as Cast[]

/** Who liked or recast a cast, or the casts quoting it. */
function Who({ hash, kind }: { hash: string; kind: keyof typeof WHO }) {
  return (
    <>
      <Header title={WHO[kind]} />
      <Pager<Cast | User> k={`${hash}:${kind}`} empty={kind === 'quotes' ? 'No quotes yet.' : 'Nobody yet.'}
        id={(x) => ('hash' in x ? x.hash : String(x.fid))}
        row={(xs) => xs.map((x) => ('hash' in x ? <CastCard key={x.hash} c={x} /> : <UserRow key={x.fid} u={x} />))}
        load={async () => {
          if (kind !== 'quotes') return { items: (await get('/v2/farcaster/reactions/cast', { hash, types: kind, limit: 100 })).reactions.map((r: { user: User }) => r.user), cursor: null }
          const casts = await quotesOf(hash)
          await hydrateParents(casts)
          return { items: casts, cursor: null }
        }} />
    </>
  )
}

function Thread({ hash }: { hash: string }) {
  const [c, setC] = useState<Cast | null>(null)
  const [up, setUp] = useState<Cast[]>([])
  const [err, setErr] = useState('')
  const [quotes, setQuotes] = useState(0)
  useEffect(() => {
    let live = true
    setC(null)
    setUp([])
    setErr('')
    setQuotes(0)
    quotesOf(hash).then((q) => live && setQuotes(q.length), () => {})
    // walk up to five parents so the reply reads in context
    let walked = false
    const parents = async (cast: Cast) => {
      if (walked) return
      walked = true
      const chain: Cast[] = []
      for (let p = cast.parent_hash; p && chain.length < 5; ) {
        const pc = (await get('/v2/farcaster/cast', { identifier: p, type: 'hash' }).catch(() => null))?.cast as Cast | undefined
        if (!pc || !live) break
        chain.unshift(pc)
        setUp([...chain])
        p = pc.parent_hash
      }
    }
    // a cast we just posted shows right away and takes a moment to be indexed, so retry until it is
    const sent = posting.get(hash)
    if (sent) setC(sent), parents(sent)
    const load = (tries: number): unknown =>
      get('/v2/farcaster/cast/conversation', { identifier: hash.replace(/^0x/, ''), type: 'hash', reply_depth: 2 }).then(
        async (r) => {
          const cast: Cast = r.conversation.cast
          await hydrateParents([cast, ...(cast.direct_replies || [])])
          if (!live) return
          posting.delete(hash)
          setC(cast)
          parents(cast)
        },
        (e) => live && (tries ? setTimeout(() => load(tries - 1), 1500) : !sent && setErr(e.message)),
      )
    load(sent ? 40 : 5)
    return () => void (live = false)
  }, [hash])
  return (
    <>
      <Header title="Cast" />
      {err && <div class="note">This cast couldn't be found. It may have been deleted.</div>}
      {!c && !err && <div class="spinner" />}
      {c && (
        <>
          {up.map((p) => <CastCard key={p.hash} c={p} line inThread />)}
          <CastCard c={c} focus quotes={quotes} />
          <button class="reply-prompt" onClick={() => (account?.done ? shell.compose({ parent: c }) : go('/join'))}>
            {account?.done && <Avatar u={users.get(account.fid!) || { fid: account.fid! }} size={32} link={false} />}
            <span>Post your reply</span>
          </button>
          {(c.direct_replies || []).map((r) => {
            const kids = r.direct_replies || []
            return (
              <div class="reply-group" key={r.hash}>
                <CastCard c={r} line={kids.length > 0} inThread />
                {kids[0] && <CastCard c={kids[0]} inThread />}
                {kids.length > 1 && <a class="more-replies" href={`/c/${r.hash}`}>Show {kids.length - 1} more {kids.length === 2 ? 'reply' : 'replies'}</a>}
              </div>
            )
          })}
          {!c.direct_replies?.length && <div class="note">No replies yet.</div>}
        </>
      )}
    </>
  )
}

function Profile({ id }: { id: string }) {
  const [u, setU] = useState<User | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'casts' | 'replies'>('casts')
  const [following, setFollowing] = useState<boolean | null>(null)
  const was = useRef(false)
  useEffect(() => {
    setU(null)
    setErr('')
    setTab('casts')
    const q = /^\d+$/.test(id) ? get('/v2/farcaster/user', { fid: id }) : get('/v2/farcaster/user/by-username', { username: id })
    q.then((r) => (users.set(r.user.fid, r.user), setU(r.user), isFollowing(r.user.fid).then((f) => ((was.current = f), setFollowing(f)))), () => setErr('No one goes by that name.'))
  }, [id])
  const self = account?.fid === u?.fid
  const toggle = () => {
    if (!account?.done) return go('/join')
    const on = !following
    setFollowing(on)
    w().then((m) => m.follow(u!.fid, on)).catch((e) => (setFollowing(!on), toast(e.message)))
  }
  return (
    <>
      <Header title={u ? u.display_name || handle(u) : 'Profile'} />
      {err && <div class="note">{err}</div>}
      {!u && !err && <div class="spinner" />}
      {u && (
        <>
          <section class="profile">
            <div class="row-top">
              <Avatar u={u} size={72} link={false} />
              {self ? <a class="btn ghost small" href="/settings">Edit profile</a> : <button class={`btn small${following ? ' ghost' : ''}`} onClick={toggle} disabled={following === null && !!account?.done}>{following ? 'Following' : 'Follow'}</button>}
            </div>
            <h2>{u.display_name || handle(u)}</h2>
            <div class="handle">@{handle(u)} <span class="pill">fid {u.fid}</span></div>
            {u.profile?.bio?.text && <RichText text={u.profile.bio.text} />}
            <div class="counts"><span><b>{n(u.following_count)}</b> following</span><span><b>{n((u.follower_count || 0) + +!!following - +was.current)}</b> followers</span></div>
          </section>
          <Tabs tabs={[['casts', 'Casts'], ['replies', 'Replies']]} value={tab} set={setTab} />
          <Feed k={`${u.fid}${tab}`} empty={tab === 'casts' ? 'No casts yet.' : 'No replies yet.'} keep={tab === 'casts' ? (c) => !c.parent_hash : (c) => !!c.parent_hash}
            load={(cursor) => get(tab === 'casts' ? '/v2/farcaster/feed/user/casts' : '/v2/farcaster/feed/user/replies_and_recasts', { fid: u.fid, limit: 25, cursor })} />
        </>
      )}
    </>
  )
}

function Search() {
  const params = new URLSearchParams(location.search)
  const [q, setQ] = useState(params.get('q') || '')
  const [tab, setTab] = useState<'people' | 'casts'>(params.get('t') === 'casts' ? 'casts' : 'people')
  const [people, setPeople] = useState<User[] | null>(null)
  const [term, setTerm] = useState(q.trim())
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    history.replaceState(null, '', term ? `/search?${new URLSearchParams({ q: term, ...(tab === 'casts' && { t: 'casts' }) })}` : '/search')
    setPeople(null)
    if (tab === 'people' && term) get('/v2/farcaster/user/search', { q: term.replace(/^@/, ''), limit: 50 }).then((r) => {
        // the node ranks loosely: exact handles first, then by followers
        const q = term.replace(/^@/, '').toLowerCase()
        const rank = (u: User) => (u.username === q || u.username === q + '.eth' ? 1e12 : 0) + (u.follower_count || 0)
        setPeople(((r.users || r.result?.users || []) as User[]).sort((a, b) => rank(b) - rank(a)).slice(0, 25))
      }, () => setPeople([]))
  }, [term, tab])
  return (
    <>
      <Header title="Search">
        <div class="searchbox">
          <Icon d={P.search} size={16} />
          <input ref={input} type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search people and casts" aria-label="Search" />
        </div>
        <Tabs tabs={[['people', 'People'], ['casts', 'Casts']]} value={tab} set={setTab} />
      </Header>
      {!term && <div class="note">Find people by name or username, or search the text of casts.</div>}
      {term && tab === 'people' && (people === null ? <div class="spinner" /> : people.length ? people.map((u) => <UserRow u={u} />) : <div class="note">No one matches “{term}”.</div>)}
      {term && tab === 'casts' && <Feed k={`s${term}`} empty={`No casts match “${term}”.`} load={(cursor) => get('/v2/farcaster/cast/search', { q: term, limit: 25, cursor }).then((r) => r.result || r)} />}
    </>
  )
}

function Settings() {
  const [, force] = useState(0)
  const [prof, setProf] = useState<Record<number, string>>({})
  const [orig, setOrig] = useState<Record<number, string>>({})
  const [phrase, setPhrase] = useState(false)
  const [out, setOut] = useState<false | 'ask' | 'busy' | 'stuck'>(false)
  const asked = useRef(0)
  const [saving, setSaving] = useState(false)
  const photo = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!account?.fid) return
    get('/v1/userDataByFid', { fid: account.fid }).then((r) => {
      const T: Record<string, number> = { USER_DATA_TYPE_DISPLAY: 2, USER_DATA_TYPE_BIO: 3, USER_DATA_TYPE_PFP: 1, USER_DATA_TYPE_URL: 5 }
      const v: Record<number, string> = {}
      for (const m of r.messages) T[m.data.userDataBody.type] && (v[T[m.data.userDataBody.type]] = m.data.userDataBody.value)
      setProf(v)
      setOrig(v)
    }, () => {})
  }, [])
  const dirty = Object.keys({ ...prof, ...orig }).some((k) => (prof[+k] || '') !== (orig[+k] || ''))
  const save = async () => {
    setSaving(true)
    try {
      const m = await w()
      for (const k of Object.keys(prof).map(Number)) if ((prof[k] || '') !== (orig[k] || '')) await m.setUserData(k, prof[k] || '')
      setOrig(prof)
      toast('Profile saved')
    } catch (e: any) {
      toast(e.message)
    }
    setSaving(false)
  }
  const newPhoto = async (f?: File) => {
    if (!f) return
    toast('Uploading photo…')
    try {
      const url = await (await w()).upload(f)
      setProf((p) => ({ ...p, [USER_DATA.PFP]: url }))
    } catch (e: any) {
      toast(e.message)
    }
  }
  // the signer revokes itself first, so a copy of it (an export, a synced profile) stops working too
  const signOut = async () => {
    // the confirm button sits where Sign out was, so it ignores clicks for a moment (no double-click erase)
    if (!out) return (asked.current = Date.now()), setOut('ask')
    if (out === 'busy' || Date.now() - asked.current < 1000) return
    if (out === 'ask') {
      setOut('busy')
      try {
        await (await w()).revokeSigner(account!)
      } catch (e: any) {
        toast(`The signing key couldn't be revoked: ${e.message}`)
        asked.current = Date.now()
        return setOut('stuck')
      }
    }
    setAccount(null)
    location.assign('/')
  }
  const exportKeys = async () => {
    const [m, fc] = await Promise.all([w(), import('./fc.ts')])
    const acc = account!
    // a wallet account has no phrase or custody key here, only its signer
    const custody = acc.wallet ? undefined : await m.custodyKey(acc.phrase)
    const keys = custody ? { recoveryPhrase: acc.phrase, custodyAddress: fc.address(custody), custodyPrivateKey: '0x' + fc.hex(custody) } : { custodyAddress: acc.wallet }
    const data = { fid: acc.fid, username: acc.username, ...keys, signerPrivateKey: acc.signer && '0x' + acc.signer }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `quilcast-${account!.username || account!.fid}-keys.json` })
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const field = (t: number, label: string, ph: string) => (
    <label class="field"><span>{label}</span><input value={prof[t] || ''} placeholder={ph} maxLength={256} onInput={(e) => setProf({ ...prof, [t]: e.currentTarget.value })} /></label>
  )
  return (
    <>
      <Header title="Settings" />
      <div class="settings">
        {accounts.length > 0 && (
          <section>
            <h2>Accounts</h2>
            <AccountList />
          </section>
        )}
        {account?.done && (
          <section>
            <h2>Profile</h2>
            <div class="photo-row">
              <Avatar u={{ fid: account.fid!, pfp_url: prof[USER_DATA.PFP], username: account.username }} size={48} link={false} />
              <button class="btn ghost small" onClick={() => photo.current?.click()}>Change photo</button>
              <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => newPhoto(e.currentTarget.files?.[0])} />
            </div>
            {field(USER_DATA.DISPLAY, 'Name', 'Your name')}
            <label class="field"><span>Bio</span><textarea rows={3} maxLength={256} value={prof[USER_DATA.BIO] || ''} placeholder="A line or two about you" onInput={(e) => setProf({ ...prof, [USER_DATA.BIO]: e.currentTarget.value })} /></label>
            {field(USER_DATA.URL, 'Website', 'https://…')}
            {dirty && <div class="actions"><button class="btn small" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
          </section>
        )}
        <section>
          <div class="setting">
            <h2>Theme</h2>
            <div class="seg">
              {['system', 'light', 'dark'].map((t) => <button class={settings.theme === t ? 'on' : ''} onClick={() => ((settings.theme = t), saveSettings(), applyTheme(), force((x) => x + 1))}>{t[0].toUpperCase() + t.slice(1)}</button>)}
            </div>
          </div>
        </section>
        {account && (
          <section>
            <h2>Keys</h2>
            {account.wallet ? (
              <p class="hint">This account belongs to the wallet <code>{account.wallet}</code>, which keeps its own keys. Quilcast only holds a signing key for this browser.</p>
            ) : (
              <>
                <p class="hint">Your recovery phrase controls your account and also works in Quorum and Warpcast. It lives only in this browser, so keep a copy somewhere safe.</p>
                <div class="setting"><span>Recovery phrase</span><span class="btns"><button class="btn ghost small" onClick={() => setPhrase(!phrase)}>{phrase ? 'Hide' : 'Show'}</button><button class="btn ghost small" onClick={() => navigator.clipboard.writeText(account!.phrase).then(() => toast('Copied'))}>Copy</button></span></div>
                {phrase && <code class="phrase">{account.phrase}</code>}
              </>
            )}
            <div class="setting"><span>{account.wallet ? 'Signing key as a file' : 'All keys as a file'}</span><button class="btn ghost small" onClick={exportKeys}>Export</button></div>
            <div class="setting"><span>Sign out{account.username ? ` of @${account.username}` : ''}</span><button class="btn danger small" disabled={out === 'busy'} onClick={signOut}>{out === 'busy' ? 'Signing out…' : out === 'stuck' ? 'Sign out anyway' : out ? 'Erase keys?' : 'Sign out'}</button></div>
            {out && <p class="hint">{account.wallet ? 'This removes the account and its signing key from this browser. Your wallet is not affected.' : "This erases the recovery phrase from this browser. Export your keys first if it's your only copy."}</p>}
          </section>
        )}
        <section>
          <h2>Network</h2>
          <label class="field"><span>Hypersnap node</span><input value={settings.node} onChange={(e) => ((settings.node = e.currentTarget.value.replace(/\/+$/, '')), saveSettings())} /></label>
          <label class="field"><span>Optimism RPC</span><input value={settings.rpc} onChange={(e) => ((settings.rpc = e.currentTarget.value.replace(/\/+$/, '')), saveSettings())} /></label>
        </section>
        <p class="foot">Quilcast v{__VERSION__} · <a href="https://github.com/backmeupplz/quilcast" target="_blank" rel="noopener">Source</a></p>
      </div>
    </>
  )
}

// --- shell ---

function applyTheme() {
  settings.theme === 'system' ? delete document.documentElement.dataset.theme : (document.documentElement.dataset.theme = settings.theme)
}

// same-origin links navigate in place instead of reloading the page
addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a')
  if (!a || a.target || a.origin !== location.origin || e.metaKey || e.ctrlKey || e.shiftKey || e.button || e.defaultPrevented) return
  e.preventDefault()
  a.pathname + a.search !== location.pathname + location.search ? go(a.pathname + a.search) : dispatchEvent(new Event('refresh'))
})

const useRoute = () => {
  const [p, setP] = useState(location.pathname)
  useEffect(() => {
    const f = () => (setP(location.pathname), scrollTo(0, 0))
    addEventListener('popstate', f)
    return () => removeEventListener('popstate', f)
  }, [])
  return p.slice(1).split('/')
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function App() {
  const [, force] = useState(0)
  const [compose, setCompose] = useState<Parameters<typeof shell.compose>[0] | null>(null)
  const [r0, r1, r2] = useRoute()
  const unread = useUnread()
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null)
  shell.compose = (o = {}) => setCompose(o)
  shell.view = (urls, index) => setViewer({ urls, index })
  useEffect(() => {
    const f = () => force((x) => x + 1)
    addEventListener('account', f)
    return () => removeEventListener('account', f)
  }, [])
  useEffect(() => {
    const f = () => force((x) => x + 1)
    loadMine().then(f)
    account?.fid && get('/v2/farcaster/user', { fid: account.fid }).then((r) => (users.set(account!.fid!, r.user), f()), () => {})
  }, [account?.fid])
  const me = account?.done ? users.get(account.fid!) || { fid: account.fid!, username: account.username } : null
  const view =
    r0 === 'c' ? (Object.hasOwn(WHO, r2) ? <Who hash={r1} kind={r2 as keyof typeof WHO} /> : <Thread hash={r1} />)
      : r0 === 'u' ? <Profile id={decode(r1)} />
        : r0 === 'search' ? <Search />
          : r0 === 'notifications' ? <Notifications />
          : r0 === 'settings' ? <Settings />
            : r0 === 'join' ? <><Header /><Join step={r1} /></>
              : <Home />
  const nav: [string, string, string][] = [['', 'Home', P.home], ['search', 'Search', P.search], ...(me ? [['notifications', 'Notifications', P.bell] as [string, string, string]] : []), me ? ['u', 'Profile', P.user] : ['join', 'Join', P.user], ['settings', 'Settings', P.gear]]
  const href = (k: string) => (k === 'u' ? userPath(me!) : `/${k}`)
  const active = (k: string) => (k === 'u' ? r0 === 'u' && !!me && userPath(me) === `/u/${r1}` : r0 === k)
  return (
    <div class="app">
      <nav class="side" aria-label="Main">
        <a class="brand" href="/"><Logo size={30} /><span>Quilcast</span></a>
        {nav.filter(([k]) => k !== 'join').map(([k, label, d]) => <a class={`navlink${active(k) ? ' on' : ''}`} href={href(k)}><span class="ico"><Icon d={d} size={22} />{k === 'notifications' && unread && <i class="badge" />}</span><span>{label}</span></a>)}
        {me ? <button class="btn cast-btn" onClick={() => setCompose({})}><Icon d={P.pen} /><span>Cast</span></button> : <a class="btn cast-btn" href="/join" aria-label="Join"><Icon d={P.user} /><span>Join</span></a>}
        {me && <AccountMenu me={me} />}
      </nav>
      <main class="col">{view}</main>
      <aside class="extra">
        {r0 !== 'search' && <a class="searchbox" href="/search"><Icon d={P.search} size={16} /><span>Search people and casts</span></a>}
        <div class="about">
          <b>About Quilcast</b>
          <p>A small, open Farcaster client that reads from and posts to Quilibrium's Hypersnap network, with your keys kept in your browser.</p>
          <p class="foot">v{__VERSION__} · <a href="https://github.com/backmeupplz/quilcast" target="_blank" rel="noopener">Source</a></p>
        </div>
      </aside>
      <nav class="tabbar" aria-label="Main">
        {nav.map(([k, label, d]) => <a class={active(k) ? 'on' : ''} href={href(k)} aria-label={label}><span class="ico"><Icon d={d} size={22} />{k === 'notifications' && unread && <i class="badge" />}</span></a>)}
      </nav>
      {me && r0 !== 'join' && r0 !== 'settings' && <button class="fab" aria-label="New cast" onClick={() => setCompose({})}><Icon d={P.pen} size={22} /></button>}
      {compose && <Composer {...compose} onClose={() => setCompose(null)} />}
      {viewer && <Lightbox {...viewer} close={() => setViewer(null)} />}
      <Toast />
    </div>
  )
}

applyTheme()
render(<App />, document.getElementById('app')!)
