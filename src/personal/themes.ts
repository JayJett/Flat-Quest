/**
 * Personal accent themes (Phase 7). A member's choice only changes *their* app: it
 * overrides the accent tokens on <html>. Room colours, success green and error red are
 * separate tokens and never change.
 *
 * Contrast (WCAG): `on` against `fill` and `ink` against white are all ≥ 4.5:1 — see
 * tests/personal.test.ts, which checks every pairing.
 */
export type AccentKey = 'blue' | 'lavender' | 'mint' | 'coral' | 'sunshine'

export interface AccentTheme {
  key: AccentKey
  label: string
  /** Buttons, active controls, selected indicators. */
  fill: string
  press: string
  /** Pale wash for selected rows and highlights. */
  soft: string
  /** Text and icons on `fill`. */
  on: '#FFFFFF' | '#111111'
  /** Accent-coloured text and icons on white. */
  ink: string
}

export const ACCENTS: AccentTheme[] = [
  { key: 'blue', label: 'Electric Blue', fill: '#3657E8', press: '#2945C9', soft: '#EEF1FD', on: '#FFFFFF', ink: '#3657E8' },
  { key: 'lavender', label: 'Lavender', fill: '#7357E8', press: '#5D41D6', soft: '#F1EEFD', on: '#FFFFFF', ink: '#6347DD' },
  { key: 'mint', label: 'Mint', fill: '#2FC48E', press: '#26B07F', soft: '#E4F7EF', on: '#111111', ink: '#127A55' },
  { key: 'coral', label: 'Coral', fill: '#F2604F', press: '#E04E3D', soft: '#FDEDEA', on: '#111111', ink: '#C93A2B' },
  { key: 'sunshine', label: 'Sunshine', fill: '#FFC63D', press: '#F0B320', soft: '#FFF6DA', on: '#111111', ink: '#8A5A00' },
]

export const DEFAULT_ACCENT: AccentKey = 'blue'

export function accentTheme(key: string | null | undefined): AccentTheme {
  return ACCENTS.find((a) => a.key === key) ?? ACCENTS[0]!
}

/** Applies a theme by overriding the CSS custom properties the whole app already uses. */
export function applyAccent(key: string | null | undefined, root: HTMLElement = document.documentElement) {
  const t = accentTheme(key)
  if (t.key === DEFAULT_ACCENT) {
    // The default stays exactly the stylesheet's own values.
    for (const v of ['--color-accent', '--color-accent-press', '--color-accent-soft', '--color-on-accent', '--color-accent-ink']) root.style.removeProperty(v)
  } else {
    root.style.setProperty('--color-accent', t.fill)
    root.style.setProperty('--color-accent-press', t.press)
    root.style.setProperty('--color-accent-soft', t.soft)
    root.style.setProperty('--color-on-accent', t.on)
    root.style.setProperty('--color-accent-ink', t.ink)
  }
  root.dataset.accent = t.key
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#FFFFFF')
}

// ----------------------------------------------------------------- Home layout

/**
 * Home always opens with Furnishing progress. It is fixed: never hidden, never moved, and
 * not part of anyone's saved layout.
 */
export const FIXED_HOME_SECTION = { id: 'progress', label: 'Furnishing progress', hint: 'Always first on Home' } as const

/**
 * The sections each person can reorder and hide (Phase 8: "Room by room" was removed from
 * Home — the Rooms tab already lists every room).
 */
export const HOME_SECTIONS = [
  { id: 'focus', label: 'For you', hint: 'Your tasks, pick-ups and items' },
  { id: 'tasks', label: 'Things to do', hint: 'Household tasks that need attention' },
  { id: 'essentials', label: 'Essentials', hint: 'What the flat is running low on' },
  { id: 'deliveries', label: 'On the way', hint: 'Furniture that’s been ordered' },
  { id: 'activity', label: 'Around the flat', hint: 'Recent household activity' },
] as const

export type HomeSectionId = (typeof HOME_SECTIONS)[number]['id']
export type HomeLayout = { id: HomeSectionId; hidden: boolean }[]

export const DEFAULT_LAYOUT: HomeLayout = HOME_SECTIONS.map((s) => ({ id: s.id, hidden: false }))

/**
 * Reads a stored layout defensively: unknown ids are dropped, duplicates removed, and any
 * section added in a later release is appended (visible) so nobody silently loses it.
 *
 * Phase 7 layouts may contain "progress" (now fixed first) and "rooms" (removed from Home).
 * Both are simply dropped here, so every other section keeps its saved order and visibility
 * and nothing needs resetting. This runs on every read, on every device.
 */
export function normaliseLayout(raw: unknown): HomeLayout {
  const known = new Set<string>(HOME_SECTIONS.map((s) => s.id))
  const out: HomeLayout = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const id = (entry as { id?: unknown })?.id
      if (typeof id !== 'string' || !known.has(id) || out.some((e) => e.id === id)) continue
      out.push({ id: id as HomeSectionId, hidden: Boolean((entry as { hidden?: unknown }).hidden) })
    }
  }
  for (const s of HOME_SECTIONS) if (!out.some((e) => e.id === s.id)) out.push({ id: s.id, hidden: false })
  return out
}

export function moveSection(layout: HomeLayout, index: number, delta: -1 | 1): HomeLayout {
  const target = index + delta
  if (target < 0 || target >= layout.length) return layout
  const next = layout.slice()
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

// ----------------------------------------------------------------- Greeting

/**
 * "Good morning, Jarden" by time of day, with an occasional "Welcome home" so it doesn't
 * feel robotic. Deterministic per day (no flicker between renders).
 */
export function greeting(name: string | null | undefined, now: Date = new Date()): string {
  const h = now.getHours()
  const base = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const day = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000)
  const phrase = h >= 17 && day % 3 === 0 ? 'Welcome home' : base
  const n = name?.trim()
  return n ? `${phrase}, ${n}` : phrase
}
