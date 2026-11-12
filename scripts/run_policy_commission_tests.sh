#!/usr/bin/env bash
# Phase 2A policy commission tracking: every database proof on a DISPOSABLE localhost PostgreSQL cluster.
# Synthetic data only. Refuses anything but a loopback cluster without hosted platform roles.
#   PGURL=postgres://postgres@127.0.0.1:<port> bash scripts/run_policy_commission_tests.sh
# Optional: POSTGREST_BIN=/path/to/postgrest (12.2.3) adds the real PostgREST + supabase-js integration;
#           PC_MEASURE=1 adds the save-overhead measurement (scripts/tests/policy_commission/measure_save_overhead.sh)
#           and the commissions center read timing (measure_center_reads.sh; PC_CENTER_POLICIES, default 500).
# Steps: migration preimage/replay guards · ACL and ownership inventory diff · security, handoff and tracking suites ·
# expected-windows migration (20261020040000) guards, inventory and suite · commissions center reads (20261020212000)
# guards, drift refusal, inventory and suite · commissions insights and goals (20261021180000) guards, drift refusal,
# inventory, suite and the released center suite on the final state · independent-session races and lock contention · existing
# sale/identity/reporting suites with both migrations applied · non-destructive rollbacks, refusal and reapply.
# Scenarios run with both applied migrations (the production end state) unless marked otherwise.
set -euo pipefail
: "${PGURL:?Disposable localhost PostgreSQL cluster URL, without database path, required}"
python3 - "$PGURL" <<'PY'
import os, sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
if u.scheme not in ('postgres', 'postgresql') or u.hostname not in ('localhost', '127.0.0.1') or u.path not in ('', '/') or u.query or u.fragment:
    raise SystemExit('REFUSING: disposable localhost cluster required')
for key in ('PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGDATABASE', 'PGOPTIONS'):
    if os.environ.get(key):
        raise SystemExit('REFUSING: unset ' + key)
PY
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PYTHONDONTWRITEBYTECODE=1
ADMIN_URL="${PGURL%/}/postgres"
PREFIX="pc_test_$$"
TEMP=$(mktemp -d)
MIGRATION="$ROOT/supabase/migrations/20261019170000_policy_commission_tracking.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20261019170000_policy_commission_tracking.rollback.sql"
WINDOWS="$ROOT/supabase/migrations/20261020040000_policy_commission_expected_windows.sql"
WINDOWS_ROLLBACK="$ROOT/supabase/migrations/rollback/20261020040000_policy_commission_expected_windows.rollback.sql"
CENTER="$ROOT/supabase/migrations/20261020212000_policy_commission_center_reads.sql"
CENTER_ROLLBACK="$ROOT/supabase/migrations/rollback/20261020212000_policy_commission_center_reads.rollback.sql"
CENTER_HARNESS="$ROOT/supabase/tests/policy_commission_center_harness.sql"
INSIGHTS="$ROOT/supabase/migrations/20261021180000_policy_commission_center_insights.sql"
INSIGHTS_ROLLBACK="$ROOT/supabase/migrations/rollback/20261021180000_policy_commission_center_insights.rollback.sql"
DATABASES=()
drop_roles() {
  for role in agentflow_policy_commission_writer agentflow_comp_operator; do
    psql "$ADMIN_URL" -qX -c "DROP ROLE IF EXISTS $role" >/dev/null 2>&1 || true
  done
}
cleanup() {
  for db in "${DATABASES[@]}"; do psql "$ADMIN_URL" -qX -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true; done
  drop_roles
  rm -rf "$TEMP"
}
trap cleanup EXIT
if [ "$(psql "$ADMIN_URL" -tAX -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != 0 ]; then
  echo 'REFUSING hosted platform roles'; exit 2
fi
echo "PostgreSQL: $(psql "$ADMIN_URL" -tAX -c 'SHOW server_version')"
python3 "$ROOT/scripts/policy_commission_fixture.py" > "$TEMP/fixture.sql"

sql() { psql "$DB_URL" -qX -v ON_ERROR_STOP=1 "$@"; }
# new_db NAME [bare|applied]: a fresh database with the fixture and harness, then both migrations (default), only
# 20261019170000 (applied) or neither (bare). Roles are cluster-global, so the previous scenario's database and roles
# are removed first.
new_db() {
  for old_db in "${DATABASES[@]}"; do psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $old_db WITH (FORCE)" >/dev/null; done
  DATABASES=()
  drop_roles
  if [ "$(psql "$ADMIN_URL" -tAX -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('agentflow_policy_commission_writer','agentflow_comp_operator')")" != 0 ]; then
    echo 'REFUSING: a commission role is still used by another database in this cluster'; exit 2
  fi
  DB="${PREFIX}_$1"
  psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB" >/dev/null
  DATABASES+=("$DB")
  DB_URL="${PGURL%/}/$DB"
  sql -f "$TEMP/fixture.sql" >/dev/null
  if [ "${2:-}" != bare ]; then sql -1 -f "$MIGRATION" >/dev/null; fi
  if [ -z "${2:-}" ]; then sql -1 -f "$WINDOWS" >/dev/null; fi
}
# center_db NAME: both applied migrations, the center harness and 20261020212000.
center_db() { new_db "$1"; sql -f "$CENTER_HARNESS" >/dev/null; sql -1 -f "$CENTER" >/dev/null; }
# insights_db NAME: center_db plus 20261021180000 (the end state of this change).
insights_db() { center_db "$1"; sql -1 -f "$INSIGHTS" >/dev/null; }
run_suite() { sql -v defaults="$(cat "$ROOT/supabase/tests/fixtures/policy_commission/permission_defaults.json")" -f "$1" | grep -E '^ *PASS' ; }
expect_fail() { # expect_fail PATTERN FILE: the file must fail with an error matching PATTERN
  if sql -1 -f "$2" > "$TEMP/out" 2>&1; then echo "FAIL: $2 unexpectedly applied"; exit 1; fi
  grep -q "$1" "$TEMP/out" || { cat "$TEMP/out"; echo "FAIL: expected '$1'"; exit 1; }
}
# Inventory of every pre-existing function and relation: owner, definer flag, ACL and body digest.
inventory() {
  sql -tAX -c "SELECT 'f|' || p.oid::regprocedure || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|' || coalesce(p.proacl::text, '-')
                 || '|' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname IN ('public', 'private', 'auth', 'comp_authz') AND p.prokind = 'f'
                 AND p.proname NOT LIKE '%policy\_commission%' AND p.proname NOT LIKE '%\_handoff'
                 AND p.proname NOT IN ('policy_sale_commission_step', 'get_policy_sale_operation_status')
               UNION ALL
               SELECT 'r|' || c.oid::regclass || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || '|' || coalesce(c.relacl::text, '-')
                 || '|' || (SELECT coalesce(string_agg(polname || ':' || pg_get_expr(polqual, polrelid), ',' ORDER BY polname), '') FROM pg_policy WHERE polrelid = c.oid)
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'v', 'S') AND c.relname NOT LIKE 'policy\_commission\_%'
               UNION ALL
               SELECT 'n|' || nspname || '|' || coalesce(nspacl::text, '-') FROM pg_namespace WHERE nspname IN ('public', 'private', 'auth')
               ORDER BY 1"
}
# Every commission object: functions (owner, definer flag, ACL, body digest), constraints, columns (with column ACLs),
# table ACLs and schema ACLs.
commission_inventory() {
  sql -tAX -c "SELECT 'f|' || p.oid::regprocedure || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|' || coalesce(p.proacl::text, '-')
                 || '|' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname IN ('public', 'private', 'policy_commission_authz') AND p.prokind = 'f'
               UNION ALL
               SELECT 'c|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(oid) FROM pg_constraint
               WHERE conrelid::regclass::text LIKE 'policy\_commission\_%'
               UNION ALL
               SELECT 'a|' || attrelid::regclass || '|' || attname || '|' || format_type(atttypid, atttypmod) || '|' || attnotnull || '|'
                 || coalesce(attacl::text, '-') FROM pg_attribute
               WHERE attrelid::regclass::text LIKE 'policy\_commission\_%' AND attnum > 0 AND NOT attisdropped
               UNION ALL
               SELECT 'r|' || c.oid::regclass || '|' || coalesce(c.relacl::text, '-') FROM pg_class c WHERE c.relname LIKE 'policy\_commission\_%'
               UNION ALL
               SELECT 'n|' || nspname || '|' || coalesce(nspacl::text, '-') FROM pg_namespace WHERE nspname IN ('public', 'private')
               ORDER BY 1"
}

