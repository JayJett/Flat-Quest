-- Flat Quest — Phase 2 / 04: responsibility shared between selected members.
--
-- item_assignees is the single source of truth for who is on an item:
--   0 rows = unclaimed, 1 = individual, 2+ = shared.
-- Composite foreign keys guarantee every assignee is a member of the item's own
-- household, and remove assignments automatically if a member leaves.
--
-- This is the "expand" step: the Phase 1 columns (responsibility,
-- responsible_user_id) stay until the new app is deployed, then a later
-- migration archives and drops them.

alter table public.items add constraint items_id_household_key unique (id, household_id);

create table public.item_assignees (
  item_id       uuid not null,
  household_id  uuid not null,
  user_id       uuid not null,
  created_at    timestamptz not null default now(),
  primary key (item_id, user_id),
  foreign key (item_id, household_id) references public.items (id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index item_assignees_household_idx on public.item_assignees (household_id);
create index item_assignees_user_idx on public.item_assignees (user_id);

-- Phase 1 "Shared" without names: flagged until someone picks the people.
alter table public.items add column needs_assignees boolean not null default false;

-- Backfill individual assignments (only current members; FK would reject others).
insert into public.item_assignees (item_id, household_id, user_id)
select i.id, i.household_id, i.responsible_user_id
from public.items i
join public.household_members m on m.household_id = i.household_id and m.user_id = i.responsible_user_id
where i.responsibility = 'member'
on conflict do nothing;

update public.items set needs_assignees = true where responsibility = 'shared';

-- Keep a private record of the Phase 1 values before anything is dropped later.
create table private.items_responsibility_phase1 as
  select id, household_id, responsibility, responsible_user_id, now() as archived_at
  from public.items;

-- RLS
alter table public.item_assignees enable row level security;
revoke all on public.item_assignees from anon, authenticated;
grant select, insert, delete on public.item_assignees to authenticated;

create policy "assignees: members read" on public.item_assignees
  for select to authenticated using (private.is_household_member(household_id));
create policy "assignees: members add" on public.item_assignees
  for insert to authenticated with check (private.is_household_member(household_id));
create policy "assignees: members remove" on public.item_assignees
  for delete to authenticated using (private.is_household_member(household_id));

-- Replace an item's assignees atomically. SECURITY INVOKER: RLS applies.
create or replace function public.set_item_assignees(p_item uuid, p_users uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_users uuid[] := coalesce(p_users, '{}');
begin
  select household_id into v_household from public.items where id = p_item;
  if v_household is null then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if cardinality(v_users) > 12 then
    raise exception 'Too many people' using errcode = '22023';
  end if;
  delete from public.item_assignees
   where item_id = p_item and not (user_id = any (v_users));
  insert into public.item_assignees (item_id, household_id, user_id)
  select p_item, v_household, u from unnest(v_users) as u
  on conflict do nothing;
  update public.items set needs_assignees = false
   where id = p_item and needs_assignees and cardinality(v_users) > 0;
end;
$$;
revoke execute on function public.set_item_assignees(uuid, uuid[]) from public, anon;
grant execute on function public.set_item_assignees(uuid, uuid[]) to authenticated;

grant update (needs_assignees) on public.items to authenticated;

alter publication supabase_realtime add table public.item_assignees;
