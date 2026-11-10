import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

if (!supabaseConfigured) {
  console.error('Flat Quest: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).')
}

export const supabase = createClient<Database>(url ?? 'http://localhost', key ?? 'missing-key', {
  auth: {
    // PKCE: OAuth and email links return ?code=… which the client exchanges itself.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 10 } },
})

export const SUPABASE_URL = url ?? ''
export const SUPABASE_KEY = key ?? ''

/** Friendly copy for common Supabase/PostgREST failures. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback
  const e = error as { message?: string; code?: string; status?: number }
  const msg = e.message ?? ''
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'You’re offline. Check your connection and try again.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Couldn’t reach Flat Quest. Check your connection and try again.'
  if (/Invalid login credentials/i.test(msg)) return 'That email and password don’t match.'
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first — check your inbox for the link.'
  if (/User already registered/i.test(msg)) return 'There’s already an account with that email. Try signing in.'
  if (/Password should be/i.test(msg)) return msg
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.'
  if (/invite link is invalid|expired/i.test(msg)) return 'This invite link is invalid or has expired. Ask a flatmate for a new one.'
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg)) return 'You don’t have permission to do that.'
  if (e.code === '23514') return msg || 'That change isn’t allowed.'
  return msg || fallback
}
