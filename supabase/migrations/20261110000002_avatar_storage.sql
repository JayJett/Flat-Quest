-- Flat Quest — private avatar storage
-- Files live at avatars/<user-id>/<file>. Only the owner can write to their
-- folder; only the owner and their flatmates can read (via signed URLs).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Safely extract the owning user id from an object path ("<uuid>/<file>").
create or replace function public.avatar_owner(p_name text)
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

revoke execute on function public.avatar_owner(text) from public, anon;
grant execute on function public.avatar_owner(text) to authenticated;

create policy "avatars: read own and flatmates"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      public.avatar_owner(name) = (select auth.uid())
      or public.shares_household_with(public.avatar_owner(name))
    )
  );

create policy "avatars: upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.avatar_owner(name) = (select auth.uid()));

create policy "avatars: update own files"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.avatar_owner(name) = (select auth.uid()))
  with check (bucket_id = 'avatars' and public.avatar_owner(name) = (select auth.uid()));

create policy "avatars: delete own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.avatar_owner(name) = (select auth.uid()));

-- A profile may only reference an avatar inside its own folder.
alter table public.profiles
  add constraint profiles_avatar_path_own_folder
  check (avatar_path is null or public.avatar_owner(avatar_path) = id);
