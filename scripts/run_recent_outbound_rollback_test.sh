#!/usr/bin/env bash
# =====================================================================================================
# Recent-outbound callback routing (20260927052736) — migration mechanics + ROLLBACK proof
# (disposable LOCAL PostgreSQL only; AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_recent_outbound_rollback_test.sh
#
# On its own throwaway database (harness + M1–M9):
#   1. a copy of the forward migration with an injected failing LAST postcondition leaves NOTHING applied;
#   2. a concurrent lock holder on inbound_route_attempts makes the apply fail with 55P03 in ≈1 s, nothing applied;
#   3. the forward applies (inert: no configuration row); the §A7 permission matrix holds as the real roles;
#   4. seed: the ops ENABLE script (guards + idempotency), verified evidence, a committed recent_outbound attempt;
#   5. the forward refuses a replay; the REAL rollback restores the M6 bodies (md5 + metadata), drops the
#      resolver and the record RPC, KEEPS the retained objects and their data, disables every configuration row;
#      the rollback re-runs as a no-op;
#   6. on the residue: the injected-failure copy changes nothing; the forward REFUSES a residue with RLS enabled
#      or forced or an UNLOGGED table, and while a configuration row is enabled; the ops DISABLE script clears it;
#      the forward re-applies cleanly and INERT;
#   7. negative control (fresh database): a copy WITHOUT its REVOKEs fails the permission postconditions, and
#      without its postconditions too it applies and the §A7 matrix probe DETECTS the missing REVOKEs;
#   8. ONE query string (fresh database): the forward, the rollback and the re-apply each succeed when the whole
#      file is sent as a single query string (psql -c, as a single simple-query apply sends it).
# Refuses to run when PGURL does not point at localhost.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

