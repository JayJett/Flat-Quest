import { expect, test, type Page } from '@playwright/test'
import { addEvent, hid, kettle, madi, mockFlat, resync, rid, uid } from './fixtures'

type State = Awaited<ReturnType<typeof mockFlat>>
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

const bell = (page: Page) => page.getByTestId('notification-bell')
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Notifications' })

function seed(state: State) {
  state.comments.push({
    id: 'c0000000-0000-4000-8000-000000000001', household_id: hid, item_id: kettle, option_id: null, idea_id: null, parent_id: null,
    author_id: madi, author_name: 'Madi', body: '@Alex steel or glass?', mentions: [uid], created_at: minutesAgo(30), edited_at: null, deleted_at: null,
  })
  addEvent(state, { type: 'comment_added', item_id: kettle, room_id: rid, comment_id: 'c0000000-0000-4000-8000-000000000001', in_timeline: true, data: { item: 'Kettle', room: 'Kitchen' } }, { reason: 'mention', at: minutesAgo(30) })
  addEvent(state, { type: 'item_assigned', item_id: kettle, room_id: rid, subject_id: uid, data: { item: 'Kettle' } }, { reason: 'assigned', at: minutesAgo(10) })
  addEvent(state, { type: 'room_completed', room_id: rid, in_timeline: true, data: { room: 'Kitchen' } }, { reason: 'milestone', category: 'household', read: true, at: daysAgo(3) })
}

async function openDrawer(page: Page) {
  await bell(page).click()
  await expect(drawer(page)).toBeVisible()
  // Let the slide-in settle before measuring or dragging.
  await page.waitForTimeout(450)
}

