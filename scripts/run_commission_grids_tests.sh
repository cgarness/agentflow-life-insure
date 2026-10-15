#!/usr/bin/env bash
# Commission grids: every database proof on a DISPOSABLE localhost PostgreSQL cluster (AGENT_RULES
# invariant #28). Synthetic data only. Refuses anything but a loopback cluster without hosted roles.
#   PGURL=postgres://postgres:<password>@127.0.0.1:<port> bash scripts/run_commission_grids_tests.sh
# Steps: migration order and replay guards · schema / access / operations suites · the editor's change sets
# against the real operation (vitest) · importer unit tests,
# synthetic artifact, import suite, CSV reconciliation and ops scripts · negative controls (the assertions
# bite) · concurrency proofs · non-destructive rollback.
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
PREFIX="comp_grids_test_$$"
TEMP=$(mktemp -d)
DATABASES=()
cleanup() {
  for db in "${DATABASES[@]}"; do psql "$ADMIN_URL" -qX -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true; done
  psql "$ADMIN_URL" -qX -c "DROP ROLE IF EXISTS agentflow_comp_operator" >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
if [ "$(psql "$ADMIN_URL" -tAX -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != 0 ]; then
  echo 'REFUSING hosted platform roles'; exit 2
fi
echo "PostgreSQL: $(psql "$ADMIN_URL" -tAX -c 'SHOW server_version')"

MIGRATIONS=(20261015120000_commission_grids_schema 20261015120100_commission_grids_operations 20261015120200_commission_grids_reference_import)
FIXTURE="$ROOT/supabase/tests/fixtures/commission_grids/synthetic_reference_grid.csv"

# The canonical actor resolver, extracted verbatim from the migration that defines it.
python3 - "$ROOT" > "$TEMP/campaign_actor.sql" <<'PY'
import sys
from pathlib import Path
src = (Path(sys.argv[1]) / 'supabase/migrations/20260811200920_campaign_leads_membership_uniqueness_and_attachment_core.sql').read_text()
start = src.index('CREATE OR REPLACE FUNCTION private.campaign_actor()')
end = src.index('REVOKE ALL ON FUNCTION private.campaign_actor() FROM PUBLIC, anon, authenticated;', start)
print(src[start:src.index('\n', end) + 1])
PY

sql() { psql "$DB_URL" -qX -v ON_ERROR_STOP=1 "$@"; }
# new_db NAME [bare]: a fresh database with the harness and actor resolver (and the migrations unless bare).
new_db() {
  local db="${PREFIX}_$1"
  # Roles are cluster-global, unlike databases. Each scenario must remove the previous disposable
  # database first, then its operation role, or the next fresh migration would correctly see a collision.
  for old_db in "${DATABASES[@]}"; do
    psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $old_db WITH (FORCE)" >/dev/null
  done
  DATABASES=()
  psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS agentflow_comp_operator" >/dev/null
  psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db" >/dev/null
  DATABASES+=("$db")
  DB_URL="${PGURL%/}/$db"
  sql -f "$ROOT/supabase/tests/commission_grids_harness.sql" >/dev/null
  sql -f "$TEMP/campaign_actor.sql" >/dev/null
  if [ "${2:-}" != bare ]; then
    for m in "${MIGRATIONS[@]}"; do sql -1 -f "$ROOT/supabase/migrations/$m.sql" >/dev/null; done
  fi
}
# weaken FILE START REGEX: print the function that starts at START in a migration as CREATE OR REPLACE, with
# the text matching REGEX removed; refuses if REGEX matches nothing (a control must never become a no-op).
weaken() {
  python3 - "$@" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
i = src.index(sys.argv[2]); j = src.index('END $$;', i) + len('END $$;')
body = src[i:j]
out = re.sub(sys.argv[3], '', body, count=1, flags=re.S)
if out == body:
    raise SystemExit('weaken: pattern not found')
print(out.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1))
PY
}
# expect_failure LABEL PATTERN -- command...: the command must fail and its output must match PATTERN.
expect_failure() {
  local label=$1 pattern=$2; shift 3
  if "$@" > "$TEMP/fail.out" 2>&1; then echo "FAIL: $label unexpectedly succeeded"; cat "$TEMP/fail.out"; exit 1; fi
  grep -q -- "$pattern" "$TEMP/fail.out" || { echo "FAIL: $label failed for the wrong reason"; cat "$TEMP/fail.out"; exit 1; }
  echo "   ok   $label"
}
# run_suite NAME [psql args]: run one suite in the current database and require its ALL PASSED line.
run_suite() {
  local name=$1; shift
  if ! sql "$@" -f "$ROOT/supabase/tests/commission_grids_$name.sql" > "$TEMP/$name.out" 2>&1; then cat "$TEMP/$name.out"; exit 1; fi
  grep -q "commission_grids_$name: ALL PASSED" "$TEMP/$name.out" || { cat "$TEMP/$name.out"; exit 1; }
  sed -n 's/^.*NOTICE:  /   ok   /p' "$TEMP/$name.out"
}

echo '== 1. migration order and replay guards'
new_db order bare
expect_failure 'operations before schema refused' 'apply 20261015120000_commission_grids_schema first' -- sql -1 -f "$ROOT/supabase/migrations/${MIGRATIONS[1]}.sql"
expect_failure 'reference import before operations refused' 'apply the commission grid schema and operations migrations first' -- sql -1 -f "$ROOT/supabase/migrations/${MIGRATIONS[2]}.sql"
new_db replay
for m in "${MIGRATIONS[@]}"; do
  expect_failure "replay of $m refused" 'refusing replay' -- sql -1 -f "$ROOT/supabase/migrations/$m.sql"
done

echo '== 2. schema, access and operations suites'
for suite in schema access operations; do
  new_db "$suite"
  run_suite "$suite"
done

new_db contract
# NO_COLOR keeps the summary plain: Vitest colors it whenever CI is set, which would break the check below.
(cd "$ROOT" && NO_COLOR=1 COMP_DB_URL="$DB_URL" npx vitest run src/lib/commission/__tests__/changeSetServer.integration.test.ts) > "$TEMP/contract.out" 2>&1 || { cat "$TEMP/contract.out"; exit 1; }
grep -q 'Tests  2 passed' "$TEMP/contract.out" || { cat "$TEMP/contract.out"; exit 1; }
echo '   ok   editor change sets: real comp_save_grid_changes as an agency admin; read-back equals the draft; stale refused'

echo '== 3. importer, synthetic artifact, import suite, reconciliation, ops scripts'
python3 "$ROOT/scripts/tests/comp_grids/test_reference_grid_importer.py" > "$TEMP/unit.out" 2>&1 || { cat "$TEMP/unit.out"; exit 1; }
echo "   ok   importer unit tests ($(grep -o 'Ran [0-9]* tests' "$TEMP/unit.out"))"
ARTIFACT="$TEMP/synthetic.comp_reference_grid.json"
python3 "$ROOT/scripts/comp_grids/reference_grid_importer.py" build --csv "$FIXTURE" \
  --grid-name 'Synthetic Reference Grid' --effective-date 2025-01-15 \
  --expect-products 6 --expect-variants 9 --expect-carriers 4 --out "$ARTIFACT" > "$TEMP/build.json"
ARTIFACT_SHA=$(sha256sum "$ARTIFACT" | cut -d' ' -f1)
GRID_ID=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["artifact_sha256"]==sys.argv[2]; print(d["grid"]["id"])' "$TEMP/build.json" "$ARTIFACT_SHA")
echo "   ok   synthetic artifact built (deterministic id $GRID_ID)"
new_db import
run_suite import -v artifact_path="$ARTIFACT" -v artifact_sha256="$ARTIFACT_SHA"
sql -v grid_id="$GRID_ID" -f "$ROOT/scripts/comp_grids/reconcile_reference_grid.sql" < "$FIXTURE" > "$TEMP/recon.out" 2>&1 || { cat "$TEMP/recon.out"; exit 1; }
grep -q 'reconciliation PASS' "$TEMP/recon.out" || { cat "$TEMP/recon.out"; exit 1; }
sed -n 's/^.*NOTICE:  /   ok   /p' "$TEMP/recon.out"
expect_failure 'ops import refused without the approval setting' 'approve_comp_reference_import=yes' -- \
  sql -v artifact_path="$ARTIFACT" -v artifact_sha256="$ARTIFACT_SHA" -f "$ROOT/supabase/ops/commission_grids_import_reference_grid.sql"
PGOPTIONS='-c agentflow.approve_comp_reference_import=yes' sql -tA -v artifact_path="$ARTIFACT" -v artifact_sha256="$ARTIFACT_SHA" \
  -f "$ROOT/supabase/ops/commission_grids_import_reference_grid.sql" > "$TEMP/ops.out" 2>&1 || { cat "$TEMP/ops.out"; exit 1; }
grep -q '"already_imported"' "$TEMP/ops.out" || { cat "$TEMP/ops.out"; exit 1; }
echo '   ok   ops import with approval is idempotent (already_imported)'
expect_failure 'ops activation refused without the approval setting' 'approve_comp_home_activation=yes' -- \
  sql -f "$ROOT/supabase/ops/commission_grids_activate_home_agency.sql"
expect_failure 'ops activation fails closed where the agency does not exist' 'found 0' -- \
  env PGOPTIONS='-c agentflow.approve_comp_home_activation=yes' psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -f "$ROOT/supabase/ops/commission_grids_activate_home_agency.sql"
expect_failure 'ops availability refused without the approval setting' 'approve_comp_home_availability=yes' -- \
  sql -f "$ROOT/supabase/ops/commission_grids_make_available_home_agency.sql"
expect_failure 'ops availability fails closed where the agency does not exist' 'found 0' -- \
  env PGOPTIONS='-c agentflow.approve_comp_home_availability=yes' psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -f "$ROOT/supabase/ops/commission_grids_make_available_home_agency.sql"
sql -c "INSERT INTO public.organizations (name) VALUES ('Family First Life - Chris Garness')" >/dev/null
expect_failure 'ops availability fails closed while that grid has no verified import here' 'no verified reference import' -- \
  env PGOPTIONS='-c agentflow.approve_comp_home_availability=yes' psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -f "$ROOT/supabase/ops/commission_grids_make_available_home_agency.sql"
expect_failure 'ops activation fails closed while that grid has no verified import here' 'no verified reference import' -- \
  env PGOPTIONS='-c agentflow.approve_comp_home_activation=yes' psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -f "$ROOT/supabase/ops/commission_grids_activate_home_agency.sql"

echo '== 3b. production-style restricted SET probe'
sql -c "DROP ROLE IF EXISTS comp_restricted_set_probe; CREATE ROLE comp_restricted_set_probe NOLOGIN NOSUPERUSER; GRANT USAGE,CREATE ON SCHEMA public TO comp_restricted_set_probe; GRANT comp_restricted_set_probe TO postgres" >/dev/null
expect_failure 'non-super function owner cannot use a restricted SET parameter' 'permission denied to set parameter' -- sql -c "SET ROLE comp_restricted_set_probe; CREATE FUNCTION public.comp_restricted_set_probe_fn() RETURNS void LANGUAGE plpgsql SET session_replication_role='replica' AS \\$\\$ BEGIN NULL; END \\$\\$"
sql -c "REVOKE comp_restricted_set_probe FROM postgres; DROP ROLE comp_restricted_set_probe" >/dev/null

echo '== 3c. production-style non-super CREATEROLE ownership transfer'
sql -c "DROP ROLE IF EXISTS comp_prod_child_probe; DROP ROLE IF EXISTS comp_prod_owner_probe; CREATE ROLE comp_prod_owner_probe NOLOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOBYPASSRLS; GRANT comp_prod_owner_probe TO postgres; CREATE SCHEMA comp_prod_probe AUTHORIZATION comp_prod_owner_probe" >/dev/null
sql -c "SET ROLE comp_prod_owner_probe; CREATE FUNCTION comp_prod_probe.before_transfer() RETURNS integer LANGUAGE sql AS 'SELECT 1'; CREATE ROLE comp_prod_child_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; GRANT comp_prod_child_probe TO comp_prod_owner_probe; GRANT USAGE,CREATE ON SCHEMA comp_prod_probe TO comp_prod_child_probe; ALTER FUNCTION comp_prod_probe.before_transfer() OWNER TO comp_prod_child_probe; REVOKE CREATE ON SCHEMA comp_prod_probe FROM comp_prod_child_probe; RESET ROLE" >/dev/null
[ "$(sql -tA -c "SELECT (NOT r.rolsuper AND NOT r.rolcanlogin AND NOT r.rolbypassrls AND NOT has_schema_privilege('comp_prod_child_probe','comp_prod_probe','CREATE') AND pg_has_role('comp_prod_owner_probe','comp_prod_child_probe','MEMBER')) FROM pg_roles r WHERE r.rolname='comp_prod_child_probe'")" = t ] || { echo 'FAIL: non-super CREATEROLE ownership-transfer proof'; exit 1; }
sql -c "DROP SCHEMA comp_prod_probe CASCADE; REVOKE comp_prod_child_probe FROM comp_prod_owner_probe; REVOKE comp_prod_owner_probe FROM postgres; DROP ROLE comp_prod_child_probe; DROP ROLE comp_prod_owner_probe" >/dev/null
echo '   ok   non-super CREATEROLE can create/narrow/self-grant child and transfer ownership'

echo '== 4. negative controls (each weakening must make a named assertion fail)'
sed 's/,87\.50,/,87.5,/' "$FIXTURE" > "$TEMP/tampered.csv"
cmp -s "$FIXTURE" "$TEMP/tampered.csv" && { echo 'FAIL: tampering did not change the CSV'; exit 1; }
expect_failure 'reconciliation catches one changed source value' 'reconciliation FAIL' -- \
  sql -v grid_id="$GRID_ID" -f "$ROOT/scripts/comp_grids/reconcile_reference_grid.sql" < "$TEMP/tampered.csv"
new_db neg_grant
sql -c 'GRANT UPDATE (organization_id) ON public.comp_grids TO authenticated' >/dev/null
expect_failure 'access suite detects a widened browser grant' 'A10h' -- sql -f "$ROOT/supabase/tests/commission_grids_access.sql"
new_db neg_role
sql -c 'ALTER ROLE agentflow_comp_operator BYPASSRLS' >/dev/null
expect_failure 'access suite detects a BYPASSRLS operation role' 'A10e' -- sql -f "$ROOT/supabase/tests/commission_grids_access.sql"
new_db neg_membership
sql -c 'GRANT agentflow_comp_operator TO authenticated' >/dev/null
expect_failure 'access suite detects client membership in operation role' 'A10f' -- sql -f "$ROOT/supabase/tests/commission_grids_access.sql"
new_db neg_availability
weaken "$ROOT/supabase/migrations/${MIGRATIONS[0]}.sql" 'CREATE FUNCTION private.comp_access_rules()' \
  '\n  PERFORM 1 FROM public\.organization_comp_grid_availability v\n.*?FOR SHARE;\n  IF NOT FOUND THEN\n.*?\n  END IF;' > "$TEMP/neg_access_rules.sql"
sql -c 'ALTER TABLE public.organization_comp_grids DROP CONSTRAINT organization_comp_grids_available_fk' >/dev/null
sql -f "$TEMP/neg_access_rules.sql" >/dev/null
expect_failure 'access suite detects enabling without availability' 'A4m' -- sql -f "$ROOT/supabase/tests/commission_grids_access.sql"
new_db neg_catalog
weaken "$ROOT/supabase/migrations/${MIGRATIONS[1]}.sql" 'CREATE FUNCTION public.comp_list_shared_grid_catalog()' \
  '\n\s+AND EXISTS \(SELECT 1 FROM public\.organization_comp_grid_availability v\n\s+WHERE v\.organization_id = v_org AND v\.grid_id = g\.id\)' > "$TEMP/neg_catalog.sql"
sql -f "$TEMP/neg_catalog.sql" >/dev/null
expect_failure 'access suite detects a catalog that ignores availability' 'A4l' -- sql -f "$ROOT/supabase/tests/commission_grids_access.sql"
new_db neg_variants
sql -c 'DROP TRIGGER comp_50_variant_rules ON public.comp_product_variants' >/dev/null
expect_failure 'operations suite detects missing variant rules' 'O4g' -- sql -f "$ROOT/supabase/tests/commission_grids_operations.sql"
new_db neg_precision
sql -c 'ALTER TABLE public.comp_rates DROP CONSTRAINT comp_rates_rate_valid' >/dev/null
expect_failure 'schema suite detects a missing rate CHECK' 'S3' -- sql -f "$ROOT/supabase/tests/commission_grids_schema.sql"

echo '== 5. concurrency (independent sessions, waits proven via pg_stat_activity)'
new_db concurrency
COMP_DB_URL="$DB_URL" node "$ROOT/scripts/commission_grids_concurrency.mjs" > "$TEMP/concurrency.out" 2>&1 || { cat "$TEMP/concurrency.out"; exit 1; }
grep -q 'CONCURRENCY: ALL PASSED' "$TEMP/concurrency.out" || { cat "$TEMP/concurrency.out"; exit 1; }
echo "   ok   $(grep -c '^   ok' "$TEMP/concurrency.out") concurrency assertions in $(grep -c '^-- ' "$TEMP/concurrency.out") scenarios"

echo '== 6. non-destructive rollback (reverse order only; refuses while any row exists)'
new_db rollback
RB="$ROOT/supabase/migrations/rollback"
expect_failure 'schema rollback refused before the operations rollback' 'roll back 20261015120100_commission_grids_operations first' -- sql -1 -f "$RB/${MIGRATIONS[0]}.rollback.sql"
expect_failure 'operations rollback refused before the import rollback' 'roll back 20261015120200_commission_grids_reference_import first' -- sql -1 -f "$RB/${MIGRATIONS[1]}.rollback.sql"
sql -1 -f "$RB/${MIGRATIONS[2]}.rollback.sql" >/dev/null
sql -1 -f "$RB/${MIGRATIONS[1]}.rollback.sql" >/dev/null
sql -c "INSERT INTO public.organizations (id, name) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'Synthetic Agency A')" >/dev/null
sql -c "INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'Synthetic', '2025-01-01', ARRAY[100], 'blank')" >/dev/null
expect_failure 'schema rollback refuses while a row exists' 'refusing a destructive rollback' -- sql -1 -f "$RB/${MIGRATIONS[0]}.rollback.sql"
sql -c 'DELETE FROM public.comp_grids' >/dev/null
sql -1 -f "$RB/${MIGRATIONS[0]}.rollback.sql" >/dev/null
LEFT=$(sql -tA -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND (c.relname LIKE 'comp\_%' OR c.relname LIKE 'organization\_comp\_%')")
LEFT=$((LEFT + $(sql -tA -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE (n.nspname IN ('public','private') AND (p.proname LIKE 'comp\_%' OR p.proname LIKE '%commission\_calculator%')) OR n.nspname = 'comp_authz'")))
LEFT=$((LEFT + $(sql -tA -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'comp_authz'")))
LEFT=$((LEFT + $(sql -tA -c "SELECT count(*) FROM pg_roles WHERE rolname = 'agentflow_comp_operator'")))
[ "$LEFT" = 0 ] || { echo "FAIL: $LEFT commission object(s)/role(s) left after rollback"; exit 1; }
echo '   ok   empty-database rollback leaves no commission object'
for m in "${MIGRATIONS[@]}"; do sql -1 -f "$ROOT/supabase/migrations/$m.sql" >/dev/null; done
echo '   ok   migrations re-apply cleanly after rollback'

echo 'PASS commission grids database suites (synthetic data, disposable localhost cluster)'
