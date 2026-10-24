#!/usr/bin/env bash
# =====================================================================================================
# Hierarchy stabilization — build ONE disposable database in a named state (development helper and library).
# DISPOSABLE LOCAL PostgreSQL ONLY (AGENT_RULES invariant #28). Synthetic data only. Refuses anything else.
# =====================================================================================================
# Usage:  PGURL=postgresql://postgres@127.0.0.1:<port> scripts/hierarchy_test_state.sh <state> <database> [--replace]
#   <state>     S0   verbatim production preimage + production-shaped stale data (scripts/hierarchy_fixture.py)
#               S1   S0 + M1 (20261023210027_hierarchy_authorization_boundaries; authored as 20261023210000,
#                    renamed to the version production recorded at Gate 2a, bytes unchanged)
#               S2   S1 + M2 (20261023232435_hierarchy_integrity; authored as pending/20261023210100, renamed to the
#                    version production recorded at Gate 2b, bytes unchanged)
#               S3   S2 + M3 (20261024045812_hierarchy_path_repair; authored as pending/20261023210200, executed at
#                    Gate 2c and recorded history-only under that version, bytes unchanged; run from a temporary copy
#                    whose two reviewed fingerprints — stale ids and stale ids with their target paths — are replaced
#                    by the synthetic stale set's)
#               S1R  S1 then the M1 rollback;  S2R  S2 then the M2 rollback;  S3R  S3 then the M2 and M1 rollbacks
#   <database>  must match ^hier_[a-z0-9_]{1,50}$; it must not exist, unless --replace is given AND it carries the
#               synthetic sentinel (then it is dropped and rebuilt).
# Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §8. Files are applied by EXPLICIT list,
# each migration in one transaction (psql -1 -f). Supabase apply_migration instead sends the whole file as ONE
# multi-statement simple query (one implicit transaction, SET LOCAL effective); the security review applied M1 and M2
# both ways and got identical inventories, data and notices. Never point this at production.
#
# Sourcing it (HIERARCHY_STATE_LIB=1 source scripts/hierarchy_test_state.sh) only defines the hs_* functions and
# the file paths below; scripts/run_hierarchy_stabilization_tests.sh builds every state through hs_build.
set -euo pipefail
set +o xtrace   # commands carry the URL, which may hold a password: never trace them

HS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HS_M1="$HS_ROOT/supabase/migrations/20261023210027_hierarchy_authorization_boundaries.sql"
HS_M2="$HS_ROOT/supabase/migrations/20261023232435_hierarchy_integrity.sql"
HS_M3="$HS_ROOT/supabase/migrations/20261024045812_hierarchy_path_repair.sql"
HS_R1="$HS_ROOT/supabase/migrations/rollback/20261023210027_hierarchy_authorization_boundaries.rollback.sql"
HS_R2="$HS_ROOT/supabase/migrations/rollback/20261023232435_hierarchy_integrity.rollback.sql"
HS_R3="$HS_ROOT/supabase/migrations/rollback/20261024045812_hierarchy_path_repair.rollback.sql"
HS_FIXTURE_PY="$HS_ROOT/scripts/hierarchy_fixture.py"
HS_REVIEWED_FINGERPRINT="ddc1f53f3823c6e367310a748ea0ac85"          # M3 c_reviewed_fingerprint (stale ids)
HS_REVIEWED_TARGET_FINGERPRINT="7daae418571600b43b7cf5d5155be0d4"   # M3 c_reviewed_target_fingerprint (ids + target paths)
HS_SENTINEL="agentflow-hierarchy-synthetic-fixture"
HS_STATES="S0 S1 S2 S3 S1R S2R S3R"

hs_refuse() { echo "REFUSING: $*" >&2; exit 2; }

# hs_check_url: PGURL is exactly postgres(ql)://postgres[:password]@127.0.0.1|localhost:<port>, no libpq overrides.
hs_check_url() {
  local v
  for v in PGHOST PGHOSTADDR PGSERVICE PGSERVICEFILE PGDATABASE PGOPTIONS; do
    [ -z "${!v:-}" ] || hs_refuse "$v is set; it could send libpq somewhere other than the validated host"
  done
  local re='^postgres(ql)?://postgres(:[A-Za-z0-9._~-]*)?@(127\.0\.0\.1|localhost):[0-9]{1,5}$'
  [[ "${PGURL:-}" =~ $re ]] || hs_refuse "PGURL must be postgresql://postgres[:password]@127.0.0.1|localhost:<port> and nothing else"
}

