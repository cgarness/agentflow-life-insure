#!/usr/bin/env bash
# =====================================================================================================
# Regression suite for the M4 RELEASE TOOLING (the apply procedure and the verifiers).
# =====================================================================================================
# Every case is labelled with what actually ran:
#
#   [fake-tool]     the apply script is driven against STUB psql / supabase binaries with canned
#                   responses. This exercises the script's CONTROL FLOW ONLY — target binding, failure
#                   handling and the wording of its recovery advice. It proves nothing about SQL.
#   [real-postgres] real SQL executed against a disposable PostgreSQL database built from the repo's
#                   harness + M1-M3 + v2 harness + M4-M7. This is what proves the verifiers.
#
# No case touches a hosted project. The stub connection strings are fabricated and never dialled.
#
#   ./scripts/test_release_tooling.sh                 # fake-tool cases only
#   PGURL='postgresql://postgres:postgres@127.0.0.1:5432' ./scripts/test_release_tooling.sh   # + real
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
# expect_fail <label> <expected exit> <expected substring> -- <env assignments…>
run_apply() { rm -f "$WORK/stubcalls"; env "$@" SUPABASE_CLI="$WORK/bin/supabase" PSQL_BIN="$WORK/bin/psql" \
                 STUB_STATE="$WORK/stubcalls" "$ROOT/scripts/apply_m4_only.sh" >"$WORK/out" 2>&1; echo $?; }
check() { # <label> <rc> <want_rc> <want_substr>
  local label="$1" rc="$2" want_rc="$3" want="$4"
  if [ "$rc" != "$want_rc" ]; then bad "$label" "exit $rc, expected $want_rc$(printf '\n     ---\n%s' "$(tail -6 "$WORK/out")")"; return; fi
  if ! grep -qF -- "$want" "$WORK/out"; then bad "$label" "output does not contain: $want$(printf '\n     ---\n%s' "$(tail -8 "$WORK/out")")"; return; fi
  ok "$label"
}
m5_guard() { # <label> — the branch in $WORK/out must forbid M5 and must not mention it any other way
  if ! grep -qF 'Do not continue to M5.' "$WORK/out"; then bad "$1" "the branch does not forbid continuing to M5"; return; fi
  if grep -viF 'Do not continue to M5.' "$WORK/out" | grep -qiE 'continue to M5|proceed to M5|then M5'; then
    bad "$1" "the branch also mentions continuing to M5 affirmatively"; return; fi
  ok "$1"
}
forbid() { # <label> <substring that must NOT appear>
  if grep -qiF -- "$2" "$WORK/out"; then bad "$1" "output wrongly contains: $2"; else ok "$1"; fi
}

# ── stub binaries ───────────────────────────────────────────────────────────────────────────────────
mkdir -p "$WORK/bin"
cat > "$WORK/bin/psql" <<'STUB'
#!/usr/bin/env bash
# canned psql. FAKE_FP / FAKE_APPLY_RC / FAKE_STATE / FAKE_STATE_PRE / FAKE_STATE_RC / FAKE_VERIFY_RC.
for a in "$@"; do case "$a" in --version) echo "psql (PostgreSQL) 16.13 [stub]"; exit 0;; esac; done
file=""; sql=""; prev=""
for a in "$@"; do
  case "$prev" in -f) file="$a";; -c) sql="$a";; esac
  prev="$a"
done
case "$file" in
  *verify_m4_state.sql)
    case "$sql" in
      *preflight*) printf '%s\n' "${FAKE_STATE_PRE:-NEITHER|preflight|PROCEED_WITH_APPLY|clean target; the single apply may be submitted|f|f|0|0|0|0|0|0|0|0|f||0|||0|0|0}"
                   exit "${FAKE_STATE_PRE_RC:-0}";;
      *)           printf '%s\n' "${FAKE_STATE:-NEITHER|recovery|OUTCOME_UNRESOLVED_DO_NOT_REPLAY|NO COMMITTED M4 STATE OBSERVED AT THIS READ.|f|f|0|0|0|0|0|0|0|0|f||0|||0|0|0}"
                   exit "${FAKE_STATE_RC:-0}";;
    esac;;
  *verify_m4_untouched.sql)
    n=$(( $(cat "${STUB_STATE:-/dev/null}" 2>/dev/null || echo 0) + 1 ))
    [ -n "${STUB_STATE:-}" ] && echo "$n" > "$STUB_STATE"
    if [ -n "${FAKE_UNTOUCHED_AFTER:-}" ] && [ "$n" -gt 1 ]; then printf '%s\n' "$FAKE_UNTOUCHED_AFTER"
    else echo "calls|t|f|5|21|0|aaa|bbb|pol|grants|<none>"; fi
    exit 0;;
  *_inbound_agent_settings_and_registrations.sql) exit "${FAKE_APPLY_RC:-0}";;
  *verify_m4_schema.sql|*verify_m4_history.sql) echo "VERIFIED [stub]"; exit "${FAKE_VERIFY_RC:-0}";;
esac
if [ -n "$sql" ]; then printf '%s\n' "${FAKE_FP:-170006|20260823222926|0|true|true|2}"; exit 0; fi
exit 0
STUB
cat > "$WORK/bin/supabase" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in --version) echo "2.84.5 [stub]"; exit 0;; esac
if [ "${1:-}" = migration ] && [ "${2:-}" = repair ]; then
  case " $* " in *" --help "*) echo "  --db-url string   ..."; exit 0;; esac
  exit "${FAKE_REPAIR_RC:-0}"
fi
exit 0
STUB
chmod +x "$WORK/bin/psql" "$WORK/bin/supabase"

REF=jncvvsvckxhqgqvkppmj
GOOD="postgresql://postgres:STUBPASS@db.${REF}.supabase.co:5432/postgres"
POOL="postgresql://postgres.${REF}:STUBPASS@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

