import { Crown, LogOut, Minus, Plus, UserMinus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, IconButton } from '@/components/ui'
import type { Member } from '@/lib/domain'
import { errorMessage, supabase } from '@/lib/supabase'
import { useHousehold } from './HouseholdProvider'
import { useMemberships } from './MembershipProvider'

type Summary = { assigned: number; sole: number; coordinating: number }
type Pending = { kind: 'remove' | 'transfer' | 'leave'; member: Member; summary: Summary | null }

const MAX_PEOPLE = 12

/** What happens to someone's things when they go, in plain words. */
export function departureCopy(name: string, s: Summary | null, self: boolean): string {
  const who = self ? 'You' : name
  const parts: string[] = []
  if (s && s.assigned > 0) {
    parts.push(
      `${who} ${self ? 'are' : 'is'} on ${s.assigned} unfinished ${s.assigned === 1 ? 'item' : 'items'}.` +
        (s.sole > 0 ? ` ${s.sole === 1 ? 'One has' : `${s.sole} have`} nobody else on ${s.sole === 1 ? 'it' : 'them'} and will go back to Open.` : ''),
    )
  }
  if (s && s.coordinating > 0) parts.push(`${s.coordinating} purchase${s.coordinating === 1 ? '' : 's'} ${self ? 'you’re' : 'they’re'} sorting will be free for someone else to take.`)
  parts.push('Purchases, photos, options and comments stay, with their name kept on them.')
  return parts.join(' ')
}

/**
 * Members, capacity and the owner's controls. Every change runs through a server function
 * that re-checks who is asking; nothing here edits roles or memberships directly.
 */
