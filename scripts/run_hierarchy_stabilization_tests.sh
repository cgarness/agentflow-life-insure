#!/usr/bin/env bash
# =====================================================================================================
# Hierarchy stabilization (M1 authorization boundaries, M2 integrity, M3 fingerprint-bound repair): every database
# proof on a DISPOSABLE loopback PostgreSQL cluster. Synthetic data only (AGENT_RULES invariant #28).
# =====================================================================================================
# Usage:  PGURL="postgresql://postgres@127.0.0.1:<port>" bash scripts/run_hierarchy_stabilization_tests.sh
# Optional: POSTGREST_BIN=/path/to/postgrest (12.2.3) runs the PostgREST / supabase-js stages; with CI=true a missing
# POSTGREST_BIN, or any missing later-stage file (named explicitly below), is a FAILURE; locally each is reported as
# NOT EXECUTED. Every suite's PASS count is pinned per state (EXPECT_* below): a truncated suite fails the run.
#
# PGURL must be exactly postgres(ql)://postgres[:password]@<127.0.0.1|localhost>:<port>; the server must answer on a
# loopback address, as the postgres superuser, with no hosted platform roles and no database named after the
# production project. The URL is never printed. The run creates and drops only databases named hier_<pid>_*.
# Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §8. Files are applied by EXPLICIT list
# (never a glob), each migration in one transaction (psql -1 -f). Supabase apply_migration instead sends the whole
# file as ONE multi-statement simple query (one implicit transaction, SET LOCAL effective); the security review
# applied M1 and M2 both ways and got identical inventories, data and notices.
#
# Stages: 1 static checks (transaction control, the two M3 fingerprint constants, no \q / \quit in the suites, M1's
# and M2's applied versions and bytes, M3 kept in pending/) ·
# 2 states S0 S1 S2 S3 S1R S2R S3R and the core suite on each (pinned PASS count; database unchanged by the suite) ·
# 3 migrations: inventories, replay / drift / missing-prerequisite refusals with nothing changed, rollbacks back to
# the exact preimage, re-apply after rollback, the M2 trigger probe, a hostile session search_path, lock_timeout,
# NOTIFY on success only · 4 M3: refusal of the unmodified file, of an ids-only copy and of the substituted copy on
# a re-parented stale set; the substituted copy, side effects (functions fired, rows touched, set_claim writes),
# second run and no-op, the rollback stub · 5 two-session concurrency at READ COMMITTED; REPEATABLE READ /
# SERIALIZABLE hierarchy statements refused (0A000), including the mover-vs-inserter race · 6 later stages, by
# explicit name: supabase/tests/hierarchy_stabilization_rls.sql and _rpcs.sql per state (psql variables state, m1,
# m2, repaired, anon_revoked, compute_revoked, opu_hardened), scripts/tests/hierarchy_stabilization/
# postgrest_forged.mjs and src/test/integration/hierarchyFrontendCompat.integration.test.ts with one database per
# state (env HIERARCHY_DB_<STATE>, HIERARCHY_STATES, PGURL, POSTGREST_BIN, HIER_REST_ROLE_PREFIX).
# Database-role verification on the server version it runs against; it proves nothing about production.
set -euo pipefail
set +o xtrace   # commands carry the URL, which may hold a password: never trace them

PGURL="${PGURL:?set PGURL to a LOCAL postgres server, e.g. postgresql://postgres@127.0.0.1:55610}"
HIERARCHY_STATE_LIB=1 source "$(cd "$(dirname "$0")" && pwd)/hierarchy_test_state.sh"
hs_check_url
ROOT="$HS_ROOT"
SUITE="$ROOT/supabase/tests/hierarchy_stabilization.sql"
RLS_SUITE="$ROOT/supabase/tests/hierarchy_stabilization_rls.sql"
RPC_SUITE="$ROOT/supabase/tests/hierarchy_stabilization_rpcs.sql"
MJS_DIR="$ROOT/scripts/tests/hierarchy_stabilization"
FORGED="$MJS_DIR/postgrest_forged.mjs"
COMPAT_TEST="$ROOT/src/test/integration/hierarchyFrontendCompat.integration.test.ts"
VITEST="$ROOT/node_modules/.bin/vitest"
for f in "$HS_M1" "$HS_M2" "$HS_M3" "$HS_R1" "$HS_R2" "$HS_R3" "$HS_FIXTURE_PY" "$SUITE"; do
  [ -f "$f" ] || hs_refuse "missing $f"
done
export PYTHONDONTWRITEBYTECODE=1
# In CI nothing may be skipped: PostgREST must be installed and every later stage must exist, each named explicitly
# (no glob, so a renamed or moved file fails instead of silently dropping out).
if [ "${CI:-}" = true ]; then
  [ -n "${POSTGREST_BIN:-}" ] || { echo "FAIL: CI=true but POSTGREST_BIN is not set; the PostgREST / supabase-js stages must run in CI" >&2; exit 1; }
  for f in "$RLS_SUITE" "$RPC_SUITE" "$FORGED" "$COMPAT_TEST"; do
    [ -f "$f" ] || { echo "FAIL: CI=true but ${f#"$ROOT"/} is missing; every later stage must run in CI" >&2; exit 1; }
  done
fi

# Pinned PASS counts (update them with the suites): the core suite per state; the RLS and RPC suites per state; the
# forged stage and the compatibility suite in total over the 7 states. Any other count fails the run.
declare -A EXPECT_CORE=([S0]=64 [S1]=64 [S2]=114 [S3]=114 [S1R]=64 [S2R]=64 [S3R]=64)
declare -A EXPECT_LATER=([hierarchy_stabilization_rls.sql]=149 [hierarchy_stabilization_rpcs.sql]=81
                         [postgrest_forged.mjs]=336 [hierarchyFrontendCompat.integration.test.ts]=190)

PFX="hier_$$_"
WORK="$(mktemp -d)"
OUT="$WORK/stdout.txt"
ERR="$WORK/stderr.txt"
CREATED=()
RC=0
BG=()
PASSES=0
NOT_EXECUTED=()

# The PostgREST harness names its authenticator roles <prefix><node pid>_<n>; a run-specific prefix lets the leftover
# check below consider only the roles THIS run created.
export HIER_REST_ROLE_PREFIX="${PFX}rest_"