echo
echo "[fake-tool] target binding — the connection, not row content, decides the target"
rc=$(run_apply SUPABASE_DB_URL="postgresql://postgres:STUBPASS@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" DRY_RUN=1)
check "wrong project ref is refused before any write" "$rc" 1 "WRONG TARGET"
forbid "  …and the refusal names no credential" "STUBPASS"
rc=$(run_apply SUPABASE_DB_URL="postgresql://postgres:STUBPASS@127.0.0.1:5432/postgres" DRY_RUN=1)
check "a non-Supabase host is AMBIGUOUS, not accepted" "$rc" 1 "AMBIGUOUS TARGET"
rc=$(run_apply SUPABASE_DB_URL="postgresql://postgres:STUBPASS@aws-0-us-east-1.pooler.supabase.com:6543/postgres" DRY_RUN=1)
check "a pooler host with no ref in the username is AMBIGUOUS" "$rc" 1 "AMBIGUOUS TARGET"
rc=$(run_apply SUPABASE_DB_URL="postgresql://postgres:STUBPASS@db.evil.supabase.co.attacker.test:5432/postgres" DRY_RUN=1)
check "a lookalike hostname is AMBIGUOUS" "$rc" 1 "AMBIGUOUS TARGET"
# the case the reviewer reported: a DIFFERENT database whose rows carry the right ref must still fail
rc=$(run_apply SUPABASE_DB_URL="postgresql://postgres:STUBPASS@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" DRY_RUN=1 \
               FAKE_FP="170006|20260823222926|0|true|true|2")
check "matching cron/history content does NOT rescue a wrong target" "$rc" 1 "WRONG TARGET"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1)
check "the intended direct connection passes preflight" "$rc" 0 "no write performed"
rc=$(run_apply SUPABASE_DB_URL="$POOL" DRY_RUN=1)
check "the intended pooler connection passes preflight" "$rc" 0 "no write performed"
grep -q "supporting evidence only, NOT proof" "$WORK/out" \
  && ok "cron evidence is labelled as non-probative" || bad "cron evidence is labelled as non-probative"

echo
echo "[fake-tool] preflight refusals"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_FP="160013|20260823222926|0|true|true|2")
check "a different PostgreSQL major is refused" "$rc" 1 "does not match the verified environment"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_FP="170006|20260901999999|0|true|true|2")
check "a moved migration head is refused" "$rc" 1 "Re-inspect and re-approve"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_STATE_PRE="BOTH|preflight|STOP_UNEXPECTED_PRESTATE|the target is not clean|t|t|2|1|1|6|1|1|0|0|f|20260914000530/inbound_agent_settings_and_registrations|0|||0|0|0")
check "an already-applied M4 is refused at preflight" "$rc" 1 "the target is not clean"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_STATE_PRE="PARTIAL|preflight|STOP_UNEXPECTED_PRESTATE|the target is not clean|t|t|2|1|1|6|2|2|0|0|t|20260914000530/x , 20260913041500/x|0|||0|0|0")
check "an ambiguous (duplicate) history is refused at preflight" "$rc" 1 "STOP_UNEXPECTED_PRESTATE"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_STATE_PRE_RC=2 FAKE_STATE_PRE="could not connect")
check "an unreadable preflight classification stops the run" "$rc" 1 "preflight classification query failed"
cp "$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql" "$WORK/m4.bak"
printf '\n-- tamper\n' >> "$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1)
check "a tampered migration file is refused by hash" "$rc" 1 "hash mismatch"
cp "$WORK/m4.bak" "$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql"

echo
echo "[fake-tool] preflight gating"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_STATE_PRE="SCHEMA_ONLY|preflight|STOP_UNEXPECTED_PRESTATE|the target is not clean|t|t|2|1|1|6|0|0|0|0|f||0|||0|0|0")
check "an unclean target is refused at preflight" "$rc" 1 "the target is not clean"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_STATE_PRE="PARTIAL|preflight|STOP_UNEXPECTED_PRESTATE|the target is not clean|t|f|1|1|0|4|0|0|0|0|f||0|||0|0|0")
check "a PARTIAL target is refused at preflight" "$rc" 1 "STOP_UNEXPECTED_PRESTATE"

echo
echo "[fake-tool] uncertain write outcomes — a failed invocation is NOT a confirmed rollback,"
echo "            and an empty read is NOT proof the operation ended"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=1 FAKE_STATE="NEITHER|recovery|OUTCOME_UNRESOLVED_DO_NOT_REPLAY|NO COMMITTED M4 STATE OBSERVED AT THIS READ.|f|f|0|0|0|0|0|0|0|0|f||0|||1|0|0")
check "apply failed + NEITHER → outcome UNRESOLVED, exit 3" "$rc" 3 "The outcome is UNRESOLVED"
m5_guard "  …and the NEITHER branch forbids continuing to M5"
forbid "  …no case claims a confirmed rollback" "rolled back"
grep -q 'That is NOT the same as "the apply did not land"' "$WORK/out" \
  && ok "  …it says plainly that this is not the same as a failed apply" \
  || bad "  …it says plainly that this is not the same as a failed apply"
forbid "  …and it never invites another attempt" "re-run this script from the top"
grep -q "DO NOT re-run this script and DO NOT submit the migration again" "$WORK/out" \
  && ok "  …it explicitly forbids replay" || bad "  …it explicitly forbids replay"
grep -q "authoritatively known to have ended WITHOUT committing" "$WORK/out" \
  && ok "  …and names the only condition that would allow one" || bad "  …and names the only condition that would allow one"
