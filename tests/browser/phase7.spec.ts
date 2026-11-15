import { expect, test, type Page } from '@playwright/test'
import { addEvent, madi, makeEssential, makeTask, mockFlat, uid } from './fixtures'

type State = Awaited<ReturnType<typeof mockFlat>>
const local = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const accentVar = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim().toLowerCase())
const errors = (page: Page) => {
  const list: string[] = []
  page.on('pageerror', (e) => list.push(e.message))
  return list
}

function seed(state: State) {
  state.essentials.push(
    makeEssential({ name: 'Toilet paper', category: 'bathroom' }),
    makeEssential({ name: 'Dishwashing liquid', status: 'getting', claimed_by: madi }),
    makeEssential({ name: 'Sponges', status: 'stocked', restocked_at: new Date().toISOString() }),
  )
  state.tasks.push(
    makeTask({ title: 'Assemble the TV cabinet', assignee_id: uid, due_on: local(0) }),
    makeTask({ title: 'Contact the property manager', due_on: local(-2) }),
    makeTask({ title: 'Take cardboard to recycling', assignee_id: madi, due_on: local(3) }),
  )
}

test.describe('household essentials', () => {
  test('quick add, duplicate detection and suggestions', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./essentials')
    await expect(page.getByRole('heading', { name: 'Essentials', level: 1 })).toBeVisible()
    await expect(page.getByTestId('essential-row')).toHaveCount(2)
    const box = page.getByRole('textbox', { name: 'Add an essential' })
    await box.fill('  toilet   PAPER ')
    await expect(page.getByText('Toilet paper is already on the list.')).toBeVisible()
    await page.getByRole('button', { name: 'Add essential' }).click()
    await expect(page.getByText('Toilet paper is already on the list', { exact: true })).toBeVisible()
    expect(state.essentials.filter((e) => e.name.toLowerCase() === 'toilet paper')).toHaveLength(1)

    await box.fill('sponges')
    await expect(page.getByText(/You’ve had Sponges before/)).toBeVisible()
    await box.fill('spong')
    await page.getByRole('list', { name: 'Suggestions' }).getByRole('button', { name: 'Sponges' }).click()
    await expect(page.getByText('Sponges is on the list again')).toBeVisible()
    expect(state.essentials.filter((e) => e.name === 'Sponges')).toHaveLength(1)
    expect(state.essentials.find((e) => e.name === 'Sponges')!.status).toBe('needed')

    await page.getByRole('list', { name: 'Common essentials' }).getByRole('button', { name: 'Rubbish bags' }).click()
    await expect(page.getByTestId('essential-row').filter({ hasText: 'Rubbish bags' })).toBeVisible()
    await box.fill('Oat milk')
    await box.press('Enter')
    await expect(page.getByTestId('essential-row').filter({ hasText: 'Oat milk' })).toBeVisible()
    await expect(box).toHaveValue('')
  })

  test('claim, conflict, restock with undo, need again', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    const pageErrors = errors(page)
    await page.goto('./essentials')
    const tp = page.getByTestId('essential-row').filter({ hasText: 'Toilet paper' })
    await tp.getByRole('button', { name: 'I’ll get Toilet paper' }).click()
    await expect(tp.getByText('You’re getting it')).toBeVisible()
    await expect(page.getByTestId('essential-row').filter({ hasText: 'Dishwashing liquid' }).getByText('Madi’s getting it')).toBeVisible()

    // A flatmate claimed it a moment ago on their phone: the stale screen is told, not overwritten.
    state.essentials.push(makeEssential({ name: 'Hand soap' }))
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    const soap = page.getByTestId('essential-row').filter({ hasText: 'Hand soap' })
    await expect(soap).toBeVisible()
    Object.assign(state.essentials.find((e) => e.name === 'Hand soap')!, { status: 'getting', claimed_by: madi })
    await soap.getByRole('button', { name: 'I’ll get Hand soap' }).click()
    await expect(page.getByText('Madi is already getting Hand soap')).toBeVisible()
    await expect(soap.getByText('Madi’s getting it')).toBeVisible()

    // Restock: the row leaves the active list, a toast offers Undo.
    await tp.getByRole('checkbox', { name: 'Mark Toilet paper as restocked' }).dblclick()
    await expect(page.getByText('Toilet paper restocked')).toBeVisible()
    await expect(tp).toHaveCount(0)
    expect(state.essentialCalls.filter((c) => c.p_action === 'restock')).toHaveLength(1)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('essential-row').filter({ hasText: 'Toilet paper' }).getByText('You’re getting it')).toBeVisible()
    expect(state.restocks).toHaveLength(0)

    // Need again from the Stocked view.
    await page.getByRole('radio', { name: /Stocked/ }).click()
    await page.getByRole('button', { name: 'Need Sponges again' }).click()
    await expect(page.getByText('Sponges is on the list again')).toBeVisible()
    await page.getByRole('radio', { name: /To get/ }).click()
    await expect(page.getByTestId('essential-row').filter({ hasText: 'Sponges' })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('a failed write rolls back with a clear message', async ({ page }) => {
    const state = await mockFlat(page)
    seed(state)
    state.failEssential = true
    await page.goto('./essentials')
    const tp = page.getByTestId('essential-row').filter({ hasText: 'Toilet paper' })
    await tp.getByRole('checkbox', { name: 'Mark Toilet paper as restocked' }).click()
    await expect(page.getByText('Essentials unavailable')).toBeVisible()
    await expect(tp).toBeVisible()
    expect(state.essentials.find((e) => e.name === 'Toilet paper')!.status).toBe('needed')
  })

  test('details: hand over, history, archive', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./essentials')
    await page.getByTestId('essential-row').filter({ hasText: 'Toilet paper' }).getByRole('button', { name: 'I’ll get Toilet paper' }).click()
    await page.getByTestId('essential-row').filter({ hasText: 'Toilet paper' }).getByRole('button', { name: /^Toilet paper/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Essential' })
    await sheet.getByLabel('Hand it to').selectOption({ label: 'Madi' })
    await expect(page.getByText('Asked Madi to get it')).toBeVisible()
    expect(state.essentialCalls.at(-1)).toMatchObject({ p_action: 'handover', p_to: madi })
    await sheet.getByRole('button', { name: /Archive/ }).click()
    await page.getByRole('dialog', { name: 'Archive Toilet paper?' }).getByRole('button', { name: 'Archive' }).click()
    await expect(page.getByText('Toilet paper archived')).toBeVisible()
    expect(state.essentials.find((e) => e.name === 'Toilet paper')!.archived_at).not.toBeNull()
  })

  test('clearing the list celebrates (Balanced); Minimal and reduced motion do not', async ({ page }, testInfo) => {
    const state = await mockFlat(page)
    state.essentials.push(makeEssential({ name: 'Toilet paper' }))
    await page.goto('./essentials')
    await page.getByRole('checkbox', { name: 'Mark Toilet paper as restocked' }).click()
    if (testInfo.project.name === 'reduced-motion') {
      await expect(page.getByTestId('confetti')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.dataset.motion)).toBe('reduced')
    } else {
      await expect(page.getByTestId('confetti').first()).toBeAttached()
      // Bursts are brief and never loop.
      await expect(page.getByTestId('confetti')).toHaveCount(0, { timeout: 3000 })
    }
    await expect(page.getByTestId('essentials-empty')).toBeVisible()

    state.prefs = { accent: 'blue', greeting_name: null, motion: 'minimal', home_layout: [] }
    state.essentials.push(makeEssential({ name: 'Sponges' }))
    await page.reload()
    await page.getByRole('checkbox', { name: 'Mark Sponges as restocked' }).click()
    await expect(page.getByText('Sponges restocked')).toBeVisible()
    await expect(page.getByTestId('confetti')).toHaveCount(0)
  })
})

