#!/usr/bin/env bash
# =====================================================================================================
# Google Sheets lead import — SQL + PostgREST suite runner.
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Refuses any non-localhost PGURL.
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_google_sheets_tests.sh
#
#   1. harness + migration (single transaction, as apply_migration does) + replay guard
#   2. behaviour suite (supabase/tests/google_sheets_import.sql): ACL, permissions, OAuth state, Vault,
#      activation baseline, ingest/idempotency, pending/correction, 24-combination duplicate matrix,
#      stale lease/version/generation/permission, reconnect, remove/re-add, review, RLS
#   2b. REGRESSION cases (supabase/tests/google_sheets_regressions.sql): fail on the reviewed head 8b675e5,
#      must pass here (stale finish, review generation, ambiguous content matches)
#   3. two-session concurrency: two sources importing the same person serialize (one plain, one flagged)
#      + NEGATIVE CONTROL (advisory lock removed → both plain, proving the test detects the race)
#   4. two-session SKIP LOCKED claim: overlapping workers never claim the same source
#   4b. two sessions: a reconnect holding the connection lock vs an old run's finish → released
#      + NEGATIVE CONTROL (finish's connection lock removed → completed with the stale status)
#   4c. two sessions: the lease expires while finish waits for the source lock → released
#      + NEGATIVE CONTROL (clock_timestamp() replaced by transaction-start now() → completed)
#   5. rollback proof (objects removed, exact permission-helper preimage restored) + clean re-apply
#   6. PostgREST role-access check (Docker postgrest/postgrest:v12.2.3; skipped with a notice if absent):
#      service_role reaches the wrappers and runs a worker cycle; authenticated/anon are refused;
#      private helpers are not exposed; authenticated reads only its own rows.
#   7. END-TO-END Review harness (scripts/google_sheets_e2e.ts, Deno): the real google-sheets-api actions and
#      sync engine through PostgREST; planner → Review preview → Review apply → next sync (Google faked).
#   4d. NON-DESTRUCTIVE SHUTDOWN with the exact supabase/ops files: an invocation already running is blocked at
#      its next call, an RPC already executing completes, new admissions are refused, the drain check reports
#      quiescence with stable markers; reopening restores the exact ACL and resumes without replay.
# PUSH SYNC (20261025120000) is applied on top of the foundation in EVERY database, as production will run it:
#   2c. push behaviour suite (supabase/tests/google_sheets_push.sql)
#   4e. two workers race for one job (target lease) + NEGATIVE CONTROL (lease check removed → both claim)
#   4f. push vs Sync now race for one tab (source lease) + NEGATIVE CONTROL (lease check removed → both claim)
#   4g. a notification during processing is never lost + NEGATIVE CONTROL (completion uses requested_seq)
#   4h. lock order: receiver vs watch_result on one target, no deadlock + NEGATIVE CONTROL (target locked first →
#       deadlock), and two receivers × 40 notifications → exactly 80 increments
#   4i. rejected requests and redeliveries never wait: while another session holds the channel and target rows,
#       20 wrong-token requests and one redelivery complete under lock_timeout 1 s and record nothing + NEGATIVE
#       CONTROL (authentication under FOR UPDATE, as before → lock timeouts)
#   8. END-TO-END push harness (scripts/google_sheets_push_e2e.ts): the real receiver, processor and
#      google-sheets-api hooks through PostgREST (Google faked)
# MAPPING V2 (20261028034425, M1: typed catalog) is applied on top of push in EVERY database, as production
# will run it; STANDARD LEAD FIELDS (20261028040215, M2) needs the custom-field logical-name guard and the
# production get_user_role / is_super_admin / normalize_us_state (loaded verbatim from the baseline schema):
#   5b. M1 suite (supabase/tests/google_sheets_mapping_v2.sql): catalog keys, visibility matrix across roles and two
#       agencies, ACL / inventory 75, normalize_us_state parity with the Deno preview port; M1 replay guard + rollback
#       proof (exact foundation body) + re-apply; mapping v2 → v1 ops aid
#   5c. M2 suite (supabase/tests/standard_lead_fields.sql): seeding, failure detection, authorized idempotent retry,
#       conversion authority / snapshot / audit, cross-agency isolation, privileges; ops report + approved apply
#       (fail-closed); M2 replay guard + rollback proof (tables kept) + re-apply
#   5d. two sessions provision one agency at once → one row per name + NEGATIVE CONTROL (provisioning lock removed)
# Every database is dropped on exit. Nothing here touches a hosted project.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (AGENT_RULES invariant #28)"; exit 2 ;;
esac
if psql "$PGURL/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname = 'jncvvsvckxhqgqvkppmj'" | grep -q 1; then
  echo "REFUSING: this looks like a hosted project"; exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/supabase/tests/google_sheets_harness.sql"
