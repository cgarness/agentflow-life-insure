#!/usr/bin/env bash
# =====================================================================================================
# Inbound call flow — SQL suite runner (disposable LOCAL PostgreSQL only; AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_inbound_sql_tests.sh
# Creates a throwaway database, applies inbound_harness.sql + M1 + M2 + M3, runs the four inbound suites,
# runs the R9 TRUE two-session advisory-lock concurrency proof, then applies inbound_v2_harness.sql +
# M4–M7 (Inbound Calling v2), runs the four v2 suites and the TRUE two-session owner-reservation proof,
# and drops the database. Refuses to run when PGURL does not point at localhost.
# Recent-outbound routing (20260927052736): after the v2 suites ran once on M4–M9 the migration is applied in
# ONE transaction, the same v2 suites are RE-RUN (unchanged behaviour with no configuration row), then
# inbound_recent_outbound.sql, three multi-session proofs (two callers of one dialer; planning vs deadline abandon;
# the SAME call planned by two sessions) and run_recent_outbound_rollback_test.sh.
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
M4="$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql"
M5="$ROOT/supabase/migrations/20260915025931_inbound_routing_v2_settings.sql"
M6="$ROOT/supabase/migrations/20260915035141_inbound_route_attempts_d13_and_recovery.sql"
M7="$ROOT/supabase/migrations/20260915053646_inbound_voicemails.sql"
# Corrective pass 13 — NOT YET APPLIED to any hosted project; local suites only.
M8="$ROOT/supabase/migrations/20260918000614_voicemail_cleanup_actionable_selection.sql"
M9="$ROOT/supabase/migrations/20260918002859_voicemail_first_listen_guard.sql"
# Recent-outbound callback routing — APPLIED as 20261002203426; this runner is isolated-local only.
M10="$ROOT/supabase/migrations/20261002203426_inbound_recent_outbound_routing.sql"

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
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M8"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M9"

V2_SUITES="inbound_registrations inbound_group_validation inbound_route_attempts inbound_voicemails voicemail_listen_guard_and_cleanup_selection"
for f in $V2_SUITES; do
  echo "== $f =="
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/$f.sql"
  echo "   OK"
done

# ── Recent-outbound callback routing (20260927052736) ───────────────────────────────────────────────
echo "== recent-outbound: apply 20260927052736 in ONE transaction =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$M10"
for f in $V2_SUITES; do
  echo "== $f (RE-RUN with 20260927052736 applied, no configuration row) =="
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/$f.sql"
  echo "   OK"
done
echo "== inbound_recent_outbound =="
RO_LOG="$(mktemp)"
if ! psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/inbound_recent_outbound.sql" > "$RO_LOG" 2>&1; then
  cat "$RO_LOG"; rm -f "$RO_LOG"; echo "RECENT-OUTBOUND SUITE FAILED"; exit 1
fi
# D9: each CONTAINED fault must have logged its WARNING (the suite asserts the group routing and the reason).
for w in "plan_inbound_route: recent_outbound config unavailable (42P01)" "plan_inbound_route: recent_outbound evidence unavailable (42P01)"; do
  grep -qF "WARNING:  $w" "$RO_LOG" || { cat "$RO_LOG"; rm -f "$RO_LOG"; echo "RECENT-OUTBOUND: missing WARNING '$w'"; exit 1; }
done
rm -f "$RO_LOG"
echo "   OK (incl. both contained-fault WARNINGs)"

# Multi-session proofs on a dedicated organization (committed fixtures; the org 0a proofs below are unaffected).
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO public.organizations (id, name) VALUES ('e0000000-0000-0000-0000-0000000000e9', 'RO proof org');
INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-0000000000d9'), ('e0000000-0000-0000-0000-0000000000a9'), ('e0000000-0000-0000-0000-0000000000b9');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status) VALUES
 ('e0000000-0000-0000-0000-0000000000d9','e0000000-0000-0000-0000-0000000000e9','Agent','Active','ro_proof_d9','Available'),
 ('e0000000-0000-0000-0000-0000000000a9','e0000000-0000-0000-0000-0000000000e9','Agent','Active','ro_proof_a9','Available'),
 ('e0000000-0000-0000-0000-0000000000b9','e0000000-0000-0000-0000-0000000000e9','Agent','Active','ro_proof_b9','Available');
