#!/usr/bin/env bash
# =====================================================================================================
# Group leaderboard appointment-attribution suite runner — DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres:<pw>@127.0.0.1:5432" ./scripts/run_group_leaderboard_tests.sh
#
# Builds throwaway databases from supabase/tests/group_leaderboard_harness.sql plus the functions extracted
# VERBATIM from the baseline migration (production ACL re-created), and proves:
#   1. the suite passes after the migration is applied in ONE transaction (as apply_migration does)
#   2. NEGATIVE CONTROL — the same suite FAILS on the pre-migration (assignee-credit) function
#   3. DRIFT refusal  — a changed body, or a changed ACL, makes the migration abort with nothing applied
#   4. REPLAY refusal — a second apply aborts with nothing changed
#   5. ROLLBACK proof — the rollback restores the exact pre-migration definition; a second rollback refuses
#   6. PRE-EXISTING DEFECT — under production's plpgsql.variable_conflict = 'error', the function raises 42702
#      (ambiguous organization_id) both before AND after the migration; 6b qualifies ONLY that reference in a copy
#      and re-runs T1-T8 under 'error', proving the migrated attribution query adds no name clash of its own
# Every database is dropped on exit. Nothing here touches a hosted project.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres:pw@127.0.0.1:5432}"
# The runner appends "/<dbname>", so a query string or a second '@' could redirect the host or swallow the name;
# libpq environment overrides could redirect the host too. Refuse all of them outright.
case "$PGURL" in
  *'?'*|*@*@*) echo "REFUSING: PGURL must be scheme://user[:pw]@host:port with no query string (AGENT_RULES invariant #28)"; exit 2 ;;
esac
for v in PGHOST PGHOSTADDR PGSERVICE PGSERVICEFILE PGDATABASE; do
  if [ -n "${!v:-}" ]; then echo "REFUSING: unset $v — it can override the host or database in PGURL"; exit 2; fi
done
PGHOST_PART="$(printf '%s' "$PGURL" | sed -E 's#^[a-z]+://##; s#^.*@##; s#[:/].*$##')"
case "$PGHOST_PART" in
  127.0.0.1|localhost) ;;
  *) echo "REFUSING: PGURL host must be 127.0.0.1 or localhost, got '$PGHOST_PART' (AGENT_RULES invariant #28)"; exit 2 ;;
esac

echo "== locality proof =="
echo "   PGURL host component: $PGHOST_PART"
psql "$PGURL/postgres" -tAc \
  "SELECT 'server=' || coalesce(inet_server_addr()::text, 'local-socket') || ' version=' || current_setting('server_version');"
if psql "$PGURL/postgres" -tAc "SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin', 'authenticator', 'supabase_auth_admin') LIMIT 1" | grep -q 1; then
  echo "REFUSING: this cluster has Supabase platform roles — it looks like a hosted project"; exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/supabase/tests/group_leaderboard_harness.sql"
SUITE="$ROOT/supabase/tests/group_leaderboard_rpc.sql"
MIG="$ROOT/supabase/migrations/20260929160000_group_leaderboard_appointment_setter_credit.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20260929160000_group_leaderboard_appointment_setter_credit.rollback.sql"
BASELINE="$ROOT/supabase/migrations/20260806000000_baseline_production_schema.sql"
PRE_MD5="e1283b5b05d295c1d25888485cc08346"
POST_MD5="e69bbcf6a9f47457a44c887cb4418aef"

