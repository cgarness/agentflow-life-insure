#!/usr/bin/env bash
# =====================================================================================================
# RLS Phase 1 — authorization-matrix runner (disposable LOCAL PostgreSQL only; AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_rls_phase1_tests.sh
#
# Builds a throwaway database, applies inbound_harness + M1 + M2 + M3, installs the REAL production
# calls policies (rls_phase1_harness), then:
#   0. proves the runner's own failure plumbing (a failing psql, and the post matrix run against the
#      PRE-Phase-1 policy, must both be detected as failures)
#   1. runs the matrix in `pre` mode   — documents today's behavior and reproduces the direct-claim bypass
#   2. applies the Phase 1 migration TRANSACTIONALLY (psql --single-transaction)
#   3. runs the matrix in `post` mode  — full denial matrix, positive compatibility, SELECT truth-table
#                                        equality, and the catalog/security assertions
#   4. proves the rollback SQL restores the original policy topology exactly
#   5. proves a transactional BEGIN → Phase 1 → ROLLBACK leaves zero catalog residue
#   6. proves mid-migration failure under --single-transaction leaves the ORIGINAL topology intact
#   7. proves the migration is fail-closed (re-applying it aborts on its preconditions)
# Refuses to run when PGURL does not point at localhost.
#
# V1 (verifier correction): every psql invocation goes through run_psql / expect_psql_failure, which
# capture output, record psql's REAL exit status, print everything on failure, and return nonzero.
# There is deliberately NO `|| true` around any psql invocation — the previous
# `psql ... | grep -v NOTICE || true` form swallowed psql's exit code, so a broken harness or a FAILED
# post-migration authorization matrix still printed OK. NOTICE filtering happens only after psql has
# already succeeded, and grep finding no NOTICE lines is not itself a failure.
#
# Set RLS_SELFTEST_FAIL=1 to inject a failing SQL statement through the normal success path — it must
# make this whole script exit nonzero (proof that an unexpected matrix failure is not swallowed).
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

DB="rls_phase1_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"
PHASE1="$MIG/20260823203257_rls_phase1_calls_command_split.sql"
ROLLBACK="$MIG/rollback/20260823120000_rls_phase1_calls_command_split.rollback.sql"

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR"
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || :
}
trap cleanup EXIT

# ── V1: capture-and-check psql helpers ───────────────────────────────────────────────────────────
# run_psql <label> [-notices] -- <psql args...>
#   Runs psql, records its ACTUAL exit status, and on failure prints the full captured output and
#   returns that status. With -notices, NOTICE lines are echoed — but only after psql succeeded, and
#   a grep that matches nothing never masks the successful command.
run_psql() {
  local label="$1"; shift
  local show_notices=0
  if [ "${1:-}" = "-notices" ]; then show_notices=1; shift; fi
  [ "${1:-}" = "--" ] && shift

  local out rc
  out="$WORKDIR/psql.$$.$RANDOM.out"
  set +e
  psql "$@" >"$out" 2>&1
  rc=$?
  set -e

  if [ "$rc" -ne 0 ]; then
    echo "‼ FAILED [$label]: psql exited $rc"
    echo "---------------- captured output ----------------"
    cat "$out"
    echo "-------------------------------------------------"
    rm -f "$out"
    return "$rc"
  fi

  if [ "$show_notices" -eq 1 ]; then
    # grep-no-match is NOT a failure here: psql already succeeded above.
    grep -E "NOTICE" "$out" || :
  fi
  rm -f "$out"
  return 0
}

# expect_psql_failure <label> -- <psql args...>
#   Inverse assertion: the command MUST exit nonzero. Used for the deliberate plumbing proofs and the
#   fail-closed re-apply check.
expect_psql_failure() {
  local label="$1"; shift
  [ "${1:-}" = "--" ] && shift
  local out rc
  out="$WORKDIR/psql.$$.$RANDOM.out"
  set +e
  psql "$@" >"$out" 2>&1
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "‼ FAILED [$label]: expected a NONZERO psql exit, got 0"
    cat "$out"
    rm -f "$out"
    return 1
  fi
  echo "   detected expected failure (psql exit $rc): $(grep -m1 -E '^(psql:|ERROR)' "$out" || echo '(see output)')"
  rm -f "$out"
  return 0
}

psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"

run_psql "harness"    -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$TESTS/inbound_harness.sql"
for m in 20260823222528_inbound_identity_foundation 20260823222805_inbound_claim_lifecycle 20260823222926_recording_source_sid; do
  run_psql "migration $m" -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/$m.sql"
done
run_psql "rls harness" -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$TESTS/rls_phase1_harness.sql"

echo "== 0. runner plumbing: failures are detected, not swallowed =="
printf 'SELECT 1/0;\n' > "$WORKDIR/known_bad.sql"
expect_psql_failure "known-bad SQL" -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$WORKDIR/known_bad.sql"
# The post matrix MUST fail while the pre-Phase-1 ALL policy is still in place (the bypass is live).
expect_psql_failure "post matrix vs pre-Phase-1 policy" -- \
  "$PGURL/$DB" -v ON_ERROR_STOP=1 -v phase=post -q -f "$TESTS/rls_phase1_matrix.sql"
