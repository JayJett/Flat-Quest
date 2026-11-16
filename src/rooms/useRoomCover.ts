import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/** The image behind a room cover: a Visual Home record, never a copy of the file. */
export type CoverImage = { id: string; thumb: string | null; photo: string | null }

// A visual's file paths never change, so they're cached by id. Lookups requested in the same
// tick (e.g. every tile on the Rooms screen) share one query.
const known = new Map<string, CoverImage | null>()
const waiting = new Map<string, ((v: CoverImage | null) => void)[]>()
let scheduled = false

function flush() {
  scheduled = false
  const ids = [...waiting.keys()]
  const callbacks = new Map(waiting)
  waiting.clear()
  void supabase
    .from('room_visuals')
    .select('id,photo_path,thumbnail_path')
    .in('id', ids)
    .then(({ data, error }) => {
      for (const id of ids) {
        const row = data?.find((r) => r.id === id)
        const value = row ? { id, thumb: row.thumbnail_path, photo: row.photo_path } : null
        // A failed lookup isn't remembered, so it is retried next time.
        if (!error) known.set(id, value)
        callbacks.get(id)?.forEach((cb) => cb(value))
      }
    })
}

function lookup(id: string, cb: (v: CoverImage | null) => void) {
  const list = waiting.get(id) ?? []
  list.push(cb)
  waiting.set(id, list)
  if (!scheduled) { scheduled = true; queueMicrotask(flush) }
}

export function forgetRoomCovers() { known.clear() }
supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') forgetRoomCovers() })

/** Resolves a room's cover to its image paths; null when there's no cover (or it has gone). */
export function useRoomCover(coverId: string | null | undefined): CoverImage | null {
  const [resolved, setResolved] = useState<{ id: string; value: CoverImage | null } | null>(null)
  useEffect(() => {
    if (!coverId || known.has(coverId)) return
    let active = true
    lookup(coverId, (value) => { if (active) setResolved({ id: coverId, value }) })
    return () => { active = false }
  }, [coverId])
  if (!coverId) return null
  if (known.has(coverId)) return known.get(coverId) ?? null
  return resolved?.id === coverId ? resolved.value : null
}
