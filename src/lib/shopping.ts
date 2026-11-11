import type { ItemPurchaseRow, ProductOptionRow, ProductPreferenceRow, PurchaseCoordinatorRow, RoomRow } from './database.types'
import { daysBetween, friendlyDay, type Day } from './dates'
import { PRIORITY_RANK, type Item, type Priority, type Status } from './domain'

/**
 * Shopping is a view over the existing checklist, not a second list. Everything
 * here is derived from an item's status, completion, purchase record and options.
 */
export const PURCHASE_STAGES = ['need_to_buy', 'shopping', 'ordered', 'on_the_way', 'ready_to_collect', 'delivered'] as const
export type PurchaseStage = (typeof PURCHASE_STAGES)[number]

/** The sections of the Shopping screen. `recent` = bought and now in the flat. */
export type ShoppingGroup = PurchaseStage | 'recent'
export const SHOPPING_GROUPS: ShoppingGroup[] = [...PURCHASE_STAGES, 'recent']

export const GROUP_LABEL: Record<ShoppingGroup, string> = {
  need_to_buy: 'Need to buy',
  shopping: 'Looking around',
  ordered: 'Ordered',
  on_the_way: 'On the way',
  ready_to_collect: 'Ready to collect',
  delivered: 'Delivered, not set up yet',
  recent: 'Recently bought',
}

/** How long a bought item stays under "Recently bought". */
export const RECENT_DAYS = 14

export type ProductOption = ProductOptionRow
export type Purchase = ItemPurchaseRow

export function isPurchaseStage(status: Status | string): status is PurchaseStage {
  return (PURCHASE_STAGES as readonly string[]).includes(status)
}

/** Has someone recorded anything that says this was actually bought? */
export function hasPurchaseEvidence(item: Pick<Item, 'status' | 'actual_price'>, purchase?: Purchase | null): boolean {
  return (
    isPurchaseStage(item.status) ||
    item.actual_price != null ||
    Boolean(purchase && (purchase.purchased_on || purchase.purchased_by || purchase.order_reference || purchase.option_id))
  )
}

/**
 * Which Shopping section an item belongs in, or null when it isn't a shopping matter:
 * not needed, provided with the flat, being brought by someone, still undecided,
 * or finished long ago / never bought.
 */
export function shoppingGroupOf(
  item: Pick<Item, 'status' | 'is_complete' | 'completed_at' | 'actual_price'>,
  purchase?: Purchase | null,
  now: Date = new Date(),
): ShoppingGroup | null {
  if (item.status === 'not_needed' || item.status === 'provided') return null
  if (item.is_complete) {
    if (!hasPurchaseEvidence(item, purchase) || !item.completed_at) return null
    const age = now.getTime() - Date.parse(item.completed_at)
    return Number.isFinite(age) && age <= RECENT_DAYS * 86_400_000 ? 'recent' : null
  }
  return isPurchaseStage(item.status) ? item.status : null
}

export interface ShoppingSummary {
  /** Need to buy + looking around. */
  toBuy: number
  /** Ordered, on the way, ready to collect or delivered but not yet in the flat. */
  inProgress: number
  /** Still "To decide": not something to buy yet, but worth a look. */
  undecided: number
}

export function shoppingSummary(items: readonly Item[]): ShoppingSummary {
  let toBuy = 0
  let inProgress = 0
  let undecided = 0
  for (const item of items) {
    if (item.is_complete) continue
    if (item.status === 'need_to_buy' || item.status === 'shopping') toBuy += 1
    else if (isPurchaseStage(item.status)) inProgress += 1
    else if (item.status === 'to_decide') undecided += 1
  }
  return { toBuy, inProgress, undecided }
}

