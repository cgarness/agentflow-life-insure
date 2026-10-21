#!/usr/bin/env bash
# Lead → Client conversion data preservation (20261021200000): every database proof on a DISPOSABLE localhost
# PostgreSQL cluster. Synthetic data only. Refuses anything but a loopback cluster without hosted platform roles.
#   PGURL=postgres://postgres@127.0.0.1:<port> bash scripts/run_lead_conversion_preservation_tests.sh
# The fixture is the production end state of the conversion chain: verbatim sale writers and identity upgrade
# (scripts/policy_commission_fixture.py), the applied commission migrations 20261019170000 + 20261020040000, the
# contact-history migrations, and the baseline normalize_us_state. Steps: guards · inventory · historical rows and
# the release boundary (mixed browser versions) · preservation suite · pre/post differential · existing suites with the
# migration applied · independent-session race · rollback, refusal and re-apply.
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
PREFIX="lcp_test_$$"
TEMP=$(mktemp -d)
MIGRATION="$ROOT/supabase/migrations/20261021200000_lead_client_conversion_preservation.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20261021200000_lead_client_conversion_preservation.rollback.sql"
SUITE="$ROOT/supabase/tests/lead_conversion_preservation.sql"
DIFFERENTIAL="$ROOT/supabase/tests/lead_conversion_differential.sql"
COMMISSION="$ROOT/supabase/migrations/20261019170000_policy_commission_tracking.sql"
WINDOWS="$ROOT/supabase/migrations/20261020040000_policy_commission_expected_windows.sql"
CENTER="$ROOT/supabase/migrations/20261020212000_policy_commission_center_reads.sql"
CENTER_HARNESS="$ROOT/supabase/tests/policy_commission_center_harness.sql"
INSIGHTS="$ROOT/supabase/migrations/20261021180000_policy_commission_center_insights.sql"
HISTORY_READ="$ROOT/supabase/migrations/20261003192857_contact_history_read_model.sql"
HISTORY_EVENTS="$ROOT/supabase/migrations/20261003192907_contact_history_operational_events.sql"
POST_ATOMIC=ac116f01810768581707e837a5ca3b99
POST_UPDATE=6313ca0c1fc374a613bfcb7e9e587d4c
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
python3 - "$ROOT" > "$TEMP/baseline_extra.sql" <<'PY'
import sys
from pathlib import Path
base = (Path(sys.argv[1]) / 'supabase/migrations/20260806000000_baseline_production_schema.sql').read_text()
def block(header, end):
    start = base.index(header)
    return base[start:base.index(end, start) + len(end)]
# Verbatim production objects the conversion chain touches beyond the commission fixture.
print(block('CREATE TABLE IF NOT EXISTS "public"."recruits" (', '\n);'))
print('ALTER TABLE public.recruits ADD PRIMARY KEY (id);')
print(block('CREATE OR REPLACE FUNCTION "public"."normalize_us_state"(', '\n$$;'))
PY

