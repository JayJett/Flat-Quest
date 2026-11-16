import type { HouseholdEventRow } from './database.types'
import { daysBetween, formatDay, todayLocal } from './dates'

/**
 * One wording for every household event, shared by the notification drawer and the
 * activity timeline. Text is returned as segments (never HTML), so names and titles
 * typed by flatmates are always rendered as plain text.
 */
export type Segment = { text: string; strong?: boolean }

export type EventKind =
  | 'item'
  | 'done'
  | 'stage'
  | 'assign'
  | 'option'
  | 'buy'
  | 'milestone'
  | 'photo'
  | 'idea'
  | 'comment'
  | 'member'
  | 'history'
  | 'essential'
  | 'task'
  | 'reminder'

export interface EventLookup {
  /** Current name for a member (falls back to the name stored with the event). */
  personName: (userId: string | null | undefined) => string | null
  itemName: (itemId: string | null | undefined) => string | null
  roomName: (roomId: string | null | undefined) => string | null
  myId: string | null
}

export interface DescribedEvent {
  segments: Segment[]
  kind: EventKind
  /** In-app destination, or null when the event has nowhere to go. */
  href: string | null
}

const STAGE_LABEL: Record<string, string> = {
  ordered: 'ordered',
  on_the_way: 'on the way',
  ready_to_collect: 'ready to collect',
  delivered: 'delivered',
}

type Data = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Where an event leads. Item-level events open the item; discussions open its discussion. */
export function eventHref(
  e: Pick<HouseholdEventRow, 'type' | 'room_id' | 'item_id' | 'option_id' | 'idea_id' | 'comment_id'> & Partial<Pick<HouseholdEventRow, 'essential_id' | 'task_id'>>,
): string | null {
  if (e.type.startsWith('essential_')) return e.essential_id ? `/essentials?essential=${e.essential_id}` : '/essentials'
  if (e.type.startsWith('task_')) return e.task_id ? `/tasks?task=${e.task_id}` : '/tasks'
  switch (e.type) {
    case 'history_started':
    case 'member_limit_changed':
      return null
    case 'member_joined':
    case 'member_left':
    case 'member_removed':
    case 'ownership_transferred':
      return '/flatmates'
    case 'room_completed':
      return e.room_id ? `/rooms/${e.room_id}` : null
    case 'transformation_added':
    case 'photos_added':
      return e.room_id ? `/rooms/${e.room_id}/visual` : null
    case 'idea_added':
      return e.idea_id ? `/wishlist?idea=${e.idea_id}` : '/wishlist'
  }
  if (e.idea_id) {
    const q = new URLSearchParams({ idea: e.idea_id })
    if (e.comment_id) q.set('discuss', e.comment_id)
    return `/wishlist?${q}`
  }
  if (e.item_id && e.room_id) {
    const q = new URLSearchParams({ item: e.item_id })
    if (e.option_id && (e.type === 'comment_added' || e.type === 'comment_mention' || e.type === 'option_selected' || e.type === 'option_added')) {
      q.set('option', e.option_id)
    }
    if (e.comment_id) q.set('discuss', e.comment_id)
    return `/rooms/${e.room_id}?${q}`
  }
  return e.room_id ? `/rooms/${e.room_id}` : null
}

/**
 * @param reason the notification reason when describing a notification (changes the
 *   wording to "you"); omit for the shared timeline.
 */
