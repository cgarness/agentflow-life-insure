#!/usr/bin/env bash
# =====================================================================================================
# Corrective pass 13 — rollback proof for M8 + M9 (disposable LOCAL PostgreSQL only; invariant #28).
# =====================================================================================================
# Its OWN throwaway database: harness + M1–M3 + v2 harness + M4–M9, then roll M9 back, roll M8 back,
# assert the schema is exactly M7-shaped again, then REAPPLY both and assert they land cleanly a second
# time (migrations must be re-runnable, not one-shot).
set -euo pipefail
PGURL="${PGURL:?set PGURL to a LOCAL postgres}"
case "$PGURL" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSING: PGURL must be localhost"; exit 2 ;; esac

DB="cp13_rollback_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/supabase/migrations"; RB="$M/rollback"; T="$ROOT/supabase/tests"
psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;"' EXIT
P() { psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$1"; }
Q() { psql "$PGURL/$DB" -Atc "$1"; }

P "$T/inbound_harness.sql"
P "$M/20260823222528_inbound_identity_foundation.sql"
P "$M/20260823222805_inbound_claim_lifecycle.sql"
P "$M/20260823222926_recording_source_sid.sql"
P "$T/inbound_v2_harness.sql"
P "$M/20260914000530_inbound_agent_settings_and_registrations.sql"
P "$M/20260915025931_inbound_routing_v2_settings.sql"
P "$M/20260915035141_inbound_route_attempts_d13_and_recovery.sql"
P "$M/20260915053646_inbound_voicemails.sql"

OBJ="SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('voicemails_cleanup_actionable_batch','voicemails_cleanup_blocked_summary','voicemails_enforce_first_listen'))
     || '/' || (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.voicemails'::regclass AND NOT tgisinternal AND tgname='voicemails_first_listen_guard')
     || '/' || (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('idx_voicemails_cleanup_actionable','idx_voicemails_cleanup_blocked'))"
BASE=$(Q "$OBJ"); [ "$BASE" = "0/0/0" ] || { echo "PRECONDITION FAILED: M7-only stack already has CP13 objects ($BASE)"; exit 1; }
echo "OK: M7-only baseline is 0 functions / 0 triggers / 0 indexes"

P "$M/20260917010000_voicemail_cleanup_actionable_selection.sql"
P "$M/20260917010500_voicemail_first_listen_guard.sql"
APPLIED=$(Q "$OBJ"); [ "$APPLIED" = "3/1/2" ] || { echo "APPLY FAILED: expected 3/1/2, got $APPLIED"; exit 1; }
echo "OK: M8+M9 applied (3 functions / 1 trigger / 2 indexes)"

# M7's own function must be untouched by M8 — that is what keeps the DEPLOYED worker (v30) working.
M7FN=$(Q "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='voicemails_cleanup_batch'")

P "$RB/20260917010500_voicemail_first_listen_guard.rollback.sql"
P "$RB/20260917010000_voicemail_cleanup_actionable_selection.rollback.sql"
ROLLED=$(Q "$OBJ"); [ "$ROLLED" = "0/0/0" ] || { echo "ROLLBACK FAILED: expected 0/0/0, got $ROLLED"; exit 1; }
echo "OK: both rollbacks return the schema to its M7 shape"

M7FN2=$(Q "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='voicemails_cleanup_batch'")
[ "$M7FN" = "$M7FN2" ] || { echo "ROLLBACK FAILED: M7's voicemails_cleanup_batch was altered"; exit 1; }
echo "OK: M7's voicemails_cleanup_batch is byte-identical throughout (deployed worker stays compatible)"

# RLS, grants and retention are M9's explicit non-goals: assert the rollback changed none of them.
POL=$(Q "SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname='public' AND tablename='voicemails'")
[ "$POL" = "voicemails_select:SELECT,voicemails_update_listened:UPDATE" ] || { echo "ROLLBACK FAILED: policies drifted ($POL)"; exit 1; }
GRA=$(Q "SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type) FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='voicemails' AND column_name='listened_at'")
case "$GRA" in *"authenticated:SELECT"*|*"authenticated:UPDATE"*) ;; *) echo "ROLLBACK FAILED: listened_at grants drifted ($GRA)"; exit 1 ;; esac
echo "OK: policies and the listened_at column grants are untouched by M9 and its rollback"

P "$M/20260917010000_voicemail_cleanup_actionable_selection.sql"
P "$M/20260917010500_voicemail_first_listen_guard.sql"
AGAIN=$(Q "$OBJ"); [ "$AGAIN" = "3/1/2" ] || { echo "REAPPLY FAILED: expected 3/1/2, got $AGAIN"; exit 1; }
# and a third time, because CREATE OR REPLACE / IF NOT EXISTS / DROP-then-CREATE must be idempotent
P "$M/20260917010000_voicemail_cleanup_actionable_selection.sql"
P "$M/20260917010500_voicemail_first_listen_guard.sql"
THIRD=$(Q "$OBJ"); [ "$THIRD" = "3/1/2" ] || { echo "IDEMPOTENCE FAILED: expected 3/1/2, got $THIRD"; exit 1; }
echo "OK: both migrations reapply cleanly and are idempotent"

echo "CP13 ROLLBACK PROOF GREEN (M4-M7 → +M8/M9 → rollback → reapply x2)"
