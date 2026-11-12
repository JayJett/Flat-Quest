import { test, expect, type Page } from '@playwright/test'
import { hid, kettle, madi, makeOption, mockFlat, resync, rid, toaster, uid } from './fixtures'

// Every test here runs against invented "Our Flat" records with all Supabase HTTP and
// WebSocket traffic intercepted. Realtime is off, so a flatmate's action is simulated by
// changing the fixture state and asking the app to resync (as it does on reconnect).

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR42mP8z8Dwn4EIwDiqkL4KAZKnCAH0mM3PAAAAAElFTkSuQmCC',
  'base64',
)

const shoppingRow = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\..*Open shopping details$`) })
const sheet = (page: Page, title: string) => page.getByRole('dialog', { name: title, exact: true })
const stage = (item: ReturnType<Page['locator']>) => item.getByRole('region', { name: 'Stage' }).locator('p[aria-live]')
/** The page's own title (the sticky header repeats it once you scroll). */
const pageTitle = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true }).last()
const section = (page: Page, label: string) => page.getByRole('region', { name: label, exact: true })

async function openShopping(page: Page, name: string) {
  await shoppingRow(page, name).click()
  await expect(sheet(page, name)).toBeVisible()
  return sheet(page, name)
}

async function addOption(page: Page, fields: { name: string; shop?: string; price?: string; link?: string; w?: string; d?: string; h?: string }) {
  const form = sheet(page, 'Add an option')
  await expect(form).toBeVisible()
  await form.getByLabel('Product', { exact: true }).fill(fields.name)
  if (fields.shop) await form.getByLabel('Shop').fill(fields.shop)
  if (fields.price) await form.getByLabel('Price (NZ$)').fill(fields.price)
  if (fields.link) await form.getByLabel('Link').fill(fields.link)
  if (fields.w) await form.getByLabel('Width in centimetres').fill(fields.w)
  if (fields.d) await form.getByLabel('Depth in centimetres').fill(fields.d)
  if (fields.h) await form.getByLabel('Height in centimetres').fill(fields.h)
  await form.getByRole('button', { name: 'Add option', exact: true }).click()
}

test.describe('the shopping journey', () => {
  // Just after midnight in Auckland while it is still the previous day in UTC.
  test.use({ timezoneId: 'Pacific/Auckland' })

  test('need to buy → compare → prefer → choose → coordinate → buy → deliver → in the flat', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-11T11:30:00Z'))
    const state = await mockFlat(page, false, { flatmates: true })
    // 1. A furnishing item needs purchasing. It is shared by Alex and Madi.
    state.items[0]!.status = 'need_to_buy'
    state.assignments = [uid, madi].map((user_id) => ({ item_id: kettle, household_id: hid, user_id, created_at: '2026-11-11T01:00:00.000Z' }))
    state.items[3]!.status = 'bringing'

    // 2. It appears in Shopping; undecided, provided and "bringing" items do not.
    await page.goto('./rooms/shopping')
    await expect(section(page, 'Need to buy').getByRole('button')).toHaveCount(1)
    await expect(shoppingRow(page, 'Kettle')).toBeVisible()
    for (const other of ['Fridge', 'Toaster', 'Plates']) await expect(shoppingRow(page, other)).toHaveCount(0)

    // 3. A household member adds a product option.
    const item = await openShopping(page, 'Kettle')
    await item.getByRole('button', { name: 'Add an option' }).click()
    await addOption(page, { name: 'Kettle A', shop: 'Briscoes', price: '$89', link: 'briscoes.co.nz/kettle-a', w: '22', d: '16', h: '25.5' })
    await expect(item.getByRole('button', { name: /^Kettle A\./ })).toBeVisible()
    expect(state.options[0]).toMatchObject({ name: 'Kettle A', retailer: 'Briscoes', price: 89, url: 'https://briscoes.co.nz/kettle-a', width_cm: 22, depth_cm: 16, height_cm: 25.5, item_id: kettle })

    // 4. Another member adds a competing option to the SAME checklist item.
    const optionB = makeOption({ name: 'Kettle B', retailer: 'Kmart', price: 45, item_id: kettle, created_by: madi })
    state.options.push(optionB)
    state.preferences.push({ item_id: kettle, user_id: madi, household_id: hid, option_id: optionB.id, created_at: '2026-11-11T03:00:00.000Z', updated_at: '2026-11-11T03:00:00.000Z' })
    await resync(page)
    await expect(item.getByRole('button', { name: /^Kettle B\./ })).toBeVisible()
    await expect(item.getByRole('button', { name: /^Kettle B\..*Preferred by Madi/ })).toBeVisible()
    expect(state.items.filter((i) => i.name === 'Kettle')).toHaveLength(1)
    expect(new Set(state.options.map((o) => o.item_id))).toEqual(new Set([kettle]))

    // 5. Members express different preferences; each has exactly one per item.
    await item.getByRole('button', { name: 'Prefer Kettle B' }).click()
    await expect(item.getByRole('button', { name: 'Remove your preference for Kettle B' })).toBeVisible()
    await item.getByRole('button', { name: 'Prefer Kettle A' }).click()
    await expect(item.getByRole('button', { name: 'Remove your preference for Kettle A' })).toBeVisible()
    await expect(item.getByRole('button', { name: 'Prefer Kettle B' })).toBeVisible()
    await expect.poll(() => state.preferences.filter((p) => p.user_id === uid).map((p) => p.option_id)).toEqual([state.options[0]!.id])
    expect(state.preferences.find((p) => p.user_id === madi)!.option_id).toBe(optionB.id)
    // Preferences alone decide nothing.
    expect(state.options.some((o) => o.is_selected)).toBe(false)

    // 6. A final product is selected; the alternative stays for reference.
    await item.getByRole('button', { name: /^Kettle A\./ }).click()
    const option = sheet(page, 'Option')
    await expect(option.getByText('Added by you', { exact: false })).toBeVisible()
    await option.getByRole('button', { name: 'Choose this one' }).click()
    await expect(option.getByText('Our pick, chosen by you')).toBeVisible()
    await option.getByRole('button', { name: 'Close' }).click()
    await expect(item.getByRole('button', { name: /^Kettle A\..*Our pick/ })).toBeVisible()
    await expect(item.getByRole('button', { name: /^Kettle B\./ })).toBeVisible()
    expect(state.options.map((o) => [o.name, o.is_selected])).toEqual([['Kettle A', true], ['Kettle B', false]])

    // 7. Someone coordinates the purchase. Assignees and ownership are untouched.
    await item.getByRole('button', { name: /I.ll sort it/ }).click()
    await expect(item.getByText('You’re sorting this')).toBeVisible()
    expect(state.coordinators).toMatchObject([{ item_id: kettle, user_id: uid }])
    expect(state.assignments.map((a) => a.user_id).sort()).toEqual([uid, madi].sort())
    expect(state.items[0]).toMatchObject({ ownership: 'to_decide', owner_user_id: null })

    // 8. Purchase information is recorded (one transaction: details + stage + amount).
    await item.getByRole('button', { name: 'Record purchase' }).click()
    const purchase = sheet(page, 'Record a purchase')
    await expect(purchase.getByLabel('Which product?')).toHaveValue(state.options[0]!.id)
    // "Today" is the Auckland date (12 Nov), not the UTC one (11 Nov).
    await expect(purchase.getByLabel('Date bought')).toHaveValue('2026-11-12')
    await purchase.getByLabel('Bought by').selectOption(uid)
    await purchase.getByLabel('Paid (NZ$)').fill('85.50')
    await purchase.getByLabel('Order reference').fill('ORD-77')
    await purchase.getByLabel('Getting it by').selectOption('delivery')
    await purchase.getByLabel('Expected on').fill('2026-11-20')
    await purchase.getByRole('button', { name: 'Save purchase' }).click()
    await expect(purchase).toBeHidden()
    expect(state.purchases[0]).toMatchObject({ item_id: kettle, option_id: state.options[0]!.id, purchased_by: uid, purchased_on: '2026-11-12', order_reference: 'ORD-77', delivery_method: 'delivery', expected_on: '2026-11-20' })
    // The amount is the checklist item's own "spent" figure: one number, not two.
    expect(state.items[0]).toMatchObject({ status: 'ordered', actual_price: 85.5, is_complete: false })
    await expect(stage(item)).toHaveText('Ordered')
    await expect(item.getByText('$85.50')).toBeVisible()
    await expect(item.getByText('20 Nov')).toBeVisible()

    // 9. Delivery progress is updated. Still not complete.
    await item.getByLabel('Change stage').selectOption('on_the_way')
    await expect(stage(item)).toHaveText('On the way')
    expect(state.items[0]).toMatchObject({ status: 'on_the_way', is_complete: false })

    // 10–11. The product arrives and the checklist item is completed.
    await item.getByRole('button', { name: /It.s in the flat/ }).click()
    await expect(item).toBeHidden()
    expect(state.items[0]).toMatchObject({ is_complete: true, completed_by: uid, status: 'on_the_way' })
    await expect.poll(() => state.purchases[0]!.arrived_on).toBe('2026-11-12')
    // Progress celebration still fires for a confirmed completion (1 of 4 in the kitchen).
    await expect(page.getByText('Kitchen is 25% ready')).toBeVisible()
    await expect(section(page, 'Recently bought').getByRole('button', { name: /^Kettle\. In the flat/ })).toBeVisible()

    // 12. Household progress, the room and the activity list all agree.
    await page.goto('./')
    await expect(page.getByRole('region', { name: 'Household progress' }).getByText('1 of 4')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Around the flat' }).getByText('Kettle')).toBeVisible()
    await page.goto(`./rooms/${rid}`)
    await expect(page.getByRole('checkbox', { name: 'Kettle is in the flat' })).toHaveAttribute('aria-checked', 'true')
  })
})

test('shopping leaves out what nobody needs to buy, and offers the undecided ones on request', async ({ page }) => {
  const state = await mockFlat(page)
  state.items[0]!.status = 'bringing'
  state.items[3]!.status = 'not_needed'
  // Completed without any purchase: brought from home, so never "recently bought".
  Object.assign(state.items[0]!, { is_complete: true, completed_at: new Date().toISOString(), completed_by: uid })
  await page.goto('./rooms/shopping')
  await expect(page.getByRole('heading', { name: 'Nothing to buy right now' })).toBeVisible()
  await expect(page.getByText('Nothing on the shopping list right now')).toBeVisible()
  for (const name of ['Kettle', 'Fridge', 'Toaster', 'Plates']) await expect(shoppingRow(page, name)).toHaveCount(0)

  await page.getByRole('button', { name: 'Look through 1 undecided item' }).click()
  await expect(section(page, 'Still to decide').getByRole('button')).toHaveCount(1)
  const item = await openShopping(page, 'Toaster')
  await item.getByRole('button', { name: 'We need to buy this' }).click()
  await expect.poll(() => state.items[2]!.status).toBe('need_to_buy')
  await item.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(section(page, 'Need to buy').getByRole('button', { name: /^Toaster\./ })).toBeVisible()
})

test('filters and sorting narrow the same checklist and survive a reload', async ({ page }) => {
  const state = await mockFlat(page, false, { flatmates: true })
  Object.assign(state.items[0]!, { status: 'shopping', priority: 'nice_to_have', estimated_price: 120 })
  Object.assign(state.items[2]!, { status: 'ordered', priority: 'must_have' })
  Object.assign(state.items[3]!, { status: 'need_to_buy', priority: 'maybe_later', estimated_price: 30 })
  state.assignments = [{ item_id: toaster, household_id: hid, user_id: uid, created_at: '2026-11-11T01:00:00.000Z' }]
  state.coordinators = [{ item_id: kettle, household_id: hid, user_id: madi, claimed_at: '2026-11-11T01:00:00.000Z' }]
  state.options = [makeOption({ name: 'Cheap kettle', price: 20, item_id: kettle })]
  await page.goto('./rooms/shopping')
  await expect(page.getByText('2 to buy · 1 on order')).toBeVisible()
  await expect(shoppingRow(page, 'Kettle')).toBeVisible()
  // Grouped by real purchase stage.
  for (const [label, name] of [['Need to buy', 'Plates'], ['Looking around', 'Kettle'], ['Ordered', 'Toaster']] as const) {
    await expect(section(page, label).getByRole('button', { name: new RegExp(`^${name}\\.`) })).toBeVisible()
  }

  const names = async () => (await page.getByRole('button', { name: /Open shopping details$/ }).allInnerTexts()).map((t) => t.split('\n')[0])
  const filters = sheet(page, 'Filter and sort')
  await page.getByRole('button', { name: 'Filter and sort' }).click()
  await filters.getByLabel('Who').selectOption('me')
  await expect(filters.getByRole('button', { name: 'Show 1 item' })).toBeVisible()
  await filters.getByLabel('Who').selectOption(madi)
  await filters.getByRole('button', { name: 'Show 1 item' }).click()
  expect(await names()).toEqual(['Kettle'])
  await expect(page).toHaveURL(new RegExp(`who=${madi}`))

  await page.getByRole('button', { name: /Filter and sort, 1 filter on/ }).click()
  await filters.getByLabel('Who').selectOption('all')
  await filters.getByLabel('Priority').selectOption('must_have')
  await filters.getByLabel('Stage').selectOption('ordered')
  await filters.getByRole('button', { name: 'Show 1 item' }).click()
  expect(await names()).toEqual(['Toaster'])
  await page.reload()
  await expect(shoppingRow(page, 'Toaster')).toBeVisible()
  expect(await names()).toEqual(['Toaster'])
  await expect(page.getByText('Must-have · Ordered')).toBeVisible()

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await page.getByRole('button', { name: 'Filter and sort' }).click()
  await filters.getByLabel('Sort by').selectOption('price')
  await filters.getByRole('button', { name: 'Show 3 items' }).click()
  // Cheapest known price first (an option's price beats the estimate); unknown prices last.
  expect(await names()).toEqual(['Kettle', 'Plates', 'Toaster'])
  await page.getByRole('button', { name: 'Filter and sort' }).click()
  await filters.getByLabel('Sort by').selectOption('name')
  await filters.getByLabel('Room').selectOption(rid)
  await filters.getByRole('button', { name: 'Show 3 items' }).click()
  expect(await names()).toEqual(['Kettle', 'Plates', 'Toaster'])
  await page.getByRole('button', { name: /Filter and sort/ }).click()
  await filters.getByRole('button', { name: 'Reset' }).click()
  await filters.getByRole('button', { name: 'Show 3 items' }).click()
  await expect(page).not.toHaveURL(/sort=|room=/)
})

test.describe('purchase coordination', () => {
  test('a claim that loses the race is refused, shown honestly, and can be taken over or handed back deliberately', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    state.items[0]!.status = 'need_to_buy'
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    await expect(item.getByText('Nobody’s sorting this yet')).toBeVisible()
    // Madi's claim reaches the database first; this screen hasn't heard yet.
    state.coordinators.push({ item_id: kettle, household_id: hid, user_id: madi, claimed_at: '2026-11-11T05:00:00.000Z' })
    await item.getByRole('button', { name: /I.ll sort it/ }).click()
    await expect(page.getByText('Someone else just took this on.')).toBeVisible()
    await expect(item.getByText('Madi is sorting this')).toBeVisible()
    expect(state.coordinators).toMatchObject([{ user_id: madi }])

    // Taking over is explicit and confirmed.
    await item.getByRole('button', { name: 'Take over' }).click()
    const confirm = sheet(page, 'Take over from Madi?')
    await confirm.getByRole('button', { name: 'Take over' }).click()
    await expect(item.getByText('You’re sorting this')).toBeVisible()
    expect(state.coordinators).toMatchObject([{ user_id: uid }])

    // Handing over gives the role to a chosen flatmate.
    await item.getByRole('button', { name: 'Hand over' }).click()
    await sheet(page, 'Hand over to').getByRole('button', { name: 'Madi' }).click()
    await expect(item.getByText('Madi is sorting this')).toBeVisible()
    expect(state.coordinators).toMatchObject([{ user_id: madi }])

    // A take-over based on stale information changes nothing.
    state.coordinators = []
    await item.getByRole('button', { name: 'Take over' }).click()
    await sheet(page, 'Take over from Madi?').getByRole('button', { name: 'Take over' }).click()
    await expect(page.getByText('That changed a moment ago. Have another look.')).toBeVisible()
    await expect(item.getByText('Nobody’s sorting this yet')).toBeVisible()
    expect(state.coordinators).toEqual([])

    // Releasing your own role.
    await item.getByRole('button', { name: /I.ll sort it/ }).click()
    await expect(item.getByText('You’re sorting this')).toBeVisible()
    await item.getByRole('button', { name: 'Release' }).click()
    await expect(item.getByText('Nobody’s sorting this yet')).toBeVisible()
    expect(state.coordinators).toEqual([])
  })

  test('a double tap sends one claim, and the shopping list shows who is sorting it', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    state.items[0]!.status = 'shopping'
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    await item.getByRole('button', { name: /I.ll sort it/ }).dblclick()
    await expect(item.getByText('You’re sorting this')).toBeVisible()
    expect(state.claimAttempts).toBe(1)
    await item.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: /^Kettle\..*You’re sorting this/ })).toBeVisible()
  })
})

test.describe('product options', () => {
  test('photo upload: preview, failed save cleans up, retry saves once, replace and remove tidy the old file', async ({ page }) => {
    const state = await mockFlat(page)
    state.items[0]!.status = 'shopping'
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    await item.getByRole('button', { name: 'Add an option' }).click()
    const form = sheet(page, 'Add an option')

    // Unsupported files are refused before anything is uploaded.
    await form.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(page.getByText('Choose a photo (JPEG, PNG or WebP).')).toBeVisible()
    await form.locator('input[type=file]').setInputFiles({ name: 'kettle.png', mimeType: 'image/png', buffer: PNG })
    await expect(form.getByRole('button', { name: 'Replace product photo' }).locator('img')).toBeVisible()
    expect(state.files).toEqual([])

    await form.getByLabel('Product', { exact: true }).fill('Kettle with photo')
    state.failOptionSave = true
    await form.getByRole('button', { name: 'Add option', exact: true }).click()
    await expect(page.getByText('Option save unavailable')).toBeVisible()
    // The draft is kept, nothing was created, and the one uploaded file is reused by the retry.
    await expect(form.getByLabel('Product', { exact: true })).toHaveValue('Kettle with photo')
    expect(state.options).toEqual([])
    expect(state.files).toHaveLength(1)
    state.failOptionSave = false
    await form.getByRole('button', { name: 'Add option', exact: true }).click()
    await expect(form).toBeHidden()
    expect(state.options).toHaveLength(1)
    expect(state.files).toHaveLength(1)
    expect(state.options[0]!.photo_path).toBe(state.files[0])
    expect(state.files[0]).toMatch(new RegExp(`^${hid}/products/[a-f0-9-]+\\.(webp|jpg)$`))
    // The card and the shopping list both lead with the photo.
    await expect(item.getByRole('button', { name: /^Kettle with photo\./ }).locator('img')).toBeVisible()

    // Replace: the new file is stored and the old one removed.
    const first = state.files[0]!
    await item.getByRole('button', { name: /^Kettle with photo\./ }).click()
    await sheet(page, 'Option').getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = sheet(page, 'Edit option')
    await edit.locator('input[type=file]').setInputFiles({ name: 'kettle2.png', mimeType: 'image/png', buffer: PNG })
    await page.waitForTimeout(5)
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit).toBeHidden()
    expect(state.removedFiles).toEqual([])
    expect(state.options[0]!.photo_path).not.toBe(first)

    // Remove: the option keeps everything else and falls back to the placeholder.
    const second = state.options[0]!.photo_path!
    await sheet(page, 'Option').getByRole('button', { name: 'Edit', exact: true }).click()
    await edit.getByRole('button', { name: 'Remove', exact: true }).click()
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit).toBeHidden()
    expect(state.files).toContain(second)
    expect(state.options[0]).toMatchObject({ name: 'Kettle with photo', photo_path: null })
    expect(state.files).toHaveLength(2)
  })

  test('closing a failed save leaves a registered upload for backend cleanup', async ({ page }) => {
    const state = await mockFlat(page)
    state.items[0]!.status = 'shopping'
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    await item.getByRole('button', { name: 'Add an option' }).click()
    const form = sheet(page, 'Add an option')
    await form.locator('input[type=file]').setInputFiles({ name: 'kettle.png', mimeType: 'image/png', buffer: PNG })
    await form.getByLabel('Product', { exact: true }).fill('Abandoned')
    state.failOptionSave = true
    await form.getByRole('button', { name: 'Add option', exact: true }).click()
    await expect(page.getByText('Option save unavailable')).toBeVisible()
    expect(state.files).toHaveLength(1)
    await form.getByRole('button', { name: 'Close' }).click()
    expect(state.files).toHaveLength(1)
    expect(state.reservations).toEqual(state.files)
    expect(state.options).toEqual([])
  })

  test('prices, links and measurements are validated before anything is sent', async ({ page }) => {
    const state = await mockFlat(page)
    state.items[0]!.status = 'shopping'
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    await item.getByRole('button', { name: 'Add an option' }).click()
    const form = sheet(page, 'Add an option')
    await form.getByRole('button', { name: 'Add option', exact: true }).click()
    await expect(form.getByText('Give the product a name.')).toBeVisible()
    await form.getByLabel('Product', { exact: true }).fill('Kettle')
    await form.getByLabel('Price (NZ$)').fill('-5')
    await form.getByLabel('Link').fill('javascript:alert(1)')
    await form.getByLabel('Width in centimetres').fill('0')
    await form.getByLabel('Height in centimetres').fill('abc')
    await form.getByRole('button', { name: 'Add option', exact: true }).click()
    await expect(form.getByText('Enter an amount, like 899 or 49.95.')).toBeVisible()
    await expect(form.getByText('That doesn’t look like a web link.')).toBeVisible()
    await expect(form.getByText('Centimetres, between 0.1 and 2000.')).toBeVisible()
    expect(state.optionWrites).toBe(0)
    // Unknown measurements may stay empty.
    await form.getByLabel('Price (NZ$)').fill('1,299')
    await form.getByLabel('Link').fill('')
    await form.getByLabel('Width in centimetres').fill('220')
    await form.getByLabel('Height in centimetres').fill('')
    await form.getByRole('button', { name: 'Add option', exact: true }).click()
    await expect(form).toBeHidden()
    expect(state.options[0]).toMatchObject({ price: 1299, url: null, width_cm: 220, depth_cm: null, height_cm: null })
    await expect(item.getByRole('button', { name: /^Kettle\. \$1,299\. W 220 cm/ })).toBeVisible()
  })

  test('a failed preference rolls back; a stale edit is refused and the draft kept', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    state.items[0]!.status = 'shopping'
    state.options = [makeOption({ name: 'Kettle A', price: 89, item_id: kettle })]
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    state.failPreference = true
    await item.getByRole('button', { name: 'Prefer Kettle A' }).click()
    await expect(page.getByText('Preference unavailable')).toBeVisible()
    await expect(item.getByRole('button', { name: 'Prefer Kettle A' })).toHaveAttribute('aria-pressed', 'false')
    expect(state.preferences).toEqual([])
    state.failPreference = false

    await item.getByRole('button', { name: /^Kettle A\./ }).click()
    await sheet(page, 'Option').getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = sheet(page, 'Edit option')
    await edit.getByLabel('Price (NZ$)').fill('79')
    // Madi saves a different price while this form is open.
    Object.assign(state.options[0]!, { price: 95, updated_at: '2026-11-11T09:00:00.000Z' })
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(/Someone changed this option while you were editing/)).toBeVisible()
    await expect(edit.getByLabel('Price (NZ$)')).toHaveValue('79')
    expect(state.options[0]!.price).toBe(95)
  })

  test('removing an option keeps the checklist item; deleting the item removes its option photos', async ({ page }) => {
    const state = await mockFlat(page)
    state.items[0]!.status = 'shopping'
    state.files = [`${hid}/products/${kettle}-1.webp`]
    state.options = [makeOption({ name: 'Kettle A', item_id: kettle, photo_path: state.files[0]! }), makeOption({ name: 'Kettle B', item_id: kettle })]
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    await item.getByRole('button', { name: /^Kettle B\./ }).click()
    await sheet(page, 'Option').getByRole('button', { name: 'Remove', exact: true }).click()
    await sheet(page, 'Remove this option?').getByRole('button', { name: 'Remove option' }).click()
    await expect(item.getByRole('button', { name: /^Kettle B\./ })).toHaveCount(0)
    expect(state.options.map((o) => o.name)).toEqual(['Kettle A'])
    expect(state.items.some((i) => i.id === kettle)).toBe(true)

    await item.getByRole('button', { name: 'Edit item' }).click()
    const details = sheet(page, 'Item details')
    await details.getByRole('button', { name: 'Delete item', exact: true }).click()
    await sheet(page, 'Delete this item?').getByRole('button', { name: 'Delete', exact: true }).click()
    expect(state.removedFiles).toEqual([])
    await expect(shoppingRow(page, 'Kettle')).toHaveCount(0)
  })
})

test.describe('purchases and deliveries', () => {
  test('an everyday item can be bought with no product options at all', async ({ page }) => {
    const state = await mockFlat(page)
    state.items[3]!.status = 'need_to_buy'
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Plates')
    await item.getByRole('button', { name: 'Record purchase' }).click()
    const purchase = sheet(page, 'Record a purchase')
    await expect(purchase.getByLabel('Which product?')).toHaveCount(0)
    await purchase.getByLabel('Paid (NZ$)').fill('24')
    await purchase.getByLabel('Stage').selectOption('delivered')
    await purchase.getByRole('button', { name: 'Save purchase' }).click()
    await expect(purchase).toBeHidden()
    expect(state.purchases[0]).toMatchObject({ option_id: null })
    // Delivered is a stage, not completion.
    expect(state.items[3]).toMatchObject({ status: 'delivered', actual_price: 24, is_complete: false })
    await expect(item.getByText('It has arrived. Tick “It’s in the flat” once it’s unpacked and in place.')).toBeVisible()
    await item.getByRole('button', { name: /It.s in the flat/ }).click()
    await expect.poll(() => state.items[3]!.is_complete).toBe(true)
  })

  test('adding purchase details to a finished item does not quietly change its plan', async ({ page }) => {
    const state = await mockFlat(page)
    Object.assign(state.items[0]!, { status: 'bringing', actual_price: 40, is_complete: true, completed_at: '2026-11-10T00:00:00.000Z', completed_by: uid })
    await page.goto(`./rooms/${rid}`)
    await page.getByRole('button', { name: /^Kettle\./ }).click()
    await sheet(page, 'Item details').getByRole('button', { name: /^Shopping/ }).click()
    const item = sheet(page, 'Kettle')
    await item.getByRole('region', { name: 'Purchase and delivery' }).getByRole('button', { name: 'Edit', exact: true }).click()
    const purchase = sheet(page, 'Record a purchase')
    await purchase.getByLabel('Order reference').fill('RECEIPT-9')
    await purchase.getByRole('button', { name: 'Save purchase' }).click()
    await expect(purchase).toBeHidden()
    expect(state.purchases[0]).toMatchObject({ order_reference: 'RECEIPT-9' })
    expect(state.items[0]).toMatchObject({ status: 'bringing', actual_price: 40, is_complete: true })
  })

  test('a stale purchase form is refused without overwriting, and a failed save changes nothing', async ({ page }) => {
    const state = await mockFlat(page, false, { flatmates: true })
    state.items[0]!.status = 'ordered'
    state.purchases = [{ item_id: kettle, household_id: hid, option_id: null, purchased_by: null, purchased_on: '2026-11-10', order_reference: 'ORD-1', notes: null, delivery_method: null, expected_on: null, tracking_url: null, delivery_notes: null, arrived_on: null, updated_by: madi, created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z' }]
    await page.goto('./rooms/shopping')
    const item = await openShopping(page, 'Kettle')
    await item.getByRole('button', { name: 'Order details' }).click()
    const purchase = sheet(page, 'Purchase and delivery')
    await expect(purchase.getByLabel('Order reference')).toHaveValue('ORD-1')
    await purchase.getByLabel('Order reference').fill('MINE')

    state.failPurchase = true
    await purchase.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Purchase save unavailable')).toBeVisible()
    await expect(purchase.getByLabel('Order reference')).toHaveValue('MINE')
    expect(state.purchases[0]!.order_reference).toBe('ORD-1')
    state.failPurchase = false

    // Madi updates the delivery while this form is still open.
    Object.assign(state.purchases[0]!, { order_reference: 'MADI-2', updated_at: '2026-11-11T09:00:00.000Z' })
    await purchase.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(/Someone updated this while you were editing/)).toBeVisible()
    await expect(purchase.getByLabel('Order reference')).toHaveValue('MINE')
    expect(state.purchases[0]!.order_reference).toBe('MADI-2')
    // Reopening shows the latest, which can then be saved.
    await purchase.getByRole('button', { name: 'Close' }).click()
    await expect(item.getByText('MADI-2')).toBeVisible()
    await item.getByRole('button', { name: 'Order details' }).click()
    await purchase.getByLabel('Tracking link').fill('track.example.nz/abc')
    await purchase.getByRole('button', { name: 'Save changes' }).click()
    await expect(purchase).toBeHidden()
    expect(state.purchases[0]).toMatchObject({ order_reference: 'MADI-2', tracking_url: 'https://track.example.nz/abc' })
    await expect(item.getByRole('link', { name: 'Track the delivery' })).toHaveAttribute('href', 'https://track.example.nz/abc')
  })
})

test('room measurements give a rough, clearly-caveated comparison', async ({ page }) => {
  const state = await mockFlat(page)
  state.items[0]!.status = 'shopping'
  state.options = [
    makeOption({ name: 'Small bench', item_id: kettle, width_cm: 120, depth_cm: 60, height_cm: 90 }),
    makeOption({ name: 'Huge bench', item_id: kettle, width_cm: 450, depth_cm: 80 }),
  ]
  await page.goto('./rooms/shopping')
  const item = await openShopping(page, 'Kettle')
  await item.getByRole('button', { name: /^Small bench\./ }).click()
  const option = sheet(page, 'Option')
  await expect(option.getByText('Add Kitchen’s measurements to see a rough comparison.')).toBeVisible()
  await option.getByRole('button', { name: 'Add room measurements' }).click()
  const room = sheet(page, 'Edit room')
  await room.getByLabel('Room width in centimetres').fill('-300')
  await room.getByRole('button', { name: 'Save room' }).click()
  await expect(room.getByText(/Use centimetres/)).toBeVisible()
  await room.getByLabel('Room width in centimetres').fill('300')
  await room.getByLabel('Room length in centimetres').fill('400')
  await room.getByLabel('Things to watch for').fill('Door is 76 cm wide')
  await room.getByRole('button', { name: 'Save room' }).click()
  await expect(room).toBeHidden()
  expect(state.room).toMatchObject({ width_cm: 300, length_cm: 400, height_cm: null, measurement_notes: 'Door is 76 cm wide', name: 'Kitchen' })
  await expect(option.getByText('It’s within the room’s floor size. Its longest side is about 30% of the longest wall.')).toBeVisible()
  await expect(option.getByText(/A rough guide from the room’s size only/)).toBeVisible()
  await option.getByRole('button', { name: 'Close' }).click()
  await item.getByRole('button', { name: /^Huge bench\./ }).click()
  await expect(option.getByText(/Looks too big for the floor: 450 × 80 cm against a room of 300 × 400 cm/)).toBeVisible()
  await expect(option.getByText(/will fit/i)).toHaveCount(0)
})

test('one status system: the checklist plan and the shopping stage are the same field', async ({ page }) => {
  const state = await mockFlat(page)
  state.items[0]!.status = 'ordered'
  await page.goto(`./rooms/${rid}`)
  await page.getByRole('button', { name: /^Kettle\. Ordered/ }).click()
  const details = sheet(page, 'Item details')
  await details.getByRole('radio', { name: 'Ready to collect' }).click()
  await details.getByRole('button', { name: 'Save changes' }).click()
  await expect(details).toBeHidden()
  expect(state.items[0]!.status).toBe('ready_to_collect')
  // The same item, reached from its details, shows the same stage in Shopping.
  await page.getByRole('button', { name: /^Kettle\. Ready to collect/ }).click()
  await details.getByRole('button', { name: /^Shopping/ }).click()
  const item = sheet(page, 'Kettle')
  await expect(stage(item)).toHaveText('Ready to collect')
  await expect(item.getByRole('button', { name: 'Edit item' })).toHaveCount(0)
  await item.getByLabel('Change stage').selectOption('bringing')
  await expect.poll(() => state.items[0]!.status).toBe('bringing')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.goto('./rooms/shopping')
  await expect(shoppingRow(page, 'Kettle')).toHaveCount(0)
})

test('shopping details being unavailable never breaks the checklist, and recovers on retry', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const state = await mockFlat(page)
  state.items[0]!.status = 'need_to_buy'
  state.shoppingDown = true
  await page.goto(`./rooms/${rid}`)
  const checkbox = page.getByRole('checkbox', { name: 'Toaster is in the flat' })
  await checkbox.click()
  await expect(checkbox).toHaveAttribute('aria-checked', 'true')
  await page.goto('./rooms/shopping')
  const item = await openShopping(page, 'Kettle')
  await expect(item.getByRole('alert').getByText('Shopping unavailable')).toBeVisible()
  state.shoppingDown = false
  state.options = [makeOption({ name: 'Kettle A', item_id: kettle })]
  await item.getByRole('button', { name: 'Try again' }).click()
  await expect(item.getByRole('button', { name: /^Kettle A\./ })).toBeVisible()
  expect(errors).toEqual([])
})

test('offline: shopping changes are refused locally and nothing is queued', async ({ page }) => {
  const state = await mockFlat(page)
  state.items[0]!.status = 'need_to_buy'
  state.options = [makeOption({ name: 'Kettle A', item_id: kettle })]
  await page.goto('./rooms/shopping')
  const item = await openShopping(page, 'Kettle')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })
  await item.getByRole('button', { name: 'Prefer Kettle A' }).click()
  await expect(page.getByText('You’re offline. Reconnect before saving changes.')).toBeVisible()
  await item.getByRole('button', { name: /I.ll sort it/ }).click()
  await item.getByLabel('Change stage').selectOption('ordered')
  await expect(stage(item)).toHaveText('Need to buy')
  expect(state.preferences).toEqual([])
  expect(state.claimAttempts).toBe(0)
  expect(state.writes).toBe(0)
})

test('navigation: four tabs, Shopping inside Rooms, and a shortcut on Home', async ({ page }) => {
  const state = await mockFlat(page)
  state.items[0]!.status = 'need_to_buy'
  state.items[2]!.status = 'ordered'
  await page.goto('./')
  const shortcut = page.getByRole('link', { name: /^Shopping/ })
  await expect(shortcut).toContainText('1 to buy · 1 on order')
  await shortcut.click()
  await expect(page).toHaveURL(/\/rooms\/shopping$/)
  await expect(pageTitle(page, 'Shopping')).toBeVisible()
  // The view switch moves between the three views of the same checklist.
  await page.getByRole('radio', { name: /^Rooms/ }).click()
  await expect(pageTitle(page, 'Rooms')).toBeVisible()
  await page.getByRole('radio', { name: /^Shopping/ }).click()
  await expect(page).toHaveURL(/\/rooms\/shopping$/)
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    const tabs = page.getByRole('navigation', { name: 'Primary' }).getByRole('link')
    await expect(tabs).toHaveText(['Home', 'Rooms', 'Wishlist', 'Flatmates'])
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Rooms' })).toHaveClass(/text-ink\b/)
  }
})

test('layout: nothing overflows, comparisons are not clipped and sheet actions stay on screen', async ({ page }) => {
  const state = await mockFlat(page, false, { flatmates: true })
  Object.assign(state.items[0]!, { status: 'shopping', name: 'Living room couch with a rather long name' })
  state.items[2]!.status = 'ordered'
  state.items[3]!.status = 'need_to_buy'
  state.options = [
    makeOption({ name: 'Jasper 3-seater fabric sofa in charcoal grey', retailer: 'Freedom Furniture', price: 1299, item_id: kettle, width_cm: 220, depth_cm: 95, height_cm: 85, is_selected: true, selected_by: madi }),
    makeOption({ name: 'Mocka', retailer: 'Mocka', price: 899.5, item_id: kettle }),
    makeOption({ name: 'Harvey Norman couch', retailer: 'Harvey Norman', price: 1599, item_id: kettle }),
  ]
  state.preferences = [{ item_id: kettle, user_id: madi, household_id: hid, option_id: state.options[0]!.id, created_at: 'x', updated_at: '2026-11-11T03:00:00.000Z' }]
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  await page.goto('./rooms/shopping')
  await expect(shoppingRow(page, 'Living room couch with a rather long name')).toBeVisible()
  expect(await fits()).toBe(true)

  const item = await openShopping(page, 'Living room couch with a rather long name')
  const viewport = page.viewportSize()!
  const inside = async (locator: ReturnType<Page['locator']>) => {
    const box = (await locator.boundingBox())!
    return box.x >= -0.5 && box.x + box.width <= viewport.width + 0.5
  }
  for (const card of await item.getByRole('button', { name: /Open option$/ }).all()) expect(await inside(card)).toBe(true)
  // The pinned actions are fully visible above the bottom edge, and comfortably tappable.
  for (const name of ['Record purchase', /It.s in the flat/] as const) {
    const button = item.getByRole('button', { name })
    await expect(button).toBeInViewport({ ratio: 1 })
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  for (const target of await item.getByRole('button', { name: /^(Prefer|Remove your preference)/ }).all()) {
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await fits()).toBe(true)

  await item.getByRole('button', { name: 'Record purchase' }).click()
  const purchase = sheet(page, 'Record a purchase')
  await purchase.getByLabel('Purchase notes').scrollIntoViewIfNeeded()
  await expect(purchase.getByRole('button', { name: 'Save purchase' })).toBeInViewport({ ratio: 1 })
  expect(await purchase.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await fits()).toBe(true)
})

test('keyboard: rows, cards, preferences and sheets all work without a pointer', async ({ page }) => {
  const state = await mockFlat(page)
  state.items[0]!.status = 'shopping'
  state.options = [makeOption({ name: 'Kettle A', item_id: kettle })]
  await page.goto('./rooms/shopping')
  await shoppingRow(page, 'Kettle').focus()
  await page.keyboard.press('Enter')
  const item = sheet(page, 'Kettle')
  await expect(item).toBeVisible()
  // Space on the preference button records it without opening the option.
  await item.getByRole('button', { name: 'Prefer Kettle A' }).focus()
  await page.keyboard.press('Space')
  await expect(item.getByRole('button', { name: 'Remove your preference for Kettle A' })).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect.poll(() => state.preferences.length).toBe(1)
  // Enter on the card opens it; Escape closes only the top sheet and returns focus.
  await item.getByRole('button', { name: /^Kettle A\./ }).focus()
  await page.keyboard.press('Enter')
  await expect(sheet(page, 'Option')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet(page, 'Option')).toBeHidden()
  await expect(item.getByRole('button', { name: /^Kettle A\./ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(shoppingRow(page, 'Kettle')).toBeFocused()
})

test('reduced motion: shopping feedback is instant', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'reduced-motion', 'Checked in the reduced-motion project.')
  const state = await mockFlat(page)
  state.items[0]!.status = 'shopping'
  state.options = [makeOption({ name: 'Kettle A', item_id: kettle })]
  await page.goto('./rooms/shopping')
  const item = await openShopping(page, 'Kettle')
  const button = item.getByRole('button', { name: 'Prefer Kettle A' })
  expect(await button.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.01)
  await button.click()
  // No spring: the icon is at rest immediately.
  const icon = item.getByRole('button', { name: 'Remove your preference for Kettle A' }).locator('span').first()
  expect(await icon.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
})

test('wishlist still works and stays separate from product preferences', async ({ page }) => {
  const state = await mockFlat(page)
  state.options = [makeOption({ name: 'Kettle A', item_id: kettle })]
  await page.goto('./wishlist')
  await expect(page.getByText('A reading lamp', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Vote for A reading lamp' })).toBeVisible()
  expect(state.preferences).toEqual([])
})

