import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { useHousehold } from '@/household/HouseholdProvider'
import type { ItemPurchaseRow, ItemRow, ProductOptionRow, ProductPreferenceRow, PurchaseCoordinatorRow } from '@/lib/database.types'
import type { Status } from '@/lib/domain'
import type { ProductOption, Purchase } from '@/lib/shopping'
import { errorMessage, supabase } from '@/lib/supabase'

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean }

export type OptionInput = Pick<ProductOptionRow, 'name'> &
  Partial<Pick<ProductOptionRow, 'retailer' | 'price' | 'url' | 'photo_path' | 'notes' | 'width_cm' | 'depth_cm' | 'height_cm'>>

export type PurchaseInput = Pick<
  ItemPurchaseRow,
  | 'option_id'
  | 'purchased_by'
  | 'purchased_on'
  | 'order_reference'
  | 'notes'
  | 'delivery_method'
  | 'expected_on'
  | 'tracking_url'
  | 'delivery_notes'
  | 'arrived_on'
>

export interface PurchaseSaveOptions {
  /** item_purchases.updated_at the form opened with; null = there was no record. */
  expectedVersion: string | null
  /** Set to change the item's stage in the same transaction. */
  status?: { to: Status; from: Status }
  /** Set to change the amount paid (items.actual_price) in the same transaction. */
  amount?: { to: number | null; from: number | null }
}

interface ShoppingState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  optionsByItem: Map<string, ProductOption[]>
  optionById: Map<string, ProductOption>
  preferencesByItem: Map<string, ProductPreferenceRow[]>
  coordinatorByItem: Map<string, PurchaseCoordinatorRow>
  purchaseByItem: Map<string, Purchase>
  reload: () => Promise<void>
  // Options
  addOption: (itemId: string, input: OptionInput) => Promise<Result<ProductOption>>
  updateOption: (id: string, patch: Partial<OptionInput>, expectedVersion: string) => Promise<Result<ProductOption>>
  deleteOption: (id: string) => Promise<Result>
  uploadPhoto: (itemId: string, blob: Blob, ext: 'webp' | 'jpg') => Promise<Result<string>>
  removeFiles: (paths: string[]) => Promise<void>
  /** Stored photo paths for an item's options (to clean up when the item itself is deleted). */
  photoPathsForItem: (itemId: string) => string[]
  // Preferences and the household's decision
  setPreference: (itemId: string, optionId: string | null) => Promise<Result>
  chooseOption: (itemId: string, optionId: string | null) => Promise<Result>
  // Purchase coordination
  claim: (itemId: string) => Promise<Result>
  release: (itemId: string) => Promise<Result>
  handOver: (itemId: string, toUserId: string) => Promise<Result>
  takeOver: (itemId: string, fromUserId: string) => Promise<Result>
  // Purchase and delivery
  savePurchase: (itemId: string, input: PurchaseInput, options: PurchaseSaveOptions) => Promise<Result<Purchase>>
}

const Ctx = createContext<ShoppingState | null>(null)

const OFFLINE = 'You’re offline. Reconnect before saving changes.'
const BUSY = 'That’s still saving. Try again in a moment.'

function numeric<T extends ProductOptionRow>(row: T): T {
  return {
    ...row,
    price: row.price == null ? null : Number(row.price),
    width_cm: row.width_cm == null ? null : Number(row.width_cm),
    depth_cm: row.depth_cm == null ? null : Number(row.depth_cm),
    height_cm: row.height_cm == null ? null : Number(row.height_cm),
  }
}

function upsertBy<T>(list: T[], row: T, same: (a: T) => boolean): T[] {
  return list.some(same) ? list.map((x) => (same(x) ? row : x)) : [...list, row]
}