grep -qi "elapsed time" "$WORK/out" && ok "  …and rules out an elapsed-time assumption" || bad "  …and rules out an elapsed-time assumption"
grep -qi "repeated empty read" "$WORK/out" && ok "  …and rules out repeated empty reads" || bad "  …and rules out repeated empty reads"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE="BOTH|recovery|COMPLETE_VERIFY_AND_STOP|the write landed|t|t|2|1|1|6|1|1|0|0|f|20260913041500/inbound_agent_settings_and_registrations|0|||0|0|0")
check "apply failed + BOTH → the write LANDED" "$rc" 1 "the write LANDED despite the failed"
m5_guard "  …and the BOTH branch forbids continuing to M5"
forbid "  …and it does not tell the operator to re-run the apply" "re-run this script from the top"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE="SCHEMA_ONLY|recovery|RECONCILE_HISTORY_ONLY|the SQL committed|t|t|2|1|1|6|0|0|0|0|f||0|||0|0|0")
check "apply failed + SCHEMA_ONLY → repair HISTORY ONLY" "$rc" 1 "MISSING HISTORY OPERATION ALONE"
m5_guard "  …and the SCHEMA_ONLY branch forbids continuing to M5"
grep -qF 'PRIMARY KEY of supabase_migrations.schema_migrations' "$WORK/out" \
  && ok "  …and states the real hazard, not an impossible duplicate row" \
  || bad "  …and states the real hazard, not an impossible duplicate row"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE="PARTIAL|recovery|INVESTIGATE_WRITE_NOTHING|unexpected: partial objects, duplicate history rows, or conflicting identities|t|f|1|1|0|4|0|0|0|0|f||0|||0|0|0")
check "apply failed + PARTIAL → investigate, write nothing" "$rc" 2 "Do NOT write anything"
m5_guard "  …and the PARTIAL branch forbids continuing to M5"
grep -q "conflicting" "$WORK/out" && ok "  …and names conflicting identities as a cause" || bad "  …and names conflicting identities as a cause"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE_RC=2 FAKE_STATE="could not connect to server")
check "apply failed + reconciliation unreachable → UNKNOWN" "$rc" 2 "state of the target is UNKNOWN"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_REPAIR_RC=1 FAKE_STATE="SCHEMA_ONLY|recovery|RECONCILE_HISTORY_ONLY|the SQL committed|t|t|2|1|1|6|0|0|0|0|f||0|||0|0|0")
check "repair failed + SCHEMA_ONLY → history only, no replay" "$rc" 1 "Do NOT re-run this script"
grep -q "still in flight" "$WORK/out" \
  && ok "  …and gates a repeat on the repair not being in flight" || bad "  …and gates a repeat on the repair not being in flight"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_REPAIR_RC=1 FAKE_STATE="BOTH|recovery|COMPLETE_VERIFY_AND_STOP|the write landed|t|t|2|1|1|6|1|1|0|0|f|20260913041500/inbound_agent_settings_and_registrations|0|||0|0|0")
check "repair failed + BOTH → the repair actually landed" "$rc" 1 "the write LANDED despite the failed"
echo
echo "[fake-tool] the post-apply block: success is claimed only after every gate passed"
rc=$(run_apply SUPABASE_DB_URL="$GOOD")
check "a green run reports APPLIED AND VERIFIED" "$rc" 0 "M4 APPLIED AND VERIFIED"
grep -q "INCONCLUSIVE" "$WORK/out" && ok "  …and calls an empty hosted registrations table inconclusive" \
  || bad "  …and calls an empty hosted registrations table inconclusive"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_VERIFY_RC=3)
check "a failing contract verifier blocks the success line" "$rc" 1 "CONTRACT NOT VERIFIED"
forbid "  …and 'APPLIED AND VERIFIED' is not printed" "APPLIED AND VERIFIED"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_UNTOUCHED_AFTER="calls|t|f|5|21|0|aaa|CHANGED|pol|grants|<none>")
check "a CHANGED pre-existing table aborts the run" "$rc" 1 "a pre-existing table CHANGED"
forbid "  …and 'APPLIED AND VERIFIED' is not printed then either" "APPLIED AND VERIFIED"

# ── real PostgreSQL ─────────────────────────────────────────────────────────────────────────────────
if [ -z "${PGURL:-}" ]; then
  echo
  echo "[real-postgres] SKIPPED — set PGURL to a superuser PostgreSQL connection to run these."
  echo
  echo "passed=$PASS failed=$FAIL (fake-tool cases only)"
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi

