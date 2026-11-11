import { roomPresetFor } from '@/design/tokens'
import type { Priority, Status } from './domain'

const BOM = new RegExp('^\\uFEFF')

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(BOM, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Payload accepted by the `import_checklist` database function. */
export interface ImportRow {
  room: string
  room_icon: string
  room_color: string
  name: string
  priority: Priority
  status: Status
  done: boolean
  responsible: string
  owned_by: string
  estimated_price: number | null
  actual_price: number | null
  shopping_url: string
  notes: string
}

export interface ImportResult {
  rows: ImportRow[]
  warnings: string[]
}

const HEADER_ALIASES: Record<keyof Omit<ImportRow, 'room_icon' | 'room_color'>, string[]> = {
  room: ['room'],
  name: ['item', 'item / what we need', 'name'],
  done: ['done', 'done? ✅', 'done?', 'complete'],
  responsible: ["who's on it?", 'whos on it?', 'responsible', 'who'],
  status: ['plan / status', 'status', 'plan'],
  priority: ['priority'],
  owned_by: ['owned by', 'owned_by', 'owner'],
  estimated_price: ['budget nz$', 'budget_nzd', 'budget', 'estimated price'],
  actual_price: ['spent nz$', 'spent_nzd', 'spent', 'actual price'],
  shopping_url: ['shopping link', 'shopping_url', 'link', 'url'],
  notes: ['notes', 'note'],
}

const PRIORITY_MAP: Record<string, Priority> = {
  'must-have': 'must_have',
  'must have': 'must_have',
  must_have: 'must_have',
  'nice to have': 'nice_to_have',
  nice_to_have: 'nice_to_have',
  'maybe later': 'maybe_later',
  maybe_later: 'maybe_later',
}

const STATUS_MAP: Record<string, Status> = {
  'to decide': 'to_decide',
  bringing: 'bringing',
  'need to buy': 'need_to_buy',
  shopping: 'shopping',
  ordered: 'ordered',
  'on the way': 'on_the_way',
  'ready to collect': 'ready_to_collect',
  delivered: 'delivered',
  provided: 'provided',
  'provided with flat': 'provided',
  'provided by landlord': 'provided',
  'not needed': 'not_needed',
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/[’']/g, "'")

/** Removes leading emoji / symbols ("🛋️ Living room" → "Living room"). */
export function cleanRoomName(raw: string): string {
  return raw.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

function parseBool(v: string | undefined): boolean {
  return ['true', 'yes', 'y', '1', '✓', '✅', 'x'].includes(norm(v))
}

function parsePrice(v: string | undefined): number | null {
  const cleaned = (v ?? '').replace(/[^0-9.]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/**
 * Maps a checklist CSV (either the Flat Quest sheet's CHECKLIST tab exported
 * as CSV, or the normalised data/checklist.csv) into import rows.
 */
export function checklistFromCsv(text: string): ImportResult {
  const table = parseCsv(text)
  const warnings: string[] = []
  const headerIndex = table.findIndex((r) => norm(r[0]) === 'room')
  if (headerIndex === -1) {
    return { rows: [], warnings: ['Could not find a header row starting with "Room".'] }
  }
  const header = table[headerIndex]!.map(norm)
  const col = {} as Record<keyof typeof HEADER_ALIASES, number>
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    col[key as keyof typeof HEADER_ALIASES] = header.findIndex((h) => aliases.includes(h))
  }
  if (col.name === -1) return { rows: [], warnings: ['Could not find an item/name column.'] }

  const rows: ImportRow[] = []
  table.slice(headerIndex + 1).forEach((r, idx) => {
    const get = (k: keyof typeof HEADER_ALIASES) => (col[k] >= 0 ? (r[col[k]] ?? '') : '')
    const room = cleanRoomName(get('room'))
    const name = get('name').trim()
    if (!room && !name) return
    const line = headerIndex + idx + 2
    if (!room || !name) {
      warnings.push(`Row ${line}: skipped — every item needs a room and a name.`)
      return
    }
    const rawPriority = norm(get('priority'))
    const priority = PRIORITY_MAP[rawPriority]
    if (rawPriority && !priority) warnings.push(`Row ${line}: unknown priority "${get('priority')}", using Must-have.`)
    const rawStatus = norm(get('status'))
    const status = STATUS_MAP[rawStatus]
    if (rawStatus && !status) warnings.push(`Row ${line}: unknown status "${get('status')}", using To decide.`)
    const url = get('shopping_url').trim()
    const preset = roomPresetFor(room)
    rows.push({
      room: room.slice(0, 40),
      room_icon: preset.icon,
      room_color: preset.color,
      name: name.slice(0, 80),
      priority: priority ?? 'must_have',
      status: status ?? 'to_decide',
      done: parseBool(get('done')),
      responsible: get('responsible').trim(),
      owned_by: get('owned_by').trim(),
      estimated_price: parsePrice(get('estimated_price')),
      actual_price: parsePrice(get('actual_price')),
      shopping_url: /^https?:\/\//i.test(url) ? url.slice(0, 1000) : '',
      notes: get('notes').trim().slice(0, 1000),
    })
  })
  return { rows, warnings }
}
