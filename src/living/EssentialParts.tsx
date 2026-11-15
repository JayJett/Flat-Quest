import { Archive, ArchiveRestore, Hand, Plus, RotateCcw, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, Field } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import type { EssentialRestockRow, EssentialRow } from '@/lib/database.types'
import { eventTime } from '@/lib/events'
import { supabase } from '@/lib/supabase'
import { useCelebration } from '@/motion/Celebration'
import { rowMotion, SPRINGS } from '@/motion/motion'
import { TickButton } from '@/motion/TickButton'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { ESSENTIAL_CATEGORIES, essentialSuggestions, isActiveEssential, matchEssential, type EssentialCategory } from './living'
import { useLiving } from './LivingProvider'

/** Shared restock flow: tick, friendly confirmation with Undo, and a burst when the list is cleared. */
export function useRestock() {
  const { actOnEssential, essentials } = useLiving()
  const toast = useToast()
  const celebration = useCelebration()
  return async (e: EssentialRow, el?: HTMLElement): Promise<boolean> => {
    const othersActive = essentials.filter((x) => x.id !== e.id && isActiveEssential(x)).length
    const res = await actOnEssential(e.id, 'restock')
    if (!res.ok) {
      toast.error(res.error)
      return false
    }
    toast.show(`${e.name} restocked`, 'success', {
      label: 'Undo',
      run: () => {
        void actOnEssential(e.id, 'undo_restock').then((r) => {
          if (!r.ok) toast.error(r.error)
        })
      },
    })
    // Everything the flat needed is now stocked: that's worth a small moment.
    if (othersActive === 0) celebration.burst(el ?? null)
    return true
  }
}

export function EssentialItem({ essential, onOpen }: { essential: EssentialRow; onOpen: (e: EssentialRow) => void }) {
  const { user } = useAuth()
  const { memberById } = useHousehold()
  const { actOnEssential } = useLiving()
  const toast = useToast()
  const level = useMotionLevel()
  const restock = useRestock()
  const me = user?.id
  const claimer = essential.claimed_by ? memberById.get(essential.claimed_by) : undefined
  const stocked = essential.status === 'stocked'
  const [working, setWorking] = useState(false)

  const act = async (action: 'claim' | 'release' | 'need') => {
    setWorking(true)
    const res = await actOnEssential(essential.id, action)
    setWorking(false)
    if (!res.ok) toast.error(res.error)
    else if (action === 'need') toast.show(`${essential.name} is on the list again`)
  }

  const meta = stocked
    ? essential.restocked_at
      ? `Restocked ${eventTime(essential.restocked_at).toLowerCase()}`
      : 'Stocked'
    : essential.status === 'getting'
      ? essential.claimed_by === me
        ? 'You’re getting it'
        : `${claimer?.profile.display_name ?? 'A flatmate'}’s getting it`
      : essential.note || 'Needed'

  return (
    <motion.li layout={level !== 'reduced'} {...rowMotion(level)} transition={SPRINGS[level].settle} data-testid="essential-row" data-status={essential.status}>
      <div className="flex min-h-[64px] items-center gap-3 py-1.5">
        {!stocked && (
          <TickButton checked={false} label={`Mark ${essential.name} as restocked`} onToggle={(_, el) => restock(essential, el)} />
        )}
        <button type="button" onClick={() => onOpen(essential)} className="pressable -my-1 min-w-0 flex-1 rounded-xl py-1 text-left">
          <span className={`block truncate text-[17px] font-semibold ${stocked ? 'text-ink-2' : ''}`}>{essential.name}</span>
          <span className="text-ink-2 flex items-center gap-1.5 truncate text-[14px]">
            {essential.status === 'getting' && claimer && <Avatar profile={claimer.profile} size={18} decorative />}
            <span className="truncate">{meta}</span>
            {stocked && essential.note ? <span className="truncate">· {essential.note}</span> : null}
          </span>
        </button>
        {stocked ? (
          <Button variant="secondary" size="sm" loading={working} icon={<RotateCcw size={16} aria-hidden />} onClick={() => void act('need')} aria-label={`Need ${essential.name} again`}>
            Need again
          </Button>
        ) : essential.status === 'needed' ? (
          <Button variant="secondary" size="sm" loading={working} icon={<Hand size={16} aria-hidden />} onClick={() => void act('claim')} aria-label={`I’ll get ${essential.name}`}>
            I’ll get it
          </Button>
        ) : essential.claimed_by === me ? (
          <Button variant="ghost" size="sm" loading={working} onClick={() => void act('release')} aria-label={`Let someone else get ${essential.name}`}>
            Let go
          </Button>
        ) : null}
      </div>
    </motion.li>
  )
}

