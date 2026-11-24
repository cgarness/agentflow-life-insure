#!/usr/bin/env bash
# Make the schema-only bundle that `run.sh release-full` restores, from the database the libpq environment selects.
# For the operator who holds the production database password, on a trusted machine with this checkout, PostgreSQL 17
# client tools (psql, pg_dump, pg_dumpall, pg_restore) and Python 3.11 or newer. Set PG_BIN to their directory when
# they are not first on PATH. The password comes from ~/.pgpass or the PGSERVICE's passfile, never from arguments,
# chat or Git. Everything is read-only, and only checksums and counts are printed; the files stay on this machine.
# Usage: make-schema-bundle.sh NEW_DIRECTORY
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
fail() { echo "$1" >&2; exit 1; }
[[ $# == 1 ]] || fail 'Usage: make-schema-bundle.sh NEW_DIRECTORY'
[[ ! -e $1 ]] || fail 'Choose a directory that does not exist yet.'
bin=${PG_BIN:+$PG_BIN/}
for tool in psql pg_dump pg_dumpall pg_restore; do
  "${bin}$tool" --version | grep -Eq '\(PostgreSQL\) 17\.' || fail "PostgreSQL 17 $tool is required (PG_BIN selects it)."
done
python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' || fail 'Python 3.11 or newer is required.'
export PGDATABASE=postgres PGCONNECT_TIMEOUT=10 TZ=UTC
export PGSSLMODE=${PGSSLMODE:-verify-full}
# Read-only and quick to give way: a dump that would wait on a lock stops, so it can simply be run again.
[[ ${AGENTFLOW_NO_PGOPTIONS:-} == 1 ]] || export PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=120s'
out=$1
mkdir -m 700 -- "$out"
sql() { "${bin}psql" -XqAt --no-password -v ON_ERROR_STOP=1 -f - "$@"; }
sql <<<'SELECT 1' >/dev/null || fail 'Could not connect read-only. Check ~/.pgpass and the libpq settings (a pooler that refuses startup options needs AGENTFLOW_NO_PGOPTIONS=1).'
[[ $(sql <<<'SELECT current_database()') == postgres ]] || fail 'The connection must select database postgres.'
# The same reading on both sides of the dump shows nothing changed while it ran.
sql <e2e/automations-local/schema-fingerprint.sql >"$out/source-fingerprint-before.json"
timeout 600 "${bin}pg_dump" --no-password --schema-only --format=custom --lock-wait-timeout=2s >"$out/agentflow-schema.dump"
sql <e2e/automations-local/schema-fingerprint.sql >"$out/source-fingerprint.json"
python3 e2e/automations-local/canonical-receipt.py query | sql >"$out/canonical-source.json"
sql <e2e/automations-local/auth-versions.sql >"$out/auth-schema-migrations.txt"
timeout 120 "${bin}pg_dumpall" --no-password --roles-only --no-role-passwords >"$out/roles.sql"
"${bin}pg_restore" --list <"$out/agentflow-schema.dump" >"$out/toc.list"
if grep -Eq '^[0-9]+; [0-9]+ [0-9]+ (TABLE DATA|FOREIGN TABLE DATA|MATERIALIZED VIEW DATA|SEQUENCE SET|STATISTICS DATA|BLOB(S)?|LARGE OBJECT|SUBSCRIPTION|USER MAPPING|SERVER)( |$)' "$out/toc.list"; then
  fail 'The archive has a data-bearing or external connection entry. Do not use or transfer it.'
fi
python3 - "$out" <<'PY'
import json, sys
from pathlib import Path
out = Path(sys.argv[1])
before, after = (json.loads((out / name).read_text()) for name in ('source-fingerprint-before.json', 'source-fingerprint.json'))
if before.get('format') != 'agentflow-schema-fingerprint/2' or before['families'] != after['families']:
    sys.exit('The schema changed while it was being dumped. Run this again into a new directory.')
if json.loads((out / 'canonical-source.json').read_text()).get('captured_at') is None:
    sys.exit('The canonical reading has no capture time.')
print(f"Read {len(after['families'])} fingerprint families before and after the dump; they match.")
PY
(cd "$out" && sha256sum agentflow-schema.dump roles.sql source-fingerprint-before.json source-fingerprint.json \
  canonical-source.json auth-schema-migrations.txt >SHA256SUMS && cat SHA256SUMS)
echo "Bundle ready: $(grep -c '^[0-9]' "$out/toc.list") archive entries, $(grep -c . "$out/auth-schema-migrations.txt") Auth versions."
