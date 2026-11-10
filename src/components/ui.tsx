import { LoaderCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white active:bg-accent-press disabled:bg-accent/40',
  ink: 'bg-ink text-white disabled:bg-ink/40',
  secondary: 'bg-surface-2 text-ink active:bg-surface-3 disabled:text-ink-3',
  ghost: 'bg-transparent text-ink active:bg-surface-2 disabled:text-ink-3',
  danger: 'bg-danger-soft text-danger active:bg-[#fadcdc] disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'lg' | 'sm'
  loading?: boolean
  block?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, icon, children, className = '', disabled, ...rest },
  ref,
) {
  const sizing =
    size === 'lg'
      ? 'min-h-14 px-6 text-[17px] rounded-[18px]'
      : size === 'sm'
        ? 'min-h-10 px-3.5 text-[15px] rounded-xl'
        : 'min-h-12 px-5 text-base rounded-2xl'
  return (
    <button
      ref={ref}
      className={`pressable inline-flex items-center justify-center gap-2 font-semibold ${sizing} ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`pressable text-ink active:bg-surface-2 inline-flex h-11 w-11 items-center justify-center rounded-full ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Spinner({ label = 'Loading', size = 24 }: { label?: string; size?: number }) {
  return (
    <span role="status" className="text-ink-2 inline-flex items-center gap-2">
      <LoaderCircle size={size} className="animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function ProgressBar({
  value,
  color = 'var(--color-ink)',
  track = 'var(--color-surface-2)',
  height = 8,
  label,
}: {
  value: number
  color?: string
  track?: string
  height?: number
  label?: string
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height, background: track }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (v: T) => void
  label: string
}) {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={label} className="bg-surface-2 flex w-full rounded-2xl p-1">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`relative min-h-10 flex-1 rounded-xl px-2 text-[14px] font-semibold transition-colors ${selected ? 'text-ink' : 'text-ink-2'}`}
          >
            {selected && (
              <motion.span
                layoutId={`seg-${id}`}
                className="bg-surface absolute inset-0 rounded-xl"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative">
              {o.label}
              {o.count !== undefined && <span className="text-ink-2 ml-1 font-medium tabular-nums">{o.count}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-ink text-[14px] font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-danger text-[14px]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-ink-2 text-[14px]">{hint}</p>
      ) : null}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="text-ink-3 mb-4">{icon}</div>}
      <h3 className="text-[18px] font-bold">{title}</h3>
      {body && <p className="text-ink-2 mt-1.5 max-w-xs text-[15px]">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-title font-bold">{title}</h2>
      {action}
    </div>
  )
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-danger-soft text-danger flex flex-col items-start gap-3 rounded-[var(--radius-card)] p-5" role="alert">
      <p className="font-semibold">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