SUITE="$ROOT/supabase/tests/google_sheets_import.sql"
MIG="$ROOT/supabase/migrations/20261022062539_google_sheets_import_foundation.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20261022062539_google_sheets_import_foundation.rollback.sql"
PUSH="$ROOT/supabase/migrations/20261025120000_google_sheets_push_sync.sql"
PUSH_ROLLBACK="$ROOT/supabase/migrations/rollback/20261025120000_google_sheets_push_sync.rollback.sql"
PUSH_SUITE="$ROOT/supabase/tests/google_sheets_push.sql"
CTX="$ROOT/supabase/migrations/20261028034425_google_sheets_context_field_types.sql"
CTX_ROLLBACK="$ROOT/supabase/migrations/rollback/20261028034425_google_sheets_context_field_types.rollback.sql"
STD="$ROOT/supabase/migrations/20261028040215_standard_lead_fields.sql"
STD_ROLLBACK="$ROOT/supabase/migrations/rollback/20261028040215_standard_lead_fields.rollback.sql"
GUARD="$ROOT/supabase/migrations/20260919052941_custom_field_logical_name_guard.sql"
GUARD_GRANT="$ROOT/supabase/migrations/20260922222659_custom_field_norm_execute_grant.sql"
V2_SUITE="$ROOT/supabase/tests/google_sheets_mapping_v2.sql"
STD_SUITE="$ROOT/supabase/tests/standard_lead_fields.sql"
STATE_PARITY="$ROOT/supabase/functions/_shared/googleSheets/fixtures/state-parity.json"
TMP="$(mktemp -d)"
DB="gs_test_$$"; DB_CC="gs_cc_$$"; DB_NEG="gs_neg_$$"; DB_RB="gs_rb_$$"; DB_RS="gs_rs_$$"; DB_RG="gs_rg_$$"
DB_FR="gs_fr_$$"; DB_FRN="gs_frn_$$"; DB_LX="gs_lx_$$"; DB_LXN="gs_lxn_$$"; DB_E2E="gs_e2e_$$"; DB_SD="gs_sd_$$"
DB_PS="gs_ps_$$"; DB_PC="gs_pc_$$"; DB_PCN="gs_pcn_$$"; DB_PE2E="gs_pe2e_$$"
DB_V2="gs_v2_$$"; DB_SLF="gs_slf_$$"; DB_SLR="gs_slr_$$"; DB_SLRN="gs_slrn_$$"
OPS="$ROOT/supabase/ops"
PGRST_E2E="gs_pgrst_e2e_$$"; PGRST_PE2E="gs_pgrst_pe2e_$$"
DENO_BIN="${DENO_BIN:-deno}"
REG="$ROOT/supabase/tests/google_sheets_regressions.sql"
PGRST_NAME="gs_pgrst_$$"
cleanup() {
  docker rm -f "$PGRST_NAME" "$PGRST_E2E" "$PGRST_PE2E" >/dev/null 2>&1 || true
  for d in "$DB" "$DB_CC" "$DB_NEG" "$DB_RB" "$DB_RS" "$DB_RG" "$DB_FR" "$DB_FRN" "$DB_LX" "$DB_LXN" "$DB_E2E" "$DB_SD" \
           "$DB_PS" "$DB_PC" "$DB_PCN" "$DB_PE2E" "$DB_V2" "$DB_SLF" "$DB_SLR" "$DB_SLRN"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d WITH (FORCE);" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

build() { # $1 db, $2 foundation file, $3 push file (default: $PUSH; "none" = foundation only); M1 follows push
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$HARNESS" >/dev/null 2>&1
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$2" >/dev/null 2>&1
  if [ "${3:-$PUSH}" != none ]; then
    psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "${3:-$PUSH}" >/dev/null && psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$CTX" >/dev/null
  fi
}
# Production helpers the standard-field functions call, verbatim from the baseline schema (the harness has none or a subset).
PROD_HELPERS="$TMP/prod_helpers.sql"
python3 - "$ROOT/supabase/migrations/20260806000000_baseline_production_schema.sql" > "$PROD_HELPERS" <<'PY'
import sys
s = open(sys.argv[1]).read()
for name in ("get_user_role", "is_super_admin", "normalize_us_state"):
    i = s.index('CREATE OR REPLACE FUNCTION "public"."%s"' % name)
    print(s[i:s.index("$$;", i) + 3] + "\n")
PY
build_std() { # $1 db, $2 M2 file (default $STD): build + production helpers + the logical-name guard + M2
  build "$1" "$MIG"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$PROD_HELPERS" >/dev/null
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$GUARD" >/dev/null 2>&1
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$GUARD_GRANT" >/dev/null 2>&1
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "${2:-$STD}" >/dev/null 2>&1
}

echo "== 1. harness + foundation + push sync migrations =="
build "$DB" "$MIG"; echo "   OK"
if psql "$PGURL/$DB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1; then echo "   FAIL: re-applied"; exit 1; fi
if psql "$PGURL/$DB" -1 -v ON_ERROR_STOP=1 -q -f "$PUSH" >/dev/null 2>&1; then echo "   FAIL: push re-applied"; exit 1; fi
if psql "$PGURL/$DB" -1 -v ON_ERROR_STOP=1 -q -f "$CTX" >/dev/null 2>&1; then echo "   FAIL: M1 re-applied"; exit 1; fi
echo "   replay guards OK (second applies refused, M1 included)"
sed '/FUNCTION private.google_sheets_finish(/,/^END \$\$;/ s/^  v_now := clock_timestamp();$/  v_now := now(); -- tampered/' "$MIG" > "$TMP/mig_tampered.sql"
grep -q "v_now := now(); -- tampered" "$TMP/mig_tampered.sql" || { echo "   FAIL: tamper patch did not apply"; exit 1; }
if build "${DB}_tp" "$TMP/mig_tampered.sql" 2>/dev/null; then echo "   FAIL: push applied over a changed finish preimage"; exit 1; fi
psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS ${DB}_tp WITH (FORCE);" >/dev/null 2>&1
echo "   preimage guard OK (push refuses a finish that differs from the live definition)"

echo; echo "== 2. behaviour suite =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f "$SUITE" 2>&1 | grep -E "PASS|FAIL|ERROR|PASSED" | sed 's/^.*NOTICE:  /   /'

echo; echo "== 2c. push sync behaviour suite =="
build "$DB_PS" "$MIG"
psql "$PGURL/$DB_PS" -v ON_ERROR_STOP=1 -f "$PUSH_SUITE" > "$TMP/push.out" 2>&1 || { grep -E "PASS|FAIL|ERROR" "$TMP/push.out" | sed 's/^.*NOTICE:  /   /'; echo "   FAIL: push suite"; exit 1; }
grep -E "PASS|PASSED" "$TMP/push.out" | sed 's/^.*NOTICE:  /   /'
grep -q "ALL GOOGLE SHEETS PUSH SQL TESTS PASSED" "$TMP/push.out" || { echo "   FAIL: push suite incomplete"; exit 1; }

echo; echo "== 2b. regression cases (fail on 8b675e5; must pass here) =="
build "$DB_RG" "$MIG"
psql "$PGURL/$DB_RG" -f "$REG" > "$TMP/reg.out" 2>&1 || true
grep -E "(PASS|FAIL) (REGRESSION|CONTROL)" "$TMP/reg.out" | sed 's/^.*NOTICE:  /   /'
grep -q "REGRESSION SUMMARY: all" "$TMP/reg.out" || { echo "   FAIL: regression cases"; grep -E "ERROR" "$TMP/reg.out" | head -5; exit 1; }
echo "   OK"

# ---------------------------------------------------------------- concurrency fixture
CC_FIXTURE="$TMP/cc_fixture.sql"
cat > "$CC_FIXTURE" <<'SQL'
INSERT INTO public.organizations (id, name) VALUES ('a0000000-0000-0000-0000-00000000000a', 'Org A');
INSERT INTO public.profiles (id, organization_id, role) VALUES
  ('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Agent'),
  ('11111111-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Agent');
CREATE TABLE public.cc_leases (src uuid PRIMARY KEY, lease uuid, ver int, gen bigint);
DO $$
DECLARE u uuid; s record; a record; g bigint; i int; l uuid; c record;
BEGIN
  FOREACH u IN ARRAY ARRAY['11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002']::uuid[] LOOP
    SELECT auth_generation INTO g FROM public.google_sheets_store_connection(u, 'a0000000-0000-0000-0000-00000000000a', 0,
      'sub-' || u, 'x@example.test', '{}', 'rt');
    FOR i IN 1..4 LOOP
      SELECT * INTO s FROM public.google_sheets_save_source(u, 'a0000000-0000-0000-0000-00000000000a', NULL, NULL,
        jsonb_build_object('spreadsheet_id','SPREADSHEET_CONCURRENT','sheet_id', i, 'display_name','cc', 'mapping','{}'::jsonb));
      SELECT * INTO a FROM public.google_sheets_activate(u, 'a0000000-0000-0000-0000-00000000000a', s.source_id, s.config_version, g, '[]', 0);
    END LOOP;
  END LOOP;
  -- lease the two sources (one per agent, sheet 1) used by the ingest race
  FOR s IN SELECT id, user_id FROM public.google_sheets_sources WHERE sheet_id = 1 LOOP
    l := gen_random_uuid();
    SELECT * INTO c FROM public.google_sheets_claim(l, 1, s.id, s.user_id, 'a0000000-0000-0000-0000-00000000000a');
    INSERT INTO public.cc_leases VALUES (s.id, l, c.config_version, c.auth_generation);
  END LOOP;
END $$;
SQL

race() { # $1 db → prints the two outcomes
  local q_a q_b
  q_a="BEGIN; SELECT public.google_sheets_ingest(src, lease, ver, gen, '[{\"k\":\"pos:2\",\"n\":2,\"f\":\"f\",\"lead\":{\"first_name\":\"Race\",\"last_name\":\"One\",\"phone\":\"5551234567\"}}]', '[]')->'rows'->0->>'o' FROM public.cc_leases l JOIN public.google_sheets_sources s ON s.id = l.src WHERE s.user_id = '11111111-0000-0000-0000-000000000001'; SELECT pg_sleep(2); COMMIT;"
  q_b="SELECT pg_sleep(0.5); SELECT public.google_sheets_ingest(src, lease, ver, gen, '[{\"k\":\"pos:2\",\"n\":2,\"f\":\"f\",\"lead\":{\"first_name\":\"Race\",\"last_name\":\"Two\",\"phone\":\"555-123-4567\"}}]', '[]')->'rows'->0->>'o' FROM public.cc_leases l JOIN public.google_sheets_sources s ON s.id = l.src WHERE s.user_id = '11111111-0000-0000-0000-000000000002';"
  psql "$PGURL/$1" -tAqc "$q_a" > "$TMP/a.out" &
  local pa=$!
  psql "$PGURL/$1" -tAqc "$q_b" > "$TMP/b.out"
  wait $pa
  echo "$(grep -E '^(imported|flagged|skipped)' "$TMP/a.out") $(grep -E '^(imported|flagged|skipped)' "$TMP/b.out")"
}

echo; echo "== 3. concurrency: two sources, same person =="
build "$DB_CC" "$MIG"
psql "$PGURL/$DB_CC" -v ON_ERROR_STOP=1 -q -f "$CC_FIXTURE" >/dev/null
OUT="$(race "$DB_CC")"
echo "   outcomes: $OUT"
[ "$OUT" = "imported flagged" ] || { echo "   FAIL: expected 'imported flagged'"; exit 1; }
echo "   OK (serialized: second import saw the first and was flagged)"
sed 's/PERFORM pg_advisory_xact_lock(hashtextextended(/PERFORM (hashtextextended(/' "$MIG" > "$TMP/mig_nolock.sql"
grep -q "PERFORM (hashtextextended(" "$TMP/mig_nolock.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
build "$DB_NEG" "$TMP/mig_nolock.sql"
psql "$PGURL/$DB_NEG" -v ON_ERROR_STOP=1 -q -f "$CC_FIXTURE" >/dev/null
OUT="$(race "$DB_NEG")"
echo "   negative control (lock removed): $OUT"
[ "$OUT" = "imported imported" ] || { echo "   FAIL: negative control did not reproduce the race"; exit 1; }
echo "   OK (race reproduced without the lock → the test is meaningful)"

echo; echo "== 4. concurrency: overlapping claims (SKIP LOCKED) =="
psql "$PGURL/$DB_CC" -qc "UPDATE public.google_sheets_sources SET next_sync_at = now() - interval '1 minute', lease_owner = NULL, lease_expires_at = NULL;"
psql "$PGURL/$DB_CC" -tAqc "BEGIN; SELECT source_id FROM public.google_sheets_claim('00000000-0000-0000-0000-0000000000aa', 4); SELECT pg_sleep(2); COMMIT;" > "$TMP/ca.out" &
PA=$!
psql "$PGURL/$DB_CC" -tAqc "SELECT pg_sleep(0.5); SELECT source_id FROM public.google_sheets_claim('00000000-0000-0000-0000-0000000000bb', 4);" > "$TMP/cb.out"
wait $PA
NA=$(grep -cE '^[0-9a-f-]{36}$' "$TMP/ca.out" || true); NB=$(grep -cE '^[0-9a-f-]{36}$' "$TMP/cb.out" || true)
DUP=$(cat "$TMP/ca.out" "$TMP/cb.out" | grep -E '^[0-9a-f-]{36}$' | sort | uniq -d | wc -l)
echo "   worker A claimed $NA, worker B claimed $NB, overlap $DUP"
[ "$NA" = 4 ] && [ "$NB" = 4 ] && [ "$DUP" = 0 ] || { echo "   FAIL"; exit 1; }
echo "   OK"

# ---------------------------------------------------------------- finish fixture: one connected agent, one claimed source
FX_FIXTURE="$ROOT/supabase/tests/google_sheets_finish_fixture.sql"
FINISH_OLD="SELECT public.google_sheets_finish(f.src, f.lease, f.ver, f.gen, 'schedule', '{\"health\":\"access_lost\",\"error_code\":\"stale\"}') FROM public.fx f;"
HEALTH="SELECT health FROM public.google_sheets_sources s JOIN public.fx f ON f.src = s.id;"

race_reconnect() { # $1 db → "<finish outcome> <health>"
  local q_a="BEGIN; SELECT r.outcome FROM public.fx f, public.google_sheets_store_connection(f.uid, f.oid, (SELECT auth_generation FROM public.google_sheets_connections WHERE id = f.cid), 'sub-fx', 'fx@example.test', '{}', 'rt-fx-2') r; SELECT pg_sleep(2); COMMIT;"
  psql "$PGURL/$1" -tAqc "$q_a" > "$TMP/ra.out" &
  local pa=$!
  psql "$PGURL/$1" -tAqc "SELECT pg_sleep(0.5);" >/dev/null
  local o; o="$(psql "$PGURL/$1" -tAqc "$FINISH_OLD")"
  wait $pa
  echo "$o $(psql "$PGURL/$1" -tAqc "$HEALTH")"
}

echo; echo "== 4b. finish vs a concurrent reconnect (two sessions) =="
build "$DB_FR" "$MIG"; psql "$PGURL/$DB_FR" -v ON_ERROR_STOP=1 -q -f "$FX_FIXTURE" >/dev/null
OUT="$(race_reconnect "$DB_FR")"; echo "   outcome: $OUT"
[ "$OUT" = "released ok" ] || { echo "   FAIL: expected 'released ok'"; exit 1; }
# The push migration replaces finish (guarded), so the control removes the lock from the LIVE (push) definition.
sed 's/ FOR SHARE; -- finish:connection-lock/; -- finish:connection-lock REMOVED (negative control)/' "$PUSH" > "$TMP/mig_nofinishlock.sql"
grep -q "finish:connection-lock REMOVED" "$TMP/mig_nofinishlock.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
build "$DB_FRN" "$MIG" "$TMP/mig_nofinishlock.sql"; psql "$PGURL/$DB_FRN" -v ON_ERROR_STOP=1 -q -f "$FX_FIXTURE" >/dev/null
OUT="$(race_reconnect "$DB_FRN")"; echo "   negative control (connection lock removed): $OUT"
[ "$OUT" = "completed access_lost" ] || { echo "   FAIL: negative control did not reproduce the race"; exit 1; }
echo "   OK (the connection lock serialises finish behind the reconnect)"

race_expiry() { # $1 db → finish outcome when the lease expires while finish waits for the source lock
  psql "$PGURL/$1" -qc "UPDATE public.google_sheets_sources s SET lease_expires_at = clock_timestamp() + interval '1 second' FROM public.fx f WHERE s.id = f.src;"
  psql "$PGURL/$1" -tAqc "BEGIN; SELECT 1 FROM public.google_sheets_sources s JOIN public.fx f ON f.src = s.id FOR UPDATE OF s; SELECT pg_sleep(2); COMMIT;" >/dev/null &
  local pa=$!
  psql "$PGURL/$1" -tAqc "SELECT pg_sleep(0.3);" >/dev/null
  psql "$PGURL/$1" -tAqc "SELECT public.google_sheets_finish(f.src, f.lease, f.ver, f.gen, 'schedule', '{\"health\":\"ok\",\"imported\":1}') FROM public.fx f;"
  wait $pa
}

echo; echo "== 4c. the lease expires while finish waits for the source lock (two sessions) =="
build "$DB_LX" "$MIG"; psql "$PGURL/$DB_LX" -v ON_ERROR_STOP=1 -q -f "$FX_FIXTURE" >/dev/null
OUT="$(race_expiry "$DB_LX")"; echo "   outcome: $OUT"
[ "$OUT" = "released" ] || { echo "   FAIL: expected released"; exit 1; }
sed '/FUNCTION private.google_sheets_finish(/,/^END \$\$;/ s/^  v_now := clock_timestamp();$/  v_now := now(); -- negative control/' "$PUSH" > "$TMP/mig_nowclock.sql"
[ "$(grep -c 'v_now := now(); -- negative control' "$TMP/mig_nowclock.sql")" = 1 ] || { echo "   FAIL: negative-control patch is not exactly finish's"; exit 1; }
grep -q "v_now := now(); -- negative control" "$TMP/mig_nowclock.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
build "$DB_LXN" "$MIG" "$TMP/mig_nowclock.sql"; psql "$PGURL/$DB_LXN" -v ON_ERROR_STOP=1 -q -f "$FX_FIXTURE" >/dev/null
OUT="$(race_expiry "$DB_LXN")"; echo "   negative control (transaction-start now()): $OUT"
[ "$OUT" = "completed" ] || { echo "   FAIL: negative control did not reproduce the stale-clock acceptance"; exit 1; }
echo "   OK (expiry is evaluated on the real clock after the lock wait)"

# ---------------------------------------------------------------- push sync two-session tests
PC_FIXTURE="$ROOT/supabase/tests/google_sheets_push_concurrency_fixture.sql"
fresh_pc() { # $1 db, $2 push migration file
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $1 WITH (FORCE);" >/dev/null 2>&1
  build "$1" "$MIG" "$2"; psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$PC_FIXTURE" >/dev/null
}
PCV() { echo "(SELECT v FROM public.pcx WHERE k = '$1')"; }
claim_race() { # $1 db → number of the two concurrent workers that claimed the same job
  local q="SELECT target_id FROM public.google_sheets_push_claim(gen_random_uuid(), $(PCV target)::uuid, 300, 'receiver')"
  psql "$PGURL/$1" -tAqc "BEGIN; $q; SELECT pg_sleep(2); COMMIT;" > "$TMP/pa.out" &
  local pa=$!; sleep 0.5
  psql "$PGURL/$1" -tAqc "$q;" > "$TMP/pb.out"; wait $pa
  cat "$TMP/pa.out" "$TMP/pb.out" | grep -cE '^[0-9a-f-]{36}$' || true
}
echo; echo "== 4e. push: two workers race for one job (target lease) =="
fresh_pc "$DB_PC" "$PUSH"; OUT="$(claim_race "$DB_PC")"; echo "   workers that claimed: $OUT"
[ "$OUT" = 1 ] || { echo "   FAIL: expected exactly one claim"; exit 1; }
sed 's/^     AND (x.lease_expires_at IS NULL OR x.lease_expires_at <= v_now) -- push_claim:lease$/     -- push_claim:lease REMOVED (negative control)/' "$PUSH" > "$TMP/push_nolease.sql"
grep -q "push_claim:lease REMOVED" "$TMP/push_nolease.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
fresh_pc "$DB_PCN" "$TMP/push_nolease.sql"; OUT="$(claim_race "$DB_PCN")"; echo "   negative control (lease check removed): $OUT"
[ "$OUT" = 2 ] || { echo "   FAIL: negative control did not reproduce the double claim"; exit 1; }
echo "   OK (one job, one worker; the test detects a missing lease check)"

src_race() { # $1 db → "<concurrent claims> <sequential second claim>"
  local lease="99999999-0000-0000-0000-0000000000e1"
  psql "$PGURL/$1" -tAqc "SELECT 1 FROM public.google_sheets_push_claim('$lease', $(PCV target)::uuid, 300, 'receiver');" >/dev/null
  local push="SELECT source_id FROM public.google_sheets_push_claim_source($(PCV target)::uuid, '$lease', $(PCV src)::uuid, gen_random_uuid())"
  local manual="SELECT source_id FROM public.google_sheets_claim(gen_random_uuid(), 1, $(PCV src)::uuid, $(PCV uid)::uuid, $(PCV oid)::uuid)"
  psql "$PGURL/$1" -tAqc "BEGIN; $push; SELECT pg_sleep(2); COMMIT;" > "$TMP/sa.out" &
  local pa=$!; sleep 0.5
  psql "$PGURL/$1" -tAqc "$manual;" > "$TMP/sb.out"; wait $pa
  local n; n="$(cat "$TMP/sa.out" "$TMP/sb.out" | grep -cE '^[0-9a-f-]{36}$' || true)"
  # sequential: Sync now holds the tab (committed) → push must not take it
  psql "$PGURL/$1" -qc "UPDATE public.google_sheets_sources SET lease_owner = NULL, lease_expires_at = NULL, last_checked_at = NULL;" >/dev/null
  psql "$PGURL/$1" -tAqc "$manual;" >/dev/null
  local m; m="$(psql "$PGURL/$1" -tAqc "$push;" | grep -cE '^[0-9a-f-]{36}$' || true)"
  echo "$n $m"
}
echo; echo "== 4f. push vs Sync now race for one tab (source lease) =="
fresh_pc "$DB_PC" "$PUSH"; OUT="$(src_race "$DB_PC")"; echo "   concurrent claims, then push after Sync now: $OUT"
[ "$OUT" = "1 0" ] || { echo "   FAIL: expected '1 0'"; exit 1; }
sed 's/^       AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= now()) -- push_claim_source:lease$/       -- push_claim_source:lease REMOVED (negative control)/' "$PUSH" > "$TMP/push_nosrclease.sql"
grep -q "push_claim_source:lease REMOVED" "$TMP/push_nosrclease.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
fresh_pc "$DB_PCN" "$TMP/push_nosrclease.sql"; OUT="$(src_race "$DB_PCN")"; echo "   negative control (lease check removed): $OUT"
[ "$OUT" = "1 1" ] || { echo "   FAIL: negative control did not reproduce the shared tab"; exit 1; }
echo "   OK (Sync now and push never run one tab at once; the test detects a missing lease check)"

mid_run() { # $1 db → "<processed> <requested> <dirty>" after a notification lands between claim and completion
  local lease="99999999-0000-0000-0000-0000000000e2" sl="99999999-0000-0000-0000-0000000000e3"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -tAq > "$TMP/mr.out" <<SQL
SELECT 1 FROM public.google_sheets_push_claim('$lease', $(PCV target)::uuid, 300, 'receiver');
SELECT outcome FROM public.google_sheets_push_accept($(PCV chx), $(PCV dx), 'RES-X', 'update', 500, 'content', now());
SELECT config_version || '|' || auth_generation FROM public.google_sheets_push_claim_source($(PCV target)::uuid, '$lease', $(PCV src)::uuid, '$sl');
SELECT public.google_sheets_finish($(PCV src)::uuid, '$sl', (SELECT config_version FROM public.google_sheets_sources WHERE id = $(PCV src)::uuid),
  (SELECT auth_generation FROM public.google_sheets_connections LIMIT 1), 'push', '{"health":"ok"}');
SELECT (public.google_sheets_push_complete($(PCV target)::uuid, '$lease', '{"outcome":"done","reason":""}'::jsonb))->>'dirty';
SELECT processed_seq || ' ' || requested_seq FROM private.google_sheets_watch_targets WHERE id = $(PCV target)::uuid;
SQL
  echo "$(tail -1 "$TMP/mr.out") $(tail -2 "$TMP/mr.out" | head -1)"
}
echo; echo "== 4g. a notification during processing is never lost =="
fresh_pc "$DB_PC" "$PUSH"; OUT="$(mid_run "$DB_PC")"; echo "   processed requested dirty: $OUT"
[ "$OUT" = "1 2 true" ] || { echo "   FAIL: expected '1 2 true'"; exit 1; }
sed 's/GREATEST(x.processed_seq, LEAST(x.lease_snapshot, x.requested_seq)) -- push_complete:snapshot/GREATEST(x.processed_seq, x.requested_seq) -- negative control/' "$PUSH" > "$TMP/push_nosnap.sql"
grep -q "x.requested_seq) -- negative control" "$TMP/push_nosnap.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
fresh_pc "$DB_PCN" "$TMP/push_nosnap.sql"; OUT="$(mid_run "$DB_PCN")"; echo "   negative control (completion uses requested_seq): $OUT"
[ "$OUT" = "2 2 false" ] || { echo "   FAIL: negative control did not reproduce the lost notification"; exit 1; }
# concurrent: a receiver accepting while a completion holds the target
psql "$PGURL/$DB_PC" -qc "UPDATE private.google_sheets_watch_targets SET next_attempt_at = now();" >/dev/null
psql "$PGURL/$DB_PC" -tAqc "SELECT 1 FROM public.google_sheets_push_claim('99999999-0000-0000-0000-0000000000e4', $(PCV target)::uuid, 300, 'receiver');" >/dev/null
psql "$PGURL/$DB_PC" -tAqc "BEGIN; SELECT public.google_sheets_push_complete($(PCV target)::uuid, '99999999-0000-0000-0000-0000000000e4', '{\"outcome\":\"retry\",\"reason\":\"busy\"}'); SELECT pg_sleep(2); COMMIT;" >/dev/null &
PA=$!; sleep 0.5
ACC="$(psql "$PGURL/$DB_PC" -tAqc "SELECT outcome FROM public.google_sheets_push_accept($(PCV chx), $(PCV dx), 'RES-X', 'update', 501, 'content', now());")"; wait $PA
SEQ="$(psql "$PGURL/$DB_PC" -tAqc "SELECT requested_seq - processed_seq FROM private.google_sheets_watch_targets WHERE id = $(PCV target)::uuid")"
echo "   concurrent accept during completion: $ACC, unprocessed $SEQ"
[ "$ACC" = queued ] && [ "$SEQ" = 2 ] || { echo "   FAIL: concurrent accept lost or refused"; exit 1; }
echo "   OK (processed only to the claim snapshot; mid-run work stays queued; the test detects the lost update)"

lock_order() { # $1 db → "<accept outcome>|<watch_result status>|<deadlocks>"
  local tgt; tgt="$(psql "$PGURL/$1" -tAqc "SELECT v FROM public.pcx WHERE k = 'target'")"
  psql "$PGURL/$1" -tAqc "BEGIN; SELECT 1 FROM private.google_sheets_watch_targets WHERE id = '$tgt' FOR UPDATE; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 &
  local ph=$!; sleep 0.3
  psql "$PGURL/$1" -tAqc "SELECT public.google_sheets_watch_result($(PCV rowy)::uuid, 'stop_failed', NULL, NULL, 'google_unavailable')->>'status';" > "$TMP/lb.out" 2>&1 &
  local pb=$!; sleep 0.3
  psql "$PGURL/$1" -tAqc "SELECT outcome FROM public.google_sheets_push_accept($(PCV chx), $(PCV dx), 'RES-X', 'update', 600, 'content', now());" > "$TMP/la.out" 2>&1 &
  local pa=$!
  wait $ph $pb $pa || true
  echo "$(tr -d '\n' < "$TMP/la.out" | sed 's/.*deadlock detected.*/DEADLOCK/')|$(tr -d '\n' < "$TMP/lb.out" | sed 's/.*deadlock detected.*/DEADLOCK/')|$(cat "$TMP/la.out" "$TMP/lb.out" | grep -c 'deadlock detected' || true)"
}
echo; echo "== 4h. lock order: receiver vs watch_result on one target =="
fresh_pc "$DB_PC" "$PUSH"; OUT="$(lock_order "$DB_PC")"; echo "   accept|watch_result|deadlocks: $OUT"
[ "$OUT" = "queued|stop_failed|0" ] || { echo "   FAIL: expected 'queued|stop_failed|0'"; exit 1; }
sed 's/^  PERFORM 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = v_target ORDER BY w.id FOR UPDATE; -- watch_result:lock-order$/  PERFORM 1 FROM private.google_sheets_watch_targets x WHERE x.id = v_target FOR UPDATE; -- negative control: target first\n  PERFORM 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = v_target ORDER BY w.id FOR UPDATE;/' "$PUSH" > "$TMP/push_badorder.sql"
grep -q "negative control: target first" "$TMP/push_badorder.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
fresh_pc "$DB_PCN" "$TMP/push_badorder.sql"; OUT="$(lock_order "$DB_PCN")"; echo "   negative control (target locked first): $OUT"
case "$OUT" in *"|1") ;; *) echo "   FAIL: negative control did not reproduce the deadlock"; exit 1 ;; esac
# two receivers, 40 notifications each on the two overlapping channels: no lost increment, no deadlock
fresh_pc "$DB_PC" "$PUSH"
BEFORE="$(psql "$PGURL/$DB_PC" -tAqc "SELECT requested_seq FROM private.google_sheets_watch_targets")"
for c in x y; do
  : > "$TMP/burst_$c.sql"
  for i in $(seq 1 40); do echo "SELECT outcome FROM public.google_sheets_push_accept($(PCV ch$c), $(PCV d$c), 'RES-$(echo $c | tr a-z A-Z)', 'update', $((1000 + i)), 'content', now());" >> "$TMP/burst_$c.sql"; done
