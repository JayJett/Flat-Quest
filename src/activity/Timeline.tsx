import { Bell, Check, Gift, Images, MessageCircle, PackageCheck, ShoppingBag, Sparkles, Truck, UserRound, Users, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { Avatar } from '@/components/Avatar'
import { useHousehold } from '@/household/HouseholdProvider'
import { recentActivity, type ActivityIdea } from '@/lib/activity'
import type { HouseholdEventRow } from '@/lib/database.types'
import { dayGroup, describeEvent, eventTime, type EventKind } from '@/lib/events'
import { errorMessage, supabase } from '@/lib/supabase'
import { useEventLookup } from '@/notifications/NotificationProvider'
import { useOpenEvent } from './useOpenEvent'

const ICON: Record<EventKind, LucideIcon> = {
  item: ShoppingBag,
  done: PackageCheck,
  stage: Truck,
  assign: UserRound,
  option: ShoppingBag,
  buy: ShoppingBag,
  milestone: Sparkles,
  photo: Images,
  idea: Gift,
  comment: MessageCircle,
  member: Users,
  history: Bell,
}

/**
 * The household's durable history (Phase 6 onwards), newest first, live-updating and
 * paged by id. `limit` is the page size; the Home preview uses a single small page.
 */
export function useTimeline(limit: number) {
  const { household } = useHousehold()
  const hid = household?.id ?? null
  const [events, setEvents] = useState<HouseholdEventRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const gen = useRef(0)

  const loadFirst = useCallback(async () => {
    if (!hid) return
    const g = ++gen.current
    const { data, error: e } = await supabase
      .from('household_events')
      .select('*')
      .eq('household_id', hid)
      .eq('in_timeline', true)
      .order('id', { ascending: false })
      .limit(limit)
    if (g !== gen.current) return
    if (e) {
      setError(errorMessage(e, 'Activity couldn’t load.'))
      setState((s) => (s === 'ready' ? s : 'error'))
      return
    }
    const rows = data ?? []
    setEvents((prev) => {
      const oldest = rows.at(-1)?.id ?? Infinity
      const fresh = new Set(rows.map((r) => r.id))
      return [...rows, ...prev.filter((p) => p.id < oldest && !fresh.has(p.id))]
    })
    setHasMore(rows.length === limit)
    setError(null)
    setState('ready')
  }, [hid, limit])

  const loadMore = useCallback(async () => {
    if (!hid) return
    const last = events.at(-1)?.id
    if (last == null) return
    const { data, error: e } = await supabase
      .from('household_events')
      .select('*')
      .eq('household_id', hid)
      .eq('in_timeline', true)
      .lt('id', last)
      .order('id', { ascending: false })
      .limit(limit)
    if (e) {
      setError(errorMessage(e, 'Older activity couldn’t load.'))
      return
    }
    const rows = data ?? []
    setEvents((prev) => {
      const have = new Set(prev.map((p) => p.id))
      return [...prev, ...rows.filter((r) => !have.has(r.id))]
    })
    setHasMore(rows.length === limit)
  }, [hid, limit, events])

  useEffect(() => {
    if (!hid) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set when it resolves
    void loadFirst()
    const onChange = (p: RealtimePostgresChangesPayload<HouseholdEventRow>) => {
      if (p.eventType === 'DELETE') {
        const id = (p.old as Partial<HouseholdEventRow>).id
        if (id != null) setEvents((prev) => prev.filter((e) => e.id !== id))
        return
      }
      const row = p.new as HouseholdEventRow
      if (row.household_id !== hid || !row.in_timeline) return
      setEvents((prev) => {
        const i = prev.findIndex((e) => e.id === row.id)
        if (i === -1) return [row, ...prev].sort((a, b) => b.id - a.id)
        const next = prev.slice()
        next[i] = row
        return next
      })
    }
    let hadError = false
    const channel = supabase
      .channel(`timeline:${hid}:${limit}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'household_events', filter: `household_id=eq.${hid}` }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'household_events', filter: `household_id=eq.${hid}` }, onChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'household_events' }, onChange)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && hadError) void loadFirst()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') hadError = true
      })
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadFirst()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [hid, limit, loadFirst])

  return { events, state, error, hasMore, loadMore, retry: loadFirst }
}

/**
 * Before Phase 6 there was no history. Rather than invent events, the app shows what the
 * current records can still tell us (completions and hand-added wishlist ideas), clearly
 * labelled as coming from before history began.
 */
export function useEarlierRecords(before: string | null) {
  const { household, items } = useHousehold()
  const hid = household?.id ?? null
  const [ideas, setIdeas] = useState<ActivityIdea[]>([])
  useEffect(() => {
    if (!hid || !before) return
    let active = true
    void supabase
      .from('wishlist_items')
      .select('id,title,created_at,created_by,import_key')
      .eq('household_id', hid)
      .is('import_key', null)
      .lt('created_at', before)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (active) setIdeas(data ?? [])
      })
    return () => {
      active = false
    }
  }, [hid, before])
  return useMemo(() => {
    if (!before) return []
    const t = Date.parse(before)
    return recentActivity(items.filter((i) => i.completed_at && Date.parse(i.completed_at) < t), ideas, 10)
  }, [items, ideas, before])
}

export function TimelineRow({ event }: { event: HouseholdEventRow }) {
  const look = useEventLookup()
  const { memberById } = useHousehold()
  const open = useOpenEvent()
  const d = describeEvent(event, look)
  // Milestones belong to the flat, not to whoever happened to finish them.
  const actor = event.actor_id && event.type !== 'room_completed' ? (memberById.get(event.actor_id)?.profile ?? null) : null
  const Icon = ICON[d.kind]
  const body = (
    <>
      <span className="relative shrink-0">
        {actor ? (
          <Avatar profile={actor} size={36} decorative />
        ) : (
          <span className="bg-surface-2 text-ink-2 flex h-9 w-9 items-center justify-center rounded-full">
            <Icon size={17} aria-hidden />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 text-[14px] leading-snug">
        {d.segments.map((s, i) =>
          s.strong ? (
            <strong key={i} className="font-semibold">
              {s.text}
            </strong>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
        <time dateTime={event.created_at} className="text-ink-2 mt-0.5 block text-[12px]">
          {eventTime(event.created_at)}
        </time>
      </span>
    </>
  )
  return (
    <li data-testid="timeline-row">
      {d.href ? (
        <button type="button" onClick={() => open(event)} className="pressable -mx-2 flex min-h-14 w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 py-2 text-left">
          {body}
        </button>
      ) : (
        <div className="-mx-2 flex min-h-14 items-center gap-3 px-2 py-2">{body}</div>
      )}
    </li>
  )
}

export function EarlierRecords({ before }: { before: string | null }) {
  const entries = useEarlierRecords(before)
  const { memberById } = useHousehold()
  if (entries.length === 0) return null
  return (
    <section aria-label="Before history began" className="mt-6">
      <h3 className="text-ink-2 text-[13px] font-bold">Before history began</h3>
      <p className="text-ink-2 mt-0.5 text-[12px]">From the flat’s current records, so earlier changes may be missing.</p>
      <ul className="mt-1">
        {entries.map((entry) => {
          const person = entry.actor ? memberById.get(entry.actor)?.profile.display_name : null
          const Icon = entry.kind === 'ready' ? Check : Gift
          return (
            <li key={entry.id} className="text-ink-2 flex min-h-12 items-center gap-3 py-1 text-[14px]">
              <span className="bg-surface-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                <Icon size={16} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="text-ink font-semibold">{person ?? 'A flatmate'}</span>
                {entry.kind === 'ready' ? ' marked ' : ' added '}
                <span className="text-ink font-semibold">{entry.title}</span>
                {entry.kind === 'ready' ? ' as in the flat' : ' to the wishlist'}
                <time dateTime={entry.at} className="mt-0.5 block text-[12px]">
                  {eventTime(entry.at)}
                </time>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Groups events into Today / Yesterday / Earlier for display. */
export function groupByDay(events: HouseholdEventRow[]) {
  const out: { label: string; events: HouseholdEventRow[] }[] = []
  for (const e of events) {
    const label = dayGroup(e.created_at)
    const last = out.at(-1)
    if (last?.label === label) last.events.push(e)
    else out.push({ label, events: [e] })
  }
  return out
}