# ── 1. Guards, inventory, suites ─────────────────────────────────────────────────────────────────────────
new_db guards bare
sql -tAX -c "SELECT md5(pg_get_functiondef('private.campaign_actor()'::regprocedure))" | grep -qx f582e43731a968fb2e0961e80939ff7e \
  || { echo 'FAIL: fixture campaign_actor differs from the production preimage'; exit 1; }
# A writer whose body drifted from the reviewed preimage is refused; nothing is created.
sql -c "SELECT pg_get_functiondef('public.record_client_policy(uuid,uuid,jsonb,boolean)'::regprocedure)" -tAX > "$TEMP/record.sql"
python3 - "$TEMP/record.sql" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().rstrip() + ';\n'
s = s.replace("RAISE EXCEPTION 'Missing policy request'", "RAISE EXCEPTION 'Missing  policy request'", 1)
open(p, 'w').write(s)
PY
sql -f "$TEMP/record.sql" >/dev/null
expect_fail 'differs from the reviewed preimage' "$MIGRATION"
test "$(sql -tAX -c "SELECT count(*) FROM pg_roles WHERE rolname = 'agentflow_policy_commission_writer'")" = 0 || { echo 'FAIL: role leaked'; exit 1; }
new_db inventory bare
inventory > "$TEMP/inventory.before"
sql -1 -f "$MIGRATION" >/dev/null
inventory > "$TEMP/inventory.after"
# The only change to existing objects is the additive wins index (not part of this inventory) and USAGE on
# public/private for the writer role. An explicit owner-only ACL equals the default (NULL) ACL.
normalize() { sed -E 's/,?agentflow_policy_commission_writer=U\/[a-z_]+//; s/^n\|private\|\{postgres=UC\/postgres\}$/n|private|-/' "$1"; }
grep -E '^n\|(public|private)\|' "$TEMP/inventory.after" | grep -c 'agentflow_policy_commission_writer=U/' | grep -qx 2 \
  || { echo 'FAIL: unexpected schema grants'; exit 1; }
diff -u <(normalize "$TEMP/inventory.before") <(normalize "$TEMP/inventory.after") || { echo 'FAIL: existing objects changed'; exit 1; }
expect_fail 'already applied; refusing replay' "$MIGRATION"
echo "PASS migration guards and existing-object inventory ($(wc -l < "$TEMP/inventory.before") objects unchanged)"
for suite in security handoff; do
  new_db "$suite"
  run_suite "$ROOT/supabase/tests/policy_commission_$suite.sql"
done
# The applied 20261019170000 timing rules (confirmed month-level schedule only); 20261020040000 supersedes them and is
# proved by the expected-windows suite below.
new_db tracking applied
run_suite "$ROOT/supabase/tests/policy_commission_tracking.sql"

# ── 1b. Expected windows (20261020040000): guards, existing-object inventory, suite ─────────────────────────
new_db windows_guards bare
expect_fail 'requires 20261019170000' "$WINDOWS"
new_db windows_drift applied
# A replaced function that drifted from its 20261019170000 definition is refused; nothing is changed.
sql -c "SELECT pg_get_functiondef('public.get_client_policy_commissions(uuid)'::regprocedure)" -tAX > "$TEMP/read.sql"
python3 - "$TEMP/read.sql" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().rstrip() + ';\n'
s = s.replace("RAISE EXCEPTION 'Client not found'", "RAISE EXCEPTION 'Client  not found'", 1)
open(p, 'w').write(s)
PY
sql -f "$TEMP/read.sql" >/dev/null
expect_fail 'differs from the reviewed preimage' "$WINDOWS"
test -z "$(sql -tAX -c "SELECT to_regprocedure('private.policy_commission_expected_schedule(date,text)')")" || { echo 'FAIL: helper leaked'; exit 1; }
new_db windows_inventory applied
inventory > "$TEMP/inventory.before"
commission_inventory > "$TEMP/commission.before"
sql -1 -f "$WINDOWS" >/dev/null
inventory > "$TEMP/inventory.after"
commission_inventory > "$TEMP/commission.after"
diff -u "$TEMP/inventory.before" "$TEMP/inventory.after" || { echo 'FAIL: expected windows changed existing non-commission objects'; exit 1; }
# Replaced functions keep owner, definer flag and ACL; only their bodies change. Added: four writer-only helpers.
grep '^f|' "$TEMP/commission.before" | cut -d'|' -f1-5 | LC_ALL=C sort > "$TEMP/meta.before"
grep '^f|' "$TEMP/commission.after" | cut -d'|' -f1-5 | LC_ALL=C sort > "$TEMP/meta.after"
test "$(LC_ALL=C comm -23 "$TEMP/meta.before" "$TEMP/meta.after" | wc -l)" = 0 || { echo 'FAIL: a function lost its owner or ACL'; exit 1; }
ADDED=$(LC_ALL=C comm -13 "$TEMP/meta.before" "$TEMP/meta.after" | cut -d'|' -f2 | LC_ALL=C sort | tr '\n' ' ')
[ "$ADDED" = 'private.policy_commission_business_day_after(date,integer) private.policy_commission_expected_schedule(date,text) private.policy_commission_fed_holiday(date) private.policy_commission_iso_date(text) ' ] \
  || { echo "FAIL: unexpected new functions: $ADDED"; exit 1; }
LC_ALL=C comm -13 "$TEMP/meta.before" "$TEMP/meta.after" | grep -q 'agentflow_policy_commission_writer=X/postgres}$' || { echo 'FAIL: helper ACL'; exit 1; }
CHANGED=$(LC_ALL=C comm -13 <(grep '^f|' "$TEMP/commission.before" | LC_ALL=C sort) <(grep '^f|' "$TEMP/commission.after" | LC_ALL=C sort) | cut -d'|' -f2 \
  | grep -v -E '_(business_day_after|expected_schedule|fed_holiday|iso_date)\(' | LC_ALL=C sort | tr '\n' ' ')
[ "$CHANGED" = 'get_client_policy_commissions(uuid) private.policy_commission_estimate_state(uuid) private.policy_commission_guard() private.policy_commission_insert_estimate(uuid,uuid,jsonb,jsonb,jsonb,uuid,text,uuid,text,jsonb,text,text) private.policy_commission_policy_facts(uuid[]) record_policy_commission_estimate_later(uuid,uuid,jsonb,uuid,bigint,text) set_policy_commission_installment_timing(uuid,uuid,bigint,text,date) set_policy_commission_schedule_basis(uuid,uuid,bigint,date,text) ' ] \
  || { echo "FAIL: unexpected replaced functions: $CHANGED"; exit 1; }
expect_fail 'already applied; refusing replay' "$WINDOWS"
echo "PASS expected windows guards and inventory (8 bodies replaced, 4 writer-only helpers, $(wc -l < "$TEMP/inventory.before") other objects unchanged)"
new_db expected_windows
run_suite "$ROOT/supabase/tests/policy_commission_expected_windows.sql"

