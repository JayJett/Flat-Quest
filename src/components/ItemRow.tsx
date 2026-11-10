import { Users } from 'lucide-react'
import { motion } from 'motion/react'
import { useAuth } from '@/auth/AuthProvider'
import { STATUS_LABEL, type Item, type Status } from '@/lib/domain'
import { useHousehold } from '@/household/HouseholdProvider'
import { Avatar } from './Avatar'
import { CompleteToggle } from './Checkbox'
import { useToast } from './Toast'

export const STATUS_TONE: Record<Status, string> = {
  to_decide: 'text-ink-2',
  bringing: 'text-accent',
  need_to_buy: 'text-orange-ink',
  shopping: 'text-periwinkle-ink',
  ordered: 'text-green-ink',
  not_needed: 'text-ink-2',
}

interface ItemRowProps {
  item: Item
  onOpen: (item: Item) => void
  /** Show the room name under the item (for cross-room lists). */
  roomName?: string
}

export function ItemRow({ item, onOpen, roomName }: ItemRowProps) {
  const { user } = useAuth()
  const { updateItem, memberById } = useHousehold()
  const toast = useToast()
  const responsible = item.responsible_user_id ? memberById.get(item.responsible_user_id) : undefined
  const notNeeded = item.status === 'not_needed'

  const toggle = async (next: boolean) => {
    const res = await updateItem(item.id, { is_complete: next })
    if (!res.ok) toast.error(res.error)
    return res.ok
  }

  const claim = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user) return
    const res = await updateItem(item.id, { responsibility: 'member', responsible_user_id: user.id })
    if (res.ok) toast.success(`You’re on “${item.name}”`)
    else toast.error(res.error)
  }

  const meta = [roomName, STATUS_LABEL[item.status]].filter(Boolean)

  return (
    <motion.li layout="position" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="list-none">
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
        aria-label={`${item.name}. ${item.is_complete ? 'In the flat' : STATUS_LABEL[item.status]}. ${
          responsible ? `${responsible.profile.display_name} is on it` : item.responsibility === 'shared' ? 'Shared' : 'Unclaimed'
        }. Open details`}
      >
        <CompleteToggle
          checked={item.is_complete}
          label={`${item.name} is in the flat`}
          onToggle={toggle}
        />
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
                <span className={`font-medium ${STATUS_TONE[item.status]}`}>{meta[meta.length - 1]}</span>
              </span>
            )}
          </p>
        </div>
        {responsible ? (
          <Avatar profile={responsible.profile} size={30} />
        ) : item.responsibility === 'shared' ? (
          <span className="text-ink-2 flex items-center gap-1 text-[14px] font-semibold">
            <Users size={18} aria-hidden /> Shared
          </span>
        ) : !item.is_complete && !notNeeded ? (
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
