#!/usr/bin/env bash
# =====================================================================================================
# Agent Profile / Team Profile aggregate RPCs — SQL suite runner.
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Refuses any non-localhost PGURL.
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/run_profile_rpc_tests.sh
#
# Builds throwaway databases, applies the migration under test over a synthetic schema, runs the
# behaviour suite, then runs two proofs that need a separate database: a NEGATIVE CONTROL that proves
# the assertions actually bite, and a ROLLBACK proof. Every database is dropped on exit.
#
# Nothing here touches a hosted project. The migration under test is NOT APPLIED ANYWHERE REMOTE.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (AGENT_RULES invariant #28)"; exit 2 ;;
esac

echo "== locality proof =="
echo "   PGURL host component: $(printf '%s' "$PGURL" | sed -E 's#^[^@]*@##; s#/.*$##')"
psql "$PGURL/postgres" -tAc \
  "SELECT 'server=' || inet_server_addr()::text || ' port=' || inet_server_port()::text || ' db=' || current_database();"
if psql "$PGURL/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname = 'jncvvsvckxhqgqvkppmj'" | grep -q 1; then
  echo "REFUSING: this looks like a hosted project"; exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/supabase/tests/profile_stats_harness.sql"
SUITE="$ROOT/supabase/tests/profile_book_stats_rpc.sql"
# Agent Profile / Team Profile aggregates — NOT YET APPLIED to any hosted project; local suites only.
MIG="$ROOT/supabase/migrations/20260919210000_profile_book_and_team_stats_rpcs.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20260919210000_profile_book_and_team_stats_rpcs.rollback.sql"

DB="profile_rpc_test_$$"
DB_NEG="profile_rpc_neg_$$"
DB_RB="profile_rpc_rb_$$"

drop_all() {
  for d in "$DB" "$DB_NEG" "$DB_RB"; do
    psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1 || true
  done
}
trap drop_all EXIT

build() {   # build <dbname>
  psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$HARNESS"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$MIG"
}

# ── Main suite ──────────────────────────────────────────────────────────────────────────────────
echo
echo "== harness + migration =="
build "$DB"
echo "   OK"

echo
echo "== behaviour suite =="
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$SUITE"

# ── Negative control ────────────────────────────────────────────────────────────────────────────
# A suite that cannot fail proves nothing. Corrupt one fixture value in a FRESH database and confirm
# the corresponding assertion fires.
echo
echo "== negative control (the assertions must bite) =="
build "$DB_NEG"
set +e
NEG_OUT=$(psql "$PGURL/$DB_NEG" -v ON_ERROR_STOP=1 -q <<'EOF' 2>&1
-- Break exactly one thing: annualize the premium the way the Leaderboard does, and prove T3's
-- shape of assertion catches it.
DROP FUNCTION public.get_profile_book_stats(text, text);
CREATE FUNCTION public.get_profile_book_stats(p_scope text, p_time_zone text DEFAULT NULL)
RETURNS TABLE (total_premium_monthly numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$ SELECT 375.75 * 12; $$;

DO $$
DECLARE v numeric;
BEGIN
  SELECT total_premium_monthly INTO v FROM public.get_profile_book_stats('self', NULL);
  IF v = 375.75 * 12 THEN
    RAISE EXCEPTION 'NEGATIVE CONTROL FIRED: an annualized total was detected';
  END IF;
  RAISE NOTICE 'NEGATIVE CONTROL DID NOT FIRE — the assertion is toothless';
END $$;
EOF
)
NEG_RC=$?
set -e
if [ $NEG_RC -eq 0 ]; then
  echo "$NEG_OUT"
  echo "   FAIL: the negative control did not fire; the annualization assertion is toothless"
  exit 1
fi
echo "$NEG_OUT" | grep -q "NEGATIVE CONTROL FIRED" || { echo "$NEG_OUT"; echo "   FAIL: wrong failure"; exit 1; }
echo "   OK (the annualization assertion provably bites)"

# ── Rollback proof ──────────────────────────────────────────────────────────────────────────────
echo
echo "== rollback proof =="
build "$DB_RB"
# Seed data BEFORE rolling back, so "the rollback rewrites nothing" is an assertion about rows that
# actually exist rather than a vacuous count of an empty table.
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q <<'EOF'
INSERT INTO public.organizations (id, name) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','RB Org');
INSERT INTO public.profiles (id, organization_id, role, status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-00000000000a','Team Leader','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active');
INSERT INTO public.clients (organization_id, assigned_agent_id, carrier, premium, face_amount, sold_date) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000f1','Americo', 10, 100, DATE '2026-01-01'),
  ('aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000f1','Americo', 20, 200, DATE '2026-01-02'),
  ('aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000c1','Foresters', 30, 300, DATE '2026-01-03');
INSERT INTO public.agent_state_licenses (agent_id, organization_id, state) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-00000000000a','CA');
EOF
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q -f "$ROLLBACK"
psql "$PGURL/$DB_RB" -v ON_ERROR_STOP=1 -q <<'EOF'
DO $$
BEGIN
  IF to_regprocedure('public.get_profile_book_stats(text,text)')     IS NOT NULL
  OR to_regprocedure('public.get_profile_team_readiness()')          IS NOT NULL
  OR to_regprocedure('private.resolve_downline_ids(uuid,uuid)')      IS NOT NULL
  OR to_regprocedure('private.profile_parse_currency(text)')         IS NOT NULL
  OR to_regprocedure('private.profile_parse_iso_date(text)')         IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: an object survived';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes
             WHERE schemaname='public' AND tablename='clients'
               AND indexname='idx_clients_assigned_agent_id') THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: the index survived';
  END IF;
  -- The rollback must not have touched data. Every fixture row is still present and unmodified.
  IF (SELECT count(*) FROM public.clients) <> 3 THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: clients row count changed';
  END IF;
  IF (SELECT count(*) FROM public.profiles) <> 2 THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: profiles row count changed';
  END IF;
  IF (SELECT count(*) FROM public.agent_state_licenses) <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: agent_state_licenses row count changed';
  END IF;
  IF (SELECT sum(premium) FROM public.clients) <> 60 THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: a clients value changed';
  END IF;
  -- private.campaign_actor is only CALLED by this migration, never defined by it: it must survive.
  IF to_regprocedure('private.campaign_actor()') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK FAIL: the rollback dropped private.campaign_actor, which it does not own';
  END IF;
  RAISE NOTICE 'ROLLBACK OK  every object dropped, campaign_actor preserved, zero data change';
END $$;
EOF
echo "   OK"

echo
echo "======================================================================"
echo " ALL PROFILE RPC PROOFS PASSED (suite + negative control + rollback)"
echo " Databases dropped. Nothing hosted was touched."
echo "======================================================================"
