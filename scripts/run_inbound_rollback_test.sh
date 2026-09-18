#!/usr/bin/env bash
# =====================================================================================================
# Inbound Calling v2 — ROLLBACK proof (disposable LOCAL PostgreSQL only; AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_inbound_rollback_test.sh
#
# Applies the complete inbound schema through M7 on a throwaway database, then runs the REAL rollback
# scripts in their documented order (M7 → M6) after satisfying their documented data prerequisites,
# checks the state each one is supposed to leave — including PostgreSQL's own answer for the per-call
# decision column the handler probes — and finally REAPPLIES M6 + M7 so a development stack that ran
# this proof is usable again. Refuses to run when PGURL does not point at localhost.
#
# This stack has NO pg_cron: that is deliberate — it is the state in which the M7 rollback used to abort
# while preparing `cron.job`. Extension-PRESENT behaviour (jobs absent / present, unrelated jobs
# preserved) is NOT exercised here; it needs a stack with pg_cron installed.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

DB="inbound_rollback_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M4="$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql"
M5="$ROOT/supabase/migrations/20260915025931_inbound_routing_v2_settings.sql"
M6="$ROOT/supabase/migrations/20260915035141_inbound_route_attempts_d13_and_recovery.sql"
M7="$ROOT/supabase/migrations/20260915053646_inbound_voicemails.sql"
RB4="$ROOT/supabase/migrations/rollback/20260914000530_inbound_agent_settings_and_registrations.rollback.sql"
RB5="$ROOT/supabase/migrations/rollback/20260915025931_inbound_routing_v2_settings.rollback.sql"
RB6="$ROOT/supabase/migrations/rollback/20260915035141_inbound_route_attempts_d13_and_recovery.rollback.sql"
RB7="$ROOT/supabase/migrations/rollback/20260915053646_inbound_voicemails.rollback.sql"

psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;"' EXIT

apply() {   # $1 = file, $2 = label
  if ! psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$1" > /tmp/rb_apply.log 2>&1; then
    grep -v "^psql:.*NOTICE:" /tmp/rb_apply.log | tail -20; echo "FAILED: $2"; exit 1
  fi
  echo "   applied: $2"
}
q() { psql "$PGURL/$DB" -Atc "$1"; }
# PostgreSQL's own SQLSTATE for a statement, or 'OK' when it succeeds.
sqlstate() {
  psql "$PGURL/$DB" -Atc "DO \$probe\$ BEGIN $1; RAISE NOTICE 'SQLSTATE=OK'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'SQLSTATE=%', SQLSTATE; END \$probe\$;" 2>&1 |
    sed -n 's/^NOTICE:  SQLSTATE=\(.*\)$/\1/p' | head -1
}
expect() {  # $1 = actual, $2 = expected, $3 = label
  if [ "$1" != "$2" ]; then echo "ROLLBACK PROOF FAILED ($3): got '$1', expected '$2'"; exit 1; fi
  echo "   OK: $3"
}

echo "== rollback proof: build the complete schema through M7 (no pg_cron on this stack) =="
psql "$PGURL/$DB" -Atc "SELECT count(*) FROM pg_extension WHERE extname = 'pg_cron';" | grep -qx 0 \
  || { echo "REFUSING: this proof asserts the NO-pg_cron state, but pg_cron is installed"; exit 2; }
for f in "$ROOT/supabase/tests/inbound_harness.sql" \
         "$ROOT/supabase/migrations/20260823222528_inbound_identity_foundation.sql" \
         "$ROOT/supabase/migrations/20260823222805_inbound_claim_lifecycle.sql" \
         "$ROOT/supabase/migrations/20260823222926_recording_source_sid.sql" \
         "$ROOT/supabase/tests/inbound_v2_harness.sql" "$M4" "$M5" "$M6" "$M7"; do
  apply "$f" "$(basename "$f")"
done
expect "$(sqlstate "PERFORM routing_engine FROM public.calls LIMIT 1")" "OK" "calls.routing_engine present before rollback"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_phone_registrations','TRUNCATE')::text;")" "false" "authenticated has NO TRUNCATE on agent_phone_registrations before rollback"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_inbound_settings','TRUNCATE')::text;")" "false" "authenticated has NO TRUNCATE on agent_inbound_settings before rollback"
expect "$(q "SELECT to_regclass('public.voicemails') IS NOT NULL;")" "t" "voicemails present before rollback"
expect "$(q "SELECT to_regclass('public.inbound_route_attempts') IS NOT NULL;")" "t" "inbound_route_attempts present before rollback"

echo "== documented prerequisite for the M7 rollback: no stored voicemail metadata would be lost =="
expect "$(q "SELECT count(*) FROM public.voicemails WHERE status = 'stored';")" "0" "zero stored voicemails"

echo "== run the REAL M7 rollback (the state in which it used to abort on a stack without pg_cron) =="
apply "$RB7" "M7 rollback"
expect "$(q "SELECT to_regclass('public.voicemails') IS NULL;")" "t" "voicemails dropped"
expect "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='converge_inbound_notifications';")" "0" "convergence function dropped"
expect "$(sqlstate "PERFORM voicemail_id FROM public.calls LIMIT 1")" "42703" "calls.voicemail_id dropped"

echo "== documented prerequisite for the M6 rollback: M7 is already rolled back =="
expect "$(q "SELECT to_regclass('public.voicemails') IS NULL;")" "t" "M7 gone before M6 rollback"

