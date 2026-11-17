import { expect, test, type Page } from '@playwright/test'
import { hid, kettle, madi, makeAppointment, makeEssential, makeTask, mockFlat, rid, uid, zonedFixtureInstant } from './fixtures'
import { addFlatB, hidB } from './multiFlat'

/** Today and offsets in the flat's zone (Pacific/Auckland), like the app computes them. */
function aucklandDate(offset = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]))
  const d = new Date(Date.UTC(+p.year!, +p.month! - 1, +p.day! + offset))
  return d.toISOString().slice(0, 10)
}
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
const monday = (date = aucklandDate()) => aucklandDateFrom(date, -weekday(date))
function aucklandDateFrom(date: string, offset: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const greeting = (page: Page) => page.locator('h1').filter({ hasText: 'Let’s furnish' })
const openMenu = async (page: Page) => {
  await page.getByRole('button', { name: 'Open menu' }).click()
  return page.getByRole('dialog', { name: 'Menu' })
}
const accountKey = `flatquest.activeHousehold.${uid}`
/** Remembers a flat for Alex once (a later switch in the test isn't undone by page loads). */
const prefer = (page: Page, id: string) => page.addInitScript(([k, v]) => {
  if (!sessionStorage.getItem('fq-test-seeded')) { localStorage.setItem(k!, v!); sessionStorage.setItem('fq-test-seeded', '1') }
}, [accountKey, id])

test.describe('your flats', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('one flat opens Home directly; the menu shows it as current with a way to add another', async ({ page }) => {
    await mockFlat(page)
    await page.goto('./')
    await expect(greeting(page)).toContainText('Our Flat')
    const menu = await openMenu(page)
    const flats = menu.getByTestId('flat-switcher')
    await expect(flats.getByRole('button', { name: 'Our Flat, current flat' })).toHaveAttribute('aria-current', 'true')
    await expect(flats.getByRole('link', { name: 'Add or join a flat' })).toBeVisible()
  })

  test('with two flats and no choice yet, you pick one; it is remembered for this account only', async ({ page }) => {
    await mockFlat(page)
    await addFlatB(page)
    await page.goto('./tasks')
    await expect(page).toHaveURL(/\/flats\?next=%2Ftasks$/)
    await expect(page.getByRole('heading', { name: 'Which flat?' })).toBeVisible()
    await page.getByRole('button', { name: /Harbour Street/ }).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await page.goto('./')
    await expect(greeting(page)).toContainText('Harbour Street')
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('flatquest.active'))))
    expect(stored).toEqual({ [accountKey]: hidB })
  })

  test('the old device-wide choice is migrated once, and only if it names one of your flats', async ({ page }) => {
    await mockFlat(page)
    await addFlatB(page)
    await page.addInitScript((id) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('flatquest.activeHousehold', id); sessionStorage.setItem('seeded', '1') } }, hidB)
    await page.goto('./')
    await expect(greeting(page)).toContainText('Harbour Street')
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('flatquest.active'))))
    expect(stored).toEqual({ [accountKey]: hidB })
  })

  test('another account’s choice on the same device is ignored', async ({ page }) => {
    await mockFlat(page)
    await addFlatB(page)
    await page.addInitScript((id) => {
      localStorage.setItem('flatquest.activeHousehold.99999999-9999-4999-8999-999999999999', id)
      localStorage.setItem('flatquest.activeHousehold', '12121212-1212-4212-8212-121212121212')
    }, hidB)
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Which flat?' })).toBeVisible()
  })

  test('switching opens the other flat’s Home; Back returns to where you were in the first flat', async ({ page }) => {
    const a = await mockFlat(page)
    a.prefs = { accent: 'coral', greeting_name: null, motion: 'balanced', home_layout: [] }
    await addFlatB(page)
    await prefer(page, hid)
    await page.goto('./rooms')
    const kitchenA = page.getByRole('link', { name: /^Kitchen: \d of 4 ready/ })
    await expect(kitchenA).toBeVisible()
    const menu = await openMenu(page)
    await menu.getByRole('button', { name: 'Switch to Harbour Street' }).click()
    await expect(page).toHaveURL(/\/Flat-Quest\/?$/)
    await expect(greeting(page)).toContainText('Harbour Street')
    // Personal settings follow the person; the flat's records don't.
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'coral')
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Rooms' }).click()
    await expect(page.getByRole('link', { name: /^Kitchen: \d of 2 ready/ })).toBeVisible()
    await expect(kitchenA).toHaveCount(0)
    await page.goBack()
    await page.goBack()
    // Back in Flat A, exactly where we were.
    await expect(page).toHaveURL(/\/rooms$/)
    await expect(kitchenA).toBeVisible()
    await page.goto('./')
    await expect(greeting(page)).toContainText('Our Flat')
  })

  test('an unsaved draft asks before switching', async ({ page }) => {
    await mockFlat(page)
    await addFlatB(page)
    await prefer(page, hid)
    await page.goto('./settings')
    await page.getByLabel('Flat name').fill('Our Flat (renamed)')
    let menu = await openMenu(page)
    await menu.getByRole('button', { name: 'Switch to Harbour Street' }).click()
    const confirm = page.getByRole('dialog', { name: 'Switch to Harbour Street?' })
    await confirm.getByRole('button', { name: 'Stay here' }).click()
    await expect(page.getByLabel('Flat name')).toHaveValue('Our Flat (renamed)')
    menu = await openMenu(page)
    await menu.getByRole('button', { name: 'Switch to Harbour Street' }).click()
    await page.getByRole('dialog', { name: 'Switch to Harbour Street?' }).getByRole('button', { name: 'Discard and switch' }).click()
    await expect(greeting(page)).toContainText('Harbour Street')
  })

  test('an invite to a flat you are already in opens exactly that flat', async ({ page }) => {
    await mockFlat(page)
    const b = await addFlatB(page)
    b.invites.set('harbour-street-invite-code-0001', hidB)
    await prefer(page, hid)
    await page.goto('./join?code=harbour-street-invite-code-0001')
    await page.getByRole('button', { name: /already in/ }).click()
    await expect(greeting(page)).toContainText('Harbour Street')
  })

  test('joining a new flat by invite opens it', async ({ page }) => {
    await mockFlat(page)
    const b = await addFlatB(page, { member: false })
    b.invites.set('harbour-street-invite-code-0001', hidB)
    await page.goto('./join?code=harbour-street-invite-code-0001')
    await page.getByRole('button', { name: 'Join the flat' }).click()
    await expect(greeting(page)).toContainText('Harbour Street')
  })

  test('a link naming a flat opens that flat; an unknown or malformed one reveals nothing', async ({ page }) => {
    const a = await mockFlat(page)
    const b = await addFlatB(page)
    b.tasks.push(makeTask({ title: 'Return the Harbour Street keys', household_id: hidB }))
    a.tasks.push(makeTask({ title: 'Assemble the TV cabinet' }))
    await prefer(page, hid)
    await page.goto(`./tasks?flat=${hidB}`)
    await expect(page.getByText('Return the Harbour Street keys')).toBeVisible()
    await expect(page.getByText('Assemble the TV cabinet')).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('Return the Harbour Street keys')).toBeVisible()
    for (const bad of ['12121212-1212-4212-8212-121212121212', 'not-a-flat']) {
      await page.goto(`./tasks?flat=${bad}`)
      const gone = page.getByTestId('flat-unavailable')
      await expect(gone).toContainText('This flat isn’t available')
      await expect(gone).not.toContainText('Harbour')
      await expect(page.getByText('Return the Harbour Street keys')).toHaveCount(0)
    }
    await page.getByRole('link', { name: 'Go to your flat' }).click()
    await expect(greeting(page)).toBeVisible()
  })

  test('a qualified link survives signing in', async ({ page }) => {
    await mockFlat(page)
    await addFlatB(page)
    // Registered after the fixture's session script, so the first visit is signed out.
    await page.addInitScript(() => { if (!sessionStorage.getItem('signed-out-once')) { sessionStorage.setItem('signed-out-once', '1'); localStorage.removeItem('sb-ivnovvdpkxrqsmsiqhid-auth-token') } })
    await page.goto(`./tasks?flat=${hidB}`)
    await expect(page).toHaveURL(/\/sign-in\?next=/)
    const next = new URL(page.url()).searchParams.get('next')
    expect(next).toBe(`/tasks?flat=${hidB}`)
    // Signing in returns to `next` (the session is restored by the fixture on the next load).
    await page.goto(`.${next}`)
    await expect(page.getByRole('heading', { name: 'Things to do', level: 1 })).toBeVisible()
    await page.goto('./')
    await expect(greeting(page)).toContainText('Harbour Street')
  })

  test('losing access to the open flat moves you to your other flat and says why', async ({ page }) => {
    await mockFlat(page)
    const b = await addFlatB(page)
    await prefer(page, hidB)
    await page.goto('./')
    await expect(greeting(page)).toContainText('Harbour Street')
    b.member = false
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.getByText('You no longer have access to Harbour Street.')).toBeVisible()
    await expect(greeting(page)).toContainText('Our Flat')
    await page.goto(`./?flat=${hidB}`)
    await expect(page.getByTestId('flat-unavailable')).toBeVisible()
  })

  test('late answers from the previous flat never show up in the next one', async ({ page }) => {
    const a = await mockFlat(page)
    a.tasks.push(makeTask({ title: 'Flat A task' }))
    const b = await addFlatB(page)
    b.tasks.push(makeTask({ title: 'Flat B secret task', household_id: hidB }))
    b.notifications.push({ id: 901, event_id: 900, household_id: hidB, recipient_id: uid, reason: 'assigned', category: 'personal', read_at: null, created_at: '2026-11-02T00:00:00.000Z' })
    await prefer(page, hid)
    await page.goto('./')
    await expect(page.getByText('Flat A task')).toBeVisible()
    let release!: () => void
    b.hold = new Promise<void>((r) => { release = r })
    const menu = await openMenu(page)
    await menu.getByRole('button', { name: 'Switch to Harbour Street' }).click()
    // Flat B is still loading; go back to Flat A before its answers arrive.
    await page.goBack()
    await expect(page.getByText('Flat A task')).toBeVisible()
    release()
    b.hold = null
    await page.waitForTimeout(800)
    await expect(page.getByText('Flat A task')).toBeVisible()
    await expect(page.getByText('Flat B secret task')).toHaveCount(0)
    await expect(page.getByTestId('notification-bell')).not.toContainText('1')
    await expect(greeting(page)).toContainText('Our Flat')
  })

  test('a new account starts with the create-or-join choice; creating opens the new flat', async ({ page }) => {
    await mockFlat(page)
    await page.route('**/rest/v1/household_members?*', (route) => route.request().url().includes('user_id=') ? route.fulfill({ json: [] }) : route.fallback())
    await page.goto('./')
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(page.getByRole('button', { name: /Set up our flat/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /I have an invite link/ })).toBeVisible()
  })

  test('the new-flat form suggests a time zone, editable before creating', async ({ page }) => {
    await mockFlat(page)
    await page.goto('./welcome?add=1')
    await expect(page.getByRole('heading', { name: /another flat/ })).toBeVisible()
    await page.getByRole('button', { name: /Set up our flat/ }).click()
    const zone = page.getByLabel('Time zone')
    await expect(zone).toBeVisible()
    await zone.selectOption('Australia/Sydney')
    await expect(zone).toHaveValue('Australia/Sydney')
  })
})

