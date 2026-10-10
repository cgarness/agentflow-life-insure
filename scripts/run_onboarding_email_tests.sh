#!/usr/bin/env bash
# =====================================================================================================
# Onboarding email series — SQL suite runner.
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Refuses any non-localhost PGURL.
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_onboarding_email_tests.sh
#
# Builds throwaway databases over a synthetic harness, applies the PREPARED (unapplied) migration
# under test, then runs:
#   0. static checks: the migration installs no trigger, no schedule and no network call
#   1. the behaviour suite (supabase/tests/onboarding_emails.sql)
#   2. two-session concurrency proofs: concurrent enrollment enrolls each user once; overlapping
#      claims never return the same delivery (SKIP LOCKED)
#   3. four NEGATIVE CONTROLS: the suite must fail when the claim gate, the enrollment gate, the
#      user_email_subscriptions organization check or the no-backfill watermark is removed
#   4. a ROLLBACK proof (refused while enabled; objects removed; profiles intact; replay refused;
#      re-apply clean and empty)
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
HARNESS="$ROOT/supabase/tests/onboarding_emails_harness.sql"
SUITE="$ROOT/supabase/tests/onboarding_emails.sql"
MIG="$ROOT/supabase/migrations/pending/20261011120000_onboarding_email_foundation.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20261011120000_onboarding_email_foundation.rollback.sql"

SUFFIX="$$"
DBS=()
drop_all() {
  for d in "${DBS[@]}"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d WITH (FORCE);" >/dev/null 2>&1 || true
  done
  rm -f /tmp/oe_cc_*_"$SUFFIX" /tmp/oe_mig_*_"$SUFFIX"
}
trap drop_all EXIT

build() { # build <db> [migration file]
  DBS+=("$1")
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "${2:-$MIG}"
}

echo; echo "== static checks (inactive by construction) =="
for pattern in 'CREATE TRIGGER' 'cron\.schedule' 'net\.http' 'vault\.' 'enabled[[:space:]]+boolean[[:space:]]+NOT NULL DEFAULT true'; do
  if grep -Eiq "$pattern" "$MIG"; then echo "   FAIL: migration contains '$pattern'"; exit 1; fi
done
grep -q 'enabled                boolean     NOT NULL DEFAULT false' "$MIG" || { echo "   FAIL: flag default"; exit 1; }
echo "   OK (no trigger, no schedule, no network call, no Vault access, flag defaults false)"

DB="oe_test_$SUFFIX"
echo; echo "== harness + migration =="
build "$DB"; echo "   OK"

echo; echo "== replay guard =="
if psql "$PGURL/$DB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1; then
  echo "   FAIL: migration re-applied over itself"; exit 1
fi
echo "   OK (second apply refused)"

echo; echo "== behaviour suite =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$SUITE" 2>&1 | grep -E 'NOTICE|PASSED|ERROR' | sed 's/^.*NOTICE:  /   /'

echo; echo "== concurrency: enrollment (two sessions) =="
DB_CE="oe_ce_$SUFFIX"; build "$DB_CE"
psql "$PGURL/$DB_CE" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT gen_random_uuid(), 'ce' || g || '@example.test', now() FROM generate_series(1, 20) g;
INSERT INTO public.profiles (id, email, organization_id, role, welcome_email_sent_at)
SELECT id, email, '00000000-0000-0000-0000-0000000000a1', 'Agent', now() FROM auth.users WHERE email LIKE 'ce%';
UPDATE public.onboarding_email_program SET enabled = true, enrollment_starts_at = now() - interval '1 hour' WHERE id = 1;
EOF
psql "$PGURL/$DB_CE" -tAq -v ON_ERROR_STOP=1 > /tmp/oe_cc_ea_"$SUFFIX" <<'EOF' &
BEGIN;
SELECT public.onboarding_email_enroll_due(100);
SELECT pg_sleep(3);
COMMIT;
EOF
EA_PID=$!
sleep 1
psql "$PGURL/$DB_CE" -tAq -v ON_ERROR_STOP=1 -c "SELECT public.onboarding_email_enroll_due(100);" > /tmp/oe_cc_eb_"$SUFFIX"
wait "$EA_PID"
EA=$(grep -E '^[0-9]+$' /tmp/oe_cc_ea_"$SUFFIX" | head -1); EB=$(grep -E '^[0-9]+$' /tmp/oe_cc_eb_"$SUFFIX" | head -1)
TOTALS=$(psql "$PGURL/$DB_CE" -tAc "SELECT (SELECT count(*) FROM public.onboarding_email_enrollments) || '/' || (SELECT count(*) FROM public.onboarding_email_deliveries) || '/' || (SELECT count(*) FROM (SELECT user_id, step_key FROM public.onboarding_email_deliveries GROUP BY 1, 2 HAVING count(*) > 1) d);")
echo "   session A enrolled $EA, session B enrolled $EB; enrollments/deliveries/duplicates = $TOTALS"
if [ "$((EA + EB))" -ne 20 ] || [ "$TOTALS" != "20/100/0" ]; then
  echo "   FAIL: expected 20 enrollments, 100 deliveries, 0 duplicates"; exit 1
fi
echo "   OK"

echo; echo "== concurrency: claims (two sessions, SKIP LOCKED) =="
psql "$PGURL/$DB_CE" -v ON_ERROR_STOP=1 -q <<'EOF'
UPDATE public.onboarding_email_deliveries
   SET scheduled_at = now() - interval '1 minute', available_at = now() - interval '1 minute', expires_at = now() + interval '1 day'
 WHERE id IN (SELECT id FROM public.onboarding_email_deliveries WHERE step_key = 'agent_day01_dialer_ready' ORDER BY id LIMIT 6);
