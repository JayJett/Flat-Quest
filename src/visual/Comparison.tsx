import { useState } from 'react'
import { MediaImage } from './MediaImage'
import type { Visual } from './types'

export function Comparison({ before, after }: { before: Visual; after: Visual }) {
  const [position, setPosition] = useState(50)
  const [mode, setMode] = useState<'compare' | 'before' | 'after'>('compare')
  return <div>
    <div className="bg-surface-2 relative aspect-[4/3] overflow-hidden rounded-[24px]">
      <MediaImage path={mode === 'before' ? before.photo_path : after.photo_path} eager alt={mode === 'before' ? 'Before' : 'After'} className="absolute inset-0 h-full w-full object-contain" />
      {mode === 'compare' && <><div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}><MediaImage path={before.photo_path} eager alt="Before" className="h-full w-full object-contain" /></div><div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${position}%` }}><span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-2 py-3 text-sm font-bold text-black">↔</span></div></>}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-between text-xs font-bold"><span className="rounded-full bg-white px-3 py-2 text-ink">Before</span><span className="rounded-full bg-white px-3 py-2 text-ink">After</span></div>
    </div>
    {mode === 'compare' && <input aria-label="Before and after comparison" className="mt-3 h-11 w-full accent-[var(--color-ink)]" type="range" min={0} max={100} value={position} onChange={e => setPosition(Number(e.target.value))} />}
    <div className="mt-3 flex justify-center gap-2">{(['before','compare','after'] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)} className={`pressable min-h-11 rounded-full px-4 text-sm font-semibold ${mode === value ? 'bg-ink text-white' : 'bg-surface-2'}`}>{value === 'compare' ? 'Compare' : value === 'before' ? 'Before' : 'After'}</button>)}</div>
  </div>
}
