-- Flat Quest — RLS / access-isolation verification (Phase 2).
-- Creates throwaway auth users, impersonates each via request.jwt.claims,
-- records expected vs actual outcomes, then deletes everything it created.
-- Run as the postgres role (Supabase SQL editor or MCP execute_sql). Every row should say PASS.
--
-- Users: A = owner, B = joins via invite, D = joins then leaves, C = outsider with own house.

begin;

-- Leftovers from an earlier run (safe if none).
delete from public.households where name in ('RLS Test House', 'Other House')
  and created_by in ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
delete from auth.users where email like 'rls-_@test.invalid';

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@test.invalid', '{"display_name":"TestA"}', '{}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@test.invalid', '{"full_name":"TestB Person"}', '{}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-c@test.invalid', '{}', '{}', now(), now()),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-d@test.invalid', '{"display_name":"TestD"}', '{}', now(), now());

create temp table rls_results (n serial, test text, expected text, actual text) on commit drop;
create temp table rls_ctx (hid uuid, code text, other_hid uuid, item1 uuid, item2 uuid, other_room uuid, idea uuid, conv uuid) on commit drop;
grant all on rls_results, rls_ctx to authenticated, anon;
grant usage on sequence rls_results_n_seq to authenticated, anon;

create or replace function pg_temp.rec(t text, e text, a text) returns void language sql as
$$ insert into rls_results (test, expected, actual) values (t, e, coalesce(a, 'NULL')) $$;
create or replace function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return 'error ' || sqlstate; end $$;
create or replace function pg_temp.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; exception when others then return 'error ' || sqlstate; end $$;

set local role authenticated;

-- ===== A: household, import, invite =====
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into rls_ctx (hid) select public.create_household('RLS Test House', '1 Test St');
select pg_temp.rec('A: first import (rooms, items, skipped)', '(2,3,0)',
  (select row(r.*)::text from rls_ctx, public.import_checklist(hid,
    '[{"room":"Kitchen","name":"Kettle"},{"room":"Kitchen","name":"Fridge","status":"provided","owned_by":"landlord"},{"room":"Lounge","name":"Rug","responsible":"TestA"}]'::jsonb) r));
select pg_temp.rec('A: re-import is idempotent', '(0,0,3)',
  (select row(r.*)::text from rls_ctx, public.import_checklist(hid,
    '[{"room":"Kitchen","name":"Kettle"},{"room":"Kitchen","name":"Fridge"},{"room":"Lounge","name":"Rug"}]'::jsonb) r));
update rls_ctx set item1 = (select id from public.items where name = 'Kettle'), item2 = (select id from public.items where name = 'Rug');
select pg_temp.rec('A: import assigns matched name via item_assignees', '11111111-1111-4111-8111-111111111111',
  (select string_agg(user_id::text, ',') from public.item_assignees a, rls_ctx where a.item_id = rls_ctx.item2));
select pg_temp.rec('A: provided status + landlord stored', 'provided,landlord', (select status || ',' || ownership from public.items where name = 'Fridge'));
select pg_temp.rec('A: unknown status rejected', 'error 23514', pg_temp.try($q$update public.items set status = 'bogus' where name = 'Fridge'$q$));
select pg_temp.rec('A: direct insert into households blocked', 'error 42501', pg_temp.try($q$insert into public.households (name) values ('sneaky')$q$));
select pg_temp.rec('A: direct insert into household_members blocked', 'error 42501',
  pg_temp.try($q$insert into public.household_members (household_id, user_id) select hid, '33333333-3333-4333-8333-333333333333' from rls_ctx$q$));
select pg_temp.rec('A: completed_by set by DB (client value ignored)', '11111111-1111-4111-8111-111111111111',
  pg_temp.val($q$with u as (update public.items set is_complete = true, completed_by = '22222222-2222-4222-8222-222222222222' where name = 'Rug' returning completed_by) select completed_by::text from u$q$));
select pg_temp.rec('A: cannot move item to another household', 'error 42501', pg_temp.try($q$update public.items set household_id = gen_random_uuid() where name = 'Rug'$q$));
select pg_temp.rec('A: ordered does not complete an item', 'false',
  pg_temp.val($q$with u as (update public.items set status = 'ordered' where name = 'Kettle' returning is_complete) select is_complete::text from u$q$));
