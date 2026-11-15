import { ListChecks } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/AppShell'
import { useToast } from '@/components/Toast'
import { AnimatedNumber, ErrorPanel, Segmented, Spinner } from '@/components/ui'
import type { TaskRow } from '@/lib/database.types'
import { sortTasks, TASK_GROUP_LABEL, taskGroup, type TaskGroup } from '@/living/living'
import { useLiving } from '@/living/LivingProvider'
import { TaskItem, TaskQuickAdd, TaskSheet } from '@/living/TaskParts'
import { SPRINGS } from '@/motion/motion'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { BackButton, goBack } from './RoomDetail'

type View = 'open' | 'mine' | 'done'
const ORDER: TaskGroup[] = ['overdue', 'today', 'soon', 'later', 'someday']

/** Things to do around the flat: simple tasks with a person and maybe a day. */
export function TasksPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const level = useMotionLevel()
  const { status, error, tasks, reload } = useLiving()
  const [view, setView] = useState<View>('open')
  const [open, setOpen] = useState<TaskRow | null>(null)
  const [params, setParams] = useSearchParams()
  const wanted = params.get('task')

  useEffect(() => {
    if (!wanted || status !== 'ready') return
    const t = tasks.find((x) => x.id === wanted)
    /* eslint-disable react-hooks/set-state-in-effect -- consuming a one-off URL parameter */
    if (t && !t.archived_at) {
      setOpen(t)
      setView(t.status === 'done' ? 'done' : 'open')
    } else toast.show('That task has been archived or is no longer here.')
    /* eslint-enable react-hooks/set-state-in-effect */
    setParams({}, { replace: true })
  }, [wanted, status, tasks, setParams, toast])

  const live = useMemo(() => tasks.filter((t) => !t.archived_at), [tasks])
  const openTasks = useMemo(() => sortTasks(live.filter((t) => t.status !== 'done')), [live])
  const mine = openTasks.filter((t) => t.assignee_id === user?.id)
  const done = useMemo(() => live.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')), [live])
  const list = view === 'open' ? openTasks : view === 'mine' ? mine : done
  const groups = view === 'done' ? [{ key: 'done', label: 'Recently done', tasks: done }] : ORDER.map((g) => ({ key: g, label: TASK_GROUP_LABEL[g], tasks: list.filter((t) => taskGroup(t) === g) })).filter((g) => g.tasks.length)

  return (
    <>
      <PageHeader title="Things to do" hideTitleUntilScroll back={<BackButton onClick={() => goBack(navigate, '/')} />} />
      <div className="px-4 lg:max-w-2xl lg:px-0">
        <div className="pt-2 pb-5">
          <h1 className="text-display font-extrabold">Things to do</h1>
          <p className="text-ink-2 mt-1 text-[16px]" aria-live="polite">
            {openTasks.length === 0 ? (
              'Nothing waiting'
            ) : (
              <>
                <span className="text-ink font-semibold tabular-nums">
                  <AnimatedNumber value={openTasks.length} />
                </span>{' '}
                to do{mine.length ? ` · ${mine.length} for you` : ''}
              </>
            )}
          </p>
        </div>

        <TaskQuickAdd />

        <div className="mt-6">
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'open', label: 'To do', count: openTasks.length },
              { value: 'mine', label: 'Mine', count: mine.length },
              { value: 'done', label: 'Done', count: done.length },
            ]}
          />
        </div>

        {status === 'loading' && tasks.length === 0 ? (
          <div className="py-10 text-center">
            <Spinner label="Loading tasks" />
          </div>
        ) : status === 'error' ? (
          <ErrorPanel message={error ?? 'Couldn’t load tasks.'} onRetry={() => void reload()} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} initial={{ opacity: 0, y: level === 'reduced' ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRINGS[level].snappy}>
              {list.length === 0 ? (
                <div className="py-12 text-center" data-testid="tasks-empty">
                  <motion.span
                    className="bg-accent-soft text-accent-ink mx-auto flex h-16 w-16 items-center justify-center rounded-full"
                    initial={level === 'reduced' || level === 'minimal' ? false : { scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={SPRINGS[level].pop}
                  >
                    <ListChecks size={28} aria-hidden />
                  </motion.span>
                  <p className="mt-4 text-[18px] font-bold">{view === 'done' ? 'Nothing finished lately' : view === 'mine' ? 'Nothing on your plate' : 'All caught up'}</p>
                  <p className="text-ink-2 mt-1 text-[15px]">{view === 'done' ? 'Finished tasks show here for two weeks.' : 'Add anything the flat needs doing above.'}</p>
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.key} aria-label={g.label} className="mt-4">
                    <h2 className={`mb-1 text-[14px] font-bold ${g.key === 'overdue' ? 'text-danger' : 'text-ink-2'}`}>
                      {g.label} <span className="font-medium tabular-nums">· {g.tasks.length}</span>
                    </h2>
                    <ul>
                      <AnimatePresence initial={false}>
                        {g.tasks.map((t) => (
                          <TaskItem key={t.id} task={t} onOpen={setOpen} />
                        ))}
                      </AnimatePresence>
                    </ul>
                  </section>
                ))
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <TaskSheet task={open} onClose={() => setOpen(null)} />
    </>
  )
}
