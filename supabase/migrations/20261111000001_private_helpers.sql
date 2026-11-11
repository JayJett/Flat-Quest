-- Flat Quest — Phase 2 / 01: move internal helper functions out of the public API.
-- PostgREST exposes the `public` schema as /rest/v1/rpc/*. The membership helpers
-- are only needed inside RLS policies and other functions, so they move to a
-- non-exposed `private` schema. Policies reference functions by OID, so existing
-- policies keep working; functions that call helpers by name are recreated.

create schema if not exists private;
revoke all on schema private from public;
-- RLS policies run as the calling role, so signed-in users need USAGE + EXECUTE.
grant usage on schema private to authenticated;

alter function public.is_household_member(uuid) set schema private;
alter function public.is_household_owner(uuid) set schema private;
alter function public.shares_household_with(uuid) set schema private;
alter function public.user_in_household(uuid, uuid) set schema private;
alter function public.avatar_owner(text) set schema private;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Recreate functions whose bodies referenced the helpers as public.*
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

  -- Responsibility / ownership may only point at members of this household.
  -- (Existing values are tolerated so a departed member does not lock edits.)
  if new.responsible_user_id is not null
     and (tg_op = 'INSERT' or new.responsible_user_id is distinct from old.responsible_user_id)
     and not private.user_in_household(new.responsible_user_id, new.household_id) then
    raise exception 'Responsible person must be a household member' using errcode = '23514';
  end if;
  if new.owner_user_id is not null
     and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
     and not private.user_in_household(new.owner_user_id, new.household_id) then
    raise exception 'Owner must be a household member' using errcode = '23514';
  end if;

  -- Completion metadata is maintained by the database, not the client.
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
      values (
        p_household,
        left(trim(v_row ->> 'room'), 40),
        coalesce(nullif(v_row ->> 'room_icon', ''), 'home'),
        coalesce(nullif(v_row ->> 'room_color', ''), 'blue'),
        v_room_ord,
        v_room_key
      )
      returning id into v_room_id;
      v_room_ord := v_room_ord + 1;
      v_rooms := v_rooms + 1;
    end if;

    -- Duplicate names within a room (e.g. two "Toilet paper" rows in different
    -- rooms are fine; repeated rows in one room get an occurrence suffix).
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

    insert into public.items (
      household_id, room_id, name, priority, status, responsibility, responsible_user_id,
      ownership, owner_user_id, is_complete, estimated_price, actual_price, shopping_url,
      notes, sort_order, import_key
    ) values (
      p_household,
      v_room_id,
      left(trim(v_row ->> 'name'), 80),
      coalesce(nullif(v_row ->> 'priority', ''), 'must_have'),
      coalesce(nullif(v_row ->> 'status', ''), 'to_decide'),
      case when v_resp_uid is not null then 'member'
           when v_resp_name = 'shared' then 'shared' else 'unclaimed' end,
      v_resp_uid,
      case when v_own_uid is not null then 'member'
           when v_own_name = 'shared' then 'shared'
           when v_own_name = 'landlord' then 'landlord' else 'to_decide' end,
      v_own_uid,
      coalesce((v_row ->> 'done')::boolean, false),
      nullif(v_row ->> 'estimated_price', '')::numeric,
      nullif(v_row ->> 'actual_price', '')::numeric,
      nullif(trim(coalesce(v_row ->> 'shopping_url', '')), ''),
      nullif(trim(coalesce(v_row ->> 'notes', '')), ''),
      v_ord,
      v_item_key
    )
    on conflict (household_id, import_key) do nothing;

    if found then
      v_items := v_items + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
    v_ord := v_ord + 1;
  end loop;

  return query select v_rooms, v_items, v_skipped;
end;
$$;
