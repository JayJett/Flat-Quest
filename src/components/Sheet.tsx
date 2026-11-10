import { X } from 'lucide-react'
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'

/** Traps focus inside `ref` while active and restores it on close. */
export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>, onEscape: () => void) {
  const escRef = useRef(onEscape)
  useEffect(() => {
    escRef.current = onEscape
  })
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const t = window.setTimeout(() => {
      const target = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node
      target?.focus({ preventScroll: true })
    }, 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        escRef.current()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const els = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (els.length === 0) return
      const first = els[0]!
      const last = els[els.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.({ preventScroll: true })
    }
  }, [active, ref])
}

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** Hide the visible title (still announced). */
  hideTitle?: boolean
}

/**
 * Bottom sheet on phones, centred dialog on wider screens. Floats above the
 * interface, so it is one of the few places a (subtle) shadow is allowed.
 */
export function Sheet({ open, onClose, title, children, footer, hideTitle }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const drag = useDragControls()
  useFocusTrap(open, ref, onClose)

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[rgb(17_17_17/0.32)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="bg-surface shadow-float relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] outline-none sm:max-w-lg sm:rounded-[28px]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%', transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 420, damping: 42, mass: 0.9 }}
            drag="y"
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div
              className="flex cursor-grab touch-none justify-center pt-2.5 pb-1 sm:hidden"
              onPointerDown={(e) => drag.start(e)}
              aria-hidden
            >
              <span className="bg-surface-3 h-1.5 w-10 rounded-full" />
            </div>
            <div className="flex items-center justify-between gap-3 px-5 pt-2 pb-2 sm:pt-5">
              <h2 id={titleId} className={hideTitle ? 'sr-only' : 'text-title font-bold'}>
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="pressable text-ink-2 active:bg-surface-2 -mr-2 ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
            {footer && (
              <div className="border-line border-t px-5 pt-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}>
                {footer}
              </div>
            )}
            {!footer && <div style={{ height: 'calc(var(--safe-bottom) + 8px)' }} />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Small confirm dialog built on Sheet. */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="text-ink-2 text-[16px]">{body}</p>
      <div className="mt-6 flex flex-col gap-2.5">
        <button
          type="button"
          data-autofocus
          disabled={busy}
          onClick={onConfirm}
          className={`pressable min-h-12 rounded-2xl font-semibold ${danger ? 'bg-danger text-white' : 'bg-accent text-white'} disabled:opacity-60`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <button type="button" onClick={onClose} className="pressable bg-surface-2 min-h-12 rounded-2xl font-semibold">
          Cancel
        </button>
      </div>
    </Sheet>
  )
}