# ── 1c. Commissions center reads (20261020212000): guards, drift refusal, existing-object inventory, suite ────
new_db center_guards applied
sql -f "$CENTER_HARNESS" >/dev/null
expect_fail 'require 20261019170000 and 20261020040000' "$CENTER"
new_db center_drift
sql -f "$CENTER_HARNESS" >/dev/null
# An authorization function that drifted from its applied definition is refused; nothing is created.
sql -c "SELECT pg_get_functiondef('policy_commission_authz.access(uuid)'::regprocedure)" -tAX > "$TEMP/access.sql"
python3 - "$TEMP/access.sql" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().rstrip() + ';\n'
s = s.replace("IF p_agent IS NULL THEN RETURN NULL; END IF;", "IF p_agent IS NULL THEN RETURN NULL;  END IF;", 1)
open(p, 'w').write(s)
PY
sql -f "$TEMP/access.sql" >/dev/null
expect_fail 'differs from the reviewed preimage' "$CENTER"
test -z "$(sql -tAX -c "SELECT to_regnamespace('policy_commission_reporting')")" || { echo 'FAIL: reporting schema leaked'; exit 1; }
new_db center_inventory
sql -f "$CENTER_HARNESS" >/dev/null
inventory > "$TEMP/inventory.before"
commission_inventory > "$TEMP/commission.before"
sql -1 -f "$CENTER" >/dev/null
inventory > "$TEMP/inventory.after"
commission_inventory > "$TEMP/commission.after"
# Nothing existing changes: no line is removed or altered. Added: the five public reads (the general inventory's name
# filter omits get_my_policy_commission) and the two indexes on Phase 2A tables. The reporting schema's own helpers
# are checked by the suite.
test "$(LC_ALL=C comm -23 <(LC_ALL=C sort "$TEMP/inventory.before") <(LC_ALL=C sort "$TEMP/inventory.after") | wc -l)" = 0 \
  || { echo 'FAIL: the center reads changed an existing object'; exit 1; }
test "$(LC_ALL=C comm -23 <(LC_ALL=C sort "$TEMP/commission.before") <(LC_ALL=C sort "$TEMP/commission.after") | wc -l)" = 0 \
  || { echo 'FAIL: the center reads changed a commission object'; exit 1; }
ADDED=$(LC_ALL=C comm -13 <(LC_ALL=C sort "$TEMP/inventory.before") <(LC_ALL=C sort "$TEMP/inventory.after") | cut -d'|' -f2 | LC_ALL=C sort | tr '\n' ' ')
[ "$ADDED" = 'get_my_commission_installments(text,date,date,text,text,text,text,integer,integer) get_my_commission_overview(text,date,date) get_my_commission_policies(text,text,integer,integer) get_my_commission_receipts(text,date,date,boolean,integer,integer) ' ] \
  || { echo "FAIL: unexpected new objects: $ADDED"; exit 1; }
LC_ALL=C comm -13 <(LC_ALL=C sort "$TEMP/commission.before") <(LC_ALL=C sort "$TEMP/commission.after") > "$TEMP/commission.added"
ADDED=$(grep -E '^(f|r)\|' "$TEMP/commission.added" | cut -d'|' -f1-2 | LC_ALL=C sort | tr '\n' ' ')
[ "$ADDED" = 'f|get_my_commission_installments(text,date,date,text,text,text,text,integer,integer) f|get_my_commission_overview(text,date,date) f|get_my_commission_policies(text,text,integer,integer) f|get_my_commission_receipts(text,date,date,boolean,integer,integer) f|get_my_policy_commission(uuid) r|policy_commission_captures_agent_open r|policy_commission_receipts_agent_received ' ] \
  || { echo "FAIL: unexpected new commission objects: $ADDED"; exit 1; }
# Column lines appear only for the two new indexes and the two reporting row types; no constraint or schema line changes.
ADDED=$(grep -E '^a\|' "$TEMP/commission.added" | cut -d'|' -f2 | LC_ALL=C sort -u | tr '\n' ' ')
[ "$ADDED" = 'policy_commission_captures_agent_open policy_commission_receipts_agent_received policy_commission_reporting.installment_fact policy_commission_reporting.policy_fact ' ] \
  || { echo "FAIL: unexpected new commission columns: $ADDED"; exit 1; }
! grep -qvE '^(f|r|a)\|' "$TEMP/commission.added" || { echo 'FAIL: unexpected commission catalog lines'; exit 1; }
expect_fail 'already applied; refusing replay' "$CENTER"
echo "PASS commissions center guards and inventory (5 reads, 2 indexes, $(wc -l < "$TEMP/inventory.before") existing objects unchanged)"
center_db center
run_suite "$ROOT/supabase/tests/policy_commission_center.sql"

# ── 1d. Commissions insights and goals (20261021180000): guards, drift refusal, existing-object inventory, suites ─
new_db insights_guards
sql -f "$CENTER_HARNESS" >/dev/null
expect_fail 'require 20261020212000' "$INSIGHTS"
center_db insights_drift
# A reused reporting definition that drifted from its applied text is refused; nothing is created.
sql -c "SELECT pg_get_functiondef('policy_commission_reporting.viewer()'::regprocedure)" -tAX > "$TEMP/viewer.sql"
python3 - "$TEMP/viewer.sql" <<'PY2'
import sys
p = sys.argv[1]
s = open(p).read().rstrip() + ';\n'
s = s.replace("RAISE EXCEPTION 'Commission access is unavailable'", "RAISE EXCEPTION 'Commission access is  unavailable'", 1)
open(p, 'w').write(s)
PY2
sql -f "$TEMP/viewer.sql" >/dev/null
expect_fail 'differs from the reviewed preimage' "$INSIGHTS"
test -z "$(sql -tAX -c "SELECT to_regnamespace('policy_commission_insights')")$(sql -tAX -c "SELECT to_regclass('public.policy_commission_goals')")" \
  || { echo 'FAIL: insights objects leaked'; exit 1; }
center_db insights_inventory
inventory > "$TEMP/inventory.before"
commission_inventory > "$TEMP/commission.before"
sql -1 -f "$INSIGHTS" >/dev/null
inventory > "$TEMP/inventory.after"
commission_inventory > "$TEMP/commission.after"
# Nothing existing changes. Added: six public functions (the general inventory sees the three reads and three goal
# functions) and, in the commission catalog, the goals table with its columns, constraints and grants.
test "$(LC_ALL=C comm -23 <(LC_ALL=C sort "$TEMP/inventory.before") <(LC_ALL=C sort "$TEMP/inventory.after") | wc -l)" = 0 \
  || { echo 'FAIL: the insights migration changed an existing object'; exit 1; }
test "$(LC_ALL=C comm -23 <(LC_ALL=C sort "$TEMP/commission.before") <(LC_ALL=C sort "$TEMP/commission.after") | wc -l)" = 0 \
  || { echo 'FAIL: the insights migration changed a commission object'; exit 1; }
ADDED=$(LC_ALL=C comm -13 <(LC_ALL=C sort "$TEMP/inventory.before") <(LC_ALL=C sort "$TEMP/inventory.after") | cut -d'|' -f2 | LC_ALL=C sort | tr '\n' ' ')
[ "$ADDED" = 'clear_my_commission_goal(date) get_my_commission_breakdown(text,date,date) get_my_commission_goal(date) get_my_commission_policy_list(text,text,boolean,text,text,date,date,integer,integer) get_my_commission_receipt_list(text,date,date,boolean,text,boolean,integer,integer) set_my_commission_goal(date,bigint) ' ] \
  || { echo "FAIL: unexpected new objects: $ADDED"; exit 1; }
