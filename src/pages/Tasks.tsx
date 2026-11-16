import { Archive, ListChecks } from 'lucide-react'
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
import { ArchivedTaskItem, TaskItem, TaskQuickAdd, TaskSheet } from '@/living/TaskParts'
import { SPRINGS } from '@/motion/motion'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { BackButton, goBack } from './RoomDetail'

type View = 'open' | 'mine' | 'done' | 'archived'
const ORDER: TaskGroup[] = ['overdue', 'today', 'soon', 'later', 'someday']

/** Things to do around the flat: simple tasks with a person and maybe a day. */
export function TasksPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const level = useMotionLevel()
  const { status, error, tasks, reload, loadArchivedTasks } = useLiving()
  const [view, setView] = useState<View>('open')
  const [archiveState, setArchiveState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [archiveAttempt, setArchiveAttempt] = useState(0)
  const openArchive = () => {
    setView('archived')
    setArchiveAttempt((n) => n + 1)
  }
  // Archived tasks aren't part of the everyday load; fetch them whenever the archive opens.
  useEffect(() => {
    if (view !== 'archived') return
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows progress for the fetch below
    setArchiveState('loading')
    void loadArchivedTasks().then((res) => {
      if (active) setArchiveState(res.ok ? 'ready' : 'error')
    })
    return () => {
      active = false
    }
  }, [view, archiveAttempt, loadArchivedTasks])
  const [open, setOpen] = useState<TaskRow | null>(null)
  const [params, setParams] = useSearchParams()
  const wanted = params.get('task')

  useEffect(() => {
    if (!wanted || status !== 'ready') return
    const t = tasks.find((x) => x.id === wanted)
    /* eslint-disable react-hooks/set-state-in-effect -- consuming a one-off URL parameter */
    if (t) {
      setOpen(t)
      if (t.archived_at) openArchive()
      else setView(t.status === 'done' ? 'done' : 'open')
    } else toast.show('That task is no longer here.')
    /* eslint-enable react-hooks/set-state-in-effect */
    setParams({}, { replace: true })
  }, [wanted, status, tasks, setParams, toast])

  const live = useMemo(() => tasks.filter((t) => !t.archived_at), [tasks])
  const openTasks = useMemo(() => sortTasks(live.filter((t) => t.status !== 'done')), [live])
  const mine = openTasks.filter((t) => t.assignee_id === user?.id)
  const done = useMemo(() => live.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')), [live])
  const archived = useMemo(() => tasks.filter((t) => t.archived_at).sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? '')), [tasks])
  const list = view === 'open' ? openTasks : view === 'mine' ? mine : view === 'done' ? done : archived
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
          {view === 'archived' ? (
            <div className="flex min-h-11 items-center justify-between gap-3">
              <h2 className="text-title font-bold">Archived</h2>
              <button type="button" onClick={() => setView('open')} className="pressable text-accent-ink min-h-11 rounded-xl px-2 font-bold">
                Back to tasks
              </button>
            </div>
          ) : (
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
          )}
        </div>

        {view === 'archived' ? (
          <motion.div key="archived" initial={{ opacity: 0, y: level === 'reduced' ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRINGS[level].snappy}>
            <p className="text-ink-2 mt-1 text-[14px]">Put away, not deleted. Restore anything to bring it back to the list.</p>
            {archiveState === 'loading' && archived.length === 0 ? (
              <div className="py-10 text-center">
                <Spinner label="Loading archived tasks" />
              </div>
            ) : archiveState === 'error' ? (
              <ErrorPanel message="Couldn’t load archived tasks." onRetry={() => openArchive()} />
            ) : archived.length === 0 ? (
              <p className="text-ink-2 py-10 text-center text-[15px]" data-testid="archive-empty">
                Nothing archived. Archive a task from its details when it no longer applies.
              </p>
            ) : (
              <ul className="mt-2" aria-label="Archived tasks">
                <AnimatePresence initial={false}>
                  {archived.map((t) => (
                    <ArchivedTaskItem key={t.id} task={t} onOpen={setOpen} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </motion.div>
        ) : status === 'loading' && tasks.length === 0 ? (
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
      {view !== 'archived' && (
        <div className="mt-8 flex justify-center px-4">
          <button type="button" onClick={() => openArchive()} className="pressable text-ink-2 active:bg-surface-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[15px] font-semibold">
            <Archive size={17} aria-hidden />
            Archived tasks
          </button>
        </div>
      )}
      <TaskSheet task={open} onClose={() => setOpen(null)} />
    </>
  )
}
