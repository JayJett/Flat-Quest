-- EMERGENCY ONLY. Reverses 20261115000001_connected_living.sql.
--
-- This DELETES all discussions, notifications and activity history recorded since Phase 6.
-- No checklist, wishlist, shopping, Visual Home or membership data is touched, and the
-- previous "leave household" behaviour is restored.
--
-- It is NOT a migration and is never applied automatically. Redeploy the previous app
-- version first, then check what would be lost:
--   select count(*) from public.comments;
--   select count(*) from public.household_events;

begin;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'flatquest-notification-retention'$q$;
  end if;
end $$;

alter publication supabase_realtime drop table public.household_events, public.notifications, public.comments;

drop trigger if exists households_history_start on public.households;
drop trigger if exists household_members_events on public.household_members;
drop trigger if exists items_events on public.items;
drop trigger if exists item_assignees_events on public.item_assignees;
drop trigger if exists product_options_events on public.product_options;
drop trigger if exists purchase_coordinators_events on public.purchase_coordinators;
drop trigger if exists room_transformations_events on public.room_transformations;
drop trigger if exists room_visuals_events on public.room_visuals;
drop trigger if exists wishlist_items_events on public.wishlist_items;

drop function if exists public.leave_household(uuid);
drop function if exists public.remove_household_member(uuid, uuid);
drop function if exists public.transfer_household_ownership(uuid, uuid);
drop function if exists public.set_member_limit(uuid, integer);
drop function if exists public.member_departure_summary(uuid, uuid);
drop function if exists public.mark_all_notifications_read(uuid);

drop policy if exists "events: members read timeline and their own" on public.household_events;
drop table if exists public.notifications;
drop table if exists public.comments;
drop table if exists public.household_events;

drop function if exists private.households_history_start(), private.prune_connected_living(),
  private.depart(uuid, uuid, text), private.members_events(), private.comments_events(), private.ideas_events(),
  private.visual_events(), private.coordinators_events(), private.options_events(), private.assignees_events(),
  private.items_events(), private.item_context(uuid), private.item_responsible(uuid), private.drop_if_unused(bigint),
  private.notify(bigint, uuid[], text, text),
  private.record_event(uuid, text, uuid, boolean, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, uuid),
  private.comments_guard(), private.display_name(uuid), private.notifications_guard();

drop index if exists public.household_members_one_owner;
grant delete on public.household_members to authenticated;
create policy "members: leave household" on public.household_members
  for delete to authenticated using (user_id = (select auth.uid()));

commit;
