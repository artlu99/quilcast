import { useEffect, useRef, useState } from 'preact/hooks'
import { account, get, go, users, type Cast } from './api.ts'
import { Avatar, channelUrl, handle, Icon, P, QuoteCard, toast, w } from './ui.tsx'

type Attachment = { id: number; preview: string; video: boolean; url?: string; err?: string }
const bytes = (s: string) => new TextEncoder().encode(s).length

// photos are re-encoded (≤2048px JPEG) so EXIF/GPS never leaves the device; GIFs and videos go as-is
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file
  const img = await createImageBitmap(file)
  const k = Math.min(1, 2048 / Math.max(img.width, img.height))
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) })
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', 0.88))
}

function ChannelPicker({ value, set }: { value?: string; set: (v?: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [list, setList] = useState<{ id: string; member_count?: number }[]>([])
  useEffect(() => {
    if (!q.trim()) return setList([])
    const t = setTimeout(() => get('/v2/farcaster/channel/search', { q: q.trim(), limit: 8 }).then((r) => setList(r.channels), () => {}), 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <span class="wrap-menu">
      <button class={`chip${value ? ' on' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox"><Icon d={P.hash} size={14} />{value ? `/${value}` : 'Channel'}</button>
      {open && (
        <div class="menu picker">
          <input autoFocus value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search channels" aria-label="Search channels" />
          {value && <button onClick={() => (set(undefined), setOpen(false))}>No channel</button>}
          {list.map((c) => <button onClick={() => (set(c.id), setOpen(false), setQ(''))}>/{c.id}<small>{c.member_count ?? ''}</small></button>)}
        </div>
      )}
    </span>
  )
}

export function Composer({ parent, quote, channel: initial, onClose }: { parent?: Cast; quote?: Cast; channel?: string; onClose: () => void }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [channel, setChannel] = useState(initial)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const left = 320 - bytes(text)
  const slots = 2 - (quote ? 1 : 0)
  const uploading = files.some((f) => !f.url && !f.err)
  const ready = (text.trim() || files.length || quote) && left >= 0 && !uploading && !files.some((f) => f.err)

  const attach = async (list: FileList | null) => {
    for (const file of [...(list || [])].slice(0, slots - files.length)) {
      const a: Attachment = { id: Math.random(), preview: URL.createObjectURL(file), video: file.type.startsWith('video/') }
      const update = (p: Partial<Attachment>) => setFiles((fs) => fs.map((f) => (f.id === a.id ? { ...f, ...p } : f)))
      setFiles((fs) => [...fs, a])
      shrink(file)
        .then(async (blob) => (await w()).upload(blob))
        .then((url) => update({ url }), (e) => update({ err: e.message }))
    }
  }
  const send = async () => {
    setBusy(true)
    try {
      const hash = await (await w()).post(text.trim(), {
        parent: parent && { fid: parent.author.fid, hash: parent.hash },
        channel: !parent && channel ? channelUrl(channel) : undefined,
        quote: quote && { fid: quote.author.fid, hash: quote.hash },
        media: files.map((f) => f.url!),
      })
      onClose()
      toast(parent ? 'Reply sent' : 'Cast sent')
      go(`/c/${hash}`)
    } catch (e: any) {
      toast(e.message)
      setBusy(false)
    }
  }
  return (
    <div class="modal" onClick={onClose}>
      <div class="sheet" role="dialog" aria-label={parent ? 'Reply' : quote ? 'Quote cast' : 'New cast'} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => (e.key === 'Escape' && onClose(), (e.metaKey || e.ctrlKey) && e.key === 'Enter' && ready && send())}>
        <div class="sheet-top">
          <button class="link-btn" onClick={onClose}>Cancel</button>
          <button class="btn" disabled={busy || !ready} onClick={send}>{busy ? 'Sending…' : parent ? 'Reply' : 'Cast'}</button>
        </div>
        {parent && (
          <div class="ctx">
            <Avatar u={parent.author} size={28} link={false} />
            <div><b>{parent.author.display_name || handle(parent.author)}</b> <span class="handle">@{handle(parent.author)}</span><p>{parent.text.slice(0, 200)}</p></div>
          </div>
        )}
        <div class="editor">
          {account && <Avatar u={users.get(account.fid!) || { fid: account.fid!, username: account.username }} size={36} link={false} />}
          <textarea ref={ref} value={text} rows={3} placeholder={parent ? `Reply to @${handle(parent.author)}` : quote ? 'Add a comment' : "What's happening?"}
            onInput={(e) => (setText(e.currentTarget.value), (e.currentTarget.style.height = 'auto'), (e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'))}
            onPaste={(e) => e.clipboardData?.files.length && (e.preventDefault(), attach(e.clipboardData.files))} />
        </div>
        {files.length > 0 && (
          <div class="attachments">
            {files.map((f) => (
              <div class={`att${f.err ? ' bad' : ''}`}>
                {f.video ? <video src={f.preview} muted /> : <img src={f.preview} alt="" />}
                {!f.url && !f.err && <span class="att-busy"><span class="spinner small" /></span>}
                {f.err && <span class="att-err">{f.err}</span>}
                <button class="att-x" aria-label="Remove" onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><Icon d={P.x} size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {quote && <QuoteCard c={quote} />}
        <div class="toolbar">
          <input ref={pick} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden onChange={(e) => (attach(e.currentTarget.files), (e.currentTarget.value = ''))} />
          <button class="icon-btn" aria-label="Add photo or video" disabled={files.length >= slots} onClick={() => pick.current?.click()}><Icon d={P.image} /></button>
          {!parent && <ChannelPicker value={channel} set={setChannel} />}
          <span class={`count${left < 20 ? ' warn' : ''}`}>{left}</span>
        </div>
      </div>
    </div>
  )
}
