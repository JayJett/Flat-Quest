import { Share, SquarePlus } from 'lucide-react'

/** iPhone / iPad Safari, not already opened from the Home Screen. */
export function shouldShowIosInstallHint(nav: Navigator = navigator, standaloneQuery = typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)').matches : false): boolean {
  const ua = nav.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  // Other iOS browsers (Chrome, Firefox, Edge) can't always add to the Home Screen the same way.
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  const installed = standaloneQuery || (nav as Navigator & { standalone?: boolean }).standalone === true
  return ios && safari && !installed
}

/**
 * A quiet how-to in Settings — never a pop-up. iOS has no install prompt, so this is the only
 * way people discover that Flat Quest can live on their Home Screen like an app.
 */
export function InstallHint() {
  if (!shouldShowIosInstallHint()) return null
  return (
    <section aria-labelledby="install-h" data-testid="install-hint">
      <h2 id="install-h" className="text-title font-bold">On your iPhone</h2>
      <p className="text-ink-2 mt-1.5">Add Flat Quest to your Home Screen to open it like an app, full screen.</p>
      <ol className="mt-3 flex flex-col gap-2 text-[15px]">
        <li className="flex items-center gap-3">
          <span className="bg-surface-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"><Share size={18} aria-hidden /></span>
          Tap <strong className="font-semibold">Share</strong> in Safari’s toolbar
        </li>
        <li className="flex items-center gap-3">
          <span className="bg-surface-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"><SquarePlus size={18} aria-hidden /></span>
          Choose <strong className="font-semibold">Add to Home Screen</strong>
        </li>
      </ol>
    </section>
  )
}