fail() { echo "   FAIL: $*" >&2; exit 1; }
ok()   { PASSES=$((PASSES + 1)); echo "   PASS $*"; }
q()    { psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$1" -c "$2"; }

cleanup() {
  local d left=0 p
  for p in "${BG[@]:-}"; do [ -z "$p" ] || kill "$p" 2>/dev/null || true; done
  if [ "${#CREATED[@]}" -gt 0 ]; then
    if ( hs_prove_local postgres ) >/dev/null 2>&1; then
      for d in "${CREATED[@]}"; do
        case "$d" in
          "$PFX"*) psql -X -q "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $d WITH (FORCE)" >/dev/null 2>&1 || left=1 ;;
        esac
      done
      [ "$left" = 1 ] && echo "cleanup WARNING: some hier_$$_* databases could not be dropped" >&2 \
                      || echo "cleanup: dropped the ${#CREATED[@]} database name(s) this run created"
    else
      echo "cleanup WARNING: the locality proof failed, so this run's databases were NOT dropped" >&2
    fi
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── locality proof ──────────────────────────────────────────────────────────────────────────────────────────────
echo "== locality proof =="
echo "   PGURL host: ${PGURL##*@} (credentials not printed)"
hs_prove_local postgres
SERVER_VERSION="$(q postgres "SHOW server_version")"
echo "   PostgreSQL $SERVER_VERSION; psql client: $(psql --version)"

# run_file <db> <file> [psql options...]: as a migration runner would (one transaction, ON_ERROR_STOP); exit status,
# stdout and stderr are captured separately, never through a pipe. Expected failures are asserted, not ignored.
run_file() {
  local db="$1" file="$2"; shift 2
  hs_prove_synthetic "$db"
  set +e
  psql -X -1 -v ON_ERROR_STOP=1 "$@" -f "$file" "$PGURL/$db" >"$OUT" 2>"$ERR"
  RC=$?
  set -e
}
expect_rc()         { [ "$RC" = "$1" ] || { cat "$OUT" "$ERR" >&2; fail "$2: exit status $RC, expected $1"; }; }
expect_failed()     { [ "$RC" != 0 ] || { cat "$OUT" "$ERR" >&2; fail "$1: succeeded, expected a failure"; }; }   # psql -c errors exit 1
expect_stderr_has() { grep -qF -- "$1" "$ERR" || { cat "$ERR" >&2; fail "$2: stderr lacks '$1'"; }; }
expect_stdout_has() { grep -qF -- "$1" "$OUT" || { cat "$OUT" >&2; fail "$2: stdout lacks '$1'"; }; }
expect_stdout_lacks() { ! grep -qF -- "$1" "$OUT" || { cat "$OUT" >&2; fail "$2: stdout has '$1'"; }; }

# Every function, relation, column, trigger, policy, index and schema ACL in the application schemas (not the test
# helper schema), with digests taken under the pinned search_path the migrations hash with.
inventory() {
  q "$1" "SET search_path = \"\$user\", public, extensions;
    SELECT 'f|' || p.oid::regprocedure || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|'
           || coalesce(array_to_string(p.proconfig, ';'), '-') || '|' || coalesce(p.proacl::text, '-') || '|' || md5(pg_get_functiondef(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'private', 'auth', 'profile_authz') AND p.prokind = 'f'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'r|' || c.oid::regclass || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || '|' || coalesce(c.relacl::text, '-')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'private', 'auth') AND c.relkind IN ('r', 'v', 'S')
    UNION ALL
    SELECT 'i|' || c.oid::regclass || '|index|' || pg_get_indexdef(c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'private', 'auth') AND c.relkind = 'i'
    UNION ALL
    SELECT 'a|' || a.attrelid::regclass || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || coalesce(a.attacl::text, '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'private', 'auth') AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 't|' || tgrelid::regclass || '|' || tgname || '|' || tgenabled::text || '|' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
    UNION ALL
    SELECT 'p|' || polrelid::regclass || '|' || polname || '|' || polcmd::text || '|' || polpermissive || '|' || polroles::text || '|'
           || md5(coalesce(pg_get_expr(polqual, polrelid), '-')) || '|' || md5(coalesce(pg_get_expr(polwithcheck, polrelid), '-')) FROM pg_policy
    UNION ALL
    SELECT 'n|' || nspname || '|' || coalesce(nspacl::text, '-') FROM pg_namespace WHERE nspname IN ('public', 'private', 'auth', 'profile_authz')
    ORDER BY 1" | LC_ALL=C sort
}
# Full-row data fingerprint of every table the hierarchy objects touch (updated_at included).
datafp() {
  q "$1" "SELECT md5(string_agg(t || ':' || r, E'\n' ORDER BY t, r)) FROM (
      SELECT 'profiles' t, to_jsonb(x)::text r FROM public.profiles x
      UNION ALL SELECT 'invitations', to_jsonb(x)::text FROM public.invitations x
      UNION ALL SELECT 'leads', to_jsonb(x)::text FROM public.leads x
      UNION ALL SELECT 'clients', to_jsonb(x)::text FROM public.clients x
      UNION ALL SELECT 'recruits', to_jsonb(x)::text FROM public.recruits x
      UNION ALL SELECT 'calls', to_jsonb(x)::text FROM public.calls x
      UNION ALL SELECT 'tasks', to_jsonb(x)::text FROM public.tasks x
      UNION ALL SELECT 'role_permissions', to_jsonb(x)::text FROM public.role_permissions x
      UNION ALL SELECT 'auth.users', to_jsonb(x)::text FROM auth.users x
      UNION ALL SELECT 'set_claim_calls', to_jsonb(x)::text FROM hierarchy_test.set_claim_calls x
      UNION ALL SELECT 'side_effects', to_jsonb(x)::text FROM hierarchy_test.side_effects x) s"
}
snapshot() { inventory "$1" > "$WORK/$2.inv"; datafp "$1" > "$WORK/$2.data"; }
unchanged_since() {   # unchanged_since <db> <snapshot> <label>
  inventory "$1" > "$WORK/now.inv"; datafp "$1" > "$WORK/now.data"
  diff -u "$WORK/$2.inv" "$WORK/now.inv" >&2 || fail "$3: the catalog changed"
  cmp -s "$WORK/$2.data" "$WORK/now.data" || fail "$3: data changed"
}
# changed_keys <before.inv> <after.inv>: the object keys (kind|object|name) added, removed or changed, one per line.
changed_keys() {
  LC_ALL=C comm -3 "$1" "$2" | sed -E 's/^\t//' | awk -F'|' '{ print $1 "|" $2 "|" $3 }' | LC_ALL=C sort -u
}
# expect_keys <before.inv> <after.inv> <label> <expected key>...: exactly these objects changed.
expect_keys() {
  local before="$1" after="$2" label="$3"; shift 3
  printf '%s\n' "$@" | sed '/^$/d' | LC_ALL=C sort -u > "$WORK/keys.expected"
  changed_keys "$before" "$after" > "$WORK/keys.actual"
  diff -u "$WORK/keys.expected" "$WORK/keys.actual" >&2 || fail "$label: unexpected set of changed catalog objects"
}

# ── 1. Static checks ────────────────────────────────────────────────────────────────────────────────────────────
echo
echo "== 1 static checks =="
# tx_check <file>: no transaction control anywhere — not as a top-level statement (BEGIN; COMMIT; END; ROLLBACK;
# START TRANSACTION; SAVEPOINT …; psql metacommands) and not inside any dollar-quoted body (PL/pgSQL COMMIT /
# ROLLBACK). Comments and string literals are skipped, so plpgsql BEGIN…END blocks and messages are allowed.
tx_check() {
  python3 -I - "$1" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
TOP = re.compile(r"(?is)^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction|"
                 r"commit\s+prepared|rollback\s+prepared|set\s+transaction|set\s+session\s+characteristics)\b")
BODY = re.compile(r"(?i)\b(commit|rollback|savepoint|start\s+transaction)\b")
def strip(text):
    """Remove comments and quoted strings; return (code, bodies) with dollar-quoted bodies taken out."""
    out, bodies, i, n = [], [], 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith('--', i):
            j = text.find('\n', i); i = n if j < 0 else j; continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        if c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'" and text.startswith("''", j): j += 2; continue
                if text[j] == "'": break
                j += 1
            out.append("''"); i = j + 1; continue
        m = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text[i:])
        if m:
            tag = m.group(0); j = text.find(tag, i + len(tag))
            if j < 0: sys.exit("unterminated dollar quote " + tag)
            bodies.append(text[i + len(tag):j]); out.append(" $body$ "); i = j + len(tag); continue
        out.append(c); i += 1
    return "".join(out), bodies
code, bodies = strip(src)
for line in code.split("\n"):
    if line.lstrip().startswith("\\"):
        sys.exit("psql metacommand at top level: " + line.strip()[:60])
for stmt in code.split(";"):
    s = stmt.strip()
    if s and TOP.match(s):
        sys.exit("top-level transaction control: " + " ".join(s.split())[:60])
pending = list(bodies)
while pending:
    body = pending.pop()
    inner, nested = strip(body)
    pending.extend(nested)
    m = BODY.search(inner)
    if m:
        sys.exit("transaction control inside a dollar-quoted body: " + m.group(0))
print("no transaction control")
PY
}
for f in "$HS_M1" "$HS_M2" "$HS_M3" "$HS_R1" "$HS_R2" "$HS_R3"; do
  set +e; r="$(tx_check "$f" 2>&1)"; c=$?; set -e
  [ "$c" = 0 ] || fail "static: $(basename "$f"): $r"
  ok "static: $(basename "$f"): $r"
done
# Negative controls: the check must catch what it claims to catch, and allow what it claims to allow.
printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$WORK/v_top.sql"
printf 'DO $x$ BEGIN PERFORM 1; COMMIT; END $x$;\n' > "$WORK/v_body.sql"
printf 'SELECT 1;\nEND;\n' > "$WORK/v_end.sql"
printf '\\set QUIET on\nSELECT 1;\n' > "$WORK/v_meta.sql"
printf "DO \$x\$ BEGIN RAISE NOTICE 'no rollback; commit nothing'; END \$x\$;\n-- COMMIT in a comment\n" > "$WORK/v_ok.sql"
for v in v_top v_body v_end v_meta; do
  set +e; r="$(tx_check "$WORK/$v.sql" 2>&1)"; c=$?; set -e
  [ "$c" != 0 ] || fail "static negative control $v was accepted"
done
set +e; r="$(tx_check "$WORK/v_ok.sql" 2>&1)"; c=$?; set -e
[ "$c" = 0 ] || fail "static control v_ok (words only in strings/comments) was rejected: $r"
ok "static: negative controls (top-level BEGIN/COMMIT, END;, PL/pgSQL COMMIT, metacommand) rejected; strings and comments allowed"
[ "$(grep -c "$HS_REVIEWED_FINGERPRINT" "$HS_M3")" = 1 ] || fail "static: M3 must carry the reviewed fingerprint exactly once"
[ "$(grep -c "$HS_REVIEWED_TARGET_FINGERPRINT" "$HS_M3")" = 1 ] || fail "static: M3 must carry the reviewed target fingerprint exactly once"
grep -q "c_reviewed_fingerprint *CONSTANT text := '$HS_REVIEWED_FINGERPRINT';" "$HS_M3" \
  && grep -q "c_reviewed_target_fingerprint CONSTANT text := '$HS_REVIEWED_TARGET_FINGERPRINT';" "$HS_M3" \
  || fail "static: M3's two fingerprint constants are not the reviewed values"
ok "static: M3 carries the reviewed stale-id fingerprint $HS_REVIEWED_FINGERPRINT and target fingerprint $HS_REVIEWED_TARGET_FINGERPRINT exactly once each"
# quit_check <file>: no psql \q / \quit anywhere outside comments, string literals and dollar-quoted bodies (psql exits
# 0 on \q, so a stray one would silently truncate a suite; the pinned counts below catch that too).
quit_check() {
  python3 -I - "$1" <<'PY2'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
out, i, n = [], 0, len(src)
while i < n:
    if src.startswith('--', i):
        j = src.find('\n', i); i = n if j < 0 else j; continue
    if src.startswith('/*', i):
        j = src.find('*/', i + 2); i = n if j < 0 else j + 2; continue
    if src[i] == "'":
        j = i + 1
        while j < n:
            if src[j] == "'" and src.startswith("''", j): j += 2; continue
            if src[j] == "'": break
            j += 1
        out.append("''"); i = j + 1; continue
    m = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", src[i:])
    if m:
        j = src.find(m.group(0), i + len(m.group(0)))
        if j < 0: sys.exit("unterminated dollar quote " + m.group(0))
        out.append(" $body$ "); i = j + len(m.group(0)); continue
    out.append(src[i]); i += 1
for no, line in enumerate("".join(out).split("\n"), 1):
    if re.search(r"\\(q|quit)(?![A-Za-z0-9_])", line):
        sys.exit(f"psql \\q / \\quit outside a comment or string (line {no} of the stripped text)")
print("no \\q or \\quit")
PY2
}
for f in "$SUITE" "$RLS_SUITE" "$RPC_SUITE"; do
  [ -f "$f" ] || continue   # a missing later suite is reported (or fails in CI) in stage 6
  set +e; r="$(quit_check "$f" 2>&1)"; c=$?; set -e
  [ "$c" = 0 ] || fail "static: $(basename "$f"): $r"
done
printf 'SELECT 1;\n\\q\nSELECT 2;\n' > "$WORK/v_quit.sql"
printf "SELECT 1; \\quit\n" > "$WORK/v_quit2.sql"
printf "SELECT '\\q';\n-- \\q in a comment\nDO \$x\$ BEGIN RAISE NOTICE '\\quit'; END \$x\$;\n" > "$WORK/v_quit_ok.sql"
for v in v_quit v_quit2; do
  set +e; r="$(quit_check "$WORK/$v.sql" 2>&1)"; c=$?; set -e
  [ "$c" != 0 ] || fail "static negative control $v (a top-level \\q / \\quit) was accepted"
done
set +e; r="$(quit_check "$WORK/v_quit_ok.sql" 2>&1)"; c=$?; set -e
[ "$c" = 0 ] || fail "static control v_quit_ok (\\q only in a string / comment / body) was rejected: $r"
ok "static: no psql \\q or \\quit in the core, RLS and RPC suites; negative controls rejected, strings and comments allowed"
case "$HS_M3" in *"/migrations/pending/"*) ok "static: M3 lives under migrations/pending/ (outside the CLI glob)" ;;
  *) fail "static: M3 is not under migrations/pending/" ;; esac
