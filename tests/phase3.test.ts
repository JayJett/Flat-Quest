import { describe, expect, it } from 'vitest'
import { completionMilestone } from '@/lib/celebrations'
import { recentActivity, type ActivityIdea } from '@/lib/activity'
import { toItem, type Item } from '@/lib/domain'
import type { ItemRow } from '@/lib/database.types'

function item(id: string, patch: Partial<Item> = {}): Item {
  return { ...toItem({ id, room_id: 'room', status: 'to_decide', priority: 'must_have', ownership: 'to_decide', is_complete: false } as ItemRow), ...patch }
}

describe('confirmed room milestones', () => {
  it.each([25, 50, 75, 100])('celebrates crossing %i percent', (mark) => {
    const before = Array.from({ length: 4 }, (_, i) => item(String(i), { is_complete: i < mark / 25 - 1 }))
    expect(completionMilestone(before, { ...before[mark / 25 - 1]!, is_complete: true })).toBe(mark)
  })
  it('selects only the highest milestone when one item crosses several', () => {
    const i = item('one')
    expect(completionMilestone([i], { ...i, is_complete: true })).toBe(100)
  })
  it('does not celebrate an echo or an undo', () => {
    const i = item('one', { is_complete: true })
    expect(completionMilestone([i], i)).toBeNull()
    expect(completionMilestone([i], { ...i, is_complete: false })).toBeNull()
  })
  it('ignores load, moves, denominator changes and not-needed items', () => {
    const i = item('one')
    expect(completionMilestone([], { ...i, is_complete: true })).toBeNull()
    expect(completionMilestone([i], { ...i, is_complete: true, room_id: 'elsewhere' })).toBeNull()
    expect(completionMilestone([i], { ...i, is_complete: true, status: 'not_needed' })).toBeNull()
    expect(completionMilestone([{ ...i, status: 'not_needed' }], { ...i, is_complete: true })).toBeNull()
  })
  it('counts provided appliances and excludes unrelated rooms', () => {
    const i = item('one', { status: 'provided' })
    expect(completionMilestone([i, item('two', { room_id: 'other' })], { ...i, is_complete: true })).toBe(100)
  })
})

describe('small household activity view', () => {
  const idea: ActivityIdea = { id: 'idea', title: 'A lamp', created_by: 'member', created_at: '2026-11-11T01:00:00Z', import_key: null }
  it('merges saved completions and personal ideas newest first', () => {
    const entries = recentActivity([item('one', { is_complete: true, completed_at: '2026-11-11T02:00:00Z', completed_by: 'other' })], [idea])
    expect(entries.map((e) => e.kind)).toEqual(['ready', 'idea'])
    expect(entries[0]!.actor).toBe('other')
  })
  it('never presents imported ideas as personal activity', () => {
    expect(recentActivity([], [{ ...idea, import_key: 'wish:room|lamp' }])).toEqual([])
  })
  it('omits undone, not-needed and invalid-date records', () => {
    expect(recentActivity([item('one', { completed_at: idea.created_at }), item('two', { is_complete: true, completed_at: 'invalid' }), item('three', { is_complete: true, completed_at: idea.created_at, status: 'not_needed' })], [])).toEqual([])
  })
  it('bounds the list and retains a missing actor without inventing identity', () => {
    const entries = recentActivity([], Array.from({ length: 9 }, (_, i) => ({ ...idea, id: String(i), created_by: null })))
    expect(entries).toHaveLength(5)
    expect(entries[0]!.actor).toBeNull()
  })
})
