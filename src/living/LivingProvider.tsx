import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHousehold } from '@/household/HouseholdProvider'
import type { EssentialRow, TaskRow } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'
import { matchEssential, type EssentialCategory } from './living'

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean }
export type EssentialAction = 'need' | 'claim' | 'release' | 'handover' | 'takeover' | 'restock' | 'undo_restock'
export type TaskInput = Pick<TaskRow, 'title'> & Partial<Pick<TaskRow, 'notes' | 'room_id' | 'assignee_id' | 'due_on' | 'status'>>
export type TaskPatch = Partial<Pick<TaskRow, 'title' | 'notes' | 'room_id' | 'assignee_id' | 'due_on' | 'status' | 'archived_at'>>

interface LivingState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  essentials: EssentialRow[]
  tasks: TaskRow[]
  reload: () => Promise<void>
  /** Adds, or reactivates the existing one with the same name (never a duplicate). */
  addEssential: (name: string, extra?: { category?: EssentialCategory | null; note?: string | null }) => Promise<Result<{ essential: EssentialRow; reused: 'new' | 'needed-again' | 'already-on-list' }>>
  actOnEssential: (id: string, action: EssentialAction, opts?: { to?: string }) => Promise<Result<EssentialRow>>
  editEssential: (id: string, patch: Partial<Pick<EssentialRow, 'name' | 'category' | 'note' | 'archived_at'>>) => Promise<Result<EssentialRow>>
  addTask: (input: TaskInput) => Promise<Result<TaskRow>>
  updateTask: (id: string, patch: TaskPatch) => Promise<Result<TaskRow>>
}

const Ctx = createContext<LivingState | null>(null)

/** Friendly copy for the server's own refusals (FQ409 = someone else got there first). */
function friendly(error: { code?: string; message?: string } | null, fallback: string): { error: string; conflict?: boolean } {
  if (error?.code === 'FQ409' || error?.code === 'P0002' || error?.code === '42501') return { error: error.message ?? fallback, conflict: error.code === 'FQ409' }
  if (error?.code === '23505') return { error: 'That’s already on the list.', conflict: true }
  return { error: errorMessage(error, fallback) }
}

/**
 * Essentials and Things to do for the active flat: loaded once, kept live with Realtime,
 * updated optimistically and rolled back if the server refuses. Writes in flight are
 * protected from Realtime echoes so the UI never flickers back.
 */
