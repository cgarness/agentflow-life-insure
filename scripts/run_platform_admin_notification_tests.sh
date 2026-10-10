#!/usr/bin/env bash
# =====================================================================================================
# Platform admin registration notifications — SQL suite runner.
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Refuses any non-localhost PGURL.
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_platform_admin_notification_tests.sh
#
# Builds throwaway databases over a synthetic harness, applies the migration under test, then runs:
#   1. the behaviour suite (supabase/tests/platform_admin_notifications.sql)
#   2. a two-session concurrency proof (SKIP LOCKED: overlapping workers never claim the same row)
#   3. a NEGATIVE CONTROL (a broken trigger must make the suite fail)
#   4. a ROLLBACK proof (objects removed, signup still works, migration re-applies cleanly)
# Migration and rollback run with --single-transaction, as apply_migration does.
# Every database is dropped on exit. Nothing here touches a hosted project.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (AGENT_RULES invariant #28)"; exit 2 ;;
esac

echo "== locality proof =="
echo "   PGURL host component: $(printf '%s' "$PGURL" | sed -E 's#^[^@]*@##; s#/.*$##')"
psql "$PGURL/postgres" -tAc \
  "SELECT 'server=' || inet_server_addr()::text || ' port=' || inet_server_port()::text || ' db=' || current_database();"
if psql "$PGURL/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname = 'jncvvsvckxhqgqvkppmj'" | grep -q 1; then
  echo "REFUSING: this looks like a hosted project"; exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/supabase/tests/platform_admin_notifications_harness.sql"
SUITE="$ROOT/supabase/tests/platform_admin_notifications.sql"
MIG="$ROOT/supabase/migrations/20261010200000_platform_admin_registration_notifications.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20261010200000_platform_admin_registration_notifications.rollback.sql"

DB="pan_test_$$"; DB_CC="pan_cc_$$"; DB_NEG="pan_neg_$$"; DB_RB="pan_rb_$$"
drop_all() {
  for d in "$DB" "$DB_CC" "$DB_NEG" "$DB_RB"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d WITH (FORCE);" >/dev/null 2>&1 || true
  done
}
trap drop_all EXIT

build() {
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$MIG"
}

echo; echo "== harness + migration =="
build "$DB"; echo "   OK"

echo; echo "== replay guard =="
if psql "$PGURL/$DB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1; then
  echo "   FAIL: migration re-applied over itself"; exit 1
fi
echo "   OK (second apply refused)"

echo; echo "== behaviour suite =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$SUITE" 2>&1 | grep -E 'NOTICE|PASSED|ERROR' | sed 's/^/   /'

echo; echo "== concurrency (two sessions, SKIP LOCKED) =="
build "$DB_CC"
psql "$PGURL/$DB_CC" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO auth.users (email) SELECT 'cc' || g || '@example.test' FROM generate_series(1, 6) g;
UPDATE public.platform_admin_notifications SET available_at = now() - interval '1 second';
EOF
# Session A claims 3 and holds its transaction open; session B claims while A's row locks are held.
psql "$PGURL/$DB_CC" -tAq -v ON_ERROR_STOP=1 > /tmp/pan_cc_a_$$ <<'EOF' &
BEGIN;
SELECT id FROM public.claim_platform_admin_notifications(3);
SELECT pg_sleep(3);
COMMIT;
EOF
A_PID=$!
sleep 1
psql "$PGURL/$DB_CC" -tAq -v ON_ERROR_STOP=1 -c "SELECT id FROM public.claim_platform_admin_notifications(50);" > /tmp/pan_cc_b_$$
wait "$A_PID"
A_IDS=$(grep -E '^[0-9a-f-]{36}$' /tmp/pan_cc_a_$$ | sort); B_IDS=$(grep -E '^[0-9a-f-]{36}$' /tmp/pan_cc_b_$$ | sort)
rm -f /tmp/pan_cc_a_$$ /tmp/pan_cc_b_$$
A_N=$(printf '%s\n' "$A_IDS" | grep -c . || true); B_N=$(printf '%s\n' "$B_IDS" | grep -c . || true)
OVERLAP=$(comm -12 <(printf '%s\n' "$A_IDS") <(printf '%s\n' "$B_IDS") | grep -c . || true)
echo "   session A claimed $A_N, session B claimed $B_N, overlap $OVERLAP"
if [ "$A_N" -ne 3 ] || [ "$B_N" -ne 3 ] || [ "$OVERLAP" -ne 0 ]; then
  echo "   FAIL: expected 3 + 3 disjoint claims"; exit 1
fi
echo "   OK"

echo; echo "== negative control (the assertions must bite) =="
build "$DB_NEG"
psql "$PGURL/$DB_NEG" -v ON_ERROR_STOP=1 -q <<'EOF'
CREATE OR REPLACE FUNCTION private.enqueue_platform_admin_user_registered()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
EOF
set +e
NEG_OUT=$(psql "$PGURL/$DB_NEG" -v ON_ERROR_STOP=1 -q -f "$SUITE" 2>&1)
NEG_RC=$?
set -e
if [ $NEG_RC -eq 0 ] || ! printf '%s' "$NEG_OUT" | grep -q 'T1: user_registered row missing'; then
  echo "   FAIL: suite did not detect the broken trigger"; printf '%s\n' "$NEG_OUT" | tail -5; exit 1
fi
echo "   OK (suite failed on T1 as expected)"

echo; echo "== rollback proof =="
build "$DB_RB"
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q <<'EOF'
DO $$ BEGIN
  ASSERT to_regclass('public.platform_admin_notifications') IS NULL, 'table dropped';
  ASSERT to_regprocedure('public.claim_platform_admin_notifications(integer)') IS NULL, 'claim dropped';
  ASSERT to_regprocedure('public.complete_platform_admin_notification(uuid,text,text,text)') IS NULL, 'complete dropped';
  ASSERT to_regprocedure('private.enqueue_platform_admin_user_registered()') IS NULL, 'enqueue user dropped';
  ASSERT to_regprocedure('private.enqueue_platform_admin_agency_created()') IS NULL, 'enqueue agency dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_zz_platform_admin_notify_%'), 'triggers dropped';
END $$;
INSERT INTO auth.users (email) VALUES ('after-rollback@example.test');
SELECT public.provision_organization('After Rollback', 'after-rollback-1', NULL);
EOF
if psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" >/dev/null 2>&1; then
  echo "   FAIL: rollback replayed"; exit 1
fi
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -tAq -c \
  "SELECT CASE WHEN count(*) = 0 THEN 'ok' ELSE 'backfilled!' END FROM public.platform_admin_notifications;" \
  | grep -qx ok || { echo "   FAIL: re-apply backfilled rows"; exit 1; }
echo "   OK (objects removed, signup works, rollback refuses replay, re-apply clean with no backfill)"

echo; echo "ALL PLATFORM ADMIN NOTIFICATION SQL CHECKS PASSED"