INSERT INTO public.agent_phone_registrations (agent_id, registration_id, organization_id, seq, registered, registered_at, last_seen_at, last_state)
SELECT p, gen_random_uuid(), 'e0000000-0000-0000-0000-0000000000e9', 1, true, now(), now(), 'registered'
  FROM unnest(ARRAY['e0000000-0000-0000-0000-0000000000d9','e0000000-0000-0000-0000-0000000000a9','e0000000-0000-0000-0000-0000000000b9']::uuid[]) p;
INSERT INTO public.phone_numbers (organization_id, phone_number, assignment_type) VALUES ('e0000000-0000-0000-0000-0000000000e9', '+15550009001', 'agency');
INSERT INTO public.inbound_routing_settings (organization_id, routing_engine, inbound_group_agent_ids)
VALUES ('e0000000-0000-0000-0000-0000000000e9', 'v2', ARRAY['e0000000-0000-0000-0000-0000000000a9','e0000000-0000-0000-0000-0000000000b9']::uuid[]);
INSERT INTO private.recent_outbound_routing_orgs (organization_id, enabled) VALUES ('e0000000-0000-0000-0000-0000000000e9', true);
-- d9 verifiably dialed three people from the DID two hours ago (outbound rows as the browser writes them; the
-- record RPC as twilio-voice-status calls it, through service_role)
INSERT INTO public.calls (id, organization_id, agent_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, created_at, ended_at)
SELECT ('e0000000-0000-0000-0009-00000000000' || i)::uuid, 'e0000000-0000-0000-0000-0000000000e9', 'e0000000-0000-0000-0000-0000000000d9',
       'outbound', 'completed', 'CA' || lpad(to_hex(9100 + i), 32, '0'), '+1999555900' || i, '+15550009001', now() - interval '2 hours', now() - interval '2 hours'
  FROM generate_series(1, 3) i;
SET ROLE service_role;
DO $$
DECLARE i integer; r jsonb;
BEGIN
  FOR i IN 1..3 LOOP
    r := public.record_outbound_dial_evidence('AC000000000000000000000000000000aa', 'AC000000000000000000000000000000aa',
           'CA' || lpad(to_hex(9100 + i), 32, '0'), 'CA' || lpad(to_hex(9200 + i), 32, '0'), 'completed', 'client:ro_proof_d9', '+1999555900' || i,
           'AC000000000000000000000000000000aa', 'client:ro_proof_d9', 'AC000000000000000000000000000000aa', 'CA' || lpad(to_hex(9100 + i), 32, '0'),
           '+1999555900' || i, '+15550009001', 'completed', now() - interval '2 hours');
    IF r->>'reason' IS DISTINCT FROM 'recorded' THEN RAISE EXCEPTION 'proof fixture evidence %: %', i, r; END IF;
  END LOOP;
END $$;
RESET ROLE;
-- three unknown callers ring the DID now
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, routing_engine)
SELECT ('e0000000-0000-0000-0009-00000000001' || i)::uuid, 'e0000000-0000-0000-0000-0000000000e9', 'inbound', 'ringing',
       'CA' || lpad(to_hex(9300 + i), 32, '0'), '+1999555900' || i, '+15550009001', 'v2'
  FROM generate_series(1, 3) i;
EOF
RO_PLAN() { echo "SELECT public.plan_inbound_route('$1','e0000000-0000-0000-0000-0000000000e9',NULL,NULL,ARRAY['e0000000-0000-0000-0000-0000000000a9','e0000000-0000-0000-0000-0000000000b9']::uuid[],20);"; }

echo "== recent-outbound proof: two unknown callers of the SAME dialer, planned concurrently =="
psql "$PGURL/$DB" -q <<EOF &
BEGIN;
SET LOCAL ROLE service_role;
$(RO_PLAN e0000000-0000-0000-0009-000000000011)
SELECT pg_sleep(3);
COMMIT;
EOF
sleep 1
psql "$PGURL/$DB" -q <<EOF
BEGIN;
SET LOCAL ROLE service_role;
$(RO_PLAN e0000000-0000-0000-0009-000000000012)
COMMIT;
EOF
wait
S1=$(psql "$PGURL/$DB" -Atc "SELECT stage || ':' || owner_source || ':' || owner_agent_id FROM public.inbound_route_attempts WHERE call_id='e0000000-0000-0000-0009-000000000011';")
S2=$(psql "$PGURL/$DB" -Atc "SELECT a.stage || ':' || a.eligibility_reason || ':' || a.owner_source || ':' || c.missed_recipient_ids::text FROM public.inbound_route_attempts a JOIN public.calls c ON c.id = a.call_id WHERE a.call_id='e0000000-0000-0000-0009-000000000012';")
if [ "$S1" != "owner_browser:recent_outbound:e0000000-0000-0000-0000-0000000000d9" ] \
   || [ "$S2" != "owner_voicemail:owner_busy:recent_outbound:{e0000000-0000-0000-0000-0000000000d9}" ]; then
  echo "RECENT-OUTBOUND CONCURRENCY FAILED: first=$S1 second=$S2"; exit 1
