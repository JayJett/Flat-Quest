import { expect, test, type Page } from '@playwright/test'
import { hid, kettle, madi, makeAppointment, makeTask, mockFlat, uid, zonedFixtureInstant } from './fixtures'
import { addFlatB, hidB } from './multiFlat'

/**
 * Phase 10 visual evidence with two synthetic flats (overlapping room names, different records).
 *   SHOTS=1 SHOT_PREFIX=p10-before npx playwright test phase10-screenshots --project=desktop-chromium
 *   SHOTS=1 SHOT_PREFIX=p10-after  npx playwright test phase10-screenshots --project=desktop-chromium
 */
const PREFIX = process.env.SHOT_PREFIX ?? 'p10-after'
const AFTER = PREFIX !== 'p10-before'
const local = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function setup(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size)
  const a = await mockFlat(page, false, { flatmates: true })
  a.tasks.push(
    makeTask({ title: 'Assemble the TV cabinet', assignee_id: uid, due_on: local(0) }),
    makeTask({ title: 'Book the carpet clean', assignee_id: madi, due_on: local(2), status: 'doing' }),
  )
  a.items[0]!.status = 'ordered'
  a.items[2]!.status = 'ready_to_collect'
  a.purchases.push(
    { item_id: kettle, household_id: hid, option_id: null, purchased_by: uid, purchased_on: local(-3), order_reference: null, notes: null, delivery_method: 'delivery', expected_on: local(1), tracking_url: null, delivery_notes: null, arrived_on: null, updated_by: uid, created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z' },
    { item_id: a.items[2]!.id, household_id: hid, option_id: null, purchased_by: madi, purchased_on: local(-2), order_reference: null, notes: null, delivery_method: 'pickup', expected_on: local(3), tracking_url: null, delivery_notes: null, arrived_on: null, updated_by: madi, created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z' },
  )
  a.prefs = { accent: 'blue', greeting_name: 'Alex', motion: 'balanced', home_layout: [] }
  const at = (d: string, t: string) => zonedFixtureInstant(d, t, 'Pacific/Auckland')
  a.appointments.push(
    makeAppointment({ title: 'Property inspection', scheduled_on: local(1), all_day: false, starts_at: at(local(1), '10:00'), ends_at: at(local(1), '11:00'), needs_cover: true, created_by: uid, notes: 'Tidy the lounge and leave the side gate open.' }),
    makeAppointment({ title: 'Meter reading', scheduled_on: local(2), all_day: false, starts_at: at(local(2), '13:00'), ends_at: at(local(2), '15:00'), needs_cover: true, host_id: madi, created_by: madi }),
    makeAppointment({ title: 'Bin day', scheduled_on: local(0) }),
  )
  const b = await addFlatB(page)
  b.tasks.push(makeTask({ title: 'Return the Harbour Street keys', household_id: hidB, due_on: local(1) }))
  b.invites.set('harbour-street-invite-code-0001', hidB)
  // A returning person: Our Flat was last used (seeded once, so later steps can clear it).
  if (AFTER) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k!, v!); sessionStorage.setItem('seeded', '1') } }, [`flatquest.activeHousehold.${uid}`, hid])
  return { a, b }
}

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `reports/screenshots/${PREFIX}-${name}.png`, fullPage: full })
}

for (const size of [{ name: 'iphone', width: 390, height: 844 }, { name: 'small', width: 320, height: 568 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`Phase 10 screens ${size.name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS, 'Screenshot generation is opt-in')
    test.setTimeout(120_000)
    await setup(page, size)
    const s = size.name
    await page.goto('./')
    await expect(page.locator('[data-section="progress"]')).toBeVisible()
    await shot(page, `${s}-home`)
    if (size.name !== 'desktop') {
      await page.getByRole('button', { name: 'Open menu' }).click()
      await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
      await shot(page, `${s}-menu`)
      await page.keyboard.press('Escape')
    }
    await page.goto('./tasks')
    await shot(page, `${s}-tasks`)
    await page.goto('./rooms/shopping')
    await shot(page, `${s}-shopping`)
    // Invite to a flat Alex already belongs to.
    await page.goto('./join?code=harbour-street-invite-code-0001')
    await expect(page.getByRole('heading', { name: 'Harbour Street' })).toBeVisible()
    await shot(page, `${s}-invite`)
    if (!AFTER) return

    await page.goto('./calendar')
    await expect(page.getByRole('heading', { name: 'This week', level: 1 })).toBeVisible()
    await shot(page, `${s}-calendar`)
    await shot(page, `${s}-calendar-full`, true)
    // A covered appointment, then the form, then the rescheduled (coverage reopened) state.
    await page.getByTestId('calendar-entry').filter({ hasText: 'Meter reading' }).click()
    await shot(page, `${s}-appointment-covered`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Add an appointment' }).first().click()
    await page.getByRole('dialog', { name: 'New appointment' }).getByLabel('What’s happening?').fill('Electrician visit')
    await shot(page, `${s}-appointment-form`)
    await page.keyboard.press('Escape')
    await page.getByTestId('calendar-entry').filter({ hasText: 'Property inspection' }).click()
    await page.getByRole('dialog', { name: 'Appointment' }).getByRole('button', { name: 'I can be home' }).click()
    await expect(page.getByRole('dialog', { name: 'Appointment' }).getByTestId('coverage')).toContainText('You’ll be home')
    await page.getByRole('dialog', { name: 'Appointment' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('dialog', { name: 'Edit appointment' }).getByLabel('Starts').fill('14:00')
    await page.getByRole('dialog', { name: 'Edit appointment' }).getByLabel('Ends').fill('15:00')
    await page.getByRole('dialog', { name: 'Edit appointment' }).getByRole('button', { name: 'Save changes' }).click()
    await shot(page, `${s}-appointment-reopen-confirm`)
    await page.getByRole('dialog', { name: 'Reopen coverage?' }).getByRole('button', { name: 'Move it' }).click()
    await expect(page.getByRole('dialog', { name: 'Appointment' }).getByTestId('coverage')).toContainText('Needs someone home')
    await shot(page, `${s}-appointment-rescheduled`)
    await page.keyboard.press('Escape')
    await page.goto(`./calendar?week=${local(28)}`)
    await shot(page, `${s}-calendar-empty`)
    // Choosing a flat, and starting another one.
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('flatquest.activeHousehold')) localStorage.removeItem(k) })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Which flat?' })).toBeVisible()
    await shot(page, `${s}-flat-chooser`)
    await page.getByRole('button', { name: /Our Flat/ }).click()
    if (size.name !== 'desktop') {
      await page.getByRole('button', { name: 'Open menu' }).click()
      await shot(page, `${s}-menu-flats`)
      await page.keyboard.press('Escape')
    }
    await page.goto('./welcome?add=1')
    await page.getByRole('button', { name: /Set up our flat/ }).click()
    await shot(page, `${s}-new-flat`)
  })
}