export function LivingProvider({ children }: { children: ReactNode }) {
  const { household } = useHousehold()
  const hid = household?.id ?? null
  const [essentials, setEssentials] = useState<EssentialRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [status, setStatus] = useState<LivingState['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(new Map<string, number>())
  const essentialsRef = useRef(essentials)
  const tasksRef = useRef(tasks)
  useEffect(() => {
    essentialsRef.current = essentials
    tasksRef.current = tasks
  }, [essentials, tasks])

  const hold = (id: string, d: 1 | -1) => {
    const n = (pending.current.get(id) ?? 0) + d
    if (n <= 0) pending.current.delete(id)
    else pending.current.set(id, n)
  }

  const load = useCallback(async () => {
    if (!hid) return
    const [es, ts] = await Promise.all([
      supabase.from('essentials').select('*').eq('household_id', hid).order('name'),
      // Open tasks, plus anything finished or archived in the last fortnight.
      supabase
        .from('household_tasks')
        .select('*')
        .eq('household_id', hid)
        .or(`status.neq.done,completed_at.gte.${new Date(Date.now() - 14 * 86_400_000).toISOString()}`)
        .order('created_at'),
    ])
    const err = es.error ?? ts.error
    if (err) {
      setError(errorMessage(err, 'Couldn’t load essentials and tasks.'))
      setStatus((s) => (s === 'ready' ? s : 'error'))
      return
    }
    const keepPending = <T extends { id: string }>(fresh: T[], local: T[]) =>
      fresh.map((row) => (pending.current.has(row.id) ? (local.find((l) => l.id === row.id) ?? row) : row))
    setEssentials((prev) => keepPending(es.data ?? [], prev))
    setTasks((prev) => keepPending(ts.data ?? [], prev))
    setError(null)
    setStatus('ready')
  }, [hid])

  useEffect(() => {
    if (!hid) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set when it resolves
    void load()
    const upsert =
      <T extends { id: string; household_id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>) =>
      (p: RealtimePostgresChangesPayload<T>) => {
        if (p.eventType === 'DELETE') {
          const id = (p.old as Partial<T>).id
          if (id) set((prev) => prev.filter((x) => x.id !== id))
          return
        }
        const row = p.new as T
        if (row.household_id !== hid || pending.current.has(row.id)) return
        set((prev) => {
          const i = prev.findIndex((x) => x.id === row.id)
          if (i === -1) return [...prev, row]
          const next = prev.slice()
          next[i] = row
          return next
        })
      }
    let hadError = false
    const channel = supabase
      .channel(`living:${hid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'essentials', filter: `household_id=eq.${hid}` }, upsert<EssentialRow>(setEssentials))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_tasks', filter: `household_id=eq.${hid}` }, upsert<TaskRow>(setTasks))
      .subscribe((s) => {
        if (s === 'SUBSCRIBED' && hadError) void load()
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') hadError = true
      })
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [hid, load])

  const replaceEssential = (row: EssentialRow) =>
    setEssentials((prev) => (prev.some((e) => e.id === row.id) ? prev.map((e) => (e.id === row.id ? row : e)) : [...prev, row]))
  const replaceTask = (row: TaskRow) => setTasks((prev) => (prev.some((t) => t.id === row.id) ? prev.map((t) => (t.id === row.id ? row : t)) : [...prev, row]))

  const actOnEssential = useCallback<LivingState['actOnEssential']>(async (id, action, opts) => {
    const before = essentialsRef.current.find((e) => e.id === id)
    if (!before) return { ok: false, error: 'That essential is no longer on the list.' }
    if (!navigator.onLine) return { ok: false, error: 'You’re offline. Try again when you’re back online.' }
    // Optimistic: show the obvious next state straight away.
    const guess: Partial<EssentialRow> =
      action === 'restock' ? { status: 'stocked', claimed_by: null } : action === 'need' ? { status: 'needed', claimed_by: null, archived_at: null } : action === 'release' ? { status: 'needed', claimed_by: null } : {}
    if (Object.keys(guess).length) setEssentials((prev) => prev.map((e) => (e.id === id ? { ...e, ...guess } : e)))
    hold(id, 1)
    const { data, error: err } = await supabase.rpc('update_essential', { p_essential: id, p_action: action, p_expected: before.status, p_to: opts?.to ?? null })
    hold(id, -1)
    if (err || !data) {
      setEssentials((prev) => prev.map((e) => (e.id === id ? before : e)))
      void load()
      return { ok: false, ...friendly(err, 'Couldn’t update that. Try again.') }
    }
    replaceEssential(data)
    return { ok: true, data }
  }, [load])

  const addEssential = useCallback<LivingState['addEssential']>(async (name, extra) => {
    if (!hid) return { ok: false, error: 'No flat' }
    const clean = name.trim().replace(/\s+/g, ' ')
    if (!clean) return { ok: false, error: 'Give it a name.' }
    if (clean.length > 60) return { ok: false, error: 'Keep it under 60 characters.' }
    const match = matchEssential(clean, essentialsRef.current)
    if (match.kind === 'active') return { ok: true, data: { essential: match.essential, reused: 'already-on-list' } }
    if (match.kind === 'stocked' || match.kind === 'archived') {
      const res = await actOnEssential(match.essential.id, 'need')
      return res.ok ? { ok: true, data: { essential: res.data, reused: 'needed-again' } } : res
    }
    const { data, error: err } = await supabase
      .from('essentials')
      .insert({ household_id: hid, name: clean, category: extra?.category ?? null, note: extra?.note?.trim() || null, status: 'needed' })
      .select()
      .single()
    if (err?.code === '23505') {
      // A flatmate added it at the same moment: use theirs.
      await load()
      const theirs = matchEssential(clean, essentialsRef.current)
      if (theirs.kind !== 'none') return { ok: true, data: { essential: theirs.essential, reused: 'already-on-list' } }
    }
    if (err || !data) return { ok: false, ...friendly(err, 'Couldn’t add that. Try again.') }
    replaceEssential(data)
    return { ok: true, data: { essential: data, reused: 'new' } }
  }, [hid, actOnEssential, load])

  const editEssential = useCallback<LivingState['editEssential']>(async (id, patch) => {
    const before = essentialsRef.current.find((e) => e.id === id)
    if (!before) return { ok: false, error: 'That essential is no longer on the list.' }
    setEssentials((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    hold(id, 1)
    const { data, error: err } = await supabase.from('essentials').update(patch).eq('id', id).select().single()
    hold(id, -1)
    if (err || !data) {
      setEssentials((prev) => prev.map((e) => (e.id === id ? before : e)))
      return { ok: false, ...friendly(err, 'Couldn’t save that.') }
    }
    replaceEssential(data)
    return { ok: true, data }
  }, [])

  const addTask = useCallback<LivingState['addTask']>(async (input) => {
    if (!hid) return { ok: false, error: 'No flat' }
    const title = input.title.trim().replace(/\s+/g, ' ')
    if (!title) return { ok: false, error: 'What needs doing?' }
    if (title.length > 120) return { ok: false, error: 'Keep it under 120 characters.' }
    const { data, error: err } = await supabase
      .from('household_tasks')
      .insert({ household_id: hid, ...input, title, notes: input.notes?.trim() || null })
      .select()
      .single()
    if (err || !data) return { ok: false, ...friendly(err, 'Couldn’t add that task.') }
    replaceTask(data)
    return { ok: true, data }
  }, [hid])

  const updateTask = useCallback<LivingState['updateTask']>(async (id, patch) => {
    const before = tasksRef.current.find((t) => t.id === id)
    if (!before) return { ok: false, error: 'That task is no longer here.' }
    if (!navigator.onLine) return { ok: false, error: 'You’re offline. Try again when you’re back online.' }
    const optimistic: Partial<TaskRow> = { ...patch }
    if (patch.status === 'done' && before.status !== 'done') optimistic.completed_at = new Date().toISOString()
    if (patch.status && patch.status !== 'done') optimistic.completed_at = null
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...optimistic } : t)))
    hold(id, 1)
    // Refuse to overwrite a newer version someone else saved meanwhile.
    const { data, error: err } = await supabase.from('household_tasks').update(patch).eq('id', id).eq('updated_at', before.updated_at).select().maybeSingle()
    hold(id, -1)
    if (err || !data) {
      setTasks((prev) => prev.map((t) => (t.id === id ? before : t)))
      void load()
      return err ? { ok: false, ...friendly(err, 'Couldn’t save that.') } : { ok: false, error: 'Someone else just changed this task. Have another look.', conflict: true }
    }
    replaceTask(data)
    return { ok: true, data }
  }, [load])

  const value = useMemo<LivingState>(
    () => ({ status, error, essentials, tasks, reload: load, addEssential, actOnEssential, editEssential, addTask, updateTask }),
    [status, error, essentials, tasks, load, addEssential, actOnEssential, editEssential, addTask, updateTask],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLiving(): LivingState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLiving must be used inside <LivingProvider>')
  return ctx
}
