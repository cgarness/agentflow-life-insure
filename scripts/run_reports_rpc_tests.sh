#!/usr/bin/env bash
# =====================================================================================================
# Reports RPC suite runner — DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres:<pw>@127.0.0.1:5432" ./scripts/run_reports_rpc_tests.sh
#
# Builds throwaway databases from supabase/tests/reports_harness.sql plus the dependency functions
# extracted VERBATIM from the repository migrations, applies the migration under test in ONE
# transaction (as apply_migration does), and runs:
#   1. the behaviour + authorization suite (supabase/tests/reports_rpc.sql)
#   2. six NEGATIVE CONTROLS the suite MUST reject — proof the assertions bite: a broken Contacted
#      rule, a removed agent-narrowing guard, a campaign-lead-first Converted identity, a silent default
#      agency time zone, a Converted identity without its campaign-lead fallback, and Campaign
#      Performance counting people instead of campaign leads
#   3. DRIFT refusal  — a changed legacy body makes the migration abort with nothing applied
#   4. REPLAY refusal — a second apply aborts with nothing changed
#   5. ROLLBACK proof — new objects dropped, legacy seal re-asserted (never re-granted), data unchanged
#   6. DISABLE / ENABLE proof — the emergency switch and its inverse, legacy sealed throughout
# Every database is dropped on exit. Nothing here touches a hosted project.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres:pw@127.0.0.1:5432}"
# The HOST component exactly (scheme and userinfo stripped, then up to ':' or '/'), never a substring
# match: a password or path containing "localhost" must not pass.
PGHOST_PART="$(printf '%s' "$PGURL" | sed -E 's#^[a-z]+://##; s#^.*@##; s#[:/].*$##')"
case "$PGHOST_PART" in
  127.0.0.1|localhost) ;;
  *) echo "REFUSING: PGURL host must be 127.0.0.1 or localhost, got '$PGHOST_PART' (AGENT_RULES invariant #28)"; exit 2 ;;
esac

echo "== locality proof =="
echo "   PGURL host component: $PGHOST_PART"
psql "$PGURL/postgres" -tAc \
  "SELECT 'server=' || coalesce(inet_server_addr()::text, 'local-socket') || ' version=' || current_setting('server_version');"
# Backstop for a tunnel or port-forward to a hosted project: every Supabase cluster has these roles; a
# disposable local cluster (and the CI service container) has none of them.
if psql "$PGURL/postgres" -tAc "SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin', 'authenticator', 'supabase_auth_admin') LIMIT 1" | grep -q 1; then
  echo "REFUSING: this cluster has Supabase platform roles — it looks like a hosted project"; exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/supabase/tests/reports_harness.sql"
SUITE="$ROOT/supabase/tests/reports_rpc.sql"
MIG="$ROOT/supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20260929152553_reports_secure_scoped_rpcs.rollback.sql"
DISABLE="$ROOT/supabase/ops/reports_disable.sql"
ENABLE="$ROOT/supabase/ops/reports_enable.sql"
BASELINE="$ROOT/supabase/migrations/20260806000000_baseline_production_schema.sql"
ACTOR_MIG="$ROOT/supabase/migrations/20260811200920_campaign_leads_membership_uniqueness_and_attachment_core.sql"
DOWNLINE_MIG="$ROOT/supabase/migrations/20260919183544_profile_book_and_team_stats_rpcs.sql"

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

# ── Verbatim dependency extraction ────────────────────────────────────────────────────────────────
python3 - "$BASELINE" "$ACTOR_MIG" "$DOWNLINE_MIG" "$WORK/deps.sql" <<'PY'
import sys
baseline, actor_mig, downline_mig, out = sys.argv[1:5]

def block(path, header):
    src = open(path, encoding="utf-8").read()
    i = src.find(header)
    if i < 0:
        sys.exit(f"extract: header not found in {path}: {header}")
    j = src.find("\n$$;", i)
    if j < 0:
        sys.exit(f"extract: terminator not found after {header}")
    return src[i:j + 4] + "\n"

parts = [
    block(baseline, 'CREATE OR REPLACE FUNCTION "public"."get_org_id"()'),
    block(actor_mig, "CREATE OR REPLACE FUNCTION private.campaign_actor()"),
    block(downline_mig, "CREATE OR REPLACE FUNCTION private.resolve_downline_ids(p_root uuid, p_org uuid)"),
]
legacy = [
    "rpc_report_call_summary",
    "rpc_report_call_volume_timeseries",
    "rpc_report_campaign_performance",
    "rpc_report_disposition_breakdown",
]
for name in legacy:
    parts.append(block(baseline, f'CREATE OR REPLACE FUNCTION "public"."{name}"('))

