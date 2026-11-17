import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHousehold } from '@/household/HouseholdProvider'
import type { AppointmentRow, TaskRow } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'
import { useLiving } from '@/living/LivingProvider'
import { useShopping } from '@/shopping/ShoppingProvider'
import { addDays, flatZone, todayIn, weekDays, type CivilDate } from './dates'
import { appointmentEntries, mergeAppointment, purchaseEntries, taskEntries, type CalendarEntry, type ItemSource, type PurchaseSource } from './entries'

export type Source = 'tasks' | 'purchases' | 'appointments'
type TaskSlice = Pick<TaskRow, 'id' | 'title' | 'due_on' | 'status' | 'archived_at' | 'room_id' | 'assignee_id'>

const PAGE = 500
const MAX_ROWS = 2000

/** Reads every page of a week-bounded query (never silently truncated at the API's row limit). */
async function paged<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** The flat's "today" and zone, updated when the flat's day rolls over or the app returns. */
export function useFlatToday() {
  const { household } = useHousehold()
  const zone = flatZone(household?.settings)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 60_000)
    const visible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', tick) }
  }, [])
  return { zone, today: todayIn(zone, now) }
}

/**
 * Everything dated in one Monday–Sunday week of the active flat. Tasks and purchases stay the
 * source of truth (this only projects them); a source that fails is reported on its own while
 * the others stay visible.
 */
