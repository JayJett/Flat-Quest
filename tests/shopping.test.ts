import { describe, expect, it } from 'vitest'
import type { ItemPurchaseRow, ItemRow, ProductOptionRow, ProductPreferenceRow, PurchaseCoordinatorRow } from '@/lib/database.types'
import { daysBetween, formatDay, friendlyDay, isDay, parseDay, todayLocal } from '@/lib/dates'
import { STATUSES, STATUS_LABEL, STATUS_RANK, toItem, type Item } from '@/lib/domain'
import {
  activeFilterCount,
  comparablePrice,
  DEFAULT_FILTERS,
  deliveryLine,
  dimensionsLabel,
  FIT_CAVEAT,
  fitGuidance,
  formatPrice,
  hasPurchaseEvidence,
  optionsLine,
  parseCm,
  parsePrice,
  preferenceTally,
  PURCHASE_STAGES,
  shoppingEntries,
  shoppingGroupOf,
  shoppingSections,
  shoppingSummary,
  sortOptions,
  summaryLine,
  type ShoppingContext,
} from '@/lib/shopping'
import { progressOf } from '@/lib/stats'
import { hostLabel, normaliseWebUrl } from '@/lib/urls'

const NOW = new Date('2026-11-12T00:00:00Z')

function item(id: string, patch: Partial<Item> = {}): Item {
  return {
    ...toItem({ id, name: id, room_id: 'r1', status: 'to_decide', priority: 'must_have', ownership: 'to_decide', is_complete: false, estimated_price: null, actual_price: null, completed_at: null } as ItemRow),
    ...patch,
  }
}
function option(id: string, patch: Partial<ProductOptionRow> = {}): ProductOptionRow {
  return { id, household_id: 'h', item_id: 'a', name: id, retailer: null, price: null, url: null, photo_path: null, notes: null, width_cm: null, depth_cm: null, height_cm: null, is_selected: false, selected_at: null, selected_by: null, created_by: 'u1', created_at: `2026-11-0${id.length}T00:00:00Z`, updated_at: 'x', ...patch }
}
function purchase(patch: Partial<ItemPurchaseRow> = {}): ItemPurchaseRow {
  return { item_id: 'a', household_id: 'h', option_id: null, purchased_by: null, purchased_on: null, order_reference: null, notes: null, delivery_method: null, expected_on: null, tracking_url: null, delivery_notes: null, arrived_on: null, updated_by: null, created_at: 'x', updated_at: 'x', ...patch }
}
function ctx(patch: Partial<ShoppingContext> = {}): ShoppingContext {
  return { myId: 'me', roomOrder: new Map([['r1', 0], ['r2', 1]]), optionsByItem: new Map(), purchaseByItem: new Map(), coordinatorByItem: new Map(), now: NOW, ...patch }
}

describe('one status system', () => {
  it('purchase stages are ordinary item statuses with labels and an order', () => {
    for (const stage of PURCHASE_STAGES) {
      expect(STATUSES).toContain(stage)
      expect(STATUS_LABEL[stage]).toBeTruthy()
    }
    expect(PURCHASE_STAGES.map((s) => STATUS_RANK[s])).toEqual([...PURCHASE_STAGES.map((s) => STATUS_RANK[s])].sort((a, b) => a - b).filter((r, i, all) => all.indexOf(r) === i))
  })
  it('ordered and delivered are not complete: only is_complete moves household progress', () => {
    const items = [item('a', { status: 'ordered' }), item('b', { status: 'delivered' }), item('c', { status: 'on_the_way' })]
    expect(progressOf(items)).toMatchObject({ total: 3, ready: 0 })
    expect(progressOf(items.map((i) => (i.id === 'b' ? { ...i, is_complete: true } : i)))).toMatchObject({ total: 3, ready: 1, ratio: 1 / 3 })
  })
})

