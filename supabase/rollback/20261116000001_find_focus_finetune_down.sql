-- EMERGENCY ONLY. Reverses 20261116000001_find_focus_finetune.sql.
-- Removes notification preferences, reminders (and their notifications) and essential amounts.
-- Nothing from Phases 1–7 is touched. Redeploy the previous app version first.
begin;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'flatquest-gentle-reminders'$q$;
  end if;
end $$;
drop function if exists private.send_reminders(timestamptz);
drop table if exists private.reminders_sent;
delete from public.household_events where type in ('task_reminder','essential_reminder');
delete from public.notifications where reason = 'reminder';
alter table public.notifications drop constraint notifications_reason_check;
alter table public.notifications add constraint notifications_reason_check check (reason in ('mention','reply','discussion',
  'assigned','unassigned','responsible','handover','takeover','milestone','member','ownership'));
alter table public.household_events drop constraint household_events_type_check;
alter table public.household_events add constraint household_events_type_check check (type in (
  'history_started','item_added','item_completed','purchase_stage','item_assigned','item_unassigned',
  'option_added','option_selected','coordination_claimed','coordination_handover','coordination_takeover',
  'room_completed','transformation_added','photos_added','idea_added','comment_added','comment_mention',
  'member_joined','member_left','member_removed','ownership_transferred','member_limit_changed',
  'essential_needed','essential_claimed','essential_handover','essential_takeover','essential_restocked',
  'task_added','task_assigned','task_unassigned','task_completed'));
-- Restore the Phase 6 notify() without preference filtering.
create or replace function private.notify(p_event bigint, p_recipients uuid[], p_reason text, p_category text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_event public.household_events%rowtype; v_count integer;
begin
  select * into v_event from public.household_events where id = p_event;
  insert into public.notifications (event_id, household_id, recipient_id, reason, category)
  select p_event, v_event.household_id, r, p_reason, p_category
    from (select distinct unnest(p_recipients) as r) s
   where r is not null and r is distinct from v_event.actor_id and private.user_in_household_unchecked(r, v_event.household_id)
  on conflict (event_id, recipient_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
drop function if exists private.notification_category(text);
alter table public.user_preferences drop column if exists muted_notifications;
alter table public.essentials drop column if exists quantity;
commit;
