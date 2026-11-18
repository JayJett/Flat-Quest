import { ArrowRight, ChevronRight, Plus, ShoppingBag, ShoppingBasket, SlidersHorizontal, Truck, CalendarDays } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/AppShell'
import { ItemRow } from '@/components/ItemRow'
import { HouseholdActivity } from '@/components/HouseholdActivity'
import { HouseholdPhoto } from '@/components/HouseholdPhoto'
import { ItemSheet } from '@/components/ItemSheet'
import { AnimatedNumber, EmptyState, IconButton, ProgressBar, SectionHeader } from '@/components/ui'
import { roomColor } from '@/design/tokens'
import type { EssentialRow, TaskRow } from '@/lib/database.types'
import { friendlyDay } from '@/lib/dates'
import { joinNames, PRIORITY_RANK, type Item } from '@/lib/domain'
import { EssentialItem, EssentialSheet } from '@/living/EssentialParts'
import { HomeLayoutSheet, QuickAddSheet, type QuickAddKind } from '@/living/HomeSheets'
import { isActiveEssential, needsAttention, sortEssentials, sortTasks } from '@/living/living'
import { useLiving } from '@/living/LivingProvider'
import { TaskItem, TaskSheet } from '@/living/TaskParts'
import { SPRINGS } from '@/motion/motion'
import { usePreferences } from '@/personal/PreferencesProvider'
import { greeting, type HomeSectionId } from '@/personal/themes'
import { useShopping } from '@/shopping/ShoppingProvider'
import { shoppingSummary, summaryLine } from '@/lib/shopping'
import { nextAction, openItemsFor, progressOf } from '@/lib/stats'
import { useHousehold } from '@/household/HouseholdProvider'

export function HomePage() {
  const { me, household, items } = useHousehold()
  const { prefs, motion: level } = usePreferences()
  const [quickAdd, setQuickAdd] = useState<QuickAddKind | null>(null)
  const [customising, setCustomising] = useState(false)
  const progress = useMemo(() => progressOf(items), [items])
  const firstName = me?.display_name?.split(' ')[0]
  const name = prefs.greetingName || firstName
  // Sections with nothing to show (no deliveries in transit, no rooms) take no space at all.
  const inTransit = items.some((i) => !i.is_complete && (i.status === 'ordered' || i.status === 'on_the_way' || i.status === 'ready_to_collect'))
  const sections = prefs.layout.filter((s) => !s.hidden && (s.id !== 'deliveries' || inTransit))

  return (
    <>
      <PageHeader
        title={household?.name}
        hideTitleUntilScroll
        actions={
          <IconButton label="Quick add" onClick={() => setQuickAdd('essential')}>
            <Plus size={24} aria-hidden />
          </IconButton>
        }
      />
      <div className="px-4 lg:px-0">
        <section className="flex items-end gap-4 pt-2 pb-7">
          <div className="min-w-0 flex-1">
            <p className="text-ink-2 text-[17px] font-medium" data-testid="greeting">
              {greeting(name)}
            </p>
            {/* Fluid size keeps the flat name on one line beside the photo on small iPhones. */}
            <h1 className="mt-1 text-[clamp(28px,8.4vw,38px)] leading-[1.06] tracking-[-0.035em] lg:text-[48px]">
              <span className="font-light">{progress.total > 0 && progress.ready < progress.total ? 'Let’s furnish' : 'Welcome home to'}</span>
              <br />
              <span className="font-extrabold [overflow-wrap:anywhere]">{household?.name ?? 'our flat'}</span>
            </h1>
          </div>
          <HouseholdPhoto size="clamp(68px, 21vw, 96px)" />
        </section>

        {/* Furnishing progress is always first and always shown; it isn't part of the
            personal layout, so it never moves while the sections below rearrange. */}
        <div data-section="progress" className="lg:max-w-[calc(50%-20px)]">
          <ProgressSection />
        </div>

        <div className="grid items-start gap-x-10 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {sections.map((s) => (
              <motion.div
                key={s.id}
                layout={level !== 'reduced' ? 'position' : false}
                initial={level === 'reduced' ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={SPRINGS[level].settle}
                className="min-w-0"
                data-section={s.id}
              >
                <HomeSection id={s.id} onAdd={setQuickAdd} focusShown={sections.some((x) => x.id === 'focus')} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => setCustomising(true)}
            className="pressable text-ink-2 active:bg-surface-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[15px] font-semibold"
          >
            <SlidersHorizontal size={18} aria-hidden />
            Customise Home
          </button>
        </div>
      </div>

      <QuickAddSheet open={quickAdd !== null} initial={quickAdd ?? 'essential'} onClose={() => setQuickAdd(null)} />
      <HomeLayoutSheet open={customising} onClose={() => setCustomising(false)} />
    </>
  )
}

