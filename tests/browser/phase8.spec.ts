import { expect, test, type Page } from '@playwright/test'
import { addEvent, hid, kettle, madi, makeEssential, makeOption, makeTask, mockFlat, rid, uid } from './fixtures'

type State = Awaited<ReturnType<typeof mockFlat>>
const order = (page: Page) => page.locator('[data-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section))
const search = (page: Page) => page.getByRole('dialog', { name: 'Search' })

function seed(state: State) {
  state.essentials.push(makeEssential({ name: 'Toilet paper', quantity: '24-roll pack' }), makeEssential({ name: 'Dish soap', status: 'stocked', archived_at: '2026-11-01T00:00:00.000Z' }))
  state.tasks.push(
    makeTask({ title: 'Assemble the TV cabinet', assignee_id: uid }),
    makeTask({ title: 'Return the old couch', archived_at: '2026-11-10T03:00:00.000Z', assignee_id: madi }),
  )
  state.options.push(makeOption({ name: 'Smeg retro kettle', item_id: kettle, retailer: 'Briscoes' }))
  state.visuals.push({ id: 'v1', household_id: hid, room_id: rid, kind: 'inspiration', title: 'Sage green tiles', notes: null, photo_path: null, thumbnail_path: null, aspect_ratio: 1, source_url: 'https://example.com', taken_on: null, sort_order: 0, created_by: uid, created_at: '2026-11-12T00:00:00.000Z', updated_at: '2026-11-12T00:00:00.000Z' })
}

test.describe('home', () => {
  test('Furnishing progress is first and fixed; Room by Room is gone', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./')
    await expect.poll(() => order(page)).toEqual(['progress', 'focus', 'tasks', 'essentials', 'activity'])
    await expect(page.getByRole('heading', { name: 'Room by room' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Customise Home' }).click()
    const sheet = page.getByRole('dialog', { name: 'Customise Home' })
    await expect(sheet.getByTestId('home-layout-fixed')).toContainText('Furnishing progress')
    await expect(sheet.getByText('Room by room')).toHaveCount(0)
    await expect(sheet.getByRole('switch', { name: /Furnishing progress/ })).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: /Move Furnishing progress/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    // The Rooms tab is untouched.
    await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link', { name: 'Rooms' }).click()
    await expect(page.getByRole('heading', { name: 'Rooms', level: 1 })).toBeVisible()
  })

  test('a Phase 7 layout is normalised without losing the person’s other choices', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    state.prefs = {
      accent: 'mint', greeting_name: 'Lex', motion: 'balanced',
      home_layout: [
        { id: 'activity', hidden: false }, { id: 'rooms', hidden: false }, { id: 'progress', hidden: true },
        { id: 'tasks', hidden: true }, { id: 'focus', hidden: false }, { id: 'essentials', hidden: false }, { id: 'deliveries', hidden: false },
      ],
    }
    await page.goto('./')
    await expect.poll(() => order(page)).toEqual(['progress', 'activity', 'focus', 'essentials'])
    await expect(page.getByTestId('greeting')).toContainText('Lex')
    // Nothing was rewritten just by reading it.
    expect((state.prefs.home_layout as unknown[]).length).toBe(7)
  })
})

test.describe('global search', () => {
  test('finds everything, grouped, and opens the right place', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./')
    await page.getByTestId('search-button').click()
    const box = search(page).getByRole('combobox', { name: 'Search the flat' })
    await expect(box).toBeFocused()
    await expect(search(page).getByTestId('search-intro')).toBeVisible()

    const titles = async (q: string) => {
      await box.fill(q)
      await page.waitForTimeout(150)
      return search(page).getByTestId('search-result').allInnerTexts()
    }
    expect((await titles('KETTLE')).join('\n')).toMatch(/Kettle\nFurnishing item · Kitchen/)
    expect((await titles('  kett ')).some((t) => t.startsWith('Smeg retro kettle'))).toBe(true)
    expect((await titles('toilet'))[0]).toMatch(/^Toilet paper\nEssential · Needed/)
    expect((await titles('dish'))[0]).toMatch(/Essential · Archived/)
    expect((await titles('tv cab'))[0]).toMatch(/^Assemble the TV cabinet\nTask/)
    expect((await titles('couch'))[0]).toMatch(/Task · Archived/)
    expect((await titles('reading'))[0]).toMatch(/^A reading lamp\nWishlist idea/)
    expect((await titles('sage'))[0]).toMatch(/^Sage green tiles\nVisual Home · Kitchen/)
    expect((await titles('briscoes'))[0]).toMatch(/^Smeg retro kettle\nProduct option · for Kettle/)
    // Exact before partial, and groups are labelled.
    const k = await titles('kitchen')
    expect(k[0]).toMatch(/^Kitchen\nRoom/)
    await expect(search(page).getByText('Rooms', { exact: true })).toBeVisible()

    await box.fill('zzzz')
    await expect(search(page).getByTestId('search-empty')).toContainText('No matches for “zzzz”')
    await expect(page.getByRole('status').filter({ hasText: 'No results for zzzz' })).toBeAttached()

    // Keyboard: arrow to a result and press Enter.
    await box.fill('kettle')
    await page.waitForTimeout(150)
    await box.press('ArrowDown')
    await expect(search(page).locator('[role="option"][aria-selected="true"]')).toContainText('Smeg retro kettle')
    await box.press('ArrowUp')
    await box.press('Enter')
    await expect(search(page)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/rooms/${rid}$`))
    await expect(page.getByRole('dialog', { name: 'Item details' })).toBeVisible()
  })

  test('closes with Escape, Cancel and Back; reopens empty; never overlaps other panels', async ({ page }) => {
    const state = await mockFlat(page)
    seed(state)
    await page.goto('./tasks')
    await expect(page.getByRole('heading', { name: 'Things to do', level: 1 })).toBeVisible()
    const url = page.url()
    await page.keyboard.press('/')
    await expect(search(page)).toBeVisible()
    await search(page).getByRole('combobox').fill('toilet')
    await page.keyboard.press('Escape')
    await expect(search(page)).toBeHidden()
    await page.getByTestId('search-button').click()
    await expect(search(page).getByRole('combobox')).toHaveValue('')
    await search(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(search(page)).toBeHidden()
    await page.getByTestId('search-button').click()
    await page.goBack()
    await expect(search(page)).toBeHidden()
    expect(page.url()).toBe(url)
    // Only one panel at a time.
    await page.getByTestId('search-button').click()
    await page.getByTestId('notification-bell').dispatchEvent('click')
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
    await expect(search(page)).toBeHidden()
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })

  test('mobile: full-screen, above the tab bar, results scroll on their own', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 })
    const state = await mockFlat(page)
    seed(state)
    for (let i = 0; i < 30; i++) state.tasks.push(makeTask({ title: `Task number ${i}` }))
    await page.goto('./')
    await page.getByTestId('search-button').click()
    const box = (await search(page).boundingBox())!
    expect(box.x).toBe(0)
    expect(Math.round(box.width)).toBe(390)
    expect(Math.round(box.height)).toBe(664)
    await search(page).getByRole('combobox').fill('task')
    await page.waitForTimeout(150)
    const scrollY = await page.evaluate(() => window.scrollY)
    await search(page).getByTestId('search-result').last().scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  })
})

test.describe('notification preferences and reminders', () => {
  test('switches save per person, persist, and membership stays on', async ({ page }) => {
    const state = await mockFlat(page)
    await page.goto('./settings')
    const panel = page.getByTestId('notification-settings')
    await expect(panel.getByTestId('notifications-always-on')).toContainText('Always on')
    await panel.getByRole('switch', { name: 'Assignments' }).click()
    await panel.getByRole('switch', { name: 'Gentle reminders' }).click()
    await expect.poll(() => (state.prefs as { muted_notifications?: string[] } | null)?.muted_notifications).toEqual(['assignments', 'reminders'])
    await page.reload()
    await expect(page.getByTestId('notification-settings').getByRole('switch', { name: 'Assignments' })).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('notification-settings').getByRole('switch', { name: 'Discussions and mentions' })).toHaveAttribute('aria-checked', 'true')
    // Make it yours' reset leaves notification choices alone, and vice versa.
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect.poll(() => (state.prefs as { muted_notifications?: string[] } | null)?.muted_notifications).toEqual(['assignments', 'reminders'])
    await page.getByRole('button', { name: 'Turn everything back on' }).click()
    await expect.poll(() => (state.prefs as { muted_notifications?: string[] } | null)?.muted_notifications).toEqual([])
  })

  test('reminders read as friendly nudges and open the task or essential', async ({ page }) => {
    const state = await mockFlat(page)
    seed(state)
    const task = state.tasks[0]!
    addEvent(state, { type: 'task_reminder', actor_id: null, actor_name: null, task_id: task.id, data: { task: task.title, due: '2026-11-03', stage: 1 } }, { reason: 'reminder' })
    addEvent(state, { type: 'essential_reminder', actor_id: null, actor_name: null, essential_id: state.essentials[0]!.id, data: { essential: 'Toilet paper', days: 3 } }, { reason: 'reminder' })
    await page.goto('./')
    await page.getByTestId('notification-bell').click()
    const drawer = page.getByRole('dialog', { name: 'Notifications' })
    await expect(drawer.getByText('Toilet paper has been on the list for 3 days. Still need it?')).toBeVisible()
    await expect(drawer.getByText(/^Friendly nudge: Assemble the TV cabinet was due on 3 Nov\.$/)).toBeVisible()
    await drawer.getByText(/Friendly nudge/).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible()
  })
})

test.describe('everyday usability', () => {
  test('archived tasks: separate view, context, one-tap restore', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./tasks')
    await expect(page.getByText('Return the old couch')).toHaveCount(0)
    await page.getByRole('button', { name: 'Archived tasks' }).click()
    const row = page.getByTestId('archived-task-row').filter({ hasText: 'Return the old couch' })
    await expect(row).toContainText('Archived 10 Nov · not done · for Madi')
    await row.getByRole('button', { name: 'Restore Return the old couch' }).click()
    await expect(page.getByText('Return the old couch is back on the list')).toBeVisible()
    expect(state.tasks.find((t) => t.title === 'Return the old couch')!.archived_at).toBeNull()
    await page.getByRole('button', { name: 'Back to tasks' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Return the old couch' })).toBeVisible()
  })

  test('essentials: optional usual amount, archived restore, quick add unchanged', async ({ page }) => {
    const state = await mockFlat(page)
    seed(state)
    await page.goto('./essentials')
    await expect(page.getByTestId('essential-row').filter({ hasText: 'Toilet paper' }).getByTestId('essential-meta')).toHaveText('24-roll pack')
    await page.getByRole('button', { name: /^Toilet paper/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Essential' })
    await sheet.getByLabel('Usual amount').fill('Two packs')
    await sheet.getByLabel('Note').fill('The unscented one')
    await sheet.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => state.essentials.find((e) => e.name === 'Toilet paper')).toMatchObject({ quantity: 'Two packs', note: 'The unscented one' })
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: /Archived/ }).click()
    await page.getByRole('button', { name: 'Restore Dish soap' }).click()
    await expect(page.getByText('Dish soap is on the list again')).toBeVisible()
    const box = page.getByRole('textbox', { name: 'Add an essential' })
    await box.fill('Bin liners')
    await box.press('Enter')
    await expect.poll(() => state.essentials.some((e) => e.name === 'Bin liners')).toBe(true)
  })

  test('Back returns to the same scroll position', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 })
    const state = await mockFlat(page)
    seed(state)
    for (let i = 0; i < 25; i++) state.tasks.push(makeTask({ title: `Chore ${i}` }))
    await page.goto('./tasks')
    await expect(page.getByTestId('task-row').filter({ hasText: 'Chore 24' })).toBeVisible()
    await page.evaluate(() => window.scrollTo({ top: 900 }))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600)
    const before = await page.evaluate(() => window.scrollY)
    await page.getByTestId('search-button').click()
    await search(page).getByRole('combobox').fill('toilet')
    await page.waitForTimeout(150)
    await search(page).getByTestId('search-result').first().click()
    await expect(page).toHaveURL(/\/essentials/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await page.goBack()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(Math.round(before))
  })
})
