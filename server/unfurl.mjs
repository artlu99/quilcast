// GET /api/unfurl?url=…: Open Graph / mini app metadata for link previews.
// Only public http(s) hosts are fetched, every redirect hop is re-checked.
// ponytail: fetch re-resolves DNS after the check (rebinding window); pin the resolved IP if this ever matters
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const UA = 'Mozilla/5.0 (compatible; QuilcastBot/1.0; +https://quilcast.com) facebookexternalhit/1.1'
const cache = new Map()

const privateIp = (ip) =>
  isIP(ip) === 6
    ? /^(::1?|fc|fd|fe80|::ffff:(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip)
    : /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(ip)

async function safeFetch(url) {
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) throw new Error('bad scheme')
    const addrs = await lookup(u.hostname, { all: true })
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('private host')
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.5' }, signal: AbortSignal.timeout(5000) })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location'), u).href
      continue
    }
    return { r, url }
  }
  throw new Error('too many redirects')
}

const decode = (s) => s?.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)))

async function read(url) {
  const { r, url: final } = await safeFetch(url)
  const type = r.headers.get('content-type') || ''
  if (type.startsWith('image/')) return { url: final, image: final }
  if (!r.ok || !type.includes('html')) return null
  // the <head> is enough (YouTube puts its tags ~800 KB in): stop there or at 1.5 MB
  let html = ''
  for await (const chunk of r.body) if ((html += Buffer.from(chunk).toString('utf8')).length > 1.5e6 || /<\/head>/i.test(html)) break
  const meta = {}
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const key = m[0].match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    const val = m[0].match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i)
    if (key && val && !(key in meta)) meta[key] = decode(val[1] ?? val[2])
  }
  // Farcaster mini apps and frames carry a 3:2 image and a button label
  let app
  try {
    app = JSON.parse(meta['fc:miniapp'] || meta['fc:frame'] || 'null')
  } catch {}
  const abs = (u) => {
    try {
      return u && new URL(u, final).href
    } catch {}
  }
  return {
    url: final,
    title: meta['og:title'] || meta['twitter:title'] || decode(html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim()),
    description: meta['og:description'] || meta['twitter:description'] || meta.description,
    site: meta['og:site_name'],
    image: abs(app?.imageUrl || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src']),
    button: app?.button?.title,
    icon: abs(html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)/i)?.[1] || '/favicon.ico'),
  }
}

// X posts: fxtwitter's public API returns the post itself, which X's own pages don't give bots
async function tweet(url) {
  const m = url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/i)
  if (!m) return
  const r = await fetch(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(5000) })
  const t = (await r.json()).tweet
  if (!t) return null
  return {
    url,
    tweet: {
      text: t.text,
      author: { name: t.author?.name, handle: t.author?.screen_name, avatar: t.author?.avatar_url },
      at: t.created_timestamp,
      photos: (t.media?.photos || []).map((p) => p.url).slice(0, 4),
      video: t.media?.videos?.[0]?.thumbnail_url,
      likes: t.likes, replies: t.replies, reposts: t.retweets,
      quote: t.quote && { name: t.quote.author?.name, handle: t.quote.author?.screen_name, text: t.quote.text },
    },
  }
}

export async function unfurl(url) {
  if (!cache.has(url)) {
    cache.size > 2000 && cache.delete(cache.keys().next().value)
    cache.set(url, tweet(url).then((t) => (t === undefined ? read(url) : t)).catch(() => null))
  }
  return cache.get(url)
}
