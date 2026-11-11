import { Check, ExternalLink, ImagePlus, Pencil, Ruler, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { RoomSheet } from '@/components/RoomSheet'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, Field, Spinner } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { formatDay } from '@/lib/dates'
import type { Item, Member } from '@/lib/domain'
import { prepareProductPhoto } from '@/lib/image'
import {
  dimensionsLabel,
  FIT_CAVEAT,
  fitGuidance,
  formatCm,
  formatPrice,
  parseCm,
  parsePrice,
  roomMeasurementsLabel,
  type ProductOption,
} from '@/lib/shopping'
import { hostLabel, normaliseWebUrl } from '@/lib/urls'
import { OptionPhoto, PreferButton, preferredByLabel } from './OptionCard'
import { useShopping, type OptionInput } from './ShoppingProvider'

function suggestedBy(option: ProductOption, memberById: Map<string, Member>, myId?: string): string {
  // Local calendar day of the timestamp (en-CA formats as YYYY-MM-DD).
  const when = formatDay(new Date(option.created_at).toLocaleDateString('en-CA'))
  const who =
    option.created_by === myId
      ? 'Added by you'
      : option.created_by && memberById.get(option.created_by)
        ? `Added by ${memberById.get(option.created_by)!.profile.display_name}`
        : 'Added by a past flatmate'
  return when ? `${who} · ${when}` : who
}

// ---------------------------------------------------------------- option details
export function OptionSheet({ open, optionId, item, onClose }: { open: boolean; optionId: string | null; item: Item; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={open} onClose={onClose} title="Option" busy={busy}>
      {open && optionId && <OptionDetails key={optionId} optionId={optionId} item={item} onClose={onClose} onBusy={setBusy} />}
    </Sheet>
  )
}

