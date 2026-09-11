#!/usr/bin/env bash
# =====================================================================================================
# Inbound call flow — SQL suite runner (disposable LOCAL PostgreSQL only; AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_inbound_sql_tests.sh
# Creates a throwaway database, applies inbound_harness.sql + M1 + M2 + M3, runs the four inbound suites,
# runs the R9 TRUE two-session advisory-lock concurrency proof, then applies inbound_v2_harness.sql +
# M4–M7 (Inbound Calling v2), runs the four v2 suites and the TRUE two-session owner-reservation proof,
# and drops the database. Refuses to run when PGURL does not point at localhost.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

DB="inbound_flow_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M1="$ROOT/supabase/migrations/20260823222528_inbound_identity_foundation.sql"
M2="$ROOT/supabase/migrations/20260823222805_inbound_claim_lifecycle.sql"
M3="$ROOT/supabase/migrations/20260823222926_recording_source_sid.sql"
M4="$ROOT/supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql"
M5="$ROOT/supabase/migrations/20260911000200_inbound_routing_v2_settings.sql"
M6="$ROOT/supabase/migrations/20260911000300_inbound_route_attempts_d13_and_recovery.sql"
M7="$ROOT/supabase/migrations/20260911000400_inbound_voicemails.sql"

psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;"' EXIT

psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/inbound_harness.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M1"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M2"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M3"

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

# ── Inbound Calling v2 (M4–M7) ──────────────────────────────────────────────────────────────────────
echo "== v2 harness + M4..M7 =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/inbound_v2_harness.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M4"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M5"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M6"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M7"

for f in inbound_registrations inbound_group_validation inbound_route_attempts inbound_voicemails; do
  echo "== $f =="
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/$f.sql"
  echo "   OK"
done

echo "== v2 two-session owner-reservation proof (plan_inbound_route serializes on the owner lock) =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO auth.users (id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_c1','Available')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.agent_phone_registrations (agent_id, registration_id, organization_id, seq, registered, registered_at, last_seen_at, last_state)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-00000000000a', 1, true, now(), now(), 'registered');
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, contact_type) VALUES
 ('cccccccc-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA000000000000000000000000000000c1','+19995550001','+15550001111',NULL),
 ('cccccccc-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA000000000000000000000000000000c2','+19995550002','+15550001111',NULL);
EOF
psql "$PGURL/$DB" -q <<'EOF' &
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.plan_inbound_route('cccccccc-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000000c1','contact','{}'::uuid[],20);
SELECT pg_sleep(3);
COMMIT;
EOF
sleep 1
psql "$PGURL/$DB" -q <<'EOF'
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.plan_inbound_route('cccccccc-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000000c1','contact','{}'::uuid[],20);
COMMIT;
EOF
wait
S1=$(psql "$PGURL/$DB" -Atc "SELECT stage FROM public.inbound_route_attempts WHERE call_id='cccccccc-0000-0000-0000-0000000000c1';")
S2=$(psql "$PGURL/$DB" -Atc "SELECT stage || ':' || eligibility_reason FROM public.inbound_route_attempts WHERE call_id='cccccccc-0000-0000-0000-0000000000c2';")
if [ "$S1" != "owner_browser" ] || [ "$S2" != "owner_voicemail:owner_busy" ]; then
  echo "v2 CONCURRENCY FAILED: first=$S1 second=$S2 (expected owner_browser / owner_voicemail:owner_busy)"; exit 1
fi
echo "   OK (first call rings the owner, the concurrent second call is refused as busy)"
echo "ALL INBOUND SQL SUITES GREEN (M1-M3 + v2 M4-M7)"
