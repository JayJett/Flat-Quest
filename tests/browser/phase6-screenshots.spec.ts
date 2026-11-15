import { expect, test } from '@playwright/test'
import { addEvent, hid, kettle, madi, mockFlat, rid, toaster, uid } from './fixtures'

// Evidence only, with invented fixture people (Alex, Madi) and items. Opt-in: SHOTS=1.
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

for (const size of [{ name: 'iphone', width: 390, height: 844 }, { name: 'small', width: 320, height: 568 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`Phase 6 evidence ${size.name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS, 'Screenshot generation is opt-in')
    await page.setViewportSize(size)
    const state = await mockFlat(page, false, { flatmates: true })
    state.comments.push(
      { id: 'c1', household_id: hid, item_id: kettle, option_id: null, idea_id: null, parent_id: null, author_id: madi, author_name: 'Madi', body: '@Alex steel or glass? The glass one shows the scale.', mentions: [uid], created_at: ago(42), edited_at: null, deleted_at: null },
      { id: 'c2', household_id: hid, item_id: kettle, option_id: null, idea_id: null, parent_id: 'c1', author_id: uid, author_name: 'Alex', body: 'Steel — easier to keep clean.', mentions: [], created_at: ago(30), edited_at: null, deleted_at: null },
    )
    addEvent(state, { type: 'room_completed', room_id: rid, in_timeline: true, data: { room: 'Kitchen' } }, { reason: 'milestone', category: 'household', read: true, at: ago(60 * 50) })
    addEvent(state, { type: 'idea_added', idea_id: 'idea', in_timeline: true, data: { idea: 'A reading lamp' } }, undefined)
    state.events.at(-1)!.created_at = ago(60 * 26)
    addEvent(state, { type: 'item_assigned', item_id: toaster, room_id: rid, subject_id: uid, data: { item: 'Toaster' } }, { reason: 'assigned', at: ago(55) })
    addEvent(state, { type: 'comment_added', item_id: kettle, room_id: rid, comment_id: 'c1', in_timeline: true, data: { item: 'Kettle', room: 'Kitchen' } }, { reason: 'mention', at: ago(42) })
    addEvent(state, { type: 'purchase_stage', item_id: kettle, room_id: rid, in_timeline: true, data: { item: 'Kettle', stage: 'ordered' } }, { reason: 'responsible', at: ago(8) })

    await page.goto('./')
    await expect(page.getByTestId('notification-badge')).toHaveText('3')
    await page.screenshot({ path: `reports/screenshots/p6-${size.name}-home.png`, fullPage: true })
    await page.getByTestId('notification-bell').click()
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `reports/screenshots/p6-${size.name}-notifications.png` })
    await page.getByRole('dialog', { name: 'Notifications' }).getByText('Madi mentioned you on Kettle').click()
    await expect(page.getByRole('dialog', { name: 'Item details' }).getByTestId('discussion')).toBeVisible()
    await page.waitForTimeout(900)
    await page.screenshot({ path: `reports/screenshots/p6-${size.name}-discussion.png` })
    await page.goto('./activity')
    await expect(page.getByTestId('history-start')).toBeVisible()
    await page.screenshot({ path: `reports/screenshots/p6-${size.name}-activity.png`, fullPage: true })
    await page.goto('./flatmates')
    await expect(page.getByTestId('household-management')).toBeVisible()
    await page.getByTestId('household-management').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `reports/screenshots/p6-${size.name}-membership.png`, fullPage: true })
  })
}
