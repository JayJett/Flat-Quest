/**
 * The app can be served from a domain root (Vercel, local dev) or a sub-folder
 * (GitHub Pages: https://jayjett.github.io/Flat-Quest/). Vite's BASE_URL tells us which.
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '')

/** Absolute URL for an in-app path, e.g. appUrl('/join?code=abc'). */
export function appUrl(path: string): string {
  return `${window.location.origin}${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`
}

/** Tidies a typed web link. Empty = null; anything that isn't an http(s) address = 'invalid'. */
export function normaliseWebUrl(v: string): string | null | 'invalid' {
  const t = v.trim()
  if (t === '') return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return 'invalid'
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
    if (!u.hostname.includes('.') || u.toString().length > 1000) return 'invalid'
    return u.toString()
  } catch {
    return 'invalid'
  }
}

/** "mocka.co.nz" from a full link, for compact display. */
export function hostLabel(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
