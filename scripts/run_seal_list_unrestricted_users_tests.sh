#!/usr/bin/env bash
# =====================================================================================================
# D0 — seal public.list_unrestricted_users(): SQL proof runner.
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Refuses any non-loopback PGURL or server.
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:55448" ./scripts/run_seal_list_unrestricted_users_tests.sh
#
# PGURL must be exactly postgres(ql)://postgres[:password]@<127.0.0.1|localhost>:<port> (no database, query, extra
# host or percent-encoding), and the server must accept the connection on a loopback address. The role must be the
# bootstrap superuser "postgres", because the fixture reproduces production's owner and ACL. The URL is never printed.
#
# The script creates and drops only its own databases (seal_d0_<pid>_*). Loading the fixture also creates the
# cluster-global NOLOGIN roles anon, authenticated and service_role if this throwaway server lacks them; they are not
# dropped. Every scenario starts from a fresh clone of a template that reproduces the production preimage exactly;
# S5 and the S7 re-apply deliberately reuse the database they just sealed. Migration and rollback runs capture the
# exit status, stdout and stderr separately (never through a pipe); expected failures are asserted, not ignored.
#
# Scenarios (implementation_plan.md, 2026-10-18 D0): S0–S14, N1, N2.
# Database-role verification only. It proves nothing about PostgREST, the browser, or a PostgreSQL major version
# other than the one it runs against. The migration under test is NOT applied to production.
set -euo pipefail
set +o xtrace   # commands carry the URL, which may hold a password: never trace them

PGURL="${PGURL:?set PGURL to a LOCAL postgres server, e.g. postgresql://postgres@127.0.0.1:55448}"
PROD_REF="jncvvsvckxhqgqvkppmj"
SENTINEL="agentflow-d0-synthetic-fixture"
ROLLBACK_HEADER="-- Re-assert only. Not an inverse. Never re-grants EXECUTE."

refuse() { echo "REFUSING: $*" >&2; exit 2; }
fail()   { echo "   FAIL: $*" >&2; exit 1; }
# say <command...>: run an assertion and print its result. Never `echo "$(cmd)"`: errexit ignores a failed
# command substitution inside echo's arguments, which would turn a failed assertion into a printed pass.
say()    { local r; r="$("$@")" || fail "assertion command failed: $*"; echo "   $r"; }

# ── PGURL shape and libpq environment (before any connection) ───────────────────────────────────────
for v in PGHOSTADDR PGSERVICE PGSERVICEFILE; do
  [ -z "${!v:-}" ] || refuse "$v is set; it could send libpq somewhere other than the validated host"
done
unset PGHOST PGPORT PGDATABASE PGUSER PGOPTIONS
URL_RE='^postgres(ql)?://postgres(:[A-Za-z0-9._~-]*)?@(127\.0\.0\.1|localhost):[0-9]{1,5}$'
[[ "$PGURL" =~ $URL_RE ]] \
  || refuse "PGURL must be postgresql://postgres[:password]@127.0.0.1|localhost:<port> and nothing else (AGENT_RULES invariant #28)"
HOSTPORT="${PGURL##*@}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20261018023911_seal_list_unrestricted_users.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/20261018023911_seal_list_unrestricted_users.rollback.sql"
FIXTURE="$ROOT/supabase/tests/seal_list_unrestricted_users.sql"
for f in "$MIG" "$ROLLBACK" "$FIXTURE"; do [ -f "$f" ] || refuse "missing $f"; done

PFX="seal_d0_$$_"
TPL="${PFX}tpl"
WORK="$(mktemp -d)"
OUT="$WORK/stdout.txt"
ERR="$WORK/stderr.txt"
CREATED=()
RC=0
HOLDER=""

# Single-value query on a FRESH connection (every psql invocation is a new session).
q() { psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$1" -c "$2"; }

# prove_local <db> <why>: the server accepted us on loopback, we are the postgres superuser, and this is not a
# hosted or Supabase-managed database. Runs before every destructive step, fixture reset and cleanup.
prove_local() {
  local row addr usr su prodref supmig
  row="$(q "$1" "SELECT coalesce(host(inet_server_addr()), 'unix-socket') || '|' || current_user || '|' ||
                        (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)::text || '|' ||
                        EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = '$PROD_REF')::text || '|' ||
                        (to_regnamespace('supabase_migrations') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL)::text")"
  IFS='|' read -r addr usr su prodref supmig <<<"$row"
  case "$addr" in 127.0.0.1|::1|unix-socket) ;; *) refuse "server address $addr is not loopback ($2)";; esac
  [ "$usr" = postgres ] && [ "$su" = true ] || refuse "connected as $usr (superuser=$su), not the postgres superuser ($2)"
  [ "$prodref" = false ] || refuse "a database named after the production project exists on this server ($2)"
  [ "$supmig" = false ] || refuse "database $1 has Supabase-managed schemas; not a throwaway fixture ($2)"
}

