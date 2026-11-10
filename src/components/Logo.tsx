/** Flat Quest mark: four rooms in four colours. Also used for the PWA icon. */
export function LogoMark({ size = 40 }: { size?: number }) {
  const g = size * 0.08
  const s = (size - g) / 2
  const r = s * 0.32
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <rect x={0} y={0} width={s} height={s} rx={r} fill="#F45D1E" />
      <rect x={s + g} y={0} width={s} height={s} rx={r} fill="#8585F5" />
      <rect x={0} y={s + g} width={s} height={s} rx={r} fill="#1F2C8F" />
      <rect x={s + g} y={s + g} width={s} height={s} rx={r} fill="#FFC350" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={30} />
      <span className="text-[19px] font-extrabold tracking-[-0.02em]">Flat Quest</span>
    </span>
  )
}
