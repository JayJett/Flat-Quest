import { Archive, ArchiveRestore, CalendarDays, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, Field, Segmented } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import type { TaskRow, TaskStatus } from '@/lib/database.types'
import { formatDay, isDay, todayLocal } from '@/lib/dates'
import { useCelebration } from '@/motion/Celebration'
import { rowMotion, SPRINGS } from '@/motion/motion'
import { TickButton } from '@/motion/TickButton'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { dayFromToday, dueLabel } from './living'
import { useLiving } from './LivingProvider'

/** Shared completion flow: confirmed tick, friendly toast with Undo, a burst when the list is clear. */
export function useCompleteTask() {
  const { updateTask, tasks } = useLiving()
  const toast = useToast()
  const celebration = useCelebration()
  return async (task: TaskRow, done: boolean, el?: HTMLElement): Promise<boolean> => {
    const previous = task.status
    const res = await updateTask(task.id, { status: done ? 'done' : 'todo' })
    if (!res.ok) {
      toast.error(res.error)
      return false
    }
    if (done) {
      const othersOpen = tasks.filter((t) => t.id !== task.id && t.status !== 'done' && !t.archived_at).length
      toast.show(othersOpen === 0 ? 'All done. Nice work!' : `Done: ${task.title}`, 'success', {
        label: 'Undo',
        run: () => {
          void updateTask(task.id, { status: previous === 'done' ? 'todo' : previous }).then((r) => {
            if (!r.ok) toast.error(r.error)
          })
        },
      })
      if (othersOpen === 0) celebration.burst(el ?? null)
    }
    return true
  }
}

export function TaskItem({ task, onOpen, showRoom = true }: { task: TaskRow; onOpen: (t: TaskRow) => void; showRoom?: boolean }) {
  const { user } = useAuth()
  const { memberById, rooms } = useHousehold()
  const level = useMotionLevel()
  const complete = useCompleteTask()
  const done = task.status === 'done'
  const assignee = task.assignee_id ? memberById.get(task.assignee_id) : undefined
  const due = done ? null : dueLabel(task.due_on)
  const room = showRoom && task.room_id ? rooms.find((r) => r.id === task.room_id) : undefined
  const meta = [
    task.status === 'doing' ? 'In progress' : null,
    due?.text ?? null,
    room?.name ?? null,
    assignee ? (assignee.userId === user?.id ? 'You' : assignee.profile.display_name) : done ? null : 'Anyone',
  ].filter(Boolean)

  return (
    <motion.li layout={level !== 'reduced'} {...rowMotion(level)} transition={SPRINGS[level].settle} data-testid="task-row" data-status={task.status}>
      <div className="flex min-h-[64px] items-center gap-3 py-1.5">
        <TickButton
          checked={done}
          tone="accent"
          label={done ? `Mark ${task.title} as not done` : `Mark ${task.title} as done`}
          onToggle={(next, el) => complete(task, next, el)}
        />
        <button type="button" onClick={() => onOpen(task)} className="pressable -my-1 min-w-0 flex-1 rounded-xl py-1 text-left">
          <motion.span
            className="block truncate text-[17px] font-semibold"
            initial={false}
            animate={{ opacity: done ? 0.5 : 1 }}
            style={{ textDecoration: done ? 'line-through' : 'none' }}
          >
            {task.title}
          </motion.span>
          {meta.length > 0 && (
            <span className="text-ink-2 block truncate text-[14px]">
              {meta.map((m, i) => (
                <span key={i} className={m === due?.text && due?.tone === 'overdue' ? 'text-danger font-semibold' : m === 'In progress' ? 'text-ink font-semibold' : ''}>
                  {i > 0 ? ' · ' : ''}
                  {m}
                </span>
              ))}
            </span>
          )}
        </button>
        {assignee && <Avatar profile={assignee.profile} size={30} decorative />}
      </div>
    </motion.li>
  )
}

type When = 'none' | 'today' | 'tomorrow' | 'weekend' | 'pick'

function weekend(now: Date = new Date()): string {
  const day = now.getDay()
  const toSaturday = day === 6 ? 0 : day === 0 ? 6 : 6 - day
  return dayFromToday(toSaturday, now)
}

