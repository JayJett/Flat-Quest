import { expect, test } from '@playwright/test'
import { hid, mockFlat } from './fixtures'
import { addFlatB, hidB } from './multiFlat'

/**
 * Phase 10 baseline reproductions. Opt-in (BASELINE=1): they document how the Phase 9 build
 * behaves with two flats, and are expected to stop reproducing once Phase 10 lands.
 */
test.describe('baseline (Phase 9 behaviour)', () => {
  test.skip(!process.env.BASELINE, 'Baseline reproductions are opt-in')

  test('an already-member invite opens whichever flat was last used, not the invited one', async ({ page }) => {
    await mockFlat(page)
    const b = await addFlatB(page)
    b.invites.set('harbour-street-invite-code-0001', hidB)
    await page.addInitScript((id) => localStorage.setItem('flatquest.activeHousehold', id), hid)
    await page.goto('./join?code=harbour-street-invite-code-0001')
    await page.getByRole('button', { name: /already in/ }).click()
    await expect(page.getByText('Let’s furnish')).toBeVisible()
    // The greeting names the flat being shown: still Flat A.
    await expect(page.getByText('Our Flat').first()).toBeVisible()
    await page.screenshot({ path: 'reports/screenshots/p10-before-repro-invite.png' })
  })

  test('the active-flat choice is one browser-wide key, shared by every account on the device', async ({ page }) => {
    await mockFlat(page)
    await addFlatB(page)
    await page.addInitScript((id) => localStorage.setItem('flatquest.activeHousehold', id), hidB)
    await page.goto('./')
    await expect(page.locator('[data-section="progress"]')).toBeVisible()
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('flatquest.active')))
    expect(keys).toEqual(['flatquest.activeHousehold'])
  })

  test('there is no way to see or switch flats in the menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockFlat(page)
    await addFlatB(page)
    await page.goto('./')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const menu = page.getByRole('dialog', { name: 'Menu' })
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Harbour Street')).toHaveCount(0)
  })
})