# prove_synthetic <db> <why>: only a database this run created, carrying the sentinel and synthetic rows only.
prove_synthetic() {
  local marker others
  case "$1" in "$PFX"*) ;; *) refuse "database $1 was not created by this run ($2)";; esac
  prove_local "$1" "$2"
  marker="$(q "$1" "SELECT string_agg(marker, ',') FROM seal_test.synthetic_sentinel")" || refuse "no sentinel in $1 ($2)"
  [ "$marker" = "$SENTINEL" ] || refuse "database $1 lacks the synthetic sentinel ($2)"
  others="$(q "$1" "SELECT count(*) FROM public.profiles WHERE first_name NOT LIKE 'Synthetic %'")" || refuse "cannot read $1 ($2)"
  [ "$others" = 0 ] || refuse "database $1 holds non-synthetic profile rows ($2)"
}

cleanup() {
  local d left=0
  [ -z "$HOLDER" ] || wait "$HOLDER" 2>/dev/null || true
  if [ "${#CREATED[@]}" -gt 0 ]; then
    if ( prove_local postgres "cleanup" ) >/dev/null 2>&1; then
      for d in "${CREATED[@]}"; do
        case "$d" in
          "$PFX"*) psql -X -q "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1 \
                     || { echo "cleanup WARNING: could not drop $d" >&2; left=1; } ;;
        esac
      done
      [ "$left" = 1 ] || echo "cleanup: dropped the ${#CREATED[@]} database name(s) this run created"
    else
      echo "cleanup WARNING: the locality proof failed, so this run's databases were NOT dropped" >&2
    fi
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# The first connection's libpq error is withheld: it can echo the URL, password included.
psql -X -qAt "$PGURL/postgres" -c "SELECT 1" >/dev/null 2>"$WORK/connect.err" \
  || refuse "cannot connect to $HOSTPORT as postgres (libpq's message is withheld because it can echo the URL)"

# fresh <scenario>: a new database cloned from the template; sets DB.
fresh() {
  DB="${PFX}$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"   # unquoted identifiers fold to lower case
  prove_local postgres "create $DB"
  CREATED+=("$DB")
  psql -X -q -v ON_ERROR_STOP=1 "$PGURL/postgres" -c "CREATE DATABASE $DB TEMPLATE $TPL;"
  prove_synthetic "$DB" "fresh $1"
  q "$DB" "SELECT seal_test.assert_state('$1 precheck', 'open')" >/dev/null
}

# run_file_env <env-assignment or ""> <db> <file> [psql options...]: the way a migration runner would run it
# (psql -f, ON_ERROR_STOP), capturing stdout, stderr and the exit status separately.
run_file_env() {
  local envspec="$1" db="$2" file="$3"; shift 3
  prove_synthetic "$db" "run $(basename "$file")"
  set +e
  if [ -n "$envspec" ]; then
    env "$envspec" psql -X -v ON_ERROR_STOP=1 "$@" -f "$file" "$PGURL/$db" >"$OUT" 2>"$ERR"
  else
    psql -X -v ON_ERROR_STOP=1 "$@" -f "$file" "$PGURL/$db" >"$OUT" 2>"$ERR"
  fi
  RC=$?
  set -e
}
run_file() { run_file_env "" "$@"; }

expect_rc()          { [ "$RC" = "$1" ] || { cat "$OUT" "$ERR" >&2; fail "$2: exit status $RC, expected $1"; }; }
expect_stdout()      { [ "$(cat "$OUT")" = "$1" ] || { printf 'stdout was:\n%s\n' "$(cat "$OUT")" >&2; fail "$2: stdout is not exactly '$1'"; }; }
expect_stdout_has()  { grep -qF -- "$1" "$OUT" || { cat "$OUT" >&2; fail "$2: stdout lacks '$1'"; }; }
expect_stdout_lacks(){ ! grep -qF -- "$1" "$OUT" || { cat "$OUT" >&2; fail "$2: stdout has '$1'"; }; }
expect_stderr_has()  { grep -qF -- "$1" "$ERR" || { cat "$ERR" >&2; fail "$2: stderr lacks '$1'"; }; }
expect_stderr_empty(){ [ ! -s "$ERR" ] || { cat "$ERR" >&2; fail "$1: stderr is not empty"; }; }

