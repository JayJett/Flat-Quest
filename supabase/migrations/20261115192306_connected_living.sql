-- Phase 6 — Connected living: durable household history, personal notifications,
-- discussions and household management.
--
-- Additive and backward compatible. Existing tables keep their columns and data. The
-- only behaviour removed is the client-side "delete my own membership row" policy, which
-- is replaced by leave_household() so an owner can never walk out and orphan the flat.
-- Recovery: supabase/rollback/pre_phase6_snapshot.sql (run first) and
-- supabase/rollback/20261115192306_connected_living_down.sql, which drops everything
-- created here and restores the previous membership policy.

-- ───────────────────────── 1. Household events (one source of truth) ─────────────────────────
-- Every meaningful change is recorded once. The activity timeline reads the rows flagged
-- in_timeline; personal notifications point at an event. Rows are only ever written by the
-- SECURITY DEFINER triggers below, in the same transaction as the change they describe,
-- so a failed or rolled-back write never produces history and clients cannot forge one.
create table public.household_events (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in (
    'history_started','item_added','item_completed','purchase_stage','item_assigned','item_unassigned',
    'option_added','option_selected','coordination_claimed','coordination_handover','coordination_takeover',
    'room_completed','transformation_added','photos_added','idea_added','comment_added','comment_mention',
    'member_joined','member_left','member_removed','ownership_transferred','member_limit_changed')),
  -- Nullable for system rows; removed accounts keep their name via actor_name.
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  -- Plain references (no FKs): history must survive the deletion of what it describes.
  room_id uuid, item_id uuid, option_id uuid, idea_id uuid, comment_id uuid, transformation_id uuid,
  subject_id uuid,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 2048),
  in_timeline boolean not null default false,
  created_at timestamptz not null default now()
);
create index household_events_timeline_idx on public.household_events (household_id, id desc) where in_timeline;
create index household_events_comment_idx on public.household_events (comment_id) where comment_id is not null;
create index household_events_coalesce_idx on public.household_events (household_id, type, actor_id, room_id, created_at desc);
create index household_events_item_idx on public.household_events (item_id, type) where item_id is not null;
create index household_events_actor_idx on public.household_events (actor_id);

alter table public.household_events enable row level security;
revoke all on public.household_events from anon, authenticated;
grant select on public.household_events to authenticated;

-- ───────────────────────── 2. Personal notifications ─────────────────────────
create table public.notifications (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.household_events(id) on delete cascade,
  household_id uuid not null,
  recipient_id uuid not null,
  -- Why this person was told: drives the wording and the personal/household split.
  reason text not null check (reason in ('mention','reply','discussion','assigned','unassigned','responsible',
    'handover','takeover','milestone','member','ownership')),
  category text not null check (category in ('personal','household')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, recipient_id),
  -- Leaving or being removed from a flat takes that flat's notifications with you.
  foreign key (household_id, recipient_id) references public.household_members(household_id, user_id) on delete cascade
);
create index notifications_inbox_idx on public.notifications (recipient_id, household_id, id desc);
create index notifications_unread_idx on public.notifications (recipient_id, household_id) where read_at is null;
create index notifications_household_idx on public.notifications (household_id, recipient_id);

alter table public.notifications enable row level security;
create policy "notifications: read your own" on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()) and private.is_household_member(household_id));
create policy "notifications: mark your own read" on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()) and private.is_household_member(household_id))
  with check (recipient_id = (select auth.uid()));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Members see the shared timeline; personal-only events are visible only to the people
-- they were sent to.
create policy "events: members read timeline and their own" on public.household_events
  for select to authenticated using (
    private.is_household_member(household_id)
    and (in_timeline or exists (select 1 from public.notifications n
                                where n.event_id = household_events.id and n.recipient_id = (select auth.uid()))));
-- Read state is a server timestamp and only moves forward (no un-reading, no back-dating).
create function private.notifications_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.read_at is not null then
    new.read_at := old.read_at;
  elsif new.read_at is not null then
    new.read_at := now();
  end if;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications
  for each row execute function private.notifications_guard();