export function summaryLine(s: ShoppingSummary): string {
  const parts: string[] = []
  if (s.toBuy > 0) parts.push(`${s.toBuy} to buy`)
  if (s.inProgress > 0) parts.push(`${s.inProgress} on order`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------- filters and sorting
export type WhoFilter = 'all' | 'me' | 'none' | (string & {})
/** `active` = everything still being bought; `to_decide` = undecided items (opt-in). */
export type StageFilter = 'active' | ShoppingGroup | 'to_decide'
export type ShoppingSort = 'stage' | 'priority' | 'room' | 'price' | 'name' | 'expected'

export interface ShoppingFilters {
  room: string
  who: WhoFilter
  priority: 'all' | Priority
  stage: StageFilter
}

export const DEFAULT_FILTERS: ShoppingFilters = { room: 'all', who: 'all', priority: 'all', stage: 'active' }

export const SORT_LABEL: Record<ShoppingSort, string> = {
  stage: 'Stage',
  priority: 'Priority',
  room: 'Room',
  price: 'Price, low to high',
  name: 'Name',
  expected: 'Arriving soonest',
}

export function activeFilterCount(f: ShoppingFilters): number {
  return (f.room !== 'all' ? 1 : 0) + (f.who !== 'all' ? 1 : 0) + (f.priority !== 'all' ? 1 : 0) + (f.stage !== 'active' ? 1 : 0)
}

export interface ShoppingContext {
  myId: string
  roomOrder: Map<string, number>
  optionsByItem: Map<string, ProductOption[]>
  purchaseByItem: Map<string, Purchase>
  coordinatorByItem: Map<string, PurchaseCoordinatorRow>
  now?: Date
}

export interface ShoppingEntry {
  item: Item
  group: ShoppingGroup | 'to_decide'
}

export interface ShoppingSection {
  key: string
  label: string
  entries: ShoppingEntry[]
}

function matchesWho(item: Item, who: WhoFilter, ctx: ShoppingContext): boolean {
  if (who === 'all') return true
  if (who === 'none') return item.assignees.length === 0 && !ctx.coordinatorByItem.has(item.id)
  const id = who === 'me' ? ctx.myId : who
  return item.assignees.includes(id) || ctx.coordinatorByItem.get(item.id)?.user_id === id
}

/** The price to compare an item by: the chosen option, else the cheapest option, else the estimate. */
export function comparablePrice(item: Pick<Item, 'id' | 'estimated_price' | 'actual_price'>, options: readonly ProductOption[] = []): number | null {
  if (item.actual_price != null) return item.actual_price
  const selected = options.find((o) => o.is_selected)
  if (selected?.price != null) return selected.price
  const prices = options.map((o) => o.price).filter((p): p is number => p != null)
  if (prices.length > 0) return Math.min(...prices)
  return item.estimated_price
}

/** Items for the Shopping screen, filtered. Undecided items only appear when asked for. */
export function shoppingEntries(items: readonly Item[], filters: ShoppingFilters, ctx: ShoppingContext): ShoppingEntry[] {
  const out: ShoppingEntry[] = []
  for (const item of items) {
    let group: ShoppingEntry['group'] | null = shoppingGroupOf(item, ctx.purchaseByItem.get(item.id), ctx.now)
    if (filters.stage === 'to_decide') {
      if (item.status !== 'to_decide' || item.is_complete) continue
      group = 'to_decide'
    } else {
      if (!group) continue
      if (filters.stage !== 'active' && group !== filters.stage) continue
    }
    if (filters.room !== 'all' && item.room_id !== filters.room) continue
    if (filters.priority !== 'all' && item.priority !== filters.priority) continue
    if (!matchesWho(item, filters.who, ctx)) continue
    out.push({ item, group })
  }
  return out
}

function byText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

/** Nulls last, whichever direction the real values sort in. */
function nullsLast<T>(a: T | null | undefined, b: T | null | undefined, cmp: (a: T, b: T) => number): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return cmp(a, b)
}

export function sortEntries(entries: readonly ShoppingEntry[], sort: ShoppingSort, ctx: ShoppingContext): ShoppingEntry[] {
  const room = (e: ShoppingEntry) => ctx.roomOrder.get(e.item.room_id) ?? 999
  const base = (a: ShoppingEntry, b: ShoppingEntry) =>
    PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority] || room(a) - room(b) || byText(a.item.name, b.item.name)
  const cmp: Record<ShoppingSort, (a: ShoppingEntry, b: ShoppingEntry) => number> = {
    stage: base,
    priority: base,
    room: (a, b) => room(a) - room(b) || base(a, b),
    name: (a, b) => byText(a.item.name, b.item.name),
    price: (a, b) =>
      nullsLast(
        comparablePrice(a.item, ctx.optionsByItem.get(a.item.id)),
        comparablePrice(b.item, ctx.optionsByItem.get(b.item.id)),
        (x, y) => x - y,
      ) || base(a, b),
    expected: (a, b) =>
      nullsLast(ctx.purchaseByItem.get(a.item.id)?.expected_on, ctx.purchaseByItem.get(b.item.id)?.expected_on, (x, y) => x.localeCompare(y)) ||
      base(a, b),
  }
  return [...entries].sort(cmp[sort])
}