LC_ALL=C comm -13 <(LC_ALL=C sort "$TEMP/commission.before") <(LC_ALL=C sort "$TEMP/commission.after") > "$TEMP/commission.added"
ADDED=$(grep -E '^(f|r)\|' "$TEMP/commission.added" | cut -d'|' -f1-2 | LC_ALL=C sort | tr '\n' ' ')
[ "$ADDED" = 'f|clear_my_commission_goal(date) f|get_my_commission_breakdown(text,date,date) f|get_my_commission_goal(date) f|get_my_commission_policy_list(text,text,boolean,text,text,date,date,integer,integer) f|get_my_commission_receipt_list(text,date,date,boolean,text,boolean,integer,integer) f|set_my_commission_goal(date,bigint) r|policy_commission_goals r|policy_commission_goals_pkey ' ] \
  || { echo "FAIL: unexpected new commission objects: $ADDED"; exit 1; }
ADDED=$(grep -E '^(a|c)\|' "$TEMP/commission.added" | cut -d'|' -f2 | LC_ALL=C sort -u | tr '\n' ' ')
[ "$ADDED" = 'policy_commission_goals policy_commission_goals_pkey ' ] || { echo "FAIL: unexpected new commission columns: $ADDED"; exit 1; }
! grep -qvE '^(f|r|a|c)\|' "$TEMP/commission.added" || { echo 'FAIL: unexpected commission catalog lines'; exit 1; }
expect_fail 'already applied; refusing replay' "$INSIGHTS"
echo "PASS commissions insights guards and inventory (6 functions, goals table, $(wc -l < "$TEMP/inventory.before") existing objects unchanged)"
insights_db insights
run_suite "$ROOT/supabase/tests/policy_commission_insights.sql"
# The released center suite still passes with this migration applied (its reads and definitions are unchanged).
insights_db center_with_insights
run_suite "$ROOT/supabase/tests/policy_commission_center.sql"

# ── 2. Independent sessions: duplicate submissions, receipt vs replacement, first-policy edits, lock contention ──
new_db races
sql <<'SQL' >/dev/null
CREATE FUNCTION public.pc_delay_client() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.first_name IN ('Concurrent', 'Edit race') THEN PERFORM pg_sleep(0.4); END IF; RETURN NEW; END $$;
CREATE TRIGGER pc_delay_client BEFORE INSERT OR UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION public.pc_delay_client();
SQL
SAME="SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9001), test_id(1), pc_client('Concurrent', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))) - 'idempotent' - 'client';"
sql -tA -c "$SAME" > "$TEMP/one" & PID=$!
sql -tA -c "$SAME" > "$TEMP/two"
wait "$PID"
cmp "$TEMP/one" "$TEMP/two" || { echo 'FAIL: duplicate submissions differ'; cat "$TEMP/one" "$TEMP/two"; exit 1; }
sql -c "SELECT test_assert((SELECT count(*) FROM clients WHERE first_name = 'Concurrent') = 1 AND (SELECT count(*) FROM policy_commission_handoffs) = 1
          AND (SELECT count(*) FROM policy_commission_estimates) = 1, 'duplicate submissions: one sale, one evidence row, one estimate')" >/dev/null
# Receipt vs replacement: the replacement loaded revision 1, then a receipt committed first.
EST="(SELECT id FROM policy_commission_estimates LIMIT 1)"
INST="(SELECT id FROM policy_commission_installments WHERE kind = 'advance' LIMIT 1)"
sql -tA -c "SELECT pc_login(11); SET ROLE authenticated; BEGIN; SELECT record_policy_commission_receipt(test_id(9101), $INST, 100, current_date, NULL); SELECT pg_sleep(0.6); COMMIT;" >/dev/null & PID=$!
sleep 0.2
REPLACE="SELECT pc_login(11); SET ROLE authenticated; SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L, %L, %L, %L, 1, %L)', test_id(9102),
  (SELECT policy_id FROM policy_commission_estimates LIMIT 1), pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot',
  $EST, 'Race replacement'), 'PT409');"
sql -tA -c "$REPLACE" > "$TEMP/race"
wait "$PID"
sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_estimates WHERE status = 'active') = 1
          AND (SELECT count(*) FROM policy_commission_receipts) = 1, 'replacement waited for the receipt and was refused as stale')" >/dev/null
# Concurrent first-policy inline edits with different request ids: exactly one sale.
sql -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9200), test_id(1), pc_contact('Edit race', 11), false, NULL);" >/dev/null
EDIT="SELECT pc_login(11); SET ROLE authenticated; SELECT update_client_with_policy_sale_handoff('%s', (SELECT id FROM clients WHERE first_name = 'Edit race'),
  '{\"carrier\": \"Synthetic Life\", \"policy_type\": \"Term\", \"premium\": 50, \"policy_number\": \"ER-1\", \"sold_date\": \"2026-10-03\"}',
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)))->'commission'->>'status';"
sql -tA -c "$(printf "$EDIT" 00000000-0000-0000-0000-000000009201)" > "$TEMP/one" & PID=$!
sql -tA -c "$(printf "$EDIT" 00000000-0000-0000-0000-000000009202)" > "$TEMP/two"
wait "$PID"
sort "$TEMP/one" "$TEMP/two" | tr '\n' ' ' | grep -q 'evidence_recorded no_new_policy' || { echo 'FAIL: concurrent edits'; cat "$TEMP/one" "$TEMP/two"; exit 1; }
sql -c "SELECT test_assert((SELECT count(*) FROM wins w JOIN clients c ON c.id = w.contact_id WHERE c.first_name = 'Edit race') = 1,
          'concurrent first-policy edits: one sale')" >/dev/null
# Confirmation vs a later estimate for the same open capture, in both orders: they serialize per policy, the second
# is refused (22023), and the capture ends recorded (confirmation first) or superseded and linked (later estimate first).
sql <<'SQL' >/dev/null
INSERT INTO role_permissions(organization_id, role, permissions) VALUES (test_id(1), 'Team Leader',
  '{"c":[{"name":"View Own Commission Percentage","teamLeader":true},{"name":"View Others'' Commission Percentage","teamLeader":true}]}');
SQL
for FIRST in confirm later; do
  sql -tA -c "SELECT pc_login(14); SET ROLE authenticated; SELECT create_client_with_sale_handoff(gen_random_uuid(), test_id(1),
    pc_client('Race $FIRST', 11, '50.00'), true, pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));" >/dev/null
  POL="(SELECT primary_policy_id FROM clients WHERE first_name = 'Race $FIRST')"
  CONFIRM="SELECT confirm_policy_commission_capture(gen_random_uuid(), (SELECT id FROM policy_commission_captures WHERE policy_id = $POL))"
  LATER="SELECT record_policy_commission_estimate_later(gen_random_uuid(), $POL,
    pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot', NULL, NULL, NULL)"
  if [ "$FIRST" = confirm ]; then A="$CONFIRM"; B="$LATER"; MODE=sale_entry; CAPTURE=recorded; else A="$LATER"; B="$CONFIRM"; MODE=recorded_later; CAPTURE=superseded; fi
  sql -tA -c "SELECT pc_login(11); SET ROLE authenticated; BEGIN; $A; SELECT pg_sleep(0.6); COMMIT;" >/dev/null & PID=$!
  sleep 0.2
  sql -tA -c "SELECT pc_login(11); SET ROLE authenticated; SELECT pc_reject(\$q\$$B\$q\$, '22023');" >/dev/null
  wait "$PID"
  sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_estimates WHERE policy_id = $POL) = 1
            AND (SELECT capture_mode FROM policy_commission_estimates WHERE policy_id = $POL) = '$MODE'
            AND (SELECT c.status = '$CAPTURE' AND (c.resolved_by_estimate_id IS NOT NULL) = ('$CAPTURE' = 'superseded')
                   AND (c.resolved_by_estimate_id IS NULL OR c.resolved_by_estimate_id = (SELECT id FROM policy_commission_estimates WHERE policy_id = $POL))
                 FROM policy_commission_captures c WHERE c.policy_id = $POL),
            'confirmation vs later estimate ($FIRST first): one estimate, consistent capture')" >/dev/null
