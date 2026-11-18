/**
 * Which flat an account works in. The choice is a per-account convenience stored in the
 * browser; it is never trusted on its own: it only counts if it is one of the account's
 * current, server-backed memberships.
 */
export const LEGACY_ACTIVE_KEY = 'flatquest.activeHousehold'
export const activeFlatKey = (userId: string) => `flatquest.activeHousehold.${userId}`

export type ActiveReason = 'requested' | 'stored' | 'legacy' | 'only' | 'choose' | 'none'

export interface Resolution {
  id: string | null
  reason: ActiveReason
  /** The device-wide Phase 1–9 key named one of this account's flats: copy it to the account's key. */
  migrateLegacy: boolean
}

export function resolveActiveFlat(input: {
  memberships: readonly string[]
  /** Chosen in this session (switcher, invite, new flat, ?flat= link). */
  requested?: string | null
  stored?: string | null
  legacy?: string | null
}): Resolution {
  const { memberships, requested, stored, legacy } = input
  const has = (id: string | null | undefined): id is string => !!id && memberships.includes(id)
  if (memberships.length === 0) return { id: null, reason: 'none', migrateLegacy: false }
  if (has(requested)) return { id: requested, reason: 'requested', migrateLegacy: false }
  if (has(stored)) return { id: stored, reason: 'stored', migrateLegacy: false }
  // The legacy key isn't tied to an account; it only counts if it names one of this account's flats.
  if (has(legacy)) return { id: legacy, reason: 'legacy', migrateLegacy: true }
  if (memberships.length === 1) return { id: memberships[0]!, reason: 'only', migrateLegacy: false }
  return { id: null, reason: 'choose', migrateLegacy: false }
}

/** Storage can be unavailable (private mode, blocked site data). Every access is optional. */
export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* the choice just won't be remembered */ }
  },
  remove(key: string) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  },
}
