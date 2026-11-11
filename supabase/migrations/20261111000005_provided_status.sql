-- Flat Quest — Phase 2 / 05: "Provided with flat" status + landlord appliances.
--
-- 'provided' = supplied by the landlord. Unlike 'not_needed' it still counts
-- towards progress (it's done once someone confirms it's there) but it never
-- shows as unclaimed / something to buy.
--
-- Data changes only touch rows nobody has changed: the three appliances from the
-- original sheet are switched to provided/landlord only while they still have
-- their imported defaults (to decide / not needed, ownership to decide or landlord,
-- nobody assigned, not complete). Dishwasher and dryer are added if missing.

alter table public.items drop constraint items_status_check;
alter table public.items add constraint items_status_check
  check (status in ('to_decide', 'bringing', 'need_to_buy', 'shopping', 'ordered', 'not_needed', 'provided'));

update public.items i
   set status = 'provided', ownership = 'landlord', owner_user_id = null
 where i.import_key in (
         'room:kitchen|fridge / freezer (confirm supplied)',
         'room:kitchen|microwave',
         'room:laundry & cleaning|washing machine (confirm supplied)')
   and i.status in ('to_decide', 'not_needed')
   and i.ownership in ('to_decide', 'landlord')
   and not i.is_complete
   and not exists (select 1 from public.item_assignees a where a.item_id = i.id);

insert into public.items (household_id, room_id, name, priority, status, ownership, sort_order, import_key)
select r.household_id, r.id, 'Dishwasher', 'must_have', 'provided', 'landlord',
       coalesce((select max(sort_order) from public.items x where x.room_id = r.id), 0) + 1,
       'room:kitchen|dishwasher'
from public.rooms r
where r.import_key = 'room:kitchen'
  and not exists (select 1 from public.items x where x.room_id = r.id and x.name ilike 'dishwasher%')
on conflict (household_id, import_key) do nothing;

insert into public.items (household_id, room_id, name, priority, status, ownership, sort_order, import_key)
select r.household_id, r.id, 'Dryer', 'must_have', 'provided', 'landlord',
       coalesce((select max(sort_order) from public.items x where x.room_id = r.id), 0) + 1,
       'room:laundry & cleaning|dryer'
from public.rooms r
where r.import_key = 'room:laundry & cleaning'
  and not exists (select 1 from public.items x where x.room_id = r.id and (x.name ilike '%dryer%' and x.name not ilike '%hair%'))
on conflict (household_id, import_key) do nothing;