fi
echo "   OK (first rings the dialer; the concurrent second is refused as busy → the dialer's voicemail, snapshot [dialer])"

echo "== recent-outbound proof: planning waits for the dialer's lock while the deadline abandon is in flight =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
UPDATE public.inbound_route_attempts SET terminal = true, reserved_agent_ids = '{}'::uuid[]
 WHERE call_id IN ('e0000000-0000-0000-0009-000000000011','e0000000-0000-0000-0009-000000000012');
UPDATE public.calls SET status = 'completed', ended_at = now()
 WHERE id IN ('e0000000-0000-0000-0009-000000000011','e0000000-0000-0000-0009-000000000012');
EOF
RO_B="$(mktemp)"; RO_C="$(mktemp)"
psql "$PGURL/$DB" -q <<'EOF' &
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('inbound_agent:e0000000-0000-0000-0000-0000000000d9'));
SELECT pg_sleep(3);
COMMIT;
EOF
sleep 0.7
psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $(RO_PLAN e0000000-0000-0000-0009-000000000013)" > "$RO_B" 2>&1 &
sleep 0.7
psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; SELECT public.abandon_inbound_routing('e0000000-0000-0000-0009-000000000013','e0000000-0000-0000-0000-0000000000e9','deadline');" > "$RO_C" 2>&1 &
wait
RO_STATE=$(psql "$PGURL/$DB" -Atc "SELECT c.status || '|' || (c.ended_at IS NOT NULL) || '|' || a.stage || ':' || a.terminal || ':' || coalesce(a.final_outcome,'-') || ':' || cardinality(a.reserved_agent_ids) || '|' || a.owner_source || '|' || c.missed_recipient_ids::text || '|' || public.is_agent_busy(c.organization_id, 'e0000000-0000-0000-0000-0000000000d9', NULL) FROM public.calls c JOIN public.inbound_route_attempts a ON a.call_id = c.id WHERE c.id = 'e0000000-0000-0000-0009-000000000013';")
echo "   B: $(tr -d '\n' < "$RO_B" | cut -c1-140)"
echo "   C: $(tr -d '\n' < "$RO_C" | cut -c1-140)"
echo "   state: $RO_STATE"
rm -f "$RO_B" "$RO_C"
if [ "$RO_STATE" != "no-answer|true|owner_browser:true:parent_no-answer:0|recent_outbound|{e0000000-0000-0000-0000-0000000000d9}|false" ]; then
  echo "RECENT-OUTBOUND BARRIER PROOF FAILED: $RO_STATE"; exit 1
fi
echo "   OK (the call is terminal, nobody reserved, and the recipients snapshot is [dialer])"

echo "== recent-outbound proof: the SAME unknown-caller call planned by two sessions at once (dialer on DND) =="
# A plans the call (eligible evidence ⇒ the dialer, who is on DND ⇒ agent voicemail + D13) and holds its transaction
# open; B plans the SAME call, WAITS on A's parent-row lock, then finds A's committed attempt. Asserted: B really
# waited while A was open, exactly one attempt, one created:true and one created:false returning that attempt,
# owner_source recent_outbound with its evidence, and exactly ONE calls write — the single D13 mark naming [dialer].
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
UPDATE public.profiles SET availability_status = 'Do Not Disturb' WHERE id = 'e0000000-0000-0000-0000-0000000000d9';
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, routing_engine)
VALUES ('e0000000-0000-0000-0009-000000000014', 'e0000000-0000-0000-0000-0000000000e9', 'inbound', 'ringing',
        'CA' || lpad(to_hex(9314), 32, '0'), '+19995559001', '+15550009001', 'v2');
