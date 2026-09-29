#!/usr/bin/env bash
# =====================================================================================================
# Group leaderboard repair suite runner — DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres:<pw>@127.0.0.1:5432" ./scripts/run_group_leaderboard_tests.sh
#
# Builds throwaway databases from supabase/tests/group_leaderboard_harness.sql plus the functions extracted
# VERBATIM from the baseline migration (production ACL re-created), and proves, for
# supabase/migrations/20260929215047_group_leaderboard_repair_membership_setter_credit.sql:
#   1. the suite passes after the migration (applied in ONE transaction, as apply_migration does), under
#      production's plpgsql.variable_conflict = error with no workaround; EXECUTE is hardened to
#      {postgres, authenticated, service_role}
#   2. NEGATIVE CONTROLS — the suite FAILS on the pre-repair function (42702), on a copy carrying only the 42702
#      fix (assignee credit), and on a repaired copy whose PUBLIC/anon EXECUTE was left open
#   3. DRIFT refusal  — a changed body, a changed ACL (incl. hardening done by hand), or an existing index name
#      aborts with nothing applied
#   4. REPLAY refusal — a second apply aborts with nothing changed
#   5. ROLLBACK proof — the exact pre-repair definition and the exact production ACL (element order included) come
#      back, the index is dropped; rollback replay refuses; the forward migration then re-applies cleanly
#   6. ACCESS DIFFERENTIAL — every membership decision, roster, period and non-appointment metric is identical
#      between the pre-repair function (read as intended) and the repaired one
#   7. INDEX PROOF — on 600k appointments the setter lookup uses appointments_setter_created_at_idx (EXPLAIN
#      ANALYZE BUFFERS + auto_explain of the RPC's own plan), with the regression shown without the index
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
TESTS="$ROOT/supabase/tests"
HARNESS="$TESTS/group_leaderboard_harness.sql"
SEED="$TESTS/group_leaderboard_seed.sql"
SUITE="$TESTS/group_leaderboard_rpc.sql"
MATRIX="$TESTS/group_leaderboard_access_matrix.sql"
PERF_DATA="$TESTS/group_leaderboard_perf_data.sql"
INDEX_PROOF="$TESTS/group_leaderboard_index_proof.sql"
MIG="$ROOT/supabase/migrations/20260929215047_group_leaderboard_repair_membership_setter_credit.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20260929215047_group_leaderboard_repair_membership_setter_credit.rollback.sql"
BASELINE="$ROOT/supabase/migrations/20260806000000_baseline_production_schema.sql"
PRE_MD5="e1283b5b05d295c1d25888485cc08346"
POST_MD5="8bd49ee01e0b92abd3e66548569f36bb"
PROD_ACL="{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"
HARD_ACL="{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"
QUALIFY_ONLY="DO \$q\$ DECLARE d text := pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure); n text := E'      AND organization_id = v_caller_org\\n'; BEGIN IF (length(d) - length(replace(d, n, ''))) / length(n) <> 1 THEN RAISE EXCEPTION 'membership reference not unique'; END IF; EXECUTE replace(d, n, E'      AND agency_group_members.organization_id = v_caller_org\\n'); END \$q\$;"

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

q() { psql "$PGURL/$1" -tAc "$2"; }
defmd5() { q "$1" "SELECT md5(pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure));"; }
acl() { q "$1" "SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_agency_group_leaderboard(uuid,text)'::regprocedure;"; }
setter_index() { q "$1" "SELECT coalesce(to_regclass('public.appointments_setter_created_at_idx')::text, 'absent');"; }

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
[ "$(acl "gl_pre_$SUFFIX")" = "$PROD_ACL" ] || { echo "FAIL: harness ACL is not the production ACL"; exit 1; }
echo "   OK (definition md5 $PRE_MD5, production ACL)"

# ── 1. Suite passes after the migration, under variable_conflict = error ─────────────────────────────
echo "== 1. suite after migration (plpgsql.variable_conflict = error) =="
build "gl_main_$SUFFIX" "$MIG"
[ "$(defmd5 "gl_main_$SUFFIX")" = "$POST_MD5" ] || { echo "FAIL: post-image md5 mismatch"; exit 1; }
[ "$(acl "gl_main_$SUFFIX")" = "$HARD_ACL" ] || { echo "FAIL: post-repair ACL is not $HARD_ACL"; exit 1; }
psql "$PGURL/gl_main_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"
echo "   OK (suite passed; definition md5 $POST_MD5; ACL $HARD_ACL)"

# ── 2. Negative controls ─────────────────────────────────────────────────────────────────────────────
echo "== 2. negative controls =="
expect_fail "pre-repair function" "is ambiguous" \
  psql "$PGURL/gl_pre_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"