create function public.mark_all_notifications_read(p_household uuid) returns integer
language sql set search_path = '' as $$
  with done as (
    update public.notifications set read_at = now()
     where household_id = p_household and recipient_id = (select auth.uid()) and read_at is null
    returning 1)
  select count(*)::int from done;
$$;
revoke all on function public.mark_all_notifications_read(uuid) from public, anon;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- ───────────────────────── 3. Discussions ─────────────────────────
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  option_id uuid references public.product_options(id) on delete cascade,
  idea_id uuid references public.wishlist_items(id) on delete cascade,
  -- One level of replies: a reply to a reply is attached to the same root.
  parent_id uuid references public.comments(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  author_name text,
  body text not null default '',
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (num_nonnulls(item_id, option_id, idea_id) = 1),
  check (deleted_at is not null or char_length(body) between 1 and 2000),
  check (cardinality(mentions) <= 10)
);
create index comments_item_idx on public.comments (item_id, created_at) where item_id is not null;
create index comments_option_idx on public.comments (option_id, created_at) where option_id is not null;
create index comments_idea_idx on public.comments (idea_id, created_at) where idea_id is not null;
create index comments_parent_idx on public.comments (parent_id) where parent_id is not null;
create index comments_household_idx on public.comments (household_id);
create index comments_author_idx on public.comments (author_id);

alter table public.comments enable row level security;
create policy "comments: members read" on public.comments
  for select to authenticated using (private.is_household_member(household_id));
create policy "comments: members write as themselves" on public.comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and private.is_household_member(household_id));
create policy "comments: authors edit their own" on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()) and private.is_household_member(household_id))
  with check (author_id = (select auth.uid()));
revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;
grant insert (household_id, item_id, option_id, idea_id, parent_id, body, mentions) on public.comments to authenticated;
-- Deleting is a soft delete (deleted_at) so replies keep their place; there is no DELETE grant.
grant update (body, mentions, deleted_at) on public.comments to authenticated;

create function private.display_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(trim(p.display_name), ''), 'A flatmate') from public.profiles p where p.id = p_user;
$$;

create function private.comments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_target_household uuid;
  v_parent public.comments%rowtype;
begin
  if tg_op = 'INSERT' then
    new.author_id := v_uid;
    new.author_name := private.display_name(v_uid);
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    if new.item_id is not null then
      select household_id into v_target_household from public.items where id = new.item_id;
    elsif new.option_id is not null then
      select household_id into v_target_household from public.product_options where id = new.option_id;
    else
      select household_id into v_target_household from public.wishlist_items where id = new.idea_id;
    end if;
    if v_target_household is distinct from new.household_id then
      raise exception 'That discussion belongs to another flat' using errcode = '42501';
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.comments where id = new.parent_id;
      if not found or v_parent.household_id <> new.household_id
         or v_parent.item_id is distinct from new.item_id
         or v_parent.option_id is distinct from new.option_id
         or v_parent.idea_id is distinct from new.idea_id then
        raise exception 'You can only reply within the same discussion' using errcode = '23514';
      end if;
      new.parent_id := coalesce(v_parent.parent_id, v_parent.id);
    end if;
  else
    if old.deleted_at is not null then
      raise exception 'This comment was deleted' using errcode = '42501';
    end if;
    -- Only the words (and who they mention) can change.
    new.id := old.id; new.household_id := old.household_id; new.item_id := old.item_id;
    new.option_id := old.option_id; new.idea_id := old.idea_id; new.parent_id := old.parent_id;
    new.author_id := old.author_id; new.author_name := old.author_name; new.created_at := old.created_at;
    if new.deleted_at is not null then
      new.deleted_at := now(); new.body := ''; new.mentions := '{}'; new.edited_at := old.edited_at;
      return new;
    end if;
    if new.body is not distinct from old.body and new.mentions is not distinct from old.mentions then
      new.edited_at := old.edited_at;
      return new;
    end if;
    new.edited_at := now();
  end if;
  new.body := trim(new.body);
  -- Mentions are limited to current flatmates, de-duplicated, and never yourself.
  new.mentions := coalesce((
    select array_agg(distinct m) from unnest(new.mentions) m
    where m <> v_uid and private.user_in_household_unchecked(m, new.household_id)), '{}');
  return new;