EOF
RO_UPD0=$(psql "$PGURL/$DB" -Atc "SELECT n FROM public.harness_trigger_counts WHERE k = 'calls_update';")
RO_A="$(mktemp)"; RO_B="$(mktemp)"; RO_A_OPEN=no; RO_B_WAITED=no
PGAPPNAME=ro_same_call_a psql "$PGURL/$DB" -q -At > "$RO_A" 2>&1 <<EOF &
BEGIN;
SET LOCAL ROLE service_role;
$(RO_PLAN e0000000-0000-0000-0009-000000000014)
SELECT pg_sleep(3);
COMMIT;
EOF
for _ in $(seq 1 50); do
  [ "$(psql "$PGURL/$DB" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'ro_same_call_a' AND state = 'active' AND query LIKE 'SELECT pg_sleep%';")" = "1" ] && { RO_A_OPEN=yes; break; }
  sleep 0.1
done
PGAPPNAME=ro_same_call_b psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $(RO_PLAN e0000000-0000-0000-0009-000000000014)" > "$RO_B" 2>&1 &
for _ in $(seq 1 25); do
  [ "$(psql "$PGURL/$DB" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'ro_same_call_b' AND wait_event_type = 'Lock';")" = "1" ] && { RO_B_WAITED=yes; break; }
  sleep 0.1
done
wait
RO_WRITES=$(( $(psql "$PGURL/$DB" -Atc "SELECT n FROM public.harness_trigger_counts WHERE k = 'calls_update';") - RO_UPD0 ))
RO_ID=$(psql "$PGURL/$DB" -Atc "SELECT id FROM public.inbound_route_attempts WHERE call_id = 'e0000000-0000-0000-0009-000000000014';")
RO_STATE=$(psql "$PGURL/$DB" -Atc "SELECT (SELECT count(*) FROM public.inbound_route_attempts x WHERE x.call_id = c.id) || '|' || a.stage || ':' || a.eligibility_reason || ':' || a.owner_source || ':' || a.owner_agent_id || ':' || (a.owner_evidence_dial_call_sid = 'CA' || lpad(to_hex(9201), 32, '0')) || ':' || a.owner_evidence_outcome || '|' || c.is_missed || ':' || c.missed_reason || ':' || c.missed_for_agent_id || ':' || c.missed_recipient_ids::text || ':' || coalesce(c.agent_id::text, '-') FROM public.calls c JOIN public.inbound_route_attempts a ON a.call_id = c.id WHERE c.id = 'e0000000-0000-0000-0009-000000000014';")
RO_A_OUT=$(tr -d '\n' < "$RO_A"); RO_B_OUT=$(tr -d '\n' < "$RO_B"); rm -f "$RO_A" "$RO_B"
echo "   A: $(echo "$RO_A_OUT" | cut -c1-140)"
echo "   B: $(echo "$RO_B_OUT" | cut -c1-140)"
echo "   A held its transaction open: $RO_A_OPEN; B waited on A's lock: $RO_B_WAITED; calls writes: $RO_WRITES"
echo "   state: $RO_STATE"
case "$RO_A_OUT" in *'"created": true'*) RO_A_CREATED=true ;; *) RO_A_CREATED=no ;; esac
case "$RO_B_OUT" in *'"created": false'*) RO_B_CREATED=false ;; *) RO_B_CREATED=no ;; esac
if [ "$RO_A_OPEN" != yes ] || [ "$RO_B_WAITED" != yes ] || [ "$RO_A_CREATED" != true ] || [ "$RO_B_CREATED" != false ] \
   || [ -z "$RO_ID" ] || [ "${RO_A_OUT#*"$RO_ID"}" = "$RO_A_OUT" ] || [ "${RO_B_OUT#*"$RO_ID"}" = "$RO_B_OUT" ] || [ "$RO_WRITES" != "1" ] \
   || [ "$RO_STATE" != "1|owner_voicemail:owner_dnd:recent_outbound:e0000000-0000-0000-0000-0000000000d9:true:answered|true:dnd:e0000000-0000-0000-0000-0000000000d9:{e0000000-0000-0000-0000-0000000000d9}:-" ]; then
  echo "RECENT-OUTBOUND SAME-CALL PROOF FAILED (A created=$RO_A_CREATED, B created=$RO_B_CREATED, attempt=$RO_ID, writes=$RO_WRITES): $RO_STATE"; exit 1
fi
psql "$PGURL/$DB" -qc "UPDATE public.profiles SET availability_status = 'Available' WHERE id = 'e0000000-0000-0000-0000-0000000000d9';"
echo "   OK (one attempt; A created it, B waited and got it back created:false; one D13 mark 'dnd' naming [dialer])"