/**
 * The fast path: type a few letters, pick a suggestion or press Enter. Recognises things the
 * flat already tracks and brings them back ("Need again") instead of creating a duplicate.
 */
export function EssentialQuickAdd({ autoFocus, onAdded }: { autoFocus?: boolean; onAdded?: () => void }) {
  const { essentials, addEssential } = useLiving()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestions = useMemo(() => essentialSuggestions(text, essentials, text ? 5 : 8), [text, essentials])
  const match = matchEssential(text, essentials)

  const add = async (name: string, category?: EssentialCategory | null) => {
    if (busy || !name.trim()) return
    setBusy(true)
    const res = await addEssential(name, { category })
    setBusy(false)
    if (!res.ok) return toast.error(res.error)
    const { essential, reused } = res.data
    if (reused === 'already-on-list') toast.show(`${essential.name} is already on the list`)
    else toast.success(reused === 'needed-again' ? `${essential.name} is on the list again` : `Added ${essential.name}`)
    setText('')
    inputRef.current?.focus()
    onAdded?.()
  }

  return (
    <div data-testid="essential-quick-add">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void add(text)
        }}
      >
        <input
          ref={inputRef}
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What are we out of?"
          aria-label="Add an essential"
          aria-describedby={match.kind !== 'none' ? `${listId}-match` : undefined}
          maxLength={60}
          autoFocus={autoFocus}
          enterKeyHint="done"
          autoComplete="off"
        />
        <Button type="submit" loading={busy} disabled={!text.trim()} className="shrink-0" aria-label="Add essential" icon={<Plus size={20} aria-hidden />}>
          Add
        </Button>
      </form>
      {match.kind !== 'none' && (
        <p id={`${listId}-match`} className="text-ink-2 mt-2 text-[13px]" role="status">
          {match.kind === 'active'
            ? `${match.essential.name} is already on the list.`
            : `You’ve had ${match.essential.name} before — adding it marks it as needed again.`}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label={text ? 'Suggestions' : 'Common essentials'}>
          <AnimatePresence initial={false}>
            {suggestions.map((s) => (
              <motion.li key={s.name} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.16 }}>
                <button
                  type="button"
                  onClick={() => void add(s.name, s.category)}
                  className="pressable bg-surface-2 active:bg-surface-3 inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold whitespace-nowrap"
                >
                  {s.existing ? <RotateCcw size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                  {s.name}
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

export function EssentialSheet({ essential, onClose }: { essential: EssentialRow | null; onClose: () => void }) {
  return (
    <Sheet open={essential !== null} onClose={onClose} title="Essential">
      {essential && <EssentialDetails key={essential.id} id={essential.id} onClose={onClose} />}
    </Sheet>
  )
}

function EssentialDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth()
  const { members, memberById } = useHousehold()
  const { essentials, actOnEssential, editEssential } = useLiving()
  const toast = useToast()
  const restock = useRestock()
  const e = essentials.find((x) => x.id === id)
  const ids = { name: useId(), cat: useId(), note: useId(), to: useId() }
  const [name, setName] = useState(e?.name ?? '')
  const [category, setCategory] = useState<EssentialCategory | ''>(e?.category ?? '')
  const [note, setNote] = useState(e?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [history, setHistory] = useState<EssentialRestockRow[] | null>(null)

  useEffect(() => {
    let active = true
    void supabase
      .from('essential_restocks')
      .select('*')
      .eq('essential_id', id)
      .order('id', { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (active) setHistory(data ?? [])
      })
    return () => {
      active = false
    }
  }, [id, e?.restocked_at])

  if (!e) {
    return <p className="text-ink-2 py-6">This essential is no longer on the list.</p>
  }
  const me = user?.id
  const claimer = e.claimed_by ? memberById.get(e.claimed_by) : undefined
  const dirty = name.trim() !== e.name || (category || null) !== e.category || (note.trim() || null) !== (e.note ?? null)

  const run = async (action: 'claim' | 'release' | 'takeover' | 'need' | 'handover', to?: string) => {
    setWorking(action)
    const res = await actOnEssential(e.id, action, { to })
    setWorking(null)
    if (!res.ok) toast.error(res.error)
    else if (action === 'handover') toast.success(`Asked ${memberById.get(to!)?.profile.display_name ?? 'them'} to get it`)
  }

  const save = async () => {
    setSaving(true)
    const res = await editEssential(e.id, { name: name.trim(), category: category || null, note: note.trim() || null })
    setSaving(false)
    if (!res.ok) return toast.error(res.error)
    toast.success('Saved')
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Status" className="bg-surface-2 rounded-[var(--radius-card)] p-4">
        <p className="text-[17px] font-bold">
          {e.archived_at ? 'Archived' : e.status === 'stocked' ? 'Stocked' : e.status === 'getting' ? `${e.claimed_by === me ? 'You’re' : `${claimer?.profile.display_name ?? 'A flatmate'}’s`} getting it` : 'Needed'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {e.archived_at || e.status === 'stocked' ? (
            <Button size="sm" loading={working === 'need'} icon={<RotateCcw size={16} aria-hidden />} onClick={() => void run('need')}>
              {e.archived_at ? 'Restore and mark needed' : 'Need again'}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ink" icon={<Sparkles size={16} aria-hidden />} onClick={() => void restock(e).then((ok) => ok && onClose())}>
                Restocked
              </Button>
              {e.status === 'needed' && (
                <Button size="sm" variant="secondary" loading={working === 'claim'} onClick={() => void run('claim')}>
                  I’ll get it
                </Button>
              )}
              {e.status === 'getting' && e.claimed_by === me && (
                <Button size="sm" variant="secondary" loading={working === 'release'} onClick={() => void run('release')}>
                  Let it go
                </Button>
              )}
              {e.status === 'getting' && e.claimed_by !== me && (
                <Button size="sm" variant="secondary" loading={working === 'takeover'} onClick={() => void run('takeover')}>
                  I’ll get it instead
                </Button>
              )}
            </>
          )}
        </div>
        {e.status === 'getting' && e.claimed_by === me && members.length > 1 && (
          <label htmlFor={ids.to} className="mt-3 block text-[14px] font-semibold">
            Hand it to
            <select
              id={ids.to}
              className="field mt-1 appearance-none"
              value=""
              onChange={(ev) => ev.target.value && void run('handover', ev.target.value)}
              disabled={working !== null}
            >
              <option value="">Choose a flatmate…</option>
              {members
                .filter((m) => m.userId !== me)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.profile.display_name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </section>

      <Field label="Name" htmlFor={ids.name}>
        <input id={ids.name} className="field font-semibold" value={name} maxLength={60} onChange={(ev) => setName(ev.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" htmlFor={ids.cat}>
          <select id={ids.cat} className="field appearance-none" value={category} onChange={(ev) => setCategory(ev.target.value as EssentialCategory | '')}>
            <option value="">None</option>
            {ESSENTIAL_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note" htmlFor={ids.note} hint="Brand, size, how many">
          <input id={ids.note} className="field" value={note} maxLength={120} placeholder="Optional" onChange={(ev) => setNote(ev.target.value)} />
        </Field>
      </div>
      {dirty && (
        <Button loading={saving} disabled={!name.trim()} onClick={() => void save()} className="self-start">
          Save changes
        </Button>
      )}

      <section aria-label="Restock history">
        <h3 className="text-[15px] font-bold">Recently restocked</h3>
        {history === null ? (
          <p className="text-ink-2 mt-1 text-[14px]">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-ink-2 mt-1 text-[14px]">Not restocked yet.</p>
        ) : (
          <ul className="mt-1">
            {history.map((h) => (
              <li key={h.id} className="text-ink-2 flex min-h-9 items-center justify-between text-[14px]">
                <span>{(h.restocked_by ? memberById.get(h.restocked_by)?.profile.display_name : null) ?? h.restocked_by_name ?? 'A flatmate'}</span>
                <time dateTime={h.restocked_at}>{eventTime(h.restocked_at)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!e.archived_at ? (
        <Button variant="ghost" block className="text-ink-2" icon={<Archive size={18} aria-hidden />} onClick={() => setArchiving(true)}>
          Archive (we don’t buy this any more)
        </Button>
      ) : (
        <Button variant="ghost" block icon={<ArchiveRestore size={18} aria-hidden />} onClick={() => void run('need')}>
          Restore
        </Button>
      )}
      <ConfirmSheet
        open={archiving}
        title={`Archive ${e.name}?`}
        body="It leaves the list for everyone. Its history is kept, and typing its name again brings it back."
        confirmLabel="Archive"
        onConfirm={async () => {
          const res = await editEssential(e.id, { archived_at: new Date().toISOString() })
          setArchiving(false)
          if (!res.ok) return toast.error(res.error)
          toast.show(`${e.name} archived`)
          onClose()
        }}
        onClose={() => setArchiving(false)}
      />
    </div>
  )
}