DB="reltool_$$"
BASE_FILES="supabase/tests/inbound_harness.sql
supabase/migrations/20260823222528_inbound_identity_foundation.sql
supabase/migrations/20260823222805_inbound_claim_lifecycle.sql
supabase/migrations/20260823222926_recording_source_sid.sql
supabase/tests/inbound_v2_harness.sql"
M4_FILE="supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql"
drop_db()  { psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $1;" >/dev/null 2>&1; }
# installed BEFORE the first CREATE DATABASE, so a failed build cannot leak a disposable database
cleanup_dbs() { for d in "$DB" "${DB}_m" "${DB}_n" "${DB}_c" "${DB}_u" "${DB}_h"; do drop_db "$d"; done; rm -rf "$WORK"; }
trap cleanup_dbs EXIT
build_base() {
  drop_db "$1"
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;" >/dev/null 2>&1 \
    || { echo "  CREATE DATABASE $1 failed — is PGURL a superuser connection?"; exit 1; }
  local f; while read -r f; do [ -n "$f" ] || continue
    psql "$PGURL/$1" -v ON_ERROR_STOP=1 -qf "$ROOT/$f" >"$WORK/build.log" 2>&1 \
      || { echo "  build failed: $f"; tail -3 "$WORK/build.log" | sed "s/^/    /"; exit 1; }
  done <<< "$BASE_FILES"
}
clone()    { drop_db "$2"; psql "$PGURL/postgres" -qc "CREATE DATABASE $2 TEMPLATE $1;" >/dev/null 2>&1; }
psqlq()    { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q "${@:2}"; }

echo
echo "[real-postgres] building a disposable database from harness + M1-M3 + v2 harness + M4"
build_base "$DB"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -qf "$ROOT/$M4_FILE" >"$WORK/build.log" 2>&1 \
  || { echo "  M4 apply failed"; tail -3 "$WORK/build.log" | sed "s/^/    /"; exit 1; }

v_schema()  { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -qf "$ROOT/scripts/verify_m4_schema.sql"  >"$WORK/v" 2>&1; echo $?; }
v_history() { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q ${2:+-c "SET m4.expected_version = '$2'"} \
                   -f "$ROOT/scripts/verify_m4_history.sql" >"$WORK/v" 2>&1; echo $?; }
v_state()   { psql "$PGURL/$1" -Atq -v ON_ERROR_STOP=1 -c "SET m4.mode = '${2:-recovery}'" \
                   -f "$ROOT/scripts/verify_m4_state.sql" 2>&1 | tail -1; }
v_untch()   { psql "$PGURL/$1" -Atq -F'|' -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify_m4_untouched.sql" 2>&1; }

echo "[real-postgres] the schema verifier ASSERTS the contract (each mutation must FAIL it)"
[ "$(v_schema "$DB")" = 0 ] && grep -q M4_SCHEMA_CONTRACT_VERIFIED "$WORK/v" \
  && ok "a correct database verifies" || bad "a correct database verifies" "$(tail -3 "$WORK/v")"
mut() { # <label> <sql> <expected failure fragment>
  local label="$1" sql="$2" want="$3" d="${DB}_m"
  clone "$DB" "$d"
  psql "$PGURL/$d" -v ON_ERROR_STOP=1 -qc "$sql" >/dev/null 2>&1 || { bad "$label" "mutation itself failed to apply"; return; }
  local rc; rc="$(v_schema "$d")"
  drop_db "$d"
  if [ "$rc" = 0 ]; then bad "$label" "verifier PASSED a mutated database"; return; fi
  grep -qF -- "$want" "$WORK/v" && ok "$label" || bad "$label" "wrong reason: $(grep -Eo 'FAILED.*' "$WORK/v" | head -1)"
}
mut "RLS disabled is caught"                 "ALTER TABLE public.agent_inbound_settings DISABLE ROW LEVEL SECURITY;" "RLS IS DISABLED"
mut "authenticated TRUNCATE is caught"       "GRANT TRUNCATE ON public.agent_phone_registrations TO authenticated;" "authenticated TRUNCATE = GRANTED"
mut "authenticated INSERT is caught"         "GRANT INSERT ON public.agent_phone_registrations TO authenticated;" "authenticated INSERT = GRANTED"
mut "anon SELECT is caught"                  "GRANT SELECT ON public.agent_inbound_settings TO anon;" "anon SELECT = GRANTED"
mut "a revoked service_role grant is caught" "REVOKE SELECT ON public.agent_inbound_settings FROM service_role;" "service_role SELECT = denied"
mut "a dropped table is caught"              "DROP TABLE public.agent_phone_registrations CASCADE;" "MISSING TABLE"
mut "a dropped policy is caught"             "DROP POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations;" "MISSING POLICY"
mut "a dropped trigger is caught"            "DROP TRIGGER trg_agent_inbound_settings_guard ON public.agent_inbound_settings;" "MISSING TRIGGER trg_agent_inbound_settings_guard"
mut "FORCE RLS is caught"                    "ALTER TABLE public.agent_inbound_settings FORCE ROW LEVEL SECURITY;" "FORCE RLS is set"
mut "is_phone_connected turned SECURITY DEFINER is caught" \
  "ALTER FUNCTION public.is_phone_connected(uuid) SECURITY DEFINER;" "SECURITY DEFINER, expected INVOKER"
mut "heartbeat turned SECURITY INVOKER is caught" \
  "ALTER FUNCTION public.heartbeat_phone_registration(uuid,bigint,boolean,text,text) SECURITY INVOKER;" "SECURITY INVOKER, expected DEFINER"
mut "anon EXECUTE on is_phone_connected is caught" \
  "GRANT EXECUTE ON FUNCTION public.is_phone_connected(uuid) TO anon;" "anon CAN EXECUTE"
mut "a revoked authenticated EXECUTE is caught" \
  "REVOKE EXECUTE ON FUNCTION public.is_phone_connected(uuid) FROM authenticated;" "authenticated cannot EXECUTE"
mut "an exposed private guard is caught" \
  "GRANT EXECUTE ON FUNCTION private.agent_inbound_settings_guard() TO authenticated;" "guard: authenticated CAN EXECUTE"
mut "a write policy on registrations is caught" \
  "CREATE POLICY agent_phone_registrations_w ON public.agent_phone_registrations FOR UPDATE TO authenticated USING (organization_id = public.get_org_id());" \
  "WRITE policy/policies present"

echo "[real-postgres] policy SCOPE changes that KEEP get_org_id() — the fragment search missed all of these"
mut "self_insert losing agent_id = auth.uid() is caught" \
  "DROP POLICY agent_inbound_settings_self_insert ON public.agent_inbound_settings;
   CREATE POLICY agent_inbound_settings_self_insert ON public.agent_inbound_settings FOR INSERT TO authenticated
     WITH CHECK (organization_id = public.get_org_id());" \
  "agent_inbound_settings_self_insert: WITH CHECK is"
mut "self_update USING widened to true while WITH CHECK stays right is caught" \
  "DROP POLICY agent_inbound_settings_self_update ON public.agent_inbound_settings;
   CREATE POLICY agent_inbound_settings_self_update ON public.agent_inbound_settings FOR UPDATE TO authenticated
     USING (true) WITH CHECK (agent_id = auth.uid() AND organization_id = public.get_org_id());" \
  "agent_inbound_settings_self_update: USING is"
mut "registrations self_select widened to the whole organization is caught" \
  "DROP POLICY agent_phone_registrations_self_select ON public.agent_phone_registrations;
   CREATE POLICY agent_phone_registrations_self_select ON public.agent_phone_registrations FOR SELECT TO authenticated
     USING (organization_id = public.get_org_id());" \
  "agent_phone_registrations_self_select: USING is"
mut "admin_select dropping the Admin/Super-Admin test is caught" \
  "DROP POLICY agent_inbound_settings_admin_select ON public.agent_inbound_settings;
   CREATE POLICY agent_inbound_settings_admin_select ON public.agent_inbound_settings FOR SELECT TO authenticated
     USING (organization_id = public.get_org_id());" \
  "agent_inbound_settings_admin_select: USING is"
mut "roles widened from authenticated to PUBLIC is caught" \
  "DROP POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations;
   CREATE POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations FOR SELECT TO PUBLIC
     USING (organization_id = public.get_org_id());" \
  "roles PUBLIC, expected authenticated"
mut "PERMISSIVE turned RESTRICTIVE is caught" \
  "DROP POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations;
   CREATE POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations AS RESTRICTIVE FOR SELECT TO authenticated
     USING (organization_id = public.get_org_id());" \
  "permissive=f, expected t"
mut "a SEVENTH, plausibly org-scoped policy is caught" \
  "CREATE POLICY agent_phone_registrations_extra ON public.agent_phone_registrations FOR SELECT TO authenticated
     USING (organization_id = public.get_org_id());" \
  "UNEXPECTED POLICY agent_phone_registrations_extra"
mut "get_org_id() swapped for a same-named function in another schema is caught" \
  "CREATE SCHEMA IF NOT EXISTS evil;
   CREATE FUNCTION evil.get_org_id() RETURNS uuid LANGUAGE sql STABLE AS \$fn\$ select gen_random_uuid() \$fn\$;
   DROP POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations;
   CREATE POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations FOR SELECT TO authenticated
     USING (organization_id = evil.get_org_id());" \
  "agent_phone_registrations_org_select: USING is"

echo "[real-postgres] the untouched comparison sees changes that leave the COUNTS equal"
v_untch "$DB" > "$WORK/untouched_before"
[ "$(wc -l < "$WORK/untouched_before")" -ge 5 ] && ok "the before-image reports one row per pre-existing table" \
  || bad "the before-image reports one row per pre-existing table"
untch_mut() { # <label> <sql> <table>
  local label="$1" sql="$2" tbl="$3" d="${DB}_u"
  clone "$DB" "$d"
  psql "$PGURL/$d" -v ON_ERROR_STOP=1 -qc "$sql" >/dev/null 2>&1 || { bad "$label" "mutation failed"; return; }
  local b a
  # column 1 is read_search_path, column 2 is the table name, columns 5-7 are the three counts
  b="$(awk -F'|' -v t="$tbl" '$2==t' "$WORK/untouched_before")"
  a="$(v_untch "$d" | awk -F'|' -v t="$tbl" '$2==t')"
  drop_db "$d"
  if [ -z "$b" ] || [ -z "$a" ]; then bad "$label" "no row for $tbl in one of the images"; return; fi
  local bc ac
  bc="$(printf '%s' "$b" | cut -d'|' -f5,6,7)"; ac="$(printf '%s' "$a" | cut -d'|' -f5,6,7)"
  if [ "$bc" != "$ac" ]; then bad "$label" "the counts changed too, so this does not test the digest"; return; fi
  if [ "$b" = "$a" ]; then bad "$label" "before and after are identical — the change was not captured"; return; fi
  ok "$label"
}
untch_mut "a SWAPPED privilege (UPDATE out, TRUNCATE in) is caught with counts equal" \
  "REVOKE UPDATE ON public.calls FROM authenticated; GRANT TRUNCATE ON public.calls TO authenticated;" calls
untch_mut "a REWRITTEN policy expression is caught with counts equal" \
  "DROP POLICY notifications_select ON public.notifications;
   CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
     USING (organization_id = public.get_user_org_id());" notifications
untch_mut "a policy turned RESTRICTIVE is caught with counts equal" \
  "DROP POLICY notifications_insert ON public.notifications;
   CREATE POLICY notifications_insert ON public.notifications AS RESTRICTIVE FOR INSERT TO authenticated
     WITH CHECK (organization_id = public.get_user_org_id() AND user_id = auth.uid());" notifications
a="$(v_untch "$DB")"
[ "$a" = "$(cat "$WORK/untouched_before")" ] && ok "an unchanged database reproduces the before-image exactly" \
  || bad "an unchanged database reproduces the before-image exactly"

echo "[real-postgres] M4 is resolved by its MIGRATION IDENTITY, not by the authored version alone"
H="${DB}_h"
hist_case() { # <label> <insert sql|-> <expected state> <history must pass? yes|no> [expected history fragment]
  local label="$1" ins="$2" want_state="$3" hist_ok="$4" frag="${5:-}"
  clone "$DB" "$H"
  [ "$ins" = "-" ] || psql "$PGURL/$H" -v ON_ERROR_STOP=1 -qc "$ins" >/dev/null 2>&1
  local st rc; st="$(v_state "$H" recovery | cut -d'|' -f1)"; rc="$(v_history "$H")"
  drop_db "$H"
  if [ "$st" != "$want_state" ]; then bad "$label" "classifier said $st, expected $want_state"; return; fi
  if [ "$hist_ok" = yes ]; then
    [ "$rc" = 0 ] && ok "$label" || bad "$label" "history verifier failed: $(grep -Eo 'FAILED.*' "$WORK/v" | head -1)"
  else
    if [ "$rc" = 0 ]; then bad "$label" "history verifier PASSED when it should fail"; return; fi
    if [ -n "$frag" ] && ! grep -qF -- "$frag" "$WORK/v"; then
      bad "$label" "wrong reason: $(grep -Eo 'FAILED.*' "$WORK/v" | head -1)"; return; fi
    ok "$label"
  fi
}
INS_SVC="insert into supabase_migrations.schema_migrations(version,name) values ('20260913041500','inbound_agent_settings_and_registrations');"
INS_AUTH="insert into supabase_migrations.schema_migrations(version,name) values ('20260914000530','inbound_agent_settings_and_registrations');"
hist_case "a SERVICE-ASSIGNED version is recognised: classifier BOTH, history verified" "$INS_SVC" BOTH yes
hist_case "the authored version is recognised too"                                      "$INS_AUTH" BOTH yes
hist_case "no history row at all: SCHEMA_ONLY, history fails" "-" SCHEMA_ONLY no "no history row carries the exact migration name"
hist_case "a NULL name no longer counts as M4" \
  "insert into supabase_migrations.schema_migrations(version,name) values ('20260914000530',null);" \
  BOTH no "no history row carries the exact migration name"
hist_case "a DUPLICATE apply (two rows, same name) is PARTIAL and fails history" \
  "$INS_AUTH $INS_SVC" PARTIAL no "duplicate apply"
hist_case "a CONFLICTING identity on the authored version is PARTIAL and fails history" \
  "insert into supabase_migrations.schema_migrations(version,name) values ('20260914000530','something_else_entirely');" \
  PARTIAL no "recorded under a different or absent name"
hist_case "a NEAR-MISS name (substring, not equal) fails history" \
  "$INS_SVC insert into supabase_migrations.schema_migrations(version,name) values ('20260913050000','x_inbound_agent_settings_and_registrations_v2');" \
  BOTH no "CONTAINING but not equal"
hist_case "M5 recorded under its NAME with a service version fails the M4-only contract" \
  "$INS_SVC insert into supabase_migrations.schema_migrations(version,name) values ('20260913060000','inbound_routing_v2_settings');" \
  BOTH no "of M5-M7 are recorded"
clone "$DB" "$H"; psql "$PGURL/$H" -v ON_ERROR_STOP=1 -qc "$INS_SVC" >/dev/null 2>&1
[ "$(v_history "$H" 20260913041500)" = 0 ] && ok "pinning m4.expected_version to the recorded version verifies" \
  || bad "pinning m4.expected_version to the recorded version verifies"
[ "$(v_history "$H" 20260914000530)" != 0 ] && grep -q "pins 20260914000530" "$WORK/v" \
  && ok "pinning it to the WRONG version fails and says so" || bad "pinning it to the WRONG version fails and says so"
drop_db "$H"
clone "$DB" "$H"
psql "$PGURL/$H" -v ON_ERROR_STOP=1 -qc "drop trigger trg_agent_inbound_settings_guard on public.agent_inbound_settings;" >/dev/null 2>&1
case "$(v_state "$H" recovery)" in PARTIAL*) ok "INCOMPLETE objects classify as PARTIAL";; *) bad "INCOMPLETE objects classify as PARTIAL" "$(v_state "$H")";; esac
drop_db "$H"
# a COMPENSATING object error: TWO overloads of one function name and NONE of the other, so a bare
# sum of the object counts still reaches 6. count(*) over a name IN-list counts pg_proc rows, which are
# per-overload, so each name has to be required in its own right.
clone "$DB" "$H"
psql "$PGURL/$H" -v ON_ERROR_STOP=1 -qc "$INS_SVC
   CREATE FUNCTION public.is_phone_connected(uuid, interval) RETURNS boolean LANGUAGE sql STABLE AS \$fn\$ select true \$fn\$;
   DROP FUNCTION public.heartbeat_phone_registration(uuid,bigint,boolean,text,text);" >/dev/null 2>&1
