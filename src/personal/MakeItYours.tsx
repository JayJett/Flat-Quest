import { Check, LayoutList, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useState } from 'react'
import { Button, Field, Segmented } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { HomeLayoutSheet } from '@/living/HomeSheets'
import { SPRINGS } from '@/motion/motion'
import { usePreferences, type MotionPref } from './PreferencesProvider'
import { ACCENTS, greeting } from './themes'

const MOTION_HINT: Record<MotionPref, string> = {
  playful: 'A little bouncier, with sparkles and the odd burst of confetti for big moments.',
  balanced: 'Smooth, quick feedback with small celebrations. The default.',
  minimal: 'Short fades and slides only. No sparkles or confetti.',
}

/**
 * Personal look and feel. Everything here is saved to your account only: flatmates keep
 * their own theme, greeting and layout.
 */
export function MakeItYours() {
  const { me } = useHousehold()
  const { prefs, update, reset, motion: level } = usePreferences()
  const ids = { name: useId() }
  const [name, setName] = useState(prefs.greetingName ?? '')
  const [syncedName, setSyncedName] = useState(prefs.greetingName)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [savingName, setSavingName] = useState(false)
  if (prefs.greetingName !== syncedName) {
    setSyncedName(prefs.greetingName)
    setName(prefs.greetingName ?? '')
  }
  const first = me?.display_name?.split(' ')[0] ?? ''
  const nameDirty = (name.trim() || null) !== (prefs.greetingName ?? null)

  return (
    <section aria-labelledby="yours-h" data-testid="make-it-yours">
      <h2 id="yours-h" className="text-title font-bold">
        Make it yours
      </h2>
      <p className="text-ink-2 mt-1 text-[15px]">Only you see these. Your flatmates keep their own.</p>

      <fieldset className="mt-5">
        <legend className="mb-3 text-[15px] font-semibold">Accent colour</legend>
        <div role="radiogroup" aria-label="Accent colour" className="grid max-w-[360px] grid-cols-5 gap-1">
          {ACCENTS.map((a) => {
            const selected = prefs.accent === a.key
            return (
              <button
                key={a.key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={a.label}
                onClick={() => void update({ accent: a.key })}
                className="pressable flex min-w-0 flex-col items-center gap-1.5 py-1"
              >
                <span className="relative flex h-11 w-11 items-center justify-center rounded-full min-[380px]:h-12 min-[380px]:w-12" style={{ backgroundColor: a.fill }}>
                  {selected && (
                    <motion.span initial={{ scale: level === 'reduced' ? 1 : 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRINGS[level].pop}>
                      <Check size={22} strokeWidth={3} style={{ color: a.on }} aria-hidden />
                    </motion.span>
                  )}
                  {selected && <span className="absolute -inset-[5px] rounded-full border-2" style={{ borderColor: a.fill }} aria-hidden />}
                </span>
                <span className={`max-w-full truncate text-[12px] leading-tight ${selected ? 'font-bold' : 'text-ink-2 font-medium'}`}>{a.label}</span>
              </button>
            )
          })}
        </div>
        {/* A live sample of what changes: buttons, selected controls and highlights. */}
        <div className="bg-surface-2 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] p-4" aria-hidden>
          <span className="bg-accent text-on-accent inline-flex min-h-10 items-center rounded-xl px-4 text-[15px] font-semibold">Button</span>
          <span className="text-accent-ink text-[15px] font-bold">Link</span>
          <span className="bg-accent-soft text-accent-ink rounded-lg px-2 py-1 text-[13px] font-bold">Selected</span>
          <span className="bg-accent h-2 w-2 rounded-full" />
        </div>
      </fieldset>

      <form
        className="mt-6"
        onSubmit={async (e) => {
          e.preventDefault()
          setSavingName(true)
          await update({ greetingName: name.trim() || null })
          setSavingName(false)
        }}
      >
        <Field label="What should Home call you?" htmlFor={ids.name} hint={`Home will say “${greeting(name.trim() || first)}”. Your name on the flat stays ${me?.display_name ?? 'the same'}.`}>
          <div className="flex gap-2">
            <input id={ids.name} className="field" value={name} maxLength={30} placeholder={first || 'Your first name'} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="secondary" loading={savingName} disabled={!nameDirty} className="shrink-0">
              Save
            </Button>
          </div>
        </Field>
      </form>

      <div className="mt-6">
        <p className="mb-2 text-[15px] font-semibold">Motion</p>
        <Segmented
          label="Motion"
          value={prefs.motion}
          onChange={(m: MotionPref) => void update({ motion: m })}
          options={[
            { value: 'playful', label: 'Playful' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'minimal', label: 'Minimal' },
          ]}
        />
        <p className="text-ink-2 mt-2 text-[14px]" aria-live="polite">
          {level === 'reduced' ? 'Your device is set to reduce motion, so Flat Quest keeps animations to a minimum whatever you choose here.' : MOTION_HINT[prefs.motion]}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setLayoutOpen(true)}
        className="pressable bg-surface-2 active:bg-surface-3 mt-6 flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-card)] px-4 text-left font-semibold"
      >
        <LayoutList size={20} aria-hidden />
        <span className="flex-1">Home layout</span>
        <span className="text-ink-2 text-[14px] font-medium">{prefs.layout.filter((s) => !s.hidden).length} sections</span>
      </button>

      <Button variant="ghost" className="text-ink-2 mt-3 -ml-2" icon={<RotateCcw size={18} aria-hidden />} onClick={() => void reset(['accent', 'greetingName', 'motion', 'layout'])}>
        Reset to defaults
      </Button>
      <HomeLayoutSheet open={layoutOpen} onClose={() => setLayoutOpen(false)} />
    </section>
  )
}
