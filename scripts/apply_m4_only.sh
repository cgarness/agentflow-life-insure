#!/usr/bin/env bash
# =====================================================================================================
# Apply EXACTLY ONE reviewed migration — M4 — to the Inbound Calling v2 target project.
# =====================================================================================================
# This script performs a PRODUCTION WRITE and must only be run under an explicit, current approval.
#
#   SUPABASE_DB_URL='postgresql://…'  ./scripts/apply_m4_only.sh            # preflight + apply
#   SUPABASE_DB_URL='…' DRY_RUN=1     ./scripts/apply_m4_only.sh            # preflight ONLY, no write
#
# Why not `supabase db push`: it applies EVERY pending migration — on this branch M4, M5, M6 and M7.
# Why not `supabase migration repair --project-ref …`: that flag does not exist (verified against the
# pinned CLI 2.84.5 — repair takes --db-url / --linked / --local / --password / --status). The history
# repair therefore targets the SAME connection this script verified and applied with, via --db-url.
#
# Guarantees:
#   • the file's SHA-256 must match the reviewed hash, or the script stops before touching anything;
#   • tools and connection are checked BEFORE any write;
#   • the connection is confirmed to be the intended project by read-only fingerprint, never by printing
#     the URL or any credential;
#   • the SQL is applied in ONE transaction that aborts on the first error;
#   • the migration is recorded as applied ONLY after the SQL apply succeeded;
#   • if the SQL succeeds but the history repair fails, the script STOPS and prints the exact read-only
#     inspection + the single reconciling command. It never re-runs the SQL and never continues to M5.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_REF="jncvvsvckxhqgqvkppmj"
VERSION="20260911000100"
FILE="$ROOT/supabase/migrations/${VERSION}_inbound_agent_settings_and_registrations.sql"
EXPECTED_SHA="fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29"
CLI="$ROOT/node_modules/.bin/supabase"
DRY_RUN="${DRY_RUN:-0}"

die() { echo "STOP: $*" >&2; exit 1; }
step() { echo; echo "── $* ──"; }

# ── 0. inputs ───────────────────────────────────────────────────────────────────────────────────────
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL is not set (percent-encode the password; never echo it)."
[ -f "$FILE" ] || die "migration file not found: $FILE"

step "1/7 content hash — the applied bytes must be the reviewed bytes"
ACTUAL_SHA="$(sha256sum "$FILE" | awk '{print $1}')"
echo "   expected: $EXPECTED_SHA"
echo "   actual:   $ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "hash mismatch — this is NOT the reviewed file. Nothing was touched."

step "2/7 tooling"
command -v psql >/dev/null 2>&1 || die "psql not found on PATH."
[ -x "$CLI" ] || die "Supabase CLI not found at $CLI (run npm ci)."
echo "   psql:     $(psql --version)"
echo "   supabase: $("$CLI" --version 2>&1 | head -1)"
"$CLI" migration repair --help 2>&1 | grep -q -- '--db-url' \
  || die "this CLI's 'migration repair' has no --db-url flag; stop and re-verify the procedure."
echo "   'migration repair --db-url' supported"

step "3/7 connection reachable, and it is the INTENDED project (read-only, no credential printed)"
FP="$(psql "$SUPABASE_DB_URL" -Atq -v ON_ERROR_STOP=1 -c "
  select (select count(*) from cron.job where command like '%${PROJECT_REF}.supabase%')
      || '|' || coalesce((select max(version) from supabase_migrations.schema_migrations),'none')
      || '|' || (select count(*) from supabase_migrations.schema_migrations where version = '${VERSION}')
      || '|' || (to_regclass('public.agent_phone_registrations') is null)::text
      || '|' || (to_regclass('public.agent_inbound_settings') is null)::text;" 2>/dev/null)" \
  || die "cannot query the database with SUPABASE_DB_URL."
IFS='|' read -r REF_HITS HEAD ALREADY REG_ABSENT SET_ABSENT <<<"$FP"
echo "   cron jobs naming ${PROJECT_REF}: $REF_HITS"
echo "   migration history head:          $HEAD"
echo "   ${VERSION} already recorded:     $ALREADY"
echo "   M4 tables absent:                registrations=$REG_ABSENT settings=$SET_ABSENT"
[ "$REF_HITS" -ge 1 ] || die "this connection does not look like project ${PROJECT_REF} (no cron job names it)."
[ "$ALREADY" = "0" ] || die "${VERSION} is ALREADY in the migration history — nothing to do."
[ "$REG_ABSENT" = "true" ] && [ "$SET_ABSENT" = "true" ] || die "an M4 table already exists — stop and inspect before writing."

step "4/7 preflight complete"
if [ "$DRY_RUN" = "1" ]; then echo "   DRY_RUN=1 — no write performed. Re-run without DRY_RUN to apply."; exit 0; fi

step "5/7 applying M4 ONLY, in one transaction, aborting on the first error"
if ! psql "$SUPABASE_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$FILE"; then
  echo
  die "the SQL apply FAILED and the transaction rolled back. Nothing was recorded in the migration
     history (step 6 was never reached). Inspect read-only, fix, then re-run this script from the top."
fi
echo "   SQL applied and committed."

step "6/7 recording ${VERSION} in the migration history (same connection)"
if ! "$CLI" migration repair --status applied "$VERSION" --db-url "$SUPABASE_DB_URL"; then
  cat >&2 <<MSG

STOP: the SQL APPLIED SUCCESSFULLY but the history repair FAILED.

  Do NOT re-run this script (it would re-run the SQL) and do NOT continue to M5.
  The schema now contains M4; only the history row is missing.

  1. Confirm read-only that the apply really landed and the history row is really absent:

     psql "\$SUPABASE_DB_URL" -c "
       select to_regclass('public.agent_inbound_settings')    as settings_tbl,
              to_regclass('public.agent_phone_registrations') as registrations_tbl,
              (select count(*) from supabase_migrations.schema_migrations
                where version = '$VERSION')                   as history_rows;"

  2. Only if settings_tbl and registrations_tbl are non-null AND history_rows = 0, reconcile the
     MISSING HISTORY OPERATION ALONE:

     $CLI migration repair --status applied $VERSION --db-url "\$SUPABASE_DB_URL"

  3. Then run step 7 of this script's verification block manually (RELEASE_READINESS.md §2.2).
MSG
  exit 1
fi

step "7/7 post-apply verification"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify_m4_applied.sql" || die "verification query failed."
echo
echo "M4 APPLIED AND VERIFIED on ${PROJECT_REF}. M5, M6 and M7 remain unapplied and separately approved."