describe('what belongs in Shopping', () => {
  it('includes each purchase stage that is not yet in the flat', () => {
    for (const stage of PURCHASE_STAGES) expect(shoppingGroupOf(item('a', { status: stage }), null, NOW)).toBe(stage)
  })
  it('leaves out not needed, provided, undecided and items someone is bringing', () => {
    for (const status of ['not_needed', 'provided', 'to_decide', 'bringing'] as const) {
      expect(shoppingGroupOf(item('a', { status }), null, NOW)).toBeNull()
    }
  })
  it('never suggests buying something a flatmate is bringing, even with a purchase record lying around', () => {
    expect(shoppingGroupOf(item('a', { status: 'bringing' }), purchase({ purchased_on: '2026-11-01' }), NOW)).toBeNull()
  })
  it('shows a completed item as recently bought only when it was actually bought, and only for two weeks', () => {
    const done = { is_complete: true, completed_at: '2026-11-10T00:00:00Z' }
    expect(shoppingGroupOf(item('a', { ...done, status: 'ordered' }), null, NOW)).toBe('recent')
    expect(shoppingGroupOf(item('a', { ...done, status: 'to_decide', actual_price: 20 }), null, NOW)).toBe('recent')
    expect(shoppingGroupOf(item('a', { ...done, status: 'to_decide' }), purchase({ purchased_by: 'u1' }), NOW)).toBe('recent')
    // Brought from home, or landlord's: complete but never bought.
    expect(shoppingGroupOf(item('a', { ...done, status: 'bringing' }), null, NOW)).toBeNull()
    expect(shoppingGroupOf(item('a', { ...done, status: 'provided', actual_price: 5 }), null, NOW)).toBeNull()
    expect(shoppingGroupOf(item('a', { is_complete: true, completed_at: '2026-10-20T00:00:00Z', status: 'ordered' }), null, NOW)).toBeNull()
    expect(shoppingGroupOf(item('a', { is_complete: true, completed_at: null, status: 'ordered' }), null, NOW)).toBeNull()
  })
  it('an empty purchase record is not evidence of a purchase', () => {
    expect(hasPurchaseEvidence(item('a', { status: 'to_decide' }), purchase())).toBe(false)
    expect(hasPurchaseEvidence(item('a', { status: 'to_decide' }), purchase({ order_reference: 'X' }))).toBe(true)
  })
  it('summarises real counts only', () => {
    const s = shoppingSummary([item('a', { status: 'need_to_buy' }), item('b', { status: 'shopping' }), item('c', { status: 'ordered' }), item('d', { status: 'delivered', is_complete: true }), item('e'), item('f', { status: 'bringing' })])
    expect(s).toEqual({ toBuy: 2, inProgress: 1, undecided: 1 })
    expect(summaryLine(s)).toBe('2 to buy · 1 on order')
    expect(summaryLine({ toBuy: 0, inProgress: 0, undecided: 3 })).toBe('')
  })
})

