import { useEffect } from 'react'

/**
 * Unsaved text the person is still typing (quick-add fields, flat details). Switching flats
 * checks this first and offers to stay, so nothing typed for one flat is silently lost or
 * carried into another.
 */
const open = new Set<symbol>()

export function useUnsavedDraft(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const key = Symbol('draft')
    open.add(key)
    return () => { open.delete(key) }
  }, [dirty])
}

export const hasUnsavedDrafts = () => open.size > 0
