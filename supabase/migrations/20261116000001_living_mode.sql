-- Phase 7 — Living mode: household essentials, things to do, and per-user personalisation.
--
-- Additive. No existing row is modified. Extends the Phase 6 household_events /
-- notifications system with new event types instead of creating another log.
-- Recovery: supabase/rollback/20261116000001_living_mode_down.sql.

-- ───────────────────────── 1. Essentials (consumables that get used up and re-bought) ─────────────────────────
-- One row per essential for the life of the household. Running out again flips the same row
-- back to "needed", so there are never duplicate requests; each restock is kept as history.
create table public.essentials (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  -- Duplicate detection ignores case and spacing: "Toilet  paper" = "toilet paper".
  name_key text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  category text check (category in ('kitchen','bathroom','laundry','cleaning','other')),
  note text check (char_length(note) <= 120),
  status text not null default 'needed' check (status in ('needed','getting','stocked')),
  -- Who is picking it up. Leaving the flat clears it (and the trigger reopens the request).
  claimed_by uuid,
  needed_at timestamptz,
  needed_by uuid references auth.users(id) on delete set null,
  restocked_at timestamptz,
  restocked_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'getting') = (claimed_by is not null)),
  foreign key (household_id, claimed_by) references public.household_members(household_id, user_id) on delete set null (claimed_by)
);
create unique index essentials_one_per_name on public.essentials (household_id, name_key) where archived_at is null;
create index essentials_household_idx on public.essentials (household_id, status);
create index essentials_claimed_idx on public.essentials (household_id, claimed_by) where claimed_by is not null;
create index essentials_needed_by_idx on public.essentials (needed_by);
create index essentials_restocked_by_idx on public.essentials (restocked_by);
create index essentials_created_by_idx on public.essentials (created_by);

