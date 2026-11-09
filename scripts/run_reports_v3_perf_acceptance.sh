#!/usr/bin/env bash
# Reports v3 performance acceptance (Batch 7, Phase E). Disposable native PostgreSQL only: no production project,
# credentials or data.
#
# Builds a fresh database with the functional v3 suites and the 500k scale fixture, then runs
# supabase/tests/reports_v3_performance.sql stage by stage, each in its own psql session:
#   measure  one warm-up round and REPORTS_V3_PERF_SAMPLES measured rounds, interleaved over the planned combinations
#   restart  after REPORTS_V3_RESTART_CMD restarts PostgreSQL: one first-after-restart round (not a cold-cache claim:
#            the operating system's page cache may still hold the data files)
#   explain  instrumented EXPLAIN (ANALYZE, BUFFERS), separate from the samples; plans go to their own file
#   finish   seal check, the gate's own controls, the verdict JSON, then the gate (REPORTS_V3_PERF_ENFORCE=1 raises)
#
# REPORTS_V3_PERF_MODE:
#   acceptance        PostgreSQL 17.6, 147 combinations, >= 20 samples, enforcement and the restart round are required;
#                     anything less refuses to start
#   diagnostic        report-only; never acceptance evidence
#   negative-control  the scope reader slowed by 2.2 s in the disposable database; this run must fail
#
# Evidence goes to $REPORTS_V3_EVIDENCE_DIR/performance (default: a new temporary directory), never into the working
# tree: verdicts.json, results.txt, plans.txt, environment.json, seal.txt and manifest.json (sha256 of every file). The
# EXIT trap always attempts the seal check and writes a failure verdict and the manifest, then drops the database.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?Set PGURL to a disposable local PostgreSQL URL without a database path}"
export PGURL
MODE="${REPORTS_V3_PERF_MODE:-diagnostic}"
SAMPLES="${REPORTS_V3_PERF_SAMPLES:-20}"
ENFORCE="${REPORTS_V3_PERF_ENFORCE:-0}"
RESTART_CMD="${REPORTS_V3_RESTART_CMD:-}"
case "$MODE" in acceptance|diagnostic|negative-control) ;; *) echo "REFUSING: unknown REPORTS_V3_PERF_MODE $MODE"; exit 2 ;; esac
[[ "$SAMPLES" =~ ^[0-9]+$ ]] && (( SAMPLES >= 3 && SAMPLES <= 100 )) || { echo 'REFUSING: REPORTS_V3_PERF_SAMPLES must be 3..100'; exit 2; }
if [[ "$MODE" == acceptance ]]; then
  [[ "$ENFORCE" == 1 ]] || { echo 'REFUSING: acceptance requires REPORTS_V3_PERF_ENFORCE=1'; exit 2; }
  (( SAMPLES >= 20 )) || { echo 'REFUSING: acceptance requires at least 20 measured samples'; exit 2; }
  [[ -n "$RESTART_CMD" ]] || { echo 'REFUSING: acceptance requires REPORTS_V3_RESTART_CMD for the first-after-restart round'; exit 2; }
fi
if [[ "$MODE" == negative-control && "$ENFORCE" != 1 ]]; then
  echo 'REFUSING: the negative control runs the enforced gate (REPORTS_V3_PERF_ENFORCE=1)'; exit 2
fi
ENFORCE_SQL=$([[ "$ENFORCE" == 1 ]] && echo true || echo false)
RESTART_SQL=$([[ -n "$RESTART_CMD" ]] && echo true || echo false)

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
if [[ "$(psql "$BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != "0" ]]; then
  echo 'REFUSING: Supabase platform roles detected.'; exit 2
fi
SERVER_NUM="$(psql "$BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SHOW server_version_num")"
psql "$BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT 'PostgreSQL ' || current_setting('server_version')"
if [[ "$MODE" == acceptance && "$SERVER_NUM" != 170006 ]]; then
  echo "REFUSING: acceptance requires PostgreSQL 17.6 (server_version_num $SERVER_NUM)"; exit 2
fi

EVIDENCE="${REPORTS_V3_EVIDENCE_DIR:-$(mktemp -d)}/performance"
mkdir -p "$EVIDENCE"
case "$(cd "$EVIDENCE" && pwd -P)/" in
  "$(pwd -P)/"*) echo 'REFUSING: the evidence directory must be outside the working tree.'; exit 2 ;;
esac
DB="reports_v3_perf_$(date +%s)_$$"
WORK="$(mktemp -d)"
CREATED=false
STAGE=start

python3 - "$EVIDENCE/environment.json" "$MODE" "$SAMPLES" "$ENFORCE" "$RESTART_SQL" <<'PY'
import json, os, platform, subprocess, sys
def read(path):
    try:
        return open(path).read()
    except OSError:
        return ''
cpu = [l.split(':', 1)[1].strip() for l in read('/proc/cpuinfo').splitlines() if l.startswith('model name')]
mem = [l.split(':', 1)[1].strip() for l in read('/proc/meminfo').splitlines() if l.startswith('MemTotal')]
head = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(['git', 'status', '--porcelain', '--', 'supabase', 'scripts', 'src'], capture_output=True, text=True).stdout.strip() != ''
env = {k: os.environ.get(k) for k in ['RUNNER_NAME', 'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion', 'GITHUB_RUN_ID',
                                      'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_SHA', 'REPORTS_V3_RUN_LABEL', 'REPORTS_V3_IMAGE']}