/** Sections for display. Sorting by stage groups by purchase stage; every other sort is one flat list. */
export function shoppingSections(entries: readonly ShoppingEntry[], sort: ShoppingSort, ctx: ShoppingContext): ShoppingSection[] {
  const sorted = sortEntries(entries, sort, ctx)
  if (sort !== 'stage') return sorted.length ? [{ key: 'all', label: '', entries: sorted }] : []
  const order: ShoppingEntry['group'][] = [...SHOPPING_GROUPS, 'to_decide']
  return order
    .map((g) => ({
      key: g,
      label: g === 'to_decide' ? 'Still to decide' : GROUP_LABEL[g],
      entries: sorted.filter((e) => e.group === g),
    }))
    .filter((s) => s.entries.length > 0)
}

// ---------------------------------------------------------------- preferences
/** option id → members who prefer it, in the order they chose. */
export function preferenceTally(preferences: readonly ProductPreferenceRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const p of [...preferences].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
    out.set(p.option_id, [...(out.get(p.option_id) ?? []), p.user_id])
  }
  return out
}

/** Options for comparing: the household's pick first, then most preferred, then oldest. */
export function sortOptions(options: readonly ProductOption[], tally: Map<string, string[]>): ProductOption[] {
  return [...options].sort(
    (a, b) =>
      Number(b.is_selected) - Number(a.is_selected) ||
      (tally.get(b.id)?.length ?? 0) - (tally.get(a.id)?.length ?? 0) ||
      a.created_at.localeCompare(b.created_at),
  )
}

// ---------------------------------------------------------------- money and measurements
const nzd0 = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 })
const nzd2 = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "$1,299" or "$49.95": cents only when there are some. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return Number.isInteger(value) ? nzd0.format(value) : nzd2.format(value)
}

/** Parses a price field. Empty = null; anything that isn't a sensible amount = 'invalid'. */
export function parsePrice(v: string): number | null | 'invalid' {
  const t = v.trim().replace(/^(nz)?\$/i, '').replace(/,/g, '').trim()
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalid'
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) return 'invalid'
  return Math.round(n * 100) / 100
}

export const MAX_PRODUCT_CM = 2000
export const MAX_ROOM_CM = 5000
export const MAX_ROOM_HEIGHT_CM = 1000

/** Parses a centimetre field (one decimal place). Empty = unknown (null). */
export function parseCm(v: string, max: number = MAX_PRODUCT_CM): number | null | 'invalid' {
  const t = v.trim().replace(/\s*cm$/i, '').replace(',', '.').trim()
  if (t === '') return null
  if (!/^\d+(\.\d+)?$/.test(t)) return 'invalid'
  const n = Math.round(Number(t) * 10) / 10
  if (!Number.isFinite(n) || n <= 0 || n > max) return 'invalid'
  return n
}

export function formatCm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export interface Dimensions {
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
}

/** "W 220 × D 95 × H 85 cm", leaving out whatever isn't known. Empty when nothing is. */
export function dimensionsLabel(d: Dimensions): string {
  const parts = [
    d.width_cm != null ? `W ${formatCm(d.width_cm)}` : null,
    d.depth_cm != null ? `D ${formatCm(d.depth_cm)}` : null,
    d.height_cm != null ? `H ${formatCm(d.height_cm)}` : null,
  ].filter(Boolean)
  return parts.length ? `${parts.join(' × ')} cm` : ''
}

export type RoomMeasurements = Pick<RoomRow, 'width_cm' | 'length_cm' | 'height_cm' | 'measurement_notes'>

export function roomMeasurementsLabel(room: RoomMeasurements): string {
  const floor =
    room.width_cm != null && room.length_cm != null
      ? `${formatCm(room.width_cm)} × ${formatCm(room.length_cm)} cm`
      : room.width_cm != null
        ? `${formatCm(room.width_cm)} cm wide`
        : room.length_cm != null
          ? `${formatCm(room.length_cm)} cm long`
          : ''
  const height = room.height_cm != null ? `${formatCm(room.height_cm)} cm high` : ''
  return [floor, height].filter(Boolean).join(', ')
}

