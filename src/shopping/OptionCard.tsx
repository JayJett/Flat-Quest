import { Check, ThumbsUp } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { AvatarGroup, useSignedUrl } from '@/components/Avatar'
import { RoomIcon } from '@/design/icons'
import { joinNames, type Member, type Room } from '@/lib/domain'
import { dimensionsLabel, formatPrice, type ProductOption } from '@/lib/shopping'

/** "Preferred by you and Madi" / "Nobody has picked this yet". */
export function preferredByLabel(voters: Member[], myId?: string): string {
  if (voters.length === 0) return 'No preferences yet'
  return `Preferred by ${joinNames(voters.map((m) => (m.userId === myId ? 'you' : m.profile.display_name)))}`
}

/** Product photo, or a calm placeholder drawn from the item's room when there isn't one. */
export function OptionPhoto({ option, room, className = '' }: { option: Pick<ProductOption, 'photo_path' | 'name'>; room?: Room; className?: string }) {
  const url = useSignedUrl('household-media', option.photo_path)
  const [failed, setFailed] = useState<string | null>(null)
  const show = url && failed !== url
  return (
    <div className={`bg-surface-3 relative flex items-center justify-center overflow-hidden ${className}`}>
      {show ? (
        <motion.img
          key={url}
          src={url}
          alt=""
          draggable={false}
          onError={() => setFailed(url)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="h-full w-full object-cover"
        />
      ) : (
        <RoomIcon name={room?.icon ?? 'house'} strokeWidth={1.2} className="text-ink-3 h-[46%] w-[46%]" aria-hidden />
      )}
    </div>
  )
}

export function PreferButton({
  active,
  count,
  name,
  onToggle,
  large,
}: {
  active: boolean
  count: number
  name: string
  onToggle: () => void
  large?: boolean
}) {
  const reduce = useReducedMotion()
  const [pulse, setPulse] = useState(0)
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `Remove your preference for ${name}` : `Prefer ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        if (!active) setPulse((p) => p + 1)
        onToggle()
      }}
      className={`pressable inline-flex items-center gap-1.5 rounded-xl font-bold tabular-nums transition-colors ${
        active ? 'bg-accent text-white' : 'bg-surface text-ink'
      } ${large ? 'min-h-12 px-4 text-[16px]' : 'min-h-11 px-3 text-[15px]'}`}
    >
      <motion.span
        key={pulse}
        initial={reduce || pulse === 0 ? false : { scale: 0.7, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 18 }}
        className="inline-flex"
      >
        <ThumbsUp size={large ? 20 : 17} strokeWidth={2.3} fill={active ? 'currentColor' : 'none'} aria-hidden />
      </motion.span>
      {large ? <span>{active ? 'You prefer this' : 'I prefer this'}</span> : count}
    </button>
  )
}

/**
 * Compact, image-led card for comparing the options of one checklist item.
 * The whole card opens the option; the thumb button records a preference.
 */
export function OptionCard({
  option,
  room,
  voters,
  myId,
  onOpen,
  onPrefer,
}: {
  option: ProductOption
  room?: Room
  voters: Member[]
  myId?: string
  onOpen: () => void
  onPrefer: () => void
}) {
  const mine = voters.some((m) => m.userId === myId)
  const dims = dimensionsLabel(option)
  const price = formatPrice(option.price)
  const summary = [option.retailer, price || 'No price yet', dims, preferredByLabel(voters, myId), option.is_selected ? 'Our pick' : null]
    .filter(Boolean)
    .join('. ')
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="list-none"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        aria-label={`${option.name}. ${summary}. Open option`}
        data-selected={option.is_selected || undefined}
        className="pressable bg-surface-2 relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[var(--radius-card)] outline-none"
      >
        <OptionPhoto option={option} room={room} className="aspect-[4/3] w-full" />
        {/* The household's decision: an inset ink outline plus one plain label. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)]"
          initial={false}
          animate={{ boxShadow: option.is_selected ? 'inset 0 0 0 2.5px #111111' : 'inset 0 0 0 2.5px rgba(17,17,17,0)' }}
          transition={{ duration: 0.2 }}
        />
        {option.is_selected && (
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="bg-ink absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-bold text-white"
          >
            <Check size={14} strokeWidth={3} aria-hidden /> Our pick
          </motion.span>
        )}
        <div className="flex flex-1 flex-col p-3">
          <p className="line-clamp-2 text-[15px] leading-snug font-bold [overflow-wrap:anywhere]">{option.name}</p>
          {option.retailer && <p className="text-ink-2 mt-0.5 truncate text-[14px]">{option.retailer}</p>}
          <p className={`mt-1.5 text-[18px] leading-tight font-extrabold tabular-nums ${price ? '' : 'text-ink-3'}`}>{price || 'No price'}</p>
          {dims && <p className="text-ink-2 mt-0.5 text-[13px] leading-snug">{dims}</p>}
          <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
            <PreferButton active={mine} count={voters.length} name={option.name} onToggle={onPrefer} />
            {voters.length > 0 && <AvatarGroup profiles={voters.map((m) => m.profile)} size={24} max={3} label={preferredByLabel(voters, myId)} />}
          </div>
        </div>
      </div>
    </motion.li>
  )
}
