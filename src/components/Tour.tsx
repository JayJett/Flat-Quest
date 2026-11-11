import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { useHousehold } from '@/household/HouseholdProvider'

/**
 * First-run tour. Each step spotlights a real element found by its
 * `data-tour` attribute (never fixed coordinates). Missing targets are skipped.
 * Completion/skip is stored on the profile (tour_completed_at), so it shows once
 * per person across devices; "Show me around" in the menu replays it.
 */
interface Step {
  id: string
  title: string
  body: string
  /** data-tour value(s) to spotlight, in order of preference; omitted = centred card. */
  target?: string | string[]
  /** Route to show first; may be a function of household data. */
  route?: string | ((ctx: { firstRoomId?: string }) => string | undefined)
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to Flat Quest!',
    body: 'Let’s make this place a home together. Here’s a 30-second look around.',
    route: '/',
  },
  {
    id: 'progress',
    title: 'Our progress',
    body: 'See how much of the house is sorted and what’s still left to do.',
    target: 'progress',
    route: '/',
  },
  {
    id: 'rooms',
    title: 'Explore rooms',
    body: 'Browse everything the flat needs, organised by room.',
    target: 'nav-rooms',
  },
  {
    id: 'claim',
    title: 'Claim and share',
    body: 'Tap Claim if you’re bringing something. Open an item to share it with flatmates.',
    // Prefer an unclaimed item so the Claim button is visible.
    target: ['item-row-claim', 'item-row'],
    route: ({ firstRoomId }) => (firstRoomId ? `/rooms/${firstRoomId}` : undefined),
  },
  {
    id: 'wishlist',
    title: 'Wishlist',
    body: 'Save furniture ideas, share inspiration and vote on favourites.',
    target: 'nav-wishlist',
  },
  {
    id: 'profile',
    title: 'Your account',
    body: 'Tap your photo to customise your profile and open the menu.',
    target: 'profile',
    // Sub-pages show a back arrow instead of the avatar, so return Home first.
    route: '/',
  },
]

const TourContext = createContext<{ start: () => void }>({ start: () => undefined })
export const useTour = () => useContext(TourContext)

function findTarget(target: string | string[]): HTMLElement | null {
  for (const name of Array.isArray(target) ? target : [target]) {
    const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
    })
    if (el) return el
  }
  return null
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { me, rooms, state, updateProfile } = useHousehold()
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const start = useCallback(() => {
    setIndex(0)
    setActive(true)
  }, [])

  // Auto-start once per person, only on the main app with data loaded.
  const shouldAutoStart = state === 'ready' && me !== null && me.tour_completed_at === null && !dismissed
  useEffect(() => {
    if (!shouldAutoStart || active) return
    const t = window.setTimeout(start, 700)
    return () => window.clearTimeout(t)
  }, [shouldAutoStart, active, start])

  const finish = useCallback(
    async (goHome: boolean) => {
      setDismissed(true)
      setActive(false)
      if (goHome && location.pathname !== '/') navigate('/')
      // Persist so it never auto-starts again (on any device). Failure is non-fatal:
      // the session flag above still stops it reappearing until the next sign-in.
      if (me && me.tour_completed_at === null) await updateProfile({ tour_completed_at: new Date().toISOString() })
    },
    [location.pathname, me, navigate, updateProfile],
  )

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {active && (
        <TourOverlay
          index={index}
          setIndex={setIndex}
          firstRoomId={rooms[0]?.id}
          onSkip={() => void finish(false)}
          onFinish={() => void finish(true)}
        />
      )}
    </TourContext.Provider>
  )
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const PAD = 8