DB="ro_rollback_test_$$"
NDB="ro_negative_test_$$"
SDB="ro_onestring_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FWD="$ROOT/supabase/migrations/20260927052736_inbound_recent_outbound_routing.sql"
RB="$ROOT/supabase/migrations/rollback/20260927052736_inbound_recent_outbound_routing.rollback.sql"
ENABLE="$ROOT/supabase/ops/recent_outbound_enable_org.sql"
DISABLE="$ROOT/supabase/ops/recent_outbound_disable.sql"
TMP="$(mktemp -d)"
cleanup() {
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $NDB;" >/dev/null 2>&1 || true
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $SDB;" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

q() { psql "$PGURL/$1" -Atc "$2"; }
expect() {  # $1 = actual, $2 = expected, $3 = label
  if [ "$1" != "$2" ]; then echo "RECENT-OUTBOUND ROLLBACK PROOF FAILED ($3): got '$1', expected '$2'"; exit 1; fi
  echo "OK: $3"
}
build() {   # $1 = database: harness + M1–M9
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  for f in "$ROOT/supabase/tests/inbound_harness.sql" \
           "$ROOT/supabase/migrations/20260823222528_inbound_identity_foundation.sql" \
           "$ROOT/supabase/migrations/20260823222805_inbound_claim_lifecycle.sql" \
           "$ROOT/supabase/migrations/20260823222926_recording_source_sid.sql" \
           "$ROOT/supabase/tests/inbound_v2_harness.sql" \
           "$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql" \
           "$ROOT/supabase/migrations/20260915025931_inbound_routing_v2_settings.sql" \
           "$ROOT/supabase/migrations/20260915035141_inbound_route_attempts_d13_and_recovery.sql" \
           "$ROOT/supabase/migrations/20260915053646_inbound_voicemails.sql" \
           "$ROOT/supabase/migrations/20260918000614_voicemail_cleanup_actionable_selection.sql" \
           "$ROOT/supabase/migrations/20260918002859_voicemail_first_listen_guard.sql"; do
    if ! psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$f" > "$TMP/build.log" 2>&1; then
      grep -v "NOTICE:" "$TMP/build.log" | tail -20; echo "BUILD FAILED: $(basename "$f")"; exit 1
    fi
  done
}
apply_fwd() {  # $1 = database, $2 = file; prints OK or the (verbose) error line
  if psql "$PGURL/$1" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -q --single-transaction -f "$2" > "$TMP/apply.log" 2>&1; then
    echo OK
  else
    grep -m1 "ERROR:" "$TMP/apply.log" | sed 's/^.*ERROR:  //'
  fi
}
apply_one_string() {  # $1 = database, $2 = file sent as ONE query string (psql -c); prints OK or the (verbose) error line
  if psql "$PGURL/$1" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -q -c "$(cat "$2")" > "$TMP/apply1.log" 2>&1; then
    echo OK
  else
    grep -m1 "ERROR:" "$TMP/apply1.log" | sed 's/^.*ERROR:  //'
  fi
}
run_file() {   # $1 = database, $2 = file, $3 = label (must succeed)
  if ! psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$2" > "$TMP/run.log" 2>&1; then
    cat "$TMP/run.log"; echo "RECENT-OUTBOUND ROLLBACK PROOF FAILED ($3)"; exit 1
  fi
}
ops_rows() {   # $1 = database, $2 = ops script (must succeed); prints its result rows "org|changed|enabled|unanswered|allowlist"
  if ! psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -At -f "$2" > "$TMP/ops.log" 2>&1; then cat "$TMP/ops.log"; echo "OPS SCRIPT FAILED: $2"; return 1; fi
  grep -E '^[0-9a-f]{8}-[0-9a-f-]{27}[|]' "$TMP/ops.log" | cut -d'|' -f1-5 || true
}
run_file_fails() {  # $1 = database, $2 = file; prints the first error line
  if psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$2" > "$TMP/run.log" 2>&1; then echo "UNEXPECTED-SUCCESS"; else grep -m1 "ERROR:" "$TMP/run.log" | sed 's/^.*ERROR:  //'; fi
}
# Everything the forward creates or changes, in one line (the "nothing applied" / "residue" witness).
STATE_SQL="SELECT concat_ws('|',
  (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)'::regprocedure),
  (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.intended_recipients_for_call(uuid,uuid)'::regprocedure),
  coalesce(to_regprocedure('private.recent_outbound_route_candidate(uuid,uuid,boolean)')::text, 'no-resolver'),
  coalesce(to_regprocedure('public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)')::text, 'no-rpc'),
  coalesce(to_regclass('private.outbound_dial_evidence')::text, 'no-evidence-table'),
  coalesce(to_regclass('private.recent_outbound_routing_orgs')::text, 'no-config-table'),
  (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.inbound_route_attempts'::regclass AND attname LIKE 'owner_evidence_%' AND NOT attisdropped),
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.inbound_route_attempts'::regclass AND conname = 'inbound_route_attempts_owner_source_check'),
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.inbound_route_attempts'::regclass AND conname = 'inbound_route_attempts_owner_evidence_check'))"
M6_PLAN=a3f59ba5a8d35ed98300d6f1dab38295
M6_IRC=7104284f7aa79c8d1ef270eb0fe82de2

# The §A7 permission matrix as the REAL roles; prints the violations ('' = none).
matrix() {  # $1 = database
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q 2>&1 <<'EOF' | sed -n 's/^NOTICE:  MATRIX=//p'
CREATE FUNCTION pg_temp.st(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql; v := 'OK'; EXCEPTION WHEN OTHERS THEN v := SQLSTATE; END;
  RESET ROLE;
  RETURN v;
END $f$;
BEGIN;
DO $m$
DECLARE v_bad text[] := '{}'; v_role text; s text; e text;
  rpc constant text := 'public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)';
  rpc_call constant text := 'SELECT public.record_outbound_dial_evidence(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(v_role, 'private', 'USAGE') THEN v_bad := v_bad || (v_role || ':private-usage'); END IF;
    FOREACH s IN ARRAY ARRAY['SELECT 1 FROM private.outbound_dial_evidence', 'DELETE FROM private.outbound_dial_evidence',
                             'SELECT 1 FROM private.recent_outbound_routing_orgs', 'UPDATE private.recent_outbound_routing_orgs SET enabled = true',
                             'SELECT * FROM private.recent_outbound_route_candidate(NULL, NULL, true)',
                             'SELECT private.intended_recipients_for_call(NULL, NULL)'] LOOP
      e := pg_temp.st(v_role, s);
      IF e <> '42501' THEN v_bad := v_bad || (v_role || ':' || s || '=' || e); END IF;
    END LOOP;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH s IN ARRAY ARRAY[rpc_call, 'SELECT public.plan_inbound_route(NULL,NULL,NULL,NULL,NULL,20)',
                             'SELECT public.converge_inbound_notifications(NULL)', 'SELECT public.abandon_inbound_routing(NULL,NULL,NULL)',
                             'SELECT public.sweep_inbound_route_attempts()', 'SELECT public.sweep_inbound_notifications()'] LOOP
      e := pg_temp.st(v_role, s);
      IF e <> '42501' THEN v_bad := v_bad || (v_role || ':' || CASE WHEN s = rpc_call THEN 'record-rpc' ELSE left(s, 45) END || '=' || e); END IF;
    END LOOP;
  END LOOP;
  IF pg_temp.st('service_role', rpc_call) <> 'OK' THEN v_bad := v_bad || 'service_role:record-rpc-refused'::text; END IF;
  IF has_function_privilege('public', rpc, 'EXECUTE') THEN v_bad := v_bad || 'PUBLIC:record-rpc'::text; END IF;
  IF has_function_privilege('public', 'private.recent_outbound_route_candidate(uuid,uuid,boolean)', 'EXECUTE') THEN v_bad := v_bad || 'PUBLIC:resolver'::text; END IF;
  IF has_function_privilege('public', 'private.intended_recipients_for_call(uuid,uuid)', 'EXECUTE') THEN v_bad := v_bad || 'PUBLIC:intended-recipients'::text; END IF;
  RAISE NOTICE 'MATRIX=%', array_to_string(v_bad, ',');
END $m$;
ROLLBACK;
EOF
}

echo "== build harness + M1–M9 on $DB (locality: $PGURL) =="
build "$DB"
BASE_STATE="$(q "$DB" "$STATE_SQL")"
expect "$(echo "$BASE_STATE" | cut -d'|' -f1-2)" "$M6_PLAN|$M6_IRC" "M6 bodies before the forward (md5(prosrc) = production's)"

echo "== 1. injected failing LAST postcondition ⇒ nothing applied =="
python3 - "$FWD" "$TMP/fwd_fail_last.sql" <<'PY'
import sys
s = open(sys.argv[1]).read()
needle = "END;\n$post$;\n"
assert s.count(needle) == 1
open(sys.argv[2], "w").write(s.replace(needle, "  RAISE EXCEPTION 'injected last-postcondition failure';\nEND;\n$post$;\n"))
PY
expect "$(apply_fwd "$DB" "$TMP/fwd_fail_last.sql")" "P0001: injected last-postcondition failure" "the injected copy fails at its last postcondition"
expect "$(q "$DB" "$STATE_SQL")" "$BASE_STATE" "nothing applied (bodies, functions, tables, columns, CHECKs unchanged)"

echo "== 2. a concurrent lock holder ⇒ 55P03 in ≈1 s, nothing applied =="
PGAPPNAME=ro_lock_holder psql "$PGURL/$DB" -q <<'EOF' > /dev/null 2>&1 &
BEGIN;
LOCK TABLE public.inbound_route_attempts IN ACCESS SHARE MODE;
SELECT pg_sleep(30);
COMMIT;
EOF
HOLDER=$!
for _ in $(seq 1 50); do
  [ "$(q "$DB" "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'ro_lock_holder' AND l.relation = 'public.inbound_route_attempts'::regclass AND l.granted;")" = "1" ] && break
  sleep 0.1
done
T0=$(date +%s%N)
RES="$(apply_fwd "$DB" "$FWD")"
T1=$(date +%s%N)
q "$DB" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'ro_lock_holder';" > /dev/null
wait "$HOLDER" 2>/dev/null || true
ELAPSED_MS=$(( (T1 - T0) / 1000000 ))
expect "$(echo "$RES" | cut -d: -f1)" "55P03" "the apply fails with lock_not_available (${ELAPSED_MS} ms: $RES)"
[ "$ELAPSED_MS" -ge 900 ] && [ "$ELAPSED_MS" -le 3000 ] || { echo "RECENT-OUTBOUND ROLLBACK PROOF FAILED (lock wait ${ELAPSED_MS} ms, expected ≈1 s)"; exit 1; }
echo "OK: bounded by lock_timeout (${ELAPSED_MS} ms)"
expect "$(q "$DB" "$STATE_SQL")" "$BASE_STATE" "nothing applied after the lock timeout"

echo "== 3. the forward applies (inert) and the permission matrix holds =="
expect "$(apply_fwd "$DB" "$FWD")" "OK" "forward applied in one transaction"
FWD_PLAN="$(q "$DB" "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)'::regprocedure;")"
FWD_IRC="$(q "$DB" "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.intended_recipients_for_call(uuid,uuid)'::regprocedure;")"
[ "$FWD_PLAN" != "$M6_PLAN" ] && [ "$FWD_IRC" != "$M6_IRC" ] || { echo "RECENT-OUTBOUND ROLLBACK PROOF FAILED (bodies not replaced)"; exit 1; }
echo "OK: replaced bodies md5 plan=$FWD_PLAN intended_recipients=$FWD_IRC"
expect "$(q "$DB" "SELECT count(*) FROM private.recent_outbound_routing_orgs;")" "0" "ships dark: no configuration row"
expect "$(matrix "$DB")" "" "§A7 permission matrix as anon / authenticated / service_role / PUBLIC"
expect "$(apply_fwd "$DB" "$FWD")" "P0001: recent_outbound: plan_inbound_route / intended_recipients_for_call are not the M6 bodies; refusing" "a replay of the forward is refused"

echo "== 4. seed: ops enable (guards, idempotency), verified evidence, a committed recent_outbound attempt =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO public.organizations (id, name) VALUES ('a0000000-0000-0000-0000-000000000001', 'Agency'), ('a0000000-0000-0000-0000-000000000002', 'Other');
INSERT INTO auth.users (id) VALUES ('a0000000-0000-0000-0000-0000000000d1'), ('a0000000-0000-0000-0000-0000000000a1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status) VALUES
  ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'Agent', 'Active', 'rb_d1', 'Available'),
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'Agent', 'Active', 'rb_a1', 'Available');
INSERT INTO public.agent_phone_registrations (agent_id, registration_id, organization_id, seq, registered, registered_at, last_seen_at, last_state)
VALUES ('a0000000-0000-0000-0000-0000000000d1', gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 1, true, now(), now(), 'registered'),
       ('a0000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 1, true, now(), now(), 'registered');
INSERT INTO public.phone_numbers (organization_id, phone_number, assignment_type) VALUES ('a0000000-0000-0000-0000-000000000001', '+15550001234', 'agency');
INSERT INTO public.inbound_routing_settings (organization_id, routing_engine, inbound_group_agent_ids)
VALUES ('a0000000-0000-0000-0000-000000000001', 'legacy', ARRAY['a0000000-0000-0000-0000-0000000000a1']::uuid[]);
-- another organization's disabled row with an allowlist (must survive the rollback untouched except flags)
INSERT INTO private.recent_outbound_routing_orgs (organization_id, enabled, did_allowlist) VALUES ('a0000000-0000-0000-0000-000000000002', false, ARRAY['+15550009999']);
EOF
expect "$(run_file_fails "$DB" "$ENABLE")" "recent_outbound enable: organization a0000000-0000-0000-0000-000000000001 routes on legacy (v2 required); refusing" "enable refuses an organization on the legacy engine"
q "$DB" "UPDATE public.inbound_routing_settings SET routing_engine = 'v2' WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';" >/dev/null
q "$DB" "UPDATE private.recent_outbound_routing_orgs SET enabled = true WHERE organization_id = 'a0000000-0000-0000-0000-000000000002';" >/dev/null
expect "$(run_file_fails "$DB" "$ENABLE")" "recent_outbound enable: expected exactly organization a0000000-0000-0000-0000-000000000001 enabled, found 2 enabled row(s); rolled back" "enable refuses when another organization is enabled (rolled back)"
expect "$(q "$DB" "SELECT count(*) FROM private.recent_outbound_routing_orgs WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';")" "0" "the refused enable wrote nothing"
q "$DB" "UPDATE private.recent_outbound_routing_orgs SET enabled = false WHERE organization_id = 'a0000000-0000-0000-0000-000000000002';" >/dev/null
expect "$(ops_rows "$DB" "$ENABLE")" "a0000000-0000-0000-0000-000000000001|t|t|f|" "ops enable creates the row (changed, enabled, unanswered_eligible false, allowlist NULL)"
expect "$(ops_rows "$DB" "$ENABLE")" "a0000000-0000-0000-0000-000000000001|f|t|f|" "ops enable is idempotent (changed = f)"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q > /dev/null <<'EOF'
INSERT INTO public.calls (id, organization_id, agent_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, created_at, ended_at)
VALUES ('a0000000-0000-0000-0001-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'outbound', 'completed',
        'CA00000000000000000000000000000b01', '+19995550001', '+15550001234', now() - interval '1 hour', now() - interval '1 hour');
SET ROLE service_role;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.record_outbound_dial_evidence('AC000000000000000000000000000000aa', 'AC000000000000000000000000000000aa',
         'CA00000000000000000000000000000b01', 'CA00000000000000000000000000000c01', 'completed', 'client:rb_d1', '+19995550001',
         'AC000000000000000000000000000000aa', 'client:rb_d1', 'AC000000000000000000000000000000aa', 'CA00000000000000000000000000000b01',
         '+19995550001', '+15550001234', 'completed', now() - interval '1 hour');
  IF r->>'reason' IS DISTINCT FROM 'recorded' THEN RAISE EXCEPTION 'seed evidence %', r; END IF;
END $$;
RESET ROLE;
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, routing_engine)
VALUES ('a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001', 'inbound', 'ringing', 'CA00000000000000000000000000000d01', '+19995550001', '+15550001234', 'v2');
SET ROLE service_role;
SELECT public.plan_inbound_route('a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001', NULL, NULL, ARRAY['a0000000-0000-0000-0000-0000000000a1']::uuid[], 20) IS NOT NULL AS planned;
RESET ROLE;
EOF
ATTEMPT="$(q "$DB" "SELECT owner_source || ':' || owner_agent_id || ':' || owner_evidence_dial_call_sid || ':' || owner_evidence_outcome FROM public.inbound_route_attempts WHERE call_id = 'a0000000-0000-0000-0002-000000000001';")"
expect "$ATTEMPT" "recent_outbound:a0000000-0000-0000-0000-0000000000d1:CA00000000000000000000000000000c01:answered" "seeded a committed recent_outbound attempt with its evidence"
EVIDENCE_BEFORE="$(q "$DB" "SELECT md5(string_agg(to_jsonb(e)::text, ',' ORDER BY dial_call_sid)) FROM private.outbound_dial_evidence e;")"
ATTEMPTS_BEFORE="$(q "$DB" "SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY id)) FROM public.inbound_route_attempts a;")"
CONFIG_BEFORE="$(q "$DB" "SELECT string_agg(organization_id || ':' || coalesce(did_allowlist::text, 'all'), ',' ORDER BY organization_id) FROM private.recent_outbound_routing_orgs;")"

