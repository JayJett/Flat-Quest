import { useMemo } from 'react'
import { DEFAULT_ZONE, validZone } from './dates'

const COMMON = ['Pacific/Auckland', 'Pacific/Chatham', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Europe/London', 'America/Los_Angeles', 'America/New_York', 'Asia/Singapore']

/** The device's zone as a starting suggestion for a new flat (editable). */
export function suggestedTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return validZone(zone) ? zone : DEFAULT_ZONE
  } catch {
    return DEFAULT_ZONE
  }
}

function allZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (list?.length) return list
  } catch { /* older browsers */ }
  return COMMON
}

const label = (zone: string) => zone.replace(/_/g, ' ').replace('/', ' / ')

export function TimeZoneSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (zone: string) => void; disabled?: boolean }) {
  const zones = useMemo(() => {
    const all = new Set(allZones())
    all.add(value)
    const common = COMMON.filter((z) => all.has(z))
    const rest = [...all].filter((z) => !common.includes(z)).sort()
    return { common, rest }
  }, [value])
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <optgroup label="Common">
        {zones.common.map((z) => <option key={z} value={z}>{label(z)}</option>)}
      </optgroup>
      <optgroup label="All time zones">
        {zones.rest.map((z) => <option key={z} value={z}>{label(z)}</option>)}
      </optgroup>
    </select>
  )
}
