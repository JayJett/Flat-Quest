import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { wishlistFromCsv } from '@/wishlist/wishlistData'
import { sortIdeas, type Idea } from '@/wishlist/WishlistProvider'

describe('wishlist CSV', () => {
  const rows = wishlistFromCsv(readFileSync('data/wishlist.csv', 'utf8'))

  it('has exactly the 20 ideas from the Google Sheet', () => {
    expect(rows).toHaveLength(20)
    expect(rows[0]).toMatchObject({ room: 'Living room', title: 'A cosy statement rug', chosen: false, estimated_price: null })
  })

  it('cleans room names so they match checklist rooms', () => {
    expect(new Set(rows.map((r) => r.room))).toEqual(
      new Set(['Living room', 'Dining', 'Kitchen', 'Shared bathroom', 'Master ensuite', 'Outdoor & carport', 'Entry & safety', 'Master bedroom']),
    )
  })

  it('reads the sheet layout with title rows and vote columns', () => {
    const sheet = [
      '✨ THE DREAM HOME WISHLIST,,,,,,,,,,',
      ',,,,,,,,,,',
      'Room,Idea,Jarden 💙,Madi 🩷,Emily 💜,Dan 💚,Votes,Target NZ$,Inspo link,Notes,Chosen? ⭐',
      '🍳 Kitchen,Air fryer,TRUE,FALSE,FALSE,FALSE,1,$149,https://example.com/af,Big one,TRUE',
    ].join('\n')
    expect(wishlistFromCsv(sheet)).toEqual([
      { room: 'Kitchen', title: 'Air fryer', estimated_price: 149, shopping_url: 'https://example.com/af', notes: 'Big one', chosen: true },
    ])
  })
})

function idea(id: string, voters: string[], created: string, chosen = false): Idea {
  return {
    id, voters, created_at: created, is_chosen: chosen, household_id: 'h', room_id: null, title: id, notes: null, estimated_price: null,
    shopping_url: null, photo_path: null, chosen_at: null, chosen_by: null, checklist_item_id: null, import_key: null, created_by: null, updated_at: created,
  }
}

describe('sortIdeas', () => {
  const list = [idea('a', ['x'], '2026-01-01'), idea('b', ['x', 'y'], '2026-01-02'), idea('c', [], '2026-01-03', true), idea('d', ['z'], '2026-01-04')]
  it('popular: most votes first, ties newest first', () => {
    expect(sortIdeas(list, 'popular').map((i) => i.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('newest: most recent first', () => {
    expect(sortIdeas(list, 'newest').map((i) => i.id)).toEqual(['d', 'c', 'b', 'a'])
  })
  it('chosen: only chosen ideas', () => {
    expect(sortIdeas(list, 'chosen').map((i) => i.id)).toEqual(['c'])
  })
})