done
psql "$PGURL/$DB_PC" -tAq -f "$TMP/burst_x.sql" > "$TMP/bx.out" 2>&1 & PX=$!
psql "$PGURL/$DB_PC" -tAq -f "$TMP/burst_y.sql" > "$TMP/by.out" 2>&1 & PY=$!
wait $PX $PY
AFTER="$(psql "$PGURL/$DB_PC" -tAqc "SELECT requested_seq FROM private.google_sheets_watch_targets")"
QUEUED="$(cat "$TMP/bx.out" "$TMP/by.out" | grep -c '^queued$' || true)"
echo "   80 concurrent notifications → $QUEUED queued, requested_seq $BEFORE → $AFTER"
[ "$QUEUED" = 80 ] && [ "$AFTER" = "$((BEFORE + 80))" ] || { echo "   FAIL: lost increments"; exit 1; }
echo "   OK (channels → target order holds; the test detects the inverted order; no lost increment)"

replay_wait() { # $1 db → "<rejected_token>|<duplicate>|<lock timeouts>|<rows recorded while locked>|<rows after release>"
  psql "$PGURL/$1" -tAqc "SELECT outcome FROM public.google_sheets_push_accept($(PCV chx), $(PCV dx), 'RES-X', 'update', 700, 'content', now());" >/dev/null
  psql "$PGURL/$1" -tAqc "BEGIN; SELECT 1 FROM private.google_sheets_watch_channels WHERE channel_id = $(PCV chx) FOR UPDATE;
    SELECT 1 FROM private.google_sheets_watch_targets WHERE id = $(PCV target)::uuid FOR UPDATE; SELECT pg_sleep(3); COMMIT;" >/dev/null 2>&1 &
  local ph=$!; sleep 0.5
  { echo "SET lock_timeout = '1s';"
    for i in $(seq 1 20); do
      echo "SELECT outcome FROM public.google_sheets_push_accept($(PCV chx), '$(printf '%064d' "$i")', 'RES-X', 'update', $((800 + i)), 'content', now());"
    done
    echo "SELECT outcome FROM public.google_sheets_push_accept($(PCV chx), $(PCV dx), 'RES-X', 'update', 700, 'content', now());"
    echo "SELECT 'recorded=' || count(*) FROM private.google_sheets_push_events e JOIN private.google_sheets_watch_channels w ON w.id = e.channel_row_id
           WHERE w.channel_id = $(PCV chx) AND NOT e.authenticated;"
  } > "$TMP/replay.sql"
  psql "$PGURL/$1" -tAq -f "$TMP/replay.sql" > "$TMP/replay.out" 2>&1
  wait $ph
  psql "$PGURL/$1" -tAqc "SELECT outcome FROM public.google_sheets_push_accept($(PCV chx), '$(printf '%064d' 99)', 'RES-X', 'update', 899, 'content', now());" >/dev/null
  local after; after="$(psql "$PGURL/$1" -tAqc "SELECT count(*) FROM private.google_sheets_push_events e JOIN private.google_sheets_watch_channels w
    ON w.id = e.channel_row_id WHERE w.channel_id = $(PCV chx) AND NOT e.authenticated")"
  echo "$(grep -c '^rejected_token$' "$TMP/replay.out" || true)|$(grep -c '^duplicate$' "$TMP/replay.out" || true)|$(grep -c 'lock timeout' "$TMP/replay.out" || true)|$(sed -n 's/^recorded=//p' "$TMP/replay.out")|$after"
}
echo; echo "== 4i. rejected requests and redeliveries never wait for genuine traffic =="
fresh_pc "$DB_PC" "$PUSH"; OUT="$(replay_wait "$DB_PC")"; echo "   rejected|duplicate|lock timeouts|recorded while locked|after release: $OUT"
[ "$OUT" = "20|1|0|0|1" ] || { echo "   FAIL: expected '20|1|0|0|1'"; exit 1; }
sed 's/WHERE w.channel_id = p_channel_id; -- push_accept:unlocked-auth/WHERE w.channel_id = p_channel_id FOR UPDATE; -- negative control/' "$PUSH" > "$TMP/push_lockauth.sql"
grep -q "FOR UPDATE; -- negative control" "$TMP/push_lockauth.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
fresh_pc "$DB_PCN" "$TMP/push_lockauth.sql"; OUT="$(replay_wait "$DB_PCN")"; echo "   negative control (authenticate under FOR UPDATE): $OUT"
[ "$(echo "$OUT" | cut -d'|' -f3)" -ge 1 ] || { echo "   FAIL: negative control did not reproduce the wait"; exit 1; }
echo "   OK (no lock, no wait, no row while genuine traffic holds the rows; one sampled row afterwards; the test detects lock-first authentication)"

