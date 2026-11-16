-- Phase 8 verification: notification preferences, reminders, essential amounts.
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
create function pg_temp.inbox(u uuid, kind text default null) returns integer language sql as $$
  select count(*)::int from public.notifications n join public.household_events e on e.id = n.event_id
   where n.recipient_id = u and (kind is null or e.type = kind)
$$;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  h uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; e1 uuid; e2 uuid; e3 uuid;
  n_before int; sent int; nz_now timestamptz := '2026-11-16 11:30:00+00'; -- 17 Nov 00:30 in Auckland
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@phase8.invalid', '{}', '{}', now(), now()
    from unnest(array[a, b, c]) u;
  update public.profiles set display_name = v.name from (values (a, 'Avery'), (b, 'Blair'), (c, 'Casey')) v(u, name) where id = v.u;
  perform pg_temp.as_user(a);
  h := public.create_household('Phase 8 flat', '');
  perform pg_temp.as_admin();
  update public.households set settings = jsonb_build_object('timezone', 'Pacific/Auckland') where id = h;
  perform pg_temp.as_user(b); perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (h, b);
  perform pg_temp.as_user(c); perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (h, c);

  -- ── Notification preferences.
  perform pg_temp.as_user(a);
  insert into public.household_tasks (household_id, title, assignee_id) values (h, 'Before muting', b) returning id into t1;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'task_assigned') = 1, 'defaults unchanged: assignments notify');
  perform pg_temp.as_user(b);
  insert into public.user_preferences (muted_notifications) values (array['assignments', 'milestones']);
  perform pg_temp.denied('update public.user_preferences set muted_notifications = array[''membership'']', '23514',
    'membership notices cannot be muted');
  perform pg_temp.denied('update public.user_preferences set muted_notifications = array[''everything'']', '23514', 'only known categories');
  perform pg_temp.as_user(a);
  insert into public.household_tasks (household_id, title, assignee_id) values (h, 'While muted', b) returning id into t2;
  insert into public.household_tasks (household_id, title, assignee_id) values (h, 'For Casey', c) returning id into t3;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'task_assigned') = 1, 'a muted category creates no new notification (server-side)');
  perform pg_temp.ok(exists (select 1 from public.notifications n join public.household_events e on e.id = n.event_id
    where n.recipient_id = b and e.task_id = t1), 'existing notifications are kept when muting');
  perform pg_temp.ok(exists (select 1 from public.household_events where task_id = t2 and type = 'task_added' and in_timeline),
    'shared history continues while muted');
  perform pg_temp.ok(pg_temp.inbox(c, 'task_assigned') = 1, 'one person''s settings never affect another''s');
  perform pg_temp.as_user(c);
  perform pg_temp.ok((select count(*) = 0 from public.user_preferences), 'nobody can read someone else''s notification settings');
  perform pg_temp.as_user(b);
  update public.user_preferences set muted_notifications = '{}';
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'task_assigned') = 1, 'unmuting does not replay old events');
  perform pg_temp.as_user(a);
  update public.household_tasks set assignee_id = b where id = t3;
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(b, 'task_assigned') = 2, 'after unmuting, new events notify again');

  -- Everything muted still gets membership news.
  perform pg_temp.as_user(a);
  insert into public.user_preferences (muted_notifications) values (array['discussions','assignments','shopping','home','reminders','milestones']);
  perform pg_temp.as_user(c);
  perform public.leave_household(h);
  perform pg_temp.as_admin();
  perform pg_temp.ok(pg_temp.inbox(a, 'member_left') = 1, 'membership notices reach the owner even with everything muted');
  perform pg_temp.ok(private.notification_category('member_removed') = 'membership' and private.notification_category('ownership_transferred') = 'membership'
    and private.notification_category('task_reminder') = 'reminders', 'event types map to the right settings');

  -- ── Reminders (time travel via p_now; Auckland calendar).
  perform pg_temp.as_user(a);
  update public.user_preferences set muted_notifications = '{}';
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (h, 'Overdue for Blair', b, date '2026-11-16') returning id into t4;
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (h, 'Due later this month', b, date '2026-11-30') returning id into t5;
  insert into public.household_tasks (household_id, title, due_on) values (h, 'Overdue, nobody assigned', date '2026-11-10') returning id into t6;
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (h, 'Archived', b, date '2026-11-10');
  update public.household_tasks set archived_at = now() where title = 'Archived' and household_id = h;
  insert into public.household_tasks (household_id, title, assignee_id, due_on, status) values (h, 'Done already', b, date '2026-11-10', 'done');
  insert into public.essentials (household_id, name) values (h, 'Toilet paper') returning id into e1;
  insert into public.essentials (household_id, name) values (h, 'Fresh request') returning id into e2;
  insert into public.essentials (household_id, name) values (h, 'Being picked up') returning id into e3;
  perform public.update_essential(e3, 'claim');
  perform pg_temp.as_admin();
  update public.essentials set needed_at = nz_now - interval '4 days' where id in (e1, e3);
  update public.essentials set needed_at = nz_now - interval '1 day' where id = e2;
  delete from public.notifications; -- start the reminder checks from a clean inbox

  sent := private.send_reminders(nz_now);
  perform pg_temp.ok(sent = 2, 'first run: one overdue assigned task and one long-needed essential');
  perform pg_temp.ok(pg_temp.inbox(b, 'task_reminder') = 1, 'the assignee gets the nudge (due 16 Nov is overdue on 17 Nov in Auckland, though still 16 Nov in UTC)');
  perform pg_temp.ok(pg_temp.inbox(a, 'essential_reminder') = 1, 'whoever asked for the essential gets the nudge');
  perform pg_temp.ok((select count(*) = 0 from public.notifications n join public.household_events e on e.id = n.event_id
    where e.task_id in (t5, t6) or e.essential_id in (e2, e3)), 'not due yet, unassigned, recently needed or being picked up: no reminders');
  perform pg_temp.ok(not exists (select 1 from public.household_events where type in ('task_reminder','essential_reminder') and in_timeline),
    'reminders stay out of the shared timeline');
  sent := private.send_reminders(nz_now + interval '1 hour');
  perform pg_temp.ok(sent = 0 and pg_temp.inbox(b, 'task_reminder') = 1, 'a repeated or retried run sends nothing new');
  sent := private.send_reminders(nz_now + interval '3 days');
  perform pg_temp.ok(sent = 2 and pg_temp.inbox(b, 'task_reminder') = 2, 'one last nudge three days after it was due');
  perform pg_temp.ok(pg_temp.inbox(a, 'essential_reminder') = 2, 'the newer essential is nudged once it too has waited three days');
  sent := private.send_reminders(nz_now + interval '6 days');
  perform pg_temp.ok(sent = 0, 'never more than two nudges per due date');

  -- Moving the due date starts a fresh cycle; finishing stops reminders.
  perform pg_temp.as_user(b);
  update public.household_tasks set due_on = date '2026-11-20' where id = t4;
  perform pg_temp.as_admin();
  sent := private.send_reminders(timestamptz '2026-11-21 12:00:00+00');
  perform pg_temp.ok(sent = 1, 'a new due date can be nudged again once it passes');
  perform pg_temp.as_user(b);
  update public.household_tasks set status = 'done' where id = t4;
  perform pg_temp.as_admin();
  sent := private.send_reminders(timestamptz '2026-11-24 12:00:00+00');
  perform pg_temp.ok(sent = 0, 'completed tasks are never nudged');

  -- Muted reminders are recorded as handled, so unmuting later doesn't flood.
  perform pg_temp.as_user(a);
  update public.user_preferences set muted_notifications = array['reminders'];
  perform pg_temp.as_admin();
  update public.essentials set needed_at = nz_now - interval '5 days', status = 'needed' where id = e2;
  n_before := pg_temp.inbox(a, 'essential_reminder');
  sent := private.send_reminders(nz_now);
  perform pg_temp.ok(pg_temp.inbox(a, 'essential_reminder') = n_before
    and not exists (select 1 from public.household_events where type = 'essential_reminder' and essential_id = e2
      and not exists (select 1 from public.notifications n where n.event_id = household_events.id)),
    'muted reminders are not delivered (and leave no orphaned event)');
  perform pg_temp.as_user(a);
  update public.user_preferences set muted_notifications = '{}';
  perform pg_temp.as_admin();
  sent := private.send_reminders(nz_now + interval '2 hours');
  perform pg_temp.ok(sent = 0, 'unmuting does not send a backlog');

  -- A restocked essential is never nudged; needing it again later is a new cycle.
  perform pg_temp.as_user(a);
  perform public.update_essential(e1, 'restock');
  perform public.update_essential(e1, 'need');
  perform pg_temp.as_admin();
  sent := private.send_reminders(now() + interval '1 hour');
  perform pg_temp.ok(not exists (select 1 from private.reminders_sent where target_id = e1 and cycle = (select needed_at::text from public.essentials where id = e1)),
    'a fresh request is not nudged straight away');

  -- ── Essentials: optional amount.
  perform pg_temp.as_user(a);
  insert into public.essentials (household_id, name, quantity) values (h, 'Washing powder', '  2 kg box ');
  perform pg_temp.ok((select quantity = '2 kg box' from public.essentials where household_id = h and name = 'Washing powder'), 'amount is optional, tidied');
  perform pg_temp.denied(format('update public.essentials set quantity = %L where id = %L', repeat('x', 41), e1), '23514', 'amount stays short');

  -- ── Grants.
  perform pg_temp.as_admin();
  perform pg_temp.ok(not has_function_privilege('authenticated', 'private.send_reminders(timestamptz)', 'EXECUTE')
    and not has_table_privilege('authenticated', 'private.reminders_sent', 'SELECT'), 'reminders can only be run by the scheduler');
  perform pg_temp.ok(has_column_privilege('authenticated', 'public.user_preferences', 'muted_notifications', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.user_preferences', 'user_id', 'UPDATE'), 'people manage only their own settings');
end
$$;
rollback;
