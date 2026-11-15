import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { useAuth } from '@/auth/AuthProvider'
import { useHousehold } from '@/household/HouseholdProvider'
import type { HouseholdEventRow, NotificationRow } from '@/lib/database.types'
import type { EventLookup } from '@/lib/events'
import { errorMessage, supabase } from '@/lib/supabase'

export type Notice = NotificationRow & { event: HouseholdEventRow | null }

const PAGE = 30

interface NotificationState {
  notices: Notice[]
  unread: number
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => Promise<void>
  retry: () => void
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
}

const Ctx = createContext<NotificationState | null>(null)

/**
 * Personal notifications for the signed-in member in the active flat. Rows are created
 * only by the server; this store reads, live-updates and marks them read. Every list
 * update de-duplicates by id, so realtime echoes, retries and refetches never double up.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { household } = useHousehold()
  const uid = user?.id ?? null
  const hid = household?.id ?? null
  const [notices, setNotices] = useState<Notice[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  /** Ids with a read write in flight: echoes can't flip them back to unread. */
  const readPending = useRef(new Set<number>())
  const generation = useRef(0)

  const withEvents = useCallback(async (rows: NotificationRow[]): Promise<Notice[]> => {
    const ids = [...new Set(rows.map((r) => r.event_id))]
    if (ids.length === 0) return []
    const { data, error: e } = await supabase.from('household_events').select('*').in('id', ids)
    if (e) throw e
    const byId = new Map((data ?? []).map((ev) => [ev.id, ev]))
    return rows.map((r) => ({ ...r, event: byId.get(r.event_id) ?? null }))
  }, [])

  const countUnread = useCallback(async () => {
    if (!uid || !hid) return
    const gen = generation.current
    const { count, error: e } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', hid)
      .eq('recipient_id', uid)
      .is('read_at', null)
    if (!e && gen === generation.current) setUnread(count ?? 0)
  }, [uid, hid])

  const loadFirst = useCallback(async () => {
    if (!uid || !hid) return
    const gen = ++generation.current
    try {
      const { data, error: e } = await supabase
        .from('notifications')
        .select('*')
        .eq('household_id', hid)
        .eq('recipient_id', uid)
        .order('id', { ascending: false })
        .limit(PAGE)
      if (e) throw e
      const rows = await withEvents(data ?? [])
      if (gen !== generation.current) return
      setNotices((prev) => {
        // Keep anything older we had paged in, refresh the first page.
        const fresh = new Map(rows.map((n) => [n.id, n]))
        const oldest = rows.at(-1)?.id ?? Infinity
        const keep = prev.filter((n) => n.id < oldest && !fresh.has(n.id))
        return [...rows, ...keep].map((n) => (readPending.current.has(n.id) && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n))
      })
      setHasMore((data ?? []).length === PAGE)
      setError(null)
      await countUnread()
    } catch (e) {
      if (gen === generation.current) setError(errorMessage(e, 'Notifications couldn’t load.'))
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [uid, hid, withEvents, countUnread])

  const loadMore = useCallback(async () => {
    if (!uid || !hid) return
    const last = notices.at(-1)?.id
    if (last == null) return
    const { data, error: e } = await supabase
      .from('notifications')
      .select('*')
      .eq('household_id', hid)
      .eq('recipient_id', uid)
      .lt('id', last)
      .order('id', { ascending: false })
      .limit(PAGE)
    if (e) {
      setError(errorMessage(e, 'More notifications couldn’t load.'))
      return
    }
    const rows = await withEvents(data ?? []).catch(() => [] as Notice[])
    setNotices((prev) => {
      const have = new Set(prev.map((n) => n.id))
      return [...prev, ...rows.filter((n) => !have.has(n.id))]
    })
    setHasMore((data ?? []).length === PAGE)
  }, [uid, hid, notices, withEvents])

  // Fresh state for each person and flat.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset before the new flat's fetch */
    setNotices([])
    setUnread(0)
    setLoading(true)
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    readPending.current.clear()
    if (!uid || !hid) return
    void loadFirst()
    const onChange = (payload: RealtimePostgresChangesPayload<NotificationRow>) => {
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as Partial<NotificationRow>).id
        if (id != null) {
          setNotices((prev) => prev.filter((n) => n.id !== id))
          void countUnread()
        }
        return
      }
      const row = payload.new as NotificationRow
      if (row.recipient_id !== uid || row.household_id !== hid) return
      if (payload.eventType === 'UPDATE') {
        setNotices((prev) => prev.map((n) => (n.id === row.id ? { ...n, read_at: row.read_at ?? n.read_at } : n)))
        void countUnread()
        return
      }
      void withEvents([row])
        .then(([notice]) => {
          if (!notice) return
          setNotices((prev) => (prev.some((n) => n.id === notice.id) ? prev : [notice, ...prev].sort((a, b) => b.id - a.id)))
          void countUnread()
        })
        .catch(() => void loadFirst())
    }
    let hadError = false
    const channel = supabase
      .channel(`notifications:${uid}:${hid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${uid}` }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${uid}` }, onChange)
      // Deletes (coalesced or withdrawn notifications) carry only the id and can't be filtered.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications' }, onChange)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hadError) void loadFirst()
          hadError = false
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadError = true
        }
      })
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadFirst()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    const gen = generation
    return () => {
      gen.current++
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [uid, hid, attempt, loadFirst, countUnread, withEvents])

  const markRead = useCallback(
    async (id: number) => {
      const target = notices.find((n) => n.id === id)
      if (!target || target.read_at || readPending.current.has(id)) return
      readPending.current.add(id)
      const now = new Date().toISOString()
      setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)))
      setUnread((u) => Math.max(0, u - 1))
      const { error: e } = await supabase.from('notifications').update({ read_at: now }).eq('id', id)
      readPending.current.delete(id)
      if (e) {
        setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)))
        void countUnread()
      }
    },
    [notices, countUnread],
  )

  const markAllRead = useCallback(async () => {
    if (!hid) return
    const before = notices
    const now = new Date().toISOString()
    setNotices((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    setUnread(0)
    const { error: e } = await supabase.rpc('mark_all_notifications_read', { p_household: hid })
    if (e) {
      setNotices(before)
      setError(errorMessage(e, 'Couldn’t mark everything read. Try again.'))
      void countUnread()
    }
  }, [hid, notices, countUnread])

  const value = useMemo<NotificationState>(
    () => ({ notices, unread, loading, error, hasMore, loadMore, markRead, markAllRead, retry: () => setAttempt((a) => a + 1) }),
    [notices, unread, loading, error, hasMore, loadMore, markRead, markAllRead],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications(): NotificationState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>')
  return ctx
}

/** Names come from current records when they still exist, otherwise from the event. */
export function useEventLookup(): EventLookup {
  const { memberById, items, rooms } = useHousehold()
  const { user } = useAuth()
  return useMemo<EventLookup>(() => {
    const itemById = new Map(items.map((i) => [i.id, i.name]))
    const roomById = new Map(rooms.map((r) => [r.id, r.name]))
    return {
      personName: (id) => (id ? (memberById.get(id)?.profile.display_name?.trim() || null) : null),
      itemName: (id) => (id ? (itemById.get(id) ?? null) : null),
      roomName: (id) => (id ? (roomById.get(id) ?? null) : null),
      myId: user?.id ?? null,
    }
  }, [memberById, items, rooms, user?.id])
}
