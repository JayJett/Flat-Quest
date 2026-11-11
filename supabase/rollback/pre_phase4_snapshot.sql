-- Run once, immediately BEFORE applying 20261112000001_shopping.sql to a live project.
-- Keeps a private, non-exposed copy of the two existing tables whose definitions the
-- migration touches (items: status rule; rooms: new nullable columns). No row in either
-- table is modified by the migration, so this is insurance, not an expected need.
--
-- The `private` schema is not served by the API. Remove the copies once Phase 4 has
-- settled:  drop table private.phase4_pre_items, private.phase4_pre_rooms;
create table private.phase4_pre_items as select *, now() as snapshot_at from public.items;
create table private.phase4_pre_rooms as select *, now() as snapshot_at from public.rooms;
revoke all on private.phase4_pre_items, private.phase4_pre_rooms from public, anon, authenticated;
alter table private.phase4_pre_items enable row level security;
alter table private.phase4_pre_rooms enable row level security;