row="$(v_state "$H" recovery)"
objs="$(printf '%s' "$row" | cut -d'|' -f11)"
case "$row" in
  PARTIAL*) [ "$objs" = 6 ] && ok "a COMPENSATING object error is PARTIAL even though the object count sums to 6" \
              || bad "a COMPENSATING object error is PARTIAL even though the object count sums to 6" "m4_objects=$objs (the case no longer reproduces the sum)";;
  *) bad "a COMPENSATING object error is PARTIAL even though the object count sums to 6" "$row";;
esac
[ "$(v_schema "$H")" != 0 ] && ok "  …and the schema verifier fails on it too" || bad "  …and the schema verifier fails on it too"
drop_db "$H"
# an unrecognised mode must fall back to the conservative reading and say so
clone "$DB" "$H"
row="$(v_state "$H" preflght)"
case "$row" in
  SCHEMA_ONLY\|recovery\ \(unrecognised*) ok "an unrecognised m4.mode falls back to recovery and names itself";;
  *) bad "an unrecognised m4.mode falls back to recovery and names itself" "$row";;
esac
drop_db "$H"

if [ -x "$ROOT/node_modules/.bin/supabase" ]; then
  clone "$DB" "$H"
  if "$ROOT/node_modules/.bin/supabase" migration repair --status applied 20260914000530 \
       --db-url "$PGURL/$H" >/dev/null 2>&1; then
    n="$(psql "$PGURL/$H" -Atqc "select count(*) from supabase_migrations.schema_migrations where name = 'inbound_agent_settings_and_registrations';")"
    [ "$n" = 1 ] && ok "the pinned CLI's 'migration repair' really records the exact migration name" \
      || bad "the pinned CLI's 'migration repair' really records the exact migration name" "rows=$n"
    [ "$(v_history "$H")" = 0 ] && ok "…so the direct procedure satisfies the same identity contract" \
      || bad "…so the direct procedure satisfies the same identity contract" "$(grep -Eo 'FAILED.*' "$WORK/v" | head -1)"
  else
    bad "the pinned CLI's 'migration repair' really records the exact migration name" "repair invocation failed"
  fi
  drop_db "$H"
