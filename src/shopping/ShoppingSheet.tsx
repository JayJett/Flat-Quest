import { Check, ChevronDown, ExternalLink, Pencil, Plus, ShoppingBag } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar, AvatarGroup } from '@/components/Avatar'
import { ItemSheet } from '@/components/ItemSheet'
import { assigneeMembers, responsibilityLabel, STATUS_TONE } from '@/components/ItemRow'
import { ConfirmSheet, Sheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button, ErrorPanel, Spinner } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { formatDay, friendlyDay, todayLocal } from '@/lib/dates'
import { PRIORITY_LABEL, STATUS_LABEL, type Item, type Member, type Status } from '@/lib/domain'
import { DELIVERY_LABEL, formatPrice, isPurchaseStage, preferenceTally, PURCHASE_STAGES, sortOptions, type DeliveryMethod, type Purchase } from '@/lib/shopping'
import { hostLabel } from '@/lib/urls'
import { OptionCard } from './OptionCard'
import { OptionFormSheet, OptionSheet } from './OptionSheet'
import { PurchaseSheet } from './PurchaseSheet'
import { useShopping } from './ShoppingProvider'

const OTHER_PLANS: Status[] = ['to_decide', 'bringing', 'provided', 'not_needed']

interface ShoppingSheetProps {
  open: boolean
  itemId: string | null
  onClose: () => void
  /** Hide the "Edit item" shortcut when this was opened from the item's own details. */
  fromItemDetails?: boolean
}

/** Everything about buying one checklist item: stage, who's sorting it, options, purchase and delivery. */
export function ShoppingSheet({ open, itemId, onClose, fromItemDetails }: ShoppingSheetProps) {
  const { items } = useHousehold()
  // Read the live item so a flatmate's changes show while this is open.
  const item = itemId ? items.find((i) => i.id === itemId) : undefined
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={open} onClose={onClose} title={item?.name ?? 'Shopping'} busy={busy}>
      {open &&
        (item ? (
          <ShoppingBody key={item.id} item={item} onClose={onClose} onBusy={setBusy} fromItemDetails={fromItemDetails} />
        ) : (
          <div className="py-6">
            <p className="font-semibold">This item is no longer on the checklist.</p>
            <p className="text-ink-2 mt-1 text-[15px]">A flatmate may have removed it.</p>
            <Button variant="secondary" className="mt-5" onClick={onClose}>
              Close
            </Button>
          </div>
        ))}
    </Sheet>
  )
}

