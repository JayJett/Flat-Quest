import {
  CalendarDays,
  Compass,
  Gift,
  House,
  LayoutGrid,
  LogOut,
  Search,
  Settings,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { ProfileIcon } from '@/design/icons'
import { useHousehold } from '@/household/HouseholdProvider'
import { ShoppingProvider } from '@/shopping/ShoppingProvider'
import { ConnectionStatus } from './ConnectionStatus'
import { Avatar, clearMediaCache } from './Avatar'
import { useFocusTrap } from './Sheet'
import { TourProvider, useTour } from './Tour'
import { useOpenEvent } from '@/activity/useOpenEvent'
import { FlatSwitcher } from '@/household/FlatSwitcher'
import { forgetRoomCovers } from '@/rooms/useRoomCover'
import { LivingProvider } from '@/living/LivingProvider'
import { SearchOverlay } from '@/search/SearchOverlay'
import { IconButton } from './ui'
import { NotificationBell, NotificationDrawer } from '@/notifications/NotificationDrawer'
import { NotificationProvider, useNotifications, type Notice } from '@/notifications/NotificationProvider'

const PRIMARY_NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/rooms', label: 'Rooms', icon: LayoutGrid },
  { to: '/wishlist', label: 'Wishlist', icon: Gift },
  { to: '/flatmates', label: 'Flatmates', icon: Users },
]

interface Panels {
  /** Opens the menu drawer (closing notifications). */
  open: () => void
  /** Opens the notification drawer (closing the menu). */
  openNotifications: () => void
  /** Opens global search (closing anything else). */
  openSearch: () => void
}
const DrawerContext = createContext<Panels>({ open: () => undefined, openNotifications: () => undefined, openSearch: () => undefined })
export const useDrawer = () => useContext(DrawerContext)

type PanelState = { panel?: 'notifications' | 'search' } | null

export function AppShell() {
  return (
    <NotificationProvider>
      <LivingProvider>
        <Shell />
      </LivingProvider>
    </NotificationProvider>
  )
}

