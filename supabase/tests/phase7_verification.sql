-- Phase 7 (living mode) verification. Disposable local database only: every fixture is
-- created inside this transaction and rolled back at the end.
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
create function pg_temp.as_admin() returns void language sql as $$ select set_config('role', 'none', true) $$;
create function pg_temp.inbox(u uuid, why text default null, kind text default null) returns integer language sql as $$
  select count(*)::int from public.notifications n join public.household_events e on e.id = n.event_id
   where n.recipient_id = u and (why is null or n.reason = why) and (kind is null or e.type = kind)
$$;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  h uuid; other_h uuid; r uuid; other_r uuid; tp uuid; soap uuid; t uuid; t2 uuid; e public.essentials;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@phase7.invalid', '{}', '{}', now(), now()
    from unnest(array[a, b, c, d]) u;
  update public.profiles set display_name = v.name
    from (values (a, 'Avery'), (b, 'Blair'), (c, 'Casey'), (d, 'Drew')) v(u, name) where id = v.u;

  perform pg_temp.as_user(a);
  h := public.create_household('Phase 7 flat', '');
  insert into public.rooms (household_id, name) values (h, 'Kitchen') returning id into r;
  perform pg_temp.as_user(b); perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (h, b);
  perform pg_temp.as_user(c); perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (h, c);
  perform pg_temp.as_user(d);
  other_h := public.create_household('Elsewhere', '');
  insert into public.rooms (household_id, name) values (other_h, 'Other room') returning id into other_r;

  -- ── Essentials: creation and duplicates.
  perform pg_temp.as_user(a);
  insert into public.essentials (household_id, name, category) values (h, '  Toilet   paper ', 'bathroom') returning id into tp;
  perform pg_temp.denied(format('insert into public.essentials (household_id, name, created_by, claimed_by) values (%L, ''Dish soap'', %L, %L)', h, b, b),
    '42501', 'clients cannot create an essential as someone else or already claimed');
  insert into public.essentials (household_id, name, status) values (h, 'Dish soap', 'getting') returning id into soap;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select name = 'Toilet paper' and status = 'needed' and needed_by = a and created_by = a from public.essentials where id = tp),
    'new essential is tidied, needed, and attributed by the server');
  perform pg_temp.ok((select status = 'needed' and claimed_by is null and created_by = a from public.essentials where id = soap),
    'an essential created as "getting" starts as needed, unclaimed');
  perform pg_temp.ok((select count(*) = 1 and max((data->>'count')::int) = 2 from public.household_events where household_id = h and type = 'essential_needed'),
    'several needs in a row are one coalesced timeline entry');
  perform pg_temp.as_user(b);
  perform pg_temp.denied(format('insert into public.essentials (household_id, name) values (%L, %L)', h, 'TOILET PAPER'), '23505',
    'the same essential cannot be added twice (case and spacing ignored)');
  perform pg_temp.denied(format('update public.essentials set status = ''stocked'' where id = %L', tp), '42501',
    'status only changes through update_essential');
  perform pg_temp.denied(format('delete from public.essentials where id = %L', tp), '42501', 'essentials are archived, never deleted');

  -- ── Claiming, conflicts, handover, takeover.
  e := public.update_essential(tp, 'claim', 'needed');
  perform pg_temp.ok(e.status = 'getting' and e.claimed_by = b, 'claiming marks who is getting it');
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(a, 'responsible', 'essential_claimed') = 1 and pg_temp.inbox(b, null, 'essential_claimed') = 0,
    'whoever asked for it hears it is sorted; the claimer is not told about themselves');
  perform pg_temp.as_user(c);
  perform pg_temp.denied(format('select public.update_essential(%L, ''claim'', ''needed'')', tp), 'FQ409',
    'a second claim is refused, not silently overwritten');
  perform pg_temp.denied(format('select public.update_essential(%L, ''release'')', tp), '42501', 'only the claimer can let it go');
  perform pg_temp.as_user(b);
  e := public.update_essential(tp, 'claim', 'needed');
  perform pg_temp.ok(e.claimed_by = b, 'claiming again is harmless for the claimer');
  perform pg_temp.denied(format('select public.update_essential(%L, ''handover'', null, %L)', tp, d), '23514',
    'cannot hand an essential to someone outside the flat');
  e := public.update_essential(tp, 'handover', 'getting', c);
  perform pg_temp.as_admin();
  perform pg_temp.ok(e.claimed_by = c and pg_temp.inbox(c, 'handover', 'essential_handover') = 1, 'handover tells the new person');
  perform pg_temp.as_user(a);
  e := public.update_essential(tp, 'takeover', 'getting');
  perform pg_temp.as_admin();
  perform pg_temp.ok(e.claimed_by = a and pg_temp.inbox(c, 'takeover', 'essential_takeover') = 1, 'taking over tells the previous person');

  -- ── Restocking, idempotency, undo, need again.
  perform pg_temp.as_user(b);
  e := public.update_essential(tp, 'restock', 'getting');
  e := public.update_essential(tp, 'restock', 'getting');
  perform pg_temp.as_admin();
  perform pg_temp.ok(e.status = 'stocked' and e.claimed_by is null and e.restocked_by = b, 'restocked clears the claim');
  perform pg_temp.ok((select count(*) = 1 from public.essential_restocks where essential_id = tp), 'a double tap records one restock');
  perform pg_temp.ok(pg_temp.inbox(a, 'responsible', 'essential_restocked') = 1 and pg_temp.inbox(c, null, 'essential_restocked') = 0,
    'only the person who was going to buy it is told (no household broadcast)');
  perform pg_temp.ok(exists (select 1 from public.household_events where essential_id = tp and type = 'essential_restocked' and in_timeline),
    'restocks appear on the timeline');
  perform pg_temp.as_user(c);
  perform pg_temp.denied(format('select public.update_essential(%L, ''undo_restock'')', tp), 'FQ409', 'only the restocker can undo');
  perform pg_temp.as_user(b);
  e := public.update_essential(tp, 'undo_restock');
  perform pg_temp.as_admin();
  perform pg_temp.ok(e.status = 'getting' and e.claimed_by = a and e.needed_by = a, 'undo puts the request back exactly');
  perform pg_temp.ok(not exists (select 1 from public.essential_restocks where essential_id = tp)
    and not exists (select 1 from public.household_events where essential_id = tp and type = 'essential_restocked'),
    'an undone restock leaves no history');
  perform pg_temp.as_user(b);
  e := public.update_essential(tp, 'restock');
  perform pg_temp.denied(format('select public.update_essential(%L, ''claim'', ''needed'')', tp), 'FQ409', 'a stale screen cannot claim a restocked item');
  e := public.update_essential(tp, 'need');
  perform pg_temp.as_admin();
  perform pg_temp.ok(e.status = 'needed' and e.needed_by = b and (select count(*) = 1 from public.essentials where household_id = h and name_key = 'toilet paper'),
    'Need again reuses the same essential (no duplicate)');
  perform pg_temp.as_user(b);
  e := public.update_essential(tp, 'restock');
  e := public.update_essential(tp, 'need');
  e := public.update_essential(tp, 'restock');
  perform pg_temp.as_admin();
  perform pg_temp.ok((select count(*) = 3 from public.essential_restocks where essential_id = tp), 'restock history accumulates');

  -- ── Archive and restore.
  perform pg_temp.as_user(a);
  update public.essentials set archived_at = now() where id = soap;
  perform pg_temp.denied(format('select public.update_essential(%L, ''claim'')', soap), 'FQ409', 'archived essentials cannot be claimed');
  e := public.update_essential(soap, 'need');
  perform pg_temp.ok(e.archived_at is null and e.status = 'needed', 'Need again restores an archived essential');

  -- ── Removal of a claimer reopens the request.
  perform pg_temp.as_user(c);
  e := public.update_essential(soap, 'claim', 'needed');

  -- ── Tasks.
  perform pg_temp.as_user(a);
  perform pg_temp.denied(format('insert into public.household_tasks (household_id, title, completed_by) values (%L, ''x'', %L)', h, d), '42501',
    'completion attribution cannot be supplied by the client');
  insert into public.household_tasks (household_id, title, assignee_id, due_on, room_id)
    values (h, ' Assemble  the TV cabinet ', b, date '2026-11-20', r) returning id into t;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select title = 'Assemble the TV cabinet' and due_on = date '2026-11-20' and created_by = a and completed_by is null
    from public.household_tasks where id = t), 'task saved tidily; the due date is a calendar date; creator set by the server');
  perform pg_temp.ok(pg_temp.inbox(b, 'assigned', 'task_assigned') = 1
    and exists (select 1 from public.household_events where task_id = t and type = 'task_added' and in_timeline),
    'the assignee is told; the task is on the timeline');
  perform pg_temp.as_user(a);
  perform pg_temp.denied(format('insert into public.household_tasks (household_id, title, assignee_id) values (%L, ''x'', %L)', h, d), '23503',
    'tasks can only be assigned to flatmates');
  perform pg_temp.denied(format('insert into public.household_tasks (household_id, title, room_id) values (%L, ''x'', %L)', h, other_r), '23514',
    'a task cannot point at another flat''s room');
  perform pg_temp.denied(format('update public.household_tasks set completed_at = now() where id = %L', t), '42501', 'completion time is server-owned');
  perform pg_temp.denied(format('delete from public.household_tasks where id = %L', t), '42501', 'tasks are archived, never deleted');
  update public.household_tasks set assignee_id = c where id = t;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'assigned', 'task_assigned') = 0 and pg_temp.inbox(b, 'unassigned') = 0 and pg_temp.inbox(c, 'assigned', 'task_assigned') = 1,
    'a quick reassignment withdraws the unread notice and tells the new person');
  perform pg_temp.as_user(c);
  update public.notifications set read_at = now() where recipient_id = c;
  perform pg_temp.as_user(a);
  update public.household_tasks set assignee_id = null where id = t;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(c, 'unassigned', 'task_unassigned') = 1, 'once seen, being taken off a task is reported');
  perform pg_temp.as_user(c);
  update public.household_tasks set assignee_id = c, status = 'doing' where id = t;
  update public.household_tasks set status = 'done' where id = t;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select completed_at is not null and completed_by = c from public.household_tasks where id = t), 'completion recorded by the server');
  perform pg_temp.ok(pg_temp.inbox(a, 'responsible', 'task_completed') = 1 and pg_temp.inbox(c, null, 'task_completed') = 0,
    'the person who added it hears it is done; the finisher is not notified');
  perform pg_temp.as_user(c);
  update public.household_tasks set status = 'todo' where id = t;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select completed_at is null from public.household_tasks where id = t)
    and not exists (select 1 from public.household_events where task_id = t and type = 'task_completed'), 'undo completion leaves no trace');
  perform pg_temp.as_user(a);
  update public.household_tasks set title = 'Assemble the TV cabinet (Saturday)', notes = 'Allen key in drawer' where id = t;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select count(*) from public.household_events where task_id = t) = (select count(*) from public.household_events where task_id = t and type <> 'task_edited'),
    'edits create no history or notifications');
  perform pg_temp.as_user(b);
  insert into public.household_tasks (household_id, title, assignee_id) values (h, 'Take cardboard out', c) returning id into t2;
  update public.household_tasks set archived_at = now() where id = t2;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select archived_at is not null from public.household_tasks where id = t2), 'tasks can be archived');

  -- ── Outsiders.
  perform pg_temp.as_user(d);
  perform pg_temp.ok((select count(*) = 0 from public.essentials where household_id = h)
    and (select count(*) = 0 from public.essential_restocks where household_id = h)
    and (select count(*) = 0 from public.household_tasks where household_id = h), 'outsiders see nothing');
  perform pg_temp.denied(format('select public.update_essential(%L, ''restock'')', tp), 'P0002', 'outsiders cannot act on essentials');
  perform pg_temp.ok(pg_temp.touched(format('update public.household_tasks set title = ''hacked'' where id = %L', t)) = 0, 'outsiders cannot edit tasks');
  perform pg_temp.denied(format('insert into public.household_tasks (household_id, title) values (%L, ''x'')', h), '42501', 'outsiders cannot add tasks');
  perform pg_temp.denied(format('insert into public.essentials (household_id, name) values (%L, ''x'')', h), '42501', 'outsiders cannot add essentials');

  -- ── Leaving the flat.
  perform pg_temp.as_user(a);
  perform public.remove_household_member(h, c);
  perform pg_temp.as_admin();
  perform pg_temp.ok((select status = 'needed' and claimed_by is null from public.essentials where id = soap),
    'a removed flatmate''s pick-up reopens for everyone else');
  perform pg_temp.ok((select assignee_id is null from public.household_tasks where id = t), 'a removed flatmate''s tasks become unassigned');
  perform pg_temp.ok((select count(*) = 3 from public.essential_restocks where essential_id = tp), 'restock history is kept');
  perform pg_temp.as_user(c);
  perform pg_temp.ok((select count(*) = 0 from public.essentials where household_id = h) and (select count(*) = 0 from public.household_tasks where household_id = h),
    'a removed flatmate loses access at once');

  -- ── Personal preferences.
  perform pg_temp.as_user(a);
  insert into public.user_preferences (accent, greeting_name, motion, home_layout) values ('mint', '  Ave ', 'playful', '[{"id":"tasks","hidden":false}]');
  perform pg_temp.as_user(b);
  insert into public.user_preferences (accent) values ('coral');
  perform pg_temp.ok((select count(*) = 1 from public.user_preferences), 'you can only read your own preferences');
  perform pg_temp.ok(pg_temp.touched(format('update public.user_preferences set accent = ''sunshine'' where user_id = %L', a)) = 0,
    'you cannot change someone else''s theme');
  perform pg_temp.denied(format('insert into public.user_preferences (user_id, accent) values (%L, ''blue'')', a), '42501', 'you cannot create preferences for someone else');
  perform pg_temp.denied('update public.user_preferences set accent = ''neon''', '23514', 'only the curated accents are allowed');
  perform pg_temp.denied('update public.user_preferences set home_layout = ''{"tasks":1}''', '23514', 'home layout must be a list');
  perform pg_temp.as_admin();
  perform pg_temp.ok((select accent = 'mint' and greeting_name = 'Ave' and motion = 'playful' from public.user_preferences where user_id = a)
    and (select accent = 'coral' and motion = 'balanced' from public.user_preferences where user_id = b),
    'each person keeps their own theme, greeting and motion');
  perform pg_temp.ok((select display_name = 'Avery' from public.profiles where id = a), 'a greeting name never changes the shared display name');

  -- ── Grants and realtime.
  perform pg_temp.ok(not has_table_privilege('anon', 'public.essentials', 'SELECT') and not has_table_privilege('anon', 'public.user_preferences', 'SELECT')
    and not has_table_privilege('authenticated', 'public.essential_restocks', 'INSERT')
    and not has_column_privilege('authenticated', 'public.essentials', 'claimed_by', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.household_tasks', 'completed_by', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.user_preferences', 'user_id', 'UPDATE'), 'API roles have only the access they need');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.update_essential(uuid,text,text,uuid)', 'EXECUTE'), 'signed-out visitors cannot call update_essential');
  perform pg_temp.ok((select count(*) = 4 from pg_publication_tables where pubname = 'supabase_realtime'
    and tablename in ('essentials', 'essential_restocks', 'household_tasks', 'user_preferences')), 'realtime publishes the new tables');
  perform pg_temp.ok((select bool_and(rowsecurity) from pg_tables where schemaname = 'public'
    and tablename in ('essentials', 'essential_restocks', 'household_tasks', 'user_preferences')), 'RLS on every new table');
end
$$;
rollback;
