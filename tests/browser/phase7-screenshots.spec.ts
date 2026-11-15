import { expect, test } from '@playwright/test'
import { addEvent, kettle, madi, makeEssential, makeTask, mockFlat, rid, uid } from './fixtures'

// Evidence only, with invented fixture people (Alex, Madi) and data. Opt-in: SHOTS=1.
const local = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

for (const size of [{ name: 'iphone', width: 390, height: 844 }, { name: 'small', width: 320, height: 568 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`Phase 7 evidence ${size.name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS, 'Screenshot generation is opt-in')
    await page.setViewportSize(size)
    const state = await mockFlat(page, false, { flatmates: true })
    state.essentials.push(
      makeEssential({ name: 'Toilet paper', category: 'bathroom' }),
      makeEssential({ name: 'Dishwashing liquid', status: 'getting', claimed_by: madi }),
      makeEssential({ name: 'Rubbish bags', note: 'The big ones' }),
      makeEssential({ name: 'Sponges', status: 'stocked', restocked_at: new Date(Date.now() - 86_400_000).toISOString() }),
    )
    state.tasks.push(
      makeTask({ title: 'Assemble the TV cabinet', assignee_id: uid, due_on: local(0), room_id: rid }),
      makeTask({ title: 'Contact the property manager', due_on: local(-1) }),
      makeTask({ title: 'Take cardboard to recycling', assignee_id: madi, due_on: local(2), status: 'doing' }),
      makeTask({ title: 'Change the hallway lightbulb', due_on: null }),
    )
    state.items[0]!.status = 'on_the_way'
    addEvent(state, { type: 'essential_restocked', in_timeline: true, data: { essential: 'Sponges' } })
    addEvent(state, { type: 'task_added', in_timeline: true, item_id: kettle, data: { task: 'Assemble the TV cabinet' } })
    state.prefs = { accent: 'blue', greeting_name: 'Alex', motion: 'balanced', home_layout: [] }

    await page.goto('./')
    await expect(page.locator('[data-section="essentials"]').getByText('Toilet paper')).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `reports/screenshots/p7-${size.name}-home.png`, fullPage: true })

    await page.goto('./essentials')
    await expect(page.getByTestId('essential-row').first()).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `reports/screenshots/p7-${size.name}-essentials.png`, fullPage: true })

    await page.goto('./tasks')
    await expect(page.getByTestId('task-row').first()).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `reports/screenshots/p7-${size.name}-tasks.png`, fullPage: true })
    // Mid-celebration: the tick has sprung in and its ring and sparks are popping.
    await page.getByRole('checkbox', { name: 'Mark Assemble the TV cabinet as done' }).click()
    await page.waitForTimeout(160)
    await page.screenshot({ path: `reports/screenshots/p7-${size.name}-task-complete.png` })

    await page.goto('./settings')
    await page.getByTestId('make-it-yours').getByRole('radio', { name: 'Mint' }).click()
    await page.waitForTimeout(400)
    await page.getByTestId('make-it-yours').screenshot({ path: `reports/screenshots/p7-${size.name}-make-it-yours.png` })
    await page.goto('./')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `reports/screenshots/p7-${size.name}-home-mint.png` })

    await page.goto('./settings')
    await page.getByTestId('make-it-yours').getByRole('radio', { name: 'Coral' }).click()
    await page.goto('./tasks')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `reports/screenshots/p7-${size.name}-tasks-coral.png` })

    await page.goto('./')
    await page.getByRole('button', { name: 'Customise Home' }).click()
    await expect(page.getByRole('dialog', { name: 'Customise Home' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `reports/screenshots/p7-${size.name}-customise-home.png` })
  })
}
