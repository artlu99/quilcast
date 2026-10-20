import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { account, get, isFollowing, loadMine, mine, saveSettings, setAccount, settings, USER_DATA } from './api.ts'
import './style.css'

// keys and crypto load only when someone signs in or writes
const w = () => import('./write.ts')
function Join() {
  const [C, setC] = useState<(() => any) | null>(null)
  useEffect(() => void import('./join.tsx').then((m) => setC(() => m.Join)), [])
  return C ? <C /> : <div class="spinner" />
}

type User = { fid: number; username?: string; display_name?: string; pfp_url?: string; profile?: { bio?: { text?: string } }; follower_count?: number; following_count?: number }
export type Cast = {
  hash: string; text: string; timestamp: string; author: User; parent_hash?: string | null; parent_url?: string | null
  embeds: { url?: string; cast_id?: { fid: number; hash: string } }[]
  reactions: { likes_count: number; recasts_count: number }; replies: { count: number }; direct_replies?: Cast[]
}

// --- tiny pieces ---

const P = {
  reply: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.9L3 20l1.1-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z',
  recast: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  like: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14',
  back: 'M19 12H5M12 19l-7-7 7-7',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
}
export const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
export const Logo = () => (
  <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="var(--accent)" />
    <path d="M23.5 6.5c-6 .5-10.5 4.8-12 11.5l-1.6 7.5 1.4.4 2-5.2c4.6-.4 8.4-3.4 9.6-8.2-1.3.6-2.7.9-4 .9 1.9-1.2 3.6-3.6 4.6-6.9z" fill="#fff" />
  </svg>
)

const ago = (t: string) => {
  const s = (Date.now() - Date.parse(t)) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 300 * 86400 ? 'numeric' : undefined })
}
const n = (x = 0) => (x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e4 ? Math.round(x / 1e3) + 'K' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(x))
const userPath = (u: User) => `#/u/${u.username || u.fid}`

export const Avatar = ({ u, size = 44 }: { u: User; size?: number }) => (
  <a class="avatar" href={userPath(u)} style={{ width: `${size}px`, height: `${size}px` }} onClick={(e) => e.stopPropagation()}>
    {u.pfp_url ? <img src={u.pfp_url} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <span>{(u.display_name || u.username || '?')[0]}</span>}
  </a>
)

// links, @mentions and /channels inside cast text
function Text({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|(?<![\w/])@[a-z0-9][a-z0-9.-]*[a-z0-9]|(?<![\w/])\/[a-z0-9-]{2,})/gi)
  return (
    <p class="text">
      {parts.map((p, i) =>
        i % 2 === 0 ? p
          : p[0] === '@' ? <a key={i} href={`#/u/${p.slice(1)}`} onClick={(e) => e.stopPropagation()}>{p}</a>
            : p[0] === '/' ? <span key={i} class="chan">{p}</span>
              : <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}{p.length > 56 ? '…' : ''}</a>,
      )}
    </p>
  )
}

const isImg = (u: string) => /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(u) || /imagedelivery\.net|i\.imgur\.com/.test(u)
const isVid = (u: string) => /\.(m3u8|mp4|webm|mov)(\?|$)/i.test(u)

function Embeds({ c, text }: { c: Cast; text: string }) {
  const urls = c.embeds.map((e) => e.url).filter((u): u is string => !!u)
  const imgs = urls.filter(isImg)
  const vids = urls.filter(isVid)
  const links = urls.filter((u) => !isImg(u) && !isVid(u) && !text.includes(u))
  const quotes = c.embeds.filter((e) => e.cast_id).map((e) => e.cast_id!)
  return (
    <>
      {imgs.length > 0 && (
        <div class={`imgs n${Math.min(imgs.length, 4)}`}>
          {imgs.slice(0, 4).map((u) => <a href={u} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><img src={u} alt="" loading="lazy" referrerpolicy="no-referrer" /></a>)}
        </div>
      )}
      {vids.map((u) => <video class="vid" src={u} controls preload="metadata" playsInline onClick={(e) => e.stopPropagation()} />)}
      {links.map((u) => (
        <a class="link" href={u} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
          <b>{new URL(u).hostname.replace(/^www\./, '')}</b>
          {u.replace(/^https?:\/\/[^/]+\/?/, '') && <span>{u.replace(/^https?:\/\/[^/]+/, '')}</span>}
        </a>
      ))}
      {quotes.map((q) => <Quote id={q} />)}
    </>
  )
}

