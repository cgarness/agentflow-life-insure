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
# plus, for the Policies Sold source fix (20260930120000, implementation_plan.md §20 rev 2):
#   P1. the policy regression suite (supabase/tests/reports_policy_facts.sql: P0, A-K, J, R)
#   P2. NEGATIVE CONTROLS — reverted COUNT(wins) (summary, volume), dropped additional policies, dropped
#       evidence rule, issueDate fallback removed, conflicting-campaign guard removed, scope widened
#   P3. policy migration DRIFT and REPLAY refusal
#   P4. FAIL-CLOSED RECOVERY — the preimage fixture refuses while Reports is enabled; after DISABLE it
#       restores the win-based bodies but every get_report_* stays client-disabled; ENABLE refuses the
#       win-based bodies; re-applying the forward migration keeps Reports disabled; ENABLE then succeeds
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
FIXTURES="$ROOT/supabase/tests/reports_fixtures.sql"
VISIBILITY_SUITE="$ROOT/supabase/tests/reports_campaign_visibility.sql"
MIG="$ROOT/supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20260929152553_reports_secure_scoped_rpcs.rollback.sql"
# The Policies Sold source fix (plan §20). Applied after $MIG in every build, as in production.
POLICY_MIG="$ROOT/supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql"
POLICY_FIXTURE="$ROOT/supabase/migrations/rollback/20260930120000_reports_policies_sold_normalized_source.rollback.sql"
POLICY_SUITE="$ROOT/supabase/tests/reports_policy_facts.sql"
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
    block(downline_mig, "CREATE OR REPLACE FUNCTION private.profile_parse_iso_date(p_raw text)"),
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
       "REVOKE ALL ON FUNCTION private.resolve_downline_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;",
       "REVOKE ALL ON FUNCTION private.profile_parse_iso_date(text) FROM PUBLIC, anon, authenticated;"]
for name in legacy:
    sig = f"public.{name}(uuid, timestamptz, timestamptz, uuid)"
    # Production ACL, read 2026-09-28: {postgres=X, anon=X, authenticated=X, service_role=X}.
    acl.append(f"REVOKE ALL ON FUNCTION {sig} FROM PUBLIC;")
    acl.append(f"GRANT EXECUTE ON FUNCTION {sig} TO anon, authenticated, service_role;")
open(out, "w", encoding="utf-8").write("\n".join(parts) + "\n" + "\n".join(acl) + "\n")
PY

build() {   # build <dbname> [migration-file [policy-migration-file | none]]
  local db="$1" mig="${2:-}" pmig="${3:-$POLICY_MIG}"
  DBS+=("$db")
  psql "$PGURL/postgres" -qc "CREATE DATABASE $db;"
  psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$WORK/deps.sql"
  if [ -n "$mig" ]; then
    psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q --single-transaction -f "$mig"
    if [ "$pmig" != "none" ]; then
      psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q --single-transaction -f "$pmig"
    fi
  fi
}

