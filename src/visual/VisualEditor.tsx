import { useId, useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Button, Field } from '@/components/ui'
import { supabase, errorMessage } from '@/lib/supabase'
import { safeSource, type Visual } from './types'

export function VisualEditor({ visual, householdId, roomId, onClose, onSaved }: { visual: Visual | null; householdId: string; roomId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const id = useId()
  const [title, setTitle] = useState(visual?.title ?? '')
  const [notes, setNotes] = useState(visual?.notes ?? '')
  const [url, setUrl] = useState(visual?.source_url ?? '')
  const [date, setDate] = useState(visual?.taken_on ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!navigator.onLine) throw new Error('Reconnect before saving. Your details are still here.')
      const source = safeSource(url)
      if (!visual?.photo_path && !source) throw new Error('Add a link to save this idea.')
      const patch = { title: title.trim() || null, notes: notes.trim() || null, source_url: source, taken_on: date || null }
      const r = visual ? await supabase.from('room_visuals').update(patch).eq('id', visual.id).eq('updated_at', visual.updated_at).select().maybeSingle()
        : await supabase.from('room_visuals').insert({ ...patch, household_id: householdId, room_id: roomId, kind: 'inspiration', sort_order: Date.now() }).select().single()
      if (r.error) throw r.error
      if (!r.data) throw new Error('A flatmate changed this. Your draft is here; reopen to see their changes.')
      await onSaved(); onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Sheet open onClose={onClose} busy={busy} title={visual ? 'A little more detail' : 'Save an inspiration link'}>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
      <Field label="Title (optional)" htmlFor={`${id}-title`}><input id={`${id}-title`} className="field" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field htmlFor={`${id}-url`} label={visual?.photo_path ? 'Link (optional)' : 'Link'}><input id={`${id}-url`} className="field" type="url" maxLength={1000} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></Field>
      {visual?.kind === 'photo' && <Field label="Date taken (optional)" htmlFor={`${id}-date`}><input id={`${id}-date`} className="field" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>}
      <Field label="Notes (optional)" htmlFor={`${id}-notes`}><textarea id={`${id}-notes`} className="field" maxLength={1000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      <Button type="submit" block loading={busy}>Save</Button>
    </form>
  </Sheet>
}