export function HouseholdManagement() {
  const { user } = useAuth()
  const { household, members, reload } = useHousehold()
  const { refresh: refreshMemberships } = useMemberships()
  const toast = useToast()
  const navigate = useNavigate()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [capacityOpen, setCapacityOpen] = useState(false)
  const [managing, setManaging] = useState<Member | null>(null)
  const me = members.find((m) => m.userId === user?.id)
  const isOwner = me?.role === 'owner'
  const hid = household?.id
  if (!household || !hid || !me) return null
  const limit = household.member_limit

  const ask = async (kind: Pending['kind'], member: Member) => {
    setManaging(null)
    let summary: Summary | null = null
    if (kind !== 'transfer') {
      const { data } = await supabase.rpc('member_departure_summary', { p_household: hid, p_user: member.userId })
      summary = (data as Summary | null) ?? null
    }
    setPending({ kind, member, summary })
  }

  const run = async () => {
    if (!pending) return
    setBusy(true)
    const { kind, member } = pending
    const res =
      kind === 'remove'
        ? await supabase.rpc('remove_household_member', { p_household: hid, p_user: member.userId })
        : kind === 'transfer'
          ? await supabase.rpc('transfer_household_ownership', { p_household: hid, p_user: member.userId })
          : await supabase.rpc('leave_household', { p_household: hid })
    setBusy(false)
    if (res.error) {
      toast.error(errorMessage(res.error))
      return
    }
    setPending(null)
    const name = member.profile.display_name || 'Your flatmate'
    if (kind === 'leave') {
      toast.show(`You’ve left ${household.name}`)
      navigate('/', { replace: true })
      // Memberships pick the next flat (or onboarding); this flat's screens unmount with it.
      await refreshMemberships({ quiet: true })
      return
    }
    toast.success(kind === 'remove' ? `${name} is no longer in the flat` : `${name} is now the flat owner`)
    await reload()
  }

  const others = members.filter((m) => m.userId !== me.userId)
  const confirmCopy = (() => {
    if (!pending) return { title: '', body: '', label: '' }
    const name = pending.member.profile.display_name || 'this flatmate'
    if (pending.kind === 'transfer')
      return {
        title: `Make ${name} the owner?`,
        body: `${name} will manage members, invites and capacity. You’ll stay in the flat as a member and can’t undo this yourself.`,
        label: 'Make owner',
      }
    if (pending.kind === 'remove')
      return {
        title: `Remove ${name} from the flat?`,
        body: `${name} will lose access straight away. ${departureCopy(name, pending.summary, false)}`,
        label: 'Remove',
      }
    return {
      title: `Leave ${household.name}?`,
      body: `You’ll lose access straight away and need a new invite to come back. ${departureCopy('You', pending.summary, true)}`,
      label: 'Leave flat',
    }
  })()

  return (
    <section aria-labelledby="manage-h" className="mt-9" data-testid="household-management">
      <h2 id="manage-h" className="text-title font-bold">
        Membership
      </h2>
      <div className="bg-surface-2 mt-3 flex min-h-[64px] items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-3">
        <div>
          <p className="font-bold">
            {members.length} of {limit} places taken
          </p>
          <p className="text-ink-2 text-[14px]">
            {members.length >= limit ? 'The flat is full — invites are paused.' : `${limit - members.length} ${limit - members.length === 1 ? 'space' : 'spaces'} left`}
          </p>
        </div>
        {isOwner && (
          <Button variant="secondary" size="sm" onClick={() => setCapacityOpen(true)}>
            Change
          </Button>
        )}
      </div>

      <ul className="mt-2">
        {members.map((m) => (
          <li key={m.userId} className="flex min-h-14 items-center gap-3 py-1">
            <Avatar profile={m.profile} size={36} decorative />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {m.profile.display_name || 'Flatmate'}
              {m.userId === me.userId && <span className="text-ink-2 font-medium"> (you)</span>}
            </span>
            {m.role === 'owner' && (
              <span className="bg-surface-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold">
                <Crown size={13} aria-hidden /> Owner
              </span>
            )}
            {isOwner && m.userId !== me.userId && (
              <Button variant="ghost" size="sm" onClick={() => setManaging(m)} aria-label={`Manage ${m.profile.display_name || 'flatmate'}`}>
                Manage
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3">
        {isOwner ? (
          <p className="text-ink-2 text-[14px]">
            {others.length > 0
              ? 'You’re the owner. To leave, make someone else the owner first.'
              : 'You’re the only one here. Invite your flatmates above.'}
          </p>
        ) : (
          <Button variant="ghost" className="text-danger -ml-2" icon={<LogOut size={18} aria-hidden />} onClick={() => void ask('leave', me)}>
            Leave this flat
          </Button>
        )}
      </div>

      <Sheet open={managing !== null} onClose={() => setManaging(null)} title={managing?.profile.display_name || 'Flatmate'}>
        {managing && (
          <div className="flex flex-col gap-2.5">
            <Button variant="secondary" block icon={<Crown size={18} aria-hidden />} onClick={() => void ask('transfer', managing)}>
              Make owner
            </Button>
            <Button variant="danger" block icon={<UserMinus size={18} aria-hidden />} onClick={() => void ask('remove', managing)}>
              Remove from flat
            </Button>
          </div>
        )}
      </Sheet>

      <CapacitySheet open={capacityOpen} onClose={() => setCapacityOpen(false)} current={limit} min={Math.max(members.length, 1)} householdId={hid} onSaved={reload} />

      <ConfirmSheet
        open={pending !== null}
        title={confirmCopy.title}
        body={confirmCopy.body}
        confirmLabel={confirmCopy.label}
        danger={pending?.kind !== 'transfer'}
        busy={busy}
        onConfirm={() => void run()}
        onClose={() => setPending(null)}
      />
    </section>
  )
}

function CapacitySheet({
  open,
  onClose,
  current,
  min,
  householdId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  current: number
  min: number
  householdId: string
  onSaved: () => Promise<void>
}) {
  const toast = useToast()
  const [value, setValue] = useState(current)
  const [saving, setSaving] = useState(false)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setValue(current)
  }
  const save = async () => {
    setSaving(true)
    const { error } = await supabase.rpc('set_member_limit', { p_household: householdId, p_limit: value })
    setSaving(false)
    if (error) return toast.error(errorMessage(error))
    toast.success(`The flat now has room for ${value}`)
    await onSaved()
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="How many people live here?" busy={saving}>
      <p className="text-ink-2 text-[15px]">Invites stop working once every place is taken. It can’t go below the number of people already here.</p>
      <div className="mt-5 flex items-center justify-center gap-6">
        <IconButton label="One fewer" disabled={value <= min} onClick={() => setValue((v) => Math.max(min, v - 1))} className="bg-surface-2 h-14 w-14 disabled:opacity-30">
          <Minus size={22} aria-hidden />
        </IconButton>
        <output aria-live="polite" className="w-16 text-center text-[40px] font-extrabold tabular-nums">
          {value}
        </output>
        <IconButton label="One more" disabled={value >= MAX_PEOPLE} onClick={() => setValue((v) => Math.min(MAX_PEOPLE, v + 1))} className="bg-surface-2 h-14 w-14 disabled:opacity-30">
          <Plus size={22} aria-hidden />
        </IconButton>
      </div>
      <Button size="lg" block className="mt-6" loading={saving} disabled={value === current} onClick={() => void save()}>
        Save
      </Button>
    </Sheet>
  )
}
