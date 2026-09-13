#!/usr/bin/env bash
# =====================================================================================================
# ALTERNATIVE (direct-connection) procedure for applying EXACTLY ONE reviewed migration — M4.
# =====================================================================================================
# The PRIMARY release path is the explicitly targeted MCP procedure in RELEASE_READINESS.md §2.0, which
# names the project id in the call itself. This script exists for an operator who has a direct database
# connection; it is NOT the path this session can execute.
#
#   SUPABASE_DB_URL='postgresql://…'  ./scripts/apply_m4_only.sh          # preflight + apply
#   SUPABASE_DB_URL='…' DRY_RUN=1     ./scripts/apply_m4_only.sh          # preflight ONLY, no write
#
# Why not `supabase db push`: it applies EVERY pending migration — on this branch M4, M5, M6 and M7.
# Why not `supabase migration repair --project-ref …`: that flag does not exist (verified against the
# pinned CLI 2.84.5 — repair takes --db-url / --linked / --local / --password / --status). The history
# repair therefore targets the SAME connection this script verified and applied with, via --db-url.
#
# Guarantees:
#   • the file's SHA-256 must match the reviewed hash, or the script stops before touching anything;
#   • the TARGET is bound to the project by the CONNECTION ITSELF — the Supabase-issued hostname or
#     pooler username — and corroborated against independently verified project facts. Row content that
#     merely mentions the ref (a cron command, for instance) is printed as supporting evidence and is
#     never sufficient on its own: another database can hold the same text. An unparseable or
#     non-Supabase target is treated as AMBIGUOUS and rejected before any write;
#   • the SQL is applied in ONE transaction that aborts on the first error;
#   • the migration is recorded as applied ONLY after the SQL apply succeeded;
#   • a FAILED OR CUT-OFF invocation is never reported as a confirmed rollback. Any non-zero exit from
#     the apply or the repair stops the script and reconciles the real state read-only
#     (NEITHER / SCHEMA_ONLY / BOTH / PARTIAL) before anything else is suggested. The script never
#     replays SQL automatically, never writes a history row by hand, never switches apply mechanism
#     mid-operation, and never continues to M5.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_REF="jncvvsvckxhqgqvkppmj"
VERSION="20260911000100"
FILE="$ROOT/supabase/migrations/${VERSION}_inbound_agent_settings_and_registrations.sql"
EXPECTED_SHA="fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29"
CLI="${SUPABASE_CLI:-$ROOT/node_modules/.bin/supabase}"
PSQL="${PSQL_BIN:-psql}"
DRY_RUN="${DRY_RUN:-0}"
# Independently verified facts about this project (read-only inspection, RELEASE_READINESS.md §1).
EXPECTED_PG_MAJOR="17"
EXPECTED_HISTORY_HEAD="20260823222926"

die() { echo "STOP: $*" >&2; exit 1; }
step() { echo; echo "── $* ──"; }

# ── target binding ──────────────────────────────────────────────────────────────────────────────────
# Derives the project ref from the connection string alone. Prints only the host and the derived ref —
# never the userinfo, never the password.
derive_ref() {
  local url="$1" rest userinfo hostport host user
  rest="${url#*://}"
  case "$rest" in
    *@*) userinfo="${rest%@*}"; hostport="${rest##*@}" ;;
    *)   userinfo=""; hostport="$rest" ;;
  esac
  hostport="${hostport%%/*}"; hostport="${hostport%%\?*}"
  host="${hostport%%:*}"
  host="${host#[}"; host="${host%]}"
  user="${userinfo%%:*}"
  DERIVED_HOST="$host"
  case "$host" in
    db.*.supabase.co)                       # direct connection: db.<ref>.supabase.co
      DERIVED_REF="${host#db.}"; DERIVED_REF="${DERIVED_REF%.supabase.co}"
      DERIVED_FROM="direct hostname db.<ref>.supabase.co" ;;
    *.pooler.supabase.com)                  # pooler: ref lives in the username, postgres.<ref>
      case "$user" in
        *.*) DERIVED_REF="${user##*.}"; DERIVED_FROM="pooler username <role>.<ref>" ;;
        *)   DERIVED_REF=""; DERIVED_FROM="pooler host but the username carries no project ref" ;;
      esac ;;
    *) DERIVED_REF=""; DERIVED_FROM="not a Supabase-issued hostname" ;;
  esac
  # a project ref is a run of lowercase alphanumerics; anything else came from a lookalike hostname
  case "$DERIVED_REF" in
    ''|*[!a-z0-9]*)
      if [ -n "$DERIVED_REF" ]; then
        DERIVED_FROM="$DERIVED_FROM (the segment '$DERIVED_REF' is not shaped like a project ref)"
        DERIVED_REF=""
      fi ;;
  esac
  if [ -n "$DERIVED_REF" ] && [ "${#DERIVED_REF}" -lt 15 ]; then
    DERIVED_FROM="$DERIVED_FROM (the segment '$DERIVED_REF' is too short to be a project ref)"
    DERIVED_REF=""
  fi
}