done
# Lock contention: commission work waits at most lock_timeout (100 ms), then the sale commits without it.
sql -tA -c "BEGIN; LOCK TABLE policy_commission_handoffs IN SHARE MODE; SELECT pg_sleep(1.2); COMMIT;" >/dev/null & PID=$!
sleep 0.2
START=$(date +%s%N)
sql -tA -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9301), test_id(1), pc_client('Locked', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)))->'commission';" > "$TEMP/locked"
ELAPSED=$(( ($(date +%s%N) - START) / 1000000 ))
wait "$PID"
grep -q '"status": "not_recorded"' "$TEMP/locked" || { cat "$TEMP/locked"; echo 'FAIL: lock contention result'; exit 1; }
[ "$ELAPSED" -lt 800 ] || { echo "FAIL: lock contention took ${ELAPSED} ms"; exit 1; }
sql -c "SELECT test_assert((SELECT count(*) FROM clients WHERE first_name = 'Locked') = 1, 'locked commission tables never block the sale')" >/dev/null
# An agency admin editing the grid (row lock) does not block or fail commission capture.
sql -tA -c "BEGIN; SELECT 1 FROM comp_grids FOR UPDATE; SELECT pg_sleep(1.0); COMMIT;" >/dev/null & PID=$!
sleep 0.2
START=$(date +%s%N)
sql -tA -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9302), test_id(1), pc_client('GridLocked', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)))->'commission'->'slots'->0->>'status';" > "$TEMP/gridlocked"
ELAPSED=$(( ($(date +%s%N) - START) / 1000000 ))
wait "$PID"
grep -qx recorded "$TEMP/gridlocked" && [ "$ELAPSED" -lt 500 ] || { echo "FAIL: grid lock blocked capture (${ELAPSED} ms)"; exit 1; }
echo 'PASS independent-session races and lock contention'

# ── 3. Existing sale, identity and reporting suites, with this migration applied after the identity upgrade ──
DB="${PREFIX}_existing"
for old_db in "${DATABASES[@]}"; do psql "$ADMIN_URL" -qX -c "DROP DATABASE IF EXISTS $old_db WITH (FORCE)" >/dev/null; done
DATABASES=("$DB"); drop_roles
psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB" >/dev/null
DB_URL="${PGURL%/}/$DB"
python3 - "$ROOT" > "$TEMP/existing.sql" <<'PY'
import json, subprocess, sys
from pathlib import Path
root = Path(sys.argv[1])
steps = json.loads(subprocess.check_output(['python3', str(root / 'scripts/reporting_fixture.py'), 'policy', '--json'], text=True))
def migration(suffix):
    return next((root / 'supabase/migrations').glob('*_' + suffix + '.sql')).read_text()
out = []
for label, body in steps:
    out.append((label, body))
    if label == 'identity upgrade':
        out += [('commission grid schema', migration('commission_grids_schema')),
                ('commission grid operations', migration('commission_grids_operations')),
                ('policy commission tracking', migration('policy_commission_tracking')),
                ('policy commission expected windows', migration('policy_commission_expected_windows'))]
assert sum(1 for label, _ in out if label == 'policy commission expected windows') == 1
for label, body in out:
    print('-- ' + label + '\nBEGIN;\n' + body + '\nCOMMIT;')
PY
sql -f "$TEMP/existing.sql" > "$TEMP/existing.log" 2>&1 || { tail -30 "$TEMP/existing.log"; echo 'FAIL: existing suites with the migration'; exit 1; }
echo 'PASS existing sale recording, identity, performance, Sold Date and repair suites with both migrations applied'

# ── 4. Rollback: refuses while records exist; otherwise restores the exact inventory and can be reapplied ──
new_db rollback_refusal
sql -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9401), test_id(1), pc_client('Kept', 11, '50.00'), true, pc_payload());" >/dev/null
expect_fail 'refusing to discard them' "$ROLLBACK"
sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_handoffs) = 1, 'refused rollback kept every record')" >/dev/null
new_db rollback bare
inventory > "$TEMP/inventory.before"
sql -1 -f "$MIGRATION" >/dev/null
sql -1 -f "$ROLLBACK" >/dev/null
inventory > "$TEMP/inventory.rolledback"
grep -q 'agentflow_policy_commission_writer' "$TEMP/inventory.rolledback" && { echo 'FAIL: writer grants remain'; exit 1; }
diff -u <(normalize "$TEMP/inventory.before") <(normalize "$TEMP/inventory.rolledback") || { echo 'FAIL: rollback did not restore the inventory'; exit 1; }
test "$(sql -tAX -c "SELECT count(*) FROM pg_roles WHERE rolname = 'agentflow_policy_commission_writer'")" = 0
test -z "$(sql -tAX -c "SELECT to_regclass('public.wins_commission_link_key')")"
expect_fail 'not installed; refusing replay' "$ROLLBACK"
sql -1 -f "$MIGRATION" >/dev/null
run_suite "$ROOT/supabase/tests/policy_commission_security.sql"
echo 'PASS non-destructive rollback, refusal, replay refusal and reapply'
# Expected windows rollback: refuses once a schedule field is in use; otherwise restores 20261019170000 exactly.
new_db windows_rollback_refusal
sql -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9501), test_id(1), pc_client('Dated', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));" >/dev/null
expect_fail 'refusing to discard them' "$WINDOWS_ROLLBACK"
sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_installments WHERE expected_until IS NOT NULL) = 4, 'refused rollback kept the windows')" >/dev/null
new_db windows_rollback_rows
sql -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9502), test_id(1), pc_client('Undated', 11, '50.00') - 'effective_date',
  true, pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));" >/dev/null
sql -1 -f "$WINDOWS_ROLLBACK" >/dev/null
sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_estimates) = 1 AND (SELECT count(*) FROM policy_commission_installments) = 4,
          'a rollback with no schedule fields in use keeps every record')" >/dev/null
