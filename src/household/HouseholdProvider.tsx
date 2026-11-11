import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { useToast } from '@/components/Toast'
import type { HouseholdMemberRow, HouseholdRow, ItemAssigneeRow, ItemRow, ProfileRow, RoomRow } from '@/lib/database.types'
import { toItem, type Household, type Item, type Member, type Profile, type Room } from '@/lib/domain'
import { errorMessage, supabase } from '@/lib/supabase'

export type LoadState = 'loading' | 'no-household' | 'ready' | 'error'
export type SyncState = 'connecting' | 'live' | 'reconnecting'

export type ItemPatch = Partial<
  Pick<
    Item,
    | 'name'
    | 'description'
    | 'priority'
    | 'status'
    | 'ownership'
    | 'owner_user_id'
    | 'is_complete'
    | 'estimated_price'
    | 'actual_price'
    | 'shopping_url'
    | 'notes'
    | 'room_id'
    | 'sort_order'
  >
>
export type ItemInput = ItemPatch & Pick<Item, 'name' | 'room_id'>
export type RoomPatch = Partial<Pick<Room, 'name' | 'icon' | 'color' | 'sort_order'>>
export type ProfilePatch = Partial<Pick<Profile, 'display_name' | 'avatar_path' | 'accent_color' | 'icon' | 'tour_completed_at'>>

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string }

interface HouseholdState {
  state: LoadState
  loadError: string | null
  sync: SyncState
  me: Profile | null
  household: Household | null
  members: Member[]
  rooms: Room[]
  items: Item[]
  memberById: Map<string, Member>
  reload: () => Promise<void>
  // Items
  createItem: (input: ItemInput) => Promise<Result<Item>>
  updateItem: (id: string, patch: ItemPatch) => Promise<Result<Item>>
  deleteItem: (id: string) => Promise<Result>
  /** Replace who is responsible for an item (0 = unclaimed, 2+ = shared). Optimistic. */
  setAssignees: (itemId: string, userIds: string[]) => Promise<Result>
  // Rooms
  createRoom: (input: { name: string; icon: string; color: string }) => Promise<Result<Room>>
  updateRoom: (id: string, patch: RoomPatch) => Promise<Result>
  deleteRoom: (id: string) => Promise<Result>
  reorderRooms: (orderedIds: string[]) => Promise<Result>
  // Profile & household
  updateProfile: (patch: ProfilePatch) => Promise<Result>
  updateHousehold: (patch: { name?: string; address?: string | null }) => Promise<Result>
  /** Upload (or remove, with null) the shared household photo. */
  setHouseholdPhoto: (photo: Blob | null, ext?: 'webp' | 'jpg') => Promise<Result>
  createHousehold: (name: string, address: string) => Promise<Result<string>>
  acceptInvite: (code: string) => Promise<Result<string>>
}

const HouseholdContext = createContext<HouseholdState | null>(null)
const ACTIVE_KEY = 'flatquest.activeHousehold'

