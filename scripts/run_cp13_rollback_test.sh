#!/usr/bin/env bash
# =====================================================================================================
# Corrective pass 13 — rollback proof for M8 + M9 (disposable LOCAL PostgreSQL only; invariant #28).
# =====================================================================================================
# WHAT THE EARLIER VERSION GOT WRONG, and what this one asserts instead:
#   * Its grant check was `case ... in *authenticated:SELECT*|*authenticated:UPDATE*`, which passes when
#     EITHER privilege is present. A stack with only SELECT — i.e. the browser unable to record a listen
#     at all — passed it. Privileges are now compared as an EXACT rendered set.
#   * Its policy check compared only names and commands, so a policy whose USING/WITH CHECK had been
#     widened to `true` still passed. Policies are now compared as COMPLETE definitions: permissiveness,
#     roles, command, and both expressions.
#   * It captured M7's `voicemails_cleanup_batch` digest AFTER applying M8/M9, so it could not prove the
#     migrations left that function alone — only that a rollback did not change what they had already
#     produced. The baseline is now captured BEFORE either migration is applied.
#   * It also never checked RLS/force-RLS state or column privileges. Both are now in the fingerprint.
#
# The shape of the proof: capture BASE (M4–M7 only), apply M8+M9, roll both back, reapply twice.
#   INVARIANT fingerprint (policies, RLS, table + column privileges, M7's function) must be byte-identical
#   at ALL FOUR points — those are M8/M9's explicit non-goals.
#   OBJECT fingerprint (what M8/M9 create) must be empty at BASE, equal after apply and after reapply,
#   and empty again after rollback.
# Catalog rendering is pinned: every ordering uses COLLATE "C" and every list is rendered the same way at
# every capture point, so a difference means a real difference and not a formatting artefact.
#
# NEGATIVE CONTROLS run afterwards on their own disposable databases and prove the fingerprint actually
# bites: a missing UPDATE grant, an unexpected extra privilege, a broadened policy and a changed original
# function must each be DETECTED. No production database is touched at any point.
set -euo pipefail
PGURL="${PGURL:?set PGURL to a LOCAL postgres}"
case "$PGURL" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSING: PGURL must be localhost"; exit 2 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/supabase/migrations"; RB="$M/rollback"; T="$ROOT/supabase/tests"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# ── the two fingerprints, rendered identically every time ────────────────────────────────────────────
INVARIANT_SQL=$(cat <<'SQL'
SELECT string_agg(line, E'\n' ORDER BY line COLLATE "C") FROM (
  -- COMPLETE policy definitions: permissiveness, roles, command and BOTH expressions.
  SELECT 'policy|' || p.policyname || '|' || p.permissive || '|' ||
         coalesce(array_to_string(p.roles, ',' ), '') || '|' || p.cmd || '|' ||
         coalesce(p.qual, '(none)') || '|' || coalesce(p.with_check, '(none)') AS line
    FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'voicemails'
  UNION ALL
  -- RLS and FORCE RLS state.
  SELECT 'rls|' || c.relrowsecurity || '|' || c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'voicemails'
  UNION ALL
  -- EXACT table privileges (grantee + privilege), not a substring match.
  SELECT 'tablepriv|' || g.grantee || '|' || g.privilege_type
    FROM information_schema.role_table_grants g
   WHERE g.table_schema = 'public' AND g.table_name = 'voicemails'
  UNION ALL
  -- EXACT column privileges, which is where the listened_at write scope actually lives.
  SELECT 'colpriv|' || cp.grantee || '|' || cp.column_name || '|' || cp.privilege_type
    FROM information_schema.column_privileges cp
   WHERE cp.table_schema = 'public' AND cp.table_name = 'voicemails'
  UNION ALL
  -- M7's ORIGINAL cleanup function: identity AND definition. This is what keeps the DEPLOYED worker
  -- working after M8 is applied, so it is proven unchanged rather than assumed.
  SELECT 'm7fn|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
         pg_get_function_result(p.oid) || '|secdef=' || p.prosecdef || '|cfg=' ||
         coalesce(array_to_string(p.proconfig, ','), '') || '|def=' || md5(pg_get_functiondef(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'voicemails_cleanup_batch'
) s
SQL
)
OBJECT_SQL=$(cat <<'SQL'
SELECT coalesce(string_agg(line, E'\n' ORDER BY line COLLATE "C"), '(none)') FROM (
  SELECT 'fn|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
         pg_get_function_result(p.oid) || '|secdef=' || p.prosecdef || '|acl=' ||
         coalesce(array_to_string(p.proacl, ',' ), '(default)') AS line
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('voicemails_cleanup_actionable_batch','voicemails_cleanup_blocked_summary','voicemails_enforce_first_listen')
  UNION ALL
  SELECT 'trg|' || t.tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE t.tgrelid = 'public.voicemails'::regclass AND NOT t.tgisinternal
  UNION ALL
  SELECT 'idx|' || i.indexname || '|' || i.indexdef
    FROM pg_indexes i WHERE i.schemaname = 'public'
     AND i.indexname IN ('idx_voicemails_cleanup_actionable','idx_voicemails_cleanup_blocked')
) s
SQL
)

mkdb() {                                   # $1 = db name; builds harness + M1..M7 only
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  for f in "$T/inbound_harness.sql" \
           "$M/20260823222528_inbound_identity_foundation.sql" \
           "$M/20260823222805_inbound_claim_lifecycle.sql" \
           "$M/20260823222926_recording_source_sid.sql" \
           "$T/inbound_v2_harness.sql" \
           "$M/20260914000530_inbound_agent_settings_and_registrations.sql" \
           "$M/20260915025931_inbound_routing_v2_settings.sql" \
           "$M/20260915035141_inbound_route_attempts_d13_and_recovery.sql" \
           "$M/20260915053646_inbound_voicemails.sql"; do
    psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$f" > "$WORK/apply.log" 2>&1 || {
      grep -v "NOTICE:" "$WORK/apply.log" || true; echo "FAILED to apply $f"; exit 1; }
  done
}
inv() { psql "$PGURL/$1" -Atc "$INVARIANT_SQL"; }
obj() { psql "$PGURL/$1" -Atc "$OBJECT_SQL"; }

DB="cp13_rollback_$$"
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
mkdb "$DB"

# ── BASE, captured BEFORE either migration touches the database ──────────────────────────────────────
BASE_INV="$(inv "$DB")"; BASE_OBJ="$(obj "$DB")"
[ -n "$BASE_INV" ] || { echo "PRECONDITION FAILED: the invariant fingerprint is empty"; exit 1; }
[ "$BASE_OBJ" = "(none)" ] || { echo "PRECONDITION FAILED: M4-M7 already has CP13 objects:"; echo "$BASE_OBJ"; exit 1; }
echo "OK: baseline captured BEFORE M8/M9 ($(printf '%s\n' "$BASE_INV" | wc -l) invariant rows, 0 CP13 objects)"

# The baseline must actually contain the things the old check could not see.
printf '%s\n' "$BASE_INV" | grep -q '^colpriv|authenticated|listened_at|UPDATE$' \
  || { echo "PRECONDITION FAILED: authenticated is missing UPDATE on listened_at"; exit 1; }
printf '%s\n' "$BASE_INV" | grep -q '^tablepriv|authenticated|SELECT$' \
  || { echo "PRECONDITION FAILED: authenticated is missing SELECT"; exit 1; }
echo "OK: baseline contains BOTH authenticated SELECT and the listened_at UPDATE grant"

psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M/20260918000614_voicemail_cleanup_actionable_selection.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M/20260918010000_voicemail_first_listen_guard.sql"
APPLIED_INV="$(inv "$DB")"; APPLIED_OBJ="$(obj "$DB")"
[ "$APPLIED_INV" = "$BASE_INV" ] || { echo "APPLY CHANGED AN INVARIANT:"; diff <(printf '%s\n' "$BASE_INV") <(printf '%s\n' "$APPLIED_INV") || true; exit 1; }
echo "OK: applying M8+M9 changed NO policy, RLS state, privilege or M7 function (proven against the pre-apply baseline)"
# M8 creates FOUR objects (two functions + two indexes); M9 creates two (one function + its trigger).
[ "$(printf '%s\n' "$APPLIED_OBJ" | grep -c '^fn|')" = 3 ] || { echo "expected 3 new functions, got:"; echo "$APPLIED_OBJ"; exit 1; }
[ "$(printf '%s\n' "$APPLIED_OBJ" | grep -c '^idx|')" = 2 ] || { echo "expected 2 new indexes"; exit 1; }
[ "$(printf '%s\n' "$APPLIED_OBJ" | grep -c '^trg|')" = 1 ] || { echo "expected 1 new trigger"; exit 1; }
echo "OK: M8 added 4 objects (2 functions + 2 indexes); M9 added 2 (1 function + 1 trigger)"

psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$RB/20260918010000_voicemail_first_listen_guard.rollback.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$RB/20260918000614_voicemail_cleanup_actionable_selection.rollback.sql"
ROLLED_INV="$(inv "$DB")"; ROLLED_OBJ="$(obj "$DB")"
[ "$ROLLED_INV" = "$BASE_INV" ] || { echo "ROLLBACK CHANGED AN INVARIANT:"; diff <(printf '%s\n' "$BASE_INV") <(printf '%s\n' "$ROLLED_INV") || true; exit 1; }
[ "$ROLLED_OBJ" = "(none)" ] || { echo "ROLLBACK LEFT OBJECTS BEHIND:"; echo "$ROLLED_OBJ"; exit 1; }
echo "OK: both rollbacks restore the exact M7 shape, and remove every object they added"

psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M/20260918000614_voicemail_cleanup_actionable_selection.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M/20260918010000_voicemail_first_listen_guard.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M/20260918000614_voicemail_cleanup_actionable_selection.sql"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$M/20260918010000_voicemail_first_listen_guard.sql"
[ "$(inv "$DB")" = "$BASE_INV" ] || { echo "REAPPLY CHANGED AN INVARIANT"; exit 1; }
[ "$(obj "$DB")" = "$APPLIED_OBJ" ] || { echo "REAPPLY IS NOT IDEMPOTENT:"; diff <(printf '%s\n' "$APPLIED_OBJ") <(obj "$DB") || true; exit 1; }
echo "OK: both migrations reapply cleanly, twice, with identical objects and untouched invariants"

# ── NEGATIVE CONTROLS: prove the fingerprint detects each perturbation ───────────────────────────────
negative() {                               # $1 = label, $2 = SQL that perturbs the M7 baseline
  local label="$1" sql="$2" db="cp13_neg_$$_$RANDOM"
  mkdb "$db"
  local before after
  before="$(inv "$db")"
  psql "$PGURL/$db" -v ON_ERROR_STOP=1 -q -c "$sql"
  after="$(inv "$db")"
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $db;" >/dev/null 2>&1
  if [ "$before" = "$after" ]; then
    echo "NEGATIVE CONTROL FAILED: '$label' was NOT detected by the fingerprint"; exit 1
  fi
  echo "   OK: '$label' is detected"
}
echo "== negative controls =="
negative "the authenticated UPDATE(listened_at) grant is missing" \
  "REVOKE UPDATE (listened_at) ON public.voicemails FROM authenticated;"
negative "an unexpected extra privilege is granted" \
  "GRANT DELETE ON public.voicemails TO authenticated;"
negative "a policy is broadened to USING (true)" \
  "DROP POLICY voicemails_select ON public.voicemails;
   CREATE POLICY voicemails_select ON public.voicemails FOR SELECT TO authenticated USING (true);"
negative "a policy gains an extra role" \
  "DROP POLICY voicemails_update_listened ON public.voicemails;
   CREATE POLICY voicemails_update_listened ON public.voicemails FOR UPDATE TO authenticated, anon
     USING (public.can_access_voicemail(id)) WITH CHECK (public.can_access_voicemail(id));"
negative "RLS is disabled" \
  "ALTER TABLE public.voicemails DISABLE ROW LEVEL SECURITY;"
negative "M7's original cleanup function is changed" \
  "CREATE OR REPLACE FUNCTION public.voicemails_cleanup_batch(p_limit integer DEFAULT 100)
   RETURNS TABLE (id uuid, organization_id uuid, recording_sid text, source_cleanup_attempts integer, provider_account_sid text)
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
   AS \$f\$ SELECT v.id, v.organization_id, v.recording_sid, v.source_cleanup_attempts, v.provider_account_sid
             FROM public.voicemails v WHERE false \$f\$;"

echo "CP13 ROLLBACK PROOF GREEN (baseline before apply; policies, RLS, exact privileges and M7's function proven unchanged; 6 negative controls detected)"