sql() { psql "$DB_URL" -qX -v ON_ERROR_STOP=1 "$@"; }
# new_db NAME [pre|commission-only]: the production end state; 'pre' stops before 20261021200000 and
# 'commission-only' applies only 20261019170000 (the state the applied tracking suite was written for).
new_db() {
  for old_db in "${DATABASES[@]}"; do psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $old_db WITH (FORCE)" >/dev/null; done
  DATABASES=()
  drop_roles
  DB="${PREFIX}_$1"
  psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB" >/dev/null
  DATABASES+=("$DB")
  DB_URL="${PGURL%/}/$DB"
  sql -f "$TEMP/fixture.sql" >/dev/null
  sql -1 -f "$COMMISSION" >/dev/null
  if [ "${2:-}" != commission-only ]; then sql -1 -f "$WINDOWS" >/dev/null; fi
  sql -f "$TEMP/baseline_extra.sql" >/dev/null
  sql -1 -f "$HISTORY_READ" >/dev/null
  sql -1 -f "$HISTORY_EVENTS" >/dev/null 2>&1
  if [ "${2:-}" != pre ]; then sql -1 -f "$MIGRATION" >/dev/null; fi
}
run_suite() { sql -v defaults="$(cat "$ROOT/supabase/tests/fixtures/policy_commission/permission_defaults.json")" -f "$1" | grep -E '^ *PASS' ; }
expect_fail() { # expect_fail PATTERN FILE: the file must fail with an error matching PATTERN
  if sql -1 -f "$2" > "$TEMP/out" 2>&1; then echo "FAIL: $2 unexpectedly applied"; exit 1; fi
  grep -q "$1" "$TEMP/out" || { cat "$TEMP/out"; echo "FAIL: expected '$1'"; exit 1; }
}
digests() {
  sql -tAX -c "SELECT md5(pg_get_functiondef('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure)) || ' '
                 || md5(pg_get_functiondef('public.update_client_with_policy_sale(uuid,jsonb)'::regprocedure))"
}
not_installed() {
  test "$(sql -tAX -c "SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.clients'::regclass AND NOT attisdropped
         AND attname IN ('date_of_birth','age','best_time_to_call','spouse_info','lead_conversion')")" = 0 \
    && test "$(digests)" = '641ba66c96ca4a76f80c9c85eb9caa42 96e8f6e7ecc85d0d5385bf8640a144a6' \
    || { echo 'FAIL: a refused migration left changes behind'; exit 1; }
}
# Every function, relation, column, trigger, policy and schema ACL in public/private/auth.
inventory() {
  sql -tAX -c "SELECT 'f|' || p.oid::regprocedure || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|' || coalesce(p.proacl::text, '-')
                 || '|' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname IN ('public', 'private', 'auth') AND p.prokind = 'f'
               UNION ALL
               SELECT 'r|' || c.oid::regclass || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || '|' || coalesce(c.relacl::text, '-')
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'v', 'S', 'i')
               UNION ALL
               SELECT 'a|' || a.attrelid::regclass || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|'
                 || a.atthasdef || '|' || coalesce(a.attacl::text, '-') FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'private') AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
               UNION ALL
               SELECT 't|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
               UNION ALL
               SELECT 'p|' || polrelid::regclass || '|' || polname || '|' || coalesce(pg_get_expr(polqual, polrelid), '-') || '|'
                 || coalesce(pg_get_expr(polwithcheck, polrelid), '-') FROM pg_policy
               UNION ALL
               SELECT 'n|' || nspname || '|' || coalesce(nspacl::text, '-') FROM pg_namespace WHERE nspname IN ('public', 'private', 'auth')
               ORDER BY 1"
}
# Full-row fingerprint of every business table the conversion chain touches; clients without the new columns.
fingerprint() {
  sql -tAX -c "SELECT md5(string_agg(t || ':' || r, E'\n' ORDER BY t, r)) FROM (
      SELECT 'clients' t, (to_jsonb(c) - ARRAY['date_of_birth','age','best_time_to_call','spouse_info','lead_conversion'])::text r FROM public.clients c
      UNION ALL SELECT 'leads', to_jsonb(x)::text FROM public.leads x
      UNION ALL SELECT 'wins', to_jsonb(x)::text FROM public.wins x
      UNION ALL SELECT 'policy_identities', to_jsonb(x)::text FROM private.policy_identities x
      UNION ALL SELECT 'policy_sale_receipts', to_jsonb(x)::text FROM private.policy_sale_receipts x
      UNION ALL SELECT 'handoffs', to_jsonb(x)::text FROM public.policy_commission_handoffs x
      UNION ALL SELECT 'captures', to_jsonb(x)::text FROM public.policy_commission_captures x
      UNION ALL SELECT 'estimates', to_jsonb(x)::text FROM public.policy_commission_estimates x
      UNION ALL SELECT 'installments', to_jsonb(x)::text FROM public.policy_commission_installments x
      UNION ALL SELECT 'calls', to_jsonb(x)::text FROM public.calls x
      UNION ALL SELECT 'messages', to_jsonb(x)::text FROM public.messages x
      UNION ALL SELECT 'campaign_leads', to_jsonb(x)::text FROM public.campaign_leads x
      UNION ALL SELECT 'contact_history_events', to_jsonb(x)::text FROM public.contact_history_events x) s"
}

