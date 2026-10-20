// Hypersnap reads plus the locally stored account. Writes live in write.ts,
// loaded on demand so readers never download the crypto.

const load = <T,>(k: string, d: T): T => {
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }
  } catch {
    return d
  }
}
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))

export const settings = load('quilcast:settings', { node: 'https://haatz.quilibrium.com', rpc: 'https://mainnet.optimism.io', theme: 'system' })
export const saveSettings = () => save('quilcast:settings', settings)

export type Account = { phrase: string; fid?: number; username?: string; display?: string; signer?: string; signerAt?: number; nonce?: number; scopes?: number; done?: boolean }
const list = (k: string): Account[] => {
  try {
    return JSON.parse(localStorage.getItem(k) || '[]')
  } catch {
    return []
  }
}
// every account this browser holds; `account` is the selected one (keyed by phrase)
export let accounts = list('quilcast:accounts')
const legacy = localStorage.getItem('quilcast:account')
if (legacy && !accounts.length) accounts = [load<Account>('quilcast:account', { phrase: '' })]
export let account: Account | null = accounts.find((a) => a.phrase === localStorage.getItem('quilcast:current')) || accounts[0] || null

/** Save `a` (added or updated, matched by phrase) and select it; `null` removes the selected account. */
export const setAccount = (a: Account | null) => {
  // re-read first: another tab may have added or removed accounts since this one loaded
  const fresh = list('quilcast:accounts')
  if (fresh.length || !legacy) accounts = fresh
  if (a) {
    const i = accounts.findIndex((x) => x.phrase === a.phrase)
    i < 0 ? accounts.push(a) : (accounts[i] = a)
  } else accounts = accounts.filter((x) => x.phrase !== account?.phrase)
  account = a || accounts.find((x) => x.done) || accounts[0] || null
  save('quilcast:accounts', accounts)
  account ? localStorage.setItem('quilcast:current', account.phrase) : localStorage.removeItem('quilcast:current')
  localStorage.removeItem('quilcast:account')
  dispatchEvent(new Event('account'))
}
// another tab changed the accounts: take its list, and start over if it signed this account out
addEventListener('storage', (e) => {
  if (e.key !== 'quilcast:accounts') return
  accounts = list('quilcast:accounts')
  const mine = account && accounts.find((x) => x.phrase === account!.phrase)
  if (account && !mine) return location.assign('/')
  account = mine || null
  dispatchEvent(new Event('account'))
})
// a full reload is the simplest way to drop the previous account's feeds and likes
export const switchAccount = (a: Account) => (localStorage.setItem('quilcast:current', a.phrase), location.assign('/'))

let depth = 0
export const go = (path: string) => {
  depth++
  history.pushState(null, '', path)
  dispatchEvent(new Event('popstate'))
}
// leave the app only if we arrived on this page from outside it
export const back = () => (depth > 0 ? (depth--, history.back()) : go('/'))

