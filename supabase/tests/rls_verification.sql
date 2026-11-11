-- Flat Quest — RLS / access-isolation verification (Phases 1–4).
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- The result table should show 163 rows, every one with result = PASS.
--
-- Creates throwaway auth users and two test flats, impersonates each user
-- (request.jwt.claims + role), records expected vs actual outcomes, then deletes
-- everything it created. The transaction rolls back all test objects after returning results.
-- Run the entire file in one connection; do not execute selected statements.
--
-- The checks run inside ONE statement (a DO block) so they work in editors that
-- don't keep temporary tables or settings between statements.
--
-- Users: A = owner, B = joins via invite, D = joins then leaves, C = outsider with own house.

begin;
drop schema if exists rls_check cascade;
create schema rls_check;
revoke all on schema rls_check from public;
grant usage on schema rls_check to authenticated, anon;

create table rls_check.results (n serial primary key, test text, expected text, actual text);
create table rls_check.ctx (hid uuid, code text, other_hid uuid, item1 uuid, item2 uuid, other_room uuid, idea uuid, conv uuid, opt_a uuid, opt_b uuid, opt_r uuid);
grant all on rls_check.results, rls_check.ctx to authenticated, anon;
grant usage on sequence rls_check.results_n_seq to authenticated, anon;

create function rls_check.rec(t text, e text, a text) returns void language sql set search_path = pg_catalog, public as
$$ insert into rls_check.results (test, expected, actual) values (t, e, coalesce(a, 'NULL')) $$;
create function rls_check.try(q text) returns text language plpgsql set search_path = pg_catalog, public as $$
begin execute q; return 'ok'; exception when others then return 'error ' || sqlstate; end $$;
create function rls_check.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; exception when others then return 'error ' || sqlstate; end $$;
grant execute on all functions in schema rls_check to authenticated, anon;