echo; echo "== 4d. non-destructive shutdown (exact supabase/ops files) =="
build "$DB_SD" "$MIG"
psql "$PGURL/$DB_SD" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
INSERT INTO public.organizations (id, name) VALUES ('a0000000-0000-0000-0000-0000000000d0', 'Org SD');
INSERT INTO public.profiles (id, organization_id, role) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d0', 'Agent'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000d0', 'Agent');
CREATE TABLE public.sd (name text PRIMARY KEY, src uuid, lease uuid, ver int, gen bigint);
DO $$
DECLARE u uuid := 'd0000000-0000-0000-0000-000000000001'; o uuid := 'a0000000-0000-0000-0000-0000000000d0';
        g bigint; s record; a record; c record; l uuid; i int;
BEGIN
  SELECT r.auth_generation INTO g FROM public.google_sheets_store_connection(u, o, 0, 'sub-sd', 'sd@example.test', '{}', 'rt-sd') r;
  PERFORM public.google_sheets_store_connection('d0000000-0000-0000-0000-000000000002', o, 0, 'sub-sd2', 'sd2@example.test', '{}', 'rt-sd2');
  FOR i IN 1..2 LOOP
    SELECT * INTO s FROM public.google_sheets_save_source(u, o, NULL, NULL, jsonb_build_object('spreadsheet_id','SPREADSHEET_SHUTDOWN',
      'sheet_id', i, 'display_name', 'sd' || i, 'identity_mode','source_id','id_header','Lead ID','mapping','{}'::jsonb));
    SELECT * INTO a FROM public.google_sheets_activate(u, o, s.source_id, s.config_version, g, '[]', 0);
    l := gen_random_uuid();
    SELECT * INTO c FROM public.google_sheets_claim(l, 1, s.source_id, u, o);
    INSERT INTO public.sd VALUES ('S' || i, s.source_id, l, c.config_version, c.auth_generation);
  END LOOP;