echo "== 5. the REAL rollback (config ENABLED at the time) =="
expect "$(q "$DB" "SELECT count(*) FROM private.recent_outbound_routing_orgs WHERE enabled;")" "1" "one organization enabled before the rollback"
run_file "$DB" "$RB" "rollback"
expect "$(q "$DB" "$STATE_SQL" | cut -d'|' -f1-4)" "$M6_PLAN|$M6_IRC|no-resolver|no-rpc" "M6 bodies restored (md5) and the resolver + record RPC dropped"
expect "$(q "$DB" "SELECT p.prosecdef || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ';') || ':' || p.proowner::regrole || ':' || array_to_string(p.proacl, ';') FROM pg_proc p WHERE p.oid = 'public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)'::regprocedure;")" \
       "true:v:search_path=pg_catalog, pg_temp:postgres:postgres=X/postgres;service_role=X/postgres" "plan_inbound_route attributes and ACL are production's"
expect "$(q "$DB" "SELECT p.prosecdef || ':' || p.provolatile::text || ':' || array_to_string(p.proacl, ';') FROM pg_proc p WHERE p.oid = 'private.intended_recipients_for_call(uuid,uuid)'::regprocedure;")" \
       "false:s:postgres=X/postgres" "intended_recipients_for_call attributes and ACL are production's"
