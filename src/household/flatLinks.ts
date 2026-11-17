/**
 * Shareable links name the flat they belong to with `?flat=<id>` on an ordinary route
 * (e.g. /tasks?task=…&flat=…). The id only identifies the flat; access is always decided by
 * the server (membership + row-level security) after sign-in.
 */
export const FLAT_PARAM = 'flat'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Adds (or replaces) the flat on an in-app path such as `/rooms/abc?item=1#x`. */
export function flatLink(path: string, flatId: string): string {
  const hashAt = path.indexOf('#')
  const hash = hashAt >= 0 ? path.slice(hashAt) : ''
  const beforeHash = hashAt >= 0 ? path.slice(0, hashAt) : path
  const queryAt = beforeHash.indexOf('?')
  const pathname = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash
  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '')
  params.set(FLAT_PARAM, flatId)
  return `${pathname}?${params.toString()}${hash}`
}

export type RequestedFlat = { kind: 'none' } | { kind: 'flat'; id: string } | { kind: 'invalid' }

/** Reads `?flat=` from a search string. A malformed value is treated as an unavailable flat. */
export function requestedFlat(search: string): RequestedFlat {
  const value = new URLSearchParams(search).get(FLAT_PARAM)
  if (value === null) return { kind: 'none' }
  return UUID.test(value) ? { kind: 'flat', id: value.toLowerCase() } : { kind: 'invalid' }
}

/** A full URL for sharing outside the app (copy link), under the app's base path. */
export function absoluteFlatLink(path: string, flatId: string, origin = window.location.origin, base = import.meta.env.BASE_URL ?? '/'): string {
  const root = base.endsWith('/') ? base.slice(0, -1) : base
  return `${origin}${root}${flatLink(path, flatId)}`
}