sql -1 -f "$WINDOWS" >/dev/null
new_db windows_rollback applied
commission_inventory > "$TEMP/commission.before"
sql -1 -f "$WINDOWS" >/dev/null
sql -1 -f "$WINDOWS_ROLLBACK" >/dev/null
commission_inventory > "$TEMP/commission.rolledback"
diff -u "$TEMP/commission.before" "$TEMP/commission.rolledback" || { echo 'FAIL: expected windows rollback did not restore 20261019170000'; exit 1; }
expect_fail 'not installed; refusing replay' "$WINDOWS_ROLLBACK"
sql -1 -f "$WINDOWS" >/dev/null
run_suite "$ROOT/supabase/tests/policy_commission_expected_windows.sql"
echo "PASS expected windows rollback: refusal, record-keeping rollback, exact restore ($(wc -l < "$TEMP/commission.before") commission catalog lines), replay refusal and reapply"
# Commissions center rollback: restores both inventories exactly (it owns no data), keeps every record, refuses replay.
new_db center_rollback
sql -f "$CENTER_HARNESS" >/dev/null
inventory > "$TEMP/inventory.before"
commission_inventory > "$TEMP/commission.before"
sql -1 -f "$CENTER" >/dev/null
sql -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9601), test_id(1), pc_client('Reported', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));" >/dev/null
sql -1 -f "$CENTER_ROLLBACK" >/dev/null
inventory > "$TEMP/inventory.rolledback"
commission_inventory > "$TEMP/commission.rolledback"
diff -u "$TEMP/inventory.before" "$TEMP/inventory.rolledback" || { echo 'FAIL: center rollback did not restore the inventory'; exit 1; }
diff -u "$TEMP/commission.before" "$TEMP/commission.rolledback" || { echo 'FAIL: center rollback did not restore the commission catalog'; exit 1; }
test -z "$(sql -tAX -c "SELECT to_regnamespace('policy_commission_reporting')")" || { echo 'FAIL: reporting schema remains'; exit 1; }
sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_estimates) = 1, 'the center rollback keeps every commission record')" >/dev/null
expect_fail 'not installed; refusing replay' "$CENTER_ROLLBACK"
sql -1 -f "$CENTER" >/dev/null
sql -c "SELECT pc_login(11); SET ROLE authenticated;
  SELECT test_assert((get_my_commission_overview()#>>'{setup,with_estimate_count}')::integer = 1, 'reapplied reads see the kept estimate')" >/dev/null
echo 'PASS commissions center rollback: exact restore, records kept, replay refusal and reapply'
# Commissions insights rollback: refuses while a goal exists; otherwise restores both inventories exactly and keeps
# every commission record; refuses replay; reapplies.
center_db insights_rollback
inventory > "$TEMP/inventory.before"
commission_inventory > "$TEMP/commission.before"
sql -1 -f "$INSIGHTS" >/dev/null
sql -c "SELECT pc_login(11); SET ROLE authenticated; SELECT create_client_with_sale_handoff(test_id(9701), test_id(1), pc_client('Insight', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));
  SELECT set_my_commission_goal(DATE '2026-10-01', 100000);" >/dev/null
expect_fail 'refusing to discard them' "$INSIGHTS_ROLLBACK"
sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_goals) = 1, 'refused rollback kept the goal')" >/dev/null
sql -c "SELECT pc_login(11); SET ROLE authenticated; SELECT clear_my_commission_goal(DATE '2026-10-01');" >/dev/null
sql -1 -f "$INSIGHTS_ROLLBACK" >/dev/null
inventory > "$TEMP/inventory.rolledback"
commission_inventory > "$TEMP/commission.rolledback"
diff -u "$TEMP/inventory.before" "$TEMP/inventory.rolledback" || { echo 'FAIL: insights rollback did not restore the inventory'; exit 1; }
diff -u "$TEMP/commission.before" "$TEMP/commission.rolledback" || { echo 'FAIL: insights rollback did not restore the commission catalog'; exit 1; }
test -z "$(sql -tAX -c "SELECT to_regnamespace('policy_commission_insights')")" || { echo 'FAIL: insights schema remains'; exit 1; }
sql -c "SELECT test_assert((SELECT count(*) FROM policy_commission_estimates) = 1, 'the insights rollback keeps every commission record')" >/dev/null
expect_fail 'not installed; refusing replay' "$INSIGHTS_ROLLBACK"
sql -1 -f "$INSIGHTS" >/dev/null
sql -c "SELECT pc_login(11); SET ROLE authenticated;
  SELECT test_assert((get_my_commission_policy_list()->>'total_count')::integer = 1, 'reapplied reads see the kept policy')" >/dev/null
echo 'PASS commissions insights rollback: goal refusal, exact restore, records kept, replay refusal and reapply'

# ── 5. Optional: real PostgREST + supabase-js, and save-overhead measurement ─────────────────────────────
if [ -n "${POSTGREST_BIN:-}" ]; then
  new_db postgrest
  PGURL="$PGURL" DB_URL="$DB_URL" POSTGREST_BIN="$POSTGREST_BIN" node "$ROOT/scripts/tests/policy_commission/postgrest_integration.mjs"
fi
if [ -n "${POSTGREST_BIN:-}" ]; then
  center_db postgrest_center
  PGURL="$PGURL" DB_URL="$DB_URL" POSTGREST_BIN="$POSTGREST_BIN" node "$ROOT/scripts/tests/policy_commission/commission_center_postgrest.mjs"
  insights_db postgrest_insights
  PGURL="$PGURL" DB_URL="$DB_URL" POSTGREST_BIN="$POSTGREST_BIN" node "$ROOT/scripts/tests/policy_commission/commission_insights_postgrest.mjs"
fi
if [ "${PC_MEASURE:-}" = 1 ]; then
  new_db measure
  DB_URL="$DB_URL" bash "$ROOT/scripts/tests/policy_commission/measure_save_overhead.sh"
  insights_db measure_center
  DB_URL="$DB_URL" bash "$ROOT/scripts/tests/policy_commission/measure_center_reads.sh"
fi
# ── 6. Reports V2 PKG-C producing-call capture (D3 §3.6, §7): guards, suite L1-L16, rollback, regressions, boundaries ──
CALL_LINKS="$ROOT/supabase/migrations/20261105120030_policy_sale_call_links.sql"
CALL_CAPTURE="$ROOT/supabase/migrations/20261105120031_policy_sale_call_link_capture.sql"
CALL_CAPTURE_ROLLBACK="$ROOT/supabase/migrations/rollback/20261105120031_policy_sale_call_link_capture.rollback.sql"
# The production column calls.voicemail_id (20260915053646) is not in the commission fixture; added for these proofs.
voicemail_column() { sql -c "ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS voicemail_id uuid" >/dev/null; }
pkgc_db() { new_db "$1" ${2:-}; voicemail_column; sql -1 -f "$CALL_LINKS" >/dev/null; sql -1 -f "$CALL_CAPTURE" >/dev/null; }
new_db call_link_guards
voicemail_column
expect_fail 'the link table (…30) must be applied first' "$CALL_CAPTURE"
sql -1 -f "$CALL_LINKS" >/dev/null
expect_fail 'Sale call links: refusing replay' "$CALL_LINKS"
sql -c "ALTER FUNCTION public.record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb) COST 101" >/dev/null
expect_fail 'sale handoff preimage drift' "$CALL_CAPTURE"
sql -c "ALTER FUNCTION public.record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb) COST 100" >/dev/null
sql -c "ALTER TABLE public.calls DROP COLUMN voicemail_id" >/dev/null
expect_fail 'dependency column missing: public.calls.voicemail_id' "$CALL_CAPTURE"
voicemail_column
sql -1 -f "$CALL_CAPTURE" >/dev/null
expect_fail 'Sale call link capture: refusing replay' "$CALL_CAPTURE"
echo 'PASS producing-call capture guards: order, replay, handoff preimage drift, dependency column'
pkgc_db call_links
run_suite "$ROOT/supabase/tests/policy_sale_call_links.sql"
DB_URL="$DB_URL" node "$ROOT/scripts/tests/sale-call-link-failure-boundaries.mjs"
pkgc_db handoff_with_call_links
run_suite "$ROOT/supabase/tests/policy_commission_handoff.sql"
pkgc_db tracking_with_call_links applied
run_suite "$ROOT/supabase/tests/policy_commission_tracking.sql"
echo 'PASS the existing handoff and tracking suites with the producing-call capture installed'
# L11 rollback: capture disabled, sales still saved, retry and status sealed, links and failure rows kept.
pkgc_db call_links_rollback
sql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO clients(organization_id, first_name, last_name, assigned_agent_id) VALUES (test_id(1), 'RolledBack', 'Synthetic', test_id(11));
INSERT INTO calls(id, organization_id, agent_id, contact_id, direction, created_at)
SELECT test_id(8901), test_id(1), test_id(11), id, 'outbound', now() - interval '1 hour' FROM clients WHERE first_name = 'RolledBack';
SELECT pc_login(11); SET ROLE authenticated;
SELECT test_assert(record_client_policy_handoff_v2(test_id(8902), (SELECT id FROM clients WHERE first_name = 'RolledBack'),
  '{"policy_type":"Term","carrier":"Synthetic Life","premium":20,"sold_date":"2026-10-02"}', true, NULL, test_id(8901)) -> 'source_call_link' ->> 'status' = 'linked', 'linked before rollback');
SQL
sql -1 -f "$CALL_CAPTURE_ROLLBACK" >/dev/null
sql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SELECT pc_login(11); SET ROLE authenticated;
SELECT test_assert(record_client_policy_handoff_v2(test_id(8903), (SELECT id FROM clients WHERE first_name = 'RolledBack'),
  '{"policy_type":"Term","carrier":"Synthetic Life","premium":21,"sold_date":"2026-10-02"}', false, NULL, test_id(8901)) -> 'source_call_link' ->> 'status' = 'disabled', 'disabled after rollback; the sale saves');
