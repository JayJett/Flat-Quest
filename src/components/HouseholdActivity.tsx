import { Check, Gift } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useHousehold } from '@/household/HouseholdProvider'
import { recentActivity, type ActivityIdea } from '@/lib/activity'
import { supabase } from '@/lib/supabase'
import { SectionHeader } from './ui'

export function HouseholdActivity() {
  const { household, items, memberById } = useHousehold()
  const [ideas, setIdeas] = useState<ActivityIdea[]>([])
  const [failed, setFailed] = useState(false)
  const hid = household?.id
  useEffect(() => {
    if (!hid) return
    let active = true
    let generation = 0
    const load = async () => {
      const request = ++generation
      const { data, error } = await supabase.from('wishlist_items')
        .select('id,title,created_at,created_by,import_key').eq('household_id', hid)
        .is('import_key', null).order('created_at', { ascending: false }).limit(5)
      if (!active || request !== generation) return
      setFailed(Boolean(error))
      if (!error) setIdeas(data ?? [])
    }
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    const channel = supabase.channel(`activity:${hid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist_items', filter: `household_id=eq.${hid}` }, refresh)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wishlist_items' }, refresh)
      .subscribe((status) => { if (status === 'SUBSCRIBED') void load() })
    void load()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      active = false
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [hid])
  const entries = recentActivity(items, ideas)
  return (
    <section className="mt-9" aria-label="Around the flat">
      <SectionHeader title="Around the flat" />
      {entries.length === 0 && <p className="text-ink-2 text-[14px]">Ready items and new wishlist ideas will appear here.</p>}
      <ul>
        {entries.map((entry) => {
          const person = entry.actor ? memberById.get(entry.actor)?.profile.display_name : null
          const Icon = entry.kind === 'ready' ? Check : Gift
          return (
            <li key={entry.id}>
              <Link to={entry.kind === 'ready' ? `/rooms/${entry.roomId}` : '/wishlist'} className="pressable -mx-2 flex min-h-14 items-center gap-3 rounded-2xl px-2 py-2">
                <Icon size={18} className="text-ink-2 shrink-0" aria-hidden />
                <span className="min-w-0 text-[14px]">
                  <span className="font-semibold">{person ?? 'A flatmate'}</span>{entry.kind === 'ready' ? ' marked ' : ' added '}<span className="font-semibold">{entry.title}</span>{entry.kind === 'ready' ? ' as ready' : ' to the wishlist'}
                  <time dateTime={entry.at} className="text-ink-2 mt-0.5 block text-[12px]">{new Date(entry.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</time>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {failed && <p className="text-ink-2 mt-2 text-[13px]" role="status">Wishlist activity couldn’t refresh. It will retry when you return or reconnect.</p>}
    </section>
  )
}
