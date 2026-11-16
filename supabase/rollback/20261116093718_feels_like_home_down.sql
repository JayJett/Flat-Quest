-- EMERGENCY ONLY. Reverses 20261116093718_feels_like_home.sql.
-- Removes room covers and descriptions (the photos themselves stay in Visual Home) and restores
-- the Phase 8 reminder function. Redeploy the previous app version first.
begin;
drop trigger if exists rooms_personality_guard on public.rooms;
drop function if exists private.room_personality_guard();
alter table public.rooms drop constraint if exists rooms_cover_same_room;
drop index if exists public.rooms_cover_visual_idx;
alter table public.rooms drop column if exists cover_visual_id, drop column if exists description;
-- Phase 8 reminders, as shipped in 20261116070905_find_focus_finetune.sql.
create or replace function private.send_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  rec record;
  v_today date;
  v_event bigint;
  v_sent integer := 0;
begin
  for rec in
    select t.id, t.household_id, t.title, t.assignee_id, t.due_on, t.room_id,
           (p_now at time zone coalesce(nullif(h.settings->>'timezone', ''), 'Pacific/Auckland'))::date as today
      from public.household_tasks t join public.households h on h.id = t.household_id
     where t.status <> 'done' and t.archived_at is null and t.assignee_id is not null and t.due_on is not null
  loop
    v_today := rec.today;
    for stage in 1..2 loop
      continue when stage = 1 and not (rec.due_on < v_today and rec.due_on >= v_today - 14);
      continue when stage = 2 and not (rec.due_on <= v_today - 3 and rec.due_on >= v_today - 14);
      insert into private.reminders_sent (kind, target_id, cycle, stage, household_id, recipient_id)
      values ('task', rec.id, rec.due_on::text, stage, rec.household_id, rec.assignee_id)
      on conflict do nothing;
      continue when not found;
      v_event := private.record_event(rec.household_id, 'task_reminder', null, false,
        jsonb_build_object('task', rec.title, 'due', rec.due_on, 'stage', stage), p_room => rec.room_id, p_subject => rec.assignee_id);
      update public.household_events set task_id = rec.id where id = v_event;
      perform private.notify(v_event, array[rec.assignee_id], 'reminder', 'personal');
      perform private.drop_if_unused(v_event);
      v_sent := v_sent + 1;
    end loop;
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
commit;
