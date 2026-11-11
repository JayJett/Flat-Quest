import { Check, Heart, Star } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { AvatarGroup, useSignedUrl } from '@/components/Avatar'
import { useToast } from '@/components/Toast'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import { joinNames, type Member, type Room } from '@/lib/domain'
import { useHousehold } from '@/household/HouseholdProvider'
import { useWishlist, type Idea } from './WishlistProvider'

const money = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 })

export function suggestedBy(idea: Idea, memberById: Map<string, Member>, myId?: string): string {
  if (idea.created_by) {
    if (idea.created_by === myId) return 'Your idea'
    const m = memberById.get(idea.created_by)
    return m ? `Suggested by ${m.profile.display_name}` : 'Suggested by a past flatmate'
  }
  return idea.import_key ? 'From your Google Sheet' : 'Suggested by a past flatmate'
}

export function votersLabel(idea: Idea, memberById: Map<string, Member>, myId?: string): string {
  const names = idea.voters.map((u) => (u === myId ? 'you' : (memberById.get(u)?.profile.display_name ?? 'a flatmate')))
  if (names.length === 0) return 'No votes yet'
  return `Liked by ${joinNames(names)}`
}

export function IdeaCard({ idea, room, onOpen }: { idea: Idea; room?: Room; onOpen: (idea: Idea) => void }) {
  const { user } = useAuth()
  const { memberById } = useHousehold()
  const photo = useSignedUrl('household-media', idea.photo_path)
  const voters = idea.voters.map((u) => memberById.get(u)).filter((m): m is Member => Boolean(m))
  const meta = [room?.name, idea.estimated_price != null ? money.format(idea.estimated_price) : null].filter(Boolean).join(' · ')
  const c = room ? roomColor(room.color) : null

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="list-none"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(idea)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(idea)
          }
        }}
        aria-label={`${idea.title}. ${meta}. ${votersLabel(idea, memberById, user?.id)}. Open idea`}
        className="pressable bg-surface-2 block cursor-pointer overflow-hidden rounded-[var(--radius-card)] outline-none"
      >
        {idea.photo_path && (
          <div className="bg-surface-3 aspect-[16/10] w-full overflow-hidden">
            {photo && <img src={photo} alt="" className="h-full w-full object-cover" draggable={false} />}
          </div>
        )}
        <div className="flex items-start gap-3 p-4">
          {!idea.photo_path && c && (
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]" style={{ backgroundColor: c.hex, color: c.on }} aria-hidden>
              <RoomIcon name={room!.icon} size={20} strokeWidth={1.9} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[17px] leading-snug font-bold">{idea.title}</p>
            {meta && <p className="text-ink-2 mt-0.5 text-[14px]">{meta}</p>}
            <p className="text-ink-2 mt-0.5 text-[14px]">{suggestedBy(idea, memberById, user?.id)}</p>
            {(idea.checklist_item_id || idea.is_chosen) && (
              <p className="text-green-ink mt-1.5 flex items-center gap-1 text-[14px] font-semibold">
                {idea.checklist_item_id ? <Check size={15} strokeWidth={2.6} aria-hidden /> : <Star size={15} strokeWidth={2.4} aria-hidden />}
                {idea.checklist_item_id ? 'On the checklist' : 'Chosen'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <VoteButton idea={idea} />
            {voters.length > 0 && <AvatarGroup profiles={voters.map((m) => m.profile)} size={22} max={3} label={votersLabel(idea, memberById, user?.id)} />}
          </div>
        </div>
      </div>
    </motion.li>
  )
}

export function VoteButton({ idea, large }: { idea: Idea; large?: boolean }) {
  const { user } = useAuth()
  const { toggleVote } = useWishlist()
  const toast = useToast()
  const reduce = useReducedMotion()
  const voted = Boolean(user && idea.voters.includes(user.id))
  const [pulse, setPulse] = useState(0)

  const click = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!voted) setPulse((p) => p + 1)
    const res = await toggleVote(idea.id)
    if (!res.ok) toast.error(res.error)
  }

  return (
    <button
      type="button"
      onClick={click}
      aria-pressed={voted}
      aria-label={voted ? `Remove your vote for ${idea.title}` : `Vote for ${idea.title}`}
      className={`pressable bg-surface inline-flex items-center gap-1.5 rounded-full font-bold tabular-nums ${large ? 'min-h-12 px-5 text-[16px]' : 'min-h-11 px-3.5 text-[15px]'}`}
    >
      <motion.span
        key={pulse}
        initial={reduce || pulse === 0 ? false : { scale: 0.7 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 18 }}
        className="inline-flex"
      >
        <Heart size={large ? 22 : 19} strokeWidth={2.2} fill={voted ? '#F0478C' : 'none'} color={voted ? '#F0478C' : '#111111'} aria-hidden />
      </motion.span>
      {idea.voters.length}
      {large && <span className="font-semibold">{voted ? 'You like this' : 'Like'}</span>}
    </button>
  )
}
