#!/usr/bin/env bash
# Reports v3 differential evidence (Batch 7, Phase E). Disposable native PostgreSQL only: no production project,
# credentials or data.
#
# Builds a fresh database with the functional v3 suites, installs the frozen reviewed baseline as schema rtref
# (scripts/reports_v3_reference.py, every hash checked against the manifest), compares the code under test with it on
# the fixtures (supabase/tests/reports_v3_differential.sql part 1), loads the 500k scale fixture of
# reports_v3_performance.sql and compares again (part 2).
#
# Evidence is sanitized (outcomes, counts and sha256 digests; no payload bodies) and goes to
# $REPORTS_V3_EVIDENCE_DIR/differential (default: a new temporary directory), never into the working tree.
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
BASE="${PGURL%/}"
# One isolated journey reader case (dispatch-only verification): checked here before the long setup, and again in the
# SQL against the pinned inventory (exactly one journey row must match).
if [[ -n "${REPORTS_V3_DX_JOURNEY_CASE:-}" ]]; then
  [[ "$REPORTS_V3_DX_JOURNEY_CASE" =~ ^[0-9]+:(agency|team|personal):[0-9]+:(-|[0-9]+)$ ]] || { echo 'REFUSING: REPORTS_V3_DX_JOURNEY_CASE must be persona:scope:days:filter'; exit 2; }
  [[ "${REPORTS_V3_DX_JOURNEY_SCALE:-0}" == 0 ]] || { echo 'REFUSING: a journey case selector excludes REPORTS_V3_DX_JOURNEY_SCALE=1'; exit 2; }
  [[ "${REPORTS_V3_DX_CASE_DEADLINE_MINUTES:-}" =~ ^[0-9]+$ ]] && (( REPORTS_V3_DX_CASE_DEADLINE_MINUTES >= 1 && REPORTS_V3_DX_CASE_DEADLINE_MINUTES <= 340 )) \
    || { echo 'REFUSING: a journey case needs REPORTS_V3_DX_CASE_DEADLINE_MINUTES between 1 and 340'; exit 2; }
  echo "Journey case mode: $REPORTS_V3_DX_JOURNEY_CASE (comparison deadline ${REPORTS_V3_DX_CASE_DEADLINE_MINUTES} min)"
fi
if [[ "$(psql "$BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != "0" ]]; then
  echo 'REFUSING: Supabase platform roles detected.'; exit 2
fi
psql "$BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT 'PostgreSQL ' || current_setting('server_version')"

EVIDENCE="${REPORTS_V3_EVIDENCE_DIR:-$(mktemp -d)}/differential"
mkdir -p "$EVIDENCE"
case "$(cd "$EVIDENCE" && pwd -P)/" in
  "$(pwd -P)/"*) echo 'REFUSING: the evidence directory must be outside the working tree.'; exit 2 ;;
esac
DB="reports_v3_dx_$(date +%s)_$$"
WORK="$(mktemp -d)"
CREATED=false
cleanup() {
  rm -rf "$WORK"
  if "$CREATED"; then dropdb --if-exists --maintenance-db="$BASE/postgres" "$DB"; fi
}
trap cleanup EXIT
createdb --maintenance-db="$BASE/postgres" "$DB"
CREATED=true

REPORTS_V3_PERF=0 python3 scripts/reports_v3_fixture.py > "$WORK/functional.sql"
python3 scripts/reports_v3_reference.py --out "$WORK/reference.sql"
python3 scripts/reports_v3_fixture.py --part setup > "$WORK/scale.sql"
python3 - "$WORK" <<'PY'
import sys
text = open('supabase/tests/reports_v3_differential.sql', encoding='utf-8').read()
marker = '-- @@differential-scale@@'
assert text.count(marker) == 1, marker
part1, part2 = text.split(marker)
open(sys.argv[1] + '/part1.sql', 'w', encoding='utf-8').write(part1)
open(sys.argv[1] + '/part2.sql', 'w', encoding='utf-8').write(part2)
PY

run() { psql "$BASE/$DB" -X -q -v ON_ERROR_STOP=1 "$@"; }
echo '== functional v3 suites'
run -f "$WORK/functional.sql" > "$WORK/functional.log" 2>&1 || { tail -40 "$WORK/functional.log"; exit 1; }
echo '== frozen reference (rtref)'
run -f "$WORK/reference.sql" > /dev/null
run -c 'ANALYZE'
echo '== differential, part 1: functional fixtures'
run -v dx_cases="$EVIDENCE/fixtures-cases.jsonl" -v dx_summary="$EVIDENCE/fixtures-summary.json" -f "$WORK/part1.sql"
echo '== scale fixture (500,000 calls)'
run -f "$WORK/scale.sql" > "$WORK/scale.log" 2>&1 || { tail -40 "$WORK/scale.log"; exit 1; }
echo '== differential, part 2: scale organization'
run -v dx_scale_cases="$EVIDENCE/scale-cases.jsonl" -v dx_scale_summary="$EVIDENCE/scale-summary.json" -f "$WORK/part2.sql"

python3 - "$EVIDENCE" "$(psql "$BASE/$DB" -XAt -c 'SHOW server_version')" <<'PY'
import hashlib, json, os, subprocess, sys
evidence, server = sys.argv[1], sys.argv[2]
def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()
head = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
dirty = subprocess.run(['git', 'status', '--porcelain', '--', 'supabase', 'scripts'], capture_output=True, text=True, check=True).stdout.strip() != ''
manifest_path = 'supabase/tests/reference/reports_v3_reference_manifest.json'
manifest = json.load(open(manifest_path))
files = {name: sha(os.path.join(evidence, name)) for name in sorted(os.listdir(evidence)) if name != 'manifest.json'}
json.dump({'kind': 'reports-v3-differential', 'tested_commit': head, 'working_tree_dirty': dirty, 'server_version': server,
           'baseline_commit': manifest['baseline_commit'], 'reference_manifest_sha256': sha(manifest_path),
           'generated_reference_sha256': manifest['generated_sha256'],
           'approved_differences': manifest.get('approved_differences', []), 'files': files},
          open(os.path.join(evidence, 'manifest.json'), 'w'), indent=2)
print('Evidence:', evidence)
PY
echo 'Reports v3 differential evidence passed: no mismatch against the reviewed baseline.'