test.describe('things to do', () => {
  test('quick add with who and when, natural due dates, complete and undo', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./tasks')
    await expect(page.getByRole('region', { name: 'Overdue' }).getByText('Contact the property manager')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Today' }).getByText('Assemble the TV cabinet')).toBeVisible()

    const form = page.getByTestId('task-quick-add')
    await form.getByRole('textbox', { name: 'New task' }).fill('Change the hallway lightbulb')
    await form.getByRole('radio', { name: 'Me' }).click()
    await form.getByRole('radio', { name: 'Tomorrow' }).click()
    await form.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Task added')).toBeVisible()
    expect(state.tasks.at(-1)).toMatchObject({ title: 'Change the hallway lightbulb', assignee_id: uid, due_on: local(1) })
    await expect(page.getByTestId('task-row').filter({ hasText: 'Change the hallway lightbulb' }).getByText(/Tomorrow · You/)).toBeVisible()

    const row = page.getByTestId('task-row').filter({ hasText: 'Assemble the TV cabinet' })
    await row.getByRole('checkbox', { name: 'Mark Assemble the TV cabinet as done' }).click()
    await expect(page.getByText('Done: Assemble the TV cabinet')).toBeVisible()
    await expect(row).toHaveCount(0)
    expect(state.tasks.find((t) => t.title === 'Assemble the TV cabinet')!.status).toBe('done')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Assemble the TV cabinet' })).toBeVisible()
    expect(state.tasks.find((t) => t.title === 'Assemble the TV cabinet')!.status).toBe('todo')

    await page.getByRole('radio', { name: /Mine/ }).click()
    await expect(page.getByTestId('task-row')).toHaveCount(2)
  })

  test('sheet: status, reassignment, archive, and a conflicting edit', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./tasks')
    await page.getByRole('button', { name: /^Assemble the TV cabinet/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Task' })
    await sheet.getByRole('radio', { name: 'In progress' }).click()
    await expect.poll(() => state.tasks[0]!.status).toBe('doing')
    await sheet.getByRole('radiogroup', { name: 'Who' }).getByRole('radio', { name: 'Madi' }).click()
    await expect.poll(() => state.tasks[0]!.assignee_id).toBe(madi)
    // Someone else edits it meanwhile: the next change is refused rather than overwriting theirs.
    state.tasks[0]!.updated_at = '2030-01-01T00:00:00.000Z'
    await sheet.getByRole('radiogroup', { name: 'When' }).getByRole('radio', { name: 'No date' }).click()
    await expect(page.getByText('Someone else just changed this task. Have another look.')).toBeVisible()
    await sheet.getByRole('button', { name: 'Archive task' }).click()
    await page.getByRole('dialog', { name: 'Archive this task?' }).getByRole('button', { name: 'Archive' }).click()
    await expect(page.getByText('Task archived')).toBeVisible()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Assemble the TV cabinet' })).toHaveCount(0)
  })

  test('deep links from notifications open the right thing or explain', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    addEvent(state, { type: 'task_assigned', task_id: state.tasks[0]!.id, subject_id: uid, data: { task: 'Assemble the TV cabinet' } }, { reason: 'assigned' })
    await page.goto('./')
    await page.getByTestId('notification-bell').click()
    await page.getByRole('dialog', { name: 'Notifications' }).getByText('Madi asked you to assemble the TV cabinet').click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible()
    await page.goto('./essentials?essential=00000000-0000-4000-8000-000000000000')
    await expect(page.getByText('That essential is no longer on the list.')).toBeVisible()
  })
})

