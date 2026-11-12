import { describe, expect, it } from 'vitest'
import { movedOrder, safeSource, type Visual } from '../src/visual/types'

describe('visual board links and ordering', () => {
  it('allows optional sources and normalizes safe links', () => { expect(safeSource(' ')).toBeNull(); expect(safeSource(' https://example.com ')).toBe('https://example.com/') })
  it.each(['javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.com', 'file:///etc/passwd', 'not a URL'])('rejects unsafe link %s', value => { expect(() => safeSource(value)).toThrow() })
  const rows = [0, 1024, 2048].map((sort_order, i) => ({ id: String(i), sort_order }) as Visual)
  it('moves between neighbours without rewriting other cards', () => { expect(movedOrder(rows, 2, -1)).toBe(512); expect(movedOrder(rows, 0, 1)).toBe(1536) })
  it('moves to the edges', () => { expect(movedOrder(rows, 1, -1)).toBe(-1024); expect(movedOrder(rows, 1, 1)).toBe(3072) })
  it('does not move outside the board', () => { expect(movedOrder(rows, 0, -1)).toBe(0); expect(movedOrder(rows, 2, 1)).toBe(2048) })
})