export interface FitGuidance {
  /** `ok` = comfortably inside the room's floor; `tight` = fits but dominates; `no` = bigger than the room. */
  verdict: 'ok' | 'tight' | 'no'
  text: string
}

export const FIT_CAVEAT = 'A rough guide from the room’s size only. It doesn’t know about doorways, stairs, hallways, corners or which way the furniture faces.'

/**
 * Compares a product's footprint with the room's floor (trying both orientations)
 * and its height with the ceiling. Returns null unless there is enough to compare.
 * Deliberately never says "it will fit": see FIT_CAVEAT.
 */
export function fitGuidance(option: Dimensions, room: RoomMeasurements): FitGuidance | null {
  const { width_cm: w, depth_cm: d, height_cm: h } = option
  const { width_cm: rw, length_cm: rl, height_cm: rh } = room
  const tooTall = h != null && rh != null && h > rh
  if (w != null && d != null && rw != null && rl != null) {
    const [short, long] = w <= d ? [w, d] : [d, w]
    const [roomShort, roomLong] = rw <= rl ? [rw, rl] : [rl, rw]
    if (short > roomShort || long > roomLong) {
      return {
        verdict: 'no',
        text: `Looks too big for the floor: ${formatCm(w)} × ${formatCm(d)} cm against a room of ${formatCm(rw)} × ${formatCm(rl)} cm.`,
      }
    }
    if (tooTall) return { verdict: 'no', text: `Taller than the room: ${formatCm(h)} cm against a ${formatCm(rh)} cm ceiling.` }
    const share = Math.round((long / roomLong) * 100)
    return share >= 80
      ? { verdict: 'tight', text: `It’s within the room’s floor size, but its longest side would take about ${share}% of the longest wall.` }
      : { verdict: 'ok', text: `It’s within the room’s floor size. Its longest side is about ${share}% of the longest wall.` }
  }
  if (h != null && rh != null) {
    return tooTall
      ? { verdict: 'no', text: `Taller than the room: ${formatCm(h)} cm against a ${formatCm(rh)} cm ceiling.` }
      : { verdict: 'ok', text: `It’s under the ceiling height (${formatCm(h)} cm of ${formatCm(rh)} cm).` }
  }
  return null
}

// ---------------------------------------------------------------- copy
export const DELIVERY_METHODS = ['delivery', 'pickup'] as const
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number]
export const DELIVERY_LABEL: Record<DeliveryMethod, string> = { delivery: 'Delivery', pickup: 'Pick-up' }

/** One line about where a purchase is at, for list rows. Empty when there's nothing useful to say. */
export function deliveryLine(item: Pick<Item, 'status' | 'is_complete'>, purchase: Purchase | null | undefined, today: Day): string {
  if (!purchase) return ''
  if (item.is_complete) return purchase.arrived_on ? `Arrived ${friendlyDay(purchase.arrived_on, today)}` : ''
  if (item.status === 'delivered') return purchase.arrived_on ? `Arrived ${friendlyDay(purchase.arrived_on, today)}` : ''
  if (!purchase.expected_on || !isPurchaseStage(item.status) || item.status === 'need_to_buy' || item.status === 'shopping') return ''
  const diff = daysBetween(today, purchase.expected_on)
  const verb = purchase.delivery_method === 'pickup' || item.status === 'ready_to_collect' ? 'Collect' : 'Due'
  if (diff != null && diff < 0) return `Was due ${friendlyDay(purchase.expected_on, today)}`
  return `${verb} ${friendlyDay(purchase.expected_on, today)}`
}

/** "3 options · from $899", "Our pick: Mocka · $899", or '' when there are none. */
export function optionsLine(options: readonly ProductOption[]): string {
  if (options.length === 0) return ''
  const selected = options.find((o) => o.is_selected)
  if (selected) {
    return ['Our pick: ' + (selected.retailer || selected.name), formatPrice(selected.price)].filter(Boolean).join(' · ')
  }
  const prices = options.map((o) => o.price).filter((p): p is number => p != null)
  const count = `${options.length} option${options.length === 1 ? '' : 's'}`
  return prices.length ? `${count} · from ${formatPrice(Math.min(...prices))}` : count
}
