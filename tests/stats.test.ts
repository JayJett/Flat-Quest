import { describe, expect, it } from 'vitest'
import type { Item } from '@/lib/domain'
import { nextAction, openItemsFor, progressOf, roomProgress } from '@/lib/stats'

let n = 0
function item(p: Partial<Item>): Item {
  n += 1
  return {
    id: `i${n}`,
    household_id: 'h',
    room_id: 'r1',
    name: `Item ${n}`,
    description: null,
    priority: 'must_have',
    status: 'to_decide',
    responsibility: 'unclaimed',
    responsible_user_id: null,
    ownership: 'to_decide',
    owner_user_id: null,
    is_complete: false,
    completed_at: null,
    completed_by: null,
    estimated_price: null,
    actual_price: null,
    shopping_url: null,
    notes: null,
    sort_order: n,
    import_key: null,
    created_by: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...p,
  }
}

describe('progressOf', () => {
  it('excludes not-needed items from every count', () => {
    const p = progressOf([item({}), item({ status: 'not_needed' }), item({ status: 'not_needed', is_complete: true })])
    expect(p).toEqual({ total: 1, ready: 0, outstanding: 1, unclaimed: 1, ratio: 0 })
  })

  it('treats ordered as outstanding until completed', () => {
    const p = progressOf([item({ status: 'ordered', responsibility: 'shared' }), item({ is_complete: true })])
    expect(p.ready).toBe(1)
    expect(p.outstanding).toBe(1)
    expect(p.unclaimed).toBe(0)
    expect(p.ratio).toBe(0.5)
  })

  it('handles an empty list without dividing by zero', () => {
    expect(progressOf([]).ratio).toBe(0)
  })

  it('does not count completed unclaimed items as unclaimed', () => {
    expect(progressOf([item({ is_complete: true })]).unclaimed).toBe(0)
  })
})

describe('roomProgress', () => {
  it('reports every room, including empty ones', () => {
    const rooms = [{ id: 'r1' }, { id: 'r2' }] as never
    const m = roomProgress(rooms, [item({ room_id: 'r1', is_complete: true }), item({ room_id: 'r1' })])
    expect(m.get('r1')).toMatchObject({ total: 2, ready: 1 })
    expect(m.get('r2')).toMatchObject({ total: 0, ready: 0 })
  })
})

describe('nextAction', () => {
  it('prioritises my own open items', () => {
    const items = [item({ responsibility: 'member', responsible_user_id: 'me' }), item({})]
    expect(nextAction('me', items)).toEqual({ kind: 'mine', count: 1 })
  })
  it('suggests claiming, counting must-haves', () => {
    const items = [item({ priority: 'nice_to_have' }), item({}), item({ responsibility: 'shared' })]
    expect(nextAction('me', items)).toEqual({ kind: 'claim', count: 2, mustHaves: 1 })
  })
  it('says finish when everything is claimed', () => {
    expect(nextAction('me', [item({ responsibility: 'shared' })])).toEqual({ kind: 'finish', count: 1 })
  })
  it('celebrates only when everything counted is complete', () => {
    expect(nextAction('me', [item({ is_complete: true }), item({ status: 'not_needed' })])).toEqual({ kind: 'done' })
  })
  it('handles an empty household', () => {
    expect(nextAction('me', [])).toEqual({ kind: 'empty' })
  })
  it('ignores completed and not-needed items on my list', () => {
    const items = [
      item({ responsibility: 'member', responsible_user_id: 'me', is_complete: true }),
      item({ responsibility: 'member', responsible_user_id: 'me', status: 'not_needed' }),
    ]
    expect(openItemsFor('me', items)).toHaveLength(0)
  })
})
