import { AtSign, Bell, Check, CheckCheck, Gift, Images, MessageCircle, PackageCheck, ShoppingBag, Sparkles, Truck, UserRound, Users, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from '@/components/Avatar'
import { useFocusTrap } from '@/components/Sheet'
import { Segmented, Spinner } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { dayGroup, describeEvent, eventTime, plainText, type EventKind } from '@/lib/events'
import { useEventLookup, useNotifications, type Notice } from './NotificationProvider'

const KIND_ICON: Record<EventKind, LucideIcon> = {
  item: ShoppingBag,
  done: PackageCheck,
  stage: Truck,
  assign: UserRound,
  option: ShoppingBag,
  buy: ShoppingBag,
  milestone: Sparkles,
  photo: Images,
  idea: Gift,
  comment: MessageCircle,
  member: Users,
  history: Bell,
}

/** Top-right bell. The badge only appears when something is unread. */
export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const { unread } = useNotifications()
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-haspopup="dialog"
      data-testid="notification-bell"
      className="pressable text-ink active:bg-surface-2 relative inline-flex h-11 w-11 items-center justify-center rounded-full"
    >
      <Bell size={23} aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          data-testid="notification-badge"
          className="bg-danger ring-surface absolute top-1 right-0.5 flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold text-white tabular-nums ring-2"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

/** Fraction of the panel's width (or a quick flick) that closes it. */
const CLOSE_FRACTION = 0.33
const CLOSE_VELOCITY = 500

export function NotificationDrawer({
  open,
  onClose,
  onOpenNotice,
}: {
  open: boolean
  onClose: () => void
  onOpenNotice: (notice: Notice) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  useFocusTrap(open, ref, onClose)
  // Backdrop fades with the drag so the panel visibly "lets go" of the page.
  const fade = useMotionValue(1)

  const onDrag = (_: unknown, info: PanInfo) => {
    const width = ref.current?.offsetWidth ?? 360
    fade.set(Math.max(0, 1 - Math.max(0, info.offset.x) / width))
  }
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const width = ref.current?.offsetWidth ?? 360
    if (info.offset.x > width * CLOSE_FRACTION || info.velocity.x > CLOSE_VELOCITY) onClose()
    else animate(fade, 1, { duration: reduce ? 0 : 0.2 })
  }

  return createPortal(
    <AnimatePresence onExitComplete={() => fade.set(1)}>
      {open && (
        <div className="fixed inset-0 z-50" data-testid="notification-layer">
          <motion.div
            className="absolute inset-0 bg-[rgb(17_17_17/0.28)]"
            style={{ opacity: fade }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
            onClick={onClose}
            data-testid="notification-backdrop"
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-title"
            tabIndex={-1}
            data-testid="notification-drawer"
            className="bg-surface shadow-float absolute inset-y-0 right-0 flex w-[min(92vw,420px)] flex-col rounded-l-[28px] outline-none"
            style={{ paddingRight: 'var(--safe-right)', touchAction: 'pan-y' }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%', transition: { duration: reduce ? 0 : 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 44 }}
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 1 }}
            dragMomentum={false}
            dragSnapToOrigin
            onDrag={onDrag}
            onDragEnd={onDragEnd}
          >
            <NotificationPanel onClose={onClose} onOpenNotice={onOpenNotice} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

type View = 'all' | 'unread'

function NotificationPanel({ onClose, onOpenNotice }: { onClose: () => void; onOpenNotice: (n: Notice) => void }) {
  const { notices, unread, loading, error, hasMore, loadMore, markRead, markAllRead, retry } = useNotifications()
  const [view, setView] = useState<View>('all')
  const [loadingMore, setLoadingMore] = useState(false)
  const visible = useMemo(() => (view === 'unread' ? notices.filter((n) => !n.read_at) : notices), [notices, view])
  const groups = useMemo(() => {
    const out: { label: string; items: Notice[] }[] = []
    for (const n of visible) {
      const label = dayGroup(n.created_at)
      const last = out.at(-1)
      if (last?.label === label) last.items.push(n)
      else out.push({ label, items: [n] })
    }
    return out
  }, [visible])

  return (
    <>
      <div className="border-line shrink-0 border-b px-5 pb-3" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h2 id="notifications-title" className="text-[22px] font-extrabold tracking-[-0.01em]">
            Notifications
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            data-autofocus
            className="pressable text-ink-2 active:bg-surface-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full"
          >
            <X size={22} aria-hidden />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Segmented
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: 'all', label: 'All' },
                { value: 'unread', label: 'Unread', count: unread },
              ]}
            />
          </div>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unread === 0}
            className="pressable text-accent inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[14px] font-bold disabled:opacity-35"
          >
            <CheckCheck size={18} aria-hidden />
            Mark all read
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
        {error && (
          <div role="alert" className="bg-danger-soft text-danger mx-2 mt-3 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] font-semibold">
            {error}
            <button type="button" onClick={retry} className="pressable min-h-11 shrink-0 underline">
              Retry
            </button>
          </div>
        )}
        {loading && notices.length === 0 ? (
          <div className="flex justify-center py-16">
            <Spinner label="Loading notifications" />
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-16 text-center" data-testid="notifications-empty">
            <span className="bg-surface-2 text-ink-2 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
              {view === 'unread' || notices.length > 0 ? <Check size={26} aria-hidden /> : <Bell size={24} aria-hidden />}
            </span>
            <p className="mt-4 text-[18px] font-bold">{notices.length === 0 ? 'No notifications yet' : 'You’re all caught up'}</p>
            <p className="text-ink-2 mt-1 text-[14px]">
              {notices.length === 0
                ? 'Mentions, replies and changes to things you look after will show up here.'
                : 'Nothing new since you last looked.'}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="mt-3">
              <h3 className="text-ink-2 px-2 pb-1 text-[13px] font-bold">{g.label}</h3>
              <ul>
                {g.items.map((n) => (
                  <NoticeRow key={n.id} notice={n} onOpen={() => onOpenNotice(n)} onMarkRead={() => void markRead(n.id)} />
                ))}
              </ul>
            </section>
          ))
        )}
        {hasMore && view === 'all' && visible.length > 0 && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true)
              await loadMore()
              setLoadingMore(false)
            }}
            className="pressable text-ink-2 mx-auto mt-3 flex min-h-11 items-center rounded-xl px-4 text-[14px] font-bold"
          >
            {loadingMore ? 'Loading…' : 'Show older'}
          </button>
        )}
      </div>
    </>
  )
}