describe('filters and sorting', () => {
  const items = [
    item('couch', { status: 'shopping', room_id: 'r1', priority: 'must_have', assignees: ['me', 'madi'], estimated_price: 1500 }),
    item('tv', { status: 'ordered', room_id: 'r1', priority: 'nice_to_have', assignees: ['madi'] }),
    item('bin', { status: 'need_to_buy', room_id: 'r2', priority: 'maybe_later', estimated_price: 30 }),
    item('lamp', { status: 'to_decide', room_id: 'r2' }),
    item('rug', { status: 'bringing', room_id: 'r1', assignees: ['me'] }),
  ]
  const names = (f: Partial<typeof DEFAULT_FILTERS>, c = ctx()) => shoppingEntries(items, { ...DEFAULT_FILTERS, ...f }, c).map((e) => e.item.id)

  it('defaults to everything being bought, and only that', () => {
    expect(names({})).toEqual(['couch', 'tv', 'bin'])
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0)
  })
  it('filters by room, priority and stage', () => {
    expect(names({ room: 'r2' })).toEqual(['bin'])
    expect(names({ priority: 'nice_to_have' })).toEqual(['tv'])
    expect(names({ stage: 'ordered' })).toEqual(['tv'])
    expect(names({ stage: 'to_decide' })).toEqual(['lamp'])
    expect(activeFilterCount({ room: 'r2', who: 'me', priority: 'must_have', stage: 'ordered' })).toBe(4)
  })
  it('filters by person: assignees and whoever is sorting the purchase both count', () => {
    expect(names({ who: 'me' })).toEqual(['couch'])
    expect(names({ who: 'madi' })).toEqual(['couch', 'tv'])
    expect(names({ who: 'none' })).toEqual(['bin'])
    const coordinating = ctx({ coordinatorByItem: new Map([['bin', { item_id: 'bin', household_id: 'h', user_id: 'me', claimed_at: 'x' } as PurchaseCoordinatorRow]]) })
    expect(names({ who: 'me' }, coordinating)).toEqual(['couch', 'bin'])
    expect(names({ who: 'none' }, coordinating)).toEqual([])
  })
  it('groups by stage in purchase order, with headings from real data', () => {
    const sections = shoppingSections(shoppingEntries(items, DEFAULT_FILTERS, ctx()), 'stage', ctx())
    expect(sections.map((s) => [s.label, s.entries.map((e) => e.item.id)])).toEqual([['Need to buy', ['bin']], ['Looking around', ['couch']], ['Ordered', ['tv']]])
    expect(shoppingSections([], 'stage', ctx())).toEqual([])
  })
  it('sorts by priority, room, name, price and expected date with unknowns last', () => {
    const c = ctx({
      optionsByItem: new Map([['couch', [option('x', { price: 900 }), option('yy', { price: 1299 })]]]),
      purchaseByItem: new Map([['tv', purchase({ expected_on: '2026-11-20' })]]),
    })
    const order = (sort: Parameters<typeof shoppingSections>[1]) => shoppingSections(shoppingEntries(items, DEFAULT_FILTERS, c), sort, c).flatMap((s) => s.entries.map((e) => e.item.id))
    expect(order('priority')).toEqual(['couch', 'tv', 'bin'])
    expect(order('room')).toEqual(['couch', 'tv', 'bin'])
    expect(order('name')).toEqual(['bin', 'couch', 'tv'])
    expect(order('price')).toEqual(['bin', 'couch', 'tv'])
    expect(order('expected')).toEqual(['tv', 'couch', 'bin'])
  })
  it('compares on what was paid, else the pick, else the cheapest option, else the estimate', () => {
    const i = item('a', { estimated_price: 500 })
    expect(comparablePrice(i)).toBe(500)
    expect(comparablePrice(i, [option('x', { price: 300 }), option('yy', { price: 200 })])).toBe(200)
    expect(comparablePrice(i, [option('x', { price: 300, is_selected: true }), option('yy', { price: 200 })])).toBe(300)
    expect(comparablePrice({ ...i, actual_price: 280 }, [option('x', { price: 300, is_selected: true })])).toBe(280)
    expect(comparablePrice(item('b'))).toBeNull()
  })
})

describe('preferences and options', () => {
  const prefs: ProductPreferenceRow[] = [
    { item_id: 'a', user_id: 'u2', household_id: 'h', option_id: 'x', created_at: 'x', updated_at: '2026-11-02' },
    { item_id: 'a', user_id: 'u1', household_id: 'h', option_id: 'x', created_at: 'x', updated_at: '2026-11-01' },
    { item_id: 'a', user_id: 'u3', household_id: 'h', option_id: 'yy', created_at: 'x', updated_at: '2026-11-03' },
  ]
  it('tallies who prefers what, in the order they chose', () => {
    const tally = preferenceTally(prefs)
    expect(tally.get('x')).toEqual(['u1', 'u2'])
    expect(tally.get('yy')).toEqual(['u3'])
  })
  it('a popular option is not a decision: the pick sorts first regardless of preferences', () => {
    const options = [option('x'), option('yy'), option('zzz', { is_selected: true })]
    expect(sortOptions(options, preferenceTally(prefs)).map((o) => o.id)).toEqual(['zzz', 'x', 'yy'])
    expect(sortOptions([option('x'), option('yy')], new Map()).map((o) => o.id)).toEqual(['x', 'yy'])
  })
  it('describes options for list rows', () => {
    expect(optionsLine([])).toBe('')
    expect(optionsLine([option('x')])).toBe('1 option')
    expect(optionsLine([option('x', { price: 1299 }), option('yy', { price: 899.5 })])).toBe('2 options · from $899.50')
    expect(optionsLine([option('x', { price: 1299 }), option('yy', { price: 899, is_selected: true, retailer: 'Mocka' })])).toBe('Our pick: Mocka · $899')
  })
})

