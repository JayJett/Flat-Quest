import { Check, ChevronRight, Copy, Share2, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { PageHeader } from '@/components/AppShell'
import { ItemRow } from '@/components/ItemRow'
import { ItemSheet } from '@/components/ItemSheet'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, EmptyState, Segmented } from '@/components/ui'
import { ProfileIcon } from '@/design/icons'
import { tooLightOnWhite } from '@/lib/color'
import type { HouseholdInviteRow } from '@/lib/database.types'
import { PRIORITY_RANK, type Item } from '@/lib/domain'
import { countsTowardProgress, openItemsFor } from '@/lib/stats'
import { errorMessage, supabase } from '@/lib/supabase'
import { appUrl } from '@/lib/urls'
import { useHousehold } from '@/household/HouseholdProvider'
import { BackButton, goBack } from './RoomDetail'

export function FlatmatesPage() {
  const { user } = useAuth()
  const { members, items, household } = useHousehold()
  const [inviting, setInviting] = useState(false)

  return (
    <>
      <PageHeader title="Flatmates" hideTitleUntilScroll />
      <div className="px-4 lg:px-0">
        <div className="pt-2 pb-6">
          <h1 className="text-display font-extrabold">Flatmates</h1>
          <p className="text-ink-2 mt-1">
            {members.length} {members.length === 1 ? 'person' : 'people'} in {household?.name}
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {members.map((m) => {
            const open = openItemsFor(m.userId, items).length
            const ready = items.filter((i) => i.responsible_user_id === m.userId && i.is_complete && countsTowardProgress(i)).length
            const iconColor = tooLightOnWhite(m.profile.accent_color) ? '#111111' : m.profile.accent_color
            return (
              <li key={m.userId}>
                <Link
                  to={`/flatmates/${m.userId}`}
                  className="pressable bg-surface-2 flex min-h-[88px] items-center gap-4 rounded-[var(--radius-card)] px-4 py-3"
                >
                  <Avatar profile={m.profile} size={56} decorative />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[18px] font-bold">
                      <span className="truncate">{m.profile.display_name || 'Flatmate'}</span>
                      <ProfileIcon name={m.profile.icon} size={18} strokeWidth={2.2} style={{ color: iconColor }} aria-hidden />
                      {m.userId === user?.id && <span className="text-ink-2 text-[14px] font-semibold">You</span>}
                    </p>
                    <p className="text-ink-2 text-[15px]">
                      <span className="text-ink font-semibold tabular-nums">{open}</span> on their list
                      {ready > 0 && (
                        <>
                          {' · '}
                          <span className="tabular-nums">{ready}</span> in the flat
                        </>
                      )}
                    </p>
                  </div>
                  <ChevronRight size={20} className="text-ink-3" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>

        <section className="mt-8">
          <button
            onClick={() => setInviting(true)}
            className="pressable active:bg-surface-2 -mx-2 flex min-h-16 w-[calc(100%+16px)] items-center gap-4 rounded-2xl px-2 text-left"
          >
            <span className="bg-accent flex h-12 w-12 items-center justify-center rounded-full text-white">
              <UserPlus size={22} aria-hidden />
            </span>
            <span>
              <span className="block font-bold">Invite a flatmate</span>
              <span className="text-ink-2 block text-[15px]">Send a private link that expires in 7 days</span>
            </span>
          </button>
        </section>
      </div>
      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
    </>
  )
}

type Invite = Omit<HouseholdInviteRow, 'token_hash'>

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Invite a flatmate">
      {open && <InviteContent />}
    </Sheet>
  )
}

function InviteContent() {
  const { household } = useHousehold()
  const toast = useToast()
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])

  const loadInvites = useCallback(async () => {
    if (!household) return
    const { data } = await supabase
      .from('household_invites')
      .select('id, household_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at')
      .eq('household_id', household.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    setInvites((data ?? []).filter((i) => i.use_count < i.max_uses))
  }, [household])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is only set after the request resolves
    void loadInvites()
  }, [loadInvites])

  const create = async () => {
    if (!household) return
    setBusy(true)
    const { data, error } = await supabase.rpc('create_household_invite', { p_household: household.id })
    setBusy(false)
    if (error || !data) return toast.error(errorMessage(error))
    setLink(appUrl(`/join?code=${encodeURIComponent(data)}`))
    void loadInvites()
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Couldn’t copy — press and hold the link to copy it.')
    }
  }

  const share = async () => {
    if (!link) return
    try {
      await navigator.share({ title: `Join ${household?.name} on Flat Quest`, text: 'Help furnish the flat:', url: link })
    } catch {
      /* user cancelled */
    }
  }

  const revoke = async (id: string) => {
    const { error } = await supabase.rpc('revoke_household_invite', { p_invite: id })
    if (error) return toast.error(errorMessage(error))
    toast.show('Invite link cancelled')
    void loadInvites()
  }

  return (
    <>
      <p className="text-ink-2">
        Anyone with this link can join {household?.name} after signing in. It works for up to 4 people and expires in 7 days.
      </p>
      {link ? (
        <div className="mt-5 flex flex-col gap-3">
          <p className="bg-surface-2 rounded-[var(--radius-control)] p-4 text-[15px] font-medium break-all select-all">{link}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={copy} icon={copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {'share' in navigator ? (
              <Button onClick={share} icon={<Share2 size={18} aria-hidden />}>
                Share
              </Button>
            ) : (
              <Button variant="ghost" onClick={create} loading={busy}>
                New link
              </Button>
            )}
          </div>
          <p className="text-ink-2 text-[14px]">For security we only show this link once. Create a new one any time.</p>
        </div>
      ) : (
        <Button size="lg" block className="mt-5" onClick={create} loading={busy} data-autofocus>
          Create invite link
        </Button>
      )}

      {invites.length > 0 && (
        <section className="mt-7">
          <h3 className="text-[14px] font-bold">Active links</h3>
          <ul className="mt-1">
            {invites.map((i) => (
              <li key={i.id} className="border-line flex min-h-14 items-center justify-between gap-3 border-b last:border-b-0">
                <span className="text-ink-2 text-[15px]">
                  Expires {new Date(i.expires_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} · {i.use_count}/
                  {i.max_uses} used
                </span>
                <button onClick={() => void revoke(i.id)} className="text-danger min-h-11 px-2 text-[15px] font-semibold">
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export function FlatmateItemsPage() {
  const { userId } = useParams()
  const { user } = useAuth()
  const { memberById, items, rooms } = useHousehold()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'open' | 'done'>('open')
  const [openItem, setOpenItem] = useState<Item | null>(null)
  const member = userId ? memberById.get(userId) : undefined
  const isMe = userId === user?.id
  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms])
  const theirs = useMemo(() => items.filter((i) => i.responsible_user_id === userId && countsTowardProgress(i)), [items, userId])
  const open = theirs
    .filter((i) => !i.is_complete)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name))
  const done = theirs.filter((i) => i.is_complete).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const list = tab === 'open' ? open : done

  if (!member) {
    return (
      <>
        <PageHeader back={<BackButton onClick={() => goBack(navigate, '/flatmates')} />} />
        <EmptyState title="Flatmate not found" body="They may have left the household." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={isMe ? 'My list' : member.profile.display_name}
        hideTitleUntilScroll
        back={<BackButton onClick={() => goBack(navigate, '/flatmates')} />}
      />
      <div className="px-4 lg:px-0">
        <div className="flex items-center gap-4 pt-2 pb-6">
          <Avatar profile={member.profile} size={64} decorative />
          <div className="min-w-0">
            <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em]">
              {isMe ? 'My list' : `${member.profile.display_name}’s list`}
            </h1>
            <p className="text-ink-2">
              {open.length} to sort · {done.length} in the flat
            </p>
          </div>
        </div>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'To sort', count: open.length },
            { value: 'done', label: 'In the flat', count: done.length },
          ]}
        />
        {list.length === 0 ? (
          <EmptyState
            title={tab === 'open' ? (isMe ? 'Your list is clear' : 'Nothing on their list') : 'Nothing ticked off yet'}
            body={tab === 'open' && isMe ? 'Find something unclaimed and take it on.' : undefined}
            action={
              tab === 'open' && isMe ? (
                <Link to="/rooms?filter=unclaimed" className="pressable bg-ink inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-white">
                  See unclaimed items
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="mt-3">
            {list.map((item) => (
              <ItemRow key={item.id} item={item} onOpen={setOpenItem} roomName={roomName.get(item.room_id)} />
            ))}
          </ul>
        )}
      </div>
      <ItemSheet open={openItem !== null} item={openItem} onClose={() => setOpenItem(null)} />
    </>
  )
}
