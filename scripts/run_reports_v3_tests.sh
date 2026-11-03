#!/usr/bin/env bash
# Reports v3 suites. Disposable native PostgreSQL only: no production project, credentials or data.
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
psql "$REPORTS_TEST_BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT 'PostgreSQL ' || current_setting('server_version')"
REPORTS_TEST_DB="reports_v3_$(date +%s)_$$"
REPORTS_TEST_SQL="$(mktemp)"
REPORTS_TEST_CREATED=false
cleanup() {
  rm -f "$REPORTS_TEST_SQL"
  if "$REPORTS_TEST_CREATED"; then dropdb --if-exists --maintenance-db="$REPORTS_TEST_BASE/postgres" "$REPORTS_TEST_DB"; fi
}
trap cleanup EXIT
createdb --maintenance-db="$REPORTS_TEST_BASE/postgres" "$REPORTS_TEST_DB"
REPORTS_TEST_CREATED=true
python3 scripts/reports_v3_fixture.py > "$REPORTS_TEST_SQL"
psql "$REPORTS_TEST_BASE/$REPORTS_TEST_DB" -X -v ON_ERROR_STOP=1 -f "$REPORTS_TEST_SQL"
echo 'All Reports v3 contract, registry, seal and refusal proofs passed.'
# Optional payload file (D1 X9): REPORTS_V3_PAYLOADS=<absolute path> loads the synthetic scale organization on top of
# the suites and writes every report reader's real response for one actor (agency, team, personal). Test input only.
if [[ -n "${REPORTS_V3_PAYLOADS:-}" ]]; then
  if [[ "${REPORTS_V3_PERF:-1}" == 0 ]]; then  # otherwise the suites' performance stage already loaded it
    python3 scripts/reports_v3_fixture.py --part setup > "$REPORTS_TEST_SQL"
    psql "$REPORTS_TEST_BASE/$REPORTS_TEST_DB" -X -q -v ON_ERROR_STOP=1 -f "$REPORTS_TEST_SQL" > /dev/null
  fi
  python3 scripts/reports_v3_fixture.py --part payloads > "$REPORTS_TEST_SQL"
  psql "$REPORTS_TEST_BASE/$REPORTS_TEST_DB" -X -q -v ON_ERROR_STOP=1 -v payloads="$REPORTS_V3_PAYLOADS" -f "$REPORTS_TEST_SQL"
  python3 - "$REPORTS_V3_PAYLOADS" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
keys = ['scopeV3', 'summaryV3', 'journeyV3', 'salesAppointmentsV3', 'statesV3', 'volumeV3', 'dispositionsV3', 'campaignsV3', 'leadSourcesV3']
for scope in ('agency', 'team', 'personal'):
    b = p if scope == 'agency' else p['scopes'][scope]
    for k in keys:
        assert isinstance(b.get(k), dict) and b[k].get('basis_version') == 'reports_v3', f'{scope}/{k}: not a v3 payload'
        assert b[k].get('requested_scope') == scope, f'{scope}/{k}: scope mismatch'
print('Wrote the v3 payload file (synthetic):', sys.argv[1])
PY
fi