function TourOverlay({
  index,
  setIndex,
  firstRoomId,
  onSkip,
  onFinish,
}: {
  index: number
  setIndex: (i: number) => void
  firstRoomId?: string
  onSkip: () => void
  onFinish: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const reduce = useReducedMotion()
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [ready, setReady] = useState(false)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [cardH, setCardH] = useState(240)
  // Measure whichever card is mounted (AnimatePresence swaps elements between steps).
  const observer = useRef<ResizeObserver | null>(null)
  const setCardEl = useCallback((el: HTMLDivElement | null) => {
    cardRef.current = el
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(() => {
      if (el.offsetHeight > 0) setCardH(el.offsetHeight)
    })
    observer.current.observe(el)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  const [dir, setDir] = useState<1 | -1>(1)
  const step = STEPS[index]!
  const isLast = index === STEPS.length - 1

  const go = useCallback(
    (to: number) => {
      setDir(to >= index ? 1 : -1)
      if (to < 0) return
      if (to >= STEPS.length) return onFinish()
      setReady(false)
      setIndex(to)
    },
    [index, onFinish, setIndex],
  )

  // Navigate if the step needs a route, then locate and measure the target.
  useLayoutEffect(() => {
    const route = typeof step.route === 'function' ? step.route({ firstRoomId }) : step.route
    if (route && location.pathname !== route) {
      navigate(route)
      return
    }
    let cancelled = false
    let tries = 0
    const locate = () => {
      if (cancelled) return
      if (!step.target) {
        setRect(null)
        setReady(true)
        return
      }
      const el = findTarget(step.target)
      if (!el) {
        if (tries++ < 15) return void window.setTimeout(locate, 100)
        // Target isn't on screen (e.g. no rooms yet): skip gracefully.
        return go(index + dir)
      }
      const r = el.getBoundingClientRect()
      const offscreen = r.top < 72 || r.bottom > window.innerHeight - 90
      if (offscreen) {
        el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
        window.setTimeout(() => measure(el), reduce ? 30 : 380)
      } else measure(el)
    }
    const measure = (el: HTMLElement, again = true) => {
      if (cancelled) return
      const r = el.getBoundingClientRect()
      setRect({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 })
      setReady(true)
      // Targets may still be settling (list entrance animations): measure once more.
      if (again) window.setTimeout(() => measure(el, false), 450)
    }
    locate()
    return () => {
      cancelled = true
    }
  }, [step, index, location.pathname, firstRoomId, navigate, go, reduce, dir])

  // Keep the spotlight attached on resize / scroll.
  useEffect(() => {
    const update = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      if (!step.target) return
      const el = findTarget(step.target)
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 })
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update)
    }
  }, [step])

  // Keyboard: Esc skips, arrows move, focus stays in the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
      } else if (e.key === 'ArrowRight') go(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) go(index - 1)
      else if (e.key === 'Tab' && cardRef.current) {
        const els = [...cardRef.current.querySelectorAll<HTMLElement>('button')]
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, index, onSkip])

  useEffect(() => {
    if (ready) nextRef.current?.focus({ preventScroll: true })
  }, [ready, index])

  // Lock page scroll while the tour is open (programmatic scrollIntoView still works).
  useEffect(() => {
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])

  // Card placement: below the target if there's room, otherwise above; centred if no target.
  const cardW = Math.min(340, viewport.w - 32)
  const safeTop = 16
  const safeBottom = 16
  // Always positioned by `top` (switching between top/bottom confuses the animation layer).
  let cardTop: number
  let cardLeft = (viewport.w - cardW) / 2
  if (rect) {
    const gap = 14
    const below = rect.y + rect.h + gap
    const above = rect.y - gap - cardH
    cardLeft = Math.min(Math.max(16, rect.x + rect.w / 2 - cardW / 2), viewport.w - cardW - 16)
    if (below + cardH <= viewport.h - safeBottom) cardTop = below
    else if (above >= safeTop) cardTop = above
    // Big target on a short screen: pin to the edge that hides less of it.
    else cardTop = viewport.h - (rect.y + rect.h) >= rect.y ? viewport.h - safeBottom - cardH : safeTop
  } else {
    cardTop = Math.max(safeTop, (viewport.h - cardH) / 2)
  }
  const cardStyle: React.CSSProperties = { left: cardLeft, top: cardTop, width: cardW }

  // If neither side has room but target + card would fit on screen together, nudge the page
  // so the card sits above the target instead of covering it (small iPhones).
  const fitsTogether = rect ? rect.h + cardH + 14 + safeTop + 24 <= viewport.h : false
  const covered = rect ? cardTop < rect.y + rect.h && cardTop + cardH > rect.y : false
  useEffect(() => {
    if (!ready || !rect || !covered || !fitsTogether) return
    const maxDown = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
    // Card below the target (scroll down) or above it (scroll up), whichever the page allows.
    const toBelow = rect.y - (viewport.h - safeBottom - cardH - 14 - rect.h)
    const toAbove = rect.y - (safeTop + cardH + 14)
    const delta = toBelow > 0 && toBelow <= maxDown ? toBelow : toAbove < 0 && window.scrollY + toAbove >= 0 ? toAbove : 0
    if (Math.abs(delta) > 2) window.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' })
  }, [ready, index, covered, fitsTogether, rect, cardH, reduce, viewport.h])

  const ease = [0.22, 1, 0.36, 1] as const
  const hole = rect ?? { x: viewport.w / 2, y: viewport.h / 2, w: 0, h: 0 }

  return createPortal(
    <div className="fixed inset-0 z-[80]" style={{ pointerEvents: 'auto' }}>
      {/* Dimmed backdrop with a spotlight hole. Clicks on it do nothing (use the card). */}
      <motion.svg
        className="absolute inset-0 h-full w-full"
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.25 }}
      >
        <defs>
          <mask id="fq-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <motion.rect
              fill="black"
              initial={false}
              animate={{ attrX: hole.x, attrY: hole.y, width: hole.w, height: hole.h, rx: rect ? 18 : 0 }}
              transition={{ duration: reduce ? 0 : 0.42, ease }}
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(17 17 17 / 0.58)" mask="url(#fq-tour-mask)" />
      </motion.svg>

      <AnimatePresence mode="wait">
        {ready && (
          <motion.div
            key={step.id}
            ref={setCardEl}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            className="bg-surface shadow-float absolute rounded-[24px] p-5"
            style={cardStyle}
            initial={{ opacity: 0, y: reduce ? 0 : 8 * dir, scale: reduce ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.12 } }}
            transition={{ duration: reduce ? 0 : 0.26, ease }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex gap-1.5" aria-hidden>
                {STEPS.map((s, i) => (
                  <span
                    key={s.id}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'bg-ink w-5' : i < index ? 'bg-ink/40 w-1.5' : 'bg-surface-3 w-1.5'}`}
                  />
                ))}
              </span>
              <span className="sr-only">
                Step {index + 1} of {STEPS.length}
              </span>
              {!isLast && (
                <button type="button" onClick={onSkip} className="text-ink-2 -mr-2 min-h-11 px-2 text-[15px] font-semibold">
                  Skip
                </button>
              )}
            </div>
            <h2 id={titleId} className="mt-2 text-[20px] leading-snug font-extrabold tracking-[-0.01em]">
              {step.title}
            </h2>
            <p id={bodyId} className="text-ink-2 mt-1 text-[16px]">
              {step.body}
            </p>
            <div className="mt-5 flex items-center gap-2">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => go(index - 1)}
                  className="pressable bg-surface-2 min-h-12 rounded-2xl px-5 font-semibold"
                >
                  Back
                </button>
              )}
              <button
                ref={nextRef}
                type="button"
                onClick={() => go(index + 1)}
                className="pressable bg-accent active:bg-accent-press min-h-12 flex-1 rounded-2xl px-5 font-semibold text-white"
              >
                {isLast ? 'Start exploring' : index === 0 ? 'Show me' : 'Next'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
