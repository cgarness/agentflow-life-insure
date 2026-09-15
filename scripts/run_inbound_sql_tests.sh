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
M4="$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql"
M5="$ROOT/supabase/migrations/20260915025931_inbound_routing_v2_settings.sql"
M6="$ROOT/supabase/migrations/20260915025932_inbound_route_attempts_d13_and_recovery.sql"
M7="$ROOT/supabase/migrations/20260915025933_inbound_voicemails.sql"

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

echo "ALL INBOUND SQL SUITES GREEN (M1-M3 + v2 M4-M7, incl. the rollback proof)"