function byOrder<T extends { sort_order: number; created_at: string }>(a: T, b: T) {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const toast = useToast()
  const userId = user?.id ?? null

  const [state, setState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncState>('connecting')
  const [me, setMe] = useState<Profile | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [memberRows, setMemberRows] = useState<HouseholdMemberRow[]>([])
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [rooms, setRooms] = useState<Room[]>([])
  const [rawItems, setItems] = useState<Item[]>([])
  /** itemId → assigned user ids (source of truth: item_assignees). */
  const [assignments, setAssignments] = useState<Map<string, string[]>>(new Map())

  /** Items with in-flight writes: realtime echoes for these are ignored until the write settles. */
  const pending = useRef(new Map<string, number>())
  /** Items whose assignees are mid-write. */
  const pendingAssign = useRef(new Map<string, number>())
  const householdIdRef = useRef<string | null>(null)
  const lastLoad = useRef(0)

  const markPending = (id: string, delta: 1 | -1) => {
    const n = (pending.current.get(id) ?? 0) + delta
    if (n <= 0) pending.current.delete(id)
    else pending.current.set(id, n)
  }

  const loadHouseholdData = useCallback(async (householdId: string) => {
    const [hh, mem, rms, its, asg] = await Promise.all([
      supabase.from('households').select('*').eq('id', householdId).single(),
      supabase.from('household_members').select('*').eq('household_id', householdId),
      supabase.from('rooms').select('*').eq('household_id', householdId).order('sort_order'),
      supabase.from('items').select('*').eq('household_id', householdId).order('sort_order'),
      supabase.from('item_assignees').select('*').eq('household_id', householdId).order('created_at'),
    ])
    const err = hh.error ?? mem.error ?? rms.error ?? its.error ?? asg.error
    if (err) throw err
    const ids = (mem.data ?? []).map((m) => m.user_id)
    const prof = ids.length ? await supabase.from('profiles').select('*').in('id', ids) : { data: [], error: null }
    if (prof.error) throw prof.error

    setHousehold(hh.data)
    setMemberRows(mem.data ?? [])
    setProfiles(new Map((prof.data ?? []).map((p) => [p.id, p])))
    setRooms([...(rms.data ?? [])].sort(byOrder))
    setAssignments((prev) => {
      const next = new Map<string, string[]>()
      for (const a of asg.data ?? []) next.set(a.item_id, [...(next.get(a.item_id) ?? []), a.user_id])
      // Keep optimistic assignee lists for items mid-write.
      for (const id of pendingAssign.current.keys()) {
        const local = prev.get(id)
        if (local) next.set(id, local)
        else next.delete(id)
      }
      return next
    })
    // Keep optimistic values for items that are mid-write.
    setItems((prev) => {
      const prevById = new Map(prev.map((i) => [i.id, i]))
      return (its.data ?? []).map((row) => {
        const local = prevById.get(row.id)
        return local && pending.current.has(row.id) ? local : toItem(row)
      })
    })
  }, [])

  const load = useCallback(async () => {
    if (!userId) return
    lastLoad.current = Date.now()
    try {
      const [{ data: profile, error: pErr }, { data: memberships, error: mErr }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('household_members').select('household_id, joined_at').eq('user_id', userId).order('joined_at'),
      ])
      if (pErr ?? mErr) throw pErr ?? mErr
      setMe(profile)
      if (!memberships || memberships.length === 0) {
        householdIdRef.current = null
        setHousehold(null)
        setState('no-household')
        return
      }
      let preferred: string | null = null
      try {
        preferred = localStorage.getItem(ACTIVE_KEY)
      } catch {
        /* storage unavailable */
      }
      const chosen = memberships.find((m) => m.household_id === preferred) ?? memberships[0]!
      householdIdRef.current = chosen.household_id
      await loadHouseholdData(chosen.household_id)
      setLoadError(null)
      setState('ready')
    } catch (e) {
      setLoadError(errorMessage(e))
      setState((s) => (s === 'ready' ? s : 'error'))
    }
  }, [userId, loadHouseholdData])

  // Initial load whenever the signed-in user changes.
  // (The provider is keyed by user id, so a different user always gets fresh state.)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is only set after the request resolves
    if (userId) void load()
  }, [userId, load])

  // Realtime subscription for the active household.
  const householdId = household?.id ?? null
  useEffect(() => {
    if (!householdId || !userId) return
    let hadError = false
    let channel: RealtimeChannel | null = supabase.channel(`household:${householdId}`)

    const onItem = (payload: RealtimePostgresChangesPayload<ItemRow>) => {
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as Partial<ItemRow>).id
        if (id) setItems((prev) => prev.filter((i) => i.id !== id))
        return
      }
      const row = payload.new as ItemRow
      if (row.household_id !== householdId || pending.current.has(row.id)) return
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === row.id)
        if (idx === -1) return [...prev, toItem(row)]
        const next = prev.slice()
        next[idx] = toItem(row)
        return next
      })
    }
    const onRoom = (payload: RealtimePostgresChangesPayload<RoomRow>) => {
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as Partial<RoomRow>).id
        if (id) {
          setRooms((prev) => prev.filter((r) => r.id !== id))
          setItems((prev) => prev.filter((i) => i.room_id !== id))
        }
        return
      }
      const row = payload.new as RoomRow
      if (row.household_id !== householdId) return
      setRooms((prev) => {
        const without = prev.filter((r) => r.id !== row.id)
        return [...without, row].sort(byOrder)
      })
    }
    const onProfile = (payload: RealtimePostgresChangesPayload<ProfileRow>) => {
      if (payload.eventType === 'DELETE') return
      const row = payload.new as ProfileRow
      setProfiles((prev) => (prev.has(row.id) ? new Map(prev).set(row.id, row) : prev))
      if (row.id === userId) setMe(row)
    }
    const onAssignee = (payload: RealtimePostgresChangesPayload<ItemAssigneeRow>) => {
      const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<ItemAssigneeRow>
      const itemId = row.item_id
      const uid = row.user_id
      if (!itemId || !uid || pendingAssign.current.has(itemId)) return
      if (payload.eventType === 'INSERT' && row.household_id !== householdId) return
      setAssignments((prev) => {
        const current = prev.get(itemId) ?? []
        const has = current.includes(uid)
        if (payload.eventType === 'DELETE' ? !has : has) return prev
        const next = new Map(prev)
        next.set(itemId, payload.eventType === 'DELETE' ? current.filter((u) => u !== uid) : [...current, uid])
        return next
      })
    }
    const onHousehold = (payload: RealtimePostgresChangesPayload<HouseholdRow>) => {
      if (payload.eventType !== 'UPDATE') return
      const row = payload.new as HouseholdRow
      if (row.id === householdId) setHousehold(row)
    }
    const onMember = () => {
      // Membership changes are rare; refetch so profiles come along too.
      void loadHouseholdData(householdId).catch(() => undefined)
    }

    channel = channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `household_id=eq.${householdId}` }, onItem)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `household_id=eq.${householdId}` }, onRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onProfile)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'item_assignees', filter: `household_id=eq.${householdId}` },
        onAssignee,
      )
      // DELETE events can't be filtered server-side; they only carry the primary key.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'item_assignees' }, onAssignee)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` }, onHousehold)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${householdId}` },
        onMember,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setSync('live')
          // Anything could have changed while disconnected: resync.
          if (hadError) void loadHouseholdData(householdId).catch(() => undefined)
          hadError = false
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadError = true
          setSync('reconnecting')
        }
      })

    return () => {
      if (channel) void supabase.removeChannel(channel)
      setSync('connecting')
    }
  }, [householdId, userId, loadHouseholdData])

  // Refresh stale data when returning to the app or coming back online.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastLoad.current < 30_000) return
      void load()
    }
    const online = () => void load()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', online)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', online)
    }
  }, [load])

  // ---------------------------------------------------------------- items
  const createItem = useCallback<HouseholdState['createItem']>(
    async (input) => {
      const hid = householdIdRef.current
      if (!hid) return { ok: false, error: 'No household' }
      const maxOrder = rawItems.filter((i) => i.room_id === input.room_id).reduce((m, i) => Math.max(m, i.sort_order), -1)
      const { data, error } = await supabase
        .from('items')
        .insert({ ...input, household_id: hid, sort_order: maxOrder + 1 })
        .select()
        .single()
      if (error || !data) return { ok: false, error: errorMessage(error) }
      const item = toItem(data)
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]))
      return { ok: true, data: item }
    },
    [rawItems],
  )

  const itemsRef = useRef(rawItems)
  useEffect(() => {
    itemsRef.current = rawItems
  }, [rawItems])
  const assignmentsRef = useRef(assignments)
  useEffect(() => {
    assignmentsRef.current = assignments
  }, [assignments])

  const setAssignees = useCallback<HouseholdState['setAssignees']>(async (itemId, userIds) => {
    const before = assignmentsRef.current.get(itemId) ?? []
    const unique = [...new Set(userIds)]
    const n = (pendingAssign.current.get(itemId) ?? 0) + 1
    pendingAssign.current.set(itemId, n)
    setAssignments((prev) => new Map(prev).set(itemId, unique))
    const { error } = await supabase.rpc('set_item_assignees', { p_item: itemId, p_users: unique })
    const left = (pendingAssign.current.get(itemId) ?? 1) - 1
    if (left <= 0) pendingAssign.current.delete(itemId)
    else pendingAssign.current.set(itemId, left)
    if (error) {
      setAssignments((prev) => new Map(prev).set(itemId, before))
      return { ok: false, error: errorMessage(error, 'Couldn’t update who’s on it.') }
    }
    if (unique.length > 0) {
      setItems((prev) => prev.map((i) => (i.id === itemId && i.needs_assignees ? { ...i, needs_assignees: false } : i)))
    }
    return { ok: true, data: undefined }
  }, [])

  const updateItem = useCallback<HouseholdState['updateItem']>(async (id, patch) => {
    const before = itemsRef.current.find((i) => i.id === id)
    if (!before) return { ok: false, error: 'This item no longer exists.' }
    const previous: ItemPatch = {}
    for (const k of Object.keys(patch) as (keyof ItemPatch)[]) {
      ;(previous as Record<string, unknown>)[k] = before[k]
    }
    markPending(id, 1)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
    const { data, error } = await supabase.from('items').update(patch).eq('id', id).select().single()
    markPending(id, -1)
    if (error || !data) {
      // Roll back only the fields this write touched.
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...previous } : i)))
      return { ok: false, error: errorMessage(error, 'Couldn’t save that change.') }
    }
    const item = toItem(data)
    if (!pending.current.has(id)) setItems((prev) => prev.map((i) => (i.id === id ? item : i)))
    return { ok: true, data: item }
  }, [])

  const deleteItem = useCallback<HouseholdState['deleteItem']>(async (id) => {
    const before = itemsRef.current.find((i) => i.id === id)
    if (!before) return { ok: true, data: undefined }
    markPending(id, 1)
    setItems((prev) => prev.filter((i) => i.id !== id))
    const { error } = await supabase.from('items').delete().eq('id', id)
    markPending(id, -1)
    if (error) {
      setItems((prev) => (prev.some((i) => i.id === id) ? prev : [...prev, before]))
      return { ok: false, error: errorMessage(error, 'Couldn’t delete that item.') }
    }
    return { ok: true, data: undefined }
  }, [])

  // ---------------------------------------------------------------- rooms
  const createRoom = useCallback<HouseholdState['createRoom']>(
    async (input) => {
      const hid = householdIdRef.current
      if (!hid) return { ok: false, error: 'No household' }
      const sort_order = rooms.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1
      const { data, error } = await supabase
        .from('rooms')
        .insert({ ...input, household_id: hid, sort_order })
        .select()
        .single()
      if (error || !data) return { ok: false, error: errorMessage(error) }
      setRooms((prev) => (prev.some((r) => r.id === data.id) ? prev : [...prev, data].sort(byOrder)))
      return { ok: true, data }
    },
    [rooms],
  )

  const updateRoom = useCallback<HouseholdState['updateRoom']>(async (id, patch) => {
    const { data, error } = await supabase.from('rooms').update(patch).eq('id', id).select().single()
    if (error || !data) return { ok: false, error: errorMessage(error) }
    setRooms((prev) => prev.map((r) => (r.id === id ? data : r)).sort(byOrder))
    return { ok: true, data: undefined }
  }, [])

  const deleteRoom = useCallback<HouseholdState['deleteRoom']>(async (id) => {
    const { error } = await supabase.from('rooms').delete().eq('id', id)
    if (error) return { ok: false, error: errorMessage(error) }
    setRooms((prev) => prev.filter((r) => r.id !== id))
    setItems((prev) => prev.filter((i) => i.room_id !== id))
    return { ok: true, data: undefined }
  }, [])

  const reorderRooms = useCallback<HouseholdState['reorderRooms']>(
    async (orderedIds) => {
      const previous = rooms
      const next = orderedIds
        .map((id, idx) => {
          const r = previous.find((x) => x.id === id)
          return r ? { ...r, sort_order: idx } : null
        })
        .filter((r): r is Room => r !== null)
      setRooms(next)
      const changed = next.filter((r) => previous.find((p) => p.id === r.id)?.sort_order !== r.sort_order)
      const results = await Promise.all(
        changed.map((r) => supabase.from('rooms').update({ sort_order: r.sort_order }).eq('id', r.id)),
      )
      const failed = results.find((r) => r.error)
      if (failed) {
        setRooms(previous)
        return { ok: false, error: errorMessage(failed.error) }
      }
      return { ok: true, data: undefined }
    },
    [rooms],
  )

  // ---------------------------------------------------------------- profile / household
  const updateProfile = useCallback<HouseholdState['updateProfile']>(
    async (patch) => {
      if (!userId) return { ok: false, error: 'Not signed in' }
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select().single()
      if (error || !data) return { ok: false, error: errorMessage(error) }
      setMe(data)
      setProfiles((prev) => (prev.has(data.id) ? new Map(prev).set(data.id, data) : prev))
      return { ok: true, data: undefined }
    },
    [userId],
  )

  const updateHousehold = useCallback<HouseholdState['updateHousehold']>(async (patch) => {
    const hid = householdIdRef.current
    if (!hid) return { ok: false, error: 'No household' }
    const { data, error } = await supabase.from('households').update(patch).eq('id', hid).select().single()
    if (error || !data) return { ok: false, error: errorMessage(error) }
    setHousehold(data)
    return { ok: true, data: undefined }
  }, [])

  const setHouseholdPhoto = useCallback<HouseholdState['setHouseholdPhoto']>(async (photo, ext = 'webp') => {
    const hid = householdIdRef.current
    if (!hid) return { ok: false, error: 'No household' }
    let newPath: string | null = null
    if (photo) {
      newPath = `${hid}/photo-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('household-media')
        .upload(newPath, photo, { contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg', upsert: false })
      if (upErr) return { ok: false, error: errorMessage(upErr, 'Couldn’t upload that photo.') }
    }
    const { data: oldPath, error } = await supabase.rpc('set_household_photo', { p_household: hid, p_path: newPath })
    if (error) {
      if (newPath) await supabase.storage.from('household-media').remove([newPath])
      return { ok: false, error: errorMessage(error, 'Couldn’t save the photo.') }
    }
    if (oldPath && oldPath !== newPath) void supabase.storage.from('household-media').remove([oldPath])
    setHousehold((h) => (h ? { ...h, photo_path: newPath } : h))
    return { ok: true, data: undefined }
  }, [])

  const createHousehold = useCallback<HouseholdState['createHousehold']>(
    async (name, address) => {
      const { data, error } = await supabase.rpc('create_household', { p_name: name, p_address: address })
      if (error || !data) return { ok: false, error: errorMessage(error) }
      try {
        localStorage.setItem(ACTIVE_KEY, data)
      } catch {
        /* ignore */
      }
      await load()
      return { ok: true, data }
    },
    [load],
  )

  const acceptInvite = useCallback<HouseholdState['acceptInvite']>(
    async (code) => {
      const { data, error } = await supabase.rpc('accept_household_invite', { p_code: code })
      if (error || !data) return { ok: false, error: errorMessage(error) }
      try {
        localStorage.setItem(ACTIVE_KEY, data)
      } catch {
        /* ignore */
      }
      await load()
      return { ok: true, data }
    },
    [load],
  )

  const members = useMemo<Member[]>(() => {
    return memberRows
      .map((m) => {
        const profile = profiles.get(m.user_id)
        if (!profile) return null
        return {
          userId: m.user_id,
          role: m.role === 'owner' ? 'owner' : 'member',
          joinedAt: m.joined_at,
          profile,
        } satisfies Member
      })
      .filter((m): m is Member => m !== null)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
  }, [memberRows, profiles])

  const memberById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  // Items carry their assignees (only current members, in join order of assignment).
  const items = useMemo<Item[]>(
    () =>
      rawItems.map((i) => {
        const a = assignments.get(i.id) ?? []
        return a === i.assignees ? i : { ...i, assignees: a }
      }),
    [rawItems, assignments],
  )

  const reload = useCallback(async () => {
    await load()
  }, [load])

  // Surface background sync failures once rather than silently.
  const lastError = useRef<string | null>(null)
  useEffect(() => {
    if (state === 'ready' && loadError && loadError !== lastError.current) toast.error(loadError)
    lastError.current = loadError
  }, [loadError, state, toast])

  const value = useMemo<HouseholdState>(
    () => ({
      state,
      loadError,
      sync,
      me,
      household,
      members,
      rooms,
      items,
      memberById,
      reload,
      createItem,
      updateItem,
      deleteItem,
      setAssignees,
      createRoom,
      updateRoom,
      deleteRoom,
      reorderRooms,
      updateProfile,
      updateHousehold,
      setHouseholdPhoto,
      createHousehold,
      acceptInvite,
    }),
    [
      state,
      loadError,
      sync,
      me,
      household,
      members,
      rooms,
      items,
      memberById,
      reload,
      createItem,
      updateItem,
      deleteItem,
      setAssignees,
      createRoom,
      updateRoom,
      deleteRoom,
      reorderRooms,
      updateProfile,
      updateHousehold,
      setHouseholdPhoto,
      createHousehold,
      acceptInvite,
    ],
  )

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

/** Remounts the household store whenever the signed-in user changes. */
export function UserScopedHouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return <HouseholdProvider key={user?.id ?? 'signed-out'}>{children}</HouseholdProvider>
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold must be used inside <HouseholdProvider>')
  return ctx
}
