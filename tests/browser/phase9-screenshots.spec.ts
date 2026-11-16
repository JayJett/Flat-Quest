import { expect, test, type Page } from '@playwright/test'
import { addEvent, hid, kettle, madi, makeEssential, makeOption, makeTask, mockFlat, rid, uid } from './fixtures'

/**
 * Phase 9 visual evidence: the same screens captured before and after the polish work, with
 * invented fixture data and generated illustrations (never real household photos).
 *   SHOTS=1 SHOT_PREFIX=p9-before npx playwright test phase9-screenshots --project=desktop-chromium
 *   SHOTS=1 SHOT_PREFIX=p9-after  npx playwright test phase9-screenshots --project=desktop-chromium
 */
const PREFIX = process.env.SHOT_PREFIX ?? 'p9-after'
const local = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const scene = (colour: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#eee8dd"/><path d="M0 420H800V600H0Z" fill="#b7a189"/><rect x="90" y="80" width="200" height="260" fill="#fdfbf4"/><rect x="104" y="94" width="172" height="232" fill="#b9c9bc"/><rect x="330" y="290" width="330" height="150" rx="40" fill="${colour}"/><rect x="300" y="370" width="390" height="100" rx="28" fill="${colour}"/><rect x="560" y="110" width="8" height="220" fill="#3e4238"/><path d="M510 120L536 60H592L618 120Z" fill="#e1b96b"/></svg>`

async function setup(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size)
  const state = await mockFlat(page, false, { flatmates: true })
  state.essentials.push(
    makeEssential({ name: 'Toilet paper', quantity: '24-roll pack' }),
    makeEssential({ name: 'Dishwashing liquid', status: 'getting', claimed_by: madi }),
    makeEssential({ name: 'Sponges', status: 'stocked', restocked_at: new Date(Date.now() - 86_400_000).toISOString() }),
  )
  state.tasks.push(
    makeTask({ title: 'Assemble the TV cabinet', assignee_id: uid, due_on: local(0), room_id: rid }),
    makeTask({ title: 'Contact the property manager', due_on: local(-1) }),
    makeTask({ title: 'Take cardboard to recycling', assignee_id: madi, due_on: local(2), status: 'doing' }),
  )
  state.items[0]!.status = 'need_to_buy'
  state.items[2]!.status = 'ordered'
  state.options.push(makeOption({ name: 'Smeg retro kettle', item_id: kettle, retailer: 'Briscoes', price: 189 }), makeOption({ name: 'Breville glass kettle', item_id: kettle, retailer: 'Noel Leeming', price: 129 }))
  const at = '2026-11-12T00:00:00.000Z'
  state.visuals.push(
    { id: 'v1', household_id: hid, room_id: rid, kind: 'photo', title: 'Morning light', notes: null, photo_path: `${hid}/visual/1.webp`, thumbnail_path: `${hid}/visual/1-thumb.webp`, aspect_ratio: 1.33, source_url: null, taken_on: null, sort_order: 0, created_by: uid, created_at: at, updated_at: at },
    { id: 'v2', household_id: hid, room_id: rid, kind: 'inspiration', title: 'Sage green tiles', notes: null, photo_path: `${hid}/visual/2.webp`, thumbnail_path: `${hid}/visual/2-thumb.webp`, aspect_ratio: 1.33, source_url: null, taken_on: null, sort_order: 1, created_by: madi, created_at: at, updated_at: at },
  )
  addEvent(state, { type: 'task_assigned', task_id: state.tasks[0]!.id, subject_id: uid, data: { task: 'Assemble the TV cabinet' } }, { reason: 'assigned' })
  addEvent(state, { type: 'essential_restocked', in_timeline: true, data: { essential: 'Sponges' } }, { reason: 'responsible', read: true })
  state.prefs = { accent: 'blue', greeting_name: 'Alex', motion: 'balanced', home_layout: [] }
  await page.route('**/storage/v1/object/sign/**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const n = Number(route.request().url().match(/\/(\d)(?:-thumb)?\.webp/)?.[1] ?? 1)
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: scene(n === 1 ? '#858d6b' : '#688179') })
  })
  return state
}

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `reports/screenshots/${PREFIX}-${name}.png`, fullPage: full })
}

for (const size of [{ name: 'iphone', width: 390, height: 844 }, { name: 'small', width: 320, height: 568 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`Phase 9 screens ${size.name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS, 'Screenshot generation is opt-in')
    test.setTimeout(120_000)
    const state = await setup(page, size)
    const s = size.name
    await page.goto('./')
    await expect(page.locator('[data-section="progress"]')).toBeVisible()
    await shot(page, `${s}-home`, true)
    await page.goto('./rooms')
    await shot(page, `${s}-rooms`)
    await page.goto(`./rooms/${rid}`)
    await expect(page.getByRole('heading', { name: 'Kitchen', level: 1 })).toBeVisible()
    await shot(page, `${s}-room`)
    await page.evaluate(() => window.scrollTo({ top: 420 }))
    await shot(page, `${s}-checklist`)
    // Room personalisation exists only after Phase 9: capture it when available.
    if (PREFIX !== 'p9-before') {
      Object.assign(state.room, { cover_visual_id: 'v1', description: 'Where all the cooking (and most of the chatting) happens.' })
      await page.goto(`./rooms/${rid}`)
      await expect(page.getByRole('heading', { name: 'Kitchen', level: 1 })).toBeVisible()
      await shot(page, `${s}-room-cover`)
      await page.goto('./rooms')
      await shot(page, `${s}-rooms-cover`)
      await page.goto(`./rooms/${rid}`)
      await page.getByRole('button', { name: 'Personalise room' }).click()
      await shot(page, `${s}-room-personalise`)
      Object.assign(state.room, { cover_visual_id: null, description: null })
    }
    await page.goto('./rooms/shopping')
    await shot(page, `${s}-shopping`)
    await page.goto('./wishlist')
    await shot(page, `${s}-wishlist`)
    await page.goto(`./rooms/${rid}/visual`)
    await shot(page, `${s}-visual`)
    await page.goto('./essentials')
    await shot(page, `${s}-essentials`)
    await page.goto('./tasks')
    await shot(page, `${s}-tasks`)
    await page.goto('./')
    await page.getByTestId('notification-bell').click()
    await shot(page, `${s}-notifications`)
    await page.keyboard.press('Escape')
    await page.getByTestId('search-button').click()
    await page.getByRole('combobox', { name: 'Search the flat' }).fill('kettle')
    await shot(page, `${s}-search`)
    await page.keyboard.press('Escape')
    await page.goto('./settings')
    await shot(page, `${s}-settings`)
    // States: empty and error.
    state.essentials.length = 0
    await page.goto('./essentials')
    await shot(page, `${s}-essentials-empty`)
    state.shoppingDown = true
    await page.goto('./rooms/shopping')
    await shot(page, `${s}-shopping-error`)
  })
}