update rls_ctx set code = public.create_household_invite(hid);
select pg_temp.rec('A: second invite blocked while one is active', 'error 23505', pg_temp.try($q$select public.create_household_invite((select hid from rls_ctx))$q$));
select pg_temp.rec('A: current invite code can be re-read', 'true', (select (i.code = c.code)::text from rls_ctx c, public.get_household_invites(c.hid) i));
select pg_temp.rec('A: invite hashes not readable', 'error 42501', pg_temp.try('select token_hash from public.household_invites'));
select pg_temp.rec('A: vault secrets not readable', 'error 42501', pg_temp.try('select * from vault.decrypted_secrets'));
select pg_temp.rec('A: sets assignees to self', 'ok', pg_temp.try($q$select public.set_item_assignees((select item1 from rls_ctx), array['11111111-1111-4111-8111-111111111111'::uuid])$q$));
select pg_temp.rec('A: cannot assign a non-member', 'error 23503',
  pg_temp.try($q$select public.set_item_assignees((select item1 from rls_ctx), array['33333333-3333-4333-8333-333333333333'::uuid])$q$));
select pg_temp.rec('A: failed assignment left the previous one intact', '1', (select count(*)::text from public.item_assignees a, rls_ctx where a.item_id = rls_ctx.item1));
reset role;
-- Database-level guarantee: a second current invite can't exist even if two requests race.
select pg_temp.rec('DB: unique index blocks a second current invite', 'error 23505',
  pg_temp.try($q$insert into public.household_invites (household_id, token_hash, expires_at) select hid, 'race', now() + interval '1 day' from rls_ctx$q$));
set local role authenticated;

-- ===== C: outsider =====
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
update rls_ctx set other_hid = public.create_household('Other House', null);
insert into public.rooms (household_id, name) select other_hid, 'C room' from rls_ctx;
update rls_ctx set other_room = (select id from public.rooms where name = 'C room');
select pg_temp.rec('C: sees none of A''s items', '0', (select count(*)::text from public.items i, rls_ctx c where i.household_id = c.hid));
select pg_temp.rec('C: sees none of A''s assignments', '0', (select count(*)::text from public.item_assignees));
select pg_temp.rec('C: cannot read A''s profile', '0', (select count(*)::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'));
select pg_temp.rec('C: cannot list A''s invites', 'error 42501', pg_temp.try($q$select * from public.get_household_invites((select hid from rls_ctx))$q$));
select pg_temp.rec('C: cannot assign self to A''s item (RLS)', 'error 42501',
  pg_temp.try($q$insert into public.item_assignees (item_id, household_id, user_id) select item1, hid, '33333333-3333-4333-8333-333333333333' from rls_ctx$q$));
select pg_temp.rec('C: set_item_assignees on A''s item', 'error P0002',
  pg_temp.try($q$select public.set_item_assignees((select item1 from rls_ctx), array['33333333-3333-4333-8333-333333333333'::uuid])$q$));
select pg_temp.rec('C: cannot attach A''s item to own household via assignees', 'error 23503',
  pg_temp.try($q$insert into public.item_assignees (item_id, household_id, user_id) select item1, other_hid, '33333333-3333-4333-8333-333333333333' from rls_ctx$q$));
select pg_temp.rec('C: update A items affects 0 rows', '0', pg_temp.val($q$with u as (update public.items set name = 'hacked' where household_id = (select hid from rls_ctx) returning 1) select count(*)::text from u$q$));
select pg_temp.rec('C: cannot import into A''s household', 'error 42501', pg_temp.try($q$select public.import_checklist((select hid from rls_ctx), '[{"room":"X","name":"Y"}]'::jsonb)$q$));
select pg_temp.rec('C: cannot create invite for A', 'error 42501', pg_temp.try($q$select public.create_household_invite((select hid from rls_ctx))$q$));
select pg_temp.rec('C: cannot set A''s household photo', 'error 42501', pg_temp.try($q$select public.set_household_photo((select hid from rls_ctx), (select hid from rls_ctx)::text || '/photo-1.webp')$q$));
select pg_temp.rec('C: storage rule denies A''s media folder', 'false', (select private.is_household_member(private.path_household(hid::text || '/photo-1.webp'))::text from rls_ctx));
select pg_temp.rec('C: bad invite code rejected', 'error P0002', pg_temp.try($q$select public.accept_household_invite('not-a-real-code')$q$));
select pg_temp.rec('C: cannot change own role', 'error 42501', pg_temp.try($q$update public.household_members set role = 'owner'$q$));
reset role;

-- ===== B and D join =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.rec('B: preview before joining (name, members, member?, spaces)', '("RLS Test House",1,f,3)', (select row(p.*)::text from rls_ctx, public.preview_household_invite(code) p));
select pg_temp.rec('B: joins', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_ctx));
select pg_temp.rec('B: joining again is a no-op', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_ctx));
select pg_temp.rec('B: adds self to A''s item (shared)', 'ok',
  pg_temp.try($q$select public.set_item_assignees((select item1 from rls_ctx), array['11111111-1111-4111-8111-111111111111'::uuid, '22222222-2222-4222-8222-222222222222'::uuid])$q$));
