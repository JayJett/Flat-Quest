import type { HouseholdRow, ItemRow, ProfileRow, RoomRow } from './database.types'

export const PRIORITIES = ['must_have', 'nice_to_have', 'maybe_later'] as const
export type Priority = (typeof PRIORITIES)[number]

export const STATUSES = ['to_decide', 'bringing', 'need_to_buy', 'shopping', 'ordered', 'not_needed'] as const
export type Status = (typeof STATUSES)[number]

export const RESPONSIBILITIES = ['unclaimed', 'member', 'shared'] as const
export type Responsibility = (typeof RESPONSIBILITIES)[number]

export const OWNERSHIPS = ['to_decide', 'member', 'shared', 'landlord'] as const
export type Ownership = (typeof OWNERSHIPS)[number]

export const PRIORITY_LABEL: Record<Priority, string> = {
  must_have: 'Must-have',
  nice_to_have: 'Nice to have',
  maybe_later: 'Maybe later',
}

export const STATUS_LABEL: Record<Status, string> = {
  to_decide: 'To decide',
  bringing: 'Bringing',
  need_to_buy: 'Need to buy',
  shopping: 'Shopping',
  ordered: 'Ordered',
  not_needed: 'Not needed',
}

export const OWNERSHIP_LABEL: Record<Ownership, string> = {
  to_decide: 'To decide',
  member: 'A flatmate',
  shared: 'Shared',
  landlord: 'Landlord',
}

export type Profile = ProfileRow
export type Household = HouseholdRow
export type Room = RoomRow
export interface Item extends Omit<ItemRow, 'priority' | 'status' | 'responsibility' | 'ownership'> {
  priority: Priority
  status: Status
  responsibility: Responsibility
  ownership: Ownership
}

export interface Member {
  userId: string
  role: 'owner' | 'member'
  joinedAt: string
  profile: Profile
}

export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v)
}
export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

/** Normalises a raw DB row into the strongly typed Item, tolerating unknown values. */
export function toItem(row: ItemRow): Item {
  return {
    ...row,
    estimated_price: row.estimated_price == null ? null : Number(row.estimated_price),
    actual_price: row.actual_price == null ? null : Number(row.actual_price),
    priority: isPriority(row.priority) ? row.priority : 'must_have',
    status: isStatus(row.status) ? row.status : 'to_decide',
    responsibility: (RESPONSIBILITIES as readonly string[]).includes(row.responsibility)
      ? (row.responsibility as Responsibility)
      : 'unclaimed',
    ownership: (OWNERSHIPS as readonly string[]).includes(row.ownership)
      ? (row.ownership as Ownership)
      : 'to_decide',
  }
}

export const PRIORITY_RANK: Record<Priority, number> = { must_have: 0, nice_to_have: 1, maybe_later: 2 }
export const STATUS_RANK: Record<Status, number> = {
  to_decide: 0,
  need_to_buy: 1,
  shopping: 2,
  bringing: 3,
  ordered: 4,
  not_needed: 5,
}