# Shared fatal setup step; also exercised by the injected fixture failure probe below.
load_report_fixtures() {
  local db_url="$1" fixture="$2"
  psql "$db_url" -v ON_ERROR_STOP=1 -q --single-transaction -f "$fixture" || return $?
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

# The base negative controls (2a-2f) mutate bodies the policy migration fingerprints, so its preflight
# would (correctly) refuse them. For those builds ONLY, a copy of the policy migration with the md5
# preflight comparison switched off is used; 2f's campaign mutation is carried into that copy too,
# because the policy migration re-creates get_report_campaign_performance from the audited body.
python3 - "$POLICY_MIG" "$WORK/policy_neg.sql" "$WORK/policy_neg_campaign.sql" <<'PYN'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
old = "    IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> v_md5 THEN\n"
if src.count(old) != 1: sys.exit("policy_neg: md5 preflight anchor not found")
neg = src.replace(old, "    IF false THEN\n")
open(sys.argv[2], "w", encoding="utf-8").write(neg)
c_old = "count(DISTINCT f.campaign_lead_id) FILTER (WHERE f.is_converting) AS converted_leads"
c_new = "count(DISTINCT f.converted_key) FILTER (WHERE f.is_converting) AS converted_leads"
if neg.count(c_old) != 1: sys.exit("policy_neg: campaign anchor not found")
open(sys.argv[3], "w", encoding="utf-8").write(neg.replace(c_old, c_new))
PYN

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
echo; echo "== P1. Policies Sold regression suite (normalized stored policies) =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$POLICY_SUITE"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$VISIBILITY_SUITE"

# ── 2. Negative controls ─────────────────────────────────────────────────────────────────────────
echo; echo "== 2a. negative control: No Answer exclusion removed (T8 must fire) =="
sed "s/= 'no answer' THEN false/= 'no-answer-mutated' THEN false/" "$MIG" > "$WORK/mig_neg_contacted.sql"
if cmp -s "$MIG" "$WORK/mig_neg_contacted.sql"; then echo "FAIL: mutation 2a did not apply"; exit 1; fi
DB_NEG1="reports_rpc_neg1_$SUFFIX"
build "$DB_NEG1" "$WORK/mig_neg_contacted.sql" "$WORK/policy_neg.sql"
expect_fail "mutated Contacted rule" "T3 contacted FAIL: got \[5\] want \[4\]" psql "$PGURL/$DB_NEG1" -v ON_ERROR_STOP=1 -q -f "$SUITE"

echo; echo "== 2b. negative control: agent-narrowing guard removed (authorization tests must fire) =="
sed "s/ELSIF NOT (p_agent_id = ANY (v_ids)) THEN/ELSIF false THEN/" "$MIG" > "$WORK/mig_neg_scope.sql"
if cmp -s "$MIG" "$WORK/mig_neg_scope.sql"; then echo "FAIL: mutation 2b did not apply"; exit 1; fi
DB_NEG2="reports_rpc_neg2_$SUFFIX"
build "$DB_NEG2" "$WORK/mig_neg_scope.sql" "$WORK/policy_neg.sql"
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
build "$DB_NEG3" "$WORK/mig_neg_converted.sql" "$WORK/policy_neg.sql"
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
build "$DB_NEG4" "$WORK/mig_neg_zone.sql" "$WORK/policy_neg.sql"
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
build "$DB_NEG5" "$WORK/mig_neg_fallback.sql" "$WORK/policy_neg.sql"
expect_fail "Converted without campaign-lead fallback" "T14 NULL-contact fallbacks (campaign lead once, each call once) FAIL: got \[5\] want \[4\]" \
  psql "$PGURL/$DB_NEG5" -v ON_ERROR_STOP=1 -q -f "$SUITE"

echo; echo "== 2f. negative control: Campaign Performance counts people, not campaign leads (T14 must fire) =="
mutate "$WORK/mig_neg_campaign.sql" \
  "count(DISTINCT f.campaign_lead_id) FILTER (WHERE f.is_converting) AS converted_leads" \
  "count(DISTINCT f.converted_key) FILTER (WHERE f.is_converting) AS converted_leads"
DB_NEG6="reports_rpc_neg6_$SUFFIX"
build "$DB_NEG6" "$WORK/mig_neg_campaign.sql" "$WORK/policy_neg_campaign.sql"
expect_fail "campaign converted leads counted as people" "T14 April C1 converted leads = campaign leads, not people FAIL: got \[2\] want \[1\]" \
  psql "$PGURL/$DB_NEG6" -v ON_ERROR_STOP=1 -q -f "$SUITE"

# ── P2. Policy negative controls: each mutated policy migration MUST fail the policy suite ────────
pmutate() {   # pmutate <out> <old> <new> [<old> <new> ...] : exact single-occurrence replacements
  python3 - "$POLICY_MIG" "$@" <<'PYM'
import sys
src, out, pairs = open(sys.argv[1], encoding="utf-8").read(), sys.argv[2], sys.argv[3:]
for old, new in zip(pairs[0::2], pairs[1::2]):
    if src.count(old) != 1: sys.exit(f"policy mutation did not apply: {old[:70]}")
    src = src.replace(old, new)
open(out, "w", encoding="utf-8").write(src)
PYM
}
# The migration's own postcondition refuses a body that reads public.wins or skips the policy facts, so
# the COUNT(wins) reversions also neutralise those two checks: the point is to prove the SUITE catches
# a reversion that got past the migration.
POST_WINS="LIKE '%public.wins%'"
POST_OFF="LIKE '%mutation-postcondition-disabled%'"
POST_FACTS="NOT LIKE '%private.report_policy_facts%'"
POST_FACTS_OFF="NOT LIKE '%'"
run_policy_neg() {   # run_policy_neg <tag> <label> <needle> <mutated-file>
  local db="reports_rpc_p$1_$SUFFIX"
  build "$db" "$MIG" "$4"
  # Setup is independent of assertions and MUST succeed, even for intentionally broken implementations.
  load_report_fixtures "$PGURL/$db" "$FIXTURES"
  expect_fail "$2" "$3" psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -f "$POLICY_SUITE"
}

echo; echo "== P2a. negative control: summary reverted to COUNT(wins) =="
pmutate "$WORK/pneg_sum_wins.sql" \
"    SELECT pf.agent_id
      FROM private.report_policy_facts(v_access.org_id, v_access.agent_ids) pf
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
" \
"    SELECT wn.agent_id
      FROM public.wins wn
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
" "$POST_WINS" "$POST_OFF" "$POST_FACTS" "$POST_FACTS_OFF"
run_policy_neg a "summary COUNT(wins)" "B manual client: valid primary, NO win = 1 policy FAIL: got \[0\] want \[1\]" "$WORK/pneg_sum_wins.sql"

echo; echo "== P2b. negative control: volume (policies chart) reverted to wins by created_at =="
pmutate "$WORK/pneg_vol_wins.sql" \
"    SELECT pf.sold_date AS local_date
      FROM private.report_policy_facts(v_access.org_id, v_access.agent_ids) pf
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
" \
"    SELECT (wn.created_at AT TIME ZONE v_win.time_zone)::date AS local_date
      FROM public.wins wn
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
" "$POST_WINS" "$POST_OFF" "$POST_FACTS" "$POST_FACTS_OFF"
run_policy_neg b "volume COUNT(wins)" "B manual client on the policies chart (09-05) FAIL: got \[0\] want \[1\]" "$WORK/pneg_vol_wins.sql"

echo; echo "== P2c. negative control: additional policies dropped =="
pmutate "$WORK/pneg_no_additional.sql" \
"  SELECT ap.client_id, ap.agent_id, ap.source, ap.sold_date FROM additional_policies ap;" \
"  SELECT ap.client_id, ap.agent_id, ap.source, ap.sold_date FROM additional_policies ap WHERE false;"
run_policy_neg c "additional policies dropped" "C one client: 1 primary + 2 additional, ONE win = 3 policies FAIL: got \[1\] want \[3\]" "$WORK/pneg_no_additional.sql"

echo; echo "== P2d. negative control: evidence rule dropped (every client row is a policy) =="
pmutate "$WORK/pneg_no_evidence.sql" \
"        OR sc.sold_date   IS NOT NULL
  ),
  additional_policies AS (" \
"        OR sc.sold_date   IS NOT NULL
        OR true
  ),
  additional_policies AS ("
run_policy_neg d "evidence rule dropped" "D import-default client -> 0 policies FAIL: got \[1\] want \[0\]" "$WORK/pneg_no_evidence.sql"

echo; echo "== P2e. negative control: legacy issueDate fallback removed =="
pmutate "$WORK/pneg_no_issuedate.sql" \
"             coalesce(e.entry ->> 'soldDate', e.entry ->> 'issueDate')" \
"             e.entry ->> 'soldDate'"
run_policy_neg e "issueDate fallback removed" "D/E/H undated policies (scope-wide, all time): PE2 x2 + PH x1 FAIL: got \[4\] want \[3\]" "$WORK/pneg_no_issuedate.sql"

echo; echo "== P2f. negative control: conflicting-campaign guard removed =="
pmutate "$WORK/pneg_conflict.sql" \
"            AND pg_catalog.count(DISTINCT w.campaign_id) = 1
" ""
run_policy_neg f "conflicting campaigns attributed" "K C1 attributed (PA 1 + PC primary + 2 additional) FAIL" "$WORK/pneg_conflict.sql"

echo; echo "== P2g. negative control: policy scope widened (agent_ids ignored) =="
pmutate "$WORK/pneg_scope.sql" \
"     WHERE c.organization_id = p_org
       AND (p_agent_ids IS NULL OR c.assigned_agent_id = ANY (p_agent_ids))
  ),
  primary_policies AS (" \
"     WHERE c.organization_id = p_org
  ),
  primary_policies AS ("
run_policy_neg g "policy scope widened" "I own scope = own policies only FAIL" "$WORK/pneg_scope.sql"

# Fixture failure control: a bad SQL statement must fail setup BEFORE a downstream test marker.
echo; echo "== P2h. fixture setup failures are fatal =="
DB_FIXTURE="reports_fixture_refusal_$SUFFIX"
build "$DB_FIXTURE" "$MIG"
{ printf '%s\n' 'SELECT missing_reports_fixture_function();'; cat "$FIXTURES"; } > "$WORK/broken_fixtures.sql"
declare -f load_report_fixtures > "$WORK/fixture_loader.sh"
cat > "$WORK/seed_probe.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
source "$4"
load_report_fixtures "$1" "$2"
printf 'UNEXPECTED_DOWNSTREAM_EXECUTION' > "$3"
SH
expect_fail "broken fixture must fail before assertions" "missing_reports_fixture_function" \
  bash "$WORK/seed_probe.sh" "$PGURL/$DB_FIXTURE" "$WORK/broken_fixtures.sql" "$WORK/downstream" "$WORK/fixture_loader.sh"
[ ! -e "$WORK/downstream" ] || { echo "FAIL: fixture error reached mutation assertions"; exit 1; }
[ "$(psql "$PGURL/$DB_FIXTURE" -tAc "SELECT count(*) FROM public.organizations")" = "0" ] \
  || { echo "FAIL: fixture transaction did not remain empty"; exit 1; }

# Mutating the shared campaign visibility predicate must expose the private-campaign regression.
echo; echo "== P2i. campaign visibility guard is behaviorally required =="
pmutate "$WORK/pneg_visibility.sql" \
  "OR (upper(btrim(c.type)) = 'PERSONAL' AND c.user_id = v_actor.uid)" \
  "OR (upper(btrim(c.type)) = 'PERSONAL')"
DB_VIS_NEG="reports_visibility_negative_$SUFFIX"
build "$DB_VIS_NEG" "$MIG" "$WORK/pneg_visibility.sql"
psql "$PGURL/$DB_VIS_NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$FIXTURES"
expect_fail "private campaign visibility regression" "V1 private campaign id withheld FAIL" \
  psql "$PGURL/$DB_VIS_NEG" -v ON_ERROR_STOP=1 -q -f "$VISIBILITY_SUITE"

# ── P3. Policy migration drift + replay refusal ──────────────────────────────────────────────────
echo; echo "== P3a. policy drift refusal: a changed summary body aborts the policy migration atomically =="
DB_PDRIFT="reports_rpc_pdrift_$SUFFIX"
build "$DB_PDRIFT" "$MIG" none
psql "$PGURL/$DB_PDRIFT" -v ON_ERROR_STOP=1 -q -c "
  DO \$d\$ DECLARE v text; BEGIN
    SELECT prosrc INTO v FROM pg_proc WHERE oid = 'public.get_report_call_summary(date,date,uuid)'::regprocedure;
    EXECUTE format('CREATE OR REPLACE FUNCTION public.get_report_call_summary(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS %L', v || E'\n-- drift');
  END \$d\$;"
expect_fail "drifted summary body" "no longer matches the audited production body" \
  psql "$PGURL/$DB_PDRIFT" -v ON_ERROR_STOP=1 -q --single-transaction -f "$POLICY_MIG"
[ "$(psql "$PGURL/$DB_PDRIFT" -tAc "SELECT count(*) FROM pg_proc WHERE proname LIKE 'report\_policy\_%'")" = "0" ] \
  || { echo "FAIL: policy drift abort left helpers behind"; exit 1; }
echo "   OK (nothing applied)"

echo; echo "== P3b. policy replay refusal =="
state_md5() {
  psql "$PGURL/$1" -tAc "SELECT md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text,''), ',' ORDER BY n.nspname, p.proname, p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'report\_%');"
}
PBEFORE=$(state_md5 "$DB")
expect_fail "second policy apply" "refusing replay" psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$POLICY_MIG"
[ "$PBEFORE" = "$(state_md5 "$DB")" ] || { echo "FAIL: policy replay attempt changed function state"; exit 1; }
echo "   OK (function state unchanged)"

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
BEFORE=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text,''), ',' ORDER BY n.nspname, p.proname, p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'report\_%' OR p.proname LIKE 'rpc\_report\_%');")
expect_fail "second apply" "refusing replay" psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
AFTER=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text,''), ',' ORDER BY n.nspname, p.proname, p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'report\_%' OR p.proname LIKE 'rpc\_report\_%');")
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
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$POLICY_SUITE" | tail -1
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$VISIBILITY_SUITE" | tail -1

