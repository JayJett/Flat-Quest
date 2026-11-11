import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import type { Json, WishlistItemRow, WishlistVoteRow } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'
import { useHousehold } from '@/household/HouseholdProvider'
import { bundledWishlist } from './wishlistData'

export interface Idea extends WishlistItemRow {
  /** User ids who voted, oldest first. */
  voters: string[]
}

export type IdeaInput = Pick<WishlistItemRow, 'title'> &
  Partial<Pick<WishlistItemRow, 'room_id' | 'notes' | 'estimated_price' | 'shopping_url' | 'photo_path' | 'is_chosen'>>

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string }

interface WishlistState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  ideas: Idea[]
  reload: () => Promise<void>
  addIdea: (input: IdeaInput) => Promise<Result<Idea>>
  updateIdea: (id: string, patch: Partial<IdeaInput>) => Promise<Result>
  deleteIdea: (id: string) => Promise<Result>
  toggleVote: (id: string) => Promise<Result>
  addToChecklist: (id: string, roomId?: string) => Promise<Result<string>>
  uploadPhoto: (ideaId: string, blob: Blob, ext: 'webp' | 'jpg') => Promise<Result<string>>
  removeFile: (path: string) => Promise<void>
  importOriginal: () => Promise<Result<{ created: number; skipped: number }>>
}

