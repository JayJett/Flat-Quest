import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { Button } from './ui'

export interface CropResult {
  blob: Blob
  ext: 'webp' | 'jpg'
}

interface Props {
  file: File | null
  title: string
  shape?: 'circle' | 'rounded'
  /** Output edge length in px. */
  size?: number
  busy?: boolean
  onCancel: () => void
  onConfirm: (result: CropResult) => void
}

const MAX_ZOOM = 4

/**
 * Square image cropper: drag to position, pinch / slider / +− to zoom,
 * arrow keys to nudge. Re-encodes to WebP (JPEG fallback), which also
 * strips EXIF/location metadata.
 */
export function ImageCropper({ file, title, shape = 'rounded', size = 640, busy, onCancel, onConfirm }: Props) {
  return (
    <Sheet open={file !== null} onClose={busy ? () => undefined : onCancel} title={title}>
      {file && <CropperBody key={file.name + file.size + file.lastModified} file={file} shape={shape} size={size} busy={busy} onCancel={onCancel} onConfirm={onConfirm} />}
    </Sheet>
  )
}

function CropperBody({ file, shape, size, busy, onCancel, onConfirm }: Omit<Props, 'title'> & { file: File; shape: 'circle' | 'rounded'; size: number }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(300)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      if (Math.min(image.naturalWidth, image.naturalHeight) < 64) setError('That image is too small. Use one at least 64 × 64 pixels.')
      else setImg(image)
    }
    image.onerror = () => setError('We couldn’t read that image. Try a JPEG or PNG.')
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const base = img ? box / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const dispW = img ? img.naturalWidth * base * zoom : box
  const dispH = img ? img.naturalHeight * base * zoom : box

  const clamp = (o: { x: number; y: number }, w = dispW, h = dispH) => ({
    x: Math.max(-(w - box) / 2, Math.min((w - box) / 2, o.x)),
    y: Math.max(-(h - box) / 2, Math.min((h - box) / 2, o.y)),
  })

  const setZoomClamped = (z: number) => {
    const nz = Math.max(1, Math.min(MAX_ZOOM, z))
    setZoom(nz)
    if (img) setOffset((o) => clamp(o, img.naturalWidth * base * nz, img.naturalHeight * base * nz))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      setZoomClamped((pinchStart.current.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinchStart.current.dist)
    } else if (pointers.current.size === 1) {
      setOffset((o) => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }))
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 12
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const m = moves[e.key]
    if (m) {
      e.preventDefault()
      setOffset((o) => clamp({ x: o.x + m[0], y: o.y + m[1] }))
    } else if (e.key === '+' || e.key === '=') setZoomClamped(zoom + 0.2)
    else if (e.key === '-') setZoomClamped(zoom - 0.2)
  }

  const confirm = async () => {
    if (!img) return
    const scale = base * zoom
    const left = box / 2 - dispW / 2 + offset.x
    const top = box / 2 - dispH / 2 + offset.y
    const sx = -left / scale
    const sy = -top / scale
    const sSize = box / scale
    const out = Math.min(size, Math.round(sSize))
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) return setError('Your browser couldn’t process the image.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, out, out)
    const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86))
    const webp = await toBlob('image/webp')
    if (webp && webp.type === 'image/webp') return onConfirm({ blob: webp, ext: 'webp' })
    const jpg = await toBlob('image/jpeg')
    if (!jpg) return setError('Your browser couldn’t process the image.')
    onConfirm({ blob: jpg, ext: 'jpg' })
  }

  return (
    <div className="flex flex-col gap-5 pt-1">
      <div
        ref={boxRef}
        role="application"
        aria-label="Photo position. Drag or use arrow keys to move, plus and minus to zoom."
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="bg-surface-2 relative mx-auto aspect-square w-full max-w-[340px] touch-none overflow-hidden rounded-[28px] select-none"
      >
        {img && (
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{
              width: dispW,
              height: dispH,
              left: box / 2 - dispW / 2 + offset.x,
              top: box / 2 - dispH / 2 + offset.y,
            }}
          />
        )}
        {/* Frame guide: dims outside the final shape. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: shape === 'circle' ? '50%' : 28,
            boxShadow: shape === 'circle' ? '0 0 0 400px rgb(255 255 255 / 0.55)' : undefined,
          }}
        />
        {!img && !error && <p className="text-ink-2 absolute inset-0 flex items-center justify-center text-[15px]">Loading photo…</p>}
      </div>

      {error ? (
        <p role="alert" className="text-danger text-center font-medium">
          {error}
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" aria-label="Zoom out" onClick={() => setZoomClamped(zoom - 0.25)} className="pressable bg-surface-2 flex h-11 w-11 items-center justify-center rounded-full">
            <Minus size={18} aria-hidden />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoomClamped(Number(e.target.value))}
            aria-label="Zoom"
            className="accent-ink flex-1"
          />
          <button type="button" aria-label="Zoom in" onClick={() => setZoomClamped(zoom + 0.25)} className="pressable bg-surface-2 flex h-11 w-11 items-center justify-center rounded-full">
            <Plus size={18} aria-hidden />
          </button>
        </div>
      )}
      <p className="text-ink-2 -mt-2 text-center text-[14px]">Drag to position · pinch or slide to zoom</p>

      <div className="flex flex-col gap-2">
        <Button size="lg" block loading={busy} disabled={!img || !!error} onClick={() => void confirm()}>
          Save photo
        </Button>
        <Button variant="ghost" block disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