# as_role <db> <role> <claims-json or -> <sql>: a fresh session switched to a client/system role.
as_role() {
  if [ "$3" = - ]; then
    psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$1" -c "SET ROLE $2" -c "$4"
  else
    psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$1" -c "SET request.jwt.claims = '$3'" -c "SET ROLE $2" -c "$4"
  fi
}

# Claims are set for realism only: the function reads none, so these cases prove the authenticated role, not RLS.
ADMIN_CLAIMS='{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated","app_metadata":{"role":"Admin","organization_id":"d0000000-0000-0000-0000-00000000000a"}}'
AGENT_CLAIMS='{"sub":"d0000000-0000-0000-0000-0000000000a2","role":"authenticated","app_metadata":{"role":"Agent","organization_id":"d0000000-0000-0000-0000-00000000000a"}}'

# ── Locality proof and server identity ──────────────────────────────────────────────────────────────
echo "== locality proof =="
echo "   PGURL host: $HOSTPORT (credentials not printed)"
prove_local postgres "start"
say q postgres "SELECT 'server=' || coalesce(host(inet_server_addr()), 'unix-socket') || ' port=' || inet_server_port() || ' user=' || current_user"
SERVER_VERSION="$(q postgres "SHOW server_version")"
echo "   server_version=$SERVER_VERSION"
say q postgres "SELECT version()"
echo "   psql client: $(psql --version)"

# ── Template: the exact production preimage ─────────────────────────────────────────────────────────
echo
echo "== template fixture (exact production preimage) =="
prove_local postgres "create the template and load the fixture (may create the anon/authenticated/service_role roles)"
CREATED+=("$TPL")
psql -X -q -v ON_ERROR_STOP=1 "$PGURL/postgres" -c "CREATE DATABASE $TPL;"
set +e
psql -X -q -v ON_ERROR_STOP=1 -f "$FIXTURE" "$PGURL/$TPL" >"$OUT" 2>"$ERR"
RC=$?
set -e
if [ "$RC" != 0 ]; then
  cat "$OUT" "$ERR" >&2
  fail "the template does not reproduce the production preimage; diagnose and report, never edit the preimage"
fi
prove_synthetic "$TPL" "template"
say q "$TPL" "SELECT seal_test.assert_state('template', 'open')"
say q "$TPL" "SELECT 'definition md5 (pinned search_path): ' || seal_test.fn_md5()"
say q "$TPL" "SELECT 'ACL: ' || seal_test.fn_acl()::text"

# ── S0: reproduction ────────────────────────────────────────────────────────────────────────────────
echo
echo "== S0 reproduction: before the seal, anon and authenticated read both agencies =="
fresh S0
say as_role "$DB" anon - "SELECT seal_test.expect_rows('S0 anon', 4, 2)"
say as_role "$DB" authenticated "$AGENT_CLAIMS" "SELECT seal_test.expect_rows('S0 authenticated', 4, 2)"

# ── S1–S4 (+ S9 runtime): apply the real migration ──────────────────────────────────────────────────
echo
echo "== S1–S4: apply the real migration =="
fresh S1
run_file "$DB" "$MIG"
expect_rc 0 "S1 migration"
expect_stdout "DO" "S9 runtime (complete command-tag output)"
expect_stderr_empty "S1 migration"
echo "   migration applied; complete command-tag output is exactly 'DO'; stderr empty"
say as_role "$DB" anon - "SELECT seal_test.expect_denied('S1 anon')"
say as_role "$DB" authenticated "$ADMIN_CLAIMS" "SELECT seal_test.expect_denied('S2 authenticated (Admin-shaped claims)')"
say as_role "$DB" authenticated "$AGENT_CLAIMS" "SELECT seal_test.expect_denied('S2 authenticated (Agent-shaped claims)')"
say as_role "$DB" service_role - "SELECT seal_test.expect_rows('S3 service_role', 4, 2)"
say q "$DB" "SELECT seal_test.expect_rows('S3 postgres', 4, 2)"
say q "$DB" "SELECT seal_test.assert_state('S4 fresh connection', 'sealed')"

