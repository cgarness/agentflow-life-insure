#!/usr/bin/env bash
# Read the three receipts `run.sh release-full` is measured against, from production, through the Supabase Management
# API: a channel separate from the database connection the bundle is dumped through. Read-only (each query is one
# read-only transaction) and digests only. Run it right before make-schema-bundle.sh: release-full refuses receipts
# read more than two hours from the dump.
# Needs SUPABASE_ACCESS_TOKEN (a personal access token, never printed or stored), SUPABASE_PUBLISHABLE_KEY (the
# project's public client key, for the Auth health endpoint), Docker with buildx (for the Auth image's registry digest),
# curl and Python 3.11 or newer. Usage: capture-receipts.sh NEW_DIRECTORY
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
fail() { echo "$1" >&2; exit 1; }
[[ $# == 1 ]] || fail 'Usage: capture-receipts.sh NEW_DIRECTORY'
[[ ! -e $1 ]] || fail 'Choose a directory that does not exist yet.'
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN to a Supabase personal access token}"
: "${SUPABASE_PUBLISHABLE_KEY:?Set SUPABASE_PUBLISHABLE_KEY to the project public client key}"
project=${AUTOMATIONS_SOURCE_PROJECT:-jncvvsvckxhqgqvkppmj}
out=$1
mkdir -m 700 -- "$out"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
# One query through the Management API. Its last statement is the reading; the trailing COMMIT is left off.
read_one() { # read_one QUERY_FILE OUTPUT
  python3 e2e/automations-local/receipts.py connector-sql "$1" >"$work/query.sql"
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$work/query.sql" >"$work/body.json"
  curl --fail-with-body --silent --show-error --max-time 60 \
    -H @- -H 'Content-Type: application/json' --data-binary @"$work/body.json" \
    "https://api.supabase.com/v1/projects/$project/database/query" >"$work/response.json" \
    <<<"Authorization: Bearer $SUPABASE_ACCESS_TOKEN" || fail "The Management API refused the reading (see $work/response.json)."
  python3 - "$work/response.json" "$2" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
if not isinstance(rows, list) or len(rows) != 1 or len(rows[0]) != 1:
    sys.exit('Unexpected Management API response shape')
value = next(iter(rows[0].values()))
value = json.loads(value) if isinstance(value, str) else value
open(sys.argv[2], 'w').write(json.dumps(value, indent=2) + '\n')
PY
}
read_one e2e/automations-local/schema-fingerprint.sql "$out/schema-fingerprint.json"
python3 e2e/automations-local/canonical-receipt.py query >"$work/canonical.sql"
read_one "$work/canonical.sql" "$out/canonical.json"
read_one e2e/automations-local/auth-receipt.sql "$work/auth-reading.json"
curl --fail-with-body --silent --show-error --max-time 20 -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  "https://$project.supabase.co/auth/v1/health" >"$work/auth-health.json"
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$work/auth-health.json")
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Unexpected Auth version from the health endpoint.'
digest=$(docker buildx imagetools inspect "supabase/gotrue:$version" --format '{{json .Manifest}}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["digest"])')
python3 e2e/automations-local/receipts.py auth-receipt "$work/auth-reading.json" "$version" "$digest" "$project" "$out/auth.json"
python3 - "$out" <<'PY'
import json, sys
from pathlib import Path
out = Path(sys.argv[1])
schema = json.loads((out / 'schema-fingerprint.json').read_text())
print(f"Receipts written: {len(schema['families'])} schema families read at {schema['captured_at']}, "
      f"canonical digests, and the Auth ledger. Run make-schema-bundle.sh within two hours.")
PY
