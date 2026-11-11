import { test, expect } from '@playwright/test'
import { mockFlat, rid } from './fixtures'

test('home preserves layout and shows saved activity without celebrating on load', async ({ page }, testInfo) => {
  await mockFlat(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Around the flat' })).toBeVisible()
  await expect(page.getByText('A reading lamp', { exact: true })).toBeVisible()
  await expect(page.getByText('Kitchen is 25% ready')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true })
})

test('confirmed completion celebrates once and undo never celebrates', async ({ page }) => {
  const state = await mockFlat(page)
  await page.goto(`./rooms/${rid}`)
  const checkbox = page.getByRole('checkbox', { name: 'Kettle is in the flat' })
  await checkbox.click()
  await expect(checkbox).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Kitchen is 25% ready')).toBeVisible()
  await expect.poll(() => state.writes).toBe(1)
  await checkbox.click()
  await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('Kitchen is 25% ready')).toBeHidden({ timeout: 5000 })
  await checkbox.click()
  await expect(checkbox).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Kitchen is 25% ready')).toHaveCount(0)
})

test('failed completion rolls back and does not celebrate', async ({ page }) => {
  const state = await mockFlat(page)
  state.failSave = true
  await page.goto(`./rooms/${rid}`)
  const checkbox = page.getByRole('checkbox', { name: 'Kettle is in the flat' })
  await checkbox.click()
  await expect(page.getByText('Save unavailable')).toBeVisible()
  await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('Kitchen is 25% ready')).toHaveCount(0)
})

test('keyboard checkbox action does not open the item sheet', async ({ page }) => {
  await mockFlat(page)
  await page.goto(`./rooms/${rid}`)
  const checkbox = page.getByRole('checkbox', { name: 'Kettle is in the flat' })
  await checkbox.focus()
  await checkbox.press('Space')
  await expect(checkbox).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a conflicting save keeps the draft and never silently overwrites', async ({ page }) => {
  const state = await mockFlat(page)
  state.conflict = true
  await page.goto(`./rooms/${rid}`)
  await page.getByRole('button', { name: /^Kettle\./ }).click()
  await page.getByLabel('Item', { exact: true }).fill('My kettle')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/Someone changed this item/)).toBeVisible()
  await expect(page.getByLabel('Item', { exact: true })).toHaveValue('My kettle')
  expect(state.items[0]!.name).toBe('Kettle')
})

test('nested confirmation Escape preserves parent focus and scroll lock', async ({ page }) => {
  await mockFlat(page)
  await page.goto(`./rooms/${rid}`)
  await page.getByRole('button', { name: /^Kettle\./ }).click()
  await page.getByRole('button', { name: 'Delete item', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Item details' })).toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('offline completion is rejected locally with a clear status', async ({ page }) => {
  const state = await mockFlat(page)
  await page.goto(`./rooms/${rid}`)
  await expect(page.getByRole('checkbox', { name: 'Kettle is in the flat' })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.getByText(/What you see may be out of date/)).toBeVisible()
  await page.getByRole('checkbox', { name: 'Kettle is in the flat' }).click()
  await expect(page.getByText('You’re offline. Reconnect before saving changes.')).toBeVisible()
  expect(state.writes).toBe(0)
})

test('retry after a partial create does not create a duplicate item', async ({ page }) => {
  const state = await mockFlat(page)
  state.failAssign = true
  await page.goto('./')
  await page.getByRole('button', { name: 'Add an item' }).click()
  await page.getByLabel('Item', { exact: true }).fill('Coffee table')
  await page.getByRole('checkbox', { name: 'Me', exact: true }).click()
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  await expect(page.getByText('Assignment unavailable')).toBeVisible()
  state.failAssign = false
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.creates).toBe(1)
})

test('lazy screens and sub-path deep links load without page errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await mockFlat(page)
  for (const path of ['rooms', 'wishlist', 'flatmates', 'profile', 'settings']) {
    await page.goto(`./${path}`)
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByText('Let’s reconnect', { exact: true })).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('first-run tour opens and can be skipped', async ({ page }) => {
  await mockFlat(page, true)
  await page.goto('./')
  await expect(page.getByText('Welcome to Flat Quest!', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Skip/ }).click()
  await expect(page.getByText('Welcome to Flat Quest!', { exact: true })).toBeHidden()
})

test('all six tour steps survive lazy navigation and stay on screen', async ({ page }) => {
  await mockFlat(page, true)
  await page.goto('./')
  for (const [index, title] of ['Welcome to Flat Quest!', 'Our progress', 'Explore rooms', 'Claim and share', 'Wishlist', 'Your account'].entries()) {
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect.poll(async () => {
      const bounds = await dialog.boundingBox()
      const viewport = page.viewportSize()!
      return Boolean(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1)
    }).toBe(true)
    await dialog.getByRole('button', { name: index === 0 ? 'Show me' : index === 5 ? 'Start exploring' : 'Next', exact: true }).click()
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test.describe('offline fallback', () => {
  test.use({ serviceWorkers: 'allow' })

test('service worker caches only the generic offline page', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service worker offline integration is checked in Chromium.')
  await page.goto('./offline.html')
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('./sw.js', { scope: './' })
    await navigator.serviceWorker.ready
  })
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys()
    return (await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((r) => r.url)))).flat()
  })
  expect(cached).toEqual(['http://127.0.0.1:3013/Flat-Quest/offline.html'])
  await page.context().setOffline(true)
  await page.goto('./rooms')
  await expect(page.getByText('Your flat will be right here')).toBeVisible()
})


})
