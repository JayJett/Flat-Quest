import { useState } from 'react'
import { useNavigate } from 'react-router'
import { EarlierRecords, groupByDay, TimelineRow, useTimeline } from '@/activity/Timeline'
import { PageHeader } from '@/components/AppShell'
import { Button, ErrorPanel, SkeletonRows } from '@/components/ui'
import { BackButton, goBack } from './RoomDetail'

/** Everything that has happened around the flat since history began, newest first. */
export function ActivityPage() {
  const navigate = useNavigate()
  const { events, state, error, hasMore, loadMore, retry } = useTimeline(40)
  const [more, setMore] = useState(false)
  const real = events.filter((e) => e.type !== 'history_started')
  const start = events.find((e) => e.type === 'history_started') ?? null
  const groups = groupByDay(real)
  return (
    <>
      <PageHeader title="Activity" hideTitleUntilScroll back={<BackButton onClick={() => goBack(navigate, '/')} />} />
      <div className="px-4 lg:px-0">
        <div className="pt-2 pb-4">
          <h1 className="text-display font-extrabold">Activity</h1>
          <p className="text-ink-2 mt-1 text-[16px]">What’s been happening around the flat.</p>
        </div>
        {state === 'loading' && events.length === 0 ? (
          <SkeletonRows label="Loading activity" rows={5} />
        ) : state === 'error' ? (
          <ErrorPanel message={error ?? 'Activity couldn’t load.'} onRetry={() => void retry()} />
        ) : (
          <>
            {real.length === 0 && (
              <p className="text-ink-2 text-[15px]">Nothing yet. Ticked-off items, new ideas, picks and comments will appear here as they happen.</p>
            )}
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label} className="mt-4">
                <h2 className="text-ink-2 mb-1 text-[14px] font-bold">{g.label}</h2>
                <ul>
                  {g.events.map((e) => (
                    <TimelineRow key={e.id} event={e} />
                  ))}
                </ul>
              </section>
            ))}
            {hasMore && (
              <Button
                variant="secondary"
                block
                className="mt-4"
                loading={more}
                onClick={async () => {
                  setMore(true)
                  await loadMore()
                  setMore(false)
                }}
              >
                Show older activity
              </Button>
            )}
            {!hasMore && start && (
              <>
                <p className="border-line text-ink-2 mt-6 border-t pt-4 text-center text-[13px] font-semibold" data-testid="history-start">
                  Flat history starts here · {new Date(start.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <EarlierRecords before={start.created_at} />
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
