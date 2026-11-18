import { CalendarClock, Check, DoorOpen, Link2, Pencil, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Switch } from '@/components/ItemSheet'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, Field } from '@/components/ui'
import { absoluteFlatLink } from '@/household/flatLinks'
import { useHousehold } from '@/household/HouseholdProvider'
import type { AppointmentRow } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'
import { dayLabel, localParts, mondayOf, timeLabel, zoneAbbreviation, zonedInstant, type CivilDate } from './dates'

export const TITLE_MAX = 80
export const NOTES_MAX = 500

export type SheetTarget = { mode: 'new'; date: CivilDate } | { mode: 'view'; id: string }

type Draft = { id: string; title: string; notes: string; roomId: string; date: CivilDate; allDay: boolean; start: string; end: string; needsCover: boolean }

function draftFrom(a: AppointmentRow, zone: string): Draft {
  const start = a.starts_at ? localParts(a.starts_at, zone) : null
  return {
    id: a.id, title: a.title, notes: a.notes ?? '', roomId: a.room_id ?? '', date: start?.date ?? a.scheduled_on, allDay: a.all_day,
    start: start?.time ?? '09:00', end: a.ends_at ? localParts(a.ends_at, zone).time : '10:00', needsCover: a.needs_cover,
  }
}
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, '0').slice(-8)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`)

/** When the appointment is, in the flat's zone (with an end date if it ends on another day). */
export function whenLabel(a: AppointmentRow, zone: string) {
  if (a.all_day || !a.starts_at || !a.ends_at) return `${dayLabel(a.scheduled_on, 'long')} · All day`
  const s = localParts(a.starts_at, zone), e = localParts(a.ends_at, zone)
  const end = e.date !== s.date ? `${dayLabel(e.date)} ${timeLabel(a.ends_at, zone)}` : timeLabel(a.ends_at, zone)
  return `${dayLabel(s.date, 'long')} · ${timeLabel(a.starts_at, zone)} – ${end}`
}

function friendly(error: { code?: string; message?: string } | null) {
  if (!error) return { message: 'Something went wrong. Please try again.', conflict: false, gone: false, network: false }
  const network = !error.code && /fetch|network|load failed/i.test(error.message ?? '')
  return {
    message: ['FQ409', 'P0002', '42501', '23514', '22008', '23505'].includes(error.code ?? '') ? error.message ?? '' : errorMessage(error),
    conflict: error.code === 'FQ409', gone: error.code === 'P0002', network,
  }
}

export function AppointmentSheet({ target, zone, rows, onClose, onSaved }: {
  target: SheetTarget | null
  zone: string
  rows: ReadonlyMap<string, AppointmentRow>
  onClose: () => void
  /** A server-confirmed row: the agenda shows it straight away. */
  onSaved: (row: AppointmentRow) => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const row = target?.mode === 'view' ? rows.get(target.id) ?? null : null
  const open = target !== null
  const close = () => { setEditing(false); onClose() }
  const title = target?.mode === 'new' ? 'New appointment' : editing ? 'Edit appointment' : 'Appointment'
  return (
    <Sheet open={open} onClose={close} title={title} busy={busy}>
      {target?.mode === 'new' && <AppointmentForm key={`new-${target.date}`} zone={zone} initial={null} date={target.date} onBusy={setBusy} onDone={(r) => { onSaved(r); close() }} onCancel={close} />}
      {target?.mode === 'view' && !row && <p className="text-ink-2">This appointment was cancelled or is no longer available.</p>}
      {row && (editing
        ? <AppointmentForm key={`edit-${row.id}`} zone={zone} initial={row} date={row.scheduled_on} onBusy={setBusy} onDone={(r) => { onSaved(r); setEditing(false) }} onCancel={() => setEditing(false)} />
        : <AppointmentDetails row={row} zone={zone} onEdit={() => setEditing(true)} onBusy={setBusy} onSaved={onSaved} onCancelled={(r) => { onSaved(r); close() }} />)}
    </Sheet>
  )
}

function AppointmentDetails({ row, zone, onEdit, onBusy, onSaved, onCancelled }: {
  row: AppointmentRow; zone: string; onEdit: () => void; onBusy: (b: boolean) => void; onSaved: (r: AppointmentRow) => void; onCancelled: (r: AppointmentRow) => void
}) {
  const { user } = useAuth()
  const { household, members, memberById, rooms } = useHousehold()
  const toast = useToast()
  const [pending, setPending] = useState<'claim' | 'release' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const me = user?.id ?? ''
  const isOwner = members.some((m) => m.userId === me && m.role === 'owner')
  const canEdit = row.created_by === me || isOwner
  const host = row.host_id ? memberById.get(row.host_id) : null
  const room = rooms.find((r) => r.id === row.room_id)
  const creator = row.created_by ? memberById.get(row.created_by)?.profile.display_name : null

  const cover = async (action: 'claim' | 'release') => {
    if (!navigator.onLine) return setError('You’re offline. Reconnect to update this.')
    setPending(action); setError(null); onBusy(true)
    const { data, error: e } = await supabase.rpc('set_appointment_cover', { p_id: row.id, p_expected_revision: row.revision, p_action: action })
    setPending(null); onBusy(false)
    if (e || !data) {
      const f = friendly(e)
      setError(f.message)
      // Show the latest version so the person can see what changed.
      const { data: latest } = await supabase.from('calendar_appointments').select('*').eq('id', row.id).maybeSingle()
      if (latest) onSaved(latest)
      return
    }
    onSaved(data)
    toast.success(action === 'claim' ? 'You’re down to be home for it' : 'You’ve stepped back. It needs someone again.')
  }

  const cancel = async () => {
    setPending('cancel'); onBusy(true)
    const { data, error: e } = await supabase.rpc('cancel_appointment', { p_id: row.id, p_expected_revision: row.revision })
    setPending(null); onBusy(false); setConfirmCancel(false)
    if (e || !data) return setError(friendly(e).message)
    toast.show(`Cancelled ${row.title}`)
    onCancelled(data)
  }

  const copyLink = async () => {
    if (!household) return
    const url = absoluteFlatLink(`/calendar?week=${mondayOf(localParts(row.starts_at ?? `${row.scheduled_on}T12:00:00Z`, zone).date)}&appointment=${row.id}`, household.id)
    try { await navigator.clipboard.writeText(url); toast.success('Link copied. Only flatmates can open it.') } catch { toast.error('Couldn’t copy the link.') }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="appointment-details">
      <div>
        <p className="text-ink-2 text-[13px] font-bold tracking-wide uppercase">Appointment</p>
        <h3 className="mt-1 text-[22px] leading-tight font-bold">{row.title}</h3>
        <p className="mt-1 flex items-center gap-2 text-[16px] font-semibold"><CalendarClock size={18} aria-hidden /> {whenLabel(row, zone)}</p>
        {!row.all_day && <p className="text-ink-2 mt-0.5 text-[14px]">Times in {zone.replace(/_/g, ' ')} ({zoneAbbreviation(zone, Date.parse(row.starts_at ?? `${row.scheduled_on}T12:00:00Z`))})</p>}
        {room && <p className="text-ink-2 mt-1 text-[15px]">{room.name}</p>}
        {row.notes && <p className="mt-3 text-[15px] whitespace-pre-line">{row.notes}</p>}
        {creator && <p className="text-ink-2 mt-3 text-[13px]">Added by {creator}</p>}
      </div>

      {row.needs_cover && (
        <section aria-label="Someone home" className={`rounded-[var(--radius-card)] p-4 ${host ? 'bg-surface-2' : 'bg-accent-soft'}`} data-testid="coverage">
          {host ? (
            <p className="flex items-center gap-2 font-semibold">
              <Check size={18} strokeWidth={2.6} aria-hidden /> {host.userId === me ? 'You’ll be home for this' : `${host.profile.display_name || 'A flatmate'} will be home`}
            </p>
          ) : (
            <p className="flex items-center gap-2 font-semibold"><DoorOpen size={18} aria-hidden /> Needs someone home</p>
          )}
          {!host && (
            <Button className="mt-3" block loading={pending === 'claim'} onClick={() => void cover('claim')}>I can be home</Button>
          )}
          {host?.userId === me && (
            <Button className="mt-3" block variant="secondary" loading={pending === 'release'} onClick={() => void cover('release')}>Release coverage</Button>
          )}
        </section>
      )}

      {error && <p role="alert" className="text-danger -mt-2 text-[14px] font-medium">{error}</p>}

      <div className="flex flex-col gap-2">
        {canEdit && <Button variant="secondary" block icon={<Pencil size={18} aria-hidden />} onClick={onEdit} disabled={pending !== null}>Edit</Button>}
        <Button variant="ghost" block icon={<Link2 size={18} aria-hidden />} onClick={() => void copyLink()}>Copy link</Button>
        {canEdit && <Button variant="ghost" block icon={<X size={18} aria-hidden />} className="text-danger" onClick={() => setConfirmCancel(true)} disabled={pending !== null}>Cancel appointment</Button>}
      </div>
      <ConfirmSheet
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this appointment?"
        body={host ? `It leaves the calendar for everyone, and ${host.userId === me ? 'you' : host.profile.display_name || 'your flatmate'} will no longer be expected home.` : 'It leaves the calendar for everyone.'}
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        busy={pending === 'cancel'}
        onConfirm={() => void cancel()}
        danger
      />
    </div>
  )
}

function AppointmentForm({ zone, initial, date, onBusy, onDone, onCancel }: {
  zone: string; initial: AppointmentRow | null; date: CivilDate; onBusy: (b: boolean) => void; onDone: (r: AppointmentRow) => void; onCancel: () => void
}) {
  const { household, rooms, memberById } = useHousehold()
  const toast = useToast()
  const ids = { title: useId(), date: useId(), start: useId(), end: useId(), room: useId(), notes: useId() }
  // One id per draft: a retry after an unclear response can never create a second appointment.
  const [draft, setDraft] = useState<Draft>(() => initial ? draftFrom(initial, zone)
    : { id: newId(), title: '', notes: '', roomId: '', date, allDay: false, start: '09:00', end: '10:00', needsCover: false })
  const [base, setBase] = useState<AppointmentRow | null>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<AppointmentRow | null>(null)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const set = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null) }

  const validate = (): string | null => {
    if (!draft.title.trim()) return 'Give it a short title.'
    if (draft.title.trim().length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`
    if (!draft.date) return 'Choose a day.'
    if (!draft.allDay) {
      if (draft.end <= draft.start) return 'The end time must be after the start, on the same day.'
      for (const [label, t] of [['start', draft.start], ['end', draft.end]] as const) {
        const r = zonedInstant(draft.date, t, zone)
        if (!r.ok) return r.reason === 'nonexistent' ? `The ${label} time doesn’t exist that day (the clocks go forward). Choose another time.`
          : r.reason === 'ambiguous' ? `The ${label} time happens twice that day (the clocks go back). Choose another time.` : `Check the ${label} time.`
      }
    }
    return null
  }

  /** Moving the slot (or no longer needing anyone) reopens coverage; the person confirms that first. */
  const reopensCoverage = () => {
    if (!base?.host_id) return false
    if (!draft.needsCover || draft.allDay !== base.all_day) return true
    if (draft.allDay) return draft.date !== base.scheduled_on
    const s = zonedInstant(draft.date, draft.start, zone), e = zonedInstant(draft.date, draft.end, zone)
    return !(s.ok && e.ok && s.instant === Date.parse(base.starts_at ?? '') && e.instant === Date.parse(base.ends_at ?? ''))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validate()
    if (problem) return setError(problem)
    if (!navigator.onLine) return setError('You’re offline. Your changes are still here; save again once you’re connected.')
    if (reopensCoverage()) return setConfirmReopen(true)
    void save()
  }

  const save = async () => {
    if (!household) return
    setConfirmReopen(false); setSaving(true); setError(null); onBusy(true)
    const { data, error: e } = await supabase.rpc('save_appointment', {
      p_id: draft.id, p_household: household.id, p_expected_revision: base?.revision ?? null,
      p_title: draft.title.trim(), p_notes: draft.notes.trim() || null, p_room: draft.roomId || null,
      p_date: draft.date, p_start: draft.allDay ? null : draft.start, p_end: draft.allDay ? null : draft.end, p_needs_cover: draft.needsCover,
    })
    let saved = data ?? null
    if (e || !saved) {
      const f = friendly(e)
      if (f.network) {
        // The request may have reached the server. Check before reporting a failure.
        const { data: latest } = await supabase.from('calendar_appointments').select('*').eq('id', draft.id).maybeSingle()
        const landed = latest && (base ? latest.revision > base.revision && latest.title === draft.title.trim() : true)
        if (landed) saved = latest
      }
      if (!saved) {
        setSaving(false); onBusy(false)
        if (f.conflict) {
          const { data: latest } = await supabase.from('calendar_appointments').select('*').eq('id', draft.id).maybeSingle()
          setConflict(latest ?? null)
        }
        setError(f.network ? 'Couldn’t reach Flat Quest. Your changes are still here; try again.' : f.message)
        return
      }
    }
    setSaving(false); onBusy(false)
    toast.success(base ? 'Appointment updated' : 'Added to the calendar')
    onDone(saved!)
  }

  const host = base?.host_id ? memberById.get(base.host_id)?.profile.display_name || 'Your flatmate' : null
  const sameDayStart = zonedInstant(draft.date, draft.start, zone)

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="What’s happening?" htmlFor={ids.title}>
        <input id={ids.title} className="field font-semibold" value={draft.title} maxLength={TITLE_MAX} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Property inspection" autoComplete="off" />
      </Field>
      <Field label="Day" htmlFor={ids.date}>
        <input id={ids.date} type="date" className="field" value={draft.date} onChange={(e) => set({ date: e.target.value })} required />
      </Field>
      <label className="bg-surface-2 flex items-center justify-between gap-4 rounded-[var(--radius-control)] px-4 py-3">
        <span className="font-semibold">All day</span>
        <Switch checked={draft.allDay} onChange={(v) => set({ allDay: v })} label="All day" tone="accent" />
      </label>
      {!draft.allDay && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor={ids.start}>
              <input id={ids.start} type="time" className="field tabular-nums" value={draft.start} onChange={(e) => set({ start: e.target.value })} step={300} />
            </Field>
            <Field label="Ends" htmlFor={ids.end}>
              <input id={ids.end} type="time" className="field tabular-nums" value={draft.end} onChange={(e) => set({ end: e.target.value })} step={300} />
            </Field>
          </div>
          <p className="text-ink-2 mt-1.5 text-[13px]" data-testid="zone-hint">
            Times in {zone.replace(/_/g, ' ')} ({zoneAbbreviation(zone, sameDayStart.ok ? sameDayStart.instant : Date.parse(`${draft.date}T12:00:00Z`) || 0)}), the flat’s time zone.
          </p>
        </div>
      )}
      <label className="bg-surface-2 flex items-center justify-between gap-4 rounded-[var(--radius-control)] px-4 py-3">
        <span>
          <span className="block font-semibold">Needs someone home</span>
          <span className="text-ink-2 block text-[13px]">A flatmate can volunteer to be there</span>
        </span>
        <Switch checked={draft.needsCover} onChange={(v) => set({ needsCover: v })} label="Needs someone home" tone="accent" />
      </label>
      <Field label="Room (optional)" htmlFor={ids.room}>
        <select id={ids.room} className="field" value={draft.roomId} onChange={(e) => set({ roomId: e.target.value })}>
          <option value="">No particular room</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)" htmlFor={ids.notes} hint={`${draft.notes.length}/${NOTES_MAX}`}>
        <textarea id={ids.notes} className="field min-h-20 resize-y" value={draft.notes} maxLength={NOTES_MAX} onChange={(e) => set({ notes: e.target.value })} placeholder="Access codes, what to prepare…" />
      </Field>

      {conflict && (
        <div role="alert" className="bg-accent-soft rounded-[var(--radius-card)] p-4 text-[15px]" data-testid="appointment-conflict">
          <p className="font-semibold">Someone changed this while you were editing.</p>
          <p className="mt-1">Now: {conflict.cancelled_at ? 'cancelled' : `${conflict.title}, ${whenLabel(conflict, zone)}`}.</p>
          {!conflict.cancelled_at && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => { setDraft(draftFrom(conflict, zone)); setBase(conflict); setConflict(null); setError(null) }}>Use their version</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => { setBase(conflict); setConflict(null); setError(null) }}>Keep my changes</Button>
            </div>
          )}
        </div>
      )}
      {error && !conflict && <p role="alert" className="text-danger text-[14px] font-medium">{error}</p>}

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" block loading={saving} disabled={conflict !== null}>{base ? 'Save changes' : 'Add to calendar'}</Button>
        <Button type="button" variant="ghost" block onClick={onCancel} disabled={saving}>{base ? 'Discard changes' : 'Cancel'}</Button>
      </div>
      <ConfirmSheet
        open={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        title="Reopen coverage?"
        body={`${host} said they’d be home for the current time. ${draft.needsCover ? 'Moving it' : 'Not needing anyone'} means nobody is marked as home until someone volunteers again.`}
        confirmLabel={draft.needsCover ? 'Move it' : 'Save'}
        cancelLabel="Go back"
        onConfirm={() => void save()}
      />
    </form>
  )
}
