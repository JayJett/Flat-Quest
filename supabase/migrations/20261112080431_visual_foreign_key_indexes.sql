-- Cover every column of the composite foreign keys, including household scope.
create index room_visuals_room_household on public.room_visuals(room_id, household_id);
create index room_transformations_room_household on public.room_transformations(room_id, household_id);
create index room_transformations_before_scope on public.room_transformations(before_id, room_id, household_id);
create index room_transformations_after_scope on public.room_transformations(after_id, room_id, household_id);
