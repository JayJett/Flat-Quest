/**
 * Household search (Phase 8). Runs in the browser over records the app has already loaded
 * through the normal, RLS-protected queries — so it can only ever find this flat's data,
 * and typing never sends a request.
 */

export type SearchKind = 'room' | 'item' | 'option' | 'idea' | 'essential' | 'task' | 'visual'

export interface SearchDoc {
  kind: SearchKind
  id: string
  title: string
  /** Secondary text that also matches (notes, retailer, category), weighted lower. */
  extra?: string | null
  /** Shown under the title: "Furnishing item · Kitchen". */
  context: string
  href: string
  /** For icons: the room colour key, if any. */
  roomColor?: string | null
  roomIcon?: string | null
}

export interface SearchHit extends SearchDoc {
  score: number
}

export const KIND_LABEL: Record<SearchKind, string> = {
  room: 'Rooms',
  item: 'Furnishing items',
  option: 'Product options',
  idea: 'Wishlist',
  essential: 'Essentials',
  task: 'Things to do',
  visual: 'Visual Home',
}

/** When scores tie, this is the order groups appear in. */
const KIND_ORDER: SearchKind[] = ['room', 'item', 'essential', 'task', 'idea', 'option', 'visual']

/** Case-, accent- and spacing-insensitive form used for matching. */
export function normalise(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function wordStart(hay: string, needle: string): boolean {
  let at = hay.indexOf(needle)
  while (at !== -1) {
    if (at === 0 || /[\s\-/(&,.]/.test(hay.charAt(at - 1))) return true
    at = hay.indexOf(needle, at + 1)
  }
  return false
}

/**
 * Scores one record. Every word typed must appear somewhere (title or extra text), so
 * "tv cab" finds "Assemble the TV cabinet". Exact title beats starts-with beats a word
 * that starts with it beats anywhere-inside; title matches beat matches in notes.
 */
export function scoreDoc(doc: Pick<SearchDoc, 'title' | 'extra'>, query: string): number {
  const q = normalise(query)
  if (!q) return 0
  const title = normalise(doc.title)
  const extra = normalise(doc.extra)
  let score = 0
  if (title === q) score += 1000
  else if (title.startsWith(q)) score += 600
  else if (wordStart(title, q)) score += 400
  else if (title.includes(q)) score += 250
  for (const token of q.split(' ')) {
    if (wordStart(title, token)) score += 40
    else if (title.includes(token)) score += 20
    else if (wordStart(extra, token)) score += 10
    else if (extra.includes(token)) score += 6
    else return 0
  }
  // Shorter titles are closer to what was typed.
  return score - Math.min(title.length, 60) * 0.1
}

export function searchDocs(docs: readonly SearchDoc[], query: string, limit = 40): SearchHit[] {
  if (!normalise(query)) return []
  const hits: SearchHit[] = []
  for (const d of docs) {
    const score = scoreDoc(d, query)
    if (score > 0) hits.push({ ...d, score })
  }
  return hits
    .sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title))
    .slice(0, limit)
}

/** Groups hits by kind, groups ordered by their best hit. Order within a group is kept. */
export function groupHits(hits: readonly SearchHit[], perGroup = 6): { kind: SearchKind; label: string; hits: SearchHit[] }[] {
  const groups = new Map<SearchKind, SearchHit[]>()
  for (const h of hits) {
    const g = groups.get(h.kind) ?? []
    if (g.length < perGroup) g.push(h)
    groups.set(h.kind, g)
  }
  return [...groups.entries()].map(([kind, list]) => ({ kind, label: KIND_LABEL[kind], hits: list }))
}