# Gates 2a / 2b (2026-10-23): M1 and M2 are applied and recorded as 20261023210027 and 20261023232435, so each
# repository file is the as-applied record (AGENT_RULES "apply_migration stamps its own version"):
# - exactly one top-level file per applied migration, named after its recorded version;
# - its SHA-256 equals the recorded statement's;
# - no copy left in pending/.
# M3 stays in pending/ until Gate 2c; moving it to the top level is part of Gate 2c and must change this check
# deliberately.
pin_applied() {  # <name> <slug> <recorded version> <recorded SHA-256> <expected path>
  local name="$1" slug="$2" version="$3" sha="$4" path="$5" pend
  local -a top
  mapfile -t top < <(find "$HS_ROOT/supabase/migrations" -maxdepth 1 -type f -name "*_${slug}.sql" | LC_ALL=C sort)
  [ "${#top[@]}" = 1 ] && [ "${top[0]}" = "$path" ] && [ "$(basename "$path")" = "${version}_${slug}.sql" ] \
    || fail "static: expected exactly one top-level $name file, ${version}_${slug}.sql (found: ${top[*]:-none})"
  pend="$(find "$HS_ROOT/supabase/migrations/pending" -maxdepth 1 -type f -name "*_${slug}.sql" | LC_ALL=C sort)"
  [ -z "$pend" ] || fail "static: applied $name must not also remain in migrations/pending/: $pend"
  [ "$(sha256sum "$path" | cut -d' ' -f1)" = "$sha" ] \
    || fail "static: $name's bytes differ from the SQL production recorded as $version (SHA-256 $sha); an applied migration is immutable"
  ok "static: $name is the as-applied record: one top-level file at the recorded version $version, SHA-256 $sha"
}
pin_applied M1 hierarchy_authorization_boundaries 20261023210027 \
  5d99c92328a507451968133603c8f53cd13a782a9749637dfc32d449e137d5df "$HS_M1"
pin_applied M2 hierarchy_integrity 20261023232435 \
  7f2c61dbdfdd39938d424bc26e024c81c823a5a41692c5a0607a8bff87377aa3 "$HS_M2"
STRAY_M3="$(find "$HS_ROOT/supabase/migrations" -maxdepth 1 -type f -name '*_hierarchy_path_repair.sql' | LC_ALL=C sort)"
[ -z "$STRAY_M3" ] || fail "static: M3 must stay in migrations/pending/ until Gate 2c; top-level copies: $STRAY_M3"
ok "static: no top-level M3 file; it stays in migrations/pending/ until Gate 2c"

# ── 2. States and the core suite ────────────────────────────────────────────────────────────────────────────────
echo
echo "== 2 states S0 S1 S2 S3 S1R S2R S3R and the core suite =="
python3 -I "$HS_FIXTURE_PY" > "$WORK/fixture.sql"
TPL="${PFX}tpl"
CREATED+=("$TPL")
hs_create_s0 "$TPL" "$WORK/fixture.sql"
ok "fixture: the verbatim production preimage loaded (digests, ACLs, triggers and policies equal production's) with the production-shaped data"
# state_db <state> <name>: a new database cloned from the S0 template and walked to <state>.
state_db() {
  local state="$1" db="${PFX}$2" prev="" s
  hs_valid_state "$state"
  hs_prove_local postgres
  CREATED+=("$db")
  psql -X -q -v ON_ERROR_STOP=1 "$PGURL/postgres" -c "CREATE DATABASE $db TEMPLATE $TPL" >/dev/null
  for s in $(hs_path "$state"); do
    [ -z "$prev" ] || hs_advance "$db" "$prev" "$s"
    prev="$s"
  done
  DB="$db"
}
flags() {   # psql variables describing a state, for every per-state suite
  local s="$1"
  echo "-v state=$s -v m1=$(case $s in S1|S2|S3|S2R) echo on;; *) echo off;; esac)" \
       "-v m2=$(case $s in S2|S3) echo on;; *) echo off;; esac)" \
       "-v repaired=$(case $s in S3|S3R) echo on;; *) echo off;; esac)" \
       "-v anon_revoked=$(case $s in S0) echo off;; *) echo on;; esac)" \
       "-v compute_revoked=$(case $s in S0) echo off;; *) echo on;; esac)" \
       "-v opu_hardened=$(case $s in S2|S3|S2R|S3R) echo on;; *) echo off;; esac)"
}
declare -A STATE_PASS
for st in $HS_STATES; do
  state_db "$st" "suite_$(echo "$st" | tr '[:upper:]' '[:lower:]')"
  snapshot "$DB" "pre_suite"
  set +e
  # shellcheck disable=SC2046
  psql -X -qAt -v ON_ERROR_STOP=1 $(flags "$st") -f "$SUITE" "$PGURL/$DB" >"$OUT" 2>"$ERR"
  RC=$?
  set -e
  [ "$RC" = 0 ] || { grep -v '^PASS' "$OUT" >&2 || true; cat "$ERR" >&2; fail "core suite on $st (exit $RC)"; }
  ! grep -v '^PASS ' "$OUT" | grep -q . || { grep -v '^PASS ' "$OUT" >&2; fail "core suite on $st printed a non-PASS line"; }
  n="$(grep -c '^PASS ' "$OUT" || true)"
  [ "$n" = "${EXPECT_CORE[$st]}" ] || fail "core suite on $st: $n cases, expected ${EXPECT_CORE[$st]} (pinned)"
  STATE_PASS[$st]=$n
  PASSES=$((PASSES + n))
  unchanged_since "$DB" "pre_suite" "core suite on $st"
  echo "   PASS core suite on $st: $n cases (= pinned ${EXPECT_CORE[$st]}); the database is unchanged afterwards (catalog and data)"
done

# ── 3. Migrations: inventories, refusals, rollbacks, re-apply, probe, search_path, lock_timeout, NOTIFY ─────────
echo
echo "== 3 migrations =="
state_db S0 mig_inventory
snapshot "$DB" s0
run_file "$DB" "$HS_M1"; expect_rc 0 "M1 apply"
snapshot "$DB" s1
expect_keys "$WORK/s0.inv" "$WORK/s1.inv" "M1 inventory" \
  "f|is_ancestor_of(uuid,uuid)|postgres" "f|profile_authz.actor_is_team_leader()|postgres" \
  "f|profile_authz.actor_is_org_admin(uuid)|postgres" "f|private.guard_profile_commission_level()|postgres" \
  "f|private.guard_team_leader_downline_call_update()|postgres" "p|tasks|tasks_select_team_leader" \
  "p|leads|leads_tl_delete_requires_contacts_permission" "p|clients|clients_tl_delete_requires_contacts_permission" \
  "p|recruits|recruits_tl_delete_requires_contacts_permission" "p|calls|calls_delete_own_rows_or_org_admin" \
  "t|profiles|trg_01_guard_profile_commission_level" "t|calls|calls_00_guard_team_leader_downline_update" \
  "f|private.guard_contact_organization_change()|postgres" "t|leads|contacts_00_guard_organization_change" \
  "t|clients|contacts_00_guard_organization_change" "t|recruits|contacts_00_guard_organization_change" \
  "f|compute_hierarchy_path(uuid)|postgres" "f|update_hierarchy_path()|postgres" "f|cascade_hierarchy_update()|postgres"
cmp -s "$WORK/s0.data" "$WORK/s1.data" || fail "M1 wrote data"
for fn in 'compute_hierarchy_path(uuid)' 'update_hierarchy_path()' 'cascade_hierarchy_update()'; do
  [ "$(grep -F "f|$fn|postgres|" "$WORK/s0.inv" | cut -d'|' -f1-5,7)" = "$(grep -F "f|$fn|postgres|" "$WORK/s1.inv" | cut -d'|' -f1-5,7)" ] \
    || fail "M1 changed more than the ACL of $fn"
  grep -qF "f|$fn|postgres|true|search_path=public|{postgres=X/postgres,service_role=X/postgres}|" "$WORK/s1.inv" || fail "M1: $fn ACL is not postgres,service_role"
done
ok "M1 inventory: exactly is_ancestor_of + tasks_select_team_leader changed, 3 helpers/guards + the contact organization guard + 5 triggers + 4 restrictive policies added, client EXECUTE revoked on the 3 path functions (bodies unchanged); $(wc -l < "$WORK/s0.inv") other catalog entries and all data unchanged"
run_file "$DB" "$HS_M2"; expect_rc 0 "M2 apply"
expect_stdout_has "DO" "M2 apply"
snapshot "$DB" s2
expect_keys "$WORK/s1.inv" "$WORK/s2.inv" "M2 inventory" \
  "f|compute_hierarchy_path(uuid)|postgres" "f|update_hierarchy_path()|postgres" "f|cascade_hierarchy_update()|postgres" \
  "f|on_profile_update()|postgres" "f|private.build_hierarchy_path(uuid,uuid,uuid,boolean)|postgres" \
  "f|private.lock_profile_hierarchy()|postgres" "f|private.validate_invitation_upline()|postgres" \
  "f|private.hierarchy_consistency()|postgres" "i|idx_profiles_upline_id|index" "t|profiles|trg_update_hierarchy_path" \
  "t|profiles|trg_cascade_hierarchy_update" "t|profiles|trg_update_hierarchy_path_lock" "t|invitations|trg_validate_invitation_upline"
cmp -s "$WORK/s1.data" "$WORK/s2.data" || fail "M2 wrote data (its trigger probe must roll itself back)"
ok "M2 inventory: exactly the 3 replaced path functions (ACL already revoked by M1), on_profile_update hardening, 4 private functions, 2 replaced + 2 new triggers and 1 index; no row written (the \$post\$ probe rolled itself back)"
cp "$HS_M3" "$WORK/m3_unmodified.sql"; hs_m3_copy "$DB" "$WORK/m3_synth.sql"
run_file "$DB" "$WORK/m3_synth.sql"; expect_rc 0 "M3 (synthetic fingerprint) apply"
snapshot "$DB" s3
expect_keys "$WORK/s2.inv" "$WORK/s3.inv" "M3 inventory"
ok "M3 inventory: no catalog change"

