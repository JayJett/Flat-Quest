import { useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Button, Field } from '@/components/ui'
import { supabase, errorMessage } from '@/lib/supabase'
import { MediaImage } from './MediaImage'
import type { Transformation, Visual } from './types'

export function TransformationSheet({ photos, householdId, roomId, existing, onClose, onSaved }: { photos: Visual[]; householdId: string; roomId: string; existing?: Transformation; onClose: () => void; onSaved: () => Promise<void> }) {
  const [before, setBefore] = useState(existing?.before_id ?? '')
  const [after, setAfter] = useState(existing?.after_id ?? '')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!navigator.onLine) throw new Error('Reconnect before saving. Your choices are still here.')
      if (!before || !after || before === after) throw new Error('Choose two different photos.')
      const patch = { before_id: before, after_id: after, title: title.trim() || null, notes: notes.trim() || null }
      const r = existing ? await supabase.from('room_transformations').update(patch).eq('id', existing.id).eq('updated_at', existing.updated_at).select().maybeSingle()
        : await supabase.from('room_transformations').insert({ ...patch, household_id: householdId, room_id: roomId }).select().single()
      if (r.error) throw r.error
      if (!r.data) throw new Error('A flatmate changed this. Reopen it to see their changes.')
      await onSaved(); onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Sheet open onClose={onClose} busy={busy} title={existing ? 'Edit transformation' : 'Look how far we’ve come'}>
    <p className="text-ink-2 mb-4">Pick a before and an after. Similar angles work beautifully.</p>
    {(['Before','After'] as const).map(label => <fieldset className="mb-5" key={label}><legend className="mb-2 font-bold">{label}</legend><div className="flex gap-2 overflow-x-auto pb-2">{photos.map((p, i) => <button key={p.id} aria-label={`${label}: ${p.title || `photo ${i + 1}`}`} aria-pressed={(label === 'Before' ? before : after) === p.id} className={`pressable w-24 shrink-0 overflow-hidden rounded-xl border-2 ${(label === 'Before' ? before : after) === p.id ? 'border-accent' : 'border-transparent'}`} onClick={() => label === 'Before' ? setBefore(p.id) : setAfter(p.id)}><MediaImage path={p.thumbnail_path} className="aspect-square h-24 w-full object-cover" /></button>)}</div></fieldset>)}
    <div className="space-y-4"><Field label="Title (optional)"><input className="field" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Notes (optional)"><textarea className="field" maxLength={1000} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field></div>
    {error && <p role="alert" className="text-danger mt-4 text-sm">{error}</p>}
    <Button className="mt-5" block loading={busy} disabled={!before || !after || before === after} onClick={() => void save()}>Save transformation</Button>
  </Sheet>
}