function NoticeRow({ notice, onOpen, onMarkRead }: { notice: Notice; onOpen: () => void; onMarkRead: () => void }) {
  const look = useEventLookup()
  const { memberById } = useHousehold()
  const unread = !notice.read_at
  if (!notice.event) return null
  const described = describeEvent(notice.event, look, notice.reason)
  const actor = notice.event.actor_id && notice.event.type !== 'room_completed' ? (memberById.get(notice.event.actor_id)?.profile ?? null) : null
  const Icon = notice.reason === 'mention' ? AtSign : KIND_ICON[described.kind]
  const text = plainText(described.segments)
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        data-testid="notification-row"
        data-unread={unread || undefined}
        aria-label={`${unread ? 'Unread: ' : ''}${text}, ${eventTime(notice.created_at)}`}
        className={`pressable flex w-full items-start gap-3 rounded-2xl py-3 pr-12 pl-2 text-left ${unread ? 'bg-accent-soft' : 'active:bg-surface-2'}`}
      >
        <span className="relative shrink-0">
          {actor ? (
            <Avatar profile={actor} size={40} decorative />
          ) : (
            <span className="bg-surface-2 text-ink-2 flex h-10 w-10 items-center justify-center rounded-full">
              <Icon size={19} aria-hidden />
            </span>
          )}
          {actor && (
            <span className="bg-surface text-ink absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full">
              <Icon size={12} strokeWidth={2.4} aria-hidden />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] leading-snug ${unread ? 'text-ink' : 'text-ink-2'}`}>
            {described.segments.map((s, i) =>
              s.strong ? (
                <strong key={i} className="text-ink font-bold">
                  {s.text}
                </strong>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </span>
          <span className="text-ink-2 mt-1 flex items-center gap-1.5 text-[12px] font-semibold">
            {notice.category === 'household' ? 'Flat' : 'For you'}
            <span aria-hidden>·</span>
            <time dateTime={notice.created_at}>{eventTime(notice.created_at)}</time>
          </span>
        </span>
      </button>
      {unread ? (
        <button
          type="button"
          onClick={onMarkRead}
          aria-label="Mark as read"
          className="pressable absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full"
        >
          <span className="bg-accent h-2.5 w-2.5 rounded-full" aria-hidden />
        </button>
      ) : null}
    </li>
  )
}
