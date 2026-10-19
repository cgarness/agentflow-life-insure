#!/usr/bin/env bash
# Phase 2A policy commission tracking: every database proof on a DISPOSABLE localhost PostgreSQL cluster.
# Synthetic data only. Refuses anything but a loopback cluster without hosted platform roles.
#   PGURL=postgres://postgres@127.0.0.1:<port> bash scripts/run_policy_commission_tests.sh
# Optional: POSTGREST_BIN=/path/to/postgrest (12.2.3) adds the real PostgREST + supabase-js integration;
#           PC_MEASURE=1 adds the save-overhead measurement (scripts/tests/policy_commission/measure_save_overhead.sh).
# Steps: migration preimage/replay guards · ACL and ownership inventory diff · security, handoff and tracking suites ·
# independent-session races and lock contention · existing sale/identity/reporting suites with this migration applied ·
# non-destructive rollback, refusal and reapply.
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
# new_db NAME [bare]: a fresh database with the fixture and harness (and the migration unless bare). Roles are
# cluster-global, so the previous scenario's database and roles are removed first.
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
}
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
for suite in security handoff tracking; do
  new_db "$suite"
  run_suite "$ROOT/supabase/tests/policy_commission_$suite.sql"
done

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
                ('policy commission tracking', migration('policy_commission_tracking'))]
assert sum(1 for label, _ in out if label == 'policy commission tracking') == 1
for label, body in out:
    print('-- ' + label + '\nBEGIN;\n' + body + '\nCOMMIT;')
PY
sql -f "$TEMP/existing.sql" > "$TEMP/existing.log" 2>&1 || { tail -30 "$TEMP/existing.log"; echo 'FAIL: existing suites with the migration'; exit 1; }
echo 'PASS existing sale recording, identity, performance, Sold Date and repair suites with the migration applied'

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

# ── 5. Optional: real PostgREST + supabase-js, and save-overhead measurement ─────────────────────────────
if [ -n "${POSTGREST_BIN:-}" ]; then
  new_db postgrest
  PGURL="$PGURL" DB_URL="$DB_URL" POSTGREST_BIN="$POSTGREST_BIN" node "$ROOT/scripts/tests/policy_commission/postgrest_integration.mjs"
fi
if [ "${PC_MEASURE:-}" = 1 ]; then
  new_db measure
  DB_URL="$DB_URL" bash "$ROOT/scripts/tests/policy_commission/measure_save_overhead.sh"
fi
echo 'PASS policy commission tracking database proofs'
