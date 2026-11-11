-- Flat Quest — Phase 2 / 07: collaborative wishlist.
--
-- wishlist_items: ideas (optionally linked to a room, with price, link, photo).
-- wishlist_votes: one row per member per idea (interest, not purchase approval).
-- add_wishlist_to_checklist(): turns a chosen idea into exactly one checklist item.
-- import_wishlist(): idempotent import of the original sheet's ideas.

create table public.wishlist_items (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete cascade,
  room_id            uuid references public.rooms (id) on delete set null,
  title              text not null check (char_length(title) between 1 and 80),
  notes              text check (notes is null or char_length(notes) <= 1000),
  estimated_price    numeric(10, 2) check (estimated_price is null or estimated_price >= 0),
  shopping_url       text check (shopping_url is null or (char_length(shopping_url) <= 1000 and shopping_url ~* '^https?://')),
  photo_path         text check (photo_path is null or (char_length(photo_path) <= 200 and split_part(photo_path, '/', 1) = household_id::text and split_part(photo_path, '/', 2) = 'wishlist')),
  is_chosen          boolean not null default false,
  chosen_at          timestamptz,
  chosen_by          uuid references auth.users (id) on delete set null,
  checklist_item_id  uuid unique references public.items (id) on delete set null,
  import_key         text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, import_key)
);
create index wishlist_items_household_idx on public.wishlist_items (household_id, created_at desc);
create index wishlist_items_room_idx on public.wishlist_items (room_id);
create index wishlist_items_created_by_idx on public.wishlist_items (created_by);
create index wishlist_items_chosen_by_idx on public.wishlist_items (chosen_by);

create trigger wishlist_items_updated_at
  before update on public.wishlist_items
  for each row execute function public.set_updated_at();

create or replace function private.wishlist_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.household_id <> old.household_id then
    raise exception 'Ideas cannot move between households' using errcode = '42501';
  end if;
  if new.room_id is not null and not exists (
    select 1 from public.rooms r where r.id = new.room_id and r.household_id = new.household_id
  ) then
    raise exception 'Room must belong to this household' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    -- Imported ideas came from the shared sheet, not from whoever ran the import.
    new.created_by := case when new.import_key is null then (select auth.uid()) else null end;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.import_key := old.import_key;
  end if;
  if tg_op = 'INSERT' or new.is_chosen is distinct from old.is_chosen then
    if new.is_chosen then
      new.chosen_at := now();
      new.chosen_by := (select auth.uid());
    else
      new.chosen_at := null;
      new.chosen_by := null;
    end if;
  else
    new.chosen_at := old.chosen_at;
    new.chosen_by := old.chosen_by;
  end if;
  return new;
end;
$$;
revoke execute on function private.wishlist_guard() from public, anon, authenticated;

create trigger wishlist_items_guard
  before insert or update on public.wishlist_items
  for each row execute function private.wishlist_guard();