echo "== run the REAL M6 rollback =="
apply "$RB6" "M6 rollback"
# The exact probe the handler makes when the decision RPC cannot answer (corrective pass 8).
expect "$(sqlstate "PERFORM routing_engine FROM public.calls LIMIT 1")" "42703" "PostgreSQL reports calls.routing_engine absent"
expect "$(sqlstate "PERFORM public.record_inbound_engine_decision('00000000-0000-0000-0000-000000000000'::uuid,'00000000-0000-0000-0000-000000000000'::uuid,'v2')")" "42883" "PostgreSQL reports the decision RPC absent"
expect "$(q "SELECT to_regclass('public.inbound_route_attempts') IS NULL;")" "t" "inbound_route_attempts dropped"
# Safeguard 4: the D13 finalize body is deliberately RETAINED and still works with the table gone.
expect "$(sqlstate "PERFORM public.finalize_inbound_call_terminal('00000000-0000-0000-0000-000000000000'::uuid,'00000000-0000-0000-0000-000000000000'::uuid,'no-answer',true)")" "OK" "retained finalize still runs after the rollback"

echo "== run the REAL M5 and M4 rollbacks — the full set, in reverse order =="
apply "$RB5" "M5 rollback"
expect "$(sqlstate "PERFORM routing_engine FROM public.inbound_routing_settings LIMIT 1")" "42703" "inbound_routing_settings.routing_engine dropped"
apply "$RB4" "M4 rollback"
expect "$(q "SELECT to_regclass('public.agent_phone_registrations') IS NULL;")" "t" "agent_phone_registrations dropped"
expect "$(q "SELECT to_regclass('public.agent_inbound_settings') IS NULL;")" "t" "agent_inbound_settings dropped"
expect "$(sqlstate "PERFORM public.is_phone_connected('00000000-0000-0000-0000-000000000000'::uuid)")" "42883" "PostgreSQL reports the presence predicate absent"
# the pre-existing table survives its ALTERs being reverted
expect "$(q "SELECT to_regclass('public.inbound_routing_settings') IS NOT NULL;")" "t" "the pre-existing routing settings table survives"

echo "== REAPPLY M4 → M7 — a development stack that ran this proof stays usable =="
apply "$M4" "M4 reapplied"
apply "$M5" "M5 reapplied"
apply "$M6" "M6 reapplied"
apply "$M7" "M7 reapplied"
# M4's presence predicate comes back with the security attribute and ACL the §7.7 scope approves
expect "$(q "SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_phone_connected';")" "f" "is_phone_connected reapplied as SECURITY INVOKER"
expect "$(q "SELECT coalesce(array_to_string(p.proacl,',') LIKE '%anon=%', false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_phone_connected';")" "f" "anon holds no EXECUTE after reapply"
expect "$(q "SELECT count(*)::text FROM pg_policy WHERE polrelid='public.agent_phone_registrations'::regclass AND pg_get_expr(polqual, polrelid) LIKE '%get_org_id()%';")" "2" "both registration policies organization-scoped after reapply"
# Corrective pass 11: the EXACT privileges survive a rollback and reapplication on a database whose
# default privileges hand every new table the full set (the v2 harness reproduces production's).
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_inbound_settings','SELECT')::text;")" "true"  "authenticated keeps SELECT on agent_inbound_settings after reapply"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_inbound_settings','UPDATE')::text;")" "true"  "authenticated keeps UPDATE on agent_inbound_settings after reapply"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_inbound_settings','TRUNCATE')::text;")" "false" "authenticated has NO TRUNCATE on agent_inbound_settings after reapply"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_inbound_settings','DELETE')::text;")" "false" "authenticated has NO DELETE on agent_inbound_settings after reapply"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_phone_registrations','SELECT')::text;")" "true"  "authenticated keeps SELECT on agent_phone_registrations after reapply"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_phone_registrations','TRUNCATE')::text;")" "false" "authenticated has NO TRUNCATE on agent_phone_registrations after reapply"
expect "$(q "SELECT has_table_privilege('authenticated','public.agent_phone_registrations','UPDATE')::text;")" "false" "authenticated has NO UPDATE on agent_phone_registrations after reapply"
expect "$(q "SELECT has_table_privilege('authenticated','public.voicemails','TRUNCATE')::text;")" "false" "authenticated has NO TRUNCATE on voicemails after reapply"
expect "$(q "SELECT has_column_privilege('authenticated','public.voicemails','listened_at','UPDATE')::text;")" "true" "authenticated may still stamp voicemails.listened_at after reapply"
expect "$(q "SELECT has_column_privilege('authenticated','public.voicemails','status','UPDATE')::text;")" "false" "authenticated has NO table-wide UPDATE on voicemails after reapply"
expect "$(q "SELECT has_table_privilege('anon','public.agent_phone_registrations','SELECT')::text;")" "false" "anon holds nothing after reapply"
expect "$(sqlstate "PERFORM routing_engine FROM public.calls LIMIT 1")" "OK" "calls.routing_engine restored"
expect "$(q "SELECT to_regclass('public.voicemails') IS NOT NULL;")" "t" "voicemails restored"
expect "$(sqlstate "PERFORM public.record_inbound_engine_decision('00000000-0000-0000-0000-000000000000'::uuid,'00000000-0000-0000-0000-000000000000'::uuid,'v2')")" "OK" "decision RPC restored"
expect "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='converge_inbound_notifications';")" "1" "convergence function restored"

echo "INBOUND ROLLBACK PROOF GREEN (M7 → M6 → M5 → M4 → reapply M4-M7, on a stack without pg_cron)"
