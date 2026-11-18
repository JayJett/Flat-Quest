import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { Spinner } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { requestedFlat } from '@/household/flatLinks'
import { useMemberships } from '@/household/MembershipProvider'
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

type HistoryState = { flat?: string } & Record<string, unknown>

/**
 * Decides which flat the household screens show, before any of them render:
 * - `?flat=<id>` (a shared link) opens that flat if, and only if, you're a member;
 * - every history entry remembers its flat, so Back after switching returns to that flat;
 * - no flat → onboarding; several and no valid choice → the chooser.
 */
export function RequireHousehold({ children }: { children: ReactNode }) {
  const { state, loadError, reload } = useHousehold()
  const { status, memberships, activeId, select } = useMemberships()
  const location = useLocation()
  const requested = requestedFlat(location.search)
  const remembered = (location.state as HistoryState | null)?.flat
  const isMember = (id: string) => memberships.some((m) => m.householdId === id)
  // A shared link must be honoured (or refused). A remembered flat (Back across a switch) only
  // counts while you're still in it; otherwise the entry just shows your current flat.
  const wanted = requested.kind === 'flat' ? requested.id
    : remembered && remembered !== activeId && isMember(remembered) ? remembered : null
  const unavailable = status === 'ready' && (requested.kind === 'invalid' || (wanted !== null && !isMember(wanted)))
  const switching = status === 'ready' && wanted !== null && isMember(wanted) && wanted !== activeId

  useEffect(() => {
    if (switching && wanted) select(wanted)
  }, [switching, wanted, select])

  // Remember the open flat on this history entry (so Back across a switch returns to it). This
  // writes the entry's state in place: it never navigates, so it can't undo a page that has just
  // tidied its own URL (e.g. consumed a one-off ?item= link).
  useEffect(() => {
    if (state !== 'ready' || !activeId || switching || unavailable) return
    try {
      const entry = (window.history.state ?? {}) as { usr?: HistoryState | null }
      if (entry.usr?.flat === activeId) return
      window.history.replaceState({ ...entry, usr: { ...(entry.usr ?? {}), flat: activeId } }, '')
    } catch { /* history unavailable: Back simply stays in the current flat */ }
  }, [state, activeId, switching, unavailable, location])

  if (status === 'loading' || switching) return <FullScreenLoader />
  if (unavailable) return <FlatUnavailable />
  if (state === 'loading') return <FullScreenLoader />
  if (state === 'no-household') return <Navigate to="/welcome" replace />
  if (state === 'choose') {
    const next = location.pathname + location.search
    return <Navigate to={`/flats${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
  }
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

/** Deliberately generic: never reveals whether the flat exists or what it's called. */
function FlatUnavailable() {
  const { memberships } = useMemberships()
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center" data-testid="flat-unavailable">
      <h1 className="text-title font-bold">This flat isn’t available</h1>
      <p className="text-ink-2">The link may be for a flat you’re not in, or one that no longer exists.</p>
      <Link to="/" replace state={null} className="pressable bg-ink inline-flex min-h-12 items-center rounded-2xl px-6 font-semibold text-white">
        {memberships.length ? 'Go to your flat' : 'Set up or join a flat'}
      </Link>
    </div>
  )
}
