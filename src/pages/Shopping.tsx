import { ChevronRight, SlidersHorizontal } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/AppShell'
import { Avatar, AvatarGroup, useSignedUrl } from '@/components/Avatar'
import { assigneeMembers, STATUS_TONE } from '@/components/ItemRow'
import { RoomsViewSwitch } from '@/components/RoomsViewSwitch'
import { Sheet } from '@/components/Sheet'
import { AnimatedNumber, Button, EmptyState, Field } from '@/components/ui'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import { useHousehold } from '@/household/HouseholdProvider'
import { todayLocal } from '@/lib/dates'
import { isPriority, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type Member, type Room } from '@/lib/domain'
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  deliveryLine,
  formatPrice,
  GROUP_LABEL,
  optionsLine,
  SHOPPING_GROUPS,
  shoppingEntries,
  shoppingSections,
  shoppingSummary,
  SORT_LABEL,
  type ShoppingContext,
  type ShoppingEntry,
  type ShoppingFilters,
  type ShoppingGroup,
  type ShoppingSort,
  type StageFilter,
} from '@/lib/shopping'
import { useShopping } from '@/shopping/ShoppingProvider'
import { ShoppingSheet } from '@/shopping/ShoppingSheet'

const SORTS = Object.keys(SORT_LABEL) as ShoppingSort[]

/** Filters live in the address bar, so Back and shared links keep them. */
function readFilters(params: URLSearchParams, rooms: Room[], members: Member[]): { filters: ShoppingFilters; sort: ShoppingSort } {
  const room = params.get('room')
  const who = params.get('who')
  const priority = params.get('priority')
  const stage = params.get('stage')
  const sort = params.get('sort')
  return {
    filters: {
      room: room && rooms.some((r) => r.id === room) ? room : 'all',
      who: who === 'me' || who === 'none' || (who && members.some((m) => m.userId === who)) ? who : 'all',
      priority: isPriority(priority) ? priority : 'all',
      stage: stage === 'to_decide' || (SHOPPING_GROUPS as string[]).includes(stage ?? '') ? (stage as StageFilter) : 'active',
    },
    sort: SORTS.includes(sort as ShoppingSort) ? (sort as ShoppingSort) : 'stage',
  }
}

