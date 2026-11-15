import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { EarlierRecords, TimelineRow, useTimeline } from '@/activity/Timeline'
import { SectionHeader } from './ui'

const PREVIEW = 5

/** "Around the flat" on Home: the latest few entries from the durable household history. */
export function HouseholdActivity() {
  // One extra row so the history-start marker doesn't push a real entry out.
  const { events, state, error } = useTimeline(PREVIEW + 1)
  const real = events.filter((e) => e.type !== 'history_started').slice(0, PREVIEW)
  const start = events.find((e) => e.type === 'history_started')
  return (
    <section aria-label="Around the flat">
      <SectionHeader
        title="Around the flat"
        action={
          <Link to="/activity" className="text-ink-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 text-[15px] font-semibold whitespace-nowrap">
            View all<span className="sr-only"> activity</span>
            <ChevronRight size={16} aria-hidden />
          </Link>
        }
      />
      {state === 'loading' && events.length === 0 && <p className="text-ink-2 text-[14px]">Loading…</p>}
      {state === 'error' && <p className="text-ink-2 text-[14px]" role="status">{error} It will retry when you return or reconnect.</p>}
      {state === 'ready' && real.length === 0 && (
        <p className="text-ink-2 text-[14px]">Ticked-off items, new ideas, picks and comments will appear here as they happen.</p>
      )}
      <ul>
        {real.map((e) => (
          <TimelineRow key={e.id} event={e} />
        ))}
      </ul>
      {state === 'ready' && real.length === 0 && start && <EarlierRecords before={start.created_at} />}
    </section>
  )
}
