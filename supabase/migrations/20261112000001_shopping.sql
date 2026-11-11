-- Flat Quest — Phase 4 / 01: the shopping experience.
--
-- Additive only: no existing row is rewritten, and the previous app keeps working
-- against this schema (it ignores the new columns and tables).
--
--   items.status          gains three purchase stages (one status system, not two)
--   rooms                 optional measurements
--   product_options       several candidate products for ONE checklist item
--   product_preferences   one preferred option per member per item
--   purchase_coordinators who is organising the purchase (at most one per item)
--   item_purchases        what was bought, and how it is getting to the flat
--
-- Every relationship is pinned to the item's own household with composite foreign
-- keys, so nothing can point across households even if a policy were wrong.
-- Nothing here is SECURITY DEFINER: every statement runs with the caller's RLS.

-- ---------------------------------------------------------------------------
-- 1. Purchase stages live in the existing items.status.
--    need_to_buy → shopping → ordered → on_the_way | ready_to_collect → delivered
--    "Delivered" still isn't "in the flat": only is_complete means that.
-- ---------------------------------------------------------------------------
alter table public.items drop constraint items_status_check;
alter table public.items add constraint items_status_check
  check (status in ('to_decide', 'bringing', 'need_to_buy', 'shopping', 'ordered',
                    'on_the_way', 'ready_to_collect', 'delivered', 'not_needed', 'provided'));

-- ---------------------------------------------------------------------------
-- 2. Optional room measurements (centimetres).
-- ---------------------------------------------------------------------------
alter table public.rooms
  add column width_cm  numeric(6, 1) check (width_cm  is null or (width_cm  > 0 and width_cm  <= 5000)),
  add column length_cm numeric(6, 1) check (length_cm is null or (length_cm > 0 and length_cm <= 5000)),
  add column height_cm numeric(6, 1) check (height_cm is null or (height_cm > 0 and height_cm <= 1000)),
  add column measurement_notes text check (measurement_notes is null or char_length(measurement_notes) <= 500);

-- ---------------------------------------------------------------------------
-- 3. Product options: candidates for one furnishing item. Never a purchase.
-- ---------------------------------------------------------------------------
create table public.product_options (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  item_id       uuid not null,
  name          text not null check (char_length(name) between 1 and 120),
  retailer      text check (retailer is null or char_length(retailer) between 1 and 60),
  price         numeric(10, 2) check (price is null or price >= 0),
  url           text check (url is null or (char_length(url) <= 1000 and url ~* '^https?://')),
  -- household-media/<household-id>/products/<file>
  photo_path    text check (photo_path is null or (
                  char_length(photo_path) <= 200
                  and split_part(photo_path, '/', 1) = household_id::text
                  and split_part(photo_path, '/', 2) = 'products'
                  and split_part(photo_path, '/', 3) ~ '^[A-Za-z0-9._-]+$'
                  and split_part(photo_path, '/', 4) = '')),
  notes         text check (notes is null or char_length(notes) <= 1000),
  width_cm      numeric(6, 1) check (width_cm  is null or (width_cm  > 0 and width_cm  <= 2000)),
  depth_cm      numeric(6, 1) check (depth_cm  is null or (depth_cm  > 0 and depth_cm  <= 2000)),
  height_cm     numeric(6, 1) check (height_cm is null or (height_cm > 0 and height_cm <= 2000)),
  -- The household's decision. Preferences (below) are separate and never set this.
  is_selected   boolean not null default false,
  selected_at   timestamptz,
  selected_by   uuid references auth.users (id) on delete set null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (item_id, household_id) references public.items (id, household_id) on delete cascade,
  unique (id, item_id)
);
-- At most one decided option per item, whatever the clients do.
create unique index product_options_one_selected on public.product_options (item_id) where is_selected;
create index product_options_item_idx on public.product_options (item_id, household_id);
create index product_options_household_idx on public.product_options (household_id);
create index product_options_created_by_idx on public.product_options (created_by);
create index product_options_selected_by_idx on public.product_options (selected_by);