create table public.wishlist_votes (
  idea_id       uuid not null,
  household_id  uuid not null,
  user_id       uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  primary key (idea_id, user_id),
  foreign key (idea_id, household_id) references public.wishlist_items (id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index wishlist_votes_household_idx on public.wishlist_votes (household_id);
create index wishlist_votes_user_idx on public.wishlist_votes (user_id);

-- RLS
alter table public.wishlist_items enable row level security;
alter table public.wishlist_votes enable row level security;
revoke all on public.wishlist_items, public.wishlist_votes from anon, authenticated;

grant select, delete on public.wishlist_items to authenticated;
grant insert (id, household_id, room_id, title, notes, estimated_price, shopping_url, photo_path, is_chosen)
  on public.wishlist_items to authenticated;
grant update (room_id, title, notes, estimated_price, shopping_url, photo_path, is_chosen)
  on public.wishlist_items to authenticated;

create policy "wishlist: members read" on public.wishlist_items
  for select to authenticated using (private.is_household_member(household_id));
create policy "wishlist: members add" on public.wishlist_items
  for insert to authenticated with check (private.is_household_member(household_id));
create policy "wishlist: members edit" on public.wishlist_items
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy "wishlist: members remove" on public.wishlist_items
  for delete to authenticated using (private.is_household_member(household_id));

grant select, insert, delete on public.wishlist_votes to authenticated;
create policy "votes: members read" on public.wishlist_votes
  for select to authenticated using (private.is_household_member(household_id));
create policy "votes: cast own vote" on public.wishlist_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_household_member(household_id));
create policy "votes: remove own vote" on public.wishlist_votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Turn a chosen idea into a checklist item (once). Returns the item id.
-- ---------------------------------------------------------------------------
create or replace function public.add_wishlist_to_checklist(p_idea uuid, p_room uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idea  public.wishlist_items%rowtype;
  v_room  uuid;
  v_item  uuid;
begin
  select * into v_idea from public.wishlist_items where id = p_idea for update;
  if not found or not private.is_household_member(v_idea.household_id) then
    raise exception 'Idea not found' using errcode = 'P0002';
  end if;
  if v_idea.checklist_item_id is not null
     and exists (select 1 from public.items where id = v_idea.checklist_item_id) then
    return v_idea.checklist_item_id;
  end if;
  v_room := coalesce(p_room, v_idea.room_id);
  if v_room is null or not exists (
    select 1 from public.rooms where id = v_room and household_id = v_idea.household_id
  ) then
    raise exception 'Choose a room for this idea first' using errcode = '22023';
  end if;

  insert into public.items (household_id, room_id, name, priority, status, ownership,
                            estimated_price, shopping_url, notes, sort_order)
  values (v_idea.household_id, v_room, left(v_idea.title, 80), 'nice_to_have', 'to_decide', 'to_decide',
          v_idea.estimated_price, v_idea.shopping_url, v_idea.notes,
          coalesce((select max(sort_order) from public.items where room_id = v_room), 0) + 1)
  returning id into v_item;

  update public.wishlist_items
     set checklist_item_id = v_item,
         is_chosen = true,
         room_id = v_room
   where id = p_idea;
  return v_item;
end;
$$;
revoke execute on function public.add_wishlist_to_checklist(uuid, uuid) from public, anon;
grant execute on function public.add_wishlist_to_checklist(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent import: rows [{ room, title, estimated_price, shopping_url, notes, chosen }]
-- keyed by room + title. Room names are matched to existing rooms.
-- ---------------------------------------------------------------------------
create or replace function public.import_wishlist(p_household uuid, p_rows jsonb)
returns table (ideas_created int, ideas_skipped int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb;
  v_room    uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_title   text;
begin
  if not private.is_household_member(p_household) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Expected an array of at most 500 rows' using errcode = '22023';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_title := left(trim(coalesce(v_row ->> 'title', '')), 80);
    if v_title = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_room := null;
    select id into v_room from public.rooms
     where household_id = p_household
       and (import_key = 'room:' || lower(trim(coalesce(v_row ->> 'room', ''))) or lower(name) = lower(trim(coalesce(v_row ->> 'room', ''))))
     order by import_key nulls last
     limit 1;
    insert into public.wishlist_items (household_id, room_id, title, notes, estimated_price, shopping_url, is_chosen, import_key)
    values (
      p_household, v_room, v_title,
      nullif(trim(coalesce(v_row ->> 'notes', '')), ''),
      nullif(v_row ->> 'estimated_price', '')::numeric,
      nullif(trim(coalesce(v_row ->> 'shopping_url', '')), ''),
      coalesce((v_row ->> 'chosen')::boolean, false),
      'wish:' || lower(trim(coalesce(v_row ->> 'room', ''))) || '|' || lower(v_title)
    )
    on conflict (household_id, import_key) do nothing;
    if found then v_created := v_created + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return query select v_created, v_skipped;
end;
$$;
revoke execute on function public.import_wishlist(uuid, jsonb) from public, anon;
grant execute on function public.import_wishlist(uuid, jsonb) to authenticated;

alter publication supabase_realtime add table public.wishlist_items, public.wishlist_votes;