# ── 1. Guards: drift, authorization metadata, column shape and missing dependency all refuse with no change ────────
new_db guards pre
echo "Fixture preimages (production values recorded 2026-10-21): $(digests)"
sql -c "DO \$\$ BEGIN EXECUTE replace(pg_get_functiondef('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure),
          'RETURN jsonb_build_object(''client_id'', v_existing, ''idempotent'', true);', 'RETURN jsonb_build_object(''client_id'', v_existing, ''idempotent'', true); -- drift'); END \$\$" >/dev/null
expect_fail 'convert_lead_to_client_atomic(uuid,jsonb) differs from the reviewed preimage' "$MIGRATION"
new_db guards_update pre
sql -c "DO \$\$ BEGIN EXECUTE replace(pg_get_functiondef('public.update_client_with_policy_sale(uuid,jsonb)'::regprocedure),
          'Invalid client edit', 'Invalid client edit.'); END \$\$" >/dev/null
expect_fail 'update_client_with_policy_sale(uuid,jsonb) differs from the reviewed preimage' "$MIGRATION"
new_db guards_wrapper pre
sql -c "DO \$\$ BEGIN EXECUTE replace(pg_get_functiondef('public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)'::regprocedure),
          'Invalid conversion policy payload', 'Invalid conversion payload'); END \$\$" >/dev/null
expect_fail 'convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid) differs from the reviewed preimage' "$MIGRATION"
new_db guards_acl pre
sql -c "GRANT EXECUTE ON FUNCTION public.convert_lead_to_client_atomic(uuid,jsonb) TO anon" >/dev/null
expect_fail 'writer authorization metadata changed' "$MIGRATION"
new_db guards_shape pre
sql -c "ALTER TABLE public.clients ADD COLUMN age text" >/dev/null
expect_fail 'clients.age exists with an unexpected shape' "$MIGRATION"
sql -c "ALTER TABLE public.clients DROP COLUMN age" >/dev/null
not_installed
new_db guards_dependency pre
sql -c "DROP FUNCTION public.normalize_us_state(text)" >/dev/null
expect_fail 'normalize_us_state(text) is required' "$MIGRATION"
not_installed
echo 'PASS migration guards: drift, ACL, column shape and dependency refused with nothing changed'

# ── 2. Inventory: exactly the reviewed additions and the two replaced bodies; nothing else changes ───────────────
new_db inventory pre
inventory | LC_ALL=C sort > "$TEMP/inventory.before"
sql -1 -f "$MIGRATION" >/dev/null
inventory | LC_ALL=C sort > "$TEMP/inventory.after"
LC_ALL=C comm -23 "$TEMP/inventory.before" "$TEMP/inventory.after" | sed -E 's/\|[0-9a-f]{32}$//' > "$TEMP/removed"
LC_ALL=C comm -13 "$TEMP/inventory.before" "$TEMP/inventory.after" > "$TEMP/added"
cat > "$TEMP/removed.expected" <<'EOF'
f|convert_lead_to_client_atomic(uuid,jsonb)|postgres|true|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
f|update_client_with_policy_sale(uuid,jsonb)|postgres|true|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
EOF
diff -u "$TEMP/removed.expected" "$TEMP/removed" || { echo 'FAIL: unexpected removed or changed objects'; exit 1; }
cat > "$TEMP/added.expected" <<EOF
a|clients|age|integer|false|false|-
a|clients|best_time_to_call|text|false|false|-
a|clients|date_of_birth|text|false|false|-
a|clients|lead_conversion|jsonb|false|false|-
a|clients|spouse_info|jsonb|false|false|-
f|convert_lead_to_client_atomic(uuid,jsonb)|postgres|true|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|$POST_ATOMIC
f|private.guard_client_lead_conversion()|postgres|false|{postgres=X/postgres}|$(sql -tAX -c "SELECT md5(pg_get_functiondef('private.guard_client_lead_conversion()'::regprocedure))")
f|update_client_with_policy_sale(uuid,jsonb)|postgres|true|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|$POST_UPDATE
t|clients|clients_lead_conversion_guard|CREATE TRIGGER clients_lead_conversion_guard BEFORE INSERT OR UPDATE OF lead_conversion ON public.clients FOR EACH ROW EXECUTE FUNCTION private.guard_client_lead_conversion()
EOF
diff -u <(LC_ALL=C sort "$TEMP/added.expected") "$TEMP/added" || { echo 'FAIL: unexpected added objects'; exit 1; }
expect_fail 'differs from the reviewed preimage; refusing' "$MIGRATION"
echo "PASS inventory: 2 bodies replaced (owner, definer flag and ACL kept), 5 nullable columns, 1 trigger + guard; $(( $(wc -l < "$TEMP/inventory.before") - 2 )) other objects unchanged; replay refused"

