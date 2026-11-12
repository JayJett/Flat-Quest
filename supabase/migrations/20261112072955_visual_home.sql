-- Phase 5: additive room galleries. Existing media is never enrolled for deletion.
revoke truncate, references, trigger on public.profiles, public.households,
  public.household_members, public.rooms, public.items from authenticated, anon;

create table public.room_visuals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  room_id uuid not null,
  kind text not null check (kind in ('inspiration','photo')),
  photo_path text,
  thumbnail_path text,
  aspect_ratio double precision not null default 1 check(aspect_ratio > 0 and aspect_ratio < 1000),
  title text check (char_length(title) <= 120),
  notes text check (char_length(notes) <= 1000),
  source_url text check (char_length(source_url) <= 1000 and source_url ~* '^https?://[^[:space:]]+$'),
  taken_on date,
  sort_order double precision not null default 0,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (room_id, household_id) references public.rooms(id, household_id) on delete cascade,
  unique(id, room_id, household_id),
  check ((photo_path is not null and thumbnail_path is not null) or (kind='inspiration' and source_url is not null and photo_path is null and thumbnail_path is null)),
  check (photo_path is null or (photo_path ~ ('^' || household_id::text || '/visual/[a-f0-9-]+\.(webp|jpg)$'))),
  check (thumbnail_path is null or thumbnail_path = regexp_replace(photo_path, '\.(webp|jpg)$', '-thumb.\1'))
);
create index room_visuals_room_order on public.room_visuals(room_id, sort_order, id);
create index room_visuals_household on public.room_visuals(household_id);
create index room_visuals_creator on public.room_visuals(created_by);

create table public.room_transformations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  room_id uuid not null,
  before_id uuid not null,
  after_id uuid not null,
  title text check (char_length(title) <= 120),
  notes text check (char_length(notes) <= 1000),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(before_id <> after_id),
  foreign key(room_id, household_id) references public.rooms(id, household_id) on delete cascade,
  foreign key(before_id, room_id, household_id) references public.room_visuals(id, room_id, household_id) on delete cascade,
  foreign key(after_id, room_id, household_id) references public.room_visuals(id, room_id, household_id) on delete cascade
);
create index room_transformations_room on public.room_transformations(room_id, created_at desc);
create index room_transformations_household on public.room_transformations(household_id);
create index room_transformations_before on public.room_transformations(before_id);
create index room_transformations_after on public.room_transformations(after_id);
create index room_transformations_creator on public.room_transformations(created_by);

alter table public.room_visuals enable row level security;
alter table public.room_transformations enable row level security;
revoke all on public.room_visuals, public.room_transformations from anon, authenticated;
grant select, delete on public.room_visuals, public.room_transformations to authenticated;
grant insert(id,household_id,room_id,kind,photo_path,thumbnail_path,aspect_ratio,title,notes,source_url,taken_on,sort_order),
 update(title,notes,source_url,taken_on,sort_order) on public.room_visuals to authenticated;
grant insert(household_id,room_id,before_id,after_id,title,notes), update(before_id,after_id,title,notes) on public.room_transformations to authenticated;
create policy "visuals: members" on public.room_visuals for all to authenticated
 using(private.is_household_member(household_id)) with check(private.is_household_member(household_id));
create policy "transformations: members" on public.room_transformations for all to authenticated
 using(private.is_household_member(household_id)) with check(private.is_household_member(household_id));

-- Only uploads explicitly reserved through the new API are cleanup candidates.
-- No backfill from storage.objects: all pre-Phase-5 objects remain protected.
create table private.media_uploads (
 path text primary key,
 household_id uuid not null,
 thumbnail_path text,
 created_at timestamptz not null default now(),
 state text not null default 'available' check(state in ('available','deleting','deleted')),
 attempts integer not null default 0,
 last_error text,
 checked_at timestamptz
);
alter table private.media_uploads enable row level security;
revoke all on private.media_uploads from public, anon, authenticated;

