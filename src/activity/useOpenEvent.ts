import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useToast } from '@/components/Toast'
import { useHousehold } from '@/household/HouseholdProvider'
import type { HouseholdEventRow } from '@/lib/database.types'
import { eventHref } from '@/lib/events'

/**
 * Opens what an event is about. Things can be deleted after the fact, so a missing item
 * or room is explained with a message rather than a dead end. Ideas, options and
 * comments are checked by the screen they open (it has that data loaded).
 */
export function useOpenEvent() {
  const { items, rooms } = useHousehold()
  const navigate = useNavigate()
  const toast = useToast()
  return useCallback(
    (e: HouseholdEventRow | null, options?: { replace?: boolean }): boolean => {
      const href = e ? eventHref(e) : null
      if (!e || !href) {
        toast.show('There’s nothing to open for this one.')
        return false
      }
      if (e.item_id && !e.idea_id && !items.some((i) => i.id === e.item_id)) {
        toast.show('That item has since been removed from the list.')
        return false
      }
      if (e.room_id && !e.idea_id && !rooms.some((r) => r.id === e.room_id)) {
        toast.show('That room has since been removed.')
        return false
      }
      navigate(href, { replace: options?.replace })
      return true
    },
    [items, rooms, navigate, toast],
  )
}