# ── 3. Historical rows and the release boundary (mixed browser versions) ────────────────────────────────────────
new_db boundary pre
sql > /dev/null <<'SQL'
INSERT INTO leads(id, organization_id, user_id, assigned_agent_id, first_name, last_name, state, notes, custom_fields, date_of_birth, age)
SELECT test_id(9000 + n), test_id(1), test_id(11), test_id(11), 'Boundary' || n, 'Synthetic', 'CA', 'Lead note ' || n,
       jsonb_build_object('Gender', 'F'), '1960-01-0' || n, 60 + n FROM generate_series(1, 4) n;
SELECT pc_login(11);
SET ROLE authenticated;
-- Pre-release: an old browser converts lead 9001; a manual client and a recorded policy exist too.
SELECT convert_lead_to_client_with_sales_handoff(test_id(9101), test_id(9001), test_id(1),
  pc_client('Boundary1', 11, '50.00') || '{"notes": "Lead note 1", "custom_fields": {"Gender": "F"}}', NULL, pc_payload());
SELECT create_client_with_sale_handoff(test_id(9102), test_id(1), pc_client('ManualBefore', 11, '41.00'), true, pc_payload());
SELECT record_client_policy_handoff(test_id(9103), (SELECT id FROM clients WHERE first_name = 'ManualBefore'),
  '{"policy_type": "Term", "carrier": "Synthetic Life", "policy_number": "SYN-REC", "premium": "19.00", "sold_date": "2026-10-04"}', false, pc_payload());
RESET ROLE;
SQL
BEFORE=$(fingerprint)
sql -1 -f "$MIGRATION" >/dev/null
test "$(fingerprint)" = "$BEFORE" || { echo 'FAIL: the migration changed existing rows'; exit 1; }
sql -c "SELECT test_assert(NOT EXISTS (SELECT 1 FROM clients WHERE date_of_birth IS NOT NULL OR age IS NOT NULL OR best_time_to_call IS NOT NULL
          OR spouse_info IS NOT NULL OR lead_conversion IS NOT NULL), 'existing clients read NULL in every new column')" >/dev/null
# A frozen retry of the pre-release conversion (unknown outcome in an old tab) replays exactly once.
sql > /dev/null <<'SQL'
SELECT pc_login(11);
SET ROLE authenticated;
SELECT convert_lead_to_client_with_sales_handoff(test_id(9101), test_id(9001), test_id(1),
  pc_client('Boundary1', 11, '50.00') || '{"notes": "Lead note 1", "custom_fields": {"Gender": "F"}}', NULL, pc_payload());
