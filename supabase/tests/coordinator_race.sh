#!/usr/bin/env bash
# Real concurrency check (separate connections, not one transaction):
#   1. many simultaneous "I'll sort this" claims on one item  -> exactly one wins
#   2. many simultaneous "choose this option" decisions       -> exactly one option ends up selected
#   3. many simultaneous preference inserts by one member     -> exactly one preference
#   4. Phase 7: simultaneous adds of one essential, claims of it, and restocks of it
#   5. Phase 9: simultaneous scheduled reminder runs -> one reminder per task, never two
#   6. Phase 10: appointment coverage: simultaneous claims, claim vs reschedule, claim vs removal,
#      and duplicate creates of one draft
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

# ---- Phase 7: essentials
ess_add_gen() { if [ $(( $1 % 2 )) -eq 0 ]; then u=$A; else u=$B; fi
  echo "$u|insert into public.essentials (household_id, name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Race soap')"; }
added="$(run_parallel essadd 12 ess_add_gen)"
check "12 simultaneous adds of the same essential: exactly one succeeds" 1 "$added"
check "12 simultaneous adds: one essential row" 1 "$(P -c "select count(*) from public.essentials where household_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'")"
ESS="$(P -c "select id from public.essentials where household_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'")"

ess_claim_gen() { if [ $(( $1 % 2 )) -eq 0 ]; then u=$A; else u=$B; fi
  echo "$u|perform public.update_essential('$ESS', 'claim', 'needed')"; }
claimed="$(run_parallel essclaim 12 ess_claim_gen)"
# The winner's own repeat taps are harmless; every attempt by the other person is refused.
check "12 simultaneous claims (two people): only the winner's 6 taps succeed" 6 "$claimed"
check "12 simultaneous claims: exactly one person is getting it" 1 "$(P -c "select count(*) from public.essentials where id = '$ESS' and status = 'getting' and claimed_by is not null")"

ess_restock_gen() { if [ $(( $1 % 2 )) -eq 0 ]; then u=$A; else u=$B; fi
  echo "$u|perform public.update_essential('$ESS', 'restock')"; }
restocked="$(run_parallel essrestock 10 ess_restock_gen)"
check "10 simultaneous restocks: none fails" 10 "$restocked"
check "10 simultaneous restocks: exactly one restock recorded" 1 "$(P -c "select count(*) from public.essential_restocks where essential_id = '$ESS'")"

# ---- Phase 9: overlapping reminder runs (e.g. a slow run still going when the next one starts)
P >/dev/null <<SQL
insert into public.household_tasks (household_id, title, assignee_id, due_on, created_by) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Race one day late', '$B', (now() at time zone 'Pacific/Auckland')::date - 1, '$A'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Race four days late', '$B', (now() at time zone 'Pacific/Auckland')::date - 4, '$A');
SQL
for i in $(seq 1 8); do
  ( P -c "select private.send_reminders()" >/dev/null 2>&1 && echo ok >"$TMP/remind.$i" || echo error >"$TMP/remind.$i" ) &
done
wait
check "8 simultaneous reminder runs: none fails" 8 "$(cat "$TMP"/remind.* | grep -c '^ok$' || true)"
check "8 simultaneous reminder runs: exactly one reminder per overdue task" "1 1" "$(P -c "select string_agg(n::text, ' ') from (select count(nt.id) n from public.household_tasks t left join public.household_events e on e.task_id = t.id and e.type = 'task_reminder' left join public.notifications nt on nt.event_id = e.id where t.household_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' group by t.id) x")"

# ---- Phase 10: shared appointments and coverage
H=cccccccc-cccc-4ccc-8ccc-cccccccccccc
APPT=a0a0a0a0-0000-4000-8000-000000000001
appt_rev() { P -c "select revision from public.calendar_appointments where id = '$1'"; }
appt_host() { P -c "select coalesce(host_id::text, 'none') from public.calendar_appointments where id = '$1'"; }

dup_gen() { echo "$A|perform public.save_appointment('$APPT', '$H', null, 'Race inspection', null, null, date '2026-12-01', time '10:00', time '11:00', true)"; }
created="$(run_parallel dupcreate 8 dup_gen)"
check "8 simultaneous submissions of one draft: none fails" 8 "$created"
check "8 simultaneous submissions of one draft: exactly one appointment" 1 "$(P -c "select count(*) from public.calendar_appointments where id = '$APPT'")"

REV="$(appt_rev $APPT)"
claim_cover_gen() { if [ $(( $1 % 2 )) -eq 0 ]; then u=$A; else u=$B; fi
  echo "$u|perform public.set_appointment_cover('$APPT', $REV, 'claim')"; }
claimed="$(run_parallel cover 12 claim_cover_gen)"
check "12 simultaneous offers to be home (two people): only the winner's 6 taps succeed" 6 "$claimed"
check "12 simultaneous offers: exactly one person is home" 1 "$(P -c "select count(*) from public.calendar_appointments where id = '$APPT' and host_id is not null")"

# Claim racing a reschedule, several times. Whichever commits first wins and the other is
# refused as stale: either the move lands and nobody is covering, or the volunteer keeps the
# slot they actually saw and the move must be reviewed. Never a volunteer on an unseen slot.
broken=0; moves=0; claims=0
for round in 1 2 3 4 5 6; do
  host="$(appt_host $APPT)"
  if [ "$host" != none ]; then
    as_user "$host" "perform public.set_appointment_cover('$APPT', $(appt_rev $APPT), 'release')" >/dev/null
  fi
  REV="$(appt_rev $APPT)"
  before="$(P -c "select starts_at from public.calendar_appointments where id = '$APPT'")"
  ( as_user "$B" "perform public.set_appointment_cover('$APPT', $REV, 'claim')" >"$TMP/rc.claim.$round" ) &
  ( as_user "$A" "perform public.save_appointment('$APPT', '$H', $REV, 'Race inspection', null, null, date '2026-12-01', time '1$round:00', time '1$round:30', true)" >"$TMP/rc.move.$round" ) &
  wait
  move="$(cat "$TMP/rc.move.$round")"; claim="$(cat "$TMP/rc.claim.$round")"
  after="$(P -c "select starts_at from public.calendar_appointments where id = '$APPT'")"
  if [ "$move" = ok ]; then
    moves=$((moves + 1))
    { [ "$(appt_host $APPT)" = none ] && [ "$after" != "$before" ]; } || broken=1
  else
    claims=$((claims + 1))
    { [ "$claim" = ok ] && [ "$(appt_host $APPT)" = "$B" ] && [ "$after" = "$before" ]; } || broken=1
  fi
done
echo "      (claim vs reschedule: move won $moves, claim won $claims)"
check "claim racing a reschedule (6 rounds): exactly one wins and no one covers a slot they didn't see" 0 "$broken"

# Claim racing removal from the flat: a removed member never ends up covering it.
REV="$(appt_rev $APPT)"
( as_user "$B" "perform public.set_appointment_cover('$APPT', $REV, 'claim')" >/dev/null ) &
( as_user "$A" "perform public.remove_household_member('$H', '$B')" >"$TMP/rm.out" ) &
wait
check "claim racing removal: the removal succeeds" ok "$(cat "$TMP/rm.out")"
check "claim racing removal: the removed member is not covering it" none "$(appt_host $APPT)"
check "claim racing removal: the removed member can no longer see it" 0 "$(psql "$DB" -X -q -t -A <<SQL 2>/dev/null | tail -n 1
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$B","role":"authenticated"}', true);
select count(*) from public.calendar_appointments;
commit;
SQL
)"

exit $fail
