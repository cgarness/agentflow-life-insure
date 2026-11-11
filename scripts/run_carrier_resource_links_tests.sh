#!/usr/bin/env bash
# Native carrier resource/RLS suite, disposable LOCAL PostgreSQL only.
# With no PGURL: start and clean up a private Unix-socket cluster (initdb/pg_ctl required).
# With PGURL: use a throwaway database on a loopback-only PostgreSQL test service.
#   PGURL=postgresql://postgres:postgres@127.0.0.1:5432 ./scripts/run_carrier_resource_links_tests.sh
# PG_BIN_DIR may point to installed PostgreSQL binaries outside PATH. CI pins PostgreSQL 17.6.
# CARRIER_PG_TCP_PORT optionally starts the private cluster on loopback TCP when Unix sockets are unavailable.
# No hosted project, Supabase branch, production credentials or network database is used.
set -euo pipefail

CARRIER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${PG_BIN_DIR:-}" ]]; then export PATH="$PG_BIN_DIR:$PATH"; fi
command -v psql >/dev/null || { echo 'psql is required (set PG_BIN_DIR if it is outside PATH).' >&2; exit 2; }

# Prevent libpq environment fallbacks from redirecting a loopback URI to a remote hostaddr/service.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS
CARRIER_DB="carrier_resources_${$}_${RANDOM}"
CARRIER_TMP=''
CARRIER_BASE=''
CARRIER_STARTED=false
CARRIER_DB_CREATED=false
CARRIER_PG_HOST=''
CARRIER_PG_PORT=5432

psql_local() {
  local database="$1"
  shift
  if [[ -n "$CARRIER_BASE" ]]; then
    psql -X "$CARRIER_BASE/$database" -v ON_ERROR_STOP=1 "$@"
  else
    psql -X -h "$CARRIER_PG_HOST" -p "$CARRIER_PG_PORT" -U postgres -d "$database" -v ON_ERROR_STOP=1 "$@"
  fi
}

cleanup() {
  if $CARRIER_DB_CREATED; then
    psql_local postgres -qc "DROP DATABASE IF EXISTS $CARRIER_DB" >/dev/null 2>&1 || true
  fi
  if $CARRIER_STARTED; then
    pg_ctl -D "$CARRIER_TMP/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ -n "$CARRIER_TMP" ]]; then rm -rf -- "$CARRIER_TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -n "${PGURL:-}" ]]; then
  # Exact authority matching, not a substring test that remote-host query strings could defeat.
  local_uri_pattern='^postgres(ql)?://([^/@?#]+@)?(127[.]0[.]0[.]1|localhost|\[::1\])(:[0-9]{1,5})?(/postgres|/)?$'
  if ! [[ "$PGURL" =~ $local_uri_pattern ]]; then
    echo 'REFUSING: PGURL must target loopback only, with no query, fragment or database other than postgres.' >&2
    exit 2
  fi
  CARRIER_BASE="${PGURL%/postgres}"
  CARRIER_BASE="${CARRIER_BASE%/}"
else
  command -v initdb >/dev/null && command -v pg_ctl >/dev/null || {
    echo 'initdb and pg_ctl are required, or set PGURL to a disposable loopback PostgreSQL service.' >&2
    exit 2
  }
  if [[ "$(id -u)" = 0 ]]; then
    echo 'Run as an unprivileged OS user, or supply PGURL for a disposable loopback service.' >&2
    exit 2
  fi
  CARRIER_TMP="$(mktemp -d "${TMPDIR:-/tmp}/carrier-resources.XXXXXX")"
  mkdir "$CARRIER_TMP/socket"
  CARRIER_PG_HOST="$CARRIER_TMP/socket"
  carrier_server_options="-F -c listen_addresses='' -k $CARRIER_TMP/socket -p 5432"
  if [[ -n "${CARRIER_PG_TCP_PORT:-}" ]]; then
    if ! [[ "$CARRIER_PG_TCP_PORT" =~ ^[1-9][0-9]{3,4}$ ]] || (( CARRIER_PG_TCP_PORT > 65535 )); then
      echo 'CARRIER_PG_TCP_PORT must be a local test port from 1000 to 65535.' >&2
      exit 2
    fi
    CARRIER_PG_HOST=127.0.0.1
    CARRIER_PG_PORT="$CARRIER_PG_TCP_PORT"
    carrier_server_options="-F -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p $CARRIER_PG_PORT"
  fi
  if ! initdb -D "$CARRIER_TMP/data" -U postgres --auth=trust --no-locale --encoding=UTF8 >"$CARRIER_TMP/init.log" 2>&1; then
    cat "$CARRIER_TMP/init.log" >&2
    exit 1
  fi
  if ! pg_ctl -D "$CARRIER_TMP/data" -l "$CARRIER_TMP/server.log" \
    -o "$carrier_server_options" -w start >/dev/null; then
    cat "$CARRIER_TMP/server.log" >&2
    exit 1
  fi
  CARRIER_STARTED=true
fi

echo "Native PostgreSQL $(psql_local postgres -Atqc 'SHOW server_version')"
psql_local postgres -qc "CREATE DATABASE $CARRIER_DB"
CARRIER_DB_CREATED=true
psql_local "$CARRIER_DB" -q -f "$CARRIER_ROOT/supabase/tests/carrier_resource_links_fixture.sql"
psql_local "$CARRIER_DB" -q -f "$CARRIER_ROOT/supabase/migrations/pending/carrier_resource_links.sql"
psql_local "$CARRIER_DB" -q -f "$CARRIER_ROOT/supabase/tests/carrier_resource_links.sql"
echo 'PASS: disposable carrier database verified; cleanup runs on exit.'
