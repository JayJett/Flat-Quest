import type { AppointmentRow, TaskRow } from '@/lib/database.types'
import { flatLink } from '@/household/flatLinks'
import { localParts, type CivilDate } from './dates'

export type EntryKind = 'appointment' | 'task' | 'delivery' | 'pickup'
export const KIND_LABEL: Record<EntryKind, string> = { appointment: 'Appointment', task: 'Task', delivery: 'Delivery', pickup: 'Pickup' }

export interface CalendarEntry {
  /** Deterministic: the same source record always projects to the same key. */
  key: string
  kind: EntryKind
  date: CivilDate
  /** Date-only entries are listed before timed ones on each day. */
  timed: boolean
  startsAt: number | null
  endsAt: number | null
  /** A timed appointment that (after a flat time-zone change) ends on another day. */
  endsOn: CivilDate | null
  title: string
  roomId: string | null
  /** Open and past its date (tasks, deliveries and pickups only). */
  overdue: boolean
  /** Where the source record lives. Appointments open in the calendar itself. */
  href: string | null
  personId: string | null
  appointment: AppointmentRow | null
}

export type PurchaseSource = { item_id: string; expected_on: string | null; delivery_method: string | null; arrived_on: string | null }
export type ItemSource = { id: string; name: string; room_id: string; status: string; is_complete: boolean }

const OPEN_TASK = new Set(['todo', 'doing'])
const EXPECTED = new Set(['ordered', 'on_the_way', 'ready_to_collect'])
const inWeek = (date: string | null | undefined, days: readonly CivilDate[]): date is CivilDate => !!date && days.includes(date)

export function taskEntries(tasks: readonly Pick<TaskRow, 'id' | 'title' | 'due_on' | 'status' | 'archived_at' | 'room_id' | 'assignee_id'>[], days: readonly CivilDate[], today: CivilDate, flatId: string): CalendarEntry[] {
  return tasks
    .filter((t) => OPEN_TASK.has(t.status) && !t.archived_at && inWeek(t.due_on, days))
    .map((t) => ({
      key: `task:${t.id}`, kind: 'task', date: t.due_on!, timed: false, startsAt: null, endsAt: null, endsOn: null,
      title: t.title, roomId: t.room_id, overdue: t.due_on! < today,
      href: flatLink(`/tasks?task=${t.id}`, flatId), personId: t.assignee_id, appointment: null,
    }))
}

/** Pickup when collected in person or already waiting to be collected; otherwise delivery. */
export function purchaseKind(p: Pick<PurchaseSource, 'delivery_method'>, item: Pick<ItemSource, 'status'>): 'delivery' | 'pickup' {
  return p.delivery_method === 'pickup' || item.status === 'ready_to_collect' ? 'pickup' : 'delivery'
}

export function purchaseEntries(purchases: readonly PurchaseSource[], items: ReadonlyMap<string, ItemSource>, coordinators: ReadonlyMap<string, string>, days: readonly CivilDate[], today: CivilDate, flatId: string): CalendarEntry[] {
  const out: CalendarEntry[] = []
  for (const p of purchases) {
    const item = items.get(p.item_id)
    if (!item || item.is_complete || !EXPECTED.has(item.status) || p.arrived_on || !inWeek(p.expected_on, days)) continue
    out.push({
      key: `purchase:${p.item_id}`, kind: purchaseKind(p, item), date: p.expected_on, timed: false, startsAt: null, endsAt: null, endsOn: null,
      title: item.name, roomId: item.room_id, overdue: p.expected_on < today,
      href: flatLink(`/rooms/${item.room_id}?item=${item.id}`, flatId), personId: coordinators.get(item.id) ?? null, appointment: null,
    })
  }
  return out
}

export function appointmentEntries(rows: readonly AppointmentRow[], days: readonly CivilDate[], zone: string): CalendarEntry[] {
  const out: CalendarEntry[] = []
  for (const a of rows) {
    if (a.cancelled_at) continue
    const timed = !a.all_day && !!a.starts_at && !!a.ends_at
    const date = timed ? localParts(a.starts_at!, zone).date : a.scheduled_on
    if (!inWeek(date, days)) continue
    const endDate = timed ? localParts(a.ends_at!, zone).date : null
    out.push({
      key: `appointment:${a.id}`, kind: 'appointment', date, timed,
      startsAt: timed ? Date.parse(a.starts_at!) : null, endsAt: timed ? Date.parse(a.ends_at!) : null,
      endsOn: endDate && endDate !== date ? endDate : null,
      title: a.title, roomId: a.room_id, overdue: false, href: null, personId: a.host_id, appointment: a,
    })
  }
  return out
}

const KIND_ORDER: Record<EntryKind, number> = { appointment: 0, task: 1, delivery: 2, pickup: 3 }

/** Per day: date-only before timed; timed by start; ties by kind, title, then key (stable). */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  return a.date.localeCompare(b.date)
    || Number(a.timed) - Number(b.timed)
    || (a.startsAt ?? 0) - (b.startsAt ?? 0)
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.title.localeCompare(b.title)
    || a.key.localeCompare(b.key)
}

export function groupByDay(entries: readonly CalendarEntry[], days: readonly CivilDate[]): { date: CivilDate; entries: CalendarEntry[] }[] {
  const sorted = [...entries].sort(compareEntries)
  return days.map((date) => ({ date, entries: sorted.filter((e) => e.date === date) }))
}

/** Applies a newer copy of an appointment; an older or equal revision (late or replayed) is ignored. */
export function mergeAppointment(current: ReadonlyMap<string, AppointmentRow>, row: AppointmentRow): Map<string, AppointmentRow> {
  const existing = current.get(row.id)
  if (existing && existing.revision >= row.revision) return current as Map<string, AppointmentRow>
  return new Map(current).set(row.id, row)
}