do $test$
begin
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

  perform set_config('role', 'authenticated', true);

  -- ===== A: household, import, invite =====
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  insert into rls_check.ctx (hid) select public.create_household('RLS Test House', '1 Test St');
  perform rls_check.rec('A: first import (rooms, items, skipped)', '(2,3,0)',
    (select row(r.*)::text from rls_check.ctx, public.import_checklist(hid,
      '[{"room":"Kitchen","name":"Kettle"},{"room":"Kitchen","name":"Fridge","status":"provided","owned_by":"landlord"},{"room":"Lounge","name":"Rug","responsible":"TestA"}]'::jsonb) r));
  perform rls_check.rec('A: re-import is idempotent', '(0,0,3)',
    (select row(r.*)::text from rls_check.ctx, public.import_checklist(hid,
      '[{"room":"Kitchen","name":"Kettle"},{"room":"Kitchen","name":"Fridge"},{"room":"Lounge","name":"Rug"}]'::jsonb) r));
  update rls_check.ctx set item1 = (select id from public.items where name = 'Kettle'), item2 = (select id from public.items where name = 'Rug');
  perform rls_check.rec('A: import assigns matched name via item_assignees', '11111111-1111-4111-8111-111111111111',
    (select string_agg(user_id::text, ',') from public.item_assignees a, rls_check.ctx where a.item_id = rls_check.ctx.item2));
  perform rls_check.rec('A: provided status + landlord stored', 'provided,landlord', (select status || ',' || ownership from public.items where name = 'Fridge'));
  perform rls_check.rec('A: unknown status rejected', 'error 23514', rls_check.try($q$update public.items set status = 'bogus' where name = 'Fridge'$q$));
  perform rls_check.rec('A: direct insert into households blocked', 'error 42501', rls_check.try($q$insert into public.households (name) values ('sneaky')$q$));
  perform rls_check.rec('A: direct insert into household_members blocked', 'error 42501',
    rls_check.try($q$insert into public.household_members (household_id, user_id) select hid, '33333333-3333-4333-8333-333333333333' from rls_check.ctx$q$));
  perform rls_check.rec('A: completed_by set by DB (client value ignored)', '11111111-1111-4111-8111-111111111111',
    rls_check.val($q$with u as (update public.items set is_complete = true, completed_by = '22222222-2222-4222-8222-222222222222' where name = 'Rug' returning completed_by) select completed_by::text from u$q$));
  perform rls_check.rec('A: cannot move item to another household', 'error 42501', rls_check.try($q$update public.items set household_id = gen_random_uuid() where name = 'Rug'$q$));
  perform rls_check.rec('A: ordered does not complete an item', 'false',
    rls_check.val($q$with u as (update public.items set status = 'ordered' where name = 'Kettle' returning is_complete) select is_complete::text from u$q$));
  update rls_check.ctx set code = public.create_household_invite(hid);
  perform rls_check.rec('A: second invite blocked while one is active', 'error 23505', rls_check.try($q$select public.create_household_invite((select hid from rls_check.ctx))$q$));
  perform rls_check.rec('A: current invite code can be re-read', 'true', (select (i.code = c.code)::text from rls_check.ctx c, public.get_household_invites(c.hid) i));
  perform rls_check.rec('A: invite hashes not readable', 'error 42501', rls_check.try('select token_hash from public.household_invites'));
  perform rls_check.rec('A: vault secrets not readable', 'error 42501', rls_check.try('select * from vault.decrypted_secrets'));
  perform rls_check.rec('A: sets assignees to self', 'ok', rls_check.try($q$select public.set_item_assignees((select item1 from rls_check.ctx), array['11111111-1111-4111-8111-111111111111'::uuid])$q$));
  perform rls_check.rec('A: cannot assign a non-member', 'error 23503',
    rls_check.try($q$select public.set_item_assignees((select item1 from rls_check.ctx), array['33333333-3333-4333-8333-333333333333'::uuid])$q$));
  perform rls_check.rec('A: failed assignment left the previous one intact', '1', (select count(*)::text from public.item_assignees a, rls_check.ctx where a.item_id = rls_check.ctx.item1));
  perform set_config('role', 'none', true);
  -- Database-level guarantee: a second current invite can't exist even if two requests race.
  perform rls_check.rec('DB: unique index blocks a second current invite', 'error 23505',
    rls_check.try($q$insert into public.household_invites (household_id, token_hash, expires_at) select hid, 'race', now() + interval '1 day' from rls_check.ctx$q$));
  perform set_config('role', 'authenticated', true);

  -- ===== C: outsider =====
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
  update rls_check.ctx set other_hid = public.create_household('Other House', null);
  insert into public.rooms (household_id, name) select other_hid, 'C room' from rls_check.ctx;
  update rls_check.ctx set other_room = (select id from public.rooms where name = 'C room');
  perform rls_check.rec('C: sees none of A''s items', '0', (select count(*)::text from public.items i, rls_check.ctx c where i.household_id = c.hid));
  perform rls_check.rec('C: sees none of A''s assignments', '0', (select count(*)::text from public.item_assignees));
  perform rls_check.rec('C: cannot read A''s profile', '0', (select count(*)::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'));
  perform rls_check.rec('C: cannot list A''s invites', 'error 42501', rls_check.try($q$select * from public.get_household_invites((select hid from rls_check.ctx))$q$));
  perform rls_check.rec('C: cannot assign self to A''s item (RLS)', 'error 42501',
    rls_check.try($q$insert into public.item_assignees (item_id, household_id, user_id) select item1, hid, '33333333-3333-4333-8333-333333333333' from rls_check.ctx$q$));
  perform rls_check.rec('C: set_item_assignees on A''s item', 'error P0002',
    rls_check.try($q$select public.set_item_assignees((select item1 from rls_check.ctx), array['33333333-3333-4333-8333-333333333333'::uuid])$q$));
  perform rls_check.rec('C: cannot attach A''s item to own household via assignees', 'error 23503',
    rls_check.try($q$insert into public.item_assignees (item_id, household_id, user_id) select item1, other_hid, '33333333-3333-4333-8333-333333333333' from rls_check.ctx$q$));
  perform rls_check.rec('C: update A items affects 0 rows', '0', rls_check.val($q$with u as (update public.items set name = 'hacked' where household_id = (select hid from rls_check.ctx) returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('C: cannot import into A''s household', 'error 42501', rls_check.try($q$select public.import_checklist((select hid from rls_check.ctx), '[{"room":"X","name":"Y"}]'::jsonb)$q$));
  perform rls_check.rec('C: cannot create invite for A', 'error 42501', rls_check.try($q$select public.create_household_invite((select hid from rls_check.ctx))$q$));
  perform rls_check.rec('C: cannot set A''s household photo', 'error 42501', rls_check.try($q$select public.set_household_photo((select hid from rls_check.ctx), (select hid from rls_check.ctx)::text || '/photo-1.webp')$q$));
  perform rls_check.rec('C: storage rule denies A''s media folder', 'false', (select private.is_household_member(private.path_household(hid::text || '/photo-1.webp'))::text from rls_check.ctx));
  perform rls_check.rec('C: bad invite code rejected', 'error P0002', rls_check.try($q$select public.accept_household_invite('not-a-real-code')$q$));
  perform rls_check.rec('C: cannot change own role', 'error 42501', rls_check.try($q$update public.household_members set role = 'owner'$q$));
  perform set_config('role', 'none', true);

  -- ===== B and D join =====
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  perform rls_check.rec('B: preview before joining (name, members, member?, spaces)', '("RLS Test House",1,f,3)', (select row(p.*)::text from rls_check.ctx, public.preview_household_invite(code) p));
  perform rls_check.rec('B: joins', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_check.ctx));
  perform rls_check.rec('B: joining again is a no-op', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_check.ctx));
  perform rls_check.rec('B: adds self to A''s item (shared)', 'ok',
    rls_check.try($q$select public.set_item_assignees((select item1 from rls_check.ctx), array['11111111-1111-4111-8111-111111111111'::uuid, '22222222-2222-4222-8222-222222222222'::uuid])$q$));
  perform rls_check.rec('B: item now shared by 2', '2', (select count(*)::text from public.item_assignees a, rls_check.ctx where a.item_id = rls_check.ctx.item1));
  perform rls_check.rec('B: can edit own tour state', '1', rls_check.val($q$with u as (update public.profiles set tour_completed_at = now() where id = '22222222-2222-4222-8222-222222222222' returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('B: cannot edit A''s tour state', '0', rls_check.val($q$with u as (update public.profiles set tour_completed_at = now() where id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('B: can set household photo (any member)', 'ok', rls_check.try($q$select public.set_household_photo((select hid from rls_check.ctx), (select hid from rls_check.ctx)::text || '/photo-1700000000000.webp')$q$));
  perform rls_check.rec('B: photo path must be in this household''s folder', 'error 22023', rls_check.try($q$select public.set_household_photo((select hid from rls_check.ctx), (select other_hid from rls_check.ctx)::text || '/photo-1.webp')$q$));
  perform rls_check.rec('B: storage rule allows own household folder', 'true', (select private.is_household_member(private.path_household(hid::text || '/photo-1.webp'))::text from rls_check.ctx));
  perform rls_check.rec('B: cannot rename household (owner only)', '0', rls_check.val($q$with u as (update public.households set name = 'Mine now' returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('B: invalid accent colour rejected', 'error 23514', rls_check.try($q$update public.profiles set accent_color = 'red' where id = '22222222-2222-4222-8222-222222222222'$q$));

  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
  perform rls_check.rec('D: joins (3 of 4)', 'true', (select (public.accept_household_invite(code) = hid)::text from rls_check.ctx));
  perform rls_check.rec('D: assigned to Rug', 'ok', rls_check.try($q$select public.set_item_assignees((select item2 from rls_check.ctx), array['44444444-4444-4444-8444-444444444444'::uuid, '11111111-1111-4111-8111-111111111111'::uuid])$q$));
  perform rls_check.rec('D: leaves the household', '1', rls_check.val($q$with u as (delete from public.household_members where user_id = '44444444-4444-4444-8444-444444444444' returning 1) select count(*)::text from u$q$));
  perform set_config('role', 'none', true);
  perform rls_check.rec('After D leaves, their assignments are removed; A stays', '11111111-1111-4111-8111-111111111111',
    (select string_agg(user_id::text, ',') from public.item_assignees a, rls_check.ctx where a.item_id = rls_check.ctx.item2));

  -- ===== Wishlist =====
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  insert into public.wishlist_items (household_id, title, room_id) select hid, 'Air fryer', (select id from public.rooms where name = 'Kitchen' and household_id = rls_check.ctx.hid) from rls_check.ctx;
  update rls_check.ctx set idea = (select id from public.wishlist_items where title = 'Air fryer');
  perform rls_check.rec('B: idea records who suggested it', '22222222-2222-4222-8222-222222222222', (select created_by::text from public.wishlist_items where title = 'Air fryer'));
  perform rls_check.rec('B: cannot set checklist link directly', 'error 42501', rls_check.try($q$update public.wishlist_items set checklist_item_id = (select item1 from rls_check.ctx)$q$));
  perform rls_check.rec('B: idea room must be in this household', 'error 23514', rls_check.try($q$update public.wishlist_items set room_id = (select other_room from rls_check.ctx)$q$));
  perform rls_check.rec('B: votes', 'ok', rls_check.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_check.ctx$q$));
  perform rls_check.rec('B: second vote on same idea rejected', 'error 23505', rls_check.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_check.ctx$q$));
  perform rls_check.rec('B: cannot vote as someone else', 'error 42501',
    rls_check.try($q$insert into public.wishlist_votes (idea_id, household_id, user_id) select idea, hid, '11111111-1111-4111-8111-111111111111' from rls_check.ctx$q$));
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('A: votes too', 'ok', rls_check.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_check.ctx$q$));
  perform rls_check.rec('A: sees 2 votes', '2', (select count(*)::text from public.wishlist_votes));
  perform rls_check.rec('A: cannot remove B''s vote', '0', rls_check.val($q$with u as (delete from public.wishlist_votes where user_id = '22222222-2222-4222-8222-222222222222' returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('A: removes own vote', '1', rls_check.val($q$with u as (delete from public.wishlist_votes where user_id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));
  update rls_check.ctx set conv = public.add_wishlist_to_checklist(idea);
  perform rls_check.rec('A: converted idea created an unclaimed checklist item', 'Air fryer,nice_to_have,to_decide,0',
    (select i.name || ',' || i.priority || ',' || i.ownership || ',' || (select count(*) from public.item_assignees a where a.item_id = i.id) from public.items i, rls_check.ctx c where i.id = c.conv));
  perform rls_check.rec('A: idea linked back and marked chosen', 'true', (select (w.checklist_item_id = c.conv and w.is_chosen)::text from public.wishlist_items w, rls_check.ctx c where w.id = c.idea));
  perform rls_check.rec('A: converting again returns the same item', 'true', (select (public.add_wishlist_to_checklist(idea) = conv)::text from rls_check.ctx));
  perform rls_check.rec('A: wishlist import (created, skipped)', '(2,0)',
    (select row(r.*)::text from rls_check.ctx, public.import_wishlist(hid, '[{"room":"Lounge","title":"Rug idea"},{"room":"Nowhere","title":"Lamp"}]'::jsonb) r));
  perform rls_check.rec('A: wishlist re-import is idempotent', '(0,2)',
    (select row(r.*)::text from rls_check.ctx, public.import_wishlist(hid, '[{"room":"Lounge","title":"Rug idea"},{"room":"Nowhere","title":"Lamp"}]'::jsonb) r));
  perform rls_check.rec('A: imported ideas are not attributed to the importer', '0', (select count(*)::text from public.wishlist_items where import_key is not null and created_by is not null));
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
  perform rls_check.rec('C: sees none of A''s ideas', '0', (select count(*)::text from public.wishlist_items w, rls_check.ctx c where w.household_id = c.hid));
  perform rls_check.rec('C: cannot vote on A''s idea', 'error 42501', rls_check.try($q$insert into public.wishlist_votes (idea_id, household_id) select idea, hid from rls_check.ctx$q$));
  perform rls_check.rec('C: cannot convert A''s idea', 'error P0002', rls_check.try($q$select public.add_wishlist_to_checklist((select idea from rls_check.ctx))$q$));
  perform rls_check.rec('C: cannot import into A''s wishlist', 'error 42501', rls_check.try($q$select public.import_wishlist((select hid from rls_check.ctx), '[{"room":"x","title":"y"}]'::jsonb)$q$));

  -- ===== Phase 4: shopping =====
  -- Kettle (item1) is shared by A and B; Rug (item2) belongs to A and is complete.
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('A: purchase stages are values of the existing status', 'ok', rls_check.try($q$update public.items set status = 'on_the_way' where id = (select item1 from rls_check.ctx)$q$));
  update public.items set status = 'shopping' where id = (select item1 from rls_check.ctx);
  insert into public.product_options (household_id, item_id, name, retailer, price, url, width_cm, depth_cm, height_cm)
    select hid, item1, 'Kettle A', 'Briscoes', 89.00, 'https://example.com/kettle-a', 22, 16, 25.5 from rls_check.ctx;
  update rls_check.ctx set opt_a = (select id from public.product_options where name = 'Kettle A');
  insert into public.product_options (household_id, item_id, name) select hid, item2, 'Rug option' from rls_check.ctx;
  update rls_check.ctx set opt_r = (select id from public.product_options where name = 'Rug option');
  perform rls_check.rec('A: option records who suggested it', '11111111-1111-4111-8111-111111111111', (select created_by::text from public.product_options o, rls_check.ctx c where o.id = c.opt_a));
  perform rls_check.rec('A: cannot set who suggested an option', 'error 42501',
    rls_check.try($q$insert into public.product_options (household_id, item_id, name, created_by) select hid, item1, 'Spoof', '22222222-2222-4222-8222-222222222222' from rls_check.ctx$q$));
  perform rls_check.rec('A: cannot write selected_by directly', 'error 42501', rls_check.try($q$update public.product_options set selected_by = '22222222-2222-4222-8222-222222222222'$q$));
  perform rls_check.rec('A: negative price rejected', 'error 23514', rls_check.try($q$update public.product_options set price = -1 where id = (select opt_a from rls_check.ctx)$q$));
  perform rls_check.rec('A: non-web link rejected', 'error 23514', rls_check.try($q$update public.product_options set url = 'javascript:alert(1)' where id = (select opt_a from rls_check.ctx)$q$));
  perform rls_check.rec('A: zero measurement rejected', 'error 23514', rls_check.try($q$update public.product_options set width_cm = 0 where id = (select opt_a from rls_check.ctx)$q$));
  perform rls_check.rec('A: absurd measurement rejected', 'error 23514', rls_check.try($q$update public.product_options set height_cm = 2000.5 where id = (select opt_a from rls_check.ctx)$q$));
  perform rls_check.rec('A: product photo must be in this household''s products folder', 'error 23514',
    rls_check.try($q$update public.product_options set photo_path = (select other_hid from rls_check.ctx)::text || '/products/x.webp' where id = (select opt_a from rls_check.ctx)$q$));
  perform rls_check.rec('A: product photo path cannot escape the products folder', 'error 23514',
    rls_check.try($q$update public.product_options set photo_path = (select hid from rls_check.ctx)::text || '/products/../photo-1.webp' where id = (select opt_a from rls_check.ctx)$q$));
  perform rls_check.rec('A: valid product photo path accepted', 'ok',
    rls_check.try($q$update public.product_options set photo_path = (select hid from rls_check.ctx)::text || '/products/kettle-1700000000000.webp' where id = (select opt_a from rls_check.ctx)$q$));
  perform rls_check.rec('A: option cannot move to another item', 'error 42501', rls_check.try($q$update public.product_options set item_id = (select item2 from rls_check.ctx) where id = (select opt_a from rls_check.ctx)$q$));

  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  insert into public.product_options (household_id, item_id, name, retailer, price) select hid, item1, 'Kettle B', 'Kmart', 45 from rls_check.ctx;
  update rls_check.ctx set opt_b = (select id from public.product_options where name = 'Kettle B');
  perform rls_check.rec('B: competing option sits under the same item', '2,1', (select count(*)::text || ',' || count(distinct item_id)::text from public.product_options o, rls_check.ctx c where o.item_id = c.item1));
  perform rls_check.rec('B: prefers an option', 'ok', rls_check.try($q$insert into public.product_preferences (item_id, household_id, option_id) select item1, hid, opt_b from rls_check.ctx$q$));
  perform rls_check.rec('B: second preference for the same item rejected', 'error 23505', rls_check.try($q$insert into public.product_preferences (item_id, household_id, option_id) select item1, hid, opt_a from rls_check.ctx$q$));
  perform rls_check.rec('B: cannot prefer on behalf of A', 'error 42501',
    rls_check.try($q$insert into public.product_preferences (item_id, household_id, option_id, user_id) select item1, hid, opt_a, '11111111-1111-4111-8111-111111111111' from rls_check.ctx$q$));
  perform rls_check.rec('B: changes own preference', '1', rls_check.val($q$with u as (update public.product_preferences set option_id = (select opt_a from rls_check.ctx) where item_id = (select item1 from rls_check.ctx) returning 1) select count(*)::text from u$q$));
  update public.product_preferences set option_id = (select opt_b from rls_check.ctx) where item_id = (select item1 from rls_check.ctx) and user_id = '22222222-2222-4222-8222-222222222222';
  perform rls_check.rec('B: cannot reassign a preference to someone else', 'error 42501', rls_check.try($q$update public.product_preferences set user_id = '11111111-1111-4111-8111-111111111111'$q$));

  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('A: prefers a different option', 'ok', rls_check.try($q$insert into public.product_preferences (item_id, household_id, option_id) select item1, hid, opt_a from rls_check.ctx$q$));
  perform rls_check.rec('A: cannot change B''s preference', '0', rls_check.val($q$with u as (update public.product_preferences set option_id = (select opt_a from rls_check.ctx) where user_id = '22222222-2222-4222-8222-222222222222' returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('A: cannot remove B''s preference', '0', rls_check.val($q$with u as (delete from public.product_preferences where user_id = '22222222-2222-4222-8222-222222222222' returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('A: preference must be an option of that same item', 'error 23503',
    rls_check.try($q$update public.product_preferences set option_id = (select opt_r from rls_check.ctx) where user_id = '11111111-1111-4111-8111-111111111111'$q$));
  perform rls_check.rec('Preferences: one per member, two members', 'Kettle A=1,Kettle B=1',
    (select string_agg(n || '=' || c, ',' order by n) from (select o.name n, count(*) c from public.product_preferences p join public.product_options o on o.id = p.option_id, rls_check.ctx x where p.item_id = x.item1 group by o.name) t));
  perform rls_check.rec('A: preferences alone select nothing', '0', (select count(*)::text from public.product_options o, rls_check.ctx c where o.item_id = c.item1 and o.is_selected));
  perform rls_check.rec('A: selects the final option (DB records who)', '11111111-1111-4111-8111-111111111111',
    rls_check.val($q$with u as (update public.product_options set is_selected = true where id = (select opt_a from rls_check.ctx) returning selected_by) select selected_by::text from u$q$));
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  perform rls_check.rec('B: changing the selection keeps exactly one selected', 'ok', rls_check.try($q$update public.product_options set is_selected = true where id = (select opt_b from rls_check.ctx)$q$));
  perform rls_check.rec('B: new selection replaced the old one', 'Kettle B', (select string_agg(o.name, ',') from public.product_options o, rls_check.ctx c where o.item_id = c.item1 and o.is_selected));
  perform rls_check.rec('B: the earlier pick is kept as an alternative, unselected and cleared', '2,true',
    (select (select count(*) from public.product_options o where o.item_id = c.item1)::text || ',' || (select (selected_at is null and selected_by is null)::text from public.product_options o where o.id = c.opt_a) from rls_check.ctx c));
  perform rls_check.rec('B: selecting did not touch preferences', '2', (select count(*)::text from public.product_preferences p, rls_check.ctx c where p.item_id = c.item1));

  -- Purchase coordination
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('A: takes on sorting the purchase', 'ok', rls_check.try($q$insert into public.purchase_coordinators (item_id, household_id) select item1, hid from rls_check.ctx$q$));
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  perform rls_check.rec('B: second claim on the same item rejected', 'error 23505', rls_check.try($q$insert into public.purchase_coordinators (item_id, household_id) select item1, hid from rls_check.ctx$q$));
  perform rls_check.rec('B: cannot claim in A''s name', 'error 42501',
    rls_check.try($q$insert into public.purchase_coordinators (item_id, household_id, user_id) select item2, hid, '11111111-1111-4111-8111-111111111111' from rls_check.ctx$q$));
  perform rls_check.rec('B: cannot release A''s role', '0', rls_check.val($q$with u as (delete from public.purchase_coordinators returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('B: take-over with a stale expectation changes nothing', '0',
    rls_check.val($q$with u as (update public.purchase_coordinators set user_id = '22222222-2222-4222-8222-222222222222' where item_id = (select item1 from rls_check.ctx) and user_id = '44444444-4444-4444-8444-444444444444' returning 1) select count(*)::text from u$q$));
  perform rls_check.rec('B: deliberate take-over from A', '1',
    rls_check.val($q$with u as (update public.purchase_coordinators set user_id = '22222222-2222-4222-8222-222222222222' where item_id = (select item1 from rls_check.ctx) and user_id = '11111111-1111-4111-8111-111111111111' returning 1) select count(*)::text from u$q$));
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('A: cannot appoint a third person while B is sorting it', 'error 42501',
    rls_check.try($q$update public.purchase_coordinators set user_id = '33333333-3333-4333-8333-333333333333' where item_id = (select item1 from rls_check.ctx)$q$));
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  perform rls_check.rec('B: cannot hand over to a non-member', 'error 23503',
    rls_check.try($q$update public.purchase_coordinators set user_id = '33333333-3333-4333-8333-333333333333' where item_id = (select item1 from rls_check.ctx)$q$));
  perform rls_check.rec('B: hands over to A', '11111111-1111-4111-8111-111111111111',
    rls_check.val($q$with u as (update public.purchase_coordinators set user_id = '11111111-1111-4111-8111-111111111111' where item_id = (select item1 from rls_check.ctx) and user_id = '22222222-2222-4222-8222-222222222222' returning user_id) select user_id::text from u$q$));
  perform rls_check.rec('Coordination left the assignees and ownership alone', '2,to_decide',
    (select (select count(*) from public.item_assignees a where a.item_id = c.item1)::text || ',' || (select ownership from public.items i where i.id = c.item1) from rls_check.ctx c));
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('A: releases own role', '1', rls_check.val($q$with u as (delete from public.purchase_coordinators returning 1) select count(*)::text from u$q$));

  -- Purchase and delivery
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  perform rls_check.rec('B: records the purchase, stage and amount together', 'ordered,89.00,ORD-1,22222222-2222-4222-8222-222222222222',
    rls_check.val($q$select (r -> 'item' ->> 'status') || ',' || (r -> 'item' ->> 'actual_price') || ',' || (r -> 'purchase' ->> 'order_reference') || ',' || (r -> 'purchase' ->> 'updated_by')
      from public.save_item_purchase((select item1 from rls_check.ctx), null, (select opt_b from rls_check.ctx), '22222222-2222-4222-8222-222222222222', date '2026-11-12', ' ORD-1 ', null, 'delivery', date '2026-11-20', 'https://track.example/1', null, null, 'ordered', 'shopping', true, 89.00, null) r$q$));
  perform rls_check.rec('Ordered is not complete', 'false', (select is_complete::text from public.items i, rls_check.ctx c where i.id = c.item1));
  perform rls_check.rec('B: a duplicate submission from a stale form is refused', 'error FQ409',
    rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), null, null, null, null, 'ORD-2')$q$));
  perform rls_check.rec('B: refused save changed nothing', 'ORD-1,1', (select order_reference || ',' || (select count(*) from public.item_purchases)::text from public.item_purchases p, rls_check.ctx c where p.item_id = c.item1));
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('A: stage change from a stale stage is refused', 'error FQ409',
    rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), (select updated_at from public.item_purchases), (select opt_b from rls_check.ctx), '22222222-2222-4222-8222-222222222222', date '2026-11-12', 'ORD-1', null, 'delivery', date '2026-11-20', null, null, null, 'on_the_way', 'shopping')$q$));
  perform rls_check.rec('A: amount change from a stale amount is refused', 'error FQ409',
    rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), (select updated_at from public.item_purchases), null, null, null, null, null, null, null, null, null, null, null, null, true, 10, null)$q$));
  perform rls_check.rec('A: buyer must be a household member', 'error 23503',
    rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), (select updated_at from public.item_purchases), null, '33333333-3333-4333-8333-333333333333')$q$));
  perform rls_check.rec('A: purchased option must belong to that item', 'error 23503',
    rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), (select updated_at from public.item_purchases), (select opt_r from rls_check.ctx))$q$));
  perform rls_check.rec('A: unknown delivery method rejected', 'error 23514',
    rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), (select updated_at from public.item_purchases), null, null, null, null, null, 'teleport')$q$));
  perform rls_check.rec('A: unknown stage rejected', 'error 23514',
    rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), (select updated_at from public.item_purchases), null, null, null, null, null, null, null, null, null, null, 'bogus', 'ordered')$q$));
  perform rls_check.rec('A: cannot edit purchase bookkeeping columns directly', 'error 42501', rls_check.try($q$update public.item_purchases set updated_by = '22222222-2222-4222-8222-222222222222'$q$));
  perform rls_check.rec('A: cannot delete a purchase record directly', 'error 42501', rls_check.try($q$delete from public.item_purchases$q$));
  perform rls_check.rec('A: delivery progress saved with a current version', 'on_the_way,2026-11-21,11111111-1111-4111-8111-111111111111',
    rls_check.val($q$select (r -> 'item' ->> 'status') || ',' || (r -> 'purchase' ->> 'expected_on') || ',' || (r -> 'purchase' ->> 'updated_by')
      from public.save_item_purchase((select item1 from rls_check.ctx), (select updated_at from public.item_purchases), (select opt_b from rls_check.ctx), '22222222-2222-4222-8222-222222222222', date '2026-11-12', 'ORD-1', null, 'delivery', date '2026-11-21', 'https://track.example/1', null, null, 'on_the_way', 'ordered') r$q$));
  perform rls_check.rec('A: amount paid was left alone by that save', '89.00', (select actual_price::text from public.items i, rls_check.ctx c where i.id = c.item1));
  perform rls_check.rec('A: delivered is still not complete', 'delivered,false',
    rls_check.val($q$with u as (update public.items set status = 'delivered' where id = (select item1 from rls_check.ctx) returning status, is_complete) select status || ',' || is_complete::text from u$q$));
  perform rls_check.rec('A: "it''s in the flat" completes the checklist item (DB records who)', 'true,11111111-1111-4111-8111-111111111111,delivered',
    rls_check.val($q$with u as (update public.items set is_complete = true where id = (select item1 from rls_check.ctx) returning is_complete, completed_by, status) select is_complete::text || ',' || completed_by::text || ',' || status from u$q$));
  perform rls_check.rec('A: purchase works for an item with no product options', 'ok',
    rls_check.try($q$select public.save_item_purchase((select id from public.items where name = 'Fridge'), null, null, '11111111-1111-4111-8111-111111111111', date '2026-11-12')$q$));
  perform rls_check.rec('A: removes the purchased option', '1', rls_check.val($q$with d as (delete from public.product_options where id = (select opt_b from rls_check.ctx) returning 1) select count(*)::text from d$q$));
  perform rls_check.rec('A: the purchase record survives without its option', 'true',
    (select (p.option_id is null and p.order_reference = 'ORD-1')::text from public.item_purchases p, rls_check.ctx c where p.item_id = c.item1));
  perform rls_check.rec('A: removing an option removes only the preferences for it', 'Kettle A', (select string_agg(o.name, ',') from public.product_preferences p join public.product_options o on o.id = p.option_id, rls_check.ctx c where p.item_id = c.item1));

  -- Room measurements
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  perform rls_check.rec('B: saves room measurements', '320.0,410.0',
    rls_check.val($q$with u as (update public.rooms set width_cm = 320, length_cm = 410, measurement_notes = 'Door is 76 cm wide' where name = 'Kitchen' returning width_cm, length_cm) select width_cm::text || ',' || length_cm::text from u$q$));
  perform rls_check.rec('B: negative room measurement rejected', 'error 23514', rls_check.try($q$update public.rooms set height_cm = -240 where name = 'Kitchen'$q$));

  -- Outsider
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
  perform rls_check.rec('C: sees none of A''s options, preferences, coordinators or purchases', '0,0,0,0',
    (select (select count(*) from public.product_options)::text || ',' || (select count(*) from public.product_preferences)::text || ',' || (select count(*) from public.purchase_coordinators)::text || ',' || (select count(*) from public.item_purchases)::text));
  perform rls_check.rec('C: cannot add an option to A''s item', 'error 42501', rls_check.try($q$insert into public.product_options (household_id, item_id, name) select hid, item1, 'x' from rls_check.ctx$q$));
  perform rls_check.rec('C: cannot attach A''s item to own household via an option', 'error 23503', rls_check.try($q$insert into public.product_options (household_id, item_id, name) select other_hid, item1, 'x' from rls_check.ctx$q$));
  perform rls_check.rec('C: cannot edit or remove A''s options', '0,0',
    rls_check.val($q$with u as (update public.product_options set name = 'hacked' returning 1), d as (delete from public.product_options returning 1) select (select count(*) from u)::text || ',' || (select count(*) from d)::text$q$));
  perform rls_check.rec('C: cannot prefer A''s option', 'error 42501', rls_check.try($q$insert into public.product_preferences (item_id, household_id, option_id) select item1, hid, opt_a from rls_check.ctx$q$));
  perform rls_check.rec('C: cannot prefer A''s option through own household', 'error 23503', rls_check.try($q$insert into public.product_preferences (item_id, household_id, option_id) select item1, other_hid, opt_a from rls_check.ctx$q$));
  perform rls_check.rec('C: cannot claim A''s purchase', 'error 42501', rls_check.try($q$insert into public.purchase_coordinators (item_id, household_id) select item2, hid from rls_check.ctx$q$));
  perform rls_check.rec('C: cannot record a purchase for A''s item', 'error P0002', rls_check.try($q$select public.save_item_purchase((select item1 from rls_check.ctx), null)$q$));
  perform rls_check.rec('C: cannot insert a purchase row for A''s item', 'error 42501', rls_check.try($q$insert into public.item_purchases (item_id, household_id) select item2, hid from rls_check.ctx$q$));
  perform rls_check.rec('C: storage rule denies A''s product photos', 'false', (select private.is_household_member(private.path_household(hid::text || '/products/kettle-1.webp'))::text from rls_check.ctx));
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  perform rls_check.rec('B: storage rule allows own household''s product photos', 'true', (select private.is_household_member(private.path_household(hid::text || '/products/kettle-1.webp'))::text from rls_check.ctx));

  -- A member who leaves takes their preference and coordination with them, nothing else.
  -- (D is re-added directly so the invite's remaining uses are untouched for the checks below.)
  perform set_config('role', 'none', true);
  insert into public.household_members (household_id, user_id) select hid, '44444444-4444-4444-8444-444444444444' from rls_check.ctx;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
  insert into public.product_preferences (item_id, household_id, option_id) select item1, hid, opt_a from rls_check.ctx;
  insert into public.purchase_coordinators (item_id, household_id) select item2, hid from rls_check.ctx;
  perform public.save_item_purchase((select item2 from rls_check.ctx), null, null, '44444444-4444-4444-8444-444444444444', date '2026-11-12');
  delete from public.household_members where user_id = '44444444-4444-4444-8444-444444444444';
  perform set_config('role', 'none', true);
  perform rls_check.rec('After D leaves: preference and coordination gone; purchase kept without a buyer; options kept', '0,0,true,2',
    (select (select count(*) from public.product_preferences where user_id = '44444444-4444-4444-8444-444444444444')::text || ','
         || (select count(*) from public.purchase_coordinators)::text || ','
         || (select (p.purchased_by is null and p.purchased_on = date '2026-11-12')::text from public.item_purchases p where p.item_id = c.item2) || ','
         || (select count(*) from public.product_options o where o.household_id = c.hid)::text
       from rls_check.ctx c));
  perform set_config('role', 'authenticated', true);

  -- ===== Capacity: fill the house =====
  perform set_config('role', 'none', true);
  update public.households set member_limit = 2 where id = (select hid from rls_check.ctx);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform rls_check.rec('Full house: no usable invites listed', '0', (select count(*)::text from rls_check.ctx c, public.get_household_invites(c.hid)));
  perform rls_check.rec('Full house: new invite refused', 'error 54000', rls_check.try($q$select public.create_household_invite((select hid from rls_check.ctx))$q$));
  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
  perform rls_check.rec('Full house: existing link can''t be used', 'error 54000', rls_check.try($q$select public.accept_household_invite((select code from rls_check.ctx))$q$));

  -- ===== anon =====
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform rls_check.rec('anon: items denied', 'error 42501', rls_check.try('select * from public.items'));
  perform rls_check.rec('anon: assignees denied', 'error 42501', rls_check.try('select * from public.item_assignees'));
  perform rls_check.rec('anon: wishlist denied', 'error 42501', rls_check.try('select * from public.wishlist_items'));
  perform rls_check.rec('anon: votes denied', 'error 42501', rls_check.try('select * from public.wishlist_votes'));
  perform rls_check.rec('anon: create_household denied', 'error 42501', rls_check.try($q$select public.create_household('x')$q$));
  perform rls_check.rec('anon: get_household_invites denied', 'error 42501', rls_check.try($q$select * from public.get_household_invites(gen_random_uuid())$q$));
  perform rls_check.rec('anon: product options denied', 'error 42501', rls_check.try('select * from public.product_options'));
  perform rls_check.rec('anon: product preferences denied', 'error 42501', rls_check.try('select * from public.product_preferences'));
  perform rls_check.rec('anon: purchase coordinators denied', 'error 42501', rls_check.try('select * from public.purchase_coordinators'));
  perform rls_check.rec('anon: purchases denied', 'error 42501', rls_check.try('select * from public.item_purchases'));
  perform rls_check.rec('anon: save_item_purchase denied', 'error 42501', rls_check.try($q$select public.save_item_purchase(gen_random_uuid())$q$));
  perform rls_check.rec('anon: private helpers not callable', 'error 42501', rls_check.try($q$select private.is_household_member(gen_random_uuid())$q$));

  -- ===== Storage policy wiring (expressions verified above) =====
  perform set_config('role', 'none', true);
  perform rls_check.rec('Storage: 4 household-media policies use membership check', '4',
    (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'household media:%'
       and coalesce(qual, with_check) like '%is_household_member%path_household%'));
  perform rls_check.rec('Storage: household-media bucket is private', 'false', (select public::text from storage.buckets where id = 'household-media'));
  perform rls_check.rec('Phase 4: RLS enabled on all four new tables', '4',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
       and c.relname in ('product_options', 'product_preferences', 'purchase_coordinators', 'item_purchases')));
  perform rls_check.rec('Phase 4: new tables are in the realtime publication', '4',
    (select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('product_options', 'product_preferences', 'purchase_coordinators', 'item_purchases')));
  perform rls_check.rec('Phase 4: no new SECURITY DEFINER functions', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef
       and ((n.nspname = 'public' and p.proname = 'save_item_purchase')
         or (n.nspname = 'private' and p.proname in ('product_options_guard', 'purchase_coordinators_guard', 'item_purchases_guard')))));
  perform rls_check.rec('Phase 4: API roles cannot truncate or bypass the new tables', '0',
    (select count(*)::text from information_schema.table_privileges where table_schema = 'public'
       and table_name in ('product_options', 'product_preferences', 'purchase_coordinators', 'item_purchases')
       and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')));

  -- ===== cleanup (as postgres) =====
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  delete from vault.secrets where id in (select secret_id from public.household_invites where household_id in (select hid from rls_check.ctx union select other_hid from rls_check.ctx));
  delete from public.households where id in (select hid from rls_check.ctx union select other_hid from rls_check.ctx);
  delete from auth.users where email like 'rls-_@test.invalid';
  revoke all on rls_check.results, rls_check.ctx from authenticated, anon;
  revoke usage on schema rls_check from authenticated, anon;
end
$test$;

select n, case when expected = actual then 'PASS' else 'FAIL' end as result, test, expected, actual
from rls_check.results order by n;

-- Make CI fail instead of accepting a printed FAIL row as a successful SQL command.
do $$
begin
  if (select count(*) from rls_check.results) <> 163
     or exists (select 1 from rls_check.results where expected is distinct from actual) then
    raise exception 'RLS verification failed';
  end if;
end $$;
rollback;