acl = ["REVOKE ALL ON FUNCTION private.campaign_actor() FROM PUBLIC, anon, authenticated;",
       "REVOKE ALL ON FUNCTION private.resolve_downline_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;"]
for name in legacy:
    sig = f"public.{name}(uuid, timestamptz, timestamptz, uuid)"
    # Production ACL, read 2026-09-28: {postgres=X, anon=X, authenticated=X, service_role=X}.
    acl.append(f"REVOKE ALL ON FUNCTION {sig} FROM PUBLIC;")
    acl.append(f"GRANT EXECUTE ON FUNCTION {sig} TO anon, authenticated, service_role;")
open(out, "w", encoding="utf-8").write("\n".join(parts) + "\n" + "\n".join(acl) + "\n")
PY

build() {   # build <dbname> [migration-file]
  local db="$1" mig="${2:-}"
  DBS+=("$db")
  psql "$PGURL/postgres" -qc "CREATE DATABASE $db;"
  psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$WORK/deps.sql"
  if [ -n "$mig" ]; then
    psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q --single-transaction -f "$mig"
  fi
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

count_report_objects() {   # count_report_objects <db>
  psql "$PGURL/$1" -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname LIKE 'get\_report\_%') OR (n.nspname = 'private' AND p.proname LIKE 'report\_%');"
}

legacy_client_exec() {   # legacy_client_exec <db>  -> number of (legacy fn, client role) pairs with EXECUTE
  psql "$PGURL/$1" -tAc "SELECT count(*) FROM (VALUES
      ('public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)'),
      ('public.rpc_report_call_volume_timeseries(uuid,timestamptz,timestamptz,uuid)'),
      ('public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid)'),
      ('public.rpc_report_disposition_breakdown(uuid,timestamptz,timestamptz,uuid)')) f(sig)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
    WHERE has_function_privilege(r.role, f.sig, 'EXECUTE');"
}

# ── 1. Main suite ────────────────────────────────────────────────────────────────────────────────
echo; echo "== 1. harness + dependencies + migration (single transaction) =="
DB="reports_rpc_test_$SUFFIX"
build "$DB" "$MIG"
echo "   OK"
echo; echo "== behaviour + authorization suite =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$SUITE"

# ── 2. Negative controls ─────────────────────────────────────────────────────────────────────────
echo; echo "== 2a. negative control: No Answer exclusion removed (T8 must fire) =="
sed "s/= 'no answer' THEN false/= 'no-answer-mutated' THEN false/" "$MIG" > "$WORK/mig_neg_contacted.sql"
if cmp -s "$MIG" "$WORK/mig_neg_contacted.sql"; then echo "FAIL: mutation 2a did not apply"; exit 1; fi
DB_NEG1="reports_rpc_neg1_$SUFFIX"
build "$DB_NEG1" "$WORK/mig_neg_contacted.sql"
expect_fail "mutated Contacted rule" "T3 contacted FAIL: got \[5\] want \[4\]" psql "$PGURL/$DB_NEG1" -v ON_ERROR_STOP=1 -q -f "$SUITE"

echo; echo "== 2b. negative control: agent-narrowing guard removed (authorization tests must fire) =="
sed "s/ELSIF NOT (p_agent_id = ANY (v_ids)) THEN/ELSIF false THEN/" "$MIG" > "$WORK/mig_neg_scope.sql"
if cmp -s "$MIG" "$WORK/mig_neg_scope.sql"; then echo "FAIL: mutation 2b did not apply"; exit 1; fi
DB_NEG2="reports_rpc_neg2_$SUFFIX"
build "$DB_NEG2" "$WORK/mig_neg_scope.sql"
expect_fail "removed narrowing guard" "T3 other agent FAIL" psql "$PGURL/$DB_NEG2" -v ON_ERROR_STOP=1 -q -f "$SUITE"

echo; echo "== 2c. negative control: Converted identity campaign-lead-first (T14 must fire) =="
python3 - "$MIG" "$WORK/mig_neg_converted.sql" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
old = "coalesce('contact:' || b.contact_id::text, 'campaign_lead:' || b.campaign_lead_id::text, 'call:' || b.id::text)"
new = "coalesce('campaign_lead:' || b.campaign_lead_id::text, 'contact:' || b.contact_id::text, 'call:' || b.id::text)"
if src.count(old) != 1: sys.exit("mutation 2c did not apply")
open(sys.argv[2], "w", encoding="utf-8").write(src.replace(old, new))
PY
DB_NEG3="reports_rpc_neg3_$SUFFIX"
build "$DB_NEG3" "$WORK/mig_neg_converted.sql"
expect_fail "campaign-lead-first Converted identity" "T14 same contact via two campaign leads = 1 converted FAIL: got \[2\] want \[1\]" \
  psql "$PGURL/$DB_NEG3" -v ON_ERROR_STOP=1 -q -f "$SUITE"