RESET ROLE;
SELECT test_assert((SELECT count(*) FROM wins WHERE idempotency_key = 'policy:' || test_id(8903)) = 1
  AND (SELECT count(*) FROM private.policy_sale_call_links) = 1
  AND NOT has_function_privilege('authenticated', 'public.retry_policy_sale_call_link(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_policy_sale_call_link_status(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid)', 'EXECUTE'),
  'rollback keeps links, keeps the sale path, seals retry and status');
SQL
echo 'PASS producing-call capture rollback (L11): disabled capture, sales unaffected, links kept'


# Fidelity aliases: additive comparison-only migration; all earlier migration suites remain unchanged.
FIDELITY="$ROOT/supabase/migrations/pending/policy_commission_fidelity_alias.sql"
FIDELITY_ROLLBACK="$ROOT/supabase/ops/policy_commission_fidelity_alias_rollback.sql"
insights_db fidelity_guards
commission_inventory > "$TEMP/fidelity.before"
sql -c "ALTER FUNCTION private.policy_commission_evaluate(jsonb,jsonb,jsonb,jsonb,text) COST 101" >/dev/null
expect_fail 'preimage or security metadata drift' "$FIDELITY"
sql -c "ALTER FUNCTION private.policy_commission_evaluate(jsonb,jsonb,jsonb,jsonb,text) COST 100" >/dev/null
sql -1 -f "$FIDELITY" >/dev/null
commission_inventory > "$TEMP/fidelity.after"
# Exactly one function body changes. Every other function/relation/ACL/constraint stays byte-identical.
sed 's/f1e6cbc2e17d2ca2c2b8652ce8a5e6d1/74e05e9bcab074d959c9ed6896bf0f20/' "$TEMP/fidelity.before" > "$TEMP/fidelity.expected"
diff -u "$TEMP/fidelity.expected" "$TEMP/fidelity.after"
expect_fail 'preimage or security metadata drift' "$FIDELITY"
sql -c "ALTER FUNCTION private.policy_commission_evaluate(jsonb,jsonb,jsonb,jsonb,text) COST 101" >/dev/null
expect_fail 'preimage or security metadata drift' "$FIDELITY_ROLLBACK"
sql -c "ALTER FUNCTION private.policy_commission_evaluate(jsonb,jsonb,jsonb,jsonb,text) COST 100" >/dev/null
run_suite "$ROOT/supabase/tests/policy_commission_fidelity_alias.sql"
# Recovery never removes financial history; reapply is tested only after exact recovery.
sql -tAX -c "SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM policy_commission_estimates x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM policy_commission_captures x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM wins x))::text)" > "$TEMP/fidelity.rows.before"
sql -1 -f "$FIDELITY_ROLLBACK" >/dev/null
sql -tAX -c "SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM policy_commission_estimates x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM policy_commission_captures x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM wins x))::text)" > "$TEMP/fidelity.rows.after"
diff -u "$TEMP/fidelity.rows.before" "$TEMP/fidelity.rows.after"
expect_fail 'preimage or security metadata drift' "$FIDELITY_ROLLBACK"
sql -1 -f "$FIDELITY" >/dev/null
for suite in security handoff tracking; do
  new_db "fidelity_existing_$suite" applied
  sql -1 -f "$FIDELITY" >/dev/null
  run_suite "$ROOT/supabase/tests/policy_commission_$suite.sql"
done
echo 'PASS Fidelity preimage/replay/metadata/recovery guards and existing security/handoff/tracking suites'

# The exact operational script is rehearsed with synthetic Settings fields, never production contacts.
new_db fidelity_settings
sql >/dev/null <<'SQL'
CREATE TABLE public.carriers(id uuid PRIMARY KEY, organization_id uuid, name text, portal_url text, is_appointed boolean,
  logo_url text, contact_phones jsonb, contact_emails jsonb, created_at timestamptz, updated_at timestamptz);
INSERT INTO carriers VALUES('fad9151b-849b-46dc-b34d-d7e17670abbb','a0000000-0000-0000-0000-000000000001','Instabrain',
  'https://example.test',true,NULL,'["5555550100"]','["synthetic@example.test"]','2026-01-01','2026-01-01');
CREATE FUNCTION public.pc_alias_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER carriers_updated_at BEFORE UPDATE ON public.carriers FOR EACH ROW EXECUTE FUNCTION public.pc_alias_touch();
SQL
FINGERPRINT=$(sql -tAX -c "SELECT md5((to_jsonb(c)-'name'-'updated_at')::text) FROM carriers c")
sed "s/3d6783e15df06b815d1b2823dc1345bb/$FINGERPRINT/" "$ROOT/supabase/ops/rename_home_agency_fidelity_carrier.sql" > "$TEMP/rename.sql"
expect_fail 'fidelity_action must be explicitly approved' "$TEMP/rename.sql"
sql -v fidelity_action=rename -f "$TEMP/rename.sql" >/dev/null
sql -v fidelity_action=rename -f "$TEMP/rename.sql" >/dev/null
sql -c "SELECT test_assert((SELECT count(*)=1 AND min(name)='Fidelity' AND min(updated_at)>'2026-01-01' FROM carriers),'rename in place and timestamp')" >/dev/null
sql -v fidelity_action=restore -f "$TEMP/rename.sql" >/dev/null
sql -v fidelity_action=restore -f "$TEMP/rename.sql" >/dev/null
for scenario in missing wrong_org wrong_id stale collision unexpected; do
  case "$scenario" in
    missing) sql -c 'ALTER TABLE carriers RENAME TO alias_saved; CREATE TABLE carriers (LIKE alias_saved INCLUDING ALL)' >/dev/null ;;
    wrong_org) sql -c "UPDATE carriers SET organization_id=test_id(2)" >/dev/null ;;
    wrong_id) sql -c "UPDATE carriers SET id=test_id(9988)" >/dev/null ;;
    stale) sql -c "UPDATE carriers SET is_appointed=false" >/dev/null ;;
    collision) sql -c "INSERT INTO carriers SELECT test_id(9988),organization_id,'Fidelity Life',portal_url,is_appointed,logo_url,contact_phones,contact_emails,created_at,updated_at FROM carriers" >/dev/null ;;
    unexpected) sql -c "UPDATE carriers SET name='Unexpected'" >/dev/null ;;
  esac
  if sql -v fidelity_action=rename -f "$TEMP/rename.sql" > "$TEMP/rename.refusal" 2>&1; then
    echo "FAIL: Settings $scenario unexpectedly accepted"; exit 1
  fi
  grep -Eq 'target or preserved fields changed|alias collision' "$TEMP/rename.refusal"
  case "$scenario" in
    missing) sql -c 'DROP TABLE carriers; ALTER TABLE alias_saved RENAME TO carriers' >/dev/null ;;
    wrong_org) sql -c "UPDATE carriers SET organization_id='a0000000-0000-0000-0000-000000000001'" >/dev/null ;;
    wrong_id) sql -c "UPDATE carriers SET id='fad9151b-849b-46dc-b34d-d7e17670abbb'" >/dev/null ;;
    stale) sql -c "UPDATE carriers SET is_appointed=true" >/dev/null ;;
    collision) sql -c 'DELETE FROM carriers WHERE id=test_id(9988)' >/dev/null ;;
    unexpected) sql -c "UPDATE carriers SET name='Instabrain'" >/dev/null ;;
  esac
done
sql -v fidelity_action=rename -f "$TEMP/rename.sql" >/dev/null
echo 'PASS Fidelity one-row Settings rename, no-op, collision/drift refusals and recovery'