# ── S5: replay refused ──────────────────────────────────────────────────────────────────────────────
echo
echo "== S5 replay refused (deliberately on the database S1 sealed) =="
run_file "$DB" "$MIG"
expect_rc 3 "S5 replay"
expect_stderr_has "D0 refused: preimage drift" "S5 replay"
echo "   refused with 'D0 refused: preimage drift'"
say q "$DB" "SELECT seal_test.assert_state('S5 after replay', 'sealed')"

# ── S6: drift refused ───────────────────────────────────────────────────────────────────────────────
echo
echo "== S6 drift refused =="
fresh S6_body
q "$DB" "CREATE OR REPLACE FUNCTION public.list_unrestricted_users() RETURNS SETOF public.profiles
           LANGUAGE sql SECURITY DEFINER AS \$function\$
  SELECT * FROM public.profiles WHERE true;
\$function\$" >/dev/null
DRIFT_MD5="$(q "$DB" "SELECT seal_test.fn_md5()")"
PRE_ACL="$(q "$DB" "SELECT seal_test.preimage_acl()::text")"
run_file "$DB" "$MIG"
expect_rc 3 "S6 body drift"
expect_stderr_has "D0 refused: preimage drift" "S6 body drift"
NOW_ACL="$(q "$DB" "SELECT seal_test.fn_acl()::text")"
NOW_MD5="$(q "$DB" "SELECT seal_test.fn_md5()")"
[ -n "$PRE_ACL" ] && [ "$NOW_ACL" = "$PRE_ACL" ] || fail "S6 body drift: ACL changed"
[ -n "$DRIFT_MD5" ] && [ "$NOW_MD5" = "$DRIFT_MD5" ] || fail "S6 body drift: definition changed"
echo "   body drift refused; ACL and drifted definition untouched"
fresh S6_acl
q "$DB" "GRANT EXECUTE ON FUNCTION public.list_unrestricted_users() TO pg_read_all_data" >/dev/null
DRIFT_ACL="$(q "$DB" "SELECT seal_test.fn_acl()::text")"
run_file "$DB" "$MIG"
expect_rc 3 "S6 ACL drift"
expect_stderr_has "D0 refused: preimage drift" "S6 ACL drift"
NOW_ACL="$(q "$DB" "SELECT seal_test.fn_acl()::text")"
[ -n "$DRIFT_ACL" ] && [ "$NOW_ACL" = "$DRIFT_ACL" ] || fail "S6 ACL drift: ACL changed"
echo "   ACL drift refused; drifted ACL untouched ($DRIFT_ACL)"

# ── S7: rollback keeps the seal ─────────────────────────────────────────────────────────────────────
echo
echo "== S7 rollback re-asserts the seal and never re-grants =="
[ "$(head -n1 "$ROLLBACK")" = "$ROLLBACK_HEADER" ] || fail "S7: the rollback's first line is not '$ROLLBACK_HEADER'"
echo "   rollback header is verbatim: $ROLLBACK_HEADER"
fresh S7
run_file "$DB" "$MIG";      expect_rc 0 "S7 migration"
run_file "$DB" "$ROLLBACK"; expect_rc 0 "S7 rollback"; expect_stdout "DO" "S7 rollback output"
say q "$DB" "SELECT seal_test.assert_state('S7 after rollback', 'sealed')"
say as_role "$DB" anon - "SELECT seal_test.expect_denied('S7 anon after rollback')"
run_file "$DB" "$MIG"
expect_rc 3 "S7 re-apply after rollback"
expect_stderr_has "D0 refused: preimage drift" "S7 re-apply after rollback"
echo "   re-applying the forward migration after the rollback is refused by its preimage guard (expected)"
fresh S7_open
run_file "$DB" "$ROLLBACK"; expect_rc 0 "S7 rollback on an unsealed database"
say q "$DB" "SELECT seal_test.assert_state('S7 rollback on an unsealed database seals it', 'sealed')"
fresh S7_dep
q "$DB" "CREATE VIEW seal_test.s7_dependent_view AS SELECT * FROM public.list_unrestricted_users()" >/dev/null
run_file "$DB" "$ROLLBACK"
expect_rc 3 "S7 rollback with a dependent on an unsealed database"
expect_stderr_has "D0 rollback refused: catalog objects depend on public.list_unrestricted_users()" "S7 rollback dependency refusal"
say q "$DB" "SELECT seal_test.assert_state('S7 rollback dependency refusal (fresh connection)', 'open')"

