import type { Item, Room } from './domain'

/**
 * Household progress rules (shared by Home, Rooms and Flatmates):
 *  - "Not needed" items are excluded from every count.
 *  - "Ready" means is_complete (physically in the flat). Status never implies completion,
 *    so an "Ordered" item is still outstanding until someone ticks it.
 *  - "Unclaimed" = outstanding and nobody has taken responsibility.
 */
export interface Progress {
  total: number
  ready: number
  outstanding: number
  unclaimed: number
  /** 0–1 */
  ratio: number
}

export function countsTowardProgress(item: Pick<Item, 'status'>): boolean {
  return item.status !== 'not_needed'
}

export function progressOf(items: readonly Item[]): Progress {
  let total = 0
  let ready = 0
  let unclaimed = 0
  for (const item of items) {
    if (!countsTowardProgress(item)) continue
    total += 1
    if (item.is_complete) ready += 1
    else if (item.responsibility === 'unclaimed') unclaimed += 1
  }
  const outstanding = total - ready
  return { total, ready, outstanding, unclaimed, ratio: total === 0 ? 0 : ready / total }
}

export function roomProgress(rooms: readonly Room[], items: readonly Item[]): Map<string, Progress> {
  const byRoom = new Map<string, Item[]>()
  for (const room of rooms) byRoom.set(room.id, [])
  for (const item of items) byRoom.get(item.room_id)?.push(item)
  const out = new Map<string, Progress>()
  for (const [roomId, roomItems] of byRoom) out.set(roomId, progressOf(roomItems))
  return out
}

/** Items a member is responsible for that still need doing. */
export function openItemsFor(userId: string, items: readonly Item[]): Item[] {
  return items.filter(
    (i) => i.responsible_user_id === userId && !i.is_complete && countsTowardProgress(i),
  )
}

export type NextAction =
  | { kind: 'empty' }
  | { kind: 'mine'; count: number }
  | { kind: 'claim'; count: number; mustHaves: number }
  | { kind: 'finish'; count: number }
  | { kind: 'done' }

/** Picks the single most useful thing for the current member to do next. */
export function nextAction(userId: string, items: readonly Item[]): NextAction {
  const progress = progressOf(items)
  if (progress.total === 0) return { kind: 'empty' }
  const mine = openItemsFor(userId, items).length
  if (mine > 0) return { kind: 'mine', count: mine }
  const unclaimed = items.filter(
    (i) => countsTowardProgress(i) && !i.is_complete && i.responsibility === 'unclaimed',
  )
  if (unclaimed.length > 0) {
    return {
      kind: 'claim',
      count: unclaimed.length,
      mustHaves: unclaimed.filter((i) => i.priority === 'must_have').length,
    }
  }
  if (progress.outstanding > 0) return { kind: 'finish', count: progress.outstanding }
  return { kind: 'done' }
}
