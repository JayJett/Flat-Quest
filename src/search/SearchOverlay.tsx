import { CornerDownLeft, Gift, Images, ListTodo, Package, Search, ShoppingBag, ShoppingBasket, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '@/components/Sheet'
import { RoomIcon } from '@/design/icons'
import { roomColor } from '@/design/tokens'
import { useHousehold } from '@/household/HouseholdProvider'
import { errorMessage, supabase } from '@/lib/supabase'
import { dueLabel } from '@/living/living'
import { useLiving } from '@/living/LivingProvider'
import { SPRINGS } from '@/motion/motion'
import { useMotionLevel } from '@/personal/PreferencesProvider'
import { useShopping } from '@/shopping/ShoppingProvider'
import { groupHits, searchDocs, type SearchDoc, type SearchHit, type SearchKind } from './search'

const ICON: Record<Exclude<SearchKind, 'room'>, LucideIcon> = {
  item: Package,
  option: ShoppingBag,
  idea: Gift,
  essential: ShoppingBasket,
  task: ListTodo,
  visual: Images,
}

type Extra = { ideas: SearchDoc[]; visuals: SearchDoc[] }

/**
 * Builds the searchable records. Rooms, items, options, essentials and tasks come from data
 * already loaded for the flat; wishlist ideas and Visual Home titles are fetched once when
 * search opens (never per keystroke). All of it is read with the member's own session, so
 * Row Level Security decides what can appear.
 */
function useSearchDocs(): { docs: SearchDoc[]; loadingExtra: boolean; extraError: string | null; retry: () => void } {
  const { household, rooms, items } = useHousehold()
  const { essentials, tasks } = useLiving()
  const { optionsByItem } = useShopping()
  const hid = household?.id ?? null
  const [extra, setExtra] = useState<Extra>({ ideas: [], visuals: [] })
  const [loadingExtra, setLoading] = useState(true)
  const [extraError, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  useEffect(() => {
    if (!hid) return
    let active = true
    void Promise.all([
      supabase.from('wishlist_items').select('id,title,notes,room_id').eq('household_id', hid).limit(500),
      supabase.from('room_visuals').select('id,title,notes,room_id,kind').eq('household_id', hid).not('title', 'is', null).limit(500),
    ]).then(([ideas, visuals]) => {
      if (!active) return
      const err = ideas.error ?? visuals.error
      setError(err ? errorMessage(err, 'Some results couldn’t load.') : null)
      setExtra({
        ideas: (ideas.data ?? []).map((i) => {
          const room = i.room_id ? roomById.get(i.room_id) : undefined
          return { kind: 'idea', id: i.id, title: i.title, extra: i.notes, context: `Wishlist idea${room ? ` · ${room.name}` : ''}`, href: `/wishlist?idea=${i.id}` }
        }),
        visuals: (visuals.data ?? [])
          .filter((v) => v.title && roomById.has(v.room_id))
          .map((v) => ({
            kind: 'visual' as const,
            id: v.id,
            title: v.title!,
            extra: v.notes,
            context: `Visual Home · ${roomById.get(v.room_id)!.name}`,
            href: `/rooms/${v.room_id}/visual?gallery=${v.kind === 'photo' ? 'photo' : 'inspiration'}`,
          })),
      })
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [hid, roomById, attempt])

  const docs = useMemo<SearchDoc[]>(() => {
    const out: SearchDoc[] = []
    const count = new Map<string, number>()
    for (const i of items) count.set(i.room_id, (count.get(i.room_id) ?? 0) + 1)
    for (const r of rooms) {
      const n = count.get(r.id) ?? 0
      out.push({ kind: 'room', id: r.id, title: r.name, context: `Room · ${n} ${n === 1 ? 'item' : 'items'}`, href: `/rooms/${r.id}`, roomColor: r.color, roomIcon: r.icon })
    }
    for (const i of items) {
      const room = roomById.get(i.room_id)
      out.push({
        kind: 'item',
        id: i.id,
        title: i.name,
        extra: [i.description, i.notes].filter(Boolean).join(' '),
        context: `Furnishing item${room ? ` · ${room.name}` : ''}${i.is_complete ? ' · In the flat' : ''}`,
        href: `/rooms/${i.room_id}?item=${i.id}`,
        roomColor: room?.color,
      })
    }
    const itemById = new Map(items.map((i) => [i.id, i]))
    for (const [itemId, options] of optionsByItem) {
      const item = itemById.get(itemId)
      if (!item) continue
      for (const o of options) {
        out.push({
          kind: 'option',
          id: o.id,
          title: o.name,
          extra: [o.retailer, o.notes].filter(Boolean).join(' '),
          context: `Product option · for ${item.name}${o.is_selected ? ' · Our pick' : ''}`,
          href: `/rooms/${item.room_id}?item=${item.id}&option=${o.id}`,
        })
      }
    }
    for (const e of essentials) {
      out.push({
        kind: 'essential',
        id: e.id,
        title: e.name,
        extra: [e.note, e.quantity, e.category].filter(Boolean).join(' '),
        context: `Essential · ${e.archived_at ? 'Archived' : e.status === 'stocked' ? 'Stocked' : e.status === 'getting' ? 'Being picked up' : 'Needed'}`,
        href: `/essentials?essential=${e.id}`,
      })
    }
    for (const t of tasks) {
      const due = t.status === 'done' ? null : dueLabel(t.due_on)
      out.push({
        kind: 'task',
        id: t.id,
        title: t.title,
        extra: t.notes,
        context: `Task · ${t.archived_at ? 'Archived' : t.status === 'done' ? 'Done' : (due?.text ?? (t.status === 'doing' ? 'In progress' : 'To do'))}`,
        href: `/tasks?task=${t.id}`,
      })
    }
    return [...out, ...extra.ideas, ...extra.visuals]
  }, [rooms, items, optionsByItem, essentials, tasks, roomById, extra])

  return { docs, loadingExtra, extraError, retry: () => setAttempt((a) => a + 1) }
}

export function SearchOverlay({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (href: string) => void }) {
  const level = useMotionLevel()
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(open, ref, onClose)
  const enter = level === 'reduced' ? { duration: 0 } : SPRINGS[level].settle
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" data-testid="search-layer">
          <motion.div
            className="absolute inset-0 hidden bg-[rgb(17_17_17/0.28)] lg:block"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: level === 'reduced' ? 0 : 0.18 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            tabIndex={-1}
            data-testid="search-dialog"
            className="bg-surface absolute inset-0 flex flex-col outline-none lg:inset-x-0 lg:top-[10vh] lg:bottom-auto lg:mx-auto lg:max-h-[72vh] lg:w-[min(640px,92vw)] lg:rounded-[28px] lg:shadow-[var(--shadow-float)]"
            initial={level === 'reduced' ? false : { opacity: 0, y: level === 'minimal' ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: level === 'reduced' || level === 'minimal' ? 0 : 10, transition: { duration: level === 'reduced' ? 0 : 0.14 } }}
            transition={enter}
          >
            <SearchPanel onClose={onClose} onSelect={onSelect} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function SearchPanel({ onClose, onSelect }: { onClose: () => void; onSelect: (href: string) => void }) {
  const level = useMotionLevel()
  const { docs, loadingExtra, extraError, retry } = useSearchDocs()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  // A short debounce keeps typing smooth on older phones; it's all local, so it can be brief.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(text)
      setActive(0)
    }, 90)
    return () => window.clearTimeout(t)
  }, [text])

  const hits = useMemo(() => searchDocs(docs, query), [docs, query])
  const groups = useMemo(() => groupHits(hits), [hits])
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])
  const optionId = (h: SearchHit) => `${listId}-${h.kind}-${h.id}`
  const current = flat[Math.min(active, flat.length - 1)]

  useEffect(() => {
    if (!current) return
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, current?.id])

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0))
    } else if (e.key === 'Enter' && current) {
      e.preventDefault()
      onSelect(current.href)
    }
  }

  const searching = normaliseLength(query) > 0
  const status = !searching ? '' : flat.length === 0 ? `No results for ${query.trim()}` : `${flat.length} result${flat.length === 1 ? '' : 's'}`

  return (
    <>
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-4 pb-3 lg:pt-4" style={{ paddingTop: 'max(12px, calc(var(--safe-top) + 10px))' }}>
        <div className="relative min-w-0 flex-1">
          <Search size={20} className="text-ink-2 pointer-events-none absolute top-1/2 left-4 -translate-y-1/2" aria-hidden />
          <input
            ref={inputRef}
            data-autofocus
            type="search"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(current) : undefined}
            aria-label="Search the flat"
            placeholder="Search rooms, items, essentials…"
            className="field pr-11 pl-11"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={80}
          />
          {text && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText('')
                inputRef.current?.focus()
              }}
              className="pressable text-ink-2 absolute top-1/2 right-1 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full"
            >
              <X size={18} aria-hidden />
            </button>
          )}
        </div>
        <button type="button" onClick={onClose} className="pressable text-accent-ink min-h-11 shrink-0 rounded-xl px-2 font-bold">
          Cancel
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
        {!searching ? (
          <div className="px-4 py-10 text-center" data-testid="search-intro">
            <p className="text-[17px] font-bold">Find anything in the flat</p>
            <p className="text-ink-2 mt-1 text-[15px]">Rooms, furnishing items, product options, wishlist ideas, essentials, tasks and Visual Home titles.</p>
          </div>
        ) : flat.length === 0 ? (
          <div className="px-4 py-10 text-center" data-testid="search-empty">
            {loadingExtra ? (
              <p className="text-ink-2 text-[15px]">Searching…</p>
            ) : (
              <>
                <p className="text-[17px] font-bold">No matches for “{query.trim()}”</p>
                <p className="text-ink-2 mt-1 text-[15px]">Try fewer letters or a different word.</p>
              </>
            )}
          </div>
        ) : (
          <ul id={listId} role="listbox" aria-label="Search results" className="pb-2">
            {groups.map((g) => (
              <li key={g.kind} role="presentation">
                <p className="text-ink-2 px-3 pt-3 pb-1 text-[13px] font-bold" role="presentation">
                  {g.label}
                </p>
                <ul role="presentation">
                  {g.hits.map((h) => {
                    const selected = current?.kind === h.kind && current.id === h.id
                    return (
                      <motion.li
                        key={`${h.kind}-${h.id}`}
                        id={optionId(h)}
                        role="option"
                        aria-selected={selected}
                        data-testid="search-result"
                        initial={level === 'reduced' || level === 'minimal' ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.14 }}
                        onClick={() => onSelect(h.href)}
                        onMouseMove={() => setActive(flat.indexOf(h))}
                        className={`pressable flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 ${selected ? 'bg-accent-soft' : ''}`}
                      >
                        <ResultIcon hit={h} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{h.title}</span>
                          <span className="text-ink-2 block truncate text-[13px]">{h.context}</span>
                        </span>
                        {selected && <CornerDownLeft size={16} className="text-ink-3 hidden shrink-0 lg:block" aria-hidden />}
                      </motion.li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {searching && extraError && (
          <p className="text-ink-2 px-4 pt-2 text-[13px]" role="status">
            Wishlist and Visual Home couldn’t be searched just now.{' '}
            <button type="button" className="text-accent-ink font-bold underline" onClick={retry}>
              Try again
            </button>
          </p>
        )}
      </div>
    </>
  )
}

const normaliseLength = (s: string) => s.trim().length

function ResultIcon({ hit }: { hit: SearchHit }) {
  if (hit.kind === 'room') {
    const c = roomColor(hit.roomColor ?? 'blue')
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ backgroundColor: c.hex, color: c.on }} aria-hidden>
        <RoomIcon name={hit.roomIcon ?? 'house'} size={20} />
      </span>
    )
  }
  const Icon = ICON[hit.kind]
  return (
    <span className="bg-surface-2 text-ink-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" aria-hidden>
      <Icon size={19} />
    </span>
  )
}
