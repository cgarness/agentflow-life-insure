#!/usr/bin/env bash
# =====================================================================================================
# Dashboard attention clearances (G3 package) — SQL suite runner.
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Refuses any non-localhost PGURL.
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_dashboard_attention_tests.sh
#
# Builds throwaway databases over a synthetic harness, applies the migration under test, then runs:
#   1. a replay guard (a second apply must be refused)
#   2. the behaviour suite (supabase/tests/dashboard_attention_clearances.sql)
#   3. a CONCURRENCY check: two sessions clearing the same occurrence at once store ONE row
#   4. three NEGATIVE CONTROLS — the migration without its privilege reset, without the source-visibility
#      WITH CHECK, and without its guard trigger — must each make the suite fail at the check guarding it
#   5. a ROLLBACK proof (refuses while rows exist, removes every object once confirmed, sources untouched,
#      the migration re-applies cleanly)
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
HARNESS="$ROOT/supabase/tests/dashboard_attention_clearances_harness.sql"
SUITE="$ROOT/supabase/tests/dashboard_attention_clearances.sql"
# The applied location wins once the file has been reconciled; before that, the pending one.
MIG=""; ROLLBACK=""
for f in "$ROOT"/supabase/migrations/*_dashboard_attention_clearances.sql "$ROOT"/supabase/migrations/pending/*_dashboard_attention_clearances.sql; do
  if [ -f "$f" ]; then MIG="$f"; break; fi
done
for f in "$ROOT"/supabase/migrations/rollback/*_dashboard_attention_clearances.rollback.sql; do
  if [ -f "$f" ]; then ROLLBACK="$f"; break; fi
done
[ -n "$MIG" ] && [ -n "$ROLLBACK" ] || { echo "migration or rollback under test not found"; exit 1; }
WORK="$(mktemp -d)"

DB="dac_test_$$"; DB_CC="dac_cc_$$"; DB_NEG1="dac_neg1_$$"; DB_NEG2="dac_neg2_$$"; DB_NEG3="dac_neg3_$$"; DB_RB="dac_rb_$$"
cleanup() {
  for d in "$DB" "$DB_CC" "$DB_NEG1" "$DB_NEG2" "$DB_NEG3" "$DB_RB"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d WITH (FORCE);" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

build() { # $1 database, $2 migration file
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  # Production runs plpgsql.variable_conflict = error (AGENT_RULES #23): an ambiguous column must fail here too.
  psql "$PGURL/postgres" -qc "ALTER DATABASE $1 SET plpgsql.variable_conflict = 'error';"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$2"
}
suite() { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$SUITE" 2>&1; }

echo "== migration under test: ${MIG#$ROOT/} =="
echo "   sha256 $(sha256sum "$MIG" | cut -d' ' -f1)"
echo "== rollback: ${ROLLBACK#$ROOT/} =="
echo "   sha256 $(sha256sum "$ROLLBACK" | cut -d' ' -f1)"

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
echo "$OUT" | grep -q 'ALL dashboard_attention_clearances CHECKS PASSED' || { echo "   FAIL: suite did not finish"; exit 1; }
echo "   $(echo "$OUT" | grep -c 'PASS: ') checks passed"

echo; echo "== concurrency: two sessions clear the same occurrence at the same time =="
build "$DB_CC" "$MIG"
psql "$PGURL/$DB_CC" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO public.organizations VALUES ('a0000000-0000-4000-8000-00000000000a', 'Agency A');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.profiles VALUES ('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Agent', 'Active', NULL, NULL);
INSERT INTO public.calls (id, organization_id, agent_id, direction, is_missed, created_at)
  VALUES ('40000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', NULL, 'inbound', true, '2026-10-29 18:00:00.123456+00');
EOF
SESSION_SQL="SET ROLE authenticated;
SELECT dac_t.claims('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a');"
CLEAR_SQL="SELECT id FROM public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000001', '2026-10-29 18:00:00.123456+00');"
# Session 1 inserts and holds its transaction open; session 2 starts while it is open and must wait on the
# unique key, then return session 1's row instead of a second one or an error.
( psql "$PGURL/$DB_CC" -v ON_ERROR_STOP=1 -qtA -c "BEGIN;" -c "$SESSION_SQL" -c "$CLEAR_SQL" -c "SELECT pg_sleep(2);" -c "COMMIT;" \
    | grep -E '^[0-9a-f-]{36}$' > "$WORK/cc1" ) &
S1=$!
sleep 0.7
psql "$PGURL/$DB_CC" -v ON_ERROR_STOP=1 -qtA -c "$SESSION_SQL" -c "$CLEAR_SQL" | grep -E '^[0-9a-f-]{36}$' > "$WORK/cc2"
wait "$S1"
ROWS="$(psql "$PGURL/$DB_CC" -tAc "SELECT count(*) FROM public.dashboard_attention_clearances")"
if [ -s "$WORK/cc1" ] && cmp -s "$WORK/cc1" "$WORK/cc2" && [ "$ROWS" = "1" ]; then
  echo "   OK (both sessions returned row $(cat "$WORK/cc1"); 1 row stored)"
else
  echo "   FAIL: session 1 '$(cat "$WORK/cc1" 2>/dev/null)', session 2 '$(cat "$WORK/cc2" 2>/dev/null)', rows $ROWS"; exit 1
fi

# Each control must fail at the check that guards what was removed, not anywhere else.
expect_fail() { # $1 database, $2 the check label that must fail
  local out
  if out="$(suite "$1")"; then echo "   FAIL: suite passed"; exit 1; fi
  echo "$out" | grep -q "FAIL: $2 " || { echo "$out" | tail -5 | sed 's/^/   /'; echo "   FAIL: expected $2 to fail"; exit 1; }
  echo "   OK (suite fails at $2)"
}

echo; echo "== negative control 1: no privilege reset (anon keeps Supabase's default grants) =="
grep -v '^REVOKE ALL ON TABLE public.dashboard_attention_clearances' "$MIG" > "$WORK/neg1.sql"
build "$DB_NEG1" "$WORK/neg1.sql"
expect_fail "$DB_NEG1" "T1.3"

echo; echo "== negative control 2: INSERT policy without the source-visibility / occurrence check =="
build "$DB_NEG2" "$MIG"
psql "$PGURL/$DB_NEG2" -v ON_ERROR_STOP=1 -q <<'EOF'
DROP POLICY dashboard_attention_clearances_insert ON public.dashboard_attention_clearances;
CREATE POLICY dashboard_attention_clearances_insert ON public.dashboard_attention_clearances
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND organization_id = (SELECT public.get_org_id()));
EOF
expect_fail "$DB_NEG2" "T5.1"

echo; echo "== negative control 3: no guard trigger (a direct INSERT could backdate cleared_at) =="
awk '/^CREATE TRIGGER dashboard_attention_clearances_guard/{skip=3} skip>0{skip--; next} {print}' "$MIG" > "$WORK/neg3.sql"
grep -q 'CREATE TRIGGER dashboard_attention_clearances_guard' "$WORK/neg3.sql" && { echo "   FAIL: trigger not removed"; exit 1; }
build "$DB_NEG3" "$WORK/neg3.sql"
expect_fail "$DB_NEG3" "T5.5b"

echo; echo "== rollback proof =="
build "$DB_RB" "$MIG"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO public.organizations VALUES ('a0000000-0000-4000-8000-00000000000a', 'Agency A');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.calls (id, organization_id, direction, is_missed, created_at)
  VALUES ('40000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'inbound', true, '2026-10-29 18:00:00+00');
INSERT INTO public.dashboard_attention_clearances (organization_id, user_id, source_type, source_id, occurrence_at)
  VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'missed_call',
          '40000000-0000-4000-8000-000000000001', '2026-10-29 18:00:00+00');
EOF
if psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" >/dev/null 2>&1; then
  echo "   FAIL: rollback dropped clearance rows without confirmation"; exit 1
fi
STILL="$(psql "$PGURL/$DB_RB" -tAc "SELECT count(*) FROM public.dashboard_attention_clearances")"
[ "$STILL" = "1" ] || { echo "   FAIL: refused rollback changed rows ($STILL)"; exit 1; }
echo "   OK (refused while 1 row exists; nothing dropped)"
{ echo "SET dashboard_attention.rollback_discard_rows = 'confirmed';"; cat "$ROLLBACK"; } > "$WORK/rollback_confirmed.sql"
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$WORK/rollback_confirmed.sql" 2>&1 | sed 's/^/   /'
LEFT="$(psql "$PGURL/$DB_RB" -tAc "SELECT (to_regclass('public.dashboard_attention_clearances') IS NULL)::int
  + (to_regprocedure('public.clear_dashboard_attention_item(text,uuid,timestamp with time zone)') IS NULL)::int
  + (to_regprocedure('public.undo_dashboard_attention_clear(uuid,timestamp with time zone)') IS NULL)::int
  + (to_regprocedure('private.dashboard_attention_clearances_guard()') IS NULL)::int
  + (SELECT count(*) FROM public.calls WHERE is_missed AND created_at = '2026-10-29 18:00:00+00')::int")"
[ "$LEFT" = "5" ] || { echo "   FAIL: rollback left objects behind or touched calls ($LEFT/5)"; exit 1; }
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG"
echo "   OK (confirmed rollback removed all four objects, calls untouched, migration re-applies)"

echo; echo "ALL DASHBOARD ATTENTION CLEARANCE CHECKS PASSED"