END $$;
SQL
SD_LEAD() { echo "jsonb_build_array(jsonb_build_object('k','id:$1','n',2,'f','f-$1','lead',jsonb_build_object('first_name','$1','last_name','Shutdown','phone','$2')))"; }
# W: an invocation that is ALREADY RUNNING (batch 1 commits, then it reads Google for a while, then continues)
psql "$PGURL/$DB_SD" -qtA > "$TMP/sd_w.out" 2>&1 <<SQL &
SET ROLE service_role;
SELECT 'batch1=' || (public.google_sheets_ingest(src, lease, ver, gen, $(SD_LEAD W1 5559100001), '[]')->>'imported') FROM public.sd WHERE name = 'S1';
SELECT pg_sleep(3);
SELECT 'batch2=' || (public.google_sheets_ingest(src, lease, ver, gen, $(SD_LEAD W2 5559100002), '[]')->>'imported') FROM public.sd WHERE name = 'S1';
SELECT 'finish=' || public.google_sheets_finish(src, lease, ver, gen, 'schedule', '{"health":"ok","imported":2}') FROM public.sd WHERE name = 'S1';
SQL
PW=$!
sleep 0.4
# H holds the Sheets duplicate lock so that W2's RPC is EXECUTING (waiting inside ingest) when admission closes
psql "$PGURL/$DB_SD" -qtAc "SELECT pg_advisory_lock(hashtextextended('google_sheets_dup:a0000000-0000-0000-0000-0000000000d0:*', 0)); SELECT pg_sleep(4);" >/dev/null 2>&1 &
PH=$!
sleep 0.4
psql "$PGURL/$DB_SD" -qtA > "$TMP/sd_w2.out" 2>&1 <<SQL &
SET ROLE service_role;
SELECT 'inflight=' || (public.google_sheets_ingest(src, lease, ver, gen, $(SD_LEAD F1 5559100003), '[]')->>'imported') FROM public.sd WHERE name = 'S2';
SQL
PW2=$!
sleep 0.6
INFLIGHT_AT_CLOSE="$(psql "$PGURL/$DB_SD" -qtAc "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock' AND query LIKE '%google_sheets_ingest%' AND query LIKE '%inflight=%'")"
psql "$PGURL/$DB_SD" -v ON_ERROR_STOP=1 -q -f "$OPS/google_sheets_unschedule.sql" >/dev/null 2>&1
psql "$PGURL/$DB_SD" -v ON_ERROR_STOP=1 -q -f "$OPS/google_sheets_admission_close.sql" >/dev/null 2>&1
CLAIM="$(psql "$PGURL/$DB_SD" -qtAc "SET ROLE service_role; SELECT count(*) FROM public.google_sheets_claim(gen_random_uuid(), 10);" 2>&1 || true)"
DISC="$(psql "$PGURL/$DB_SD" -qtAc "SET ROLE service_role; SELECT public.google_sheets_disconnect('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000d0'); SELECT 'disconnected';" 2>&1 || true)"
wait $PW $PH $PW2 || true
echo "   running invocation: $(tr '\n' ' ' < "$TMP/sd_w.out" | sed 's/ERROR:  permission denied for function \(google_sheets_[a-z_]*\)/denied(\1)/g')"
echo "   in-flight RPC:      executing at close: $INFLIGHT_AT_CLOSE; result: $(tr '\n' ' ' < "$TMP/sd_w2.out")"
echo "   new admission:      $(echo "$CLAIM" | sed 's/.*ERROR:  permission denied for function \(google_sheets_[a-z_]*\).*/denied(\1)/')"
grep -q "^batch1=1" "$TMP/sd_w.out" && grep -q "permission denied for function google_sheets_ingest" "$TMP/sd_w.out" \
  && grep -q "permission denied for function google_sheets_finish" "$TMP/sd_w.out" && ! grep -q "^batch2=" "$TMP/sd_w.out" \
  || { echo "   FAIL: the running invocation was not blocked at its next call"; exit 1; }
