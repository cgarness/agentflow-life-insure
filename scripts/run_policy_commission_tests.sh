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

# ── 4b. Age-independent product validation: additive migration and local-only regression suite ──
# This deliberately comes after the original rollback proofs so that prior immutable release tests
# continue on their pinned database contract. Never run the optional-age migration on production here.
new_db optional_age
sql -1 -f "$ROOT/supabase/migrations/20261023180000_policy_commission_optional_age.sql" >/dev/null
run_suite "$ROOT/supabase/tests/policy_commission_optional_age.sql"
expect_fail 'optional insured age already applied or column drift' "$ROOT/supabase/migrations/20261023180000_policy_commission_optional_age.sql"
echo 'PASS optional-age SQL nullability, payload, matching and replay guard'

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
echo 'PASS policy commission tracking database proofs'