function Quote({ id }: { id: { fid: number; hash: string } }) {
  const [c, setC] = useState<Cast | null>(null)
  useEffect(() => void get('/v2/farcaster/cast', { identifier: id.hash.replace(/^0x/, ''), type: 'hash' }).then((r) => setC(r.cast), () => {}), [id.hash])
  if (!c) return <a class="quote" href={`#/c/${id.hash}`}>Quoted cast</a>
  return (
    <a class="quote" href={`#/c/${c.hash}`} onClick={(e) => e.stopPropagation()}>
      <div class="who"><Avatar u={c.author} size={20} /><b>{c.author.display_name || c.author.username}</b><span>@{c.author.username}</span></div>
      <Text text={c.text} />
    </a>
  )
}

const channelOf = (u?: string | null) => u?.match(/warpcast\.com\/~\/channel\/([^/?#]+)/)?.[1]

// --- cast card ---

export function CastCard({ c, big, inThread, onReply }: { c: Cast; big?: boolean; inThread?: boolean; onReply: (c: Cast) => void }) {
  const [was] = useState(() => [mine.likes.has(c.hash), mine.recasts.has(c.hash)])
  const [liked, setLiked] = useState(was[0])
  const [recast, setRecast] = useState(was[1])
  const [gone, setGone] = useState(false)
  const toggle = async (type: 1 | 2, on: boolean, set: (v: boolean) => void, bag: Set<string>) => {
    if (!account?.done) return (location.hash = '#/join')
    set(on)
    on ? bag.add(c.hash) : bag.delete(c.hash)
    w().then((m) => m.react(type, on, c)).catch((e) => (set(!on), on ? bag.delete(c.hash) : bag.add(c.hash), toast(e.message)))
  }
  const share = () => {
    const url = `https://s.quilcast.com/c/${c.hash}`
    navigator.share ? navigator.share({ url }).catch(() => {}) : navigator.clipboard.writeText(url).then(() => toast('Link copied'))
  }
  if (gone) return null
  const ch = channelOf(c.parent_url)
  const self = account?.fid === c.author.fid
  return (
    <article class={`cast${big ? ' big' : ''}`} onClick={() => !big && (location.hash = `#/c/${c.hash}`)}>
      <Avatar u={c.author} size={big ? 48 : 44} />
      <div class="body">
        <header>
          <a class="name" href={userPath(c.author)} onClick={(e) => e.stopPropagation()}>{c.author.display_name || c.author.username || `!${c.author.fid}`}</a>
          <span class="handle">@{c.author.username || c.author.fid}</span>
          <span class="dot">·</span>
          <time dateTime={c.timestamp} title={new Date(c.timestamp).toLocaleString()}>{ago(c.timestamp)}</time>
          {ch && <span class="chan">/{ch}</span>}
        </header>
        {c.parent_hash && !big && !inThread && <a class="replying" href={`#/c/${c.parent_hash}`} onClick={(e) => e.stopPropagation()}>Replying to a cast</a>}
        <Text text={c.text} />
        <Embeds c={c} text={c.text} />
        <footer onClick={(e) => e.stopPropagation()}>
          <button class="act" aria-label="Reply" onClick={() => (account?.done ? onReply(c) : (location.hash = '#/join'))}><Icon d={P.reply} />{n(c.replies.count)}</button>
          <button class={`act rc${recast ? ' on' : ''}`} aria-label="Recast" onClick={() => toggle(2, !recast, setRecast, mine.recasts)}><Icon d={P.recast} />{n(c.reactions.recasts_count + +recast - +was[1])}</button>
          <button class={`act lk${liked ? ' on' : ''}`} aria-label="Like" onClick={() => toggle(1, !liked, setLiked, mine.likes)}><Icon d={P.like} fill={liked} />{n(c.reactions.likes_count + +liked - +was[0])}</button>
          <button class="act" aria-label="Share" onClick={share}><Icon d={P.share} /></button>
          {self && big && <button class="act" aria-label="Delete" onClick={() => w().then((m) => m.deleteCast(c.hash)).then(() => (setGone(true), toast('Deleted')), (e) => toast(e.message))}><Icon d={P.trash} /></button>}
        </footer>
      </div>
    </article>
  )
}

// --- toast ---

let showToast = (_: string) => {}
export const toast = (m: string) => showToast(m)
function Toast() {
  const [m, setM] = useState('')
  const t = useRef(0)
  showToast = (x) => (setM(x), clearTimeout(t.current), (t.current = window.setTimeout(() => setM(''), 3500)))
  return m ? <div class="toast" role="status">{m}</div> : null
}

// --- paginated list of casts ---

function useInfinite(load: (cursor?: string) => Promise<{ casts: Cast[]; next?: { cursor?: string | null } }>, key: string) {
  const [items, setItems] = useState<Cast[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sentinel = useRef<HTMLDivElement>(null)
  const more = async (reset = false) => {
    if (busy || (!reset && cursor === null)) return
    setBusy(true)
    setErr('')
    try {
      const r = await load(reset ? undefined : cursor || undefined)
      setItems((prev) => {
        const seen = new Set(reset ? [] : prev.map((c) => c.hash))
        return [...(reset ? [] : prev), ...r.casts.filter((c) => !seen.has(c.hash))]
      })
      setCursor(r.casts.length ? r.next?.cursor || null : null)
    } catch (e: any) {
      setErr(e.message)
    }
    setBusy(false)
  }
  useEffect(() => void more(true), [key])
  useEffect(() => {
    const o = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: '800px' })
    sentinel.current && o.observe(sentinel.current)
    return () => o.disconnect()
  })
  return { items, setItems, busy, err, more, sentinel, end: cursor === null }
}

function Feed({ load, k, onReply, empty }: { load: Parameters<typeof useInfinite>[0]; k: string; onReply: (c: Cast) => void; empty?: string }) {
  const f = useInfinite(load, k)
  return (
    <>
      {f.items.map((c) => <CastCard key={c.hash} c={c} onReply={onReply} />)}
      {f.err && <div class="note">Couldn't load: {f.err} <button class="link-btn" onClick={() => f.more()}>Retry</button></div>}
      {f.busy && <div class="spinner" aria-label="Loading" />}
      {f.end && !f.items.length && !f.err && <div class="note">{empty || 'Nothing here yet.'}</div>}
      <div ref={f.sentinel} />
    </>
  )
}

// --- views ---

function Home({ onReply }: { onReply: (c: Cast) => void }) {
  const [tab, setTab] = useState(account?.done ? 'following' : 'trending')
  return (
    <>
      <nav class="tabs">
        {account?.done && <button class={tab === 'following' ? 'on' : ''} onClick={() => setTab('following')}>Following</button>}
        <button class={tab === 'trending' ? 'on' : ''} onClick={() => setTab('trending')}>Trending</button>
      </nav>
      {!account?.done && <JoinBanner />}
      <Feed
        k={tab}
        onReply={onReply}
        empty="Follow a few people and their casts will show up here."
        load={(cursor) => (tab === 'following' ? get('/v2/farcaster/feed/following', { fid: account!.fid, limit: 25, cursor }) : get('/v2/farcaster/feed/trending', { limit: 25, cursor }))}
      />
    </>
  )
}

const JoinBanner = () => (
  <div class="banner">
    <div>
      <b>Farcaster without the middlemen.</b>
      <p>Quilcast talks straight to the public Hypersnap network, and your keys never leave this browser.</p>
    </div>
    <a class="btn" href="#/join">Join</a>
  </div>
)

function Thread({ hash, onReply }: { hash: string; onReply: (c: Cast) => void }) {
  const [c, setC] = useState<Cast | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setC(null)
    get('/v2/farcaster/cast/conversation', { identifier: hash.replace(/^0x/, ''), type: 'hash', reply_depth: 2 }).then((r) => setC(r.conversation.cast), (e) => setErr(e.message))
  }, [hash])
  if (err) return <div class="note">This cast couldn't be found. It may have been deleted.</div>
  if (!c) return <div class="spinner" />
  return (
    <>
      {c.parent_hash && <a class="up" href={`#/c/${c.parent_hash}`}>Show the cast this replies to</a>}
      <CastCard c={c} big onReply={onReply} />
      <div class="replies">
        {(c.direct_replies || []).map((r) => (
          <div class="reply-group" key={r.hash}>
            <CastCard c={r} inThread onReply={onReply} />
            {(r.direct_replies || []).slice(0, 2).map((rr) => <div class="nested" key={rr.hash}><CastCard c={rr} inThread onReply={onReply} /></div>)}
          </div>
        ))}
        {!c.direct_replies?.length && <div class="note">No replies yet.</div>}
      </div>
    </>
  )
}

function Profile({ id, onReply }: { id: string; onReply: (c: Cast) => void }) {
  const [u, setU] = useState<User | null>(null)
  const [err, setErr] = useState('')
  const [following, setFollowing] = useState<boolean | null>(null)
  const was = useRef(false)
  useEffect(() => {
    setU(null)
    setErr('')
    const q = /^\d+$/.test(id) ? get('/v2/farcaster/user', { fid: id }) : get('/v2/farcaster/user/by-username', { username: id })
    q.then((r) => (setU(r.user), isFollowing(r.user.fid).then((f) => ((was.current = f), setFollowing(f)))), () => setErr('No one goes by that name.'))
  }, [id])
  if (err) return <div class="note">{err}</div>
  if (!u) return <div class="spinner" />
  const self = account?.fid === u.fid
  const toggle = () => {
    if (!account?.done) return (location.hash = '#/join')
    const on = !following
    setFollowing(on)
    w().then((m) => m.follow(u.fid, on)).catch((e) => (setFollowing(!on), toast(e.message)))
  }
  return (
    <>
      <section class="profile">
        <div class="row">
          <Avatar u={u} size={76} />
          {self ? <a class="btn ghost" href="#/settings">Edit profile</a> : <button class={`btn${following ? ' ghost' : ''}`} onClick={toggle} disabled={following === null && !!account?.done}>{following ? 'Following' : 'Follow'}</button>}
        </div>
        <h1>{u.display_name || u.username}</h1>
        <div class="handle">@{u.username || u.fid} <span class="fid">fid {u.fid}</span></div>
        {u.profile?.bio?.text && <Text text={u.profile.bio.text} />}
        <div class="counts"><span><b>{n(u.following_count)}</b> following</span><span><b>{n((u.follower_count || 0) + +!!following - +was.current)}</b> followers</span></div>
      </section>
      <Feed k={`u${u.fid}`} onReply={onReply} empty="No casts yet." load={(cursor) => get('/v2/farcaster/feed/user/casts', { fid: u.fid, limit: 25, cursor })} />
    </>
  )
}

function Settings() {
  const [, force] = useState(0)
  const [prof, setProf] = useState<Record<number, string>>({})
  const [orig, setOrig] = useState<Record<number, string>>({})
  const [showPhrase, setShowPhrase] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!account?.fid) return
    get('/v1/userDataByFid', { fid: account.fid }).then((r) => {
      const v: Record<number, string> = {}
      const T: Record<string, number> = { USER_DATA_TYPE_DISPLAY: 2, USER_DATA_TYPE_BIO: 3, USER_DATA_TYPE_PFP: 1, USER_DATA_TYPE_URL: 5 }
      for (const m of r.messages) T[m.data.userDataBody.type] && (v[T[m.data.userDataBody.type]] = m.data.userDataBody.value)
      setProf(v)
      setOrig(v)
    }, () => {})
  }, [])
  const saveProfile = async () => {
    setSaving(true)
    try {
      for (const k of Object.keys(prof).map(Number)) if ((prof[k] || '') !== (orig[k] || '')) await (await w()).setUserData(k, prof[k] || '')
      setOrig(prof)
      toast('Profile saved')
    } catch (e: any) {
      toast(e.message)
    }
    setSaving(false)
  }
  const field = (t: number, label: string, ph: string, area?: boolean) => {
    const props = { value: prof[t] || '', placeholder: ph, onInput: (e: any) => setProf({ ...prof, [t]: e.currentTarget.value }) }
    return <label>{label}{area ? <textarea rows={3} maxLength={256} {...props} /> : <input maxLength={256} {...props} />}</label>
  }
  const setting = (k: 'node' | 'rpc', label: string, hint: string) => (
    <label>{label}<input value={settings[k]} onChange={(e) => ((settings[k] = e.currentTarget.value.replace(/\/+$/, '')), saveSettings())} /><small>{hint}</small></label>
  )
  return (
    <div class="settings">
      <h1>Settings</h1>
      {account?.done && (
        <section>
          <h2>Profile</h2>
          {field(USER_DATA.DISPLAY, 'Display name', 'Your name')}
          {field(USER_DATA.BIO, 'Bio', 'A line or two about you', true)}
          {field(USER_DATA.PFP, 'Avatar image URL', 'https://…/me.jpg')}
          {field(USER_DATA.URL, 'Website', 'https://…')}
          <button class="btn" onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        </section>
      )}
      <section>
        <h2>Appearance</h2>
        <div class="seg">
          {['system', 'light', 'dark'].map((t) => (
            <button class={settings.theme === t ? 'on' : ''} onClick={() => ((settings.theme = t), saveSettings(), applyTheme(), force((x) => x + 1))}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </section>
      <section>
        <h2>Network</h2>
        {setting('node', 'Hypersnap node', 'Any public Hypersnap or Snapchain HTTP endpoint with CORS.')}
        {setting('rpc', 'Optimism RPC', 'Used only to register new accounts.')}
      </section>
      {account && (
        <section>
          <h2>Account</h2>
          <p class="muted">Your recovery phrase controls your Farcaster account. It's stored only in this browser, and it also works in Quorum, Warpcast and other Farcaster apps.</p>
          {showPhrase ? <code class="phrase">{account.phrase}</code> : <button class="btn ghost" onClick={() => setShowPhrase(true)}>Show recovery phrase</button>}
          <button class="btn danger" onClick={() => (confirmOut ? (setAccount(null), (location.hash = '#/')) : setConfirmOut(true))}>{confirmOut ? 'Tap again to sign out and erase keys' : 'Sign out'}</button>
        </section>
      )}
      <p class="muted small">Quilcast is open source at <a href="https://github.com/backmeupplz/quilcast" target="_blank" rel="noopener">github.com/backmeupplz/quilcast</a>.</p>
    </div>
  )
}

// --- composer ---

const bytes = (s: string) => new TextEncoder().encode(s).length
function Composer({ parent, onClose }: { parent?: Cast; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const left = 320 - bytes(text)
  const send = async () => {
    setBusy(true)
    try {
      const hash = await (await w()).post(text.trim(), parent && { fid: parent.author.fid, hash: parent.hash })
      onClose()
      toast(parent ? 'Reply sent' : 'Cast sent')
      location.hash = `#/c/${hash}`
    } catch (e: any) {
      toast(e.message)
      setBusy(false)
    }
  }
  return (
    <div class="modal" onClick={onClose}>
      <div class="sheet" role="dialog" aria-label={parent ? 'Reply' : 'New cast'} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => (e.key === 'Escape' && onClose(), (e.metaKey || e.ctrlKey) && e.key === 'Enter' && left >= 0 && text.trim() && send())}>
        <div class="sheet-top">
          <button class="link-btn" onClick={onClose}>Cancel</button>
          <button class="btn" disabled={busy || left < 0 || !text.trim()} onClick={send}>{busy ? 'Sending…' : parent ? 'Reply' : 'Cast'}</button>
        </div>
        {parent && <div class="parent-preview"><b>{parent.author.display_name}</b> <span>@{parent.author.username}</span><p>{parent.text.slice(0, 140)}</p></div>}
        <textarea ref={ref} value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder={parent ? 'Write your reply' : "What's happening?"} rows={5} />
        <div class={`count${left < 20 ? ' warn' : ''}`}>{left}</div>
      </div>
    </div>
  )
}

// --- shell ---

function applyTheme() {
  settings.theme === 'system' ? delete document.documentElement.dataset.theme : (document.documentElement.dataset.theme = settings.theme)
}

const useRoute = () => {
  const [h, setH] = useState(location.hash)
  useEffect(() => {
    const f = () => (setH(location.hash), scrollTo(0, 0))
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return h.replace(/^#\/?/, '').split('/')
}

function App() {
  const [, force] = useState(0)
  const [compose, setCompose] = useState<{ parent?: Cast } | null>(null)
  const [r0, r1] = useRoute()
  useEffect(() => {
    const f = () => force((x) => x + 1)
    addEventListener('account', f)
    loadMine().then(f)
    return () => removeEventListener('account', f)
  }, [])
  const onReply = (c: Cast) => setCompose({ parent: c })
  const view =
    r0 === 'c' ? <Thread hash={r1} onReply={onReply} />
      : r0 === 'u' ? <Profile id={decodeURIComponent(r1)} onReply={onReply} />
        : r0 === 'settings' ? <Settings />
          : r0 === 'join' ? <Join />
            : <Home onReply={onReply} />
  const me = account?.done
  return (
    <>
      <header class="top">
        <div class="wrap">
          {r0 ? <button class="icon-btn" aria-label="Back" onClick={() => (history.length > 1 ? history.back() : (location.hash = '#/'))}><Icon d={P.back} /></button> : <span class="icon-btn" />}
          <a class="brand" href="#/"><Logo /><span>Quilcast</span></a>
          <div class="right">
            {me ? <a href={`#/u/${account!.username || account!.fid}`} class="me" aria-label="Your profile">{account!.username ? `@${account!.username}` : 'Profile'}</a> : <a class="btn small" href="#/join">Join</a>}
            <a class="icon-btn" href="#/settings" aria-label="Settings"><Icon d={P.gear} /></a>
          </div>
        </div>
      </header>
      <main class="wrap">{view}</main>
      {me && r0 !== 'join' && r0 !== 'settings' && <button class="fab" aria-label="New cast" onClick={() => setCompose({})}><Icon d={P.pen} /></button>}
      {compose && <Composer parent={compose.parent} onClose={() => setCompose(null)} />}
      <Toast />
    </>
  )
}

applyTheme()
render(<App />, document.getElementById('app')!)