json.dump({'tested_commit': head, 'working_tree_dirty': dirty, 'mode': sys.argv[2], 'samples': int(sys.argv[3]),
           'enforce': sys.argv[4] == '1', 'restart_round': sys.argv[5] == 'true',
           'cpu_model': cpu[0] if cpu else None, 'cpu_count': os.cpu_count(), 'memory_total': mem[0] if mem else None,
           'kernel': platform.release(), 'platform': platform.platform(), 'runner': env},
          open(sys.argv[1], 'w'), indent=2)
PY

run() { psql "$BASE/$DB" -X -q -v ON_ERROR_STOP=1 "$@"; }
vars=(-v perf_samples="$SAMPLES" -v perf_mode="$MODE" -v perf_enforce="$ENFORCE_SQL" -v perf_restart="$RESTART_SQL")

finish_evidence() {
  local rc=$?
  set +e
  if "$CREATED"; then
    # The seal holds after any outcome: revoke the measurement grants and assert the creation-migration seal.
    psql "$BASE/$DB" -X -q -v ON_ERROR_STOP=1 -c 'SELECT rt.v3_reader_grants(false)' -c 'SELECT rt.assert_sealed_v3(true, false)' \
      > "$EVIDENCE/seal.txt" 2>&1 && echo 'seal verified' >> "$EVIDENCE/seal.txt" || echo 'SEAL CHECK FAILED' >> "$EVIDENCE/seal.txt"
  fi
  if [[ ! -s "$EVIDENCE/verdicts.json" ]]; then
    printf '{"schema": "reports-v3-performance-verdict/1", "mode": "%s", "verdict": "FAIL", "acceptance_eligible": false, "failed_stage": "%s", "exit_code": %d}\n' \
      "$MODE" "$STAGE" "$rc" > "$EVIDENCE/verdicts.json"
  fi
  python3 - "$EVIDENCE" "$rc" "$STAGE" <<'PY'
import hashlib, json, os, sys
evidence, rc, stage = sys.argv[1], int(sys.argv[2]), sys.argv[3]
files = {n: hashlib.sha256(open(os.path.join(evidence, n), 'rb').read()).hexdigest()
         for n in sorted(os.listdir(evidence)) if n != 'manifest.json'}
json.dump({'kind': 'reports-v3-performance', 'exit_code': rc, 'last_stage': stage, 'files': files},
          open(os.path.join(evidence, 'manifest.json'), 'w'), indent=2)
PY
  rm -rf "$WORK"
  if "$CREATED"; then dropdb --if-exists --maintenance-db="$BASE/postgres" "$DB"; fi
  exit "$rc"
}
trap finish_evidence EXIT

createdb --maintenance-db="$BASE/postgres" "$DB"
CREATED=true
REPORTS_V3_PERF=0 python3 scripts/reports_v3_fixture.py > "$WORK/functional.sql"
for stage in setup measure restart explain finish; do
  python3 scripts/reports_v3_fixture.py --part "$stage" > "$WORK/$stage.sql"
done

STAGE=functional
echo '== functional v3 suites'
run -f "$WORK/functional.sql" > "$WORK/functional.log" 2>&1 || { tail -40 "$WORK/functional.log"; exit 1; }
STAGE=setup
echo '== scale fixture (500,000 calls)'
stage_run() { run "$@" >> "$EVIDENCE/results.txt" 2>&1 || { grep -v '^NOTICE' "$EVIDENCE/results.txt" | tail -40; exit 1; }; }
: > "$EVIDENCE/results.txt"
stage_run -f "$WORK/setup.sql"
{ grep -A3 'performance fixture' "$EVIDENCE/results.txt" || true; } | tail -4
STAGE=measure
echo "== measurement: mode $MODE, $SAMPLES samples after one warm-up round"
stage_run "${vars[@]}" -f "$WORK/measure.sql"
{ grep -A3 'performance parameters' "$EVIDENCE/results.txt" || true; } | tail -4
if [[ -n "$RESTART_CMD" ]]; then
  STAGE=restart
  echo '== restarting PostgreSQL for the first-after-restart round'
  bash -c "$RESTART_CMD"
  for attempt in $(seq 1 60); do
    if psql "$BASE/postgres" -XAt -c 'SELECT 1' > /dev/null 2>&1; then break; fi
    sleep 2
  done
  psql "$BASE/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT 'restarted at ' || pg_postmaster_start_time()" | tee -a "$EVIDENCE/results.txt"
  stage_run "${vars[@]}" -f "$WORK/restart.sql"
  { grep -A3 'first-after-restart round' "$EVIDENCE/results.txt" || true; } | tail -4
fi
STAGE=explain
echo '== instrumented EXPLAIN (separate from the samples)'
run "${vars[@]}" -f "$WORK/explain.sql" > "$EVIDENCE/explain-output.txt" 2> "$EVIDENCE/plans.txt"
STAGE=finish
echo '== verdicts and gate'
finish_rc=0
run "${vars[@]}" -v perf_verdicts="$EVIDENCE/verdicts.json" -f "$WORK/finish.sql" >> "$EVIDENCE/results.txt" 2>&1 || finish_rc=$?
# The compact verdict table and the gate line, so the job log carries them.
{ grep -E '^ *[a-z_]+ +\| [a-z0-9-]+ +\|.*\| (PASS|FAIL) ' "$EVIDENCE/results.txt" || true; } | tail -150
{ grep -E 'performance gate|ERROR' "$EVIDENCE/results.txt" || true; } | tail -5
(( finish_rc == 0 )) || exit "$finish_rc"
STAGE=done
echo "Reports v3 performance run complete ($MODE); evidence: $EVIDENCE"