echo "== recent-outbound rollback proof (forward → rollback → forward, forced failures, negative control) =="
"$ROOT/scripts/run_recent_outbound_rollback_test.sh" | sed 's/^/   /'

# Dedicated agents for the barrier proofs (the suites above roll their own fixtures back).
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO auth.users (id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1'),('aaaaaaaa-0000-0000-0000-0000000000d2'),('aaaaaaaa-0000-0000-0000-0000000000d3') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_d1','Available'),
 ('aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_d2','Available'),
 ('aaaaaaaa-0000-0000-0000-0000000000d3','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_d3','Available')
ON CONFLICT (id) DO NOTHING;
EOF
# ── Corrective pass 4: TRUE three-session barrier proofs — a routing transaction WAITING for an agent lock
#    while the parent is finalized/abandoned by another session must end in a consistent state: the call
#    terminal, no actionable attempt, nobody reserved. Session A holds the agent lock for ~3 s; B starts the
#    routing write (blocks on A's lock while holding the parent row lock); C finalizes/abandons (blocks on B's
#    row lock); A releases; B then C complete. Asserted from the resulting rows, not from timing.
run_barrier_proof() {
  local label="$1" call="$2" sid="$3" lock_agent="$4" routing_sql="$5" cancel_sql="$6" setup_sql="$7"
  echo "== barrier proof: $label =="
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<EOF
SET ROLE service_role;
$setup_sql
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, created_at, routing_engine)
VALUES ('$call', 'aaaaaaaa-0000-0000-0000-00000000000a', 'inbound', 'ringing', '$sid', '+18885550000', '+15550001111', now(), 'v2')
ON CONFLICT (id) DO NOTHING;
RESET ROLE;
EOF
  psql "$PGURL/$DB" -q <<EOF &
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('inbound_agent:$lock_agent'));
SELECT pg_sleep(3);
COMMIT;
EOF
  sleep 0.7
  psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $routing_sql" > "/tmp/barrier_${label// /_}_B.out" 2>&1 &
  sleep 0.7
  psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $cancel_sql" > "/tmp/barrier_${label// /_}_C.out" 2>&1 &
  wait
  local state
  state=$(psql "$PGURL/$DB" -Atc "SELECT c.status || '|' || (c.ended_at IS NOT NULL) || '|' || coalesce((SELECT string_agg(a.stage || ':' || a.terminal || ':' || coalesce(a.final_outcome,'-') || ':' || cardinality(a.reserved_agent_ids), ',') FROM public.inbound_route_attempts a WHERE a.call_id = c.id), 'no-attempt') || '|' || public.is_agent_busy(c.organization_id, '$lock_agent', NULL) FROM public.calls c WHERE c.id = '$call';")
  echo "   B: $(cat "/tmp/barrier_${label// /_}_B.out" | tr -d '\n' | cut -c1-140)"
  echo "   C: $(cat "/tmp/barrier_${label// /_}_C.out" | tr -d '\n' | cut -c1-140)"
  echo "   state: $state"
  case "$state" in
    no-answer\|true\|*:true:*:0\|false|no-answer\|true\|no-attempt\|false) echo "   OK" ;;
    *) echo "BARRIER PROOF FAILED ($label): $state"; exit 1 ;;
  esac
}

# B plans an OWNER route (waits for a1's lock); C abandons (the webhook's failure decision).
run_barrier_proof "owner planning vs abandon" 'dddddddd-0000-0000-0000-000000000001' 'CA00000000000000000000000000000d01' \
  'aaaaaaaa-0000-0000-0000-0000000000d1' \
  "SELECT public.plan_inbound_route('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000d1','contact','{}'::uuid[],20);" \
  "SELECT public.abandon_inbound_routing('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','deadline');" \
  "UPDATE public.profiles SET availability_status = 'Available' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
   INSERT INTO public.agent_phone_registrations (agent_id, organization_id, registration_id, registered, registered_at, last_seen_at, last_state, seq)
   VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000000a', gen_random_uuid(), true, now(), now(), 'registered', 1);"

# B plans a GROUP route (waits for a2's lock); C finalizes through the status-callback writer.
run_barrier_proof "group planning vs finalize" 'dddddddd-0000-0000-0000-000000000002' 'CA00000000000000000000000000000d02' \
  'aaaaaaaa-0000-0000-0000-0000000000d2' \
  "SELECT public.plan_inbound_route('dddddddd-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a',NULL,NULL,ARRAY['aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-0000000000d3']::uuid[],20);" \
  "SELECT public.finalize_inbound_call_terminal('dddddddd-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','no-answer',true);" \
  "UPDATE public.profiles SET availability_status = 'Available' WHERE id IN ('aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-0000000000d3');
   INSERT INTO public.agent_phone_registrations (agent_id, organization_id, registration_id, registered, registered_at, last_seen_at, last_state, seq)
   VALUES ('aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000000a', gen_random_uuid(), true, now(), now(), 'registered', 1),
          ('aaaaaaaa-0000-0000-0000-0000000000d3','aaaaaaaa-0000-0000-0000-00000000000a', gen_random_uuid(), true, now(), now(), 'registered', 1);"

# B advances an existing owner ring into the mobile dial (waits for a1's lock); C abandons meanwhile.
run_barrier_proof "owner-mobile advance vs abandon" 'dddddddd-0000-0000-0000-000000000003' 'CA00000000000000000000000000000d03' \
  'aaaaaaaa-0000-0000-0000-0000000000d1' \
  "SELECT public.advance_to_owner_mobile((SELECT id FROM public.inbound_route_attempts WHERE call_id = 'dddddddd-0000-0000-0000-000000000003'),'aaaaaaaa-0000-0000-0000-00000000000a','dddddddd-0000-0000-0000-000000000003');" \
  "SELECT public.abandon_inbound_routing('dddddddd-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','deadline');" \
  "INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, created_at, routing_engine)
   VALUES ('dddddddd-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA00000000000000000000000000000d03','+18885550000','+15550001111', now(), 'v2') ON CONFLICT (id) DO NOTHING;
   SELECT public.plan_inbound_route('dddddddd-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000d1','contact','{}'::uuid[],20);
   INSERT INTO public.agent_inbound_settings (agent_id, organization_id, mobile_forward_enabled, mobile_forward_number)
   VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000000a', true, '+15559990001')
   ON CONFLICT (agent_id) DO UPDATE SET mobile_forward_enabled = true, mobile_forward_number = '+15559990001';"

# B moves a group ring into group voicemail (a finalize holding the parent row lock is in flight in C's place).
echo "== barrier proof: stage transition vs finalize in flight =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
SET ROLE service_role;
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, created_at, routing_engine)
VALUES ('dddddddd-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA00000000000000000000000000000d04','+18885550000','+15550001111', now(), 'v2') ON CONFLICT (id) DO NOTHING;
SELECT public.plan_inbound_route('dddddddd-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-00000000000a',NULL,NULL,ARRAY['aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-0000000000d3']::uuid[],20);
RESET ROLE;
EOF
psql "$PGURL/$DB" -q <<'EOF' &
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.finalize_inbound_call_terminal('dddddddd-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-00000000000a','no-answer',true);
SELECT pg_sleep(3);
COMMIT;
EOF
sleep 0.7
psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; SELECT public.advance_inbound_route_stage((SELECT id FROM public.inbound_route_attempts WHERE call_id = 'dddddddd-0000-0000-0000-000000000004'),'aaaaaaaa-0000-0000-0000-00000000000a','group_browser','group_voicemail','{\"voicemail_kind\":\"group\"}'::jsonb);" > /tmp/barrier_stage_B.out 2>&1 &
wait
STATE=$(psql "$PGURL/$DB" -Atc "SELECT c.status || '|' || (SELECT a.stage || ':' || a.terminal FROM public.inbound_route_attempts a WHERE a.call_id = c.id) FROM public.calls c WHERE c.id = 'dddddddd-0000-0000-0000-000000000004';")
echo "   B: $(tr -d '\n' < /tmp/barrier_stage_B.out | cut -c1-140)"
echo "   state: $STATE"
if [ "$STATE" != "no-answer|group_browser:true" ]; then echo "BARRIER PROOF FAILED (stage transition): $STATE"; exit 1; fi
echo "   OK"

