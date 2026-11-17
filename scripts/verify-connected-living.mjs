// Real Realtime + REST checks for Phase 6 with independent signed-in sessions, against
// disposable local Supabase only (CI). Never production.
//   node scripts/verify-connected-living.mjs <supabase status -o json file>
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const url = config.API_URL
assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):54321$/, 'local stack only')
const anon = config.ANON_KEY
const admin = createClient(url, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let checks = 0
const pass = (ok, label) => { assert.ok(ok, label); checks++; console.log(`PASS ${label}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let diagnose = async () => {}
async function waitFor(fn, label, ms = 20_000) {
  const start = Date.now()
  while (Date.now() - start < ms) { if (fn()) return true; await sleep(100) }
  await diagnose()
  throw new Error(`Timed out: ${label}`)
}

async function person(name) {
  const email = `${randomUUID()}@phase6-local.invalid`
  const password = `${randomUUID()}Aa1!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } })
  if (error) throw error
  const session = async () => {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: e } = await client.auth.signInWithPassword({ email, password })
    if (e) throw e
    await client.from('profiles').update({ display_name: name }).eq('id', data.user.id)
    return client
  }
  return { id: data.user.id, session }
}

const ok = (res, label) => { if (res.error) throw new Error(`${label}: ${res.error.message}`); return res.data }

const avery = await person('Avery'); const blair = await person('Blair'); const casey = await person('Casey')
const A = await avery.session(); const B = await blair.session(); const B2 = await blair.session(); const C = await casey.session()

const hid = ok(await A.rpc('create_household', { p_name: 'Realtime fixture', p_address: '' }), 'create household')
const code = ok(await A.rpc('create_household_invite', { p_household: hid }), 'invite')
ok(await B.rpc('accept_household_invite', { p_code: typeof code === 'string' ? code : code.code }), 'join')
ok(await C.rpc('create_household', { p_name: 'Other flat', p_address: '' }), 'outsider flat')

