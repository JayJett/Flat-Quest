/**
 * Flat-local calendar maths. Two kinds of date exist in Flat Quest:
 * - civil dates ("YYYY-MM-DD"): task due dates, deliveries, all-day appointments. They never
 *   convert: Friday is Friday on every device.
 * - instants (timed appointments): resolved in the FLAT's time zone, displayed in it too.
 * The device's own zone is never used for household dates.
 */
export const DEFAULT_ZONE = 'Pacific/Auckland'
export type CivilDate = string // YYYY-MM-DD

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isCivilDate(value: string | null | undefined): value is CivilDate {
  const m = value ? DATE.exec(value) : null
  if (!m) return false
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!
}

export function validZone(zone: string | null | undefined): zone is string {
  if (!zone || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The flat's zone from its settings, falling back like the server does. */
export function flatZone(settings: unknown): string {
  const zone = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).timezone : null
  return typeof zone === 'string' && validZone(zone) ? zone : DEFAULT_ZONE
}

const partsCache = new Map<string, Intl.DateTimeFormat>()
function formatter(zone: string) {
  let f = partsCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    partsCache.set(zone, f)
  }
  return f
}

/** Wall-clock fields of an instant in a zone. */
export function wallClock(instant: number, zone: string) {
  const p = Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).map((x) => [x.type, x.value]))
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute!, second: +p.second! }
}

const pad = (n: number) => String(n).padStart(2, '0')
export const civilOf = (y: number, m: number, d: number): CivilDate => `${y}-${pad(m)}-${pad(d)}`

/** Today's date in the flat (not on this device). */
export function todayIn(zone: string, now = Date.now()): CivilDate {
  const w = wallClock(now, zone)
  return civilOf(w.year, w.month, w.day)
}

/** The instant's date and HH:MM in the flat. */
export function localParts(instant: string | number, zone: string): { date: CivilDate; time: string } {
  const w = wallClock(typeof instant === 'string' ? Date.parse(instant) : instant, zone)
  return { date: civilOf(w.year, w.month, w.day), time: `${pad(w.hour)}:${pad(w.minute)}` }
}

function civilToUtc(date: CivilDate) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}
export function addDays(date: CivilDate, days: number): CivilDate {
  const t = new Date(civilToUtc(date) + days * 86_400_000)
  return civilOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}
/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: CivilDate) {
  return (new Date(civilToUtc(date)).getUTCDay() + 6) % 7
}
export function mondayOf(date: CivilDate): CivilDate {
  return addDays(date, -weekdayIndex(date))
}
export function weekDays(monday: CivilDate): CivilDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}
export function daysBetween(a: CivilDate, b: CivilDate) {
  return Math.round((civilToUtc(b) - civilToUtc(a)) / 86_400_000)
}

/** A `?week=` value: any date in the week (normalised to its Monday); invalid → this week. */
export function weekFromParam(param: string | null, zone: string, now = Date.now()): CivilDate {
  return mondayOf(isCivilDate(param) ? param : todayIn(zone, now))
}

function offsetAt(instant: number, zone: string) {
  const w = wallClock(instant, zone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(instant / 1000) * 1000
}

export type InstantResult = { ok: true; instant: number } | { ok: false; reason: 'nonexistent' | 'ambiguous' | 'invalid' }

/**
 * Resolves a flat-local date and HH:MM to an instant. Times skipped when clocks go forward
 * don't exist; times repeated when clocks go back are ambiguous. Both are refused rather than
 * guessed (the server applies the same rule).
 */
export function zonedInstant(date: CivilDate, time: string, zone: string): InstantResult {
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!isCivilDate(date) || !t || +t[1]! > 23 || +t[2]! > 59) return { ok: false, reason: 'invalid' }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const naive = Date.UTC(y, m - 1, d, +t[1]!, +t[2]!)
  const offsets = new Set([-36, -12, 0, 12, 36].map((h) => offsetAt(naive + h * 3_600_000, zone)))
  const matches = new Set<number>()
  for (const off of offsets) {
    const candidate = naive - off
    const w = wallClock(candidate, zone)
    if (w.year === y && w.month === m && w.day === d && w.hour === +t[1]! && w.minute === +t[2]!) matches.add(candidate)
  }
  if (matches.size === 0) return { ok: false, reason: 'nonexistent' }
  if (matches.size > 1) return { ok: false, reason: 'ambiguous' }
  return { ok: true, instant: [...matches][0]! }
}

/** "Mon 17 Nov" in the flat. */
export function dayLabel(date: CivilDate, style: 'short' | 'long' = 'short') {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', weekday: style, day: 'numeric', month: style === 'long' ? 'long' : 'short' }).format(new Date(civilToUtc(date)))
}
/** "10:30 am" in the flat. */
export function timeLabel(instant: string | number, zone: string) {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant)).replace(/\u202f/g, ' ')
}
/** "NZDT" (or "GMT+13" where no abbreviation exists) for a moment in the flat. */
export function zoneAbbreviation(zone: string, at = Date.now()) {
  const part = new Intl.DateTimeFormat('en-NZ', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')
  return part?.value ?? zone
}
