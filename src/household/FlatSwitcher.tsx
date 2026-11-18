import { Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ConfirmSheet } from '@/components/Sheet'
import { hasUnsavedDrafts } from './drafts'
import { useMemberships } from './MembershipProvider'

/**
 * "Your flats": the current flat is marked; choosing another opens its Home. The switch itself
 * happens in the route guard, which loads the destination flat before rendering anything.
 */
export function FlatSwitcher({ onSwitched, compact = false }: { onSwitched?: () => void; compact?: boolean }) {
  const { memberships, activeId } = useMemberships()
  const navigate = useNavigate()
  const [pending, setPending] = useState<string | null>(null)

  const go = (id: string) => {
    setPending(null)
    onSwitched?.()
    navigate('/', { state: { flat: id } })
  }
  const choose = (id: string) => {
    if (id === activeId) return onSwitched?.()
    if (hasUnsavedDrafts()) return setPending(id)
    go(id)
  }
  const target = memberships.find((m) => m.householdId === pending)

  return (
    <section aria-labelledby="your-flats-h" data-testid="flat-switcher">
      <h2 id="your-flats-h" className={`text-ink-2 px-3 text-[13px] font-bold tracking-wide uppercase ${compact ? 'mb-1' : 'mb-1.5'}`}>Your flats</h2>
      <ul className="flex flex-col">
        {memberships.map((m) => {
          const current = m.householdId === activeId
          return (
            <li key={m.householdId}>
              <button
                type="button"
                onClick={() => choose(m.householdId)}
                aria-current={current ? 'true' : undefined}
                aria-label={current ? `${m.name}, current flat` : `Switch to ${m.name}`}
                className={`pressable flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left ${current ? 'bg-surface-2' : 'active:bg-surface-2'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold">{m.name}</span>
                  <span className="text-ink-2 block text-[13px]">{current ? 'Current flat' : m.role === 'owner' ? 'Owner' : 'Member'}</span>
                </span>
                {current && <Check size={18} strokeWidth={2.6} aria-hidden />}
              </button>
            </li>
          )
        })}
        <li>
          <Link
            to="/welcome?add=1"
            onClick={onSwitched}
            className="pressable text-ink-2 active:bg-surface-2 flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold"
          >
            <Plus size={18} aria-hidden /> Add or join a flat
          </Link>
        </li>
      </ul>
      <ConfirmSheet
        open={pending !== null}
        // Staying also closes the menu, so you're straight back at what you were typing.
        onClose={() => { setPending(null); onSwitched?.() }}
        title={`Switch to ${target?.name ?? 'another flat'}?`}
        body="You have something typed here that isn’t saved yet. Switching will discard it."
        confirmLabel="Discard and switch"
        cancelLabel="Stay here"
        onConfirm={() => pending && go(pending)}
        danger
      />
    </section>
  )
}