# ── P4. Fail-closed recovery (implementation_plan.md §20.11.4) ──────────────────────────────────
client_exec_reports() {   # number of (get_report_* fn, client role) pairs with EXECUTE
  psql "$PGURL/$1" -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
    WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%' AND has_function_privilege(r.role, p.oid, 'EXECUTE');"
}
body_md5() {   # body_md5 <db> <fn>
  psql "$PGURL/$1" -tAc "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.$2(date,date,uuid)'::regprocedure;"
}
authed_summary() {   # an authenticated Admin's summary call (O1 ADMIN), exactly as PostgREST would make it
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -tA -c "
    BEGIN;
    SELECT set_config('request.jwt.claims', json_build_object('sub', '11000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
      'app_metadata', json_build_object('organization_id', '10000000-0000-0000-0000-000000000001'))::text, true) IS NULL;
    SET LOCAL ROLE authenticated;
    SELECT 'policies_sold=' || (public.get_report_call_summary('2026-09-01', '2026-09-29', NULL) -> 'totals' ->> 'policies_sold');
    COMMIT;"
}
echo; echo "== P4. fail-closed recovery =="
expect_fail "preimage fixture while Reports is enabled" "Reports must be DISABLED first" \
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$POLICY_FIXTURE"
POLICY_SUMMARY_MD5="$(body_md5 "$DB" get_report_call_summary)"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$DISABLE"
[ "$(client_exec_reports "$DB")" = "0" ] || { echo "FAIL: disable left a get_report_* client-executable"; exit 1; }
# Old AND new frontends receive the same platform refusal, which both map to "Reports unavailable".
expect_fail "authenticated call while disabled" "permission denied for function get_report_call_summary" authed_summary
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$POLICY_FIXTURE"
[ "$(body_md5 "$DB" get_report_call_summary)" = "f221e1d470fc70ec92937be66be56e69" ] || { echo "FAIL: fixture did not restore the summary preimage"; exit 1; }
[ "$(body_md5 "$DB" get_report_call_volume)" = "604abca3774fc10daa2c86faa9ff7524" ] || { echo "FAIL: fixture did not restore the volume preimage"; exit 1; }
[ "$(body_md5 "$DB" get_report_campaign_performance)" = "9d151bf9ce31bd602af8317f2dd8e124" ] || { echo "FAIL: fixture did not restore the campaign preimage"; exit 1; }
[ "$(client_exec_reports "$DB")" = "0" ] || { echo "FAIL: win-based bodies are client-executable"; exit 1; }
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: legacy unsealed during recovery"; exit 1; }
expect_fail "authenticated call on restored win-based bodies" "permission denied for function get_report_call_summary" authed_summary
echo "   OK (win-based bodies restored ONLY behind a disabled Reports; no client can read them)"
expect_fail "enable while the win-based bodies are installed" "is not the verified normalized-policy implementation" \
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ENABLE"
[ "$(client_exec_reports "$DB")" = "0" ] || { echo "FAIL: a refused enable granted something"; exit 1; }
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$POLICY_MIG"
[ "$(client_exec_reports "$DB")" = "0" ] || { echo "FAIL: re-applying the forward migration re-enabled Reports"; exit 1; }
[ "$(body_md5 "$DB" get_report_call_summary)" = "$POLICY_SUMMARY_MD5" ] || { echo "FAIL: forward re-apply body differs"; exit 1; }
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ENABLE"
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: legacy unsealed after re-enable"; exit 1; }
authed_summary | grep -qx 'policies_sold=17' || { echo "FAIL: re-enabled Reports did not return the stored-policy total"; exit 1; }
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$POLICY_SUITE" | tail -1
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$VISIBILITY_SUITE" | tail -1
echo "   OK (disable -> fixture, still disabled -> enable refused -> forward re-apply, still disabled -> enable -> 17 policies)"

