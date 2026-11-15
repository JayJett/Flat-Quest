-- Phase 6 (connected living) verification. Disposable local database only: every fixture
-- is created inside this transaction and rolled back at the end.
begin;
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- Runs a statement as the current role and expects it to fail with a given SQLSTATE.
create function pg_temp.denied(stmt text, code text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (statement succeeded)', label;
exception when others then
  if sqlstate = code then raise notice 'PASS: %', label;
  else raise exception 'FAIL: % (got % %)', label, sqlstate, sqlerrm; end if;
end $$;
-- Rows a statement touched, as the current role.
create function pg_temp.touched(stmt text) returns integer language plpgsql as $$
declare n integer;
begin execute stmt; get diagnostics n = row_count; return n; end $$;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('role', 'none', true);
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$ select set_config('role', 'none', true) $$;
-- Admin-side truth: one recipient's notifications by reason.
create function pg_temp.inbox(u uuid, why text default null) returns integer language sql as $$
  select count(*)::int from public.notifications where recipient_id = u and (why is null or reason = why)
$$;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  h uuid; other_h uuid; r uuid; r2 uuid; item1 uuid; item2 uuid; other_item uuid; opt uuid; idea uuid;
  cm uuid; reply uuid; reply2 uuid; n bigint; ev_before int; summary jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@phase6.invalid',
         jsonb_build_object('display_name', name), '{}', now(), now()
    from (values (a, 'Avery'), (b, 'Blair'), (c, 'Casey'), (d, 'Drew')) v(u, name);
  update public.profiles set display_name = v.name
    from (values (a, 'Avery'), (b, 'Blair'), (c, 'Casey'), (d, 'Drew')) v(u, name) where id = v.u;

  -- ── Setup: Avery founds a flat; Blair and Casey join; Drew has a separate flat.
  perform pg_temp.as_user(a);
  h := public.create_household('Phase 6 flat', '');
  perform pg_temp.ok((select count(*) = 1 from public.household_events where household_id = h and type = 'history_started'),
    'history begins when a flat is created (no back-filled events)');
  -- Joining is the invite RPC's job; here the row is added as admin with the joiner's identity.
  perform pg_temp.as_user(b); perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (h, b);
  perform pg_temp.as_user(c); perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (h, c);
  perform pg_temp.ok(pg_temp.inbox(a, 'member') = 2 and pg_temp.inbox(b, 'member') = 1 and pg_temp.inbox(c, 'member') = 0,
    'joins notify existing flatmates, never the person joining');
  perform pg_temp.as_user(d);
  other_h := public.create_household('Elsewhere', '');
  insert into public.rooms (household_id, name) values (other_h, 'Other room') returning id into r2;
  insert into public.items (household_id, room_id, name) values (other_h, r2, 'Other lamp') returning id into other_item;

  perform pg_temp.as_user(a);
  insert into public.rooms (household_id, name) values (h, 'Kitchen') returning id into r;
  insert into public.items (household_id, room_id, name) values (h, r, 'Kettle') returning id into item1;
  insert into public.items (household_id, room_id, name) values (h, r, 'Toaster') returning id into item2;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select count(*) = 1 and max((data->>'count')::int) = 2 from public.household_events
    where household_id = h and type = 'item_added'), 'items added together are one coalesced timeline entry');

  -- ── Assignment notifications.
  perform pg_temp.as_user(a);
  perform public.set_item_assignees(item1, array[a, b]);
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'assigned') = 1 and pg_temp.inbox(a, 'assigned') = 0, 'assignee told; self-assignment silent');
  perform pg_temp.as_user(a);
  perform public.set_item_assignees(item1, array[a]);
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'assigned') = 0 and pg_temp.inbox(b, 'unassigned') = 0,
    'assign then unassign within minutes cancels out (no noise)');
  perform pg_temp.as_user(a);
  perform public.set_item_assignees(item1, array[a, b]);
  perform pg_temp.as_user(b);
  perform pg_temp.ok(pg_temp.touched(format('update public.notifications set read_at = now() where recipient_id = %L and reason = ''assigned''', b)) = 1,
    'recipient marks own notification read');
  perform pg_temp.as_user(a);
  perform public.set_item_assignees(item1, array[a]);
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'unassigned') = 1, 'once the assignment was seen, an unassign is reported');
  perform pg_temp.as_user(a);
  perform public.set_item_assignees(item1, array[a, b]);
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'unassigned') = 0 and pg_temp.inbox(b, 'assigned') = 1,
    'a quick re-assign withdraws the unread unassign instead of adding more');

  -- ── Notification privacy and read state.
  perform pg_temp.as_user(c);
  perform pg_temp.ok((select count(*) = 0 from public.notifications where recipient_id <> c), 'cannot read anyone else''s notifications');
  perform pg_temp.ok(pg_temp.touched(format('update public.notifications set read_at = now() where recipient_id = %L', b)) = 0,
    'cannot mark someone else''s notifications read');
  perform pg_temp.ok(public.mark_all_notifications_read(h) = 0, 'mark all read never touches other people''s notifications');
  perform pg_temp.denied(format('insert into public.notifications (event_id, household_id, recipient_id, reason, category)
     select id, %L, %L, ''mention'', ''personal'' from public.household_events limit 1', h, b), '42501', 'notifications cannot be forged');
  perform pg_temp.denied(format('insert into public.household_events (household_id, type, actor_id, in_timeline)
     values (%L, ''room_completed'', %L, true)', h, b), '42501', 'history cannot be forged');
  perform pg_temp.denied('update public.notifications set recipient_id = recipient_id', '42501', 'recipient cannot be changed');
  perform pg_temp.as_user(b);
  update public.notifications set read_at = '2000-01-01' where recipient_id = b and read_at is null;
  perform pg_temp.ok((select bool_and(read_at > now() - interval '1 minute') from public.notifications where recipient_id = b and read_at > '2001-01-01'),
    'read time is the server''s, not back-dated');
  perform pg_temp.as_user(a);
  perform pg_temp.ok(public.mark_all_notifications_read(h) >= 1, 'mark all read reports what it cleared');
  perform pg_temp.ok((select count(*) = 0 from public.notifications where read_at is null), 'mark all read clears your own unread');
  perform pg_temp.as_user(b);
  update public.notifications set read_at = null where recipient_id = b;
  perform pg_temp.ok((select count(*) = 0 from public.notifications where recipient_id = b and read_at is null), 'read state only moves forward');
  perform pg_temp.ok((select count(*) = 0 from public.household_events where not in_timeline
    and not exists (select 1 from public.notifications n where n.event_id = household_events.id and n.recipient_id = b)),
    'personal-only events are visible only to their recipients');

  -- ── Discussions.
  perform pg_temp.as_user(b);
  insert into public.comments (household_id, item_id, body, mentions) values (h, item1, '  Which kettle?  ', array[c, d, b])
    returning id into cm;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select body = 'Which kettle?' and mentions = array[c] and author_id = b and author_name = 'Blair'
    from public.comments where id = cm), 'comment trimmed; mentions limited to flatmates, never yourself; author set by server');
  perform pg_temp.ok(pg_temp.inbox(c, 'mention') = 1 and pg_temp.inbox(a, 'discussion') = 1
    and not exists (select 1 from public.notifications n join public.household_events e on e.id = n.event_id where e.comment_id = cm and n.recipient_id = b)
    and pg_temp.inbox(d) = 0, 'mention and responsible-person notifications; author and outsiders not told');
  perform pg_temp.as_user(c);
  insert into public.comments (household_id, item_id, parent_id, body) values (h, item1, cm, 'The steel one') returning id into reply;
  insert into public.comments (household_id, item_id, parent_id, body, mentions) values (h, item1, reply, 'Agreed', array[b]) returning id into reply2;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select parent_id = cm from public.comments where id = reply2), 'reply to a reply stays one level deep');
  perform pg_temp.ok(pg_temp.inbox(b, 'reply') = 1 and pg_temp.inbox(b, 'mention') = 1,
    'reply notifies the parent author; a mention outranks reply (one per person per comment)');
  perform pg_temp.ok(pg_temp.inbox(a, 'discussion') = 1, 'unread thread activity is coalesced for responsible people');
  perform pg_temp.ok((select count(*) = 1 from public.notifications n join public.household_events e on e.id = n.event_id
    where e.comment_id = reply2 and n.recipient_id = b), 'exactly one notification per person per comment');
  perform pg_temp.as_user(b);
  perform pg_temp.denied(format('insert into public.comments (household_id, item_id, body, author_id) values (%L, %L, ''x'', %L)', h, item1, c),
    '42501', 'cannot post as someone else');
  perform pg_temp.denied(format('insert into public.comments (household_id, item_id, body) values (%L, %L, ''x'')', h, other_item),
    '42501', 'cannot attach a comment to another flat''s item');
  perform pg_temp.denied(format('insert into public.comments (household_id, item_id, body) values (%L, %L, ''   '')', h, item1),
    '23514', 'empty comments rejected');
  perform pg_temp.ok(pg_temp.touched(format('update public.comments set body = ''edited'' where id = %L', reply)) = 0,
    'cannot edit someone else''s comment');
  perform pg_temp.denied(format('delete from public.comments where id = %L', cm), '42501', 'no hard deletes');
  update public.comments set body = 'Which kettle, @Avery?', mentions = array[c, a] where id = cm;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select edited_at is not null from public.comments where id = cm) and pg_temp.inbox(a, 'mention') = 1
    and pg_temp.inbox(c, 'mention') = 1, 'editing notifies only newly mentioned people');
  perform pg_temp.as_user(b);
  update public.comments set deleted_at = now() where id = cm;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select body = '' and deleted_at is not null from public.comments where id = cm)
    and not exists (select 1 from public.household_events where comment_id = cm), 'soft delete clears the words and its history');
  perform pg_temp.ok((select count(*) = 2 from public.comments where parent_id = cm), 'replies survive their parent being deleted');
  perform pg_temp.as_user(d);
  perform pg_temp.ok((select count(*) = 0 from public.comments where household_id = h), 'outsider cannot read the discussion');
  perform pg_temp.ok((select count(*) = 0 from public.household_events where household_id = h), 'outsider cannot read the timeline');
  perform pg_temp.denied(format('insert into public.comments (household_id, item_id, body) values (%L, %L, ''hi'')', h, item1),
    '42501', 'outsider cannot comment');

  -- ── Completion, room milestone, quick undo, no-ops and failed writes.
  perform pg_temp.as_admin();
  select count(*) into ev_before from public.household_events where household_id = h;
  perform pg_temp.as_user(b);
  update public.items set name = name, notes = 'no change to history' where id = item1;
  update public.items set is_complete = false where id = item1;
  begin
    update public.items set is_complete = true where id = item1;
    raise exception 'roll this back' using errcode = 'P0001';
  exception when raise_exception then null; end;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select count(*) from public.household_events where household_id = h) = ev_before,
    'edits, no-op updates and failed writes create no history');
  perform pg_temp.as_user(b);
  update public.items set is_complete = true where id = item1;
  update public.items set is_complete = false where id = item1;
  perform pg_temp.as_admin();
  perform pg_temp.ok(not exists (select 1 from public.household_events where item_id = item1 and type = 'item_completed'),
    'an accidental tick undone straight away leaves no trace');
  perform pg_temp.as_user(c);
  update public.items set is_complete = true where id = item1;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(a, 'responsible') >= 1 and pg_temp.inbox(b, 'responsible') >= 1 and pg_temp.inbox(c, 'responsible') = 0,
    'people responsible hear when someone else finishes their item');
  perform pg_temp.ok(not exists (select 1 from public.household_events where type = 'room_completed' and room_id = r), 'no milestone while items remain');
  perform pg_temp.as_user(c);
  update public.items set is_complete = true where id = item2;
  update public.items set is_complete = false where id = item2;
  update public.items set is_complete = true where id = item2;
  perform pg_temp.as_admin();
  perform pg_temp.ok((select count(*) = 1 from public.household_events where type = 'room_completed' and room_id = r),
    'room reaching 100% is one milestone (not repeated on re-ticks)');
  perform pg_temp.ok(pg_temp.inbox(a, 'milestone') = 1 and pg_temp.inbox(b, 'milestone') = 1 and pg_temp.inbox(c, 'milestone') = 0,
    'milestone goes to the household, not the person who finished it');

  -- ── Purchasing: options, coordination, stages.
  perform pg_temp.as_user(c);
  insert into public.product_options (household_id, item_id, name, is_selected) values (h, item2, 'Two-slice', true) returning id into opt;
  insert into public.purchase_coordinators (item_id, household_id) values (item2, h);
  update public.purchase_coordinators set user_id = b where item_id = item2;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'handover') = 1, 'handing over coordination tells the new person');
  perform pg_temp.as_user(a);
  update public.purchase_coordinators set user_id = a where item_id = item2;
  update public.items set status = 'ordered' where id = item2;
  update public.items set status = 'on_the_way' where id = item2;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'takeover') = 1, 'taking over tells the previous coordinator');
  perform pg_temp.ok(not exists (select 1 from public.notifications n join public.household_events e on e.id = n.event_id
    where e.item_id = item2 and e.type = 'purchase_stage' and n.recipient_id = a), 'no notification about your own stage change');
  perform pg_temp.as_user(c);
  insert into public.wishlist_items (household_id, title) values (h, 'Plant') returning id into idea;
  perform pg_temp.as_admin();
  perform pg_temp.ok(exists (select 1 from public.household_events where idea_id = idea and type = 'idea_added' and in_timeline),
    'new wishlist ideas appear in the timeline');

  -- ── Household management.
  perform pg_temp.as_user(b);
  perform pg_temp.denied(format('select public.remove_household_member(%L, %L)', h, c), '42501', 'members cannot remove people');
  perform pg_temp.denied(format('select public.transfer_household_ownership(%L, %L)', h, b), '42501', 'members cannot take ownership');
  perform pg_temp.denied(format('select public.set_member_limit(%L, 8)', h), '42501', 'members cannot change capacity');
  perform pg_temp.denied(format('update public.households set member_limit = 9 where id = %L', h), '42501',
    'capacity is not client-editable');
  perform pg_temp.denied(format('delete from public.household_members where household_id = %L and user_id = %L', h, b), '42501',
    'raw membership deletes are refused');
  perform pg_temp.as_user(a);
  perform pg_temp.denied(format('select public.leave_household(%L)', h), '42501', 'the owner cannot leave without handing over');
  perform pg_temp.denied(format('select public.remove_household_member(%L, %L)', h, a), '42501', 'the owner cannot remove themselves');
  perform pg_temp.denied(format('select public.set_member_limit(%L, 2)', h), '22023', 'capacity cannot drop below current members');
  perform public.set_member_limit(h, 5);
  perform pg_temp.as_admin();
  perform pg_temp.ok((select member_limit = 5 from public.households where id = h), 'owner changes capacity explicitly');
  perform pg_temp.as_user(a);
  perform public.transfer_household_ownership(h, b);
  perform pg_temp.as_admin();
  perform pg_temp.ok((select string_agg(role, ',' order by role) = 'member,member,owner' from public.household_members where household_id = h)
    and (select role = 'owner' from public.household_members where household_id = h and user_id = b), 'ownership moves atomically');
  perform pg_temp.ok(pg_temp.inbox(b, 'ownership') = 1, 'new owner is told');
  perform pg_temp.denied(format('update public.household_members set role = ''owner'' where household_id = %L and user_id = %L', h, a),
    '23505', 'a flat can never have two owners');
  perform pg_temp.as_user(a);
  perform pg_temp.denied(format('select public.set_member_limit(%L, 6)', h), '42501', 'former owner loses owner powers');

  -- Casey is removed by the new owner.
  perform pg_temp.as_user(c);
  insert into public.comments (household_id, item_id, body) values (h, item2, 'Got it from the shop') returning id into reply;
  perform public.set_item_assignees(item2, array[c]);
  perform pg_temp.as_user(b);
  summary := public.member_departure_summary(h, c);
  perform pg_temp.ok((summary->>'sole')::int = 0 and (summary->>'assigned')::int = 0, 'departure summary counts outstanding items only');
  summary := public.remove_household_member(h, c);
  perform pg_temp.as_admin();
  perform pg_temp.ok(not exists (select 1 from public.household_members where household_id = h and user_id = c)
    and pg_temp.inbox(c) = 0 and not exists (select 1 from public.item_assignees where user_id = c),
    'removed member loses membership, notifications and assignments');
  perform pg_temp.ok((select author_name = 'Casey' from public.comments where id = reply)
    and exists (select 1 from public.household_events where actor_id = c and actor_name = 'Casey'),
    'history keeps their name');
  perform pg_temp.ok(exists (select 1 from public.household_events where type = 'member_removed' and subject_id = c and actor_id = b),
    'removal recorded on the timeline');
  perform pg_temp.as_user(c);
  perform pg_temp.ok((select count(*) = 0 from public.comments where household_id = h)
    and (select count(*) = 0 from public.items where household_id = h)
    and (select count(*) = 0 from public.household_events where household_id = h), 'removed member loses access immediately');
  perform pg_temp.denied(format('insert into public.comments (household_id, item_id, body) values (%L, %L, ''still here?'')', h, item2),
    '42501', 'removed member cannot keep writing');

  -- Avery leaves.
  perform pg_temp.as_user(a);
  perform public.leave_household(h);
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'member') >= 2 and exists (select 1 from public.household_events where type = 'member_left' and subject_id = a),
    'leaving tells the owner and is recorded');
  perform pg_temp.as_user(b);
  perform pg_temp.denied(format('select public.leave_household(%L)', h), '42501', 'last owner cannot leave the flat ownerless');

  -- ── Grants.
  perform pg_temp.as_admin();
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.household_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
    and not has_table_privilege('authenticated', 'public.notifications', 'DELETE')
    and not has_table_privilege('authenticated', 'public.comments', 'DELETE')
    and not has_table_privilege('anon', 'public.comments', 'SELECT')
    and not has_table_privilege('authenticated', 'public.household_members', 'DELETE'), 'API roles have only the access they need');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'private.record_event(uuid,text,uuid,boolean,jsonb,uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.remove_household_member(uuid,uuid)', 'EXECUTE'), 'internal functions are not callable');
  perform pg_temp.ok((select count(*) = 3 from pg_publication_tables where pubname = 'supabase_realtime'
    and tablename in ('household_events', 'notifications', 'comments')), 'realtime publishes the new tables');
  perform pg_temp.ok((select bool_and(rowsecurity) from pg_tables where schemaname = 'public'
    and tablename in ('household_events', 'notifications', 'comments')), 'RLS enabled on every new table');
end
$$;
rollback;
