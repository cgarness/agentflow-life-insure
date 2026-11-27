#!/usr/bin/env bash
# Make the schema-only bundle that `run.sh release-full` restores, from the database the libpq environment selects.
# For the operator who holds the production database password, on a trusted machine with this checkout, PostgreSQL 17
# client tools (psql, pg_dump, pg_dumpall, pg_restore) and Python 3.11 or newer. Set PG_BIN to their directory when
# they are not first on PATH. The password comes from ~/.pgpass or the PGSERVICE's passfile, never from arguments,
# chat or Git. Everything is read-only, and only checksums and counts are printed; the files stay on this machine.
# Usage: make-schema-bundle.sh NEW_DIRECTORY
# Bash 4.4 or newer (macOS ships 3.2: brew install bash, then open a new terminal so bash resolves to it).
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
  echo 'Run this with bash 4.4 or newer. On macOS: brew install bash, then open a new terminal.' >&2; exit 2
fi
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
# The bundle's readings name their connection, so a receipt read through another channel is told apart from them.
export PGDATABASE=postgres PGCONNECT_TIMEOUT=10 TZ=UTC PGAPPNAME=agentflow-schema-bundle
export PGSSLMODE=${PGSSLMODE:-verify-full}
# Read-only and quick to give way: a dump that would wait on a lock stops, so it can simply be run again.
[[ ${AGENTFLOW_NO_PGOPTIONS:-} == 1 ]] || export PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=120s'
out=$1
mkdir -m 700 -- "$out"
sql() { "${bin}psql" -XqAt --no-password -v ON_ERROR_STOP=1 -f - "$@"; }
# A time limit where the system has one: GNU timeout, or gtimeout from Homebrew's coreutils. pg_dump already gives up
# on a lock after two seconds.
bounded() {
  local seconds=$1; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$seconds" "$@"
  else "$@"; fi
}
sql <<<'SELECT 1' >/dev/null || fail 'Could not connect read-only. Check ~/.pgpass and the libpq settings (a pooler that refuses startup options needs AGENTFLOW_NO_PGOPTIONS=1).'
[[ $(sql <<<'SELECT current_database()') == postgres ]] || fail 'The connection must select database postgres.'
# pg_dump leaves out an index that a failed or interrupted CREATE INDEX, REINDEX or DROP INDEX CONCURRENTLY left behind
# (an invalid one, unless it belongs to a partitioned table), so the restored copy could not match. Only a count is printed.
n=$(sql <<<"SELECT count(*) FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace s ON s.oid=t.relnamespace WHERE s.nspname!~'^pg_' AND s.nspname<>'information_schema' AND NOT ((i.indisvalid OR t.relkind='p') AND i.indisready)")
[[ $n == 0 ]] || fail "$n invalid indexes (left by a failed or interrupted CREATE INDEX, REINDEX or DROP INDEX CONCURRENTLY) are never dumped, so the restored copy cannot match. Stop and send this line; removing or rebuilding them on production is a separate decision."
# A table keeps its TOAST table, and that table's storage settings (toast.*), after the last column that needed one is
# dropped. pg_dump writes the settings on the table, but the restore's CREATE TABLE makes a TOAST table only for a
# column of unbounded length that can be stored out of line (attlen -1, a type whose storage is not plain, and no length
# limit on bpchar, varchar, numeric, bit or varbit), so the settings are lost and the restored copy cannot match.
n=$(sql <<<"SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace JOIN pg_class t ON t.oid=c.reltoastrelid WHERE s.nspname!~'^pg_' AND s.nspname<>'information_schema' AND t.reloptions IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_type y ON y.oid=a.atttypid WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attlen=-1 AND y.typstorage<>'p' AND (a.atttypmod<0 OR NOT (y.typnamespace='pg_catalog'::regnamespace AND y.typname IN ('bpchar','varchar','numeric','bit','varbit'))))")
[[ $n == 0 ]] || fail "$n tables keep TOAST storage settings (toast.*) on a TOAST table a restore would not create, because no remaining column needs one, so the restored copy cannot match. Stop and send this line; changing those tables on production is a separate decision."
# The same reading on both sides of the dump shows nothing changed while it ran.
sql <e2e/automations-local/schema-fingerprint.sql >"$out/source-fingerprint-before.json"
bounded 600 "${bin}pg_dump" --no-password --schema-only --format=custom --lock-wait-timeout=2s >"$out/agentflow-schema.dump"
# What the dump cannot carry: who owns each extension and its members, the initial privileges extension scripts
# recorded, and the shared dependencies PostgreSQL keeps for them. restore-full.sh reproduces it on the restored copy,
# which the receipt then checks.
sql <e2e/automations-local/extension-ownership.sql >"$out/extension-ownership.json"
sql <e2e/automations-local/schema-fingerprint.sql >"$out/source-fingerprint.json"
python3 e2e/automations-local/canonical-receipt.py query | sql >"$out/canonical-source.json"
sql <e2e/automations-local/auth-versions.sql >"$out/auth-schema-migrations.txt"
bounded 120 "${bin}pg_dumpall" --no-password --roles-only --no-role-passwords >"$out/roles.sql"
"${bin}pg_restore" --list <"$out/agentflow-schema.dump" >"$out/toc.list"
if grep -Eq '^[0-9]+; [0-9]+ [0-9]+ (TABLE DATA|FOREIGN TABLE DATA|MATERIALIZED VIEW DATA|SEQUENCE SET|STATISTICS DATA|BLOB(S)?|LARGE OBJECT|SUBSCRIPTION|USER MAPPING|SERVER)( |$)' "$out/toc.list"; then
  fail 'The archive has a data-bearing or external connection entry. Do not use or transfer it.'
fi
python3 - "$out" <<'PY'
import json, sys
from pathlib import Path
out = Path(sys.argv[1])
before, after = (json.loads((out / name).read_text()) for name in ('source-fingerprint-before.json', 'source-fingerprint.json'))
if before.get('format') != 'agentflow-schema-fingerprint/3' or before['families'] != after['families']:
    sys.exit('The schema changed while it was being dumped. Run this again into a new directory.')
if json.loads((out / 'canonical-source.json').read_text()).get('captured_at') is None:
    sys.exit('The canonical reading has no capture time.')
ownership = json.loads((out / 'extension-ownership.json').read_text())
if ownership.get('format') != 'agentflow-extension-ownership/2':
    sys.exit('The extension ownership reading is not format 2.')
print(f"Read {len(after['families'])} fingerprint families before and after the dump; they match.")
print(f"Read the owners of {len(ownership['extensions'])} extensions and {len(ownership['members'])} of their members, "
      f"{len(ownership['initial_privileges'])} initial privileges extension scripts recorded, and "
      f"{len(ownership['shared_dependencies'])} shared dependencies on roles PostgreSQL keeps for them.")
PY
# Checksums in sha256sum's own format, computed in Python so no GNU tool is needed.
python3 - "$out" agentflow-schema.dump roles.sql source-fingerprint-before.json source-fingerprint.json \
  canonical-source.json auth-schema-migrations.txt extension-ownership.json <<'PY'
import hashlib, sys
from pathlib import Path
out = Path(sys.argv[1])
lines = [f"{hashlib.sha256((out / name).read_bytes()).hexdigest()}  {name}\n" for name in sys.argv[2:]]
(out / 'SHA256SUMS').write_text(''.join(lines))
print(''.join(lines), end='')
PY
echo "Bundle ready: $(grep -c '^[0-9]' "$out/toc.list") archive entries, $(grep -c . "$out/auth-schema-migrations.txt") Auth versions."