# ── read-only reconciliation after ANY uncertain outcome ────────────────────────────────────────────
# A failed or cut-off psql invocation does NOT establish that the transaction rolled back, and a failed
# repair response does NOT establish that the history row is absent. Both are answered by looking — and
# by being honest about what looking can and cannot settle. Under PostgreSQL's default READ COMMITTED
# isolation a statement sees only what was committed before it began, so an apply that is STILL RUNNING
# in another session is invisible to this read and commits afterwards:
#   https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED
# `NEITHER` after an uncertain outcome therefore means ONLY "no committed M4 state observed at this
# read", and this script never turns that into permission to write again.
classify() {   # $1 = preflight | recovery ; prints the single classifier row on stdout
  # pipefail is on, so a psql failure still propagates through the tail
  "$PSQL" "$SUPABASE_DB_URL" -Atq -v ON_ERROR_STOP=1 \
      -c "SET m4.mode = '$1'" -f "$ROOT/scripts/verify_m4_state.sql" 2>&1 | tail -1
}
reconcile_and_stop() {
  local what="$1"; shift
  echo >&2
  echo "STOP: ${what} did not return success. THE OUTCOME IS NOT KNOWN from that alone —" >&2
  echo "      a connection can drop after the server committed, and an operation that is still" >&2
  echo "      running is invisible to any read taken now. Reconciling read-only…" >&2
  echo >&2
  local row rc
  row="$(classify recovery)"; rc=$?
  if [ $rc -ne 0 ]; then
    cat >&2 <<MSG
  The read-only reconciliation ALSO failed:

$row

  The state of the target is UNKNOWN. Do not re-run this script, do not write a history row, do not
  switch to another apply mechanism, and do not continue to M5. Restore database access, then run
  ONLY this, read-only, and act on its 'next_action' column:

     $PSQL "\$SUPABASE_DB_URL" -c "SET m4.mode = 'recovery'" -f scripts/verify_m4_state.sql
MSG
    exit 2
  fi
  local state action
  state="$(printf '%s' "$row" | cut -d'|' -f1)"
  action="$(printf '%s' "$row" | cut -d'|' -f3)"
  echo "  read-only classification: $row" >&2
  echo >&2
  case "$action" in
    OUTCOME_UNRESOLVED_DO_NOT_REPLAY)
      cat >&2 <<MSG
  NO COMMITTED M4 STATE WAS OBSERVED AT THIS READ. That is NOT the same as "the apply did not land".

  Under READ COMMITTED this read cannot see an apply that is still running in another session; that
  apply can commit a moment from now. The outcome is UNRESOLVED.

  DO NOT re-run this script and DO NOT submit the migration again. Replaying is permitted only once the
  ORIGINAL operation is authoritatively known to have ended WITHOUT committing — for example:

     • the server returned a definitive SQLSTATE for that statement (a PostgreSQL error, not a
       connection reset, timeout, proxy 5xx or lost response), or
     • the backend that ran it is provably gone AND no prepared transaction holds its work
       (this classification reports other_open_transactions / backends_naming_m4_objects /
       prepared_xacts — those can only ever show that something IS in flight).

  NEITHER elapsed time NOR a repeated empty read establishes that. If you cannot establish it, stop
  here and report the outcome as UNRESOLVED to the approver. Do not continue to M5.
