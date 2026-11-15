-- EMERGENCY ONLY. Reverses 20261116000001_living_mode.sql.
--
-- This DELETES all essentials, restock history, household tasks and personal preferences,
-- and the activity/notifications those created. Furnishing, shopping, Visual Home,
-- discussions and membership data are not touched.
--
-- Not a migration; never applied automatically. Redeploy the previous app version first.
--   select count(*) from public.essentials; select count(*) from public.household_tasks;

begin;
alter publication supabase_realtime drop table public.essentials, public.essential_restocks, public.household_tasks, public.user_preferences;

drop trigger if exists essentials_events on public.essentials;
drop trigger if exists household_tasks_events on public.household_tasks;
drop function if exists public.update_essential(uuid, text, text, uuid);
drop table if exists public.essential_restocks;
drop table if exists public.essentials;
drop table if exists public.household_tasks;
drop table if exists public.user_preferences;
drop function if exists private.essentials_guard(), private.tasks_guard(), private.preferences_guard(),
  private.essentials_events(), private.tasks_events();

delete from public.household_events where type in ('essential_needed','essential_claimed','essential_handover',
  'essential_takeover','essential_restocked','task_added','task_assigned','task_unassigned','task_completed');
drop index if exists public.household_events_essential_idx, public.household_events_task_idx;
alter table public.household_events drop column if exists essential_id, drop column if exists task_id;
alter table public.household_events drop constraint household_events_type_check;
alter table public.household_events add constraint household_events_type_check check (type in (
  'history_started','item_added','item_completed','purchase_stage','item_assigned','item_unassigned',
  'option_added','option_selected','coordination_claimed','coordination_handover','coordination_takeover',
  'room_completed','transformation_added','photos_added','idea_added','comment_added','comment_mention',
  'member_joined','member_left','member_removed','ownership_transferred','member_limit_changed'));
commit;