function ShoppingBody({ item, onClose, onBusy, fromItemDetails }: { item: Item; onClose: () => void; onBusy: (b: boolean) => void; fromItemDetails?: boolean }) {
  const { user } = useAuth()
  const { rooms, memberById, updateItem } = useHousehold()
  const shopping = useShopping()
  const toast = useToast()
  const [openOption, setOpenOption] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [editingItem, setEditingItem] = useState(false)
  const [working, setWorking] = useState(false)

  const room = rooms.find((r) => r.id === item.room_id)
  const people = assigneeMembers(item, memberById)
  const tally = preferenceTally(shopping.preferencesByItem.get(item.id) ?? [])
  const options = sortOptions(shopping.optionsByItem.get(item.id) ?? [], tally)
  const purchase = shopping.purchaseByItem.get(item.id) ?? null
  const myPreference = (shopping.preferencesByItem.get(item.id) ?? []).find((p) => p.user_id === user?.id)?.option_id ?? null
  const buying = isPurchaseStage(item.status)
  const preOrder = item.status === 'need_to_buy' || item.status === 'shopping'

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setWorking(true)
    onBusy(true)
    const res = await fn()
    setWorking(false)
    onBusy(false)
    if (!res.ok) toast.error(res.error ?? 'Something went wrong.')
    else if (done) toast.success(done)
    return res.ok
  }

  const setStage = (status: Status) => {
    if (status === item.status) return
    void run(() => updateItem(item.id, { status }))
  }

  const inTheFlat = async () => {
    const ok = await run(() => updateItem(item.id, { is_complete: true }), `“${item.name}” is in the flat`)
    if (!ok) return
    // Note the arrival date on the purchase record, if there is one and nobody has yet.
    if (purchase && !purchase.arrived_on) {
      const { item_id: _i, household_id: _h, updated_by: _u, created_at: _c, updated_at: _t, ...fields } = purchase
      void shopping.savePurchase(item.id, { ...fields, arrived_on: todayLocal() }, { expectedVersion: purchase.updated_at })
    }
    onClose()
  }

  const prefer = async (optionId: string) => {
    const res = await shopping.setPreference(item.id, myPreference === optionId ? null : optionId)
    if (!res.ok) toast.error(res.error)
  }

  return (
    <div className="flex flex-col gap-6 pt-1">
      {/* Where it sits on the checklist */}
      <div className="-mt-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink-2 text-[15px]">{[room?.name, PRIORITY_LABEL[item.priority]].filter(Boolean).join(' · ')}</p>
          <p className="text-ink-2 text-[14px]">{responsibilityLabel(item, people, user?.id)}</p>
        </div>
        {people.length > 0 && <AvatarGroup profiles={people.map((m) => m.profile)} size={30} label={responsibilityLabel(item, people, user?.id)} />}
      </div>

      {/* Stage: the same "Plan" as the checklist, never a second status. */}
      <section aria-label="Stage" className="bg-surface-2 rounded-[var(--radius-card)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink-2 text-[14px] font-medium">Stage</p>
            {/* One live region; only the incoming label animates, so it is announced once. */}
            <p aria-live="polite" data-stage={item.is_complete ? 'done' : item.status} className="text-[20px] leading-tight font-extrabold">
              <motion.span
                key={item.is_complete ? 'done' : item.status}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={`inline-block ${item.is_complete ? 'text-green-ink' : STATUS_TONE[item.status]}`}
              >
                {item.is_complete ? 'In the flat' : STATUS_LABEL[item.status]}
              </motion.span>
            </p>
          </div>
          {!item.is_complete && (
            <label className="text-ink bg-surface relative inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3.5 text-[15px] font-semibold">
              Change
              <ChevronDown size={16} aria-hidden />
              <select
                aria-label="Change stage"
                value={item.status}
                disabled={working}
                onChange={(e) => setStage(e.target.value as Status)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <optgroup label="Buying it">
                  {PURCHASE_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Not buying it">
                  {OTHER_PLANS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          )}
        </div>
        <p className="text-ink-2 mt-2 text-[14px]">{stageHint(item)}</p>
      </section>

      {!item.is_complete && <Coordinator item={item} />}

      {/* Options to compare */}
      <section aria-label="Options">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h3 className="text-title font-bold">
            Options{options.length > 0 && <span className="text-ink-2 ml-1.5 text-[16px] font-semibold tabular-nums">{options.length}</span>}
          </h3>
          {options.length > 0 && (
            <button type="button" onClick={() => setAdding(true)} className="text-accent inline-flex min-h-11 items-center gap-1 text-[15px] font-bold">
              <Plus size={18} strokeWidth={2.6} aria-hidden /> Add option
            </button>
          )}
        </div>
        {shopping.status === 'loading' ? (
          <div className="flex justify-center py-8">
            <Spinner label="Loading options" />
          </div>
        ) : shopping.status === 'error' ? (
          <ErrorPanel message={shopping.error ?? 'Couldn’t load shopping details.'} onRetry={() => void shopping.reload()} />
        ) : options.length === 0 ? (
          <div className="bg-surface-2 flex flex-col items-start gap-3 rounded-[var(--radius-card)] p-4">
            <p className="text-[15px]">
              <span className="font-semibold">Nothing to compare yet.</span>{' '}
              <span className="text-ink-2">Add a couple of products you’ve found and see which one everyone prefers.</span>
            </p>
            <Button type="button" variant="ink" size="sm" icon={<Plus size={18} aria-hidden />} onClick={() => setAdding(true)}>
              Add an option
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2.5">
            <AnimatePresence initial={false}>
              {options.map((o) => (
                <OptionCard
                  key={o.id}
                  option={o}
                  room={room}
                  myId={user?.id}
                  voters={(tally.get(o.id) ?? []).map((u) => memberById.get(u)).filter((m): m is Member => Boolean(m))}
                  onOpen={() => setOpenOption(o.id)}
                  onPrefer={() => void prefer(o.id)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {item.shopping_url && (
          <a href={item.shopping_url} target="_blank" rel="noopener noreferrer" className="text-accent mt-2 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold">
            <ExternalLink size={16} aria-hidden /> Saved link: {hostLabel(item.shopping_url) || 'open'}
          </a>
        )}
      </section>

      {/* Purchase and delivery */}
      {(purchase || item.actual_price != null) && (
        <PurchaseSummary item={item} purchase={purchase} onEdit={() => setPurchasing(true)} />
      )}

      {!fromItemDetails && (
        <Button type="button" variant="ghost" block className="text-ink-2 -my-2" icon={<Pencil size={17} aria-hidden />} onClick={() => setEditingItem(true)}>
          Edit item
        </Button>
      )}

      {/* One clear next step, pinned above the keyboard-safe bottom edge. */}
      <div className="bg-surface border-line sticky -bottom-4 z-10 -mx-5 -mt-1 border-t px-5 pt-3 pb-4">
        {item.is_complete ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-green-ink flex items-center gap-2 font-bold">
              <Check size={20} strokeWidth={2.8} aria-hidden /> It’s in the flat
            </p>
            <Button type="button" variant="ghost" size="sm" loading={working} onClick={() => void run(() => updateItem(item.id, { is_complete: false }))}>
              Not yet
            </Button>
          </div>
        ) : !buying ? (
          <Button type="button" variant="ink" size="lg" block loading={working} onClick={() => setStage('need_to_buy')}>
            We need to buy this
          </Button>
        ) : (
          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" size="lg" className="min-w-0 flex-1 !px-2 !text-[15px] whitespace-nowrap min-[380px]:!text-[17px]" disabled={working} onClick={() => setPurchasing(true)}>
              {preOrder && !purchase ? 'Record purchase' : 'Order details'}
            </Button>
            <Button type="button" size="lg" className="min-w-0 flex-1 !px-2 !text-[15px] whitespace-nowrap min-[380px]:!text-[17px]" loading={working} onClick={() => void inTheFlat()}>
              It’s in the flat
            </Button>
          </div>
        )}
      </div>

      <OptionSheet open={openOption !== null} optionId={openOption} item={item} onClose={() => setOpenOption(null)} />
      <OptionFormSheet open={adding} item={item} option={null} onClose={() => setAdding(false)} />
      <PurchaseSheet open={purchasing} item={item} onClose={() => setPurchasing(false)} />
      {!fromItemDetails && <ItemSheet open={editingItem} item={item} onClose={() => setEditingItem(false)} hideShoppingLink />}
    </div>
  )
}

function stageHint(item: Item): string {
  if (item.is_complete) return 'Done. It counts towards the flat’s progress.'
  switch (item.status) {
    case 'need_to_buy':
      return 'On the shopping list. Add options to compare, or record the purchase once it’s bought.'
    case 'shopping':
      return 'Someone’s looking around. Compare options below and pick one together.'
    case 'ordered':
      return 'Ordered isn’t done: it stays open until it’s in the flat.'
    case 'on_the_way':
      return 'On its way. Tick it off when it’s in the flat.'
    case 'ready_to_collect':
      return 'Waiting to be picked up.'
    case 'delivered':
      return 'It has arrived. Tick “It’s in the flat” once it’s unpacked and in place.'
    case 'bringing':
      return 'Someone is bringing this, so it isn’t on the shopping list.'
    case 'provided':
      return 'Supplied with the flat, so there’s nothing to buy.'
    case 'not_needed':
      return 'Marked as not needed.'
    default:
      return 'Not decided yet. Is this something to buy?'
  }
}

// ---------------------------------------------------------------- who is sorting it
function Coordinator({ item }: { item: Item }) {
  const { user } = useAuth()
  const { members, memberById } = useHousehold()
  const { coordinatorByItem, claim, release, handOver, takeOver } = useShopping()
  const toast = useToast()
  const [working, setWorking] = useState(false)
  const [handing, setHanding] = useState(false)
  const [confirmTake, setConfirmTake] = useState(false)
  const row = coordinatorByItem.get(item.id)
  const who = row ? memberById.get(row.user_id) : undefined
  const mine = Boolean(row && row.user_id === user?.id)
  const others = members.filter((m) => m.userId !== user?.id)

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    if (working) return
    setWorking(true)
    const res = await fn()
    setWorking(false)
    if (!res.ok) toast.error(res.error ?? 'Something went wrong.')
    else if (done) toast.success(done)
  }

  const state = !row ? 'none' : mine ? 'mine' : 'other'
  return (
    <section aria-label="Who’s sorting the purchase" className="flex min-h-14 items-center gap-3">
      {who ? (
        <Avatar profile={who.profile} size={40} decorative />
      ) : (
        <span className="bg-surface-2 text-ink-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full" aria-hidden>
          <ShoppingBag size={19} />
        </span>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${state}:${row?.user_id ?? ''}`}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="flex min-w-0 flex-1 items-center justify-between gap-2"
        >
          <div className="min-w-0" aria-live="polite">
            <p className="leading-snug font-bold">
              {state === 'none' ? 'Nobody’s sorting this yet' : state === 'mine' ? 'You’re sorting this' : `${who?.profile.display_name ?? 'A flatmate'} is sorting this`}
            </p>
            <p className="text-ink-2 text-[14px] leading-snug">
              {state === 'none' ? 'Take it on so it doesn’t get bought twice.' : `Organising the purchase · since ${formatDay(new Date(row!.claimed_at).toLocaleDateString('en-CA'))}`}
            </p>
          </div>
          {state === 'none' && (
            <Button type="button" variant="secondary" size="sm" className="shrink-0" loading={working} onClick={() => void run(() => claim(item.id), 'You’re sorting this')}>
              I’ll sort it
            </Button>
          )}
          {state === 'mine' && (
            <div className="flex shrink-0 gap-1">
              {others.length > 0 && (
                <Button type="button" variant="secondary" size="sm" disabled={working} onClick={() => setHanding(true)}>
                  Hand over
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" loading={working} onClick={() => void run(() => release(item.id))}>
                Release
              </Button>
            </div>
          )}
          {state === 'other' && (
            <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={working} onClick={() => setConfirmTake(true)}>
              Take over
            </Button>
          )}
        </motion.div>
      </AnimatePresence>

      <Sheet open={handing} onClose={() => setHanding(false)} title="Hand over to" busy={working}>
        <p className="text-ink-2 text-[15px]">They’ll be shown as sorting “{item.name}”. Who’s on the item doesn’t change.</p>
        <ul className="mt-3 flex flex-col">
          {others.map((m) => (
            <li key={m.userId}>
              <button
                type="button"
                disabled={working}
                onClick={() =>
                  void run(() => handOver(item.id, m.userId), `${m.profile.display_name} is sorting this now`).then(() => setHanding(false))
                }
                className="pressable active:bg-surface-2 -mx-2 flex min-h-14 w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 text-left font-semibold"
              >
                <Avatar profile={m.profile} size={40} decorative />
                {m.profile.display_name}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      <ConfirmSheet
        open={confirmTake}
        title={`Take over from ${who?.profile.display_name ?? 'them'}?`}
        body={`You’ll be shown as sorting “${item.name}” instead. Worth a quick word first so it isn’t bought twice.`}
        confirmLabel="Take over"
        busy={working}
        onConfirm={() => {
          if (!row) return setConfirmTake(false)
          void run(() => takeOver(item.id, row.user_id), 'You’re sorting this').then(() => setConfirmTake(false))
        }}
        onClose={() => setConfirmTake(false)}
      />
    </section>
  )
}

// ---------------------------------------------------------------- purchase summary
function PurchaseSummary({ item, purchase, onEdit }: { item: Item; purchase: Purchase | null; onEdit: () => void }) {
  const { memberById } = useHousehold()
  const { optionById } = useShopping()
  const today = todayLocal()
  const option = purchase?.option_id ? optionById.get(purchase.option_id) : undefined
  const buyer = purchase?.purchased_by ? memberById.get(purchase.purchased_by)?.profile.display_name : null
  const rows: [string, string][] = []
  if (option) rows.push(['Product', [option.name, option.retailer].filter(Boolean).join(' · ')])
  if (buyer || purchase?.purchased_on) {
    rows.push(['Bought', [buyer ? `by ${buyer}` : null, purchase?.purchased_on ? `on ${formatDay(purchase.purchased_on, today)}` : null].filter(Boolean).join(' ')])
  }
  if (item.actual_price != null) rows.push(['Paid', formatPrice(item.actual_price)])
  if (purchase?.order_reference) rows.push(['Order', purchase.order_reference])
  if (purchase?.delivery_method) rows.push(['Getting it by', DELIVERY_LABEL[purchase.delivery_method as DeliveryMethod] ?? purchase.delivery_method])
  if (purchase?.expected_on && !purchase.arrived_on) rows.push([purchase.delivery_method === 'pickup' ? 'Collect' : 'Expected', friendlyDay(purchase.expected_on, today)])
  if (purchase?.arrived_on) rows.push(['Arrived', friendlyDay(purchase.arrived_on, today)])
  if (purchase?.delivery_notes) rows.push(['Delivery notes', purchase.delivery_notes])
  if (purchase?.notes) rows.push(['Notes', purchase.notes])

  return (
    <motion.section aria-label="Purchase and delivery" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-title font-bold">Purchase</h3>
        <button type="button" onClick={onEdit} className="text-accent min-h-11 text-[15px] font-bold">
          Edit
        </button>
      </div>
      <dl className="flex flex-col">
        {rows.map(([label, value]) => (
          <div key={label} className="border-line flex gap-4 border-b py-2.5 last:border-b-0">
            <dt className="text-ink-2 w-28 shrink-0 text-[15px]">{label}</dt>
            <dd className="min-w-0 flex-1 text-[15px] font-semibold [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      {purchase?.tracking_url && (
        <a href={purchase.tracking_url} target="_blank" rel="noopener noreferrer" className="text-accent inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold">
          <ExternalLink size={16} aria-hidden /> Track the delivery
        </a>
      )}
    </motion.section>
  )
}
