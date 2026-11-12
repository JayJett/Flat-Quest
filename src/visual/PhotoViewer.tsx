import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react'
import { motion } from 'motion/react'
import { useFocusTrap } from '@/components/Sheet'
import { MediaImage } from './MediaImage'
import type { Visual } from './types'

export function PhotoViewer({ photos, initial, onClose }: { photos: Visual[]; initial: string; onClose: () => void }) {
  const [index, setIndex] = useState(Math.max(0, photos.findIndex(p => p.id === initial)))
  const [zoom, setZoom] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  useFocusTrap(true, ref, onClose)
  const visibleIndex = Math.min(index, photos.length - 1)
  const photo = photos[visibleIndex]
  const move = (n: number) => { setZoom(false); setIndex(i => Math.max(0, Math.min(photos.length - 1, Math.min(i, photos.length - 1) + n))) }
  if (!photo) return null
  const control = 'pressable flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-25'
  return createPortal(<motion.div ref={ref} role="dialog" aria-modal="true" aria-label="Photo viewer" tabIndex={-1}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] flex h-dvh flex-col bg-[#111111] text-white outline-none"
    onKeyDown={e => { if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1) }}>
    <div className="flex shrink-0 items-center justify-between px-4 pb-3" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
      <span className="text-sm tabular-nums" aria-live="polite">{visibleIndex + 1} / {photos.length}</span>
      <div className="flex gap-2"><button className={control} aria-label={zoom ? 'Zoom out' : 'Zoom in'} onClick={() => setZoom(!zoom)}>{zoom ? <ZoomOut /> : <ZoomIn />}</button><button data-autofocus className={control} aria-label="Close photo viewer" onClick={onClose}><X /></button></div>
    </div>
    <div className={`min-h-0 flex-1 ${zoom ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden'}`}
      onTouchStart={e => { start.current = e.touches.length === 1 ? { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY } : null }}
      onTouchEnd={e => { const s = start.current; start.current = null; if (!s || zoom) return; const dx = e.changedTouches[0]!.clientX - s.x; const dy = e.changedTouches[0]!.clientY - s.y; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1) }}>
      <MediaImage key={photo.id} path={photo.photo_path} alt={photo.title || 'Our flat photo'} eager className={zoom ? 'w-[200%] max-w-none' : 'max-h-full w-full object-contain'} />
    </div>
    <div className="shrink-0 px-5 pt-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
      {(photo.title || photo.notes) && <div className="mb-3 max-h-24 overflow-y-auto"><p className="font-bold">{photo.title}</p><p className="text-sm text-white/70">{photo.notes}</p></div>}
      <div className="flex items-center justify-between"><button className={control} disabled={index === 0} aria-label="Previous photo" onClick={() => move(-1)}><ChevronLeft /></button><span className="text-sm text-white/60">{photo.taken_on || 'Our home, coming together'}</span><button className={control} disabled={index >= photos.length - 1} aria-label="Next photo" onClick={() => move(1)}><ChevronRight /></button></div>
    </div>
  </motion.div>, document.body)
}
