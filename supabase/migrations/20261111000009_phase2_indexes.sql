-- Flat Quest — Phase 2 / 09: performance-advisor follow-ups.
create index if not exists item_assignees_household_user_idx on public.item_assignees (household_id, user_id);
create index if not exists item_assignees_item_household_idx on public.item_assignees (item_id, household_id);
create index if not exists wishlist_votes_household_user_idx on public.wishlist_votes (household_id, user_id);
create index if not exists wishlist_votes_idea_household_idx on public.wishlist_votes (idea_id, household_id);

-- The archive holds two snapshots (expand + contract steps), so key it by both.
alter table private.items_responsibility_phase1 add column if not exists snapshot_id bigint generated always as identity;
alter table private.items_responsibility_phase1 add primary key (snapshot_id);