describe('prices and measurements', () => {
  it('formats NZ dollars, with cents only when there are some', () => {
    expect(formatPrice(1299)).toBe('$1,299')
    expect(formatPrice(49.95)).toBe('$49.95')
    expect(formatPrice(0)).toBe('$0')
    expect(formatPrice(null)).toBe('')
  })
  it('parses prices strictly', () => {
    expect(parsePrice('')).toBeNull()
    expect(parsePrice(' $1,299 ')).toBe(1299)
    expect(parsePrice('NZ$49.95')).toBe(49.95)
    expect(parsePrice('0')).toBe(0)
    for (const bad of ['-5', 'abc', '12.345', '1e3', '100000000', '12 dollars', '.']) expect(parsePrice(bad)).toBe('invalid')
  })
  it('parses centimetres: blank is unknown, zero and negatives are invalid', () => {
    expect(parseCm('')).toBeNull()
    expect(parseCm('220')).toBe(220)
    expect(parseCm('25,5 cm')).toBe(25.5)
    expect(parseCm('25.55')).toBe(25.6)
    expect(parseCm('2000')).toBe(2000)
    for (const bad of ['0', '-3', '2000.5', 'wide', '1e2', '0.04']) expect(parseCm(bad)).toBe('invalid')
    expect(parseCm('4200', 5000)).toBe(4200)
  })
  it('labels only the dimensions that are known', () => {
    expect(dimensionsLabel({ width_cm: 220, depth_cm: 95, height_cm: 85 })).toBe('W 220 × D 95 × H 85 cm')
    expect(dimensionsLabel({ width_cm: 220, depth_cm: null, height_cm: 85.5 })).toBe('W 220 × H 85.5 cm')
    expect(dimensionsLabel({ width_cm: null, depth_cm: null, height_cm: null })).toBe('')
  })
})

describe('rough fit guidance', () => {
  const room = { width_cm: 300, length_cm: 400, height_cm: 240, measurement_notes: null }
  it('says nothing without enough measurements', () => {
    expect(fitGuidance({ width_cm: 220, depth_cm: null, height_cm: null }, room)).toBeNull()
    expect(fitGuidance({ width_cm: 220, depth_cm: 95, height_cm: 85 }, { ...room, width_cm: null, height_cm: null })).toBeNull()
  })
  it('tries both orientations before saying it is too big', () => {
    expect(fitGuidance({ width_cm: 95, depth_cm: 350, height_cm: null }, room)?.verdict).toBe('tight')
    expect(fitGuidance({ width_cm: 350, depth_cm: 95, height_cm: null }, room)?.verdict).toBe('tight')
    expect(fitGuidance({ width_cm: 450, depth_cm: 80, height_cm: null }, room)?.verdict).toBe('no')
    expect(fitGuidance({ width_cm: 310, depth_cm: 310, height_cm: null }, room)?.verdict).toBe('no')
  })
  it('checks height against the ceiling, on its own if that is all there is', () => {
    expect(fitGuidance({ width_cm: 100, depth_cm: 50, height_cm: 250 }, room)).toMatchObject({ verdict: 'no', text: expect.stringContaining('Taller than the room') })
    expect(fitGuidance({ width_cm: null, depth_cm: null, height_cm: 200 }, room)?.verdict).toBe('ok')
    expect(fitGuidance({ width_cm: null, depth_cm: null, height_cm: 260 }, room)?.verdict).toBe('no')
  })
  it('never promises that furniture will fit', () => {
    const ok = fitGuidance({ width_cm: 120, depth_cm: 60, height_cm: 90 }, room)!
    expect(ok.verdict).toBe('ok')
    expect(ok.text).toContain('30%')
    for (const text of [ok.text, FIT_CAVEAT]) expect(text).not.toMatch(/will fit|definitely|guarantee/i)
    expect(FIT_CAVEAT).toMatch(/doorways.*stairs.*hallways/)
  })
})