# ── S8: forced failure at the REVOKE's ddl_command_end, autocommit and --single-transaction ─────────
# The event trigger raises after the REVOKE has changed the catalog but before that statement completes, so it shows
# the change is rolled back; on its own it cannot tell a single DO from a split file (S9 and S11 cover that).
echo
echo "== S8 forced failure at the REVOKE (test-only event trigger) =="
for mode in autocommit single; do
  fresh "S8_$mode"
  ET="$(q "$DB" "SELECT coalesce(current_setting('event_triggers', true), 'unset')")"
  [ -n "$ET" ] && [ "$ET" != off ] || refuse "event triggers are disabled (event_triggers=$ET)"
  q "$DB" "CREATE EVENT TRIGGER d0_s8_fail_after_revoke ON ddl_command_end WHEN TAG IN ('REVOKE')
           EXECUTE FUNCTION seal_test.s8_fail_after_revoke()" >/dev/null
  if [ "$mode" = single ]; then run_file "$DB" "$MIG" --single-transaction; else run_file "$DB" "$MIG"; fi
  expect_rc 3 "S8 $mode"
  expect_stderr_has "S8 injected failure after REVOKE (tag REVOKE)" "S8 $mode (the event trigger must have fired)"
  say q "$DB" "SELECT seal_test.assert_state('S8 $mode fresh connection', 'open')"
  q "$DB" "DROP EVENT TRIGGER d0_s8_fail_after_revoke" >/dev/null
  [ "$(q "$DB" "SELECT count(*) FROM pg_catalog.pg_event_trigger")" = 0 ] || fail "S8 $mode: an event trigger remains"
done
echo "   event triggers dropped; none remain"

# ── S9: exactly one top-level DO containing the migration ───────────────────────────────────────────
# Specific to this migration, not a SQL parser: ASCII only, no block comments, exactly one line 'DO $seal$' and one
# later line 'END $seal$;' (case-sensitive, like PostgreSQL dollar quotes), only comment/blank lines outside them
# (so no other statement and no psql metacommand), no other dollar-quote tag inside, and no transaction control
# inside. The body is scanned raw, comments and literals included, so nothing can hide behind '--' or a string.
s9_check() {
  python3 -I - "$1" <<'PY'
import re, sys
raw = open(sys.argv[1], "rb").read()
try:
    text = raw.decode("ascii")
except UnicodeDecodeError:
    sys.exit("non-ASCII bytes in the file (this check accepts ASCII only)")
if "\r" in text:
    sys.exit("carriage return in the file")
if "/*" in text or "*/" in text:
    sys.exit("block comment in the file (not permitted by this check)")
lines = text.split("\n")
opens = [i for i, l in enumerate(lines) if l == "DO $seal$"]
closes = [i for i, l in enumerate(lines) if l == "END $seal$;"]
if len(opens) != 1 or len(closes) != 1 or closes[0] <= opens[0]:
    sys.exit("expected exactly one line 'DO $seal$' and one later line 'END $seal$;' (found %d and %d)"
             % (len(opens), len(closes)))
o, c = opens[0], closes[0]
for l in lines[:o] + lines[c + 1:]:
    if not re.fullmatch(r"[ \t]*(--.*)?", l):
        sys.exit("executable text or psql metacommand outside the single DO: %r" % l[:80])
body = "\n".join(lines[o + 1:c])
if re.search(r"\$[A-Za-z0-9_]*\$", body):
    sys.exit("a dollar-quote tag inside the DO body")
tc = re.search(r"(?i)\b(COMMIT|ROLLBACK|ABORT|SAVEPOINT|RELEASE|CALL|PREPARE\s+TRANSACTION|START\s+TRANSACTION|"
               r"BEGIN\s+(TRANSACTION|WORK|ISOLATION)|END\s+(TRANSACTION|WORK)|SET\s+TRANSACTION|"
               r"SET\s+SESSION\s+CHARACTERISTICS)\b", body)
if tc:
    sys.exit("transaction control inside the DO body: %s" % tc.group(0))
print("one top-level DO; only comments/whitespace outside; no transaction control inside")
PY
}
echo
echo "== S9 single top-level statement =="
set +e; S9OUT="$(s9_check "$MIG" 2>&1)"; S9RC=$?; set -e
[ "$S9RC" = 0 ] || fail "S9 static check rejected the real migration: $S9OUT"
echo "   real migration: $S9OUT"
python3 -I - "$MIG" "$WORK" <<'PY'
import sys
src = open(sys.argv[1], encoding="ascii").read()
work = sys.argv[2]
revoke = "  REVOKE EXECUTE ON FUNCTION public.list_unrestricted_users() FROM PUBLIC, anon, authenticated;\n"
assert src.count(revoke) == 1, "REVOKE anchor not found exactly once"
assert src.count("DO $seal$\n") == 1 and src.count("END $seal$;\n") == 1, "DO anchors not found exactly once"
split_decl = ("DO $seal$\nDECLARE\n  v_fn     regprocedure := to_regprocedure('public.list_unrestricted_users()');\n"
              "  v_old_lt text := pg_catalog.current_setting('lock_timeout');\n"
              "  v_old_sp text := pg_catalog.current_setting('search_path');\nBEGIN\n")
