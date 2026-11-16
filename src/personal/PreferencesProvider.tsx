import { useReducedMotion } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { useToast } from '@/components/Toast'
import type { UserPreferencesRow } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'
import { applyAccent, DEFAULT_ACCENT, DEFAULT_LAYOUT, normaliseLayout, type AccentKey, type HomeLayout } from './themes'

export type MotionPref = 'playful' | 'balanced' | 'minimal'
/** What actually plays: the OS "reduce motion" setting always wins over the app setting. */
export type MotionLevel = MotionPref | 'reduced'

export const NOTIFICATION_CATEGORIES = ['discussions', 'assignments', 'shopping', 'home', 'reminders', 'milestones'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export interface Preferences {
  accent: AccentKey
  greetingName: string | null
  motion: MotionPref
  layout: HomeLayout
  /** Notification categories this person has switched off (Phase 8). Empty = everything on. */
  muted: NotificationCategory[]
}

export const DEFAULT_PREFERENCES: Preferences = { accent: DEFAULT_ACCENT, greetingName: null, motion: 'balanced', layout: DEFAULT_LAYOUT, muted: [] }

interface PreferencesState {
  prefs: Preferences
  motion: MotionLevel
  /** True once the saved preferences have been read from the server. */
  synced: boolean
  update: (patch: Partial<Preferences>) => Promise<boolean>
  /** Resets the given settings (all of them when omitted) to their defaults. */
  reset: (keys?: (keyof Preferences)[]) => Promise<boolean>
}

const Ctx = createContext<PreferencesState | null>(null)
const cacheKey = (uid: string) => `flatquest.prefs.${uid}`

function fromRow(row: Pick<UserPreferencesRow, 'accent' | 'greeting_name' | 'motion' | 'home_layout'> & { muted_notifications?: string[] | null }): Preferences {
  return {
    accent: row.accent ?? DEFAULT_ACCENT,
    greetingName: row.greeting_name ?? null,
    motion: row.motion ?? 'balanced',
    layout: normaliseLayout(row.home_layout),
    muted: (row.muted_notifications ?? []).filter((c): c is NotificationCategory => (NOTIFICATION_CATEGORIES as readonly string[]).includes(c)),
  }
}
const toRow = (p: Preferences) => ({
  accent: p.accent,
  greeting_name: p.greetingName,
  motion: p.motion,
  // Saved without the retired Home sections (normalised on read), never wiped.
  home_layout: p.layout,
  muted_notifications: p.muted,
})

function readCache(uid: string | null): Preferences {
  if (!uid) return DEFAULT_PREFERENCES
  try {
    const raw = localStorage.getItem(cacheKey(uid))
    if (raw) return fromRow(JSON.parse(raw))
  } catch {
    /* storage unavailable or corrupt: fall back to defaults until the server answers */
  }
  return DEFAULT_PREFERENCES
}

/**
 * The signed-in person's own look and feel. Stored in `user_preferences` (readable and
 * writable only by that account), cached per account on the device so the theme is right
 * from the first frame, and kept in sync across devices with Realtime. Keyed by user id by
 * its parent, so switching accounts never carries one person's theme over to another.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const uid = user?.id ?? null
  const toast = useToast()
  const osReduce = useReducedMotion()
  const [prefs, setPrefs] = useState<Preferences>(() => readCache(uid))
  const [synced, setSynced] = useState(false)
  const saving = useRef(0)
  const prefsRef = useRef(prefs)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  const motion: MotionLevel = osReduce ? 'reduced' : prefs.motion

  // Theme and motion are applied to <html> so every existing component follows them.
  useEffect(() => {
    applyAccent(prefs.accent)
    document.documentElement.dataset.motion = motion
  }, [prefs.accent, motion])
  useEffect(
    () => () => {
      applyAccent(DEFAULT_ACCENT)
      delete document.documentElement.dataset.motion
    },
    [],
  )

  const remember = useCallback(
    (p: Preferences) => {
      if (!uid) return
      try {
        localStorage.setItem(cacheKey(uid), JSON.stringify(toRow(p)))
      } catch {
        /* best effort */
      }
    },
    [uid],
  )

  useEffect(() => {
    if (!uid) return
    let active = true
    const load = async () => {
      const { data } = await supabase.from('user_preferences').select('*').eq('user_id', uid).maybeSingle()
      if (!active || saving.current > 0) return
      const next = data ? fromRow(data) : DEFAULT_PREFERENCES
      setPrefs(next)
      remember(next)
      setSynced(true)
    }
    void load()
    const channel = supabase
      .channel(`preferences:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${uid}` }, (p) => {
        if (p.eventType === 'DELETE' || saving.current > 0) return
        const next = fromRow(p.new as UserPreferencesRow)
        setPrefs(next)
        remember(next)
      })
      .subscribe()
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      active = false
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [uid, remember])

  const save = useCallback(
    async (next: Preferences): Promise<boolean> => {
      if (!uid) return false
      const before = prefsRef.current
      setPrefs(next)
      saving.current++
      const { error } = await supabase.from('user_preferences').upsert(toRow(next), { onConflict: 'user_id' })
      saving.current--
      if (error) {
        setPrefs(before)
        toast.error(errorMessage(error, 'Couldn’t save that. Try again.'))
        return false
      }
      remember(next)
      return true
    },
    [uid, toast, remember],
  )

  const update = useCallback((patch: Partial<Preferences>) => save({ ...prefsRef.current, ...patch }), [save])
  const reset = useCallback(
    (keys?: (keyof Preferences)[]) => {
      if (!keys) return save(DEFAULT_PREFERENCES)
      const next = { ...prefsRef.current }
      for (const k of keys) (next as Record<string, unknown>)[k] = DEFAULT_PREFERENCES[k]
      return save(next)
    },
    [save],
  )

  const value = useMemo<PreferencesState>(() => ({ prefs, motion, synced, update, reset }), [prefs, motion, synced, update, reset])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function UserScopedPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return <PreferencesProvider key={user?.id ?? 'signed-out'}>{children}</PreferencesProvider>
}

export function usePreferences(): PreferencesState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>')
  return ctx
}

/** For components that may render outside the provider (tests, sign-in screens). */
export function useMotionLevel(): MotionLevel {
  const ctx = useContext(Ctx)
  const os = useReducedMotion()
  if (os) return 'reduced'
  return ctx?.motion ?? 'balanced'
}
