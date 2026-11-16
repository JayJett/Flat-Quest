import { describe, expect, it } from 'vitest'
import { groupHits, normalise, scoreDoc, searchDocs, type SearchDoc } from '@/search/search'

const doc = (kind: SearchDoc['kind'], title: string, extra?: string): SearchDoc => ({ kind, id: title, title, extra, context: '', href: '/' })
const docs = [
  doc('room', 'Living room'),
  doc('item', 'Living room TV', 'wall mount'),
  doc('item', 'TV cabinet'),
  doc('task', 'Assemble the TV cabinet'),
  doc('essential', 'Toilet paper', '24-roll pack'),
  doc('idea', 'Crème brûlée torch'),
]

describe('search', () => {
  it('normalises case, spacing and accents', () => {
    expect(normalise('  Crème   BRÛLÉE ')).toBe('creme brulee')
  })
  it('matches partial words and every typed word, in any order', () => {
    expect(searchDocs(docs, 'cab tv').map((h) => h.title)).toEqual(['TV cabinet', 'Assemble the TV cabinet'])
    expect(searchDocs(docs, 'creme').map((h) => h.title)).toEqual(['Crème brûlée torch'])
    expect(searchDocs(docs, 'xyz')).toEqual([])
    expect(searchDocs(docs, '   ')).toEqual([])
  })
  it('ranks exact, then starts-with, then word-start, then anywhere', () => {
    expect(scoreDoc({ title: 'Living room' }, 'living room')).toBeGreaterThan(scoreDoc({ title: 'Living room TV' }, 'living room'))
    expect(scoreDoc({ title: 'TV cabinet' }, 'tv')).toBeGreaterThan(scoreDoc({ title: 'Assemble the TV cabinet' }, 'tv'))
    expect(scoreDoc({ title: 'Assemble the TV cabinet' }, 'tv')).toBeGreaterThan(scoreDoc({ title: 'Activities' }, 'tiv'))
  })
  it('title matches beat matches in notes', () => {
    const hits = searchDocs([doc('item', 'Bracket', 'for the tv'), doc('item', 'TV stand')], 'tv')
    expect(hits[0]!.title).toBe('TV stand')
    expect(searchDocs(docs, '24-roll')[0]!.title).toBe('Toilet paper')
  })
  it('groups results by kind and caps each group', () => {
    const many = Array.from({ length: 9 }, (_, i) => doc('task', `Clean ${i}`))
    const groups = groupHits(searchDocs([...many, doc('room', 'Cleaning cupboard')], 'clean'))
    expect(groups.map((g) => g.label).sort()).toEqual(['Rooms', 'Things to do'])
    // Groups follow their best hit: "Clean 0" is a closer match than "Cleaning cupboard".
    expect(groups[0]!.kind).toBe('task')
    expect(groups.find((g) => g.kind === 'task')!.hits).toHaveLength(6)
  })
})
