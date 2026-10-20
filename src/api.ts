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

export type Account = { phrase: string; fid?: number; username?: string; display?: string; signer?: string; signerAt?: number; nonce?: number; done?: boolean }
export let account: Account | null = localStorage.getItem('quilcast:account') ? load<Account>('quilcast:account', { phrase: '' }) : null
export const setAccount = (a: Account | null) => {
  account = a
  a ? save('quilcast:account', a) : localStorage.removeItem('quilcast:account')
  dispatchEvent(new Event('account'))
}

export const USER_DATA = { PFP: 1, DISPLAY: 2, BIO: 3, URL: 5, USERNAME: 6 }

export async function get<T = any>(path: string, q: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][])
  const r = await fetch(`${settings.node}${path}?${qs}`)
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `HTTP ${r.status}`)
  return r.json()
}

export const fidByName = async (name: string) => (await get('/v2/farcaster/user/by-username', { username: name }).catch(() => null))?.user?.fid as number | undefined

// what the signed-in user already liked/recast, so buttons render filled
export const mine = { likes: new Set<string>(), recasts: new Set<string>() }
const norm = (h: string) => h.replace(/^0x/, '').toLowerCase()
export async function loadMine() {
  if (!account?.fid) return
  for (const [type, set] of [['Like', mine.likes], ['Recast', mine.recasts]] as const) {
    const r = await get('/v1/reactionsByFid', { fid: account.fid, reaction_type: type, pageSize: 1000, reverse: 'true' }).catch(() => ({ messages: [] }))
    for (const m of r.messages) m.data.reactionBody.targetCastId && set.add(norm(m.data.reactionBody.targetCastId.hash))
  }
}
export const isFollowing = async (target: number) =>
  !!account?.fid && (await fetch(`${settings.node}/v1/linkById?fid=${account.fid}&target_fid=${target}&link_type=follow`)).ok