describe('calendar dates never drift across time zones', () => {
  it('today is the local date, not the UTC date', () => {
    // 12 Nov 00:30 local. (new Date(y, m, d, …) is local time whatever zone the tests run in.)
    expect(todayLocal(new Date(2026, 10, 12, 0, 30))).toBe('2026-11-12')
    expect(todayLocal(new Date(2026, 10, 11, 23, 59))).toBe('2026-11-11')
    expect(todayLocal(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
  })
  it('validates real calendar dates only', () => {
    expect(parseDay('2026-11-20')).toEqual({ y: 2026, m: 11, d: 20 })
    expect(isDay('2028-02-29')).toBe(true)
    for (const bad of ['2026-02-30', '2026-13-01', '20/11/2026', '2026-11-20T00:00:00Z', '1999-01-01', '', null, undefined]) expect(isDay(bad)).toBe(false)
  })
  it('formats a stored date as that same day', () => {
    expect(formatDay('2026-11-20', '2026-11-12')).toMatch(/^20 Nov$/)
    expect(formatDay('2027-01-03', '2026-11-12')).toMatch(/^3 Jan 2027$/)
    expect(formatDay('nonsense')).toBe('')
  })
  it('counts whole days across a daylight-saving change', () => {
    expect(daysBetween('2026-09-26', '2026-09-28')).toBe(2)
    expect(daysBetween('2026-04-04', '2026-04-06')).toBe(2)
    expect(daysBetween('2026-11-12', '2026-11-11')).toBe(-1)
    expect(daysBetween('x', '2026-11-11')).toBeNull()
  })
  it('uses friendly words near today', () => {
    expect(friendlyDay('2026-11-12', '2026-11-12')).toBe('today')
    expect(friendlyDay('2026-11-13', '2026-11-12')).toBe('tomorrow')
    expect(friendlyDay('2026-11-11', '2026-11-12')).toBe('yesterday')
    expect(friendlyDay('2026-11-20', '2026-11-12')).toMatch(/^20 Nov$/)
    expect(friendlyDay(null)).toBe('')
  })
  it('describes delivery progress for list rows', () => {
    const today = '2026-11-12'
    expect(deliveryLine(item('a', { status: 'ordered' }), purchase({ expected_on: '2026-11-13' }), today)).toBe('Due tomorrow')
    expect(deliveryLine(item('a', { status: 'ready_to_collect' }), purchase({ expected_on: '2026-11-12' }), today)).toBe('Collect today')
    expect(deliveryLine(item('a', { status: 'on_the_way' }), purchase({ expected_on: '2026-11-10' }), today)).toMatch(/^Was due 10 Nov$/)
    expect(deliveryLine(item('a', { status: 'delivered' }), purchase({ arrived_on: '2026-11-11' }), today)).toBe('Arrived yesterday')
    expect(deliveryLine(item('a', { status: 'shopping' }), purchase({ expected_on: '2026-11-13' }), today)).toBe('')
    expect(deliveryLine(item('a', { status: 'ordered' }), null, today)).toBe('')
  })
})

describe('web links', () => {
  it('accepts web addresses and adds https', () => {
    expect(normaliseWebUrl('')).toBeNull()
    expect(normaliseWebUrl('mocka.co.nz/sofa')).toBe('https://mocka.co.nz/sofa')
    expect(normaliseWebUrl('http://example.com')).toBe('http://example.com/')
  })
  it('rejects anything that is not an http(s) link', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.nz', 'ftp://x.nz', 'localhost', 'not a link']) expect(normaliseWebUrl(bad)).toBe('invalid')
  })
  it('shows a short host name', () => {
    expect(hostLabel('https://www.mocka.co.nz/sofa?x=1')).toBe('mocka.co.nz')
    expect(hostLabel('nope')).toBe('')
  })
})
