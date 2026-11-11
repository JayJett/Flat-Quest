-- Flat Quest — Phase 2 / 02: one current invite link per household.
--
-- * Household size limit (default 4). An invite lets people join while there is space.
-- * The plain invite code is stored encrypted in Supabase Vault so household members
--   can copy/share the current link again. Only its SHA-256 hash is in the table that
--   clients can read, and revoking an invite deletes the vault secret.
-- * Invites created before this migration have no recoverable code. They are marked
--   `is_legacy`, keep working until they expire (nothing already sent breaks), and can
--   be revoked from the app. While any usable invite exists no new one can be created.
-- * Server-side enforcement: a row lock on the household serialises creation, and a
--   partial unique index guarantees at most one current (non-legacy, unrevoked) invite.

alter table public.households
  add column member_limit int not null default 4 check (member_limit between 1 and 12);

alter table public.household_invites
  add column secret_id uuid,
  add column is_legacy boolean not null default false;

update public.household_invites set is_legacy = true;

create unique index household_invites_one_current
  on public.household_invites (household_id)
  where revoked_at is null and not is_legacy;

grant select (is_legacy) on public.household_invites to authenticated;

-- Places still free in a household (members only; used by RPCs below).
create or replace function private.household_spaces(p_household uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, h.member_limit - (select count(*)::int from public.household_members m where m.household_id = h.id))
  from public.households h
  where h.id = p_household;
$$;
revoke execute on function private.household_spaces(uuid) from public, anon;
grant execute on function private.household_spaces(uuid) to authenticated;

-- Retires invites that can no longer be used (expired / exhausted) and wipes their secrets.
create or replace function private.retire_unusable_invites(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  for v_secret in
    update public.household_invites
       set revoked_at = now()
     where household_id = p_household
       and revoked_at is null
       and (expires_at <= now() or use_count >= max_uses)
    returning secret_id
  loop
    if v_secret is not null then
      delete from vault.secrets where id = v_secret;
    end if;
  end loop;
end;
$$;
revoke execute on function private.retire_unusable_invites(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_household_invite: returns the plain code of the NEW current invite.
-- Fails if any usable invite (current or legacy) already exists, or if the flat is full.
-- Signature unchanged from Phase 1 (p_max_uses is ignored: capacity decides).
-- ---------------------------------------------------------------------------
create or replace function public.create_household_invite(p_household uuid, p_days int default 7, p_max_uses int default 4)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code   text;
  v_id     uuid := gen_random_uuid();
  v_secret uuid;
  v_spaces int;
begin
  if not private.is_household_member(p_household) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  -- Serialise concurrent requests for this household.
  perform 1 from public.households where id = p_household for update;

  perform private.retire_unusable_invites(p_household);

  if exists (
    select 1 from public.household_invites
    where household_id = p_household and revoked_at is null
  ) then
    raise exception 'An invite link is already active' using errcode = '23505';
  end if;

  v_spaces := private.household_spaces(p_household);
  if v_spaces <= 0 then
    raise exception 'Your flat is full' using errcode = '54000';
  end if;

  v_code := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
  v_secret := vault.create_secret(v_code, 'flatquest_invite_' || v_id::text, 'Flat Quest household invite code');

  insert into public.household_invites (id, household_id, token_hash, created_by, expires_at, max_uses, secret_id, is_legacy)
  values (
    v_id,
    p_household,
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    (select auth.uid()),
    now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))),
    v_spaces,
    v_secret,
    false
  );
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_household_invites: the usable invites for a household. The current invite
-- includes its code (decrypted from Vault); legacy invites have code = null.
-- ---------------------------------------------------------------------------
create or replace function public.get_household_invites(p_household uuid)
returns table (
  id uuid,
  code text,
  is_legacy boolean,
  created_at timestamptz,
  created_by uuid,
  expires_at timestamptz,
  use_count int,
  people_can_join int,
  spaces_left int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_household_member(p_household) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  return query
    select i.id,
           case when i.is_legacy then null else s.decrypted_secret end,
           i.is_legacy,
           i.created_at,
           i.created_by,
           i.expires_at,
           i.use_count,
           least(i.max_uses - i.use_count, private.household_spaces(p_household)),
           private.household_spaces(p_household)
    from public.household_invites i
    left join vault.decrypted_secrets s on s.id = i.secret_id
    where i.household_id = p_household
      and i.revoked_at is null
      and i.expires_at > now()
      and i.use_count < i.max_uses
    order by i.is_legacy, i.created_at desc;
end;
$$;

create or replace function public.revoke_household_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  update public.household_invites i
     set revoked_at = now()
   where i.id = p_invite
     and private.is_household_member(i.household_id)
     and i.revoked_at is null
  returning i.secret_id into v_secret;
  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

-- Membership test that does not require the caller to be a member (internal only).
create or replace function private.user_in_household_unchecked(p_user uuid, p_household uuid)
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
revoke execute on function private.user_in_household_unchecked(uuid, uuid) from public, anon, authenticated;

drop function if exists public.preview_household_invite(text);
create function public.preview_household_invite(p_code text)
returns table (household_name text, member_count int, is_member boolean, spaces_left int)
language sql
stable
security definer
set search_path = ''
as $$
  select h.name,
         (select count(*)::int from public.household_members m where m.household_id = h.id),
         private.user_in_household_unchecked((select auth.uid()), h.id),
         greatest(0, h.member_limit - (select count(*)::int from public.household_members m where m.household_id = h.id))
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

  if private.user_in_household_unchecked(v_uid, v_invite.household_id) then
    return v_invite.household_id;
  end if;

  -- Serialise joins so the size limit holds under concurrency.
  perform 1 from public.households where id = v_invite.household_id for update;
  if private.household_spaces(v_invite.household_id) <= 0 then
    raise exception 'This flat is already full' using errcode = '54000';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_uid, 'member');

  update public.household_invites set use_count = use_count + 1 where id = v_invite.id;
  return v_invite.household_id;
end;
$$;

revoke execute on function public.create_household_invite(uuid, int, int) from public, anon;
revoke execute on function public.get_household_invites(uuid) from public, anon;
revoke execute on function public.revoke_household_invite(uuid) from public, anon;
revoke execute on function public.preview_household_invite(text) from public, anon;
revoke execute on function public.accept_household_invite(text) from public, anon;
grant execute on function public.create_household_invite(uuid, int, int) to authenticated;
grant execute on function public.get_household_invites(uuid) to authenticated;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
grant execute on function public.preview_household_invite(text) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;

-- Not added to the realtime publication: change events would carry token_hash.
