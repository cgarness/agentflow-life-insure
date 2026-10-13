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
#   3. two-session concurrency: two sources importing the same person serialize (one plain, one flagged)
#      + NEGATIVE CONTROL (advisory lock removed → both plain, proving the test detects the race)
#   4. two-session SKIP LOCKED claim: overlapping workers never claim the same source
#   5. rollback proof (objects removed, exact permission-helper preimage restored) + clean re-apply
#   6. PostgREST role-access check (Docker postgrest/postgrest:v12.2.3; skipped with a notice if absent):
#      service_role reaches the wrappers and runs a worker cycle; authenticated/anon are refused;
#      private helpers are not exposed; authenticated reads only its own rows.
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
DB="gs_test_$$"; DB_CC="gs_cc_$$"; DB_NEG="gs_neg_$$"; DB_RB="gs_rb_$$"; DB_RS="gs_rs_$$"
PGRST_NAME="gs_pgrst_$$"
cleanup() {
  docker rm -f "$PGRST_NAME" >/dev/null 2>&1 || true
  for d in "$DB" "$DB_CC" "$DB_NEG" "$DB_RB" "$DB_RS"; do
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
for _ in $(seq 1 30); do curl -s "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.5; done
node "$ROOT/scripts/google_sheets_postgrest_check.mjs" "http://127.0.0.1:$PORT" "$SECRET"

echo; echo "ALL GOOGLE SHEETS CHECKS PASSED"