test.describe('notification centre', () => {
  test('bell shows a per-user unread badge only when something is unread', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    // Someone else's notification never reaches this browser (row-level security in the fixture too).
    addEvent(state, { type: 'item_assigned', item_id: kettle, subject_id: madi }, { reason: 'assigned' })
    state.notifications.at(-1)!.recipient_id = madi
    await page.goto('./')
    await expect(bell(page)).toHaveAccessibleName('Notifications')
    await expect(page.getByTestId('notification-badge')).toHaveCount(0)

    seed(state)
    await resync(page)
    await expect(page.getByTestId('notification-badge')).toHaveText('2')
    await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread')
  })

  test('drawer: grouping, unread view, mark one, mark all, empty states', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./')
    await openDrawer(page)
    const d = drawer(page)
    await expect(d.getByRole('region', { name: 'Today' }).getByTestId('notification-row')).toHaveCount(2)
    await expect(d.getByRole('region', { name: 'Earlier' }).getByTestId('notification-row')).toHaveCount(1)
    await expect(d.getByText('Madi mentioned you on Kettle')).toBeVisible()
    await expect(d.locator('[data-unread]')).toHaveCount(2)

    await d.getByRole('radio', { name: /Unread/ }).click()
    await expect(d.getByTestId('notification-row')).toHaveCount(2)
    await d.getByRole('button', { name: 'Mark as read' }).first().click()
    await expect(d.getByTestId('notification-row')).toHaveCount(1)
    await expect(page.getByTestId('notification-badge')).toHaveText('1')
    expect(state.notifications.filter((n) => n.read_at).length).toBe(2)

    await d.getByRole('button', { name: 'Mark all read' }).click()
    await expect(d.getByText('You’re all caught up')).toBeVisible()
    await expect(page.getByTestId('notification-badge')).toHaveCount(0)
    expect(state.notifications.every((n) => n.read_at)).toBe(true)
    await d.getByRole('radio', { name: 'All' }).click()
    await expect(d.getByTestId('notification-row')).toHaveCount(3)
  })

  test('empty and failed states', async ({ page }) => {
    const state = await mockFlat(page)
    await page.goto('./')
    await openDrawer(page)
    await expect(drawer(page).getByText('No notifications yet')).toBeVisible()
    await page.keyboard.press('Escape')
    // A failed mark-read rolls back instead of pretending it worked.
    addEvent(state, { type: 'item_assigned', item_id: kettle, room_id: rid, subject_id: uid }, { reason: 'assigned' })
    state.failMarkRead = true
    await resync(page)
    await openDrawer(page)
    await drawer(page).getByRole('button', { name: 'Mark as read' }).click()
    await expect(drawer(page).locator('[data-unread]')).toHaveCount(1)
    await expect(page.getByTestId('notification-badge')).toHaveText('1')
  })

  test('closes with X, backdrop, Escape and browser Back — and returns focus to the bell', async ({ page }) => {
    const state = await mockFlat(page)
    seed(state)
    await page.goto(`./rooms/${rid}`)
    const url = page.url()
    await openDrawer(page)
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
    await expect(bell(page)).toBeFocused()

    await openDrawer(page)
    await drawer(page).getByRole('button', { name: 'Close notifications' }).click()
    await expect(drawer(page)).toBeHidden()

    await openDrawer(page)
    await page.getByTestId('notification-backdrop').click({ position: { x: 10, y: 300 } })
    await expect(drawer(page)).toBeHidden()

    await openDrawer(page)
    await page.goBack()
    await expect(drawer(page)).toBeHidden()
    expect(page.url()).toBe(url)
    await expect(page.getByRole('heading', { name: 'Kitchen', level: 1 })).toBeVisible()
  })

  test('drag: follows the finger, springs back below the threshold, closes past it, ignores vertical scrolls', async ({ page }) => {
    const state = await mockFlat(page)
    seed(state)
    await page.goto('./')
    await openDrawer(page)
    const box = (await drawer(page).boundingBox())!
    const y = box.y + 30
    const startX = box.x + 60

    // A short drag: the panel moves with the pointer, then settles back.
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX + box.width * 0.15, y, { steps: 8 })
    const mid = (await drawer(page).boundingBox())!
    expect(mid.x).toBeGreaterThan(box.x + box.width * 0.08)
    await page.mouse.up()
    await expect.poll(async () => Math.abs((await drawer(page).boundingBox())!.x - box.x)).toBeLessThan(2)
    await expect(drawer(page)).toBeVisible()

    // A vertical gesture (scrolling the list) never dismisses it.
    await page.mouse.move(startX, y + 120)
    await page.mouse.down()
    await page.mouse.move(startX + 6, y + 420, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    await expect(drawer(page)).toBeVisible()

    // Past a third of its width: it closes.
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX + box.width * 0.5, y, { steps: 12 })
    await page.mouse.up()
    await expect(drawer(page)).toBeHidden()
  })

  test('the menu and notification drawers are never open together', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const state = await mockFlat(page)
    seed(state)
    await page.goto('./')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
    // Even if the bell were activated behind the menu, only one panel may be open.
    await bell(page).dispatchEvent('click')
    await expect(drawer(page)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden()
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })

  test('opening a notification deep-links to the discussion; Back returns to where you were', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto('./wishlist')
    await openDrawer(page)
    await drawer(page).getByText('Madi mentioned you on Kettle').click()
    await expect(drawer(page)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/rooms/${rid}$`))
    const sheet = page.getByRole('dialog', { name: 'Item details' })
    await expect(sheet.getByTestId('discussion').getByText('steel or glass?')).toBeVisible()
    expect(state.notifications.find((n) => n.reason === 'mention')!.read_at).not.toBeNull()
    await page.keyboard.press('Escape')
    await page.goBack()
    await expect(page).toHaveURL(/\/wishlist$/)
  })

  test('a notification about something since deleted explains itself', async ({ page }) => {
    const state = await mockFlat(page)
    addEvent(state, { type: 'item_assigned', item_id: '44444444-4444-4444-8444-999999999999', room_id: rid, data: { item: 'Old lamp' } }, { reason: 'assigned' })
    await page.goto('./')
    await openDrawer(page)
    await drawer(page).getByText('Madi put you on Old lamp').click()
    await expect(page.getByText('That item has since been removed from the list.')).toBeVisible()
    await expect(drawer(page)).toBeVisible()
  })

  test('new notifications arrive once, however often the app resyncs', async ({ page }) => {
    const state = await mockFlat(page)
    await page.goto('./')
    await openDrawer(page)
    addEvent(state, { type: 'coordination_handover', item_id: kettle, room_id: rid, data: { item: 'Kettle' } }, { reason: 'handover' })
    await resync(page)
    await resync(page)
    await resync(page)
    await expect(drawer(page).getByTestId('notification-row')).toHaveCount(1)
    await expect(drawer(page).getByText('Madi handed Kettle over to you')).toBeVisible()
    await expect(page.getByTestId('notification-badge')).toHaveText('1')
  })

  test('keyboard: focus stays inside the drawer', async ({ page }) => {
    const state = await mockFlat(page)
    seed(state)
    await page.goto('./')
    await bell(page).focus()
    await page.keyboard.press('Enter')
    await expect(drawer(page)).toBeVisible()
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect(await drawer(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }
  })

  test('reduced motion: the drawer appears without sliding', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'reduced-motion', 'reduced-motion project only')
    await mockFlat(page)
    await page.goto('./')
    await bell(page).click()
    const box = await drawer(page).boundingBox()
    const viewport = page.viewportSize()!
    expect(Math.round(box!.x + box!.width)).toBe(viewport.width)
  })
})

test.describe('discussions', () => {
  test('post with a mention, edit, delete; text is never treated as HTML', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    await page.goto(`./rooms/${rid}`)
    await page.getByRole('button', { name: /^Kettle\./ }).click()
    const discussion = page.getByRole('dialog', { name: 'Item details' }).getByTestId('discussion')
    await expect(discussion.getByText('No comments yet')).toBeVisible()
    const box = discussion.getByRole('textbox', { name: 'Add a comment…' })
    await box.fill('Can you check @Ma')
    await discussion.getByRole('option').getByRole('button', { name: '@Madi' }).click()
    await box.pressSequentially('<img src=x onerror="window.hacked=1"> please')
    await discussion.getByRole('button', { name: 'Send' }).click()
    await expect(discussion.getByTestId('comment')).toHaveCount(1)
    await expect(discussion.getByText('<img src=x onerror="window.hacked=1"> please', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined()
    expect(state.comments[0]).toMatchObject({ item_id: kettle, author_id: uid, mentions: [madi] })

    await discussion.getByRole('button', { name: 'Edit' }).click()
    const edit = discussion.getByRole('textbox', { name: 'Edit comment' })
    await edit.fill('Steel one please')
    await discussion.getByRole('button', { name: 'Save' }).click()
    await expect(discussion.getByText('Steel one please')).toBeVisible()
    await expect(discussion.getByText(/edited/)).toBeVisible()

    await discussion.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete this comment?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(discussion.getByTestId('comment')).toHaveCount(0)
    expect(state.comments[0]!.deleted_at).not.toBeNull()
  })

  test('replies stay one level deep and a failed post keeps the draft', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    await page.goto(`./rooms/${rid}`)
    await page.getByRole('button', { name: /^Kettle\./ }).click()
    const discussion = page.getByRole('dialog', { name: 'Item details' }).getByTestId('discussion')
    await discussion.getByRole('button', { name: 'Reply' }).click()
    await expect(discussion.getByText('Replying to Madi')).toBeVisible()
    await discussion.getByRole('textbox', { name: 'Write a reply…' }).fill('Glass')
    await discussion.getByRole('button', { name: 'Send' }).click()
    await expect(discussion.getByTestId('comment')).toHaveCount(2)
    expect(state.comments.at(-1)!.parent_id).toBe('c0000000-0000-4000-8000-000000000001')

    state.failComment = true
    const box = discussion.getByRole('textbox', { name: 'Add a comment…' })
    await box.fill('This will not send')
    await discussion.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText('Comments unavailable')).toBeVisible()
    await expect(box).toHaveValue('This will not send')
    await expect(discussion.getByTestId('comment')).toHaveCount(2)
  })

  test('product options and wishlist ideas have discussions too', async ({ page }) => {
    await mockFlat(page, false, { flatmates: true })
    await page.goto('./wishlist')
    await page.getByText('A reading lamp').click()
    await expect(page.getByRole('dialog', { name: 'Idea' }).getByTestId('discussion')).toBeVisible()
  })
})

test.describe('activity timeline', () => {
  test('Home preview links to all activity; history starts honestly; still four tabs', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    seed(state)
    addEvent(state, { type: 'idea_added', idea_id: 'idea', in_timeline: true, data: { idea: 'A reading lamp' } })
    await page.goto('./')
    const around = page.getByRole('region', { name: 'Around the flat' })
    await expect(around.getByText('Madi added A reading lamp to the wishlist')).toBeVisible()
    await expect(around.getByTestId('timeline-row')).toHaveCount(3)
    await around.getByRole('link', { name: 'View all activity' }).click()
    await expect(page).toHaveURL(/\/activity$/)
    await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible()
    await expect(page.getByTestId('history-start')).toBeVisible()
    const tabs = await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link').allInnerTexts()
    expect(tabs.map((t) => t.trim()).filter((t) => ['Home', 'Rooms', 'Wishlist', 'Flatmates'].includes(t)).length).toBe(4)
    expect(tabs.some((t) => /activity/i.test(t))).toBe(false)
  })
})

test.describe('household management', () => {
  test('owner manages capacity, removal and ownership through confirmations', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    await page.goto('./flatmates')
    const panel = page.getByTestId('household-management')
    await expect(panel.getByText('2 of 4 places taken')).toBeVisible()
    await expect(panel.getByText('To leave, make someone else the owner first.')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Leave this flat' })).toHaveCount(0)

    await panel.getByRole('button', { name: 'Change' }).click()
    const cap = page.getByRole('dialog', { name: 'How many people live here?' })
    await cap.getByRole('button', { name: 'One fewer' }).click()
    await cap.getByRole('button', { name: 'One fewer' }).click()
    await expect(cap.locator('output')).toHaveText('2')
    // Never below the people already here.
    await expect(cap.getByRole('button', { name: 'One fewer' })).toBeDisabled()
    await cap.getByRole('button', { name: 'One more' }).click()
    await cap.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => state.rpcCalls.find((c) => c.name === 'set_member_limit')?.body).toMatchObject({ p_household: hid, p_limit: 3 })

    await panel.getByRole('button', { name: 'Manage Madi' }).click()
    await page.getByRole('button', { name: 'Remove from flat' }).click()
    const confirm = page.getByRole('dialog', { name: 'Remove Madi from the flat?' })
    await expect(confirm.getByText(/on 3 unfinished items\. One has nobody else on it and will go back to Open/)).toBeVisible()
    await confirm.getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => state.rpcCalls.some((c) => c.name === 'remove_household_member' && c.body.p_user === madi)).toBe(true)

    await panel.getByRole('button', { name: 'Manage Madi' }).click()
    await page.getByRole('button', { name: 'Make owner' }).click()
    await page.getByRole('dialog', { name: 'Make Madi the owner?' }).getByRole('button', { name: 'Make owner' }).click()
    await expect.poll(() => state.rpcCalls.some((c) => c.name === 'transfer_household_ownership' && c.body.p_user === madi)).toBe(true)
  })
})