variants = {
  "split":  src.replace(revoke, "END $seal$;\n" + revoke.strip() + "\n" + split_decl),
  "commit": src.replace(revoke, revoke + "  COMMIT;\n"),
  "hidden": src.replace(revoke, revoke + "  PERFORM '--'; COMMIT;\n"),
  "call":   src.replace(revoke, revoke + "  CALL seal_test.noop();\n"),
  "case":   src.replace("DO $seal$\n", "DO $SEAL$\n").replace("END $seal$;\n", "END $SEAL$;\n"),
  "trailing": src + "SELECT 1;\n",
  "metacommand": "\\set QUIET on\n" + src,
}
for name, text in variants.items():
    open("%s/%s.sql" % (work, name), "w", encoding="ascii").write(text)
PY
s9_reject() {   # s9_reject <variant> <expected reason>
  local vout vrc
  set +e; vout="$(s9_check "$WORK/$1.sql" 2>&1)"; vrc=$?; set -e
  [ "$vrc" != 0 ] || fail "S9: the static check accepted the $1 variant"
  printf '%s' "$vout" | grep -qF -- "$2" || fail "S9: the $1 variant was rejected for the wrong reason: $vout"
  echo "   $1 variant rejected: $vout"
}
s9_reject split       "expected exactly one line 'DO \$seal\$' and one later line 'END \$seal\$;' (found 2 and 2)"
s9_reject commit      "transaction control inside the DO body: COMMIT"
s9_reject hidden      "transaction control inside the DO body: COMMIT"
s9_reject call        "transaction control inside the DO body: CALL"
s9_reject case        "expected exactly one line 'DO \$seal\$' and one later line 'END \$seal\$;' (found 0 and 0)"
s9_reject trailing    "executable text or psql metacommand outside the single DO: 'SELECT 1;'"
s9_reject metacommand "executable text or psql metacommand outside the single DO: '\\\\set QUIET on'"
fresh S9_split
run_file "$DB" "$WORK/split.sql"; expect_rc 0 "S9 split variant runs"
SPLIT_TAGS="$(tr '\n' ' ' <"$OUT" | sed 's/ $//')"
[ "$SPLIT_TAGS" = "DO REVOKE DO" ] || fail "S9: unexpected split-variant output '$SPLIT_TAGS'"
echo "   split variant is also rejected by the command-tag check: output was '$SPLIT_TAGS', not 'DO'"
fresh S9_commit
run_file "$DB" "$WORK/commit.sql"; expect_rc 0 "S9 commit variant runs"
echo "   commit variant's command-tag output is '$(tr '\n' ' ' <"$OUT" | sed 's/ $//')': only the static check catches it"

# ── S10: dependency refusal ─────────────────────────────────────────────────────────────────────────
echo
echo "== S10 dependency refusal (catalog-tracked dependent) =="
fresh S10
q "$DB" "CREATE VIEW seal_test.s10_dependent_view AS SELECT * FROM public.list_unrestricted_users()" >/dev/null
DEPS="$(q "$DB" "SELECT count(*) FROM pg_catalog.pg_depend d WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass
                 AND d.refobjid = 'public.list_unrestricted_users()'::regprocedure::oid AND d.deptype <> 'p'")"