# Replays are refused with nothing changed.
for pair in "M1|$HS_M1|hierarchy M1 refused: public.is_ancestor_of(uuid,uuid) differs from the reviewed preimage" \
            "M2|$HS_M2|hierarchy M2 refused: public.compute_hierarchy_path(uuid) differs from the reviewed preimage"; do
  IFS='|' read -r label file msg <<<"$pair"
  run_file "$DB" "$file"; expect_rc 3 "$label replay"; expect_stderr_has "$msg" "$label replay"
  unchanged_since "$DB" s3 "$label replay"
  ok "$label replay refused ('${msg%%:*}: …'); catalog and data unchanged"
done
run_file "$DB" "$HS_R3"; expect_rc 3 "M3 rollback stub"; expect_stderr_has "hierarchy M3 has no automatic rollback" "M3 rollback stub"
unchanged_since "$DB" s3 "M3 rollback stub"
ok "M3 rollback stub always refuses (operational revocation is the recovery path); nothing changed"

# Missing prerequisites and wrong-state rollbacks are refused with nothing changed.
state_db S0 mig_prereq
snapshot "$DB" p0
run_file "$DB" "$HS_M2"; expect_rc 3 "M2 without M1"; expect_stderr_has "hierarchy M2 refused: M1 (20261023210027 hierarchy_authorization_boundaries) is not applied as reviewed" "M2 without M1"
run_file "$DB" "$WORK/m3_unmodified.sql"; expect_rc 3 "M3 without M1/M2"; expect_stderr_has "hierarchy M3 refused: public.is_ancestor_of(uuid,uuid) is not the reviewed M1/M2 post-image" "M3 without M1/M2"
run_file "$DB" "$HS_R1"; expect_rc 3 "M1 rollback on S0"; expect_stderr_has "hierarchy M1 rollback refused" "M1 rollback on S0"
run_file "$DB" "$HS_R2"; expect_rc 3 "M2 rollback on S0"; expect_stderr_has "hierarchy M2 rollback refused" "M2 rollback on S0"
unchanged_since "$DB" p0 "prerequisite refusals"
ok "M2 without M1, M3 without M1/M2, and both rollbacks on the preimage are refused; nothing changed"
state_db S1 mig_prereq1
snapshot "$DB" p1
run_file "$DB" "$WORK/m3_unmodified.sql"; expect_rc 3 "M3 without M2"; expect_stderr_has "is not the reviewed M1/M2 post-image" "M3 without M2"
run_file "$DB" "$HS_R2"; expect_rc 3 "M2 rollback on S1"; expect_stderr_has "hierarchy M2 rollback refused" "M2 rollback on S1"
unchanged_since "$DB" p1 "S1 refusals"
ok "M3 without M2 and the M2 rollback before M2 are refused; nothing changed"

# Drift on any guarded object is refused with nothing changed (each from a fresh clone of the needed state).
drift_case() {   # drift_case <state> <label> <drift sql> <file> <expected message>
  state_db "$1" "drift_$(printf '%s' "$2" | tr -c 'a-z0-9' '_' | cut -c1-30)"
  q "$DB" "$3" >/dev/null
  snapshot "$DB" drift
  run_file "$DB" "$4"; expect_rc 3 "$2"; expect_stderr_has "$5" "$2"
  unchanged_since "$DB" drift "$2"
  ok "drift refused — $2"
}
drift_case S0 "M1: is_ancestor_of body" \
  "CREATE OR REPLACE FUNCTION public.is_ancestor_of(ancestor_id uuid, descendant_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS \$\$ SELECT true \$\$" \
  "$HS_M1" "hierarchy M1 refused: public.is_ancestor_of(uuid,uuid) differs from the reviewed preimage"
drift_case S0 "M1: is_ancestor_of ACL (anon revoked, PUBLIC kept)" \
  "REVOKE EXECUTE ON FUNCTION public.is_ancestor_of(uuid,uuid) FROM anon" \
  "$HS_M1" "hierarchy M1 refused: public.is_ancestor_of(uuid,uuid) owner, definer flag or ACL drifted"
drift_case S0 "M1: a dependent policy expression" \
  "ALTER POLICY \"Leads Hierarchical Access\" ON public.leads USING (user_id = auth.uid())" \
  "$HS_M1" "hierarchy M1 refused: policy \"Leads Hierarchical Access\" on public.leads differs from the reviewed preimage"
drift_case S0 "M1: a tenth policy depending on is_ancestor_of" \
  "CREATE POLICY drift_dependent ON public.tasks FOR SELECT TO authenticated USING (public.is_ancestor_of(auth.uid(), assigned_to))" \
  "$HS_M1" "hierarchy M1 refused: the policies depending on is_ancestor_of are not the reviewed 9"
drift_case S0 "M1: tasks_select_team_leader roles" \
  "ALTER POLICY tasks_select_team_leader ON public.tasks TO authenticated" \
  "$HS_M1" "hierarchy M1 refused: policy \"tasks_select_team_leader\" on public.tasks differs from the reviewed preimage"
drift_case S0 "M1: an existing restrictive policy" \
  "CREATE POLICY drift_restrictive ON public.calls AS RESTRICTIVE FOR SELECT TO authenticated USING (true)" \
  "$HS_M1" "hierarchy M1 refused: an object this migration creates already exists"
drift_case S0 "M1: calls_guard_dialer_core disabled" \
  "ALTER TABLE public.calls DISABLE TRIGGER calls_guard_dialer_core" \
  "$HS_M1" "hierarchy M1 refused: trigger calls_guard_dialer_core on public.calls differs from the reviewed preimage"
drift_case S0 "M1: compute_hierarchy_path ACL (anon revoked, PUBLIC kept)" \
  "REVOKE EXECUTE ON FUNCTION public.compute_hierarchy_path(uuid) FROM anon" \
  "$HS_M1" "hierarchy M1 refused: public.compute_hierarchy_path(uuid) owner, definer flag or ACL drifted"
drift_case S0 "M1: a clients trigger that fires before the organization guard changed" \
  "ALTER TABLE public.clients DISABLE TRIGGER clients_policy_identity" \
  "$HS_M1" "hierarchy M1 refused: trigger clients_policy_identity on public.clients differs from the reviewed preimage"
drift_case S0 "M1: an extra BEFORE UPDATE trigger that would fire before the organization guard" \
  "CREATE TRIGGER a_drift BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()" \
  "$HS_M1" "hierarchy M1 refused: BEFORE UPDATE triggers on public.leads that fire before the organization guard differ from the reviewed set (found a_drift)"
drift_case S0 "M1: guard_client_lead_conversion body" \
  "CREATE OR REPLACE FUNCTION private.guard_client_lead_conversion() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS \$\$ BEGIN NEW.organization_id := NULL; RETURN NEW; END \$\$" \
  "$HS_M1" "hierarchy M1 refused: private.guard_client_lead_conversion() differs from the reviewed preimage"
drift_case S1 "M2: compute_hierarchy_path body" \
  "CREATE OR REPLACE FUNCTION public.compute_hierarchy_path(target_user_id uuid) RETURNS ltree LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS \$\$ BEGIN RETURN NULL; END; \$\$" \
  "$HS_M2" "hierarchy M2 refused: public.compute_hierarchy_path(uuid) differs from the reviewed preimage"
drift_case S1 "M2: compute_hierarchy_path re-granted to anon after M1" \
  "GRANT EXECUTE ON FUNCTION public.compute_hierarchy_path(uuid) TO anon" \
  "$HS_M2" "hierarchy M2 refused: public.compute_hierarchy_path(uuid) differs from the reviewed preimage"
drift_case S1 "M2: preimage body with the post-rollback ACL mixed (on_profile_update revoked, not hardened)" \
  "REVOKE EXECUTE ON FUNCTION public.on_profile_update() FROM PUBLIC, anon, authenticated" \
  "$HS_M2" "hierarchy M2 refused: public.on_profile_update() differs from the reviewed preimage"
drift_case S1 "M2: trg_cascade_hierarchy_update definition" \
  "CREATE OR REPLACE TRIGGER trg_cascade_hierarchy_update AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION cascade_hierarchy_update()" \
  "$HS_M2" "hierarchy M2 refused: trigger trg_cascade_hierarchy_update differs from the reviewed preimage"
drift_case S1 "M2: an extra profiles trigger" \
  "CREATE TRIGGER zz_drift AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()" \
  "$HS_M2" "hierarchy M2 refused: the profiles trigger set differs from the reviewed one"
drift_case S1 "M2: an invitations trigger already present" \
  "CREATE TRIGGER zz_drift BEFORE INSERT ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()" \
  "$HS_M2" "hierarchy M2 refused: an object this migration creates already exists"
drift_case S1 "M2: clients granted CREATE on public" \
  "GRANT CREATE ON SCHEMA public TO authenticated" \
  "$HS_M2" "hierarchy M2 refused: ltree location or public/private schema privileges differ from the reviewed state"
drift_case S1 "M1 rollback: compute_hierarchy_path re-granted to anon after M1" \
  "GRANT EXECUTE ON FUNCTION public.compute_hierarchy_path(uuid) TO anon" \
  "$HS_R1" "hierarchy M1 rollback refused: public.compute_hierarchy_path(uuid) ACL drifted (anon,postgres,service_role)"
drift_case S2 "M3: an M2 trigger disabled" \
  "ALTER TABLE public.profiles DISABLE TRIGGER trg_update_hierarchy_path_lock" \
  "$WORK/m3_synth.sql" "hierarchy M3 refused: trigger trg_update_hierarchy_path_lock on public.profiles is not the reviewed M1/M2 post-image"
drift_case S2 "M3: a cross-organization edge in the data" \
  "ALTER TABLE public.profiles DISABLE TRIGGER USER; UPDATE public.profiles SET upline_id = hierarchy_test.id('BA') WHERE id = hierarchy_test.id('K1'); ALTER TABLE public.profiles ENABLE TRIGGER USER" \
  "$WORK/m3_synth.sql" "hierarchy M3 refused: self_parents=0, cross_org_edges=1, unreachable=0"
drift_case S2 "M3: a stale set that is not the reviewed one (one more stale row)" \
  "ALTER TABLE public.profiles DISABLE TRIGGER USER; UPDATE public.profiles SET hierarchy_path = text2ltree(replace(id::text, '-', '_')) WHERE id = hierarchy_test.id('K1'); ALTER TABLE public.profiles ENABLE TRIGGER USER" \
  "$WORK/m3_synth.sql" "hierarchy M3 refused: the 5 stale row(s) are not the reviewed set"

