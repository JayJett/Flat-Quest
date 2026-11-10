import { describe, expect, it } from 'vitest'
import { MEMBER_COLORS, ROOM_COLORS } from '@/design/tokens'
import { contrast, normaliseHex, readableOn } from '@/lib/color'
import { parseInviteCode } from '@/pages/Welcome'

describe('design tokens', () => {
  it('every room colour has ≥3:1 contrast with its label colour (large text)', () => {
    for (const c of ROOM_COLORS) expect(contrast(c.hex, c.on), c.key).toBeGreaterThanOrEqual(3)
  })
  it('secondary text meets WCAG AA on white and on the grey surface', () => {
    expect(contrast('#737378', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#737378', '#F5F5F6')).toBeGreaterThan(4.3)
  })
  it('accent and status text colours meet AA on white', () => {
    for (const hex of ['#3657E8', '#16855C', '#C2410C', '#5B5BD6', '#C9302C']) {
      expect(contrast(hex, '#FFFFFF'), hex).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('member colours always get a readable initials colour', () => {
    for (const c of MEMBER_COLORS) expect(contrast(c.hex, readableOn(c.hex)), c.label).toBeGreaterThanOrEqual(3)
  })
})

describe('normaliseHex', () => {
  it('accepts 3/6 digit hex with or without #', () => {
    expect(normaliseHex('3657e8')).toBe('#3657E8')
    expect(normaliseHex('#abc')).toBe('#AABBCC')
    expect(normaliseHex('nope')).toBeNull()
    expect(normaliseHex('#12345')).toBeNull()
  })
})

describe('parseInviteCode', () => {
  it('extracts codes from links and bare codes', () => {
    expect(parseInviteCode('https://flat.example/join?code=abcDEF123_-abcdefgh')).toBe('abcDEF123_-abcdefgh')
    expect(parseInviteCode('  abcDEF123_-abcdefghij ')).toBe('abcDEF123_-abcdefghij')
    expect(parseInviteCode('hello')).toBeNull()
    expect(parseInviteCode('')).toBeNull()
  })
})