# ── 7. Team Commissions: current hierarchy/read policies, native scopes, parity, HTTP, guarded recovery ──
SCOPED="$ROOT/supabase/migrations/20261112165503_policy_commission_scoped_reads.sql"
SCOPED_ROLLBACK="$ROOT/supabase/migrations/rollback/20261112165503_policy_commission_scoped_reads.sql"
scoped_db() {
  insights_db "$1"
  sql -1 -f "$FIDELITY" >/dev/null
  # Existing unchanged insights suite seeds the complete holds/void/replacement/restricted-contact book.
  run_suite "$ROOT/supabase/tests/policy_commission_insights.sql"
  python3 "$ROOT/scripts/policy_commission_scope_fixture.py" > "$TEMP/scoped-fixture.sql"
  sql -f "$TEMP/scoped-fixture.sql" >/dev/null
}
scoped_inventory() {
  sql -tAX -c "SELECT 'f|'||p.oid::regprocedure||'|'||pg_get_userbyid(p.proowner)||'|'||p.proacl::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||coalesce(p.proconfig::text,'-')||'|'||md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','policy_commission_authz','policy_commission_reporting','policy_commission_insights','policy_commission_scoped') ORDER BY 1"
}
scoped_db scoped
sql -v capture=true -f "$ROOT/supabase/tests/policy_commission_scoped_parity.sql" >/dev/null
scoped_inventory > "$TEMP/scoped.before"
commission_inventory > "$TEMP/scoped.commission.before"
sql -c "ALTER FUNCTION public.get_my_commission_overview(text,date,date) COST 101" >/dev/null
expect_fail 'preimage' "$SCOPED"
sql -c "ALTER FUNCTION public.get_my_commission_overview(text,date,date) COST 100" >/dev/null
sql -1 -f "$SCOPED" >/dev/null
expect_fail 'already' "$SCOPED"
sql -v capture=false -f "$ROOT/supabase/tests/policy_commission_scoped_parity.sql" | grep -E '^ *PASS'
run_suite "$ROOT/supabase/tests/policy_commission_scoped.sql"
if [ -n "${POSTGREST_BIN:-}" ]; then
  PGURL="$PGURL" DB_URL="$DB_URL" POSTGREST_BIN="$POSTGREST_BIN" node "$ROOT/scripts/tests/policy_commission/commission_scoped_postgrest.mjs"
fi
# Recover exact prior readers without removing a single estimate/receipt; metadata drift must refuse recovery.
sql -c "ALTER FUNCTION policy_commission_scoped.resolve_scope(text,uuid[]) COST 101" >/dev/null
expect_fail 'drift' "$SCOPED_ROLLBACK"
sql -c "ALTER FUNCTION policy_commission_scoped.resolve_scope(text,uuid[]) COST 100" >/dev/null
sql -1 -f "$SCOPED_ROLLBACK" >/dev/null
scoped_inventory > "$TEMP/scoped.rolledback"
commission_inventory > "$TEMP/scoped.commission.rolledback"
diff -u "$TEMP/scoped.before" "$TEMP/scoped.rolledback"
diff -u "$TEMP/scoped.commission.before" "$TEMP/scoped.commission.rolledback"
sql -v capture=false -f "$ROOT/supabase/tests/policy_commission_scoped_parity.sql" | grep -E '^ *PASS'
sql -c "SELECT test_assert(to_jsonb(cs_history_digest())=cs_get('history_before'),'rollback retains complete financial history')" >/dev/null
# Execute the exact reviewed SQL Editor packages, including atomic migration-history bookkeeping.
# This loopback database has a synthetic history table; no hosted database or customer identity is used.
SCOPED_RELEASE="$ROOT/docs/plans/2026-11-08-team-commissions/release"
sql <<'SQL' >/dev/null
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text);
INSERT INTO supabase_migrations.schema_migrations VALUES
 ('20261110191037',ARRAY['synthetic prior history'],'reports_cleanup'),
 ('20261110205228',ARRAY['synthetic prior history'],'policy_commission_fidelity_alias'),
 ('20261111192142',ARRAY['synthetic current head'],'carrier_resource_links');
SQL
sql -tAX -c 'SELECT to_jsonb(h) FROM supabase_migrations.schema_migrations h ORDER BY version' > "$TEMP/history.before"
sql -f "$SCOPED_RELEASE/apply.sql" >/dev/null
expect_fail 'history' "$SCOPED_RELEASE/apply.sql"
python3 - "$SCOPED" > "$TEMP/history-assert.sql" <<'PY_RELEASE'
from pathlib import Path
import hashlib, sys
body = Path(sys.argv[1]).read_bytes()
print("SELECT test_assert((SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20261112165503' AND name='policy_commission_scoped_reads' AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='" + hashlib.sha256(body).hexdigest() + "'),'exact CLI history version/name/bytes');")
PY_RELEASE
sql -f "$TEMP/history-assert.sql" >/dev/null
sql -c "UPDATE supabase_migrations.schema_migrations SET name='injected_history_drift' WHERE version='20261112165503'" >/dev/null
expect_fail 'Recovery history' "$SCOPED_RELEASE/rollback.sql"
sql -c "UPDATE supabase_migrations.schema_migrations SET name='policy_commission_scoped_reads' WHERE version='20261112165503'" >/dev/null
python3 - "$SCOPED_RELEASE/rollback.sql" "$TEMP/package-hash-drift.sql" <<'PY_RELEASE'
from pathlib import Path
import re, sys
body = Path(sys.argv[1]).read_text()
body, count = re.subn(r"reviewed_hash text := '[0-9a-f]{64}'", "reviewed_hash text := '" + '0'*64 + "'", body)
assert count == 1
Path(sys.argv[2]).write_text(body)
PY_RELEASE
expect_fail 'Embedded SQL differs' "$TEMP/package-hash-drift.sql"
sql -f "$SCOPED_RELEASE/rollback.sql" >/dev/null
scoped_inventory > "$TEMP/scoped.package-rollback"
diff -u "$TEMP/scoped.before" "$TEMP/scoped.package-rollback"
sql -tAX -c 'SELECT to_jsonb(h) FROM supabase_migrations.schema_migrations h ORDER BY version' > "$TEMP/history.after"
diff -u "$TEMP/history.before" "$TEMP/history.after"
sql -c "SELECT test_assert(to_jsonb(cs_history_digest())=cs_get('history_before'),'release package rollback retains all financial history')" >/dev/null
sql -v capture=false -f "$ROOT/supabase/tests/policy_commission_scoped_parity.sql" | grep -E '^ *PASS'
sql -f "$SCOPED_RELEASE/apply.sql" >/dev/null
sql -f "$TEMP/history-assert.sql" >/dev/null
sql -v capture=false -f "$ROOT/supabase/tests/policy_commission_scoped_parity.sql" | grep -E '^ *PASS'
echo 'PASS scoped preimage/replay/drift refusal, exact legacy parity, full catalog rollback and financial history preservation'
echo 'PASS exact release packages: apply/history bytes/replay/history drift/hash drift/rollback catalog+history/reapply'
if [ "${PC_SCOPE_MEASURE:-}" = 1 ]; then
  DB_URL="$DB_URL" bash "$ROOT/scripts/tests/policy_commission/measure_scoped_reads.sh"
  if [ -n "${POSTGREST_BIN:-}" ]; then
    PGURL="$PGURL" DB_URL="$DB_URL" POSTGREST_BIN="$POSTGREST_BIN" node "$ROOT/scripts/tests/policy_commission/commission_scoped_scale_postgrest.mjs"
  fi
fi
# Re-run unchanged existing Center and insights acceptance against the FINAL shared implementation and current hierarchy.
for suite in center insights; do
  insights_db "scoped_existing_$suite"
  sql -1 -f "$FIDELITY" >/dev/null
  python3 "$ROOT/scripts/policy_commission_scope_fixture.py" --schema-only > "$TEMP/scoped-schema.sql"
  sql -f "$TEMP/scoped-schema.sql" >/dev/null
  sql -1 -f "$SCOPED" >/dev/null
  run_suite "$ROOT/supabase/tests/policy_commission_$suite.sql"
done

echo 'PASS policy commission tracking database proofs'