function HomeSection({ id, onAdd, focusShown }: { id: HomeSectionId; onAdd: (k: QuickAddKind) => void; focusShown: boolean }) {
  switch (id) {
    case 'focus':
      return <FocusSection />
    case 'tasks':
      return <TasksSection onAdd={() => onAdd('task')} skipMine={focusShown} />
    case 'essentials':
      return <EssentialsSection onAdd={() => onAdd('essential')} />
    case 'deliveries':
      return <DeliveriesSection />
    case 'activity':
      return <HouseholdActivityWrapper />
  }
}

function SeeAll({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-ink-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 text-[15px] font-semibold whitespace-nowrap">
      {children}
      <ChevronRight size={16} aria-hidden />
    </Link>
  )
}

/** Everything that's yours right now, across tasks, pick-ups and furnishing. */
function FocusSection() {
  const { user } = useAuth()
  const { items, rooms } = useHousehold()
  const { tasks, essentials } = useLiving()
  const [openItem, setOpenItem] = useState<Item | null>(null)
  const [openTask, setOpenTask] = useState<TaskRow | null>(null)
  const uid = user?.id ?? ''
  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms])
  const myTasks = sortTasks(tasks.filter((t) => t.assignee_id === uid && t.status !== 'done' && !t.archived_at)).slice(0, 3)
  const pickups = essentials.filter((e) => e.status === 'getting' && e.claimed_by === uid && !e.archived_at)
  const myItems = openItemsFor(uid, items)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name))
    .slice(0, 3)
  const empty = !myTasks.length && !pickups.length && !myItems.length
  return (
    <section className="mt-2 mb-9" aria-labelledby="focus-h">
      <SectionHeader title="For you" action={<SeeAll to={`/flatmates/${uid}`}>My list</SeeAll>} />
      <h2 id="focus-h" className="sr-only">
        For you
      </h2>
      {empty ? (
        <p className="text-ink-2 text-[15px]">Nothing on your plate right now.</p>
      ) : (
        <>
          {pickups.length > 0 && (
            <Link to="/essentials" className="pressable bg-accent-soft mb-2 flex min-h-14 items-center gap-3 rounded-2xl px-4 py-2">
              <ShoppingBasket size={20} className="text-accent-ink shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-[15px]">
                <span className="font-bold">You’re picking up</span> {joinNames(pickups.map((e) => e.name))}
              </span>
            </Link>
          )}
          <ul>
            <AnimatePresence initial={false}>
              {myTasks.map((t) => (
                <TaskItem key={t.id} task={t} onOpen={setOpenTask} />
              ))}
              {myItems.map((item) => (
                <ItemRow key={item.id} item={item} onOpen={setOpenItem} roomName={roomName.get(item.room_id)} />
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}
      <ItemSheet open={openItem !== null} item={openItem} onClose={() => setOpenItem(null)} />
      <TaskSheet task={openTask} onClose={() => setOpenTask(null)} />
    </section>
  )
}

/** Household tasks that need attention. Yours are already under "For you" when that's shown. */
function TasksSection({ onAdd, skipMine }: { onAdd: () => void; skipMine: boolean }) {
  const { user } = useAuth()
  const { tasks } = useLiving()
  const [open, setOpen] = useState<TaskRow | null>(null)
  const live = tasks.filter((t) => !t.archived_at && t.status !== 'done')
  const others = skipMine ? live.filter((t) => t.assignee_id !== user?.id) : live
  const urgent = sortTasks(others.filter((t) => needsAttention(t)))
  const shown = (urgent.length ? urgent : sortTasks(others)).slice(0, 4)
  return (
    <section className="mb-9" aria-labelledby="tasks-h">
      <SectionHeader title="Things to do" action={<SeeAll to="/tasks">{live.length ? `All ${live.length}` : 'Open'}</SeeAll>} />
      <h2 id="tasks-h" className="sr-only">
        Things to do
      </h2>
      {shown.length === 0 ? (
        <p className="text-ink-2 text-[15px]">{live.length ? 'Nothing else waiting.' : 'Nothing waiting. Nice.'}</p>
      ) : (
        <ul>
          <AnimatePresence initial={false}>
            {shown.map((t) => (
              <TaskItem key={t.id} task={t} onOpen={setOpen} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      <AddRow onClick={onAdd}>Add a task</AddRow>
      <TaskSheet task={open} onClose={() => setOpen(null)} />
    </section>
  )
}

function EssentialsSection({ onAdd }: { onAdd: () => void }) {
  const { essentials } = useLiving()
  const [open, setOpen] = useState<EssentialRow | null>(null)
  const active = sortEssentials(essentials.filter(isActiveEssential))
  return (
    <section className="mb-9" aria-labelledby="essentials-h">
      <SectionHeader title="Essentials" action={<SeeAll to="/essentials">{active.length ? `${active.length} needed` : 'Open'}</SeeAll>} />
      <h2 id="essentials-h" className="sr-only">
        Essentials
      </h2>
      {active.length === 0 ? (
        <p className="text-ink-2 text-[15px]">Everything’s stocked.</p>
      ) : (
        <ul>
          <AnimatePresence initial={false}>
            {active.slice(0, 5).map((e) => (
              <EssentialItem key={e.id} essential={e} onOpen={setOpen} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      <AddRow onClick={onAdd}>Add something we need</AddRow>
      <EssentialSheet essential={open} onClose={() => setOpen(null)} />
    </section>
  )
}

function AddRow({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable text-accent-ink active:bg-accent-soft -mx-2 mt-1 flex min-h-12 w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 font-bold"
    >
      <span className="bg-accent-soft flex h-[30px] w-[30px] items-center justify-center rounded-full">
        <Plus size={18} strokeWidth={2.6} aria-hidden />
      </span>
      {children}
    </button>
  )
}

/** Furniture that's ordered or on its way. Hidden when there's nothing in transit. */
function DeliveriesSection() {
  const { items, rooms } = useHousehold()
  const { purchaseByItem } = useShopping()
  const coming = items
    .filter((i) => !i.is_complete && (i.status === 'ordered' || i.status === 'on_the_way' || i.status === 'ready_to_collect'))
    .map((i) => ({ item: i, expected: purchaseByItem.get(i.id)?.expected_on ?? null }))
    .sort((a, b) => (a.expected ?? '9999').localeCompare(b.expected ?? '9999'))
  if (coming.length === 0) return null
  const roomOf = new Map(rooms.map((r) => [r.id, r]))
  return (
    <section className="mb-9" aria-labelledby="deliveries-h">
      <SectionHeader title="On the way" action={<SeeAll to="/rooms/shopping">All orders</SeeAll>} />
      <h2 id="deliveries-h" className="sr-only">
        On the way
      </h2>
      <ul>
        {coming.slice(0, 4).map(({ item, expected }) => {
          const room = roomOf.get(item.room_id)
          const c = roomColor(room?.color ?? 'blue')
          return (
            <li key={item.id}>
              <Link to={`/rooms/${item.room_id}?item=${item.id}`} className="pressable active:bg-surface-2 -mx-2 flex min-h-14 items-center gap-3 rounded-2xl px-2 py-1.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]" style={{ backgroundColor: c.hex, color: c.on }} aria-hidden>
                  <Truck size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{item.name}</span>
                  <span className="text-ink-2 block truncate text-[14px]">
                    {item.status === 'ready_to_collect' ? 'Ready to collect' : item.status === 'on_the_way' ? 'On the way' : 'Ordered'}
                    {expected ? ` · ${friendlyDay(expected)}` : ''}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ProgressSection() {
  const { user } = useAuth()
  const { items } = useHousehold()
  const progress = useMemo(() => progressOf(items), [items])
  const action = useMemo(() => nextAction(user?.id ?? '', items), [user?.id, items])
  const shopping = useMemo(() => shoppingSummary(items), [items])
  const pct = Math.round(progress.ratio * 100)
  if (progress.total === 0) {
    return (
      <div className="mb-9">
        <EmptyState
          title="Nothing on the furnishing list yet"
          body="Add rooms and the things your flat needs, or import your checklist from Settings."
          action={
            <Link to="/rooms" className="pressable bg-ink inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-white">
              Go to rooms
            </Link>
          }
        />
      </div>
    )
  }
  return (
    <div className="mb-9">
      {/* Overall progress: real counts, no decoration. */}
      <section aria-labelledby="progress-h" data-tour="progress" className="bg-surface-2 rounded-[var(--radius-tile)] p-5">
        <h2 id="progress-h" className="sr-only">
          Household progress
        </h2>
        <div className="flex items-end justify-between gap-4">
          <p className="text-[56px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
            <AnimatedNumber value={pct} />
            <span className="text-[28px] tracking-normal">%</span>
          </p>
          <p className="text-ink-2 pb-1 text-right text-[15px] font-medium">
            {progress.ready} of {progress.total}
            <br />
            in the flat
          </p>
        </div>
        <div className="mt-4">
          <ProgressBar value={progress.ratio} color="var(--color-green)" track="#E3E3E7" height={10} label="Items in the flat" />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-2">
          <Stat label="Ready" value={progress.ready} />
          <Stat label="To sort" value={progress.outstanding} />
          <Stat label="Unclaimed" value={progress.unclaimed} />
        </dl>
      </section>
      <NextActionCard action={action} />
      {shopping.toBuy + shopping.inProgress > 0 && (
        <Link
          to="/rooms/shopping"
          className="pressable bg-surface-2 active:bg-surface-3 mt-3 flex min-h-[68px] items-center gap-3.5 rounded-[var(--radius-card)] px-5 py-3"
        >
          <ShoppingBag size={24} strokeWidth={1.9} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] leading-snug font-bold">Shopping</span>
            <span className="text-ink-2 block truncate text-[15px]">{summaryLine(shopping)}</span>
          </span>
          <ChevronRight size={18} className="text-ink-3 shrink-0" aria-hidden />
        </Link>
      )}
      {/* The shared week sits after progress, never before it. */}
      <Link
        to="/calendar"
        className="pressable bg-surface-2 active:bg-surface-3 mt-3 flex min-h-[68px] items-center gap-3.5 rounded-[var(--radius-card)] px-5 py-3"
        data-testid="home-calendar-link"
      >
        <CalendarDays size={24} strokeWidth={1.9} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-snug font-bold">This week</span>
          <span className="text-ink-2 block truncate text-[15px]">Tasks, deliveries and appointments</span>
        </span>
        <ChevronRight size={18} className="text-ink-3 shrink-0" aria-hidden />
      </Link>
    </div>
  )
}

function HouseholdActivityWrapper() {
  const { household } = useHousehold()
  return (
    <div className="mb-9">
      <HouseholdActivity key={household?.id} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-ink-2 text-[14px] font-medium">{label}</dt>
      <dd className="text-[22px] font-bold tabular-nums">
        <AnimatedNumber value={value} />
      </dd>
    </div>
  )
}

function NextActionCard({ action }: { action: ReturnType<typeof nextAction> }) {
  const { user } = useAuth()
  let title: string
  let body: string
  let to: string
  let cta: string
  switch (action.kind) {
    case 'mine':
      title = action.count === 1 ? 'You’ve got 1 thing to sort' : `You’ve got ${action.count} things to sort`
      body = 'Bring them in, then tick them off.'
      to = `/flatmates/${user?.id ?? ''}`
      cta = 'See my list'
      break
    case 'claim':
      title =
        action.mustHaves > 0
          ? `${action.mustHaves} must-have${action.mustHaves === 1 ? '' : 's'} need${action.mustHaves === 1 ? 's' : ''} someone`
          : `${action.count} item${action.count === 1 ? '' : 's'} still unclaimed`
      body = 'Already own one, or happy to buy it? Claim it.'
      to = '/rooms?filter=unclaimed'
      cta = 'Find something to claim'
      break
    case 'finish':
      title = `${action.count} to go`
      body = 'Everything’s claimed. Tick items off as they arrive.'
      to = '/rooms'
      cta = 'Open rooms'
      break
    case 'done':
      title = 'The flat is fully furnished'
      body = 'Every item is in. Nice work, team.'
      to = '/rooms'
      cta = 'Have a look'
      break
    default:
      return null
  }
  return (
    <Link
      to={to}
      className="pressable bg-accent mt-3 flex items-center justify-between gap-4 rounded-[var(--radius-tile)] p-5 text-on-accent"
    >
      <span className="min-w-0">
        <span className="block text-[19px] leading-snug font-bold">{title}</span>
        <span className="mt-1 block text-[15px] text-white/85">{body}</span>
        <span className="mt-3 inline-flex items-center gap-1.5 text-[15px] font-bold">
          {cta} <ArrowRight size={18} aria-hidden />
        </span>
      </span>
    </Link>
  )
}
