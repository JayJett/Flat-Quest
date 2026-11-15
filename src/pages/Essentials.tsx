import { Archive, PackageCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/AppShell'
import { useToast } from '@/components/Toast'
import { AnimatedNumber, ErrorPanel, Segmented, Spinner } from '@/components/ui'
import type { EssentialRow } from '@/lib/database.types'
import { EssentialItem, EssentialQuickAdd, EssentialSheet } from '@/living/EssentialParts'
import { isActiveEssential, sortEssentials } from '@/living/living'
import { useLiving } from '@/living/LivingProvider'
import { SPRINGS } from '@/motion/motion'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { BackButton, goBack } from './RoomDetail'

type View = 'needed' | 'stocked' | 'archived'

/** Consumables the flat keeps running out of. Separate from the furnishing checklist. */
export function EssentialsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const level = useMotionLevel()
  const { status, error, essentials, reload } = useLiving()
  const [view, setView] = useState<View>('needed')
  const [open, setOpen] = useState<EssentialRow | null>(null)
  const [params, setParams] = useSearchParams()
  const wanted = params.get('essential')

  // Deep link from a notification or the timeline.
  useEffect(() => {
    if (!wanted || status !== 'ready') return
    const e = essentials.find((x) => x.id === wanted)
    /* eslint-disable react-hooks/set-state-in-effect -- consuming a one-off URL parameter */
    if (e) {
      setOpen(e)
      setView(e.archived_at ? 'archived' : e.status === 'stocked' ? 'stocked' : 'needed')
    } else toast.show('That essential is no longer on the list.')
    /* eslint-enable react-hooks/set-state-in-effect */
    setParams({}, { replace: true })
  }, [wanted, status, essentials, setParams, toast])

  const active = useMemo(() => sortEssentials(essentials.filter(isActiveEssential)), [essentials])
  const stocked = useMemo(() => sortEssentials(essentials.filter((e) => !e.archived_at && e.status === 'stocked')), [essentials])
  const archived = useMemo(() => essentials.filter((e) => e.archived_at).sort((a, b) => a.name.localeCompare(b.name)), [essentials])
  const getting = active.filter((e) => e.status === 'getting').length
  const list = view === 'needed' ? active : view === 'stocked' ? stocked : archived

  return (
    <>
      <PageHeader title="Essentials" hideTitleUntilScroll back={<BackButton onClick={() => goBack(navigate, '/')} />} />
      <div className="px-4 lg:max-w-2xl lg:px-0">
        <div className="pt-2 pb-5">
          <h1 className="text-display font-extrabold">Essentials</h1>
          <p className="text-ink-2 mt-1 text-[16px]" aria-live="polite">
            {active.length === 0 ? (
              'Everything’s stocked'
            ) : (
              <>
                <span className="text-ink font-semibold tabular-nums">
                  <AnimatedNumber value={active.length} />
                </span>{' '}
                needed{getting > 0 ? ` · ${getting} being picked up` : ''}
              </>
            )}
          </p>
        </div>

        <EssentialQuickAdd />

        <div className="mt-6">
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'needed', label: 'To get', count: active.length },
              { value: 'stocked', label: 'Stocked', count: stocked.length },
              ...(archived.length ? [{ value: 'archived' as const, label: 'Archived', count: archived.length }] : []),
            ]}
          />
        </div>

        {status === 'loading' && essentials.length === 0 ? (
          <div className="py-10 text-center">
            <Spinner label="Loading essentials" />
          </div>
        ) : status === 'error' ? (
          <ErrorPanel message={error ?? 'Couldn’t load essentials.'} onRetry={() => void reload()} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} initial={{ opacity: 0, y: level === 'reduced' ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRINGS[level].snappy}>
              {list.length === 0 ? (
                <EmptyEssentials view={view} />
              ) : (
                <ul className="mt-2" aria-label={view === 'needed' ? 'Essentials to get' : view === 'stocked' ? 'Stocked essentials' : 'Archived essentials'}>
                  <AnimatePresence initial={false}>
                    {list.map((e) => (
                      <EssentialItem key={e.id} essential={e} onOpen={setOpen} />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <EssentialSheet essential={open} onClose={() => setOpen(null)} />
    </>
  )
}

function EmptyEssentials({ view }: { view: View }) {
  const level = useMotionLevel()
  const Icon = view === 'archived' ? Archive : PackageCheck
  return (
    <div className="py-12 text-center" data-testid="essentials-empty">
      <motion.span
        className="bg-green-soft text-green-ink mx-auto flex h-16 w-16 items-center justify-center rounded-full"
        initial={level === 'reduced' || level === 'minimal' ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={SPRINGS[level].pop}
      >
        <Icon size={28} aria-hidden />
      </motion.span>
      <p className="mt-4 text-[18px] font-bold">{view === 'needed' ? 'Nothing needed right now' : view === 'stocked' ? 'Nothing stocked yet' : 'Nothing archived'}</p>
      <p className="text-ink-2 mt-1 text-[15px]">
        {view === 'needed' ? 'When something runs out, add it above and a flatmate can grab it.' : 'Restocked essentials wait here until they run out again.'}
      </p>
    </div>
  )
}