# ── Corrective pass 6 (finding 2): TRUE three-session barrier proofs for the ACCEPTANCE ↔ ABANDONMENT race,
#    in BOTH orderings. Session A holds the ATTEMPT ROW lock (not an advisory lock), so the two writers meet on
#    the real row they both must take, in the shared order parent row → attempt row. Asserted from the RPC
#    results AND the committed rows.
setup_mobile_ring() {                      # $1 = call id, $2 = parent sid, agent d1, mobile +15559990001
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<EOF
SET ROLE service_role;
-- Clean slate: every earlier proof's call is closed so the owner is not still reserved (is_agent_busy
-- follows the live reservation, by design) — the assertions of those proofs have already been made.
UPDATE public.inbound_route_attempts SET terminal = true, reserved_agent_ids = '{}'::uuid[] WHERE NOT terminal AND call_id <> '$1';
UPDATE public.calls SET status = 'completed', ended_at = coalesce(ended_at, now())
 WHERE direction = 'inbound' AND ended_at IS NULL AND id <> '$1';
UPDATE public.profiles SET availability_status = 'Available' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
DELETE FROM public.agent_phone_registrations WHERE agent_id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
INSERT INTO public.agent_phone_registrations (agent_id, organization_id, registration_id, registered, registered_at, last_seen_at, last_state, seq)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000000a', gen_random_uuid(), true, now(), now(), 'registered', 1);
INSERT INTO public.agent_inbound_settings (agent_id, organization_id, mobile_forward_enabled, mobile_forward_number)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000000a', true, '+15559990001')
ON CONFLICT (agent_id) DO UPDATE SET mobile_forward_enabled = true, mobile_forward_number = '+15559990001';
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, created_at, routing_engine)
VALUES ('$1','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','$2','+18885550000','+15550001111', now(), 'v2') ON CONFLICT (id) DO NOTHING;
SELECT public.plan_inbound_route('$1','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000d1','contact','{}'::uuid[],20);
SELECT public.advance_to_owner_mobile((SELECT id FROM public.inbound_route_attempts WHERE call_id = '$1'),'aaaaaaaa-0000-0000-0000-00000000000a','$1');
RESET ROLE;
EOF
  local stage
  stage=$(psql "$PGURL/$DB" -Atc "SELECT stage || ':' || coalesce(mobile_number_dialed,'-') FROM public.inbound_route_attempts WHERE call_id = '$1';")
  if [ "$stage" != "owner_mobile:+15559990001" ]; then echo "SETUP FAILED ($1): $stage"; exit 1; fi
}

