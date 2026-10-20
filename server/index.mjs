// Serves the built app from dist/ and gives cast and profile pages real meta tags,
// plus a rendered 1200×630 card per cast at /og/c/<hash>.png, so shared links unfurl.
import { Resvg } from '@resvg/resvg-js'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const NODE = process.env.NODE_URL || 'https://haatz.quilibrium.com'
const SITE = process.env.SITE_URL || 'https://quilcast.com'
const DIST = new URL('../dist/', import.meta.url).pathname
const FONTS = ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'NotoEmoji.ttf'].map((f) => new URL(`fonts/${f}`, import.meta.url).pathname)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const fetchJson = (url) => fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null))

// ponytail: per-character width guesses instead of real font metrics; fine for wrapping, may misjudge exotic scripts
const charW = (c) => (/[iljI.,'!|:;`]/.test(c) ? 0.27 : c === ' ' ? 0.28 : /[mwMW@%]/.test(c) ? 0.86 : /[A-Z]/.test(c) ? 0.68 : /[0-9a-z]/.test(c) ? 0.56 : c.codePointAt(0) > 0x2e7f ? 1.05 : 0.6)
const width = (s, px) => [...s].reduce((w, c) => w + charW(c) * px, 0)
function wrap(text, px, max, lines) {
  const out = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      if (width(line + word, px) > max && line.trim()) out.push(line.trimEnd()), (line = word.trimStart())
      else line += word
      while (width(line, px) > max) {
        let i = line.length
        while (i > 1 && width(line.slice(0, i), px) > max) i--
        out.push(line.slice(0, i))
        line = line.slice(i)
      }
    }
    out.push(line.trimEnd())
  }
  while (out.length && !out.at(-1)) out.pop()
  if (out.length > lines) {
    out.length = lines
    out[lines - 1] = out[lines - 1].replace(/\s*\S{0,12}$/, '') + '…'
  }
  return out
}

async function dataUri(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) })
    const type = r.headers.get('content-type') || ''
    if (!r.ok || !/^image\/(png|jpe?g|gif|webp)/.test(type)) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length < 4e6 ? `data:${type};base64,${buf.toString('base64')}` : null
  } catch {
    return null
  }
}

const n = (x = 0) => (x >= 1e4 ? Math.round(x / 1e3) + 'K' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(x))
const MARK = 'M23.5 6.5c-6 .5-10.5 4.8-12 11.5l-1.6 7.5 1.4.4 2-5.2c4.6-.4 8.4-3.4 9.6-8.2-1.3.6-2.7.9-4 .9 1.9-1.2 3.6-3.6 4.6-6.9z'

async function card(c) {
  const a = c.author
  const img = c.embeds.map((e) => e.url).find((u) => u && (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) || /imagedelivery\.net|i\.imgur\.com/.test(u)))
  const [pfp, pic] = await Promise.all([a.pfp_url ? dataUri(a.pfp_url) : null, img ? dataUri(img) : null])
  const textW = pic ? 600 : 1040
  const size = c.text.length < 90 ? 46 : c.text.length < 200 ? 38 : 32
  const lines = wrap(c.text || ' ', size, textW, Math.floor(300 / (size * 1.32)))
  const name = a.display_name || a.username || `!${a.fid}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="g" cx="0.9" cy="0.05" r="0.8"><stop offset="0" stop-color="#3a2a9a"/><stop offset="1" stop-color="#0d0c11" stop-opacity="0"/></radialGradient>
    <clipPath id="av"><circle cx="128" cy="120" r="44"/></clipPath>
    <clipPath id="pic"><rect x="712" y="72" width="420" height="420" rx="28"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#0d0c11"/><rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="128" cy="120" r="44" fill="#2a2735"/>
  ${pfp ? `<image href="${pfp}" x="84" y="76" width="88" height="88" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>` : `<text x="128" y="136" font-family="Inter" font-weight="700" font-size="40" fill="#9893a5" text-anchor="middle">${esc(name[0].toUpperCase())}</text>`}
  <text x="196" y="112" font-family="Inter, Noto Emoji" font-weight="700" font-size="34" fill="#edebf3">${esc(wrap(name, 34, (pic ? 480 : 900) - 196, 1)[0])}</text>
  <text x="196" y="150" font-family="Inter" font-size="26" fill="#9893a5">@${esc(a.username || a.fid)}</text>
  <text font-family="Inter, Noto Emoji" font-size="${size}" fill="#edebf3">${lines.map((l, i) => `<tspan x="84" y="${232 + i * size * 1.32}">${esc(l) || ' '}</tspan>`).join('')}</text>
  ${pic ? `<rect x="712" y="72" width="420" height="420" rx="28" fill="#1c1a23"/><image href="${pic}" x="712" y="72" width="420" height="420" preserveAspectRatio="xMidYMid slice" clip-path="url(#pic)"/>` : ''}
  <line x1="84" y1="540" x2="1116" y2="540" stroke="#25232d" stroke-width="2"/>
  <g transform="translate(84 562) scale(1.25)"><rect width="32" height="32" rx="9" fill="#5b3df5"/><path d="${MARK}" fill="#fff"/></g>
  <text x="138" y="593" font-family="Inter" font-weight="700" font-size="28" fill="#edebf3">Quilcast</text>
  <text x="1116" y="592" xml:space="preserve" font-family="Inter" font-size="24" fill="#9893a5" text-anchor="end">${n(c.replies.count)} replies  ·  ${n(c.reactions.recasts_count)} recasts  ·  <tspan fill="#ff5c8a">♥ ${n(c.reactions.likes_count)}</tspan></text>
</svg>`
}

