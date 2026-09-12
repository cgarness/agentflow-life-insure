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
run_apply() { env "$@" SUPABASE_CLI="$WORK/bin/supabase" PSQL_BIN="$WORK/bin/psql" \
                 "$ROOT/scripts/apply_m4_only.sh" >"$WORK/out" 2>&1; echo $?; }
check() { # <label> <rc> <want_rc> <want_substr>
  local label="$1" rc="$2" want_rc="$3" want="$4"
  if [ "$rc" != "$want_rc" ]; then bad "$label" "exit $rc, expected $want_rc$(printf '\n     ---\n%s' "$(tail -6 "$WORK/out")")"; return; fi
  if ! grep -qF -- "$want" "$WORK/out"; then bad "$label" "output does not contain: $want$(printf '\n     ---\n%s' "$(tail -8 "$WORK/out")")"; return; fi
  ok "$label"
}
forbid() { # <label> <substring that must NOT appear>
  if grep -qiF -- "$2" "$WORK/out"; then bad "$label" "output wrongly contains: $2"; else ok "$1"; fi
}

# ── stub binaries ───────────────────────────────────────────────────────────────────────────────────
mkdir -p "$WORK/bin"
cat > "$WORK/bin/psql" <<'STUB'
#!/usr/bin/env bash
# canned psql. FAKE_FP / FAKE_APPLY_RC / FAKE_STATE / FAKE_STATE_RC / FAKE_VERIFY_RC drive it.
for a in "$@"; do case "$a" in --version) echo "psql (PostgreSQL) 16.13 [stub]"; exit 0;; esac; done
file=""; sql=""; prev=""
for a in "$@"; do
  case "$prev" in -f) file="$a";; -c) sql="$a";; esac
  prev="$a"
done
if [ -n "$sql" ]; then printf '%s\n' "${FAKE_FP:-170006|20260823222926|0|true|true|2}"; exit 0; fi
case "$file" in
  *verify_m4_state.sql)     printf '%s\n' "${FAKE_STATE:-NEITHER|f|f|0|0|0||}"; exit "${FAKE_STATE_RC:-0}";;
  *verify_m4_untouched.sql) echo " calls | t | f | 5 | 3"; exit 0;;
  *_inbound_agent_settings_and_registrations.sql) exit "${FAKE_APPLY_RC:-0}";;
  *verify_m4_schema.sql|*verify_m4_history.sql) echo "VERIFIED [stub]"; exit "${FAKE_VERIFY_RC:-0}";;
esac
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
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_FP="170006|20260823222926|1|true|true|2")
check "an already-recorded version is refused" "$rc" 1 "ALREADY in the migration history"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1 FAKE_FP="170006|20260823222926|0|false|true|2")
check "a pre-existing M4 table is refused" "$rc" 1 "already exists"
cp "$ROOT/supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql" "$WORK/m4.bak"
printf '\n-- tamper\n' >> "$ROOT/supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" DRY_RUN=1)
check "a tampered migration file is refused by hash" "$rc" 1 "hash mismatch"
cp "$WORK/m4.bak" "$ROOT/supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql"

echo
echo "[fake-tool] uncertain write outcomes — a failed invocation is NOT a confirmed rollback"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=1 FAKE_STATE="NEITHER|f|f|0|0|0||")
check "apply failed + NEITHER  → 'the apply did not land'" "$rc" 1 "the apply did not land"
forbid "  …and no case claims a confirmed rollback" "rolled back"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE="BOTH|t|t|2|1|0|20260911000100|…")
check "apply failed + BOTH     → 'the write LANDED'" "$rc" 1 "the write LANDED despite the failed response"
forbid "  …and it does not tell the operator to re-run the apply" "re-run this script from the top"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE="SCHEMA_ONLY|t|t|2|0|0||")
check "apply failed + SCHEMA_ONLY → repair HISTORY ONLY" "$rc" 1 "Reconcile the MISSING HISTORY OPERATION ALONE"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE="PARTIAL|t|f|1|0|0||")
check "apply failed + PARTIAL  → investigate, write nothing" "$rc" 2 "Do NOT write anything"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_APPLY_RC=2 FAKE_STATE_RC=2 FAKE_STATE="could not connect to server")
check "apply failed + reconciliation unreachable → UNKNOWN" "$rc" 2 "state of the target is UNKNOWN"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_REPAIR_RC=1 FAKE_STATE="SCHEMA_ONLY|t|t|2|0|0||")
check "repair failed + SCHEMA_ONLY → repair HISTORY ONLY, no replay" "$rc" 1 "Do NOT re-run this script"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_REPAIR_RC=1 FAKE_STATE="BOTH|t|t|2|1|0|20260911000100|…")
check "repair failed + BOTH → the repair actually landed" "$rc" 1 "the write LANDED despite the failed response"
grep -qi "continue to M5" "$WORK/out" && ok "every recovery branch forbids continuing to M5" || bad "every recovery branch forbids continuing to M5"

