-- Flat Quest — RLS / access-isolation verification.
-- Creates three throwaway auth users, impersonates each via request.jwt.claims,
-- records actual vs expected outcomes, then deletes everything it created.
-- Run as the postgres role (Supabase SQL editor or MCP execute_sql).

begin;

-- Remove leftovers from any earlier run (safe if none exist).
delete from public.households where name in ('RLS Test House', 'Other House')
  and created_by in ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
delete from auth.users where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@test.invalid', '{"display_name":"TestA"}', '{}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@test.invalid', '{"full_name":"TestB Person"}', '{}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-c@test.invalid', '{}', '{}', now(), now());

create temp table rls_results (n serial, test text, expected text, actual text) on commit drop;
create temp table rls_ctx (hid uuid, code text, other_hid uuid) on commit drop;
grant all on rls_results, rls_ctx to authenticated, anon;
grant usage on sequence rls_results_n_seq to authenticated, anon;

-- Helper: record a check
create or replace function pg_temp.rec(t text, e text, a text) returns void language sql as
$$ insert into rls_results (test, expected, actual) values (t, e, coalesce(a, 'NULL')) $$;

-- Helper: run a statement, return 'ok' or the SQLSTATE it failed with
create or replace function pg_temp.try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return 'error ' || sqlstate;
end $$;

-- Helper: run a query (may modify data) and return its single value as text, or the SQLSTATE
create or replace function pg_temp.val(q text) returns text language plpgsql as $$
declare v text;
begin
  execute q into v;
  return v;
exception when others then
  return 'error ' || sqlstate;
end $$;

set local role authenticated;

-- ===== A creates a household and imports two rooms =====
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into rls_ctx (hid) select public.create_household('RLS Test House', '1 Test St');
update rls_ctx set code = public.create_household_invite(hid);
select pg_temp.rec('A: first import (rooms, items, skipped)', '(2,3,0)',
  (select row(r.*)::text from rls_ctx, public.import_checklist(hid,
    '[{"room":"Kitchen","name":"Kettle"},{"room":"Kitchen","name":"Kettle"},{"room":"Lounge","name":"Rug","responsible":"TestA","owned_by":"shared"}]'::jsonb) r));
select pg_temp.rec('A: re-import is idempotent', '(0,0,3)',
  (select row(r.*)::text from rls_ctx, public.import_checklist(hid,
    '[{"room":"Kitchen","name":"Kettle"},{"room":"Kitchen","name":"Kettle"},{"room":"Lounge","name":"Rug"}]'::jsonb) r));
select pg_temp.rec('A: import maps responsible name to member', 'member', (select responsibility from public.items where name = 'Rug'));
select pg_temp.rec('A: sees 3 items', '3', (select count(*)::text from public.items));
select pg_temp.rec('A: direct insert into households blocked', 'error 42501', pg_temp.try($q$insert into public.households (name) values ('sneaky')$q$));
select pg_temp.rec('A: direct insert into household_members blocked', 'error 42501',
  pg_temp.try($q$insert into public.household_members (household_id, user_id) select hid, '33333333-3333-4333-8333-333333333333' from rls_ctx$q$));
select pg_temp.rec('A: cannot read invite token hashes', 'error 42501', pg_temp.try('select token_hash from public.household_invites'));
select pg_temp.rec('A: can mark item complete; completed_by set by DB', '11111111-1111-4111-8111-111111111111',
  pg_temp.val($q$with u as (update public.items set is_complete = true, completed_by = '22222222-2222-4222-8222-222222222222' where name = 'Rug' returning completed_by) select completed_by::text from u$q$));
select pg_temp.rec('A: cannot assign a non-member', 'error 23514',
  pg_temp.try($q$update public.items set responsibility = 'member', responsible_user_id = '33333333-3333-4333-8333-333333333333' where name = 'Rug'$q$));
select pg_temp.rec('A: cannot move item to another household', 'error 42501',
  pg_temp.try($q$update public.items set household_id = gen_random_uuid() where name = 'Rug'$q$));
select pg_temp.rec('A: ordered status does not complete item', 'false',
  pg_temp.val($q$with u as (update public.items set status = 'ordered' where import_key = 'room:kitchen|kettle' returning is_complete) select is_complete::text from u$q$));