end $$;
create trigger comments_guard before insert or update on public.comments
  for each row execute function private.comments_guard();

-- ───────────────────────── 4. Event helpers ─────────────────────────
create function private.record_event(
  p_household uuid, p_type text, p_actor uuid, p_timeline boolean, p_data jsonb default '{}'::jsonb,
  p_room uuid default null, p_item uuid default null, p_option uuid default null, p_idea uuid default null,
  p_comment uuid default null, p_transformation uuid default null, p_subject uuid default null)
returns bigint
language sql security definer set search_path = '' as $$
  insert into public.household_events (household_id, type, actor_id, actor_name, in_timeline, data,
    room_id, item_id, option_id, idea_id, comment_id, transformation_id, subject_id)
  values (p_household, p_type, p_actor, case when p_actor is null then null else private.display_name(p_actor) end,
    p_timeline, jsonb_strip_nulls(coalesce(p_data, '{}'::jsonb)),
    p_room, p_item, p_option, p_idea, p_comment, p_transformation, p_subject)
  returning id;
$$;

-- Fans an event out to people. Never the actor, only current members of that flat, at
-- most once per person per event.
create function private.notify(p_event bigint, p_recipients uuid[], p_reason text, p_category text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.household_events%rowtype;
  v_count integer;
begin
  select * into v_event from public.household_events where id = p_event;
  insert into public.notifications (event_id, household_id, recipient_id, reason, category)
  select p_event, v_event.household_id, r, p_reason, p_category
    from (select distinct unnest(p_recipients) as r) s
   where r is not null and r is distinct from v_event.actor_id
     and private.user_in_household_unchecked(r, v_event.household_id)
  on conflict (event_id, recipient_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Personal-only events that reach nobody are not kept.
create function private.drop_if_unused(p_event bigint) returns void
language sql security definer set search_path = '' as $$
  delete from public.household_events e
   where e.id = p_event and not e.in_timeline
     and not exists (select 1 from public.notifications n where n.event_id = e.id);
$$;

create function private.item_responsible(p_item uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u), '{}') from (
    select user_id as u from public.item_assignees where item_id = p_item
    union select user_id from public.purchase_coordinators where item_id = p_item) s;
$$;

create function private.item_context(p_item uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('item', i.name, 'room', r.name, 'room_id', r.id)
    from public.items i join public.rooms r on r.id = i.room_id where i.id = p_item;
$$;

-- ───────────────────────── 5. Event triggers ─────────────────────────
-- Items: additions (coalesced), completion, purchase stages, room milestones.
create function private.items_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_ctx jsonb;
  v_recent bigint;
  v_room_name text;
begin
  if v_uid is null then return null; end if;
  if tg_op = 'INSERT' then
    if new.import_key is not null then return null; end if;
    select name into v_room_name from public.rooms where id = new.room_id;
    -- "Alex added 3 items to Kitchen" rather than three separate rows.
    select id into v_recent from public.household_events
     where household_id = new.household_id and type = 'item_added' and actor_id = v_uid
       and room_id = new.room_id and created_at > now() - interval '30 minutes'
     order by id desc limit 1 for update;
    if v_recent is not null then
      update public.household_events
         set data = data || jsonb_build_object('count', coalesce((data->>'count')::int, 1) + 1), created_at = now()
       where id = v_recent;
    else
      perform private.record_event(new.household_id, 'item_added', v_uid, true,
        jsonb_build_object('item', new.name, 'room', v_room_name, 'count', 1), p_room => new.room_id, p_item => new.id);
    end if;
    return null;
  end if;

  v_ctx := private.item_context(new.id);

  if new.is_complete and not old.is_complete then
    v_event := private.record_event(new.household_id, 'item_completed', v_uid, true, v_ctx,
      p_room => new.room_id, p_item => new.id);
    perform private.notify(v_event, private.item_responsible(new.id), 'responsible', 'personal');
    -- Milestone: every counted item in the room is now in the flat.
    perform pg_advisory_xact_lock(hashtextextended(new.room_id::text, 6));
    if not exists (select 1 from public.items i where i.room_id = new.room_id and i.status <> 'not_needed' and not i.is_complete)
       and exists (select 1 from public.items i where i.room_id = new.room_id and i.status <> 'not_needed')
       and not exists (select 1 from public.household_events e where e.household_id = new.household_id
            and e.type = 'room_completed' and e.room_id = new.room_id and e.created_at > now() - interval '12 hours') then
      v_event := private.record_event(new.household_id, 'room_completed', v_uid, true,
        jsonb_build_object('room', v_ctx->>'room'), p_room => new.room_id);
      perform private.notify(v_event, (select array_agg(user_id) from public.household_members
        where household_id = new.household_id), 'milestone', 'household');
    end if;
  elsif old.is_complete and not new.is_complete then
    -- An accidental tick that is undone quickly leaves no trace.
    delete from public.household_events
     where item_id = new.id and type = 'item_completed' and actor_id = v_uid and created_at > now() - interval '10 minutes';
  end if;

  if new.status is distinct from old.status and new.status in ('ordered','on_the_way','ready_to_collect','delivered') then
    -- Keep only the latest unread stage update per person and item.
    delete from public.notifications n using public.household_events e
     where n.event_id = e.id and e.item_id = new.id and e.type = 'purchase_stage' and n.read_at is null;
    delete from public.household_events e where e.item_id = new.id and e.type = 'purchase_stage' and not e.in_timeline
      and not exists (select 1 from public.notifications n where n.event_id = e.id);
    v_event := private.record_event(new.household_id, 'purchase_stage', v_uid, new.status in ('ordered','delivered'),
      v_ctx || jsonb_build_object('stage', new.status), p_room => new.room_id, p_item => new.id);
    perform private.notify(v_event, private.item_responsible(new.id), 'responsible', 'personal');
    perform private.drop_if_unused(v_event);
  end if;
  return null;
end $$;
create trigger items_events after insert or update of is_complete, status on public.items
  for each row execute function private.items_events();

-- Assignments: personal, and a quick assign/unassign pair cancels out.
create function private.assignees_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.item_assignees%rowtype := case when tg_op = 'INSERT' then new else old end;
  v_opposite text := case when tg_op = 'INSERT' then 'item_unassigned' else 'item_assigned' end;
  v_cancelled integer;
  v_event bigint;
begin
  if v_uid is null or v_row.user_id = v_uid then return null; end if;
  if not private.user_in_household_unchecked(v_row.user_id, v_row.household_id) then return null; end if;
  delete from public.household_events e
   where e.item_id = v_row.item_id and e.type = v_opposite and e.subject_id = v_row.user_id
     and e.created_at > now() - interval '10 minutes'
     and exists (select 1 from public.notifications n where n.event_id = e.id and n.read_at is null);
  get diagnostics v_cancelled = row_count;
  if v_cancelled > 0 then return null; end if;
  if not exists (select 1 from public.items where id = v_row.item_id) then return null; end if;
  v_event := private.record_event(v_row.household_id,
    case when tg_op = 'INSERT' then 'item_assigned' else 'item_unassigned' end, v_uid, false,
    private.item_context(v_row.item_id), p_item => v_row.item_id, p_subject => v_row.user_id,
    p_room => (select room_id from public.items where id = v_row.item_id));
  perform private.notify(v_event, array[v_row.user_id],
    case when tg_op = 'INSERT' then 'assigned' else 'unassigned' end, 'personal');
  perform private.drop_if_unused(v_event);
  return null;
end $$;
create trigger item_assignees_events after insert or delete on public.item_assignees
  for each row execute function private.assignees_events();

-- Product options: new options on the timeline; a changed pick tells the people responsible.
create function private.options_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_ctx jsonb;
begin
  if v_uid is null then return null; end if;
  v_ctx := private.item_context(new.item_id) || jsonb_build_object('option', new.name);
  if tg_op = 'INSERT' then
    perform private.record_event(new.household_id, 'option_added', v_uid, true, v_ctx,
      p_room => (v_ctx->>'room_id')::uuid, p_item => new.item_id, p_option => new.id);
  end if;
  if new.is_selected and (tg_op = 'INSERT' or not old.is_selected) then
    v_event := private.record_event(new.household_id, 'option_selected', v_uid, true, v_ctx,
      p_room => (v_ctx->>'room_id')::uuid, p_item => new.item_id, p_option => new.id);
    perform private.notify(v_event, private.item_responsible(new.item_id), 'responsible', 'personal');
  end if;
  return null;
end $$;
create trigger product_options_events after insert or update of is_selected on public.product_options
  for each row execute function private.options_events();

-- Purchase coordination: claim, hand over, take over.
create function private.coordinators_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_ctx jsonb;
begin
  if v_uid is null then return null; end if;
  v_ctx := private.item_context(new.item_id);
  if tg_op = 'INSERT' then
    v_event := private.record_event(new.household_id, 'coordination_claimed', v_uid, false, v_ctx,
      p_room => (v_ctx->>'room_id')::uuid, p_item => new.item_id, p_subject => new.user_id);
    perform private.notify(v_event, (select array_agg(user_id) from public.item_assignees where item_id = new.item_id),
      'responsible', 'personal');
    perform private.drop_if_unused(v_event);
  elsif new.user_id <> old.user_id then
    if v_uid = old.user_id then
      v_event := private.record_event(new.household_id, 'coordination_handover', v_uid, false, v_ctx,
        p_room => (v_ctx->>'room_id')::uuid, p_item => new.item_id, p_subject => new.user_id);
      perform private.notify(v_event, array[new.user_id], 'handover', 'personal');
    else
      v_event := private.record_event(new.household_id, 'coordination_takeover', v_uid, false, v_ctx,
        p_room => (v_ctx->>'room_id')::uuid, p_item => new.item_id, p_subject => old.user_id);
      perform private.notify(v_event, array[old.user_id], 'takeover', 'personal');
    end if;
    perform private.drop_if_unused(v_event);
  end if;
  return null;
end $$;
create trigger purchase_coordinators_events after insert or update of user_id on public.purchase_coordinators
  for each row execute function private.coordinators_events();

-- Visual Home: transformations are milestones, photos are coalesced timeline rows.
create function private.visual_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_recent bigint;
  v_room text;
begin
  if v_uid is null then return null; end if;
  select name into v_room from public.rooms where id = new.room_id;
  if tg_table_name = 'room_transformations' then
    v_event := private.record_event(new.household_id, 'transformation_added', v_uid, true,
      jsonb_build_object('room', v_room), p_room => new.room_id, p_transformation => new.id);
    perform private.notify(v_event, (select array_agg(user_id) from public.household_members
      where household_id = new.household_id), 'milestone', 'household');
  elsif new.kind = 'photo' then
    select id into v_recent from public.household_events
     where household_id = new.household_id and type = 'photos_added' and actor_id = v_uid
       and room_id = new.room_id and created_at > now() - interval '30 minutes'
     order by id desc limit 1 for update;
    if v_recent is not null then
      update public.household_events
         set data = data || jsonb_build_object('count', coalesce((data->>'count')::int, 1) + 1), created_at = now()
       where id = v_recent;
    else
      perform private.record_event(new.household_id, 'photos_added', v_uid, true,
        jsonb_build_object('room', v_room, 'count', 1), p_room => new.room_id);
    end if;
  end if;
  return null;
end $$;
create trigger room_transformations_events after insert on public.room_transformations
  for each row execute function private.visual_events();
create trigger room_visuals_events after insert on public.room_visuals
  for each row execute function private.visual_events();

-- Wishlist ideas added by hand (imports are not activity).
create function private.ideas_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or new.import_key is not null then return null; end if;
  perform private.record_event(new.household_id, 'idea_added', v_uid, true,
    jsonb_build_object('idea', new.title), p_idea => new.id, p_room => new.room_id);
  return null;
end $$;
create trigger wishlist_items_events after insert on public.wishlist_items
  for each row execute function private.ideas_events();

-- Discussions: one notification per person per comment. Mention beats reply beats
-- "discussion on something you look after"; the last is coalesced per thread.
create function private.comments_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_ctx jsonb;
  v_item uuid;
  v_room uuid;
  v_told uuid[] := '{}';
  v_parent_author uuid;
  v_relevant uuid[];
  v_new_mentions uuid[];
begin
  if v_uid is null then return null; end if;
  if tg_op = 'UPDATE' then
    if new.deleted_at is not null and old.deleted_at is null then
      -- A deleted comment takes its history and notifications with it.
      delete from public.household_events where comment_id = new.id;
      return null;
    end if;
    v_new_mentions := array(select unnest(new.mentions) except select unnest(old.mentions));
    if cardinality(v_new_mentions) = 0 then return null; end if;
  end if;

  if new.item_id is not null then
    v_item := new.item_id;
    v_ctx := private.item_context(v_item);
    v_relevant := private.item_responsible(v_item);
  elsif new.option_id is not null then
    select item_id into v_item from public.product_options where id = new.option_id;
    v_ctx := private.item_context(v_item) || jsonb_build_object('option', (select name from public.product_options where id = new.option_id));
    v_relevant := private.item_responsible(v_item)
      || coalesce((select array[created_by] from public.product_options where id = new.option_id and created_by is not null), '{}');
  else
    select jsonb_build_object('idea', title) into v_ctx from public.wishlist_items where id = new.idea_id;
    v_relevant := coalesce((select array[created_by] from public.wishlist_items where id = new.idea_id and created_by is not null), '{}');
  end if;
  v_room := (v_ctx->>'room_id')::uuid;

  if tg_op = 'UPDATE' then
    v_event := private.record_event(new.household_id, 'comment_mention', v_uid, false, v_ctx,
      p_room => v_room, p_item => v_item, p_option => new.option_id, p_idea => new.idea_id, p_comment => new.id);
    perform private.notify(v_event, v_new_mentions, 'mention', 'personal');
    perform private.drop_if_unused(v_event);
    return null;
  end if;

  v_event := private.record_event(new.household_id, 'comment_added', v_uid, true,
    v_ctx || jsonb_build_object('reply', new.parent_id is not null),
    p_room => v_room, p_item => v_item, p_option => new.option_id, p_idea => new.idea_id, p_comment => new.id);

  perform private.notify(v_event, new.mentions, 'mention', 'personal');
  v_told := new.mentions || v_uid;

  if new.parent_id is not null then
    select author_id into v_parent_author from public.comments where id = new.parent_id and deleted_at is null;
    if v_parent_author is not null and not (v_parent_author = any (v_told)) then
      perform private.notify(v_event, array[v_parent_author], 'reply', 'personal');
      v_told := v_told || v_parent_author;
    end if;
  end if;

  -- Responsible people hear about a thread once until they read it.
  perform private.notify(v_event, array(
    select r from unnest(v_relevant) r
     where not (r = any (v_told))
       and not exists (
         select 1 from public.notifications n join public.household_events e on e.id = n.event_id
          where n.recipient_id = r and n.read_at is null and n.reason = 'discussion'
            and n.created_at > now() - interval '30 minutes'
            and e.item_id is not distinct from v_item and e.option_id is not distinct from new.option_id
            and e.idea_id is not distinct from new.idea_id)), 'discussion', 'personal');
  return null;
end $$;
create trigger comments_events after insert or update of mentions, deleted_at on public.comments
  for each row execute function private.comments_events();

-- ───────────────────────── 6. Household management ─────────────────────────
-- Exactly one owner per flat.
create unique index household_members_one_owner on public.household_members (household_id) where role = 'owner';

-- Leaving and removal go through the functions below, never a raw delete.
drop policy "members: leave household" on public.household_members;
revoke delete on public.household_members from authenticated;

-- Membership history. Joins are recorded by the trigger; leaving/removal is recorded by
-- the functions so the wording reflects what happened.
create function private.members_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_full boolean;
begin
  if new.role = 'owner' then return null; end if; -- the founder creating the flat
  v_full := coalesce(private.household_spaces(new.household_id), 0) <= 0;
  v_event := private.record_event(new.household_id, 'member_joined', coalesce(v_uid, new.user_id), true,
    jsonb_build_object('full', v_full), p_subject => new.user_id);
  perform private.notify(v_event, (select array_agg(user_id) from public.household_members
    where household_id = new.household_id and user_id <> new.user_id), 'member', 'household');
  return null;
end $$;
create trigger household_members_events after insert on public.household_members
  for each row execute function private.members_events();

-- What someone leaves behind, for confirmations and for the history entry.
create function public.member_departure_summary(p_household uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_household_member(p_household) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'assigned', (select count(*) from public.item_assignees a join public.items i on i.id = a.item_id
                  where a.household_id = p_household and a.user_id = p_user and not i.is_complete),
    'sole', (select count(*) from public.item_assignees a join public.items i on i.id = a.item_id
              where a.household_id = p_household and a.user_id = p_user and not i.is_complete
                and not exists (select 1 from public.item_assignees b where b.item_id = a.item_id and b.user_id <> p_user)),
    'coordinating', (select count(*) from public.purchase_coordinators where household_id = p_household and user_id = p_user));
end $$;

create function private.depart(p_household uuid, p_user uuid, p_type text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_summary jsonb := public.member_departure_summary(p_household, p_user);
  v_name text := private.display_name(p_user);
  v_event bigint;
begin
  -- Items only this person was on go back to "open" so nothing is silently orphaned.
  -- Purchase records, photos, options and comments are kept; attribution survives as names.
  delete from public.household_members where household_id = p_household and user_id = p_user;
  perform private.retire_unusable_invites(p_household);
  v_event := private.record_event(p_household, p_type, v_uid, true,
    v_summary || jsonb_build_object('subject', v_name), p_subject => p_user);
  if p_type = 'member_left' then
    perform private.notify(v_event, (select array_agg(user_id) from public.household_members
      where household_id = p_household and role = 'owner'), 'member', 'household');
  end if;
  return v_summary;
end $$;

create function public.leave_household(p_household uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  perform 1 from public.households where id = p_household for update;
  select role into v_role from public.household_members where household_id = p_household and user_id = v_uid;
  if v_role is null then
    raise exception 'You are not in this flat' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    raise exception 'Hand ownership to a flatmate before you leave' using errcode = '42501';
  end if;
  return private.depart(p_household, v_uid, 'member_left');
end $$;

create function public.remove_household_member(p_household uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.households where id = p_household for update;
  if not private.is_household_owner(p_household) then
    raise exception 'Only the flat owner can remove someone' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'You can’t remove yourself' using errcode = '42501';
  end if;
  if not private.user_in_household_unchecked(p_user, p_household) then
    raise exception 'They’re not in this flat any more' using errcode = 'P0002';
  end if;
  return private.depart(p_household, p_user, 'member_removed');
end $$;

create function public.transfer_household_ownership(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
begin
  perform 1 from public.households where id = p_household for update;
  if not private.is_household_owner(p_household) then
    raise exception 'Only the flat owner can hand over ownership' using errcode = '42501';
  end if;
  if p_user = v_uid or not private.user_in_household_unchecked(p_user, p_household) then
    raise exception 'Choose a flatmate who is in this flat' using errcode = '23514';
  end if;
  update public.household_members set role = 'member' where household_id = p_household and user_id = v_uid;
  update public.household_members set role = 'owner' where household_id = p_household and user_id = p_user;
  v_event := private.record_event(p_household, 'ownership_transferred', v_uid, true,
    jsonb_build_object('subject', private.display_name(p_user)), p_subject => p_user);
  perform private.notify(v_event, array[p_user], 'ownership', 'personal');
end $$;

create function public.set_member_limit(p_household uuid, p_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_old integer;
begin
  select member_limit into v_old from public.households where id = p_household for update;
  if not private.is_household_owner(p_household) then
    raise exception 'Only the flat owner can change how many people can join' using errcode = '42501';
  end if;
  select count(*) into v_count from public.household_members where household_id = p_household;
  if p_limit is null or p_limit < greatest(v_count, 1) or p_limit > 12 then
    raise exception 'Choose between % and 12 people', greatest(v_count, 1) using errcode = '22023';
  end if;
  if p_limit = v_old then return; end if;
  update public.households set member_limit = p_limit where id = p_household;
  perform private.retire_unusable_invites(p_household);
  perform private.record_event(p_household, 'member_limit_changed', (select auth.uid()), false,
    jsonb_build_object('from', v_old, 'to', p_limit));
end $$;

revoke all on function public.leave_household(uuid) from public, anon;
revoke all on function public.remove_household_member(uuid, uuid) from public, anon;
revoke all on function public.transfer_household_ownership(uuid, uuid) from public, anon;
revoke all on function public.set_member_limit(uuid, integer) from public, anon;
revoke all on function public.member_departure_summary(uuid, uuid) from public, anon;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_household_ownership(uuid, uuid) to authenticated;
grant execute on function public.set_member_limit(uuid, integer) to authenticated;
grant execute on function public.member_departure_summary(uuid, uuid) to authenticated;

-- Internal helpers and trigger functions are never callable through the API.
revoke all on function private.notifications_guard(), private.comments_guard(), private.display_name(uuid),
  private.record_event(uuid, text, uuid, boolean, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, uuid),
  private.notify(bigint, uuid[], text, text), private.drop_if_unused(bigint), private.item_responsible(uuid),
  private.item_context(uuid), private.items_events(), private.assignees_events(), private.options_events(),
  private.coordinators_events(), private.visual_events(), private.ideas_events(), private.comments_events(),
  private.members_events(), private.depart(uuid, uuid, text)
  from public, anon, authenticated;

-- ───────────────────────── 7. Retention ─────────────────────────
-- Read notifications go after 90 days, unread after 180; personal-only events with no
-- remaining notifications are tidied. The timeline itself is kept.
create function private.prune_connected_living() returns void
language sql security definer set search_path = '' as $$
  delete from public.notifications where (read_at is not null and read_at < now() - interval '90 days')
     or created_at < now() - interval '180 days';
  delete from public.household_events e where not e.in_timeline and e.created_at < now() - interval '7 days'
     and not exists (select 1 from public.notifications n where n.event_id = e.id);
$$;
revoke all on function private.prune_connected_living() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('flatquest-notification-retention', '41 3 * * *', 'select private.prune_connected_living()');
  end if;
end $$;

-- ───────────────────────── 8. Realtime and history start ─────────────────────────
alter publication supabase_realtime add table public.household_events, public.notifications, public.comments;

-- History starts now. Nothing earlier is invented; the app shows older records separately.
insert into public.household_events (household_id, type, in_timeline)
select id, 'history_started', true from public.households;

create function private.households_history_start() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.household_events (household_id, type, in_timeline) values (new.id, 'history_started', true);
  return null;
end $$;
revoke all on function private.households_history_start() from public, anon, authenticated;
create trigger households_history_start after insert on public.households
  for each row execute function private.households_history_start();