const cache = new Map()
const remember = (k, v) => (cache.size > 500 && cache.delete(cache.keys().next().value), cache.set(k, v), v)
const getCast = (hash) => cache.get(hash) || remember(hash, fetchJson(`${NODE}/v2/farcaster/cast?identifier=${hash}&type=hash`).then((r) => r?.cast || (cache.delete(hash), null)))
const getUser = (name) => fetchJson(`${NODE}/v2/farcaster/user${/^\d+$/.test(name) ? `?fid=${name}` : `/by-username?username=${encodeURIComponent(name)}`}`).then((r) => r?.user)
const render = (svg) => new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng()

const index = await readFile(join(DIST, 'index.html'), 'utf8')
// swap the default title/description/url/image in index.html for page-specific ones
function page({ title, desc, path, image, alt }) {
  let h = index.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
  const set = (attr, keys, v) => keys.forEach((k) => (h = h.replace(new RegExp(`(<meta ${attr}="${k}" content=")[^"]*`), `$1${esc(v)}`)))
  set('name', ['description', 'twitter:description'], desc)
  set('property', ['og:description'], desc)
  set('property', ['og:title'], title)
  set('name', ['twitter:title'], title)
  set('property', ['og:url'], SITE + path)
  if (image) set('property', ['og:image'], image), set('name', ['twitter:image'], image), set('property', ['og:image:alt'], alt), set('name', ['twitter:image:alt'], alt)
  return h.replace(/(<link rel="canonical" href=")[^"]*/, `$1${SITE + path}`).replace('<meta property="og:type" content="website" />', '<meta property="og:type" content="article" />')
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const html = (res, body) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }).end(body)

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  try {
    if (path === '/health') return res.end('ok')
    const og = path.match(/^\/og\/c\/(?:0x)?([0-9a-f]{40})\.png$/i)
    if (og) {
      const hash = og[1].toLowerCase()
      const c = await getCast(hash)
      if (!c) return res.writeHead(404).end()
      const png = await (cache.get(hash + '.png') || remember(hash + '.png', card(c).then(render)))
      return res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }).end(png)
    }
    const cast = path.match(/^\/c\/(?:0x)?([0-9a-f]{40})$/i)
    if (cast) {
      const c = await getCast(cast[1].toLowerCase())
      if (!c) return html(res, index)
      const desc = c.text.slice(0, 280) || 'A cast on Farcaster'
      return html(res, page({ title: `${c.author.display_name || c.author.username} (@${c.author.username}) on Quilcast`, desc, path, image: `${SITE}/og/c/${c.hash}.png`, alt: desc }))
    }
    const user = path.match(/^\/u\/([^/]+)$/)
    if (user) {
      const u = await getUser(user[1]).catch(() => null)
      if (!u) return html(res, index)
      return html(res, page({ title: `${u.display_name || u.username} (@${u.username}) on Quilcast`, desc: u.profile?.bio?.text || `${u.display_name || u.username} on Farcaster`, path }))
    }
    const file = normalize(join(DIST, path))
    if (file.startsWith(DIST) && extname(file)) {
      const body = await readFile(file).catch(() => null)
      if (body) return res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' }).end(body)
      return res.writeHead(404).end()
    }
    html(res, index)
  } catch (e) {
    console.error(path, e)
    res.headersSent || html(res, index)
  }
}).listen(process.env.PORT || 3000)
