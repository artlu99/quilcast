// Pure helpers that the app and the server (which imports this file as TypeScript) both use.

export const isImg = (u: string) => /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(u) || /imagedelivery\.net|i\.imgur\.com/.test(u)
export const isVid = (u: string) => /\.(m3u8|mp4|webm|mov)(\?|$)/i.test(u)

/** Farcaster's image CDN resizes on request (`w=96`, `anim=false,w=144`…), so nothing needs the full original. */
export const sized = (u: string, variant: string) => u.replace(/^(https:\/\/imagedelivery\.net\/[\w-]+\/[\w-]+)\/original$/, `$1/${variant}`)

export const n = (x = 0) => (x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e4 ? Math.round(x / 1e3) + 'K' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(x))

type Mentioned = { text?: string; mentioned_profiles?: { username?: string }[]; mentioned_profiles_ranges?: { start: number; end: number }[] }
/** Hypersnap leaves mentions out of `text` and gives their UTF-8 byte offsets; put "@name" back in. */
export function castText(c: Mentioned) {
  const bytes = new TextEncoder().encode(c.text || '')
  const at = (c.mentioned_profiles_ranges || [])
    .map((r, i) => ({ at: r.start, name: r.start === r.end && c.mentioned_profiles?.[i]?.username }))
    .filter((r) => r.name && r.at <= bytes.length)
    .sort((a, b) => a.at - b.at)
  if (!at.length) return c.text || ''
  const dec = new TextDecoder()
  let out = ''
  let last = 0
  for (const r of at) (out += dec.decode(bytes.subarray(last, r.at)) + '@' + r.name), (last = r.at)
  return out + dec.decode(bytes.subarray(last))
}

export const LOGO = 'M23.5 6.5c-6 .5-10.5 4.8-12 11.5l-1.6 7.5 1.4.4 2-5.2c4.6-.4 8.4-3.4 9.6-8.2-1.3.6-2.7.9-4 .9 1.9-1.2 3.6-3.6 4.6-6.9z'
export const X_LOGO = 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.19L2 3h6.33l4.37 5.77zm-1.08 16.17h1.7L7.4 4.74H5.58z'