echo "   OK"

echo "== 1. matrix: pre (baseline behavior + reproduced bypass) =="
run_psql "pre matrix" -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -v phase=pre -q -f "$TESTS/rls_phase1_matrix.sql"
echo "   OK"

# V2: the local apply uses psql --single-transaction so the whole migration is atomic here too —
# a failure in ANY precondition, policy statement, COMMENT or postcondition rolls the file back.
# (No transaction-control statements are added to the migration file itself; the production
# application mechanism is reviewed separately.)
echo "== 2. apply Phase 1 migration (psql --single-transaction) =="
run_psql "apply Phase 1" -- "$PGURL/$DB" --single-transaction -v ON_ERROR_STOP=1 -q -f "$PHASE1"
echo "   OK"

echo "== 3. matrix: post (denials + compatibility + truth table + catalog assertions) =="
run_psql "post matrix" -notices -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -v phase=post -f "$TESTS/rls_phase1_matrix.sql"
echo "   OK"

if [ -n "${RLS_SELFTEST_FAIL:-}" ]; then
  echo "== SELF-TEST: injecting a failing statement through the normal success path =="
  printf 'DO $$ BEGIN RAISE EXCEPTION %s; END $$;\n' "'injected unexpected matrix failure'" > "$WORKDIR/inject.sql"
  run_psql "injected failure" -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$WORKDIR/inject.sql"
  echo "UNREACHABLE: the injected failure did not abort the script"
  exit 1
fi

echo "== 4. rollback SQL restores the original topology =="
run_psql "rollback SQL" -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROLLBACK"
RESTORED=$(psql "$PGURL/$DB" -Atc "SELECT (SELECT count(*) FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Access' AND cmd='ALL')::text || ',' || ((SELECT qual FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Access') IS NOT DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='using'))::text || ',' || ((SELECT with_check FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Access') IS NOT DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='check'))::text || ',' || (SELECT count(*) FROM pg_policies WHERE tablename='calls')::text;")
if [ "$RESTORED" != "1,true,true,2" ]; then echo "‼ ROLLBACK FAILED: $RESTORED"; exit 1; fi
echo "   OK (original ALL policy + peer read restored, expressions byte-identical)"

echo "== 5. explicit BEGIN → migration → ROLLBACK leaves zero residue =="
TOPOLOGY_SQL="SELECT md5(string_agg(policyname||'|'||cmd||'|'||permissive||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' ORDER BY policyname)) FROM pg_policies WHERE tablename='calls';"
BEFORE=$(psql "$PGURL/$DB" -Atc "$TOPOLOGY_SQL")
{ echo "BEGIN;"; cat "$PHASE1"; echo "ROLLBACK;"; } > "$WORKDIR/wrapped.sql"
run_psql "wrapped apply+rollback" -- "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$WORKDIR/wrapped.sql"
AFTER=$(psql "$PGURL/$DB" -Atc "$TOPOLOGY_SQL")
if [ "$BEFORE" != "$AFTER" ]; then echo "‼ RESIDUE DETECTED after transactional rollback"; exit 1; fi
echo "   OK"

echo "== 6. atomicity: a mid-migration failure under --single-transaction changes nothing =="
# The migration file is NOT modified: a failing statement is appended to a COPY of it, so the failure
# lands AFTER every policy statement and COMMENT — exactly the case that must roll back completely.
{ cat "$PHASE1"; printf "\nDO \$\$ BEGIN RAISE EXCEPTION 'injected post-DDL failure'; END \$\$;\n"; } > "$WORKDIR/phase1_failing.sql"
expect_psql_failure "mid-migration failure" -- \
  "$PGURL/$DB" --single-transaction -v ON_ERROR_STOP=1 -q -f "$WORKDIR/phase1_failing.sql"
AFTER_FAIL=$(psql "$PGURL/$DB" -Atc "$TOPOLOGY_SQL")
if [ "$BEFORE" != "$AFTER_FAIL" ]; then
  echo "‼ ATOMICITY FAILED: the original two-policy topology did not survive a mid-migration failure"; exit 1
fi
POLICY_COUNT=$(psql "$PGURL/$DB" -Atc "SELECT count(*) FROM pg_policies WHERE tablename='calls';")
if [ "$POLICY_COUNT" != "2" ]; then echo "‼ ATOMICITY FAILED: policy count is $POLICY_COUNT, expected 2"; exit 1; fi
echo "   OK (original ALL + peer-read policies intact, no command-specific residue)"

echo "== 7. migration is fail-closed (second apply aborts) =="
run_psql "first apply" -- "$PGURL/$DB" --single-transaction -v ON_ERROR_STOP=1 -q -f "$PHASE1"
expect_psql_failure "second apply" -- "$PGURL/$DB" --single-transaction -v ON_ERROR_STOP=1 -q -f "$PHASE1"
echo "   OK"

echo "ALL RLS PHASE 1 CHECKS GREEN"
