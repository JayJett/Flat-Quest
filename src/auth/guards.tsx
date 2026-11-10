import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Spinner } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { useAuth } from './AuthProvider'

export const NEXT_KEY = 'flatquest.next'

export function FullScreenLoader({ label = 'Loading Flat Quest' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label={label} size={28} />
    </div>
  )
}

/** Only allow internal paths as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!session) {
    const next = location.pathname + location.search
    return <Navigate to={`/sign-in${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
  }
  return <>{children}</>
}

/** Sends signed-in members without a household to onboarding. */
export function RequireHousehold({ children }: { children: ReactNode }) {
  const { state, loadError, reload } = useHousehold()
  if (state === 'loading') return <FullScreenLoader />
  if (state === 'no-household') return <Navigate to="/welcome" replace />
  if (state === 'error') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-title font-bold">Couldn’t load your flat</h1>
        <p className="text-ink-2">{loadError}</p>
        <button className="pressable bg-ink min-h-12 rounded-2xl px-6 font-semibold text-white" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    )
  }
  return <>{children}</>
}