export function ShoppingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { household, applyItemRow } = useHousehold()
  const hid = household?.id ?? null
  const me = user?.id ?? null

  const [status, setStatus] = useState<ShoppingState['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<ProductOption[]>([])
  const [preferences, setPreferences] = useState<ProductPreferenceRow[]>([])
  const [coordinators, setCoordinators] = useState<PurchaseCoordinatorRow[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])

  /** Keys with a write in flight: realtime echoes and refetches leave these alone until it settles. */
  const busy = useRef(new Set<string>())
  const lastLoad = useRef(0)
  const generation = useRef(0)

  const optionsRef = useRef(options)
  const preferencesRef = useRef(preferences)
  const coordinatorsRef = useRef(coordinators)
  useEffect(() => {
    optionsRef.current = options
    preferencesRef.current = preferences
    coordinatorsRef.current = coordinators
  }, [options, preferences, coordinators])

  const load = useCallback(async () => {
    if (!hid) return
    const request = ++generation.current
    lastLoad.current = Date.now()
    const [opt, pref, coord, pur] = await Promise.all([
      supabase.from('product_options').select('*').eq('household_id', hid).order('created_at'),
      supabase.from('product_preferences').select('*').eq('household_id', hid).order('updated_at'),
      supabase.from('purchase_coordinators').select('*').eq('household_id', hid),
      supabase.from('item_purchases').select('*').eq('household_id', hid),
    ])
    if (request !== generation.current) return
    const err = opt.error ?? pref.error ?? coord.error ?? pur.error
    if (err) {
      setError(errorMessage(err, 'Couldn’t load shopping details.'))
      setStatus((s) => (s === 'ready' ? s : 'error'))
      return
    }
    // Keep local (optimistic) rows for anything mid-write.
    setOptions((prev) => {
      const fresh = (opt.data ?? []).map(numeric)
      const held = prev.filter((o) => busy.current.has(`option:${o.id}`) || busy.current.has(`choose:${o.item_id}`))
      const heldIds = new Set(held.map((o) => o.id))
      return [...fresh.filter((o) => !heldIds.has(o.id) && !busy.current.has(`choose:${o.item_id}`)), ...held]
    })
    setPreferences((prev) => {
      const mine = (p: ProductPreferenceRow) => p.user_id === me && busy.current.has(`prefer:${p.item_id}`)
      const pendingItems = new Set([...busy.current].filter((k) => k.startsWith('prefer:')).map((k) => k.slice(7)))
      return [...(pref.data ?? []).filter((p) => !(p.user_id === me && pendingItems.has(p.item_id))), ...prev.filter(mine)]
    })
    setCoordinators(coord.data ?? [])
    setPurchases(pur.data ?? [])
    setError(null)
    setStatus('ready')
  }, [hid, me])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is only set after the request resolves
    void load()
  }, [load])

  // Stale data: refetch when returning to the app or coming back online.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > 30_000) void load()
    }
    const online = () => void load()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', online)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', online)
    }
  }, [load])

  // Realtime: everything flatmates do to options, preferences, coordination and purchases.
  useEffect(() => {
    if (!hid) return
    let hadError = false
    const onOption = (p: RealtimePostgresChangesPayload<ProductOptionRow>) => {
      if (p.eventType === 'DELETE') {
        const id = (p.old as Partial<ProductOptionRow>).id
        if (id) setOptions((prev) => prev.filter((o) => o.id !== id))
        return
      }
      const row = numeric(p.new as ProductOptionRow)
      if (row.household_id !== hid || busy.current.has(`option:${row.id}`) || busy.current.has(`choose:${row.item_id}`)) return
      setOptions((prev) => upsertBy(prev, row, (o) => o.id === row.id))
    }
    const onPreference = (p: RealtimePostgresChangesPayload<ProductPreferenceRow>) => {
      const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<ProductPreferenceRow>
      if (!row.item_id || !row.user_id) return
      if (row.user_id === me && busy.current.has(`prefer:${row.item_id}`)) return
      const same = (x: ProductPreferenceRow) => x.item_id === row.item_id && x.user_id === row.user_id
      if (p.eventType === 'DELETE') setPreferences((prev) => prev.filter((x) => !same(x)))
      else if (row.household_id === hid) setPreferences((prev) => upsertBy(prev, row as ProductPreferenceRow, same))
    }
    const onCoordinator = (p: RealtimePostgresChangesPayload<PurchaseCoordinatorRow>) => {
      const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<PurchaseCoordinatorRow>
      if (!row.item_id || busy.current.has(`coordinate:${row.item_id}`)) return
      if (p.eventType === 'DELETE') setCoordinators((prev) => prev.filter((c) => c.item_id !== row.item_id))
      else if (row.household_id === hid) setCoordinators((prev) => upsertBy(prev, row as PurchaseCoordinatorRow, (c) => c.item_id === row.item_id))
    }
    const onPurchase = (p: RealtimePostgresChangesPayload<ItemPurchaseRow>) => {
      const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<ItemPurchaseRow>
      if (!row.item_id || busy.current.has(`purchase:${row.item_id}`)) return
      if (p.eventType === 'DELETE') setPurchases((prev) => prev.filter((x) => x.item_id !== row.item_id))
      else if (row.household_id === hid) setPurchases((prev) => upsertBy(prev, row as ItemPurchaseRow, (x) => x.item_id === row.item_id))
    }
    const filter = `household_id=eq.${hid}`
    const channel = supabase
      .channel(`shopping:${hid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_options', filter }, onOption)
      // DELETE events only carry the primary key, so they can't be filtered by household.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'product_options' }, onOption)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_preferences', filter }, onPreference)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'product_preferences' }, onPreference)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_coordinators', filter }, onCoordinator)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'purchase_coordinators' }, onCoordinator)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_purchases', filter }, onPurchase)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'item_purchases' }, onPurchase)
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          // Anything could have changed while disconnected.
          if (hadError) void load()
          hadError = false
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') hadError = true
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hid, me, load])

  /** Runs one write per key at a time; a second tap while saving is refused, not queued. */
  const exclusive = useCallback(async <T,>(key: string, run: () => Promise<Result<T>>): Promise<Result<T>> => {
    if (!navigator.onLine) return { ok: false, error: OFFLINE }
    if (busy.current.has(key)) return { ok: false, error: BUSY }
    busy.current.add(key)
    try {
      return await run()
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    } finally {
      busy.current.delete(key)
    }
  }, [])

  // ---------------------------------------------------------------- options
  const removeFiles = useCallback(async (paths: string[]) => {
    if (paths.length > 0) await supabase.storage.from('household-media').remove(paths)
  }, [])

  const uploadPhoto = useCallback<ShoppingState['uploadPhoto']>(
    async (itemId, blob, ext) => {
      if (!hid) return { ok: false, error: 'No household' }
      if (!navigator.onLine) return { ok: false, error: OFFLINE }
      const path = `${hid}/products/${itemId}-${Date.now()}.${ext}`
      const { error: err } = await supabase.storage
        .from('household-media')
        .upload(path, blob, { contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg', upsert: false })
      if (err) return { ok: false, error: errorMessage(err, 'Couldn’t upload that photo.') }
      return { ok: true, data: path }
    },
    [hid],
  )

  const addOption = useCallback<ShoppingState['addOption']>(
    (itemId, input) =>
      exclusive(`add:${itemId}`, async () => {
        if (!hid) return { ok: false, error: 'No household' }
        const { data, error: err } = await supabase
          .from('product_options')
          .insert({ ...input, household_id: hid, item_id: itemId })
          .select()
          .single()
        if (err || !data) return { ok: false, error: errorMessage(err, 'Couldn’t add that option.') }
        const row = numeric(data)
        setOptions((prev) => upsertBy(prev, row, (o) => o.id === row.id))
        return { ok: true, data: row }
      }),
    [hid, exclusive],
  )

  const updateOption = useCallback<ShoppingState['updateOption']>(
    (id, patch, expectedVersion) =>
      exclusive(`option:${id}`, async () => {
        // The version filter makes the write a no-op if a flatmate saved first.
        const { data, error: err } = await supabase
          .from('product_options')
          .update(patch)
          .eq('id', id)
          .eq('updated_at', expectedVersion)
          .select()
          .maybeSingle()
        if (err) return { ok: false, error: errorMessage(err, 'Couldn’t save that option.') }
        if (!data) {
          void load()
          return { ok: false, conflict: true, error: 'Someone changed this option while you were editing. Your draft is still here: close and reopen it to see the latest.' }
        }
        const row = numeric(data)
        setOptions((prev) => upsertBy(prev, row, (o) => o.id === row.id))
        return { ok: true, data: row }
      }),
    [exclusive, load],
  )

  const deleteOption = useCallback<ShoppingState['deleteOption']>(
    (id) =>
      exclusive(`option:${id}`, async () => {
        const before = optionsRef.current.find((o) => o.id === id)
        if (!before) return { ok: true, data: undefined }
        const beforePrefs = preferencesRef.current.filter((p) => p.option_id === id)
        setOptions((prev) => prev.filter((o) => o.id !== id))
        setPreferences((prev) => prev.filter((p) => p.option_id !== id))
        const { error: err } = await supabase.from('product_options').delete().eq('id', id)
        if (err) {
          setOptions((prev) => upsertBy(prev, before, (o) => o.id === id))
          setPreferences((prev) => [...prev.filter((p) => p.option_id !== id), ...beforePrefs])
          return { ok: false, error: errorMessage(err, 'Couldn’t remove that option.') }
        }
        setPurchases((prev) => prev.map((p) => (p.option_id === id ? { ...p, option_id: null } : p)))
        if (before.photo_path) void removeFiles([before.photo_path])
        return { ok: true, data: undefined }
      }),
    [exclusive, removeFiles],
  )

  const photoPathsForItem = useCallback(
    (itemId: string) => optionsRef.current.filter((o) => o.item_id === itemId && o.photo_path).map((o) => o.photo_path!),
    [],
  )

  // ---------------------------------------------------------------- preferences
  const setPreference = useCallback<ShoppingState['setPreference']>(
    (itemId, optionId) =>
      exclusive(`prefer:${itemId}`, async () => {
        if (!me || !hid) return { ok: false, error: 'Not signed in' }
        const same = (p: ProductPreferenceRow) => p.item_id === itemId && p.user_id === me
        const before = preferencesRef.current.find(same) ?? null
        if ((before?.option_id ?? null) === optionId) return { ok: true, data: undefined }
        const now = new Date().toISOString()
        const optimistic: ProductPreferenceRow | null = optionId
          ? { item_id: itemId, user_id: me, household_id: hid, option_id: optionId, created_at: before?.created_at ?? now, updated_at: now }
          : null
        setPreferences((prev) => [...prev.filter((p) => !same(p)), ...(optimistic ? [optimistic] : [])])
        const rollback = () => setPreferences((prev) => [...prev.filter((p) => !same(p)), ...(before ? [before] : [])])

        if (!optionId) {
          const { error: err } = await supabase.from('product_preferences').delete().eq('item_id', itemId).eq('user_id', me)
          if (err) {
            rollback()
            return { ok: false, error: errorMessage(err, 'Couldn’t remove your preference.') }
          }
          return { ok: true, data: undefined }
        }
        let res = before
          ? await supabase.from('product_preferences').update({ option_id: optionId }).eq('item_id', itemId).eq('user_id', me).select().maybeSingle()
          : await supabase.from('product_preferences').insert({ item_id: itemId, household_id: hid, option_id: optionId }).select().maybeSingle()
        // One preference per member per item is a database rule. If this device was behind
        // (a preference already exists, or it was removed elsewhere), fall back to the other write.
        if (!before && res.error?.code === '23505') {
          res = await supabase.from('product_preferences').update({ option_id: optionId }).eq('item_id', itemId).eq('user_id', me).select().maybeSingle()
        } else if (before && !res.error && !res.data) {
          res = await supabase.from('product_preferences').insert({ item_id: itemId, household_id: hid, option_id: optionId }).select().maybeSingle()
        }
        if (res.error || !res.data) {
          rollback()
          if (res.error?.code === '23503') void load()
          return {
            ok: false,
            error: res.error?.code === '23503' ? 'That option was just removed.' : errorMessage(res.error, 'Couldn’t save your preference.'),
          }
        }
        const saved = res.data
        setPreferences((prev) => [...prev.filter((p) => !same(p)), saved])
        return { ok: true, data: undefined }
      }),
    [me, hid, exclusive, load],
  )

  const chooseOption = useCallback<ShoppingState['chooseOption']>(
    (itemId, optionId) =>
      exclusive(`choose:${itemId}`, async () => {
        const before = optionsRef.current.filter((o) => o.item_id === itemId)
        const now = new Date().toISOString()
        setOptions((prev) =>
          prev.map((o) =>
            o.item_id !== itemId
              ? o
              : o.id === optionId
                ? { ...o, is_selected: true, selected_at: now, selected_by: me }
                : o.is_selected
                  ? { ...o, is_selected: false, selected_at: null, selected_by: null }
                  : o,
          ),
        )
        const rollback = () => setOptions((prev) => [...prev.filter((o) => o.item_id !== itemId), ...before])
        // Selecting retires the previous pick inside the database (one decided option per item).
        const { data, error: err } = optionId
          ? await supabase.from('product_options').update({ is_selected: true }).eq('id', optionId).select()
          : await supabase.from('product_options').update({ is_selected: false }).eq('item_id', itemId).eq('is_selected', true).select()
        if (err || (optionId && (data ?? []).length === 0)) {
          rollback()
          if (!err) void load()
          return { ok: false, error: err ? errorMessage(err, 'Couldn’t save that choice.') : 'That option was just removed.' }
        }
        // Bring in the authoritative rows for this item (the previous pick changed server-side too).
        const fresh = await supabase.from('product_options').select('*').eq('item_id', itemId).order('created_at')
        if (!fresh.error && fresh.data) {
          const rows = fresh.data.map(numeric)
          setOptions((prev) => [...prev.filter((o) => o.item_id !== itemId), ...rows])
        }
        return { ok: true, data: undefined }
      }),
    [me, exclusive, load],
  )

  // ---------------------------------------------------------------- coordination
  // Not optimistic on purpose: two people can reach for the same purchase, so the
  // interface only says "you're sorting this" once the database has agreed.
  const refreshCoordinator = useCallback(async (itemId: string) => {
    const { data, error: err } = await supabase.from('purchase_coordinators').select('*').eq('item_id', itemId).maybeSingle()
    if (err) return
    setCoordinators((prev) => [...prev.filter((c) => c.item_id !== itemId), ...(data ? [data] : [])])
  }, [])

  const claim = useCallback<ShoppingState['claim']>(
    (itemId) =>
      exclusive(`coordinate:${itemId}`, async () => {
        if (!hid) return { ok: false, error: 'No household' }
        const { data, error: err } = await supabase.from('purchase_coordinators').insert({ item_id: itemId, household_id: hid }).select().maybeSingle()
        if (err || !data) {
          await refreshCoordinator(itemId)
          if (err?.code === '23505') return { ok: false, conflict: true, error: 'Someone else just took this on.' }
          return { ok: false, error: errorMessage(err, 'Couldn’t save that.') }
        }
        setCoordinators((prev) => [...prev.filter((c) => c.item_id !== itemId), data])
        return { ok: true, data: undefined }
      }),
    [hid, exclusive, refreshCoordinator],
  )

  const release = useCallback<ShoppingState['release']>(
    (itemId) =>
      exclusive(`coordinate:${itemId}`, async () => {
        if (!me) return { ok: false, error: 'Not signed in' }
        const { error: err } = await supabase.from('purchase_coordinators').delete().eq('item_id', itemId).eq('user_id', me)
        if (err) return { ok: false, error: errorMessage(err, 'Couldn’t save that.') }
        await refreshCoordinator(itemId)
        return { ok: true, data: undefined }
      }),
    [me, exclusive, refreshCoordinator],
  )

  /** Compare-and-swap: only changes hands if `from` is still the person sorting it. */
  const swap = useCallback(
    (itemId: string, from: string, to: string) =>
      exclusive(`coordinate:${itemId}`, async (): Promise<Result> => {
        const { data, error: err } = await supabase
          .from('purchase_coordinators')
          .update({ user_id: to })
          .eq('item_id', itemId)
          .eq('user_id', from)
          .select()
          .maybeSingle()
        if (err || !data) {
          await refreshCoordinator(itemId)
          if (!err) return { ok: false, conflict: true, error: 'That changed a moment ago. Have another look.' }
          return { ok: false, error: errorMessage(err, 'Couldn’t save that.') }
        }
        setCoordinators((prev) => [...prev.filter((c) => c.item_id !== itemId), data])
        return { ok: true, data: undefined }
      }),
    [exclusive, refreshCoordinator],
  )

  const handOver = useCallback<ShoppingState['handOver']>(
    async (itemId, toUserId) => (me ? swap(itemId, me, toUserId) : { ok: false, error: 'Not signed in' }),
    [me, swap],
  )
  const takeOver = useCallback<ShoppingState['takeOver']>(
    async (itemId, fromUserId) => (me ? swap(itemId, fromUserId, me) : { ok: false, error: 'Not signed in' }),
    [me, swap],
  )

  // ---------------------------------------------------------------- purchase
  const savePurchase = useCallback<ShoppingState['savePurchase']>(
    (itemId, input, opts) =>
      exclusive(`purchase:${itemId}`, async () => {
        const { data, error: err } = await supabase.rpc('save_item_purchase', {
          p_item: itemId,
          p_expected_version: opts.expectedVersion,
          p_option: input.option_id,
          p_purchased_by: input.purchased_by,
          p_purchased_on: input.purchased_on,
          p_order_reference: input.order_reference,
          p_notes: input.notes,
          p_delivery_method: input.delivery_method,
          p_expected_on: input.expected_on,
          p_tracking_url: input.tracking_url,
          p_delivery_notes: input.delivery_notes,
          p_arrived_on: input.arrived_on,
          ...(opts.status ? { p_status: opts.status.to, p_expected_status: opts.status.from } : {}),
          ...(opts.amount ? { p_set_amount: true, p_amount: opts.amount.to, p_expected_amount: opts.amount.from } : {}),
        })
        if (err || !data) {
          if (err?.code === 'FQ409') {
            void load()
            return {
              ok: false,
              conflict: true,
              error: 'Someone updated this while you were editing. Nothing was overwritten: close and reopen it to see the latest.',
            }
          }
          if (err?.code === '23503') return { ok: false, error: 'That product or person is no longer available. Pick another and try again.' }
          return { ok: false, error: errorMessage(err, 'Couldn’t save the purchase.') }
        }
        const { purchase, item } = data as unknown as { purchase: ItemPurchaseRow; item: ItemRow }
        setPurchases((prev) => [...prev.filter((p) => p.item_id !== itemId), purchase])
        applyItemRow(item)
        return { ok: true, data: purchase }
      }),
    [exclusive, load, applyItemRow],
  )

  // ---------------------------------------------------------------- derived
  const optionsByItem = useMemo(() => {
    const map = new Map<string, ProductOption[]>()
    for (const o of [...options].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
      map.set(o.item_id, [...(map.get(o.item_id) ?? []), o])
    }
    return map
  }, [options])
  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const preferencesByItem = useMemo(() => {
    const map = new Map<string, ProductPreferenceRow[]>()
    for (const p of preferences) {
      // Ignore preferences whose option has gone (a delete we haven't heard about yet).
      if (!optionById.has(p.option_id)) continue
      map.set(p.item_id, [...(map.get(p.item_id) ?? []), p])
    }
    return map
  }, [preferences, optionById])
  const coordinatorByItem = useMemo(() => new Map(coordinators.map((c) => [c.item_id, c])), [coordinators])
  const purchaseByItem = useMemo(() => new Map(purchases.map((p) => [p.item_id, p])), [purchases])

  const value = useMemo<ShoppingState>(
    () => ({
      status,
      error,
      optionsByItem,
      optionById,
      preferencesByItem,
      coordinatorByItem,
      purchaseByItem,
      reload: load,
      addOption,
      updateOption,
      deleteOption,
      uploadPhoto,
      removeFiles,
      photoPathsForItem,
      setPreference,
      chooseOption,
      claim,
      release,
      handOver,
      takeOver,
      savePurchase,
    }),
    [
      status,
      error,
      optionsByItem,
      optionById,
      preferencesByItem,
      coordinatorByItem,
      purchaseByItem,
      load,
      addOption,
      updateOption,
      deleteOption,
      uploadPhoto,
      removeFiles,
      photoPathsForItem,
      setPreference,
      chooseOption,
      claim,
      release,
      handOver,
      takeOver,
      savePurchase,
    ],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useShopping(): ShoppingState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useShopping must be used inside <ShoppingProvider>')
  return ctx
}