# ── 6. Rollback proof ────────────────────────────────────────────────────────────────────────────
echo; echo "== 6. rollback (fail-closed) =="
DATA_BEFORE=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
  SELECT 'calls:' || count(*) t FROM calls UNION ALL SELECT 'wins:' || count(*) FROM wins UNION ALL
  SELECT 'profiles:' || count(*) FROM profiles UNION ALL SELECT 'rp:' || md5(string_agg(permissions::text, ',' ORDER BY id)) FROM role_permissions) x;")
expect_fail "base rollback while the policy helpers exist" "report objects remain" \
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ROLLBACK"
# The approved order: disable, then the policy preimage fixture, then (only if ever needed) the base rollback.
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$DISABLE"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$POLICY_FIXTURE"
# Simulate someone having re-granted a legacy function: rollback must re-seal it, never keep it.
psql "$PGURL/$DB" -q -c "GRANT EXECUTE ON FUNCTION public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid) TO authenticated;"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ROLLBACK"
[ "$(count_report_objects "$DB")" = "0" ] || { echo "FAIL: rollback left report objects"; exit 1; }
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: rollback left legacy client-executable"; exit 1; }
DATA_AFTER=$(psql "$PGURL/$DB" -tAc "SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
  SELECT 'calls:' || count(*) t FROM calls UNION ALL SELECT 'wins:' || count(*) FROM wins UNION ALL
  SELECT 'profiles:' || count(*) FROM profiles UNION ALL SELECT 'rp:' || md5(string_agg(permissions::text, ',' ORDER BY id)) FROM role_permissions) x;")
