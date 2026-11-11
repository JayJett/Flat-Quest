import { motion } from 'motion/react'
import { useAuth } from '@/auth/AuthProvider'
import { joinNames, STATUS_LABEL, type Item, type Member, type Status } from '@/lib/domain'
import { isUnclaimed } from '@/lib/stats'
import { useHousehold } from '@/household/HouseholdProvider'
import { AvatarGroup } from './Avatar'
import { CompleteToggle } from './Checkbox'
import { useToast } from './Toast'

export const STATUS_TONE: Record<Status, string> = {
  to_decide: 'text-ink-2',
  bringing: 'text-accent',
  need_to_buy: 'text-orange-ink',
  shopping: 'text-periwinkle-ink',
  ordered: 'text-green-ink',
  provided: 'text-ink-2',
  not_needed: 'text-ink-2',
}

/** Members on an item, in the order they were assigned (unknown ids are skipped). */
export function assigneeMembers(item: Item, memberById: Map<string, Member>): Member[] {
  return item.assignees.map((id) => memberById.get(id)).filter((m): m is Member => Boolean(m))
}

/** "Jarden is on it" / "Shared by Jarden and Madi" / "Unclaimed". */
export function responsibilityLabel(item: Item, people: Member[], myId?: string): string {
  if (people.length === 0) {
    if (item.needs_assignees) return 'Shared, choose who'
    if (item.status === 'provided') return 'Provided by the landlord'
    return 'Unclaimed'
  }
  const names = people.map((m) => (m.userId === myId ? 'you' : m.profile.display_name))
  if (people.length === 1) return people[0]!.userId === myId ? 'You’re on it' : `${names[0]} is on it`
  return `Shared by ${joinNames(names)}`
}

interface ItemRowProps {
  item: Item
  onOpen: (item: Item) => void
  /** Show the room name under the item (for cross-room lists). */
  roomName?: string
}

export function ItemRow({ item, onOpen, roomName }: ItemRowProps) {
  const { user } = useAuth()
  const { updateItem, setAssignees, memberById } = useHousehold()
  const toast = useToast()
  const people = assigneeMembers(item, memberById)
  const notNeeded = item.status === 'not_needed'
  const who = responsibilityLabel(item, people, user?.id)

  const toggle = async (next: boolean) => {
    const res = await updateItem(item.id, { is_complete: next })
    if (!res.ok) toast.error(res.error)
    return res.ok
  }

  // Only offered when nobody is on the item, so it never replaces anyone.
  const claim = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user) return
    const res = await setAssignees(item.id, [user.id])
    if (res.ok) toast.success(`You’re on “${item.name}”`)
    else toast.error(res.error)
  }

  const statusText = item.is_complete ? 'In the flat' : STATUS_LABEL[item.status]

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="list-none"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(item)
          }
        }}
        className="pressable active:bg-surface-2 -mx-2 flex min-h-[64px] cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 outline-none"
        aria-label={`${item.name}. ${statusText}. ${who}. Open details`}
        data-tour={isUnclaimed(item) ? 'item-row-claim' : 'item-row'}
      >
        <CompleteToggle checked={item.is_complete} label={`${item.name} is in the flat`} onToggle={toggle} />
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[16px] leading-snug font-semibold transition-colors ${
              item.is_complete || notNeeded ? 'text-ink-2' : 'text-ink'
            } ${notNeeded ? 'line-through decoration-1' : ''}`}
          >
            {item.name}
          </p>
          <p className="mt-0.5 truncate text-[14px]">
            {item.is_complete ? (
              <span className="text-green-ink font-medium">In the flat{roomName ? ` · ${roomName}` : ''}</span>
            ) : (
              <span className="text-ink-2">
                {roomName && <span>{roomName} · </span>}
                <span className={`font-medium ${STATUS_TONE[item.status]}`}>{statusText}</span>
              </span>
            )}
          </p>
        </div>
        {people.length > 0 ? (
          <AvatarGroup profiles={people.map((m) => m.profile)} size={30} label={who} />
        ) : item.needs_assignees ? (
          <span className="text-orange-ink text-[14px] font-semibold">Choose who</span>
        ) : isUnclaimed(item) ? (
          <button
            type="button"
            onClick={claim}
            className="pressable text-accent active:bg-accent-soft -mr-1 min-h-11 rounded-xl px-3 text-[15px] font-bold"
            aria-label={`Claim ${item.name}`}
          >
            Claim
          </button>
        ) : null}
      </div>
    </motion.li>
  )
}