export function describeEvent(e: HouseholdEventRow, look: EventLookup, reason?: string): DescribedEvent {
  const d = (e.data ?? {}) as Data
  const actor = look.personName(e.actor_id) ?? str(e.actor_name) ?? 'A flatmate'
  const subject = look.personName(e.subject_id) ?? str(d.subject) ?? 'a flatmate'
  const item = look.itemName(e.item_id) ?? str(d.item) ?? 'an item'
  const room = look.roomName(e.room_id) ?? str(d.room) ?? 'a room'
  const option = str(d.option)
  const idea = str(d.idea) ?? 'an idea'
  const count = num(d.count) ?? 1
  const A: Segment = { text: actor, strong: true }
  const I: Segment = { text: item, strong: true }
  const R: Segment = { text: room, strong: true }
  const href = eventHref(e)
  const t = (text: string): Segment => ({ text })
  const out = (kind: EventKind, ...segments: Segment[]): DescribedEvent => ({ kind, segments, href })

  const target: Segment[] = e.idea_id
    ? [{ text: idea, strong: true }]
    : option
      ? [{ text: option, strong: true }, t(' for '), I]
      : [I]

  switch (e.type) {
    case 'history_started':
      return out('history', t('Flat history starts here'))
    case 'essential_needed':
      return count > 1
        ? out('essential', A, t(` added ${count} things to Essentials`))
        : out('essential', A, t(' says we need '), { text: str(d.essential) ?? 'something', strong: true })
    case 'essential_claimed':
      return out('essential', A, t(reason ? ' is getting the ' : ' is getting '), { text: str(d.essential) ?? 'it', strong: true }, t(reason ? ' you asked for' : ''))
    case 'essential_handover':
      return out('essential', A, t(' asked you to pick up '), { text: str(d.essential) ?? 'something', strong: true })
    case 'essential_takeover':
      return out('essential', A, t(' is getting '), { text: str(d.essential) ?? 'it', strong: true }, t(' instead of you'))
    case 'essential_restocked':
      return out('essential', A, t(' restocked '), { text: str(d.essential) ?? 'something', strong: true }, t(reason ? ' — no need to buy it' : ''))
    case 'task_added':
      return out('task', A, t(' added a task: '), { text: str(d.task) ?? 'a task', strong: true })
    case 'task_assigned':
      return out('task', A, t(' asked you to '), { text: lowerFirst(str(d.task) ?? 'do a task'), strong: true })
    case 'task_unassigned':
      return out('task', A, t(' took you off '), { text: str(d.task) ?? 'a task', strong: true })
    case 'task_completed':
      return out('task', A, t(' finished '), { text: str(d.task) ?? 'a task', strong: true })
    // Reminders come from the flat, not a person, and are worded as a friendly nudge.
    case 'task_reminder':
      return num(d.stage) === 2
        ? out('reminder', t('Still on your list: '), { text: str(d.task) ?? 'a task', strong: true }, t('. Need a hand, or a new date?'))
        : out('reminder', t('Friendly nudge: '), { text: str(d.task) ?? 'your task', strong: true }, t(' was due ' + dueWords(str(d.due)) + '.'))
    case 'essential_reminder':
      return out('reminder', { text: str(d.essential) ?? 'Something', strong: true }, t(` has been on the list for ${num(d.days) ?? 3} days. Still need it?`))
    case 'item_added':
      return count > 1 ? out('item', A, t(` added ${count} items to `), R) : out('item', A, t(' added '), I, t(' to '), R)
    case 'item_completed':
      return out('done', A, t(' marked '), I, t(' as in the flat'))
    case 'purchase_stage':
      return out('stage', A, t(' marked '), I, t(` as ${STAGE_LABEL[str(d.stage) ?? ''] ?? 'updated'}`))
    case 'item_assigned':
      return out('assign', A, t(' put you on '), I)
    case 'item_unassigned':
      return out('assign', A, t(' took you off '), I)
    case 'option_added':
      return out('option', A, t(' added an option for '), I, ...(option ? [t(': '), { text: option, strong: true }] : []))
    case 'option_selected':
      return out('option', A, t(' picked '), ...(option ? [{ text: option, strong: true }, t(' for ')] : [t('an option for ')]), I)
    case 'coordination_claimed':
      return out('buy', A, t(' is sorting out buying '), I)
    case 'coordination_handover':
      return reason ? out('buy', A, t(' handed '), I, t(' over to you')) : out('buy', A, t(' handed '), I, t(' to '), { text: subject, strong: true })
    case 'coordination_takeover':
      return out('buy', A, t(' took over buying '), I)
    case 'room_completed':
      return out('milestone', R, t(' is all set — everything’s in the flat'))
    case 'transformation_added':
      return out('milestone', A, t(' added a before and after for '), R)
    case 'photos_added':
      return out('photo', A, t(count > 1 ? ` added ${count} photos of ` : ' added a photo of '), R)
    case 'idea_added':
      return out('idea', A, t(' added '), { text: idea, strong: true }, t(' to the wishlist'))
    case 'comment_mention':
      return out('comment', A, t(' mentioned you on '), ...target)
    case 'comment_added':
      if (reason === 'mention') return out('comment', A, t(' mentioned you on '), ...target)
      if (reason === 'reply') return out('comment', A, t(' replied to you on '), ...target)
      return out('comment', A, t(d.reply ? ' replied on ' : ' commented on '), ...target)
    case 'member_joined':
      return out('member', A, t(d.full && reason ? ' joined — the flat is now full' : ' joined the flat'))
    case 'member_left':
      return out('member', { text: subject, strong: true }, t(' left the flat'))
    case 'member_removed':
      return out('member', { text: subject, strong: true }, t(' is no longer in the flat'))
    case 'ownership_transferred':
      return e.subject_id === look.myId
        ? out('member', A, t(' made you the flat owner'))
        : out('member', A, t(' handed ownership to '), { text: subject, strong: true })
    case 'member_limit_changed':
      return out('member', A, t(` set the flat to ${num(d.to) ?? ''} people`))
    default:
      return out('history', A, t(' made a change'))
  }
}