expect "$(q "$DB" "$STATE_SQL" | cut -d'|' -f5-)" "private.outbound_dial_evidence|private.recent_outbound_routing_orgs|3|CHECK ((owner_source = ANY (ARRAY['contact'::text, 'direct_line'::text, 'recent_outbound'::text])))|1" \
       "retained: both private tables, the three columns, the widened CHECK and the evidence CHECK"
expect "$(q "$DB" "SELECT md5(string_agg(to_jsonb(e)::text, ',' ORDER BY dial_call_sid)) FROM private.outbound_dial_evidence e;")" "$EVIDENCE_BEFORE" "evidence rows retained byte-for-byte"
expect "$(q "$DB" "SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY id)) FROM public.inbound_route_attempts a;")" "$ATTEMPTS_BEFORE" "attempt rows (incl. recent_outbound) retained byte-for-byte"
expect "$(q "$DB" "SELECT string_agg(organization_id || ':' || coalesce(did_allowlist::text, 'all'), ',' ORDER BY organization_id) FROM private.recent_outbound_routing_orgs;")" "$CONFIG_BEFORE" "configuration rows retained"
expect "$(q "$DB" "SELECT count(*) FROM private.recent_outbound_routing_orgs WHERE enabled OR unanswered_eligible;")" "0" "every configuration row disabled"
expect "$(q "$DB" "SELECT private.intended_recipients_for_call('a0000000-0000-0000-0002-000000000001', 'a0000000-0000-0000-0000-000000000001')::text;")" \
       "{a0000000-0000-0000-0000-0000000000a1}" "after rollback the M6 recovery precedence applies (group) — documented"
