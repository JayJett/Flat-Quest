import type { Item } from './domain'
import { progressOf } from './stats'

/** Only a confirmed new completion can celebrate; loading/filtering/deleting cannot. */
export function completionMilestone(before: readonly Item[], saved: Item): number | null {
  const previous = before.find((item) => item.id === saved.id)
  if (!previous || previous.is_complete || !saved.is_complete || saved.status === 'not_needed' || previous.room_id !== saved.room_id) return null
  const room = before.filter((item) => item.room_id === saved.room_id)
  const oldProgress = progressOf(room)
  const nextProgress = progressOf(room.map((item) => item.id === saved.id ? saved : item))
  if (!nextProgress.total || oldProgress.total !== nextProgress.total) return null
  return [100, 75, 50, 25].find((mark) => oldProgress.ratio * 100 < mark && nextProgress.ratio * 100 >= mark) ?? null
}
