import { ChevronDown, ChevronLeft, Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/AppShell'
import { ItemRow } from '@/components/ItemRow'
import { ItemSheet } from '@/components/ItemSheet'
import { RoomSheet } from '@/components/RoomSheet'
import { EmptyState, IconButton, Segmented } from '@/components/ui'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, STATUS_RANK, type Item } from '@/lib/domain'
import { isUnclaimed, progressOf } from '@/lib/stats'
import { useHousehold } from '@/household/HouseholdProvider'

type Filter = 'all' | 'mine' | 'unclaimed' | 'done'
type Sort = 'priority' | 'name' | 'status'

export function RoomDetailPage() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const { rooms, items } = useHousehold()
  const navigate = useNavigate()
  const room = rooms.find((r) => r.id === roomId)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('priority')
  const [open, setOpen] = useState<Item | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)

  const roomItems = useMemo(() => items.filter((i) => i.room_id === roomId), [items, roomId])
  const progress = useMemo(() => progressOf(roomItems), [roomItems])

  const counts = useMemo(
    () => ({
      all: roomItems.length,
      mine: roomItems.filter((i) => i.assignees.includes(user?.id ?? '') && !i.is_complete).length,
      unclaimed: roomItems.filter((i) => isUnclaimed(i)).length,
      done: roomItems.filter((i) => i.is_complete).length,
    }),
    [roomItems, user?.id],
  )

  const visible = useMemo(() => {
    const list = roomItems.filter((i) => {
      if (filter === 'mine') return i.assignees.includes(user?.id ?? '') && !i.is_complete
      if (filter === 'unclaimed') return isUnclaimed(i)
      if (filter === 'done') return i.is_complete
      return true
    })
    const cmp: Record<Sort, (a: Item, b: Item) => number> = {
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sort_order - b.sort_order,
      name: (a, b) => a.name.localeCompare(b.name),
      status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name),
    }
    return list.sort(cmp[sort])
  }, [roomItems, filter, sort, user?.id])

  if (!room) {
    return (
      <>
        <PageHeader back={<BackButton onClick={() => navigate('/rooms')} />} />
        <EmptyState
          title="Room not found"
          body="It may have been deleted by a flatmate."
          action={
            <Link to="/rooms" className="pressable bg-ink inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-white">
              All rooms
            </Link>
          }
        />
      </>
    )
  }

  const c = roomColor(room.color)
  const active = visible.filter((i) => i.status !== 'not_needed' || filter !== 'all' || sort !== 'priority')
  const notNeeded = filter === 'all' && sort === 'priority' ? visible.filter((i) => i.status === 'not_needed') : []
  const groups =
    sort === 'priority'
      ? PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABEL[p], items: active.filter((i) => i.priority === p) })).filter(
          (g) => g.items.length > 0,
        )
      : [{ key: 'all', label: '', items: active }]

  return (
    <>
      <PageHeader
        title={room.name}
        hideTitleUntilScroll
        back={<BackButton onClick={() => goBack(navigate, '/rooms')} />}
        actions={
          <>
            <IconButton label="Edit room" onClick={() => setEditing(true)}>
              <Pencil size={21} aria-hidden />
            </IconButton>
            <IconButton label="Add an item" onClick={() => setAdding(true)}>
              <Plus size={24} aria-hidden />
            </IconButton>
          </>
        }
      />
      <div className="px-4 lg:px-0">
        <section
          className="relative mt-1 overflow-hidden rounded-[var(--radius-tile)] p-5"
          style={{ backgroundColor: c.hex, color: c.on }}
        >
          <RoomIcon name={room.icon} aria-hidden strokeWidth={1.1} className="pointer-events-none absolute -top-4 -right-4 h-40 w-40 opacity-90" />
          <div className="relative pt-14">
            <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-[-0.02em]">{room.name}</h1>
            <p className="mt-1 text-[19px] font-bold" style={{ opacity: 0.92 }}>
              {progress.total === 0
                ? 'Nothing here yet'
                : progress.ready === progress.total
                  ? 'All set'
                  : `${progress.ready} of ${progress.total} in the flat`}
            </p>
            <div
              className="mt-4 h-2 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: c.on === '#FFFFFF' ? 'rgb(255 255 255 / 0.3)' : 'rgb(17 17 17 / 0.14)' }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${progress.ratio * 100}%`, backgroundColor: c.on }}
              />
            </div>
          </div>
        </section>

        {roomItems.length > 0 && (
          <div className="mt-5 flex flex-col gap-3">
            <Segmented
              label="Filter items"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'mine', label: 'Mine', count: counts.mine },
                { value: 'unclaimed', label: 'Open', count: counts.unclaimed },
                { value: 'done', label: 'Done', count: counts.done },
              ]}
            />
            <label className="text-ink-2 relative inline-flex min-h-11 items-center gap-1 self-end text-[15px] font-semibold">
              Sort by
              <span className="text-ink">{sort === 'priority' ? 'priority' : sort === 'name' ? 'name' : 'plan'}</span>
              <ChevronDown size={16} aria-hidden />
              <select
                aria-label="Sort items"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value="priority">Priority</option>
                <option value="name">Name</option>
                <option value="status">Plan</option>
              </select>
            </label>
          </div>
        )}

        {roomItems.length === 0 ? (
          <EmptyState
            title="What does this room need?"
            body="Add the first item and claim it if you’re bringing it."
            action={
              <button onClick={() => setAdding(true)} className="pressable bg-ink min-h-12 rounded-2xl px-5 font-semibold text-white">
                Add an item
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={filter === 'mine' ? 'Nothing on your list here' : filter === 'done' ? 'Nothing ticked off yet' : 'Nothing unclaimed'}
            body={filter === 'mine' ? 'Claim something from this room to see it here.' : undefined}
          />
        ) : (
          <div className="mt-1">
            {groups.map((g) => (
              <section key={g.key} className="mt-4" aria-label={g.label || 'Items'}>
                {g.label && (
                  <h2 className="text-ink-2 mb-1 text-[14px] font-bold">
                    {g.label} <span className="font-medium tabular-nums">· {g.items.length}</span>
                  </h2>
                )}
                <ul>
                  {g.items.map((item) => (
                    <ItemRow key={item.id} item={item} onOpen={setOpen} />
                  ))}
                </ul>
              </section>
            ))}
            {notNeeded.length > 0 && (
              <section className="mt-4" aria-label="Not needed">
                <h2 className="text-ink-2 mb-1 text-[14px] font-bold">
                  Not needed <span className="font-medium">· {notNeeded.length}</span>
                </h2>
                <ul>
                  {notNeeded.map((item) => (
                    <ItemRow key={item.id} item={item} onOpen={setOpen} />
                  ))}
                </ul>
              </section>
            )}
            <button
              onClick={() => setAdding(true)}
              className="pressable text-accent active:bg-accent-soft -mx-2 mt-3 flex min-h-14 w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 font-bold"
            >
              <span className="bg-accent-soft flex h-[30px] w-[30px] items-center justify-center rounded-full">
                <Plus size={18} strokeWidth={2.6} aria-hidden />
              </span>
              Add an item
            </button>
          </div>
        )}
      </div>

      <ItemSheet open={open !== null} item={open} onClose={() => setOpen(null)} />
      <ItemSheet open={adding} item={null} roomId={room.id} onClose={() => setAdding(false)} />
      <RoomSheet open={editing} room={room} onClose={() => setEditing(false)} />
    </>
  )
}

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <IconButton label={label} onClick={onClick} className="-ml-2">
      <ChevronLeft size={28} aria-hidden />
    </IconButton>
  )
}

/** Pops history when we navigated here in-app; otherwise goes to a sensible parent. */
export function goBack(navigate: ReturnType<typeof useNavigate>, fallback: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
  if (idx > 0) navigate(-1)
  else navigate(fallback, { replace: true })
}
