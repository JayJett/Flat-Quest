import { CircleAlert, CircleCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Tone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: Tone
  message: string
}

interface ToastApi {
  show: (message: string, tone?: Tone) => void
  error: (message: string) => void
  success: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback((message: string, tone: Tone = 'info') => {
    const id = nextId.current++
    setToasts((t) => [...t.filter((x) => x.message !== message), { id, tone, message }].slice(-3))
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5000 : 2800)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({ show, error: (m) => show(m, 'error'), success: (m) => show(m, 'success') }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4"
        style={{ top: 'calc(var(--safe-top) + 12px)' }}
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="bg-ink shadow-float pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-2xl px-4 py-3 text-[15px] font-medium text-white"
            >
              {t.tone === 'error' ? (
                <CircleAlert size={18} className="shrink-0 text-[#FF8A80]" aria-hidden />
              ) : t.tone === 'success' ? (
                <CircleCheck size={18} className="text-green shrink-0" aria-hidden />
              ) : null}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