hs_q() { psql -X -qAt -v ON_ERROR_STOP=1 "$PGURL/$1" -c "$2"; }

# hs_prove_local <db>: loopback server, postgres superuser, no hosted platform roles, no production-named database.
hs_prove_local() {
  local row addr usr su hosted prodref
  row="$(hs_q "$1" "SELECT coalesce(host(inet_server_addr()), 'unix-socket') || '|' || current_user || '|' ||
                        (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)::text || '|' ||
                        (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('supabase_admin', 'authenticator',
                           'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user'))::text || '|' ||
                        EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'jncvvsvckxhqgqvkppmj')::text")" \
    || hs_refuse "cannot connect to the local server (libpq's message is withheld because it can echo the URL)"
  IFS='|' read -r addr usr su hosted prodref <<<"$row"
  case "$addr" in 127.0.0.1|::1|unix-socket) ;; *) hs_refuse "server address $addr is not loopback";; esac
  [ "$usr" = postgres ] && [ "$su" = true ] || hs_refuse "connected as $usr (superuser=$su), not the postgres superuser"
  [ "$hosted" = 0 ] || hs_refuse "hosted platform roles exist on this server; disposable clusters only"
  [ "$prodref" = false ] || hs_refuse "a database named after the production project exists on this server"
}

# hs_prove_synthetic <db>: a database built by this helper (sentinel, synthetic profiles only).
hs_prove_synthetic() {
  local marker others
  marker="$(hs_q "$1" "SELECT string_agg(marker, ',') FROM hierarchy_test.synthetic_sentinel" 2>/dev/null)" \
    || hs_refuse "database $1 has no synthetic sentinel"
  [ "$marker" = "$HS_SENTINEL" ] || hs_refuse "database $1 lacks the synthetic sentinel"
  others="$(hs_q "$1" "SELECT count(*) FROM public.profiles WHERE first_name NOT LIKE 'Synthetic %'")"
  [ "$others" = 0 ] || hs_refuse "database $1 holds non-synthetic profile rows"
}

# hs_apply <db> <file> [psql options...]: one transaction, ON_ERROR_STOP; output to stderr only on failure.
hs_apply() {
  local db="$1" file="$2" out
  shift 2
  hs_prove_synthetic "$db"
  out="$(psql -X -q -1 -v ON_ERROR_STOP=1 "$@" -f "$file" "$PGURL/$db" 2>&1)" || { echo "$out" >&2; return 1; }
}

# hs_m3_copy <db> <out-file> [ids-only]: M3 with BOTH reviewed fingerprints replaced by <db>'s current stale-set
# fingerprints (with 'ids-only', only the id fingerprint: the target check must then refuse).
hs_m3_copy() {
  local fp tfp
  fp="$(hs_q "$1" "SELECT coalesce(hierarchy_test.stale_fingerprint(), '')")"
  tfp="$(hs_q "$1" "SELECT coalesce(hierarchy_test.stale_target_fingerprint(), '')")"
  [ "$(grep -c "$HS_REVIEWED_FINGERPRINT" "$HS_M3")" = 1 ] || hs_refuse "M3 does not carry the reviewed fingerprint exactly once"
  [ "$(grep -c "$HS_REVIEWED_TARGET_FINGERPRINT" "$HS_M3")" = 1 ] || hs_refuse "M3 does not carry the reviewed target fingerprint exactly once"
  if [ -z "$fp" ]; then cp "$HS_M3" "$2"
  elif [ "${3:-}" = ids-only ]; then sed "s/$HS_REVIEWED_FINGERPRINT/$fp/" "$HS_M3" > "$2"
  else sed -e "s/$HS_REVIEWED_FINGERPRINT/$fp/" -e "s/$HS_REVIEWED_TARGET_FINGERPRINT/$tfp/" "$HS_M3" > "$2"; fi
}

# hs_create_s0 <db> [<fixture.sql>]: a new database loaded with the fixture (schema + data).
hs_create_s0() {
  local db="$1" fixture="${2:-}" work
  work="$(mktemp -d)"
  hs_prove_local postgres
  psql -X -q -v ON_ERROR_STOP=1 "$PGURL/postgres" -c "CREATE DATABASE $db" >/dev/null
  if [ -z "$fixture" ]; then fixture="$work/fixture.sql"; python3 -I "$HS_FIXTURE_PY" > "$fixture"; fi
  if ! psql -X -q -v ON_ERROR_STOP=1 -f "$fixture" "$PGURL/$db" >/dev/null 2>"$work/err"; then
    cat "$work/err" >&2; rm -rf "$work"
    psql -X -q "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true   # created just above
    hs_refuse "the fixture did not load into $db (database dropped)"
  fi
  rm -rf "$work"
  hs_prove_synthetic "$db"
}