[ "$DEPS" -gt 0 ] || fail "S10: the view did not create a pg_depend row"
run_file "$DB" "$MIG"
expect_rc 3 "S10 dependency refusal"
expect_stderr_has "D0 refused: catalog objects depend on public.list_unrestricted_users()" "S10 dependency refusal"
echo "   refused with the dependency error ($DEPS pg_depend row(s))"
say q "$DB" "SELECT seal_test.assert_state('S10 fresh connection', 'open')"

# ── S11: the postconditions themselves refuse (a re-grant right after the REVOKE) ───────────────────
# Unlike S8, the injected change completes and only the migration's own postcondition can refuse it. A split file
# in autocommit would leave the REVOKE and the re-grant committed; the single DO leaves the preimage.
echo
echo "== S11 postconditions refuse a re-grant after the REVOKE =="
fresh S11_forward
q "$DB" "CREATE EVENT TRIGGER d0_s11_regrant ON ddl_command_end WHEN TAG IN ('REVOKE')
         EXECUTE FUNCTION seal_test.s11_regrant_anon_after_revoke()" >/dev/null
run_file "$DB" "$MIG"
expect_rc 3 "S11 forward"
expect_stderr_has "D0 postcondition failed" "S11 forward"
q "$DB" "DROP EVENT TRIGGER d0_s11_regrant" >/dev/null
say q "$DB" "SELECT seal_test.assert_state('S11 forward postcondition refusal (fresh connection)', 'open')"
fresh S11_rollback
run_file "$DB" "$MIG"; expect_rc 0 "S11 seal before the rollback case"
q "$DB" "CREATE EVENT TRIGGER d0_s11_regrant ON ddl_command_end WHEN TAG IN ('REVOKE')
         EXECUTE FUNCTION seal_test.s11_regrant_anon_after_revoke()" >/dev/null
run_file "$DB" "$ROLLBACK"
expect_rc 3 "S11 rollback"
expect_stderr_has "D0 rollback postcondition failed" "S11 rollback"
q "$DB" "DROP EVENT TRIGGER d0_s11_regrant" >/dev/null
[ "$(q "$DB" "SELECT count(*) FROM pg_catalog.pg_event_trigger")" = 0 ] || fail "S11: an event trigger remains"
say q "$DB" "SELECT seal_test.assert_state('S11 rollback postcondition refusal (fresh connection)', 'sealed')"

# ── S12: a hostile session search_path does not defeat the md5 guard ────────────────────────────────
echo
echo "== S12 the migration pins its own search_path =="
fresh S12
HOSTILE="$(env "PGOPTIONS=-c search_path=pg_catalog" psql -X -qAt "$PGURL/$DB" -c "SHOW search_path")"
[ "$HOSTILE" = pg_catalog ] || fail "S12: the session search_path is '$HOSTILE', not pg_catalog"
run_file_env "PGOPTIONS=-c search_path=pg_catalog" "$DB" "$MIG"
expect_rc 0 "S12 under search_path=pg_catalog"
say q "$DB" "SELECT seal_test.assert_state('S12 sealed despite session search_path=pg_catalog', 'sealed')"

# ── S13: lock_timeout bounds the wait for a concurrent catalog lock ─────────────────────────────────
echo
echo "== S13 lock_timeout bounds the wait =="
fresh S13
psql -X -q -v ON_ERROR_STOP=1 "$PGURL/$DB" -c "BEGIN" -c "ALTER FUNCTION public.list_unrestricted_users() COST 100" \
  -c "SELECT pg_sleep(8)" -c "ROLLBACK" >"$WORK/holder.out" 2>&1 &
HOLDER=$!
HELD=0
for _ in $(seq 1 100); do
  if [ "$(q "$DB" "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname = current_database()
                   AND query = 'SELECT pg_sleep(8)' AND state = 'active'")" = 1 ]; then HELD=1; break; fi
  q postgres "SELECT pg_sleep(0.1)" >/dev/null
