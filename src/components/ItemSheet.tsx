import { Check, ChevronRight, ExternalLink, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import {
  OWNERSHIP_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  type Item,
  type Ownership,
  type Priority,
  type Status,
} from '@/lib/domain'
import { useHousehold, type ItemPatch } from '@/household/HouseholdProvider'
import { optionsLine } from '@/lib/shopping'
import { ShoppingSheet } from '@/shopping/ShoppingSheet'
import { useShopping } from '@/shopping/ShoppingProvider'
import { Avatar } from './Avatar'
import { assigneeMembers, responsibilityLabel } from './ItemRow'
import { ConfirmSheet, Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Field, Segmented } from './ui'

interface ItemSheetProps {
  open: boolean
  onClose: () => void
  /** Existing item to edit, or null to create. */
  item: Item | null
  /** Default room when creating. */
  roomId?: string
  /** Set when this sheet was opened from the shopping sheet, which already shows all of that. */
  hideShoppingLink?: boolean
}

interface Draft {
  name: string
  description: string
  room_id: string
  priority: Priority
  status: Status
  assignees: string[]
  ownership: Ownership
  owner_user_id: string | null
  is_complete: boolean
  estimated_price: string
  actual_price: string
  shopping_url: string
  notes: string
}

function toDraft(item: Item | null, roomId: string): Draft {
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    room_id: item?.room_id ?? roomId,
    priority: item?.priority ?? 'must_have',
    status: item?.status ?? 'to_decide',
    assignees: item?.assignees ?? [],
    ownership: item?.ownership ?? 'to_decide',
    owner_user_id: item?.owner_user_id ?? null,
    is_complete: item?.is_complete ?? false,
    estimated_price: item?.estimated_price != null ? String(item.estimated_price) : '',
    actual_price: item?.actual_price != null ? String(item.actual_price) : '',
    shopping_url: item?.shopping_url ?? '',
    notes: item?.notes ?? '',
  }
}

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
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes('.')) return 'invalid'
    return u.toString()
  } catch {
    return 'invalid'
  }
}

export function ItemSheet({ open, onClose, item, roomId, hideShoppingLink }: ItemSheetProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet busy={busy} open={open} onClose={onClose} title={item ? 'Item details' : 'Add an item'}>
      {open && <ItemForm key={item?.id ?? 'new'} item={item} roomId={roomId} onDone={onClose} onBusy={setBusy} hideShoppingLink={hideShoppingLink} />}
    </Sheet>
  )
}

