import { Check, ImagePlus, Settings2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { Sheet } from '@/components/Sheet'
import { Button, Spinner } from '@/components/ui'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import { useHousehold } from '@/household/HouseholdProvider'
import type { Room } from '@/lib/domain'
import { supabase } from '@/lib/supabase'
import { RoomCoverImage } from './RoomCover'
import type { CoverImage } from './useRoomCover'

export const DESCRIPTION_MAX = 120

type Choice = CoverImage & { title: string | null; kind: string }

/** Choose a cover from the room's own Visual Home and write a short description. Shared with every flatmate. */
export function PersonaliseRoomSheet({ open, onClose, room, onEditDetails }: {
  open: boolean; onClose: () => void; room: Room; onEditDetails: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={open} onClose={onClose} title="Personalise room" busy={busy}>
      {open && <PersonaliseForm key={room.id} room={room} onDone={onClose} onBusy={setBusy} onEditDetails={onEditDetails} />}
    </Sheet>
  )
}

function PersonaliseForm({ room, onDone, onBusy, onEditDetails }: {
  room: Room; onDone: () => void; onBusy: (b: boolean) => void; onEditDetails: () => void
}) {
  const { updateRoom } = useHousehold()
  const descId = useId()
  const countId = useId()
  const [choices, setChoices] = useState<Choice[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [cover, setCover] = useState<string | null>(room.cover_visual_id)
  const [description, setDescription] = useState(room.description ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const c = roomColor(room.color)

  useEffect(() => {
    let active = true
    void supabase
      .from('room_visuals')
      .select('id,kind,title,photo_path,thumbnail_path')
      .eq('room_id', room.id)
      .not('thumbnail_path', 'is', null)
      .order('sort_order')
      .order('id')
      .limit(60)
      .then(({ data, error: e }) => {
        if (!active) return
        if (e) return setLoadError(true)
        // Photos of the actual flat first, then inspiration images.
        const rows = (data ?? []).map((v) => ({ id: v.id, kind: v.kind, title: v.title, thumb: v.thumbnail_path, photo: v.photo_path }))
        setChoices([...rows.filter((r) => r.kind === 'photo'), ...rows.filter((r) => r.kind !== 'photo')])
      })
    return () => { active = false }
  }, [room.id])

  const chosen = choices?.find((v) => v.id === cover) ?? null
  const trimmed = description.trim().replace(/\s+/g, ' ')
  const changed = cover !== room.cover_visual_id || (trimmed || null) !== (room.description ?? null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!changed) return onDone()
    setState('saving'); setError(null); onBusy(true)
    // Only what changed, so this can't undo a flatmate's edit to the other field.
    const patch: { cover_visual_id?: string | null; description?: string | null } = {}
    if (cover !== room.cover_visual_id) patch.cover_visual_id = cover
    if ((trimmed || null) !== (room.description ?? null)) patch.description = trimmed || null
    const res = await updateRoom(room.id, patch)
    onBusy(false)
    if (!res.ok) {
      setState('error')
      setError(/visual home|foreign key|violates/i.test(res.error) ? 'That photo is no longer in this room’s Visual Home. Choose another.' : res.error)
      return
    }
    setState('saved')
    window.setTimeout(onDone, 650)
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      {/* Preview: exactly how the room header will look. */}
      <div className="relative h-28 overflow-hidden rounded-[var(--radius-tile)]" style={{ backgroundColor: c.hex, color: c.on }} aria-hidden>
        {chosen ? <RoomCoverImage key={chosen.id} cover={chosen} size="full" className="absolute inset-0" /> : (
          <RoomIcon name={room.icon} strokeWidth={1.1} className="absolute -top-3 -right-3 h-28 w-28 opacity-90" />
        )}
      </div>

      <fieldset>
        <legend className="text-ink text-[14px] font-semibold">Cover photo</legend>
        <p className="text-ink-2 mt-0.5 text-[14px]">Chosen from this room’s Visual Home. Everyone in the flat sees it.</p>
        {loadError ? (
          <p role="alert" className="text-danger mt-3 text-[14px]">Couldn’t load this room’s photos. Check your connection and try again.</p>
        ) : choices === null ? (
          <div className="mt-3 flex min-h-24 items-center justify-center"><Spinner label="Loading photos" /></div>
        ) : choices.length === 0 ? (
          <div className="bg-surface-2 mt-3 rounded-2xl p-4">
            <p className="text-ink text-[15px] font-semibold">No photos of this room yet</p>
            <p className="text-ink-2 mt-0.5 text-[14px]">Add a photo or an inspiration image in Visual Home, then come back to make it the cover.</p>
            <Link to={`/rooms/${room.id}/visual`} onClick={onDone} className="pressable text-accent-ink mt-2 inline-flex min-h-11 items-center gap-2 font-bold">
              <ImagePlus size={18} aria-hidden /> Open Visual Home
            </Link>
          </div>
        ) : (
          <div role="radiogroup" aria-label="Cover photo" className="mt-3 grid grid-cols-3 gap-2">
            <CoverOption selected={cover === null} label="No cover" onSelect={() => setCover(null)}>
              <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: c.hex, color: c.on }}>
                <RoomIcon name={room.icon} strokeWidth={1.4} className="h-9 w-9" aria-hidden />
              </div>
            </CoverOption>
            {choices.map((v, i) => (
              <CoverOption key={v.id} selected={cover === v.id} label={v.title || (v.kind === 'photo' ? `Photo ${i + 1}` : `Inspiration ${i + 1}`)} onSelect={() => setCover(v.id)}>
                <RoomCoverImage cover={v} />
              </CoverOption>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={descId} className="text-ink text-[14px] font-semibold">Description</label>
        <textarea
          id={descId}
          aria-describedby={countId}
          className="field min-h-20 resize-none"
          value={description}
          maxLength={DESCRIPTION_MAX}
          placeholder="e.g. Sunny spot for slow breakfasts"
          onChange={(e) => setDescription(e.target.value.replace(/\n/g, ' '))}
        />
        <p id={countId} className="text-ink-2 text-right text-[13px] tabular-nums">{description.length}/{DESCRIPTION_MAX}</p>
      </div>

      {error && <p role="alert" className="text-danger -mt-2 text-[14px]">{error}</p>}

      <div className="flex flex-col gap-2">
        <Button type="submit" block size="lg" loading={state === 'saving'} disabled={state === 'saved'}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={state === 'saved' ? 'saved' : 'save'} className="inline-flex items-center gap-2"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
              {state === 'saved' ? <><Check size={20} strokeWidth={2.6} aria-hidden /> Saved</> : state === 'saving' ? 'Saving…' : 'Save'}
            </motion.span>
          </AnimatePresence>
        </Button>
        <span role="status" className="sr-only">{state === 'saved' ? 'Room saved' : ''}</span>
        <Button type="button" variant="ghost" block icon={<Settings2 size={18} aria-hidden />} onClick={onEditDetails} disabled={state === 'saving'}>
          Name, colour and measurements
        </Button>
      </div>
    </form>
  )
}

function CoverOption({ selected, label, onSelect, children }: { selected: boolean; label: string; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={`pressable bg-surface-2 relative aspect-square overflow-hidden rounded-2xl outline-offset-2 ${selected ? 'ring-accent ring-[3px] ring-offset-2 ring-offset-[var(--color-surface)]' : ''}`}
    >
      {children}
      {selected && (
        <span className="bg-accent text-on-accent absolute right-1.5 bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full" aria-hidden>
          <Check size={15} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}
