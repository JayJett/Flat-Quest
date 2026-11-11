import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { PageHeader } from '@/components/AppShell'
import { ItemRow } from '@/components/ItemRow'
import { ItemSheet } from '@/components/ItemSheet'
import { InvitePanel } from '@/components/InvitePanel'
import { EmptyState, Segmented } from '@/components/ui'
import { ProfileIcon } from '@/design/icons'
import { tooLightOnWhite } from '@/lib/color'
import { PRIORITY_RANK, type Item } from '@/lib/domain'
import { countsTowardProgress, doneItemsFor, openItemsFor } from '@/lib/stats'
import { useHousehold } from '@/household/HouseholdProvider'
import { BackButton, goBack } from './RoomDetail'

export function FlatmatesPage() {
  const { user } = useAuth()
  const { members, items, household } = useHousehold()

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
            const ready = doneItemsFor(m.userId, items).length
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

        <InvitePanel />
      </div>
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
  const theirs = useMemo(() => items.filter((i) => i.assignees.includes(userId ?? '') && countsTowardProgress(i)), [items, userId])
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
