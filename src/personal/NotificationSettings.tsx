import { AlarmClock, AtSign, Lock, PartyPopper, RotateCcw, ShoppingBag, ShoppingBasket, UserRound, type LucideIcon } from 'lucide-react'
import { Switch } from '@/components/ItemSheet'
import { Button } from '@/components/ui'
import { usePreferences, type NotificationCategory } from './PreferencesProvider'

/**
 * Each row maps to the categories the database uses when deciding whether to create a
 * notification (private.notification_category). Turning one off stops new notifications of
 * that kind for you only; the shared timeline and anything already in your inbox stay.
 */
const ROWS: { key: NotificationCategory; label: string; hint: string; icon: LucideIcon }[] = [
  { key: 'discussions', label: 'Discussions and mentions', hint: 'Someone @mentions you, replies to you, or comments on something you look after', icon: AtSign },
  { key: 'assignments', label: 'Assignments', hint: 'You’re put on, or taken off, an item or a task', icon: UserRound },
  { key: 'shopping', label: 'Shopping and deliveries', hint: 'Orders, deliveries, picks and who’s buying things you’re on', icon: ShoppingBag },
  { key: 'home', label: 'Tasks and essentials', hint: 'Your tasks get done, and pick-ups are claimed, handed over or restocked', icon: ShoppingBasket },
  { key: 'reminders', label: 'Gentle reminders', hint: 'A nudge when your task is overdue or an essential you asked for is still waiting', icon: AlarmClock },
  { key: 'milestones', label: 'Milestones', hint: 'A room is finished, a new before-and-after, or someone joins', icon: PartyPopper },
]

export function NotificationSettings() {
  const { prefs, update, reset } = usePreferences()
  const muted = new Set(prefs.muted)
  const toggle = (key: NotificationCategory, on: boolean) => {
    const next = on ? prefs.muted.filter((k) => k !== key) : [...prefs.muted, key]
    void update({ muted: next })
  }
  return (
    <section aria-labelledby="notify-h" data-testid="notification-settings">
      <h2 id="notify-h" className="text-title font-bold">
        Notifications
      </h2>
      <p className="text-ink-2 mt-1 text-[15px]">Choose what reaches your bell. Only affects you — everything still shows in Around the flat.</p>
      <ul className="mt-4">
        {ROWS.map((r) => {
          const on = !muted.has(r.key)
          return (
            <li key={r.key} className="border-line flex min-h-[72px] items-center gap-3 border-b py-2.5 last:border-b-0">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${on ? 'bg-accent-soft text-accent-ink' : 'bg-surface-2 text-ink-2'}`}>
                <r.icon size={19} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.label}</p>
                <p className="text-ink-2 text-[13px] leading-snug">{r.hint}</p>
              </div>
              <Switch tone="accent" checked={on} label={r.label} onChange={(v) => toggle(r.key, v)} />
            </li>
          )
        })}
        <li className="flex min-h-[72px] items-center gap-3 py-2.5" data-testid="notifications-always-on">
          <span className="bg-surface-2 text-ink-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <Lock size={17} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Flat membership</p>
            <p className="text-ink-2 text-[13px] leading-snug">Someone leaves, is removed, or ownership changes. Always on, so nobody misses it.</p>
          </div>
        </li>
      </ul>
      <Button variant="ghost" className="text-ink-2 mt-1 -ml-2" disabled={prefs.muted.length === 0} icon={<RotateCcw size={18} aria-hidden />} onClick={() => void reset(['muted'])}>
        Turn everything back on
      </Button>
    </section>
  )
}
