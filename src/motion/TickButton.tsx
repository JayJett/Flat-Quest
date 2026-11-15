import { AnimatePresence, motion } from 'motion/react'
import { useState, type MouseEvent } from 'react'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { decorative, PRESS_SCALE, SPRINGS } from './motion'

interface TickButtonProps {
  checked: boolean
  /** Accessible name, e.g. "Mark Toilet paper as restocked". */
  label: string
  /** Resolves true only when the write was confirmed. */
  onToggle: (next: boolean, el: HTMLButtonElement) => Promise<boolean>
  size?: number
  /** Fill when checked. Defaults to the success green used across the app. */
  tone?: 'green' | 'accent'
  disabled?: boolean
}

const SPARKS = [0, 60, 120, 180, 240, 300]

/**
 * The Living Mode check control: it springs into its checked state, then (after the
 * server confirms) a ring and a few sparks pop around it. The result never depends on
 * the animation: state, label and focus are all immediate.
 */
export function TickButton({ checked, label, onToggle, size = 30, tone = 'green', disabled }: TickButtonProps) {
  const level = useMotionLevel()
  const springs = SPRINGS[level]
  const [busy, setBusy] = useState(false)
  const [pop, setPop] = useState(0)
  const fill = tone === 'green' ? 'var(--color-green)' : 'var(--color-accent)'
  const stroke = tone === 'green' ? '#111111' : 'var(--color-on-accent)'

  const click = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (busy || disabled) return
    const el = e.currentTarget
    const next = !checked
    setBusy(true)
    const ok = await onToggle(next, el)
    setBusy(false)
    if (ok && next) {
      if (level !== 'reduced' && navigator.vibrate) navigator.vibrate(8)
      setPop((p) => p + 1)
    }
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={click}
      data-testid="tick"
      className="relative -m-2 inline-flex shrink-0 items-center justify-center p-2 disabled:opacity-40"
      style={{ width: size + 16, height: size + 16 }}
    >
      <motion.span
        className="relative inline-flex items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        initial={false}
        animate={{
          backgroundColor: checked ? fill : 'rgba(255,255,255,0)',
          boxShadow: checked ? 'inset 0 0 0 0px #D4D4D8' : 'inset 0 0 0 2px #C9C9CF',
          scale: checked && pop > 0 && level === 'playful' ? [1, 1.18, 1] : 1,
        }}
        whileTap={{ scale: PRESS_SCALE[level] }}
        transition={{ ...springs.pop, backgroundColor: { duration: level === 'reduced' ? 0 : 0.18 }, boxShadow: { duration: 0.18 } }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} aria-hidden>
          <motion.path
            d="M5 12.5l4.2 4.2L19 7"
            fill="none"
            style={{ stroke }}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
            transition={{ duration: level === 'reduced' ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
      </motion.span>
      <AnimatePresence>
        {pop > 0 && decorative(level) && (
          <motion.span key={pop} aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.span
              className="absolute rounded-full border-2"
              style={{ width: size, height: size, borderColor: fill }}
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
            {SPARKS.map((deg) => (
              <motion.span
                key={deg}
                className="absolute h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: fill }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos((deg * Math.PI) / 180) * (size * (level === 'playful' ? 0.95 : 0.8)),
                  y: Math.sin((deg * Math.PI) / 180) * (size * (level === 'playful' ? 0.95 : 0.8)),
                  opacity: 0,
                  scale: 0.4,
                }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              />
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}
