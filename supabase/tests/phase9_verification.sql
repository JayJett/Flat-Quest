-- Phase 9 verification: room covers and descriptions; one reminder per task per run.
-- Disposable local database only; everything rolls back.
begin;
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.denied(stmt text, code text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (statement succeeded)', label;
exception when others then
  if sqlstate = code then raise notice 'PASS: %', label;
  else raise exception 'FAIL: % (got % %)', label, sqlstate, sqlerrm; end if;
end $$;
create function pg_temp.touched(stmt text) returns integer language plpgsql as $$
declare n integer;
begin execute stmt; get diagnostics n = row_count; return n; end $$;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.reminders(u uuid, t uuid) returns integer language sql as $$
  select count(*)::int from public.notifications n join public.household_events e on e.id = n.event_id
   where n.recipient_id = u and e.type = 'task_reminder' and e.task_id = t
$$;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  h uuid; other_h uuid; kitchen uuid; lounge uuid; other_room uuid;
  photo uuid; photo2 uuid; link_only uuid; lounge_photo uuid; other_photo uuid; spare uuid;
  t1 uuid; t4 uuid; t_changed uuid; t_unassigned uuid; t_done uuid; sent int;
  nz_now timestamptz := '2026-11-20 01:00:00+00'; -- 20 Nov in Auckland
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@phase9.invalid', '{}', '{}', now(), now()
    from unnest(array[a, b, d]) u;
  perform pg_temp.as_user(a);
  h := public.create_household('Phase 9 flat', '');
  insert into public.rooms (household_id, name, color, icon) values (h, 'Kitchen', 'green', 'cooking-pot') returning id into kitchen;
  insert into public.rooms (household_id, name) values (h, 'Lounge') returning id into lounge;
  perform pg_temp.as_user(b); perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (h, b);
  perform pg_temp.as_user(d);
  other_h := public.create_household('Elsewhere', '');
  insert into public.rooms (household_id, name) values (other_h, 'Their room') returning id into other_room;
  perform pg_temp.as_admin();
  -- Visual Home records (paths only; storage isn't needed to test references). Uploads are
  -- reserved first, exactly as the app does.
  insert into private.media_uploads (path, household_id)
  select p, split_part(p, '/', 1)::uuid from unnest(array[h || '/visual/a.webp', h || '/visual/b.webp', h || '/visual/c.webp',
    h || '/visual/d.webp', other_h || '/visual/e.webp']) p;
  insert into public.room_visuals (household_id, room_id, kind, photo_path, thumbnail_path) values
    (h, kitchen, 'photo', h || '/visual/a.webp', h || '/visual/a-thumb.webp') returning id into photo;
  insert into public.room_visuals (household_id, room_id, kind, photo_path, thumbnail_path) values
    (h, kitchen, 'inspiration', h || '/visual/b.webp', h || '/visual/b-thumb.webp') returning id into photo2;
  insert into public.room_visuals (household_id, room_id, kind, source_url) values (h, kitchen, 'inspiration', 'https://example.com') returning id into link_only;
  insert into public.room_visuals (household_id, room_id, kind, photo_path, thumbnail_path) values (h, lounge, 'photo', h || '/visual/c.webp', h || '/visual/c-thumb.webp') returning id into lounge_photo;
  insert into public.room_visuals (household_id, room_id, kind, photo_path, thumbnail_path) values (other_h, other_room, 'photo', other_h || '/visual/e.webp', other_h || '/visual/e-thumb.webp') returning id into other_photo;
  insert into public.room_visuals (household_id, room_id, kind, photo_path, thumbnail_path) values (h, kitchen, 'photo', h || '/visual/d.webp', h || '/visual/d-thumb.webp') returning id into spare;

  -- ── Covers and descriptions.
  perform pg_temp.as_user(b);
  perform pg_temp.ok(pg_temp.touched(format('update public.rooms set cover_visual_id = %L, description = %L where id = %L',
    photo, '  Where all   the cooking happens. ', kitchen)) = 1, 'any flatmate can set a cover and description');
  perform pg_temp.as_admin();
  perform pg_temp.ok((select description = 'Where all the cooking happens.' and cover_visual_id = photo and name = 'Kitchen' and color = 'green' and icon = 'cooking-pot'
    from public.rooms where id = kitchen), 'description tidied; name, colour and icon untouched');
  perform pg_temp.as_user(b);
  update public.rooms set cover_visual_id = photo2 where id = kitchen;
  perform pg_temp.ok((select cover_visual_id = photo2 from public.rooms where id = kitchen), 'inspiration images with a picture can be covers too');
  perform pg_temp.denied(format('update public.rooms set cover_visual_id = %L where id = %L', link_only, kitchen), '23514', 'a link-only idea (no image) cannot be a cover');
  perform pg_temp.denied(format('update public.rooms set cover_visual_id = %L where id = %L', lounge_photo, kitchen), '23514', 'a photo from another room is refused');
  perform pg_temp.denied(format('update public.rooms set cover_visual_id = %L where id = %L', other_photo, kitchen), '23514', 'a photo from another flat is refused');
  perform pg_temp.denied(format('update public.rooms set description = %L where id = %L', repeat('x', 121), kitchen), '23514', 'descriptions stay short');
  -- Even bypassing the guard, the database key rejects a mismatched cover.
  perform pg_temp.as_admin();
  alter table public.rooms disable trigger rooms_personality_guard;
  perform pg_temp.denied(format('update public.rooms set cover_visual_id = %L where id = %L', lounge_photo, kitchen), '23503', 'the foreign key alone also forbids another room''s photo');
  alter table public.rooms enable trigger rooms_personality_guard;
  perform pg_temp.as_user(d);
  perform pg_temp.ok(pg_temp.touched(format('update public.rooms set description = ''mine now'' where id = %L', kitchen)) = 0, 'outsiders cannot change a room');
  perform pg_temp.ok((select count(*) = 0 from public.room_visuals where household_id = h), 'outsiders cannot see the photos behind a cover');
  perform pg_temp.as_user(b);
  update public.rooms set cover_visual_id = null, description = '' where id = kitchen;
  perform pg_temp.ok((select cover_visual_id is null and description is null from public.rooms where id = kitchen), 'cover and description can be removed');

  -- Deleting the cover photo falls back gracefully; deleting the room still works.
  update public.rooms set cover_visual_id = spare where id = kitchen;
  delete from public.room_visuals where id = spare;
  perform pg_temp.ok((select cover_visual_id is null from public.rooms where id = kitchen), 'removing the photo clears the cover (no broken image)');
  perform pg_temp.ok((select count(*) = 3 from public.room_visuals where room_id = kitchen), 'other photos are untouched');
  update public.rooms set cover_visual_id = photo where id = kitchen;
  perform pg_temp.as_admin();
  delete from public.rooms where id = kitchen;
  perform pg_temp.ok(not exists (select 1 from public.rooms where id = kitchen) and not exists (select 1 from public.room_visuals where room_id = kitchen),
    'a room with a cover can still be deleted');
  perform pg_temp.ok(private.media_referenced(h || '/visual/c.webp'), 'media cleanup still sees Visual Home files as in use');

  -- ── Reminders: one per task per run (Auckland calendar; today = 20 Nov).
  perform pg_temp.as_user(a);
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (h, 'One day overdue', b, date '2026-11-19') returning id into t1;
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (h, 'Four days overdue, never reminded', b, date '2026-11-16') returning id into t4;
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (h, 'Date moved', b, date '2026-11-15') returning id into t_changed;
  insert into public.household_tasks (household_id, title, due_on) values (h, 'Nobody assigned', date '2026-11-10') returning id into t_unassigned;
  insert into public.household_tasks (household_id, title, assignee_id, due_on, status) values (h, 'Already done', b, date '2026-11-10', 'done') returning id into t_done;
  perform pg_temp.as_admin();
  delete from public.notifications;

  sent := private.send_reminders(nz_now);
  perform pg_temp.ok(pg_temp.reminders(b, t1) = 1, 'a task one day overdue gets its first nudge');
  perform pg_temp.ok(pg_temp.reminders(b, t4) = 1, 'a task four days overdue with no previous reminder gets exactly one');
  perform pg_temp.ok((select (data->>'stage')::int = 2 from public.household_events where task_id = t4 and type = 'task_reminder'),
    'and it is the follow-up wording that fits its age');
  perform pg_temp.ok((select count(*) = 2 from private.reminders_sent where target_id = t4), 'the skipped first nudge is marked handled');
  perform pg_temp.ok(pg_temp.reminders(b, t_unassigned) = 0 and pg_temp.reminders(b, t_done) = 0, 'unassigned and completed tasks never nudge');
  perform pg_temp.ok(sent = 3, 'three tasks, three reminders — never two for one task in a run');

  sent := private.send_reminders(nz_now + interval '1 hour');
  perform pg_temp.ok(sent = 0, 'running again sends nothing');
  sent := private.send_reminders(nz_now + interval '2 days');
  perform pg_temp.ok(pg_temp.reminders(b, t1) = 2 and pg_temp.reminders(b, t4) = 1, 'the one-day task later gets its single follow-up; the other gets nothing more');

  perform pg_temp.as_user(b);
  update public.household_tasks set due_on = date '2026-11-21' where id = t_changed;
  perform pg_temp.as_admin();
  sent := private.send_reminders(timestamptz '2026-11-22 01:00:00+00');
  perform pg_temp.ok(pg_temp.reminders(b, t_changed) = 2 and (select count(*) = 1 from public.household_events where task_id = t_changed
    and type = 'task_reminder' and data->>'due' = '2026-11-21'), 'a changed due date starts a fresh cycle with one nudge');
  perform pg_temp.as_user(b);
  update public.household_tasks set archived_at = now() where id = t1;
  perform pg_temp.as_admin();
  sent := private.send_reminders(timestamptz '2026-11-30 01:00:00+00');
  perform pg_temp.ok(pg_temp.reminders(b, t1) = 2, 'archived tasks are never nudged');

  -- Muted reminders are still respected.
  perform pg_temp.as_user(b);
  insert into public.user_preferences (muted_notifications) values (array['reminders']);
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (h, 'Muted', b, date '2026-11-28') returning id into t1;
  perform pg_temp.as_admin();
  sent := private.send_reminders(timestamptz '2026-11-30 01:00:00+00');
  perform pg_temp.ok(pg_temp.reminders(b, t1) = 0, 'notification preferences still apply');

  perform pg_temp.ok(not has_function_privilege('authenticated', 'private.send_reminders(timestamptz)', 'EXECUTE'), 'only the scheduler can run reminders');
end
$$;
rollback;