/** "yesterday" or "on 12 Nov", from a calendar date. */
function dueWords(day: string | null): string {
  if (!day) return 'recently'
  const diff = daysBetween(day, todayLocal())
  if (diff === 1) return 'yesterday'
  return `on ${formatDay(day)}`
}

/** "Assemble the TV cabinet" → "assemble the TV cabinet" (keeps acronyms like "TV"). */
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

export const plainText = (segments: Segment[]) => segments.map((s) => s.text).join('')

/** Today / Yesterday / Earlier, in the device's own calendar. */
export function dayGroup(iso: string, now: Date = new Date()): 'Today' | 'Yesterday' | 'Earlier' {
  const at = new Date(iso)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (at.getTime() >= start) return 'Today'
  if (at.getTime() >= start - 86_400_000) return 'Yesterday'
  return 'Earlier'
}

/** "Just now", "5 min ago", "3:41 pm", "Mon 3:41 pm", "12 Nov". */
export function eventTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const diff = now.getTime() - at.getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  const group = dayGroup(iso, now)
  const time = at.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
  if (group === 'Today') return time
  if (group === 'Yesterday') return `Yesterday ${time}`
  if (diff < 6 * 86_400_000) return `${at.toLocaleDateString('en-NZ', { weekday: 'short' })} ${time}`
  return at.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

/** Mentions in a comment are written as @Name; this finds the members referenced. */
export function findMentions(body: string, people: readonly { id: string; name: string }[]): string[] {
  let rest = body.toLowerCase()
  const found = new Set<string>()
  // Longest names first, and each match is consumed, so "@Sam Lee" never also counts as "@Sam".
  for (const p of [...people].sort((a, b) => b.name.trim().length - a.name.trim().length)) {
    const name = p.name.trim()
    if (!name) continue
    const needle = `@${name.toLowerCase()}`
    let at = rest.indexOf(needle)
    while (at !== -1) {
      const after = rest.charAt(at + needle.length)
      if (!after || !/[\p{L}\p{N}]/u.test(after)) {
        found.add(p.id)
        rest = rest.slice(0, at) + ' '.repeat(needle.length) + rest.slice(at + needle.length)
      }
      at = rest.indexOf(needle, at + 1)
    }
  }
  return [...found]
}