RESET ROLE;
SQL
test "$(fingerprint)" = "$BEFORE" || { echo 'FAIL: a pre-release retry changed data'; exit 1; }
# After release, a still-open old browser converts with its stale snapshot: an outdated notes copy and custom bag.
sql > /dev/null <<'SQL'
UPDATE leads SET notes = 'Current lead note 2', custom_fields = '{"Gender": "F", "Tobacco": "No"}' WHERE id = test_id(9002);
SELECT pc_login(11);
SET ROLE authenticated;
SELECT convert_lead_to_client_with_sales_handoff(test_id(9104), test_id(9002), test_id(1),
  pc_client('Boundary2', 11, '50.00') || '{"notes": "Lead note 2", "custom_fields": {"Gender": "M"}}', NULL, pc_payload());
-- The same old browser with no conversion note and an up-to-date copy.
SELECT convert_lead_to_client_with_sales_handoff(test_id(9105), test_id(9003), test_id(1),
  pc_client('Boundary3', 11, '50.00') || '{"notes": "Lead note 3", "custom_fields": {"Gender": "F"}}', NULL, pc_payload());
-- The new browser sends conversion notes only and no lead notes fallback.
SELECT convert_lead_to_client_with_sales_handoff(test_id(9106), test_id(9004), test_id(1),
  pc_client('Boundary4', 11, '50.00') || '{"notes": null, "custom_fields": {"Gender": "F"}}', NULL, pc_payload());
-- An old browser edit of a pre-release client sends only the old keys.
SELECT update_client_with_policy_sale((SELECT id FROM clients WHERE lead_id = test_id(9001)), '{"notes": "Old tab edit", "state": "CA"}');
RESET ROLE;
SELECT test_assert(custom_fields = '{"Gender": "F", "Tobacco": "No"}' AND notes = 'Lead note 2'
                   AND lead_conversion->>'lead_notes' = 'Current lead note 2' AND date_of_birth = '1960-01-02' AND age = 62 AND state = 'CA',
                   'old browser after release: stale custom bag ignored; the current lead notes are kept beside its stale copy')
FROM clients WHERE lead_id = test_id(9002);
SELECT test_assert(notes = 'Lead note 3' AND NOT lead_conversion ? 'lead_notes' AND custom_fields = '{"Gender": "F"}',
                   'old browser after release, current copy: nothing displaced') FROM clients WHERE lead_id = test_id(9003);
SELECT test_assert(notes = 'Lead note 4' AND NOT lead_conversion ? 'lead_notes', 'new browser: database notes') FROM clients WHERE lead_id = test_id(9004);
SELECT test_assert(notes = 'Old tab edit' AND lead_conversion IS NULL AND date_of_birth IS NULL, 'pre-release client edited by an old tab stays historical')
FROM clients WHERE lead_id = test_id(9001);
SELECT test_assert(NOT EXISTS (SELECT 1 FROM contact_history_capture_health), 'no contact-history capture gap');
SQL
echo 'PASS historical rows unchanged by the migration; pre-release retry exactly once; old and new browsers after release lose nothing'

# ── 4. Preservation suite (P2–P15) ─────────────────────────────────────────────────────────────────────────────
new_db suite
sql -f "$SUITE" | grep -E '^ *PASS'

# ── 5. Differential: identical sales, policies, commissions, history and refusals before and after ───────────────
new_db differential_pre pre
sql -f "$DIFFERENTIAL" > "$TEMP/differential.pre"
new_db differential_post
sql -f "$DIFFERENTIAL" > "$TEMP/differential.post"
grep -q '"wins"' "$TEMP/differential.post" || { echo 'FAIL: empty differential'; exit 1; }
! grep -q '"unmapped"' "$TEMP/differential.post" || { echo 'FAIL: differential has an unmapped id'; exit 1; }
diff -u "$TEMP/differential.pre" "$TEMP/differential.post" || { echo 'FAIL: the migration changed sale, commission or history outcomes'; exit 1; }
echo "PASS differential: $(wc -l < "$TEMP/differential.post") canonical lines identical without and with the migration (sha256 $(sha256sum "$TEMP/differential.post" | cut -c1-16))"

# ── 6. Existing suites with the migration applied ─────────────────────────────────────────────────────────────
for suite in security handoff expected_windows; do
  new_db "existing_$suite"
  run_suite "$ROOT/supabase/tests/policy_commission_$suite.sql"