echo; echo "== 2d. negative control: silent America/Chicago default for an unconfigured zone (T6 must fire) =="
python3 - "$MIG" "$WORK/mig_neg_zone.sql" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
old = ("    RAISE EXCEPTION 'reports: the agency time zone is not configured'\n"
       "      USING ERRCODE = '55000', HINT = 'An admin must set the time zone in Settings > Company Branding.';\n")
new = "    RETURN QUERY SELECT 'America/Chicago'::text, 'agency_settings'::text;\n    RETURN;\n"
if src.count(old) != 1: sys.exit("mutation 2d did not apply")
open(sys.argv[2], "w", encoding="utf-8").write(src.replace(old, new))
PY
DB_NEG4="reports_rpc_neg4_$SUFFIX"
build "$DB_NEG4" "$WORK/mig_neg_zone.sql"
expect_fail "silent default zone" "T6 O2 unconfigured zone refuses the report FAIL" \
  psql "$PGURL/$DB_NEG4" -v ON_ERROR_STOP=1 -q -f "$SUITE"

mutate() {   # mutate <out> <old> <new> : exact, single-occurrence replacement or abort
  python3 - "$MIG" "$1" "$2" "$3" <<'PY'
import sys
src, out, old, new = open(sys.argv[1], encoding="utf-8").read(), sys.argv[2], sys.argv[3], sys.argv[4]
if src.count(old) != 1: sys.exit(f"mutation did not apply: {old[:60]}")
open(out, "w", encoding="utf-8").write(src.replace(old, new))
PY
}

echo; echo "== 2e. negative control: Converted without the campaign-lead fallback (T14 must fire) =="
mutate "$WORK/mig_neg_fallback.sql" \
  "coalesce('contact:' || b.contact_id::text, 'campaign_lead:' || b.campaign_lead_id::text, 'call:' || b.id::text)" \
  "coalesce('contact:' || b.contact_id::text, 'call:' || b.id::text)"
DB_NEG5="reports_rpc_neg5_$SUFFIX"
build "$DB_NEG5" "$WORK/mig_neg_fallback.sql"
expect_fail "Converted without campaign-lead fallback" "T14 NULL-contact fallbacks (campaign lead once, each call once) FAIL: got \[5\] want \[4\]" \
  psql "$PGURL/$DB_NEG5" -v ON_ERROR_STOP=1 -q -f "$SUITE"

echo; echo "== 2f. negative control: Campaign Performance counts people, not campaign leads (T14 must fire) =="
mutate "$WORK/mig_neg_campaign.sql" \
  "count(DISTINCT f.campaign_lead_id) FILTER (WHERE f.is_converting) AS converted_leads" \
  "count(DISTINCT f.converted_key) FILTER (WHERE f.is_converting) AS converted_leads"
DB_NEG6="reports_rpc_neg6_$SUFFIX"
build "$DB_NEG6" "$WORK/mig_neg_campaign.sql"
expect_fail "campaign converted leads counted as people" "T14 April C1 converted leads = campaign leads, not people FAIL: got \[2\] want \[1\]" \
  psql "$PGURL/$DB_NEG6" -v ON_ERROR_STOP=1 -q -f "$SUITE"

# ── 3. Drift refusal ─────────────────────────────────────────────────────────────────────────────
echo; echo "== 3. drift refusal: a changed legacy body aborts the migration atomically =="
DB_DRIFT="reports_rpc_drift_$SUFFIX"
build "$DB_DRIFT"
psql "$PGURL/$DB_DRIFT" -v ON_ERROR_STOP=1 -q -c "
  DO \$d\$ DECLARE v text; BEGIN
    SELECT prosrc INTO v FROM pg_proc WHERE oid = 'public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)'::regprocedure;
    EXECUTE format('CREATE OR REPLACE FUNCTION public.rpc_report_call_summary(p_org_id uuid, p_start_date timestamptz, p_end_date timestamptz, p_agent_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS %L', v || E'\n-- drift');
  END \$d\$;"
