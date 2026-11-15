-- Run once, immediately BEFORE applying 20261115192306_connected_living.sql to a live project.
-- The migration adds new tables and triggers but changes no existing rows. The only
-- existing objects it alters are household_members (a one-owner index and the removal of
-- the "leave household" delete policy) — so a private copy of memberships and limits is
-- kept as insurance. The `private` schema is not served by the API.
-- Remove once Phase 6 has settled:  drop table private.phase6_pre_members, private.phase6_pre_households;
create table private.phase6_pre_members as select *, now() as snapshot_at from public.household_members;
create table private.phase6_pre_households as select id, member_limit, created_by, now() as snapshot_at from public.households;
revoke all on private.phase6_pre_members, private.phase6_pre_households from public, anon, authenticated;
alter table private.phase6_pre_members enable row level security;
alter table private.phase6_pre_households enable row level security;
