#!/usr/bin/env bash
# Real concurrency check (separate connections, not one transaction):
#   1. many simultaneous "I'll sort this" claims on one item  -> exactly one wins
#   2. many simultaneous "choose this option" decisions       -> exactly one option ends up selected
#   3. many simultaneous preference inserts by one member     -> exactly one preference
# Uses throwaway users and a throwaway household, and removes them afterwards.
#
#   FLATQUEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres supabase/tests/coordinator_race.sh
set -euo pipefail
DB="${FLATQUEST_DB_URL:?Set FLATQUEST_DB_URL to a disposable local database}"
case "$DB" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Refusing to run against a non-local database." >&2; exit 2 ;;
esac
P() { psql "$DB" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
A=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
B=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
TMP="$(mktemp -d)"
cleanup() {
  P -c "delete from public.households where name = 'Race Test House' and created_by = '$A'" \
    -c "delete from auth.users where id in ('$A', '$B')" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
cleanup; TMP="$(mktemp -d)"

P >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
  ('$A', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-a@test.invalid', '{"display_name":"RaceA"}', '{}', now(), now()),
  ('$B', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-b@test.invalid', '{"display_name":"RaceB"}', '{}', now(), now());
insert into public.households (id, name, created_by) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Race Test House', '$A');
insert into public.household_members (household_id, user_id, role) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '$A', 'owner'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '$B', 'member');
insert into public.rooms (id, household_id, name) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Race room');
insert into public.items (id, household_id, room_id, name, status) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Race couch', 'shopping');
insert into public.product_options (id, household_id, item_id, name)
select ('f0000000-0000-4000-8000-00000000000' || n)::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Couch ' || n
from generate_series(1, 6) n;
SQL

as_user() { # $1 = user id, $2 = SQL. Prints "ok" or "error <sqlstate>".
  psql "$DB" -X -q -t -A -v ON_ERROR_STOP=1 <<SQL 2>/dev/null | tail -n 1
\set VERBOSITY sqlstate
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
do \$\$ begin
  $2;
  raise notice 'done';
end \$\$;
commit;
select 'ok';
SQL
}

run_parallel() { # $1 = label, $2 = count, then a function producing "user|sql" per index
  local label="$1" n="$2" gen="$3" i
  for i in $(seq 1 "$n"); do
    IFS='|' read -r user sql <<<"$($gen "$i")"
    ( r="$(as_user "$user" "$sql")"; echo "${r:-error}" >"$TMP/$label.$i" ) &
  done
  wait
  cat "$TMP/$label".* | grep -c '^ok$' || true
}

fail=0
check() { # label expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi
}

claim_gen() { if [ $(( $1 % 2 )) -eq 0 ]; then u=$A; else u=$B; fi
  echo "$u|insert into public.purchase_coordinators (item_id, household_id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')"; }
won="$(run_parallel claim 12 claim_gen)"
check "12 simultaneous claims: exactly one succeeds" 1 "$won"
check "12 simultaneous claims: exactly one coordinator row" 1 "$(P -c "select count(*) from public.purchase_coordinators where item_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'")"

select_gen() { if [ $(( $1 % 2 )) -eq 0 ]; then u=$A; else u=$B; fi
  echo "$u|update public.product_options set is_selected = true where id = 'f0000000-0000-4000-8000-00000000000$(( ($1 % 6) + 1 ))'"; }
done_n="$(run_parallel select 12 select_gen)"
check "12 simultaneous selections: none fails" 12 "$done_n"
check "12 simultaneous selections: exactly one option selected" 1 "$(P -c "select count(*) from public.product_options where item_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and is_selected")"

pref_gen() { echo "$A|insert into public.product_preferences (item_id, household_id, option_id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'f0000000-0000-4000-8000-00000000000$(( ($1 % 6) + 1 ))')"; }
pref_ok="$(run_parallel pref 8 pref_gen)"
check "8 simultaneous preferences by one member: exactly one succeeds" 1 "$pref_ok"
check "8 simultaneous preferences by one member: exactly one row" 1 "$(P -c "select count(*) from public.product_preferences where item_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'")"

exit $fail
