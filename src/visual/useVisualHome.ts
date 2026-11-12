import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, errorMessage } from '@/lib/supabase'
import type { Transformation, Visual } from './types'

export function useVisualHome(householdId: string, roomId: string) {
  const [visuals, setVisuals] = useState<Visual[]>([])
  const [transformations, setTransformations] = useState<Transformation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(60)
  const [more, setMore] = useState(false)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    const [v, t] = await Promise.all([
      supabase.from('room_visuals').select('*').eq('household_id', householdId).eq('room_id', roomId).order('sort_order').order('id').limit(limit + 1),
      supabase.from('room_transformations').select('*').eq('household_id', householdId).eq('room_id', roomId).order('created_at', { ascending: false }).limit(limit + 1),
    ])
    if (current !== generation.current) return
    if (v.error || t.error) setError(errorMessage(v.error || t.error))
    else {
      // Fetch referenced photos outside the current gallery page for comparisons.
      const visible = (v.data ?? []).slice(0, limit)
      const pairs = (t.data ?? []).slice(0, limit)
      const missing = [...new Set(pairs.flatMap(x => [x.before_id, x.after_id]))].filter(id => !visible.some(x => x.id === id))
      const extra = missing.length ? await supabase.from('room_visuals').select('*').eq('room_id', roomId).in('id', missing) : { data: [] as Visual[], error: null }
      if (current !== generation.current) return
      if (extra.error) setError(errorMessage(extra.error))
      else {
        setVisuals([...visible, ...(extra.data ?? [])].sort((a,b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)))
        setTransformations(pairs)
        setMore((v.data?.length ?? 0) > limit || (t.data?.length ?? 0) > limit)
        setError(null)
      }
    }
    setLoading(false)
  }, [householdId, roomId, limit])
  useEffect(() => {
    queueMicrotask(() => void load())
    const channel = supabase.channel(`visual:${householdId}:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_visuals', filter: `room_id=eq.${roomId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_transformations', filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe(s => { if (s === 'SUBSCRIBED') void load() })
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    const invalidate = () => { generation.current++ }
    return () => { invalidate(); void supabase.removeChannel(channel); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [householdId, roomId, load])
  return { visuals, transformations, loading, error, load, more, loadMore: () => setLimit(x => x + 60) }
}
