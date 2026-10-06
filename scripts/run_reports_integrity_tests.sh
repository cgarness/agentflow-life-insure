#!/usr/bin/env bash
# Disposable native PostgreSQL only. No production project, credentials or data.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?Set PGURL to a disposable local PostgreSQL URL without a database path}"
export PGURL
python3 - <<'PY'
import os,sys,urllib.parse
try:
 u=urllib.parse.urlsplit(os.environ['PGURL'])
 assert u.scheme in ('postgres','postgresql') and u.hostname in ('127.0.0.1','localhost','::1')
 assert u.path in ('','/') and not u.query and not u.fragment and u.port
except (AssertionError,ValueError):
 sys.exit('REFUSING: require an exact loopback host, explicit port, no database path/query/fragment.')
print('Locality URL check passed; checking for hosted platform roles.')
PY
REPORTS_TEST_BASE="${PGURL%/}"
if [[ "$(psql "$REPORTS_TEST_BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != "0" ]]; then
  echo 'REFUSING: Supabase platform roles detected.'; exit 2
fi
REPORTS_TEST_DB="reports_integrity_$(date +%s)_$$"
REPORTS_TEST_SQL="$(mktemp)"
REPORTS_TEST_CREATED=false
cleanup() {
  rm -f "$REPORTS_TEST_SQL"
  if "$REPORTS_TEST_CREATED"; then dropdb --if-exists --maintenance-db="$REPORTS_TEST_BASE/postgres" "$REPORTS_TEST_DB"; fi
}
trap cleanup EXIT
createdb --maintenance-db="$REPORTS_TEST_BASE/postgres" "$REPORTS_TEST_DB"
REPORTS_TEST_CREATED=true
python3 scripts/reports_integrity_fixture.py > "$REPORTS_TEST_SQL"
psql "$REPORTS_TEST_BASE/$REPORTS_TEST_DB" -X -v ON_ERROR_STOP=1 -f "$REPORTS_TEST_SQL"
python3 scripts/reports_integrity_fixture.py --payload-sql > "$REPORTS_TEST_SQL"
psql "$REPORTS_TEST_BASE/$REPORTS_TEST_DB" -XAt -v ON_ERROR_STOP=1 -f "$REPORTS_TEST_SQL" > reports-integrity-payloads.json
echo 'All native Reports integrity semantics, controls and recovery proofs passed.'