// links as people write them: with a scheme, or a bare domain on a common TLD ("quilcast.com/x")
const TLDS = 'com|org|net|xyz|io|app|dev|ai|co|me|gg|so|sh|fm|tv|art|fun|lol|wtf|info|page|site|tech|link|to|us|uk|de|fr|eu|ca|ly|cc|club|blog|news|social|world|live|studio|games|finance|money|cash|network|systems|build|tools'
export const LINK_RE = new RegExp(`https?:\\/\\/[^\\s<>"]+[^\\s<>".,;:!?)\\]'"]|(?<![@\\w.\\/-])(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?:\\/[^\\s<>"]*[^\\s<>".,;:!?)\\]'"])?`, 'gi')
export const toUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`)

// URLs from casts, profiles and link previews are untrusted: Snapchain only checks their length, so
// a "link" can be javascript:… or point at the viewer's own network. Only public http(s) gets through.
const LOCAL = /^(localhost|.*\.localhost|.*\.local|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[)/i
export function safeUrl(u?: string | null) {
  if (typeof u !== 'string') return
  try {
    const x = new URL(u)
    if (/^https?:$/.test(x.protocol) && !x.username && !x.password && !LOCAL.test(x.hostname)) return x.href
  } catch {}
}

export const USER_DATA = { PFP: 1, DISPLAY: 2, BIO: 3, URL: 5, USERNAME: 6 }

export async function get<T = any>(path: string, q: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][])
  const r = await fetch(`${settings.node}${path}?${qs}`)
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `HTTP ${r.status}`)
  return r.json()
}

export const fidByName = async (name: string) => (await get('/v2/farcaster/user/by-username', { username: name }).catch(() => null))?.user?.fid as number | undefined

// what the signed-in user recently liked/recast, so buttons render filled; `mineVersion` bumps when it loads
export const mine = { likes: new Set<string>(), recasts: new Set<string>() }
export let mineVersion = 0
const norm = (h: string) => h.replace(/^0x/, '').toLowerCase()
export async function loadMine() {
  const fid = account?.fid
  if (!fid) return
  await Promise.all(
    ([['Like', mine.likes], ['Recast', mine.recasts]] as const).map(async ([type, set]) => {
      const r = await get('/v1/reactionsByFid', { fid, reaction_type: type, pageSize: 200, reverse: 'true' }).catch(() => ({ messages: [] }))
      for (const m of r.messages) m.data?.reactionBody?.targetCastId && set.add(norm(m.data.reactionBody.targetCastId.hash))
    }),
  )
  mineVersion++
}

/** The FID whose custody address this is: Hypersnap first (fast), Optimism when the node doesn't know it.
 *  A wrong FID can't sign in anyway: the network only takes a key signed by that FID's custody address. */
export async function fidForAddress(addr: string, rpcLookup: () => Promise<number>) {
  const u = (await get('/v2/farcaster/user/custody-address', { custody_address: addr }).catch(() => null))?.user
  return typeof u?.fid === 'number' && u.fid > 0 && String(u.custody_address).toLowerCase() === addr.toLowerCase() ? u.fid : rpcLookup()
}
export const isFollowing = async (target: number) =>
  !!account?.fid && (await fetch(`${settings.node}/v1/linkById?fid=${account.fid}&target_fid=${target}&link_type=follow`)).ok

export type User = { fid: number; username?: string; display_name?: string; pfp_url?: string; profile?: { bio?: { text?: string } }; follower_count?: number; following_count?: number }
export type Cast = {
  hash: string; text: string; timestamp: string; author: User; parent_hash?: string | null; parent_url?: string | null; parent_author?: { fid: number | null }
  embeds: { url?: string; cast_id?: { fid: number; hash: string } }[]
  reactions: { likes_count: number; recasts_count: number }; replies: { count: number }; direct_replies?: Cast[]
  mentioned_profiles?: User[]; mentioned_profiles_ranges?: { start: number; end: number }[]
}

/** Hypersnap leaves mentions out of `text` and gives UTF-8 byte offsets; put "@name" back in. */
export function castText(c: Cast) {
  const ranges = c.mentioned_profiles_ranges || []
  if (!ranges.some((r) => r.start === r.end)) return c.text
  let bytes = new TextEncoder().encode(c.text)
  const enc = new TextEncoder()
  // insert from the end so earlier offsets stay valid
  ranges
    .map((r, i) => ({ ...r, u: c.mentioned_profiles?.[i] }))
    .filter((r) => r.start === r.end && r.u?.username)
    .sort((a, b) => b.start - a.start)
    .forEach((r) => {
      const ins = enc.encode('@' + r.u!.username)
      const out = new Uint8Array(bytes.length + ins.length)
      out.set(bytes.subarray(0, r.start))
      out.set(ins, r.start)
      out.set(bytes.subarray(r.start), r.start + ins.length)
      bytes = out
    })
  return new TextDecoder().decode(bytes)
}

// authors we've seen, so replies can say who they reply to
export const users = new Map<number, User>()
/** Casts this tab just sent, shown as "Posting…" until the node has indexed them. */
export const posting = new Map<string, Cast>()
export async function hydrateParents(casts: Cast[]) {
  for (const c of casts) users.set(c.author.fid, c.author)
  const missing = [...new Set(casts.map((c) => c.parent_author?.fid).filter((f): f is number => !!f && !users.has(f)))]
  if (missing.length) {
    const r = await get('/v2/farcaster/user/bulk', { fids: missing.slice(0, 100).join(',') }).catch(() => ({ users: [] }))
    for (const u of r.users) users.set(u.fid, u)
  }
  return casts
}
