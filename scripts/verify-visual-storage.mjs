// Real Storage API checks against disposable local Supabase only. Never production.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const base = config.API_URL
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):54321$/)
const key = config.ANON_KEY
const admin = config.SERVICE_ROLE_KEY
let checks = 0
async function api(path, token, method = 'GET', body, extra = {}) {
  const response = await fetch(base + path, { method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  return { response, data }
}
function pass(condition, label) { assert.ok(condition, label); checks++; console.log(`PASS ${label}`) }
async function user() {
  const email = `${randomUUID()}@visual-local.invalid`; const password = randomUUID() + 'Aa1!'
  const created = await api('/auth/v1/admin/users', admin, 'POST', { email, password, email_confirm: true })
  assert.ok(created.response.ok, JSON.stringify(created.data))
  const signed = await api('/auth/v1/token?grant_type=password', key, 'POST', { email, password })
  assert.ok(signed.response.ok)
  return signed.data.access_token
}
const member = await user(); const outsider = await user()
const household = await api('/rest/v1/rpc/create_household', member, 'POST', { p_name: 'Visual storage fixture', p_address: '' })
assert.ok(household.response.ok, JSON.stringify(household.data))
const hid = household.data
const reserved = await api('/rest/v1/rpc/reserve_media_upload', member, 'POST', { p_household: hid, p_kind: 'visual', p_ext: 'jpg' })
assert.ok(reserved.response.ok)
const path = reserved.data.path
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
async function upload(token, name) { return fetch(`${base}/storage/v1/object/household-media/${name}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: png }) }
pass((await upload(member, path)).ok, 'member uploads reserved image through Storage API')
pass((await upload(member, reserved.data.thumbnail_path)).ok, 'member uploads thumbnail')
pass(!(await upload(outsider, `${hid}/visual/${randomUUID()}.jpg`)).ok, 'outsider cannot upload to household')
const signed = await api(`/storage/v1/object/sign/household-media/${path}`, member, 'POST', { expiresIn: 60 })
pass(signed.response.ok && !!signed.data.signedURL, 'member can sign private image')
const forbidden = await api(`/storage/v1/object/sign/household-media/${path}`, outsider, 'POST', { expiresIn: 60 })
pass(!forbidden.response.ok, 'outsider cannot sign private image')
await api('/storage/v1/object/household-media', member, 'DELETE', { prefixes: [path] })
const retained = await api(`/storage/v1/object/sign/household-media/${path}`, member, 'POST', { expiresIn: 60 })
pass(retained.response.ok, 'browser deletion cannot remove reserved media')
const overwritten = await fetch(`${base}/storage/v1/object/household-media/${path}`, { method: 'PUT', headers: { apikey: key, Authorization: `Bearer ${member}`, 'Content-Type': 'image/png' }, body: png })
pass(!overwritten.ok, 'reserved images are immutable')
const secret = await api('/rest/v1/rpc/claim_media_cleanup', member, 'POST', { p_dry_run: false })
pass(!secret.response.ok, 'browser token cannot call privileged cleanup')
console.log(`${checks} real local Storage API checks passed. Fixtures are discarded with the local stack.`)
