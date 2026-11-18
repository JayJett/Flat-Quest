-- EMERGENCY ONLY. Reverses 20261118004453_shared_week.sql.
--
-- Prefer reverting the frontend and KEEPING this schema: it is additive, and the previous app
-- ignores it. Run this only if the schema itself must go, and only after exporting appointments:
--   \copy (select * from public.calendar_appointments) to 'calendar_appointments_export.csv' csv header
-- The script refuses to drop appointments unless you confirm the export, e.g.
--   PGOPTIONS='-c flatquest.appointments_exported=yes' psql ... -f this_file.sql
-- or, in an interactive session before running it:
--   set flatquest.appointments_exported = 'yes';
-- Household time-zone settings are kept (they are ordinary settings the reminder job used before).
begin;
do $$
begin
  if exists (select 1 from public.calendar_appointments)
     and coalesce(current_setting('flatquest.appointments_exported', true), '') <> 'yes' then
    raise exception 'calendar_appointments has rows: export them, then set flatquest.appointments_exported = ''yes''';
  end if;
end $$;
alter publication supabase_realtime drop table public.calendar_appointments;
drop function if exists public.cancel_appointment(uuid, integer);
drop function if exists public.set_appointment_cover(uuid, integer, text);
drop function if exists public.save_appointment(uuid, uuid, integer, text, text, uuid, date, time, time, boolean);
drop function if exists private.appointment_json(public.calendar_appointments);
drop table if exists public.calendar_appointments;
drop function if exists private.appointments_revision();
drop function if exists private.local_instant(date, time, text);
drop function if exists public.set_household_timezone(uuid, text);
drop trigger if exists households_settings_guard on public.households;
drop function if exists private.households_settings_guard();
-- Phase 9 reminders, as shipped in 20261116093718_feels_like_home.sql.
create or replace function private.send_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  rec record;
  v_stage smallint;
  v_event bigint;
  v_sent integer := 0;
begin
  for rec in
    select t.id, t.household_id, t.title, t.assignee_id, t.due_on, t.room_id,
           (p_now at time zone coalesce(nullif(h.settings->>'timezone', ''), 'Pacific/Auckland'))::date as today
      from public.household_tasks t join public.households h on h.id = t.household_id
     where t.status <> 'done' and t.archived_at is null and t.assignee_id is not null and t.due_on is not null
  loop
    continue when not (rec.due_on < rec.today and rec.due_on >= rec.today - 14);
    v_stage := case when rec.due_on <= rec.today - 3 then 2 else 1 end;
    if v_stage = 2 then
      -- Skipping straight to the follow-up: the first nudge is no longer appropriate.
      insert into private.reminders_sent (kind, target_id, cycle, stage, household_id, recipient_id)
      values ('task', rec.id, rec.due_on::text, 1, rec.household_id, rec.assignee_id)
      on conflict do nothing;
    end if;
    insert into private.reminders_sent (kind, target_id, cycle, stage, household_id, recipient_id)
    values ('task', rec.id, rec.due_on::text, v_stage, rec.household_id, rec.assignee_id)
    on conflict do nothing;
    continue when not found;
    v_event := private.record_event(rec.household_id, 'task_reminder', null, false,
      jsonb_build_object('task', rec.title, 'due', rec.due_on, 'stage', v_stage), p_room => rec.room_id, p_subject => rec.assignee_id);
    update public.household_events set task_id = rec.id where id = v_event;
    perform private.notify(v_event, array[rec.assignee_id], 'reminder', 'personal');
    perform private.drop_if_unused(v_event);
    v_sent := v_sent + 1;
  end loop;

  for rec in
    select e.id, e.household_id, e.name, e.needed_by, e.needed_at
      from public.essentials e
     where e.status = 'needed' and e.claimed_by is null and e.archived_at is null and e.needed_by is not null
       and e.needed_at <= p_now - interval '3 days' and e.needed_at > p_now - interval '30 days'
  loop
    insert into private.reminders_sent (kind, target_id, cycle, stage, household_id, recipient_id)
    values ('essential', rec.id, rec.needed_at::text, 1, rec.household_id, rec.needed_by)
    on conflict do nothing;
    continue when not found;
    v_event := private.record_event(rec.household_id, 'essential_reminder', null, false,
      jsonb_build_object('essential', rec.name, 'days', floor(extract(epoch from p_now - rec.needed_at) / 86400)::int), p_subject => rec.needed_by);
    update public.household_events set essential_id = rec.id where id = v_event;
    perform private.notify(v_event, array[rec.needed_by], 'reminder', 'personal');
    perform private.drop_if_unused(v_event);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;
revoke all on function private.send_reminders(timestamptz) from public, anon, authenticated;
drop function if exists private.household_zone(jsonb);
drop function if exists private.valid_time_zone(text);
commit;
