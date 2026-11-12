import { useSignedUrl } from '@/components/Avatar'
import { ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'

export function MediaImage({ path, alt = '', className = '', eager = false }: { path: string | null; alt?: string; className?: string; eager?: boolean }) {
  const url = useSignedUrl('household-media', path)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    const retry = () => { if (document.visibilityState === 'visible') setFailed(null) }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', retry)
    return () => { window.removeEventListener('online', retry); document.removeEventListener('visibilitychange', retry) }
  }, [])
  return url && failed !== url ? <img src={url} alt={alt} className={className} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(url)} draggable={false} />
    : <div role="img" aria-label={alt || 'Photo loading'} className={`bg-surface-2 text-ink-3 flex min-h-40 items-center justify-center ${className}`}><ImageOff size={24} aria-hidden /></div>
}
