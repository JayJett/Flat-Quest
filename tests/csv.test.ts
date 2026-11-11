import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checklistFromCsv, cleanRoomName, parseCsv } from '@/lib/csv'
import { withLandlordAppliances } from '@/household/importChecklist'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and CRLF', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ])
  })
  it('strips a UTF-8 BOM and blank lines', () => {
    expect(parseCsv('﻿Room,Item\n\n,\nKitchen,Kettle')).toEqual([
      ['Room', 'Item'],
      ['Kitchen', 'Kettle'],
    ])
  })
})

describe('cleanRoomName', () => {
  it('removes leading emoji and variation selectors', () => {
    expect(cleanRoomName('🛋️ Living room')).toBe('Living room')
    expect(cleanRoomName('🧺 Laundry & cleaning')).toBe('Laundry & cleaning')
    expect(cleanRoomName('Kitchen')).toBe('Kitchen')
  })
})

describe('bundled 9 Rua Kai Wai checklist', () => {
  const { rows, warnings } = checklistFromCsv(readFileSync('data/checklist.csv', 'utf8'))

  it('contains exactly the 103 items from the Google Sheet', () => {
    expect(warnings).toEqual([])
    expect(rows).toHaveLength(103)
  })

  it('preserves the ten rooms and their item counts', () => {
    const counts = Object.fromEntries(
      [...new Set(rows.map((r) => r.room))].map((room) => [room, rows.filter((r) => r.room === room).length]),
    )
    expect(counts).toEqual({
      'Living room': 11,
      Kitchen: 26,
      Dining: 4,
      'Shared bathroom': 10,
      'Master ensuite': 8,
      'Laundry & cleaning': 14,
      'Master bedroom': 9,
      'Other bedrooms': 5,
      'Entry & safety': 12,
      'Outdoor & carport': 4,
    })
  })

  it('maps priorities exactly (74 must-have, 21 nice to have, 8 maybe later)', () => {
    const by = (p: string) => rows.filter((r) => r.priority === p).length
    expect([by('must_have'), by('nice_to_have'), by('maybe_later')]).toEqual([74, 21, 8])
  })

  it('keeps the sheet defaults: unclaimed, to decide, not done', () => {
    expect(rows.every((r) => r.status === 'to_decide' && !r.done && r.responsible === 'Unclaimed')).toBe(true)
  })

  it('keeps quoted item names intact', () => {
    expect(rows.some((r) => r.name === 'Duvet, pillows and bedding')).toBe(true)
  })

  it('gives every room an icon and colour preset', () => {
    const ensuite = rows.find((r) => r.room === 'Master ensuite')!
    const shared = rows.find((r) => r.room === 'Shared bathroom')!
    expect(ensuite.room_icon).toBe('shower-head')
    expect(shared.room_icon).toBe('bath')
    expect(new Set(rows.map((r) => r.room_color)).size).toBe(10)
  })
})

describe('checklistFromCsv with the raw sheet export layout', () => {
  const sheet = [
    '✅ FLAT QUEST — Everything We Need,,,,,,,,,,',
    'Claim what you’re bringing,,,,,,,,,,',
    ',,,,,,,,,,',
    "Room,Item / what we need,Done? ✅,Who's on it?,Plan / status,Priority,Owned by,Budget NZ$,Spent NZ$,Shopping link,Notes",
    '🍳 Kitchen,Kettle,TRUE,Madi,Ordered,Must-have,Shared,$45,"1,200.50",https://example.com/k,Blue one',
    '🍳 Kitchen,Toaster,FALSE,Unclaimed,Mystery,Urgent,To decide,,,not a url,',
    ',Orphan item,FALSE,,,,,,,,',
  ].join('\n')
  const { rows, warnings } = checklistFromCsv(sheet)

  it('finds the header row below the title rows and maps every column', () => {
    expect(rows[0]).toMatchObject({
      room: 'Kitchen',
      name: 'Kettle',
      done: true,
      responsible: 'Madi',
      status: 'ordered',
      priority: 'must_have',
      owned_by: 'Shared',
      estimated_price: 45,
      actual_price: 1200.5,
      shopping_url: 'https://example.com/k',
      notes: 'Blue one',
    })
  })

  it('falls back safely and reports unknown values', () => {
    expect(rows[1]).toMatchObject({ status: 'to_decide', priority: 'must_have', shopping_url: '' })
    expect(warnings.some((w) => w.includes('unknown status'))).toBe(true)
    expect(warnings.some((w) => w.includes('unknown priority'))).toBe(true)
    expect(warnings.some((w) => w.includes('needs a room and a name'))).toBe(true)
    expect(rows).toHaveLength(2)
  })
})

describe('landlord appliances for new households', () => {
  const rows = withLandlordAppliances(checklistFromCsv(readFileSync('data/checklist.csv', 'utf8')).rows)
  const provided = rows.filter((r) => r.status === 'provided')

  it('marks the sheet appliances provided and adds the dishwasher and dryer', () => {
    expect(provided.map((r) => r.name).sort()).toEqual(
      ['Dishwasher', 'Dryer', 'Fridge / freezer (confirm supplied)', 'Microwave', 'Washing machine (confirm supplied)'].sort(),
    )
    expect(provided.every((r) => r.owned_by === 'Landlord')).toBe(true)
    expect(rows).toHaveLength(105)
  })

  it('does not catch look-alike items', () => {
    expect(rows.find((r) => r.name === 'Dishwashing liquid')?.status).toBe('to_decide')
    expect(rows.find((r) => r.name === 'Clothes drying rack')?.status).toBe('to_decide')
  })

  it('understands "Provided with flat" in imported CSVs', () => {
    const { rows: r } = checklistFromCsv('Room,Item,Plan / status\nKitchen,Fridge,Provided with flat')
    expect(r[0]?.status).toBe('provided')
  })
})