EOF
psql "$PGURL/$DB_CE" -tAq -v ON_ERROR_STOP=1 > /tmp/oe_cc_ca_"$SUFFIX" <<'EOF' &
BEGIN;
SELECT id FROM public.claim_onboarding_email_deliveries(3);
SELECT pg_sleep(3);
COMMIT;
EOF
CA_PID=$!
sleep 1
psql "$PGURL/$DB_CE" -tAq -v ON_ERROR_STOP=1 -c "SELECT id FROM public.claim_onboarding_email_deliveries(25);" > /tmp/oe_cc_cb_"$SUFFIX"
wait "$CA_PID"
A_IDS=$(grep -E '^[0-9a-f-]{36}$' /tmp/oe_cc_ca_"$SUFFIX" | sort); B_IDS=$(grep -E '^[0-9a-f-]{36}$' /tmp/oe_cc_cb_"$SUFFIX" | sort)
A_N=$(printf '%s\n' "$A_IDS" | grep -c . || true); B_N=$(printf '%s\n' "$B_IDS" | grep -c . || true)
OVERLAP=$(comm -12 <(printf '%s\n' "$A_IDS") <(printf '%s\n' "$B_IDS") | grep -c . || true)
echo "   session A claimed $A_N, session B claimed $B_N, overlap $OVERLAP"
if [ "$A_N" -ne 3 ] || [ "$B_N" -ne 3 ] || [ "$OVERLAP" -ne 0 ]; then
  echo "   FAIL: expected 3 + 3 disjoint claims"; exit 1
fi
echo "   OK"

negative_control() { # negative_control <name> <sed expression> <expected failure text>
  local name="$1" expr="$2" expect="$3"
  local mut="/tmp/oe_mig_${name}_$SUFFIX" db="oe_neg_${name}_$SUFFIX"
  sed -E "$expr" "$MIG" > "$mut"
  if cmp -s "$MIG" "$mut"; then echo "   FAIL: mutation '$name' did not apply"; exit 1; fi
  build "$db" "$mut"
  set +e
  local out; out=$(psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$SUITE" 2>&1); local rc=$?
  set -e
  if [ $rc -eq 0 ] || ! printf '%s' "$out" | grep -q "$expect"; then
    echo "   FAIL: suite did not detect '$name'"; printf '%s\n' "$out" | grep -E 'ERROR|NOTICE' | tail -3; exit 1
  fi
  echo "   OK ($name caught: $expect)"
}

echo; echo "== negative controls (the assertions must bite) =="
negative_control claim_gate 's/IF v_enabled IS NOT TRUE THEN/IF false THEN/' \
  'T14: disabled program must claim nothing'
negative_control enroll_gate 's/IF NOT FOUND OR v_program.enabled IS NOT TRUE OR v_program.enrollment_starts_at IS NULL THEN/IF NOT FOUND THEN/' \
  'T1: a watermark alone must not enable enrollment'
negative_control rls_org 's/ AND organization_id = \(SELECT public.get_org_id\(\)\)\);/);/' \
  'T11: an agency mismatch must hide the row'
negative_control backfill_watermark 's/AND p\.(welcome_email_sent_at|created_at) >= v_program\.enrollment_starts_at/AND true/' \
  'T3: six more eligible users'

echo; echo "== rollback proof =="
DB_RB="oe_rb_$SUFFIX"; build "$DB_RB"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -qc \
  "UPDATE public.onboarding_email_program SET enabled = true, enrollment_starts_at = now() WHERE id = 1;"
if psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" >/dev/null 2>&1; then
  echo "   FAIL: rollback ran while the program was enabled"; exit 1
fi
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -qc "UPDATE public.onboarding_email_program SET enabled = false WHERE id = 1;"
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q <<'EOF'
DO $$ BEGIN
  ASSERT to_regclass('public.onboarding_email_program') IS NULL, 'program dropped';
  ASSERT to_regclass('public.onboarding_email_deliveries') IS NULL, 'deliveries dropped';
  ASSERT to_regclass('public.user_email_subscriptions') IS NULL, 'subscriptions dropped';
  ASSERT to_regprocedure('public.claim_onboarding_email_deliveries(integer)') IS NULL, 'claim dropped';
  ASSERT to_regprocedure('public.set_my_onboarding_email_opt_out(boolean)') IS NULL, 'set_my dropped';
  ASSERT to_regprocedure('private.onboarding_email_slot(timestamptz,integer,text,integer)') IS NULL, 'slot dropped';
  ASSERT (SELECT count(*) FROM public.profiles) = 1, 'profiles untouched';
END $$;
EOF
if psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" >/dev/null 2>&1; then
  echo "   FAIL: rollback replayed"; exit 1
fi
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -tAq -c \
  "SELECT CASE WHEN NOT enabled AND enrollment_starts_at IS NULL AND (SELECT count(*) FROM public.onboarding_email_enrollments) = 0 THEN 'ok' ELSE 'dirty' END FROM public.onboarding_email_program;" \
  | grep -qx ok || { echo "   FAIL: re-apply was not clean"; exit 1; }
echo "   OK (refused while enabled, objects removed, profiles intact, replay refused, re-apply clean and disabled)"

echo; echo "ALL ONBOARDING EMAIL SQL CHECKS PASSED"
