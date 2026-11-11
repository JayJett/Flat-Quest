-- Flat Quest — Phase 2 / 03: when the flat is full, its invite links retire.
-- A link for a full flat can't be used, so it shouldn't block a fresh link later
-- or show as "active". Joining the last free place now retires all usable links.

create or replace function private.retire_unusable_invites(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  v_full   boolean := coalesce(private.household_spaces(p_household), 0) <= 0;
begin
  for v_secret in
    update public.household_invites
       set revoked_at = now()
     where household_id = p_household
       and revoked_at is null
       and (expires_at <= now() or use_count >= max_uses or v_full)
    returning secret_id
  loop
    if v_secret is not null then
      delete from vault.secrets where id = v_secret;
    end if;
  end loop;
end;
$$;
revoke execute on function private.retire_unusable_invites(uuid) from public, anon, authenticated;

create or replace function public.get_household_invites(p_household uuid)
returns table (
  id uuid, code text, is_legacy boolean, created_at timestamptz, created_by uuid,
  expires_at timestamptz, use_count int, people_can_join int, spaces_left int
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
           i.is_legacy, i.created_at, i.created_by, i.expires_at, i.use_count,
           least(i.max_uses - i.use_count, private.household_spaces(p_household)),
           private.household_spaces(p_household)
    from public.household_invites i
    left join vault.decrypted_secrets s on s.id = i.secret_id
    where i.household_id = p_household
      and i.revoked_at is null
      and i.expires_at > now()
      and i.use_count < i.max_uses
      and private.household_spaces(p_household) > 0
    order by i.is_legacy, i.created_at desc;
end;
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
  perform 1 from public.households where id = v_invite.household_id for update;
  if private.household_spaces(v_invite.household_id) <= 0 then
    raise exception 'This flat is already full' using errcode = '54000';
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_uid, 'member');
  update public.household_invites set use_count = use_count + 1 where id = v_invite.id;
  -- Last place taken (or link used up): retire links so they can't linger.
  perform private.retire_unusable_invites(v_invite.household_id);
  return v_invite.household_id;
end;
$$;