create or replace function private.product_options_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.household_id <> old.household_id or new.item_id <> old.item_id then
      raise exception 'Options cannot move to another item' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := (select auth.uid());
    new.created_at := now();
    if (select count(*) from public.product_options o where o.item_id = new.item_id) >= 20 then
      raise exception 'That’s plenty of options for one item (20 at most)' using errcode = '54000';
    end if;
  end if;

  if tg_op = 'INSERT' or new.is_selected is distinct from old.is_selected then
    if new.is_selected then
      -- Serialise decisions per item, then retire the previous pick (it stays as an option).
      perform 1 from public.items i where i.id = new.item_id for no key update;
      update public.product_options o set is_selected = false
       where o.item_id = new.item_id and o.id <> new.id and o.is_selected;
      new.selected_at := now();
      new.selected_by := (select auth.uid());
    else
      new.selected_at := null;
      new.selected_by := null;
    end if;
  else
    new.selected_at := old.selected_at;
    new.selected_by := old.selected_by;
  end if;
  return new;
end;
$$;
revoke execute on function private.product_options_guard() from public, anon, authenticated;

create trigger product_options_guard
  before insert or update on public.product_options
  for each row execute function private.product_options_guard();
create trigger product_options_updated_at
  before update on public.product_options
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Preferences: each member may back one option per item.
--    The primary key is the rule; the foreign keys keep the option on that item.
-- ---------------------------------------------------------------------------
create table public.product_preferences (
  item_id       uuid not null,
  user_id       uuid not null default auth.uid(),
  household_id  uuid not null,
  option_id     uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (item_id, user_id),
  foreign key (option_id, item_id) references public.product_options (id, item_id) on delete cascade,
  foreign key (item_id, household_id) references public.items (id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index product_preferences_option_idx on public.product_preferences (option_id, item_id);
create index product_preferences_item_household_idx on public.product_preferences (item_id, household_id);
create index product_preferences_member_idx on public.product_preferences (household_id, user_id);

create trigger product_preferences_updated_at
  before update on public.product_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Purchase coordination: "Jarden is sorting this".
--    Separate from assignees (who is responsible) and from who paid.
--    One row per item, so two simultaneous claims cannot both succeed.
-- ---------------------------------------------------------------------------
create table public.purchase_coordinators (
  item_id       uuid primary key,
  household_id  uuid not null,
  user_id       uuid not null default auth.uid(),
  claimed_at    timestamptz not null default now(),
  foreign key (item_id, household_id) references public.items (id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index purchase_coordinators_item_household_idx on public.purchase_coordinators (item_id, household_id);
create index purchase_coordinators_member_idx on public.purchase_coordinators (household_id, user_id);

-- A change of coordinator must involve the caller: you can hand your own role to a
-- flatmate, or take a role over for yourself. You can never appoint a third person.
create or replace function private.purchase_coordinators_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.item_id <> old.item_id or new.household_id <> old.household_id then
    raise exception 'Coordination cannot move to another item' using errcode = '42501';
  end if;
  if new.user_id <> old.user_id then
    if v_uid is not null and v_uid <> old.user_id and v_uid <> new.user_id then
      raise exception 'Only the person sorting this can hand it to someone else' using errcode = '42501';
    end if;
    new.claimed_at := now();
  else
    new.claimed_at := old.claimed_at;
  end if;
  return new;
end;
$$;
revoke execute on function private.purchase_coordinators_guard() from public, anon, authenticated;

create trigger purchase_coordinators_guard
  before update on public.purchase_coordinators
  for each row execute function private.purchase_coordinators_guard();

-- ---------------------------------------------------------------------------
-- 6. Purchase and delivery details (optional, one record per item).
--    The amount paid is items.actual_price and the stage is items.status, so
--    neither can disagree with the checklist.
-- ---------------------------------------------------------------------------
create table public.item_purchases (
  item_id          uuid primary key,
  household_id     uuid not null,
  option_id        uuid,
  purchased_by     uuid,
  purchased_on     date check (purchased_on is null or purchased_on between date '2000-01-01' and date '2100-12-31'),
  order_reference  text check (order_reference is null or char_length(order_reference) between 1 and 80),
  notes            text check (notes is null or char_length(notes) <= 1000),
  delivery_method  text check (delivery_method is null or delivery_method in ('delivery', 'pickup')),
  expected_on      date check (expected_on is null or expected_on between date '2000-01-01' and date '2100-12-31'),
  tracking_url     text check (tracking_url is null or (char_length(tracking_url) <= 1000 and tracking_url ~* '^https?://')),
  delivery_notes   text check (delivery_notes is null or char_length(delivery_notes) <= 1000),
  arrived_on       date check (arrived_on is null or arrived_on between date '2000-01-01' and date '2100-12-31'),
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (item_id, household_id) references public.items (id, household_id) on delete cascade,
  -- If the chosen product or the buyer goes away, the record stays without them.
  foreign key (option_id, item_id) references public.product_options (id, item_id) on delete set null (option_id),
  foreign key (household_id, purchased_by) references public.household_members (household_id, user_id) on delete set null (purchased_by)
);
create index item_purchases_item_household_idx on public.item_purchases (item_id, household_id);
create index item_purchases_option_idx on public.item_purchases (option_id, item_id);
create index item_purchases_buyer_idx on public.item_purchases (household_id, purchased_by);
create index item_purchases_updated_by_idx on public.item_purchases (updated_by);

create or replace function private.item_purchases_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.item_id <> old.item_id or new.household_id <> old.household_id then
      raise exception 'A purchase cannot move to another item' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
revoke execute on function private.item_purchases_guard() from public, anon, authenticated;

create trigger item_purchases_guard
  before insert or update on public.item_purchases
  for each row execute function private.item_purchases_guard();
create trigger item_purchases_updated_at
  before update on public.item_purchases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Row level security and least-privilege grants.
-- ---------------------------------------------------------------------------
alter table public.product_options       enable row level security;
alter table public.product_preferences   enable row level security;
alter table public.purchase_coordinators enable row level security;
alter table public.item_purchases        enable row level security;
revoke all on public.product_options, public.product_preferences,
              public.purchase_coordinators, public.item_purchases from anon, authenticated;

-- product_options: collaborative, like items. Server-maintained columns
-- (created_by, selected_at, selected_by, timestamps) are not writable.
grant select, delete on public.product_options to authenticated;
grant insert (household_id, item_id, name, retailer, price, url, photo_path, notes, width_cm, depth_cm, height_cm, is_selected)
  on public.product_options to authenticated;
grant update (name, retailer, price, url, photo_path, notes, width_cm, depth_cm, height_cm, is_selected)
  on public.product_options to authenticated;
create policy "options: members read" on public.product_options
  for select to authenticated using (private.is_household_member(household_id));
create policy "options: members add" on public.product_options
  for insert to authenticated with check (private.is_household_member(household_id));
create policy "options: members edit" on public.product_options
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy "options: members remove" on public.product_options
  for delete to authenticated using (private.is_household_member(household_id));

-- product_preferences: read your household's; write only your own. user_id is
-- not an insertable column at all, so it always comes from auth.uid().
grant select, delete on public.product_preferences to authenticated;
grant insert (item_id, household_id, option_id) on public.product_preferences to authenticated;
grant update (option_id) on public.product_preferences to authenticated;
create policy "preferences: members read" on public.product_preferences
  for select to authenticated using (private.is_household_member(household_id));
create policy "preferences: add own" on public.product_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_household_member(household_id));
create policy "preferences: change own" on public.product_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_household_member(household_id));
create policy "preferences: remove own" on public.product_preferences
  for delete to authenticated using (user_id = (select auth.uid()));

-- purchase_coordinators: claim for yourself (insert), release your own (delete),
-- hand over / take over (update, checked by the guard above).
grant select, delete on public.purchase_coordinators to authenticated;
grant insert (item_id, household_id) on public.purchase_coordinators to authenticated;
grant update (user_id) on public.purchase_coordinators to authenticated;
create policy "coordinators: members read" on public.purchase_coordinators
  for select to authenticated using (private.is_household_member(household_id));
create policy "coordinators: claim for yourself" on public.purchase_coordinators
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_household_member(household_id));
create policy "coordinators: hand over or take over" on public.purchase_coordinators
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy "coordinators: release your own" on public.purchase_coordinators
  for delete to authenticated using (user_id = (select auth.uid()));

-- item_purchases: members read and write; rows only disappear with their item.
grant select on public.item_purchases to authenticated;
grant insert (item_id, household_id, option_id, purchased_by, purchased_on, order_reference, notes,
              delivery_method, expected_on, tracking_url, delivery_notes, arrived_on)
  on public.item_purchases to authenticated;
grant update (option_id, purchased_by, purchased_on, order_reference, notes,
              delivery_method, expected_on, tracking_url, delivery_notes, arrived_on)
  on public.item_purchases to authenticated;
create policy "purchases: members read" on public.item_purchases
  for select to authenticated using (private.is_household_member(household_id));
create policy "purchases: members add" on public.item_purchases
  for insert to authenticated with check (private.is_household_member(household_id));
create policy "purchases: members edit" on public.item_purchases
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- 8. Save purchase + delivery details and (optionally) the item's stage and
--    amount paid in ONE transaction, refusing to overwrite newer changes.
--
--    SECURITY INVOKER: the caller's RLS applies to every statement.
--    p_expected_version = item_purchases.updated_at the form was opened with
--    (null = "there was no record yet"). p_expected_status / p_expected_amount
--    are what the form showed for the item's stage and amount paid.
--    SQLSTATE FQ409 = someone else changed it first; nothing is written.
-- ---------------------------------------------------------------------------
create or replace function public.save_item_purchase(
  p_item             uuid,
  p_expected_version timestamptz default null,
  p_option           uuid default null,
  p_purchased_by     uuid default null,
  p_purchased_on     date default null,
  p_order_reference  text default null,
  p_notes            text default null,
  p_delivery_method  text default null,
  p_expected_on      date default null,
  p_tracking_url     text default null,
  p_delivery_notes   text default null,
  p_arrived_on       date default null,
  p_status           text default null,
  p_expected_status  text default null,
  p_set_amount       boolean default false,
  p_amount           numeric default null,
  p_expected_amount  numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item     public.items%rowtype;
  v_purchase public.item_purchases%rowtype;
  v_exists   boolean;
begin
  select * into v_item from public.items where id = p_item for no key update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  select * into v_purchase from public.item_purchases where item_id = p_item for update;
  v_exists := found;
  if (v_exists and v_purchase.updated_at is distinct from p_expected_version)
     or (not v_exists and p_expected_version is not null) then
    raise exception 'Someone else just updated this purchase' using errcode = 'FQ409';
  end if;
  if p_status is not null and v_item.status is distinct from p_expected_status then
    raise exception 'Someone else just changed this item’s stage' using errcode = 'FQ409';
  end if;
  if p_set_amount and v_item.actual_price is distinct from p_expected_amount then
    raise exception 'Someone else just changed the amount paid' using errcode = 'FQ409';
  end if;

  if v_exists then
    update public.item_purchases
       set option_id = p_option,
           purchased_by = p_purchased_by,
           purchased_on = p_purchased_on,
           order_reference = nullif(btrim(p_order_reference), ''),
           notes = nullif(btrim(p_notes), ''),
           delivery_method = p_delivery_method,
           expected_on = p_expected_on,
           tracking_url = nullif(btrim(p_tracking_url), ''),
           delivery_notes = nullif(btrim(p_delivery_notes), ''),
           arrived_on = p_arrived_on
     where item_id = p_item
    returning * into v_purchase;
  else
    insert into public.item_purchases (
      item_id, household_id, option_id, purchased_by, purchased_on, order_reference, notes,
      delivery_method, expected_on, tracking_url, delivery_notes, arrived_on)
    values (
      p_item, v_item.household_id, p_option, p_purchased_by, p_purchased_on,
      nullif(btrim(p_order_reference), ''), nullif(btrim(p_notes), ''),
      p_delivery_method, p_expected_on, nullif(btrim(p_tracking_url), ''),
      nullif(btrim(p_delivery_notes), ''), p_arrived_on)
    returning * into v_purchase;
  end if;

  if p_status is not null or p_set_amount then
    update public.items
       set status = coalesce(p_status, status),
           actual_price = case when p_set_amount then p_amount else actual_price end
     where id = p_item
    returning * into v_item;
  end if;

  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'item', to_jsonb(v_item));
end;
$$;
revoke execute on function public.save_item_purchase(uuid, timestamptz, uuid, uuid, date, text, text, text, date, text, text, date, text, text, boolean, numeric, numeric) from public, anon;
grant execute on function public.save_item_purchase(uuid, timestamptz, uuid, uuid, date, text, text, text, date, text, text, date, text, text, boolean, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Realtime for the four new tables.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.product_options, public.product_preferences,
  public.purchase_coordinators, public.item_purchases;