ACCEPT_SQL() { echo "SELECT public.record_inbound_mobile_accept((SELECT id FROM public.inbound_route_attempts WHERE call_id = '$1'),'aaaaaaaa-0000-0000-0000-00000000000a','$1','aaaaaaaa-0000-0000-0000-0000000000d1','$2','1','$3','+15559990001');"; }
ABANDON_SQL() { echo "SELECT public.abandon_inbound_routing('$1','aaaaaaaa-0000-0000-0000-00000000000a','deadline');"; }

run_accept_abandon_proof() {               # $1 label  $2 call  $3 parent sid  $4 child sid  $5 = accept_first|abandon_first
  local label="$1" call="$2" psid="$3" csid="$4" order="$5"
  echo "== barrier proof: $label =="
  setup_mobile_ring "$call" "$psid"
  psql "$PGURL/$DB" -q <<EOF &
BEGIN;
SELECT id FROM public.inbound_route_attempts WHERE call_id = '$call' FOR UPDATE;
SELECT pg_sleep(3);
COMMIT;
EOF
  sleep 0.7
  if [ "$order" = "accept_first" ]; then
    psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $(ACCEPT_SQL "$call" "$csid" "$psid")" > "/tmp/aa_${call}_B.out" 2>&1 &
    sleep 0.7
    psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $(ABANDON_SQL "$call")" > "/tmp/aa_${call}_C.out" 2>&1 &
  else
    psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $(ABANDON_SQL "$call")" > "/tmp/aa_${call}_C.out" 2>&1 &
    sleep 0.7
    psql "$PGURL/$DB" -q -Atc "SET ROLE service_role; $(ACCEPT_SQL "$call" "$csid" "$psid")" > "/tmp/aa_${call}_B.out" 2>&1 &
  fi
  wait
  local acc aba state
  acc=$(tr -d '\n' < "/tmp/aa_${call}_B.out")
  aba=$(tr -d '\n' < "/tmp/aa_${call}_C.out")
  state=$(psql "$PGURL/$DB" -Atc "SELECT c.status || '|' || coalesce(c.is_missed::text,'-') || '|' || coalesce(c.agent_id::text,'-') || '|' || (SELECT a.terminal || ':' || coalesce(a.mobile_accept_result,'-') || ':' || coalesce(a.final_outcome,'-') || ':' || cardinality(a.reserved_agent_ids) FROM public.inbound_route_attempts a WHERE a.call_id = c.id) FROM public.calls c WHERE c.id = '$call';")
  echo "   accept:   $(echo "$acc" | cut -c1-200)"
  echo "   abandon:  $(echo "$aba" | cut -c1-200)"
  echo "   state:    $state"
  if [ "$order" = "accept_first" ]; then
    # The live acceptance wins: it is granted, and the abandonment REFUSES to classify the call as unanswered.
    case "$acc" in *'"accept" : true'*|*'"accept": true'*) ;; *) echo "BARRIER PROOF FAILED ($label): acceptance must be granted: $acc"; exit 1 ;; esac
    case "$acc" in *'"result" : "accepted"'*|*'"result": "accepted"'*) ;; *) echo "BARRIER PROOF FAILED ($label): acceptance result: $acc"; exit 1 ;; esac
    case "$aba" in *mobile_accepted_live*) ;; *) echo "BARRIER PROOF FAILED ($label): abandonment must refuse a live acceptance: $aba"; exit 1 ;; esac
    # The call is still ringing with the owner reserved and the acceptance recorded; is_missed is already true
    # because the FORWARD commit stamped D13 ("Missed in AgentFlow — forwarded to mobile") when it dialed.
    if [ "$state" != "ringing|true|-|false:accepted:-:1" ]; then
      echo "BARRIER PROOF FAILED ($label): $state"; exit 1
    fi
  else
    # The abandonment committed first: the late acceptance is REFUSED and never grants bridge permission.
    case "$aba" in *'"updated" : true'*|*'"updated": true'*) ;; *) echo "BARRIER PROOF FAILED ($label): abandonment must commit: $aba"; exit 1 ;; esac
    case "$acc" in *'"accept" : false'*|*'"accept": false'*) ;; *) echo "BARRIER PROOF FAILED ($label): a late acceptance must be refused: $acc"; exit 1 ;; esac
    case "$acc" in *stage_mismatch*) ;; *) echo "BARRIER PROOF FAILED ($label): refusal reason: $acc"; exit 1 ;; esac
    # The call is terminal and unclaimed, the attempt is closed with NO acceptance recorded and nobody
    # reserved (the closing writer is finalize, inside the abandonment's own transaction).
    case "$state" in
      'no-answer|true|-|true:-:'*':0') ;;
      *) echo "BARRIER PROOF FAILED ($label): $state"; exit 1 ;;
    esac
  fi
  echo "   OK"
}