function OptionDetails({ optionId, item, onClose, onBusy }: { optionId: string; item: Item; onClose: () => void; onBusy: (b: boolean) => void }) {
  const { user } = useAuth()
  const { rooms, memberById } = useHousehold()
  const { optionById, preferencesByItem, setPreference, chooseOption, deleteOption } = useShopping()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  // Read the live option so prices, preferences and the pick update while this is open.
  const option = optionById.get(optionId)
  const room = rooms.find((r) => r.id === item.room_id)

  if (!option) {
    return (
      <div className="py-6">
        <p className="font-semibold">This option was removed.</p>
        <p className="text-ink-2 mt-1 text-[15px]">A flatmate deleted it while you were looking.</p>
        <Button variant="secondary" className="mt-5" onClick={onClose}>
          Back to options
        </Button>
      </div>
    )
  }

  const prefs = preferencesByItem.get(item.id) ?? []
  const voters = prefs
    .filter((p) => p.option_id === option.id)
    .map((p) => memberById.get(p.user_id))
    .filter((m): m is Member => Boolean(m))
  const mine = voters.some((m) => m.userId === user?.id)
  const dims = dimensionsLabel(option)
  const fit = room ? fitGuidance(option, room) : null
  const roomSize = room ? roomMeasurementsLabel(room) : ''
  const price = formatPrice(option.price)
  const chosenBy = option.selected_by ? (option.selected_by === user?.id ? 'you' : memberById.get(option.selected_by)?.profile.display_name) : null

  const prefer = async () => {
    const res = await setPreference(item.id, mine ? null : option.id)
    if (!res.ok) toast.error(res.error)
  }

  const choose = async (next: boolean) => {
    setChoosing(true)
    const res = await chooseOption(item.id, next ? option.id : null)
    setChoosing(false)
    if (!res.ok) return toast.error(res.error)
    if (next) toast.success(`“${option.name}” is our pick`)
  }

  const remove = async () => {
    setDeleting(true)
    onBusy(true)
    const res = await deleteOption(option.id)
    setDeleting(false)
    onBusy(false)
    setConfirmDelete(false)
    if (!res.ok) return toast.error(res.error)
    toast.show('Option removed')
    onClose()
  }

  return (
    <div className="flex flex-col gap-5 pt-1">
      {option.photo_path && <OptionPhoto option={option} room={room} className="aspect-[4/3] w-full rounded-[var(--radius-card)]" />}

      <div>
        <h3 className="text-[22px] leading-tight font-extrabold tracking-[-0.015em] [overflow-wrap:anywhere]">{option.name}</h3>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className={`text-[26px] leading-none font-extrabold tabular-nums ${price ? '' : 'text-ink-3'}`}>{price || 'No price yet'}</span>
          {option.retailer && <span className="text-ink-2 text-[16px] font-medium">{option.retailer}</span>}
        </p>
        <p className="text-ink-2 mt-1.5 text-[14px]">For {item.name} · {suggestedBy(option, memberById, user?.id)}</p>
      </div>

      {option.url && (
        <a
          href={option.url}
          target="_blank"
          rel="noopener noreferrer"
          className="pressable bg-surface-2 active:bg-surface-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold"
        >
          <ExternalLink size={18} aria-hidden />
          <span className="truncate">View at {option.retailer || hostLabel(option.url) || 'the shop'}</span>
        </a>
      )}

      {(dims || option.notes) && (
        <div className="flex flex-col gap-3">
          {dims && (
            <p className="flex items-center gap-2 font-semibold">
              <Ruler size={18} className="text-ink-2 shrink-0" aria-hidden />
              {dims}
            </p>
          )}
          {option.notes && <p className="text-[15px] whitespace-pre-wrap [overflow-wrap:anywhere]">{option.notes}</p>}
        </div>
      )}

      {dims && room && (
        <section aria-label="Will it fit?" className="bg-surface-2 rounded-[var(--radius-card)] p-4">
          <p className="text-[14px] font-bold">Rough fit in {room.name}</p>
          {fit ? (
            <>
              <p className={`mt-1 text-[15px] font-semibold ${fit.verdict === 'no' ? 'text-orange-ink' : fit.verdict === 'ok' ? 'text-green-ink' : 'text-ink'}`}>
                {fit.text}
              </p>
              <p className="text-ink-2 mt-1.5 text-[14px]">{FIT_CAVEAT}</p>
            </>
          ) : (
            <p className="text-ink-2 mt-1 text-[15px]">
              {roomSize
                ? `${room.name} is ${roomSize}. Add this product’s width and depth to compare.`
                : `Add ${room.name}’s measurements to see a rough comparison.`}
            </p>
          )}
          <button type="button" onClick={() => setMeasuring(true)} className="text-accent mt-1 min-h-11 text-[15px] font-bold">
            {roomSize ? `Room: ${roomSize}. Edit` : 'Add room measurements'}
          </button>
        </section>
      )}

      <section aria-label="Preferences" className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">{voters.length === 0 ? 'No preferences yet' : preferredByLabel(voters, user?.id)}</p>
          {voters.length > 0 ? (
            <span className="mt-1.5 flex gap-1.5">
              {voters.map((m) => (
                <Avatar key={m.userId} profile={m.profile} size={28} decorative />
              ))}
            </span>
          ) : (
            <p className="text-ink-2 text-[14px]">One preference each per item. It isn’t a decision.</p>
          )}
        </div>
        <PreferButton active={mine} count={voters.length} name={option.name} onToggle={() => void prefer()} large />
      </section>

      {option.is_selected ? (
        <section aria-label="Decision" className="bg-green-soft flex items-center justify-between gap-3 rounded-[var(--radius-card)] py-2 pr-2 pl-4">
          <p className="text-green-ink flex min-w-0 items-center gap-2 font-bold">
            <Check size={18} strokeWidth={2.8} className="shrink-0" aria-hidden />
            <span>Our pick{chosenBy ? `, chosen by ${chosenBy}` : ''}</span>
          </p>
          <Button type="button" variant="ghost" size="sm" loading={choosing} onClick={() => void choose(false)}>
            Undo
          </Button>
        </section>
      ) : (
        <Button type="button" variant="ink" size="lg" block loading={choosing} onClick={() => void choose(true)}>
          Choose this one
        </Button>
      )}

      <div className="-mt-2 grid grid-cols-2 gap-2">
        <Button type="button" variant="ghost" icon={<Pencil size={18} aria-hidden />} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button type="button" variant="ghost" className="text-danger" icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirmDelete(true)}>
          Remove
        </Button>
      </div>

      <OptionFormSheet open={editing} item={item} option={option} onClose={() => setEditing(false)} />
      {room && <RoomSheet open={measuring} room={room} onClose={() => setMeasuring(false)} />}
      <ConfirmSheet
        open={confirmDelete}
        title="Remove this option?"
        body={`“${option.name}” and any preferences for it will be removed for everyone. ${item.name} stays on the checklist.`}
        confirmLabel="Remove option"
        danger
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}

