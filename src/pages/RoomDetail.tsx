import { ArrowUpDown, ChevronLeft, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/AppShell'
import { ItemRow } from '@/components/ItemRow'
import { ItemSheet } from '@/components/ItemSheet'
import { RoomSheet } from '@/components/RoomSheet'
import { EmptyState, IconButton, Segmented } from '@/components/ui'
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, STATUS_RANK, type Item } from '@/lib/domain'
import { isUnclaimed, progressOf } from '@/lib/stats'
import { useHousehold } from '@/household/HouseholdProvider'
import { useToast } from '@/components/Toast'
import { ShoppingSheet } from '@/shopping/ShoppingSheet'
import { PersonaliseRoomSheet } from '@/rooms/PersonaliseRoomSheet'
import { RoomHeader } from '@/rooms/RoomHeader'

type Filter = 'all' | 'mine' | 'unclaimed' | 'done'
type Sort = 'priority' | 'name' | 'status'
const SORT_LABEL: Record<Sort, string> = { priority: 'priority', name: 'name', status: 'plan' }

export function RoomDetailPage() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const { rooms, items, state } = useHousehold()
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  /** Opened from a notification or the timeline: which comment to bring into view. */
  const [focus, setFocus] = useState<{ comment: string | null; option: string | null } | null>(null)
  const wantedItem = params.get('item')
  const [shoppingFor, setShoppingFor] = useState<string | null>(null)
  const room = rooms.find((r) => r.id === roomId)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('priority')
  const [open, setOpen] = useState<Item | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [personalising, setPersonalising] = useState(false)

  // Deep links: /rooms/<room>?item=<id>[&option=<id>][&discuss=<comment>]
  useEffect(() => {
    if (!wantedItem || state !== 'ready') return
    const item = items.find((i) => i.id === wantedItem)
    /* eslint-disable react-hooks/set-state-in-effect -- consuming a one-off URL parameter */
    if (item) {
      setFocus({ comment: params.get('discuss'), option: params.get('option') })
      if (!params.get('option')) setOpen(item)
      else setShoppingFor(item.id)
    } else {
      toast.show('That item has since been removed from the list.')
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    setParams({}, { replace: true })
  }, [wantedItem, state, items, params, setParams, toast])

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
            <IconButton label="Add an item" onClick={() => setAdding(true)}>
              <Plus size={24} aria-hidden />
            </IconButton>
          </>
        }
      />
      <div className="px-4 lg:px-0">
        <div className="mb-3"><Segmented label="Room view" value="checklist" onChange={() => navigate(`/rooms/${room.id}/visual`)} options={[{ value: 'checklist', label: 'Checklist' }, { value: 'visual', label: 'Visual Home' }]} /></div>
        <RoomHeader room={room} progress={progress} onPersonalise={() => setPersonalising(true)} />

        {roomItems.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="min-w-0 flex-1">
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
            </div>
            <label
              title={`Sort by ${SORT_LABEL[sort]}`}
              className={`pressable relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${sort === 'priority' ? 'bg-surface-2 text-ink' : 'bg-accent-soft text-accent-ink'}`}
            >
              <ArrowUpDown size={20} aria-hidden />
              <select
                aria-label={`Sort items (now by ${SORT_LABEL[sort]})`}
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
          <motion.div
            key={`${filter}-${sort}`}
            className="mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            {groups.map((g) => (
              <section key={g.key} className="mt-3" aria-label={g.label || 'Items'}>
                {g.label && (
                  <h2 className="text-ink-2 mb-1 text-[14px] font-bold">
                    {g.label} <span className="font-medium tabular-nums">· {g.items.length}</span>
                  </h2>
                )}
                <ul>
                  <AnimatePresence initial={false}>
                    {g.items.map((item) => (
                      <ItemRow key={item.id} item={item} onOpen={setOpen} />
                    ))}
                  </AnimatePresence>
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
              className="pressable text-accent-ink active:bg-accent-soft -mx-2 mt-3 flex min-h-14 w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 font-bold"
            >
              <span className="bg-accent-soft flex h-[30px] w-[30px] items-center justify-center rounded-full">
                <Plus size={18} strokeWidth={2.6} aria-hidden />
              </span>
              Add an item
            </button>
          </motion.div>
        )}
      </div>

      <ItemSheet
        open={open !== null}
        item={open}
        focusCommentId={focus?.option ? null : focus?.comment}
        onClose={() => {
          setOpen(null)
          setFocus(null)
        }}
      />
      <ShoppingSheet
        open={shoppingFor !== null}
        itemId={shoppingFor}
        initialOptionId={focus?.option}
        focusCommentId={focus?.comment}
        onClose={() => {
          setShoppingFor(null)
          setFocus(null)
        }}
      />
      <ItemSheet open={adding} item={null} roomId={room.id} onClose={() => setAdding(false)} />
      <RoomSheet open={editing} room={room} onClose={() => setEditing(false)} />
      <PersonaliseRoomSheet
        open={personalising}
        room={room}
        onClose={() => setPersonalising(false)}
        onEditDetails={() => { setPersonalising(false); setEditing(true) }}
      />
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