else
  echo "  --   CLI absent; the 'migration repair' identity case was not run"
fi

echo "[real-postgres] the classifier's NEITHER state, on a database without M4"
build_base "${DB}_n"
case "$(v_state "${DB}_n" recovery)" in NEITHER*) ok "the classifier reports NEITHER";; *) bad "the classifier reports NEITHER" "$(v_state "${DB}_n")";; esac
case "$(v_state "${DB}_n" preflight)" in NEITHER\|preflight\|PROCEED_WITH_APPLY*) ok "…and in preflight mode it authorises the apply";; *) bad "…and in preflight mode it authorises the apply" "$(v_state "${DB}_n" preflight)";; esac
[ "$(v_schema "${DB}_n")" != 0 ] && ok "the schema verifier FAILS where M4 is absent" || bad "the schema verifier FAILS where M4 is absent"
drop_db "${DB}_n"


echo "[real-postgres] the deparse is pinned, so the CALLER's search_path cannot change the verdict"
EV="${DB}_h"
clone "$DB" "$EV"
psql "$PGURL/$EV" -v ON_ERROR_STOP=1 -qc "CREATE SCHEMA evil;
   CREATE FUNCTION evil.get_org_id() RETURNS uuid LANGUAGE sql STABLE AS \$fn\$ select gen_random_uuid() \$fn\$;" >/dev/null 2>&1
