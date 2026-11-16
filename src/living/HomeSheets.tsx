import { ArrowDown, ArrowUp, Lock, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { ItemSheet, Switch } from '@/components/ItemSheet'
import { Sheet } from '@/components/Sheet'
import { Button, IconButton, Segmented } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { SPRINGS } from '@/motion/motion'
import { usePreferences } from '@/personal/PreferencesProvider'
import { DEFAULT_LAYOUT, FIXED_HOME_SECTION, HOME_SECTIONS, moveSection } from '@/personal/themes'
import { EssentialQuickAdd } from './EssentialParts'
import { TaskQuickAdd } from './TaskParts'

export type QuickAddKind = 'essential' | 'task' | 'item'

/**
 * One place to add anything from Home: something we've run out of, something to do, or a
 * furnishing item. Opens as the usual bottom sheet, within thumb reach.
 */
export function QuickAddSheet({ open, initial = 'essential', onClose }: { open: boolean; initial?: QuickAddKind; onClose: () => void }) {
  const { rooms } = useHousehold()
  const [kind, setKind] = useState<QuickAddKind>(initial)
  const [lastOpen, setLastOpen] = useState(open)
  const [itemOpen, setItemOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setKind(initial)
  }
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Add">
        <div className="flex flex-col gap-5" data-testid="quick-add-sheet">
          <Segmented
            label="What to add"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'essential', label: 'Essential' },
              { value: 'task', label: 'Task' },
              ...(rooms.length ? [{ value: 'item' as const, label: 'Furnishing' }] : []),
            ]}
          />
          {kind === 'essential' && <EssentialQuickAdd autoFocus onAdded={onClose} />}
          {kind === 'task' && <TaskQuickAdd autoFocus onAdded={onClose} />}
          {kind === 'item' && (
            <div>
              <p className="text-ink-2 text-[15px]">Something the flat needs to buy or bring, and keep.</p>
              <Button
                size="lg"
                block
                className="mt-4"
                onClick={() => {
                  onClose()
                  window.setTimeout(() => setItemOpen(true), 240)
                }}
              >
                Add a furnishing item
              </Button>
            </div>
          )}
        </div>
      </Sheet>
      <ItemSheet open={itemOpen} item={null} onClose={() => setItemOpen(false)} />
    </>
  )
}

/**
 * Show/hide and reorder Home sections. Buttons rather than dragging, so it works with one
 * thumb, a keyboard or a screen reader; rows glide to their new place.
 */
export function HomeLayoutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, update, motion: level } = usePreferences()
  const layout = prefs.layout
  const label = (id: string) => HOME_SECTIONS.find((s) => s.id === id)!
  const isDefault = JSON.stringify(layout) === JSON.stringify(DEFAULT_LAYOUT)
  return (
    <Sheet open={open} onClose={onClose} title="Customise Home">
      <p className="text-ink-2 -mt-1 mb-3 text-[15px]">Choose what you see on Home, and in what order. Only you see this.</p>
      <div className="bg-surface-2 flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2" data-testid="home-layout-fixed">
        <span className="bg-surface text-ink-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
          <Lock size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{FIXED_HOME_SECTION.label}</p>
          <p className="text-ink-2 text-[13px]">Always first on Home, and always shown.</p>
        </div>
      </div>
      <p className="text-ink-2 mt-4 mb-1 text-[13px] font-bold">Then, in this order</p>
      <ul data-testid="home-layout-list">
        {layout.map((entry, i) => {
          const s = label(entry.id)
          return (
            <motion.li key={entry.id} layout={level !== 'reduced'} transition={SPRINGS[level].settle} className="border-line flex min-h-16 items-center gap-2 border-b py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className={`font-semibold ${entry.hidden ? 'text-ink-2' : ''}`}>{s.label}</p>
                <p className="text-ink-2 truncate text-[13px]">{s.hint}</p>
              </div>
              <IconButton label={`Move ${s.label} up`} disabled={i === 0} onClick={() => void update({ layout: moveSection(layout, i, -1) })} className="disabled:opacity-25">
                <ArrowUp size={20} aria-hidden />
              </IconButton>
              <IconButton
                label={`Move ${s.label} down`}
                disabled={i === layout.length - 1}
                onClick={() => void update({ layout: moveSection(layout, i, 1) })}
                className="disabled:opacity-25"
              >
                <ArrowDown size={20} aria-hidden />
              </IconButton>
              <Switch
                tone="accent"
                checked={!entry.hidden}
                label={`Show ${s.label}`}
                onChange={(show) => void update({ layout: layout.map((e) => (e.id === entry.id ? { ...e, hidden: !show } : e)) })}
              />
            </motion.li>
          )
        })}
      </ul>
      <Button variant="ghost" block className="mt-3" disabled={isDefault} icon={<RotateCcw size={18} aria-hidden />} onClick={() => void update({ layout: DEFAULT_LAYOUT })}>
        Reset to the usual layout
      </Button>
    </Sheet>
  )
}