function ItemForm({ item, roomId, onDone, onBusy, hideShoppingLink }: { item: Item | null; roomId?: string; onDone: () => void; onBusy: (busy: boolean) => void; hideShoppingLink?: boolean }) {
  const { user } = useAuth()
  const { items, rooms, members, memberById, createItem, updateItem, deleteItem, setAssignees } = useHousehold()
  const shopping = useShopping()
  const [shoppingOpen, setShoppingOpen] = useState(false)
  const toast = useToast()
  const ids = { name: useId(), desc: useId(), room: useId(), owner: useId(), est: useId(), act: useId(), url: useId(), notes: useId() }
  const [savedItem, setSavedItem] = useState<Item | null>(item)
  const [draft, setDraft] = useState<Draft>(() => toDraft(item, roomId ?? rooms[0]?.id ?? ''))
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const toggleAssignee = (userId: string) =>
    setDraft((d) => ({
      ...d,
      assignees: d.assignees.includes(userId) ? d.assignees.filter((u) => u !== userId) : [...d.assignees, userId],
    }))
  const draftPeople = assigneeMembers({ ...(item ?? ({} as Item)), assignees: draft.assignees } as Item, memberById)
  const whoSummary = responsibilityLabel(
    { ...(item ?? ({ status: draft.status } as Item)), status: draft.status, assignees: draft.assignees, needs_assignees: Boolean(item?.needs_assignees) && draft.assignees.length === 0 } as Item,
    draftPeople,
    user?.id,
  )

  const ownerValue = draft.ownership === 'member' ? `member:${draft.owner_user_id}` : draft.ownership
  const setOwner = (value: string) => {
    if (value.startsWith('member:')) setDraft((d) => ({ ...d, ownership: 'member', owner_user_id: value.slice(7) }))
    else setDraft((d) => ({ ...d, ownership: value as Ownership, owner_user_id: null }))
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    const current = savedItem ? items.find((i) => i.id === savedItem.id) : null
    if (savedItem && (!current || current.updated_at !== savedItem.updated_at || current.assignees.slice().sort().join(',') !== savedItem.assignees.slice().sort().join(','))) {
      toast.error('This item changed while you were editing. Close and reopen it to review the latest version. Your draft is still here.')
      return
    }
    const errs: typeof errors = {}
    const name = draft.name.trim()
    if (!name) errs.name = 'Give it a name.'
    else if (name.length > 80) errs.name = 'Keep it under 80 characters.'
    if (!draft.room_id) errs.room_id = 'Choose a room.'
    const est = parseMoney(draft.estimated_price)
    const act = parseMoney(draft.actual_price)
    if (est === 'invalid') errs.estimated_price = 'Enter a number, like 120 or 49.95.'
    if (act === 'invalid') errs.actual_price = 'Enter a number, like 120 or 49.95.'
    const url = normaliseUrl(draft.shopping_url)
    if (url === 'invalid') errs.shopping_url = 'That doesn’t look like a web link.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    const payload: ItemPatch & { name: string; room_id: string } = {
      name,
      description: draft.description.trim() || null,
      room_id: draft.room_id,
      priority: draft.priority,
      status: draft.status,
      ownership: draft.ownership,
      owner_user_id: draft.owner_user_id,
      is_complete: draft.is_complete,
      estimated_price: est as number | null,
      actual_price: act as number | null,
      shopping_url: url as string | null,
      notes: draft.notes.trim() || null,
    }
    setSaving(true)
    onBusy(true)
    const patch = savedItem ? Object.fromEntries(Object.entries(payload).filter(([key, value]) => savedItem[key as keyof Item] !== value)) as ItemPatch : payload
    const res = savedItem
      ? Object.keys(patch).length > 0
        ? await updateItem(savedItem.id, patch, savedItem.updated_at)
        : { ok: true as const, data: savedItem }
      : await createItem(payload)
    if (!res.ok) {
      setSaving(false)
      onBusy(false)
      toast.error(res.error)
      return
    }
    const before = savedItem?.assignees ?? []
    // Retain the created ID after an assignment failure so retry cannot duplicate an item.
    setSavedItem({ ...res.data, assignees: before })
    const changed = before.length !== draft.assignees.length || before.some((u) => !draft.assignees.includes(u))
    if (changed) {
      const a = await setAssignees(res.data.id, draft.assignees)
      if (!a.ok) {
        setSaving(false)
        onBusy(false)
        toast.error(a.error)
        return
      }
    }
    setSaving(false)
    onBusy(false)
    toast.success(item ? 'Saved' : `Added “${name}”`)
    onDone()
  }

  const remove = async () => {
    if (!item) return
    setDeleting(true)
    onBusy(true)
    // Its product options go with it (database cascade); their photo files need removing too.
    const photos = shopping.photoPathsForItem(item.id)
    const res = await deleteItem(item.id)
    setDeleting(false)
    onBusy(false)
    setConfirmDelete(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    void shopping.removeFiles(photos)
    toast.show(`Removed “${item.name}”`)
    onDone()
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6 pt-2" noValidate>
      <Field label="Item" htmlFor={ids.name} error={errors.name}>
        <input
          id={ids.name}
          className="field text-[17px] font-semibold"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Coffee table"
          maxLength={80}
          autoComplete="off"
          aria-invalid={!!errors.name}
          data-autofocus={item ? undefined : true}
        />
      </Field>

      <label className="bg-surface-2 flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] px-4">
        <span>
          <span className="block font-semibold">It’s in the flat</span>
          <span className="text-ink-2 block text-[14px]">Tick only once it’s physically here</span>
        </span>
        <Switch checked={draft.is_complete} onChange={(v) => set('is_complete', v)} label="It’s in the flat" />
      </label>

      {item && !hideShoppingLink && (
        <button
          type="button"
          onClick={() => setShoppingOpen(true)}
          className="pressable bg-surface-2 active:bg-surface-3 -mt-3 flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-control)] px-4 py-2.5 text-left"
        >
          <span className="min-w-0">
            <span className="block font-semibold">Shopping</span>
            <span className="text-ink-2 block truncate text-[14px]">{shoppingSummary(item, shopping, memberById, user?.id)}</span>
          </span>
          <ChevronRight size={20} className="text-ink-3 shrink-0" aria-hidden />
        </button>
      )}

      <fieldset>
        <legend className="mb-1 text-[14px] font-semibold">Who’s on it?</legend>
        <p className="text-ink-2 mb-2 text-[14px]">Pick one person, or several to share it.</p>
        <div className="no-scrollbar -mx-5 flex gap-1 overflow-x-auto px-4" role="group" aria-label="Who’s on it?">
          {members.map((m) => (
            <PersonToggle
              key={m.userId}
              selected={draft.assignees.includes(m.userId)}
              onClick={() => toggleAssignee(m.userId)}
              label={m.userId === user?.id ? 'Me' : m.profile.display_name}
            >
              <Avatar profile={m.profile} size={48} decorative />
            </PersonToggle>
          ))}
        </div>
        <p className={`mt-1.5 text-[14px] font-medium ${draft.assignees.length === 0 && item?.needs_assignees ? 'text-orange-ink' : 'text-ink-2'}`} aria-live="polite">
          {draft.assignees.length === 0 && item?.needs_assignees
            ? 'This was marked “Shared” before. Choose who’s sharing it.'
            : whoSummary}
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[14px] font-semibold">Plan</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plan">
          {STATUSES.map((s) => {
            const selected = draft.status === s
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set('status', s)}
                className={`pressable min-h-12 rounded-2xl px-3 text-left text-[15px] font-semibold transition-colors ${
                  selected ? 'bg-ink text-white' : 'bg-surface-2 text-ink'
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            )
          })}
        </div>
        {draft.status === 'ordered' && !draft.is_complete && (
          <p className="text-ink-2 mt-2 text-[14px]">Ordered items stay open until someone ticks them as in the flat.</p>
        )}
        {draft.status === 'provided' && (
          <p className="text-ink-2 mt-2 text-[14px]">Supplied by the landlord. Tick “It’s in the flat” once you’ve checked it’s there.</p>
        )}
        {draft.status === 'not_needed' && (
          <p className="text-ink-2 mt-2 text-[14px]">Not needed items don’t count towards progress.</p>
        )}
      </fieldset>

      <div>
        <p className="mb-2 text-[14px] font-semibold">Priority</p>
        <Segmented
          label="Priority"
          value={draft.priority}
          onChange={(v) => set('priority', v)}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Room" htmlFor={ids.room} error={errors.room_id}>
          <select id={ids.room} className="field appearance-none" value={draft.room_id} onChange={(e) => set('room_id', e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owned by" htmlFor={ids.owner} hint="Who keeps it if the flat moves on">
          <select id={ids.owner} className="field appearance-none" value={ownerValue} onChange={(e) => setOwner(e.target.value)}>
            <option value="to_decide">{OWNERSHIP_LABEL.to_decide}</option>
            <option value="shared">{OWNERSHIP_LABEL.shared}</option>
            {members.map((m) => (
              <option key={m.userId} value={`member:${m.userId}`}>
                {m.profile.display_name}
              </option>
            ))}
            <option value="landlord">{OWNERSHIP_LABEL.landlord}</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Estimate (NZ$)" htmlFor={ids.est} error={errors.estimated_price}>
          <input
            id={ids.est}
            className="field tabular-nums"
            inputMode="decimal"
            placeholder="Optional"
            value={draft.estimated_price}
            onChange={(e) => set('estimated_price', e.target.value)}
            aria-invalid={!!errors.estimated_price}
          />
        </Field>
        <Field label="Spent (NZ$)" htmlFor={ids.act} error={errors.actual_price}>
          <input
            id={ids.act}
            className="field tabular-nums"
            inputMode="decimal"
            placeholder="Optional"
            value={draft.actual_price}
            onChange={(e) => set('actual_price', e.target.value)}
            aria-invalid={!!errors.actual_price}
          />
        </Field>
      </div>

      <Field label="Shopping link" htmlFor={ids.url} error={errors.shopping_url}>
        <div className="flex gap-2">
          <input
            id={ids.url}
            className="field"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            placeholder="https://"
            value={draft.shopping_url}
            onChange={(e) => set('shopping_url', e.target.value)}
            aria-invalid={!!errors.shopping_url}
          />
          {item?.shopping_url && (
            <a
              href={item.shopping_url}
              target="_blank"
              rel="noopener noreferrer"
              className="pressable bg-surface-2 inline-flex w-14 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
              aria-label="Open shopping link"
            >
              <ExternalLink size={20} aria-hidden />
            </a>
          )}
        </div>
      </Field>

      <Field label="Details" htmlFor={ids.desc} hint="Size, colour, model…">
        <input
          id={ids.desc}
          className="field"
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={500}
          placeholder="Optional"
        />
      </Field>

      <Field label="Notes" htmlFor={ids.notes}>
        <textarea
          id={ids.notes}
          className="field min-h-24 resize-y"
          value={draft.notes}
          onChange={(e) => set('notes', e.target.value)}
          maxLength={1000}
          placeholder="Anything the others should know"
        />
      </Field>

      {item && (
        <Button type="button" variant="ghost" block icon={<Trash2 size={18} aria-hidden />} className="text-danger -mt-2" onClick={() => setConfirmDelete(true)}>
          Delete item
        </Button>
      )}

      {/* Flush with the sheet's bottom edge (the scroll area has 16px bottom padding). */}
      <div className="bg-surface border-line sticky -bottom-4 z-10 -mx-5 -mt-2 border-t px-5 pt-3 pb-4">
        <Button type="submit" size="lg" block loading={saving}>
          {item ? 'Save changes' : 'Add item'}
        </Button>
      </div>

      {item && !hideShoppingLink && <ShoppingSheet open={shoppingOpen} itemId={item.id} onClose={() => setShoppingOpen(false)} fromItemDetails />}

      <ConfirmSheet
        open={confirmDelete}
        title="Delete this item?"
        body={`“${item?.name ?? ''}” will be removed for everyone in the flat.`}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </form>
  )
}

/** One line for the item sheet's Shopping row: who's sorting it, and what there is to compare. */
function shoppingSummary(
  item: Item,
  shopping: ReturnType<typeof useShopping>,
  memberById: ReturnType<typeof useHousehold>['memberById'],
  myId?: string,
): string {
  const coordinator = shopping.coordinatorByItem.get(item.id)
  const who = coordinator
    ? coordinator.user_id === myId
      ? 'You’re sorting this'
      : `${memberById.get(coordinator.user_id)?.profile.display_name ?? 'A flatmate'} is sorting this`
    : ''
  const parts = [who, optionsLine(shopping.optionsByItem.get(item.id) ?? [])].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Compare products, track the order'
}

function PersonToggle({
  selected,
  onClick,
  label,
  children,
}: {
  selected: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      className="pressable flex w-[72px] shrink-0 flex-col items-center gap-1.5 rounded-2xl py-1.5"
    >
      <span className="relative rounded-full p-[3px]">
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          initial={false}
          animate={{ boxShadow: selected ? '0 0 0 2.5px var(--color-ink)' : '0 0 0 2.5px rgba(17,17,17,0)' }}
          transition={{ duration: 0.16 }}
        />
        <motion.span
          className="block"
          initial={false}
          animate={{ opacity: selected ? 1 : 0.55, scale: selected ? 1 : 0.94 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.span>
        <motion.span
          aria-hidden
          className="bg-ink absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-white"
          initial={false}
          animate={{ opacity: selected ? 1 : 0, scale: selected ? 1 : 0.4 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          <Check size={12} strokeWidth={3.2} />
        </motion.span>
      </span>
      <span className={`w-full truncate text-center text-[13px] transition-colors ${selected ? 'text-ink font-bold' : 'text-ink-2 font-medium'}`}>
        {label}
      </span>
    </button>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault()
        onChange(!checked)
      }}
      className={`relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full transition-colors duration-200 ${checked ? 'bg-green' : 'bg-surface-3'}`}
    >
      <span
        className="bg-surface absolute top-1 left-1 h-6 w-6 rounded-full transition-transform duration-200"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}
