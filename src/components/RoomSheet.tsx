import { Check, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { ROOM_ICONS, RoomIcon } from '@/design/icons'
import { ROOM_COLORS, roomColor } from '@/design/tokens'
import type { Room } from '@/lib/domain'
import { formatCm, MAX_ROOM_CM, MAX_ROOM_HEIGHT_CM, parseCm } from '@/lib/shopping'
import { useHousehold } from '@/household/HouseholdProvider'
import { ConfirmSheet, Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Field } from './ui'

export function RoomSheet({ open, onClose, room }: { open: boolean; onClose: () => void; room: Room | null }) {
  return (
    <Sheet open={open} onClose={onClose} title={room ? 'Edit room' : 'New room'}>
      {open && <RoomForm key={room?.id ?? 'new'} room={room} onDone={onClose} />}
    </Sheet>
  )
}

function RoomForm({ room, onDone }: { room: Room | null; onDone: () => void }) {
  const { createRoom, updateRoom, deleteRoom, items } = useHousehold()
  const toast = useToast()
  const navigate = useNavigate()
  const nameId = useId()
  const ids = { w: useId(), l: useId(), h: useId(), notes: useId() }
  const cmText = (v: number | null | undefined) => (v != null ? formatCm(v) : '')
  const [width, setWidth] = useState(cmText(room?.width_cm))
  const [length, setLength] = useState(cmText(room?.length_cm))
  const [height, setHeight] = useState(cmText(room?.height_cm))
  const [measureNotes, setMeasureNotes] = useState(room?.measurement_notes ?? '')
  const [measureError, setMeasureError] = useState<string | null>(null)
  const [name, setName] = useState(room?.name ?? '')
  const [icon, setIcon] = useState(room?.icon ?? 'sofa')
  const [color, setColor] = useState(room?.color ?? 'blue')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const itemCount = room ? items.filter((i) => i.room_id === room.id).length : 0
  const preview = roomColor(color)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Give the room a name.')
    if (trimmed.length > 40) return setError('Keep it under 40 characters.')
    const w = parseCm(width, MAX_ROOM_CM)
    const l = parseCm(length, MAX_ROOM_CM)
    const h = parseCm(height, MAX_ROOM_HEIGHT_CM)
    if (w === 'invalid' || l === 'invalid' || h === 'invalid') {
      return setMeasureError(`Use centimetres: up to ${MAX_ROOM_CM} for width and length, ${MAX_ROOM_HEIGHT_CM} for height.`)
    }
    setMeasureError(null)
    const measurements = { width_cm: w, length_cm: l, height_cm: h, measurement_notes: measureNotes.trim() || null }
    setSaving(true)
    let res
    if (room) {
      // Only send what changed, so an old sheet can't undo a flatmate's edit to another field.
      const next = { name: trimmed, icon, color, ...measurements }
      const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => room[k as keyof Room] !== v))
      res = Object.keys(patch).length > 0 ? await updateRoom(room.id, patch) : { ok: true as const, data: undefined }
    } else {
      res = await createRoom({ name: trimmed, icon, color, ...measurements })
    }
    setSaving(false)
    if (!res.ok) return toast.error(res.error)
    toast.success(room ? 'Room updated' : `Added ${trimmed}`)
    onDone()
  }

  const remove = async () => {
    if (!room) return
    setDeleting(true)
    const res = await deleteRoom(room.id)
    setDeleting(false)
    if (!res.ok) return toast.error(res.error)
    toast.show(`Deleted ${room.name}`)
    onDone()
    navigate('/rooms', { replace: true })
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6 pt-2" noValidate>
      <div
        className="relative flex h-28 items-end overflow-hidden rounded-[var(--radius-tile)] p-4 transition-colors duration-300"
        style={{ backgroundColor: preview.hex, color: preview.on }}
        aria-hidden
      >
        <RoomIcon name={icon} strokeWidth={1.15} className="absolute -top-2 -right-2 h-28 w-28 opacity-90" />
        <span className="relative text-[22px] font-bold">{name.trim() || 'Room name'}</span>
      </div>

      <Field label="Name" htmlFor={nameId} error={error}>
        <input
          id={nameId}
          className="field font-semibold"
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          placeholder="e.g. Study"
          aria-invalid={!!error}
          data-autofocus={room ? undefined : true}
        />
      </Field>

      <fieldset>
        <legend className="mb-2 text-[14px] font-semibold">Colour</legend>
        <div className="grid grid-cols-6 gap-2.5" role="radiogroup" aria-label="Colour">
          {ROOM_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={color === c.key}
              aria-label={c.label}
              onClick={() => setColor(c.key)}
              className="pressable flex aspect-square items-center justify-center rounded-2xl"
              style={{ backgroundColor: c.hex, color: c.on }}
            >
              {color === c.key && <Check size={20} strokeWidth={3} aria-hidden />}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[14px] font-semibold">Icon</legend>
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Icon">
          {Object.entries(ROOM_ICONS).map(([key, { icon: Icon, label }]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={icon === key}
              aria-label={label}
              title={label}
              onClick={() => setIcon(key)}
              className={`pressable flex aspect-square items-center justify-center rounded-2xl transition-colors ${icon === key ? 'bg-ink text-white' : 'bg-surface-2 text-ink'}`}
            >
              <Icon size={24} strokeWidth={1.8} aria-hidden />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-0.5 text-[14px] font-semibold">Measurements</legend>
        <p className="text-ink-2 mb-2 text-[14px]">Optional, in centimetres. Handy when comparing furniture.</p>
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              ['Width', ids.w, width, setWidth],
              ['Length', ids.l, length, setLength],
              ['Height', ids.h, height, setHeight],
            ] as const
          ).map(([label, id, value, set]) => (
            <label key={label} htmlFor={id} className="flex flex-col gap-1">
              <span className="text-ink-2 text-[14px] font-medium">{label}</span>
              <input
                id={id}
                className="field tabular-nums"
                inputMode="decimal"
                placeholder="cm"
                value={value}
                onChange={(e) => {
                  set(e.target.value)
                  setMeasureError(null)
                }}
                aria-invalid={!!measureError}
                aria-label={`Room ${label.toLowerCase()} in centimetres`}
              />
            </label>
          ))}
        </div>
        {measureError && (
          <p className="text-danger mt-1.5 text-[14px]" role="alert">
            {measureError}
          </p>
        )}
        <label htmlFor={ids.notes} className="text-ink-2 mt-3 mb-1 block text-[14px] font-medium">
          Things to watch for
        </label>
        <input
          id={ids.notes}
          className="field"
          value={measureNotes}
          maxLength={500}
          onChange={(e) => setMeasureNotes(e.target.value)}
          placeholder="e.g. Door is 76 cm wide, heater on the left wall"
        />
      </fieldset>

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" block loading={saving}>
          {room ? 'Save room' : 'Add room'}
        </Button>
        {room && (
          <Button type="button" variant="ghost" className="text-danger" block icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirm(true)}>
            Delete room
          </Button>
        )}
      </div>

      <ConfirmSheet
        open={confirm}
        title={`Delete ${room?.name ?? 'room'}?`}
        body={
          itemCount > 0
            ? `This also deletes its ${itemCount} item${itemCount === 1 ? '' : 's'} for everyone. Move items you want to keep to another room first.`
            : 'This room is empty. It will be removed for everyone.'
        }
        confirmLabel="Delete room"
        danger
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      />
    </form>
  )
}