build "gl_qual_$SUFFIX"
psql "$PGURL/gl_qual_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "$QUALIFY_ONLY"
expect_fail "42702 fix only (assignee credit)" "T1/T3/T4/T5 setter A appointments_set" \
  psql "$PGURL/gl_qual_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"
build "gl_open_$SUFFIX" "$MIG"
psql "$PGURL/gl_open_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) TO PUBLIC, anon;"
expect_fail "repaired but PUBLIC/anon EXECUTE left open" "T8g anon cannot EXECUTE" \
  psql "$PGURL/gl_open_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"

# ── 3. Drift refusal (body, ACL, existing index name) ────────────────────────────────────────────────
echo "== 3. drift refusal =="
build "gl_drift_$SUFFIX"
psql "$PGURL/gl_drift_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "DO \$d\$ DECLARE d text := pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure); BEGIN EXECUTE replace(d, 'ORDER BY policies_sold DESC, calls_made DESC', 'ORDER BY policies_sold DESC, calls_made DESC, agent_id'); END \$d\$;"
drifted="$(defmd5 "gl_drift_$SUFFIX")"
expect_fail "drifted body" "definition changed" \
  psql "$PGURL/gl_drift_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_drift_$SUFFIX")" = "$drifted" ] && [ "$(setter_index "gl_drift_$SUFFIX")" = "absent" ] \
  || { echo "FAIL: drift refusal changed something"; exit 1; }
build "gl_acl_$SUFFIX"
psql "$PGURL/gl_acl_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "REVOKE EXECUTE ON FUNCTION public.get_agency_group_leaderboard(uuid, text) FROM anon;"
expect_fail "drifted ACL" "owner or ACL changed" \
  psql "$PGURL/gl_acl_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_acl_$SUFFIX")" = "$PRE_MD5" ] && [ "$(setter_index "gl_acl_$SUFFIX")" = "absent" ] \
  || { echo "FAIL: ACL refusal changed something"; exit 1; }
build "gl_acl2_$SUFFIX"
psql "$PGURL/gl_acl2_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "REVOKE EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) FROM PUBLIC;"
acl_before="$(acl "gl_acl2_$SUFFIX")"
expect_fail "EXECUTE hardened by hand first" "owner or ACL changed" \
  psql "$PGURL/gl_acl2_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_acl2_$SUFFIX")" = "$PRE_MD5" ] && [ "$(acl "gl_acl2_$SUFFIX")" = "$acl_before" ] && [ "$(setter_index "gl_acl2_$SUFFIX")" = "absent" ] \
  || { echo "FAIL: hand-hardening refusal changed something"; exit 1; }
build "gl_idx_$SUFFIX"
psql "$PGURL/gl_idx_$SUFFIX" -v ON_ERROR_STOP=1 -q -c "CREATE INDEX appointments_setter_created_at_idx ON public.appointments (user_id);"
expect_fail "existing index name" "already exists" \
  psql "$PGURL/gl_idx_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_idx_$SUFFIX")" = "$PRE_MD5" ] || { echo "FAIL: index-name refusal changed the function"; exit 1; }

# ── 4. Replay refusal ────────────────────────────────────────────────────────────────────────────────
echo "== 4. replay refusal =="
expect_fail "replay" "definition changed" \
  psql "$PGURL/gl_main_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_main_$SUFFIX")" = "$POST_MD5" ] && [ "$(acl "gl_main_$SUFFIX")" = "$HARD_ACL" ] || { echo "FAIL: replay changed something"; exit 1; }

# ── 5. Rollback ──────────────────────────────────────────────────────────────────────────────────────
echo "== 5. rollback =="
build "gl_rb_$SUFFIX" "$MIG"
psql "$PGURL/gl_rb_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ROLLBACK"
[ "$(defmd5 "gl_rb_$SUFFIX")" = "$PRE_MD5" ] || { echo "FAIL: rollback did not restore the preimage"; exit 1; }
[ "$(acl "gl_rb_$SUFFIX")" = "$PROD_ACL" ] || { echo "FAIL: rollback did not restore the exact production ACL"; acl "gl_rb_$SUFFIX"; exit 1; }
[ "$(setter_index "gl_rb_$SUFFIX")" = "absent" ] || { echo "FAIL: rollback left the index"; exit 1; }
[ "$(q "gl_rb_$SUFFIX" "SELECT has_function_privilege('anon', 'public.get_agency_group_leaderboard(uuid,text)'::regprocedure, 'EXECUTE')")" = "t" ] \
  || { echo "FAIL: rollback did not restore anon EXECUTE"; exit 1; }
echo "   OK (rollback restored $PRE_MD5, the exact production ACL $PROD_ACL, and dropped the index)"
expect_fail "rollback replay" "not the repaired version" \
  psql "$PGURL/gl_rb_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ROLLBACK"
