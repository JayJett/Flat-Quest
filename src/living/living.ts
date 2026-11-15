import type { EssentialRow, TaskRow } from '@/lib/database.types'
import { daysBetween, formatDay, parseDay, todayLocal, type Day } from '@/lib/dates'

// ----------------------------------------------------------------- Essentials

export type EssentialCategory = NonNullable<EssentialRow['category']>
export const ESSENTIAL_CATEGORIES: { key: EssentialCategory; label: string }[] = [
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'laundry', label: 'Laundry' },
  { key: 'cleaning', label: 'Cleaning' },
  { key: 'other', label: 'Other' },
]

/** Common things flats run out of, offered as one-tap suggestions. */
export const ESSENTIAL_SUGGESTIONS: { name: string; category: EssentialCategory }[] = [
  { name: 'Toilet paper', category: 'bathroom' },
  { name: 'Dishwashing liquid', category: 'kitchen' },
  { name: 'Washing powder', category: 'laundry' },
  { name: 'Rubbish bags', category: 'kitchen' },
  { name: 'Paper towels', category: 'kitchen' },
  { name: 'Sponges', category: 'kitchen' },
  { name: 'Dishwasher tablets', category: 'kitchen' },
  { name: 'Hand soap', category: 'bathroom' },
  { name: 'Spray cleaner', category: 'cleaning' },
  { name: 'Bin liners', category: 'kitchen' },
  { name: 'Cling wrap', category: 'kitchen' },
  { name: 'Tissues', category: 'bathroom' },
  { name: 'Light bulbs', category: 'other' },
  { name: 'Batteries', category: 'other' },
]

/** Same normalisation as the database's `name_key`, so duplicates are caught before saving. */
export function essentialKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type EssentialMatch =
  | { kind: 'none' }
  | { kind: 'active'; essential: EssentialRow }
  | { kind: 'stocked'; essential: EssentialRow }
  | { kind: 'archived'; essential: EssentialRow }

/** What adding `name` should do: create it, or bring back the one we already have. */
export function matchEssential(name: string, essentials: readonly EssentialRow[]): EssentialMatch {
  const key = essentialKey(name)
  if (!key) return { kind: 'none' }
  const live = essentials.find((e) => !e.archived_at && essentialKey(e.name) === key)
  if (live) return live.status === 'stocked' ? { kind: 'stocked', essential: live } : { kind: 'active', essential: live }
  const archived = essentials.find((e) => e.archived_at && essentialKey(e.name) === key)
  return archived ? { kind: 'archived', essential: archived } : { kind: 'none' }
}

/**
 * Autocomplete while typing: the flat's own essentials first (so "Toi" offers "Toilet paper —
 * Need again"), then common suggestions not already being tracked.
 */
export function essentialSuggestions(query: string, essentials: readonly EssentialRow[], limit = 6) {
  const q = essentialKey(query)
  const own = essentials
    .filter((e) => e.status === 'stocked' || e.archived_at)
    .filter((e) => !q || essentialKey(e.name).includes(q))
    .sort((a, b) => (b.restocked_at ?? '').localeCompare(a.restocked_at ?? ''))
    .map((e) => ({ name: e.name, category: e.category, existing: e }))
  const tracked = new Set(essentials.filter((e) => !e.archived_at).map((e) => essentialKey(e.name)))
  const common = ESSENTIAL_SUGGESTIONS.filter((s) => !tracked.has(essentialKey(s.name)) && (!q || essentialKey(s.name).includes(q))).map((s) => ({
    ...s,
    existing: null as EssentialRow | null,
  }))
  const seen = new Set<string>()
  return [...own, ...common]
    .filter((s) => {
      const k = essentialKey(s.name)
      if (seen.has(k) || k === q) return false
      seen.add(k)
      return true
    })
    .slice(0, limit)
}

export const isActiveEssential = (e: Pick<EssentialRow, 'status' | 'archived_at'>) => !e.archived_at && e.status !== 'stocked'

/** Active first (needed before being-got), then by name. */
export function sortEssentials(list: readonly EssentialRow[]): EssentialRow[] {
  const rank = { needed: 0, getting: 1, stocked: 2 } as const
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name))
}

// ----------------------------------------------------------------- Tasks

export const TASK_STATUS_LABEL: Record<TaskRow['status'], string> = { todo: 'To do', doing: 'In progress', done: 'Done' }

/**
 * Due dates in people's words, computed on the device's own calendar (never via UTC):
 * "Overdue", "Today", "Tomorrow", "Friday", "20 Nov".
 */
export function dueLabel(due: Day | null | undefined, today: Day = todayLocal()): { text: string; tone: 'overdue' | 'soon' | 'later' } | null {
  if (!due || !parseDay(due)) return null
  const diff = daysBetween(today, due)
  if (diff === null) return null
  if (diff < 0) return { text: diff === -1 ? 'Overdue · yesterday' : `Overdue · ${formatDay(due, today)}`, tone: 'overdue' }
  if (diff === 0) return { text: 'Today', tone: 'soon' }
  if (diff === 1) return { text: 'Tomorrow', tone: 'soon' }
  if (diff < 7) {
    const p = parseDay(due)!
    return { text: new Date(p.y, p.m - 1, p.d).toLocaleDateString('en-NZ', { weekday: 'long' }), tone: 'later' }
  }
  return { text: formatDay(due, today), tone: 'later' }
}

/** A calendar date `n` days from today on this device. */
export function dayFromToday(n: number, now: Date = new Date()): Day {
  return todayLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
}

export type TaskGroup = 'overdue' | 'today' | 'soon' | 'later' | 'someday'
export const TASK_GROUP_LABEL: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  soon: 'This week',
  later: 'Later',
  someday: 'Whenever',
}

export function taskGroup(task: Pick<TaskRow, 'due_on'>, today: Day = todayLocal()): TaskGroup {
  if (!task.due_on) return 'someday'
  const diff = daysBetween(today, task.due_on)
  if (diff === null) return 'someday'
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff < 7) return 'soon'
  return 'later'
}

/** Open tasks: by due date (undated last), in-progress before to-do on the same day. */
export function sortTasks(list: readonly TaskRow[]): TaskRow[] {
  return [...list].sort(
    (a, b) =>
      (a.due_on ?? '9999-12-31').localeCompare(b.due_on ?? '9999-12-31') ||
      (a.status === 'doing' ? 0 : 1) - (b.status === 'doing' ? 0 : 1) ||
      a.created_at.localeCompare(b.created_at),
  )
}

/** Tasks that genuinely need attention today: overdue, due today, or in progress. */
export function needsAttention(task: TaskRow, today: Day = todayLocal()): boolean {
  if (task.status === 'done' || task.archived_at) return false
  const g = taskGroup(task, today)
  return g === 'overdue' || g === 'today' || task.status === 'doing'
}
