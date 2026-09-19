#!/usr/bin/env bash
# =====================================================================================================
# Custom-Field Canonicalization — SQL suite runner (disposable LOCAL PostgreSQL only; invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_custom_field_guard_tests.sh
#
# Creates throwaway databases, seeds the LEGACY DUPLICATES FIRST, applies the guard migration over
# them, runs the scenario suite, then runs three proofs that need more than one session or a separate
# database: a TRUE two-session concurrency race, a NEGATIVE CONTROL that proves the assertions bite,
# and a ROLLBACK proof. Every database is dropped on exit. Refuses to run when PGURL is not localhost.
#
# Nothing here touches a hosted project. The migration under test is NOT APPLIED ANYWHERE.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/supabase/tests/custom_fields_harness.sql"
SUITE="$ROOT/supabase/tests/custom_field_logical_name_guard.sql"
# Custom-Field Canonicalization — NOT YET APPLIED to any hosted project; local suites only.
MIG="$ROOT/supabase/migrations/20260919052941_custom_field_logical_name_guard.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20260919052941_custom_field_logical_name_guard.rollback.sql"

DB="cf_guard_test_$$"
DB_NEG="cf_guard_neg_$$"
DB_RB="cf_guard_rb_$$"

drop_all() {
  for d in "$DB" "$DB_NEG" "$DB_RB"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1 || true
  done
}
trap drop_all EXIT

ORG_A='aaaaaaaa-0000-0000-0000-00000000000a'
AGENT1='aaaaaaaa-0000-0000-0000-0000000000a1'
AGENT2='aaaaaaaa-0000-0000-0000-0000000000a2'

# ── Main suite ──────────────────────────────────────────────────────────────────────────────────
echo "== harness (seeds 3 LEGACY duplicate rows BEFORE the migration) =="
psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$HARNESS"

echo "== applying the guard migration OVER the legacy duplicates =="
# If this fails, the forward-only design is wrong — a unique index would fail exactly here.
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$MIG"
echo "   OK (migration applied over violating rows — this is what a UNIQUE INDEX could not do)"

echo "== scenario suite =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$SUITE"
echo "   OK"

# ── True two-session concurrency proof ──────────────────────────────────────────────────────────
# Two sessions insert the SAME new normalized name into the SAME organization at the same time.
# Exactly one must commit. Session 1 takes the advisory lock and holds the transaction open for 3s;
# session 2 starts 1s later and must block on that lock, then fail 23505 once session 1 commits.
echo "== two-session concurrency proof =="
psql "$PGURL/$DB" -q >/dev/null 2>&1 <<EOF &
BEGIN;
INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
VALUES ('Race Condition Field','Text','["Leads"]'::jsonb,'$ORG_A','$AGENT1');
SELECT pg_sleep(3);
COMMIT;
EOF
sleep 1
set +e
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<EOF
BEGIN;
INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
VALUES ('race   condition field','Text','["Leads"]'::jsonb,'$ORG_A','$AGENT2');
COMMIT;
EOF
SECOND_RC=$?
set -e
wait

RACE_ROWS=$(psql "$PGURL/$DB" -Atc \
  "SELECT count(*) FROM public.custom_fields
    WHERE organization_id='$ORG_A' AND active
      AND private.custom_field_norm(name)='race condition field';")
if [ "$RACE_ROWS" != "1" ]; then
  echo "CONCURRENCY FAILED: $RACE_ROWS rows survived the race (expected exactly 1)"; exit 1
fi
if [ "$SECOND_RC" = "0" ]; then
  echo "CONCURRENCY FAILED: the second concurrent session was not rejected"; exit 1
fi
echo "   OK (1 row survived; the losing session was rejected)"

# ── Negative control ────────────────────────────────────────────────────────────────────────────
# Proves the assertions actually bite: on a database WITHOUT the trigger, the duplicate INSERT that
# S2 expects to fail must SUCCEED. A suite that passes with and without the guard proves nothing.
echo "== negative control (no trigger => the duplicate MUST be accepted) =="
psql "$PGURL/postgres" -qc "CREATE DATABASE $DB_NEG;"
psql "$PGURL/$DB_NEG" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
set +e
psql "$PGURL/$DB_NEG" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<EOF
INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
VALUES ('Gender','Text','["Leads"]'::jsonb,'$ORG_A','bbbbbbbb-0000-0000-0000-0000000000b1');
EOF
NEG_RC=$?
set -e
if [ "$NEG_RC" != "0" ]; then
  echo "NEGATIVE CONTROL FAILED: the duplicate was rejected without the guard installed —"
  echo "  something OTHER than the guard is blocking it, so S2 proves nothing."
  exit 1
fi
echo "   OK (without the guard a 4th Gender is accepted — the guard is what rejects it)"

# ── Rollback proof ──────────────────────────────────────────────────────────────────────────────
echo "== rollback proof =="
psql "$PGURL/postgres" -qc "CREATE DATABASE $DB_RB;"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
BEFORE=$(psql "$PGURL/$DB_RB" -Atc \
  "SELECT md5(string_agg(id::text||'|'||name||'|'||type||'|'||active::text||'|'||created_at::text, ',' ORDER BY id))
     FROM public.custom_fields;")
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q -f "$MIG"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q -f "$ROLLBACK"
AFTER=$(psql "$PGURL/$DB_RB" -Atc \
  "SELECT md5(string_agg(id::text||'|'||name||'|'||type||'|'||active::text||'|'||created_at::text, ',' ORDER BY id))
     FROM public.custom_fields;")
if [ "$BEFORE" != "$AFTER" ]; then
  echo "ROLLBACK FAILED: row fingerprint changed ($BEFORE -> $AFTER)"; exit 1
fi

LEFTOVER=$(psql "$PGURL/$DB_RB" -Atc "
  SELECT (SELECT count(*) FROM pg_trigger
           WHERE tgrelid='public.custom_fields'::regclass
             AND tgname='trg_custom_fields_logical_name_guard' AND NOT tgisinternal)
       + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='private'
             AND p.proname IN ('custom_fields_logical_name_guard','custom_field_norm'))
       + (SELECT count(*) FROM pg_indexes
           WHERE schemaname='public' AND indexname='custom_fields_org_norm_active_idx');")
if [ "$LEFTOVER" != "0" ]; then
  echo "ROLLBACK FAILED: $LEFTOVER guard object(s) survived the rollback"; exit 1
fi

# After rollback the duplicate must be accepted again — proving the rollback really restored the
# prior behaviour rather than merely dropping objects.
set +e
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<EOF
INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
VALUES ('Gender','Text','["Leads"]'::jsonb,'$ORG_A','bbbbbbbb-0000-0000-0000-0000000000b1');
EOF
RB_RC=$?
set -e
if [ "$RB_RC" != "0" ]; then
  echo "ROLLBACK FAILED: duplicates are still blocked after rolling back"; exit 1
fi
echo "   OK (all guard objects dropped, every row byte-identical, prior behaviour restored)"

echo
echo "ALL CUSTOM-FIELD GUARD PROOFS PASSED"
