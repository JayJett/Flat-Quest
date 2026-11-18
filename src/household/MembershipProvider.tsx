import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { useToast } from '@/components/Toast'
import { errorMessage, supabase } from '@/lib/supabase'
import { activeFlatKey, LEGACY_ACTIVE_KEY, resolveActiveFlat, storage } from './activeFlat'

export interface Membership {
  householdId: string
  role: 'owner' | 'member'
  joinedAt: string
  name: string
}

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string }

export interface MembershipState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  memberships: Membership[]
  /** The flat this session works in; null when there is none yet or a choice is needed. */
  activeId: string | null
  needsChoice: boolean
  /** Makes a flat (one of your memberships) active. Returns false if it isn't yours. */
  select: (householdId: string) => boolean
  /** Re-reads memberships from the server, e.g. after an access failure or a removal. */
  refresh: (opts?: { quiet?: boolean }) => Promise<Membership[] | null>
  /** Creates a flat you own. It does not switch to it; call select() when ready. */
  createHousehold: (name: string, address: string) => Promise<Result<string>>
  /** Joins (or, if already a member, identifies) the invite's flat. Does not switch. */
  acceptInvite: (code: string) => Promise<Result<string>>
}

const Ctx = createContext<MembershipState | null>(null)

/** Account-level state: which flats you belong to and which one is open. Keyed by user. */
export function MembershipProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const toast = useToast()
  const [status, setStatus] = useState<MembershipState['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  /** The flat chosen in this session (switcher, invite, new flat, ?flat= link). */
  const requested = useRef<string | null>(null)
  const membershipsRef = useRef<Membership[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [needsChoice, setNeedsChoice] = useState(false)
  const activeRef = useRef<string | null>(null)
  const namesRef = useRef(new Map<string, string>())
  const generation = useRef(0)

  const resolve = useCallback((list: Membership[], wanted: string | null, quiet = false) => {
    if (!userId) return
    const ids = list.map((m) => m.householdId)
    const r = resolveActiveFlat({
      memberships: ids,
      requested: wanted,
      stored: storage.get(activeFlatKey(userId)),
      legacy: storage.get(LEGACY_ACTIVE_KEY),
    })
    if (r.migrateLegacy && r.id) {
      storage.set(activeFlatKey(userId), r.id)
      storage.remove(LEGACY_ACTIVE_KEY)
    }
    const previous = activeRef.current
    if (previous && !ids.includes(previous) && !quiet) {
      toast.show(`You no longer have access to ${namesRef.current.get(previous) ?? 'that flat'}.`)
    }
    activeRef.current = r.id
    setActiveId(r.id)
    setNeedsChoice(r.reason === 'choose')
  }, [userId, toast])

  const refresh = useCallback(async (opts?: { quiet?: boolean }): Promise<Membership[] | null> => {
    if (!userId) return null
    const run = ++generation.current
    const mem = await supabase.from('household_members').select('household_id, role, joined_at').eq('user_id', userId).order('joined_at')
    if (run !== generation.current) return null
    if (mem.error) {
      setError(errorMessage(mem.error))
      setStatus((s) => (s === 'ready' ? s : 'error'))
      return null
    }
    const ids = (mem.data ?? []).map((m) => m.household_id)
    const names = ids.length ? await supabase.from('households').select('id, name').in('id', ids) : { data: [], error: null }
    if (run !== generation.current) return null
    if (names.error) {
      setError(errorMessage(names.error))
      setStatus((s) => (s === 'ready' ? s : 'error'))
      return null
    }
    const nameOf = new Map((names.data ?? []).map((h) => [h.id, h.name]))
    const list = (mem.data ?? []).map((m) => ({
      householdId: m.household_id,
      role: m.role === 'owner' ? 'owner' : 'member',
      joinedAt: m.joined_at,
      name: nameOf.get(m.household_id) ?? 'Your flat',
    }) satisfies Membership)
    for (const m of list) namesRef.current.set(m.householdId, m.name)
    membershipsRef.current = list
    setMemberships(list)
    setError(null)
    setStatus('ready')
    resolve(list, requested.current, opts?.quiet)
    return list
  }, [userId, resolve])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set when it resolves
    if (userId) void refresh()
  }, [userId, refresh])

  // Reads the latest list (not the one from the last render), so a flat that was just created
  // or joined can be selected straight away.
  const select = useCallback((householdId: string) => {
    if (!userId || !membershipsRef.current.some((m) => m.householdId === householdId)) return false
    storage.set(activeFlatKey(userId), householdId)
    requested.current = householdId
    activeRef.current = householdId
    setActiveId(householdId)
    setNeedsChoice(false)
    return true
  }, [userId])

  const createHousehold = useCallback<MembershipState['createHousehold']>(async (name, address) => {
    const { data, error: e } = await supabase.rpc('create_household', { p_name: name, p_address: address })
    if (e || !data) return { ok: false, error: /Too many households/i.test(e?.message ?? '') ? 'You can be in up to 5 flats. Leave one before setting up another.' : errorMessage(e) }
    await refresh()
    return { ok: true, data }
  }, [refresh])

  const acceptInvite = useCallback<MembershipState['acceptInvite']>(async (code) => {
    const { data, error: e } = await supabase.rpc('accept_household_invite', { p_code: code })
    if (e || !data) return { ok: false, error: errorMessage(e) }
    await refresh()
    return { ok: true, data }
  }, [refresh])

  const value = useMemo<MembershipState>(() => ({
    status, error, memberships, activeId, needsChoice, select, refresh, createHousehold, acceptInvite,
  }), [status, error, memberships, activeId, needsChoice, select, refresh, createHousehold, acceptInvite])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMemberships(): MembershipState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMemberships must be used inside <MembershipProvider>')
  return ctx
}
