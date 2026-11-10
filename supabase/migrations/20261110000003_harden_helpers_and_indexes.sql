-- Flat Quest — advisor follow-ups
-- 1. user_in_household() is reachable via /rest/v1/rpc. Without a guard any
--    signed-in user could probe whether arbitrary users belong to arbitrary
--    households. It now only answers for households the caller belongs to.
--    (Its only internal caller, items_guard, runs for members anyway.)
create or replace function public.user_in_household(p_user uuid, p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members caller
    where caller.household_id = p_household and caller.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = p_user
  );
$$;

-- 2. Covering indexes for foreign keys flagged by the performance advisor.
create index if not exists items_room_household_idx on public.items (room_id, household_id);
create index if not exists items_owner_idx on public.items (owner_user_id) where owner_user_id is not null;
create index if not exists items_completed_by_idx on public.items (completed_by) where completed_by is not null;
create index if not exists items_created_by_idx on public.items (created_by) where created_by is not null;
create index if not exists households_created_by_idx on public.households (created_by);
create index if not exists household_invites_created_by_idx on public.household_invites (created_by);