function Shell() {
  const { household } = useHousehold()
  // Leaving a flat (switch, removal, sign-out) forgets its signed photo links and cover lookups;
  // late answers to requests already in flight are discarded by the cache's generation check.
  useEffect(() => () => { clearMediaCache(); forgetRoomCovers() }, [household?.id])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const openEvent = useOpenEvent()
  const { markRead } = useNotifications()
  // The notification drawer and search are history entries, so the browser's Back button
  // (and the Android back gesture) closes them instead of leaving the page. Only one panel
  // can be open at a time.
  const panel = (location.state as PanelState)?.panel ?? null
  const notificationsOpen = panel === 'notifications'
  const searchOpen = panel === 'search'
  const pushedPanel = useRef(false)
  const here = `${location.pathname}${location.search}${location.hash}`
  const openPanel = (name: 'notifications' | 'search') => {
    setDrawerOpen(false)
    if (panel === name) return
    // Switching panels replaces the entry, so one Back always returns to the page.
    if (panel) navigate(here, { replace: true, state: { panel: name } })
    else {
      pushedPanel.current = true
      navigate(here, { state: { panel: name } })
    }
  }
  const closePanel = () => {
    if (!panel) return
    if (pushedPanel.current) navigate(-1)
    else navigate(here, { replace: true, state: null })
    pushedPanel.current = false
  }
  const openNotifications = () => openPanel('notifications')
  const openSearch = () => openPanel('search')
  const closeNotifications = closePanel
  const openMenu = () => {
    closePanel()
    setDrawerOpen(true)
  }
  const openResult = (href: string) => {
    pushedPanel.current = false
    // Replace the search entry: Back from the result returns to the page search was opened on.
    navigate(href, { replace: true })
  }

  const openSearchRef = useRef(openSearch)
  useEffect(() => {
    openSearchRef.current = openSearch
  })

  // Desktop shortcut: "/" or Ctrl/⌘-K opens search (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
        if (document.querySelector('[role="dialog"][aria-modal="true"]') && panel !== 'search') return
        e.preventDefault()
        openSearchRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])
  const openNotice = (notice: Notice) => {
    void markRead(notice.id)
    const wasPushed = pushedPanel.current
    // Replace the drawer's history entry: Back from the destination returns to this page.
    if (openEvent(notice.event, { replace: true })) pushedPanel.current = false
    else pushedPanel.current = wasPushed
  }

  // Close the drawer on navigation.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    if (drawerOpen) setDrawerOpen(false)
  }

  // Scroll like a native app: a new screen starts at the top; going Back returns you to
  // where you were on that screen. Positions are remembered per history entry.
  const navType = useNavigationType()
  const positions = useRef(new Map<string, number>())
  const entryKey = useRef(location.key)
  useEffect(() => {
    const onScroll = () => positions.current.set(entryKey.current, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  // Switch the key before paint, so a shorter new page clamping the scroll can't overwrite
  // the position remembered for the page we just left.
  useLayoutEffect(() => {
    entryKey.current = location.key
  }, [location.key])
  // A new screen starts at the top before anything reads the scroll position, so its header
  // doesn't briefly think it's scrolled (child effects run before this component's).
  useLayoutEffect(() => {
    if (navType !== 'POP' || !positions.current.has(location.key)) window.scrollTo({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])
  useEffect(() => {
    const saved = navType === 'POP' ? positions.current.get(location.key) : undefined
    if (saved === undefined) return
    // Lazy screens render a moment later; try for a few frames until the page is tall enough.
    let tries = 0
    let frame = 0
    const restore = () => {
      window.scrollTo({ top: saved })
      if (Math.abs(window.scrollY - saved) > 2 && ++tries < 20) frame = requestAnimationFrame(restore)
    }
    frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
    // Only screen changes move the scroll position (opening a panel keeps the path).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  return (
    <ShoppingProvider>
    <TourProvider>
    <DrawerContext.Provider value={{ open: openMenu, openNotifications, openSearch }}>
      <div className="lg:flex" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
        <SideRail />
        <main
          className="mx-auto w-full max-w-[560px] min-w-0 lg:max-w-5xl lg:px-10"
          style={{ paddingBottom: 'calc(var(--bottom-nav-h) + var(--safe-bottom) + 24px)' }}
        >
          <ConnectionStatus />
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <Drawer open={drawerOpen && !panel} onClose={() => setDrawerOpen(false)} />
      <SearchOverlay open={searchOpen} onClose={closePanel} onSelect={openResult} />
      <NotificationDrawer open={notificationsOpen} onClose={closeNotifications} onOpenNotice={openNotice} />
    </DrawerContext.Provider>
    </TourProvider>
    </ShoppingProvider>
  )
}

/** Sticky page header with the member's avatar at top-left (opens the drawer). */
export function PageHeader({
  title,
  actions,
  back,
  hideTitleUntilScroll,
}: {
  title?: string
  actions?: ReactNode
  back?: ReactNode
  hideTitleUntilScroll?: boolean
}) {
  const { me } = useHousehold()
  const drawer = useDrawer()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const showTitle = title && (!hideTitleUntilScroll || scrolled)

  return (
    <header
      className={`bg-surface sticky top-0 z-30 transition-[border-color] duration-200 ${scrolled ? 'border-line border-b' : 'border-b border-transparent'}`}
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="flex h-16 items-center gap-2 px-4 lg:px-0">
        {back ?? (
          <button
            type="button"
            onClick={drawer.open}
            aria-label="Open menu"
            data-tour="profile"
            className="pressable -ml-1 rounded-full p-1 lg:hidden"
          >
            <Avatar profile={me} size={40} decorative />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <AnimatePresence initial={false}>
            {showTitle && (
              <motion.h1
                key={title}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.18 }}
                className="truncate text-[17px] font-bold"
              >
                {title}
              </motion.h1>
            )}
          </AnimatePresence>
        </div>
        <div className="-mr-2 flex items-center gap-1">
          {actions}
          <IconButton label="Search" onClick={drawer.openSearch} data-testid="search-button" aria-haspopup="dialog" aria-keyshortcuts="/ Control+K Meta+K">
            <Search size={22} aria-hidden />
          </IconButton>
          <NotificationBell onOpen={drawer.openNotifications} />
        </div>
      </div>
    </header>
  )
}

function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="bg-surface border-line fixed inset-x-0 bottom-0 z-40 border-t lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <ul className="mx-auto flex h-[var(--bottom-nav-h)] max-w-[560px] items-stretch justify-around">
        {PRIMARY_NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex flex-1">
            <NavLink
              to={to}
              end={end}
              data-tour={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                `pressable flex flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold ${isActive ? 'text-ink' : 'text-ink-2'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={24} strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
                  <span>{label}</span>
                  <motion.span
                    aria-hidden
                    className="bg-accent h-1.5 w-1.5 rounded-full"
                    initial={false}
                    animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0 }}
                    transition={{ duration: 0.18 }}
                  />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function SideRail() {
  const { me, household } = useHousehold()
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col px-5 py-8 lg:flex">
      <NavLink to="/profile" data-tour="profile" className="pressable flex items-center gap-3 rounded-2xl p-2">
        <Avatar profile={me} size={44} decorative />
        <div className="min-w-0">
          <p className="truncate font-bold">{me?.display_name || 'You'}</p>
          <p className="text-ink-2 truncate text-[14px]">{household?.name}</p>
        </div>
      </NavLink>
      <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
        {[...PRIMARY_NAV, { to: '/calendar', label: 'Calendar', icon: CalendarDays, end: false }, { to: '/settings', label: 'Settings', icon: Settings, end: false }].map(
          ({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-tour={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                `pressable flex min-h-12 items-center gap-3 rounded-2xl px-3 font-semibold ${isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`
              }
            >
              <Icon size={22} aria-hidden />
              {label}
            </NavLink>
          ),
        )}
      </nav>
      <div className="mt-8 -mx-2 overflow-y-auto">
        <FlatSwitcher compact />
      </div>
    </aside>
  )
}

const DRAWER_LINKS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  ...PRIMARY_NAV,
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, household } = useHousehold()
  const { signOut } = useAuth()
  const tour = useTour()
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(open, ref, onClose)
  const accent = me?.accent_color ?? '#3657E8'

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -80 || info.velocity.x < -500) onClose()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-[rgb(17_17_17/0.28)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="bg-surface shadow-float absolute inset-y-0 left-0 flex w-[min(86vw,340px)] flex-col rounded-r-[28px] outline-none"
            style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%', transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 420, damping: 44 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.5, right: 0 }}
            onDragEnd={onDragEnd}
          >
            <div className="flex justify-end px-3">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="pressable text-ink-2 active:bg-surface-2 inline-flex h-11 w-11 items-center justify-center rounded-full"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            <div className="px-6 pb-6">
              <Avatar profile={me} size={72} decorative />
              <p className="mt-4 text-[22px] leading-tight font-bold">{me?.display_name || 'You'}</p>
              <p className="text-ink-2 mt-1 flex items-center gap-1.5 text-[15px]">
                <ProfileIcon name={me?.icon ?? 'sparkles'} size={16} style={{ color: accent }} aria-hidden />
                {household?.name ?? 'No household yet'}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
            <div className="px-3 pb-4">
              <FlatSwitcher onSwitched={onClose} />
            </div>
            <nav aria-label="Menu" className="px-3">
              <ul className="flex flex-col">
                {DRAWER_LINKS.map(({ to, label, icon: LinkIcon, end }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      className={({ isActive }) =>
                        `pressable flex min-h-13 items-center gap-4 rounded-2xl px-3 text-[17px] font-semibold ${isActive ? 'bg-surface-2' : 'active:bg-surface-2'}`
                      }
                    >
                      <LinkIcon size={22} aria-hidden />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            </div>
            <div className="px-3">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  window.setTimeout(() => tour.start(), 260)
                }}
                className="pressable active:bg-surface-2 flex min-h-13 w-full items-center gap-4 rounded-2xl px-3 text-[17px] font-semibold"
              >
                <Compass size={22} aria-hidden />
                Show me around
              </button>
              <button
                type="button"
                onClick={async () => {
                  onClose()
                  await signOut()
                  navigate('/sign-in', { replace: true })
                }}
                className="pressable text-danger active:bg-danger-soft flex min-h-13 w-full items-center gap-4 rounded-2xl px-3 text-[17px] font-semibold"
              >
                <LogOut size={22} aria-hidden />
                Sign out
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
