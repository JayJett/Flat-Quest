import { ArrowRight, Check, ImagePlus, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar, useSignedUrl } from '@/components/Avatar'
import { Switch } from '@/components/ItemSheet'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, Field } from '@/components/ui'
import { prepareImage, validateAvatarFile } from '@/lib/image'
import { useHousehold } from '@/household/HouseholdProvider'
import { suggestedBy, VoteButton } from './IdeaCard'
import { useWishlist, type Idea } from './WishlistProvider'

function parseMoney(v: string): number | null | 'invalid' {
  const t = v.trim().replace(/^\$/, '').replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) return 'invalid'
  return Math.round(n * 100) / 100
}

function normaliseUrl(v: string): string | null | 'invalid' {
  const t = v.trim()
  if (t === '') return null
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
    return u.hostname.includes('.') ? u.toString() : 'invalid'
  } catch {
    return 'invalid'
  }
}

export function IdeaSheet({ open, idea, onClose }: { open: boolean; idea: Idea | null; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={idea ? 'Idea' : 'Add an idea'}>
      {open && <IdeaForm key={idea?.id ?? 'new'} ideaId={idea?.id ?? null} onDone={onClose} />}
    </Sheet>
  )
}

function IdeaForm({ ideaId, onDone }: { ideaId: string | null; onDone: () => void }) {
  const { user } = useAuth()
  const { rooms, memberById } = useHousehold()
  const { ideas, addIdea, updateIdea, deleteIdea, addToChecklist, uploadPhoto, removeFile } = useWishlist()
  const toast = useToast()
  const navigate = useNavigate()
  // Read the live idea so votes / chosen state update while the sheet is open.
  const idea = ideaId ? (ideas.find((i) => i.id === ideaId) ?? null) : null
  const ids = { title: useId(), room: useId(), price: useId(), url: useId(), notes: useId() }
  const fileRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState(idea?.title ?? '')
  const [roomId, setRoomId] = useState(idea?.room_id ?? '')
  const [price, setPrice] = useState(idea?.estimated_price != null ? String(idea.estimated_price) : '')
  const [url, setUrl] = useState(idea?.shopping_url ?? '')
  const [notes, setNotes] = useState(idea?.notes ?? '')
  const [photo, setPhoto] = useState<{ blob: Blob; ext: 'webp' | 'jpg'; preview: string } | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const existingPhoto = useSignedUrl('household-media', removePhoto ? null : idea?.photo_path)
  const shownPhoto = photo?.preview ?? existingPhoto

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.preview)
  }, [photo])

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const invalid = validateAvatarFile(f)
    if (invalid) return toast.error(invalid)
    try {
      const { blob, ext } = await prepareImage(f)
      setPhoto({ blob, ext, preview: URL.createObjectURL(blob) })
      setRemovePhoto(false)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    const t = title.trim()
    if (!t) errs.title = 'Give your idea a name.'
    const p = parseMoney(price)
    if (p === 'invalid') errs.price = 'Enter a number, like 120.'
    const u = normaliseUrl(url)
    if (u === 'invalid') errs.url = 'That doesn’t look like a web link.'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setSaving(true)
    const fields = {
      title: t.slice(0, 80),
      room_id: roomId || null,
      estimated_price: p as number | null,
      shopping_url: u as string | null,
      notes: notes.trim() || null,
    }
    let id = idea?.id
    if (!id) {
      const res = await addIdea(fields)
      if (!res.ok) {
        setSaving(false)
        return toast.error(res.error)
      }
      id = res.data.id
    }
    let photoPatch: { photo_path?: string | null } = {}
    let uploaded: string | null = null
    if (photo) {
      const up = await uploadPhoto(id, photo.blob, photo.ext)
      if (!up.ok) {
        setSaving(false)
        return toast.error(up.error)
      }
      uploaded = up.data
      photoPatch = { photo_path: up.data }
    } else if (removePhoto) photoPatch = { photo_path: null }

    const needsUpdate = idea || Object.keys(photoPatch).length > 0
    if (needsUpdate) {
      const res = await updateIdea(id, { ...(idea ? fields : {}), ...photoPatch })
      if (!res.ok) {
        if (uploaded) void removeFile(uploaded)
        setSaving(false)
        return toast.error(res.error)
      }
      if (idea?.photo_path && 'photo_path' in photoPatch && idea.photo_path !== photoPatch.photo_path) void removeFile(idea.photo_path)
    }
    setSaving(false)
    toast.success(idea ? 'Saved' : 'Idea added')
    onDone()
  }

  const toggleChosen = async (next: boolean) => {
    if (!idea) return
    const res = await updateIdea(idea.id, { is_chosen: next })
    if (!res.ok) toast.error(res.error)
  }

  const convert = async () => {
    if (!idea) return
    const target = roomId || idea.room_id
    if (!target) return setErrors({ room: 'Choose a room for it first.' })
    setConverting(true)
    const res = await addToChecklist(idea.id, target)
    setConverting(false)
    if (!res.ok) return toast.error(res.error)
    toast.success('Added to the checklist')
  }

  const linkedRoom = rooms.find((r) => r.id === (idea?.room_id ?? roomId))
  const voters = (idea?.voters ?? []).map((v) => memberById.get(v)).filter(Boolean)

  return (
    <form onSubmit={save} className="flex flex-col gap-6 pt-2" noValidate>
      {/* Photo */}
      <div>
        {shownPhoto ? (
          <div className="bg-surface-2 relative aspect-[16/10] overflow-hidden rounded-[var(--radius-card)]">
            <img src={shownPhoto} alt="Inspiration photo" className="h-full w-full object-cover" />
            <div className="absolute right-3 bottom-3 flex gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="pressable bg-surface min-h-10 rounded-xl px-3 text-[14px] font-semibold">
                Replace
              </button>
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => {
                  setPhoto(null)
                  setRemovePhoto(true)
                }}
                className="pressable bg-surface flex h-10 w-10 items-center justify-center rounded-xl"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="pressable bg-surface-2 text-ink-2 flex min-h-20 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] font-semibold"
          >
            <ImagePlus size={20} aria-hidden /> Add an inspiration photo
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => void pickPhoto(e)} />
      </div>

      <Field label="Idea" htmlFor={ids.title} error={errors.title}>
        <input
          id={ids.title}
          className="field text-[17px] font-semibold"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Big indoor plant"
          aria-invalid={!!errors.title}
          data-autofocus={idea ? undefined : true}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Room" htmlFor={ids.room} error={errors.room}>
          <select id={ids.room} className="field appearance-none" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">No room yet</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price (NZ$)" htmlFor={ids.price} error={errors.price}>
          <input id={ids.price} className="field tabular-nums" inputMode="decimal" placeholder="Optional" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!errors.price} />
        </Field>
      </div>

      <Field label="Link" htmlFor={ids.url} error={errors.url}>
        <input id={ids.url} className="field" type="url" inputMode="url" autoCapitalize="off" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!errors.url} />
      </Field>

      <Field label="Notes" htmlFor={ids.notes}>
        <textarea id={ids.notes} className="field min-h-20 resize-y" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Why you love it, size, colour…" />
      </Field>

      {idea && (
        <>
          <section aria-label="Votes" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold">Votes</p>
                <p className="text-ink-2 text-[14px]">{suggestedBy(idea, memberById, user?.id)}</p>
              </div>
              <VoteButton idea={idea} large />
            </div>
            {voters.length > 0 ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {voters.map((m) => (
                  <li key={m!.userId} className="flex items-center gap-2 text-[15px] font-medium">
                    <Avatar profile={m!.profile} size={28} decorative />
                    {m!.userId === user?.id ? 'You' : m!.profile.display_name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-2 text-[15px]">No votes yet. A vote just means you like it.</p>
            )}
          </section>

          <section aria-label="Decision" className="bg-surface-2 flex flex-col gap-4 rounded-[var(--radius-card)] p-4">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block font-semibold">Chosen</span>
                <span className="text-ink-2 block text-[14px]">Tick once everyone agrees</span>
              </span>
              <Switch checked={idea.is_chosen} onChange={(v) => void toggleChosen(v)} label="Chosen" />
            </label>
            {idea.checklist_item_id ? (
              <button
                type="button"
                onClick={() => {
                  onDone()
                  if (idea.room_id) navigate(`/rooms/${idea.room_id}`)
                }}
                className="text-green-ink flex min-h-11 items-center gap-2 text-left font-semibold"
              >
                <Check size={18} strokeWidth={2.6} aria-hidden />
                On the checklist{linkedRoom ? ` in ${linkedRoom.name}` : ''}
                <ArrowRight size={16} aria-hidden />
              </button>
            ) : idea.is_chosen ? (
              <Button type="button" variant="ink" loading={converting} onClick={() => void convert()}>
                Add to the checklist
              </Button>
            ) : null}
          </section>
        </>
      )}

      <div className="bg-surface border-line sticky -bottom-4 z-10 -mx-5 flex flex-col gap-1 border-t px-5 pt-3 pb-4">
        <Button type="submit" size="lg" block loading={saving}>
          {idea ? 'Save changes' : 'Add idea'}
        </Button>
        {idea && (
          <Button type="button" variant="ghost" block className="text-danger" icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirmDelete(true)}>
            Delete idea
          </Button>
        )}
      </div>

      <ConfirmSheet
        open={confirmDelete}
        title="Delete this idea?"
        body={`“${idea?.title ?? ''}” and its votes will be removed for everyone.${idea?.checklist_item_id ? ' The checklist item stays.' : ''}`}
        confirmLabel="Delete idea"
        danger
        onConfirm={async () => {
          if (!idea) return
          setConfirmDelete(false)
          const res = await deleteIdea(idea.id)
          if (!res.ok) return toast.error(res.error)
          toast.show('Idea deleted')
          onDone()
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </form>
  )
}
