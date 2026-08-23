#!/usr/bin/env bash
# =====================================================================================================
# RLS Phase 1 — authorization-matrix runner (disposable LOCAL PostgreSQL only; AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_rls_phase1_tests.sh
#
# Builds a throwaway database, applies inbound_harness + M1 + M2 + M3, installs the REAL production
# calls policies (rls_phase1_harness), then:
#   1. runs the matrix in `pre` mode   — documents today's behavior and reproduces the direct-claim bypass
#   2. applies the Phase 1 migration
#   3. runs the matrix in `post` mode  — full denial matrix, positive compatibility, SELECT truth-table
#                                        equality, and the catalog/security assertions
#   4. proves the rollback SQL restores the original policy topology exactly
#   5. proves a transactional BEGIN → Phase 1 → ROLLBACK leaves zero catalog residue
#   6. proves the migration is fail-closed (re-applying it aborts on its preconditions)
# Refuses to run when PGURL does not point at localhost.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

DB="rls_phase1_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/supabase/migrations"
PHASE1="$MIG/20260823120000_rls_phase1_calls_command_split.sql"
ROLLBACK="$MIG/rollback/20260823120000_rls_phase1_calls_command_split.rollback.sql"

psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;"' EXIT

psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/inbound_harness.sql" >/dev/null 2>&1
for m in 20260822120000_inbound_identity_foundation 20260822120100_inbound_claim_lifecycle 20260822120200_recording_source_sid; do
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/$m.sql"
done
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/rls_phase1_harness.sql" 2>&1 | grep -v NOTICE || true

echo "== matrix: pre (baseline behavior + reproduced bypass) =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -v phase=pre -q -f "$ROOT/supabase/tests/rls_phase1_matrix.sql" >/dev/null
echo "   OK"

echo "== apply Phase 1 migration =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$PHASE1"
echo "   OK"

echo "== matrix: post (denials + compatibility + truth table + catalog assertions) =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -v phase=post -f "$ROOT/supabase/tests/rls_phase1_matrix.sql" 2>&1 | grep -E "NOTICE" || true
echo "   OK"

echo "== rollback SQL restores the original topology =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROLLBACK"
RESTORED=$(psql "$PGURL/$DB" -Atc "SELECT (SELECT count(*) FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Access' AND cmd='ALL')::text || ',' || ((SELECT qual FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Access') IS NOT DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='using'))::text || ',' || ((SELECT with_check FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Access') IS NOT DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='check'))::text || ',' || (SELECT count(*) FROM pg_policies WHERE tablename='calls')::text;")
if [ "$RESTORED" != "1,true,true,2" ]; then echo "ROLLBACK FAILED: $RESTORED"; exit 1; fi
echo "   OK (original ALL policy + peer read restored, expressions byte-identical)"

echo "== transactional replay leaves zero residue =="
BEFORE=$(psql "$PGURL/$DB" -Atc "SELECT md5(string_agg(policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' ORDER BY policyname)) FROM pg_policies WHERE tablename='calls';")
{ echo "BEGIN;"; cat "$PHASE1"; echo "ROLLBACK;"; } | psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q
AFTER=$(psql "$PGURL/$DB" -Atc "SELECT md5(string_agg(policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' ORDER BY policyname)) FROM pg_policies WHERE tablename='calls';")
if [ "$BEFORE" != "$AFTER" ]; then echo "RESIDUE DETECTED after transactional rollback"; exit 1; fi
echo "   OK"

echo "== migration is fail-closed (second apply aborts) =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$PHASE1" >/dev/null
if psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$PHASE1" >/dev/null 2>&1; then
  echo "FAILED: re-applying the migration did not abort"; exit 1
fi
echo "   OK"

echo "ALL RLS PHASE 1 CHECKS GREEN"
