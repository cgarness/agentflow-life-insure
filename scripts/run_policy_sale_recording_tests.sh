#!/usr/bin/env bash
# Disposable cluster only: production must never receive synthetic fixture rows.
set -euo pipefail
: "${PGURL:?Disposable localhost PostgreSQL cluster URL, without database path, required}"
python3 - "$PGURL" <<'PY'
import os,sys,urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
if u.scheme not in ('postgres','postgresql') or u.hostname not in ('localhost','127.0.0.1') or u.path not in ('','/') or u.query or u.fragment:
 raise SystemExit('REFUSING: disposable localhost cluster required')
for key in ('PGHOST','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGDATABASE'):
 if os.environ.get(key): raise SystemExit('REFUSING: unset '+key)
PY
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TASK_DB="policy_sales_test_$$"
TASK_URL="${PGURL%/}/$TASK_DB"
TASK_TEMP=$(mktemp -d)
if [ "$(psql "${PGURL%/}/postgres" -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != 0 ]; then
 echo 'REFUSING hosted platform roles'; exit 2
fi
trap 'psql "${PGURL%/}/postgres" -q -c "DROP DATABASE IF EXISTS $TASK_DB" >/dev/null; rm -rf "$TASK_TEMP"' EXIT
psql "${PGURL%/}/postgres" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TASK_DB"
python3 "$TASK_ROOT/scripts/policy_sale_fixture.py" > "$TASK_TEMP/fixture.sql"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_TEMP/fixture.sql"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_ROOT/supabase/migrations/20261004000819_leaderboard_sale_recording.sql"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_ROOT/supabase/tests/policy_sale_recording.sql"
# Two real backends submit the same manual operation while the first transaction is held in INSERT.
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE FUNCTION public.test_delay_client() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.first_name='Concurrent' THEN PERFORM pg_sleep(0.4); END IF; RETURN NEW; END $$;
CREATE TRIGGER test_delay_client BEFORE INSERT ON clients FOR EACH ROW EXECUTE FUNCTION public.test_delay_client();
SQL
TASK_SQL="SELECT test_actor(11); SET ROLE authenticated; SELECT create_client_with_sale(test_id(800),test_id(1),test_client_payload()||'{\"first_name\":\"Concurrent\"}',true)->>'client_id';"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -qAt -c "$TASK_SQL" > "$TASK_TEMP/one" &
TASK_PID=$!
psql "$TASK_URL" -v ON_ERROR_STOP=1 -qAt -c "$TASK_SQL" > "$TASK_TEMP/two"
wait "$TASK_PID"
cmp "$TASK_TEMP/one" "$TASK_TEMP/two"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "SELECT test_assert((SELECT count(*) FROM clients WHERE first_name='Concurrent')=1 AND (SELECT count(*) FROM wins WHERE idempotency_key LIKE '%000000000800')=1,'concurrent manual save exactly once');"
# Conversion also serializes before calling the unchanged original converter.
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "INSERT INTO leads(id,organization_id,user_id,assigned_agent_id,first_name,last_name) VALUES(test_id(801),test_id(1),test_id(11),test_id(11),'Concurrent','Conversion');"
TASK_SQL="SELECT test_actor(11); SET ROLE authenticated; SELECT convert_lead_to_client_with_sales(test_id(801),test_id(1),test_client_payload(),null)->>'client_id';"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -qAt -c "$TASK_SQL" > "$TASK_TEMP/one" &
TASK_PID=$!
psql "$TASK_URL" -v ON_ERROR_STOP=1 -qAt -c "$TASK_SQL" > "$TASK_TEMP/two"
wait "$TASK_PID"
cmp "$TASK_TEMP/one" "$TASK_TEMP/two"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "SELECT test_assert((SELECT count(*) FROM clients WHERE lead_id=test_id(801))=1 AND (SELECT count(*) FROM wins WHERE idempotency_key='conversion:'||test_id(801))=1,'concurrent conversion exactly once');"
echo 'PASS policy sale PostgreSQL suite including independent-session retry contention'
