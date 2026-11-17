import { describe, expect, it } from 'vitest'
import { activeFlatKey, resolveActiveFlat } from '@/household/activeFlat'
import { flatLink, requestedFlat } from '@/household/flatLinks'
import { addDays, flatZone, isCivilDate, localParts, mondayOf, todayIn, weekDays, weekFromParam, zonedInstant } from '@/calendar/dates'
import { appointmentEntries, compareEntries, groupByDay, mergeAppointment, purchaseEntries, purchaseKind, taskEntries, type CalendarEntry } from '@/calendar/entries'
import type { AppointmentRow } from '@/lib/database.types'

const A = '22222222-2222-4222-8222-222222222222'
const B = '29292929-2929-4292-8292-292929292929'
const C = '39393939-3939-4393-8393-393939393939'

describe('active flat resolution', () => {
  it('no memberships: none', () => expect(resolveActiveFlat({ memberships: [] })).toEqual({ id: null, reason: 'none', migrateLegacy: false }))
  it('one membership opens directly, ignoring stale preferences', () =>
    expect(resolveActiveFlat({ memberships: [A], stored: C, legacy: C })).toEqual({ id: A, reason: 'only', migrateLegacy: false }))
  it('a session choice wins over the stored one', () => expect(resolveActiveFlat({ memberships: [A, B], requested: B, stored: A }).id).toBe(B))
  it('a stored choice is used only while it is still a membership', () => {
    expect(resolveActiveFlat({ memberships: [A, B], stored: B }).id).toBe(B)
    expect(resolveActiveFlat({ memberships: [A, B], stored: C })).toEqual({ id: null, reason: 'choose', migrateLegacy: false })
  })
  it('a requested flat you left is ignored', () => expect(resolveActiveFlat({ memberships: [A], requested: B }).id).toBe(A))
  it('the legacy device-wide key migrates only when it names one of your flats', () => {
    expect(resolveActiveFlat({ memberships: [A, B], legacy: B })).toEqual({ id: B, reason: 'legacy', migrateLegacy: true })
    expect(resolveActiveFlat({ memberships: [A, B], legacy: C }).reason).toBe('choose')
    expect(resolveActiveFlat({ memberships: [A, B], stored: A, legacy: B })).toEqual({ id: A, reason: 'stored', migrateLegacy: false })
  })
  it('the stored key is per account', () => expect(activeFlatKey('u1')).not.toBe(activeFlatKey('u2')))
})

describe('flat links', () => {
  it('adds or replaces the flat, keeping the path, query and hash', () => {
    expect(flatLink('/tasks', A)).toBe(`/tasks?flat=${A}`)
    expect(flatLink(`/rooms/r1?item=i1#x`, A)).toBe(`/rooms/r1?item=i1&flat=${A}#x`)
    expect(flatLink(`/calendar?flat=${B}&week=2026-11-16`, A)).toBe(`/calendar?flat=${A}&week=2026-11-16`)
  })
  it('parses the requested flat; malformed values are refused', () => {
    expect(requestedFlat('?week=2026-11-16')).toEqual({ kind: 'none' })
    expect(requestedFlat(`?flat=${A.toUpperCase()}`)).toEqual({ kind: 'flat', id: A })
    expect(requestedFlat('?flat=../../etc')).toEqual({ kind: 'invalid' })
    expect(requestedFlat('?flat=')).toEqual({ kind: 'invalid' })
  })
})

