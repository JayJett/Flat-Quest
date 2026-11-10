export const HEX_RE = /^#[0-9a-f]{6}$/i

export function normaliseHex(input: string): string | null {
  let v = input.trim()
  if (!v.startsWith('#')) v = `#${v}`
  if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${[...v.slice(1)].map((c) => c + c).join('')}`
  return HEX_RE.test(v) ? v.toUpperCase() : null
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const n = normaliseHex(hex) ?? '#000000'
  const r = parseInt(n.slice(1, 3), 16)
  const g = parseInt(n.slice(3, 5), 16)
  const b = parseInt(n.slice(5, 7), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Best of white / ink for text placed on `bg`. */
export function readableOn(bg: string): '#FFFFFF' | '#111111' {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#111111') ? '#FFFFFF' : '#111111'
}

/**
 * When an accent colour is used *as text or a thin line on white*, very light
 * colours become unreadable. Returns true if it needs a fallback.
 */
export function tooLightOnWhite(hex: string): boolean {
  return contrast(hex, '#FFFFFF') < 3
}