[ "$DATA_BEFORE" = "$DATA_AFTER" ] || { echo "FAIL: rollback changed data"; exit 1; }
if grep -Eqi "grant[[:space:]]+execute[^;]*rpc_report" "$ROLLBACK" "$DISABLE" "$ENABLE" "$POLICY_FIXTURE" "$POLICY_MIG"; then
  echo "FAIL: a recovery script contains a GRANT on a legacy rpc_report_* function"; exit 1
fi
echo "   OK (objects dropped; legacy re-sealed, never re-granted; data unchanged)"
echo "   re-apply after rollback succeeds (rollback is a clean inverse of the new objects):"
# A plain command (not an && list) so a failed re-apply stops the run under `set -e`.
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$MIG"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$POLICY_MIG"
[ "$(count_report_objects "$DB")" = "18" ] || { echo "FAIL: re-apply after rollback did not recreate all 18 report functions"; exit 1; }
[ "$(legacy_client_exec "$DB")" = "0" ] || { echo "FAIL: legacy client-executable after re-apply"; exit 1; }
echo "   OK"

echo
echo "======================================================================"
echo " ALL REPORTS RPC PROOFS PASSED (suite + 6 negative controls + drift +"
echo " replay + disable/enable + rollback) AND POLICY PROOFS (P1 suite, P2 7"
echo " negative controls, P3 drift/replay, P4 fail-closed recovery)."
echo " Databases dropped. Nothing hosted was touched."
echo "======================================================================"
