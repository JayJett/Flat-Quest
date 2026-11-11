import { test, type Page } from '@playwright/test'
import { hid, kettle, madi, makeOption, mockFlat, toaster, uid } from './fixtures'

// Regenerates the Phase 4 screenshots in reports/screenshots (invented "Our Flat" data only):
//   SHOTS=1 npx playwright test screenshots --project=desktop-chromium
// (ignored by normal test runs; see playwright.config.ts)
test.describe.configure({ mode: 'serial' })

const dir = 'reports/screenshots'
const photo = (name: string) => `${hid}/products/${name}.webp`

async function seed(page: Page) {
  const state = await mockFlat(page, false, { flatmates: true })
  Object.assign(state.items[0]!, { name: 'Couch', status: 'shopping', priority: 'must_have', estimated_price: 1200 })
  Object.assign(state.items[2]!, { name: 'TV', status: 'on_the_way', actual_price: 899 })
  Object.assign(state.items[3]!, { name: 'Dining chairs', status: 'need_to_buy', priority: 'nice_to_have' })
  state.room.name = 'Living room'
  Object.assign(state.room, { icon: 'sofa', color: 'orange', width_cm: 420, length_cm: 510, height_cm: 240, measurement_notes: 'Door is 76 cm wide' })
  state.assignments = [uid, madi].map((user_id) => ({ item_id: kettle, household_id: hid, user_id, created_at: '2026-11-11T01:00:00.000Z' }))
  state.options = [
    makeOption({ name: 'Jasper 3-seater sofa', retailer: 'Freedom', price: 1299, url: 'https://example.com/a', item_id: kettle, width_cm: 220, depth_cm: 95, height_cm: 85, photo_path: photo('a'), notes: 'Charcoal fabric. Delivery is $89 extra.' }),
    makeOption({ name: 'Eve 3-seater', retailer: 'Mocka', price: 899, url: 'https://example.com/b', item_id: kettle, width_cm: 198, depth_cm: 88, height_cm: 82, photo_path: photo('b'), is_selected: true, selected_by: madi, created_by: madi }),
    makeOption({ name: 'Cooper modular couch', retailer: 'Harvey Norman', price: 1599, item_id: kettle, created_by: madi }),
  ]
  state.files = [photo('a'), photo('b')]
  const t = '2026-11-11T03:00:00.000Z'
  state.preferences = [
    { item_id: kettle, user_id: uid, household_id: hid, option_id: state.options[0]!.id, created_at: t, updated_at: t },
    { item_id: kettle, user_id: madi, household_id: hid, option_id: state.options[1]!.id, created_at: t, updated_at: t },
  ]
  state.coordinators = [{ item_id: kettle, household_id: hid, user_id: madi, claimed_at: '2026-11-10T03:00:00.000Z' }]
  state.purchases = [{ item_id: toaster, household_id: hid, option_id: null, purchased_by: uid, purchased_on: '2026-11-09', order_reference: 'NL-48213', notes: null, delivery_method: 'delivery', expected_on: '2026-11-14', tracking_url: 'https://example.com/track', delivery_notes: 'Leave at the back door', arrived_on: null, updated_by: uid, created_at: t, updated_at: t }]
  // Product photos in screenshots are flat colour swatches, not real products.
  await page.route('**/storage/v1/object/sign/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const colour = route.request().url().includes('/a.webp') ? '#B9C2CC' : '#D9C7B0'
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${colour}"/><rect x="70" y="130" width="260" height="90" rx="22" fill="#fff" opacity=".55"/><rect x="50" y="160" width="300" height="80" rx="24" fill="#fff" opacity=".7"/></svg>` })
  })
  return state
}

for (const [prefix, viewport, scale] of [['p4-m', { width: 393, height: 852 }, 2], ['p4-se', { width: 320, height: 568 }, 2], ['p4-d', { width: 1440, height: 900 }, 1]] as const) {
  test.describe(prefix, () => {
    test.use({ viewport, deviceScaleFactor: scale })
    test(`${prefix} screens`, async ({ page }) => {
      await seed(page)
      const shot = async (name: string) => {
        await page.waitForTimeout(450)
        await page.screenshot({ path: `${dir}/${prefix}-${name}.png` })
      }
      await page.goto('./')
      await page.getByRole('link', { name: /^Shopping/ }).scrollIntoViewIfNeeded()
      await shot('home-shortcut')
      await page.goto('./rooms/shopping')
      await page.getByRole('button', { name: /^Couch\./ }).waitFor()
      await shot('shopping')
      await page.getByRole('button', { name: 'Filter and sort' }).click()
      await shot('filters')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Couch\./ }).click()
      await shot('item-sheet')
      const sheet = page.getByRole('dialog', { name: 'Couch', exact: true })
      await sheet.getByRole('button', { name: /^Cooper modular couch\./ }).scrollIntoViewIfNeeded()
      await shot('compare')
      await sheet.getByRole('button', { name: /^Eve 3-seater\./ }).click()
      await shot('option')
      const option = page.getByRole('dialog', { name: 'Option', exact: true })
      await option.getByRole('region', { name: 'Will it fit?' }).scrollIntoViewIfNeeded()
      await shot('option-fit')
      await option.getByRole('button', { name: 'Edit', exact: true }).click()
      await shot('option-form')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await sheet.getByRole('button', { name: 'Record purchase' }).click()
      await shot('purchase-form')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^TV\./ }).click()
      await shot('delivery')
      await page.keyboard.press('Escape')
      await page.goto('./rooms')
      await shot('rooms-switch')
    })
  })
}
