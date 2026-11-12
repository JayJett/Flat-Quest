import { test, expect } from '@playwright/test'
import { mockFlat, hid, rid, uid, madi } from './fixtures'

// Invented room illustrations, never photographs from the live household.
const scene = (colour: string, furnished: boolean, height = 600) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}" viewBox="0 0 600 600"><rect width="600" height="600" fill="#eee8dd"/><path d="M0 410H600V600H0Z" fill="#b7a189"/><path d="M0 410L190 345H600" fill="none" stroke="#fff" stroke-width="5"/><rect x="65" y="75" width="160" height="245" fill="#fdfbf4"/><rect x="77" y="88" width="136" height="220" fill="#b9c9bc"/><path d="M145 88V308M77 200H213" stroke="#fdfbf4" stroke-width="9"/>${furnished ? `<ellipse cx="350" cy="490" rx="190" ry="60" fill="#e1d7c4"/><rect x="235" y="290" width="270" height="140" rx="35" fill="${colour}"/><rect x="210" y="360" width="320" height="100" rx="25" fill="${colour}"/><rect x="247" y="320" width="65" height="65" rx="12" fill="#e6caa5"/><rect x="385" y="320" width="65" height="65" rx="12" fill="#eae1d3"/><ellipse cx="330" cy="495" rx="80" ry="25" fill="#72533e"/><path d="M280 500V550M380 500V550" stroke="#72533e" stroke-width="8"/><rect x="480" y="110" width="6" height="210" fill="#3e4238"/><path d="M430 120L455 60H510L535 120Z" fill="#e1b96b"/><rect x="280" y="80" width="105" height="140" fill="#fdfbf4"/><circle cx="332" cy="150" r="33" fill="${colour}"/>` : ''}</svg>`

for (const size of [{ name: 'iphone', width: 390, height: 844 }, { name: 'small', width: 320, height: 568 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`Phase 5 visual evidence ${size.name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS, 'Screenshot generation is opt-in')
    await page.setViewportSize(size)
    const state = await mockFlat(page, false, { flatmates: true }); state.room.name = 'Living room'; state.room.color = 'orange'
    const now = '2026-11-12T00:00:00.000Z'
    state.visuals = Array.from({ length: 8 }, (_, i) => ({ id: String(i), household_id: hid, room_id: rid, kind: i < 4 ? 'inspiration' : 'photo', photo_path: `${hid}/visual/${i}.webp`, thumbnail_path: `${hid}/visual/${i}-thumb.webp`, aspect_ratio: i % 3 === 0 ? 0.8 : i % 3 === 1 ? 1.25 : 1, title: ['Warm textures', null, 'A little colour', null, 'Move-in day', 'Our favourite corner', null, null][i] ?? null, notes: null, source_url: null, taken_on: null, sort_order: i, created_by: i % 2 ? madi : uid, created_at: now, updated_at: now }))
    state.transformations = [{ id: 'pair', household_id: hid, room_id: rid, before_id: '4', after_id: '5', title: 'From empty to ours', notes: 'A sofa, a lamp, and a place to land.', created_by: uid, created_at: now, updated_at: now }]
    await page.route('**/storage/v1/object/sign/**', route => {
      if (route.request().method() !== 'GET') return route.fallback()
      const number = Number(route.request().url().match(/\/([0-7])(?:-thumb)?\.webp/)?.[1] ?? 0)
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: scene(['#858d6b','#b77d61','#d0b67d','#688179'][number % 4]!, number !== 4) })
    })
    await page.goto(`./rooms/${rid}/visual`)
    await expect(page.getByRole('button', { name: 'View Warm textures' }).locator('img')).toBeVisible()
    await page.screenshot({ path: `reports/screenshots/p5-${size.name}-overview.png`, fullPage: true })
    await page.getByRole('button', { name: /Before After From empty to ours/ }).click()
    await expect(page.getByRole('slider')).toBeVisible()
    await page.waitForTimeout(500) // Let the sheet's spring settle for evidence capture.
    await page.screenshot({ path: `reports/screenshots/p5-${size.name}-comparison.png` })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'View Our favourite corner' }).click()
    await expect(page.getByRole('dialog', { name: 'Photo viewer' })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `reports/screenshots/p5-${size.name}-viewer.png` })
  })
}
