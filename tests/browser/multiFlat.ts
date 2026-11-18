import type { Page, Route } from '@playwright/test'
import { hid, uid } from './fixtures'

/**
 * A second flat layered over `mockFlat`. Requests that name Flat B (or list memberships) are
 * answered here; everything else falls through to the single-flat fixture, which plays Flat A.
 * Flat B deliberately reuses room names ("Kitchen") so mix-ups would be visible.
 */
export const hidB = '29292929-2929-4292-8292-292929292929'
export const ridB = '39393939-3939-4393-8393-393939393939'
export const sam = '59595959-5959-4595-8595-595959595959'
const at = '2026-11-01T00:00:00.000Z'
const itemB = (i: number) => `49494949-4949-4494-8494-${String(i).padStart(12, '0')}`

export type FlatB = ReturnType<typeof flatBState>

function flatBState() {
  return {
    household: { id: hidB, name: 'Harbour Street', address: null, created_by: sam, settings: { timezone: 'Pacific/Auckland' } as Record<string, unknown>, member_limit: 4, photo_path: null, created_at: at, updated_at: at },
    rooms: [{ id: ridB, household_id: hidB, name: 'Kitchen', icon: 'cooking-pot', color: 'blue', sort_order: 0, import_key: null, width_cm: null, length_cm: null, height_cm: null, measurement_notes: null, description: null, cover_visual_id: null, created_at: at, updated_at: at }],
    items: ['Coffee machine', 'Bar stools'].map((name, i) => ({
      id: itemB(i), household_id: hidB, room_id: ridB, name, description: null, priority: 'must_have', status: 'to_decide', ownership: 'to_decide', owner_user_id: null,
      is_complete: false, completed_at: null, completed_by: null, estimated_price: null, actual_price: null, shopping_url: null, notes: null, sort_order: i, import_key: null,
      needs_assignees: false, created_by: sam, created_at: at, updated_at: at,
    })),
    members: [
      { household_id: hidB, user_id: sam, role: 'owner', joined_at: at },
      { household_id: hidB, user_id: uid, role: 'member', joined_at: '2026-11-02T00:00:00.000Z' },
    ],
    tasks: [] as Record<string, unknown>[],
    purchases: [] as Record<string, unknown>[],
    essentials: [] as Record<string, unknown>[],
    notifications: [] as Record<string, unknown>[],
    events: [{ id: 900, household_id: hidB, type: 'history_started', actor_id: null, actor_name: null, room_id: null, item_id: null, option_id: null, idea_id: null, comment_id: null, transformation_id: null, subject_id: null, data: {}, in_timeline: true, created_at: at }] as Record<string, unknown>[],
    appointments: [] as Record<string, unknown>[],
    /** Alex is a member of Flat B. Set false to simulate removal (the server stops serving it). */
    member: true,
    /** Requests for Flat B wait on this when set (to test late responses after a switch). */
    hold: null as Promise<void> | null,
    /** Invite codes and the flat each one opens. */
    invites: new Map<string, string>(),
  }
}

/** Alex belongs to Flat A (owner, from mockFlat) and Flat B (member). */
export async function addFlatB(page: Page, opts: { member?: boolean } = {}) {
  const b = flatBState()
  if (opts.member === false) b.member = false
  const samProfile = { id: sam, display_name: 'Sam', avatar_path: null, accent_color: '#2fb2ee', icon: 'user', preferences: {}, tour_completed_at: at, created_at: at, updated_at: at }
  await page.route('**/*.supabase.co/rest/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const table = url.pathname.split('/').at(-1)
    const method = request.method()
    const p = (name: string) => url.searchParams.get(name)
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) })
    const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const rows = (list: unknown[]) => send(single ? (list[0] ?? null) : list)
    const body = method === 'GET' || method === 'HEAD' ? null : request.postDataJSON()
    const forB = p('household_id') === `eq.${hidB}` || p('id') === `eq.${hidB}` || body?.p_household === hidB

    // Memberships of the signed-in person.
    if (table === 'household_members' && p('user_id') === `eq.${uid}` && method === 'GET') {
      const mine = [{ household_id: hid, user_id: uid, role: 'owner', joined_at: '2026-10-01T00:00:00.000Z' }]
      if (b.member) mine.push({ household_id: hidB, user_id: uid, role: 'member', joined_at: '2026-11-02T00:00:00.000Z' })
      return rows(mine)
    }
    if (table === 'households' && p('id')?.startsWith('in.(')) {
      const wanted = p('id')!.slice(4, -1).split(',')
      const all = [{ id: hid, name: 'Our Flat' }, ...(b.member ? [{ id: hidB, name: b.household.name }] : [])]
      return rows(all.filter((h) => wanted.includes(h.id)))
    }
    if (table === 'profiles' && p('id')?.includes(sam)) {
      return rows([samProfile, { id: uid, display_name: 'Alex', avatar_path: null, accent_color: '#3657e8', icon: 'user', preferences: {}, tour_completed_at: at, created_at: at, updated_at: at }])
    }
    if (table === 'preview_household_invite') {
      const target = b.invites.get(body.p_code)
      if (!target) return send([])
      const isB = target === hidB
      return send([{ household_name: isB ? b.household.name : 'Our Flat', member_count: 2, is_member: isB ? b.member : true, spaces_left: 2 }])
    }
    if (table === 'accept_household_invite') {
      const target = b.invites.get(body.p_code)
      if (!target) return send({ code: 'P0002', message: 'This invite link is invalid or has expired' }, 400)
      if (target === hidB) b.member = true
      return send(target)
    }
    if (!forB) return route.fallback()

    if (b.hold) await b.hold
    // Row-level security: once Alex is no longer a member, Flat B returns nothing.
    if (!b.member) {
      if (table === 'households' && single) return send({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null }, 406)
      return rows([])
    }
    if (method === 'HEAD') {
      const unread = b.notifications.filter((n) => !n.read_at).length
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-range': `*/${unread}`, 'access-control-expose-headers': 'content-range' }, body: '' })
    }
    switch (table) {
      case 'households':
        if (method === 'PATCH') Object.assign(b.household, body)
        return rows([b.household])
      case 'household_members': return rows(b.members)
      case 'rooms': return rows(b.rooms)
      case 'items': return rows(b.items)
      case 'household_tasks': return rows(b.tasks)
      case 'item_purchases': return rows(b.purchases)
      case 'essentials': return rows(b.essentials)
      case 'notifications': return rows(b.notifications)
      case 'household_events': return rows(b.events)
      case 'calendar_appointments': return rows(b.appointments)
      case 'mark_all_notifications_read': return send(0)
      default: return rows([])
    }
  })
  return b
}