# Rollbacks restore the exact preimage; re-apply after rollback is accepted and reproduces the post-image exactly.
state_db S1 mig_rb1
run_file "$DB" "$HS_R1"; expect_rc 0 "M1 rollback"
snapshot "$DB" s1r
expect_keys "$WORK/s0.inv" "$WORK/s1r.inv" "M1 rollback vs S0" "f|is_ancestor_of(uuid,uuid)|postgres" \
  "f|compute_hierarchy_path(uuid)|postgres" "f|update_hierarchy_path()|postgres" "f|cascade_hierarchy_update()|postgres"
printf '%s\n' \
  "f|cascade_hierarchy_update()|postgres|true|search_path=public|{postgres=X/postgres,service_role=X/postgres}|8392e93e9b09f726dcb097cb54dae522" \
  "f|compute_hierarchy_path(uuid)|postgres|true|search_path=public|{postgres=X/postgres,service_role=X/postgres}|b9aaa16d5b974676ce18d55c5dce9e18" \
  "f|is_ancestor_of(uuid,uuid)|postgres|true|search_path=public|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|7c5213032696734f2e0c5ffe5a71a07a" \
  "f|update_hierarchy_path()|postgres|true|search_path=public|{postgres=X/postgres,service_role=X/postgres}|d9ff2d22fcc0bd5e55ea288850ad1cfe" \
  | LC_ALL=C sort > "$WORK/s1r.expected"
LC_ALL=C comm -13 "$WORK/s0.inv" "$WORK/s1r.inv" | diff -u "$WORK/s1r.expected" - >&2 \
  || fail "M1 rollback: is_ancestor_of and the 3 path functions are not their preimage bodies with the revoked ACLs"
cmp -s "$WORK/s0.data" "$WORK/s1r.data" || fail "M1 rollback changed data"
ok "M1 rollback: the exact preimage everywhere (is_ancestor_of md5 7c5213032696734f2e0c5ffe5a71a07a); only the revokes are kept (is_ancestor_of from PUBLIC/anon; the 3 path functions from PUBLIC/anon/authenticated)"
run_file "$DB" "$HS_M1"; expect_rc 0 "M1 re-apply after rollback"
inventory "$DB" > "$WORK/s1again.inv"
diff -u "$WORK/s1.inv" "$WORK/s1again.inv" >&2 || fail "M1 re-apply after rollback differs from the first apply"
ok "M1 re-apply after rollback accepted; catalog identical to the first apply"
state_db S2 mig_rb2
run_file "$DB" "$HS_R2"; expect_rc 0 "M2 rollback"
snapshot "$DB" s2r
expect_keys "$WORK/s1.inv" "$WORK/s2r.inv" "M2 rollback vs S1" "f|on_profile_update()|postgres"
for d in b9aaa16d5b974676ce18d55c5dce9e18 d9ff2d22fcc0bd5e55ea288850ad1cfe 8392e93e9b09f726dcb097cb54dae522; do
  grep -q "|{postgres=X/postgres,service_role=X/postgres}|$d\$" "$WORK/s2r.inv" || fail "M2 rollback: preimage body $d with the hardened ACL not found"
done
cmp -s "$WORK/s1.data" "$WORK/s2r.data" || fail "M2 rollback changed data"
ok "M2 rollback: exact preimage bodies (b9aaa16d…, d9ff2d22…, 8392e93e…) with M1's revoked ACL, and the preimage trigger definitions; the catalog equals S1 except on_profile_update's kept revoke and search_path"
run_file "$DB" "$HS_M2"; expect_rc 0 "M2 re-apply after rollback"
inventory "$DB" > "$WORK/s2again.inv"
diff -u "$WORK/s2.inv" "$WORK/s2again.inv" >&2 || fail "M2 re-apply after rollback differs from the first apply"
ok "M2 re-apply after rollback accepted; catalog identical to the first apply"
state_db S3 mig_rb3
run_file "$DB" "$HS_R2"; expect_rc 0 "M2 rollback after M3"
run_file "$DB" "$HS_R1"; expect_rc 0 "M1 rollback after M3"; expect_stderr_has "Team Leader downline relationship(s) are live" "M1 rollback after M3 warns"
q "$DB" "SELECT CASE WHEN stale_paths = 0 AND missing_pairs = 0 THEN 'ok' END FROM hierarchy_test.consistency()" | grep -qx ok \
  || fail "rollbacks after M3 must leave the repaired paths correct"
ok "M2 then M1 rolled back after M3: repaired paths stay correct; the M1 rollback warns that Team Leader powers widen again"

# The M2 \$post\$ probe really fires the triggers: a sabotage trigger behind set_claim aborts the whole migration.
state_db S1 mig_probe
q "$DB" "CREATE FUNCTION hierarchy_test.sabotage() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'probe fired the profiles triggers'; END \$\$;
         CREATE TRIGGER sabotage BEFORE INSERT ON hierarchy_test.set_claim_calls FOR EACH ROW EXECUTE FUNCTION hierarchy_test.sabotage()" >/dev/null
snapshot "$DB" probe
run_file "$DB" "$HS_M2"; expect_rc 3 "M2 probe"; expect_stderr_has "probe fired the profiles triggers" "M2 probe"
unchanged_since "$DB" probe "M2 probe failure"
ok "M2 \$post\$ probe fires the real profiles triggers (on_profile_update -> set_claim); a runtime failure aborts the migration with nothing changed"

# A hostile session search_path does not defeat the guards or the new functions.
state_db S0 mig_searchpath
for f in "$HS_M1" "$HS_M2"; do
  run_file "$DB" "$f" -c "SET search_path = pg_catalog"; expect_rc 0 "$(basename "$f") under search_path=pg_catalog"
done
hs_m3_copy "$DB" "$WORK/m3_sp.sql"
run_file "$DB" "$WORK/m3_sp.sql" -c "SET search_path = pg_catalog"; expect_rc 0 "M3 under search_path=pg_catalog"
q "$DB" "SELECT CASE WHEN stale_paths = 0 THEN 'ok' END FROM hierarchy_test.consistency()" | grep -qx ok || fail "search_path: M3 did not repair"
ok "M1, M2 and M3 apply and behave when the session search_path is pg_catalog only"

# lock_timeout bounds the wait for a concurrent lock on profiles.
state_db S1 mig_lock
# SHARE ROW EXCLUSIVE: blocks M2's trigger DDL but not the readers (including this runner's own checks).
psql -X -q "$PGURL/$DB" -c "BEGIN" -c "LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE" -c "SELECT pg_sleep(8)" -c "ROLLBACK" >"$WORK/holder.out" 2>&1 &
BG+=("$!")
HELD=0
for _ in $(seq 1 100); do
  if [ "$(q postgres "SELECT count(*) FROM pg_stat_activity WHERE datname = '$DB' AND query = 'SELECT pg_sleep(8)' AND state = 'active'")" = 1 ]; then HELD=1; break; fi
  sleep 0.1
done
[ "$HELD" = 1 ] || fail "lock_timeout: the lock holder never started"
T0="$(date +%s%N)"; run_file "$DB" "$HS_M2"; T1="$(date +%s%N)"
expect_rc 3 "M2 under a held lock"; expect_stderr_has "canceling statement due to lock timeout" "M2 under a held lock"
WAIT_MS=$(( (T1 - T0) / 1000000 ))
[ "$WAIT_MS" -lt 5000 ] || fail "lock_timeout: M2 waited ${WAIT_MS} ms"
wait "${BG[-1]}" || true
ok "lock_timeout: M2 gives up after ${WAIT_MS} ms while another session holds profiles (retryable failure)"

# NOTIFY pgrst only on success (an explicit transaction, so psql reports the notification after COMMIT).
run_notify() {   # run_notify <db> <file>
  hs_prove_synthetic "$1"
  set +e
  psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$1" -c "LISTEN pgrst" -c "BEGIN" -f "$2" -c "COMMIT" -c "SELECT 'after commit'" >"$OUT" 2>"$ERR"
  RC=$?
  set -e
}
state_db S0 mig_notify
NOTE='Asynchronous notification "pgrst" with payload "reload schema" received'
run_notify "$DB" "$HS_M1"; expect_rc 0 "M1 notify"; expect_stdout_has "$NOTE" "M1 notify"
run_notify "$DB" "$HS_M1"; expect_rc 3 "M1 replay notify"; expect_stdout_lacks "Asynchronous notification" "M1 replay notify"
run_notify "$DB" "$HS_M2"; expect_rc 0 "M2 notify"; expect_stdout_has "$NOTE" "M2 notify"
run_notify "$DB" "$HS_M2"; expect_rc 3 "M2 replay notify"; expect_stdout_lacks "Asynchronous notification" "M2 replay notify"
run_notify "$DB" "$HS_R2"; expect_rc 0 "M2 rollback notify"; expect_stdout_has "$NOTE" "M2 rollback notify"
run_notify "$DB" "$HS_R1"; expect_rc 0 "M1 rollback notify"; expect_stdout_has "$NOTE" "M1 rollback notify"
ok "NOTIFY pgrst is delivered by M1, M2 and both rollbacks on success and never by a refused replay"

