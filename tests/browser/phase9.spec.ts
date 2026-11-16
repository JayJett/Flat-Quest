import { expect, test, type Page } from '@playwright/test'
import { hid, madi, mockFlat, resync, rid, uid } from './fixtures'

type State = Awaited<ReturnType<typeof mockFlat>>
const at = '2026-11-12T00:00:00.000Z'

function withPhotos(state: State) {
  state.visuals.push(
    { id: 'v1', household_id: hid, room_id: rid, kind: 'photo', title: 'Morning light', notes: null, photo_path: `${hid}/visual/1.webp`, thumbnail_path: `${hid}/visual/1-thumb.webp`, aspect_ratio: 1.33, source_url: null, taken_on: null, sort_order: 0, created_by: uid, created_at: at, updated_at: at },
    { id: 'v2', household_id: hid, room_id: rid, kind: 'inspiration', title: 'Sage green tiles', notes: null, photo_path: `${hid}/visual/2.webp`, thumbnail_path: `${hid}/visual/2-thumb.webp`, aspect_ratio: 1.33, source_url: null, taken_on: null, sort_order: 1, created_by: madi, created_at: at, updated_at: at },
  )
}
const header = (page: Page) => page.getByTestId('room-header')
const personalise = (page: Page) => page.getByRole('dialog', { name: 'Personalise room' })

