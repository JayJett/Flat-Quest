import { motion } from 'motion/react'
import { useState } from 'react'
import { useSignedUrl } from '@/components/Avatar'
import type { CoverImage } from './useRoomCover'

/**
 * A room's cover photo. Fades in once loaded; if the file can't be shown (deleted, offline,
 * expired link) it renders nothing, so the room simply keeps its colour.
 */
export function RoomCoverImage({ cover, size = 'thumb', className = '', onState }: {
  cover: CoverImage | null; size?: 'thumb' | 'full'; className?: string; onState?: (shown: boolean) => void
}) {
  const path = cover ? (size === 'full' ? (cover.photo ?? cover.thumb) : (cover.thumb ?? cover.photo)) : null
  const url = useSignedUrl('household-media', path)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  if (!url || failed === url) return null
  return (
    <motion.img
      src={url}
      alt=""
      draggable={false}
      decoding="async"
      className={`h-full w-full object-cover ${className}`}
      initial={false}
      animate={{ opacity: loaded === url ? 1 : 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      onLoad={() => { setLoaded(url); onState?.(true) }}
      onError={() => { setFailed(url); onState?.(false) }}
    />
  )
}