MSG
      exit 3 ;;
    RECONCILE_HISTORY_ONLY)
      cat >&2 <<MSG
  The SCHEMA COMMITTED but no M4 history row is present. Do NOT re-run this script — it would re-run
  the SQL. Do NOT insert a history row by hand.

  If the operation that just failed was the HISTORY REPAIR, first establish by the same standard as
  above that it is not still in flight. Not because a duplicate row could result — `version` is the
  PRIMARY KEY of supabase_migrations.schema_migrations, so a second repair at the SAME version cannot
  duplicate it — but because issuing any write while the outcome of the previous one is unresolved is
  exactly what this procedure forbids, and a repair racing the first can fail on that key against a
  target that is in fact already correct, which reads like a problem and is not one. (The duplicate
  hazard is real for the APPLY, not the repair: a second apply is assigned a NEW version and would
  leave two M4-named rows — the classifier's `ambiguous_history` / PARTIAL case.)
  Once established, reconcile the MISSING HISTORY OPERATION ALONE, then verify:

     $CLI migration repair --status applied $VERSION --db-url "\$SUPABASE_DB_URL"
     $PSQL "\$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify_m4_schema.sql
     $PSQL "\$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify_m4_history.sql

  If that repair also fails, classify again before doing anything else. Do not continue to M5.
MSG
      exit 1 ;;
    COMPLETE_VERIFY_AND_STOP)
      cat >&2 <<MSG
  BOTH the schema and an unambiguous M4 history row are present: the write LANDED despite the failed
  response. Nothing further is to be written. Confirm the contracts and stop:

     $PSQL "\$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify_m4_schema.sql
     $PSQL "\$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify_m4_history.sql

  Do not continue to M5. That is a separate migration under a separate approval.
MSG
      exit 1 ;;
    *)
      cat >&2 <<MSG
  PARTIAL / UNEXPECTED state ($state). Some objects present, duplicate history rows, or conflicting
  migration identities. Do NOT write anything: not the SQL, not a history row. Do not continue to M5.
  Hand the classification line above to the reviewer and investigate the target read-only.
MSG
      exit 2 ;;
  esac
}

# ── 0. inputs ───────────────────────────────────────────────────────────────────────────────────────
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL is not set (percent-encode the password; never echo it)."
[ -f "$FILE" ] || die "migration file not found: $FILE"

step "1/8 content hash — the applied bytes must be the reviewed bytes"
ACTUAL_SHA="$(sha256sum "$FILE" | awk '{print $1}')"
echo "   expected: $EXPECTED_SHA"
echo "   actual:   $ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "hash mismatch — this is NOT the reviewed file. Nothing was touched."

step "2/8 tooling"
command -v "$PSQL" >/dev/null 2>&1 || die "psql not found on PATH."
[ -x "$CLI" ] || die "Supabase CLI not found at $CLI (run npm ci)."
echo "   psql:     $("$PSQL" --version)"
echo "   supabase: $("$CLI" --version 2>&1 | head -1)"
"$CLI" migration repair --help 2>&1 | grep -q -- '--db-url' \
  || die "this CLI's 'migration repair' has no --db-url flag; stop and re-verify the procedure."
echo "   'migration repair --db-url' supported"

step "3/8 TARGET BINDING — the connection itself must name project ${PROJECT_REF}"
derive_ref "$SUPABASE_DB_URL"
echo "   host:        ${DERIVED_HOST:-(none)}"
echo "   derived ref: ${DERIVED_REF:-(none)}   [$DERIVED_FROM]"
[ -n "$DERIVED_REF" ] \
  || die "AMBIGUOUS TARGET — no project ref can be derived from this connection ($DERIVED_FROM).
     Use the Supabase-issued connection string for ${PROJECT_REF} (db.${PROJECT_REF}.supabase.co, or a
     pooler host with username postgres.${PROJECT_REF}). Refusing to write to an unidentified database."
[ "$DERIVED_REF" = "$PROJECT_REF" ] \
  || die "WRONG TARGET — this connection belongs to project '${DERIVED_REF}', not '${PROJECT_REF}'.
     Nothing was touched."
echo "   target bound to ${PROJECT_REF} by the connection string"

step "4/8 corroboration against independently verified project facts (read-only)"
FP="$("$PSQL" "$SUPABASE_DB_URL" -Atq -v ON_ERROR_STOP=1 -c "
  select current_setting('server_version_num')
      || '|' || coalesce((select max(version) from supabase_migrations.schema_migrations),'none')
      || '|' || (select count(*) from supabase_migrations.schema_migrations where version = '${VERSION}')
      || '|' || (to_regclass('public.agent_phone_registrations') is null)::text
      || '|' || (to_regclass('public.agent_inbound_settings') is null)::text
      || '|' || (select count(*) from cron.job where command like '%${PROJECT_REF}.supabase%');" 2>/dev/null)" \
  || die "cannot query the database with SUPABASE_DB_URL."