run_accept_abandon_proof "Press-1 acceptance vs abandonment (acceptance first)" \
  'dddddddd-0000-0000-0000-000000000005' 'CA00000000000000000000000000000d05' 'CA00000000000000000000000000000e05' accept_first
run_accept_abandon_proof "abandonment vs late Press-1 acceptance (abandonment first)" \
  'dddddddd-0000-0000-0000-000000000006' 'CA00000000000000000000000000000d06' 'CA00000000000000000000000000000e06' abandon_first

echo "== v2 two-session owner-reservation proof (plan_inbound_route serializes on the owner lock) =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO auth.users (id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_c1','Available')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.agent_phone_registrations (agent_id, registration_id, organization_id, seq, registered, registered_at, last_seen_at, last_state)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-00000000000a', 1, true, now(), now(), 'registered');
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, contact_type, routing_engine) VALUES
 ('cccccccc-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA000000000000000000000000000000c1','+19995550001','+15550001111',NULL,'v2'),
 ('cccccccc-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA000000000000000000000000000000c2','+19995550002','+15550001111',NULL,'v2');
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
# ── Corrective pass 9: the ROLLBACK deliverable is part of the gate, not a separate promise. Its own
#    throwaway database (M7 → M6 → reapply) so nothing above depends on its state.
echo "== rollback proof (M7 → M6 → reapply) =="
"$ROOT/scripts/run_inbound_rollback_test.sh" | sed 's/^/   /'

echo "== corrective-pass-13 rollback proof (M9 → M8 → reapply) =="
"$ROOT/scripts/run_cp13_rollback_test.sh" | sed 's/^/   /'

echo "ALL INBOUND SQL SUITES GREEN (M1-M3 + v2 M4-M9 + recent-outbound 20260927052736, incl. all three rollback proofs)"
