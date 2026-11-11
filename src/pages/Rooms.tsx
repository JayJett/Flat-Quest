import { ArrowDown, ArrowUp, ArrowUpDown, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/AppShell'
import { ItemRow } from '@/components/ItemRow'
import { ItemSheet } from '@/components/ItemSheet'
import { RoomSheet } from '@/components/RoomSheet'
import { RoomTile } from '@/components/RoomTile'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { RoomsViewSwitch } from '@/components/RoomsViewSwitch'
import { EmptyState, IconButton } from '@/components/ui'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import { PRIORITY_RANK, type Item } from '@/lib/domain'
import { isUnclaimed, progressOf, roomProgress } from '@/lib/stats'
import { useHousehold } from '@/household/HouseholdProvider'

type View = 'rooms' | 'unclaimed'

export function RoomsPage() {
  const { rooms, items } = useHousehold()
  const [params] = useSearchParams()
  const view: View = params.get('filter') === 'unclaimed' ? 'unclaimed' : 'rooms'
  const [creating, setCreating] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [open, setOpen] = useState<Item | null>(null)
  const perRoom = useMemo(() => roomProgress(rooms, items), [rooms, items])
  const total = useMemo(() => progressOf(items), [items])
  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms])
  const roomOrder = useMemo(() => new Map(rooms.map((r, i) => [r.id, i])), [rooms])

  const unclaimed = useMemo(
    () =>
      items
        .filter(isUnclaimed)
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            (roomOrder.get(a.room_id) ?? 0) - (roomOrder.get(b.room_id) ?? 0) ||
            a.sort_order - b.sort_order,
        ),
    [items, roomOrder],
  )

  return (
    <>
      <PageHeader
        title="Rooms"
        hideTitleUntilScroll
        actions={
          <>
            {rooms.length > 1 && (
              <IconButton label="Reorder rooms" onClick={() => setReordering(true)}>
                <ArrowUpDown size={22} aria-hidden />
              </IconButton>
            )}
            <IconButton label="Add a room" onClick={() => setCreating(true)}>
              <Plus size={24} aria-hidden />
            </IconButton>
          </>
        }
      />
      <div className="px-4 lg:px-0">
        <div className="pt-2 pb-5">
          <h1 className="text-display font-extrabold">Rooms</h1>
          <p className="text-ink-2 mt-1 text-[16px]">
            {total.total} items · {total.ready} in the flat · {total.unclaimed} unclaimed
          </p>
        </div>

        <RoomsViewSwitch view={view} />

        {view === 'rooms' ? (
          rooms.length === 0 ? (
            <EmptyState
              title="No rooms yet"
              body="Add the rooms in your flat, then the things each one needs."
              action={
                <button onClick={() => setCreating(true)} className="pressable bg-ink min-h-12 rounded-2xl px-5 font-semibold text-white">
                  Add a room
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {rooms.map((room) => (
                <RoomTile key={room.id} room={room} progress={perRoom.get(room.id)} />
              ))}
              <button
                onClick={() => setCreating(true)}
                className="pressable bg-surface-2 text-ink-2 flex aspect-square flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] font-semibold"
              >
                <Plus size={28} aria-hidden />
                Add room
              </button>
            </div>
          )
        ) : unclaimed.length === 0 ? (
          <EmptyState title="Everything’s claimed" body="Every outstanding item has someone on it." />
        ) : (
          <>
            <p className="text-ink-2 mb-2 text-[15px]">Must-haves first. Tap Claim if you can bring or buy it.</p>
            <ul>
              {unclaimed.map((item) => (
                <ItemRow key={item.id} item={item} onOpen={setOpen} roomName={roomName.get(item.room_id)} />
              ))}
            </ul>
          </>
        )}
      </div>

      <RoomSheet open={creating} onClose={() => setCreating(false)} room={null} />
      <ReorderSheet open={reordering} onClose={() => setReordering(false)} />
      <ItemSheet open={open !== null} item={open} onClose={() => setOpen(null)} />
    </>
  )
}

function ReorderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { rooms, reorderRooms } = useHousehold()
  const toast = useToast()
  const move = async (index: number, delta: -1 | 1) => {
    const ids = rooms.map((r) => r.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    const res = await reorderRooms(ids)
    if (!res.ok) toast.error(res.error)
  }
  return (
    <Sheet open={open} onClose={onClose} title="Reorder rooms">
      <ul className="flex flex-col pt-1">
        {rooms.map((room, index) => {
          const c = roomColor(room.color)
          return (
            <li key={room.id} className="flex min-h-14 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: c.hex, color: c.on }} aria-hidden>
                <RoomIcon name={room.icon} size={20} />
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{room.name}</span>
              <IconButton label={`Move ${room.name} up`} disabled={index === 0} onClick={() => void move(index, -1)} className="disabled:opacity-25">
                <ArrowUp size={20} aria-hidden />
              </IconButton>
              <IconButton
                label={`Move ${room.name} down`}
                disabled={index === rooms.length - 1}
                onClick={() => void move(index, 1)}
                className="disabled:opacity-25"
              >
                <ArrowDown size={20} aria-hidden />
              </IconButton>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