describe('flat dates', () => {
  const NOV17_AKL_MORNING = Date.parse('2026-11-16T20:00:00Z') // Tue 17 Nov 09:00 in Auckland, Mon 16 Nov 12:00 in Los Angeles
  it('today is the flat’s, not the device’s', () => {
    expect(todayIn('Pacific/Auckland', NOV17_AKL_MORNING)).toBe('2026-11-17')
    expect(todayIn('America/Los_Angeles', NOV17_AKL_MORNING)).toBe('2026-11-16')
  })
  it('weeks run Monday to Sunday, across month and year ends', () => {
    expect(mondayOf('2026-11-17')).toBe('2026-11-16')
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')
    expect(mondayOf('2026-11-23')).toBe('2026-11-23')
    expect(weekDays('2026-12-28')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('the week in the URL is normalised; invalid values mean this week', () => {
    expect(weekFromParam('2026-11-19', 'Pacific/Auckland', NOV17_AKL_MORNING)).toBe('2026-11-16')
    expect(weekFromParam('2026-02-30', 'Pacific/Auckland', NOV17_AKL_MORNING)).toBe('2026-11-16')
    expect(weekFromParam('next', 'America/Los_Angeles', NOV17_AKL_MORNING)).toBe('2026-11-16')
    expect(isCivilDate('2026-13-01')).toBe(false)
  })
  it('flat settings fall back to Auckland like the server', () => {
    expect(flatZone({ timezone: 'Australia/Perth' })).toBe('Australia/Perth')
    expect(flatZone({ timezone: 'Mars/Base' })).toBe('Pacific/Auckland')
    expect(flatZone(null)).toBe('Pacific/Auckland')
  })
  it('resolves local times in the flat’s zone, across daylight saving', () => {
    const summer = zonedInstant('2026-11-20', '10:00', 'Pacific/Auckland')
    expect(summer).toEqual({ ok: true, instant: Date.parse('2026-11-19T21:00:00Z') })
    const winter = zonedInstant('2026-07-20', '10:00', 'Pacific/Auckland')
    expect(winter).toEqual({ ok: true, instant: Date.parse('2026-07-19T22:00:00Z') })
    expect(zonedInstant('2026-11-20', '10:00', 'America/Los_Angeles')).toEqual({ ok: true, instant: Date.parse('2026-11-20T18:00:00Z') })
  })
  it('refuses times skipped or repeated by a clock change', () => {
    expect(zonedInstant('2026-09-27', '02:30', 'Pacific/Auckland')).toEqual({ ok: false, reason: 'nonexistent' })
    expect(zonedInstant('2026-04-05', '02:30', 'Pacific/Auckland')).toEqual({ ok: false, reason: 'ambiguous' })
    expect(zonedInstant('2026-03-08', '02:30', 'America/Los_Angeles')).toEqual({ ok: false, reason: 'nonexistent' })
    expect(zonedInstant('2026-11-01', '01:30', 'America/Los_Angeles')).toEqual({ ok: false, reason: 'ambiguous' })
    expect(zonedInstant('2026-09-27', '03:00', 'Pacific/Auckland').ok).toBe(true)
    expect(zonedInstant('2026-11-20', '24:00', 'Pacific/Auckland')).toEqual({ ok: false, reason: 'invalid' })
  })
  it('a booked moment shows at the flat’s local time', () => {
    expect(localParts('2026-11-19T21:00:00Z', 'Pacific/Auckland')).toEqual({ date: '2026-11-20', time: '10:00' })
    expect(localParts('2026-11-19T21:00:00Z', 'Australia/Perth')).toEqual({ date: '2026-11-20', time: '05:00' })
  })
})

const week = weekDays('2026-11-16')
const appt = (patch: Partial<AppointmentRow>): AppointmentRow => ({
  id: 'a1', household_id: A, title: 'Inspection', notes: null, room_id: null, all_day: true, scheduled_on: '2026-11-18', starts_at: null, ends_at: null,
  needs_cover: false, host_id: null, created_by: 'u', cancelled_at: null, cancelled_by: null, revision: 1, created_at: '', updated_at: '', ...patch,
})

describe('projection into the week', () => {
  it('tasks: open, unarchived, due this week; overdue when past', () => {
    const entries = taskEntries([
      { id: 't1', title: 'Open', due_on: '2026-11-16', status: 'todo', archived_at: null, room_id: null, assignee_id: null },
      { id: 't2', title: 'Doing', due_on: '2026-11-20', status: 'doing', archived_at: null, room_id: null, assignee_id: 'u' },
      { id: 't3', title: 'Done', due_on: '2026-11-18', status: 'done', archived_at: null, room_id: null, assignee_id: null },
      { id: 't4', title: 'Archived', due_on: '2026-11-18', status: 'todo', archived_at: 'x', room_id: null, assignee_id: null },
      { id: 't5', title: 'Next week', due_on: '2026-11-23', status: 'todo', archived_at: null, room_id: null, assignee_id: null },
      { id: 't6', title: 'Undated', due_on: null, status: 'todo', archived_at: null, room_id: null, assignee_id: null },
    ], week, '2026-11-18', A)
    expect(entries.map((e) => [e.key, e.overdue])).toEqual([['task:t1', true], ['task:t2', false]])
    expect(entries[0]!.href).toBe(`/tasks?task=t1&flat=${A}`)
  })
  it('purchases: expected this week, not arrived, item still on its way; pickup vs delivery', () => {
    const items = new Map([
      ['i1', { id: 'i1', name: 'Couch', room_id: 'r', status: 'ordered', is_complete: false }],
      ['i2', { id: 'i2', name: 'Lamp', room_id: 'r', status: 'ready_to_collect', is_complete: false }],
      ['i3', { id: 'i3', name: 'Rug', room_id: 'r', status: 'delivered', is_complete: false }],
      ['i4', { id: 'i4', name: 'Desk', room_id: 'r', status: 'on_the_way', is_complete: true }],
      ['i5', { id: 'i5', name: 'Bed', room_id: 'r', status: 'on_the_way', is_complete: false }],
    ])
    const entries = purchaseEntries([
      { item_id: 'i1', expected_on: '2026-11-17', delivery_method: 'delivery', arrived_on: null },
      { item_id: 'i2', expected_on: '2026-11-18', delivery_method: 'delivery', arrived_on: null },
      { item_id: 'i3', expected_on: '2026-11-18', delivery_method: 'delivery', arrived_on: null },
      { item_id: 'i4', expected_on: '2026-11-18', delivery_method: 'delivery', arrived_on: null },
      { item_id: 'i5', expected_on: '2026-11-18', delivery_method: 'pickup', arrived_on: '2026-11-17' },
      { item_id: 'gone', expected_on: '2026-11-18', delivery_method: 'delivery', arrived_on: null },
    ], items, new Map([['i1', 'madi']]), week, '2026-11-18', A)
    expect(entries.map((e) => [e.key, e.kind, e.personId])).toEqual([['purchase:i1', 'delivery', 'madi'], ['purchase:i2', 'pickup', null]])
    expect(entries[0]!.href).toBe(`/rooms/r?item=i1&flat=${A}`)
    expect(purchaseKind({ delivery_method: 'pickup' }, { status: 'ordered' })).toBe('pickup')
  })
  it('appointments: active only; timed ones land on the flat’s local day; an end on another day is labelled', () => {
    const rows = [
      appt({ id: 'all', scheduled_on: '2026-11-18' }),
      appt({ id: 'cancelled', cancelled_at: 'x' }),
      appt({ id: 'timed', all_day: false, scheduled_on: '2026-11-19', starts_at: '2026-11-19T21:00:00Z', ends_at: '2026-11-19T22:00:00Z' }),
      appt({ id: 'late', all_day: false, scheduled_on: '2026-11-22', starts_at: '2026-11-22T10:30:00Z', ends_at: '2026-11-22T11:30:00Z' }),
    ]
    const akl = appointmentEntries(rows, week, 'Pacific/Auckland')
    expect(akl.map((e) => [e.key, e.date, e.endsOn])).toEqual([['appointment:all', '2026-11-18', null], ['appointment:timed', '2026-11-20', null], ['appointment:late', '2026-11-22', '2026-11-23']])
    // The same booked moment after the flat moves to Perth: an earlier local time, same day.
    expect(appointmentEntries(rows, week, 'Australia/Perth').find((e) => e.key === 'appointment:timed')!.date).toBe('2026-11-20')
  })
  it('orders each day: date-only first, then by start time; ties stable', () => {
    const e = (key: string, timed: boolean, startsAt: number | null, kind: CalendarEntry['kind'], title: string): CalendarEntry =>
      ({ key, kind, date: '2026-11-18', timed, startsAt, endsAt: null, endsOn: null, title, roomId: null, overdue: false, href: null, personId: null, appointment: null })
    const list = [e('5', true, 2, 'appointment', 'B'), e('4', true, 1, 'appointment', 'Z'), e('3', false, null, 'pickup', 'A'), e('2', false, null, 'task', 'B'), e('1', false, null, 'task', 'B')]
    expect([...list].sort(compareEntries).map((x) => x.key)).toEqual(['1', '2', '3', '4', '5'])
    expect(groupByDay(list, week).find((g) => g.date === '2026-11-18')!.entries).toHaveLength(5)
    expect(groupByDay(list, week).filter((g) => g.entries.length === 0)).toHaveLength(6)
  })
  it('live updates never go backwards', () => {
    const one = mergeAppointment(new Map(), appt({ revision: 3, title: 'New' }))
    expect(mergeAppointment(one, appt({ revision: 2, title: 'Old' })).get('a1')!.title).toBe('New')
    expect(mergeAppointment(one, appt({ revision: 3, title: 'Replay' })).get('a1')!.title).toBe('New')
    expect(mergeAppointment(one, appt({ revision: 4, title: 'Newer' })).get('a1')!.title).toBe('Newer')
  })
})