const Ctx = createContext<WishlistState | null>(null)

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { household, reload: reloadHousehold } = useHousehold()
  const hid = household?.id ?? null
  const me = user?.id ?? null
  const [status, setStatus] = useState<WishlistState['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<WishlistItemRow[]>([])
  const [votes, setVotes] = useState<WishlistVoteRow[]>([])
  const pendingVotes = useRef(new Set<string>())

  const load = useCallback(async () => {
    if (!hid) return
    const [ideas, vts] = await Promise.all([
      supabase.from('wishlist_items').select('*').eq('household_id', hid).order('created_at', { ascending: false }),
      supabase.from('wishlist_votes').select('*').eq('household_id', hid).order('created_at'),
    ])
    const err = ideas.error ?? vts.error
    if (err) {
      setError(errorMessage(err))
      setStatus((s) => (s === 'ready' ? s : 'error'))
      return
    }
    setRows(ideas.data ?? [])
    setVotes((prev) => {
      const fresh = vts.data ?? []
      // Keep optimistic votes for ideas mid-write.
      const keep = prev.filter((v) => pendingVotes.current.has(v.idea_id))
      return [...fresh.filter((v) => !pendingVotes.current.has(v.idea_id)), ...keep]
    })
    setError(null)
    setStatus('ready')
  }, [hid])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is only set after the request resolves
    void load()
  }, [load])

  // Realtime: ideas and votes from flatmates.
  useEffect(() => {
    if (!hid) return
    let hadError = false
    const onIdea = (p: RealtimePostgresChangesPayload<WishlistItemRow>) => {
      if (p.eventType === 'DELETE') {
        const id = (p.old as Partial<WishlistItemRow>).id
        if (id) setRows((prev) => prev.filter((r) => r.id !== id))
        return
      }
      const row = p.new as WishlistItemRow
      if (row.household_id !== hid) return
      setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev]))
    }
    const onVote = (p: RealtimePostgresChangesPayload<WishlistVoteRow>) => {
      const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<WishlistVoteRow>
      if (!row.idea_id || !row.user_id || pendingVotes.current.has(row.idea_id)) return
      if (p.eventType === 'INSERT') {
        if (row.household_id !== hid) return
        setVotes((prev) => (prev.some((v) => v.idea_id === row.idea_id && v.user_id === row.user_id) ? prev : [...prev, row as WishlistVoteRow]))
      } else if (p.eventType === 'DELETE') {
        setVotes((prev) => prev.filter((v) => !(v.idea_id === row.idea_id && v.user_id === row.user_id)))
      }
    }
    const channel = supabase
      .channel(`wishlist:${hid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist_items', filter: `household_id=eq.${hid}` }, onIdea)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wishlist_items' }, onIdea)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishlist_votes', filter: `household_id=eq.${hid}` }, onVote)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wishlist_votes' }, onVote)
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          if (hadError) void load()
          hadError = false
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') hadError = true
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hid, load])

  const rowsRef = useRef(rows)
  const votesRef = useRef(votes)
  useEffect(() => {
    rowsRef.current = rows
    votesRef.current = votes
  }, [rows, votes])

  const addIdea = useCallback<WishlistState['addIdea']>(
    async (input) => {
      if (!hid) return { ok: false, error: 'No household' }
      const { data, error: err } = await supabase
        .from('wishlist_items')
        .insert({ ...input, household_id: hid })
        .select()
        .single()
      if (err || !data) return { ok: false, error: errorMessage(err) }
      setRows((prev) => (prev.some((r) => r.id === data.id) ? prev : [data, ...prev]))
      return { ok: true, data: { ...data, voters: [] } }
    },
    [hid],
  )

  const updateIdea = useCallback<WishlistState['updateIdea']>(async (id, patch) => {
    const before = rowsRef.current.find((r) => r.id === id)
    if (!before) return { ok: false, error: 'This idea no longer exists.' }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    const { data, error: err } = await supabase.from('wishlist_items').update(patch).eq('id', id).select().single()
    if (err || !data) {
      setRows((prev) => prev.map((r) => (r.id === id ? before : r)))
      return { ok: false, error: errorMessage(err) }
    }
    setRows((prev) => prev.map((r) => (r.id === id ? data : r)))
    return { ok: true, data: undefined }
  }, [])

  const removeFile = useCallback(async (path: string) => {
    await supabase.storage.from('household-media').remove([path])
  }, [])

  const deleteIdea = useCallback<WishlistState['deleteIdea']>(
    async (id) => {
      const before = rowsRef.current.find((r) => r.id === id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      const { error: err } = await supabase.from('wishlist_items').delete().eq('id', id)
      if (err) {
        if (before) setRows((prev) => [before, ...prev])
        return { ok: false, error: errorMessage(err) }
      }
      if (before?.photo_path) void removeFile(before.photo_path)
      return { ok: true, data: undefined }
    },
    [removeFile],
  )

  const toggleVote = useCallback<WishlistState['toggleVote']>(
    async (id) => {
      if (!me || !hid) return { ok: false, error: 'Not signed in' }
      if (pendingVotes.current.has(id)) return { ok: true, data: undefined }
      const had = votesRef.current.some((v) => v.idea_id === id && v.user_id === me)
      pendingVotes.current.add(id)
      setVotes((prev) =>
        had
          ? prev.filter((v) => !(v.idea_id === id && v.user_id === me))
          : [...prev, { idea_id: id, household_id: hid, user_id: me, created_at: new Date().toISOString() }],
      )
      const { error: err } = had
        ? await supabase.from('wishlist_votes').delete().eq('idea_id', id).eq('user_id', me)
        : await supabase.from('wishlist_votes').insert({ idea_id: id, household_id: hid })
      pendingVotes.current.delete(id)
      if (err && !/duplicate key/i.test(err.message)) {
        setVotes((prev) =>
          had
            ? [...prev, { idea_id: id, household_id: hid, user_id: me, created_at: new Date().toISOString() }]
            : prev.filter((v) => !(v.idea_id === id && v.user_id === me)),
        )
        return { ok: false, error: errorMessage(err, 'Couldn’t save your vote.') }
      }
      return { ok: true, data: undefined }
    },
    [me, hid],
  )

  const addToChecklist = useCallback<WishlistState['addToChecklist']>(
    async (id, roomId) => {
      const { data, error: err } = await supabase.rpc('add_wishlist_to_checklist', { p_idea: id, ...(roomId ? { p_room: roomId } : {}) })
      if (err || !data) return { ok: false, error: errorMessage(err) }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, checklist_item_id: data, is_chosen: true, room_id: roomId ?? r.room_id } : r)))
      // The new checklist item arrives via realtime; reload as a fallback.
      void reloadHousehold()
      return { ok: true, data }
    },
    [reloadHousehold],
  )

  const uploadPhoto = useCallback<WishlistState['uploadPhoto']>(
    async (ideaId, blob, ext) => {
      if (!hid) return { ok: false, error: 'No household' }
      const path = `${hid}/wishlist/${ideaId}-${Date.now()}.${ext}`
      const { error: err } = await supabase.storage
        .from('household-media')
        .upload(path, blob, { contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg', upsert: false })
      if (err) return { ok: false, error: errorMessage(err, 'Couldn’t upload that photo.') }
      return { ok: true, data: path }
    },
    [hid],
  )

  const importOriginal = useCallback<WishlistState['importOriginal']>(async () => {
    if (!hid) return { ok: false, error: 'No household' }
    const { data, error: err } = await supabase.rpc('import_wishlist', {
      p_household: hid,
      p_rows: bundledWishlist() as unknown as Json,
    })
    if (err) return { ok: false, error: errorMessage(err) }
    await load()
    return { ok: true, data: { created: data?.[0]?.ideas_created ?? 0, skipped: data?.[0]?.ideas_skipped ?? 0 } }
  }, [hid, load])

  const ideas = useMemo<Idea[]>(() => {
    const byIdea = new Map<string, string[]>()
    for (const v of votes) byIdea.set(v.idea_id, [...(byIdea.get(v.idea_id) ?? []), v.user_id])
    return rows.map((r) => ({ ...r, voters: byIdea.get(r.id) ?? [] }))
  }, [rows, votes])

  const value = useMemo<WishlistState>(
    () => ({ status, error, ideas, reload: load, addIdea, updateIdea, deleteIdea, toggleVote, addToChecklist, uploadPhoto, removeFile, importOriginal }),
    [status, error, ideas, load, addIdea, updateIdea, deleteIdea, toggleVote, addToChecklist, uploadPhoto, removeFile, importOriginal],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWishlist(): WishlistState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWishlist must be used inside <WishlistProvider>')
  return ctx
}

export type WishSort = 'popular' | 'newest' | 'chosen'

/** Popular = most votes first (ties: newest); Chosen = chosen ideas only. */
export function sortIdeas(ideas: readonly Idea[], sort: WishSort): Idea[] {
  const list = sort === 'chosen' ? ideas.filter((i) => i.is_chosen) : [...ideas]
  return list.sort((a, b) =>
    sort === 'popular' ? b.voters.length - a.voters.length || b.created_at.localeCompare(a.created_at) : b.created_at.localeCompare(a.created_at),
  )
}
