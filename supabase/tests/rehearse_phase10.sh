#!/usr/bin/env bash
# Phase 10 migration rehearsal on a POPULATED disposable Phase 9 database (synthetic data only).
#   1. Build a database with every migration up to Phase 9 and fill it with two flats' worth of
#      records (memberships, rooms, items, assignees, wishlist and votes, shopping and purchases,
#      Visual Home with a room cover, comments, history, notifications, essentials, tasks,
#      preferences, invites, reminders).
#   2. Fingerprint every table (row count + md5 of all rows in key order).
#   3. Apply the Phase 10 migration; fingerprints must be identical (it is additive).
#   4. Run the Phase 6–10 verification suites against the extended schema.
#   5. Roll back (export confirmed) and re-apply; fingerprints still identical.
#
#   PGHOST=127.0.0.1 PGPORT=54399 PGUSER=postgres supabase/tests/rehearse_phase10.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=flatquest_rehearsal
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54399}" PGUSER="${PGUSER:-postgres}"
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "Refusing to run against a non-local database." >&2; exit 2 ;; esac
PHASE10=$(ls supabase/migrations/*_shared_week.sql)
ROLLBACK=$(ls supabase/rollback/*_shared_week_down.sql)
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
Q() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

# Roles are cluster-wide: drop the other disposable test database too (run_local.sh recreates it).
psql -q -d postgres -c "drop database if exists $DB" -c "drop database if exists flatquest_test" -c "create database $DB" >/dev/null
for role in anon authenticated service_role; do psql -q -d postgres -c "drop role if exists $role" >/dev/null 2>&1 || true; done
Q -f supabase/tests/local_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  [ "$f" = "$PHASE10" ] && continue
  Q -f "$f" >/dev/null
done
echo "Phase 9 schema built ($(ls supabase/migrations/*.sql | grep -vc shared_week) migrations)"

Q >/dev/null <<'SQL'
-- Synthetic population, written the way the app writes it (as signed-in members).
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('role', 'none', false);
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, false);
  select set_config('role', 'authenticated', false);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'none', false); select set_config('request.jwt.claims', '', false);
$$;
do $$
declare
  a uuid := 'a0000000-0000-4000-8000-00000000000a'; b uuid := 'b0000000-0000-4000-8000-00000000000b';
  c uuid := 'c0000000-0000-4000-8000-00000000000c';
  f1 uuid; f2 uuid; k1 uuid; k2 uuid; l1 uuid; item uuid; item2 uuid; opt uuid; idea uuid; vis uuid; r record; ess uuid; up jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@rehearsal.invalid', jsonb_build_object('display_name', n), '{}', now(), now()
    from (values (a, 'Avery'), (b, 'Blair'), (c, 'Casey')) v(u, n);
  perform pg_temp.as_user(a);
  f1 := public.create_household('Rehearsal Flat', '1 Example Street');
  insert into public.rooms (household_id, name, color, icon) values (f1, 'Kitchen', 'green', 'cooking-pot') returning id into k1;
  insert into public.rooms (household_id, name) values (f1, 'Lounge') returning id into l1;
  for i in 1..40 loop
    insert into public.items (household_id, room_id, name, priority, status) values (f1, case when i % 2 = 0 then k1 else l1 end, 'Item ' || i,
      (array['must_have','nice_to_have','maybe_later'])[1 + i % 3], (array['to_decide','need_to_buy','shopping','ordered','on_the_way','delivered','provided'])[1 + i % 7]);
  end loop;
  select id into item from public.items where household_id = f1 and status = 'ordered' limit 1;
  select id into item2 from public.items where household_id = f1 and status = 'need_to_buy' limit 1;
  perform public.create_household_invite(f1);
  perform pg_temp.as_admin();
  insert into public.household_members (household_id, user_id) values (f1, b);
  perform pg_temp.as_user(b);
  perform public.set_item_assignees(item2, array[a, b]);
  insert into public.product_options (household_id, item_id, name, price) values (f1, item2, 'Option A', 120) returning id into opt;
  insert into public.product_preferences (household_id, item_id, option_id) values (f1, item2, opt);
  insert into public.purchase_coordinators (household_id, item_id) values (f1, item);
  perform public.save_item_purchase(item, null, null, b, current_date - 2, 'ORD-1', null, 'delivery', current_date + 2, null, null, null);
  insert into public.wishlist_items (household_id, title) values (f1, 'Reading lamp') returning id into idea;
  insert into public.wishlist_votes (household_id, idea_id) values (f1, idea);
  insert into public.comments (household_id, item_id, body, mentions) values (f1, item2, 'Shall we get this one @Avery?', array[a]);
  insert into public.essentials (household_id, name, quantity) values (f1, 'Toilet paper', '24-roll pack') returning id into ess;
  perform public.update_essential(ess, 'claim', 'needed');
  insert into public.household_tasks (household_id, title, assignee_id, due_on, room_id) values (f1, 'Book the carpet clean', a, current_date + 3, l1);
  insert into public.household_tasks (household_id, title, assignee_id, due_on) values (f1, 'Return the trailer', b, current_date - 2);
  insert into public.user_preferences (accent, motion, greeting_name, muted_notifications) values ('coral', 'playful', 'B', array['reminders']);
  perform pg_temp.as_admin();
  insert into private.media_uploads (path, household_id) values (f1 || '/visual/0a0a0a0a-0000-4000-8000-000000000001.webp', f1);
  insert into public.room_visuals (household_id, room_id, kind, photo_path, thumbnail_path)
  values (f1, k1, 'photo', f1 || '/visual/0a0a0a0a-0000-4000-8000-000000000001.webp', f1 || '/visual/0a0a0a0a-0000-4000-8000-000000000001-thumb.webp') returning id into vis;
  update public.rooms set cover_visual_id = vis, description = 'Where the kettle lives' where id = k1;
  perform private.send_reminders(now());
  perform pg_temp.as_user(c);
  f2 := public.create_household('Second Flat', '');
  insert into public.rooms (household_id, name) values (f2, 'Kitchen') returning id into k2;
  insert into public.items (household_id, room_id, name) values (f2, k2, 'Coffee machine');
  perform pg_temp.as_admin();
  update public.households set settings = '{"currency":"NZD"}' where id = f2;
end $$;
select pg_temp.as_admin();
SQL
echo "Populated: $(Q -tAc "select format('%s flats, %s members, %s rooms, %s items, %s events, %s notifications, %s reminders', (select count(*) from public.households), (select count(*) from public.household_members), (select count(*) from public.rooms), (select count(*) from public.items), (select count(*) from public.household_events), (select count(*) from public.notifications), (select count(*) from private.reminders_sent))")"

fingerprint() { # every base table in public and private, plus scheduled jobs if present
  Q -tA > "$1" <<'SQL'
do $$ begin perform set_config('fq.fp', '', false); end $$;
select format('%s.%s %s %s', n.nspname, c.relname,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text,
  (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) as h from %I.%I t', n.nspname, c.relname), false, true, '')))[1]::text)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public', 'private') and c.relname <> 'calendar_appointments'
order by 1;
SQL
}
suites() { # $1 = label; prints "<phase>:<passes>:<first failure or ok>" for each earlier suite
  for n in 6 7 8 9; do
    out="$(Q -f "supabase/tests/phase${n}_verification.sql" 2>&1 || true)"
    fail="$(printf '%s\n' "$out" | grep -m1 -o 'FAIL: [^(]*' || true)"
    printf '%s:%s:%s\n' "$n" "$(printf '%s\n' "$out" | grep -c 'PASS:' || true)" "${fail:-ok}"
  done > "$OUT/suites-$1.txt"
}
suites before
fingerprint "$OUT/before.txt"
echo "Fingerprinted $(wc -l < "$OUT/before.txt") tables"

Q -f "$PHASE10" >/dev/null
fingerprint "$OUT/after.txt"
if diff -u "$OUT/before.txt" "$OUT/after.txt"; then echo "PASS  applying Phase 10 changed no existing row in any table"; else echo "FAIL  existing data changed"; exit 1; fi
Q -tAc "select 'PASS  legacy flat without a zone reads as ' || private.household_zone(settings) from public.households where name = 'Second Flat'"
Q -tAc "select 'PASS  reminder job runs on the extended schema (sent ' || private.send_reminders(now()) || ' new)'"

suites after
echo "Earlier suites on the same populated data (phase:passes:result), before -> after Phase 10:"
paste -d' ' "$OUT/suites-before.txt" "$OUT/suites-after.txt" | sed 's/^/  /'
if diff -q "$OUT/suites-before.txt" "$OUT/suites-after.txt" >/dev/null; then echo "PASS  every earlier suite behaves identically on the extended schema"; else echo "FAIL  an earlier suite changed behaviour"; exit 1; fi
printf 'Phase 10 suite on the populated, extended database: '
Q -f supabase/tests/phase10_verification.sql 2>&1 | grep -c "PASS:"
fingerprint "$OUT/after-suites.txt"
grep -v "reminders_sent\|household_events\|notifications" "$OUT/after.txt" > "$OUT/a"; grep -v "reminders_sent\|household_events\|notifications" "$OUT/after-suites.txt" > "$OUT/b"
if diff -q "$OUT/a" "$OUT/b" >/dev/null; then echo "PASS  the suites left the populated data untouched (they roll back)"; else diff -u "$OUT/a" "$OUT/b"; echo "FAIL"; exit 1; fi

# A synthetic appointment, then rollback with the export confirmed, then re-apply.
Q -c "insert into public.calendar_appointments (id, household_id, title, all_day, scheduled_on) select gen_random_uuid(), id, 'Rehearsal inspection', true, current_date from public.households where name = 'Rehearsal Flat'" >/dev/null
if Q -f "$ROLLBACK" >/dev/null 2>&1; then echo "FAIL  rollback ran without an export"; exit 1; else echo "PASS  rollback refuses while appointments exist and no export is confirmed"; fi
Q -c "\copy (select * from public.calendar_appointments) to '$OUT/appointments.csv' csv header"
echo "PASS  exported $(($(wc -l < "$OUT/appointments.csv") - 1)) appointment(s) before rollback"
PGOPTIONS='-c flatquest.appointments_exported=yes' Q -f "$ROLLBACK" >/dev/null
fingerprint "$OUT/rolled-back.txt"
grep -v "reminders_sent\|household_events\|notifications" "$OUT/rolled-back.txt" > "$OUT/c"
if diff -q "$OUT/a" "$OUT/c" >/dev/null; then echo "PASS  rollback restored the exact Phase 9 data"; else diff -u "$OUT/a" "$OUT/c"; echo "FAIL"; exit 1; fi
Q -f "$PHASE10" >/dev/null
echo "PASS  Phase 10 re-applied after rollback"
[ -n "${KEEP_DB:-}" ] || psql -q -d postgres -c "drop database $DB" >/dev/null
echo "Rehearsal complete; disposable database dropped."
