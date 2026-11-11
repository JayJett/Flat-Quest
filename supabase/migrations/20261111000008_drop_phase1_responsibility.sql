-- Flat Quest — Phase 2 / 08: "contract" step for shared responsibility.
-- Applied after the app that reads item_assignees was deployed.
--
-- 1. Catch up: anything the old app assigned after migration 04 is copied across.
-- 2. Archive the latest Phase 1 values (private schema), then drop the columns.
-- 3. items_guard and import_checklist no longer reference them; the importer
--    writes matched names to item_assignees ("shared" -> needs_assignees).

insert into public.item_assignees (item_id, household_id, user_id)
select i.id, i.household_id, i.responsible_user_id
from public.items i
join public.household_members m on m.household_id = i.household_id and m.user_id = i.responsible_user_id
where i.responsibility = 'member'
on conflict do nothing;

update public.items set needs_assignees = true
 where responsibility = 'shared'
   and not exists (select 1 from public.item_assignees a where a.item_id = items.id);

insert into private.items_responsibility_phase1 (id, household_id, responsibility, responsible_user_id, archived_at)
select id, household_id, responsibility, responsible_user_id, now()
from public.items;

drop index if exists public.items_responsible_idx;
alter table public.items drop constraint if exists items_check;
alter table public.items drop column responsibility;
alter table public.items drop column responsible_user_id;

create or replace function public.items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.household_id <> old.household_id then
    raise exception 'Items cannot move between households' using errcode = '42501';
  end if;
  if new.owner_user_id is not null
     and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
     and not private.user_in_household(new.owner_user_id, new.household_id) then
    raise exception 'Owner must be a household member' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    if new.is_complete then
      new.completed_at := now();
      new.completed_by := (select auth.uid());
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
  elsif new.is_complete is distinct from old.is_complete then
    if new.is_complete then
      new.completed_at := now();
      new.completed_by := (select auth.uid());
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function public.import_checklist(p_household uuid, p_rows jsonb)
returns table (rooms_created int, items_created int, items_skipped int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        jsonb;
  v_room_key   text;
  v_room_id    uuid;
  v_item_key   text;
  v_item_id    uuid;
  v_ord        int := 0;
  v_room_ord   int;
  v_resp_name  text;
  v_own_name   text;
  v_resp_uid   uuid;
  v_own_uid    uuid;
  v_rooms      int := 0;
  v_items      int := 0;
  v_skipped    int := 0;
  v_seen       jsonb := '{}'::jsonb;
  v_n          int;
begin
  if not private.is_household_member(p_household) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Expected an array of at most 1000 rows' using errcode = '22023';
  end if;
  select coalesce(max(sort_order), -1) + 1 into v_room_ord from public.rooms where household_id = p_household;
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if coalesce(trim(v_row ->> 'room'), '') = '' or coalesce(trim(v_row ->> 'name'), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_room_key := 'room:' || lower(trim(v_row ->> 'room'));
    v_room_id := null;
    select id into v_room_id from public.rooms
     where household_id = p_household and import_key = v_room_key;
    if v_room_id is null then
      insert into public.rooms (household_id, name, icon, color, sort_order, import_key)
      values (p_household, left(trim(v_row ->> 'room'), 40),
        coalesce(nullif(v_row ->> 'room_icon', ''), 'home'),
        coalesce(nullif(v_row ->> 'room_color', ''), 'blue'), v_room_ord, v_room_key)
      returning id into v_room_id;
      v_room_ord := v_room_ord + 1;
      v_rooms := v_rooms + 1;
    end if;
    v_item_key := v_room_key || '|' || lower(trim(v_row ->> 'name'));
    v_n := coalesce((v_seen ->> v_item_key)::int, 0) + 1;
    v_seen := v_seen || jsonb_build_object(v_item_key, v_n);
    if v_n > 1 then
      v_item_key := v_item_key || '#' || v_n;
    end if;
    v_resp_name := lower(trim(coalesce(v_row ->> 'responsible', '')));
    v_own_name  := lower(trim(coalesce(v_row ->> 'owned_by', '')));
    v_resp_uid := null;
    v_own_uid  := null;
    if v_resp_name not in ('', 'unclaimed', 'shared') then
      select p.id into v_resp_uid from public.profiles p
        join public.household_members m on m.user_id = p.id and m.household_id = p_household
       where lower(trim(p.display_name)) = v_resp_name limit 1;
    end if;
    if v_own_name not in ('', 'to decide', 'shared', 'landlord') then
      select p.id into v_own_uid from public.profiles p
        join public.household_members m on m.user_id = p.id and m.household_id = p_household
       where lower(trim(p.display_name)) = v_own_name limit 1;
    end if;
    v_item_id := null;
    insert into public.items (
      household_id, room_id, name, priority, status, needs_assignees,
      ownership, owner_user_id, is_complete, estimated_price, actual_price, shopping_url,
      notes, sort_order, import_key
    ) values (
      p_household, v_room_id, left(trim(v_row ->> 'name'), 80),
      coalesce(nullif(v_row ->> 'priority', ''), 'must_have'),
      coalesce(nullif(v_row ->> 'status', ''), 'to_decide'),
      v_resp_name = 'shared',
      case when v_own_uid is not null then 'member'
           when v_own_name = 'shared' then 'shared'
           when v_own_name = 'landlord' then 'landlord' else 'to_decide' end,
      v_own_uid,
      coalesce((v_row ->> 'done')::boolean, false),
      nullif(v_row ->> 'estimated_price', '')::numeric,
      nullif(v_row ->> 'actual_price', '')::numeric,
      nullif(trim(coalesce(v_row ->> 'shopping_url', '')), ''),
      nullif(trim(coalesce(v_row ->> 'notes', '')), ''),
      v_ord, v_item_key
    )
    on conflict (household_id, import_key) do nothing
    returning id into v_item_id;
    if v_item_id is not null then
      v_items := v_items + 1;
      if v_resp_uid is not null then
        insert into public.item_assignees (item_id, household_id, user_id)
        values (v_item_id, p_household, v_resp_uid)
        on conflict do nothing;
      end if;
    else
      v_skipped := v_skipped + 1;
    end if;
    v_ord := v_ord + 1;
  end loop;
  return query select v_rooms, v_items, v_skipped;
end;
$$;
