-- EMERGENCY ONLY. Reverses 20261112000001_shopping.sql.
--
-- This DELETES everything recorded with the Phase 4 features (product options,
-- preferences, purchase coordination, purchase/delivery details, room measurements).
-- It does not touch any Phase 1–3 data. Product photo files in the household-media
-- bucket (<household>/products/…) are not removed by SQL; delete them from Storage.
--
-- It is NOT a migration and is never applied automatically. Before running it,
-- redeploy the previous app version, then check what would be lost:
--   select count(*) from public.product_options;
--   select count(*) from public.item_purchases;
--   select count(*) from public.items where status in ('on_the_way', 'ready_to_collect', 'delivered');

begin;

alter publication supabase_realtime drop table
  public.product_options, public.product_preferences,
  public.purchase_coordinators, public.item_purchases;

drop function if exists public.save_item_purchase(uuid, timestamptz, uuid, uuid, date, text, text, text, date, text, text, date, text, text, boolean, numeric, numeric);

drop table if exists public.item_purchases;
drop table if exists public.purchase_coordinators;
drop table if exists public.product_preferences;
drop table if exists public.product_options;
drop function if exists private.item_purchases_guard();
drop function if exists private.purchase_coordinators_guard();
drop function if exists private.product_options_guard();

alter table public.rooms
  drop column if exists width_cm,
  drop column if exists length_cm,
  drop column if exists height_cm,
  drop column if exists measurement_notes;

-- The three newer stages fall back to the closest Phase 3 status.
update public.items set status = 'ordered' where status in ('on_the_way', 'ready_to_collect', 'delivered');
alter table public.items drop constraint items_status_check;
alter table public.items add constraint items_status_check
  check (status in ('to_decide', 'bringing', 'need_to_buy', 'shopping', 'ordered', 'not_needed', 'provided'));

commit;