// ---------------------------------------------------------------- add / edit an option
export function OptionFormSheet({ open, item, option, onClose }: { open: boolean; item: Item; option: ProductOption | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={open} onClose={onClose} title={option ? 'Edit option' : 'Add an option'} busy={busy}>
      {open && <OptionForm key={option?.id ?? 'new'} item={item} option={option} onDone={onClose} onBusy={setBusy} />}
    </Sheet>
  )
}

function OptionForm({ item, option, onDone, onBusy }: { item: Item; option: ProductOption | null; onDone: () => void; onBusy: (b: boolean) => void }) {
  const { addOption, updateOption, uploadPhoto, removeFiles } = useShopping()
  const toast = useToast()
  const ids = { name: useId(), retailer: useId(), price: useId(), url: useId(), w: useId(), d: useId(), h: useId(), notes: useId() }
  const fileRef = useRef<HTMLInputElement>(null)
  // The version this form was opened with: a save is refused if a flatmate saved in between.
  const [opened] = useState(option)
  const [name, setName] = useState(option?.name ?? '')
  const [retailer, setRetailer] = useState(option?.retailer ?? '')
  const [price, setPrice] = useState(option?.price != null ? String(option.price) : '')
  const [url, setUrl] = useState(option?.url ?? '')
  const [w, setW] = useState(option?.width_cm != null ? formatCm(option.width_cm) : '')
  const [d, setD] = useState(option?.depth_cm != null ? formatCm(option.depth_cm) : '')
  const [h, setH] = useState(option?.height_cm != null ? formatCm(option.height_cm) : '')
  const [notes, setNotes] = useState(option?.notes ?? '')
  const [photo, setPhoto] = useState<{ blob: Blob; ext: 'webp' | 'jpg'; preview: string } | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  /** A photo already uploaded by a failed save, reused by the retry so nothing is uploaded twice. */
  const uploaded = useRef<{ blob: Blob; path: string } | null>(null)
  const saved = useRef(false)

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.preview)
    },
    [photo],
  )
  // Closing without saving must not leave an uploaded file behind.
  useEffect(
    () => () => {
      if (uploaded.current && !saved.current) void removeFiles([uploaded.current.path])
    },
    [removeFiles],
  )

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setPreparing(true)
    try {
      const { blob, ext } = await prepareProductPhoto(f)
      setPhoto({ blob, ext, preview: URL.createObjectURL(blob) })
      setRemovePhoto(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPreparing(false)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    const errs: Record<string, string> = {}
    const n = name.trim()
    if (!n) errs.name = 'Give the product a name.'
    const p = parsePrice(price)
    if (p === 'invalid') errs.price = 'Enter an amount, like 899 or 49.95.'
    const u = normaliseWebUrl(url)
    if (u === 'invalid') errs.url = 'That doesn’t look like a web link.'
    const cm = { w: parseCm(w), d: parseCm(d), h: parseCm(h) }
    for (const k of ['w', 'd', 'h'] as const) if (cm[k] === 'invalid') errs[k] = 'Centimetres, between 0.1 and 2000.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setSaving(true)
    onBusy(true)
    const fail = (message: string) => {
      setSaving(false)
      onBusy(false)
      toast.error(message)
    }

    let photoPatch: { photo_path?: string | null } = {}
    if (photo) {
      if (uploaded.current?.blob !== photo.blob) {
        if (uploaded.current) void removeFiles([uploaded.current.path])
        uploaded.current = null
        const up = await uploadPhoto(item.id, photo.blob, photo.ext)
        if (!up.ok) return fail(up.error)
        uploaded.current = { blob: photo.blob, path: up.data }
      }
      photoPatch = { photo_path: uploaded.current!.path }
    } else if (removePhoto && opened?.photo_path) photoPatch = { photo_path: null }

    const fields: OptionInput = {
      name: n.slice(0, 120),
      retailer: retailer.trim().slice(0, 60) || null,
      price: p as number | null,
      url: u as string | null,
      width_cm: cm.w as number | null,
      depth_cm: cm.d as number | null,
      height_cm: cm.h as number | null,
      notes: notes.trim() || null,
      ...photoPatch,
    }

    if (!opened) {
      const res = await addOption(item.id, fields)
      if (!res.ok) return fail(res.error)
    } else {
      // Send only what changed, so untouched fields can't overwrite a flatmate's edit.
      const patch = Object.fromEntries(Object.entries(fields).filter(([k, v]) => opened[k as keyof ProductOption] !== v)) as Partial<OptionInput>
      if (Object.keys(patch).length > 0) {
        const res = await updateOption(opened.id, patch, opened.updated_at)
        if (!res.ok) return fail(res.error)
      }
      if (opened.photo_path && 'photo_path' in photoPatch && opened.photo_path !== photoPatch.photo_path) void removeFiles([opened.photo_path])
    }
    saved.current = true
    setSaving(false)
    onBusy(false)
    toast.success(opened ? 'Saved' : 'Option added')
    onDone()
  }

  const hasPhoto = Boolean(photo) || Boolean(opened?.photo_path && !removePhoto)

  return (
    <form onSubmit={save} className="flex flex-col gap-5 pt-2" noValidate>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={hasPhoto ? 'Replace product photo' : 'Add a product photo'}
          className="pressable bg-surface-2 text-ink-2 relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)]"
        >
          {preparing ? (
            <Spinner label="Preparing photo" />
          ) : photo ? (
            <img src={photo.preview} alt="" className="h-full w-full object-cover" />
          ) : opened?.photo_path && !removePhoto ? (
            <OptionPhoto option={opened} className="h-full w-full" />
          ) : (
            <ImagePlus size={26} aria-hidden />
          )}
        </button>
        <div className="min-w-0">
          <p className="font-semibold">Product photo</p>
          <p className="text-ink-2 text-[14px]">Optional. A screenshot from the shop’s page works well.</p>
          <div className="mt-1 flex gap-4">
            <button type="button" onClick={() => fileRef.current?.click()} className="text-accent min-h-11 text-[15px] font-bold">
              {hasPhoto ? 'Replace' : 'Choose photo'}
            </button>
            {hasPhoto && (
              <button
                type="button"
                onClick={() => {
                  setPhoto(null)
                  setRemovePhoto(true)
                }}
                className="text-ink-2 inline-flex min-h-11 items-center gap-1 text-[15px] font-bold"
              >
                <X size={16} aria-hidden /> Remove
              </button>
            )}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pickPhoto(e)} />
      </div>

      <Field label="Product" htmlFor={ids.name} error={errors.name}>
        <input
          id={ids.name}
          className="field text-[17px] font-semibold"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jasper 3-seater sofa"
          autoComplete="off"
          aria-invalid={!!errors.name}
          data-autofocus={option ? undefined : true}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Shop" htmlFor={ids.retailer}>
          <input id={ids.retailer} className="field" value={retailer} maxLength={60} onChange={(e) => setRetailer(e.target.value)} placeholder="e.g. Mocka" autoComplete="off" />
        </Field>
        <Field label="Price (NZ$)" htmlFor={ids.price} error={errors.price}>
          <input id={ids.price} className="field tabular-nums" inputMode="decimal" placeholder="Optional" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!errors.price} />
        </Field>
      </div>

      <Field label="Link" htmlFor={ids.url} error={errors.url}>
        <input id={ids.url} className="field" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!errors.url} />
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-[14px] font-semibold">Size in centimetres</legend>
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              ['Width', ids.w, w, setW, 'w'],
              ['Depth', ids.d, d, setD, 'd'],
              ['Height', ids.h, h, setH, 'h'],
            ] as const
          ).map(([label, id, value, set, key]) => (
            <label key={key} htmlFor={id} className="flex flex-col gap-1">
              <span className="text-ink-2 text-[14px] font-medium">{label}</span>
              <input id={id} className="field tabular-nums" inputMode="decimal" placeholder="cm" value={value} onChange={(e) => set(e.target.value)} aria-invalid={!!errors[key]} aria-label={`${label} in centimetres`} />
            </label>
          ))}
        </div>
        {errors.w || errors.d || errors.h ? (
          <p className="text-danger mt-1.5 text-[14px]" role="alert">
            {errors.w ?? errors.d ?? errors.h}
          </p>
        ) : (
          <p className="text-ink-2 mt-1.5 text-[14px]">Leave blank what you don’t know.</p>
        )}
      </fieldset>

      <Field label="Notes" htmlFor={ids.notes}>
        <textarea id={ids.notes} className="field min-h-20 resize-y" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Colour, delivery cost, why you like it…" />
      </Field>

      <div className="bg-surface border-line sticky -bottom-4 z-10 -mx-5 border-t px-5 pt-3 pb-4">
        <Button type="submit" size="lg" block loading={saving} disabled={preparing}>
          {option ? 'Save changes' : 'Add option'}
        </Button>
      </div>
    </form>
  )
}
