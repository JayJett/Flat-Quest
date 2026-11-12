export type VisualKind = 'inspiration' | 'photo'
export type Visual = {
  id: string; household_id: string; room_id: string; kind: VisualKind
  photo_path: string | null; thumbnail_path: string | null
  title: string | null; notes: string | null; source_url: string | null; taken_on: string | null
  sort_order: number; created_by: string | null; created_at: string; updated_at: string
}
export type Transformation = {
  id: string; household_id: string; room_id: string; before_id: string; after_id: string
  title: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string
}
export function safeSource(value: string): string | null {
  if (!value.trim()) return null
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 1000) throw new Error('Use a full http or https link.')
  return url.href
}
/** A one-row move avoids partially saved reorders. */
export function movedOrder(rows: Visual[], index: number, direction: -1 | 1): number {
  const target = index + direction
  if (target < 0 || target >= rows.length) return rows[index]!.sort_order
  if (direction < 0) return target === 0 ? rows[0]!.sort_order - 1024 : (rows[target - 1]!.sort_order + rows[target]!.sort_order) / 2
  return target === rows.length - 1 ? rows[target]!.sort_order + 1024 : (rows[target]!.sort_order + rows[target + 1]!.sort_order) / 2
}

