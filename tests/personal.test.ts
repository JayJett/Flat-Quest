import { describe, expect, it } from 'vitest'
import { contrast } from '@/lib/color'
import { ACCENTS, DEFAULT_LAYOUT, greeting, HOME_SECTIONS, moveSection, normaliseLayout } from '@/personal/themes'
import { dayFromToday, dueLabel, essentialKey, essentialSuggestions, matchEssential, sortTasks, taskGroup } from '@/living/living'
import type { EssentialRow, TaskRow } from '@/lib/database.types'
import { describeEvent, eventHref, plainText } from '@/lib/events'

describe('accent themes', () => {
  it.each(ACCENTS)('$label is readable on its own fill and as text on white (WCAG AA 4.5:1)', (a) => {
    expect(contrast(a.on, a.fill)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(a.on, a.press)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(a.ink, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the original Electric Blue default exactly', () => {
    expect(ACCENTS[0]).toMatchObject({ key: 'blue', fill: '#3657E8', press: '#2945C9', soft: '#EEF1FD', on: '#FFFFFF' })
  })
})

describe('home layout', () => {
  it('defaults to every section, visible, in the designed order', () => {
    expect(DEFAULT_LAYOUT.map((s) => s.id)).toEqual(HOME_SECTIONS.map((s) => s.id))
    expect(DEFAULT_LAYOUT.every((s) => !s.hidden)).toBe(true)
  })
  it('reads stored layouts defensively and appends new sections', () => {
    const out = normaliseLayout([{ id: 'essentials', hidden: true }, { id: 'nope' }, { id: 'essentials' }, 'junk', { id: 'tasks' }])
    expect(out[0]).toEqual({ id: 'essentials', hidden: true })
    expect(out[1]).toEqual({ id: 'tasks', hidden: false })
    expect(out.map((s) => s.id).sort()).toEqual(HOME_SECTIONS.map((s) => s.id).sort())
    expect(normaliseLayout(null)).toEqual(DEFAULT_LAYOUT)
  })
  it('Phase 8: migrates Phase 7 layouts — progress becomes fixed, Room by room disappears, everything else is kept', () => {
    const phase7 = [
      { id: 'activity', hidden: false },
      { id: 'rooms', hidden: false },
      { id: 'progress', hidden: true },
      { id: 'essentials', hidden: true },
      { id: 'focus', hidden: false },
      { id: 'tasks', hidden: false },
      { id: 'deliveries', hidden: true },
    ]
    expect(normaliseLayout(phase7)).toEqual([
      { id: 'activity', hidden: false },
      { id: 'essentials', hidden: true },
      { id: 'focus', hidden: false },
      { id: 'tasks', hidden: false },
      { id: 'deliveries', hidden: true },
    ])
  })
  it('Phase 8: the default order is For you, Things to do, Essentials, On the way, Around the flat', () => {
    expect(DEFAULT_LAYOUT.map((s) => s.id)).toEqual(['focus', 'tasks', 'essentials', 'deliveries', 'activity'])
    expect(HOME_SECTIONS.some((s) => (s.id as string) === 'rooms' || (s.id as string) === 'progress')).toBe(false)
  })
  it('moves sections one step and never off the ends', () => {
    expect(moveSection(DEFAULT_LAYOUT, 0, -1)).toBe(DEFAULT_LAYOUT)
    expect(moveSection(DEFAULT_LAYOUT, 1, -1)[0]!.id).toBe(DEFAULT_LAYOUT[1]!.id)
  })
})

describe('greeting', () => {
  it('follows the time of day and uses the chosen name', () => {
    expect(greeting('Jarden', new Date(2026, 10, 16, 8))).toBe('Good morning, Jarden')
    expect(greeting('Madi', new Date(2026, 10, 16, 14))).toBe('Good afternoon, Madi')
    expect(greeting(null, new Date(2026, 10, 16, 9))).toBe('Good morning')
  })
  it('is stable for a given day (no flicker between renders)', () => {
    const at = new Date(2026, 10, 16, 19, 30)
    expect(greeting('Dan', at)).toBe(greeting('Dan', new Date(2026, 10, 16, 21)))
  })
})

const essential = (p: Partial<EssentialRow>): EssentialRow => ({
  id: p.name ?? 'x', household_id: 'h', name: 'x', name_key: '', category: null, note: null, status: 'needed', claimed_by: null, needed_at: null, needed_by: null,
  restocked_at: null, restocked_by: null, archived_at: null, created_by: null, created_at: '', updated_at: '', ...p,
})

describe('essentials', () => {
  const list = [essential({ name: 'Toilet paper', status: 'stocked' }), essential({ name: 'Sponges' }), essential({ name: 'Bleach', archived_at: '2026-11-01' })]
  it('normalises names like the database', () => {
    expect(essentialKey('  Toilet   PAPER ')).toBe('toilet paper')
  })
  it('recognises what the flat already tracks instead of duplicating it', () => {
    expect(matchEssential('toilet  paper', list).kind).toBe('stocked')
    expect(matchEssential('SPONGES', list).kind).toBe('active')
    expect(matchEssential('bleach', list).kind).toBe('archived')
    expect(matchEssential('Matches', list).kind).toBe('none')
  })
  it('suggests the flat’s own items first, then common ones not already tracked', () => {
    const s = essentialSuggestions('', list, 20)
    expect(s[0]!.existing?.name).toBeDefined()
    expect(s.some((x) => x.name === 'Sponges')).toBe(false)
    expect(s.filter((x) => x.name === 'Toilet paper')).toHaveLength(1)
  })
})

const task = (p: Partial<TaskRow>): TaskRow => ({
  id: p.title ?? 't', household_id: 'h', title: 't', notes: null, room_id: null, assignee_id: null, due_on: null, status: 'todo', completed_at: null,
  completed_by: null, archived_at: null, created_by: null, created_at: '2026-11-01', updated_at: '', ...p,
})

describe('due dates (device calendar, never UTC)', () => {
  const today = '2026-11-16' // a Monday
  it('speaks naturally', () => {
    expect(dueLabel('2026-11-16', today)).toEqual({ text: 'Today', tone: 'soon' })
    expect(dueLabel('2026-11-17', today)?.text).toBe('Tomorrow')
    expect(dueLabel('2026-11-20', today)?.text).toBe('Friday')
    expect(dueLabel('2026-11-15', today)).toEqual({ text: 'Overdue · yesterday', tone: 'overdue' })
    expect(dueLabel('2026-12-25', today)?.text).toBe('25 Dec')
    expect(dueLabel(null, today)).toBeNull()
    expect(dueLabel('2026-02-30', today)).toBeNull()
  })
  it('counts days from local midnight across daylight saving', () => {
    expect(dayFromToday(1, new Date(2026, 8, 26, 23, 30))).toBe('2026-09-27')
    expect(dayFromToday(0, new Date(2026, 10, 16, 0, 5))).toBe('2026-11-16')
  })
  it('groups and sorts open tasks sensibly', () => {
    expect(taskGroup({ due_on: '2026-11-10' }, today)).toBe('overdue')
    expect(taskGroup({ due_on: null }, today)).toBe('someday')
    const sorted = sortTasks([task({ title: 'later', due_on: '2026-11-30' }), task({ title: 'none' }), task({ title: 'soon', due_on: '2026-11-17' })])
    expect(sorted.map((t) => t.title)).toEqual(['soon', 'later', 'none'])
  })
})

describe('living-mode events', () => {
  const look = { personName: () => 'Madi', itemName: () => null, roomName: () => null, myId: 'me' }
  const ev = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ id: 1, household_id: 'h', type, actor_id: 'm', actor_name: 'Madi', room_id: null, item_id: null, option_id: null, idea_id: null, comment_id: null, transformation_id: null, subject_id: null, data, in_timeline: true, created_at: '', ...extra }) as never
  it('reads naturally in the drawer and timeline', () => {
    expect(plainText(describeEvent(ev('essential_restocked', { essential: 'Toilet paper' }), look, 'responsible').segments)).toBe('Madi restocked Toilet paper — no need to buy it')
    expect(plainText(describeEvent(ev('essential_handover', { essential: 'Sponges' }), look, 'handover').segments)).toBe('Madi asked you to pick up Sponges')
    expect(plainText(describeEvent(ev('task_assigned', { task: 'Assemble the TV cabinet' }), look, 'assigned').segments)).toBe('Madi asked you to assemble the TV cabinet')
    expect(plainText(describeEvent(ev('task_completed', { task: 'Change a lightbulb' }), look).segments)).toBe('Madi finished Change a lightbulb')
    expect(plainText(describeEvent(ev('essential_needed', { essential: 'x', count: 3 }), look).segments)).toBe('Madi added 3 things to Essentials')
  })
  it('links to the right screen', () => {
    expect(eventHref({ ...(ev('task_completed', {}, { task_id: 't1' }) as object) } as never)).toBe('/tasks?task=t1')
    expect(eventHref({ ...(ev('essential_restocked', {}, { essential_id: 'e1' }) as object) } as never)).toBe('/essentials?essential=e1')
  })
})