done
[ "$HELD" = 1 ] || fail "S13: the lock holder never started"
T0="$(date +%s%N)"; run_file "$DB" "$MIG"; T1="$(date +%s%N)"
WAIT_MS=$(( (T1 - T0) / 1000000 ))
expect_rc 3 "S13 lock timeout"
expect_stderr_has "canceling statement due to lock timeout" "S13 lock timeout"
[ "$WAIT_MS" -lt 5000 ] || fail "S13: the migration waited ${WAIT_MS} ms; lock_timeout did not bound it"
wait "$HOLDER" || fail "S13: the lock holder failed: $(cat "$WORK/holder.out")"
HOLDER=""
echo "   refused after ${WAIT_MS} ms with 'canceling statement due to lock timeout' (holder kept the lock 8 s)"
say q "$DB" "SELECT seal_test.assert_state('S13 after the lock timeout (fresh connection)', 'open')"

# ── S14: PostgREST reload notification only on success ──────────────────────────────────────────────
echo
echo "== S14 NOTIFY pgrst is sent on success only =="
fresh S14
NOTE='Asynchronous notification "pgrst" with payload "reload schema" received'
run_file "$DB" "$MIG" -c "LISTEN pgrst"; expect_rc 0 "S14 migration"; expect_stdout_has "$NOTE" "S14 migration"
run_file "$DB" "$MIG" -c "LISTEN pgrst"; expect_rc 3 "S14 replay"; expect_stdout_lacks "Asynchronous notification" "S14 replay"
run_file "$DB" "$ROLLBACK" -c "LISTEN pgrst"; expect_rc 0 "S14 rollback"; expect_stdout_has "$NOTE" "S14 rollback"
echo "   migration and rollback notify pgrst; the refused replay sends nothing"

# ── N1: S1 must detect PUBLIC inheritance ───────────────────────────────────────────────────────────
echo
echo "== N1 negative control: revoking from anon/authenticated but not PUBLIC must fail S1 and S2 =="
fresh N1
q "$DB" "REVOKE EXECUTE ON FUNCTION public.list_unrestricted_users() FROM anon, authenticated" >/dev/null
for r in anon authenticated; do
  set +e
  as_role "$DB" "$r" - "SELECT seal_test.expect_denied('N1 $r')" >"$OUT" 2>"$ERR"; RC=$?
  set -e
  [ "$RC" != 0 ] || fail "N1: $r was reported denied although PUBLIC still grants EXECUTE"
  expect_stderr_has "N1 $r FAIL: $r executed public.list_unrestricted_users()" "N1 $r"
done
echo "   OK: S1/S2 fail for anon and authenticated while PUBLIC still grants EXECUTE"

# ── N2: a standalone REVOKE commits in autocommit even when a later statement fails ─────────────────
echo
echo "== N2 negative control: multi-statement file in autocommit =="
fresh N2
[ "$(q "$DB" "SELECT count(*) FROM pg_catalog.pg_event_trigger")" = 0 ] || refuse "N2 needs a database with no event triggers"
N2="$WORK/n2.sql"
cat >"$N2" <<'SQL'
REVOKE EXECUTE ON FUNCTION public.list_unrestricted_users() FROM PUBLIC, anon, authenticated;
DO $n2$ BEGIN RAISE EXCEPTION 'N2 injected failure after a committed standalone REVOKE'; END $n2$;
CREATE TABLE public.n2_marker_must_not_exist ();
SQL
run_file "$DB" "$N2"
expect_rc 3 "N2"
expect_stdout "REVOKE" "N2 (the standalone REVOKE finished)"
! grep -q "WARNING" "$ERR" || { cat "$ERR" >&2; fail "N2: the REVOKE raised a warning"; }
[ "$(head -n1 "$ERR")" = "psql:$N2:2: ERROR:  N2 injected failure after a committed standalone REVOKE" ] \
  || { cat "$ERR" >&2; fail "N2: the failure did not come from statement 2"; }
echo "   exit 3; stdout exactly 'REVOKE'; the error came from statement 2; no warning"
say q "$DB" "SELECT seal_test.assert_state('N2 fresh connection: the standalone REVOKE committed', 'sealed')"
[ "$(q "$DB" "SELECT to_regclass('public.n2_marker_must_not_exist') IS NULL")" = t ] || fail "N2: statement 3 ran"
echo "   statement 3 never ran (marker table absent)"

echo
echo "======================================================================"
echo " ALL D0 PROOFS PASSED: S0–S14, N1, N2 on PostgreSQL $SERVER_VERSION"
echo " Database-role verification only; not PostgREST or browser evidence."
echo " This run's seal_d0_$$_* databases are dropped by the exit trap (reported below)."
echo "======================================================================"