echo
echo "[fake-tool] the successful path only claims success after the asserting verifiers ran"
rc=$(run_apply SUPABASE_DB_URL="$GOOD")
check "green run reports APPLIED AND VERIFIED" "$rc" 0 "M4 APPLIED AND VERIFIED"
grep -q "INCONCLUSIVE" "$WORK/out" && ok "an empty hosted registrations table is called inconclusive" \
  || bad "an empty hosted registrations table is called inconclusive"
rc=$(run_apply SUPABASE_DB_URL="$GOOD" FAKE_VERIFY_RC=3)
check "a failing verifier blocks the success message" "$rc" 1 "CONTRACT NOT VERIFIED"
forbid "  …and 'APPLIED AND VERIFIED' is not printed" "APPLIED AND VERIFIED"

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
psqlq() { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q "${@:2}"; }
build() {
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $1;" >/dev/null 2>&1
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1 TEMPLATE $DB;" >/dev/null 2>&1
}
echo
echo "[real-postgres] building a disposable database from harness + M1-M3 + v2 harness + M4-M7"
psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1
psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;" >/dev/null 2>&1
for f in supabase/tests/inbound_harness.sql \
         supabase/migrations/20260823222528_inbound_identity_foundation.sql \
         supabase/migrations/20260823222805_inbound_claim_lifecycle.sql \
         supabase/migrations/20260823222926_recording_source_sid.sql \
         supabase/tests/inbound_v2_harness.sql \
         supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql; do
  psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -qf "$ROOT/$f" >/dev/null 2>&1 || { echo "  build failed: $f"; exit 1; }
done
trap 'psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; rm -rf "$WORK"' EXIT

v_schema()  { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -qf "$ROOT/scripts/verify_m4_schema.sql"  >"$WORK/v" 2>&1; echo $?; }
v_history() { psql "$PGURL/$1" -v ON_ERROR_STOP=1 -qf "$ROOT/scripts/verify_m4_history.sql" >"$WORK/v" 2>&1; echo $?; }
v_state()   { psql "$PGURL/$1" -Atq -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify_m4_state.sql" 2>&1 | head -1; }

echo "[real-postgres] the schema verifier ASSERTS the contract (each mutation must FAIL it)"
[ "$(v_schema "$DB")" = 0 ] && grep -q M4_SCHEMA_CONTRACT_VERIFIED "$WORK/v" \
  && ok "a correct database verifies" || bad "a correct database verifies" "$(tail -3 "$WORK/v")"
mut() { # <label> <sql> <expected failure fragment>
  local label="$1" sql="$2" want="$3" d="${DB}_m"
  build "$d"
  psql "$PGURL/$d" -v ON_ERROR_STOP=1 -qc "$sql" >/dev/null 2>&1 || { bad "$label" "mutation itself failed to apply"; return; }
  local rc; rc="$(v_schema "$d")"
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1
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
mut "a dropped trigger is caught"            "DROP TRIGGER trg_agent_inbound_settings_guard ON public.agent_inbound_settings;" "EXPECTED the settings guard trigger"
mut "FORCE RLS is caught"                    "ALTER TABLE public.agent_inbound_settings FORCE ROW LEVEL SECURITY;" "FORCE RLS is set"
mut "an unscoped policy expression is caught" \
  "DROP POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations;
   CREATE POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations FOR SELECT TO authenticated USING (true);" \
  "is not organization-scoped"
mut "a widened policy role is caught" \
  "DROP POLICY agent_inbound_settings_self_select ON public.agent_inbound_settings;
   CREATE POLICY agent_inbound_settings_self_select ON public.agent_inbound_settings FOR SELECT TO anon USING (organization_id = public.get_org_id());" \
  "roles anon, expected authenticated"
mut "is_phone_connected turned SECURITY DEFINER is caught" \
  "ALTER FUNCTION public.is_phone_connected(uuid) SECURITY DEFINER;" "SECURITY DEFINER (must be INVOKER)"
mut "heartbeat turned SECURITY INVOKER is caught" \
  "ALTER FUNCTION public.heartbeat_phone_registration(uuid,bigint,boolean,text,text) SECURITY INVOKER;" "must be SECURITY DEFINER"
mut "anon EXECUTE on is_phone_connected is caught" \
  "GRANT EXECUTE ON FUNCTION public.is_phone_connected(uuid) TO anon;" "anon CAN EXECUTE"
mut "a revoked authenticated EXECUTE is caught" \
  "REVOKE EXECUTE ON FUNCTION public.is_phone_connected(uuid) FROM authenticated;" "authenticated cannot EXECUTE"
mut "an exposed private guard is caught" \
  "GRANT EXECUTE ON FUNCTION private.agent_inbound_settings_guard() TO authenticated;" "guard: authenticated CAN EXECUTE"
mut "a write policy on registrations is caught" \
  "CREATE POLICY agent_phone_registrations_w ON public.agent_phone_registrations FOR UPDATE TO authenticated USING (organization_id = public.get_org_id());" \
  "WRITE policy/policies present"

echo "[real-postgres] history verification is separate and also ASSERTS"
[ "$(v_history "$DB")" != 0 ] && grep -q "found 0" "$WORK/v" \
  && ok "a missing history row FAILS (the reported defect)" || bad "a missing history row FAILS" "$(tail -2 "$WORK/v")"
[ "$(v_state "$DB")" != "${_x:-}" ] && case "$(v_state "$DB")" in SCHEMA_ONLY*) ok "the classifier reports SCHEMA_ONLY";; *) bad "the classifier reports SCHEMA_ONLY" "$(v_state "$DB")";; esac
psqlq "$DB" -c "insert into supabase_migrations.schema_migrations (version, name) values ('20260911000100','inbound_agent_settings_and_registrations');" >/dev/null
[ "$(v_history "$DB")" = 0 ] && grep -q M4_HISTORY_VERIFIED "$WORK/v" \
  && ok "the exact expected history entry verifies" || bad "the exact expected history entry verifies" "$(tail -2 "$WORK/v")"
