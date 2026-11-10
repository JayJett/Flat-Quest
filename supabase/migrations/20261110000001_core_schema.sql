-- Flat Quest — Phase 1 core schema
-- Profiles, households, memberships, invites, rooms and furnishing items,
-- protected by row level security with database-backed membership checks.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '' check (char_length(display_name) <= 40),
  avatar_path   text check (avatar_path is null or char_length(avatar_path) <= 200),
  accent_color  text not null default '#3657E8' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  icon          text not null default 'sparkles' check (icon ~ '^[a-z0-9-]{1,40}$'),
  -- Free-form JSON for future appearance settings (themes, banners …).
  preferences   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically for each new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(v_name, ''), 40))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Households and memberships
-- ---------------------------------------------------------------------------
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  address     text check (address is null or char_length(address) <= 120),
  created_by  uuid references auth.users (id) on delete set null,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger households_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

create table public.household_members (
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'member')),
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);

-- Membership checks used by every policy. SECURITY DEFINER avoids recursive
-- RLS evaluation on household_members; both only ever answer about auth.uid().
create or replace function public.is_household_member(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- True when the given user shares at least one household with the caller.
create or replace function public.shares_household_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user
  );
$$;

-- True when p_user is a member of p_household (used to validate assignments).
create or replace function public.user_in_household(p_user uuid, p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------------------
-- Invitations (only a SHA-256 hash of the code is stored)
-- ---------------------------------------------------------------------------
create table public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  token_hash    text not null unique,
  created_by    uuid references auth.users (id) on delete set null,
  expires_at    timestamptz not null,
  max_uses      int not null default 4 check (max_uses between 1 and 20),
  use_count     int not null default 0 check (use_count >= 0),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index household_invites_household_idx on public.household_invites (household_id);

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 40),
  icon          text not null default 'home' check (icon ~ '^[a-z0-9-]{1,40}$'),
  color         text not null default 'blue' check (color ~ '^[a-z0-9-]{1,30}$'),
  sort_order    int not null default 0,
  import_key    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, import_key)
);

create index rooms_household_idx on public.rooms (household_id, sort_order);

create trigger rooms_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Furnishing items
-- ---------------------------------------------------------------------------
create table public.items (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  room_id              uuid not null,
  name                 text not null check (char_length(name) between 1 and 80),
  description          text check (description is null or char_length(description) <= 500),
  priority             text not null default 'must_have'
                         check (priority in ('must_have', 'nice_to_have', 'maybe_later')),
  status               text not null default 'to_decide'
                         check (status in ('to_decide', 'bringing', 'need_to_buy', 'shopping', 'ordered', 'not_needed')),
  -- Responsibility: who is bringing or buying it.
  responsibility       text not null default 'unclaimed'
                         check (responsibility in ('unclaimed', 'member', 'shared')),
  responsible_user_id  uuid references auth.users (id) on delete set null,
  -- Ownership: who keeps it if the flat splits up. Separate from responsibility.
  ownership            text not null default 'to_decide'
                         check (ownership in ('to_decide', 'member', 'shared', 'landlord')),
  owner_user_id        uuid references auth.users (id) on delete set null,
  -- Completion is independent of status: done = physically in the flat.
  is_complete          boolean not null default false,
  completed_at         timestamptz,
  completed_by         uuid references auth.users (id) on delete set null,
  estimated_price      numeric(10, 2) check (estimated_price is null or estimated_price >= 0),
  actual_price         numeric(10, 2) check (actual_price is null or actual_price >= 0),
  shopping_url         text check (shopping_url is null or (char_length(shopping_url) <= 1000 and shopping_url ~* '^https?://')),
  notes                text check (notes is null or char_length(notes) <= 1000),
  sort_order           int not null default 0,
  import_key           text,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- An item's room must belong to the same household.
  foreign key (room_id, household_id) references public.rooms (id, household_id) on delete cascade,
  unique (household_id, import_key),
  check ((responsibility = 'member') = (responsible_user_id is not null)),
  check ((ownership = 'member') = (owner_user_id is not null))
);

create index items_household_idx on public.items (household_id);
create index items_room_idx on public.items (room_id, sort_order);
create index items_responsible_idx on public.items (responsible_user_id) where responsible_user_id is not null;

create trigger items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- Integrity rules that RLS alone cannot express.
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
     and not public.user_in_household(new.responsible_user_id, new.household_id) then
    raise exception 'Responsible person must be a household member' using errcode = '23514';
  end if;
  if new.owner_user_id is not null
     and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
     and not public.user_in_household(new.owner_user_id, new.household_id) then
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

create trigger items_guard
  before insert or update on public.items
  for each row execute function public.items_guard();

create or replace function public.rooms_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id <> old.household_id then
    raise exception 'Rooms cannot move between households' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger rooms_guard
  before update on public.rooms
  for each row execute function public.rooms_guard();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.rooms             enable row level security;
alter table public.items             enable row level security;

-- Nothing is readable or writable without signing in.
revoke all on public.profiles, public.households, public.household_members,
              public.household_invites, public.rooms, public.items from anon;

-- profiles: see yourself and flatmates; edit only yourself.
create policy "profiles: read self and flatmates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_household_with(id));

create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, delete on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_path, accent_color, icon, preferences) on public.profiles to authenticated;

