-- Flat Quest — Phase 2 / 06: per-user tour state + household photo.

-- Tour: null = not seen yet (shows once). Set when finished or skipped.
alter table public.profiles add column tour_completed_at timestamptz;
grant update (tour_completed_at) on public.profiles to authenticated;

-- Household photo, stored in a separate private bucket, one folder per household:
--   household-media/<household-id>/photo-<timestamp>.webp
--   household-media/<household-id>/wishlist/<idea-id>-<timestamp>.webp
alter table public.households
  add column photo_path text
  check (photo_path is null or (char_length(photo_path) <= 200 and split_part(photo_path, '/', 1) = id::text));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('household-media', 'household-media', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.path_household(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_first ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end;
$$;
revoke execute on function private.path_household(text) from public, anon;
grant execute on function private.path_household(text) to authenticated;

create policy "household media: members read"
  on storage.objects for select to authenticated
  using (bucket_id = 'household-media' and private.is_household_member(private.path_household(name)));
create policy "household media: members upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'household-media' and private.is_household_member(private.path_household(name)));
create policy "household media: members update"
  on storage.objects for update to authenticated
  using (bucket_id = 'household-media' and private.is_household_member(private.path_household(name)))
  with check (bucket_id = 'household-media' and private.is_household_member(private.path_household(name)));
create policy "household media: members delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'household-media' and private.is_household_member(private.path_household(name)));

-- Any member may change the photo (household name/address stay owner-only).
-- Returns the previous path so the client can delete the old file.
create or replace function public.set_household_photo(p_household uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not private.is_household_member(p_household) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if p_path is not null and (split_part(p_path, '/', 1) <> p_household::text or split_part(p_path, '/', 2) !~ '^photo-[0-9]+\.(webp|jpg)$') then
    raise exception 'Invalid photo path' using errcode = '22023';
  end if;
  select photo_path into v_old from public.households where id = p_household for update;
  update public.households set photo_path = p_path where id = p_household;
  return v_old;
end;
$$;
revoke execute on function public.set_household_photo(uuid, text) from public, anon;
grant execute on function public.set_household_photo(uuid, text) to authenticated;

-- Photo / name changes reach every open session.
alter publication supabase_realtime add table public.households;