RESIDUE_STATE="$(q "$DB" "$STATE_SQL")"
run_file "$DB" "$RB" "rollback re-run"
expect "$(q "$DB" "$STATE_SQL")" "$RESIDUE_STATE" "the rollback re-runs as a no-op"

echo "== 6. on the residue: injected failure changes nothing; refusal while enabled; disable; forward re-applies inert =="
expect "$(apply_fwd "$DB" "$TMP/fwd_fail_last.sql")" "P0001: injected last-postcondition failure" "the injected copy fails on the residue"
expect "$(q "$DB" "$STATE_SQL")" "$RESIDUE_STATE" "nothing applied on the residue"
residue_drift() {  # $1 = label, $2 = drift DDL, $3 = restoring DDL, $4 = drifted table
  q "$DB" "$2" >/dev/null
  expect "$(apply_fwd "$DB" "$FWD")" "P0001: recent_outbound: retained objects are neither absent nor the exact rollback residue (drift: $4 owner/grants/RLS/persistence/triggers/policies/publication); refusing" \
         "the forward REFUSES a residue with $1"
  expect "$(q "$DB" "$STATE_SQL")" "$RESIDUE_STATE" "the refused forward applied nothing ($1)"
  q "$DB" "$3" >/dev/null
}
residue_drift "RLS enabled" "ALTER TABLE private.outbound_dial_evidence ENABLE ROW LEVEL SECURITY;" \
              "ALTER TABLE private.outbound_dial_evidence DISABLE ROW LEVEL SECURITY;" "private.outbound_dial_evidence"
