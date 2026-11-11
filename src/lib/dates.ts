/**
 * Calendar dates for purchases and deliveries are stored as plain YYYY-MM-DD
 * (Postgres `date`), not timestamps, so "20 November" means the same day for
 * everyone. These helpers never go through UTC: `new Date('2026-11-20')` would
 * be parsed as midnight UTC and can land on the 19th or 21st locally.
 */
export type Day = string

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Today's calendar date where the device is (not the UTC date). */
export function todayLocal(now: Date = new Date()): Day {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** A real calendar date in a sensible range, or null. Rejects 2026-02-30 and the like. */
export function parseDay(value: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = DAY.exec((value ?? '').trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const probe = new Date(y, m - 1, d)
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null
  return { y, m, d }
}

export function isDay(value: string | null | undefined): value is Day {
  return parseDay(value) !== null
}

/** Whole days from `from` to `to` (negative when `to` is earlier). Daylight-saving safe. */
export function daysBetween(from: Day, to: Day): number | null {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b) return null
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/** "20 Nov", or "20 Nov 2027" when it isn't this year. */
export function formatDay(value: Day | null | undefined, today: Day = todayLocal()): string {
  const p = parseDay(value)
  if (!p) return ''
  const sameYear = parseDay(today)?.y === p.y
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** "today", "tomorrow", "yesterday", otherwise the formatted date. */
export function friendlyDay(value: Day | null | undefined, today: Day = todayLocal()): string {
  if (!value) return ''
  const diff = daysBetween(today, value)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  return formatDay(value, today)
}