[ "$INFLIGHT_AT_CLOSE" = 1 ] || { echo "   FAIL: the in-flight RPC was not executing when admission closed (test timing)"; exit 1; }
grep -q "^inflight=1" "$TMP/sd_w2.out" || { echo "   FAIL: the RPC already executing did not complete atomically"; exit 1; }
echo "$CLAIM" | grep -q "permission denied for function google_sheets_claim" || { echo "   FAIL: new admission not refused"; exit 1; }
echo "$DISC" | grep -q "disconnected" || { echo "   FAIL: disconnect must stay available"; exit 1; }
DRAIN1="$(psql "$PGURL/$DB_SD" -qtA -F '|' -f "$OPS/google_sheets_drain_check.sql")"
sleep 2
psql "$PGURL/$DB_SD" -qtAc "SET ROLE service_role; SELECT public.google_sheets_ingest(src, lease, ver, gen, '[]', '[]') FROM public.sd WHERE name = 'S2';" >/dev/null 2>&1 || true
DRAIN2="$(psql "$PGURL/$DB_SD" -qtA -F '|' -f "$OPS/google_sheets_drain_check.sql")"
echo "   drain check: wrappers_executable=$(echo "$DRAIN1" | cut -d'|' -f2) active_backends=$(echo "$DRAIN1" | cut -d'|' -f3) receipts=$(echo "$DRAIN1" | cut -d'|' -f6) sheets_leads=$(echo "$DRAIN1" | cut -d'|' -f8) unexpired_leases(informational)=$(echo "$DRAIN1" | cut -d'|' -f15)"
[ "$(echo "$DRAIN1" | cut -d'|' -f2)" = 0 ] && [ "$(echo "$DRAIN1" | cut -d'|' -f3)" = 0 ] || { echo "   BLOCKED: admission open or a Sheets RPC still active"; exit 1; }
# Columns 2-14 must not move (column 1 is the read time; column 15, unexpired leases, is informational and may fall as
# leases expire, which proves nothing either way) — the same comparison release-package.md §5 step 5 prescribes.
[ "$(echo "$DRAIN1" | cut -d'|' -f2-14,16-20)" = "$(echo "$DRAIN2" | cut -d'|' -f2-14,16-20)" ] || { echo "   BLOCKED: markers moved between drain reads"; echo "$DRAIN1"; echo "$DRAIN2"; exit 1; }
# column 16 = queued push-maintenance requests (NULL here: the plain harness has no pg_net; the cron check covers it)
case "$(echo "$DRAIN1" | cut -d'|' -f16)" in ""|0) ;; *) echo "   BLOCKED: push maintenance requests queued"; exit 1 ;; esac
[ "$(echo "$DRAIN1" | awk -F'|' '{print NF}')" = 21 ] || { echo "   BLOCKED: drain check is missing the push columns"; exit 1; }
psql "$PGURL/$DB_SD" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null || { echo "   FAIL: data or intent not preserved"; exit 1; }
DO $$ BEGIN
  IF (SELECT count(*) FROM public.leads WHERE first_name IN ('W1','F1')) <> 2 OR EXISTS (SELECT 1 FROM public.leads WHERE first_name = 'W2') THEN
    RAISE EXCEPTION 'leads: committed work kept, blocked batch absent'; END IF;
  IF (SELECT count(*) FROM private.google_sheets_receipts WHERE receipt_key IN ('id:W1','id:F1')) <> 2 THEN RAISE EXCEPTION 'receipts'; END IF;
  IF EXISTS (SELECT 1 FROM public.google_sheets_sources WHERE state <> 'enabled' OR health <> 'ok') THEN RAISE EXCEPTION 'source intent changed'; END IF;
END $$;
SQL
echo "   OK (blocked at next call; in-flight RPC completed; admission refused; disconnect kept; markers stable)"
psql "$PGURL/$DB_SD" -v ON_ERROR_STOP=1 -q -f "$OPS/google_sheets_admission_open.sql" >/dev/null 2>&1
psql "$PGURL/$DB_SD" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null || { echo "   FAIL: reopen"; exit 1; }
DO $$
DECLARE fn regprocedure; l uuid := gen_random_uuid(); c record; res jsonb;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
             WHERE ns.nspname IN ('public','private') AND p.proname LIKE 'google\_sheets\_%' LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE')
       OR has_function_privilege('public', fn, 'EXECUTE') THEN RAISE EXCEPTION 'ACL widened: %', fn; END IF;
    IF has_function_privilege('service_role', fn, 'EXECUTE') <>
       ((SELECT ns2.nspname FROM pg_proc p2 JOIN pg_namespace ns2 ON ns2.oid = p2.pronamespace WHERE p2.oid = fn) = 'public') THEN
      RAISE EXCEPTION 'ACL not restored: %', fn; END IF;
  END LOOP;
  -- the interrupted lease expires (simulated), the source resumes, and receipts prevent any replay
  UPDATE public.google_sheets_sources s SET lease_expires_at = now() - interval '1 second' FROM public.sd d WHERE d.name = 'S1' AND s.id = d.src;
  SET LOCAL ROLE service_role;
  SELECT * INTO c FROM public.google_sheets_claim(l, 1, (SELECT src FROM public.sd WHERE name = 'S1'),
    'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d0');
  res := public.google_sheets_ingest(c.source_id, l, c.config_version, c.auth_generation, jsonb_build_array(
    jsonb_build_object('k','id:W1','n',2,'f','f-W1','lead',jsonb_build_object('first_name','W1','last_name','Shutdown','phone','5559100001')),
    jsonb_build_object('k','id:W2','n',3,'f','f-W2','lead',jsonb_build_object('first_name','W2','last_name','Shutdown','phone','5559100002'))), '[]');
  IF res->'rows'->0->>'o' <> 'already' OR (res->>'imported')::int <> 1 THEN RAISE EXCEPTION 'resume: %', res; END IF;
  IF public.google_sheets_finish(c.source_id, l, c.config_version, c.auth_generation, 'schedule', '{"health":"ok","imported":1}') <> 'completed' THEN
    RAISE EXCEPTION 'resume finish'; END IF;
END $$;
SQL
echo "   OK (reopen restores the exact ACL; the source resumes after lease expiry with no replay)"

echo; echo "== 5. rollback + re-apply (push first, then the foundation) =="
build "$DB_RB" "$MIG"
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$PUSH_ROLLBACK" >/dev/null 2>&1 || { echo "   FAIL: push rollback"; exit 1; }
RB="$(psql "$PGURL/$DB_RB" -tAc "SELECT md5(pg_get_functiondef('private.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)'::regprocedure)) || '|' || (SELECT count(*) FROM pg_proc WHERE proname LIKE 'google\_sheets\_%') || '|' || (SELECT count(*) FROM pg_class WHERE relname LIKE 'google\_sheets\_watch\_%' OR relname LIKE 'google\_sheets\_push\_%') || '|' || (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'google_sheets_sync_runs_trigger_check')")"
[ "$RB" = "f1cf66bea7de1d469e2ff03c57f1a414|52|0|CHECK ((trigger = ANY (ARRAY['schedule'::text, 'manual'::text, 'activation'::text])))" ] || { echo "   FAIL: push rollback state: $RB"; exit 1; }
echo "   OK (push rollback: exact finish preimage, 52 functions, no push relations, 3-value CHECK)"
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" >/dev/null 2>&1
LEFT=$(psql "$PGURL/$DB_RB" -tAc "SELECT count(*) FROM pg_proc WHERE proname LIKE 'google\_sheets\_%'")
TBL=$(psql "$PGURL/$DB_RB" -tAc "SELECT count(*) FROM pg_class WHERE relname LIKE 'google\_sheets\_%' AND relkind = 'r'")
[ "$LEFT" = 0 ] && [ "$TBL" = 0 ] || { echo "   FAIL: objects remain ($LEFT functions, $TBL tables)"; exit 1; }
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$PUSH" >/dev/null || { echo "   FAIL: push re-apply"; exit 1; }
echo "   OK (objects removed, preimage restored, both migrations re-apply cleanly)"

echo; echo "== 5b. mapping v2: typed catalog (M1) =="
build "$DB_V2" "$MIG"
psql "$PGURL/$DB_V2" -v ON_ERROR_STOP=1 -q -f "$PROD_HELPERS" >/dev/null
psql "$PGURL/$DB_V2" -v ON_ERROR_STOP=1 -v state_parity="$(cat "$STATE_PARITY")" -f "$V2_SUITE" > "$TMP/v2.out" 2>&1 \
  || { grep -E "PASS|FAIL|ERROR" "$TMP/v2.out" | sed 's/^.*NOTICE:  /   /'; echo "   FAIL: M1 suite"; exit 1; }