done
new_db existing_tracking commission-only
run_suite "$ROOT/supabase/tests/policy_commission_tracking.sql"
new_db existing_center pre
sql -f "$CENTER_HARNESS" >/dev/null
sql -1 -f "$CENTER" >/dev/null
sql -1 -f "$INSIGHTS" >/dev/null
sql -1 -f "$MIGRATION" >/dev/null
run_suite "$ROOT/supabase/tests/policy_commission_insights.sql"
new_db existing_center_only pre
sql -f "$CENTER_HARNESS" >/dev/null
sql -1 -f "$CENTER" >/dev/null
sql -1 -f "$INSIGHTS" >/dev/null
sql -1 -f "$MIGRATION" >/dev/null
run_suite "$ROOT/supabase/tests/policy_commission_center.sql"
# Performance, Sold Date, reporting reconciliation and reviewed-repair suites run after this migration, inserted right
# after the last suite that pins the original converter bytes ('identity regressions').
for old_db in "${DATABASES[@]}"; do psql "$ADMIN_URL" -qX -c "DROP DATABASE IF EXISTS $old_db WITH (FORCE)" >/dev/null; done
DATABASES=(); drop_roles
DB="${PREFIX}_reporting"
psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB" >/dev/null
DATABASES=("$DB"); DB_URL="${PGURL%/}/$DB"
python3 - "$ROOT" "$TEMP/baseline_extra.sql" > "$TEMP/reporting.sql" <<'PY'
import json, subprocess, sys
from pathlib import Path
root = Path(sys.argv[1])
extra = Path(sys.argv[2]).read_text()
steps = json.loads(subprocess.check_output(['python3', str(root / 'scripts/reporting_fixture.py'), 'policy', '--json'], text=True))
def migration(suffix):
    return next((root / 'supabase/migrations').glob('*_' + suffix + '.sql')).read_text()
out = []
for label, body in steps:
    out.append((label, body))
    if label == 'identity regressions':
        out += [('commission grid schema', migration('commission_grids_schema')),
                ('commission grid operations', migration('commission_grids_operations')),
                ('policy commission tracking', migration('policy_commission_tracking')),
                ('policy commission expected windows', migration('policy_commission_expected_windows')),
                ('baseline normalize_us_state and recruits', extra),
                ('lead conversion preservation', migration('lead_client_conversion_preservation'))]
assert sum(1 for label, _ in out if label == 'lead conversion preservation') == 1
for label, body in out:
    print('-- step: ' + label + '\nBEGIN;\n' + body + '\nCOMMIT;')
PY
sql -f "$TEMP/reporting.sql" > "$TEMP/reporting.log" 2>&1 || { tail -30 "$TEMP/reporting.log"; echo 'FAIL: existing reporting suites with the migration'; exit 1; }
# Those suites assert by raising; ON_ERROR_STOP makes the chain all-or-nothing.
REPORTING_STEPS=$(grep -c '^-- step: ' "$TEMP/reporting.sql")
grep -q 'PASS View As, NULL ownership' "$TEMP/reporting.log" || { tail -30 "$TEMP/reporting.log"; echo 'FAIL: reporting chain did not run'; exit 1; }
echo "PASS existing commission security/handoff/tracking/windows/center/insights suites and the $REPORTING_STEPS-step sale, identity, performance, Sold Date, reconciliation and repair chain with the migration applied"

# ── 7. Independent sessions submit the same conversion at once: exactly one client and one sale ──────────────────
new_db race
sql -c "INSERT INTO leads(id, organization_id, user_id, assigned_agent_id, first_name, last_name, state, notes)
        VALUES (test_id(9201), test_id(1), test_id(11), test_id(11), 'Race', 'Synthetic', 'NY', 'Race note');" >/dev/null