/** Who and when, chosen with large tap targets. Used by quick add and the task sheet. */
function WhoPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { user } = useAuth()
  const { members } = useHousehold()
  const ordered = [...members].sort((a, b) => (a.userId === user?.id ? -1 : b.userId === user?.id ? 1 : 0))
  return (
    <div role="radiogroup" aria-label="Who" className="no-scrollbar chip-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <Chip selected={value === null} onClick={() => onChange(null)}>
        Anyone
      </Chip>
      {ordered.map((m) => (
        <Chip key={m.userId} selected={value === m.userId} onClick={() => onChange(m.userId)}>
          <Avatar profile={m.profile} size={20} decorative />
          {m.userId === user?.id ? 'Me' : m.profile.display_name}
        </Chip>
      ))}
    </div>
  )
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`pressable inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold whitespace-nowrap transition-colors ${selected ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'}`}
    >
      {children}
    </button>
  )
}

function WhenPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const id = useId()
  const today = todayLocal()
  const tomorrow = dayFromToday(1)
  const sat = weekend()
  const mode: When = !value ? 'none' : value === today ? 'today' : value === tomorrow ? 'tomorrow' : value === sat ? 'weekend' : 'pick'
  const [picking, setPicking] = useState(mode === 'pick')
  return (
    <div>
      <div role="radiogroup" aria-label="When" className="no-scrollbar chip-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip selected={mode === 'none' && !picking} onClick={() => { setPicking(false); onChange(null) }}>No date</Chip>
        <Chip selected={mode === 'today' && !picking} onClick={() => { setPicking(false); onChange(today) }}>Today</Chip>
        <Chip selected={mode === 'tomorrow' && !picking} onClick={() => { setPicking(false); onChange(tomorrow) }}>Tomorrow</Chip>
        {sat !== today && sat !== tomorrow && (
          <Chip selected={mode === 'weekend' && !picking} onClick={() => { setPicking(false); onChange(sat) }}>This weekend</Chip>
        )}
        <Chip selected={mode === 'pick' || picking} onClick={() => setPicking(true)}>
          <CalendarDays size={16} aria-hidden /> Pick a date
        </Chip>
      </div>
      {(picking || mode === 'pick') && (
        <label htmlFor={id} className="mt-2 block">
          <span className="sr-only">Due date</span>
          <input id={id} type="date" className="field" value={value ?? ''} min="2000-01-01" max="2100-12-31" onChange={(e) => onChange(isDay(e.target.value) ? e.target.value : null)} />
        </label>
      )}
    </div>
  )
}

/** Quick add: just the words, plus optional who/when chips. Enter saves. */
export function TaskQuickAdd({ autoFocus, onAdded, defaultMine }: { autoFocus?: boolean; onAdded?: () => void; defaultMine?: boolean }) {
  const { user } = useAuth()
  const { addTask } = useLiving()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [who, setWho] = useState<string | null>(defaultMine ? (user?.id ?? null) : null)
  const [when, setWhen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (busy || !title.trim()) return
    setBusy(true)
    const res = await addTask({ title, assignee_id: who, due_on: when })
    setBusy(false)
    if (!res.ok) return toast.error(res.error)
    toast.success('Task added')
    setTitle('')
    setWhen(null)
    onAdded?.()
  }
  return (
    <form
      data-testid="task-quick-add"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex gap-2">
        <input
          className="field"
          value={title}
          maxLength={120}
          autoFocus={autoFocus}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="New task"
          enterKeyHint="done"
        />
        <Button type="submit" loading={busy} disabled={!title.trim()} className="shrink-0" icon={<Plus size={20} aria-hidden />}>
          Add
        </Button>
      </div>
      <WhoPicker value={who} onChange={setWho} />
      <WhenPicker value={when} onChange={setWhen} />
    </form>
  )
}

export function TaskSheet({ task, onClose }: { task: TaskRow | null; onClose: () => void }) {
  return (
    <Sheet open={task !== null} onClose={onClose} title="Task">
      {task && <TaskDetails key={task.id} id={task.id} onClose={onClose} />}
    </Sheet>
  )
}

function TaskDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { rooms } = useHousehold()
  const { tasks, updateTask } = useLiving()
  const toast = useToast()
  const complete = useCompleteTask()
  const t = tasks.find((x) => x.id === id)
  const ids = { title: useId(), notes: useId(), room: useId() }
  const [title, setTitle] = useState(t?.title ?? '')
  const [notes, setNotes] = useState(t?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  if (!t) return <p className="text-ink-2 py-6">This task is no longer here.</p>
  const dirty = title.trim() !== t.title || (notes.trim() || null) !== (t.notes ?? null)

  const patch = async (p: Parameters<typeof updateTask>[1]) => {
    const res = await updateTask(t.id, p)
    if (!res.ok) toast.error(res.error)
    return res.ok
  }

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        label="Status"
        value={t.status}
        onChange={(s: TaskStatus) => (s === 'done' ? void complete(t, true) : void patch({ status: s }))}
        options={[
          { value: 'todo', label: 'To do' },
          { value: 'doing', label: 'In progress' },
          { value: 'done', label: 'Done' },
        ]}
      />
      <Field label="Task" htmlFor={ids.title}>
        <input id={ids.title} className="field font-semibold" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div>
        <p className="mb-2 text-[15px] font-semibold">Who’s doing it</p>
        <WhoPicker value={t.assignee_id} onChange={(v) => void patch({ assignee_id: v })} />
      </div>
      <div>
        <p className="mb-2 text-[15px] font-semibold">When</p>
        <WhenPicker value={t.due_on} onChange={(v) => void patch({ due_on: v })} />
      </div>
      <Field label="Room" htmlFor={ids.room}>
        <select id={ids.room} className="field appearance-none" value={t.room_id ?? ''} onChange={(e) => void patch({ room_id: e.target.value || null })}>
          <option value="">No room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes" htmlFor={ids.notes}>
        <textarea id={ids.notes} className="field min-h-20 resize-y" value={notes} maxLength={1000} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {dirty && (
        <Button
          loading={saving}
          disabled={!title.trim()}
          className="self-start"
          onClick={async () => {
            setSaving(true)
            const ok = await patch({ title: title.trim(), notes: notes.trim() || null })
            setSaving(false)
            if (ok) toast.success('Saved')
          }}
        >
          Save changes
        </Button>
      )}
      {t.archived_at ? (
        <Button variant="ghost" block icon={<ArchiveRestore size={18} aria-hidden />} onClick={() => void patch({ archived_at: null })}>
          Restore task
        </Button>
      ) : (
        <Button variant="ghost" block className="text-ink-2" icon={<Archive size={18} aria-hidden />} onClick={() => setArchiving(true)}>
          Archive task
        </Button>
      )}
      <ConfirmSheet
        open={archiving}
        title="Archive this task?"
        body="It leaves everyone’s list. Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={async () => {
          const ok = await patch({ archived_at: new Date().toISOString() })
          setArchiving(false)
          if (ok) {
            toast.show('Task archived')
            onClose()
          }
        }}
        onClose={() => setArchiving(false)}
      />
    </div>
  )
}

/** A row in the archive: what it was, when it was put away, and a one-tap Restore. */
export function ArchivedTaskItem({ task, onOpen }: { task: TaskRow; onOpen: (t: TaskRow) => void }) {
  const { memberById } = useHousehold()
  const { updateTask } = useLiving()
  const toast = useToast()
  const level = useMotionLevel()
  const [busy, setBusy] = useState(false)
  const who = task.assignee_id ? memberById.get(task.assignee_id)?.profile.display_name : null
  const meta = [
    task.archived_at ? `Archived ${formatDay(todayLocal(new Date(task.archived_at))) || ''}` : 'Archived',
    task.status === 'done' && task.completed_at ? `done ${formatDay(todayLocal(new Date(task.completed_at)))}` : 'not done',
    who ? `for ${who}` : null,
  ].filter(Boolean)
  return (
    <motion.li layout={level !== 'reduced'} {...rowMotion(level)} transition={SPRINGS[level].settle} data-testid="archived-task-row">
      <div className="flex min-h-[64px] items-center gap-3 py-1.5">
        <span className="bg-surface-2 text-ink-2 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full" aria-hidden>
          <Archive size={15} />
        </span>
        <button type="button" onClick={() => onOpen(task)} className="pressable -my-1 min-w-0 flex-1 rounded-xl py-1 text-left">
          <span className="text-ink-2 block truncate text-[17px] font-semibold">{task.title}</span>
          <span className="text-ink-2 block truncate text-[14px]">{meta.join(' · ')}</span>
        </button>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          icon={<ArchiveRestore size={16} aria-hidden />}
          aria-label={`Restore ${task.title}`}
          onClick={async () => {
            setBusy(true)
            const res = await updateTask(task.id, { archived_at: null })
            setBusy(false)
            if (!res.ok) return toast.error(res.error)
            toast.success(`${task.title} is back on the list`)
          }}
        >
          Restore
        </Button>
      </div>
    </motion.li>
  )
}
