/**
 * The app can be served from a domain root (Vercel, local dev) or a sub-folder
 * (GitHub Pages: https://jayjett.github.io/Flat-Quest/). Vite's BASE_URL tells us which.
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '')

/** Absolute URL for an in-app path, e.g. appUrl('/join?code=abc'). */
export function appUrl(path: string): string {
  return `${window.location.origin}${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`
}