residue_drift "RLS forced" "ALTER TABLE private.recent_outbound_routing_orgs FORCE ROW LEVEL SECURITY;" \
              "ALTER TABLE private.recent_outbound_routing_orgs NO FORCE ROW LEVEL SECURITY;" "private.recent_outbound_routing_orgs"
residue_drift "an UNLOGGED table" "ALTER TABLE private.recent_outbound_routing_orgs SET UNLOGGED;" \
              "ALTER TABLE private.recent_outbound_routing_orgs SET LOGGED;" "private.recent_outbound_routing_orgs"
q "$DB" "UPDATE private.recent_outbound_routing_orgs SET enabled = true WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';" >/dev/null
expect "$(apply_fwd "$DB" "$FWD")" "P0001: recent_outbound: 1 configuration row(s) enabled; run supabase/ops/recent_outbound_disable.sql first; refusing" "the forward REFUSES while a configuration row is enabled"
expect "$(q "$DB" "$STATE_SQL")" "$RESIDUE_STATE" "the refused forward applied nothing"
expect "$(ops_rows "$DB" "$DISABLE")" "a0000000-0000-0000-0000-000000000001|t|f|f|" "ops disable reports exactly the row it changed"
expect "$(ops_rows "$DB" "$DISABLE")" "" "ops disable is idempotent (nothing to change)"
expect "$(apply_fwd "$DB" "$FWD")" "OK" "the forward re-applies on the residue"
expect "$(q "$DB" "$STATE_SQL" | cut -d'|' -f1-2)" "$FWD_PLAN|$FWD_IRC" "re-applied bodies are the forward bodies"
expect "$(q "$DB" "SELECT count(*) || ':' || count(*) FILTER (WHERE enabled OR unanswered_eligible) FROM private.recent_outbound_routing_orgs;")" "2:0" "re-applied INERT: configuration rows kept, none enabled"
expect "$(q "$DB" "SELECT md5(string_agg(to_jsonb(e)::text, ',' ORDER BY dial_call_sid)) FROM private.outbound_dial_evidence e;")" "$EVIDENCE_BEFORE" "evidence still intact after re-apply"
expect "$(matrix "$DB")" "" "§A7 permission matrix after re-apply"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q > /dev/null <<'EOF'
UPDATE public.inbound_route_attempts SET terminal = true, reserved_agent_ids = '{}' WHERE NOT terminal;
UPDATE public.calls SET status = 'completed', ended_at = now() WHERE direction = 'inbound' AND ended_at IS NULL;
INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, routing_engine) VALUES
  ('a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001', 'inbound', 'ringing', 'CA00000000000000000000000000000d02', '+19995550001', '+15550001234', 'v2'),
  ('a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001', 'inbound', 'ringing', 'CA00000000000000000000000000000d03', '+19995550001', '+15550001234', 'v2');
