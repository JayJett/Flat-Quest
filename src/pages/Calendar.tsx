import { ChevronLeft, ChevronRight, DoorOpen, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/AppShell'
import { Button, EmptyState, IconButton, SkeletonRows } from '@/components/ui'
import { AppointmentSheet, type SheetTarget } from '@/calendar/AppointmentSheet'
import { addDays, dayLabel, mondayOf, timeLabel, weekFromParam, type CivilDate } from '@/calendar/dates'
import { groupByDay, KIND_LABEL, type CalendarEntry } from '@/calendar/entries'
import { useWeek, type Source } from '@/calendar/useWeek'
import { useHousehold } from '@/household/HouseholdProvider'
import { useAuth } from '@/auth/AuthProvider'

const SOURCE_LABEL: Record<Source, string> = { tasks: 'Things to do', purchases: 'Deliveries and pickups', appointments: 'Appointments' }

export function CalendarPage() {
  const { household } = useHousehold()
  const [params, setParams] = useSearchParams()
  const zoneProbe = useWeekZone()
  const monday = weekFromParam(params.get('week'), zoneProbe)
  const week = useWeek(monday)
  const thisWeek = mondayOf(week.today)
  const [target, setTarget] = useState<SheetTarget | null>(null)

  // A shared link can open one appointment directly.
  const wanted = params.get('appointment')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consuming a one-off URL parameter
    if (wanted) setTarget({ mode: 'view', id: wanted })
  }, [wanted])
  const closeSheet = () => {
    setTarget(null)
    if (wanted) setParams((p) => { p.delete('appointment'); return p }, { replace: true })
  }

  const goWeek = (m: CivilDate) => setParams((p) => {
    const next = new URLSearchParams(p)
    next.delete('appointment')
    if (m === thisWeek) next.delete('week')
    else next.set('week', m)
    return next
  })

  const groups = useMemo(() => groupByDay(week.entries, week.days), [week.entries, week.days])
  const needCover = week.entries.filter((e) => e.appointment?.needs_cover && !e.appointment.host_id).length
  const failed = (Object.keys(week.errors) as Source[])
  const range = `${dayLabel(week.days[0]!)} – ${dayLabel(week.days[6]!)}`
  const heading = monday === thisWeek ? 'This week' : monday === addDays(thisWeek, 7) ? 'Next week' : monday === addDays(thisWeek, -7) ? 'Last week' : `Week of ${dayLabel(monday)}`
  const addDate = monday === thisWeek ? week.today : monday

  return (
    <>
      <PageHeader
        title="Calendar"
        hideTitleUntilScroll
        actions={
          <IconButton label="Add an appointment" onClick={() => setTarget({ mode: 'new', date: addDate })}>
            <Plus size={24} aria-hidden />
          </IconButton>
        }
      />
      <div className="px-4 lg:max-w-2xl lg:px-0">
        <div className="pt-2 pb-4">
          <h1 className="text-display font-extrabold">{heading}</h1>
          <p className="text-ink-2 mt-1 text-[15px]">
            {range} · {household?.name} · <span data-testid="flat-zone">{week.zone.replace(/_/g, ' ')}</span>
          </p>
        </div>

        <nav aria-label="Week" className="flex items-center gap-2">
          <IconButton label="Previous week" onClick={() => goWeek(addDays(monday, -7))} className="bg-surface-2">
            <ChevronLeft size={22} aria-hidden />
          </IconButton>
          <Button variant="secondary" size="sm" className="min-h-11 flex-1" onClick={() => goWeek(thisWeek)} disabled={monday === thisWeek} aria-label="This week">
            This week
          </Button>
          <IconButton label="Next week" onClick={() => goWeek(addDays(monday, 7))} className="bg-surface-2">
            <ChevronRight size={22} aria-hidden />
          </IconButton>
        </nav>

        {!week.loading && needCover > 0 && (
          <p className="bg-accent-soft mt-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-semibold" role="status">
            <DoorOpen size={18} aria-hidden /> {needCover} {needCover === 1 ? 'appointment needs' : 'appointments need'} someone home
          </p>
        )}

        {failed.map((s) => (
          <div key={s} role="alert" className="bg-danger-soft text-danger mt-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[15px]" data-testid={`source-error-${s}`}>
            <span><strong className="font-semibold">{SOURCE_LABEL[s]}</strong> couldn’t load. The rest of the week is shown.</span>
            <button type="button" className="min-h-11 shrink-0 px-2 font-semibold underline" onClick={() => void week.reload([s])}>Try again</button>
          </div>
        ))}

        {week.loading && week.entries.length === 0 ? (
          <div className="mt-6"><SkeletonRows label="Loading the week" rows={4} /></div>
        ) : week.entries.length === 0 && failed.length === 0 ? (
          <EmptyState
            title={monday === thisWeek ? 'A quiet week' : 'Nothing planned'}
            body="Due tasks, expected deliveries and appointments for this week show up here."
            action={<Button onClick={() => setTarget({ mode: 'new', date: addDate })} icon={<Plus size={18} aria-hidden />}>Add an appointment</Button>}
          />
        ) : (
          <div className="mt-2">
            {groups.map(({ date, entries }) => (
              <section key={date} aria-labelledby={`day-${date}`} className="mt-5" data-testid="calendar-day" data-date={date}>
                <h2 id={`day-${date}`} className="flex items-baseline gap-2 text-[17px] font-bold">
                  {dayLabel(date, 'long')}
                  {date === week.today && <span className="bg-ink rounded-full px-2 py-0.5 text-[12px] font-bold text-white">Today</span>}
                </h2>
                {entries.length === 0 ? (
                  <p className="text-ink-3 mt-1 text-[14px]">Nothing planned</p>
                ) : (
                  <ul className="mt-1">
                    {entries.map((e) => <EntryRow key={e.key} entry={e} zone={week.zone} onOpen={() => setTarget({ mode: 'view', id: e.appointment!.id })} />)}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
      <AppointmentSheet target={target} zone={week.zone} rows={week.appointments} onClose={closeSheet} onSaved={week.apply} />
    </>
  )
}

/** The flat's zone without the week hook (needed to read the week from the URL first). */
function useWeekZone() {
  const { household } = useHousehold()
  const settings = household?.settings as Record<string, unknown> | null
  return typeof settings?.timezone === 'string' ? settings.timezone : 'Pacific/Auckland'
}

function EntryRow({ entry: e, zone, onOpen }: { entry: CalendarEntry; zone: string; onOpen: () => void }) {
  const { user } = useAuth()
  const { memberById, rooms } = useHousehold()
  const person = e.personId ? memberById.get(e.personId) : null
  const personName = person ? (person.userId === user?.id ? 'You' : person.profile.display_name || 'A flatmate') : null
  const room = e.roomId ? rooms.find((r) => r.id === e.roomId)?.name : null
  const when = e.timed && e.startsAt && e.endsAt
    ? `${timeLabel(e.startsAt, zone)} – ${e.endsOn ? `${dayLabel(e.endsOn)} ` : ''}${timeLabel(e.endsAt, zone)}`
    : e.kind === 'task' ? 'Due' : e.kind === 'appointment' ? 'All day' : 'Expected'
  const a = e.appointment
  const status = a?.needs_cover
    ? (a.host_id ? `${personName ?? 'A flatmate'} ${personName === 'You' ? 'are' : 'is'} home` : 'Needs someone home')
    : e.kind === 'task' ? (personName ? `For ${personName === 'You' ? 'you' : personName}` : 'Anyone')
      : e.kind !== 'appointment' && personName ? `Sorted by ${personName === 'You' ? 'you' : personName}` : null
  const body = (
    <>
      <span className="text-ink-2 w-[72px] shrink-0 pt-0.5 text-[13px] leading-tight font-semibold tabular-nums">{when}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="bg-surface-2 text-ink rounded-md px-1.5 py-0.5 text-[12px] font-bold">{KIND_LABEL[e.kind]}</span>
          {e.overdue && <span className="text-danger text-[12px] font-bold">Overdue</span>}
        </span>
        <span className="mt-0.5 block text-[16px] leading-snug font-semibold [overflow-wrap:anywhere]">{e.title}</span>
        {(room || status) && (
          <span className="text-ink-2 block text-[14px]">
            {[room, status].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </>
  )
  const cls = 'pressable active:bg-surface-2 -mx-2 flex min-h-14 w-[calc(100%+16px)] items-start gap-3 rounded-2xl px-2 py-2.5 text-left'
  return (
    <li data-testid="calendar-entry" data-kind={e.kind} data-key={e.key}>
      {e.href ? <Link to={e.href} className={cls}>{body}</Link> : <button type="button" onClick={onOpen} className={cls}>{body}</button>}
    </li>
  )
}
