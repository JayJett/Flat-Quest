import { useEffect, useState } from 'react'
import { useHousehold } from '@/household/HouseholdProvider'

export function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const { loadError, reload } = useHousehold()
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  if (online && !loadError) return null
  return (
    <div role="status" className="bg-surface-2 px-4 py-2 text-center text-[13px]">
      {!online ? 'You’re offline. What you see may be out of date. Reconnect to save changes.' : (
        <>Couldn’t refresh your flat. <button type="button" className="min-h-11 px-2 font-semibold underline" onClick={() => void reload()}>Try again</button></>
      )}
    </div>
  )
}
