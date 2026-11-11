import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

interface CompleteToggleProps {
  checked: boolean
  label: string
  /** Resolves true when the write genuinely succeeded. */
  onToggle: (next: boolean) => Promise<boolean>
  size?: number
}

/**
 * The primary "it's in the flat" control. Visual state follows the (optimistic)
 * item; the celebration ring only plays after the database confirms the write.
 */
export function CompleteToggle({ checked, label, onToggle, size = 30 }: CompleteToggleProps) {
  const [burst, setBurst] = useState(0)
  const [busy, setBusy] = useState(false)
  const reduce = useReducedMotion()

  const click = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy) return
    const next = !checked
    setBusy(true)
    const ok = await onToggle(next)
    setBusy(false)
    if (ok && next) {
      if (!reduce && navigator.vibrate) navigator.vibrate(8)
      setBurst((b) => b + 1)
    }
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={click}
      disabled={busy}
      aria-busy={busy}
      className="relative -m-2 inline-flex shrink-0 items-center justify-center p-2"
      style={{ width: size + 16, height: size + 16 }}
    >
      <motion.span
        className="relative inline-flex items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        initial={false}
        animate={{
          backgroundColor: checked ? 'var(--color-green)' : 'rgba(255,255,255,0)',
          boxShadow: checked ? 'inset 0 0 0 0px #D4D4D8' : 'inset 0 0 0 2px #C9C9CF',
        }}
        whileTap={reduce ? undefined : { scale: 0.86 }}
        transition={{ duration: 0.2 }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} aria-hidden>
          <motion.path
            d="M5 12.5l4.2 4.2L19 7"
            fill="none"
            stroke="#111111"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
      </motion.span>
      <AnimatePresence>
        {burst > 0 && !reduce && (
          <motion.span
            key={burst}
            aria-hidden
            className="border-green pointer-events-none absolute rounded-full border-2"
            style={{ width: size, height: size }}
            initial={{ scale: 1, opacity: 0.9 }}
            animate={{ scale: 1.9, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </button>
  )
}
