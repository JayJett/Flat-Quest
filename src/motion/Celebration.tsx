import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { BURST_PIECES } from './motion'

type Burst = { id: number; x: number; y: number; pieces: Piece[] }
type Piece = { dx: number; dy: number; rotate: number; color: string; shape: 'dot' | 'bar'; delay: number }

interface CelebrationApi {
  /**
   * A short burst of colourful pieces from a point (or the screen's centre). Reserved for
   * genuine milestones: everything done, a room complete. Returns whether it played.
   */
  burst: (origin?: { x: number; y: number } | HTMLElement | null) => boolean
}

const Ctx = createContext<CelebrationApi>({ burst: () => false })
export const useCelebration = () => useContext(Ctx)

// The room palette, so celebrations feel like Flat Quest rather than generic confetti.
const COLORS = ['#F45D1E', '#8585F5', '#FFC350', '#42C493', '#3657E8', '#F0478C', '#2FB2EE']

function makePieces(n: number, seed: number): Piece[] {
  let s = seed
  const rand = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
  return Array.from({ length: n }, (_, i) => {
    const angle = (Math.PI * 2 * i) / n + rand() * 0.6
    const dist = 70 + rand() * 90
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 40 - rand() * 40,
      rotate: (rand() - 0.5) * 540,
      color: COLORS[i % COLORS.length]!,
      shape: rand() > 0.5 ? 'dot' : 'bar',
      delay: rand() * 0.06,
    }
  })
}

/**
 * Renders celebration bursts above everything, ignoring pointer events and screen readers
 * (the action itself already announces its result). Pieces animate transform/opacity once
 * and are removed; nothing loops. Plays nothing for Minimal or reduced motion.
 */
export function CelebrationProvider({ children }: { children: ReactNode }) {
  const level = useMotionLevel()
  const [bursts, setBursts] = useState<Burst[]>([])
  const next = useRef(1)

  const burst = useCallback<CelebrationApi['burst']>(
    (origin) => {
      const n = BURST_PIECES[level]
      if (!n) return false
      let x = window.innerWidth / 2
      let y = window.innerHeight / 2.4
      if (origin instanceof HTMLElement) {
        const r = origin.getBoundingClientRect()
        x = r.left + r.width / 2
        y = r.top + r.height / 2
      } else if (origin) ({ x, y } = origin)
      const id = next.current++
      setBursts((b) => [...b.slice(-2), { id, x, y, pieces: makePieces(n, id * 7919) }])
      window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1100)
      return true
    },
    [level],
  )

  const value = useMemo(() => ({ burst }), [burst])
  return (
    <Ctx.Provider value={value}>
      {children}
      {createPortal(
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" data-testid="celebration-layer">
          <AnimatePresence>
            {bursts.map((b) =>
              b.pieces.map((p, i) => (
                <motion.span
                  key={`${b.id}-${i}`}
                  data-testid="confetti"
                  className="absolute block"
                  style={{
                    left: b.x,
                    top: b.y,
                    width: p.shape === 'dot' ? 8 : 5,
                    height: p.shape === 'dot' ? 8 : 12,
                    borderRadius: p.shape === 'dot' ? 999 : 2,
                    backgroundColor: p.color,
                  }}
                  initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
                  animate={{ x: p.dx, y: [0, p.dy, p.dy + 90], scale: 1, opacity: [1, 1, 0], rotate: p.rotate }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.9, delay: p.delay, ease: [0.22, 1, 0.36, 1], times: [0, 0.55, 1] }}
                />
              )),
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  )
}