export function ShoppingPage() {
  const { user } = useAuth()
  const { items, rooms, members, memberById } = useHousehold()
  const shopping = useShopping()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<string | null>(null)
  const [filtering, setFiltering] = useState(false)
  const myId = user?.id ?? ''
  const { filters, sort } = useMemo(() => readFilters(params, rooms, members), [params, rooms, members])

  const update = (patch: Partial<ShoppingFilters> & { sort?: ShoppingSort }) => {
    const next = { ...filters, sort, ...patch }
    const out: Record<string, string> = {}
    if (next.room !== 'all') out.room = next.room
    if (next.who !== 'all') out.who = next.who
    if (next.priority !== 'all') out.priority = next.priority
    if (next.stage !== 'active') out.stage = next.stage
    if (next.sort !== 'stage') out.sort = next.sort
    // Commit each native select change before a second select reads the filters.
    // Safari can otherwise apply a rapid change against the previous URL state.
    setParams(out, { replace: true, flushSync: true })
  }

  const ctx = useMemo<ShoppingContext>(
    () => ({
      myId,
      roomOrder: new Map(rooms.map((r, i) => [r.id, i])),
      optionsByItem: shopping.optionsByItem,
      purchaseByItem: shopping.purchaseByItem,
      coordinatorByItem: shopping.coordinatorByItem,
    }),
    [myId, rooms, shopping.optionsByItem, shopping.purchaseByItem, shopping.coordinatorByItem],
  )
  const entries = useMemo(() => shoppingEntries(items, filters, ctx), [items, filters, ctx])
  const sections = useMemo(() => shoppingSections(entries, sort, ctx), [entries, sort, ctx])
  const summary = useMemo(() => shoppingSummary(items), [items])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
  const filterCount = activeFilterCount(filters)
  const today = todayLocal()

  const chips = [
    filters.room !== 'all' ? roomById.get(filters.room)?.name : null,
    filters.who === 'me' ? 'Mine' : filters.who === 'none' ? 'Nobody on it' : filters.who !== 'all' ? memberById.get(filters.who)?.profile.display_name : null,
    filters.priority !== 'all' ? PRIORITY_LABEL[filters.priority] : null,
    filters.stage === 'to_decide' ? 'Still to decide' : filters.stage !== 'active' ? GROUP_LABEL[filters.stage] : null,
  ].filter(Boolean) as string[]

  return (
    <>
      <PageHeader title="Shopping" hideTitleUntilScroll />
      <div className="px-4 lg:px-0">
        <div className="pt-2 pb-5">
          <h1 className="text-display font-extrabold">Shopping</h1>
          <p className="text-ink-2 mt-1 text-[16px]">
            {summary.toBuy + summary.inProgress === 0 ? (
              'Nothing on the shopping list right now'
            ) : (
              <>
                <AnimatedNumber value={summary.toBuy} /> to buy · <AnimatedNumber value={summary.inProgress} /> on order
              </>
            )}
          </p>
        </div>

        <RoomsViewSwitch view="shopping" />

        <div className="mb-1 flex min-h-11 items-center justify-between gap-3">
          <p className="text-ink-2 min-w-0 truncate text-[15px]" aria-live="polite">
            {chips.length > 0 ? chips.join(' · ') : sort === 'stage' ? 'Everything being bought' : `Sorted by ${SORT_LABEL[sort].toLowerCase()}`}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {filterCount > 0 && (
              <button type="button" onClick={() => update({ ...DEFAULT_FILTERS })} className="text-ink-2 min-h-11 px-2 text-[15px] font-semibold">
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setFiltering(true)}
              className="pressable bg-surface-2 active:bg-surface-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold"
              aria-label={filterCount > 0 ? `Filter and sort, ${filterCount} filter${filterCount === 1 ? '' : 's'} on` : 'Filter and sort'}
            >
              <SlidersHorizontal size={18} aria-hidden />
              Filter
              {filterCount > 0 && <span className="tabular-nums">{filterCount}</span>}
            </button>
          </div>
        </div>

        {sections.length === 0 ? (
          <EmptyState
            title={filterCount > 0 ? 'Nothing matches those filters' : 'Nothing to buy right now'}
            body={
              filterCount > 0
                ? 'Try clearing a filter.'
                : 'Items show up here once their plan is Need to buy, Shopping or Ordered. Things flatmates are bringing stay off this list.'
            }
            action={
              filterCount > 0 ? (
                <Button variant="secondary" onClick={() => update({ ...DEFAULT_FILTERS })}>
                  Clear filters
                </Button>
              ) : summary.undecided > 0 ? (
                <Button variant="ink" onClick={() => update({ stage: 'to_decide' })}>
                  Look through {summary.undecided} undecided item{summary.undecided === 1 ? '' : 's'}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <motion.div
            key={`${params.toString()}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            className="lg:max-w-2xl"
          >
            {sections.map((section) => (
              <section key={section.key} className="mt-4" aria-label={section.label || 'Items'}>
                {section.label && (
                  <h2 className="text-ink-2 mb-1 text-[14px] font-bold">
                    {section.label} <span className="font-medium tabular-nums">· {section.entries.length}</span>
                  </h2>
                )}
                <ul>
                  <AnimatePresence initial={false}>
                    {section.entries.map((entry) => (
                      <ShoppingRow
                        key={entry.item.id}
                        entry={entry}
                        room={roomById.get(entry.item.room_id)}
                        showStage={sort !== 'stage'}
                        today={today}
                        onOpen={() => setOpen(entry.item.id)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ))}
          </motion.div>
        )}

        {filters.stage === 'active' && filterCount === 0 && sections.length > 0 && summary.undecided > 0 && (
          <button
            type="button"
            onClick={() => update({ stage: 'to_decide' })}
            className="pressable text-ink-2 active:bg-surface-2 -mx-2 mt-5 flex min-h-14 w-[calc(100%+16px)] items-center justify-between gap-3 rounded-2xl px-2 text-left text-[15px] lg:max-w-2xl"
          >
            <span>
              <span className="text-ink font-semibold tabular-nums">{summary.undecided}</span> item{summary.undecided === 1 ? ' is' : 's are'} still undecided. See
              if any need buying
            </span>
            <ChevronRight size={18} className="text-ink-3 shrink-0" aria-hidden />
          </button>
        )}
      </div>

      <FilterSheet
        open={filtering}
        onClose={() => setFiltering(false)}
        filters={filters}
        sort={sort}
        count={entries.length}
        onChange={update}
      />
      <ShoppingSheet open={open !== null} itemId={open} onClose={() => setOpen(null)} />
    </>
  )
}

function ShoppingRow({ entry, room, showStage, today, onOpen }: { entry: ShoppingEntry; room?: Room; showStage: boolean; today: string; onOpen: () => void }) {
  const { user } = useAuth()
  const { memberById } = useHousehold()
  const { optionsByItem, purchaseByItem, coordinatorByItem } = useShopping()
  const { item } = entry
  const options = optionsByItem.get(item.id) ?? []
  const purchase = purchaseByItem.get(item.id)
  const coordinator = coordinatorByItem.get(item.id)
  const sorter = !item.is_complete && coordinator ? memberById.get(coordinator.user_id) : undefined
  const people = assigneeMembers(item, memberById)
  const lead = options.find((o) => o.is_selected && o.photo_path) ?? options.find((o) => o.photo_path)
  const stage = item.is_complete ? 'In the flat' : STATUS_LABEL[item.status]
  const detail =
    deliveryLine(item, purchase, today) ||
    (item.is_complete && item.actual_price != null ? `Paid ${formatPrice(item.actual_price)}` : '') ||
    optionsLine(options) ||
    (item.estimated_price != null ? `About ${formatPrice(item.estimated_price)}` : '')
  const who = sorter
    ? sorter.userId === user?.id
      ? 'You’re sorting this'
      : `${sorter.profile.display_name} is sorting this`
    : people.length > 0
      ? `${people.map((m) => (m.userId === user?.id ? 'you' : m.profile.display_name)).join(', ')} on it`
      : 'Nobody on it yet'

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="list-none"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${item.name}. ${stage}. ${[room?.name, detail, who].filter(Boolean).join('. ')}. Open shopping details`}
        className="pressable active:bg-surface-2 -mx-2 flex min-h-[72px] w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 py-2 text-left"
      >
        <RowThumb path={lead?.photo_path ?? null} room={room} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[16px] leading-snug font-semibold ${item.is_complete ? 'text-ink-2' : ''}`}>{item.name}</span>
          <span className="text-ink-2 mt-0.5 block truncate text-[14px]">
            {showStage && <span className={`font-medium ${item.is_complete ? 'text-green-ink' : STATUS_TONE[item.status]}`}>{stage} · </span>}
            {[room?.name, detail].filter(Boolean).join(' · ')}
          </span>
        </span>
        {sorter ? (
          <span className="relative shrink-0" role="img" aria-label={who}>
            <Avatar profile={sorter.profile} size={32} decorative />
          </span>
        ) : people.length > 0 ? (
          <AvatarGroup profiles={people.map((m) => m.profile)} size={28} label={who} />
        ) : null}
      </button>
    </motion.li>
  )
}

/** The chosen product's photo when there is one; otherwise the room's colour tile. */
function RowThumb({ path, room }: { path: string | null; room?: Room }) {
  const url = useSignedUrl('household-media', path)
  const c = roomColor(room?.color ?? 'blue')
  return (
    <span
      className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[15px]"
      style={url ? undefined : { backgroundColor: c.hex, color: c.on }}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : <RoomIcon name={room?.icon ?? 'house'} size={24} strokeWidth={1.9} />}
    </span>
  )
}

function FilterSheet({
  open,
  onClose,
  filters,
  sort,
  count,
  onChange,
}: {
  open: boolean
  onClose: () => void
  filters: ShoppingFilters
  sort: ShoppingSort
  count: number
  onChange: (patch: Partial<ShoppingFilters> & { sort?: ShoppingSort }) => void
}) {
  const { user } = useAuth()
  const { rooms, members } = useHousehold()
  const ids = { room: useId(), who: useId(), priority: useId(), stage: useId(), sort: useId() }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filter and sort"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" size="lg" className="flex-1" disabled={activeFilterCount(filters) === 0 && sort === 'stage'} onClick={() => onChange({ ...DEFAULT_FILTERS, sort: 'stage' })}>
            Reset
          </Button>
          <Button size="lg" className="flex-[1.4]" onClick={onClose}>
            Show {count} item{count === 1 ? '' : 's'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pt-2 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Room" htmlFor={ids.room}>
            <select id={ids.room} className="field appearance-none" value={filters.room} onChange={(e) => onChange({ room: e.target.value })}>
              <option value="all">All rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Who" htmlFor={ids.who}>
            <select id={ids.who} className="field appearance-none" value={filters.who} onChange={(e) => onChange({ who: e.target.value })}>
              <option value="all">Everyone</option>
              <option value="me">Me</option>
              {members
                .filter((m) => m.userId !== user?.id)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.profile.display_name}
                  </option>
                ))}
              <option value="none">Nobody yet</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor={ids.priority}>
            <select id={ids.priority} className="field appearance-none" value={filters.priority} onChange={(e) => onChange({ priority: e.target.value as ShoppingFilters['priority'] })}>
              <option value="all">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stage" htmlFor={ids.stage}>
            <select id={ids.stage} className="field appearance-none" value={filters.stage} onChange={(e) => onChange({ stage: e.target.value as StageFilter })}>
              <option value="active">All stages</option>
              {SHOPPING_GROUPS.map((g: ShoppingGroup) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
              <option value="to_decide">Still to decide</option>
            </select>
          </Field>
        </div>
        <Field label="Sort by" htmlFor={ids.sort}>
          <select id={ids.sort} className="field appearance-none" value={sort} onChange={(e) => onChange({ sort: e.target.value as ShoppingSort })}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Sheet>
  )
}