test.describe('the shared week', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  async function week(page: Page) {
    const a = await mockFlat(page, false, { flatmates: true })
    const today = aucklandDate()
    const mon = monday(today)
    a.items[0]!.status = 'ordered'
    a.items[2]!.status = 'ready_to_collect'
    a.tasks.push(
      makeTask({ title: 'Book the carpet clean', due_on: aucklandDateFrom(mon, 6), assignee_id: madi }),
      makeTask({ title: 'Already done', due_on: aucklandDateFrom(mon, 2), status: 'done', completed_at: '2026-11-11T00:00:00.000Z' }),
      makeTask({ title: 'Archived', due_on: aucklandDateFrom(mon, 2), archived_at: '2026-11-11T00:00:00.000Z' }),
      makeTask({ title: 'Next week task', due_on: aucklandDateFrom(mon, 8) }),
    )
    a.purchases.push(
      { item_id: kettle, household_id: hid, delivery_method: 'delivery', expected_on: aucklandDateFrom(mon, 1), arrived_on: null, updated_at: '2026-11-10T00:00:00.000Z' },
      { item_id: a.items[2]!.id, household_id: hid, delivery_method: 'delivery', expected_on: aucklandDateFrom(mon, 1), arrived_on: null, updated_at: '2026-11-10T00:00:00.000Z' },
    )
    a.coordinators.push({ item_id: kettle, user_id: madi })
    a.appointments.push(
      makeAppointment({ title: 'Property inspection', scheduled_on: aucklandDateFrom(mon, 1), all_day: false,
        starts_at: zonedFixtureInstant(aucklandDateFrom(mon, 1), '10:00', 'Pacific/Auckland'), ends_at: zonedFixtureInstant(aucklandDateFrom(mon, 1), '11:00', 'Pacific/Auckland'),
        needs_cover: true, created_by: madi }),
      makeAppointment({ title: 'Bin day', scheduled_on: aucklandDateFrom(mon, 1) }),
      makeAppointment({ title: 'Cancelled viewing', scheduled_on: aucklandDateFrom(mon, 1), cancelled_at: '2026-11-11T00:00:00.000Z', cancelled_by: uid }),
    )
    return { a, mon, today }
  }

  test('one agenda: tasks, deliveries, pickups and appointments, labelled and ordered', async ({ page }) => {
    const { mon } = await week(page)
    await page.goto('./calendar')
    await expect(page.getByRole('heading', { name: 'This week', level: 1 })).toBeVisible()
    await expect(page.getByTestId('flat-zone')).toHaveText('Pacific/Auckland')
    const tuesday = page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 1)}"]`)
    const kinds = await tuesday.getByTestId('calendar-entry').evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.kind}:${e.textContent}`))
    // Date-only first (appointment, delivery, pickup by kind), then timed.
    expect(kinds.map((k) => k.split(':')[0])).toEqual(['appointment', 'delivery', 'pickup', 'appointment'])
    expect(kinds[0]).toContain('Bin day')
    expect(kinds[1]).toContain('Kettle')
    expect(kinds[1]).toContain('Sorted by Madi')
    expect(kinds[2]).toContain('Toaster')
    expect(kinds[3]).toContain('10:00 am')
    expect(kinds[3]).toContain('Needs someone home')
    await expect(page.getByText('Cancelled viewing')).toHaveCount(0)
    await expect(page.getByText('Already done')).toHaveCount(0)
    await expect(page.getByText('Archived')).toHaveCount(0)
    await expect(page.getByText('Next week task')).toHaveCount(0)
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 6)}"]`)).toContainText('Book the carpet clean')
    await expect(page.getByText('1 appointment needs someone home')).toBeVisible()
  })

  test('entries open their own records; Back returns to the week', async ({ page }) => {
    await week(page)
    await page.goto('./calendar')
    await page.getByTestId('calendar-entry').filter({ hasText: 'Kettle' }).click()
    await expect(page).toHaveURL(new RegExp(`/rooms/${rid}`))
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/calendar/)
    await page.getByTestId('calendar-entry').filter({ hasText: 'Book the carpet clean' }).click()
    await expect(page).toHaveURL(/\/tasks/)
    await expect(page.getByRole('dialog', { name: /task/i }).first()).toBeVisible()
  })

  test('week navigation is kept in the URL and Back steps through it', async ({ page }) => {
    const { mon } = await week(page)
    await page.goto('./calendar')
    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(page).toHaveURL(new RegExp(`week=${aucklandDateFrom(mon, 7)}`))
    await expect(page.getByRole('heading', { name: 'Next week', level: 1 })).toBeVisible()
    await expect(page.getByText('Next week task')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Next week task')).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'This week', level: 1 })).toBeVisible()
    await page.goto(`./calendar?week=${aucklandDateFrom(mon, 21)}`)
    await expect(page.getByText('Nothing planned').first()).toBeVisible()
    await page.getByRole('button', { name: 'This week' }).click()
    await expect(page.getByRole('heading', { name: 'This week', level: 1 })).toBeVisible()
  })

  test('if one source fails, the rest of the week is still shown', async ({ page }) => {
    const { a } = await week(page)
    a.appointmentsDown = true
    await page.goto('./calendar')
    await expect(page.getByTestId('source-error-appointments')).toContainText('Appointments couldn’t load')
    await expect(page.getByText('Book the carpet clean')).toBeVisible()
    a.appointmentsDown = false
    await page.getByTestId('source-error-appointments').getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Property inspection')).toBeVisible()
    await expect(page.getByTestId('source-error-appointments')).toHaveCount(0)
  })

  test('add an inspection that needs someone home, volunteer, then step back', async ({ page }) => {
    const { a, today } = await week(page)
    await page.goto('./calendar')
    await page.getByRole('button', { name: 'Add an appointment' }).click()
    const sheet = page.getByRole('dialog', { name: 'New appointment' })
    await sheet.getByLabel('What’s happening?').fill('Electrician visit')
    await expect(sheet.getByLabel('Day', { exact: true })).toHaveValue(today)
    await sheet.getByLabel('Starts').fill('13:30')
    await sheet.getByLabel('Ends').fill('15:00')
    await expect(sheet.getByTestId('zone-hint')).toContainText('Pacific/Auckland')
    await sheet.getByRole('switch', { name: 'Needs someone home' }).click()
    await sheet.getByRole('button', { name: 'Add to calendar' }).click()
    await expect(sheet).toBeHidden()
    expect(a.appointments.filter((x) => x.title === 'Electrician visit')).toHaveLength(1)
    const row = page.getByTestId('calendar-entry').filter({ hasText: 'Electrician visit' })
    await expect(row).toContainText('1:30 pm')
    await expect(row).toContainText('Needs someone home')
    await row.click()
    const details = page.getByRole('dialog', { name: 'Appointment' })
    await details.getByRole('button', { name: 'I can be home' }).click()
    await expect(details.getByTestId('coverage')).toContainText('You’ll be home for this')
    await details.getByRole('button', { name: 'Release coverage' }).click()
    await expect(details.getByTestId('coverage')).toContainText('Needs someone home')
  })

  test('moving a covered appointment asks first, then reopens coverage', async ({ page }) => {
    const { a, mon } = await week(page)
    const insp = a.appointments[0]!
    Object.assign(insp, { created_by: uid, host_id: madi, revision: 2 })
    await page.goto('./calendar')
    await page.getByTestId('calendar-entry').filter({ hasText: 'Property inspection' }).click()
    const sheet = page.getByRole('dialog', { name: 'Appointment' })
    await expect(sheet.getByTestId('coverage')).toContainText('Madi will be home')
    await sheet.getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit appointment' })
    await edit.getByLabel('Notes (optional)').fill('Tidy the lounge')
    await edit.getByLabel('Day', { exact: true }).fill(aucklandDateFrom(mon, 3))
    await edit.getByRole('button', { name: 'Save changes' }).click()
    const confirm = page.getByRole('dialog', { name: 'Reopen coverage?' })
    await expect(confirm).toContainText('Madi said they’d be home')
    await confirm.getByRole('button', { name: 'Move it' }).click()
    await expect(page.getByRole('dialog', { name: 'Appointment' }).getByTestId('coverage')).toContainText('Needs someone home')
    expect(insp.host_id).toBeNull()
    await page.keyboard.press('Escape')
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 3)}"]`)).toContainText('Property inspection')
  })

  test('a title-only edit keeps the volunteer', async ({ page }) => {
    const { a } = await week(page)
    const insp = a.appointments[0]!
    Object.assign(insp, { created_by: uid, host_id: madi })
    await page.goto('./calendar')
    await page.getByTestId('calendar-entry').filter({ hasText: 'Property inspection' }).click()
    await page.getByRole('dialog', { name: 'Appointment' }).getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit appointment' })
    await edit.getByLabel('What’s happening?').fill('Routine inspection')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog', { name: 'Appointment' }).getByTestId('coverage')).toContainText('Madi will be home')
    expect(insp.host_id).toBe(madi)
  })

  test('a stale edit is never saved silently: review, then choose', async ({ page }) => {
    const { a } = await week(page)
    const insp = a.appointments[0]!
    Object.assign(insp, { created_by: uid })
    await page.goto('./calendar')
    await page.getByTestId('calendar-entry').filter({ hasText: 'Property inspection' }).click()
    await page.getByRole('dialog', { name: 'Appointment' }).getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit appointment' })
    await edit.getByLabel('What’s happening?').fill('My title')
    // Meanwhile a flatmate renames it.
    Object.assign(insp, { title: 'Their title', revision: insp.revision + 1 })
    await edit.getByRole('button', { name: 'Save changes' }).click()
    const conflict = edit.getByTestId('appointment-conflict')
    await expect(conflict).toContainText('Someone changed this while you were editing')
    await expect(conflict).toContainText('Their title')
    await expect(edit.getByLabel('What’s happening?')).toHaveValue('My title')
    await conflict.getByRole('button', { name: 'Keep my changes' }).click()
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog', { name: 'Appointment' })).toContainText('My title')
    expect(insp.title).toBe('My title')
  })

  test('a create whose answer was lost is confirmed from the server, never duplicated', async ({ page }) => {
    const { a } = await week(page)
    a.failAppointmentSave = 'lost'
    await page.goto('./calendar')
    await page.getByRole('button', { name: 'Add an appointment' }).click()
    const sheet = page.getByRole('dialog', { name: 'New appointment' })
    await sheet.getByLabel('What’s happening?').fill('Meter reading')
    await sheet.getByRole('switch', { name: 'All day' }).click()
    await sheet.getByRole('button', { name: 'Add to calendar' }).click()
    await expect(sheet).toBeHidden()
    expect(a.appointments.filter((x) => x.title === 'Meter reading')).toHaveLength(1)
    await expect(page.getByTestId('calendar-entry').filter({ hasText: 'Meter reading' })).toHaveCount(1)
  })

  test('a failed create keeps the draft and retrying uses the same draft id', async ({ page }) => {
    const { a } = await week(page)
    a.failAppointmentSave = 'network'
    await page.goto('./calendar')
    await page.getByRole('button', { name: 'Add an appointment' }).click()
    const sheet = page.getByRole('dialog', { name: 'New appointment' })
    await sheet.getByLabel('What’s happening?').fill('Couch pickup')
    await sheet.getByRole('button', { name: 'Add to calendar' }).click()
    await expect(sheet.getByRole('alert')).toContainText('Your changes are still here')
    await expect(sheet.getByLabel('What’s happening?')).toHaveValue('Couch pickup')
    a.failAppointmentSave = null
    await sheet.getByRole('button', { name: 'Add to calendar' }).click()
    await expect(sheet).toBeHidden()
    const ids = new Set(a.appointmentSaves.map((s) => s.p_id))
    expect(ids.size).toBe(1)
    expect(a.appointments.filter((x) => x.title === 'Couch pickup')).toHaveLength(1)
  })

  test('times that don’t exist when the clocks change are refused with a clear correction', async ({ page }) => {
    await week(page)
    await page.goto('./calendar')
    await page.getByRole('button', { name: 'Add an appointment' }).click()
    const sheet = page.getByRole('dialog', { name: 'New appointment' })
    await sheet.getByLabel('What’s happening?').fill('Spring forward')
    await sheet.getByLabel('Day', { exact: true }).fill('2026-09-27')
    await sheet.getByLabel('Starts').fill('02:30')
    await sheet.getByLabel('Ends').fill('04:00')
    await sheet.getByRole('button', { name: 'Add to calendar' }).click()
    await expect(sheet.getByRole('alert')).toContainText('doesn’t exist that day')
    await sheet.getByLabel('Ends').fill('02:00')
    await sheet.getByLabel('Starts').fill('03:00')
    await sheet.getByRole('button', { name: 'Add to calendar' }).click()
    await expect(sheet.getByRole('alert')).toContainText('end time must be after the start')
  })

  test('cancelling removes it from the week', async ({ page }) => {
    const { a } = await week(page)
    Object.assign(a.appointments[1]!, { created_by: uid })
    await page.goto('./calendar')
    await page.getByTestId('calendar-entry').filter({ hasText: 'Bin day' }).click()
    await page.getByRole('dialog', { name: 'Appointment' }).getByRole('button', { name: 'Cancel appointment' }).click()
    await page.getByRole('dialog', { name: 'Cancel this appointment?' }).getByRole('button', { name: 'Cancel appointment' }).click()
    await expect(page.getByTestId('calendar-entry').filter({ hasText: 'Bin day' })).toHaveCount(0)
    expect(a.appointments[1]!.cancelled_at).not.toBeNull()
  })

  test('only the person who added it (or the owner) can edit; anyone can volunteer', async ({ page }) => {
    const { a } = await week(page)
    await page.goto('./calendar')
    // Alex owns Flat A in the fixture, so switch the owner role away for this check.
    await page.route('**/rest/v1/household_members?*', (route) => route.request().url().includes('user_id=')
      ? route.fallback()
      : route.fulfill({ json: [{ household_id: hid, user_id: uid, role: 'member', joined_at: '2026-11-01T00:00:00.000Z' }, { household_id: hid, user_id: madi, role: 'owner', joined_at: '2026-11-01T00:00:00.000Z' }] }))
    await page.reload()
    await page.getByTestId('calendar-entry').filter({ hasText: 'Property inspection' }).click()
    const sheet = page.getByRole('dialog', { name: 'Appointment' })
    await expect(sheet.getByRole('button', { name: 'I can be home' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: 'Cancel appointment' })).toHaveCount(0)
    expect(a.appointments[0]!.created_by).toBe(madi)
  })

  test('a shared appointment link opens it in its flat', async ({ page }) => {
    const { a, mon } = await week(page)
    await addFlatB(page)
    await prefer(page, hidB)
    await page.goto(`./calendar?week=${mon}&appointment=${a.appointments[0]!.id}&flat=${hid}`)
    await expect(page.getByRole('dialog', { name: 'Appointment' })).toContainText('Property inspection')
    await expect(page.getByTestId('flat-zone')).toHaveText('Pacific/Auckland')
  })

  test('Home keeps Furnishing progress first and links to the week', async ({ page }) => {
    await week(page)
    await page.goto('./')
    await expect(page.locator('[data-section]').first()).toHaveAttribute('data-section', 'progress')
    await page.getByTestId('home-calendar-link').click()
    await expect(page).toHaveURL(/\/calendar$/)
    await expect(page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link')).toHaveCount(4)
  })

  test('an empty week offers to add something', async ({ page }) => {
    await mockFlat(page)
    await page.goto('./calendar')
    await expect(page.getByText('A quiet week')).toBeVisible()
    await page.getByRole('button', { name: 'Add an appointment' }).last().click()
    await expect(page.getByRole('dialog', { name: 'New appointment' })).toBeVisible()
  })

  test('Things to do edits move the entry on the week', async ({ page }) => {
    const { a, mon } = await week(page)
    await page.goto('./calendar')
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 6)}"]`)).toContainText('Book the carpet clean')
    a.tasks.find((t) => t.title === 'Book the carpet clean')!.due_on = aucklandDateFrom(mon, 4)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 4)}"]`)).toContainText('Book the carpet clean')
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 6)}"]`)).not.toContainText('Book the carpet clean')
  })
})

