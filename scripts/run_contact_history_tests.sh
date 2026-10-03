#!/usr/bin/env bash
set -euo pipefail
: "${PGURL:?Disposable localhost PostgreSQL cluster URL, without database path, required}"
python3 - "$PGURL" <<'PY'
import sys,urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
if u.scheme not in ('postgres','postgresql') or u.hostname not in ('localhost','127.0.0.1') or u.path not in ('','/') or u.query or u.fragment:
 raise SystemExit('REFUSING: disposable localhost cluster required')
PY
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TASK_DB="contact_history_test_$$"
TASK_URL="${PGURL%/}/$TASK_DB"
if [ "$(psql "${PGURL%/}/postgres" -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != 0 ]; then
 echo 'REFUSING hosted platform roles'; exit 2
fi
trap 'psql "${PGURL%/}/postgres" -q -c "DROP DATABASE IF EXISTS $TASK_DB" >/dev/null' EXIT
psql "${PGURL%/}/postgres" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TASK_DB"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -v setup=true -q -f "$TASK_ROOT/supabase/tests/contact_history.sql"
for migration in 20261003192857_contact_history_read_model 20261003192907_contact_history_operational_events; do
 psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_ROOT/supabase/migrations/$migration.sql"
done
psql "$TASK_URL" -v ON_ERROR_STOP=1 -v setup=false -q -f "$TASK_ROOT/supabase/tests/contact_history.sql"
# Hold an exclusive ledger lock in another real backend: source saves must not wait for it.
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "BEGIN; LOCK TABLE public.contact_history_events IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(2); COMMIT;" >/dev/null &
TASK_LOCK_PID=$!
TASK_READY=false
for TASK_POLL in $(seq 1 40); do
 if [ "$(psql "$TASK_URL" -tAc "SELECT count(*) FROM pg_locks WHERE relation='public.contact_history_events'::regclass AND mode='AccessExclusiveLock' AND granted")" = 1 ]; then TASK_READY=true; break; fi
 psql "$TASK_URL" -q -c 'SELECT pg_sleep(0.025)' >/dev/null
done
if [ "$TASK_READY" != true ]; then echo 'FAIL ledger lock test never reached barrier'; exit 1; fi
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "SET statement_timeout='500ms'; UPDATE public.clients SET first_name='Saved while ledger locked' WHERE id=public.test_id(104);" >/dev/null
wait "$TASK_LOCK_PID"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "SELECT public.test_assert(EXISTS(SELECT 1 FROM public.contact_history_capture_health WHERE error_code='55P03'),'ledger lock captured without blocking source');" >/dev/null
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM public.calls WHERE organization_id=public.test_id(1) AND contact_id=public.test_id(104) ORDER BY coalesce(started_at,created_at) DESC,id DESC LIMIT 31;"
echo 'PASS Contact history PostgreSQL suite, including real backend lock contention'

