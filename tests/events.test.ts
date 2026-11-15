import { describe, expect, it } from 'vitest'
import type { HouseholdEventRow } from '@/lib/database.types'
import { dayGroup, describeEvent, eventHref, eventTime, findMentions, plainText, type EventLookup } from '@/lib/events'

const base: HouseholdEventRow = {
  id: 1, household_id: 'h', type: 'item_completed', actor_id: 'a', actor_name: 'Stored name', room_id: 'r', item_id: 'i', option_id: null,
  idea_id: null, comment_id: null, transformation_id: null, subject_id: null, data: { item: 'Old kettle name', room: 'Kitchen' }, in_timeline: true,
  created_at: '2026-11-15T01:00:00Z',
}
const look = (over: Partial<EventLookup> = {}): EventLookup => ({
  personName: (id) => (id === 'a' ? 'Madi' : null), itemName: (id) => (id === 'i' ? 'Kettle' : null), roomName: () => null, myId: 'me', ...over,
})
const text = (e: Partial<HouseholdEventRow>, reason?: string, l = look()) => plainText(describeEvent({ ...base, ...e }, l, reason).segments)

describe('event wording', () => {
  it('prefers current names, falling back to the names stored with the event', () => {
    expect(text({})).toBe('Madi marked Kettle as in the flat')
    expect(text({}, undefined, look({ personName: () => null, itemName: () => null }))).toBe('Stored name marked Old kettle name as in the flat')
  })
  it('speaks to the reader for personal notifications', () => {
    expect(text({ type: 'comment_added' }, 'mention')).toBe('Madi mentioned you on Kettle')
    expect(text({ type: 'comment_added' }, 'reply')).toBe('Madi replied to you on Kettle')
    expect(text({ type: 'comment_added' })).toBe('Madi commented on Kettle')
    expect(text({ type: 'ownership_transferred', subject_id: 'me' })).toBe('Madi made you the flat owner')
    expect(text({ type: 'coordination_handover', subject_id: 'me' }, 'handover')).toBe('Madi handed Kettle over to you')
  })
  it('summarises coalesced entries', () => {
    expect(text({ type: 'photos_added', data: { room: 'Kitchen', count: 3 } })).toBe('Madi added 3 photos of Kitchen')
    expect(text({ type: 'item_added', data: { room: 'Kitchen', count: 2 } })).toBe('Madi added 2 items to Kitchen')
  })
  it('never invents an actor for system rows', () => {
    expect(text({ type: 'history_started', actor_id: null, actor_name: null })).toBe('Flat history starts here')
  })
  it('keeps flatmate-typed text as plain segments (no markup)', () => {
    const d = describeEvent({ ...base, type: 'idea_added', idea_id: 'x', data: { idea: '<b>Lamp</b>' } }, look())
    expect(d.segments.some((s) => s.text === '<b>Lamp</b>')).toBe(true)
  })
})

describe('event destinations', () => {
  it('links items, option discussions, ideas and members', () => {
    expect(eventHref({ ...base })).toBe('/rooms/r?item=i')
    expect(eventHref({ ...base, type: 'comment_added', option_id: 'o', comment_id: 'c' })).toBe('/rooms/r?item=i&option=o&discuss=c')
    expect(eventHref({ ...base, type: 'comment_added', item_id: null, room_id: null, idea_id: 'd', comment_id: 'c' })).toBe('/wishlist?idea=d&discuss=c')
    expect(eventHref({ ...base, type: 'member_joined' })).toBe('/flatmates')
    expect(eventHref({ ...base, type: 'history_started' })).toBeNull()
  })
})

describe('time grouping', () => {
  const now = new Date(2026, 10, 15, 12, 0)
  it('groups by the device calendar', () => {
    expect(dayGroup(new Date(2026, 10, 15, 0, 5).toISOString(), now)).toBe('Today')
    expect(dayGroup(new Date(2026, 10, 14, 23, 59).toISOString(), now)).toBe('Yesterday')
    expect(dayGroup(new Date(2026, 10, 10).toISOString(), now)).toBe('Earlier')
  })
  it('uses relative times for the last hour', () => {
    expect(eventTime(new Date(now.getTime() - 20_000).toISOString(), now)).toBe('Just now')
    expect(eventTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('5 min ago')
  })
})

describe('mentions', () => {
  const people = [{ id: 's', name: 'Sam' }, { id: 'sl', name: 'Sam Lee' }, { id: 'm', name: 'Madi' }]
  it('finds whole names only, longest first', () => {
    expect(findMentions('hey @Sam Lee and @madi', people).sort()).toEqual(['m', 'sl'])
    expect(findMentions('@Samantha?', people)).toEqual([])
    expect(findMentions('email sam@example.com', people)).toEqual([])
  })
})