-- households: members read; owners rename. Creation goes through create_household().
create policy "households: members read" on public.households
  for select to authenticated
  using (public.is_household_member(id));

create policy "households: owners update" on public.households
  for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

revoke insert, delete on public.households from authenticated;
revoke update on public.households from authenticated;
grant update (name, address, settings) on public.households to authenticated;

-- household_members: members see each other; you may leave. Joining is RPC-only.
create policy "members: read own households" on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

create policy "members: leave household" on public.household_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update on public.household_members from authenticated;

-- household_invites: members can list invites (never the hash). RPC-only writes.
create policy "invites: members read" on public.household_invites
  for select to authenticated
  using (public.is_household_member(household_id));

revoke all on public.household_invites from authenticated;
grant select (id, household_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at)
  on public.household_invites to authenticated;

-- rooms: full collaborative access for household members.
create policy "rooms: members read" on public.rooms
  for select to authenticated using (public.is_household_member(household_id));
create policy "rooms: members insert" on public.rooms
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "rooms: members update" on public.rooms
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "rooms: members delete" on public.rooms
  for delete to authenticated using (public.is_household_member(household_id));

-- items: full collaborative access for household members.
create policy "items: members read" on public.items
  for select to authenticated using (public.is_household_member(household_id));
create policy "items: members insert" on public.items
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "items: members update" on public.items
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "items: members delete" on public.items
  for delete to authenticated using (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- RPCs: household creation and invitations
-- ---------------------------------------------------------------------------
create or replace function public.create_household(p_name text, p_address text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if (select count(*) from public.household_members where user_id = v_uid) >= 5 then
    raise exception 'Too many households' using errcode = '54000';
  end if;
  insert into public.households (name, address, created_by)
  values (trim(p_name), nullif(trim(coalesce(p_address, '')), ''), v_uid)
  returning id into v_id;
  insert into public.household_members (household_id, user_id, role)
  values (v_id, v_uid, 'owner');
  return v_id;
end;
$$;

-- Returns the plain invite code exactly once; only its hash is stored.
create or replace function public.create_household_invite(p_household uuid, p_days int default 7, p_max_uses int default 4)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_household_member(p_household) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if (select count(*) from public.household_invites
      where household_id = p_household and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'Too many active invites' using errcode = '54000';
  end if;
  v_code := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
  insert into public.household_invites (household_id, token_hash, created_by, expires_at, max_uses)
  values (
    p_household,
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    (select auth.uid()),
    now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))),
    greatest(1, least(coalesce(p_max_uses, 4), 20))
  );
  return v_code;
end;
$$;

create or replace function public.revoke_household_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.household_invites i
     set revoked_at = now()
   where i.id = p_invite
     and public.is_household_member(i.household_id)
     and i.revoked_at is null;
  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Read-only preview so the join screen can show which household a code is for.
create or replace function public.preview_household_invite(p_code text)
returns table (household_name text, member_count int, is_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select h.name,
         (select count(*)::int from public.household_members m where m.household_id = h.id),
         public.is_household_member(h.id)
  from public.household_invites i
  join public.households h on h.id = i.household_id
  where (select auth.uid()) is not null
    and i.token_hash = encode(extensions.digest(coalesce(p_code, ''), 'sha256'), 'hex')
    and i.revoked_at is null
    and i.expires_at > now()
    and i.use_count < i.max_uses;
$$;

create or replace function public.accept_household_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_invite public.household_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into v_invite
  from public.household_invites
  where token_hash = encode(extensions.digest(coalesce(p_code, ''), 'sha256'), 'hex')
  for update;

  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now()
     or v_invite.use_count >= v_invite.max_uses then
    raise exception 'This invite link is invalid or has expired' using errcode = 'P0002';
  end if;

  if public.user_in_household(v_uid, v_invite.household_id) then
    return v_invite.household_id;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_uid, 'member');

  update public.household_invites set use_count = use_count + 1 where id = v_invite.id;
  return v_invite.household_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent checklist import (rooms + items keyed by import_key)
-- p_rows: [{ room, room_icon, room_color, name, priority, status, done,
--            responsible, owned_by, estimated_price, actual_price,
--            shopping_url, notes }]
-- Responsible / owned-by names are matched case-insensitively against
-- members' display names; "shared" maps to shared; anything else → unclaimed.
-- ---------------------------------------------------------------------------
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
  if not public.is_household_member(p_household) then
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

-- Lock down function execution: no anonymous callers.
revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.create_household_invite(uuid, int, int) from public, anon;
revoke execute on function public.revoke_household_invite(uuid) from public, anon;
revoke execute on function public.preview_household_invite(text) from public, anon;
revoke execute on function public.accept_household_invite(text) from public, anon;
revoke execute on function public.import_checklist(uuid, jsonb) from public, anon;
revoke execute on function public.is_household_member(uuid) from public, anon;
revoke execute on function public.is_household_owner(uuid) from public, anon;
revoke execute on function public.shares_household_with(uuid) from public, anon;
revoke execute on function public.user_in_household(uuid, uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.items_guard() from public, anon, authenticated;

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.create_household_invite(uuid, int, int) to authenticated;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
grant execute on function public.preview_household_invite(text) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.import_checklist(uuid, jsonb) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.shares_household_with(uuid) to authenticated;
grant execute on function public.user_in_household(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.items, public.rooms, public.household_members, public.profiles;
