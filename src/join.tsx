import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { useEffect, useState } from 'preact/hooks'
import { account, get, go, loadMine, setAccount, settings, USER_DATA, type Account } from './api.ts'
import { balance, fidOf, register, registerPrice } from './eth.ts'
import { address, fnameProof } from './fc.ts'
import { custodyKey, ensureSigner, setUserData } from './write.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6).replace(/\.?0+$/, '')
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,15}$/

const finish = async (a: Account) => {
  const u = await get('/v2/farcaster/user', { fid: a.fid }).catch(() => null)
  setAccount({ ...account!, username: a.username || u?.user?.username, done: true })
  await loadMine()
  go('/')
}

export function Join() {
  const [mode, setMode] = useState<'pick' | 'create' | 'signin'>('pick')
  if (account && !account.done) return <Setup />
  if (mode === 'create') return <Create back={() => setMode('pick')} />
  if (mode === 'signin') return <SignIn back={() => setMode('pick')} />
  return (
    <div class="join">
      <h1>{account ? 'Add an account' : 'Join Farcaster on Hypersnap'}</h1>
      <p class="lede">Quilcast is a small, open client that reads from and posts to the Hypersnap network that Quilibrium runs. There is no server in between, and your keys stay in this browser.</p>
      <button class="choice" onClick={() => setMode('create')}>
        <b>Create a new account</b>
        <span>Pick a username and register it on Optimism for about twenty cents of ETH.</span>
      </button>
      <button class="choice" onClick={() => setMode('signin')}>
        <b>I already have an account</b>
        <span>Sign in with the recovery phrase from Warpcast, Quorum or any other Farcaster app.</span>
      </button>
    </div>
  )
}

function Create({ back }: { back: () => void }) {
  const [name, setName] = useState('')
  const [display, setDisplay] = useState('')
  const [state, setState] = useState<'' | 'checking' | 'free' | 'taken' | 'bad'>('')
  useEffect(() => {
    if (!name) return setState('')
    if (!NAME_RE.test(name)) return setState('bad')
    setState('checking')
    const t = setTimeout(() => fetch(`https://fnames.farcaster.xyz/transfers/current?name=${name}`).then((r) => setState(r.status === 404 ? 'free' : 'taken'), () => setState('')), 350)
    return () => clearTimeout(t)
  }, [name])
  const go = () => setAccount({ phrase: generateMnemonic(wordlist), username: name, display: display.trim() || name })
  return (
    <div class="join">
      <button class="link-btn" onClick={back}>← Back</button>
      <h1>Pick your name</h1>
      <label>Username
        <div class="prefix"><span>@</span><input value={name} onInput={(e) => setName(e.currentTarget.value.toLowerCase().trim())} placeholder="yourname" maxLength={16} autoFocus autocapitalize="none" spellcheck={false} /></div>
        <small class={state === 'free' ? 'ok' : state === 'taken' || state === 'bad' ? 'warn' : ''}>
          {{ '': 'Lowercase letters, numbers and dashes, up to 16 characters.', checking: 'Checking…', free: `@${name} is available.`, taken: `@${name} is already taken.`, bad: 'Use lowercase letters, numbers and dashes, starting with a letter or number.' }[state]}
        </small>
      </label>
      <label>Display name<input value={display} onInput={(e) => setDisplay(e.currentTarget.value)} placeholder="Your Name" maxLength={32} /></label>
      <button class="btn wide" disabled={state !== 'free'} onClick={go}>Continue</button>
    </div>
  )
}

function SignIn({ back }: { back: () => void }) {
  const [phrase, setPhrase] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    const p = phrase.trim().toLowerCase().split(/\s+/).join(' ')
    if (!validateMnemonic(p, wordlist)) return setErr("That doesn't look like a valid recovery phrase. Check the words and their order.")
    setBusy(true)
    setErr('')
    try {
      const fid = await fidOf(settings.rpc, address(custodyKey(p)))
      if (!fid) throw new Error('No Farcaster account belongs to this phrase.')
      const a = { phrase: p, fid, done: true }
      await ensureSigner(a)
      await finish(a)
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }
  return (
    <div class="join">
      <button class="link-btn" onClick={back}>← Back</button>
      <h1>Sign in</h1>
      <p class="lede">Enter the 12 or 24 word recovery phrase of your Farcaster account. Quilcast keeps it in this browser and uses it to add a signing key for this device.</p>
      <textarea rows={4} value={phrase} onInput={(e) => setPhrase(e.currentTarget.value)} placeholder="apple banana cherry …" autocapitalize="none" spellcheck={false} />
      {err && <p class="warn">{err}</p>}
      <button class="btn wide" disabled={busy || !phrase.trim()} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </div>
  )
}