test.describe('the flat’s time zone, not the device’s', () => {
  test.use({ timezoneId: 'America/Los_Angeles', viewport: { width: 390, height: 844 } })

  test('a device in Los Angeles sees the Auckland flat’s week and times', async ({ page }) => {
    const a = await mockFlat(page)
    const mon = monday()
    a.appointments.push(makeAppointment({ title: 'Inspection', scheduled_on: aucklandDateFrom(mon, 2), all_day: false,
      starts_at: zonedFixtureInstant(aucklandDateFrom(mon, 2), '10:00', 'Pacific/Auckland'), ends_at: zonedFixtureInstant(aucklandDateFrom(mon, 2), '11:00', 'Pacific/Auckland') }))
    a.tasks.push(makeTask({ title: 'Friday task', due_on: aucklandDateFrom(mon, 4) }))
    await page.goto('./calendar')
    await expect(page.getByRole('heading', { name: 'This week', level: 1 })).toBeVisible()
    const insp = page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 2)}"]`)
    await expect(insp).toContainText('10:00 am')
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${aucklandDateFrom(mon, 4)}"]`)).toContainText('Friday task')
    const today = page.locator('[data-testid="calendar-day"]').filter({ hasText: 'Today' })
    await expect(today).toHaveAttribute('data-date', aucklandDate())
  })

  test('the owner changes the flat’s zone; booked moments stay, local times follow', async ({ page }) => {
    const a = await mockFlat(page)
    const mon = monday()
    a.appointments.push(makeAppointment({ title: 'Inspection', scheduled_on: aucklandDateFrom(mon, 2), all_day: false,
      starts_at: zonedFixtureInstant(aucklandDateFrom(mon, 2), '10:00', 'Pacific/Auckland'), ends_at: zonedFixtureInstant(aucklandDateFrom(mon, 2), '11:00', 'Pacific/Auckland') }))
    const before = a.appointments[0]!.starts_at
    await page.goto('./settings')
    await page.getByLabel('Time zone').selectOption('Australia/Perth')
    await expect(page.getByText('Time zone set to Australia/Perth')).toBeVisible()
    expect(a.settings.timezone).toBe('Australia/Perth')
    await page.goto(`./calendar?week=${mon}`)
    await expect(page.getByTestId('flat-zone')).toHaveText('Australia/Perth')
    await expect(page.getByTestId('calendar-entry').filter({ hasText: 'Inspection' })).toContainText(/[5-7]:00 am/)
    expect(a.appointments[0]!.starts_at).toBe(before)
  })
})

