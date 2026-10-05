#!/usr/bin/env bash
# Disposable localhost PostgreSQL only. Never source an application environment.
set -euo pipefail
: "${PGURL:?Disposable localhost cluster URL without database path required}"
python3 - "$PGURL" <<'PY'
import os,sys,urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
if u.scheme not in ('postgres','postgresql') or u.hostname not in ('localhost','127.0.0.1') or u.path not in ('','/') or u.query or u.fragment:raise SystemExit('REFUSING: disposable localhost cluster required')
for key in ('PGHOST','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGDATABASE'):
 if os.environ.get(key):raise SystemExit('REFUSING: unset '+key)
PY
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$TASK_ROOT"
TASK_TEMP=$(mktemp -d)
TASK_DB=''
cleanup() {
 if [ -n "$TASK_DB" ]; then psql "${PGURL%/}/postgres" -q -c "DROP DATABASE IF EXISTS $TASK_DB" >/dev/null; fi
 rm -rf "$TASK_TEMP"
}
trap cleanup EXIT
if [ "$(psql "${PGURL%/}/postgres" -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != 0 ]; then echo 'REFUSING hosted platform roles'; exit 2; fi
for TASK_MODE in policy booking; do
 TASK_DB="reporting_${TASK_MODE}_test_$$"
 TASK_URL="${PGURL%/}/$TASK_DB"
 psql "${PGURL%/}/postgres" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TASK_DB"
 python3 scripts/reporting_fixture.py "$TASK_MODE" > "$TASK_TEMP/fixture.sql"
 psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -f "$TASK_TEMP/fixture.sql" > "$TASK_TEMP/$TASK_MODE.log" 2>&1 || { tail -35 "$TASK_TEMP/$TASK_MODE.log"; exit 1; }
 REPORTING_TEST_URL="$TASK_URL" node scripts/tests/reporting-concurrency.mjs "$TASK_MODE"
 if [ "$TASK_MODE" = policy ]; then
  TASK_ASOF=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  REPORTING_READ_ONLY_DATABASE_URL="$TASK_URL" node scripts/reconcile_reporting.mjs 00000000-0000-0000-0000-000000000001 "$TASK_ASOF" > "$TASK_TEMP/reconciliation.json"
  python3 - "$TASK_TEMP/reconciliation.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
assert data['bounds']['org']=='00000000-0000-0000-0000-000000000001'
assert len(data['raw_period_totals'])==3
PY
 fi
 psql "${PGURL%/}/postgres" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE $TASK_DB"
 TASK_DB=''
 echo "PASS native $TASK_MODE SQL, permissions and independent-session contention"
done
