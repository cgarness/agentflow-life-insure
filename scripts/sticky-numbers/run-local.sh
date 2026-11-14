#!/usr/bin/env bash
# Only a disposable loopback cluster; never a linked Supabase project.
set -euo pipefail
: "${STICKY_PG_BIN:?Set the PostgreSQL 17 bin directory}"
STICKY_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
STICKY_EVIDENCE="$(dirname "$STICKY_REPO")/evidence"
STICKY_DATA="${STICKY_TEST_DATA:-$(dirname "$STICKY_REPO")/sticky-test-pgdata}"
mkdir -p "$STICKY_EVIDENCE"
if [ ! -f "$STICKY_DATA/PG_VERSION" ]; then "$STICKY_PG_BIN/initdb" -D "$STICKY_DATA" -U postgres -A trust --no-locale > "$STICKY_EVIDENCE/pg-init.log"; fi
"$STICKY_PG_BIN/postgres" -D "$STICKY_DATA" -h 127.0.0.1 -p 55473 -c unix_socket_directories= -c max_connections=180 > "$STICKY_EVIDENCE/pg-run.log" 2>&1 &
STICKY_PID=$!
trap 'kill -INT "$STICKY_PID" 2>/dev/null || true; wait "$STICKY_PID" || true' EXIT
cd "$STICKY_REPO"
node --input-type=module - <<'JS'
import postgres from 'postgres';
for(let i=0;i<60;i++){const db=postgres('postgres://postgres@127.0.0.1:55473/postgres',{max:1,connect_timeout:1});try{await db`select 1`;await db.end();process.exit(0);}catch{await db.end();await new Promise(r=>setTimeout(r,50));}}
throw Error('Disposable PostgreSQL did not start');
JS
"$@"
