import { test, expect } from '@playwright/test'
import { mockFlat, hid, rid, uid } from './fixtures'
import type { Visual } from '../../src/visual/types'

const now = '2026-11-12T00:00:00.000Z'
function photo(id: string, kind: 'photo' | 'inspiration' = 'photo', title: string | null = null): Visual {
  return { id, household_id: hid, room_id: rid, kind, photo_path: `${hid}/visual/${id}.webp`, thumbnail_path: `${hid}/visual/${id}-thumb.webp`, title, notes: null, source_url: null, taken_on: null, sort_order: Number(id) * 1024, created_by: uid, created_at: now, updated_at: now }
}
const path = `./rooms/${rid}/visual`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('room switch leads to one overview with three welcoming sections', async ({ page }) => {
  await mockFlat(page); await page.goto(`./rooms/${rid}`)
  await page.getByRole('radio', { name: 'Visual Home' }).click()
  await expect(page.getByRole('heading', { name: 'Our inspiration' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Our flat photos' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Before & after' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('multiple uploads need no titles and retry without duplicating saved cards', async ({ page }) => {
  const state = await mockFlat(page); await page.goto(path)
  await page.getByRole('button', { name: 'Add flat photos', exact: true }).first().click()
  state.failVisualSave = true
  await page.getByLabel('Choose photos').setInputFiles([{ name: 'first.png', mimeType: 'image/png', buffer: PNG }, { name: 'second.png', mimeType: 'image/png', buffer: PNG }])
  await expect(page.getByRole('button', { name: 'Retry second.png' })).toBeEnabled()
  expect(state.visuals).toHaveLength(0); expect(state.files).toHaveLength(4)
  state.failVisualSave = false
  await page.getByRole('button', { name: 'Retry first.png' }).click()
  await expect.poll(() => state.visuals.length).toBe(1)
  await page.getByRole('button', { name: 'Retry second.png' }).click()
  await expect.poll(() => state.visuals.length).toBe(2)
  expect(state.files).toHaveLength(4); expect(state.visuals.every(p => p.title === null)).toBe(true)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
})
test('full-screen viewer navigates, zooms and restores focus', async ({ page }) => {
  const state = await mockFlat(page); state.visuals.push(photo('1', 'photo', 'Before the move'), photo('2', 'photo', 'Our cosy corner'))
  await page.goto(path)
  const opener = page.getByRole('button', { name: 'View Before the move' }); await opener.click()
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' })
  await expect(viewer).toBeVisible(); await viewer.getByRole('button', { name: 'Next photo' }).click()
  await expect(viewer.getByText('Our cosy corner')).toBeVisible()
  await viewer.getByRole('button', { name: 'Zoom in' }).click(); await expect(viewer.getByRole('button', { name: 'Zoom out' })).toBeVisible()
  await page.keyboard.press('Escape'); await expect(viewer).toBeHidden(); await expect(opener).toBeFocused()
})
test('optional details preserve a conflicting draft', async ({ page }) => {
  const state = await mockFlat(page); state.visuals.push(photo('1', 'photo', 'Corner'))
  await page.goto(path); await page.getByRole('button', { name: 'Options for Corner' }).click(); await page.getByRole('button', { name: 'Edit details' }).click()
  await page.getByLabel('Title (optional)').fill('Our new corner')
  state.visuals[0]!.updated_at = '2026-11-12T01:00:00.000Z'
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('flatmate changed')
  await expect(page.getByLabel('Title (optional)')).toHaveValue('Our new corner')
})
test('reordering and removing a photo preserve the other photos', async ({ page }) => {
  const state = await mockFlat(page); state.visuals.push(photo('1', 'photo', 'First'), photo('2', 'photo', 'Second'))
  await page.goto(path); await page.getByRole('button', { name: 'Options for Second' }).click(); await page.getByRole('button', { name: 'Move earlier' }).click()
  await expect.poll(() => state.visuals[0]!.title).toBe('Second')
  await page.getByRole('button', { name: 'Options for Second' }).click(); await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remove this photo or idea?' }).getByRole('button', { name: 'Remove', exact: true }).click()
  await expect.poll(() => state.visuals.length).toBe(1); expect(state.visuals[0]!.title).toBe('First'); expect(state.removedFiles).toEqual([])
})
test('pair photos, compare them, and remove only the transformation', async ({ page }) => {
  const state = await mockFlat(page); state.visuals.push(photo('1', 'photo', 'Before'), photo('2', 'photo', 'After'))
  await page.goto(path); await page.getByRole('button', { name: 'Create transformation' }).click()
  await page.getByRole('button', { name: 'Before: Before', exact: true }).click(); await page.getByRole('button', { name: 'After: After', exact: true }).click()
  await page.getByRole('button', { name: 'Save transformation' }).click(); await expect.poll(() => state.transformations.length).toBe(1)
  await page.getByRole('button', { name: /Before After Look how far/ }).click()
  await expect(page.getByRole('slider', { name: 'Before and after comparison' })).toBeVisible()
  await page.getByRole('button', { name: 'After', exact: true }).click(); await expect(page.getByRole('slider')).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove', exact: true }).click(); await page.getByRole('dialog', { name: 'Remove this transformation?' }).getByRole('button', { name: 'Remove', exact: true }).click()
  await expect.poll(() => state.transformations.length).toBe(0); expect(state.visuals).toHaveLength(2)
})
test('source-only inspiration is quick to save and safe to open', async ({ page }) => {
  const state = await mockFlat(page); await page.goto(path); await page.getByRole('button', { name: 'Save a link' }).click()
  await page.getByLabel('Link', { exact: true }).fill('https://example.com/room'); await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => state.visuals.length).toBe(1); await expect(page.getByRole('link', { name: 'example.com' })).toHaveAttribute('rel', 'noopener noreferrer')
})

