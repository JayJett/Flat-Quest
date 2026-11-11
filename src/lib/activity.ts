import type { Item } from './domain'
import type { WishlistItemRow } from './database.types'

export type ActivityIdea = Pick<WishlistItemRow, 'id' | 'title' | 'created_at' | 'created_by' | 'import_key'>
export interface ActivityEntry { id: string; actor: string | null; title: string; at: string; kind: 'ready' | 'idea'; roomId?: string }

/** A small view of current records, not a permanent audit log. Imports aren't personal activity. */
export function recentActivity(items: readonly Item[], ideas: readonly ActivityIdea[], limit = 5): ActivityEntry[] {
  const completions: ActivityEntry[] = items
    .filter((i) => i.is_complete && i.completed_at && i.status !== 'not_needed')
    .map((i) => ({ id: `item:${i.id}`, actor: i.completed_by, title: i.name, at: i.completed_at!, kind: 'ready', roomId: i.room_id }))
  const additions: ActivityEntry[] = ideas.filter((i) => !i.import_key)
    .map((i) => ({ id: `idea:${i.id}`, actor: i.created_by, title: i.title, at: i.created_at, kind: 'idea' }))
  return [...completions, ...additions].filter((entry) => Number.isFinite(Date.parse(entry.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)).slice(0, limit)
}
