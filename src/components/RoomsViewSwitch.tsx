import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useHousehold } from '@/household/HouseholdProvider'
import { shoppingSummary } from '@/lib/shopping'
import { isUnclaimed } from '@/lib/stats'
import { Segmented } from './ui'

export type RoomsView = 'rooms' | 'unclaimed' | 'shopping'

const PATH: Record<RoomsView, string> = {
  rooms: '/rooms',
  unclaimed: '/rooms?filter=unclaimed',
  shopping: '/rooms/shopping',
}

/** The three ways of looking at the same checklist, shared by Rooms and Shopping. */
export function RoomsViewSwitch({ view }: { view: RoomsView }) {
  const { items } = useHousehold()
  const navigate = useNavigate()
  const unclaimed = useMemo(() => items.filter(isUnclaimed).length, [items])
  const shopping = useMemo(() => {
    const s = shoppingSummary(items)
    return s.toBuy + s.inProgress
  }, [items])
  return (
    <div className="mb-5 max-w-md">
      <Segmented
        label="View"
        value={view}
        onChange={(v) => navigate(PATH[v], { replace: true })}
        options={[
          { value: 'rooms', label: 'Rooms' },
          { value: 'unclaimed', label: 'Unclaimed', count: unclaimed },
          { value: 'shopping', label: 'Shopping', count: shopping },
        ]}
      />
    </div>
  )
}
