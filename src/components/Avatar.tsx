import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { readableOn } from '@/lib/color'
import type { Profile } from '@/lib/domain'
import { supabase } from '@/lib/supabase'

const cache = new Map<string, { url: string; expires: number }>()
const inflight = new Map<string, Promise<string | null>>()
const TTL_SECONDS = 60 * 60

export type MediaBucket = 'avatars' | 'household-media'

/** Resolves a private storage path to a short-lived signed URL (cached per bucket). */
export function signedUrl(bucket: MediaBucket, path: string): Promise<string | null> {
  const key = `${bucket}:${path}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now() + 60_000) return Promise.resolve(hit.url)
  const running = inflight.get(key)
  if (running) return running
  const p = supabase.storage
    .from(bucket)
    .createSignedUrl(path, TTL_SECONDS)
    .then(({ data }) => {
      if (!data?.signedUrl) return null
      cache.set(key, { url: data.signedUrl, expires: Date.now() + TTL_SECONDS * 1000 })
      return data.signedUrl
    })
    .catch(() => null)
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export function useSignedUrl(bucket: MediaBucket, path: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null)
  const key = path ? `${bucket}:${path}` : null
  useEffect(() => {
    if (!path || !key) return
    let active = true
    void signedUrl(bucket, path).then((url) => {
      if (active) setResolved({ key, url })
    })
    return () => {
      active = false
    }
  }, [bucket, path, key])
  if (!key) return null
  return resolved?.key === key ? resolved.url : (cache.get(key)?.url ?? null)
}

export function useAvatarUrl(path: string | null | undefined): string | null {
  return useSignedUrl('avatars', path)
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return [...parts[0]!][0]!.toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

interface AvatarProps {
  profile: Pick<Profile, 'display_name' | 'avatar_path' | 'accent_color'> | null
  size?: number
  /** Override the image (e.g. local preview before upload). */
  src?: string | null
  className?: string
  /** Decorative avatars next to a visible name should hide from screen readers. */
  decorative?: boolean
}

export function Avatar({ profile, size = 40, src, className = '', decorative = false }: AvatarProps) {
  const remote = useAvatarUrl(src === undefined ? profile?.avatar_path : null)
  const url = src ?? remote
  const [failed, setFailed] = useState<string | null>(null)
  const color = profile?.accent_color ?? '#3657E8'
  const name = profile?.display_name || 'Flatmate'
  const showImage = url && failed !== url

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full select-none ${className}`}
      style={{ width: size, height: size, backgroundColor: color, color: readableOn(color) }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setFailed(url)}
        />
      ) : (
        <span className="font-bold tracking-tight" style={{ fontSize: Math.max(11, size * 0.38) }}>
          {initialsOf(name)}
        </span>
      )}
    </span>
  )
}

/**
 * Compact overlapping avatars for the people on an item. Shows up to `max`
 * faces plus a "+n". Each face keeps its accent colour; a white ring separates them.
 */
export function AvatarGroup({
  profiles,
  size = 30,
  max = 3,
  label,
}: {
  profiles: Profile[]
  size?: number
  max?: number
  label: string
}) {
  const shown = profiles.slice(0, profiles.length > max ? max - 1 : max)
  const extra = profiles.length - shown.length
  const overlap = Math.round(size * 0.24)
  return (
    <span role="img" aria-label={label} className="inline-flex items-center">
      <AnimatePresence initial={false}>
        {shown.map((p, i) => (
          <motion.span
            key={p.id}
            layout
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative inline-flex rounded-full ring-2 ring-white"
            style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: shown.length - i }}
          >
            <Avatar profile={p} size={size} decorative />
          </motion.span>
        ))}
      </AnimatePresence>
      {extra > 0 && (
        <span
          className="bg-surface-2 text-ink relative inline-flex items-center justify-center rounded-full text-[12px] font-bold ring-2 ring-white"
          style={{ width: size, height: size, marginLeft: -overlap }}
          aria-hidden
        >
          +{extra}
        </span>
      )}
    </span>
  )
}
