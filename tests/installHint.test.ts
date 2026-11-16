import { describe, expect, it } from 'vitest'
import { shouldShowIosInstallHint } from '@/components/InstallHint'

const nav = (userAgent: string, extra: Partial<Navigator & { standalone: boolean }> = {}) =>
  ({ userAgent, platform: 'iPhone', maxTouchPoints: 5, ...extra }) as unknown as Navigator
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

describe('iOS Home Screen hint', () => {
  it('shows in iPhone Safari', () => expect(shouldShowIosInstallHint(nav(SAFARI), false)).toBe(true))
  it('hides once installed', () => {
    expect(shouldShowIosInstallHint(nav(SAFARI), true)).toBe(false)
    expect(shouldShowIosInstallHint(nav(SAFARI, { standalone: true }), false)).toBe(false)
  })
  it('hides in other iOS browsers', () => expect(shouldShowIosInstallHint(nav(SAFARI.replace('Version/18.0', 'CriOS/130.0')), false)).toBe(false))
  it('recognises iPadOS presenting as a Mac', () =>
    expect(shouldShowIosInstallHint(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', { platform: 'MacIntel', maxTouchPoints: 5 }), false)).toBe(true))
  it('never shows on desktop or Android', () => {
    expect(shouldShowIosInstallHint(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', { platform: 'MacIntel', maxTouchPoints: 0 }), false)).toBe(false)
    expect(shouldShowIosInstallHint(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', { platform: 'Linux' }), false)).toBe(false)
  })
})