WORK="$(mktemp -d)"
SUFFIX="$$"
DBS=()
cleanup() {
  for d in "${DBS[@]:-}"; do
    [ -n "$d" ] && psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── Verbatim extraction from the baseline, with the production ACL (read 2026-09-29) ──────────────────
python3 - "$BASELINE" "$WORK/deps.sql" <<'PY'
import sys
baseline, out = sys.argv[1:3]
src = open(baseline, encoding="utf-8").read()
def block(header):
    i = src.find(header)
    if i < 0:
        sys.exit(f"extract: header not found: {header}")
    j = src.find("\n$$;", i)
    if j < 0:
        sys.exit(f"extract: terminator not found after {header}")
    return src[i:j + 4] + "\n"
parts = [
    block('CREATE OR REPLACE FUNCTION "public"."get_org_id"()'),
    block('CREATE OR REPLACE FUNCTION "public"."get_agency_group_leaderboard"('),
    # Production ACL {=X, postgres=X, anon=X, authenticated=X, service_role=X}: PUBLIC keeps its default EXECUTE.
    "GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(uuid, text) TO anon, authenticated, service_role;",
]
open(out, "w", encoding="utf-8").write("\n".join(parts) + "\n")
PY

build() {   # build <dbname> [migration-file]
  local db="$1" mig="${2:-}"
  DBS+=("$db")
  psql "$PGURL/postgres" -qc "CREATE DATABASE $db;"
  [ "$(psql "$PGURL/$db" -tAc 'SELECT current_database()')" = "$db" ] || { echo "REFUSING: connected to the wrong database"; exit 2; }
  psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$WORK/deps.sql"
  if [ -n "$mig" ]; then
    psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q --single-transaction -f "$mig"
  fi
}

defmd5() {   # defmd5 <db>
  psql "$PGURL/$1" -tAc "SELECT md5(pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure));"
}

expect_fail() {   # expect_fail <label> <must-contain> <command...>
  local label="$1" needle="$2"; shift 2
  set +e
  local out; out=$("$@" 2>&1); local rc=$?
  set -e
  if [ $rc -eq 0 ]; then echo "FAIL [$label]: expected failure, got success"; echo "$out" | tail -20; exit 1; fi
  if ! printf '%s' "$out" | grep -q -- "$needle"; then
    echo "FAIL [$label]: failed, but without [$needle]"; echo "$out" | tail -20; exit 1
  fi
  echo "   OK ($label refused: $needle)"
}

# ── 0. The extracted function is the production preimage ──────────────────────────────────────────────
echo "== 0. preimage =="
build "gl_pre_$SUFFIX"
[ "$(defmd5 "gl_pre_$SUFFIX")" = "$PRE_MD5" ] || { echo "FAIL: extracted definition is not the production preimage"; exit 1; }
echo "   OK (definition md5 $PRE_MD5)"

# ── 1. Suite passes after the migration ───────────────────────────────────────────────────────────────
echo "== 1. suite after migration =="
build "gl_main_$SUFFIX" "$MIG"
[ "$(defmd5 "gl_main_$SUFFIX")" = "$POST_MD5" ] || { echo "FAIL: post-image md5 mismatch"; exit 1; }
psql "$PGURL/gl_main_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"
echo "   OK (suite passed; definition md5 $POST_MD5)"

# ── 2. Negative control: the suite must fail on the assignee-credit function ─────────────────────────
echo "== 2. negative control =="
expect_fail "pre-migration suite" "T1/T3/T4/T5 setter A appointments_set" \
  psql "$PGURL/gl_pre_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"

# ── 3. Drift refusal (body, ACL) ─────────────────────────────────────────────────────────────────────
echo "== 3. drift refusal =="
build "gl_drift_$SUFFIX"
psql "$PGURL/gl_drift_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "DO \$d\$ DECLARE d text := pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure); BEGIN EXECUTE replace(d, 'ORDER BY policies_sold DESC, calls_made DESC', 'ORDER BY policies_sold DESC, calls_made DESC, agent_id'); END \$d\$;"
drifted="$(defmd5 "gl_drift_$SUFFIX")"
expect_fail "drifted body" "definition changed" \
  psql "$PGURL/gl_drift_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_drift_$SUFFIX")" = "$drifted" ] || { echo "FAIL: drift refusal changed the function"; exit 1; }
build "gl_acl_$SUFFIX"
psql "$PGURL/gl_acl_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "REVOKE EXECUTE ON FUNCTION public.get_agency_group_leaderboard(uuid, text) FROM anon;"
expect_fail "drifted ACL" "owner or ACL changed" \
  psql "$PGURL/gl_acl_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_acl_$SUFFIX")" = "$PRE_MD5" ] || { echo "FAIL: ACL refusal changed the function"; exit 1; }

# ── 4. Replay refusal ────────────────────────────────────────────────────────────────────────────────
echo "== 4. replay refusal =="
expect_fail "replay" "definition changed" \
  psql "$PGURL/gl_main_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_main_$SUFFIX")" = "$POST_MD5" ] || { echo "FAIL: replay changed the function"; exit 1; }

# ── 5. Rollback ──────────────────────────────────────────────────────────────────────────────────────
echo "== 5. rollback =="
build "gl_rb_$SUFFIX" "$MIG"
psql "$PGURL/gl_rb_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ROLLBACK"
[ "$(defmd5 "gl_rb_$SUFFIX")" = "$PRE_MD5" ] || { echo "FAIL: rollback did not restore the preimage"; exit 1; }
[ "$(psql "$PGURL/gl_rb_$SUFFIX" -tAc "SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_agency_group_leaderboard(uuid,text)'::regprocedure")" \
  = "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}" ] \
  || { echo "FAIL: rollback changed the ACL"; exit 1; }
echo "   OK (rollback restored $PRE_MD5 with the production ACL)"
expect_fail "rollback replay" "not the setter-credit version" \
  psql "$PGURL/gl_rb_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ROLLBACK"
expect_fail "suite after rollback" "T1/T3/T4/T5 setter A appointments_set" \
  psql "$PGURL/gl_rb_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"

# ── 6. Pre-existing ambiguity under the production setting, before and after ─────────────────────────
echo "== 6. pre-existing 42702 under plpgsql.variable_conflict = error (unchanged by the migration) =="
CALL_AS_MEMBER="SET plpgsql.variable_conflict = error; SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"a0000000-0000-4000-8000-00000000000a\",\"app_metadata\":{\"organization_id\":\"10000000-0000-4000-8000-000000000001\"}}', false); SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');"
expect_fail "production setting, pre-migration" "is ambiguous" \
  psql "$PGURL/gl_pre_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "$CALL_AS_MEMBER"
expect_fail "production setting, post-migration" "is ambiguous" \
  psql "$PGURL/gl_main_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "$CALL_AS_MEMBER"
build "gl_qual_$SUFFIX" "$MIG"
psql "$PGURL/gl_qual_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "DO \$q\$ DECLARE d text := pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure); n text := E'      AND organization_id = v_caller_org\\n'; BEGIN IF (length(d) - length(replace(d, n, ''))) / length(n) <> 1 THEN RAISE EXCEPTION 'membership reference not unique'; END IF; EXECUTE replace(d, n, E'      AND agency_group_members.organization_id = v_caller_org\\n'); END \$q\$;"
psql "$PGURL/gl_qual_$SUFFIX" -v ON_ERROR_STOP=1 -q -v conflict_mode=error -v skip_body_pin=1 -f "$SUITE"
echo "   OK (6b: with only the membership reference qualified, T1-T8 pass under variable_conflict = error)"

echo "== ALL GROUP LEADERBOARD CHECKS PASSED =="
