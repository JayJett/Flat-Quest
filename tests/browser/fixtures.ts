import type { Page, Route } from '@playwright/test'
import type { Visual, Transformation } from '../../src/visual/types'

export const uid = '11111111-1111-4111-8111-111111111111'
export const hid = '22222222-2222-4222-8222-222222222222'
export const rid = '33333333-3333-4333-8333-333333333333'
/** A second flatmate. Her actions are simulated by changing the fixture state "on the server". */
export const madi = '66666666-6666-4666-8666-666666666666'
const now = '2026-11-11T01:00:00.000Z'
const itemId = (i: number) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`
export const kettle = itemId(0)
export const toaster = itemId(2)

/** 1×1 PNG served for every signed photo URL. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

type Row = Record<string, unknown>
export interface OptionRow extends Row { id: string; item_id: string; name: string; is_selected: boolean; photo_path: string | null; updated_at: string; created_by: string }
export interface PreferenceRow extends Row { item_id: string; user_id: string; option_id: string }
export interface CoordinatorRow extends Row { item_id: string; user_id: string }
export interface PurchaseRow extends Row { item_id: string; updated_at: string; arrived_on: string | null }

export interface EventRow extends Row { id: number; type: string; actor_id: string | null; actor_name: string | null; in_timeline: boolean; created_at: string; data: Row }
export interface NoticeRow extends Row { id: number; event_id: number; recipient_id: string; reason: string; category: string; read_at: string | null; created_at: string }
export interface CommentFixture extends Row { id: string; item_id: string | null; option_id: string | null; idea_id: string | null; parent_id: string | null; author_id: string | null; body: string; mentions: string[]; deleted_at: string | null; edited_at: string | null; created_at: string }

export interface EssentialFixture extends Row { id: string; name: string; status: 'needed' | 'getting' | 'stocked'; claimed_by: string | null; archived_at: string | null; updated_at: string }
export interface TaskFixture extends Row { id: string; title: string; status: 'todo' | 'doing' | 'done'; assignee_id: string | null; due_on: string | null; archived_at: string | null; updated_at: string; completed_at: string | null }

export interface AppointmentFixture extends Row {
  id: string; household_id: string; title: string; notes: string | null; room_id: string | null; all_day: boolean; scheduled_on: string
  starts_at: string | null; ends_at: string | null; needs_cover: boolean; host_id: string | null; created_by: string | null
  cancelled_at: string | null; cancelled_by: string | null; revision: number; created_at: string; updated_at: string
}
export function makeAppointment(patch: Partial<AppointmentFixture> & { title: string; scheduled_on: string }): AppointmentFixture {
  const at = stamp()
  return {
    id: `a0a0a0a0-a0a0-4a0a-8a0a-${String(++tick).padStart(12, '0')}`, household_id: hid, notes: null, room_id: null, all_day: true, starts_at: null, ends_at: null,
    needs_cover: false, host_id: null, created_by: uid, cancelled_at: null, cancelled_by: null, revision: 1, created_at: at, updated_at: at, ...patch,
  }
}

/** Local date + time in a zone → ISO instant (the fixture's stand-in for the server's conversion). */
export function zonedFixtureInstant(date: string, time: string, zone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  const naive = Date.UTC(y, m - 1, d, hh, mm)
  const offset = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!) - t
  }
  const guess = naive - offset(naive)
  return new Date(naive - offset(guess)).toISOString()
}

export function makeEssential(patch: Partial<EssentialFixture> & { name: string }): EssentialFixture {
  const at = stamp()
  return {
    id: `e5e5e5e5-e5e5-4e5e-8e5e-${String(++tick).padStart(12, '0')}`, household_id: hid, name_key: patch.name.toLowerCase(), category: null, note: null, status: 'needed',
    claimed_by: null, needed_at: at, needed_by: uid, restocked_at: null, restocked_by: null, archived_at: null, created_by: uid, created_at: at, updated_at: at, ...patch,
  }
}
export function makeTask(patch: Partial<TaskFixture> & { title: string }): TaskFixture {
  const at = stamp()
  return {
    id: `7a7a7a7a-7a7a-47a7-87a7-${String(++tick).padStart(12, '0')}`, household_id: hid, notes: null, room_id: null, assignee_id: null, due_on: null, status: 'todo',
    completed_at: null, completed_by: null, archived_at: null, created_by: uid, created_at: at, updated_at: at, ...patch,
  }
}

let tick = 0
/** Strictly increasing timestamps, so "has this changed?" checks behave like the database. */
const stamp = () => new Date(Date.parse('2026-11-11T02:00:00.000Z') + ++tick * 1000).toISOString()

export function makeOption(patch: Partial<OptionRow> & { name: string; item_id: string }): OptionRow {
  return {
    id: `77777777-7777-4777-8777-${String(++tick).padStart(12, '0')}`, household_id: hid, retailer: null, price: null, url: null, photo_path: null, notes: null,
    width_cm: null, depth_cm: null, height_cm: null, is_selected: false, selected_at: null, selected_by: null, created_by: uid, created_at: stamp(), updated_at: stamp(), ...patch,
  }
}

export async function mockFlat(page: Page, tour = false, opts: { flatmates?: boolean } = {}) {
  page.on('pageerror', (e) => console.log('BROWSER ERROR', e.message))
  const profile = { id: uid, display_name: 'Alex', avatar_path: null, accent_color: '#3657e8', icon: 'user', preferences: {}, tour_completed_at: tour ? null : now, created_at: now, updated_at: now }
  const madiProfile = { ...profile, id: madi, display_name: 'Madi', accent_color: '#f0478c', tour_completed_at: now }
  const room = { id: rid, household_id: hid, name: 'Kitchen', icon: 'cooking-pot', color: 'green', sort_order: 0, import_key: null, width_cm: null as number | null, length_cm: null as number | null, height_cm: null as number | null, measurement_notes: null as string | null, description: null as string | null, cover_visual_id: null as string | null, created_at: now, updated_at: now }
  const items = Array.from({ length: 4 }, (_, i) => ({ id: itemId(i), household_id: hid, room_id: rid, name: ['Kettle', 'Fridge', 'Toaster', 'Plates'][i], description: null, priority: 'must_have', status: i === 1 ? 'provided' : 'to_decide', ownership: 'to_decide', owner_user_id: null, is_complete: false, completed_at: null as string | null, completed_by: null as string | null, estimated_price: null, actual_price: null as number | null, shopping_url: null, notes: null, sort_order: i, import_key: null, needs_assignees: false, created_by: uid, created_at: now, updated_at: now }))
  const state = {
    items, room, roomPatches: [] as Record<string, unknown>[], failRoomSave: false, failSave: false, conflict: false, failAssign: false, writes: 0, creates: 0,
    assignments: [] as { item_id: string; household_id: string; user_id: string; created_at: string }[],
    // Phase 4
    options: [] as OptionRow[], preferences: [] as PreferenceRow[], coordinators: [] as CoordinatorRow[], purchases: [] as PurchaseRow[],
    files: [] as string[], removedFiles: [] as string[],
    visuals: [] as Visual[], transformations: [] as Transformation[], reservations: [] as string[], failVisualSave: false,
    failOptionSave: false, failPreference: false, failPurchase: false, failUpload: false, shoppingDown: false,
    optionWrites: 0, purchaseSaves: 0, claimAttempts: 0,
    // Phase 6
    events: [{ id: 1, household_id: hid, type: 'history_started', actor_id: null, actor_name: null, room_id: null, item_id: null, option_id: null, idea_id: null, comment_id: null, transformation_id: null, subject_id: null, data: {}, in_timeline: true, created_at: '2026-11-10T00:00:00.000Z' }] as EventRow[],
    notifications: [] as NoticeRow[], comments: [] as CommentFixture[],
    failComment: false, failMarkRead: false, rpcCalls: [] as { name: string; body: Row }[], memberLimit: 4,
    // Phase 7
    essentials: [] as EssentialFixture[], restocks: [] as Row[], tasks: [] as TaskFixture[],
    prefs: null as null | { accent: string; greeting_name: string | null; motion: string; home_layout: unknown },
    failEssential: false, failTask: false, failPrefs: false, essentialCalls: [] as Row[],
    // Phase 10
    settings: { timezone: 'Pacific/Auckland' } as Record<string, unknown>, failZone: false,
    appointments: [] as AppointmentFixture[], appointmentSaves: [] as Row[], appointmentsDown: false,
    failAppointmentSave: null as null | 'network' | 'error' | 'lost',
  }
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'alex@example.invalid', app_metadata: {}, user_metadata: {}, created_at: now }
  await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-ivnovvdpkxrqsmsiqhid-auth-token', JSON.stringify({ access_token: 'mock-token', refresh_token: 'mock-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }))
  }, { user })
  // No browser test can contact the real project's HTTP or WebSocket endpoints.
  await page.routeWebSocket('**/*.supabase.co/**', (socket) => socket.close())
  await page.route('**/*.supabase.co/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const table = url.pathname.split('/').at(-1)
    const method = request.method()
    const q = (name: string) => { const v = url.searchParams.get(name); return v?.startsWith('eq.') ? v.slice(3) : undefined }
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(data) })
    // PostgREST returns one object (or nothing) when the client asked for a single row.
    const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const rows = (list: unknown[]) => send(single ? (list[0] ?? null) : list)
    const dbError = (code: string, message: string, status = 400) => send({ code, message, details: null, hint: null }, status)
    if (method === 'OPTIONS') return send(null)

    // ---- Storage (private bucket: upload, sign, fetch, remove)
    if (url.pathname.startsWith('/storage/v1/')) {
      const path = decodeURIComponent(url.pathname.split('/household-media/')[1] ?? '')
      if (url.pathname.includes('/object/sign/')) {
        if (method === 'POST') return send({ signedURL: `/object/sign/household-media/${path}?token=mock` })
        return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: PIXEL })
      }
      if (method === 'DELETE') {
        const prefixes: string[] = request.postDataJSON()?.prefixes ?? []
        state.removedFiles.push(...prefixes)
        state.files = state.files.filter((f) => !prefixes.includes(f))
        return send(prefixes.map((name) => ({ name })))
      }
      if (method === 'POST') {
        if (state.failUpload) return send({ statusCode: '500', error: 'Internal', message: 'Upload unavailable' }, 500)
        if (!path.startsWith(`${hid}/products/`) && !path.startsWith(`${hid}/visual/`)) return send({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 403)
        state.files.push(path)
        return send({ Key: `household-media/${path}`, Id: 'mock' })
      }
    }

    const body = request.postDataJSON()
    if (table === 'reserve_media_upload') {
      const path = `${hid}/${body.p_kind}/88888888-8888-4888-8888-${String(++tick).padStart(12, '0')}.${body.p_ext}`
      state.reservations.push(path)
      return send({ path, thumbnail_path: body.p_kind === 'visual' ? path.replace(/\.(webp|jpg)$/, '-thumb.$1') : null })
    }
    if (table === 'room_visuals' || table === 'room_transformations') {
      const collection = table === 'room_visuals' ? state.visuals : state.transformations
      if (method === 'GET') {
        const ids = url.searchParams.get('id')
        const list = q('id') ? collection.filter(x => x.id === q('id')) : ids?.startsWith('in.') ? collection.filter(x => ids.slice(4,-1).split(',').includes(x.id)) : collection
        return rows(list.slice(0, Number(url.searchParams.get('limit') || list.length)))
      }
      if (state.failVisualSave) return dbError('500', 'Gallery save unavailable', 500)
      if (method === 'POST') {
        const row = { id: `99999999-9999-4999-8999-${String(++tick).padStart(12, '0')}`, title: null, notes: null, source_url: null, taken_on: null, photo_path: null, thumbnail_path: null, created_by: uid, created_at: stamp(), updated_at: stamp(), ...body }
        collection.push(row)
        return rows([row])
      }
      const found = collection.find(x => x.id === q('id') && (!q('updated_at') || x.updated_at === q('updated_at')))
      if (!found) return rows([])
      if (method === 'PATCH') { Object.assign(found, body, { updated_at: stamp() }); state.visuals.sort((a,b) => a.sort_order-b.sort_order); return rows([found]) }
      if (method === 'DELETE') {
        if (table === 'room_visuals') { state.visuals = state.visuals.filter(x => x.id !== found.id); state.transformations = state.transformations.filter(x => x.before_id !== found.id && x.after_id !== found.id) }
        else state.transformations = state.transformations.filter(x => x.id !== found.id)
        return rows([found])
      }
    }
    if (url.pathname === '/auth/v1/user') return send(user)
    if (url.pathname === '/auth/v1/settings') return send({ external: { google: false } })
    if (table === 'profiles') {
      if (method === 'PATCH') Object.assign(profile, body)
      if (url.searchParams.has('id') && !url.searchParams.get('id')?.startsWith('in.')) return send(profile)
      return send(opts.flatmates ? [profile, madiProfile] : [profile])
    }
    if (table === 'household_members') {
      const mine = { household_id: hid, user_id: uid, role: 'owner', joined_at: now }
      return send(opts.flatmates && !url.searchParams.has('user_id') ? [mine, { household_id: hid, user_id: madi, role: 'member', joined_at: '2026-11-11T01:30:00.000Z' }] : [mine])
    }
    if (table === 'households') {
      const flat = { id: hid, name: 'Our Flat', address: null, created_by: uid, settings: state.settings, member_limit: state.memberLimit, photo_path: null, created_at: now, updated_at: now }
      return url.searchParams.get('id')?.startsWith('in.(') ? send([flat]) : send(flat)
    }
    if (table === 'set_household_timezone') {
      if (state.failZone) return dbError('22023', 'Choose a time zone from the list')
      state.settings = { ...state.settings, timezone: body.p_zone }
      return send(body.p_zone)
    }

    // ---- Phase 10: shared appointments (mirrors save_appointment / set_appointment_cover / cancel_appointment).
    if (table === 'calendar_appointments') {
      if (state.appointmentsDown) return send({ message: 'Appointments unavailable' }, 500)
      const list = state.appointments.filter((a) => (!q('id') || a.id === q('id')) && (q('id') || !a.cancelled_at))
      return rows(list)
    }
    if (table === 'save_appointment') {
      state.appointmentSaves.push(body)
      if (state.failAppointmentSave === 'network') return route.abort('failed')
      if (state.failAppointmentSave === 'error') return send({ message: 'Appointments unavailable' }, 500)
      const zone = typeof state.settings.timezone === 'string' ? state.settings.timezone : 'Pacific/Auckland'
      const instant = (d: string, t: string) => zonedFixtureInstant(d, t, zone)
      const timed = body.p_start != null
      const fields = {
        title: String(body.p_title).trim(), notes: body.p_notes ?? null, room_id: body.p_room ?? null, all_day: !timed, scheduled_on: body.p_date,
        starts_at: timed ? instant(body.p_date, body.p_start) : null, ends_at: timed ? instant(body.p_date, body.p_end) : null, needs_cover: !!body.p_needs_cover,
      }
      const existing = state.appointments.find((a) => a.id === body.p_id)
      if (body.p_expected_revision == null) {
        if (existing) return send(existing)
        const row = { id: body.p_id, household_id: hid, ...fields, host_id: null, created_by: uid, cancelled_at: null, cancelled_by: null, revision: 1, created_at: stamp(), updated_at: stamp() }
        state.appointments.push(row)
        // The write happened, but the response never arrived.
        if (state.failAppointmentSave === 'lost') { state.failAppointmentSave = null; return route.abort('failed') }
        return send(row)
      }
      if (!existing || existing.cancelled_at) return dbError('P0002', 'That appointment was cancelled or removed', 404)
      if (existing.revision !== body.p_expected_revision) return dbError('FQ409', 'Someone changed this appointment while you were editing')
      const moved = existing.all_day !== fields.all_day || existing.starts_at !== fields.starts_at || existing.ends_at !== fields.ends_at || (fields.all_day && existing.scheduled_on !== fields.scheduled_on) || !fields.needs_cover
      Object.assign(existing, fields, { host_id: moved ? null : existing.host_id, revision: existing.revision + 1, updated_at: stamp() })
      return send(existing)
    }
    if (table === 'set_appointment_cover') {
      const a = state.appointments.find((x) => x.id === body.p_id)
      if (!a || a.cancelled_at) return dbError('P0002', 'That appointment isn’t available', 404)
      if (body.p_action === 'claim') {
        if (a.host_id === uid) return send(a)
        if (a.revision !== body.p_expected_revision) return dbError('FQ409', 'This appointment changed. Check the new time before volunteering.')
        if (a.host_id) return dbError('FQ409', 'Madi is already going to be home')
        Object.assign(a, { host_id: uid, revision: a.revision + 1, updated_at: stamp() })
      } else if (a.host_id === uid) Object.assign(a, { host_id: null, revision: a.revision + 1, updated_at: stamp() })
      return send(a)
    }
    if (table === 'cancel_appointment') {
      const a = state.appointments.find((x) => x.id === body.p_id)
      if (!a) return dbError('P0002', 'That appointment isn’t available', 404)
      if (a.revision !== body.p_expected_revision) return dbError('FQ409', 'Someone changed this appointment. Check it before cancelling.')
      Object.assign(a, { cancelled_at: stamp(), cancelled_by: uid, host_id: null, revision: a.revision + 1, updated_at: stamp() })
      return send(a)
    }
    if (table === 'rooms') {
      if (method === 'PATCH') {
        state.roomPatches.push(body)
        if (state.failRoomSave) return dbError('23514', 'Choose a photo from this room’s Visual Home', 400)
        Object.assign(room, body, { updated_at: stamp() }); return send(room)
      }
      return send([room])
    }
    if (table === 'item_assignees') return send(state.assignments)
    if (table === 'set_item_assignees') {
      if (state.failAssign) return send({ message: 'Assignment unavailable' }, 500)
      state.assignments = [...state.assignments.filter((a) => a.item_id !== body.p_item), ...body.p_users.map((id: string) => ({ item_id: body.p_item, user_id: id, household_id: hid, created_at: now }))]
      return send(null)
    }
    if (table === 'items') {
      if (method === 'GET') return send(state.items)
      state.writes++
      if (state.failSave) return send({ message: 'Save unavailable' }, 500)
      if (method === 'PATCH') {
        if (state.conflict) return send(null)
        const row = state.items.find((i) => i.id === q('id'))
        if (!row || (q('updated_at') && q('updated_at') !== row.updated_at)) return send(null)
        const was = row.is_complete
        Object.assign(row, body, { updated_at: stamp() })
        if (row.is_complete && !was) {
          row.completed_at = new Date().toISOString(); row.completed_by = uid
          // Mirrors the server trigger: a completion is recorded in the household history.
          state.events.push({ id: Math.max(0, ...state.events.map((e) => e.id)) + 1, household_id: hid, type: 'item_completed', actor_id: uid, actor_name: 'Alex', room_id: row.room_id, item_id: row.id, option_id: null, idea_id: null, comment_id: null, transformation_id: null, subject_id: null, data: { item: row.name, room: 'Kitchen' }, in_timeline: true, created_at: row.completed_at })
        }
        if (!row.is_complete) { row.completed_at = null; row.completed_by = null }
        return send(row)
      }
      if (method === 'POST') {
        state.creates++
        const row = { ...state.items[0]!, ...body, id: '55555555-5555-4555-8555-555555555555', updated_at: stamp() }
        state.items.push(row)
        return send(row)
      }
      if (method === 'DELETE') {
        const id = q('id')
        state.items = state.items.filter((i) => i.id !== id)
        state.options = state.options.filter((o) => o.item_id !== id)
        return send(null)
      }
    }

    // ---- Phase 4 tables. These mirror the database rules the access suite verifies for real.
    if (state.shoppingDown && ['product_options', 'product_preferences', 'purchase_coordinators', 'item_purchases'].includes(table ?? '')) {
      return send({ message: 'Shopping unavailable' }, 500)
    }
    if (table === 'product_options') {
      if (method === 'GET') return rows(q('item_id') ? state.options.filter((o) => o.item_id === q('item_id')) : state.options)
      state.optionWrites++
      if (state.failOptionSave) return send({ message: 'Option save unavailable' }, 500)
      if (method === 'POST') {
        if (!state.items.some((i) => i.id === body.item_id)) return dbError('23503', 'violates foreign key constraint', 409)
        const row = makeOption({ ...body, created_by: uid })
        state.options.push(row)
        return rows([row])
      }
      const targets = state.options.filter((o) =>
        (!q('id') || o.id === q('id')) && (!q('item_id') || o.item_id === q('item_id')) &&
        (!q('updated_at') || o.updated_at === q('updated_at')) && (!q('is_selected') || String(o.is_selected) === q('is_selected')))
      if (method === 'PATCH') {
        for (const row of targets) {
          if (body.is_selected === true) {
            // One decided option per item: selecting retires the previous pick.
            for (const other of state.options) if (other.item_id === row.item_id && other.id !== row.id && other.is_selected) Object.assign(other, { is_selected: false, selected_at: null, selected_by: null, updated_at: stamp() })
            Object.assign(row, { selected_at: stamp(), selected_by: uid })
          } else if (body.is_selected === false) Object.assign(row, { selected_at: null, selected_by: null })
          Object.assign(row, body, { updated_at: stamp() })
        }
        return rows(targets)
      }
      if (method === 'DELETE') {
        const ids = new Set(targets.map((o) => o.id))
        state.options = state.options.filter((o) => !ids.has(o.id))
        state.preferences = state.preferences.filter((p) => !ids.has(p.option_id))
        for (const p of state.purchases) if (ids.has(p.option_id as string)) p.option_id = null
        return send(null)
      }
    }
    if (table === 'product_preferences') {
      if (method === 'GET') return rows(state.preferences)
      if (state.failPreference) return send({ message: 'Preference unavailable' }, 500)
      // A member can only ever write their own row: user_id comes from the session.
      const mine = (p: PreferenceRow) => p.item_id === (q('item_id') ?? body?.item_id) && p.user_id === uid
      if (method === 'POST') {
        if (body.user_id && body.user_id !== uid) return dbError('42501', 'permission denied for table product_preferences', 403)
        if (state.preferences.some(mine)) return dbError('23505', 'duplicate key value violates unique constraint "product_preferences_pkey"', 409)
        if (!state.options.some((o) => o.id === body.option_id && o.item_id === body.item_id)) return dbError('23503', 'violates foreign key constraint', 409)
        const row = { ...body, user_id: uid, created_at: stamp(), updated_at: stamp() }
        state.preferences.push(row)
        return rows([row])
      }
      if (q('user_id') !== uid) return rows([])
      if (method === 'PATCH') {
        const row = state.preferences.find(mine)
        if (!row) return rows([])
        if (!state.options.some((o) => o.id === body.option_id && o.item_id === row.item_id)) return dbError('23503', 'violates foreign key constraint', 409)
        Object.assign(row, body, { updated_at: stamp() })
        return rows([row])
      }
      if (method === 'DELETE') { state.preferences = state.preferences.filter((p) => !mine(p)); return send(null) }
    }
    if (table === 'purchase_coordinators') {
      if (method === 'GET') return rows(q('item_id') ? state.coordinators.filter((c) => c.item_id === q('item_id')) : state.coordinators)
      if (method === 'POST') {
        state.claimAttempts++
        // The primary key is the item: a second claim cannot succeed.
        if (state.coordinators.some((c) => c.item_id === body.item_id)) return dbError('23505', 'duplicate key value violates unique constraint "purchase_coordinators_pkey"', 409)
        const row = { ...body, user_id: uid, claimed_at: stamp() }
        state.coordinators.push(row)
        return rows([row])
      }
      const row = state.coordinators.find((c) => c.item_id === q('item_id') && c.user_id === q('user_id'))
      if (method === 'PATCH') {
        if (!row) return rows([])
        // Hand over your own role, or take one over for yourself; never appoint a third person.
        if (row.user_id !== uid && body.user_id !== uid) return dbError('42501', 'Only the person sorting this can hand it to someone else', 403)
        Object.assign(row, { user_id: body.user_id, claimed_at: stamp() })
        return rows([row])
      }
      if (method === 'DELETE') {
        if (row && row.user_id === uid) state.coordinators = state.coordinators.filter((c) => c !== row)
        return send(null)
      }
    }
    if (table === 'item_purchases') return rows(state.purchases)
    if (table === 'save_item_purchase') {
      state.purchaseSaves++
      if (state.failPurchase) return send({ message: 'Purchase save unavailable' }, 500)
      const item = state.items.find((i) => i.id === body.p_item)
      if (!item) return dbError('P0002', 'Item not found', 404)
      const existing = state.purchases.find((p) => p.item_id === body.p_item)
      if ((existing?.updated_at ?? null) !== (body.p_expected_version ?? null)) return dbError('FQ409', 'Someone else just updated this purchase')
      if (body.p_status != null && item.status !== body.p_expected_status) return dbError('FQ409', 'Someone else just changed this item’s stage')
      if (body.p_set_amount && (item.actual_price ?? null) !== (body.p_expected_amount ?? null)) return dbError('FQ409', 'Someone else just changed the amount paid')
      const purchase: PurchaseRow = {
        item_id: item.id, household_id: hid, option_id: body.p_option ?? null, purchased_by: body.p_purchased_by ?? null, purchased_on: body.p_purchased_on ?? null,
        order_reference: body.p_order_reference ?? null, notes: body.p_notes ?? null, delivery_method: body.p_delivery_method ?? null, expected_on: body.p_expected_on ?? null,
        tracking_url: body.p_tracking_url ?? null, delivery_notes: body.p_delivery_notes ?? null, arrived_on: body.p_arrived_on ?? null,
        updated_by: uid, created_at: (existing?.created_at as string | undefined) ?? stamp(), updated_at: stamp(),
      }
      state.purchases = [...state.purchases.filter((p) => p.item_id !== item.id), purchase]
      if (body.p_status != null) item.status = body.p_status
      if (body.p_set_amount) item.actual_price = body.p_amount ?? null
      if (body.p_status != null || body.p_set_amount) item.updated_at = stamp()
      return send({ purchase, item })
    }

    // ---- Phase 6: history, notifications, discussions, household management.
    const ids = (name: string) => { const v = url.searchParams.get(name); return v?.startsWith('in.(') ? v.slice(4, -1).split(',') : null }
    const lt = (name: string) => { const v = url.searchParams.get(name); return v?.startsWith('lt.') ? Number(v.slice(3)) : null }
    const limit = Number(url.searchParams.get('limit') || 1000)
    if (table === 'household_events') {
      const wanted = ids('id')
      const before = lt('id')
      const list = state.events
        .filter((e) => (wanted ? wanted.includes(String(e.id)) : true) && (q('in_timeline') ? String(e.in_timeline) === q('in_timeline') : true) && (before == null || e.id < before))
        .sort((a, b) => b.id - a.id)
      return rows(list.slice(0, limit))
    }
    if (table === 'notifications') {
      // Row-level security: you only ever see your own.
      const mine = state.notifications.filter((n) => n.recipient_id === uid)
      if (method === 'HEAD') {
        const unread = mine.filter((n) => !n.read_at).length
        return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${unread}`, 'access-control-expose-headers': 'content-range' }, body: '' })
      }
      if (method === 'PATCH') {
        if (state.failMarkRead) return send({ message: 'Read state unavailable' }, 500)
        const row = mine.find((n) => String(n.id) === q('id'))
        if (row && !row.read_at) row.read_at = new Date().toISOString()
        return rows(row ? [row] : [])
      }
      const before = lt('id')
      return rows(mine.filter((n) => before == null || n.id < before).sort((a, b) => b.id - a.id).slice(0, limit))
    }
    if (table === 'mark_all_notifications_read') {
      let n = 0
      for (const row of state.notifications) if (row.recipient_id === uid && !row.read_at) { row.read_at = new Date().toISOString(); n++ }
      return send(n)
    }
    if (table === 'comments') {
      if (method === 'GET') {
        const key = ['item_id', 'option_id', 'idea_id'].find((k) => q(k))
        return rows(state.comments.filter((c) => !key || c[key] === q(key)).sort((a, b) => a.created_at.localeCompare(b.created_at)))
      }
      if (state.failComment) return send({ message: 'Comments unavailable' }, 500)
      if (method === 'POST') {
        if (body.author_id) return dbError('42501', 'permission denied for table comments', 403)
        if (!String(body.body ?? '').trim()) return dbError('23514', 'violates check constraint', 400)
        const parent = body.parent_id ? state.comments.find((c) => c.id === body.parent_id) : null
        const row: CommentFixture = {
          id: `abababab-abab-4bab-8bab-${String(++tick).padStart(12, '0')}`, household_id: hid, item_id: body.item_id ?? null, option_id: body.option_id ?? null, idea_id: body.idea_id ?? null,
          parent_id: parent ? ((parent.parent_id as string | null) ?? parent.id) : null, author_id: uid, author_name: 'Alex', body: String(body.body).trim(),
          mentions: (body.mentions ?? []).filter((m: string) => m === madi && opts.flatmates), created_at: stamp(), edited_at: null, deleted_at: null,
        }
        state.comments.push(row)
        return rows([row])
      }
      if (method === 'PATCH') {
        const row = state.comments.find((c) => c.id === q('id') && c.author_id === uid)
        if (!row) return rows([])
        if (body.deleted_at) Object.assign(row, { deleted_at: stamp(), body: '', mentions: [] })
        else Object.assign(row, { body: String(body.body).trim(), mentions: body.mentions ?? row.mentions, edited_at: stamp() })
        return rows([row])
      }
    }
    if (['member_departure_summary', 'remove_household_member', 'leave_household', 'transfer_household_ownership', 'set_member_limit'].includes(table ?? '')) {
      state.rpcCalls.push({ name: table!, body })
      if (table === 'set_member_limit') { state.memberLimit = body.p_limit; return send(null) }
      if (table === 'leave_household') return dbError('42501', 'Hand ownership to a flatmate before you leave', 403)
      return send(table === 'transfer_household_ownership' ? null : { assigned: 3, sole: 1, coordinating: 0 })
    }

    // ---- Phase 7: essentials, tasks and personal preferences (mirroring the database rules).
    if (table === 'user_preferences') {
      if (method === 'GET') return rows(state.prefs ? [{ user_id: uid, updated_at: now, ...state.prefs }] : [])
      if (state.failPrefs) return send({ message: 'Preferences unavailable' }, 500)
      state.prefs = { accent: 'blue', greeting_name: null, motion: 'balanced', home_layout: [], ...(state.prefs ?? {}), ...body }
      return rows([{ user_id: uid, updated_at: stamp(), ...state.prefs }])
    }
    if (table === 'essentials') {
      if (method === 'GET') return rows(state.essentials)
      if (state.failEssential) return send({ message: 'Essentials unavailable' }, 500)
      if (method === 'POST') {
        if (body.claimed_by || body.created_by) return dbError('42501', 'permission denied for table essentials', 403)
        const key = String(body.name).trim().toLowerCase().replace(/\s+/g, ' ')
        if (state.essentials.some((e) => !e.archived_at && String(e.name).toLowerCase() === key)) return dbError('23505', 'duplicate key value violates unique constraint "essentials_one_per_name"', 409)
        const row = makeEssential({ ...body, name: String(body.name).trim(), status: body.status === 'stocked' ? 'stocked' : 'needed' })
        state.essentials.push(row)
        return rows([row])
      }
      const row = state.essentials.find((e) => e.id === q('id'))
      if (method === 'PATCH' && row) {
        Object.assign(row, body, { updated_at: stamp() })
        if (body.archived_at) Object.assign(row, { status: 'stocked', claimed_by: null })
        return rows([row])
      }
      return rows([])
    }
    if (table === 'essential_restocks') return rows(state.restocks.filter((r) => r.essential_id === q('essential_id')).reverse())
    if (table === 'update_essential') {
      state.essentialCalls.push(body)
      if (state.failEssential) return send({ message: 'Essentials unavailable' }, 500)
      const e = state.essentials.find((x) => x.id === body.p_essential)
      if (!e) return dbError('P0002', 'That essential is no longer on the list', 404)
      const a = body.p_action
      if (a === 'claim') {
        if (e.status === 'getting' && e.claimed_by !== uid) return dbError('FQ409', `Madi is already getting ${e.name}`)
        if (e.status === 'needed') Object.assign(e, { status: 'getting', claimed_by: uid })
      } else if (a === 'release' && e.claimed_by === uid) Object.assign(e, { status: 'needed', claimed_by: null })
      else if (a === 'takeover') Object.assign(e, { status: 'getting', claimed_by: uid })
      else if (a === 'handover') Object.assign(e, { claimed_by: body.p_to })
      else if (a === 'restock' && e.status !== 'stocked') {
        state.restocks.push({ id: state.restocks.length + 1, essential_id: e.id, household_id: hid, restocked_by: uid, restocked_by_name: 'Alex', restocked_at: stamp(), prior_status: e.status, prior_claimed_by: e.claimed_by })
        Object.assign(e, { status: 'stocked', claimed_by: null, restocked_at: stamp(), restocked_by: uid })
      } else if (a === 'undo_restock') {
        const last = [...state.restocks].reverse().find((r) => r.essential_id === e.id)
        if (!last) return dbError('FQ409', 'That restock can no longer be undone')
        state.restocks = state.restocks.filter((r) => r !== last)
        Object.assign(e, { status: last.prior_status, claimed_by: last.prior_claimed_by })
      } else if (a === 'need' && (e.status === 'stocked' || e.archived_at)) Object.assign(e, { status: 'needed', claimed_by: null, archived_at: null, needed_by: uid })
      e.updated_at = stamp()
      return send(e)
    }
    if (table === 'household_tasks') {
      if (method === 'GET') return rows(state.tasks)
      if (state.failTask) return send({ message: 'Tasks unavailable' }, 500)
      if (method === 'POST') {
        if (body.completed_by || body.created_by) return dbError('42501', 'permission denied for table household_tasks', 403)
        const row = makeTask({ ...body, title: String(body.title).trim() })
        state.tasks.push(row)
        return rows([row])
      }
      const row = state.tasks.find((t) => t.id === q('id') && (!q('updated_at') || t.updated_at === q('updated_at')))
      if (method === 'PATCH') {
        if (!row) return rows([])
        const was = row.status
        Object.assign(row, body, { updated_at: stamp() })
        if (row.status === 'done' && was !== 'done') row.completed_at = new Date().toISOString()
        if (row.status !== 'done') row.completed_at = null
        return rows([row])
      }
      return rows([])
    }

    if (table === 'wishlist_items') return send([{ id: 'idea', household_id: hid, title: 'A reading lamp', created_by: uid, created_at: now, updated_at: now, import_key: null, voters: [], room_id: rid, notes: null, photo_path: null, estimated_price: null, shopping_url: null, is_chosen: false, chosen_at: null, chosen_by: null, checklist_item_id: null }])
    if (table === 'wishlist_votes' || table === 'get_household_invites') return send([])
    return send({ message: `Unhandled fixture request: ${method} ${url.pathname}` }, 400)
  })
  return state
}

/** Adds an event (and, optionally, a notification for Alex) the way the server's triggers would. */
export function addEvent(
  state: Awaited<ReturnType<typeof mockFlat>>,
  event: Partial<EventRow> & { type: string },
  notify?: { reason: string; category?: 'personal' | 'household'; read?: boolean; at?: string },
) {
  const id = Math.max(0, ...state.events.map((e) => e.id)) + 1
  const at = notify?.at ?? event.created_at ?? new Date().toISOString()
  const row: EventRow = {
    household_id: hid, actor_id: madi, actor_name: 'Madi', room_id: null, item_id: null, option_id: null, idea_id: null, comment_id: null, transformation_id: null,
    subject_id: null, data: {}, in_timeline: false, ...event, id, created_at: at,
  }
  state.events.push(row)
  if (notify) {
    state.notifications.push({ id: Math.max(0, ...state.notifications.map((n) => n.id)) + 1, event_id: id, household_id: hid, recipient_id: uid, reason: notify.reason, category: notify.category ?? 'personal', read_at: notify.read ? at : null, created_at: at })
  }
  return row
}

/** Makes the app refetch, the way it does after reconnecting (realtime is switched off in these tests). */
export async function resync(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
}