case "$(v_state "$DB")" in BOTH*) ok "the classifier reports BOTH";; *) bad "the classifier reports BOTH" "$(v_state "$DB")";; esac
psqlq "$DB" -c "insert into supabase_migrations.schema_migrations (version, name) values ('20260911000200','inbound_routing_v2_settings');" >/dev/null
[ "$(v_history "$DB")" != 0 ] && grep -q "M5-M7 are recorded" "$WORK/v" \
  && ok "an M5 history row FAILS the M4-only contract" || bad "an M5 history row FAILS the M4-only contract" "$(tail -2 "$WORK/v")"
psqlq "$DB" -c "delete from supabase_migrations.schema_migrations where version = '20260911000200';" >/dev/null
psqlq "$DB" -c "update supabase_migrations.schema_migrations set name = 'something_else' where version = '20260911000100';" >/dev/null
[ "$(v_history "$DB")" != 0 ] && grep -q "unexpected name" "$WORK/v" \
  && ok "a wrongly named history row FAILS" || bad "a wrongly named history row FAILS" "$(tail -2 "$WORK/v")"
psqlq "$DB" -c "update supabase_migrations.schema_migrations set version = '20260912120000', name = 'inbound_agent_settings_and_registrations' where version = '20260911000100';" >/dev/null
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -c "SET m4.expected_version = '20260912120000'" -f "$ROOT/scripts/verify_m4_history.sql" >"$WORK/v" 2>&1
[ $? = 0 ] && grep -q M4_HISTORY_VERIFIED "$WORK/v" \
  && ok "a service-assigned version verifies when passed in (the MCP case)" \
  || bad "a service-assigned version verifies when passed in" "$(tail -2 "$WORK/v")"
[ "$(v_history "$DB")" != 0 ] \
  && ok "…and the same database FAILS against the default version" || bad "…and the same database FAILS against the default version"

echo "[real-postgres] the classifier's NEITHER state, on a database without M4"
ND="${DB}_n"
psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $ND;" >/dev/null 2>&1
psql "$PGURL/postgres" -qc "CREATE DATABASE $ND;" >/dev/null 2>&1
for f in supabase/tests/inbound_harness.sql \
         supabase/migrations/20260823222528_inbound_identity_foundation.sql \
         supabase/migrations/20260823222805_inbound_claim_lifecycle.sql \
         supabase/migrations/20260823222926_recording_source_sid.sql; do
  psql "$PGURL/$ND" -v ON_ERROR_STOP=1 -qf "$ROOT/$f" >/dev/null 2>&1
done
psql "$PGURL/$ND" -v ON_ERROR_STOP=1 -qc "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" >/dev/null 2>&1
case "$(v_state "$ND")" in NEITHER*) ok "the classifier reports NEITHER";; *) bad "the classifier reports NEITHER" "$(v_state "$ND")";; esac
[ "$(v_schema "$ND")" != 0 ] && ok "the schema verifier FAILS where M4 is absent" || bad "the schema verifier FAILS where M4 is absent"
psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $ND;" >/dev/null 2>&1

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