# hs_advance <db> <from-state> <to-state>: apply the files that turn one state into the next (explicit list).
hs_advance() {
  local db="$1" from="$2" to="$3" copy
  case "$from>$to" in
    "S0>S1"|"S1R>S1") hs_apply "$db" "$HS_M1" ;;
    "S1>S2"|"S2R>S2") hs_apply "$db" "$HS_M2" ;;
    "S2>S3")          copy="$(mktemp --suffix=.sql)"; hs_m3_copy "$db" "$copy"; hs_apply "$db" "$copy"; rm -f "$copy" ;;
    "S1>S1R")         hs_apply "$db" "$HS_R1" ;;
    "S2>S2R")         hs_apply "$db" "$HS_R2" ;;
    "S3>S3R")         hs_apply "$db" "$HS_R2"; hs_apply "$db" "$HS_R1" ;;
    *) hs_refuse "no transition $from -> $to" ;;
  esac
}

# hs_valid_state <state>: refuse anything but a known state (call before any $(hs_path ...) substitution, whose
# refusal would only exit the subshell).
hs_valid_state() {
  case "$1" in S0|S1|S2|S3|S1R|S2R|S3R) ;; *) hs_refuse "unknown state '$1' (expected one of $HS_STATES)" ;; esac
}

# hs_path <state>: the sequence of states from S0.
hs_path() {
  case "$1" in
    S0) echo "S0" ;; S1) echo "S0 S1" ;; S2) echo "S0 S1 S2" ;; S3) echo "S0 S1 S2 S3" ;;
    S1R) echo "S0 S1 S1R" ;; S2R) echo "S0 S1 S2 S2R" ;; S3R) echo "S0 S1 S2 S3 S3R" ;;
    *) hs_refuse "unknown state '$1' (expected one of $HS_STATES)" ;;
  esac
}

# hs_build <state> <db> [<fixture.sql>]: create <db> and walk it from S0 to <state>.
hs_build() {
  local state="$1" db="$2" prev="" s
  hs_valid_state "$state"
  [[ "$db" =~ ^hier_[a-z0-9_]{1,50}$ ]] || hs_refuse "database name '$db' must match ^hier_[a-z0-9_]{1,50}\$"
  for s in $(hs_path "$state"); do
    if [ -z "$prev" ]; then hs_create_s0 "$db" "${3:-}"; else hs_advance "$db" "$prev" "$s"; fi
    prev="$s"
  done
}

if [ "${HIERARCHY_STATE_LIB:-0}" != 1 ]; then
  [ "$#" -ge 2 ] && [ "$#" -le 3 ] || { sed -n '6,22p' "$0" >&2; exit 2; }
  [ "$#" = 2 ] || [ "$3" = --replace ] || hs_refuse "unknown option '$3'"
  hs_valid_state "$1"
  hs_check_url
  for f in "$HS_M1" "$HS_M2" "$HS_M3" "$HS_R1" "$HS_R2" "$HS_R3" "$HS_FIXTURE_PY"; do [ -f "$f" ] || hs_refuse "missing $f"; done
  [[ "$2" =~ ^hier_[a-z0-9_]{1,50}$ ]] || hs_refuse "database name '$2' must match ^hier_[a-z0-9_]{1,50}\$"
  hs_prove_local postgres
  if [ "$(hs_q postgres "SELECT count(*) FROM pg_database WHERE datname = '$2'")" != 0 ]; then
    [ "${3:-}" = --replace ] || hs_refuse "database $2 exists (pass --replace to rebuild a synthetic one)"
    hs_prove_synthetic "$2"
    psql -X -q -v ON_ERROR_STOP=1 "$PGURL/postgres" -c "DROP DATABASE $2 WITH (FORCE)" >/dev/null
  fi
  hs_build "$1" "$2"
  echo "built $2 in state $1 ($(hs_q "$2" "SELECT 'stale=' || stale_paths || ' missing=' || missing_pairs || ' profiles=' || profiles FROM hierarchy_test.consistency()"))"
fi
