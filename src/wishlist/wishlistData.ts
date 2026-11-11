import wishlistCsv from '../../data/wishlist.csv?raw'
import { cleanRoomName, parseCsv } from '@/lib/csv'

export interface WishlistImportRow {
  room: string
  title: string
  estimated_price: number | null
  shopping_url: string
  notes: string
  chosen: boolean
}

/** Parses a wishlist CSV (the sheet's WISHLIST tab, or data/wishlist.csv). */
export function wishlistFromCsv(text: string): WishlistImportRow[] {
  const table = parseCsv(text)
  const headerIndex = table.findIndex((r) => (r[0] ?? '').trim().toLowerCase() === 'room')
  if (headerIndex === -1) return []
  const header = table[headerIndex]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)))
  const c = {
    room: col(['room']),
    title: col(['idea', 'title']),
    price: col(['target', 'estimated', 'price']),
    url: col(['inspo', 'shopping', 'link', 'url']),
    notes: col(['notes']),
    chosen: col(['chosen']),
  }
  return table
    .slice(headerIndex + 1)
    .map((r) => {
      const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
      const price = Number(get(c.price).replace(/[^0-9.]/g, ''))
      const url = get(c.url)
      return {
        room: cleanRoomName(get(c.room)),
        title: get(c.title).slice(0, 80),
        estimated_price: get(c.price) && Number.isFinite(price) ? price : null,
        shopping_url: /^https?:\/\//i.test(url) ? url : '',
        notes: get(c.notes),
        chosen: /^(true|yes|1|✓|⭐)$/i.test(get(c.chosen)),
      }
    })
    .filter((r) => r.title !== '')
}

/** The 20 ideas from the original Google Sheet's WISHLIST tab. */
export function bundledWishlist(): WishlistImportRow[] {
  return wishlistFromCsv(wishlistCsv)
}
