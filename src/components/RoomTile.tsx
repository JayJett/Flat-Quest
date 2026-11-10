import { Link } from 'react-router'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import type { Room } from '@/lib/domain'
import type { Progress } from '@/lib/stats'

/**
 * Large saturated tile (the reference's signature element) with a cropped
 * line-icon "illustration". Labels are ≥19px bold so the 3:1 large-text
 * contrast threshold applies; every colour token meets it.
 */
export function RoomTile({ room, progress, compact }: { room: Room; progress: Progress | undefined; compact?: boolean }) {
  const color = roomColor(room.color)
  const done = progress && progress.total > 0 && progress.ready === progress.total
  const pct = progress && progress.total > 0 ? progress.ready / progress.total : 0

  return (
    <Link
      to={`/rooms/${room.id}`}
      className={`pressable relative flex flex-col justify-end overflow-hidden rounded-[var(--radius-tile)] p-4 ${compact ? 'aspect-[1/0.92]' : 'aspect-square'}`}
      style={{ backgroundColor: color.hex, color: color.on }}
      aria-label={`${room.name}: ${progress?.ready ?? 0} of ${progress?.total ?? 0} ready`}
    >
      <RoomIcon
        name={room.icon}
        aria-hidden
        strokeWidth={1.15}
        className="pointer-events-none absolute -top-3 -right-4 opacity-90"
        style={{ width: '68%', height: '68%' }}
      />
      <div className="relative">
        <p className="text-[19px] leading-tight font-bold tabular-nums" style={{ opacity: 0.92 }}>
          {done ? 'All set' : `${progress?.ready ?? 0}/${progress?.total ?? 0}`}
        </p>
        <p className="mt-0.5 text-[20px] leading-[1.15] font-bold tracking-[-0.01em] [overflow-wrap:anywhere]">{room.name}</p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: color.on === '#FFFFFF' ? 'rgb(255 255 255 / 0.3)' : 'rgb(17 17 17 / 0.14)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${pct * 100}%`, backgroundColor: color.on }}
          />
        </div>
      </div>
    </Link>
  )
}