grep -E "PASS" "$TMP/v2.out" | sed 's/^.*NOTICE:  /   /'
grep -q "ALL GOOGLE SHEETS MAPPING V2 SQL TESTS PASSED" "$TMP/v2.out" || { echo "   FAIL: M1 suite incomplete"; exit 1; }
psql "$PGURL/$DB_V2" -1 -v ON_ERROR_STOP=1 -q -f "$CTX_ROLLBACK" >/dev/null 2>&1 || { echo "   FAIL: M1 rollback"; exit 1; }
OUT="$(psql "$PGURL/$DB_V2" -tAc "SELECT md5(prosrc) || '|' || (public.google_sheets_context('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a') ? 'catalog_version')::text || '|' || array_to_string(proacl, ' ') FROM pg_proc WHERE oid = 'private.google_sheets_context(uuid, uuid)'::regprocedure")"
[ "$OUT" = "2aa8978ceafb8f5079317474f98d4dad|false|postgres=X/postgres" ] || { echo "   FAIL: M1 rollback state: $OUT"; exit 1; }
psql "$PGURL/$DB_V2" -1 -v ON_ERROR_STOP=1 -q -f "$CTX" >/dev/null || { echo "   FAIL: M1 re-apply"; exit 1; }
echo "   OK (M1 rollback restores the exact foundation body and ACL; M1 re-applies cleanly)"
sed '0,/LANGUAGE plpgsql STABLE SECURITY DEFINER/s//LANGUAGE plpgsql STABLE SECURITY DEFINER -- tampered/' "$MIG" > "$TMP/mig_ctx_tampered.sql"
psql "$PGURL/postgres" -qc "CREATE DATABASE ${DB_V2}_tp;"
psql "$PGURL/${DB_V2}_tp" -v ON_ERROR_STOP=1 -q -f "$HARNESS" >/dev/null 2>&1
psql "$PGURL/${DB_V2}_tp" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1
psql "$PGURL/${DB_V2}_tp" -1 -v ON_ERROR_STOP=1 -q -f "$PUSH" >/dev/null 2>&1
psql "$PGURL/${DB_V2}_tp" -qc "CREATE OR REPLACE FUNCTION private.google_sheets_context(p_user uuid, p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp' AS \$x\$ SELECT '{}'::jsonb \$x\$;" >/dev/null
if psql "$PGURL/${DB_V2}_tp" -1 -v ON_ERROR_STOP=1 -q -f "$CTX" >/dev/null 2>&1; then echo "   FAIL: M1 applied over a changed context body"; exit 1; fi
psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS ${DB_V2}_tp WITH (FORCE);" >/dev/null 2>&1
echo "   OK (M1 refuses to replace a context body that is not the foundation's)"
psql "$PGURL/$DB_V2" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null || { echo "   FAIL: v2 → v1 ops fixture"; exit 1; }
DO $$
DECLARE g bigint; s record;
BEGIN
  SELECT auth_generation INTO g FROM public.google_sheets_store_connection('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
    0, 'sub-v2', 'v2@example.test', ARRAY['openid','email','https://www.googleapis.com/auth/drive.file'], 'rt-v2');
  SELECT * INTO s FROM public.google_sheets_save_source('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', NULL, NULL,
    jsonb_build_object('spreadsheet_id', 'SPREADSHEET_V2V1', 'sheet_id', 0, 'display_name', 'v2', 'mapping',
      '{"v":2,"columns":[{"header":"Phone","target":"phone"},{"header":"Name","target":"full_name"}],"ignored":["Address"]}'::jsonb));
  SELECT * INTO s FROM public.google_sheets_save_source('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', NULL, NULL,
    jsonb_build_object('spreadsheet_id', 'SPREADSHEET_V2V1', 'sheet_id', 1, 'display_name', 'v1', 'mapping',
      '{"v":1,"columns":[{"header":"Phone","target":"phone"},{"header":"Name","target":"full_name"}]}'::jsonb));
END $$;
SQL
if psql "$PGURL/$DB_V2" -1 -v ON_ERROR_STOP=1 -q -v confirm='' -f "$OPS/google_sheets_mapping_v2_to_v1.sql" >/dev/null 2>&1; then echo "   FAIL: v2 → v1 ran without confirmation"; exit 1; fi
psql "$PGURL/$DB_V2" -1 -v ON_ERROR_STOP=1 -q -v confirm='DOWNGRADE-V2-MAPPINGS' -f "$OPS/google_sheets_mapping_v2_to_v1.sql" >/dev/null 2>&1 || { echo "   FAIL: v2 → v1 ops"; exit 1; }
OUT="$(psql "$PGURL/$DB_V2" -tAc "SELECT string_agg(sheet_id || ':' || (mapping->>'v') || ':' || (mapping->'columns')::text || ':' || (mapping ? 'ignored')::text || ':' || config_version, ' ' ORDER BY sheet_id) FROM public.google_sheets_sources WHERE spreadsheet_id = 'SPREADSHEET_V2V1'")"
[ "$OUT" = '0:1:[{"header": "Phone", "target": "phone"}, {"header": "Name", "target": "full_name"}]:false:2 1:1:[{"header": "Phone", "target": "phone"}, {"header": "Name", "target": "full_name"}]:false:1' ] \
  || { echo "   FAIL: v2 → v1 result: $OUT"; exit 1; }
echo "   OK (v2 → v1 ops aid: refused without confirmation; same columns, ignored dropped, version bumped; v1 sources untouched)"

echo; echo "== 5c. standard lead fields (M2) =="
build_std "$DB_SLF"
if psql "$PGURL/$DB_SLF" -1 -v ON_ERROR_STOP=1 -q -f "$STD" >/dev/null 2>&1; then echo "   FAIL: M2 re-applied"; exit 1; fi
psql "$PGURL/$DB_SLF" -v ON_ERROR_STOP=1 -f "$STD_SUITE" > "$TMP/slf.out" 2>&1 \
  || { grep -E "PASS|FAIL|ERROR" "$TMP/slf.out" | sed 's/^.*NOTICE:  /   /'; echo "   FAIL: M2 suite"; exit 1; }
grep -E "PASS" "$TMP/slf.out" | sed 's/^.*NOTICE:  /   /'
grep -q "ALL STANDARD LEAD FIELDS SQL TESTS PASSED" "$TMP/slf.out" || { echo "   FAIL: M2 suite incomplete"; exit 1; }
# ops: the read-only report lists exactly the agencies that are not complete (B: no status row, Address/City missing; the
# suspended agency: all three missing); complete agencies (A after its conversion, D, E) are not listed
REPORT="$(psql "$PGURL/$DB_SLF" -qtA -F'|' -f "$OPS/standard_lead_fields_report.sql" 2>/dev/null | cut -d'|' -f2,4,6 | sort | tr '\n' ' ')"
[ "$REPORT" = "Org B|address|missing Org B|city|missing Org B|zip_code|agency Org Suspended|address|missing Org Suspended|city|missing Org Suspended|zip_code|missing " ] \
  || { echo "   FAIL: report: $REPORT"; exit 1; }
BEFORE="$(psql "$PGURL/$DB_SLF" -tAc "SELECT md5(string_agg(id::text || name || COALESCE(created_by::text, '-'), ',' ORDER BY id)) FROM public.custom_fields")"
if psql "$PGURL/$DB_SLF" -1 -v ON_ERROR_STOP=1 -q -v approval_ref='TEST-APPROVAL-1' \
     -v provision='["b0000000-0000-0000-0000-00000000000b"]' \
     -v convert='[{"organization_id":"a0000000-0000-0000-0000-00000000000a","field_id":"f0000000-0000-0000-0000-000000000002","snapshot":"0000000000000000000000000000000000000000000000000000000000000000"}]' \
     -f "$OPS/standard_lead_fields_apply.sql" >/dev/null 2>&1; then echo "   FAIL: apply with a refused conversion committed"; exit 1; fi
[ "$(psql "$PGURL/$DB_SLF" -tAc "SELECT md5(string_agg(id::text || name || COALESCE(created_by::text, '-'), ',' ORDER BY id)) FROM public.custom_fields")" = "$BEFORE" ] \
  || { echo "   FAIL: a failed apply changed fields"; exit 1; }
if psql "$PGURL/$DB_SLF" -1 -v ON_ERROR_STOP=1 -q -v approval_ref='' -v provision='["b0000000-0000-0000-0000-00000000000b"]' -v convert='[]' \
     -f "$OPS/standard_lead_fields_apply.sql" >/dev/null 2>&1; then echo "   FAIL: apply without an approval reference"; exit 1; fi
psql "$PGURL/$DB_SLF" -1 -v ON_ERROR_STOP=1 -q -v approval_ref='TEST-APPROVAL-2' -v provision='["b0000000-0000-0000-0000-00000000000b"]' -v convert='[]' \
  -f "$OPS/standard_lead_fields_apply.sql" >/dev/null 2>&1 || { echo "   FAIL: approved apply"; exit 1; }