IFS='|' read -r PGNUM HEAD ALREADY REG_ABSENT SET_ABSENT REF_HITS <<<"$FP"
PG_MAJOR="$(( PGNUM / 10000 ))"
echo "   PostgreSQL major:                $PG_MAJOR (expected $EXPECTED_PG_MAJOR)"
echo "   migration history head:          $HEAD (expected $EXPECTED_HISTORY_HEAD)"
echo "   ${VERSION} already recorded:     $ALREADY"
echo "   M4 tables absent:                registrations=$REG_ABSENT settings=$SET_ABSENT"
echo "   cron jobs mentioning the ref:    $REF_HITS   ← supporting evidence only, NOT proof of identity"
[ "$PG_MAJOR" = "$EXPECTED_PG_MAJOR" ] \
  || die "server is PostgreSQL $PG_MAJOR but ${PROJECT_REF} was inspected as $EXPECTED_PG_MAJOR.
     The target does not match the verified environment. Nothing was touched."
[ "$HEAD" = "$EXPECTED_HISTORY_HEAD" ] \
  || die "migration history head is '$HEAD' but the verified head for ${PROJECT_REF} is
     '$EXPECTED_HISTORY_HEAD'. Either this is a different database or migrations were applied since the
     inspection. Re-inspect and re-approve. Nothing was touched."
PRE_ROW="$(classify preflight)" || die "the preflight classification query failed."
PRE_ACTION="$(printf '%s' "$PRE_ROW" | cut -d'|' -f3)"
echo "   preflight classification:        $PRE_ROW"
[ "$PRE_ACTION" = "PROCEED_WITH_APPLY" ] \
  || die "the target is not clean (next_action = $PRE_ACTION). M4 objects or an M4 history row are
     already present, or the history is ambiguous. Stop and inspect; do not write."

step "5/8 baseline of the objects M4 must not touch (compare against the after-image in step 8)"
"$PSQL" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify_m4_untouched.sql" \
  | tee "${TMPDIR:-/tmp}/m4_untouched_before.txt" || die "baseline query failed."

step "6/8 preflight complete"
if [ "$DRY_RUN" = "1" ]; then echo "   DRY_RUN=1 — no write performed. Re-run without DRY_RUN to apply."; exit 0; fi

step "7/8 applying M4 ONLY, in one transaction, aborting on the first error"
"$PSQL" "$SUPABASE_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$FILE" \
  || reconcile_and_stop "the SQL apply"
echo "   psql reported success."

step "8/8 recording ${VERSION} in the migration history (same connection)"
"$CLI" migration repair --status applied "$VERSION" --db-url "$SUPABASE_DB_URL" \
  || reconcile_and_stop "the migration-history repair"

step "verification — machine checked, read only"
"$PSQL" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify_m4_schema.sql"  || die "SCHEMA CONTRACT NOT VERIFIED (see the failure above). Do not proceed to M5."
"$PSQL" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify_m4_history.sql" || die "HISTORY CONTRACT NOT VERIFIED (see the failure above). Do not proceed to M5."
"$PSQL" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify_m4_untouched.sql" \
  | tee "${TMPDIR:-/tmp}/m4_untouched_after.txt" >/dev/null || die "after-image query failed."
diff -u "${TMPDIR:-/tmp}/m4_untouched_before.txt" "${TMPDIR:-/tmp}/m4_untouched_after.txt" \
  || die "a pre-existing table CHANGED (diff above). Investigate before anything else."
echo "   pre-existing tables unchanged."
echo
echo "M4 APPLIED AND VERIFIED on ${PROJECT_REF} — both contracts asserted, not merely printed."
echo "M5, M6 and M7 remain unapplied and separately approved."
echo "NOTE: an empty public.agent_phone_registrations makes the hosted cross-organization read"
echo "      INCONCLUSIVE. Isolation is proven on the disposable database (supabase/tests, R7/R9/R10);"
echo "      do not seed production rows to make the hosted check look meaningful."
