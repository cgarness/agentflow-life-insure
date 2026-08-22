#!/usr/bin/env bash
# =====================================================================================================
# Inbound call flow — SQL suite runner (disposable LOCAL PostgreSQL only; AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_inbound_sql_tests.sh
# Creates a throwaway database, applies inbound_harness.sql + M1 + M2, runs the four inbound suites,
# then runs the R9 TRUE two-session advisory-lock concurrency proof, and drops the database.
# Refuses to run when PGURL does not point at localhost.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

DB="inbound_flow_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M1="$ROOT/supabase/migrations/20260822120000_inbound_identity_foundation.sql"
M2="$ROOT/supabase/migrations/20260822120100_inbound_claim_lifecycle.sql"

psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;"' EXIT

psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/inbound_harness.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M1"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M2"

for f in inbound_identity_resolution inbound_ingest_idempotency inbound_claim inbound_terminal_lifecycle; do
  echo "== $f =="
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/$f.sql"
  echo "   OK"
done

echo "== R9 two-session advisory-lock concurrency proof =="
psql "$PGURL/$DB" -qc "INSERT INTO public.organizations (id,name) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','Conc A') ON CONFLICT DO NOTHING;"
psql "$PGURL/$DB" -q <<'EOF' &
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.ingest_inbound_call('CA00000000000000000000000000000041',
  'aaaaaaaa-0000-0000-0000-00000000000a', '+18885552000', '+15550001111', true);
SELECT pg_sleep(3);
COMMIT;
EOF
sleep 1
psql "$PGURL/$DB" -q <<'EOF'
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.ingest_inbound_call('CA00000000000000000000000000000042',
  'aaaaaaaa-0000-0000-0000-00000000000a', '+18885552000', '+15550001111', true);
COMMIT;
EOF
wait
LEADS=$(psql "$PGURL/$DB" -Atc "SELECT count(*) FROM public.leads WHERE phone='+18885552000';")
LINKED=$(psql "$PGURL/$DB" -Atc "SELECT count(*) FROM public.calls WHERE contact_type='lead'
  AND contact_id=(SELECT id FROM public.leads WHERE phone='+18885552000' LIMIT 1)
  AND twilio_call_sid IN ('CA00000000000000000000000000000041','CA00000000000000000000000000000042');")
if [ "$LEADS" != "1" ] || [ "$LINKED" != "2" ]; then
  echo "R9 FAILED: leads=$LEADS linked=$LINKED (expected 1 / 2)"; exit 1
fi
echo "   OK (1 lead, 2 calls linked)"
echo "ALL INBOUND SQL SUITES GREEN"