# ── 4. M3: fingerprint binding, side effects, second run, no-op ─────────────────────────────────────────────────
echo
echo "== 4 M3 repair =="
state_db S2 m3
snapshot "$DB" m3pre
run_file "$DB" "$WORK/m3_unmodified.sql"; expect_rc 3 "M3 unmodified on the synthetic set"
expect_stderr_has "hierarchy M3 refused: the 4 stale row(s) are not the reviewed set (fingerprint $(q "$DB" "SELECT hierarchy_test.stale_fingerprint()"))" "M3 unmodified"
unchanged_since "$DB" m3pre "M3 unmodified refusal"
ok "the unmodified M3 REFUSES the synthetic stale set (its fingerprint is not production's reviewed $HS_REVIEWED_FINGERPRINT); nothing changed"
hs_m3_copy "$DB" "$WORK/m3_idsonly.sql" ids-only
[ "$(diff "$HS_M3" "$WORK/m3_idsonly.sql" | grep -c '^[<>]')" = 2 ] || fail "the ids-only M3 copy differs from the file in more than the id fingerprint line"
run_file "$DB" "$WORK/m3_idsonly.sql"; expect_rc 3 "M3 with only the id fingerprint substituted"
expect_stderr_has "hierarchy M3 refused: the 4 stale row(s) would be repaired to paths that are not the reviewed targets (target fingerprint $(q "$DB" "SELECT hierarchy_test.stale_target_fingerprint()"))" "M3 ids-only copy"
unchanged_since "$DB" m3pre "M3 ids-only refusal"
ok "M3 with the right stale ids but production's reviewed TARGET fingerprint REFUSES the synthetic set (both fingerprints are required); nothing changed"
hs_m3_copy "$DB" "$WORK/m3_run.sql"
[ "$(diff "$HS_M3" "$WORK/m3_run.sql" | grep -c '^[<>]')" = 4 ] || fail "the runner's M3 copy differs from the file in more than the two fingerprint lines"
q "$DB" "SELECT hierarchy_test.take_snap('m3')" >/dev/null
set +e
psql -X -v ON_ERROR_STOP=1 "$PGURL/$DB" -c "BEGIN" -c "SET LOCAL track_functions = 'all'" -c "TRUNCATE hierarchy_test.set_claim_calls, hierarchy_test.side_effects" \
  -f "$WORK/m3_run.sql" \
  -c "SELECT 'fired ' || string_agg(funcname || '=' || calls, ' ' ORDER BY funcname) FROM pg_stat_xact_user_functions
       WHERE funcname IN ('update_hierarchy_path', 'lock_profile_hierarchy', 'cascade_hierarchy_update', 'build_hierarchy_path',
                          'on_profile_update', 'set_claim', 'on_uv_profile_saved', 'enqueue_platform_admin_user_registered')" \
  -c "SELECT 'changed ' || string_agg(key || ':' || what, ' ' ORDER BY key COLLATE \"C\") FROM hierarchy_test.diff_snap('m3')" \
  -c "SELECT 'claims ' || count(*) || ' side_effects ' || (SELECT count(*) FROM hierarchy_test.side_effects) FROM hierarchy_test.set_claim_calls" \
  -c "COMMIT" >"$OUT" 2>"$ERR"
RC=$?
set -e
expect_rc 0 "M3 synthetic copy"
expect_stderr_has "hierarchy M3: 4 row(s) repaired; 15 of 15 expected ancestor pairs present" "M3 summary notice"
[ "$(grep -Ec 'hierarchy M3 repair aa000000: depth [0-9]+ -> [0-9]+, parent (none|[0-9a-f]{8}) -> [0-9a-f]{8}$' "$ERR")" = 4 ] \
  || { cat "$ERR" >&2; fail "M3: expected one NOTICE per repaired row (id8, old and new depth, old and new parent id8)"; }
expect_stdout_has "changed A1:path,updated_at A2:path,updated_at D1:path,updated_at D2:path,updated_at" "M3 touched exactly the stale rows"
expect_stdout_has "claims 8 side_effects 0" "M3 set_claim writes"
expect_stdout_has "fired build_hierarchy_path=4 lock_profile_hierarchy=1 on_profile_update=4 set_claim=8 update_hierarchy_path=4" "M3 functions fired"
expect_stdout_lacks "cascade_hierarchy_update=" "M3 cascade"
ok "M3 repairs exactly the 4 stale rows (one NOTICE each; path + updated_at only), the path and lock triggers fire and re-derive the same value, the cascade does not fire, 8 set_claim writes, no UV / notification side effect"
q "$DB" "SELECT row(stale_paths, missing_pairs, extra_pairs, null_paths, path_pairs, expected_pairs)::text FROM private.hierarchy_consistency()" | grep -qx '(0,0,0,0,15,15)' \
  || fail "M3 postcondition"
snapshot "$DB" m3post
run_file "$DB" "$WORK/m3_run.sql"; expect_rc 0 "M3 second run"; expect_stderr_has "hierarchy M3: no stale hierarchy path; nothing to repair (no-op)" "M3 second run"
expect_stderr_has "hierarchy M3: 0 row(s) repaired" "M3 second run"
unchanged_since "$DB" m3post "M3 second run"
run_file "$DB" "$WORK/m3_unmodified.sql"; expect_rc 0 "unmodified M3 on 0 stale rows"; expect_stderr_has "nothing to repair (no-op)" "unmodified M3 no-op"
unchanged_since "$DB" m3post "unmodified M3 no-op"
ok "M3 second run and the unmodified file on repaired data are no-ops (0 rows; catalog and data unchanged)"

# INT-1: an Admin re-parents one of the reviewed stale rows to another Team Leader in the M1-only window (the preimage
# triggers keep it stale): the stale ids — and so the id fingerprint — are unchanged, the targets are not. The copy
# substituted for the UNDRIFTED synthetic set must refuse.
state_db S1 m3_reparent
FP0="$(q "$DB" "SELECT hierarchy_test.stale_fingerprint() || '/' || hierarchy_test.stale_target_fingerprint()")"
[ "$FP0" = "$(q "$DB" "SELECT hierarchy_test.stale_fingerprint()")/$(grep -o "c_reviewed_target_fingerprint CONSTANT text := '[0-9a-f]*'" "$WORK/m3_run.sql" | grep -o '[0-9a-f]\{32\}')" ] \
  || fail "re-parent drift: the substituted copy does not carry this database's undrifted fingerprints"
R_ID="$(q "$DB" "SELECT hierarchy_test.id('R')")"; K1="$(q "$DB" "SELECT hierarchy_test.id('K1')")"; A1="$(q "$DB" "SELECT hierarchy_test.id('A1')")"
[ "$(q "$DB" "SELECT hierarchy_test.as_user('$R_ID', format('UPDATE public.profiles SET role = %L WHERE id = %L', 'Team Leader', '$K1'))")" = "OK 1" ] \
  || fail "re-parent drift: the Admin could not promote K1"
[ "$(q "$DB" "SELECT hierarchy_test.as_user('$R_ID', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', '$K1', '$A1'))")" = "OK 1" ] \
  || fail "re-parent drift: the Admin could not move A1 under K1"
run_file "$DB" "$HS_M2"; expect_rc 0 "M2 on the re-parented set"
FP1="$(q "$DB" "SELECT hierarchy_test.stale_fingerprint() || '/' || hierarchy_test.stale_target_fingerprint()")"
[ "${FP0%%/*}" = "${FP1%%/*}" ] && [ "${FP0#*/}" != "${FP1#*/}" ] \
  || fail "re-parent drift: expected the same id fingerprint and a different target fingerprint ($FP0 -> $FP1)"
snapshot "$DB" m3drift
run_file "$DB" "$WORK/m3_run.sql"; expect_rc 3 "M3 on a re-parented stale set"
expect_stderr_has "hierarchy M3 refused: the 4 stale row(s) would be repaired to paths that are not the reviewed targets (target fingerprint ${FP1#*/})" "M3 on a re-parented stale set"
unchanged_since "$DB" m3drift "M3 re-parent refusal"
ok "M3 REFUSES the reviewed stale rows after an Admin re-parented one of them (id fingerprint ${FP0%%/*} unchanged, target fingerprint ${FP0#*/} -> ${FP1#*/}); nothing changed"

# ── 5. Two-session concurrency (M1 + M2 + M3 applied) ───────────────────────────────────────────────────────────
echo
echo "== 5 concurrency =="
CONC_ERR="$WORK/conc"
bg_session() {   # bg_session <db> <file-prefix> <sql...>: a second session in the background
  local db="$1" pfx="$2"; shift 2
  psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$db" "$@" >"$pfx.out" 2>"$pfx.err" &
  BG+=("$!")
}
wait_active() {   # wait_active <db> <query text fragment>
  for _ in $(seq 1 100); do
    [ "$(q postgres "SELECT count(*) FROM pg_stat_activity WHERE datname = '$1' AND query LIKE '%$2%' AND state <> 'idle'")" -ge 1 ] && return 0
    sleep 0.05
  done
  fail "concurrency: the first session never started ($2)"
}
# READ COMMITTED: the hierarchy lock trigger serializes statements that list a hierarchy column, and the builder's
# FOR SHARE ancestor walk makes a writer below a moving node wait for the mover. The cases below assert the outcome,
# how long the second session was blocked, and the lock it was observed waiting on (the statement-level advisory lock
# is taken first, so that is where it blocks). They do NOT prove which mechanism is necessary: the security review
# found the FOR SHARE walk alone also serializes the 2-cycle and the insert race, and only the deadlock pattern below
# depends on the advisory lock.
# second_session <tag> <sql...>: runs a second session in the background, samples what its tagged statement waits on
# while blocked (W), then waits for it (RC; stdout/stderr in $OUT/$ERR; WAIT_MS = its wall time).
second_session() {
  local tag="$1" p t0 t1; shift
  t0="$(date +%s%N)"
  set +e
  psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$DB" "$@" >"$OUT" 2>"$ERR" &
  p=$!; BG+=("$p")
  W=""
  for _ in $(seq 1 150); do
    W="$(q postgres "SELECT coalesce(string_agg(DISTINCT wait_event_type || '/' || wait_event, ','), '') FROM pg_stat_activity
                     WHERE datname = '$DB' AND query LIKE '%$tag%' AND wait_event_type = 'Lock'")"
    [ -n "$W" ] && break
    sleep 0.02
  done
  wait "$p"; RC=$?
  set -e
  t1="$(date +%s%N)"; WAIT_MS=$(( (t1 - t0) / 1000000 ))
}
ISO="READ COMMITTED"; iso=rc
state_db S3 "conc_cycle_$iso"
K1="$(q "$DB" "SELECT hierarchy_test.id('K1')")"; K2="$(q "$DB" "SELECT hierarchy_test.id('K2')")"
bg_session "$DB" "$CONC_ERR.a" -c "BEGIN ISOLATION LEVEL $ISO" -c "UPDATE public.profiles SET upline_id = '$K2' WHERE id = '$K1'" -c "SELECT pg_sleep(1.5) /* conc-a */" -c "COMMIT"
wait_active "$DB" "conc-a"
second_session conc-a2 -c "BEGIN ISOLATION LEVEL $ISO" -c "SELECT 1" -c "UPDATE public.profiles SET upline_id = '$K1' WHERE id = '$K2' /* conc-a2 */" -c "COMMIT"
wait "${BG[-2]}" || fail "concurrency: the first mover failed: $(cat "$CONC_ERR.a.err")"
expect_failed "concurrent 2-cycle ($ISO)"
expect_stderr_has "Hierarchy: this upline would create a reporting cycle" "concurrent 2-cycle ($ISO)"
[ "$W" = "Lock/advisory" ] || fail "concurrent 2-cycle ($ISO): the second mover was observed waiting on '$W', not the hierarchy advisory lock"
[ "$WAIT_MS" -ge 1000 ] || fail "concurrent 2-cycle ($ISO): the second mover was not blocked until the first committed (${WAIT_MS} ms)"
q "$DB" "SELECT row(self_parents, unreachable, stale_paths, missing_pairs, extra_pairs)::text FROM private.hierarchy_consistency()" | grep -qx '(0,0,0,0,0)' \
  || fail "concurrency: hierarchy inconsistent after the 2-cycle race ($ISO)"
ok "concurrent X->Y / Y->X ($ISO): the second mover is blocked ${WAIT_MS} ms (observed waiting on Lock/advisory) until the first commits, then rejected as a cycle; no cycle, all paths canonical"

state_db S3 "conc_insert_$iso"
T="$(q "$DB" "SELECT hierarchy_test.id('T')")"; K3="$(q "$DB" "SELECT hierarchy_test.id('K3')")"; A1="$(q "$DB" "SELECT hierarchy_test.id('A1')")"
q "$DB" "INSERT INTO auth.users (id) VALUES ('a8000000-0000-4000-8000-000000000001')" >/dev/null
bg_session "$DB" "$CONC_ERR.b" -c "BEGIN ISOLATION LEVEL $ISO" -c "UPDATE public.profiles SET upline_id = '$K3' WHERE id = '$T'" -c "SELECT pg_sleep(1.5) /* conc-b */" -c "COMMIT"
wait_active "$DB" "conc-b"
second_session conc-b2 -c "BEGIN ISOLATION LEVEL $ISO" -c "SELECT 1" \
  -c "INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES ('a8000000-0000-4000-8000-000000000001', hierarchy_test.org('A'), '$A1', 'Synthetic N') /* conc-b2 */" \
  -c "COMMIT"
wait "${BG[-2]}" || fail "concurrency: the mover failed: $(cat "$CONC_ERR.b.err")"
expect_rc 0 "insert under a moving node ($ISO)"
[ "$W" = "Lock/advisory" ] || fail "insert under a moving node ($ISO): the insert was observed waiting on '$W', not the hierarchy advisory lock"
[ "$WAIT_MS" -ge 1000 ] || fail "insert under a moving node ($ISO): the insert was not blocked until the mover committed (${WAIT_MS} ms)"
q "$DB" "SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = 'a8000000-0000-4000-8000-000000000001'" | grep -qx 'R.K3.T.A1.a8000000' \
  || fail "concurrency: the inserted row did not get the moved chain"
q "$DB" "SELECT row(self_parents, unreachable, stale_paths, missing_pairs, extra_pairs)::text FROM private.hierarchy_consistency()" | grep -qx '(0,0,0,0,0)' \
  || fail "concurrency: hierarchy inconsistent after insert-under-move ($ISO)"
ok "insert under a node whose ancestor is moving ($ISO): blocked ${WAIT_MS} ms (observed waiting on Lock/advisory) until the mover commits, then stores the moved chain; all paths canonical"

# REPEATABLE READ / SERIALIZABLE (INT-2): the snapshot predates the hierarchy lock, so every hierarchy statement is
# refused before the lock with 0A000 (a retry at the same level could never succeed).
RRMSG="0A000: Hierarchy: upline and organization changes must run in a READ COMMITTED transaction"
state_db S3 conc_rr_refused
K1="$(q "$DB" "SELECT hierarchy_test.id('K1')")"; K2="$(q "$DB" "SELECT hierarchy_test.id('K2')")"; A1="$(q "$DB" "SELECT hierarchy_test.id('A1')")"
q "$DB" "INSERT INTO auth.users (id) VALUES ('a8000000-0000-4000-8000-000000000002')" >/dev/null
snapshot "$DB" rr
for ISO in "REPEATABLE READ" "SERIALIZABLE"; do
  for stmt in "UPDATE public.profiles SET upline_id = '$K2' WHERE id = '$K1'" \
              "UPDATE public.profiles SET organization_id = hierarchy_test.org('B'), upline_id = NULL WHERE id = '$K1'" \
              "INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES ('a8000000-0000-4000-8000-000000000002', hierarchy_test.org('A'), '$A1', 'Synthetic N2')"; do
    set +e
    psql -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "$PGURL/$DB" -c "BEGIN ISOLATION LEVEL $ISO" -c "$stmt" -c "COMMIT" >"$OUT" 2>"$ERR"
    RC=$?
    set -e
    expect_failed "$ISO hierarchy statement"; expect_stderr_has "$RRMSG" "$ISO hierarchy statement (${stmt:0:40}…)"
  done
done
psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$DB" -c "BEGIN ISOLATION LEVEL REPEATABLE READ" -c "UPDATE public.profiles SET last_login_at = last_login_at WHERE id = '$K1'" \
  -c "UPDATE public.profiles SET phone = phone WHERE id = '$K1'" -c "ROLLBACK" >"$OUT" 2>"$ERR" \
  || { cat "$ERR" >&2; fail "REPEATABLE READ: a statement listing no hierarchy column was refused"; }
unchanged_since "$DB" rr "REPEATABLE READ / SERIALIZABLE refusals"
ok "REPEATABLE READ and SERIALIZABLE: upline moves, organization changes and profile inserts are refused before the hierarchy lock ($RRMSG); statements listing no hierarchy column still run; nothing changed"

# The INT-2 race: a REPEATABLE READ mover (A1: out of Team Leader T's branch, under K3) whose snapshot predates a READ
# COMMITTED insert under A1. Before the fix the mover committed, its cascade missed the new member, and T kept
# ancestry over it (fail-open); now the mover is refused and the inserted row is canonical.
state_db S3 conc_rr_race
K3="$(q "$DB" "SELECT hierarchy_test.id('K3')")"; A1="$(q "$DB" "SELECT hierarchy_test.id('A1')")"
q "$DB" "INSERT INTO auth.users (id) VALUES ('a8000000-0000-4000-8000-000000000003')" >/dev/null
bg_session "$DB" "$CONC_ERR.r" -v VERBOSITY=verbose -c "BEGIN ISOLATION LEVEL REPEATABLE READ" -c "SELECT count(*) FROM public.profiles" \
  -c "SELECT pg_sleep(1.5) /* conc-r */" -c "UPDATE public.profiles SET upline_id = '$K3' WHERE id = '$A1'" -c "COMMIT"
wait_active "$DB" "conc-r"
psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$DB" \
  -c "INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES ('a8000000-0000-4000-8000-000000000003', hierarchy_test.org('A'), '$A1', 'Synthetic N3')" \
  >"$OUT" 2>"$ERR" || { cat "$ERR" >&2; fail "INT-2 race: the READ COMMITTED insert failed"; }
set +e; wait "${BG[-1]}"; RCR=$?; set -e
[ "$RCR" != 0 ] && grep -qF "$RRMSG" "$CONC_ERR.r.err" || { cat "$CONC_ERR.r.err" >&2; fail "INT-2 race: the REPEATABLE READ mover was not refused"; }
q "$DB" "SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = 'a8000000-0000-4000-8000-000000000003'" | grep -qx 'R.T.A1.a8000000' \
  || fail "INT-2 race: the inserted row is not canonical"
q "$DB" "SELECT row(self_parents, unreachable, stale_paths, missing_pairs, extra_pairs, cross_org_edges)::text FROM private.hierarchy_consistency()" | grep -qx '(0,0,0,0,0,0)' \
  || fail "INT-2 race: hierarchy inconsistent"
ok "INT-2 race (REPEATABLE READ mover vs READ COMMITTED insert under the moving subtree): the mover is refused (0A000), the insert commits canonical; all paths canonical, no cross-organization edge"

# A REPEATABLE READ statement that lists no hierarchy column (login sync) still waits for a mover's FOR SHARE lock on
# the row, then succeeds.
for ISO in "READ COMMITTED" "REPEATABLE READ"; do
  iso="$(echo "$ISO" | tr ' [:upper:]' '_[:lower:]')"
  state_db S3 "conc_login_$iso"
  R="$(q "$DB" "SELECT hierarchy_test.id('R')")"; K1="$(q "$DB" "SELECT hierarchy_test.id('K1')")"; T="$(q "$DB" "SELECT hierarchy_test.id('T')")"
  bg_session "$DB" "$CONC_ERR.c" -c "BEGIN" -c "UPDATE public.profiles SET upline_id = '$T' WHERE id = '$K1'" -c "SELECT pg_sleep(2) /* conc-c */" -c "COMMIT"
  wait_active "$DB" "conc-c"
  T0="$(date +%s%N)"
  set +e
  psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$DB" -c "BEGIN ISOLATION LEVEL $ISO" -c "SELECT 1" -c "UPDATE public.profiles SET last_login_at = now() WHERE id = '$R'" -c "COMMIT" >"$OUT" 2>"$ERR"
  RC=$?
  set -e
  T1="$(date +%s%N)"
  wait "${BG[-1]}" || fail "concurrency: the mover failed: $(cat "$CONC_ERR.c.err")"
  expect_rc 0 "ancestor login-sync during a move ($ISO)"
  WAIT_MS=$(( (T1 - T0) / 1000000 ))
  [ "$WAIT_MS" -ge 1000 ] || fail "concurrency: the ancestor login-sync did not wait for the mover (${WAIT_MS} ms)"
  ok "ancestor login-sync during a move ($ISO): waits ${WAIT_MS} ms for the mover's FOR SHARE lock, then succeeds"
done
state_db S3 conc_deadlock
R="$(q "$DB" "SELECT hierarchy_test.id('R')")"; K1="$(q "$DB" "SELECT hierarchy_test.id('K1')")"; K3="$(q "$DB" "SELECT hierarchy_test.id('K3')")"; T="$(q "$DB" "SELECT hierarchy_test.id('T')")"
bg_session "$DB" "$CONC_ERR.d" -c "BEGIN" -c "UPDATE public.profiles SET status = status WHERE id = '$R'" -c "SELECT pg_sleep(1) /* conc-d */" -c "UPDATE public.profiles SET upline_id = upline_id WHERE id = '$K3'" -c "COMMIT"
wait_active "$DB" "conc-d"
set +e
psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$DB" -c "BEGIN" -c "UPDATE public.profiles SET upline_id = '$T' WHERE id = '$K1'" -c "COMMIT" >"$OUT" 2>"$ERR"
RC=$?
wait "${BG[-1]}"; RCD=$?
set -e
if { [ "$RC" = 0 ] && [ "$RCD" = 0 ]; } || { [ "$RC" != 0 ] && [ "$RCD" != 0 ]; }; then
  fail "deadlock pattern: expected exactly one side to fail (mover rc=$RC, other rc=$RCD)"
fi
cat "$ERR" "$CONC_ERR.d.err" | grep -qF "deadlock detected" || fail "deadlock pattern: no 'deadlock detected'"
q "$DB" "SELECT row(self_parents, unreachable, stale_paths, missing_pairs, extra_pairs)::text FROM private.hierarchy_consistency()" | grep -qx '(0,0,0,0,0)' \
  || fail "concurrency: hierarchy inconsistent after the deadlock"
ok "deadlock pattern (row lock on an ancestor, then a hierarchy statement, against a mover): PostgreSQL aborts exactly one side; all paths canonical"

# ── 6. Later stages (each by explicit name; pinned PASS counts) ──────────────────────────────────────────────────
echo
echo "== 6 later stages =="
declare -A LATER_TOTAL
for suite in "$RLS_SUITE" "$RPC_SUITE"; do
  name="$(basename "$suite")"
  if [ ! -f "$suite" ]; then
    [ "${CI:-}" != true ] || fail "CI=true but $name is missing"
    NOT_EXECUTED+=("$name (file not present)"); echo "   NOT EXECUTED $name (file not present)"; continue
  fi
  LATER_TOTAL[$name]=0
  for st in $HS_STATES; do
    state_db "$st" "later_$(echo "${name%%.sql}_$st" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_' '_' | cut -c1-40)"
    snapshot "$DB" later
    set +e
    # shellcheck disable=SC2046
    psql -X -qAt -v ON_ERROR_STOP=1 $(flags "$st") -f "$suite" "$PGURL/$DB" >"$OUT" 2>"$ERR"
    RC=$?
    set -e
    [ "$RC" = 0 ] || { grep -v '^PASS' "$OUT" >&2 || true; cat "$ERR" >&2; fail "$name on $st (exit $RC)"; }
    n="$(grep -c '^PASS ' "$OUT" || true)"
    ! grep -q '^FAIL' "$OUT" || fail "$name on $st printed FAIL"
    [ "$n" = "${EXPECT_LATER[$name]}" ] || fail "$name on $st: $n cases, expected ${EXPECT_LATER[$name]} (pinned)"
    unchanged_since "$DB" later "$name on $st"
    PASSES=$((PASSES + n))
    LATER_TOTAL[$name]=$(( ${LATER_TOTAL[$name]} + n ))
    echo "   PASS $name on $st: $n cases (= pinned ${EXPECT_LATER[$name]})"
  done
done
HTTP_STAGES=()
for f in "$FORGED" "$COMPAT_TEST"; do
  if [ -f "$f" ]; then HTTP_STAGES+=("$f")
  else
    [ "${CI:-}" != true ] || fail "CI=true but ${f#"$ROOT"/} is missing"
    NOT_EXECUTED+=("$(basename "$f") (file not present)"); echo "   NOT EXECUTED $(basename "$f") (file not present)"
  fi
done
if [ "${#HTTP_STAGES[@]}" -gt 0 ]; then
  if [ -z "${POSTGREST_BIN:-}" ]; then
    for f in "${HTTP_STAGES[@]}"; do NOT_EXECUTED+=("$(basename "$f") (POSTGREST_BIN not set)"); echo "   NOT EXECUTED $(basename "$f") (POSTGREST_BIN not set)"; done
  else
    [ -x "$POSTGREST_BIN" ] || fail "POSTGREST_BIN is not executable"
    echo "   PostgREST: $("$POSTGREST_BIN" --version 2>&1 | head -1)"
    ENVS=()
    for st in $HS_STATES; do
      state_db "$st" "rest_$(echo "$st" | tr '[:upper:]' '[:lower:]')"
      ENVS+=("HIERARCHY_DB_$st=$PGURL/$DB")
    done
    # Each stage clones every state database it is given (…_forged / …_compat) and drops its clones, so one
    # stage's writes never reach the next; each prints one 'PASS <state> <case>' line per case (counted here).
    if [ -f "$FORGED" ]; then
      set +e
      env "${ENVS[@]}" HIERARCHY_STATES="$HS_STATES" PGURL="$PGURL" POSTGREST_BIN="$POSTGREST_BIN" node "$FORGED" >"$OUT" 2>"$ERR"
      RC=$?
      set -e
      cat "$OUT"
      [ "$RC" = 0 ] || { cat "$ERR" >&2; fail "$(basename "$FORGED") (exit $RC)"; }
      ! grep -q '^FAIL' "$OUT" || fail "$(basename "$FORGED") printed FAIL"
      n="$(grep -c '^PASS ' "$OUT" || true)"
      [ "$n" = "${EXPECT_LATER[postgrest_forged.mjs]}" ] || fail "$(basename "$FORGED"): $n cases, expected ${EXPECT_LATER[postgrest_forged.mjs]} (pinned)"
      PASSES=$((PASSES + n))
      LATER_TOTAL[postgrest_forged.mjs]=$n
      echo "   PASS $(basename "$FORGED") against PostgREST on $HS_STATES: $n cases (= pinned ${EXPECT_LATER[postgrest_forged.mjs]})"
    fi
    if [ -f "$COMPAT_TEST" ]; then
      [ -x "$VITEST" ] || fail "vitest is not installed at ${VITEST#"$ROOT"/} (npm ci); the compatibility suite cannot run"
      cname="$(basename "$COMPAT_TEST")"
      set +e
      (cd "$ROOT" && env "${ENVS[@]}" HIERARCHY_STATES="$HS_STATES" PGURL="$PGURL" POSTGREST_BIN="$POSTGREST_BIN" \
         HIERARCHY_COMPAT=1 HIERARCHY_COMPAT_REPORT="$WORK/compat_matrix.txt" NO_COLOR=1 "$VITEST" run "${COMPAT_TEST#"$ROOT"/}") >"$OUT" 2>"$ERR"
      RC=$?
      set -e
      [ ! -f "$WORK/compat_matrix.txt" ] || cat "$WORK/compat_matrix.txt"
      tail -n 8 "$OUT"
      [ "$RC" = 0 ] || { grep -E 'FAIL|AssertionError|Expected|Received|threw' "$OUT" | head -80 >&2; cat "$ERR" >&2; fail "$cname (exit $RC)"; }
      # The suite skips itself without HIERARCHY_COMPAT=1: a run where only the precondition test passed proves nothing.
      # (Colour codes are stripped in case the CI environment forces them; no match must not abort under set -e.)
      sed -E 's/\x1b\[[0-9;]*m//g' "$OUT" > "$WORK/compat_plain.txt"
      n="$(grep -Eo 'Tests +[0-9]+ passed' "$WORK/compat_plain.txt" | grep -Eo '[0-9]+' | tail -n 1 || true)"
      [ -n "$n" ] && ! grep -Eq 'Tests .*(skipped|failed)' "$WORK/compat_plain.txt" \
        || fail "$cname: the compatibility cases did not all run"
      [ "$n" = "${EXPECT_LATER[$cname]}" ] || fail "$cname: $n tests, expected ${EXPECT_LATER[$cname]} (pinned)"
      PASSES=$((PASSES + n))
      LATER_TOTAL[$cname]=$n
      echo "   PASS $cname (real frontend data-layer modules via supabase-js) on $HS_STATES: $n tests (= pinned ${EXPECT_LATER[$cname]})"
    fi
    # The stages must leave nothing behind (their harness drops every clone and authenticator role it creates); a
    # leftover clone of this run is dropped here, and either kind of leftover OF THIS RUN fails it. Roles another run
    # or session left (other prefixes) are only listed.
    left="$(q postgres "SELECT coalesce(string_agg(datname, ' '), '') FROM pg_database
                         WHERE starts_with(datname, '${PFX}rest_') AND (datname LIKE '%\_forged' OR datname LIKE '%\_compat')")"
    roles="$(q postgres "SELECT coalesce(string_agg(rolname, ' '), '') FROM pg_roles WHERE starts_with(rolname, '${HIER_REST_ROLE_PREFIX}')")"
    foreign="$(q postgres "SELECT coalesce(string_agg(rolname, ' '), '') FROM pg_roles
                            WHERE (rolname LIKE 'hier\_rest\_%' OR rolname ~ '^hier_[0-9]+_rest_') AND NOT starts_with(rolname, '${HIER_REST_ROLE_PREFIX}')")"
    for d in $left; do psql -X -q "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $d WITH (FORCE)" >/dev/null 2>&1 || true; done
    [ -z "$left" ] && [ -z "$roles" ] || fail "PostgREST stages left clones ($left) or authenticator roles ($roles) behind"
    [ -z "$foreign" ] || echo "   NOTE: authenticator roles from other runs exist on this cluster (not this run's; not a failure): $foreign"
    ok "PostgREST stages dropped every database clone and authenticator role this run created"
  fi
fi

echo
echo "======================================================================"
echo " ALL HIERARCHY STABILIZATION PROOFS PASSED on PostgreSQL $SERVER_VERSION: $PASSES PASS lines"
for st in $HS_STATES; do echo "   core suite $st: ${STATE_PASS[$st]} cases (pinned ${EXPECT_CORE[$st]})"; done
for k in hierarchy_stabilization_rls.sql hierarchy_stabilization_rpcs.sql postgrest_forged.mjs hierarchyFrontendCompat.integration.test.ts; do
  [ -z "${LATER_TOTAL[$k]:-}" ] || echo "   $k: ${LATER_TOTAL[$k]} in total over $HS_STATES"
done
if [ "${#NOT_EXECUTED[@]}" -gt 0 ]; then
  echo " NOT EXECUTED (not evidence):"
  for x in "${NOT_EXECUTED[@]}"; do echo "   - $x"; done
fi
echo " Disposable local database verification only; never run against production."
echo "======================================================================"