export function useWeek(monday: CivilDate) {
  const { household, items } = useHousehold()
  const living = useLiving()
  const shopping = useShopping()
  const flatId = household?.id ?? ''
  const { zone, today } = useFlatToday()
  const days = useMemo(() => weekDays(monday), [monday])

  const [tasks, setTasks] = useState<TaskSlice[]>([])
  const [purchases, setPurchases] = useState<PurchaseSource[]>([])
  const [extraItems, setExtraItems] = useState<Map<string, ItemSource>>(new Map())
  const [appointments, setAppointments] = useState<Map<string, AppointmentRow>>(new Map())
  const [loaded, setLoaded] = useState<Record<Source, boolean>>({ tasks: false, purchases: false, appointments: false })
  const [errors, setErrors] = useState<Partial<Record<Source, string>>>({})
  const generation = useRef(0)
  /** Appointments received live while a fetch was in flight (so the fetch can't drop them). */
  const liveDuringFetch = useRef(new Map<string, AppointmentRow>())
  const latest = useRef(appointments)
  useEffect(() => { latest.current = appointments }, [appointments])

  const itemMap = useMemo(() => {
    const m = new Map<string, ItemSource>(extraItems)
    for (const i of items) m.set(i.id, { id: i.id, name: i.name, room_id: i.room_id, status: i.status, is_complete: i.is_complete })
    return m
  }, [items, extraItems])

  const load = useCallback(async (only?: Source[]) => {
    if (!flatId) return
    const run = ++generation.current
    const want = (s: Source) => !only || only.includes(s)
    const first = days[0]!, last = days[6]!
    const settle = (s: Source, error?: unknown) => {
      if (run !== generation.current) return
      setLoaded((l) => ({ ...l, [s]: true }))
      setErrors((e) => {
        const next = { ...e }
        if (error) next[s] = errorMessage(error)
        else delete next[s]
        return next
      })
    }
    const jobs: Promise<void>[] = []
    if (want('tasks')) jobs.push(paged<TaskSlice>((from, to) => supabase.from('household_tasks')
      .select('id, title, due_on, status, archived_at, room_id, assignee_id')
      .eq('household_id', flatId).gte('due_on', first).lte('due_on', last).in('status', ['todo', 'doing']).is('archived_at', null)
      .order('due_on').order('id').range(from, to))
      .then((rows) => { if (run === generation.current) setTasks(rows); settle('tasks') }, (e) => settle('tasks', e)))
    if (want('purchases')) jobs.push(paged<PurchaseSource>((from, to) => supabase.from('item_purchases')
      .select('item_id, expected_on, delivery_method, arrived_on')
      .eq('household_id', flatId).gte('expected_on', first).lte('expected_on', last).is('arrived_on', null)
      .order('expected_on').order('item_id').range(from, to))
      .then(async (rows) => {
        // Items normally come from the household's own load; fetch any it doesn't hold.
        const missing = rows.map((r) => r.item_id).filter((id) => !itemMap.has(id))
        if (missing.length) {
          const { data, error } = await supabase.from('items').select('id, name, room_id, status, is_complete').eq('household_id', flatId).in('id', missing)
          if (error) throw error
          if (run === generation.current) setExtraItems((m) => { const n = new Map(m); for (const i of data ?? []) n.set(i.id, i); return n })
        }
        if (run === generation.current) setPurchases(rows)
        settle('purchases')
      }).catch((e) => settle('purchases', e)))
    if (want('appointments')) {
      liveDuringFetch.current = new Map()
      // A two-day margin either side: a timed appointment's local day can shift if the flat's zone changes.
      jobs.push(paged<AppointmentRow>((from, to) => supabase.from('calendar_appointments').select('*')
        .eq('household_id', flatId).is('cancelled_at', null).gte('scheduled_on', addDays(first, -2)).lte('scheduled_on', addDays(last, 2))
        .order('scheduled_on').order('id').range(from, to))
        .then((rows) => {
          if (run !== generation.current) return
          let next = new Map<string, AppointmentRow>()
          for (const r of rows) next = mergeAppointment(next, r)
          for (const r of latest.current.values()) if ((next.get(r.id)?.revision ?? -1) < r.revision && liveDuringFetch.current.has(r.id)) next.set(r.id, r)
          setAppointments(next)
          settle('appointments')
        }, (e) => settle('appointments', e)))
    }
    await Promise.all(jobs)
  }, [flatId, days, itemMap])

  // A new week (or flat) starts fresh.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before loading the new week
    setLoaded({ tasks: false, purchases: false, appointments: false })
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatId, monday])

  // Source records changed somewhere (this device or a flatmate's, via the providers' live
  // subscriptions): refresh the projection shortly after.
  const sourceSignal = `${living.tasks.length}:${living.tasks.map((t) => t.updated_at).join()}|${shopping.purchaseByItem.size}:${[...shopping.purchaseByItem.values()].map((p) => p.updated_at).join()}|${items.map((i) => `${i.status}${i.is_complete ? 1 : 0}`).join()}`
  const firstSignal = useRef(true)
  useEffect(() => {
    if (firstSignal.current) { firstSignal.current = false; return }
    const t = window.setTimeout(() => void load(['tasks', 'purchases']), 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSignal])

  // Live appointment changes for this flat only. Older revisions (late or replayed) are ignored;
  // after a reconnect everything is fetched again.
  useEffect(() => {
    if (!flatId) return
    let hadError = false
    const channel: RealtimeChannel = supabase.channel(`calendar:${flatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_appointments', filter: `household_id=eq.${flatId}` }, (payload) => {
        const row = payload.new as AppointmentRow
        if (!row?.id || row.household_id !== flatId) return
        liveDuringFetch.current.set(row.id, row)
        setAppointments((m) => mergeAppointment(m, row))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { if (hadError) void load(['appointments']); hadError = false }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') hadError = true
      })
    const online = () => void load()
    window.addEventListener('online', online)
    return () => { void supabase.removeChannel(channel); window.removeEventListener('online', online) }
  }, [flatId, load])

  /** A row the server just confirmed (save, cover, cancel) is applied immediately. */
  const apply = useCallback((row: AppointmentRow) => setAppointments((m) => mergeAppointment(m, row)), [])

  const coordinators = useMemo(() => new Map([...shopping.coordinatorByItem].map(([id, c]) => [id, c.user_id])), [shopping.coordinatorByItem])
  const entries: CalendarEntry[] = useMemo(() => [
    ...taskEntries(tasks, days, today, flatId),
    ...purchaseEntries(purchases, itemMap, coordinators, days, today, flatId),
    ...appointmentEntries([...appointments.values()], days, zone),
  ], [tasks, purchases, itemMap, coordinators, appointments, days, today, flatId, zone])

  const loading = !loaded.tasks || !loaded.purchases || !loaded.appointments
  return { days, entries, zone, today, loading, loaded, errors, reload: load, apply, appointments }
}
