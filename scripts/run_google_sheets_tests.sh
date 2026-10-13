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
MIG="$ROOT/supabase/migrations/20261013120000_google_sheets_import_foundation.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20261013120000_google_sheets_import_foundation.rollback.sql"
TMP="$(mktemp -d)"
DB="gs_test_$$"; DB_CC="gs_cc_$$"; DB_NEG="gs_neg_$$"; DB_RB="gs_rb_$$"; DB_RS="gs_rs_$$"; DB_RG="gs_rg_$$"
DB_FR="gs_fr_$$"; DB_FRN="gs_frn_$$"; DB_LX="gs_lx_$$"; DB_LXN="gs_lxn_$$"; DB_E2E="gs_e2e_$$"; DB_SD="gs_sd_$$"
OPS="$ROOT/supabase/ops"
PGRST_E2E="gs_pgrst_e2e_$$"
DENO_BIN="${DENO_BIN:-deno}"
REG="$ROOT/supabase/tests/google_sheets_regressions.sql"
PGRST_NAME="gs_pgrst_$$"
cleanup() {
  docker rm -f "$PGRST_NAME" "$PGRST_E2E" >/dev/null 2>&1 || true
  for d in "$DB" "$DB_CC" "$DB_NEG" "$DB_RB" "$DB_RS" "$DB_RG" "$DB_FR" "$DB_FRN" "$DB_LX" "$DB_LXN" "$DB_E2E" "$DB_SD"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d WITH (FORCE);" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

build() { # $1 db, $2 migration file
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$HARNESS" >/dev/null 2>&1
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$2" >/dev/null 2>&1
}

echo "== 1. harness + migration =="
build "$DB" "$MIG"; echo "   OK"
if psql "$PGURL/$DB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1; then echo "   FAIL: re-applied"; exit 1; fi
echo "   replay guard OK (second apply refused)"

echo; echo "== 2. behaviour suite =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f "$SUITE" 2>&1 | grep -E "PASS|FAIL|ERROR|PASSED" | sed 's/^.*NOTICE:  /   /'

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
sed 's/ FOR SHARE; -- finish:connection-lock/; -- finish:connection-lock REMOVED (negative control)/' "$MIG" > "$TMP/mig_nofinishlock.sql"
grep -q "finish:connection-lock REMOVED" "$TMP/mig_nofinishlock.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
build "$DB_FRN" "$TMP/mig_nofinishlock.sql"; psql "$PGURL/$DB_FRN" -v ON_ERROR_STOP=1 -q -f "$FX_FIXTURE" >/dev/null
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
sed 's/  v_now := clock_timestamp();/  v_now := now(); -- negative control/' "$MIG" > "$TMP/mig_nowclock.sql"
grep -q "v_now := now(); -- negative control" "$TMP/mig_nowclock.sql" || { echo "   FAIL: negative-control patch did not apply"; exit 1; }
build "$DB_LXN" "$TMP/mig_nowclock.sql"; psql "$PGURL/$DB_LXN" -v ON_ERROR_STOP=1 -q -f "$FX_FIXTURE" >/dev/null
OUT="$(race_expiry "$DB_LXN")"; echo "   negative control (transaction-start now()): $OUT"
[ "$OUT" = "completed" ] || { echo "   FAIL: negative control did not reproduce the stale-clock acceptance"; exit 1; }
echo "   OK (expiry is evaluated on the real clock after the lock wait)"

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
[ "$(echo "$DRAIN1" | cut -d'|' -f2-)" = "$(echo "$DRAIN2" | cut -d'|' -f2-)" ] || { echo "   BLOCKED: markers moved between drain reads"; echo "$DRAIN1"; echo "$DRAIN2"; exit 1; }
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

echo; echo "== 5. rollback + re-apply =="
build "$DB_RB" "$MIG"
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$ROLLBACK" >/dev/null 2>&1
LEFT=$(psql "$PGURL/$DB_RB" -tAc "SELECT count(*) FROM pg_proc WHERE proname LIKE 'google\_sheets\_%'")
TBL=$(psql "$PGURL/$DB_RB" -tAc "SELECT count(*) FROM pg_class WHERE relname LIKE 'google\_sheets\_%' AND relkind = 'r'")
[ "$LEFT" = 0 ] && [ "$TBL" = 0 ] || { echo "   FAIL: objects remain ($LEFT functions, $TBL tables)"; exit 1; }
psql "$PGURL/$DB_RB" -1 -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1
echo "   OK (objects removed, preimage restored, migration re-applies cleanly)"

echo; echo "== 6. PostgREST role access =="
if ! docker info >/dev/null 2>&1 || ! docker image inspect postgrest/postgrest:v12.2.3 >/dev/null 2>&1; then
  echo "   SKIPPED: Docker or postgrest/postgrest:v12.2.3 unavailable (not a pass)"
  echo; echo "ALL AVAILABLE GOOGLE SHEETS CHECKS PASSED (PostgREST check skipped)"; exit 0
fi
build "$DB_RS" "$MIG"
psql "$PGURL/$DB_RS" -v ON_ERROR_STOP=1 -q -f "$CC_FIXTURE" >/dev/null
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
build "$DB_E2E" "$MIG"
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

echo; echo "ALL GOOGLE SHEETS CHECKS PASSED"