select pg_temp.rec('B: item now shared by 2', '2', (select count(*)::text from public.item_assignees a, rls_ctx where a.item_id = rls_ctx.item1));
select pg_temp.rec('B: can edit own tour state', '1', pg_temp.val($q$with u as (update public.profiles set tour_completed_at = now() where id = '22222222-2222-4222-8222-222222222222' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('B: cannot edit A''s tour state', '0', pg_temp.val($q$with u as (update public.profiles set tour_completed_at = now() where id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('B: can set household photo (any member)', 'ok', pg_temp.try($q$select public.set_household_photo((select hid from rls_ctx), (select hid from rls_ctx)::text || '/photo-1700000000000.webp')$q$));
select pg_temp.rec('B: photo path must be in this household''s folder', 'error 22023', pg_temp.try($q$select public.set_household_photo((select hid from rls_ctx), (select other_hid from rls_ctx)::text || '/photo-1.webp')$q$));
select pg_temp.rec('B: storage rule allows own household folder', 'true', (select private.is_household_member(private.path_household(hid::text || '/photo-1.webp'))::text from rls_ctx));
select pg_temp.rec('B: cannot rename household (owner only)', '0', pg_temp.val($q$with u as (update public.households set name = 'Mine now' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('B: invalid accent colour rejected', 'error 23514', pg_temp.try($q$update public.profiles set accent_color = 'red' where id = '22222222-2222-4222-8222-222222222222'$q$));

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.rec('D: joins (3 of 4)', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_ctx));
select pg_temp.rec('D: assigned to Rug', 'ok', pg_temp.try($q$select public.set_item_assignees((select item2 from rls_ctx), array['44444444-4444-4444-8444-444444444444'::uuid, '11111111-1111-4111-8111-111111111111'::uuid])$q$));
select pg_temp.rec('D: leaves the household', '1', pg_temp.val($q$with u as (delete from public.household_members where user_id = '44444444-4444-4444-8444-444444444444' returning 1) select count(*)::text from u$q$));
reset role;
select pg_temp.rec('After D leaves, their assignments are removed; A stays', '11111111-1111-4111-8111-111111111111',
  (select string_agg(user_id::text, ',') from public.item_assignees a, rls_ctx where a.item_id = rls_ctx.item2));

-- ===== Wishlist =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
insert into public.wishlist_items (household_id, title, room_id) select hid, 'Air fryer', (select id from public.rooms where name = 'Kitchen' and household_id = rls_ctx.hid) from rls_ctx;
update rls_ctx set idea = (select id from public.wishlist_items where title = 'Air fryer');
select pg_temp.rec('B: idea records who suggested it', '22222222-2222-4222-8222-222222222222', (select created_by::text from public.wishlist_items where title = 'Air fryer'));
select pg_temp.rec('B: cannot set checklist link directly', 'error 42501', pg_temp.try($q$update public.wishlist_items set checklist_item_id = (select item1 from rls_ctx)$q$));
select pg_temp.rec('B: idea room must be in this household', 'error 23514', pg_temp.try($q$update public.wishlist_items set room_id = (select other_room from rls_ctx)$q$));
select pg_temp.rec('B: votes', 'ok', pg_temp.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_ctx$q$));
select pg_temp.rec('B: second vote on same idea rejected', 'error 23505', pg_temp.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_ctx$q$));
select pg_temp.rec('B: cannot vote as someone else', 'error 42501',
  pg_temp.try($q$insert into public.wishlist_votes (idea_id, household_id, user_id) select idea, hid, '11111111-1111-4111-8111-111111111111' from rls_ctx$q$));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.rec('A: votes too', 'ok', pg_temp.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_ctx$q$));
select pg_temp.rec('A: sees 2 votes', '2', (select count(*)::text from public.wishlist_votes));
select pg_temp.rec('A: cannot remove B''s vote', '0', pg_temp.val($q$with u as (delete from public.wishlist_votes where user_id = '22222222-2222-4222-8222-222222222222' returning 1) select count(*)::text from u$q$));
select pg_temp.rec('A: removes own vote', '1', pg_temp.val($q$with u as (delete from public.wishlist_votes where user_id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));
update rls_ctx set conv = public.add_wishlist_to_checklist(idea);
select pg_temp.rec('A: converted idea created an unclaimed checklist item', 'Air fryer,nice_to_have,to_decide,0',
  (select i.name || ',' || i.priority || ',' || i.ownership || ',' || (select count(*) from public.item_assignees a where a.item_id = i.id) from public.items i, rls_ctx c where i.id = c.conv));
select pg_temp.rec('A: idea linked back and marked chosen', 'true', (select (w.checklist_item_id = c.conv and w.is_chosen)::text from public.wishlist_items w, rls_ctx c where w.id = c.idea));
select pg_temp.rec('A: converting again returns the same item', 'true', (select (public.add_wishlist_to_checklist(idea) = conv)::text from rls_ctx));
select pg_temp.rec('A: wishlist import (created, skipped)', '(2,0)',
  (select row(r.*)::text from rls_ctx, public.import_wishlist(hid, '[{"room":"Lounge","title":"Rug idea"},{"room":"Nowhere","title":"Lamp"}]'::jsonb) r));
select pg_temp.rec('A: wishlist re-import is idempotent', '(0,2)',
  (select row(r.*)::text from rls_ctx, public.import_wishlist(hid, '[{"room":"Lounge","title":"Rug idea"},{"room":"Nowhere","title":"Lamp"}]'::jsonb) r));
select pg_temp.rec('A: imported ideas are not attributed to the importer', '0', (select count(*)::text from public.wishlist_items where import_key is not null and created_by is not null));
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.rec('C: sees none of A''s ideas', '0', (select count(*)::text from public.wishlist_items w, rls_ctx c where w.household_id = c.hid));
select pg_temp.rec('C: cannot vote on A''s idea', 'error 42501', pg_temp.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_ctx$q$));
select pg_temp.rec('C: cannot convert A''s idea', 'error P0002', pg_temp.try($q$select public.add_wishlist_to_checklist((select idea from rls_ctx))$q$));
select pg_temp.rec('C: cannot import into A''s wishlist', 'error 42501', pg_temp.try($q$select public.import_wishlist((select hid from rls_ctx), '[{"room":"x","title":"y"}]'::jsonb)$q$));

-- ===== Capacity: fill the house =====
reset role;
update public.households set member_limit = 2 where id = (select hid from rls_ctx);
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.rec('Full house: no usable invites listed', '0', (select count(*)::text from rls_ctx c, public.get_household_invites(c.hid)));
select pg_temp.rec('Full house: new invite refused', 'error 54000', pg_temp.try($q$select public.create_household_invite((select hid from rls_ctx))$q$));
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.rec('Full house: existing link can''t be used', 'error 54000', pg_temp.try($q$select public.accept_household_invite((select code from rls_ctx))$q$));

-- ===== anon =====
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select pg_temp.rec('anon: items denied', 'error 42501', pg_temp.try('select * from public.items'));
select pg_temp.rec('anon: assignees denied', 'error 42501', pg_temp.try('select * from public.item_assignees'));
select pg_temp.rec('anon: wishlist denied', 'error 42501', pg_temp.try('select * from public.wishlist_items'));
select pg_temp.rec('anon: votes denied', 'error 42501', pg_temp.try('select * from public.wishlist_votes'));
select pg_temp.rec('anon: create_household denied', 'error 42501', pg_temp.try($q$select public.create_household('x')$q$));
select pg_temp.rec('anon: get_household_invites denied', 'error 42501', pg_temp.try($q$select * from public.get_household_invites(gen_random_uuid())$q$));
select pg_temp.rec('anon: private helpers not callable', 'error 42501', pg_temp.try($q$select private.is_household_member(gen_random_uuid())$q$));

-- ===== Storage policy wiring (expressions verified above) =====
reset role;
select pg_temp.rec('Storage: 4 household-media policies use membership check', '4',
  (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'household media:%'
     and coalesce(qual, with_check) like '%is_household_member%path_household%'));
select pg_temp.rec('Storage: household-media bucket is private', 'false', (select public::text from storage.buckets where id = 'household-media'));

-- ===== cleanup =====
delete from vault.secrets where id in (select secret_id from public.household_invites where household_id in (select hid from rls_ctx union select other_hid from rls_ctx));
delete from public.households where id in (select hid from rls_ctx union select other_hid from rls_ctx);
delete from auth.users where email like 'rls-_@test.invalid';

select n, case when expected = actual then 'PASS' else 'FAIL' end as result, test, expected, actual
from rls_results order by n;

commit;