OUT="$(psql "$PGURL/$DB_SLF" -tAc "SELECT string_agg(name || ':' || (created_by IS NULL)::text, ',' ORDER BY lower(name)) || '|' || (SELECT status FROM private.standard_lead_field_provisioning WHERE organization_id = 'b0000000-0000-0000-0000-00000000000b') FROM public.custom_fields WHERE organization_id = 'b0000000-0000-0000-0000-00000000000b' AND private.custom_field_norm(name) IN ('address','city','zip code')")"
[ "$OUT" = "Address:true,City:true,Zip Code:true|complete" ] || { echo "   FAIL: approved apply result: $OUT"; exit 1; }
echo "   OK (ops: report lists exactly the incomplete agencies; a refused entry rolls back the whole run; approval reference required; approved provisioning completes agency B and keeps its \"Zip Code\")"
psql "$PGURL/$DB_SLF" -1 -v ON_ERROR_STOP=1 -q -f "$STD_ROLLBACK" >/dev/null 2>&1 || { echo "   FAIL: M2 rollback"; exit 1; }
OUT="$(psql "$PGURL/$DB_SLF" -tAc "SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname IN ('provision_standard_lead_fields','custom_field_make_agency_wide','standard_lead_field_catalog','standard_lead_field_state','standard_lead_fields_on_org_created','standard_lead_fields_authority','custom_field_scope_snapshot','custom_field_convert_to_agency')) || '|' || (SELECT count(*) FROM pg_trigger WHERE tgname = 'on_organization_created_seed_standard_lead_fields') || '|' || (SELECT count(*) FROM private.custom_field_scope_changes) || '|' || (SELECT count(*) FROM private.standard_lead_field_provisioning)")"
case "$OUT" in 0\|0\|[1-9]*\|[1-9]*) ;; *) echo "   FAIL: M2 rollback state: $OUT"; exit 1 ;; esac
psql "$PGURL/$DB_SLF" -qc "INSERT INTO public.organizations (id, name) VALUES ('f0000000-0000-0000-0000-0000000000f1', 'After rollback');" >/dev/null
[ "$(psql "$PGURL/$DB_SLF" -tAc "SELECT count(*) FROM public.custom_fields WHERE organization_id = 'f0000000-0000-0000-0000-0000000000f1'")" = 0 ] || { echo "   FAIL: seed still active after rollback"; exit 1; }
psql "$PGURL/$DB_SLF" -1 -v ON_ERROR_STOP=1 -q -f "$STD" >/dev/null 2>&1 || { echo "   FAIL: M2 re-apply over the kept tables"; exit 1; }
psql "$PGURL/$DB_SLF" -qc "INSERT INTO public.organizations (id, name) VALUES ('f0000000-0000-0000-0000-0000000000f2', 'After re-apply');" >/dev/null
[ "$(psql "$PGURL/$DB_SLF" -tAc "SELECT count(*) FROM public.custom_fields WHERE organization_id = 'f0000000-0000-0000-0000-0000000000f2' AND created_by IS NULL")" = 3 ] || { echo "   FAIL: seed after re-apply"; exit 1; }
echo "   OK (M2 rollback: trigger and functions removed, audit and status kept, fields kept; re-apply reuses the tables and seeds again)"

echo; echo "== 5d. two sessions provision one agency at once =="
slf_race() { # $1 db → "<rows> <second session's states or error>"
  psql "$PGURL/$1" -qc "ALTER TABLE public.organizations DISABLE TRIGGER on_organization_created_seed_standard_lead_fields;
    INSERT INTO public.organizations (id, name) VALUES ('f0000000-0000-0000-0000-0000000000aa', 'Race');
    ALTER TABLE public.organizations ENABLE TRIGGER on_organization_created_seed_standard_lead_fields;" >/dev/null
  psql "$PGURL/$1" -tAqc "BEGIN; SELECT private.provision_standard_lead_fields('f0000000-0000-0000-0000-0000000000aa', 'ops', NULL, false)->>'status'; SELECT pg_sleep(2); COMMIT;" > "$TMP/sa.out" 2>&1 &
  local pa=$!
  psql "$PGURL/$1" -tAqc "SELECT pg_sleep(0.5); SELECT (SELECT string_agg(e->>'state', ',') FROM jsonb_array_elements(private.provision_standard_lead_fields('f0000000-0000-0000-0000-0000000000aa', 'ops', NULL, false)->'fields') e);" > "$TMP/sb.out" 2>&1 || true
  wait $pa
  echo "$(psql "$PGURL/$1" -tAc "SELECT count(*) FROM public.custom_fields WHERE organization_id = 'f0000000-0000-0000-0000-0000000000aa'") $(grep -Eo 'exists_agency,exists_agency,exists_agency|already exists in this organization' "$TMP/sb.out" | head -1 | tr ' ' '_')"
}
build_std "$DB_SLR"
OUT="$(slf_race "$DB_SLR")"; echo "   rows, second session: $OUT"
[ "$OUT" = "3 exists_agency,exists_agency,exists_agency" ] || { echo "   FAIL: expected '3 exists_agency,exists_agency,exists_agency'"; exit 1; }
sed '/FUNCTION private.provision_standard_lead_fields(/,/^END \$\$;/ s/PERFORM pg_catalog.pg_advisory_xact_lock(/PERFORM ( -- negative control: no provisioning lock/' "$STD" > "$TMP/std_nolock.sql"
[ "$(grep -c 'negative control: no provisioning lock' "$TMP/std_nolock.sql")" = 1 ] || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
build_std "$DB_SLRN" "$TMP/std_nolock.sql"
OUT="$(slf_race "$DB_SLRN")"; echo "   negative control (provisioning lock removed): $OUT"
[ "$OUT" = "3 already_exists_in_this_organization" ] || { echo "   FAIL: negative control did not reproduce the concurrent retry error"; exit 1; }
echo "   OK (a concurrent retry waits and reports the rows; without the lock it fails on the guard — never a duplicate)"

echo; echo "== 6. PostgREST role access =="
if ! docker info >/dev/null 2>&1 || ! docker image inspect postgrest/postgrest:v12.2.3 >/dev/null 2>&1; then
  echo "   SKIPPED: Docker or postgrest/postgrest:v12.2.3 unavailable (not a pass)"
  echo; echo "ALL AVAILABLE GOOGLE SHEETS CHECKS PASSED (PostgREST check skipped)"; exit 0
fi
build_std "$DB_RS"
psql "$PGURL/$DB_RS" -v ON_ERROR_STOP=1 -q -f "$CC_FIXTURE" >/dev/null
psql "$PGURL/$DB_RS" -v ON_ERROR_STOP=1 -q -c "INSERT INTO public.profiles (id, organization_id, role) VALUES ('11111111-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000a', 'Admin');"
SECRET="local-only-test-secret-0123456789abcdefghij"
PORT=$((3600 + $$ % 300))
HOSTPART="$(printf '%s' "$PGURL" | sed -E 's#^postgres(ql)?://[^@]*@##')"
docker run -d --rm --name "$PGRST_NAME" --network host \
  -e PGRST_DB_URI="postgres://authenticator:authenticator@${HOSTPART}/${DB_RS}" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" \
  -e PGRST_SERVER_PORT="$PORT" postgrest/postgrest:v12.2.3 >/dev/null
pgrst_ready() { # PostgREST answers 503 (PGRST002) until its schema cache is loaded: wait for HTTP 200
  for _ in $(seq 1 120); do curl -sf -o /dev/null "http://127.0.0.1:$1/" && return 0; sleep 0.5; done
  echo "   FAIL: PostgREST on port $1 did not become ready"; exit 1
}
pgrst_ready "$PORT"
node "$ROOT/scripts/google_sheets_postgrest_check.mjs" "http://127.0.0.1:$PORT" "$SECRET"

echo; echo "== 7. end-to-end Review harness (real actions + engine via PostgREST; Google faked) =="
if ! command -v "$DENO_BIN" >/dev/null 2>&1; then echo "   FAIL: Deno not found (set DENO_BIN)"; exit 1; fi
build_std "$DB_E2E"
psql "$PGURL/$DB_E2E" -v ON_ERROR_STOP=1 -q -c "INSERT INTO public.organizations (id, name, status) VALUES ('a0000000-0000-0000-0000-0000000000e2', 'E2E Org', 'active');
  INSERT INTO public.profiles (id, organization_id, role, status) VALUES ('e2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000e2', 'Agent', 'Active');"
PORT2=$((PORT + 1))
docker run -d --rm --name "$PGRST_E2E" --network host \
  -e PGRST_DB_URI="postgres://authenticator:authenticator@${HOSTPART}/${DB_E2E}" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" \
  -e PGRST_SERVER_PORT="$PORT2" postgrest/postgrest:v12.2.3 >/dev/null
pgrst_ready "$PORT2"
(cd "$ROOT" && "$DENO_BIN" run --allow-net=127.0.0.1 --allow-env --allow-read ${DENO_IMPORT_MAP:+--import-map="$DENO_IMPORT_MAP"} \
  scripts/google_sheets_e2e.ts "http://127.0.0.1:$PORT2" "$SECRET")

echo; echo "== 8. end-to-end push harness (real receiver, processor, maintenance and api hooks via PostgREST; Google faked) =="
build "$DB_PE2E" "$MIG"
psql "$PGURL/$DB_PE2E" -v ON_ERROR_STOP=1 -q -c "INSERT INTO public.organizations (id, name, status) VALUES ('a0000000-0000-0000-0000-0000000000f2', 'Push E2E Org', 'active');
  INSERT INTO public.profiles (id, organization_id, role, status) VALUES ('f2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f2', 'Agent', 'Active');
  UPDATE private.google_sheets_push_config SET mode = 'on';"
PORT3=$((PORT + 2))
docker run -d --rm --name "$PGRST_PE2E" --network host \
  -e PGRST_DB_URI="postgres://authenticator:authenticator@${HOSTPART}/${DB_PE2E}" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" \
  -e PGRST_SERVER_PORT="$PORT3" postgrest/postgrest:v12.2.3 >/dev/null
pgrst_ready "$PORT3"
(cd "$ROOT" && "$DENO_BIN" run --allow-net=127.0.0.1 --allow-env --allow-read ${DENO_IMPORT_MAP:+--import-map="$DENO_IMPORT_MAP"} \
  scripts/google_sheets_push_e2e.ts "http://127.0.0.1:$PORT3" "$SECRET")

echo; echo "ALL GOOGLE SHEETS CHECKS PASSED"
