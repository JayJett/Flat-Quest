import { useId, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, Field } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { isDay, todayLocal } from '@/lib/dates'
import { STATUS_LABEL, type Item } from '@/lib/domain'
import { DELIVERY_LABEL, DELIVERY_METHODS, formatPrice, isPurchaseStage, parsePrice, PURCHASE_STAGES, type PurchaseStage } from '@/lib/shopping'
import { normaliseWebUrl } from '@/lib/urls'
import { useShopping, type PurchaseInput } from './ShoppingProvider'

/**
 * Purchase and delivery details for one item. Works with or without product
 * options. The amount paid is the item's own "Spent" figure and the stage is the
 * item's own plan, saved together with these details in one transaction.
 */
export function PurchaseSheet({ open, item, onClose }: { open: boolean; item: Item; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const { purchaseByItem } = useShopping()
  const exists = purchaseByItem.has(item.id)
  return (
    <Sheet open={open} onClose={onClose} title={exists ? 'Purchase and delivery' : 'Record a purchase'} busy={busy}>
      {open && <PurchaseForm item={item} onDone={onClose} onBusy={setBusy} />}
    </Sheet>
  )
}

function PurchaseForm({ item, onDone, onBusy }: { item: Item; onDone: () => void; onBusy: (b: boolean) => void }) {
  const { user } = useAuth()
  const { members } = useHousehold()
  const { purchaseByItem, optionsByItem, savePurchase } = useShopping()
  const toast = useToast()
  const ids = { option: useId(), by: useId(), on: useId(), paid: useId(), ref: useId(), notes: useId(), stage: useId(), method: useId(), expected: useId(), track: useId(), dnotes: useId(), arrived: useId() }
  // What the form was opened with. Saving is refused if any of it changed underneath.
  const [opened] = useState(() => ({ purchase: purchaseByItem.get(item.id) ?? null, status: item.status, amount: item.actual_price }))
  const options = optionsByItem.get(item.id) ?? []
  const p = opened.purchase

  const [optionId, setOptionId] = useState(p ? (p.option_id ?? '') : (options.find((o) => o.is_selected)?.id ?? ''))
  const [by, setBy] = useState(p?.purchased_by ?? '')
  const [on, setOn] = useState(p ? (p.purchased_on ?? '') : todayLocal())
  const [paid, setPaid] = useState(opened.amount != null ? String(opened.amount) : '')
  const [reference, setReference] = useState(p?.order_reference ?? '')
  const [notes, setNotes] = useState(p?.notes ?? '')
  const [stage, setStage] = useState<PurchaseStage>(isPurchaseStage(opened.status) && opened.status !== 'need_to_buy' && opened.status !== 'shopping' ? opened.status : 'ordered')
  const [method, setMethod] = useState(p?.delivery_method ?? '')
  const [expected, setExpected] = useState(p?.expected_on ?? '')
  const [tracking, setTracking] = useState(p?.tracking_url ?? '')
  const [deliveryNotes, setDeliveryNotes] = useState(p?.delivery_notes ?? '')
  const [arrived, setArrived] = useState(p?.arrived_on ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const chosen = options.find((o) => o.id === optionId)
  const listed = chosen?.price != null ? formatPrice(chosen.price) : ''

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    const errs: Record<string, string> = {}
    const amount = parsePrice(paid)
    if (amount === 'invalid') errs.paid = 'Enter an amount, like 899 or 49.95.'
    const track = normaliseWebUrl(tracking)
    if (track === 'invalid') errs.track = 'That doesn’t look like a web link.'
    for (const [key, value] of [['on', on], ['expected', expected], ['arrived', arrived]] as const) {
      if (value && !isDay(value)) errs[key] = 'Choose a real date.'
    }
    setErrors(errs)
    if (Object.keys(errs).length) return

    const input: PurchaseInput = {
      option_id: optionId || null,
      purchased_by: by || null,
      purchased_on: on || null,
      order_reference: reference.trim().slice(0, 80) || null,
      notes: notes.trim() || null,
      delivery_method: method || null,
      expected_on: expected || null,
      tracking_url: track as string | null,
      delivery_notes: deliveryNotes.trim() || null,
      arrived_on: arrived || null,
    }
    setSaving(true)
    onBusy(true)
    const res = await savePurchase(item.id, input, {
      expectedVersion: p?.updated_at ?? null,
      ...(stage !== opened.status ? { status: { to: stage, from: opened.status } } : {}),
      ...(amount !== opened.amount ? { amount: { to: amount as number | null, from: opened.amount } } : {}),
    })
    setSaving(false)
    onBusy(false)
    if (!res.ok) return toast.error(res.error)
    toast.success(p ? 'Saved' : `Purchase recorded for “${item.name}”`)
    onDone()
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5 pt-2" noValidate>
      <p className="text-ink-2 -mt-1 text-[15px]">
        For <span className="text-ink font-semibold">{item.name}</span>. Everything here is optional.
      </p>

      {options.length > 0 && (
        <Field label="Which product?" htmlFor={ids.option}>
          <select id={ids.option} className="field appearance-none" value={optionId} onChange={(e) => setOptionId(e.target.value)}>
            <option value="">Something else</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {[o.name, o.retailer, formatPrice(o.price)].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Bought by" htmlFor={ids.by}>
          <select id={ids.by} className="field appearance-none" value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">Not recorded</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === user?.id ? `${m.profile.display_name} (me)` : m.profile.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date bought" htmlFor={ids.on} error={errors.on}>
          <input id={ids.on} type="date" className="field min-h-[54px]" value={on} onChange={(e) => setOn(e.target.value)} aria-invalid={!!errors.on} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid (NZ$)" htmlFor={ids.paid} error={errors.paid} hint={listed ? `Listed at ${listed}` : undefined}>
          <input id={ids.paid} className="field tabular-nums" inputMode="decimal" placeholder="Optional" value={paid} onChange={(e) => setPaid(e.target.value)} aria-invalid={!!errors.paid} />
        </Field>
        <Field label="Order reference" htmlFor={ids.ref}>
          <input id={ids.ref} className="field" value={reference} maxLength={80} autoCapitalize="characters" autoCorrect="off" placeholder="Optional" onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Stage" htmlFor={ids.stage}>
          <select id={ids.stage} className="field appearance-none" value={stage} onChange={(e) => setStage(e.target.value as PurchaseStage)}>
            {PURCHASE_STAGES.filter((s) => s !== 'need_to_buy' && s !== 'shopping').map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Getting it by" htmlFor={ids.method}>
          <select id={ids.method} className="field appearance-none" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Not set</option>
            {DELIVERY_METHODS.map((m) => (
              <option key={m} value={m}>
                {DELIVERY_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!item.is_complete && (
        <p className="text-ink-2 -mt-3 text-[14px]">
          {stage === 'delivered' ? 'Delivered isn’t done yet: tick “It’s in the flat” once it’s set up.' : 'It stays on the checklist until someone ticks “It’s in the flat”.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={method === 'pickup' ? 'Collect on' : 'Expected on'} htmlFor={ids.expected} error={errors.expected}>
          <input id={ids.expected} type="date" className="field min-h-[54px]" value={expected} onChange={(e) => setExpected(e.target.value)} aria-invalid={!!errors.expected} />
        </Field>
        <Field label="Arrived on" htmlFor={ids.arrived} error={errors.arrived}>
          <input id={ids.arrived} type="date" className="field min-h-[54px]" value={arrived} max={todayLocal()} onChange={(e) => setArrived(e.target.value)} aria-invalid={!!errors.arrived} />
        </Field>
      </div>

      <Field label="Tracking link" htmlFor={ids.track} error={errors.track}>
        <input id={ids.track} className="field" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://" value={tracking} onChange={(e) => setTracking(e.target.value)} aria-invalid={!!errors.track} />
      </Field>

      <Field label="Delivery notes" htmlFor={ids.dnotes}>
        <input id={ids.dnotes} className="field" value={deliveryNotes} maxLength={1000} placeholder="e.g. Leave at the back door" onChange={(e) => setDeliveryNotes(e.target.value)} />
      </Field>

      <Field label="Purchase notes" htmlFor={ids.notes}>
        <textarea id={ids.notes} className="field min-h-20 resize-y" value={notes} maxLength={1000} placeholder="Warranty, receipt, who’s chipping in…" onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="bg-surface border-line sticky -bottom-4 z-10 -mx-5 border-t px-5 pt-3 pb-4">
        <Button type="submit" size="lg" block loading={saving}>
          {p ? 'Save changes' : 'Save purchase'}
        </Button>
      </div>
    </form>
  )
}
