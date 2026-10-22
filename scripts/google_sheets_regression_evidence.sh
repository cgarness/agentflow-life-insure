#!/usr/bin/env bash
# =====================================================================================================
# Google Sheets — REGRESSION EVIDENCE for the PR #442 review (LOCAL ONLY).
# Runs the same REGRESSION / CONTROL tests against the reviewed head (default 8b675e5, in a temporary git
# worktree) and against this working tree. A REGRESSION must FAIL on the reviewed head and PASS here; a CONTROL
# must pass on both. Only behaviour present in both versions is exercised (Deno: planRows / planSourceId /
# runSource / pickerToken / preview with fakes, run with --no-check because type shapes changed; SQL: a signature
# adapter with assertions on database state; two-session races: each version's own finish signature).
# Usage: PGURL=postgresql://postgres@127.0.0.1:54329 DENO_BIN=deno ./scripts/google_sheets_regression_evidence.sh [reviewed-sha]
# =====================================================================================================
set -euo pipefail
PGURL="${PGURL:?set PGURL to a LOCAL postgres}"
case "$PGURL" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSING: PGURL must be localhost"; exit 2 ;; esac
REVIEWED="${1:-8b675e5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DENO_BIN="${DENO_BIN:-deno}"
TMP="$(mktemp -d)"; OLD="$TMP/reviewed"
foundation_file() {
  # The reviewed historical tree predates the release-only filename re-stamp.
  case "$1" in
    "$OLD") printf '%s\n' "$OLD/supabase/migrations/20261013120000_google_sheets_import_foundation.sql" ;;
    "$ROOT") printf '%s\n' "$ROOT/supabase/migrations/20261022062539_google_sheets_import_foundation.sql" ;;
    *) return 2 ;;
  esac
}
DBS=()
cleanup() {
  git -C "$ROOT" worktree remove --force "$OLD" >/dev/null 2>&1 || true
  for d in "${DBS[@]}"; do psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $d WITH (FORCE);" >/dev/null 2>&1 || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT
git -C "$ROOT" worktree add --detach "$OLD" "$REVIEWED" >/dev/null 2>&1
echo "reviewed head: $(git -C "$OLD" rev-parse HEAD)   candidate: $(git -C "$ROOT" rev-parse HEAD) + working tree"

# ---------------------------------------------------------------- Deno
cp "$ROOT/supabase/functions/_shared/googleSheets/regressions.test.ts" "$OLD/supabase/functions/_shared/googleSheets/"
cp "$ROOT/supabase/functions/google-sheets-api/actions.test.ts" "$OLD/supabase/functions/google-sheets-api/"
deno_run() {
  (cd "$1/supabase/functions" && "$DENO_BIN" test --no-check --allow-env ${DENO_IMPORT_MAP:+--import-map="$DENO_IMPORT_MAP"} \
     _shared/googleSheets/regressions.test.ts google-sheets-api/actions.test.ts 2>&1 || true) \
    | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^(REGRESSION|CONTROL).* \.\.\. (ok|FAILED)" \
    | sed -E 's/^(.*) \.\.\. (ok|FAILED).*$/\1|\2/' | sed 's/|ok$/|PASS/; s/|FAILED$/|FAIL/'
}
deno_run "$OLD" > "$TMP/deno_old.txt"; deno_run "$ROOT" > "$TMP/deno_new.txt"

# ---------------------------------------------------------------- SQL regression cases
sql_run() { # $1 db $2 tree
  DBS+=("$1")
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $1 WITH (FORCE);" >/dev/null 2>&1; psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$2/supabase/tests/google_sheets_harness.sql" >/dev/null 2>&1
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$(foundation_file "$2")" >/dev/null 2>&1
  (psql "$PGURL/$1" -f "$ROOT/supabase/tests/google_sheets_regressions.sql" 2>&1 || true) | grep -E "(PASS|FAIL) (REGRESSION|CONTROL)" \
    | sed -E 's/^.*NOTICE:  (PASS|FAIL) (REGRESSION|CONTROL) ([^:]*):.*$/\2 SQL \3|\1/'
}
sql_run "gs_ev_old_$$" "$OLD" > "$TMP/sql_old.txt"; sql_run "gs_ev_new_$$" "$ROOT" > "$TMP/sql_new.txt"

# ---------------------------------------------------------------- two-session races (each version's own finish)
race_db() { # $1 db $2 tree
  DBS+=("$1")
  psql "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $1 WITH (FORCE);" >/dev/null 2>&1; psql "$PGURL/postgres" -qc "CREATE DATABASE $1;"
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$2/supabase/tests/google_sheets_harness.sql" >/dev/null 2>&1
  psql "$PGURL/$1" -1 -v ON_ERROR_STOP=1 -q -f "$(foundation_file "$2")" >/dev/null 2>&1
  psql "$PGURL/$1" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/google_sheets_finish_fixture.sql" >/dev/null
}
finish_sql() { # $1 db $2 result-json → each version's own signature
  if [ "$(psql "$PGURL/$1" -tAc "SELECT to_regprocedure('public.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)') IS NOT NULL")" = t ]; then
    echo "SELECT public.google_sheets_finish(f.src, f.lease, f.ver, f.gen, 'schedule', '$2') FROM public.fx f;"
  else
    echo "SELECT public.google_sheets_finish(f.src, f.lease, f.ver, 'schedule', '$2') FROM public.fx f;"
  fi
}
race_reconnect() { # → PASS when the stale finish wrote nothing
  local q; q="$(finish_sql "$1" '{"health":"access_lost","error_code":"stale"}')"
  psql "$PGURL/$1" -tAqc "BEGIN; SELECT r.outcome FROM public.fx f, public.google_sheets_store_connection(f.uid, f.oid, (SELECT auth_generation FROM public.google_sheets_connections WHERE id = f.cid), 'sub-fx', 'fx@example.test', '{}', 'rt-fx-2') r; SELECT pg_sleep(2); COMMIT;" >/dev/null &
  local pa=$!; sleep 0.5
  local o; o="$(psql "$PGURL/$1" -tAqc "$q")"; wait $pa
  local h; h="$(psql "$PGURL/$1" -tAqc "SELECT health FROM public.google_sheets_sources s JOIN public.fx f ON f.src = s.id")"
  [ "$h" = ok ] && echo "PASS ($o, health $h)" || echo "FAIL ($o, health $h)"
}
race_expiry() { # → PASS when a lease that expired during the lock wait wrote nothing
  local q; q="$(finish_sql "$1" '{"health":"ok","imported":1}')"
  psql "$PGURL/$1" -qc "UPDATE public.google_sheets_sources s SET lease_expires_at = clock_timestamp() + interval '1 second' FROM public.fx f WHERE s.id = f.src;"
  psql "$PGURL/$1" -tAqc "BEGIN; SELECT 1 FROM public.google_sheets_sources s JOIN public.fx f ON f.src = s.id FOR UPDATE OF s; SELECT pg_sleep(2); COMMIT;" >/dev/null &
  local pa=$!; sleep 0.3
  local o; o="$(psql "$PGURL/$1" -tAqc "$q")"; wait $pa
  local w; w="$(psql "$PGURL/$1" -tAqc "SELECT last_success_at IS NOT NULL FROM public.google_sheets_sources s JOIN public.fx f ON f.src = s.id")"
  [ "$w" = f ] && echo "PASS ($o, success written: $w)" || echo "FAIL ($o, success written: $w)"
}
for v in old new; do
  tree="$OLD"; [ "$v" = new ] && tree="$ROOT"
  race_db "gs_ev_r1${v}_$$" "$tree"; r1="$(race_reconnect "gs_ev_r1${v}_$$")"
  race_db "gs_ev_r2${v}_$$" "$tree"; r2="$(race_expiry "gs_ev_r2${v}_$$")"
  printf 'REGRESSION 2-session: finish racing a reconnect writes nothing|%s\nREGRESSION 2-session: lease expiring during the finish lock wait writes nothing|%s\n' \
    "${r1%% *}" "${r2%% *}" > "$TMP/race_$v.txt"
  printf '%s\n%s\n' "$r1" "$r2" > "$TMP/race_${v}_detail.txt"
done

# ---------------------------------------------------------------- report
cat "$TMP/deno_old.txt" "$TMP/sql_old.txt" "$TMP/race_old.txt" > "$TMP/old.txt"
cat "$TMP/deno_new.txt" "$TMP/sql_new.txt" "$TMP/race_new.txt" > "$TMP/new.txt"
echo; printf '%-6s | %-8s | %-9s | %s\n' "kind" "reviewed" "candidate" "test"
bad=0
while IFS='|' read -r name newres; do
  oldres="$(grep -F "$name|" "$TMP/old.txt" | head -1 | cut -d'|' -f2)"; oldres="${oldres:-ABSENT}"
  kind="${name%% *}"
  if [ "$kind" = REGRESSION ]; then { [ "$oldres" = FAIL ] && [ "$newres" = PASS ]; } || bad=$((bad + 1))
  else { [ "$oldres" = PASS ] && [ "$newres" = PASS ]; } || bad=$((bad + 1)); fi
  printf '%-6s | %-8s | %-9s | %s\n' "${kind:0:6}" "$oldres" "$newres" "${name#* }"
done < "$TMP/new.txt"
echo; echo "two-session details (reviewed): $(tr '\n' ';' < "$TMP/race_old_detail.txt")"
echo "two-session details (candidate): $(tr '\n' ';' < "$TMP/race_new_detail.txt")"
echo; [ "$bad" = 0 ] && echo "EVIDENCE OK: every REGRESSION fails on $REVIEWED and passes on the candidate; every CONTROL passes on both" \
  || { echo "EVIDENCE PROBLEM: $bad test(s) did not behave as required"; exit 1; }