test.describe('personal home', () => {
  test('greeting, everyday sections and quick add from Home', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    state.prefs = { accent: 'blue', greeting_name: 'Lex', motion: 'balanced', home_layout: [] }
    await page.goto('./')
    await expect(page.getByTestId('greeting')).toHaveText(/^(Good (morning|afternoon|evening)|Welcome home), Lex$/)
    const forYou = page.locator('[data-section="focus"]')
    await expect(forYou.getByText('Assemble the TV cabinet')).toBeVisible()
    await expect(page.locator('[data-section="tasks"]').getByText('Contact the property manager')).toBeVisible()
    await expect(page.locator('[data-section="essentials"]').getByText('Toilet paper')).toBeVisible()
    await page.getByRole('button', { name: 'Quick add' }).click()
    const sheet = page.getByTestId('quick-add-sheet')
    await sheet.getByRole('textbox', { name: 'Add an essential' }).fill('Bin liners')
    await sheet.getByRole('button', { name: 'Add essential' }).click()
    await expect(page.locator('[data-section="essentials"]').getByText('Bin liners')).toBeVisible()
    // Still four tabs.
    const tabs = (await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link').allInnerTexts()).map((t) => t.trim())
    expect(tabs.filter((t) => ['Home', 'Rooms', 'Wishlist', 'Flatmates'].includes(t))).toHaveLength(4)
    expect(tabs.some((t) => /essentials|things to do|tasks/i.test(t))).toBe(false)
  })

  test('customise Home: hide, reorder, reset — saved to the account', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./')
    const order = () => page.locator('[data-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section))
    await expect.poll(async () => (await order())[0]).toBe('focus')
    await page.getByRole('button', { name: 'Customise Home' }).click()
    const sheet = page.getByRole('dialog', { name: 'Customise Home' })
    await sheet.getByRole('button', { name: 'Move Essentials up' }).click()
    await sheet.getByRole('button', { name: 'Move Essentials up' }).click()
    await sheet.getByRole('switch', { name: 'Show Room by room' }).click()
    await expect.poll(() => (state.prefs?.home_layout as { id: string }[] | undefined)?.[0]?.id).toBe('essentials')
    await page.keyboard.press('Escape')
    await expect.poll(order).toEqual(['essentials', 'focus', 'tasks', 'progress', 'activity'])
    await page.reload()
    await expect.poll(order).toEqual(['essentials', 'focus', 'tasks', 'progress', 'activity'])
    await page.getByRole('button', { name: 'Customise Home' }).click()
    await page.getByRole('button', { name: 'Reset to the usual layout' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(order).toEqual(['focus', 'tasks', 'essentials', 'progress', 'rooms', 'activity'])
  })
})

test.describe('make it yours', () => {
  test('accent theme applies, persists, resets — and the default is untouched', async ({ page }) => {
    const state = await mockFlat(page)
    await page.goto('./settings')
    expect(await accentVar(page)).toBe('#3657e8')
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--color-accent'))).toBe('')
    const yours = page.getByTestId('make-it-yours')
    await yours.getByRole('radio', { name: 'Mint' }).click()
    expect(await accentVar(page)).toBe('#2fc48e')
    await expect.poll(() => state.prefs?.accent).toBe('mint')
    // On a mint fill, button text switches to dark ink for contrast.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-on-accent').trim())).toBe('#111111')
    await page.reload()
    await expect.poll(() => accentVar(page)).toBe('#2fc48e')
    // Room colours never follow the theme.
    await page.goto('./')
    await expect(page.locator('[data-section="rooms"] a span[aria-hidden]').first()).toHaveCSS('background-color', 'rgb(66, 196, 147)')
    await page.goto('./settings')
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect.poll(() => accentVar(page)).toBe('#3657e8')
  })

  test('greeting name and motion are personal; a failed save rolls back', async ({ page }, testInfo) => {
    const state = await mockFlat(page)
    await page.goto('./settings')
    const yours = page.getByTestId('make-it-yours')
    await yours.getByLabel('What should Home call you?').fill('Lex')
    await yours.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => state.prefs?.greeting_name).toBe('Lex')
    await yours.getByRole('radio', { name: 'Playful' }).click()
    await expect.poll(() => state.prefs?.motion).toBe('playful')
    const expected = testInfo.project.name === 'reduced-motion' ? 'reduced' : 'playful'
    expect(await page.evaluate(() => document.documentElement.dataset.motion)).toBe(expected)
    if (expected === 'reduced') await expect(yours.getByText(/Your device is set to reduce motion/)).toBeVisible()
    state.failPrefs = true
    await yours.getByRole('radio', { name: 'Coral' }).click()
    await expect(page.getByText('Preferences unavailable')).toBeVisible()
    await expect.poll(() => accentVar(page)).toBe('#3657e8')
    // Stored per account on this device, so another account never inherits it.
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('flatquest.prefs.')))
    expect(keys).toEqual([`flatquest.prefs.${uid}`])
  })

  test('keyboard: accent and layout controls work without a pointer', async ({ page }) => {
    const state = await mockFlat(page)
    await page.goto('./settings')
    await page.getByTestId('make-it-yours').getByRole('radio', { name: 'Lavender' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => state.prefs?.accent).toBe('lavender')
    await page.getByRole('button', { name: /Home layout/ }).focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByRole('dialog', { name: 'Customise Home' })
    await sheet.getByRole('button', { name: 'Move Things to do up' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => (state.prefs?.home_layout as { id: string }[] | undefined)?.[0]?.id).toBe('tasks')
    await expect(sheet.getByRole('button', { name: 'Move Things to do up' })).toBeDisabled()
  })
})

test('layout: nothing overflows on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const state = await mockFlat(page, false, { flatmates: true })
  seed(state)
  for (const path of ['./', './essentials', './tasks', './settings']) {
    await page.goto(path)
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