test.describe('room personality', () => {
  test('choose a cover and description from Visual Home; only those fields are saved', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    withPhotos(state)
    await page.goto(`./rooms/${rid}`)
    await expect(header(page)).toHaveAttribute('data-cover', 'false')
    await page.getByRole('button', { name: 'Personalise room' }).click()
    const sheet = personalise(page)
    await expect(sheet.getByRole('radio', { name: 'No cover' })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByRole('radio', { name: 'Morning light' }).click()
    await sheet.getByLabel('Description').fill('  Sunny   spot for slow breakfasts ')
    await expect(sheet.getByText('35/120')).toBeVisible()
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet.getByRole('button', { name: 'Saved' })).toBeVisible()
    await expect(sheet).toBeHidden()
    expect(state.roomPatches).toEqual([{ cover_visual_id: 'v1', description: 'Sunny spot for slow breakfasts' }])
    await expect(header(page)).toHaveAttribute('data-cover', 'true')
    await expect(header(page).getByText('Sunny spot for slow breakfasts')).toBeVisible()
    // Rooms tab shows it too.
    await page.goto('./rooms')
    await expect(page.getByRole('link', { name: /^Kitchen:/ })).toHaveAttribute('data-cover', 'true')
  })

  test('change and remove a cover; nothing is sent when nothing changed', async ({ page }) => {
    const state = await mockFlat(page)
    withPhotos(state)
    Object.assign(state.room, { cover_visual_id: 'v1', description: 'Ours' })
    await page.goto(`./rooms/${rid}`)
    await expect(header(page)).toHaveAttribute('data-cover', 'true')
    await page.getByRole('button', { name: 'Personalise room' }).click()
    await personalise(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(personalise(page)).toBeHidden()
    expect(state.roomPatches).toEqual([])
    await page.getByRole('button', { name: 'Personalise room' }).click()
    await personalise(page).getByRole('radio', { name: 'Sage green tiles' }).click()
    await personalise(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(personalise(page)).toBeHidden()
    await page.getByRole('button', { name: 'Personalise room' }).click()
    await personalise(page).getByRole('radio', { name: 'No cover' }).click()
    await personalise(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(personalise(page)).toBeHidden()
    expect(state.roomPatches).toEqual([{ cover_visual_id: 'v2' }, { cover_visual_id: null }])
    await expect(header(page)).toHaveAttribute('data-cover', 'false')
    await expect(header(page).getByText('Ours')).toBeVisible()
  })

  test('a room without photos points to Visual Home', async ({ page }) => {
    await mockFlat(page)
    await page.goto(`./rooms/${rid}`)
    await page.getByRole('button', { name: 'Personalise room' }).click()
    await expect(personalise(page).getByText('No photos of this room yet')).toBeVisible()
    await personalise(page).getByRole('link', { name: 'Open Visual Home' }).click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${rid}/visual$`))
  })

  test('a refused save explains itself and keeps the sheet open', async ({ page }) => {
    const state = await mockFlat(page)
    withPhotos(state)
    state.failRoomSave = true
    await page.goto(`./rooms/${rid}`)
    await page.getByRole('button', { name: 'Personalise room' }).click()
    await personalise(page).getByRole('radio', { name: 'Morning light' }).click()
    await personalise(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(personalise(page).getByRole('alert')).toHaveText('That photo is no longer in this room’s Visual Home. Choose another.')
    await expect(personalise(page)).toBeVisible()
    await expect(header(page)).toHaveAttribute('data-cover', 'false')
  })

  test('a cover whose image cannot load falls back to the room colour', async ({ page }) => {
    const state = await mockFlat(page)
    withPhotos(state)
    Object.assign(state.room, { cover_visual_id: 'v1' })
    await page.route('**/storage/v1/object/sign/**', (route) => route.request().method() === 'GET' ? route.fulfill({ status: 404, body: '' }) : route.fallback())
    await page.goto(`./rooms/${rid}`)
    await expect(header(page)).toHaveAttribute('data-cover', 'false')
    await expect(page.getByRole('heading', { name: 'Kitchen', level: 1 })).toBeVisible()
  })

  test('a flatmate’s change appears after sync; a deleted photo clears the cover', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    withPhotos(state)
    await page.goto(`./rooms/${rid}`)
    await expect(header(page)).toHaveAttribute('data-cover', 'false')
    Object.assign(state.room, { cover_visual_id: 'v2', description: 'Madi picked this' })
    await resync(page)
    await expect(header(page)).toHaveAttribute('data-cover', 'true')
    await expect(header(page).getByText('Madi picked this')).toBeVisible()
    // The database clears the reference when the photo is deleted (ON DELETE SET NULL).
    state.visuals = state.visuals.filter((v) => v.id !== 'v2')
    Object.assign(state.room, { cover_visual_id: null })
    await resync(page)
    await expect(header(page)).toHaveAttribute('data-cover', 'false')
  })

  test('name, colour and measurements stay one tap away', async ({ page }) => {
    await mockFlat(page)
    await page.goto(`./rooms/${rid}`)
    await page.getByRole('button', { name: 'Personalise room' }).click()
    await personalise(page).getByRole('button', { name: 'Name, colour and measurements' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit room' })).toBeVisible()
  })
})

test.describe('room screen polish', () => {
  for (const cover of [false, true]) {
    test(`small phone: the first checklist item is fully visible ${cover ? 'with' : 'without'} a cover`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 })
      const state = await mockFlat(page)
      withPhotos(state)
      if (cover) Object.assign(state.room, { cover_visual_id: 'v1', description: 'Where all the cooking (and most of the chatting) happens.' })
      await page.goto(`./rooms/${rid}`)
      await expect(header(page)).toHaveAttribute('data-cover', String(cover))
      const row = await page.getByRole('listitem').filter({ hasText: 'Kettle' }).boundingBox()
      const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
      expect(row && nav && row.y + row.height <= nav.y).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    })
  }

  test('the room header has at most three icon actions; filter and sort share one row', async ({ page }) => {
    await mockFlat(page)
    await page.goto(`./rooms/${rid}`)
    const actions = page.locator('header').first().getByRole('button')
    // Back, Add, Search, Notifications.
    await expect(actions).toHaveCount(4)
    await expect(page.getByRole('button', { name: 'Edit room' })).toHaveCount(0)
    const filter = await page.getByRole('radiogroup', { name: 'Filter items' }).boundingBox()
    const sort = await page.getByLabel(/Sort items/).boundingBox()
    expect(Math.abs(filter!.y + filter!.height / 2 - (sort!.y + sort!.height / 2))).toBeLessThan(4)
    await page.getByLabel(/Sort items/).selectOption('name')
    await expect(page.getByLabel('Sort items (now by name)')).toBeVisible()
  })
})
