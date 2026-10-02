#!/usr/bin/env bash
# Disposable LOCAL PostgreSQL only, synthetic data, no hosted credentials or dialing.
set -euo pipefail
PGURL="${PGURL:?set PGURL to a disposable LOCAL PostgreSQL base URL}"
python3 - "$PGURL" <<'PY'
import sys
from urllib.parse import urlsplit
u=urlsplit(sys.argv[1])
if u.scheme not in ('postgres','postgresql') or u.hostname not in ('127.0.0.1','localhost') or u.path not in ('','/') or u.query or u.fragment:
    sys.exit('REFUSING: expected a loopback PostgreSQL base URL without database/query/fragment')
print(f'Locality proof: {u.scheme}://{u.hostname}:{u.port or 5432}; synthetic-only databases')
PY
PGURL="${PGURL%/}"
if [ "$(psql "$PGURL/postgres" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != '0' ]; then
  echo 'REFUSING: Supabase platform roles indicate a hosted stack'; exit 2
fi
psql "$PGURL/postgres" -v ON_ERROR_STOP=1 -tAc "SELECT 'server='||coalesce(inet_server_addr()::text,'local-socket')||' version='||current_setting('server_version');"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
DB="team_dialer_$$"
CREATED=false
NEGATIVE_DBS=()
cleanup() {
  for db in "${NEGATIVE_DBS[@]:-}"; do
    [ -z "$db" ] || psql "$PGURL/postgres" -q -c "DROP DATABASE IF EXISTS $db;" >/dev/null 2>&1 || true
  done
  if [ "$CREATED" = true ]; then psql "$PGURL/postgres" -q -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
python3 "$ROOT/scripts/team_dialer_test_dependencies.py" "$WORK/deps.sql"
psql "$PGURL/postgres" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $DB;"
CREATED=true
sql() { psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$1"; }
query() { psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -qAt -c "$1"; }
fail() {
  local label="$1" needle="$2"; shift 2
  if "$@" >"$WORK/refusal.log" 2>&1; then echo "FAIL: expected refusal [$label]"; exit 1; fi
  if ! rg -q -- "$needle" "$WORK/refusal.log"; then cat "$WORK/refusal.log"; echo "FAIL: wrong refusal [$label]"; exit 1; fi
  echo "PASS refusal: $label"
}
P1="$ROOT/supabase/migrations/20261002172423_team_dialer_queue_provenance.sql"
ASSOC="$ROOT/supabase/migrations/20261002172455_team_dialer_association_provenance.sql"
P2="$ROOT/supabase/migrations/20261002172541_team_dialer_scoped_display_access.sql"
TEST="$ROOT/supabase/tests"
sql "$WORK/deps.sql"
sql "$TEST/team_dialer_fixtures.sql"
sql "$P1"
sql "$TEST/team_dialer_p1.sql"
fail 'P1 replay' 'preimage drift|replay' sql "$P1"
sql "$ASSOC"
sql "$TEST/team_dialer_associations.sql"
fail 'P1B replay' 'preimage drift|replay' sql "$ASSOC"
fail 'P2 while old active locks remain' 'unproven active locks remain' sql "$P2"
sql "$TEST/team_dialer_transition_release.sql"
fail 'P2 before explicit historical review' 'historical associations require explicit manager review' sql "$P2"
sql "$TEST/team_dialer_reviewed_associations.sql"
query "CREATE TABLE team_test.ready_preimage AS SELECT prosrc FROM pg_proc WHERE oid='public.claim_lead(uuid,uuid,uuid)'::regprocedure;" >/dev/null
# Drift refusal must be atomic, with no client reader created.
query "CREATE OR REPLACE FUNCTION public.claim_lead(uuid,uuid,uuid) RETURNS void LANGUAGE plpgsql AS \$\$ BEGIN NULL; END \$\$;" >/dev/null
fail 'P2 claim drift' 'preimage drift' sql "$P2"
test "$(query "SELECT to_regprocedure('public.get_team_dialer_lead_details(uuid)') IS NULL;")" = t
python3 - "$ROOT" "$WORK/claim_restore.sql" <<'PY'
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('team_deps',Path(sys.argv[1])/'scripts/team_dialer_test_dependencies.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
Path(sys.argv[2]).write_text(m.block(m.BASE,'CREATE OR REPLACE FUNCTION "public"."claim_lead"(')+'\n')
PY
sql "$WORK/claim_restore.sql"
sql "$P2"
fail 'P2 replay' 'preimage drift|replay' sql "$P2"
sql "$TEST/team_dialer_access.sql"
sql "$TEST/team_dialer_concurrency_fixtures.sql"
sql "$TEST/team_dialer_queue_compatibility.sql"

# Real concurrent sessions. A holds its row/ownership transaction during PgSleep; B overlaps it.
wait_sleep() {
  local app="$1" n
  for n in $(seq 1 50); do
    if [ "$(query "SELECT count(*) FROM pg_stat_activity WHERE datname='$DB' AND application_name='$app' AND wait_event='PgSleep';")" = 1 ]; then return; fi
    sleep 0.05
  done
  echo "FAIL: concurrent session $app did not reach its overlap barrier"; exit 1
}
echo 'Native concurrency: canonical queue claims'
PGAPPNAME=team_queue_a psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -qAt -c "BEGIN; SELECT team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(35))); SELECT pg_sleep(2); COMMIT;" >"$WORK/queue_a.json" &
PID_A=$!
wait_sleep team_queue_a
query "SELECT team_test.run(13,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(35)));" >"$WORK/queue_b.json"
wait "$PID_A"
python3 - "$WORK/queue_a.json" "$WORK/queue_b.json" <<'PY'
import json,sys
def obj(p): return next(json.loads(x) for x in open(p) if x.startswith('{'))
a,b=map(obj,sys.argv[1:])
assert a['ok'] and len(a['rows'])==1 and b['ok'] and not b['rows'],(a,b)
print('PASS native SKIP LOCKED: one winner, other agent gets no row')
PY
query "SELECT team_test.assert((SELECT count(*)=1 FROM public.dialer_lead_locks WHERE campaign_lead_id=team_test.id(701)),'one canonical lock');" >/dev/null
query "SELECT team_test.run(13,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(36)));" >"$WORK/other_campaign.json"
echo 'Native concurrency: guarded ownership claims on the same source lead'
PGAPPNAME=team_claim_a psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -qAt -c "BEGIN; SELECT team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(701),team_test.id(151),team_test.id(35))); SELECT pg_sleep(2); COMMIT;" >"$WORK/claim_a.json" &
PID_A=$!
wait_sleep team_claim_a
query "SELECT team_test.run(13,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(702),team_test.id(151),team_test.id(36)));" >"$WORK/claim_b.json"
wait "$PID_A"
python3 - "$WORK/claim_a.json" "$WORK/claim_b.json" <<'PY'
import json,sys
def obj(p): return next(json.loads(x) for x in open(p) if x.startswith('{'))
a,b=map(obj,sys.argv[1:])
assert a['ok'] and not b['ok'] and b['state']=='42501',(a,b)
print('PASS native claim race: first owner retained, second refused')
PY
query "SELECT team_test.assert((SELECT assigned_agent_id=team_test.id(12) FROM public.leads WHERE id=team_test.id(151)),'claim race owner retained');" >/dev/null

# Negative controls each run in their own transaction and ROLLBACK after the first biting assertion.
# The real suite must reject an unsafe reader, missing lock mark, missing association, wrong target,
# removed owner guard, or writable identity. Baseline schema/data are restored even on expected failure.
python3 - "$P2" "$WORK" <<'PY'
import re,sys
from pathlib import Path
s=Path(sys.argv[1]).read_text();out=Path(sys.argv[2])
def fn(name): return re.search(r'CREATE(?: OR REPLACE)? FUNCTION '+re.escape(name)+r'\([\s\S]*?AS (\$[^$]*\$)[\s\S]*?\1;',s)[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
authority=fn('private.has_team_queue_authority');reader=fn('public.get_team_dialer_lead_details');claim=fn('public.claim_lead');identity=fn('private.guard_campaign_lead_identity')
mutants={
 'reader':reader.replace('private.has_team_queue_authority(q.id, true)','true'),
 'mark':authority.replace(' AND k.queue_issued_at IS NOT NULL',''),
 'association':authority.replace('    JOIN private.team_queue_associations a ON a.campaign_lead_id = q.id\n      AND a.campaign_id = q.campaign_id AND a.organization_id = q.organization_id AND a.lead_id = q.lead_id\n',''),
 'target':claim.replace(' AND q.lead_id = p_lead_id',''),
 'owner':authority.replace('AND (l.assigned_agent_id IS NULL OR l.assigned_agent_id = auth.uid())','AND true')+'\n'+claim.replace('AND (assigned_agent_id IS NULL OR assigned_agent_id = a.uid)','AND true'),
 'identity':identity.replace("IF current_user <>","IF false AND current_user <>"),
}
for name,sql in mutants.items():
 Path(out/f'mutant_{name}.sql').write_text('BEGIN;\n'+sql+'\n')
PY
# Rebuild the staged pre-suite state for each negative control so failures are causal.
for name in reader mark association target owner identity; do
  NEG="team_dialer_neg_${name}_$$"
  psql "$PGURL/postgres" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $NEG;"
  NEGATIVE_DBS+=("$NEG")
  if ! (
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$WORK/deps.sql" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$TEST/team_dialer_fixtures.sql" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$P1" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$TEST/team_dialer_p1.sql" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$ASSOC" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$TEST/team_dialer_associations.sql" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$TEST/team_dialer_transition_release.sql" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$TEST/team_dialer_reviewed_associations.sql" &&
    psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q --single-transaction -f "$P2"
  ) >"$WORK/negative_setup.log" 2>&1; then cat "$WORK/negative_setup.log"; exit 1; fi
  cat "$WORK/mutant_${name}.sql" "$TEST/team_dialer_access.sql" >"$WORK/negative.sql"
  fail "negative $name" 'FAIL \[' psql "$PGURL/$NEG" -v ON_ERROR_STOP=1 -q -f "$WORK/negative.sql"
  psql "$PGURL/postgres" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE $NEG;"
done
sql "$ROOT/supabase/ops/team_dialer_display_disable.sql"
sql "$TEST/team_dialer_disabled.sql"
echo 'ALL TEAM DIALER ACCESS PROOFS PASSED; isolated databases dropped; nothing hosted changed.'
