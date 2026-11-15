import type { Transition } from 'motion/react'
import type { MotionLevel } from '@/personal/PreferencesProvider'

/**
 * One place for Flat Quest's motion vocabulary. Everything animates transform and opacity
 * only, is brief (< 0.9s), never loops, and collapses to an instant change when the
 * operating system asks for reduced motion.
 */
export const SPRINGS: Record<MotionLevel, { snappy: Transition; settle: Transition; pop: Transition }> = {
  // A little bounce: checkmarks overshoot slightly, cards settle with personality.
  playful: {
    snappy: { type: 'spring', stiffness: 520, damping: 22, mass: 0.8 },
    settle: { type: 'spring', stiffness: 380, damping: 28 },
    pop: { type: 'spring', stiffness: 600, damping: 14, mass: 0.7 },
  },
  // Default: crisp, almost no overshoot.
  balanced: {
    snappy: { type: 'spring', stiffness: 520, damping: 32 },
    settle: { type: 'spring', stiffness: 420, damping: 38 },
    pop: { type: 'spring', stiffness: 560, damping: 22 },
  },
  // Short fades and slides only.
  minimal: {
    snappy: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
    settle: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
    pop: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
  },
  reduced: {
    snappy: { duration: 0 },
    settle: { duration: 0 },
    pop: { duration: 0 },
  },
}

/** Scale a pressed control shrinks to. */
export const PRESS_SCALE: Record<MotionLevel, number> = { playful: 0.9, balanced: 0.94, minimal: 1, reduced: 1 }

/** Decorative effects (sparkles, confetti) only play for these levels. */
export const decorative = (level: MotionLevel) => level === 'playful' || level === 'balanced'

/** Number of confetti pieces in a milestone burst. */
export const BURST_PIECES: Record<MotionLevel, number> = { playful: 22, balanced: 12, minimal: 0, reduced: 0 }

/** Enter/exit for list rows: rows slide a little and fade; collapse height on exit. */
export function rowMotion(level: MotionLevel) {
  if (level === 'reduced') return { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } }
  const y = level === 'minimal' ? 0 : 8
  return {
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, x: level === 'minimal' ? 0 : 24, transition: { duration: 0.18 } },
  }
}