// Funding, registration and first-time setup. Every step is re-derived from the
// chain and the node, so a reload resumes wherever it stopped.
function Setup() {
  const a = account!
  const custody = custodyKey(a.phrase)
  const addr = address(custody)
  const [need, setNeed] = useState<bigint | null>(null)
  const [bal, setBal] = useState<bigint | null>(null)
  const [step, setStep] = useState(a.fid ? 'setup' : 'fund')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let live = true
    let sent = false
    ;(async () => {
      while (live && !account!.fid) {
        try {
          const fid = await fidOf(settings.rpc, addr)
          if (fid) {
            setAccount({ ...account!, fid })
            break
          }
          const [p, b] = await Promise.all([registerPrice(settings.rpc), balance(settings.rpc, addr)])
          const want = (p * 102n) / 100n
          setNeed(want + 10n ** 13n)
          setBal(b)
          if (b >= want + 10n ** 13n && !sent) {
            setStep('register')
            await register(settings.rpc, custody, want)
            sent = true
          }
        } catch (e: any) {
          setErr(e.message)
        }
        await sleep(4000)
      }
      if (!live) return
      setStep('setup')
      setErr('')
      // the node needs to see the on-chain registration before it accepts a signer
      for (let i = 0; live; i++) {
        try {
          const acc = account!
          if (!acc.signer) await ensureSigner(acc)
          if (acc.username && !(await get('/v2/farcaster/user', { fid: acc.fid }).then((r) => r.user.username === acc.username, () => false))) {
            const proof = await fetch(`https://fnames.farcaster.xyz/transfers/current?name=${acc.username}`).then((r) => r.json())
            if (!proof.transfer || proof.transfer.to !== acc.fid) {
              const timestamp = Math.floor(Date.now() / 1000)
              const r = await fetch('https://fnames.farcaster.xyz/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: acc.username, from: 0, to: acc.fid, fid: acc.fid, timestamp, ...fnameProof(acc.username, timestamp, custody) }) })
              if (!r.ok) throw new Error(`Couldn't claim @${acc.username}: ${(await r.json().catch(() => ({}))).code || r.status}`)
            }
            await setUserData(USER_DATA.USERNAME, acc.username)
            if (acc.display) await setUserData(USER_DATA.DISPLAY, acc.display)
          }
          await finish(acc)
          return
        } catch (e: any) {
          // early attempts fail until the node indexes the new fid and fname, so stay quiet for a bit
          if (i > 6) setErr(e.message)
          await sleep(5000)
        }
      }
    })()
    return () => void (live = false)
  }, [])

  const copy = (s: string) => navigator.clipboard.writeText(s)
  return (
    <div class="join">
      <h1>{step === 'fund' ? `Fund @${a.username}` : 'Setting up your account'}</h1>
      {step === 'fund' && (
        <>
          <section class="card">
            <h2>1. Save your recovery phrase</h2>
            <p class="muted">These words are your account. Quilcast keeps them in this browser only, so write them down somewhere safe. They also work in Quorum and Warpcast.</p>
            <code class="phrase">{a.phrase}</code>
            <label class="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} /> I saved my recovery phrase</label>
          </section>
          <section class={`card${saved ? '' : ' dim'}`}>
            <h2>2. Send ETH on Optimism</h2>
            <p class="muted">Registering a Farcaster ID costs a small fee paid on the Optimism network, which includes a year of storage. Send at least the amount below to your new address from any wallet or exchange that supports Optimism.</p>
            <div class="kv"><span>Amount</span><b>{need === null ? '…' : `${eth(need)} ETH`}</b>{need !== null && <button class="link-btn" onClick={() => copy(eth(need))}>Copy</button>}</div>
            <div class="kv"><span>Address</span><code>{addr}</code><button class="link-btn" onClick={() => copy(addr)}>Copy</button></div>
            <div class="kv"><span>Network</span><b>Optimism (OP Mainnet)</b></div>
            {need !== null && <a class="btn ghost wide" href={`ethereum:${addr}@10?value=${need}`}>Open in a wallet app</a>}
            <p class="waiting"><span class="pulse" /> {bal === null ? 'Checking balance…' : `Balance ${eth(bal)} ETH. Waiting for funds…`}</p>
          </section>
        </>
      )}
      {step !== 'fund' && (
        <section class="card">
          <ol class="steps">
            <li class={step === 'register' ? 'now' : 'done'}>Registering your Farcaster ID on Optimism</li>
            <li class={step === 'setup' ? 'now' : ''}>Adding a signing key for this browser and claiming @{a.username}</li>
          </ol>
          <p class="muted">This usually takes under a minute. You can keep this tab open or come back later, and Quilcast will pick up where it left off.</p>
        </section>
      )}
      {err && <p class="warn">{err}</p>}
      {step === 'fund' && bal === 0n && <button class="link-btn danger" onClick={() => setAccount(null)}>Start over</button>}
    </div>
  )
}
