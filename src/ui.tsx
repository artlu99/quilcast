import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { account, castText, get, go, LINK_RE, mine, mineVersion, posting, safeUrl, toUrl, users, type Cast, type User } from './api.ts'

// keys and crypto load only when someone signs in or writes
export const w = () => import('./write.ts')

// module-level hooks the shell fills in, so any component can toast or open the composer
export const shell = {
  toast: (_: string) => {},
  compose: (_: { parent?: Cast; quote?: Cast; channel?: string } = {}) => {},
  view: (_urls: string[], _index: number) => {},
}
export const toast = (m: string) => shell.toast(m)
export const requireAccount = () => (account?.done ? true : (go('/join'), false))

export const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  reply: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.9L3 20l1.1-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z',
  recast: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  quote: 'M7 7h4v4c0 3-1.5 4.5-4 5M15 7h4v4c0 3-1.5 4.5-4 5',
  like: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14',
  back: 'M19 12H5M12 19l-7-7 7-7',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  image: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM3 16l5-5 5 5M14 14l2-2 5 5M15.5 8.5h.01',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  x: 'M18 6 6 18M6 6l12 12',
  play: 'M7 4v16l13-8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
}
export const Icon = ({ d, fill, size = 18 }: { d: string; fill?: boolean; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="var(--accent)" />
    <path d="M23.5 6.5c-6 .5-10.5 4.8-12 11.5l-1.6 7.5 1.4.4 2-5.2c4.6-.4 8.4-3.4 9.6-8.2-1.3.6-2.7.9-4 .9 1.9-1.2 3.6-3.6 4.6-6.9z" fill="#fff" />
  </svg>
)

export const ago = (t: string) => {
  const s = (Date.now() - Date.parse(t)) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 300 * 86400 ? 'numeric' : undefined })
}
export const n = (x = 0) => (x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e4 ? Math.round(x / 1e3) + 'K' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(x))
export const handle = (u: User) => (u.username && !u.username.startsWith('fid:') ? u.username : `!${u.fid}`)
export const userPath = (u: User) => `/u/${u.username && !u.username.startsWith('fid:') ? u.username : u.fid}`
export const channelOf = (u?: string | null) => u?.match(/(?:warpcast\.com|farcaster\.xyz)\/~\/channel\/([^/?#]+)/)?.[1]
export const channelUrl = (id: string) => `https://warpcast.com/~/channel/${id}`
const stop = (e: Event) => e.stopPropagation()

export const Avatar = ({ u, size = 40, link = true }: { u: User; size?: number; link?: boolean }) => {
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px` }
  const pfp = safeUrl(u.pfp_url)
  const inner = pfp ? <img src={pfp} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <span>{[...(u.display_name || u.username || '?')][0]}</span>
  return link ? <a class="avatar" href={userPath(u)} style={style} onClick={stop} aria-label={u.display_name || u.username}>{inner}</a> : <span class="avatar" style={style}>{inner}</span>
}

// links, @mentions and /channels inside cast text
export function RichText({ text, class: cls = 'text' }: { text: string; class?: string }) {
  const parts = text.split(new RegExp(`(${LINK_RE.source}|(?<![\\w/])@[a-z0-9][a-z0-9.-]*[a-z0-9]|(?<![\\w/:])\\/[a-z0-9-]{2,}(?![\\w/]))`, 'gi'))
  return (
    <p class={cls}>
      {parts.map((p, i) =>
        i % 2 === 0 ? p
          : p[0] === '@' ? <a key={i} href={`/u/${p.slice(1)}`} onClick={stop}>{p}</a>
            : p[0] === '/' ? <span key={i} class="chan-ref">{p}</span>
              : !safeUrl(toUrl(p)) ? p
                : <a key={i} href={safeUrl(toUrl(p))} target="_blank" rel="noopener noreferrer nofollow" onClick={stop}>{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}{p.replace(/^https?:\/\/(www\.)?/, '').length > 40 ? '…' : ''}</a>,
      )}
    </p>
  )
}

export const isImg = (u: string) => /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(u) || /imagedelivery\.net|i\.imgur\.com/.test(u)
export const isVid = (u: string) => /\.(m3u8|mp4|webm|mov)(\?|$)/i.test(u)

// Farcaster's streams get a first-frame poster from our server
const poster = (src?: string) => (src && /^https:\/\/stream\.farcaster\.xyz\//.test(src) ? `/api/poster?url=${encodeURIComponent(src)}` : undefined)

// HLS plays natively in Safari and Chrome; Firefox-based browsers get hls.js, loaded on first play
export function Video({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const hls = src.includes('.m3u8') && !document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
  const [ready, setReady] = useState(!hls)
  const start = async (e: Event) => {
    e.stopPropagation()
    // the full build: Farcaster's streams carry audio as a separate rendition, which hls.js/light drops
    const { default: Hls } = await import('hls.js')
    const h = new Hls()
    h.loadSource(src)
    h.attachMedia(ref.current!)
    setReady(true)
    ref.current!.play().catch(() => {})
  }
  return (
    <div class="vid" onClick={stop}>
      <video ref={ref} src={hls ? undefined : src} poster={poster(src)} controls={ready} preload="metadata" playsInline />
      {!ready && <button class="play" aria-label="Play video" onClick={start}><Icon d={P.play} fill size={26} /></button>}
    </div>
  )
}

export function Media({ urls: given }: { urls: string[] }) {
  const urls = given.map(safeUrl).filter((u): u is string => !!u)
  const imgs = urls.filter(isImg)
  const shown = imgs.slice(0, 4)
  return (
    <>
      {imgs.length > 0 && (
        <div class={`imgs n${shown.length}`} onClick={stop}>
          {shown.map((u, i) => (
            <button class="img" aria-label={`Open image ${i + 1} of ${imgs.length}`} onClick={() => shell.view(imgs, i)}>
              <img src={u} alt="" loading="lazy" referrerpolicy="no-referrer" />
              {i === 3 && imgs.length > 4 && <span class="more-imgs">+{imgs.length - 4}</span>}
            </button>
          ))}
        </div>
      )}
      {urls.filter(isVid).map((u) => <Video src={u} />)}
    </>
  )
}

/** Full-screen image viewer: arrows, keyboard and swipe move between images. */
export function Lightbox({ urls, index, close }: { urls: string[]; index: number; close: () => void }) {
  const [i, setI] = useState(index)
  const many = urls.length > 1
  const step = (d: number) => many && setI((x) => (x + d + urls.length) % urls.length)
  const touch = useRef(0)
  useEffect(() => {
    const key = (e: KeyboardEvent) => (e.key === 'Escape' ? close() : e.key === 'ArrowRight' ? step(1) : e.key === 'ArrowLeft' ? step(-1) : null)
    addEventListener('keydown', key)
    document.body.style.overflow = 'hidden'
    return () => (removeEventListener('keydown', key), (document.body.style.overflow = ''))
  }, [])
  return (
    <div class="lightbox" role="dialog" aria-label="Image viewer" onClick={close}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - touch.current
        Math.abs(dx) > 50 && step(dx < 0 ? 1 : -1)
      }}>
      <img src={safeUrl(urls[i])} alt="" referrerpolicy="no-referrer" onClick={stop} />
      <button class="lb-btn lb-close" aria-label="Close" onClick={close}><Icon d={P.x} size={22} /></button>
      {many && (
        <>
          <button class="lb-btn lb-prev" aria-label="Previous image" onClick={(e) => (stop(e), step(-1))}><Icon d={P.back} size={22} /></button>
          <button class="lb-btn lb-next" aria-label="Next image" onClick={(e) => (stop(e), step(1))}><Icon d={P.back} size={22} /></button>
          <span class="lb-count">{i + 1} / {urls.length}</span>
        </>
      )}
      {safeUrl(urls[i]) && <a class="lb-open" href={safeUrl(urls[i])} target="_blank" rel="noopener noreferrer" onClick={stop}>Open original</a>}
    </div>
  )
}

type Tweet = { text: string; author: { name?: string; handle?: string; avatar?: string }; at?: number; photos: string[]; video?: string; likes?: number; replies?: number; reposts?: number; quote?: { name?: string; handle?: string; text?: string } }
type Unfurl = { url: string; title?: string; description?: string; site?: string; image?: string; button?: string; icon?: string; tweet?: Tweet } | null

const X_LOGO = 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.19L2 3h6.33l4.37 5.77zm-1.08 16.17h1.7L7.4 4.74H5.58z'
function TweetCard({ u, t }: { u: string; t: Tweet }) {
  return (
    <div class="tweet" onClick={(e) => (stop(e), safeUrl(u) && open(safeUrl(u), '_blank', 'noopener,noreferrer'))} role="link" tabIndex={0}>
      <div class="tw-head">
        {safeUrl(t.author.avatar) && <img class="tw-av" src={safeUrl(t.author.avatar)} alt="" loading="lazy" referrerpolicy="no-referrer" />}
        <b>{t.author.name}</b><span class="handle">@{t.author.handle}</span>
        {t.at && <span class="handle">· {ago(new Date(t.at * 1000).toISOString())}</span>}
        <svg class="tw-x" viewBox="0 0 24 24" width="16" height="16" aria-label="X"><path d={X_LOGO} fill="currentColor" /></svg>
      </div>
      {t.text && <RichText text={t.text.replace(/\s*https:\/\/t\.co\/\S+$/, '')} class="text tw-text" />}
      {t.photos.length > 0 && <Media urls={t.photos} />}
      {!t.photos.length && safeUrl(t.video) && <div class="tw-video"><img src={safeUrl(t.video)} alt="" loading="lazy" referrerpolicy="no-referrer" /><span class="play"><Icon d={P.play} fill size={24} /></span></div>}
      {t.quote && <div class="tw-quote"><b>{t.quote.name}</b> <span class="handle">@{t.quote.handle}</span><p>{t.quote.text}</p></div>}
      <div class="tw-stats"><span>{n(t.replies)} replies</span><span>{n(t.reposts)} reposts</span><span>{n(t.likes)} likes</span></div>
    </div>
  )
}
const unfurls = new Map<string, Promise<Unfurl>>()
const unfurl = (u: string) => {
  if (!unfurls.has(u)) unfurls.set(u, fetch(`/api/unfurl?url=${encodeURIComponent(u)}`).then((r) => r.json(), () => null))
  return unfurls.get(u)!
}

// Open Graph preview, fetched through our server; a plain domain row until (or unless) it arrives
export function LinkCard({ u: given }: { u: string }) {
  const u = safeUrl(given)
  const [d, setD] = useState<Unfurl | undefined>(undefined)
  useEffect(() => void (u && unfurl(u).then(setD)), [u])
  if (!u) return null
  const host = new URL(u).hostname.replace(/^www\./, '')
  const image = safeUrl(d?.image)
  const icon = safeUrl(d?.icon)
  if (d?.tweet) return <TweetCard u={u} t={d.tweet} />
  // a link straight to an image renders as the image
  if (image && d?.image === d?.url) return <Media urls={[image]} />
  const meta = (
    <span class="lc-text">
      <span class="lc-site">{icon && <img src={icon} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />}{host}</span>
      {d?.title && <b class="lc-title">{d.title}</b>}
      {d?.description && <span class="lc-desc">{d.description}</span>}
    </span>
  )
  return (
    <a class={`linkcard${image ? ' big' : ''}`} href={u} target="_blank" rel="noopener noreferrer nofollow" onClick={stop}>
      {image && <img class="lc-img" src={image} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />}
      {meta}
      {d?.button && <span class="lc-btn">{d.button}</span>}
    </a>
  )
}

const castCache = new Map<string, Promise<Cast | null>>()
export const fetchCast = (hash: string) => {
  hash = hash.replace(/^0x/, '')
  if (!castCache.has(hash)) castCache.set(hash, get('/v2/farcaster/cast', { identifier: hash, type: 'hash' }).then((r) => r.cast, () => null))
  return castCache.get(hash)!
}

export function QuoteCard({ hash, c: given }: { hash?: string; c?: Cast }) {
  const [c, setC] = useState<Cast | null | undefined>(given)
  useEffect(() => void (hash && !given && fetchCast(hash).then(setC)), [hash])
  if (c === null) return <div class="quote muted">This cast is unavailable.</div>
  if (!c) return <div class="quote skeleton" />
  const urls = c.embeds.map((e) => safeUrl(e.url)).filter((u): u is string => !!u)
  const img = urls.find(isImg) || poster(urls.find(isVid))
  const text = castText(c).trim()
  return (
    <a class="quote" href={`/c/${c.hash}`} onClick={stop}>
      <div class="meta"><Avatar u={c.author} size={18} link={false} /><b>{c.author.display_name || handle(c.author)}</b><span>@{handle(c.author)} · {ago(c.timestamp)}</span></div>
      {/* text gets a thumbnail beside it; a cast that is only media shows it at size */}
      <div class={`qbody${text ? '' : ' bare'}`}>
        {text && <RichText text={text} class="text clamp" />}
        {img && <img class="qimg" src={img} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />}
      </div>
    </a>
  )
}

function Embeds({ c }: { c: Cast }) {
  const urls = c.embeds.map((e) => safeUrl(e.url)).filter((u): u is string => !!u)
  const links = urls.filter((u) => !isImg(u) && !isVid(u))
  const quotes = c.embeds.filter((e) => /^(0x)?[0-9a-f]{40}$/i.test(e.cast_id?.hash || ''))
  const all = (
    <>
      <Media urls={urls} />
      {links.map((u) => <LinkCard u={u} />)}
      {quotes.map((e) => <QuoteCard hash={e.cast_id!.hash} />)}
    </>
  )
  // several embeds (the images count as one) sit side by side and scroll, instead of stacking into a tall cast
  return +urls.some(isImg) + urls.filter(isVid).length + links.length + quotes.length > 1 ? <div class="strip">{all}</div> : all
}

function RecastMenu({ c, on, toggle, close }: { c: Cast; on: boolean; toggle: () => void; close: () => void }) {
  useEffect(() => {
    const f = () => close()
    setTimeout(() => addEventListener('click', f), 0)
    return () => removeEventListener('click', f)
  }, [])
  return (
    <div class="menu" role="menu">
      <button role="menuitem" onClick={() => (close(), toggle())}><Icon d={P.recast} />{on ? 'Undo recast' : 'Recast'}</button>
      <button role="menuitem" onClick={() => (close(), requireAccount() && shell.compose({ quote: c }))}><Icon d={P.quote} />Quote</button>
    </div>
  )
}

/** A cast row. `focus` is the thread's main cast; `line` draws the thread connector down to the next row. */
export function CastCard({ c, focus, line, inThread, quotes = 0 }: { c: Cast; focus?: boolean; line?: boolean; inThread?: boolean; quotes?: number }) {
  // what the node counted already includes our earlier reactions; local taps adjust from there
  const was = useMemo(() => [mine.likes.has(c.hash), mine.recasts.has(c.hash)], [c.hash, mineVersion])
  const [likedTap, setLiked] = useState<boolean | null>(null)
  const [recastTap, setRecast] = useState<boolean | null>(null)
  const liked = likedTap ?? was[0]
  const recast = recastTap ?? was[1]
  const [menu, setMenu] = useState(false)
  const [gone, setGone] = useState(false)
  const toggle = (type: 1 | 2, on: boolean, set: (v: boolean) => void, bag: Set<string>) => {
    if (!requireAccount()) return
    set(on)
    on ? bag.add(c.hash) : bag.delete(c.hash)
    w().then((m) => m.react(type, on, c)).catch((e) => (set(!on), on ? bag.delete(c.hash) : bag.add(c.hash), toast(e.message)))
  }
  const share = () => {
    const url = `${location.origin}/c/${c.hash}`
    navigator.share ? navigator.share({ url }).catch(() => {}) : navigator.clipboard.writeText(url).then(() => toast('Link copied'))
  }
  if (gone) return null
  const sending = posting.get(c.hash) === c
  const ch = channelOf(c.parent_url)
  const parentUser = c.parent_author?.fid ? users.get(c.parent_author.fid) : undefined
  const likes = c.reactions.likes_count + +liked - +was[0]
  const recasts = c.reactions.recasts_count + +recast - +was[1]
  const actions = (
    <footer onClick={stop}>
      <button class="act" aria-label="Reply" onClick={() => requireAccount() && shell.compose({ parent: c })}><Icon d={P.reply} /><span>{c.replies.count ? n(c.replies.count) : ''}</span></button>
      <span class="wrap-menu">
        <button class={`act rc${recast ? ' on' : ''}`} aria-label="Recast or quote" aria-haspopup="menu" onClick={() => setMenu(!menu)}><Icon d={P.recast} /><span>{recasts ? n(recasts) : ''}</span></button>
        {menu && <RecastMenu c={c} on={recast} toggle={() => toggle(2, !recast, setRecast, mine.recasts)} close={() => setMenu(false)} />}
      </span>
      <button class={`act lk${liked ? ' on' : ''}`} aria-label="Like" onClick={() => toggle(1, !liked, setLiked, mine.likes)}><Icon d={P.like} fill={liked} /><span>{likes ? n(likes) : ''}</span></button>
      <button class="act" aria-label="Share" onClick={share}><Icon d={P.share} /></button>
      {focus && account?.fid === c.author.fid && <button class="act" aria-label="Delete" onClick={() => w().then((m) => m.deleteCast(c.hash)).then(() => (setGone(true), toast('Deleted')), (e) => toast(e.message))}><Icon d={P.trash} /></button>}
    </footer>
  )
  const name = (
    <>
      <a class="name" href={userPath(c.author)} onClick={stop}>{c.author.display_name || handle(c.author)}</a>
      <span class="handle">@{handle(c.author)}</span>
    </>
  )
  if (focus)
    return (
      <article class="cast focus">
        <header><Avatar u={c.author} size={44} /><div class="who">{name}</div>{ch && <span class="chan">/{ch}</span>}</header>
        <RichText text={castText(c)} />
        <Embeds c={c} />
        <div class="when">{sending ? <span class="posting"><span class="pulse" /> Posting…</span> : new Date(c.timestamp).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', year: 'numeric' })}</div>
        {(recasts > 0 || quotes > 0 || likes > 0) && (
          <div class="stats">
            {recasts > 0 && <a href={`/c/${c.hash}/recasts`}><b>{n(recasts)}</b> {recasts === 1 ? 'recast' : 'recasts'}</a>}
            {quotes > 0 && <a href={`/c/${c.hash}/quotes`}><b>{n(quotes)}</b> {quotes === 1 ? 'quote' : 'quotes'}</a>}
            {likes > 0 && <a href={`/c/${c.hash}/likes`}><b>{n(likes)}</b> {likes === 1 ? 'like' : 'likes'}</a>}
          </div>
        )}
        {actions}
      </article>
    )
  return (
    <article class={`cast${line ? ' line' : ''}`} onClick={() => go(`/c/${c.hash}`)}>
      <div class="rail"><Avatar u={c.author} /></div>
      <div class="body">
        <header>
          {name}
          <span class="dot">·</span>
          {sending ? <span class="posting">Posting…</span> : <time dateTime={c.timestamp} title={new Date(c.timestamp).toLocaleString()}>{ago(c.timestamp)}</time>}
          {ch && <span class="chan">/{ch}</span>}
        </header>
        {c.parent_hash && !inThread && <div class="replying">Replying to {parentUser ? <a href={userPath(parentUser)} onClick={stop}>@{handle(parentUser)}</a> : 'a cast'}</div>}
        <RichText text={castText(c)} />
        <Embeds c={c} />
        {actions}
      </div>
    </article>
  )
}

export const UserRow = ({ u }: { u: User }) => (
  <a class="row" href={userPath(u)}>
    <Avatar u={u} link={false} />
    <span class="row-main">
      <span class="row-top"><b>{u.display_name || handle(u)}</b><span class="handle">@{handle(u)}</span></span>
      {u.profile?.bio?.text && <span class="row-sub">{u.profile.bio.text}</span>}
    </span>
    <span class="row-meta">{n(u.follower_count)}<small>followers</small></span>
  </a>
)
