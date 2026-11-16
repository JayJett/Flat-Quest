import { Palette } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import type { Room } from '@/lib/domain'
import type { Progress } from '@/lib/stats'
import { RoomCoverImage } from './RoomCover'
import { useRoomCover } from './useRoomCover'

/**
 * The room's identity at the top of its checklist. With a cover photo, the photo sits above a
 * band of the room's colour that carries the text, so it always stays readable (no text over the
 * image). Without one, it's the familiar colour tile, made more compact.
 */
export function RoomHeader({ room, progress, onPersonalise }: { room: Room; progress: Progress; onPersonalise: () => void }) {
  const c = roomColor(room.color)
  const cover = useRoomCover(room.cover_visual_id)
  // If the file can't be shown, fall back to the colour layout rather than an empty band.
  const [broken, setBroken] = useState<string | null>(null)
  const withCover = Boolean(cover) && broken !== cover?.id
  const track = c.on === '#FFFFFF' ? 'rgb(255 255 255 / 0.3)' : 'rgb(17 17 17 / 0.14)'
  const status = progress.total === 0 ? 'Nothing here yet' : progress.ready === progress.total ? 'All set' : `${progress.ready} of ${progress.total} in the flat`

  return (
    <section
      data-testid="room-header"
      data-cover={withCover ? 'true' : 'false'}
      className="relative overflow-hidden rounded-[var(--radius-tile)]"
      style={{ backgroundColor: c.hex, color: c.on }}
    >
      {withCover && cover ? (
        <div className="relative h-[60px] min-[380px]:h-32 sm:h-44 lg:h-52" style={{ backgroundColor: c.hex }}>
          <RoomCoverImage cover={cover} size="full" className="absolute inset-0" onState={(ok) => { if (!ok) setBroken(cover.id) }} />
        </div>
      ) : (
        <RoomIcon name={room.icon} aria-hidden strokeWidth={1.1} className="pointer-events-none absolute -top-4 -right-4 h-32 w-32 opacity-90 sm:h-40 sm:w-40" />
      )}
      <button
        type="button"
        onClick={onPersonalise}
        aria-label="Personalise room"
        className={`pressable absolute top-3 left-3 z-10 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-bold ${withCover ? 'bg-surface text-ink' : ''}`}
        style={withCover ? undefined : { backgroundColor: track }}
      >
        <Palette size={17} aria-hidden /> Personalise
      </button>
      <div className={`relative px-4 pb-4 sm:p-5 ${withCover ? 'pt-3' : 'pt-[68px] sm:pt-20'}`}>
        <h1 className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere] min-[380px]:text-[28px] sm:text-[30px]">{room.name}</h1>
        {room.description && <p className="mt-1 line-clamp-2 text-[15px] leading-snug font-medium" style={{ opacity: 0.92 }}>{room.description}</p>}
        <p className="mt-1.5 text-[17px] font-bold sm:text-[19px]" style={{ opacity: 0.92 }}>{status}</p>
        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: track }} role="progressbar" aria-label={`${room.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: c.on }}
            initial={false}
            animate={{ width: `${progress.ratio * 100}%` }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>
    </section>
  )
}
