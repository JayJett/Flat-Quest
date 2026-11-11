import type { Page } from '@playwright/test'

export const uid = '11111111-1111-4111-8111-111111111111'
export const hid = '22222222-2222-4222-8222-222222222222'
export const rid = '33333333-3333-4333-8333-333333333333'
const now = '2026-11-11T01:00:00.000Z'
export async function mockFlat(page: Page, tour = false) {
  page.on('pageerror', (e) => console.log('BROWSER ERROR', e.message))
  const profile = { id: uid, display_name: 'Alex', avatar_path: null, accent_color: '#3657e8', icon: 'user', preferences: {}, tour_completed_at: tour ? null : now, created_at: now, updated_at: now }
  const room = { id: rid, household_id: hid, name: 'Kitchen', icon: 'cooking-pot', color: 'green', sort_order: 0, import_key: null, created_at: now, updated_at: now }
  const items = Array.from({ length: 4 }, (_, i) => ({ id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, household_id: hid, room_id: rid, name: ['Kettle', 'Fridge', 'Toaster', 'Plates'][i], description: null, priority: 'must_have', status: i === 1 ? 'provided' : 'to_decide', ownership: 'to_decide', owner_user_id: null, is_complete: false, completed_at: null as string | null, completed_by: null as string | null, estimated_price: null, actual_price: null, shopping_url: null, notes: null, sort_order: i, import_key: null, needs_assignees: false, created_by: uid, created_at: now, updated_at: now }))
  const state = { items, failSave: false, conflict: false, failAssign: false, writes: 0, creates: 0, assignments: [] as { item_id: string; household_id: string; user_id: string; created_at: string }[] }
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'alex@example.invalid', app_metadata: {}, user_metadata: {}, created_at: now }
  await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-ivnovvdpkxrqsmsiqhid-auth-token', JSON.stringify({ access_token: 'mock-token', refresh_token: 'mock-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }))
  }, { user })
  // No browser test can contact the real project's HTTP or WebSocket endpoints.
  await page.routeWebSocket('**/*.supabase.co/**', (socket) => socket.close())
  await page.route('**/*.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const table = url.pathname.split('/').at(-1)
    const method = request.method()
    const body = request.postDataJSON()
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' }, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return send(null)
    if (url.pathname === '/auth/v1/user') return send(user)
    if (url.pathname === '/auth/v1/settings') return send({ external: { google: false } })
    if (table === 'profiles') {
      if (method === 'PATCH') Object.assign(profile, body)
      return send(url.searchParams.has('id') && !url.searchParams.get('id')?.startsWith('in.') ? profile : [profile])
    }
    if (table === 'household_members') return send([{ household_id: hid, user_id: uid, role: 'owner', joined_at: now }])
    if (table === 'households') return send({ id: hid, name: 'Our Flat', address: null, created_by: uid, settings: {}, member_limit: 4, photo_path: null, created_at: now, updated_at: now })
    if (table === 'rooms') return send([room])
    if (table === 'item_assignees') return send(state.assignments)
    if (table === 'set_item_assignees') {
      if (state.failAssign) return send({ message: 'Assignment unavailable' }, 500)
      state.assignments = body.p_users.map((id: string) => ({ item_id: body.p_item, user_id: id, household_id: hid, created_at: now }))
      return send(null)
    }
    if (table === 'items') {
      if (method === 'GET') return send(state.items)
      state.writes++
      if (state.failSave) return send({ message: 'Save unavailable' }, 500)
      if (method === 'PATCH') {
        if (state.conflict) return send(null)
        const row = state.items.find((i) => i.id === url.searchParams.get('id')?.slice(3))!
        Object.assign(row, body, { updated_at: new Date().toISOString() })
        if (body.is_complete) { row.completed_at = new Date().toISOString(); row.completed_by = uid }
        return send(row)
      }
      if (method === 'POST') {
        state.creates++
        const row = { ...state.items[0]!, ...body, id: '55555555-5555-4555-8555-555555555555', updated_at: new Date().toISOString() }
        state.items.push(row)
        return send(row)
      }
    }
    if (table === 'wishlist_items') return send([{ id: 'idea', household_id: hid, title: 'A reading lamp', created_by: uid, created_at: now, updated_at: now, import_key: null, voters: [], room_id: rid, notes: null, photo_path: null, estimated_price: null, shopping_url: null, is_chosen: false, chosen_at: null, chosen_by: null, checklist_item_id: null }])
    if (table === 'wishlist_votes' || table === 'get_household_invites') return send([])
    return send({ message: `Unhandled fixture request: ${method} ${url.pathname}` }, 400)
  })
  return state
}

