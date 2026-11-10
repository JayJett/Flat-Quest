import { useEffect, useState } from 'react'
import { readableOn } from '@/lib/color'
import type { Profile } from '@/lib/domain'
import { supabase } from '@/lib/supabase'

const cache = new Map<string, { url: string; expires: number }>()
const inflight = new Map<string, Promise<string | null>>()
const TTL_SECONDS = 60 * 60

/** Resolves a private avatar path to a short-lived signed URL (cached). */
export function signedAvatarUrl(path: string): Promise<string | null> {
  const hit = cache.get(path)
  if (hit && hit.expires > Date.now() + 60_000) return Promise.resolve(hit.url)
  const running = inflight.get(path)
  if (running) return running
  const p = supabase.storage
    .from('avatars')
    .createSignedUrl(path, TTL_SECONDS)
    .then(({ data }) => {
      if (!data?.signedUrl) return null
      cache.set(path, { url: data.signedUrl, expires: Date.now() + TTL_SECONDS * 1000 })
      return data.signedUrl
    })
    .catch(() => null)
    .finally(() => inflight.delete(path))
  inflight.set(path, p)
  return p
}

export function useAvatarUrl(path: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!path) return
    let active = true
    void signedAvatarUrl(path).then((url) => {
      if (active) setResolved({ path, url })
    })
    return () => {
      active = false
    }
  }, [path])
  if (!path) return null
  return resolved?.path === path ? resolved.url : (cache.get(path)?.url ?? null)
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