SET ROLE service_role;
SELECT public.plan_inbound_route('a0000000-0000-0000-0002-000000000002', 'a0000000-0000-0000-0000-000000000001', NULL, NULL, ARRAY['a0000000-0000-0000-0000-0000000000a1']::uuid[], 20) IS NOT NULL AS planned;
RESET ROLE;
EOF
expect "$(q "$DB" "SELECT mode || ':' || eligibility_reason FROM public.inbound_route_attempts WHERE call_id = 'a0000000-0000-0000-0002-000000000002';")" "group:no_owner->group" "inert: a disabled switch routes the group even with retained evidence"
expect "$(ops_rows "$DB" "$ENABLE")" "a0000000-0000-0000-0000-000000000001|t|t|f|" "ops enable after the re-apply"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -c "SET ROLE service_role; SELECT public.plan_inbound_route('a0000000-0000-0000-0002-000000000003', 'a0000000-0000-0000-0000-000000000001', NULL, NULL, ARRAY['a0000000-0000-0000-0000-0000000000a1']::uuid[], 20) IS NOT NULL;" > /dev/null
expect "$(q "$DB" "SELECT owner_source || ':' || owner_agent_id FROM public.inbound_route_attempts WHERE call_id = 'a0000000-0000-0000-0002-000000000003';")" \
       "recent_outbound:a0000000-0000-0000-0000-0000000000d1" "re-enabled: the retained evidence routes again"

