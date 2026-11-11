/**
 * Flat Quest design tokens (TypeScript side). CSS custom properties with the
 * same values live in src/index.css under @theme.
 */

export interface ColorToken {
  key: string
  label: string
  hex: string
  /** Text/icon colour that meets ≥3:1 (large text) on `hex`. */
  on: '#FFFFFF' | '#111111'
}

/**
 * Room category colours: saturated, flat, used for room tiles only.
 * Contrast of `on` vs `hex` (large bold text): orange 3.27, periwinkle 3.15,
 * navy 11.6, yellow 11.9, green 8.6, blue 5.7, pink 3.5, sky 7.8, violet 4.3,
 * teal 7.2, red 3.3.
 */
export const ROOM_COLORS: ColorToken[] = [
  { key: 'orange', label: 'Orange', hex: '#F45D1E', on: '#FFFFFF' },
  { key: 'periwinkle', label: 'Periwinkle', hex: '#8585F5', on: '#FFFFFF' },
  { key: 'navy', label: 'Navy', hex: '#1F2C8F', on: '#FFFFFF' },
  { key: 'yellow', label: 'Sunshine', hex: '#FFC350', on: '#111111' },
  { key: 'green', label: 'Mint', hex: '#42C493', on: '#111111' },
  { key: 'blue', label: 'Blue', hex: '#3657E8', on: '#FFFFFF' },
  { key: 'pink', label: 'Pink', hex: '#F0478C', on: '#FFFFFF' },
  { key: 'sky', label: 'Sky', hex: '#2FB2EE', on: '#111111' },
  { key: 'violet', label: 'Violet', hex: '#9257F2', on: '#FFFFFF' },
  { key: 'teal', label: 'Teal', hex: '#12B3A0', on: '#111111' },
  { key: 'red', label: 'Red', hex: '#FF4B4B', on: '#FFFFFF' },
]

export function roomColor(key: string): ColorToken {
  return ROOM_COLORS.find((c) => c.key === key) ?? ROOM_COLORS[5]!
}

/** Curated personal accent colours for flatmates. Custom hex is also allowed. */
export const MEMBER_COLORS: { hex: string; label: string }[] = [
  { hex: '#3657E8', label: 'Blue' },
  { hex: '#7272F0', label: 'Periwinkle' },
  { hex: '#9257F2', label: 'Violet' },
  { hex: '#F0478C', label: 'Pink' },
  { hex: '#FF4B4B', label: 'Red' },
  { hex: '#F45D1E', label: 'Orange' },
  { hex: '#FFC350', label: 'Sunshine' },
  { hex: '#1FAE7A', label: 'Green' },
  { hex: '#12B3A0', label: 'Teal' },
  { hex: '#1A9EDB', label: 'Sky' },
  { hex: '#1F2C8F', label: 'Navy' },
  { hex: '#111111', label: 'Ink' },
]

export interface RoomPreset {
  icon: string
  color: string
}

/** Icon + colour presets for the rooms in the original Flat Quest checklist. */
const ROOM_PRESETS: { match: RegExp; preset: RoomPreset }[] = [
  { match: /living|lounge/i, preset: { icon: 'sofa', color: 'orange' } },
  { match: /kitchen/i, preset: { icon: 'cooking-pot', color: 'periwinkle' } },
  { match: /dining/i, preset: { icon: 'utensils-crossed', color: 'yellow' } },
  { match: /shared bath|main bath|bathroom/i, preset: { icon: 'bath', color: 'sky' } },
  { match: /ensuite/i, preset: { icon: 'shower-head', color: 'navy' } },
  { match: /laundry|cleaning/i, preset: { icon: 'washing-machine', color: 'green' } },
  { match: /master bed/i, preset: { icon: 'bed-double', color: 'blue' } },
  { match: /bedroom/i, preset: { icon: 'bed-single', color: 'pink' } },
  { match: /entry|safety/i, preset: { icon: 'door-open', color: 'violet' } },
  { match: /outdoor|carport|garden/i, preset: { icon: 'trees', color: 'teal' } },
]

export function roomPresetFor(name: string): RoomPreset {
  // Ensuite must win over the generic bathroom rule.
  if (/ensuite/i.test(name)) return { icon: 'shower-head', color: 'navy' }
  return ROOM_PRESETS.find((p) => p.match.test(name))?.preset ?? { icon: 'house', color: 'blue' }
}
