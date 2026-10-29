#!/usr/bin/env bash
# =====================================================================================================
# Dashboard Client Milestones review state (G2) — SQL suite runner.
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Refuses any non-localhost PGURL.
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_dashboard_milestone_tests.sh
#
# Builds throwaway databases over a synthetic harness, applies the migration under test, then runs:
#   1. a replay guard (a second apply must be refused)
#   2. the behaviour suite (supabase/tests/dashboard_milestone_reviews.sql)
#   3. two NEGATIVE CONTROLS: the migration without its privilege reset, and without its guard trigger,
#      must each make the suite fail
#   4. a ROLLBACK proof (every object removed, clients untouched, the migration re-applies cleanly)
# Migration and rollback run with --single-transaction. Every database is dropped on exit.
# Nothing here touches a hosted project.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (AGENT_RULES invariant #28)"; exit 2 ;;
esac
if psql "$PGURL/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname = 'jncvvsvckxhqgqvkppmj'" | grep -q 1; then
  echo "REFUSING: this looks like a hosted project"; exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/supabase/tests/dashboard_milestone_reviews_harness.sql"
SUITE="$ROOT/supabase/tests/dashboard_milestone_reviews.sql"
# The applied location wins once the file has been reconciled; before that, the pending one.
MIG=""; ROLLBACK=""
for f in "$ROOT"/supabase/migrations/*_dashboard_milestone_reviews.sql "$ROOT"/supabase/migrations/pending/*_dashboard_milestone_reviews.sql; do
  if [ -f "$f" ]; then MIG="$f"; break; fi
done
for f in "$ROOT"/supabase/migrations/rollback/*_dashboard_milestone_reviews.rollback.sql; do
  if [ -f "$f" ]; then ROLLBACK="$f"; break; fi
done
[ -n "$MIG" ] && [ -n "$ROLLBACK" ] || { echo "migration or rollback under test not found"; exit 1; }
WORK="$(mktemp -d)"

DB="dmr_test_$$"; DB_NEG1="dmr_neg1_$$"; DB_NEG2="dmr_neg2_$$"; DB_RB="dmr_rb_$$"
cleanup() {
  for d in "$DB" "$DB_NEG1" "$DB_NEG2" "$DB_RB"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d WITH (FORCE);" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

build() { # $1 database, $2 migration file
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$2"
}
suite() { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$SUITE" 2>&1; }

echo "== migration under test: ${MIG#$ROOT/} =="
echo "   sha256 $(sha256sum "$MIG" | cut -d' ' -f1)"

echo; echo "== harness + migration =="
build "$DB" "$MIG"; echo "   OK"

echo; echo "== replay guard =="
if psql "$PGURL/$DB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1; then
  echo "   FAIL: migration re-applied over itself"; exit 1
fi
echo "   OK (second apply refused)"

echo; echo "== behaviour suite =="
OUT="$(suite "$DB")" || { echo "$OUT" | sed 's/^/   /'; echo "   FAIL"; exit 1; }
echo "$OUT" | grep -E 'PASS|FAIL|PASSED' | sed 's/^psql:[^:]*:[0-9]*: NOTICE: */   /; s/^/   /'
echo "$OUT" | grep -q 'ALL dashboard_milestone_reviews CHECKS PASSED' || { echo "   FAIL: suite did not finish"; exit 1; }

echo; echo "== negative control 1: no privilege reset (anon keeps Supabase's default grants) =="
grep -v '^REVOKE ALL ON TABLE public.dashboard_milestone_reviews' "$MIG" > "$WORK/neg1.sql"
build "$DB_NEG1" "$WORK/neg1.sql"
# Each control must fail at the check that guards what was removed, not anywhere else.
expect_fail() { # $1 database, $2 the check label that must fail
  local out
  if out="$(suite "$1")"; then echo "   FAIL: suite passed"; exit 1; fi
  echo "$out" | grep -q "FAIL: $2 " || { echo "$out" | tail -5 | sed 's/^/   /'; echo "   FAIL: expected $2 to fail"; exit 1; }
  echo "   OK (suite fails at $2)"
}
expect_fail "$DB_NEG1" "T1.3"

echo; echo "== negative control 2: no guard trigger (updated_at would not move; reminder bound bypassable) =="
awk '/^CREATE TRIGGER dashboard_milestone_reviews_guard/{skip=3} skip>0{skip--; next} {print}' "$MIG" > "$WORK/neg2.sql"
build "$DB_NEG2" "$WORK/neg2.sql"
# Without the trigger, updated_at no longer changes on Remind Later, so Undo could erase a newer action.
expect_fail "$DB_NEG2" "T2.2a"

echo; echo "== rollback proof =="
build "$DB_RB" "$MIG"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO public.organizations VALUES ('a0000000-0000-4000-8000-00000000000a', 'Agency A');
INSERT INTO public.clients VALUES ('c0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', NULL, 'Riley');
EOF
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" 2>&1 | sed 's/^/   /'
LEFT="$(psql "$PGURL/$DB_RB" -tAc "SELECT (to_regclass('public.dashboard_milestone_reviews') IS NULL)::int
  + (to_regprocedure('public.set_dashboard_milestone_review(text,uuid,text,date,text,timestamp with time zone)') IS NULL)::int
  + (to_regprocedure('public.clear_dashboard_milestone_review(uuid,timestamp with time zone)') IS NULL)::int
  + (to_regprocedure('private.dashboard_milestone_reviews_guard()') IS NULL)::int
  + (SELECT count(*) FROM public.clients WHERE first_name = 'Riley')::int")"
[ "$LEFT" = "5" ] || { echo "   FAIL: rollback left objects behind or touched clients ($LEFT/5)"; exit 1; }
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG"
echo "   OK (all four objects removed, clients untouched, migration re-applies)"

echo; echo "ALL DASHBOARD MILESTONE REVIEW CHECKS PASSED"
