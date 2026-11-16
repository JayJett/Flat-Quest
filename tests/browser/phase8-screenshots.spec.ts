import { expect, test } from '@playwright/test'
import { hid, kettle, madi, makeEssential, makeOption, makeTask, mockFlat, rid, uid } from './fixtures'

// Evidence only, with invented fixture people (Alex, Madi) and data. Opt-in: SHOTS=1.
const local = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

for (const size of [{ name: 'iphone', width: 390, height: 844 }, { name: 'small', width: 320, height: 568 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`Phase 8 evidence ${size.name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS, 'Screenshot generation is opt-in')
    await page.setViewportSize(size)
    const state = await mockFlat(page, false, { flatmates: true })
    state.essentials.push(
      makeEssential({ name: 'Toilet paper', quantity: '24-roll pack', note: 'The recycled one' }),
      makeEssential({ name: 'Dishwashing liquid', quantity: 'Large bottle', status: 'getting', claimed_by: madi }),
      makeEssential({ name: 'Washing powder', quantity: '2 kg box' }),
    )
    state.tasks.push(
      makeTask({ title: 'Assemble the TV cabinet', assignee_id: uid, due_on: local(0) }),
      makeTask({ title: 'Take cardboard to recycling', assignee_id: madi, due_on: local(2) }),
      makeTask({ title: 'Return the old couch', archived_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), assignee_id: madi }),
      makeTask({ title: 'Measure the lounge window', archived_at: new Date(Date.now() - 6 * 86_400_000).toISOString(), status: 'done', completed_at: new Date(Date.now() - 7 * 86_400_000).toISOString() }),
    )
    state.options.push(makeOption({ name: 'Smeg retro kettle', item_id: kettle, retailer: 'Briscoes' }))
    state.visuals.push({ id: 'v1', household_id: hid, room_id: rid, kind: 'inspiration', title: 'Kitchen shelf styling', notes: null, photo_path: null, thumbnail_path: null, aspect_ratio: 1, source_url: 'https://example.com', taken_on: null, sort_order: 0, created_by: uid, created_at: '2026-11-12T00:00:00.000Z', updated_at: '2026-11-12T00:00:00.000Z' })
    state.prefs = { accent: 'blue', greeting_name: 'Alex', motion: 'balanced', home_layout: [] }

    await page.goto('./')
    await expect(page.locator('[data-section="progress"]')).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `reports/screenshots/p8-${size.name}-home.png`, fullPage: true })

    await page.getByRole('button', { name: 'Customise Home' }).click()
    await expect(page.getByRole('dialog', { name: 'Customise Home' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `reports/screenshots/p8-${size.name}-customise-home.png` })
    await page.keyboard.press('Escape')

    await page.getByTestId('search-button').click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `reports/screenshots/p8-${size.name}-search-open.png` })
    await page.getByRole('combobox', { name: 'Search the flat' }).fill('k')
    await page.waitForTimeout(200)
    await page.getByRole('combobox', { name: 'Search the flat' }).fill('kit')
    await page.waitForTimeout(400)
    await page.screenshot({ path: `reports/screenshots/p8-${size.name}-search-results.png` })
    await page.keyboard.press('Escape')

    await page.goto('./settings')
    await page.getByTestId('notification-settings').getByRole('switch', { name: 'Milestones' }).click()
    await page.waitForTimeout(400)
    await page.getByTestId('notification-settings').screenshot({ path: `reports/screenshots/p8-${size.name}-notification-settings.png` })

    await page.goto('./tasks')
    await page.getByRole('button', { name: 'Archived tasks' }).click()
    await expect(page.getByTestId('archived-task-row').first()).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `reports/screenshots/p8-${size.name}-task-archive.png` })

    await page.goto('./essentials')
    await expect(page.getByTestId('essential-row').first()).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `reports/screenshots/p8-${size.name}-essentials.png` })
  })
}