expect_fail "drifted legacy body" "no longer matches the audited production body" \
  psql "$PGURL/$DB_DRIFT" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(count_report_objects "$DB_DRIFT")" = "0" ] || { echo "FAIL: drift left report objects behind"; exit 1; }
[ "$(legacy_client_exec "$DB_DRIFT")" = "8" ] || { echo "FAIL: drift abort changed legacy ACLs (must be untouched)"; exit 1; }
echo "   OK (nothing applied; legacy ACL untouched)"

# ── 4. Replay refusal ────────────────────────────────────────────────────────────────────────────
echo; echo "== 4. replay refusal =="
BEFORE=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text,''), ',' ORDER BY 1)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'report\_%' OR p.proname LIKE 'rpc\_report\_%');")
expect_fail "second apply" "refusing replay" psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
AFTER=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text,''), ',' ORDER BY 1)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'report\_%' OR p.proname LIKE 'rpc\_report\_%');")
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: replay attempt changed function state"; exit 1; }
echo "   OK (function state unchanged)"

# ── 5. Disable / enable proof (on the suite database, fixtures present) ───────────────────────────
echo; echo "== 5. disable / enable =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$DISABLE"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -c "
  DO \$t\$ BEGIN
    IF has_function_privilege('authenticated', 'public.get_report_call_summary(date,date,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'DISABLE FAIL: authenticated can still execute'; END IF;
  END \$t\$;"
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: legacy unsealed after disable"; exit 1; }
# A client re-grant of legacy (simulated drift) must be re-sealed by enable, never kept.
psql "$PGURL/$DB" -q -c "GRANT EXECUTE ON FUNCTION public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid) TO anon;"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ENABLE"
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: enable did not re-seal legacy"; exit 1; }
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -c "
  DO \$t\$ BEGIN
    IF NOT has_function_privilege('authenticated', 'public.get_report_call_summary(date,date,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_report_call_summary(date,date,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'ENABLE FAIL'; END IF;
  END \$t\$;"
echo "   OK (disable revokes; enable restores only the new RPCs and re-seals legacy)"
echo "   re-running the suite after enable:"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$SUITE" | tail -1

# ── 6. Rollback proof ────────────────────────────────────────────────────────────────────────────
echo; echo "== 6. rollback (fail-closed) =="
DATA_BEFORE=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
  SELECT 'calls:' || count(*) t FROM calls UNION ALL SELECT 'wins:' || count(*) FROM wins UNION ALL
  SELECT 'profiles:' || count(*) FROM profiles UNION ALL SELECT 'rp:' || md5(string_agg(permissions::text, ',' ORDER BY id)) FROM role_permissions) x;")
# Simulate someone having re-granted a legacy function: rollback must re-seal it, never keep it.
psql "$PGURL/$DB" -q -c "GRANT EXECUTE ON FUNCTION public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid) TO authenticated;"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ROLLBACK"
[ "$(count_report_objects "$DB")" = "0" ] || { echo "FAIL: rollback left report objects"; exit 1; }
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: rollback left legacy client-executable"; exit 1; }
DATA_AFTER=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
  SELECT 'calls:' || count(*) t FROM calls UNION ALL SELECT 'wins:' || count(*) FROM wins UNION ALL
  SELECT 'profiles:' || count(*) FROM profiles UNION ALL SELECT 'rp:' || md5(string_agg(permissions::text, ',' ORDER BY id)) FROM role_permissions) x;")
[ "$DATA_BEFORE" = "$DATA_AFTER" ] || { echo "FAIL: rollback changed data"; exit 1; }
if grep -Eqi "grant[[:space:]]+execute[^;]*rpc_report" "$ROLLBACK" "$DISABLE" "$ENABLE"; then
  echo "FAIL: a recovery script contains a GRANT on a legacy rpc_report_* function"; exit 1
fi
echo "   OK (objects dropped; legacy re-sealed, never re-granted; data unchanged)"
echo "   re-apply after rollback succeeds (rollback is a clean inverse of the new objects):"
# A plain command (not an && list) so a failed re-apply stops the run under `set -e`.
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
[ "$(count_report_objects "$DB")" = "14" ] || { echo "FAIL: re-apply after rollback did not recreate all 14 report functions"; exit 1; }
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: legacy client-executable after re-apply"; exit 1; }
echo "   OK"

echo
echo "======================================================================"
echo " ALL REPORTS RPC PROOFS PASSED (suite + 6 negative controls + drift +"
echo " replay + disable/enable + rollback). Databases dropped. Nothing hosted"
echo " was touched."
echo "======================================================================"