psql "$PGURL/$EV" -v ON_ERROR_STOP=1 -q -c "SET search_path = evil, public" -f "$ROOT/scripts/verify_m4_schema.sql" >"$WORK/v" 2>&1
[ $? = 0 ] && ok "a CORRECT database still verifies under a hostile search_path" \
  || bad "a CORRECT database still verifies under a hostile search_path" "$(grep -Eo 'FAILED.*' "$WORK/v" | head -1)"
psql "$PGURL/$EV" -v ON_ERROR_STOP=1 -qc "DROP POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations;
   CREATE POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations FOR SELECT TO authenticated
     USING (organization_id = evil.get_org_id());" >/dev/null 2>&1
psql "$PGURL/$EV" -v ON_ERROR_STOP=1 -q -c "SET search_path = evil, public" -f "$ROOT/scripts/verify_m4_schema.sql" >"$WORK/v" 2>&1
if [ $? = 0 ]; then bad "a policy calling evil.get_org_id() FAILS even when search_path hides the schema" "verifier PASSED it"
elif grep -qF 'evil.get_org_id()' "$WORK/v"; then ok "a policy calling evil.get_org_id() FAILS even when search_path hides the schema"
else bad "a policy calling evil.get_org_id() FAILS even when search_path hides the schema" "$(grep -Eo 'FAILED.*' "$WORK/v" | head -1)"; fi
drop_db "$EV"

echo "[real-postgres] function bodies, security pins and the guard trigger are part of the contract"
mut "the heartbeat's SET search_path pin removed is caught" \
  "ALTER FUNCTION public.heartbeat_phone_registration(uuid,bigint,boolean,text,text) RESET search_path;" \
  "search_path pin is <none>"
mut "the guard's SET search_path pin removed is caught" \
  "ALTER FUNCTION private.agent_inbound_settings_guard() RESET search_path;" "search_path pin is <none>"
mut "the guard trigger DISABLED is caught" \
  "ALTER TABLE public.agent_inbound_settings DISABLE TRIGGER trg_agent_inbound_settings_guard;" "tgenabled=D"
mut "the guard trigger narrowed to BEFORE INSERT only is caught" \
  "DROP TRIGGER trg_agent_inbound_settings_guard ON public.agent_inbound_settings;
   CREATE TRIGGER trg_agent_inbound_settings_guard BEFORE INSERT ON public.agent_inbound_settings
     FOR EACH ROW EXECUTE FUNCTION private.agent_inbound_settings_guard();" "tgtype=7, expected 23"
mut "the guard trigger re-pointed at another function is caught" \
  "CREATE FUNCTION private.noop_guard() RETURNS trigger LANGUAGE plpgsql AS \$fn\$ BEGIN RETURN NEW; END; \$fn\$;
   DROP TRIGGER trg_agent_inbound_settings_guard ON public.agent_inbound_settings;
   CREATE TRIGGER trg_agent_inbound_settings_guard BEFORE INSERT OR UPDATE ON public.agent_inbound_settings
     FOR EACH ROW EXECUTE FUNCTION private.noop_guard();" "fires private.noop_guard()"
mut "the guard BODY replaced by RETURN NEW is caught" \
  "CREATE OR REPLACE FUNCTION private.agent_inbound_settings_guard() RETURNS trigger LANGUAGE plpgsql
     SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS \$fn\$ BEGIN RETURN NEW; END; \$fn\$;" "BODY DIGEST"
mut "the guard flipped to SECURITY INVOKER is caught" \
  "ALTER FUNCTION private.agent_inbound_settings_guard() SECURITY INVOKER;" "SECURITY INVOKER, expected DEFINER"
mut "the presence predicate's BODY replaced by 'true' is caught" \
  "CREATE OR REPLACE FUNCTION public.is_phone_connected(p_agent_id uuid) RETURNS boolean LANGUAGE sql STABLE
     SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS \$fn\$ select true \$fn\$;" "BODY DIGEST"
mut "a dropped function is REPORTED, not a raw undefined_function error" \
  "DROP FUNCTION public.heartbeat_phone_registration(uuid,bigint,boolean,text,text);" \
  "EXPECTED EXACTLY ONE public.heartbeat_phone_registration, found 0"

echo "[real-postgres] an out-of-scope migration on the target stops the apply"
clone "$DB" "$H"
psql "$PGURL/$H" -v ON_ERROR_STOP=1 -qc "DROP TABLE public.agent_phone_registrations CASCADE;
   DROP TABLE public.agent_inbound_settings CASCADE;
   DROP FUNCTION public.is_phone_connected(uuid);
   DROP FUNCTION public.heartbeat_phone_registration(uuid,bigint,boolean,text,text);
   DROP FUNCTION private.agent_inbound_settings_guard();
   insert into supabase_migrations.schema_migrations(version,name)
     values ('20260913070000','inbound_routing_v2_settings');" >/dev/null 2>&1