create function public.reserve_media_upload(p_household uuid, p_kind text, p_ext text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p text; t text;
begin
 if not private.is_household_member(p_household) then raise exception 'Not a household member' using errcode='42501'; end if;
 if p_kind not in ('visual','products') or p_ext not in ('webp','jpg') then raise exception 'Invalid media type'; end if;
 p := p_household::text || '/' || p_kind || '/' || gen_random_uuid()::text || '.' || p_ext;
 if p_kind='visual' then t:=regexp_replace(p,'\.(webp|jpg)$','-thumb.\1'); end if;
 insert into private.media_uploads(path,household_id,thumbnail_path) values(p,p_household,t);
 return jsonb_build_object('path',p,'thumbnail_path',t);
end $$;
revoke all on function public.reserve_media_upload(uuid,text,text) from public, anon;
grant execute on function public.reserve_media_upload(uuid,text,text) to authenticated;

-- This row lock serializes attachment against cleanup claims. Once claimed,
-- a path can never be attached or overwritten again, even after a worker crash.
create function private.guard_media_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
declare s text;
begin
 if new.photo_path is not null then
   select state into s from private.media_uploads where path=new.photo_path for update;
   if s is not null and s <> 'available' then raise exception 'This upload expired. Please add the photo again.' using errcode='23514'; end if;
   if tg_table_name='room_visuals' and s is null then raise exception 'Reserve the upload first' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_media_attachment() from public,anon,authenticated;
create trigger guard_visual_attachment before insert on public.room_visuals for each row execute function private.guard_media_attachment();
create trigger guard_product_attachment before insert or update of photo_path on public.product_options for each row execute function private.guard_media_attachment();

create function private.visual_updated() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='room_transformations' then
   if exists(select 1 from public.room_visuals where id in(new.before_id,new.after_id) and kind <> 'photo') then
     raise exception 'Choose two flat photos' using errcode='23514';
   end if;
 end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
revoke all on function private.visual_updated() from public,anon,authenticated;
create trigger visual_updated before update on public.room_visuals for each row execute function private.visual_updated();
create trigger transformation_updated before insert or update on public.room_transformations for each row execute function private.visual_updated();

create function private.media_referenced(p text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.room_visuals where photo_path=p or thumbnail_path=p)
 or exists(select 1 from public.product_options where photo_path=p)
 or exists(select 1 from public.wishlist_items where photo_path=p)
 or exists(select 1 from public.households where photo_path=p)
$$;
revoke all on function private.media_referenced(text) from public,anon,authenticated;

-- Worker-only API: no browser can claim or acknowledge deletion.
create function public.claim_media_cleanup(p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; result jsonb := '[]'::jsonb;
begin
 for r in select * from private.media_uploads where state <> 'deleted'
   and created_at < now()-interval '24 hours'
   and not private.media_referenced(path) and not private.media_referenced(thumbnail_path)
   order by created_at limit 100 for update skip locked loop
   if not private.media_referenced(r.path) and not private.media_referenced(r.thumbnail_path) then
     if not p_dry_run then update private.media_uploads set state='deleting',attempts=attempts+1,checked_at=now() where path=r.path; end if;
     result:=result || jsonb_build_array(jsonb_build_object('path',r.path,'thumbnail_path',r.thumbnail_path));
   end if;
 end loop;
 return result;
end $$;
create function public.finish_media_cleanup(p_path text,p_error text default null) returns void
language sql security definer set search_path='' as $$
 update private.media_uploads set state=case when p_error is null then 'deleted' else 'deleting' end,
 last_error=left(p_error,500),checked_at=now() where path=p_path and state='deleting';
$$;
revoke all on function public.claim_media_cleanup(boolean), public.finish_media_cleanup(text,text) from public,anon,authenticated;
grant execute on function public.claim_media_cleanup(boolean), public.finish_media_cleanup(text,text) to service_role;

-- Restrictive policies compose with the existing membership policies.
-- Reserved objects are immutable and deleted only by the worker.
create function private.media_writable(p text) returns boolean language sql security definer stable set search_path='' as $$
 select not exists(select 1 from private.media_uploads where (path=p or thumbnail_path=p) and (state <> 'available' or created_at < now()-interval '24 hours'));
$$;
create function private.media_reserved(p text) returns boolean language sql security definer stable set search_path='' as $$
 select exists(select 1 from private.media_uploads where path=p or thumbnail_path=p);
$$;
revoke all on function private.media_writable(text),private.media_reserved(text) from public,anon;
grant execute on function private.media_writable(text),private.media_reserved(text) to authenticated;
create policy "media: reserved upload window" on storage.objects as restrictive for insert to authenticated
 with check(bucket_id <> 'household-media' or private.media_writable(name));
create policy "media: reserved immutable" on storage.objects as restrictive for update to authenticated
 using(bucket_id <> 'household-media' or not private.media_reserved(name))
 with check(bucket_id <> 'household-media' or not private.media_reserved(name));
create policy "media: reserved worker deletion" on storage.objects as restrictive for delete to authenticated
 using(bucket_id <> 'household-media' or not private.media_reserved(name));

alter publication supabase_realtime add table public.room_visuals, public.room_transformations;

create table private.media_worker_settings (id boolean primary key default true check(id), token_hash text not null);
alter table private.media_worker_settings enable row level security;
revoke all on private.media_worker_settings from public,anon,authenticated;
create function public.authorize_media_cleanup(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from private.media_worker_settings where token_hash=encode(extensions.digest(p_token,'sha256'),'hex'));
$$;
revoke all on function public.authorize_media_cleanup(text) from public,anon,authenticated;
grant execute on function public.authorize_media_cleanup(text) to service_role;
