#!/usr/bin/env bash
# Rebuilds a throwaway database on a plain local Postgres (15+), applies every
# migration in order and runs the access-test suites. Nothing here can reach a
# Supabase project: it only talks to the connection given below.
#
#   PGHOST=127.0.0.1 PGPORT=54399 PGUSER=postgres supabase/tests/run_local.sh
#
# CI does the same against a real local Supabase stack (see deploy.yml).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${FLATQUEST_TEST_DB:-flatquest_test}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54399}" PGUSER="${PGUSER:-postgres}"

psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
for role in anon authenticated service_role; do
  psql -q -d postgres -c "drop role if exists ${role}" >/dev/null
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/local_shim.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
  echo "applied $(basename "$f")"
done
psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/rls_verification.sql | tail -n 4
FLATQUEST_DB_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${DB}" supabase/tests/coordinator_race.sh