// Each session listens the way the app does.
const seen = { a: [], b: [], b2: [], bEvents: [], bMembers: [], cAll: [] }
// SUBSCRIBED can arrive before Realtime is attached to Postgres changes; wait for its
// "Subscribed to PostgreSQL" system message so no early change is missed.
const listen = (client, name, table, filter, sink, event = '*') =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Realtime never attached for ${name}/${table}`)), 30_000)
    client
      .channel(`${name}-${table}-${randomUUID()}`)
      .on('postgres_changes', { event, schema: 'public', table, ...(filter ? { filter } : {}) }, (p) => sink.push(p))
      .on('system', {}, (msg) => {
        if (msg?.extension === 'postgres_changes') {
          if (msg.status === 'ok') { clearTimeout(timer); resolve() } else { clearTimeout(timer); reject(new Error(`${name}/${table}: ${msg.message}`)) }
        }
      })
      .subscribe((status, err) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.log(`${name}/${table}: ${status} ${err?.message ?? ''}`) })
  })
await Promise.all([
  listen(A, 'a', 'notifications', `recipient_id=eq.${avery.id}`, seen.a),
  listen(B, 'b', 'notifications', `recipient_id=eq.${blair.id}`, seen.b),
  listen(B2, 'b2', 'notifications', `recipient_id=eq.${blair.id}`, seen.b2),
  listen(B, 'b', 'household_events', `household_id=eq.${hid}`, seen.bEvents),
  listen(B, 'b', 'household_members', null, seen.bMembers, 'DELETE'),
  // The outsider tries to eavesdrop on everything.
  listen(C, 'c', 'notifications', null, seen.cAll),
  listen(C, 'c', 'household_events', null, seen.cAll),
  listen(C, 'c', 'comments', null, seen.cAll),
])
await sleep(500)
console.log(`Node ${process.version}; all channels attached to Postgres changes`)
diagnose = async () => {
  const rows = await B.from('notifications').select('id, reason, read_at').eq('recipient_id', blair.id)
  console.log('Diagnostics — Blair can read over REST:', JSON.stringify(rows.data ?? rows.error))
  console.log('Diagnostics — realtime payloads seen:', JSON.stringify({ a: seen.a.length, b: seen.b.length, b2: seen.b2.length, bEvents: seen.bEvents.length, bMembers: seen.bMembers.length, outsider: seen.cAll.length }))
}

// 1. Assignment reaches the assignee live, never the actor.
const room = ok(await A.from('rooms').insert({ household_id: hid, name: 'Kitchen' }).select().single(), 'room')
const item = ok(await A.from('items').insert({ household_id: hid, room_id: room.id, name: 'Kettle' }).select().single(), 'item')
ok(await A.rpc('set_item_assignees', { p_item: item.id, p_users: [avery.id, blair.id] }), 'assign')
await waitFor(() => seen.b.some((p) => p.eventType === 'INSERT' && p.new.reason === 'assigned'), 'assignment notification')
pass(true, 'assignee receives a live notification in their own session')
pass(seen.b2.some((p) => p.eventType === 'INSERT'), 'the same person’s second device receives it too')
pass(!seen.a.some((p) => p.new?.reason === 'assigned'), 'the actor is not notified about their own action')

// 2. Read state syncs across devices.
const notice = seen.b.find((p) => p.new.reason === 'assigned').new
ok(await B.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notice.id), 'mark read')
await waitFor(() => seen.b2.some((p) => p.eventType === 'UPDATE' && p.new.id === notice.id && p.new.read_at), 'read sync')
pass(true, 'marking read on one device updates the other live')
const other = await A.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notice.id).select()
pass((other.data ?? []).length === 0, 'another member cannot mark it read')

// 3. A mention produces exactly one notification and a timeline entry, live.
const comment = ok(await A.from('comments').insert({ household_id: hid, item_id: item.id, body: '@Blair which one?', mentions: [blair.id] }).select().single(), 'comment')
await waitFor(() => seen.b.some((p) => p.eventType === 'INSERT' && p.new.reason === 'mention'), 'mention')
await waitFor(() => seen.bEvents.some((p) => p.eventType === 'INSERT' && p.new.comment_id === comment.id), 'timeline event')
await sleep(1500)
const forComment = (await B.from('notifications').select('id, event_id').eq('recipient_id', blair.id)).data ?? []
const events = (await B.from('household_events').select('id').eq('comment_id', comment.id)).data ?? []
pass(forComment.filter((n) => events.some((e) => e.id === n.event_id)).length === 1, 'one notification per person per comment')
pass(true, 'the timeline updates live for other members')
const forged = await B.from('comments').insert({ household_id: hid, item_id: item.id, body: 'pretending', author_id: avery.id })
pass(Boolean(forged.error), 'a comment cannot be attributed to someone else')

// 4. Nothing leaks to another flat, over REST or Realtime.
pass(seen.cAll.length === 0, 'outsider receives no realtime changes from this flat')
const peek = await C.from('household_events').select('id').eq('household_id', hid)
pass((peek.data ?? []).length === 0, 'outsider cannot read this flat’s history')

// 4b. Phase 7: essentials, tasks and personal preferences over Realtime.
const p7 = { bEss: [], bTask: [], bPrefs: [], b2Prefs: [], aPrefs: [], cLiving: [] }
await Promise.all([
  listen(B, 'b', 'essentials', `household_id=eq.${hid}`, p7.bEss),
  listen(B, 'b', 'household_tasks', `household_id=eq.${hid}`, p7.bTask),
  listen(B2, 'b2', 'user_preferences', `user_id=eq.${blair.id}`, p7.b2Prefs),
  listen(A, 'a', 'user_preferences', null, p7.aPrefs),
  listen(C, 'c', 'essentials', null, p7.cLiving),
  listen(C, 'c', 'household_tasks', null, p7.cLiving),
])
const ess = ok(await A.from('essentials').insert({ household_id: hid, name: 'Toilet paper' }).select().single(), 'add essential')
await waitFor(() => p7.bEss.some((p) => p.new?.id === ess.id), 'essential sync')
pass(true, 'a new essential appears live for flatmates')
ok(await B.rpc('update_essential', { p_essential: ess.id, p_action: 'claim', p_expected: 'needed' }), 'claim')
const lost = await A.rpc('update_essential', { p_essential: ess.id, p_action: 'claim', p_expected: 'needed' })
pass(lost.error?.code === 'FQ409', 'a second claim from another session is refused')
await waitFor(() => seen.a.some((p) => p.eventType === 'INSERT' && p.new.reason === 'responsible'), 'claim notice')
pass(true, 'whoever asked for it is told live that it is being picked up')
const task = ok(await A.from('household_tasks').insert({ household_id: hid, title: 'Change a lightbulb', assignee_id: blair.id }).select().single(), 'task')
await waitFor(() => p7.bTask.some((p) => p.new?.id === task.id), 'task sync')
await waitFor(() => seen.b.some((p) => p.eventType === 'INSERT' && p.new.reason === 'assigned' && p.new.id > notice.id), 'task assignment notice')
pass(true, 'an assigned task arrives live with a notification for the assignee')
ok(await B.from('user_preferences').upsert({ accent: 'coral', motion: 'playful' }, { onConflict: 'user_id' }), 'prefs')
await waitFor(() => p7.b2Prefs.some((p) => p.new?.accent === 'coral'), 'prefs sync')
pass(true, 'a theme change reaches the same person’s other device')
await sleep(1000)
pass(p7.aPrefs.length === 0, 'a flatmate never receives someone else’s preferences')
pass(p7.cLiving.length === 0, 'outsiders receive no essentials or tasks')

// 4c. Phase 8: a muted category creates nothing for that person, live; search sources stay private.
ok(await B.from('user_preferences').upsert({ muted_notifications: ['assignments'] }, { onConflict: 'user_id' }), 'mute')
const beforeMute = seen.b.length
const muted = ok(await A.from('household_tasks').insert({ household_id: hid, title: 'Muted assignment', assignee_id: blair.id }).select().single(), 'muted task')
await waitFor(() => p7.bTask.some((p) => p.new?.id === muted.id), 'muted task sync')
await sleep(1500)
pass(!seen.b.slice(beforeMute).some((p) => p.eventType === 'INSERT'), 'a muted category creates no notification for that person (server-side)')
const stillThere = (await B.from('notifications').select('id').eq('recipient_id', blair.id)).data ?? []
pass(stillThere.length > 0, 'earlier notifications are still there after muting')
const peekIdeas = await C.from('wishlist_items').select('id').eq('household_id', hid)
const peekVisuals = await C.from('room_visuals').select('id').eq('household_id', hid)
const peekTasks = await C.from('household_tasks').select('id').ilike('title', '%')
pass((peekIdeas.data ?? []).length === 0 && (peekVisuals.data ?? []).length === 0 && !(peekTasks.data ?? []).some((t) => t.id === muted.id),
  'search sources from another flat are invisible to an outsider')

// 4d. Phase 9: a shared room cover and description sync live; covers stay inside their room and flat.
const p9 = { bRooms: [], cRooms: [] }
await Promise.all([
  listen(B, 'b', 'rooms', `household_id=eq.${hid}`, p9.bRooms),
  listen(C, 'c', 'rooms', null, p9.cRooms),
])
const visual = async (client, flat, roomId) => {
  const r = ok(await client.rpc('reserve_media_upload', { p_household: flat, p_kind: 'visual', p_ext: 'webp' }), 'reserve')
  return ok(await client.from('room_visuals').insert({ household_id: flat, room_id: roomId, kind: 'photo', photo_path: r.path, thumbnail_path: r.thumbnail_path }).select().single(), 'visual')
}
const lounge = ok(await A.from('rooms').insert({ household_id: hid, name: 'Lounge' }).select().single(), 'second room')
const coverPhoto = await visual(A, hid, room.id)
const loungePhoto = await visual(A, hid, lounge.id)
ok(await A.from('rooms').update({ cover_visual_id: coverPhoto.id, description: 'Where the kettle lives' }).eq('id', room.id), 'set cover')
await waitFor(() => p9.bRooms.some((p) => p.new?.id === room.id && p.new.cover_visual_id === coverPhoto.id), 'cover sync')
pass(p9.bRooms.some((p) => p.new?.description === 'Where the kettle lives'), 'a new cover and description appear live for flatmates')
const wrongRoom = await A.from('rooms').update({ cover_visual_id: loungePhoto.id }).eq('id', room.id)
pass(wrongRoom.error?.code === '23514', 'a photo from another room cannot be the cover')
const cFlat = ok(await C.from('households').select('id').neq('id', hid).limit(1).single(), 'outsider flat id').id
const cRoom = ok(await C.from('rooms').insert({ household_id: cFlat, name: 'Their room' }).select().single(), 'outsider room')
const cPhoto = await visual(C, cFlat, cRoom.id)
const crossFlat = await A.from('rooms').update({ cover_visual_id: cPhoto.id }).eq('id', room.id)
pass(Boolean(crossFlat.error), 'a photo from another flat cannot be the cover')
const hijack = await C.from('rooms').update({ cover_visual_id: cPhoto.id, description: 'mine' }).eq('id', room.id).select()
pass(!hijack.error && (hijack.data ?? []).length === 0, 'an outsider cannot change this flat’s room')
ok(await A.from('room_visuals').delete().eq('id', coverPhoto.id), 'delete cover photo')
await waitFor(() => p9.bRooms.some((p) => p.new?.id === room.id && p.new.cover_visual_id === null && p.new.description === 'Where the kettle lives'), 'cover cleared')
pass(true, 'deleting the photo clears the cover live, keeping the description')
pass(!p9.cRooms.some((p) => p.new?.household_id === hid || p.old?.id === room.id), 'outsiders receive no room changes from this flat')

// 4e. Phase 10: shared appointments and coverage, live across sessions; flats stay separate.
const p10 = { bAppt: [], aAllAppt: [], cAppt: [] }
await Promise.all([
  listen(B, 'b', 'calendar_appointments', `household_id=eq.${hid}`, p10.bAppt),
  listen(A, 'a', 'calendar_appointments', null, p10.aAllAppt),
  listen(C, 'c', 'calendar_appointments', null, p10.cAppt),
])
const apptId = randomUUID()
const save = (client, rev, day, start, end, cover = true, id = apptId, flat = hid) => client.rpc('save_appointment', {
  p_id: id, p_household: flat, p_expected_revision: rev, p_title: 'Inspection', p_notes: null, p_room: null,
  p_date: day, p_start: start, p_end: end, p_needs_cover: cover,
})
let appt = ok(await save(A, null, '2026-12-02', '10:00', '11:00'), 'create appointment')
await waitFor(() => p10.bAppt.some((p) => p.new?.id === apptId), 'appointment insert')
pass(true, 'a new appointment appears live for a flatmate')
const retry = ok(await save(A, null, '2026-12-02', '10:00', '11:00'), 'retry create')
pass(retry.revision === 1 && (await A.from('calendar_appointments').select('id').eq('id', apptId)).data.length === 1, 'retrying a create (unclear response) never duplicates')
appt = ok(await B.rpc('set_appointment_cover', { p_id: apptId, p_expected_revision: appt.revision, p_action: 'claim' }), 'claim')
await waitFor(() => p10.aAllAppt.some((p) => p.new?.id === apptId && p.new.host_id === blair.id), 'claim sync')
pass(true, 'volunteering to be home reaches the other flatmate live')
const twice = await A.rpc('set_appointment_cover', { p_id: apptId, p_expected_revision: appt.revision, p_action: 'claim' })
pass(twice.error?.code === 'FQ409', 'a second volunteer from another session is refused')
const claimedRev = appt.revision
appt = ok(await save(A, appt.revision, '2026-12-03', '10:00', '11:00'), 'reschedule')
await waitFor(() => p10.bAppt.some((p) => p.new?.id === apptId && p.new.host_id === null && p.new.scheduled_on === '2026-12-03'), 'reschedule sync')
pass(true, 'moving it reopens coverage, and the volunteer sees that live')
const staleClaim = await B.rpc('set_appointment_cover', { p_id: apptId, p_expected_revision: claimedRev, p_action: 'claim' })
pass(staleClaim.error?.code === 'FQ409', 'a claim made against the old slot is refused')
const outsiderClaim = await C.rpc('set_appointment_cover', { p_id: apptId, p_expected_revision: appt.revision, p_action: 'claim' })
pass(Boolean(outsiderClaim.error) && (await C.from('calendar_appointments').select('id').eq('id', apptId)).data.length === 0, 'an outsider can neither see nor claim it')
const direct = await A.from('calendar_appointments').update({ host_id: avery.id }).eq('id', apptId)
pass(Boolean(direct.error), 'direct writes are refused even for members')
// A person in two flats: Blair's own flat stays separate from this one.
const blairFlat = ok(await B.rpc('create_household', { p_name: 'Blair’s new place', p_address: '' }), 'second flat')
const elsewhere = randomUUID()
ok(await save(B, null, '2026-12-02', null, null, false, elsewhere, blairFlat), 'appointment in second flat')
await sleep(1500)
pass(!p10.aAllAppt.some((p) => p.new?.id === elsewhere), 'appointments in a flatmate’s other flat never reach this flat')
pass(!p10.cAppt.some((p) => p.new?.household_id === hid), 'outsiders receive no appointment changes from this flat')
// Signed photo links: a member can sign; after removal, new links are refused (checked below).
const reserved = ok(await A.rpc('reserve_media_upload', { p_household: hid, p_kind: 'visual', p_ext: 'webp' }), 'reserve photo')
const upload = await A.storage.from('household-media').upload(reserved.path, new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' }), { contentType: 'image/webp' })
if (upload.error) throw new Error(`upload: ${upload.error.message}`)
const signedBefore = await B.storage.from('household-media').createSignedUrl(reserved.path, 60)
pass(Boolean(signedBefore.data?.signedUrl), 'a member can get a signed link to a flat photo')

// 5. Removal takes effect immediately, including for the removed person's open session.
ok(await A.rpc('remove_household_member', { p_household: hid, p_user: blair.id }), 'remove')
await waitFor(() => seen.bMembers.some((p) => p.old?.user_id === blair.id), 'membership delete event')
pass(true, 'the removed member’s session is told it was removed')
const after = await B.from('items').select('id').eq('household_id', hid)
pass((after.data ?? []).length === 0, 'removed member can no longer read the flat')
const stillOwner = (await A.from('household_members').select('role').eq('household_id', hid).eq('user_id', avery.id).single()).data
pass(stillOwner?.role === 'owner', 'owner unaffected')

// 5b. Phase 10: after removal the old session gets nothing new, and can't sign new photo links.
const seenBefore = p10.bAppt.length
ok(await A.rpc('set_appointment_cover', { p_id: apptId, p_expected_revision: appt.revision, p_action: 'claim' }), 'owner claims after removal')
await waitFor(() => p10.aAllAppt.some((p) => p.new?.id === apptId && p.new.host_id === avery.id), 'owner claim sync')
await sleep(1500)
pass(p10.bAppt.length === seenBefore, 'a removed member’s open session receives no further appointment changes')
const signedAfter = await B.storage.from('household-media').createSignedUrl(reserved.path, 60)
pass(!signedAfter.data?.signedUrl, 'a removed member cannot get new signed photo links')

for (const client of [A, B, B2, C]) await client.removeAllChannels()
console.log(`${checks} real Realtime/REST checks passed with independent sessions. Fixtures are discarded with the local stack.`)
process.exit(0)
