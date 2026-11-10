import {
  Gift,
  House,
  LayoutGrid,
  LogOut,
  Settings,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { ProfileIcon } from '@/design/icons'
import { useHousehold } from '@/household/HouseholdProvider'
import { Avatar } from './Avatar'
import { useFocusTrap } from './Sheet'

const PRIMARY_NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/rooms', label: 'Rooms', icon: LayoutGrid },
  { to: '/wishlist', label: 'Wishlist', icon: Gift },
  { to: '/flatmates', label: 'Flatmates', icon: Users },
]

const DrawerContext = createContext<{ open: () => void }>({ open: () => undefined })
export const useDrawer = () => useContext(DrawerContext)

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close the drawer on navigation.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    if (drawerOpen) setDrawerOpen(false)
  }

  // Scroll to top on route change, like a native push.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <DrawerContext.Provider value={{ open: () => setDrawerOpen(true) }}>
      <div className="lg:flex" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
        <SideRail />
        <main
          className="mx-auto w-full max-w-[560px] min-w-0 lg:max-w-5xl lg:px-10"
          style={{ paddingBottom: 'calc(var(--bottom-nav-h) + var(--safe-bottom) + 24px)' }}
        >
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </DrawerContext.Provider>
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
      className={`bg-surface/95 sticky top-0 z-30 backdrop-blur-none transition-[border-color] duration-200 ${scrolled ? 'border-line border-b' : 'border-b border-transparent'}`}
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="flex h-16 items-center gap-2 px-4 lg:px-0">
        {back ?? (
          <button
            type="button"
            onClick={drawer.open}
            aria-label="Open menu"
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
        <div className="-mr-2 flex items-center gap-1">{actions}</div>
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
                    className="bg-ink h-1 w-1 rounded-full"
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
      <NavLink to="/profile" className="pressable flex items-center gap-3 rounded-2xl p-2">
        <Avatar profile={me} size={44} decorative />
        <div className="min-w-0">
          <p className="truncate font-bold">{me?.display_name || 'You'}</p>
          <p className="text-ink-2 truncate text-[14px]">{household?.name}</p>
        </div>
      </NavLink>
      <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
        {[...PRIMARY_NAV, { to: '/settings', label: 'Settings', icon: Settings, end: false }].map(
          ({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
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
    </aside>
  )
}

const DRAWER_LINKS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  ...PRIMARY_NAV,
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, household } = useHousehold()
  const { signOut } = useAuth()
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
            <nav aria-label="Menu" className="flex-1 overflow-y-auto px-3">
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
            <div className="px-3">
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