expect_fail "suite after rollback" "is ambiguous" \
  psql "$PGURL/gl_rb_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$SUITE"
psql "$PGURL/gl_rb_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(defmd5 "gl_rb_$SUFFIX")" = "$POST_MD5" ] && [ "$(acl "gl_rb_$SUFFIX")" = "$HARD_ACL" ] && [ "$(setter_index "gl_rb_$SUFFIX")" != "absent" ] \
  || { echo "FAIL: the forward migration did not re-apply cleanly after the rollback"; exit 1; }
echo "   OK (after the rollback the forward migration re-applies cleanly)"

# ── 6. Access differential ───────────────────────────────────────────────────────────────────────────
echo "== 6. access differential (pre-repair read as intended vs repaired under production settings) =="
build "gl_dpre_$SUFFIX"
build "gl_dpost_$SUFFIX" "$MIG"
for d in gl_dpre gl_dpost; do
  psql "$PGURL/${d}_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$SEED"
done
psql "$PGURL/gl_dpre_$SUFFIX"  -v ON_ERROR_STOP=1 -q -v conflict_mode=use_column -f "$MATRIX" 2>&1 | grep -o 'MATRIX .*' > "$WORK/matrix_pre.txt"
psql "$PGURL/gl_dpost_$SUFFIX" -v ON_ERROR_STOP=1 -q -v conflict_mode=error      -f "$MATRIX" 2>&1 | grep -o 'MATRIX .*' > "$WORK/matrix_post.txt"
[ "$(wc -l < "$WORK/matrix_post.txt")" -eq 13 ] || { echo "FAIL: expected 13 matrix lines"; cat "$WORK/matrix_post.txt"; exit 1; }
diff "$WORK/matrix_pre.txt" "$WORK/matrix_post.txt" || { echo "FAIL: access/roster/metrics differ between pre-repair and repaired"; exit 1; }
[ "$(grep -c '| ok |' "$WORK/matrix_post.txt")" -eq 9 ] && [ "$(grep -c '| P0001 | Access denied' "$WORK/matrix_post.txt")" -eq 4 ] \
  || { echo "FAIL: unexpected access outcomes"; cat "$WORK/matrix_post.txt"; exit 1; }
sed 's/^/   /' "$WORK/matrix_post.txt"
echo "   OK (13 authenticated scenarios identical: 9 allowed, 4 denied by the membership check)"

# ── 7. Index proof on large data ─────────────────────────────────────────────────────────────────────
echo "== 7. index proof (600k appointments, 120-profile roster) =="
build "gl_perf_$SUFFIX"
psql "$PGURL/gl_perf_$SUFFIX" -v ON_ERROR_STOP=1 -q -f "$PERF_DATA" >/dev/null
psql "$PGURL/gl_perf_$SUFFIX" -qc "VACUUM ANALYZE;"
psql "$PGURL/gl_perf_$SUFFIX" -v ON_ERROR_STOP=1 -q -v phase=before -f "$INDEX_PROOF" >/dev/null
psql "$PGURL/gl_perf_$SUFFIX" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
psql "$PGURL/gl_perf_$SUFFIX" -qc "VACUUM ANALYZE public.appointments;"
psql "$PGURL/gl_perf_$SUFFIX" -v ON_ERROR_STOP=1 -q -v phase=after -f "$INDEX_PROOF" 2>&1 | grep -v '^$' | sed 's/^psql:[^ ]* //; s/^/   /'
# The RPC's OWN plan (plpgsql caches a generic plan after five executions): auto_explain of the nested query.
psql "$PGURL/gl_perf_$SUFFIX" -v ON_ERROR_STOP=1 -q > "$WORK/auto_explain.txt" 2>&1 <<'SQL'
LOAD 'auto_explain';
SET auto_explain.log_min_duration = 0;
SET auto_explain.log_nested_statements = on;
SET auto_explain.log_level = notice;
SET plpgsql.variable_conflict = error;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000003e9","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000001"}}', false);
SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
SELECT count(*) FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
SQL
uses="$(grep -c 'using appointments_setter_created_at_idx on appointments' "$WORK/auto_explain.txt" || true)"
seqs="$(grep -c 'Seq Scan on appointments' "$WORK/auto_explain.txt" || true)"
[ "$uses" -ge 7 ] && [ "$seqs" -eq 0 ] \
  || { echo "FAIL: the RPC's own plan does not use the setter index (uses=$uses seq=$seqs)"; grep -n 'appointments' "$WORK/auto_explain.txt" | head -20; exit 1; }
echo "   OK (auto_explain: all 7 RPC executions, custom and cached generic plans, use appointments_setter_created_at_idx; 0 seq scans)"

echo "== ALL GROUP LEADERBOARD CHECKS PASSED =="
