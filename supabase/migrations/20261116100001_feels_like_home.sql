-- Phase 9 — Feels like home: shared room covers and descriptions; one reminder per task per run.
--
-- Additive. Existing rooms keep their name, icon, colour and order; both new columns start
-- empty. No reminder history is changed. Recovery:
-- supabase/rollback/20261116100001_feels_like_home_down.sql.

-- ───────────────────────── 1. Room personality ─────────────────────────
-- A short shared description, and an optional cover chosen from the room's own Visual Home
-- photos. The cover is a reference to an existing image record — no file is copied.
alter table public.rooms
  add column description text check (char_length(description) <= 120),
  add column cover_visual_id uuid;

-- The composite key means the database itself guarantees a cover belongs to the same room in
-- the same flat. Deleting the photo clears the cover (the room simply goes back to its colour).
alter table public.rooms
  add constraint rooms_cover_same_room foreign key (cover_visual_id, id, household_id)
    references public.room_visuals (id, room_id, household_id) on delete set null (cover_visual_id);
create index rooms_cover_visual_idx on public.rooms (cover_visual_id) where cover_visual_id is not null;

-- Only real photos (not link-only inspiration) can be covers; descriptions are tidied.
create function private.room_personality_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.description := nullif(regexp_replace(trim(coalesce(new.description, '')), '\s+', ' ', 'g'), '');
  if new.cover_visual_id is not null
     and (tg_op = 'INSERT' or new.cover_visual_id is distinct from old.cover_visual_id)
     and not exists (select 1 from public.room_visuals v
                      where v.id = new.cover_visual_id and v.room_id = new.id and v.household_id = new.household_id
                        and coalesce(v.thumbnail_path, v.photo_path) is not null) then
    raise exception 'Choose a photo from this room’s Visual Home' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.room_personality_guard() from public, anon, authenticated;
create trigger rooms_personality_guard before insert or update of description, cover_visual_id on public.rooms
  for each row execute function private.room_personality_guard();

-- ───────────────────────── 2. Reminders: one per task per run ─────────────────────────
-- Phase 8 could send both the first nudge and the follow-up in the same run for a task that
-- was already 3+ days overdue when it first became eligible. Now each run picks the single
-- stage that fits the task's age; choosing the follow-up also marks the first nudge as
-- handled, so it can never arrive afterwards. Idempotency (the primary key) is unchanged.
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