-- ===== C: an outsider with a household of their own =====
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
update rls_ctx set other_hid = public.create_household('Other House', null);
select pg_temp.rec('C: sees no items of A', '0', (select count(*)::text from public.items));
select pg_temp.rec('C: sees only own room count', '0', (select count(*)::text from public.rooms));
select pg_temp.rec('C: sees only own household', '1', (select count(*)::text from public.households));
select pg_temp.rec('C: cannot read A profile', '0', (select count(*)::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'));
select pg_temp.rec('C: sees no invites of A', '0', (select count(*)::text from public.household_invites i, rls_ctx where i.household_id = rls_ctx.hid));
select pg_temp.rec('C: update A items affects 0 rows', '0', pg_temp.val($q$with u as (update public.items set name = 'hacked' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('C: delete A rooms affects 0 rows', '0', pg_temp.val($q$with u as (delete from public.rooms returning 1) select count(*)::text from u$q$));
select pg_temp.rec('C: insert item into A household blocked', 'error 42501',
  pg_temp.try($q$insert into public.items (household_id, room_id, name) select hid, gen_random_uuid(), 'x' from rls_ctx$q$));
select pg_temp.rec('C: edit A profile affects 0 rows', '0',
  pg_temp.val($q$with u as (update public.profiles set display_name = 'hacked' where id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('C: import into A household blocked', 'error 42501',
  pg_temp.try($q$select public.import_checklist((select hid from rls_ctx), '[{"room":"X","name":"Y"}]'::jsonb)$q$));
select pg_temp.rec('C: create invite for A household blocked', 'error 42501',
  pg_temp.try($q$select public.create_household_invite((select hid from rls_ctx))$q$));
select pg_temp.rec('C: probing membership of A household returns false', 'false',
  (select public.user_in_household('11111111-1111-4111-8111-111111111111', hid)::text from rls_ctx));
select pg_temp.rec('C: bad invite code rejected', 'error P0002', pg_temp.try($q$select public.accept_household_invite('not-a-real-code')$q$));
select pg_temp.rec('C: bad invite preview returns nothing', '0', (select count(*)::text from public.preview_household_invite('not-a-real-code')));
select pg_temp.rec('C: cannot change own role (no update grant)', 'error 42501',
  pg_temp.try($q$update public.household_members set role = 'owner'$q$));

-- ===== B joins with the valid invite =====
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.rec('B: profile name derived from full_name', 'TestB', (select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'));
select pg_temp.rec('B: preview shows household before joining', '("RLS Test House",1,f)', (select row(p.*)::text from rls_ctx, public.preview_household_invite(code) p));
select pg_temp.rec('B: sees nothing before joining', '0', (select count(*)::text from public.items));
select pg_temp.rec('B: join returns household id', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_ctx));
select pg_temp.rec('B: joining twice is a no-op', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_ctx));
select pg_temp.rec('B: now sees A items', '3', (select count(*)::text from public.items));
select pg_temp.rec('B: can read A profile', 'TestA', (select display_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'));
select pg_temp.rec('B: still cannot read C household', '0', (select count(*)::text from public.households h, rls_ctx where h.id = rls_ctx.other_hid));
select pg_temp.rec('B: edit A profile affects 0 rows', '0',
  pg_temp.val($q$with u as (update public.profiles set display_name = 'hacked' where id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('B: edit own profile', '1',
  pg_temp.val($q$with u as (update public.profiles set display_name = 'Bee', accent_color = '#42C493', icon = 'heart' where id = '22222222-2222-4222-8222-222222222222' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('B: invalid accent colour rejected', 'error 23514',
  pg_temp.try($q$update public.profiles set accent_color = 'red' where id = '22222222-2222-4222-8222-222222222222'$q$));
select pg_temp.rec('B: avatar path outside own folder rejected', 'error 23514',
  pg_temp.try($q$update public.profiles set avatar_path = '11111111-1111-4111-8111-111111111111/x.webp' where id = '22222222-2222-4222-8222-222222222222'$q$));
select pg_temp.rec('B: claims an item', '1',
  pg_temp.val($q$with u as (update public.items set responsibility = 'member', responsible_user_id = '22222222-2222-4222-8222-222222222222' where import_key = 'room:kitchen|kettle' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('B: cannot rename household (not owner)', '0',
  pg_temp.val($q$with u as (update public.households set name = 'Mine now' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('B: cannot remove A from household', '0',
  pg_temp.val($q$with u as (delete from public.household_members where user_id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));

-- ===== anon has no access =====
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select pg_temp.rec('anon: items select denied', 'error 42501', pg_temp.try('select * from public.items'));
select pg_temp.rec('anon: profiles select denied', 'error 42501', pg_temp.try('select * from public.profiles'));
select pg_temp.rec('anon: create_household denied', 'error 42501', pg_temp.try($q$select public.create_household('x')$q$));

-- ===== cleanup (as postgres) =====
reset role;
delete from public.households where id in (select hid from rls_ctx union select other_hid from rls_ctx);
delete from auth.users where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

select n, case when expected = actual then 'PASS' else 'FAIL' end as result, test, expected, actual
from rls_results order by n;

commit;
