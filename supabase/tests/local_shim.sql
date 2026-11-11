-- Minimal stand-in for the parts of a Supabase database that the Flat Quest
-- migrations and access tests rely on. For a plain disposable Postgres ONLY
-- (see supabase/tests/run_local.sh). Never run this against a Supabase project:
-- CI and production use the real platform schemas instead.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to current_user;

create schema extensions;
create schema auth;
create schema storage;
create schema vault;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;

-- Supabase's defaults: new public tables/functions are granted to the API roles
-- (migrations then revoke down to what each table needs).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
grant execute on function storage.foldername(text), storage.filename(text) to anon, authenticated;

create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text,
  description text,
  secret text not null
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id into v;
  return v;
end $$;

create publication supabase_realtime;