test.describe('small phone', () => {
  test.use({ viewport: { width: 320, height: 568 } })

  test('week navigation, entries and the appointment form fit at 320px', async ({ page }) => {
    const a = await mockFlat(page)
    const mon = monday()
    a.appointments.push(makeAppointment({ title: 'A very long appointment title that keeps going to test wrapping', scheduled_on: aucklandDateFrom(mon, 1), needs_cover: true }))
    a.essentials.push(makeEssential({ name: 'Toilet paper' }))
    await page.goto('./calendar')
    await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible()
    for (const name of ['Previous week', 'Next week', 'Add an appointment']) {
      const box = await page.getByRole('button', { name }).first().boundingBox()
      expect(box!.width >= 44 && box!.height >= 44, name).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await page.getByRole('button', { name: 'Add an appointment' }).first().click()
    const sheet = page.getByRole('dialog', { name: 'New appointment' })
    await sheet.getByLabel('What’s happening?').fill('Inspection')
    await expect(sheet.getByRole('button', { name: 'Add to calendar' })).toBeInViewport({ ratio: 0.1 }).catch(async () => {
      await sheet.getByRole('button', { name: 'Add to calendar' }).scrollIntoViewIfNeeded()
    })
    await sheet.getByRole('button', { name: 'Add to calendar' }).scrollIntoViewIfNeeded()
    await expect(sheet.getByRole('button', { name: 'Add to calendar' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  })
})
