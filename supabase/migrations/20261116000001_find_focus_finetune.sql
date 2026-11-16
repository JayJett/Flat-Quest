-- Phase 8 — Find, focus & fine-tune: per-user notification preferences (enforced where
-- notifications are created), gentle scheduled reminders, and an optional amount for essentials.
--
-- Additive. No existing row is modified; Home layout normalisation happens in the app on read
-- so nobody's saved preferences are rewritten. Recovery:
-- supabase/rollback/20261116000001_find_focus_finetune_down.sql.

-- ───────────────────────── 1. Notification preferences ─────────────────────────
-- Categories a person can mute. Flat membership and ownership notices are deliberately not
-- in this list, so they can never be switched off.
alter table public.user_preferences
  add column muted_notifications text[] not null default '{}'
    check (muted_notifications <@ array['discussions','assignments','shopping','home','reminders','milestones']::text[]);
grant insert (muted_notifications), update (muted_notifications) on public.user_preferences to authenticated;

-- Which preference governs each kind of event. Anything unknown is 'membership' (never muted).
create function private.notification_category(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_type in ('comment_added','comment_mention') then 'discussions'
    when p_type in ('item_assigned','item_unassigned','task_assigned','task_unassigned') then 'assignments'
    when p_type in ('purchase_stage','option_selected','coordination_claimed','coordination_handover',
                    'coordination_takeover','item_completed') then 'shopping'
    when p_type in ('task_completed','essential_claimed','essential_handover','essential_takeover','essential_restocked') then 'home'
    when p_type in ('task_reminder','essential_reminder') then 'reminders'
    when p_type in ('room_completed','transformation_added','member_joined') then 'milestones'
    else 'membership'
  end;
$$;

-- The single place notifications are created (Phase 6). Now also skips anyone who has muted
-- this kind of notification. Shared history (the timeline) is unaffected, existing
-- notifications are never deleted, and unmuting only affects new events.
create or replace function private.notify(p_event bigint, p_recipients uuid[], p_reason text, p_category text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.household_events%rowtype;
  v_count integer;
  v_pref text;
begin
  select * into v_event from public.household_events where id = p_event;
  v_pref := private.notification_category(v_event.type);
  insert into public.notifications (event_id, household_id, recipient_id, reason, category)
  select p_event, v_event.household_id, r, p_reason, p_category
    from (select distinct unnest(p_recipients) as r) s
   where r is not null and r is distinct from v_event.actor_id
     and private.user_in_household_unchecked(r, v_event.household_id)
     and not exists (select 1 from public.user_preferences p where p.user_id = r and v_pref = any (p.muted_notifications))
  on conflict (event_id, recipient_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ───────────────────────── 2. Gentle reminders ─────────────────────────
alter table public.household_events drop constraint household_events_type_check;
alter table public.household_events add constraint household_events_type_check check (type in (
  'history_started','item_added','item_completed','purchase_stage','item_assigned','item_unassigned',
  'option_added','option_selected','coordination_claimed','coordination_handover','coordination_takeover',
  'room_completed','transformation_added','photos_added','idea_added','comment_added','comment_mention',
  'member_joined','member_left','member_removed','ownership_transferred','member_limit_changed',
  'essential_needed','essential_claimed','essential_handover','essential_takeover','essential_restocked',
  'task_added','task_assigned','task_unassigned','task_completed',
  'task_reminder','essential_reminder'));
alter table public.notifications drop constraint notifications_reason_check;
alter table public.notifications add constraint notifications_reason_check check (reason in ('mention','reply','discussion',
  'assigned','unassigned','responsible','handover','takeover','milestone','member','ownership','reminder'));

-- One row per reminder ever sent. The primary key makes sending idempotent: a retried or
-- overlapping run can't send the same reminder twice. A "cycle" is the due date (tasks) or the
-- moment it was last needed (essentials), so moving a due date or needing something again
-- starts afresh.
create table private.reminders_sent (
  kind text not null check (kind in ('task','essential')),
  target_id uuid not null,
  cycle text not null,
  stage smallint not null,
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_id uuid,
  sent_at timestamptz not null default now(),
  primary key (kind, target_id, cycle, stage)
);
create index reminders_sent_household_idx on private.reminders_sent (household_id);
alter table private.reminders_sent enable row level security;
revoke all on private.reminders_sent from public, anon, authenticated;

-- Runs hourly. Rules (calendar dates are the flat's own, default Pacific/Auckland):
--   • Assigned task, not done or archived, due date has passed → one friendly nudge to the
--     assignee; if still open 3 days after it was due, one last nudge. Unassigned tasks never
--     nudge anyone (no flat-wide nagging).
--   • Essential still needed and unclaimed for 3 days → one nudge to whoever asked for it.
-- Only recent conditions are considered (tasks due in the last 14 days, essentials needed in
-- the last 30), so turning this on can't produce a burst about old items.
create function private.send_reminders(p_now timestamptz default now()) returns integer
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
revoke all on function private.send_reminders(timestamptz), private.notification_category(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('flatquest-gentle-reminders', '23 * * * *', 'select private.send_reminders()');
  end if;
end $$;

-- ───────────────────────── 3. Essentials: optional amount ─────────────────────────
-- "Two packs", "24-roll pack", "Large bottle". Free text, optional, never counted.
alter table public.essentials add column quantity text check (char_length(quantity) <= 40);
grant insert (quantity), update (quantity) on public.essentials to authenticated;

create or replace function private.essentials_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  new.name := regexp_replace(trim(new.name), '\s+', ' ', 'g');
  new.note := nullif(trim(coalesce(new.note, '')), '');
  new.quantity := nullif(trim(coalesce(new.quantity, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := v_uid;
    new.created_at := now();
    if new.status not in ('needed','stocked') then new.status := 'needed'; end if;
    new.claimed_by := null;
    new.archived_at := null;
    new.restocked_at := null; new.restocked_by := null;
    if new.status = 'needed' then new.needed_at := now(); new.needed_by := v_uid;
    else new.needed_at := null; new.needed_by := null; end if;
  else
    if new.household_id <> old.household_id then
      raise exception 'Essentials cannot move between flats' using errcode = '42501';
    end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    if new.claimed_by is null and new.status = 'getting' then new.status := 'needed'; end if;
    if new.archived_at is not null and old.archived_at is null then
      new.archived_at := now(); new.status := 'stocked'; new.claimed_by := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
