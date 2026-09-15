#!/usr/bin/env bash
# =====================================================================================================
# Inbound Calling v2 — generated-types verification against a COMPLETE ISOLATED schema (local only).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:54329" ./scripts/verify_inbound_generated_types.sh
#
# Builds a throwaway database from inbound_harness.sql + M1–M3 + inbound_v2_harness.sql + M4–M7, generates
# TypeScript types from it with @supabase/postgres-meta at the exact version the pinned Supabase CLI
# ships (the CLI's `gen types --db-url` runs the same generator inside Docker), and type-checks that
# src/integrations/supabase/types.ts is STRUCTURALLY IDENTICAL to the generated output for every object
# M4–M7 create or alter: the four new tables (Row/Insert/Update/Relationships), the added columns on
# `calls` and `inbound_routing_settings`, and every v2 function's Args/Returns.
# Never points at a hosted database (AGENT_RULES invariant #28); production migration application is
# NOT the type-generation test.
set -euo pipefail

PGURL="${PGURL:?set PGURL to a LOCAL postgres, e.g. postgresql://postgres@127.0.0.1:54329}"
case "$PGURL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "REFUSING: PGURL must be localhost (invariant #28)"; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGMETA_VERSION="${PGMETA_VERSION:-0.96.1}"   # supabase CLI 2.84.5 pins supabase/postgres-meta:v0.96.1
PORT="${PGMETA_PORT:-18537}"
DB="inbound_types_check_$$"
WORK="$(mktemp -d)"
trap 'kill "${META_PID:-0}" 2>/dev/null || true; psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB;"; rm -rf "$WORK"' EXIT

psql "$PGURL/postgres" -qc "CREATE DATABASE $DB;"
for f in \
  "$ROOT/supabase/tests/inbound_harness.sql" \
  "$ROOT/supabase/migrations/20260823222528_inbound_identity_foundation.sql" \
  "$ROOT/supabase/migrations/20260823222805_inbound_claim_lifecycle.sql" \
  "$ROOT/supabase/migrations/20260823222926_recording_source_sid.sql" \
  "$ROOT/supabase/tests/inbound_v2_harness.sql" \
  "$ROOT/supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql" \
  "$ROOT/supabase/migrations/20260915025931_inbound_routing_v2_settings.sql" \
  "$ROOT/supabase/migrations/20260915035141_inbound_route_attempts_d13_and_recovery.sql" \
  "$ROOT/supabase/migrations/20260915035142_inbound_voicemails.sql"; do
  # A harness/migration that fails to apply ABORTS the check: a half-built schema must never be reported
  # as OK or as a types.ts mismatch. psql's own exit status decides; NOTICE chatter is shown only on failure.
  if ! psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -q -f "$f" > "$WORK/apply.log" 2>&1; then
    grep -v "^psql:.*NOTICE:" "$WORK/apply.log" || true
    echo "FAILED to apply $f"; exit 1
  fi
done
echo "== isolated schema built ($DB)"

echo "== installing @supabase/postgres-meta@$PGMETA_VERSION (scratch dir)"
( cd "$WORK" && npm init -y >/dev/null && npm i --no-audit --no-fund --silent "@supabase/postgres-meta@$PGMETA_VERSION" )
PG_META_DB_URL="$PGURL/$DB" PG_META_PORT="$PORT" PG_META_HOST=127.0.0.1 \
  node "$WORK/node_modules/@supabase/postgres-meta/dist/server/server.js" > "$WORK/server.log" 2>&1 &
META_PID=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "http://127.0.0.1:$PORT/generators/typescript?included_schemas=public&detect_one_to_one_relationships=true" \
  -o "$WORK/generated-types.ts"
[ -s "$WORK/generated-types.ts" ] || { echo "type generation produced no output"; cat "$WORK/server.log"; exit 1; }
echo "== generated $(wc -l < "$WORK/generated-types.ts") lines of types from the isolated schema"

cp "$ROOT/src/integrations/supabase/types.ts" "$WORK/repo-types.ts"
node "$ROOT/scripts/verify_inbound_generated_types/emit_check.mjs" > "$WORK/check.ts"
if ( cd "$ROOT" && npx tsc --noEmit --strict --skipLibCheck --moduleResolution bundler --module esnext --target es2020 "$WORK/check.ts" ); then
  echo "== OK: src/integrations/supabase/types.ts matches the generated types for every M4–M7 object"
else
  echo "== MISMATCH: see the Check<...> names above (generated vs repo); regenerate the listed blocks"
  exit 1
fi
