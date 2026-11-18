-- Phase 10 verification: per-flat time zones, shared appointments and coverage, across two flats.
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
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', '', true);
$$;
-- save_appointment with named, readable arguments.
create function pg_temp.save(id uuid, flat uuid, rev int, title text, day date, s time default null, e time default null,
  cover boolean default false, room uuid default null, notes text default null) returns jsonb language sql as $$
  select public.save_appointment(id, flat, rev, title, notes, room, day, s, e, cover)
$$;
create function pg_temp.appt(id uuid) returns public.calendar_appointments language sql as $$
  select * from public.calendar_appointments where id = $1
$$;

do $$
declare
  owner_a uuid := gen_random_uuid(); mate_a uuid := gen_random_uuid(); dual uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  flat_a uuid; flat_b uuid; flat_o uuid; room_a uuid; room_b uuid;
  inspection uuid := gen_random_uuid(); pickup uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  r public.calendar_appointments; rev int; j jsonb; start_before timestamptz;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@phase10.invalid', '{}', '{}', now(), now()
    from unnest(array[owner_a, mate_a, dual, owner_b, outsider]) u;
  update public.profiles set display_name = 'Mate' where id = mate_a;

  perform pg_temp.as_user(owner_a);
  flat_a := public.create_household('Flat A', '');
  insert into public.rooms (household_id, name) values (flat_a, 'Kitchen') returning id into room_a;
  perform pg_temp.as_user(owner_b);
  flat_b := public.create_household('Flat B', '');
  insert into public.rooms (household_id, name) values (flat_b, 'Kitchen') returning id into room_b;
  perform pg_temp.as_user(outsider);
  flat_o := public.create_household('Elsewhere', '');
  perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (flat_a, mate_a), (flat_a, dual), (flat_b, dual);

  -- ── Time zones
  perform pg_temp.ok((select private.household_zone(settings) = 'Pacific/Auckland' from public.households where id = flat_a), 'a flat without a zone behaves as Auckland');
  perform pg_temp.as_admin();
  update public.households set settings = '{"currency":"NZD"}' where id = flat_b;
  perform pg_temp.as_user(owner_b);
  perform public.set_household_timezone(flat_b, 'America/Los_Angeles');
  perform pg_temp.ok((select settings = '{"currency":"NZD","timezone":"America/Los_Angeles"}'::jsonb from public.households where id = flat_b), 'setting the zone keeps the other settings');
  perform pg_temp.denied(format('select public.set_household_timezone(%L, %L)', flat_b, 'Mars/Olympus_Mons'), '22023', 'an unknown time zone is refused');
  perform pg_temp.denied(format('update public.households set settings = settings || ''{"timezone":"Nowhere/Land"}'' where id = %L', flat_b), '22023', 'a direct settings write with a bad zone is refused too');
  perform pg_temp.as_user(dual);
  perform pg_temp.denied(format('select public.set_household_timezone(%L, %L)', flat_b, 'Pacific/Auckland'), '42501', 'only the owner sets the zone');
  -- A legacy bad value (written before validation existed) can no longer break reminders for everyone.
  perform pg_temp.as_admin();
  alter table public.households disable trigger households_settings_guard;
  update public.households set settings = '{"timezone":"Not/AZone"}' where id = flat_o;
  alter table public.households enable trigger households_settings_guard;
  perform pg_temp.ok((select private.household_zone(settings) = 'Pacific/Auckland' from public.households where id = flat_o), 'a legacy invalid zone falls back to Auckland');
  perform private.send_reminders(now());
  perform pg_temp.ok(true, 'the reminder job still runs with a legacy invalid zone in another flat');

  -- ── Creating appointments
  perform pg_temp.as_user(mate_a);
  j := pg_temp.save(inspection, flat_a, null, '  Property inspection  ', date '2026-11-20', time '10:00', time '11:00', true, room_a);
  r := pg_temp.appt(inspection);
  perform pg_temp.ok(r.title = 'Property inspection' and r.revision = 1 and r.created_by = mate_a and r.needs_cover and r.host_id is null,
    'any flatmate can add an appointment that needs someone home');
  perform pg_temp.ok(r.starts_at = timestamptz '2026-11-20 10:00 Pacific/Auckland' and r.ends_at = timestamptz '2026-11-20 11:00 Pacific/Auckland',
    'times are resolved in the flat’s own zone');
  j := pg_temp.save(inspection, flat_a, null, 'Property inspection', date '2026-11-20', time '10:00', time '11:00', true, room_a);
  perform pg_temp.ok((select count(*) = 1 from public.calendar_appointments where id = inspection) and (j->>'revision')::int = 1,
    'retrying a create after an unclear response returns the original, never a duplicate');
  perform pg_temp.as_user(owner_a);
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L)', inspection, flat_a, 'Hijack', '2026-11-21'), '23505', 'someone else cannot reuse an existing id');
  perform pg_temp.as_user(mate_a);
  perform pg_temp.save(pickup, flat_a, null, 'Pick up the couch', date '2026-11-21');
  perform pg_temp.ok((select all_day and starts_at is null from public.calendar_appointments where id = pickup), 'all-day appointments keep a civil date only');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L)', x, flat_a, '   ', '2026-11-21'), '23514', 'a title is required');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L)', x, flat_a, repeat('x', 81), '2026-11-21'), '23514', 'titles stay short');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L, notes => %L)', x, flat_a, 'Notes', '2026-11-21', repeat('n', 501)), '23514', 'notes stay short');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L, %L, %L)', x, flat_a, 'Backwards', '2026-11-21', '11:00', '10:00'), '23514', 'the end must be after the start');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L, %L)', x, flat_a, 'Half', '2026-11-21', '11:00'), '23514', 'a start needs an end');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L, %L, %L)', x, flat_a, 'Spring forward', '2026-09-27', '02:30', '03:30'), '22008',
    'a time that doesn’t exist (clocks go forward) is refused');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L, %L, %L)', x, flat_a, 'Fall back', '2026-04-05', '02:30', '04:00'), '22008',
    'a time that happens twice (clocks go back) is refused');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L, room => %L)', x, flat_a, 'Wrong room', '2026-11-21', room_b), '23514',
    'a room from another flat is refused');
  perform pg_temp.as_user(outsider);
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, null, %L, %L)', x, flat_a, 'Intruder', '2026-11-21'), '42501', 'an outsider cannot add to a flat');
  perform pg_temp.ok((select count(*) = 0 from public.calendar_appointments where household_id = flat_a), 'an outsider cannot see a flat’s appointments');
  perform pg_temp.denied(format('insert into public.calendar_appointments (id, household_id, title, all_day, scheduled_on) values (%L, %L, %L, true, %L)', x, flat_o, 'Direct', '2026-11-21'),
    '42501', 'direct inserts are refused (only the checked functions write)');
  perform pg_temp.as_user(mate_a);
  perform pg_temp.denied(format('update public.calendar_appointments set host_id = %L where id = %L', mate_a, inspection), '42501', 'direct updates are refused');
  perform pg_temp.denied(format('delete from public.calendar_appointments where id = %L', inspection), '42501', 'direct deletes are refused');

  -- ── A person in two flats sees each flat only in its own scope, and can't mix them.
  perform pg_temp.as_user(dual);
  perform pg_temp.ok((select count(*) = 2 from public.calendar_appointments where household_id = flat_a), 'a member of dual flats sees Flat A’s appointments');
  perform pg_temp.save(x, flat_b, null, 'Flat B meter reading', date '2026-11-20', time '09:00', time '09:30', true);
  perform pg_temp.ok((select household_id = flat_b and starts_at = timestamptz '2026-11-20 09:00 America/Los_Angeles' from public.calendar_appointments where id = x),
    'Flat B’s appointment uses Flat B’s zone');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, 1, %L, %L, room => %L)', x, flat_b, 'Moved rooms', '2026-11-20', room_a), '23514',
    'Flat A’s room cannot be attached to a Flat B appointment');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, 1, %L, %L)', x, flat_a, 'Moved flats', '2026-11-20'), 'P0002', 'an appointment cannot be moved to another flat');
  perform pg_temp.as_user(mate_a);
  perform pg_temp.ok((select count(*) = 0 from public.calendar_appointments where household_id = flat_b), 'a Flat A member sees nothing from Flat B');
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, 1, %L)', x, 'claim'), 'P0002', 'and cannot volunteer for Flat B');
  perform pg_temp.as_admin();
  perform pg_temp.denied(format('update public.calendar_appointments set host_id = %L where id = %L', mate_a, x), '23503',
    'the database key alone forbids a host from another flat');

  -- ── Coverage
  perform pg_temp.as_user(dual);
  rev := (pg_temp.appt(inspection)).revision;
  j := public.set_appointment_cover(inspection, rev, 'claim');
  perform pg_temp.ok((j->>'host_id')::uuid = dual and (j->>'revision')::int = rev + 1, 'a flatmate volunteers to be home');
  perform pg_temp.ok((public.set_appointment_cover(inspection, rev, 'claim')->>'host_id')::uuid = dual, 'a repeated tap by the volunteer is harmless');
  perform pg_temp.as_user(owner_a);
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, %s, %L)', inspection, rev + 1, 'claim'), 'FQ409', 'a second volunteer is refused');
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, %s, %L)', inspection, rev + 1, 'release'), '42501', 'only the volunteer can step back');
  perform pg_temp.as_user(dual);
  j := public.set_appointment_cover(inspection, rev + 1, 'release');
  perform pg_temp.ok(j->>'host_id' is null, 'the volunteer can step back');
  perform pg_temp.as_user(owner_a);
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, %s, %L)', inspection, rev, 'claim'), 'FQ409', 'a claim against an old version is refused');
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, 1, %L)', pickup, 'claim'), 'FQ409', 'nobody can volunteer when no one is needed');

  -- ── Editing
  perform pg_temp.as_user(dual);
  rev := (pg_temp.appt(inspection)).revision;
  perform public.set_appointment_cover(inspection, rev, 'claim');
  rev := (pg_temp.appt(inspection)).revision;
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, %s, %L, %L, %L, %L, true)', inspection, flat_a, rev, 'Mine now', '2026-11-20', '10:00', '11:00'), '42501',
    'a flatmate who didn’t add it cannot edit it');
  perform pg_temp.denied(format('select public.cancel_appointment(%L, %s)', inspection, rev), '42501', 'or cancel it');
  perform pg_temp.as_user(mate_a);
  j := pg_temp.save(inspection, flat_a, rev, 'Routine inspection', date '2026-11-20', time '10:00', time '11:00', true, room_a, 'Tidy the lounge');
  perform pg_temp.ok((j->>'host_id')::uuid = dual and j->>'title' = 'Routine inspection' and (j->>'revision')::int = rev + 1, 'a title or note edit keeps the volunteer');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, %s, %L, %L, %L, %L, true)', inspection, flat_a, rev, 'Stale', '2026-11-20', '10:00', '11:00'), 'FQ409',
    'a save from a stale screen is refused');
  rev := rev + 1;
  j := pg_temp.save(inspection, flat_a, rev, 'Routine inspection', date '2026-11-20', time '13:00', time '14:00', true, room_a, 'Tidy the lounge');
  perform pg_temp.ok(j->>'host_id' is null and (j->>'revision')::int = rev + 1, 'moving the time reopens coverage');
  perform pg_temp.as_user(dual);
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, %s, %L)', inspection, rev, 'claim'), 'FQ409', 'a claim made before it moved is refused');
  rev := rev + 1;
  perform public.set_appointment_cover(inspection, rev, 'claim');
  rev := rev + 1;
  perform pg_temp.as_user(owner_a);
  j := pg_temp.save(inspection, flat_a, rev, 'Routine inspection', date '2026-11-22', time '13:00', time '14:00', true, room_a, 'Tidy the lounge');
  perform pg_temp.ok(j->>'host_id' is null and j->>'scheduled_on' = '2026-11-22', 'the owner can reschedule; moving the day reopens coverage');
  rev := (j->>'revision')::int;
  perform pg_temp.as_user(dual);
  perform public.set_appointment_cover(inspection, rev, 'claim');
  rev := rev + 1;
  perform pg_temp.as_user(mate_a);
  j := pg_temp.save(inspection, flat_a, rev, 'Routine inspection', date '2026-11-22', time '13:00', time '14:00', false, room_a, 'Tidy the lounge');
  perform pg_temp.ok(j->>'host_id' is null and not (j->>'needs_cover')::boolean, 'no longer needing someone home clears the volunteer');
  rev := (j->>'revision')::int;
  j := pg_temp.save(inspection, flat_a, rev, 'Routine inspection', date '2026-11-22', time '13:00', time '14:00', true, room_a, 'Tidy the lounge');
  rev := (j->>'revision')::int;
  perform pg_temp.as_user(dual);
  perform public.set_appointment_cover(inspection, rev, 'claim');

  -- ── Zone change keeps booked moments and the volunteer
  perform pg_temp.as_admin();
  start_before := (pg_temp.appt(inspection)).starts_at;
  perform pg_temp.as_user(owner_a);
  perform public.set_household_timezone(flat_a, 'Australia/Sydney');
  perform pg_temp.ok((select starts_at = start_before and host_id = dual from public.calendar_appointments where id = inspection),
    'changing the flat’s zone keeps the booked time and the volunteer');
  perform public.set_household_timezone(flat_a, 'Pacific/Auckland');

  -- ── Database cleanup bumps the revision
  perform pg_temp.as_admin();
  rev := (pg_temp.appt(inspection)).revision;
  delete from public.household_members where household_id = flat_a and user_id = dual;
  r := pg_temp.appt(inspection);
  perform pg_temp.ok(r.host_id is null and r.revision = rev + 1, 'when the volunteer leaves the flat, coverage reopens (and the revision moves)');
  delete from public.rooms where id = room_a;
  r := pg_temp.appt(inspection);
  perform pg_temp.ok(r.room_id is null and r.revision = rev + 2, 'deleting the room keeps the appointment and clears the room');
  perform pg_temp.as_user(dual);
  perform pg_temp.ok((select count(*) = 0 from public.calendar_appointments where household_id = flat_a), 'a removed member loses access immediately');
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, %s, %L)', inspection, rev + 2, 'claim'), 'P0002', 'and cannot volunteer any more');

  -- ── Cancelling
  perform pg_temp.as_user(owner_a);
  perform pg_temp.denied(format('select public.cancel_appointment(%L, %s)', inspection, rev), 'FQ409', 'cancelling from a stale screen is refused');
  j := public.cancel_appointment(inspection, rev + 2);
  perform pg_temp.ok(j->>'cancelled_at' is not null and (j->>'cancelled_by')::uuid = owner_a and j->>'host_id' is null, 'the owner can cancel; it is recorded, not deleted');
  perform pg_temp.ok((public.cancel_appointment(inspection, 0)->>'cancelled_at') is not null, 'cancelling twice is harmless');
  perform pg_temp.as_user(mate_a);
  perform pg_temp.denied(format('select public.set_appointment_cover(%L, %s, %L)', inspection, rev + 3, 'claim'), 'P0002', 'nobody can volunteer for a cancelled appointment');
  perform pg_temp.denied(format('select pg_temp.save(%L, %L, %s, %L, %L)', inspection, flat_a, rev + 3, 'Revive', '2026-11-23'), 'P0002', 'a cancelled appointment cannot be edited');
  perform pg_temp.as_user(owner_a);
  perform pg_temp.denied(format('select public.cancel_appointment(%L, 0)', pickup), 'FQ409', 'the owner still needs the current version to cancel');

  -- ── Grants
  perform pg_temp.as_admin();
  perform pg_temp.ok(not has_function_privilege('authenticated', 'private.local_instant(date, time, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.appointments_revision()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.save_appointment(uuid, uuid, integer, text, text, uuid, date, time, time, boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_household_timezone(uuid, text)', 'EXECUTE'), 'helpers are private and nothing is open to anonymous users');
  perform pg_temp.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'calendar_appointments'), 'appointments are published to Realtime');
  perform pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.calendar_appointments'::regclass), 'row-level security is on');
end
$$;
rollback;