row="$(v_state "$H" preflight)"
case "$row" in
  NEITHER\|preflight\|STOP_UNEXPECTED_PRESTATE*) ok "M5 recorded under a service version blocks preflight even with M4 absent";;
  *) bad "M5 recorded under a service version blocks preflight even with M4 absent" "$row";;
esac
case "$(v_state "$H" recovery)" in
  *INVESTIGATE_WRITE_NOTHING*) ok "  …and recovery refuses to authorise a write there too";;
  *) bad "  …and recovery refuses to authorise a write there too" "$(v_state "$H" recovery)";;
esac
drop_db "$H"

echo "[real-postgres] the classifier's self-exclusion marker survives psql"
# psql DISCARDS comments that precede the first token of a query, so a marker in the file header never
# reaches pg_stat_activity.query and every concurrent classifier read counts as in-flight work. Held
# deterministically: the session runs the classifier and then idles on an open stdin, and an idle
# backend's pg_stat_activity.query still holds its LAST statement.
( cat "$ROOT/scripts/verify_m4_state.sql"; sleep 8 ) \
  | PGAPPNAME=m4_marker_probe psql "$PGURL/$DB" -Atq -v ON_ERROR_STOP=1 -c "SET m4.mode='recovery'" -f - >/dev/null 2>&1 &
MPID=$!
found=none
for _ in $(seq 1 800); do
  q="$(psql "$PGURL/$DB" -Atqc "select coalesce(max(case when query like '%M4\_STATE\_CLASSIFIER%' then 'present' else 'absent' end),'none') from pg_stat_activity where application_name = 'm4_marker_probe' and query not like '%SET m4.mode%';" 2>/dev/null)"
  case "$q" in present) found=present; break;; absent) found=absent;; esac
done
kill "$MPID" 2>/dev/null; wait "$MPID" 2>/dev/null
[ "$found" = present ] && ok "the marker reaches pg_stat_activity, so a concurrent read is not counted as in-flight work" \
  || bad "the marker reaches pg_stat_activity" "observed: $found — it must sit INSIDE the statement, not in the file header"

# ── concurrency: an UNCOMMITTED apply is invisible, and that must not be read as "nothing landed" ────
echo "[real-postgres] an apply still in flight is invisible under READ COMMITTED"
echo "                (https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED)"
CD="${DB}_c"
build_base "$CD"
cat "$ROOT/$M4_FILE" > "$WORK/hold.sql"
echo "SELECT pg_sleep(15);" >> "$WORK/hold.sql"
PGAPPNAME=m4_inflight_probe psql "$PGURL/$CD" --single-transaction -v ON_ERROR_STOP=1 -qf "$WORK/hold.sql" >/dev/null 2>&1 &
HOLD_PID=$!
seen=0
for _ in $(seq 1 400); do
  n="$(psql "$PGURL/$CD" -Atqc "select count(*) from pg_stat_activity where application_name = 'm4_inflight_probe' and query like '%pg_sleep%';" 2>/dev/null)"
  [ "$n" = "1" ] && { seen=1; break; }
done
if [ "$seen" != 1 ]; then
  bad "the in-flight apply could be observed" "no backend named m4_inflight_probe reached pg_sleep"
  kill "$HOLD_PID" 2>/dev/null; wait "$HOLD_PID" 2>/dev/null
else
  ok "the in-flight apply is running in another session, past its DDL, uncommitted"
  vis="$(psql "$PGURL/$CD" -Atqc "select (to_regclass('public.agent_inbound_settings') is not null)::text;")"
  [ "$vis" = "false" ] && ok "  …its tables are INVISIBLE to another session before commit" \
    || bad "  …its tables are INVISIBLE to another session before commit" "to_regclass returned $vis"
  INFLIGHT_ROW="$(v_state "$CD" recovery)"
  case "$INFLIGHT_ROW" in
    NEITHER\|recovery\|OUTCOME_UNRESOLVED_DO_NOT_REPLAY*) ok "  …so the classifier reads NEITHER and returns OUTCOME_UNRESOLVED_DO_NOT_REPLAY";;
    *) bad "  …so the classifier reads NEITHER and returns OUTCOME_UNRESOLVED_DO_NOT_REPLAY" "$INFLIGHT_ROW";;
  esac
  otx="$(printf '%s' "$INFLIGHT_ROW" | rev | cut -d'|' -f3 | rev)"
  [ -n "$otx" ] && [ "$otx" -ge 1 ] 2>/dev/null && ok "  …and it reports the other open transaction ($otx)" \
    || bad "  …and it reports the other open transaction" "other_open_transactions=$otx"
  # [real-postgres → fake-tool] the REAL in-flight classification, fed to the real recovery path
  rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=1 FAKE_STATE="$INFLIGHT_ROW")
  check "  …and the recovery path stops with UNRESOLVED on that exact reading" "$rc" 3 "The outcome is UNRESOLVED"
  forbid "  …never recommending a replay during the interval" "re-run this script from the top"
  grep -q "DO NOT re-run this script and DO NOT submit the migration again" "$WORK/out" \
    && ok "  …and forbidding another submission outright" || bad "  …and forbidding another submission outright"
  wait "$HOLD_PID" 2>/dev/null
  vis="$(psql "$PGURL/$CD" -Atqc "select (to_regclass('public.agent_inbound_settings') is not null)::text;")"
  [ "$vis" = "true" ] && ok "after COMMIT the same session sees the tables" \
    || bad "after COMMIT the same session sees the tables" "to_regclass returned $vis"
  case "$(v_state "$CD" recovery)" in
    SCHEMA_ONLY\|recovery\|RECONCILE_HISTORY_ONLY*) ok "…and the classifier now reads SCHEMA_ONLY / RECONCILE_HISTORY_ONLY";;
    *) bad "…and the classifier now reads SCHEMA_ONLY / RECONCILE_HISTORY_ONLY" "$(v_state "$CD" recovery)";;
  esac
fi
drop_db "$CD"

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