RACE="SELECT pc_login(11); SET ROLE authenticated; SELECT convert_lead_to_client_with_sales_handoff(test_id(9202), test_id(9201), test_id(1),
  pc_client('Race', 11, '50.00') || '{\"notes\": \"Agent note\"}', NULL, pc_payload())->>'client_id';"
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -tA -c "$RACE" > "$TEMP/one" &
RACE_PID=$!
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -tA -c "$RACE" > "$TEMP/two"
wait "$RACE_PID"
cmp "$TEMP/one" "$TEMP/two" || { echo 'FAIL: duplicate submissions differ'; cat "$TEMP/one" "$TEMP/two"; exit 1; }
sql -c "SELECT test_assert((SELECT count(*) FROM clients WHERE lead_id = test_id(9201)) = 1
          AND (SELECT count(*) FROM wins WHERE idempotency_key = 'conversion:' || test_id(9201)) = 1
          AND (SELECT notes = 'Agent note' AND lead_conversion->>'lead_notes' = 'Race note' AND state = 'NY' FROM clients WHERE lead_id = test_id(9201)),
          'concurrent duplicate conversion: exactly once, nothing lost')" >/dev/null
echo 'PASS independent-session duplicate submission converts exactly once'

# ── 8. Rollback: function-only, keeps preserved data and protection, refuses replay, re-apply restores ───────────
new_db rollback
sql > /dev/null <<'SQL'
INSERT INTO leads(id, organization_id, user_id, assigned_agent_id, first_name, last_name, state, date_of_birth, notes)
VALUES (test_id(9301), test_id(1), test_id(11), test_id(11), 'Kept', 'Synthetic', 'WA', '1955-05-05', 'Kept note'),
       (test_id(9302), test_id(1), test_id(11), test_id(11), 'After', 'Synthetic', 'OR', '1956-06-06', 'After note');
SELECT pc_login(11);
SET ROLE authenticated;
SELECT convert_lead_to_client_with_sales_handoff(test_id(9303), test_id(9301), test_id(1), pc_client('Kept', 11, '50.00'), NULL, pc_payload());
RESET ROLE;
SQL
KEPT=$(sql -tAX -c "SELECT md5(to_jsonb(c)::text) FROM clients c WHERE lead_id = test_id(9301)")
sql -1 -f "$ROLLBACK" >/dev/null
test "$(digests)" = '641ba66c96ca4a76f80c9c85eb9caa42 96e8f6e7ecc85d0d5385bf8640a144a6' || { echo 'FAIL: rollback digests'; exit 1; }
test "$(sql -tAX -c "SELECT md5(to_jsonb(c)::text) FROM clients c WHERE lead_id = test_id(9301)")" = "$KEPT" || { echo 'FAIL: rollback changed preserved data'; exit 1; }
sql > /dev/null <<'SQL'
SELECT pc_reject($q$UPDATE public.clients SET lead_conversion = '{}' WHERE lead_id = test_id(9301)$q$, '23514');
SELECT pc_login(11);
SET ROLE authenticated;
SELECT convert_lead_to_client_with_sales_handoff(test_id(9304), test_id(9302), test_id(1), pc_client('After', 11, '50.00'), NULL, pc_payload());
SELECT pc_reject(format($q$SELECT update_client_with_policy_sale(%L, '{"age": 70}')$q$, (SELECT id FROM clients WHERE lead_id = test_id(9301))), '22023');
RESET ROLE;
SELECT test_assert(state IS NULL AND date_of_birth IS NULL AND lead_conversion IS NULL AND notes = 'After note',
                   'after rollback the original converter runs unchanged') FROM clients WHERE lead_id = test_id(9302);
SQL
expect_fail 'not the reviewed post-images; refusing' "$ROLLBACK"
sql -1 -f "$MIGRATION" >/dev/null 2>&1
test "$(digests)" = "$POST_ATOMIC $POST_UPDATE" || { echo 'FAIL: re-apply digests'; exit 1; }
echo 'PASS function-only rollback: exact preimages, preserved data and protection kept, replay refused, re-apply restores'

echo 'PASS lead conversion preservation PostgreSQL suite'
