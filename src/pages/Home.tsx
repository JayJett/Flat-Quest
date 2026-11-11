import { ArrowRight, ChevronRight, Plus } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader } from '@/components/AppShell'
import { ItemRow } from '@/components/ItemRow'
import { HouseholdActivity } from '@/components/HouseholdActivity'
import { HouseholdPhoto } from '@/components/HouseholdPhoto'
import { ItemSheet } from '@/components/ItemSheet'
import { AnimatedNumber, EmptyState, IconButton, ProgressBar, SectionHeader } from '@/components/ui'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import { PRIORITY_RANK, type Item } from '@/lib/domain'
import { nextAction, openItemsFor, progressOf, roomProgress } from '@/lib/stats'
import { useHousehold } from '@/household/HouseholdProvider'

export function HomePage() {
  const { user } = useAuth()
  const { me, household, items, rooms } = useHousehold()
  const [open, setOpen] = useState<Item | null>(null)
  const [adding, setAdding] = useState(false)
  const userId = user?.id ?? ''

  const progress = useMemo(() => progressOf(items), [items])
  const perRoom = useMemo(() => roomProgress(rooms, items), [rooms, items])
  const action = useMemo(() => nextAction(userId, items), [userId, items])
  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms])
  const mine = useMemo(
    () =>
      openItemsFor(userId, items).sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name),
      ),
    [userId, items],
  )
  const firstName = me?.display_name?.split(' ')[0]
  const pct = Math.round(progress.ratio * 100)

  return (
    <>
      <PageHeader
        title={household?.name}
        hideTitleUntilScroll
        actions={
          rooms.length > 0 ? (
            <IconButton label="Add an item" onClick={() => setAdding(true)}>
              <Plus size={24} aria-hidden />
            </IconButton>
          ) : null
        }
      />
      <div className="px-4 lg:px-0">
        <section className="flex items-end gap-4 pt-2 pb-7">
          <div className="min-w-0 flex-1">
            <p className="text-ink-2 text-[17px] font-medium">Kia ora{firstName ? `, ${firstName}` : ''}</p>
            {/* Fluid size keeps the flat name on one line beside the photo on small iPhones. */}
            <h1 className="mt-1 text-[clamp(28px,8.4vw,38px)] leading-[1.06] tracking-[-0.035em] lg:text-[48px]">
              <span className="font-light">Let’s furnish</span>
              <br />
              <span className="font-extrabold [overflow-wrap:anywhere]">{household?.name ?? 'our flat'}</span>
            </h1>
          </div>
          <HouseholdPhoto size="clamp(68px, 21vw, 96px)" />
        </section>

        {progress.total === 0 ? (
          <EmptyState
            title="Nothing on the list yet"
            body="Add rooms and the things your flat needs, or import your checklist from Settings."
            action={
              <Link to="/rooms" className="pressable bg-ink inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-white">
                Go to rooms
              </Link>
            }
          />
        ) : (
          <div className="lg:grid lg:grid-cols-[1.1fr_1fr] lg:gap-10">
            <div>
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
              <HouseholdActivity key={household?.id} />

              {mine.length > 0 && (
                <section className="mt-9" aria-labelledby="mine-h">
                  <SectionHeader
                    title="On your list"
                    action={
                      mine.length > 5 ? (
                        <Link to={`/flatmates/${userId}`} className="text-ink-2 inline-flex min-h-11 items-center text-[15px] font-semibold">
                          See all {mine.length}
                        </Link>
                      ) : undefined
                    }
                  />
                  <h2 id="mine-h" className="sr-only">
                    On your list
                  </h2>
                  <ul>
                    <AnimatePresence initial={false}>
                      {mine.slice(0, 5).map((item) => (
                        <ItemRow key={item.id} item={item} onOpen={setOpen} roomName={roomName.get(item.room_id)} />
                      ))}
                    </AnimatePresence>
                  </ul>
                </section>
              )}
            </div>

            <section className="mt-9 lg:mt-0" aria-label="Room by room">
              <SectionHeader
                title="Room by room"
                action={
                  <Link to="/rooms" className="text-ink-2 inline-flex min-h-11 items-center text-[15px] font-semibold">
                    Show all
                  </Link>
                }
              />
              <ul className="flex flex-col">
                {rooms.map((room) => {
                  const p = perRoom.get(room.id)
                  const c = roomColor(room.color)
                  return (
                    <li key={room.id}>
                      <Link
                        to={`/rooms/${room.id}`}
                        className="pressable active:bg-surface-2 -mx-2 flex min-h-[64px] items-center gap-3.5 rounded-2xl px-2 py-2"
                      >
                        <span
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
                          style={{ backgroundColor: c.hex, color: c.on }}
                          aria-hidden
                        >
                          <RoomIcon name={room.icon} size={22} strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-semibold">{room.name}</span>
                            <span className="text-ink-2 shrink-0 text-[14px] font-semibold tabular-nums">
                              {p?.ready ?? 0}/{p?.total ?? 0}
                            </span>
                          </span>
                          <span className="mt-1.5 block">
                            <ProgressBar value={p && p.total ? p.ready / p.total : 0} color={c.hex} height={5} label={`${room.name} progress`} />
                          </span>
                        </span>
                        <ChevronRight size={18} className="text-ink-3 shrink-0" aria-hidden />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        )}
      </div>

      <ItemSheet open={open !== null} item={open} onClose={() => setOpen(null)} />
      <ItemSheet open={adding} item={null} onClose={() => setAdding(false)} />
    </>
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
      className="pressable bg-accent mt-3 flex items-center justify-between gap-4 rounded-[var(--radius-tile)] p-5 text-white"
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
