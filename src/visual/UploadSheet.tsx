import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, RotateCcw, X } from 'lucide-react'
import { Sheet } from '@/components/Sheet'
import { Button } from '@/components/ui'
import { prepareImage, validateAvatarFile, MEDIA_MAX_UPLOAD_BYTES } from '@/lib/image'
import { errorMessage, supabase } from '@/lib/supabase'
import type { VisualKind } from './types'

type Upload = { id: string; file: File; preview: string; state: 'waiting' | 'saving' | 'done' | 'failed' | 'cancelled'; error?: string; path?: string; thumb?: string; uploaded?: boolean; thumbUploaded?: boolean }
export function UploadSheet({ kind, householdId, roomId, onClose, onSaved }: { kind: VisualKind; householdId: string; roomId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [busy, setBusy] = useState(false)
  const queue = useRef<Upload[]>([])
  const running = useRef(false)
  const cancelled = useRef(false)
  const mounted = useRef(true)
  const input = useRef<HTMLInputElement>(null)
  const previews = useRef<string[]>([])
  const paint = () => { if (mounted.current) setUploads(queue.current.map(x => ({ ...x }))) }
  useEffect(() => { mounted.current = true; const urls = previews.current; return () => { mounted.current = false; cancelled.current = true; urls.forEach(url => URL.revokeObjectURL(url)) } }, [])
  const run = async () => {
    if (running.current) return
    running.current = true; cancelled.current = false; setBusy(true)
    for (const entry of queue.current) {
      if (cancelled.current) break
      if (entry.state !== 'waiting') continue
      entry.state = 'saving'; paint()
      try {
        if (!navigator.onLine) throw new Error('You’re offline. Reconnect, then retry.')
        const invalid = validateAvatarFile(entry.file)
        if (invalid) throw new Error(invalid)
        let main = await prepareImage(entry.file, 1600)
        if (main.blob.size > MEDIA_MAX_UPLOAD_BYTES) main = await prepareImage(entry.file, 1000)
        if (main.blob.size > MEDIA_MAX_UPLOAD_BYTES) throw new Error('This photo is too large. Try a smaller image.')
        const thumb = await prepareImage(entry.file, 480)
        if (!entry.path) {
          const reserved = await supabase.rpc('reserve_media_upload', { p_household: householdId, p_kind: 'visual', p_ext: main.ext })
          if (reserved.error) throw reserved.error
          const data = reserved.data as { path: string; thumbnail_path: string }
          entry.path = data.path; entry.thumb = data.thumbnail_path
        }
        if (!entry.uploaded) {
          const r = await supabase.storage.from('household-media').upload(entry.path, main.blob, { contentType: main.blob.type })
          if (r.error && !/already exists|duplicate/i.test(r.error.message)) throw r.error
          entry.uploaded = true
        }
        if (!entry.thumbUploaded) {
          const r = await supabase.storage.from('household-media').upload(entry.thumb!, thumb.blob, { contentType: thumb.blob.type })
          if (r.error && !/already exists|duplicate/i.test(r.error.message)) throw r.error
          entry.thumbUploaded = true
        }
        if (cancelled.current) { entry.state = 'cancelled'; paint(); break }
        const saved = await supabase.from('room_visuals').insert({ id: entry.id, household_id: householdId, room_id: roomId, kind, photo_path: entry.path, thumbnail_path: entry.thumb, aspect_ratio: main.width / main.height, sort_order: Date.now() })
        if (saved.error) {
          // A retry after a lost response must not create a second card.
          const existing = await supabase.from('room_visuals').select('id').eq('id', entry.id).maybeSingle()
          if (!existing.data) throw saved.error
        }
        entry.state = 'done'
      } catch (e) { entry.state = 'failed'; entry.error = errorMessage(e) }
      paint()
    }
    if (cancelled.current) queue.current.forEach(x => { if (x.state === 'waiting') x.state = 'cancelled' })
    running.current = false
    if (mounted.current) { setBusy(false); paint(); await onSaved() }
  }
  const add = (files: FileList | null) => {
    if (!files) return
    queue.current.push(...Array.from(files).slice(0, 20).map(file => { const preview = URL.createObjectURL(file); previews.current.push(preview); return { id: crypto.randomUUID(), file, preview, state: 'waiting' as const } }))
    paint(); void run()
  }
  return <Sheet open onClose={onClose} busy={busy} title={kind === 'photo' ? 'Add flat photos' : 'Add inspiration'}>
    <p className="text-ink-2 mb-4">Pick a few favourites. Add details later, if you like.</p>
    <input ref={input} className="sr-only" aria-label="Choose photos" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={e => { add(e.target.files); e.target.value = '' }} />
    <Button variant="ink" block icon={<ImagePlus size={20} />} disabled={busy} onClick={() => input.current?.click()}>Choose photos</Button>
    <p className="text-ink-3 mt-2 text-sm">Up to 20 at a time · JPEG, PNG or WebP</p>
    <ul className="mt-5 space-y-3" aria-live="polite">{uploads.map(x => <li key={x.id} className="flex items-center gap-3">
      <img src={x.preview} alt="" className="h-16 w-16 rounded-xl object-cover" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{x.file.name}</p><p className="text-ink-2 text-sm">{x.state === 'saving' ? 'Adding…' : x.state === 'done' ? 'Added' : x.state === 'failed' ? x.error : x.state === 'cancelled' ? 'Cancelled' : 'Waiting'}</p></div>
      {x.state === 'done' && <Check aria-label="Added" size={20} />}
      {(x.state === 'failed' || x.state === 'cancelled') && <button className="pressable flex h-11 w-11 items-center justify-center" disabled={busy} aria-label={`Retry ${x.file.name}`} onClick={() => { const entry = queue.current.find(e => e.id === x.id); if (entry) entry.state = 'waiting'; void run() }}><RotateCcw size={20} /></button>}
    </li>)}</ul>
    <div className="mt-6">{busy ? <Button variant="secondary" block icon={<X size={18} />} onClick={() => { cancelled.current = true }}>Stop remaining uploads</Button> : <Button block onClick={onClose}>Done</Button>}</div>
  </Sheet>
}