create table public.essential_restocks (
  id bigint generated always as identity primary key,
  essential_id uuid not null references public.essentials(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  restocked_by uuid references auth.users(id) on delete set null,
  restocked_by_name text,
  needed_at timestamptz,
  restocked_at timestamptz not null default now(),
  -- What the request looked like just before, so a quick "Undo" can put it back exactly.
  prior_status text not null,
  prior_claimed_by uuid,
  prior_needed_by uuid
);
create index essential_restocks_essential_idx on public.essential_restocks (essential_id, id desc);
create index essential_restocks_household_idx on public.essential_restocks (household_id);
create index essential_restocks_by_idx on public.essential_restocks (restocked_by);

alter table public.essentials enable row level security;
alter table public.essential_restocks enable row level security;
create policy "essentials: members read" on public.essentials
  for select to authenticated using (private.is_household_member(household_id));
create policy "essentials: members add" on public.essentials
  for insert to authenticated with check (private.is_household_member(household_id));
create policy "essentials: members edit" on public.essentials
  for update to authenticated using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy "restocks: members read" on public.essential_restocks
  for select to authenticated using (private.is_household_member(household_id));
revoke all on public.essentials, public.essential_restocks from anon, authenticated;
grant select on public.essentials, public.essential_restocks to authenticated;
grant insert (household_id, name, category, note, status) on public.essentials to authenticated;
-- Details only. Status and who's getting it change through update_essential() so concurrent
-- claims are serialised and history is kept. There is no DELETE: archive instead.
grant update (name, category, note, archived_at) on public.essentials to authenticated;

create function private.essentials_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  new.name := regexp_replace(trim(new.name), '\s+', ' ', 'g');
  new.note := nullif(trim(coalesce(new.note, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := v_uid;
    new.created_at := now();
    if new.status not in ('needed','stocked') then new.status := 'needed'; end if;
    new.claimed_by := null;
    new.archived_at := null;
    new.restocked_at := null; new.restocked_by := null;
    if new.status = 'needed' then new.needed_at := now(); new.needed_by := v_uid;
    else new.needed_at := null; new.needed_by := null; end if;
  else
    if new.household_id <> old.household_id then
      raise exception 'Essentials cannot move between flats' using errcode = '42501';
    end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    -- The claimer left the flat (foreign key cleared claimed_by): the request is open again.
    if new.claimed_by is null and new.status = 'getting' then new.status := 'needed'; end if;
    if new.archived_at is not null and old.archived_at is null then
      new.archived_at := now(); new.status := 'stocked'; new.claimed_by := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger essentials_guard before insert or update on public.essentials
  for each row execute function private.essentials_guard();

-- The one way to move an essential through Need it → Someone's getting it → Restocked.
-- Row-locked; p_expected lets the app refuse to act on a stale screen (FQ409).
create function public.update_essential(p_essential uuid, p_action text, p_expected text default null, p_to uuid default null)
returns public.essentials
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  e public.essentials%rowtype;
  r public.essential_restocks%rowtype;
  v_who text;
begin
  select * into e from public.essentials where id = p_essential for update;
  if not found or not private.is_household_member(e.household_id) then
    raise exception 'That essential is no longer on the list' using errcode = 'P0002';
  end if;
  if p_action <> 'need' and e.archived_at is not null then
    raise exception 'That essential was archived' using errcode = 'FQ409';
  end if;
  -- Needing, restocking and re-claiming your own pick-up are idempotent, so they never conflict.
  if p_expected is not null and e.status <> p_expected and p_action not in ('need','restock')
     and not (p_action = 'claim' and e.claimed_by = v_uid) then
    raise exception 'Someone else just updated %', e.name using errcode = 'FQ409';
  end if;
  v_who := case when e.claimed_by is null then null else private.display_name(e.claimed_by) end;

  if p_action = 'need' then
    if e.status = 'stocked' or e.archived_at is not null then
      update public.essentials set status = 'needed', claimed_by = null, needed_at = now(), needed_by = v_uid,
        archived_at = null where id = e.id returning * into e;
    end if;
  elsif p_action = 'claim' then
    if e.status = 'needed' then
      update public.essentials set status = 'getting', claimed_by = v_uid where id = e.id returning * into e;
    elsif e.status = 'getting' and e.claimed_by <> v_uid then
      raise exception '% is already getting %', v_who, e.name using errcode = 'FQ409';
    elsif e.status = 'stocked' then
      raise exception '% was just restocked', e.name using errcode = 'FQ409';
    end if;
  elsif p_action = 'release' then
    if e.status = 'getting' and e.claimed_by = v_uid then
      update public.essentials set status = 'needed', claimed_by = null where id = e.id returning * into e;
    elsif e.status = 'getting' then
      raise exception 'Only % can let this go', v_who using errcode = '42501';
    end if;
  elsif p_action = 'handover' then
    if e.status <> 'getting' or e.claimed_by <> v_uid then
      raise exception 'Only the person getting it can hand it over' using errcode = '42501';
    end if;
    if p_to is null or p_to = v_uid or not private.user_in_household_unchecked(p_to, e.household_id) then
      raise exception 'Choose a flatmate in this flat' using errcode = '23514';
    end if;
    update public.essentials set claimed_by = p_to where id = e.id returning * into e;
  elsif p_action = 'takeover' then
    if e.status = 'getting' and e.claimed_by <> v_uid then
      update public.essentials set claimed_by = v_uid where id = e.id returning * into e;
    elsif e.status = 'needed' then
      update public.essentials set status = 'getting', claimed_by = v_uid where id = e.id returning * into e;
    end if;
  elsif p_action = 'restock' then
    -- Idempotent: a second tap (or a flatmate restocking at the same moment) changes nothing.
    if e.status in ('needed','getting') then
      insert into public.essential_restocks (essential_id, household_id, restocked_by, restocked_by_name, needed_at,
        prior_status, prior_claimed_by, prior_needed_by)
      values (e.id, e.household_id, v_uid, private.display_name(v_uid), e.needed_at, e.status, e.claimed_by, e.needed_by);
      update public.essentials set status = 'stocked', claimed_by = null, restocked_at = now(), restocked_by = v_uid
       where id = e.id returning * into e;
    end if;
  elsif p_action = 'undo_restock' then
    select * into r from public.essential_restocks where essential_id = e.id order by id desc limit 1;
    if e.status <> 'stocked' or r.id is null or r.restocked_by is distinct from v_uid
       or r.restocked_at < now() - interval '10 minutes' then
      raise exception 'That restock can no longer be undone' using errcode = 'FQ409';
    end if;
    delete from public.essential_restocks where id = r.id;
    if r.prior_claimed_by is not null and not private.user_in_household_unchecked(r.prior_claimed_by, e.household_id) then
      r.prior_claimed_by := null; r.prior_status := 'needed';
    end if;
    update public.essentials set status = r.prior_status, claimed_by = r.prior_claimed_by, needed_at = r.needed_at,
      needed_by = r.prior_needed_by,
      restocked_at = (select max(x.restocked_at) from public.essential_restocks x where x.essential_id = e.id),
      restocked_by = (select x.restocked_by from public.essential_restocks x where x.essential_id = e.id order by x.id desc limit 1)
     where id = e.id returning * into e;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  return e;
end $$;
revoke all on function public.update_essential(uuid, text, text, uuid) from public, anon;
grant execute on function public.update_essential(uuid, text, text, uuid) to authenticated;

-- ───────────────────────── 2. Things to do ─────────────────────────
create table public.household_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  notes text check (char_length(notes) <= 1000),
  room_id uuid references public.rooms(id) on delete set null,
  assignee_id uuid,
  -- A calendar date (like purchases), never a timestamp: "Friday" is Friday for everyone.
  due_on date,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'done') = (completed_at is not null)),
  foreign key (household_id, assignee_id) references public.household_members(household_id, user_id) on delete set null (assignee_id)
);
create index household_tasks_household_idx on public.household_tasks (household_id, status) where archived_at is null;
create index household_tasks_assignee_idx on public.household_tasks (household_id, assignee_id) where assignee_id is not null;
create index household_tasks_room_idx on public.household_tasks (room_id) where room_id is not null;
create index household_tasks_completed_by_idx on public.household_tasks (completed_by);
create index household_tasks_created_by_idx on public.household_tasks (created_by);

alter table public.household_tasks enable row level security;
create policy "tasks: members read" on public.household_tasks
  for select to authenticated using (private.is_household_member(household_id));
create policy "tasks: members add" on public.household_tasks
  for insert to authenticated with check (private.is_household_member(household_id));
create policy "tasks: members edit" on public.household_tasks
  for update to authenticated using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
revoke all on public.household_tasks from anon, authenticated;
grant select on public.household_tasks to authenticated;
grant insert (household_id, title, notes, room_id, assignee_id, due_on, status) on public.household_tasks to authenticated;
grant update (title, notes, room_id, assignee_id, due_on, status, archived_at) on public.household_tasks to authenticated;

create function private.tasks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  new.title := regexp_replace(trim(new.title), '\s+', ' ', 'g');
  new.notes := nullif(trim(coalesce(new.notes, '')), '');
  if tg_op = 'UPDATE' and new.household_id <> old.household_id then
    raise exception 'Tasks cannot move between flats' using errcode = '42501';
  end if;
  if new.room_id is not null and (tg_op = 'INSERT' or new.room_id is distinct from old.room_id)
     and not exists (select 1 from public.rooms r where r.id = new.room_id and r.household_id = new.household_id) then
    raise exception 'That room is in another flat' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := v_uid; new.created_at := now(); new.archived_at := null;
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    if new.archived_at is not null and old.archived_at is null then new.archived_at := now(); end if;
    if new.archived_at is null and old.archived_at is not null then new.archived_at := null; end if;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now(); new.completed_by := v_uid;
  elsif new.status <> 'done' then
    new.completed_at := null; new.completed_by := null;
  else
    new.completed_at := old.completed_at; new.completed_by := old.completed_by;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger household_tasks_guard before insert or update on public.household_tasks
  for each row execute function private.tasks_guard();

-- ───────────────────────── 3. Personal preferences (yours only) ─────────────────────────
create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  accent text not null default 'blue' check (accent in ('blue','lavender','mint','coral','sunshine')),
  greeting_name text check (char_length(greeting_name) between 1 and 30),
  motion text not null default 'balanced' check (motion in ('playful','balanced','minimal')),
  -- Ordered Home sections: [{"id":"tasks","hidden":false}, …]. Unknown ids are ignored by the app.
  home_layout jsonb not null default '[]'::jsonb
    check (jsonb_typeof(home_layout) = 'array' and jsonb_array_length(home_layout) <= 20 and pg_column_size(home_layout) < 2048),
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
create policy "preferences: read your own" on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "preferences: create your own" on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "preferences: change your own" on public.user_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.user_preferences from anon, authenticated;
grant select, insert (accent, greeting_name, motion, home_layout), update (accent, greeting_name, motion, home_layout)
  on public.user_preferences to authenticated;

create function private.preferences_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.greeting_name := nullif(trim(coalesce(new.greeting_name, '')), '');
  if tg_op = 'INSERT' then new.user_id := (select auth.uid()); else new.user_id := old.user_id; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger user_preferences_guard before insert or update on public.user_preferences
  for each row execute function private.preferences_guard();

-- ───────────────────────── 4. History and notifications (extends Phase 6) ─────────────────────────
alter table public.household_events add column essential_id uuid, add column task_id uuid;
alter table public.household_events drop constraint household_events_type_check;
alter table public.household_events add constraint household_events_type_check check (type in (
  'history_started','item_added','item_completed','purchase_stage','item_assigned','item_unassigned',
  'option_added','option_selected','coordination_claimed','coordination_handover','coordination_takeover',
  'room_completed','transformation_added','photos_added','idea_added','comment_added','comment_mention',
  'member_joined','member_left','member_removed','ownership_transferred','member_limit_changed',
  'essential_needed','essential_claimed','essential_handover','essential_takeover','essential_restocked',
  'task_added','task_assigned','task_unassigned','task_completed'));
create index household_events_essential_idx on public.household_events (essential_id, type) where essential_id is not null;
create index household_events_task_idx on public.household_events (task_id, type) where task_id is not null;

create function private.essentials_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_recent bigint;
  v_data jsonb := jsonb_build_object('essential', new.name);
begin
  if v_uid is null then return null; end if;
  -- Needed (new, or run out again): one coalesced timeline line per person, no notifications.
  if new.status = 'needed' and (tg_op = 'INSERT' or (old.status = 'stocked' and new.status = 'needed')) then
    select id into v_recent from public.household_events
     where household_id = new.household_id and type = 'essential_needed' and actor_id = v_uid
       and created_at > now() - interval '30 minutes' order by id desc limit 1 for update;
    if v_recent is not null then
      update public.household_events
         set data = data || jsonb_build_object('count', coalesce((data->>'count')::int, 1) + 1), created_at = now()
       where id = v_recent;
    else
      v_event := private.record_event(new.household_id, 'essential_needed', v_uid, true, v_data || jsonb_build_object('count', 1));
      update public.household_events set essential_id = new.id where id = v_event;
    end if;
    return null;
  end if;
  if tg_op = 'INSERT' then return null; end if;

  if old.status = 'needed' and new.status = 'getting' then
    -- Tell whoever asked for it that it's sorted.
    v_event := private.record_event(new.household_id, 'essential_claimed', v_uid, false, v_data, p_subject => new.claimed_by);
    update public.household_events set essential_id = new.id where id = v_event;
    perform private.notify(v_event, array[new.needed_by], 'responsible', 'personal');
    perform private.drop_if_unused(v_event);
  elsif old.status = 'getting' and new.status = 'getting' and new.claimed_by <> old.claimed_by then
    if v_uid = old.claimed_by then
      v_event := private.record_event(new.household_id, 'essential_handover', v_uid, false, v_data, p_subject => new.claimed_by);
      update public.household_events set essential_id = new.id where id = v_event;
      perform private.notify(v_event, array[new.claimed_by], 'handover', 'personal');
    else
      v_event := private.record_event(new.household_id, 'essential_takeover', v_uid, false, v_data, p_subject => old.claimed_by);
      update public.household_events set essential_id = new.id where id = v_event;
      perform private.notify(v_event, array[old.claimed_by], 'takeover', 'personal');
    end if;
    perform private.drop_if_unused(v_event);
  elsif old.status in ('needed','getting') and new.status = 'stocked' and new.archived_at is null then
    v_event := private.record_event(new.household_id, 'essential_restocked', v_uid, true, v_data);
    update public.household_events set essential_id = new.id where id = v_event;
    -- Only the person who was going to buy it needs to know (so they don't buy it twice).
    if old.claimed_by is not null then
      perform private.notify(v_event, array[old.claimed_by], 'responsible', 'personal');
    end if;
  elsif old.status = 'stocked' and new.status in ('needed','getting') and old.restocked_by = v_uid
        and old.restocked_at > now() - interval '10 minutes' and new.restocked_at is distinct from old.restocked_at then
    -- Undo of a restock: it never happened.
    delete from public.household_events
     where essential_id = new.id and type = 'essential_restocked' and actor_id = v_uid and created_at > now() - interval '10 minutes';
  end if;
  return null;
end $$;
create trigger essentials_events after insert or update of status, claimed_by on public.essentials
  for each row execute function private.essentials_events();

create function private.tasks_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event bigint;
  v_data jsonb := jsonb_build_object('task', new.title, 'room', (select name from public.rooms where id = new.room_id));
  v_cancelled integer;
begin
  if v_uid is null then return null; end if;
  if tg_op = 'INSERT' then
    v_event := private.record_event(new.household_id, 'task_added', v_uid, true, v_data, p_room => new.room_id);
    update public.household_events set task_id = new.id where id = v_event;
    if new.assignee_id is not null and new.assignee_id <> v_uid then
      v_event := private.record_event(new.household_id, 'task_assigned', v_uid, false, v_data, p_room => new.room_id, p_subject => new.assignee_id);
      update public.household_events set task_id = new.id where id = v_event;
      perform private.notify(v_event, array[new.assignee_id], 'assigned', 'personal');
      perform private.drop_if_unused(v_event);
    end if;
    return null;
  end if;

  if new.assignee_id is distinct from old.assignee_id and new.archived_at is null then
    -- A quick change of mind (assign → unassign within minutes, still unread) cancels out.
    if old.assignee_id is not null and old.assignee_id <> v_uid then
      delete from public.household_events e
       where e.task_id = new.id and e.type = 'task_assigned' and e.subject_id = old.assignee_id
         and e.created_at > now() - interval '10 minutes'
         and exists (select 1 from public.notifications n where n.event_id = e.id and n.read_at is null);
      get diagnostics v_cancelled = row_count;
      if v_cancelled = 0 and private.user_in_household_unchecked(old.assignee_id, new.household_id) then
        v_event := private.record_event(new.household_id, 'task_unassigned', v_uid, false, v_data, p_room => new.room_id, p_subject => old.assignee_id);
        update public.household_events set task_id = new.id where id = v_event;
        perform private.notify(v_event, array[old.assignee_id], 'unassigned', 'personal');
        perform private.drop_if_unused(v_event);
      end if;
    end if;
    if new.assignee_id is not null and new.assignee_id <> v_uid then
      v_event := private.record_event(new.household_id, 'task_assigned', v_uid, false, v_data, p_room => new.room_id, p_subject => new.assignee_id);
      update public.household_events set task_id = new.id where id = v_event;
      perform private.notify(v_event, array[new.assignee_id], 'assigned', 'personal');
      perform private.drop_if_unused(v_event);
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    v_event := private.record_event(new.household_id, 'task_completed', v_uid, true, v_data, p_room => new.room_id);
    update public.household_events set task_id = new.id where id = v_event;
    perform private.notify(v_event, array[new.assignee_id, new.created_by], 'responsible', 'personal');
  elsif old.status = 'done' and new.status <> 'done' then
    -- Undoing a completion straight away leaves no trace.
    delete from public.household_events
     where task_id = new.id and type = 'task_completed' and actor_id = v_uid and created_at > now() - interval '10 minutes';
  end if;
  return null;
end $$;
create trigger household_tasks_events after insert or update of assignee_id, status on public.household_tasks
  for each row execute function private.tasks_events();

revoke all on function private.essentials_guard(), private.tasks_guard(), private.preferences_guard(),
  private.essentials_events(), private.tasks_events() from public, anon, authenticated;

-- ───────────────────────── 5. Realtime ─────────────────────────
alter publication supabase_realtime add table public.essentials, public.essential_restocks, public.household_tasks, public.user_preferences;