echo "== 7. negative control: the forward WITHOUT its REVOKEs (fresh database $NDB) =="
build "$NDB"
grep -v '^REVOKE ' "$FWD" > "$TMP/fwd_no_revoke.sql"
[ "$(grep -c '^REVOKE ' "$FWD")" -gt 0 ] || { echo "RECENT-OUTBOUND ROLLBACK PROOF FAILED (no REVOKE lines found to remove)"; exit 1; }
expect "$(apply_fwd "$NDB" "$TMP/fwd_no_revoke.sql")" "P0001: recent_outbound postcondition: record_outbound_dial_evidence attributes or grantees wrong" \
       "without its REVOKEs the permission postconditions refuse the migration"
expect "$(q "$NDB" "$STATE_SQL" | cut -d'|' -f1-4)" "$M6_PLAN|$M6_IRC|no-resolver|no-rpc" "the refused copy applied nothing"
python3 - "$TMP/fwd_no_revoke.sql" "$TMP/fwd_no_revoke_no_post.sql" <<'PY'
import sys
s = open(sys.argv[1]).read()
a = s.index("-- ── 7. Postconditions"); b = s.index("-- ── end of postconditions ──")
open(sys.argv[2], "w").write(s[:a] + s[b:])
PY
expect "$(apply_fwd "$NDB" "$TMP/fwd_no_revoke_no_post.sql")" "OK" "the same copy without its postconditions applies"
expect "$(matrix "$NDB")" "anon:record-rpc=OK,authenticated:record-rpc=OK,PUBLIC:record-rpc,PUBLIC:resolver" \
       "the §A7 matrix probe DETECTS every missing REVOKE"

echo "== 8. ONE query string (psql -c, as a single simple-query apply sends it) on a fresh database $SDB =="
build "$SDB"
expect "$(apply_one_string "$SDB" "$FWD")" "OK" "the forward applies as ONE query string"
expect "$(q "$SDB" "$STATE_SQL" | cut -d'|' -f1-2)" "$FWD_PLAN|$FWD_IRC" "one-string forward: the forward bodies (md5) — metadata postconditions held"
expect "$(q "$SDB" "SELECT count(*) FROM private.recent_outbound_routing_orgs;")" "0" "one-string forward ships dark"
expect "$(apply_one_string "$SDB" "$RB")" "OK" "the rollback applies as ONE query string"
expect "$(q "$SDB" "$STATE_SQL" | cut -d'|' -f1-4)" "$M6_PLAN|$M6_IRC|no-resolver|no-rpc" "one-string rollback: M6 bodies restored, resolver + record RPC dropped"
expect "$(apply_one_string "$SDB" "$FWD")" "OK" "the forward re-applies on the residue as ONE query string"
expect "$(q "$SDB" "$STATE_SQL" | cut -d'|' -f1-2)" "$FWD_PLAN|$FWD_IRC" "one-string re-apply: the forward bodies (md5)"

echo "RECENT-OUTBOUND ROLLBACK PROOF GREEN (nothing applied on failure or lock timeout; forward → rollback → forward inert; residue drift refused; ops guards; negative control detected; one-query-string apply)"
