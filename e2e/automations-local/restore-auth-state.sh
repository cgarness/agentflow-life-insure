#!/usr/bin/env bash
# Restore the GoTrue migration version IDs into the network-isolated rehearsal database.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
fail() { echo "$1" >&2; exit 1; }
[[ $# == 2 && -d $2 ]] || fail 'Use prepare or verify with a schema bundle directory.'
phase=$1
case "$phase" in prepare|verify) ;; *) fail 'Unknown Auth rehearsal phase.' ;; esac
bundle=$(realpath -- "$2")
receipt=${AUTOMATIONS_AUTH_SOURCE_RECEIPT:-docs/plans/2026-11-21-automations/production-auth-receipt.json}
db=${AUTOMATIONS_DB_CONTAINER:?dedicated release-full database required}
: "${PGPASSWORD:?disposable PostgreSQL password required}"
prefix="af-auto-test-$PPID"
network="$prefix-net"
[[ $db == "$prefix-db" ]] || fail 'Only the direct caller’s disposable database can be used.'
[[ $(docker inspect -f '{{index .Config.Labels "agentflow-test"}}' "$db") == automations ]]
[[ $(docker inspect -f '{{range $key,$value := .NetworkSettings.Networks}}{{$key}}{{end}}' "$db") == "$network" ]]
[[ $(docker network inspect -f '{{.Internal}} {{index .Labels "agentflow-test"}}' "$network") == 'true automations' ]]
[[ $(docker inspect -f '{{.HostConfig.Privileged}} {{len .HostConfig.Binds}} {{len .HostConfig.PortBindings}}' "$db") == 'false 0 0' ]]
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
[[ -f $bundle/auth-schema-migrations.txt && ! -L $bundle/auth-schema-migrations.txt ]] || fail 'Missing regular Auth version manifest.'
cp -- "$bundle/auth-schema-migrations.txt" "$work/versions"
python3 - "$receipt" "$bundle" "$work" <<'PY'
import hashlib, json, pathlib, re, sys
receipt_path, bundle, work = map(pathlib.Path, sys.argv[1:])
if receipt_path.resolve().is_relative_to(bundle.resolve()):
    sys.exit('The trusted Auth receipt must come from outside the supplied bundle.')
receipt = json.loads(receipt_path.read_text())
if receipt.get('project_ref') != 'jncvvsvckxhqgqvkppmj' or receipt.get('database') != 'postgres':
    sys.exit('Auth receipt source does not match the AgentFlow project.')
version = receipt['gotrue_version']
image_digest = receipt['image_index_digest']
if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+',version) or not re.fullmatch(r'sha256:[0-9a-f]{64}',image_digest):
    sys.exit('Invalid version or registry digest on the Auth receipt.')
data = (work/'versions').read_bytes()
lines = data.splitlines(keepends=True)
if not lines or len(data)>131072 or not all(re.fullmatch(rb'(?:00|[0-9]{14})\n',s) for s in lines):
    sys.exit('Auth manifest permits one numeric migration version per LF-terminated line.')
if lines != sorted(set(lines)) or len(lines) != receipt['version_count'] or hashlib.sha256(data).hexdigest() != receipt['versions_sha256']:
    sys.exit('Auth migration versions differ from the independent source receipt.')
(work/'version').write_text(version)
(work/'image').write_text('supabase/gotrue:'+version+'@'+image_digest)
PY
image=$(cat "$work/image")
psql=(docker exec -i -e PGPASSWORD "$db" psql -XqAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1)
if [[ $phase == prepare ]]; then
  [[ $(docker network inspect -f '{{len .Containers}}' "$network") == 1 ]] || fail 'Seed the Auth ledger before starting the services.'
  {
    cat <<'SQL'
BEGIN;
LOCK TABLE auth.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE expected_auth_versions(version text PRIMARY KEY) ON COMMIT DROP;
COPY expected_auth_versions(version) FROM STDIN;
SQL
    cat "$work/versions"
    cat <<'SQL'
\.
DO $$ BEGIN
  IF EXISTS (SELECT FROM auth.schema_migrations) THEN
    IF EXISTS (SELECT version FROM auth.schema_migrations EXCEPT SELECT version FROM expected_auth_versions)
       OR EXISTS (SELECT version FROM expected_auth_versions EXCEPT SELECT version FROM auth.schema_migrations) THEN
      RAISE EXCEPTION 'Existing local Auth ledger differs from the source';
    END IF;
  ELSE
    INSERT INTO auth.schema_migrations(version) SELECT version FROM expected_auth_versions;
  END IF;
END $$;
COMMIT;
SQL
  } | "${psql[@]}" -f - >"$work/output" 2>&1 || fail 'Local Auth ledger preparation failed.'
  echo "$image"
else
  [[ $(docker inspect -f '{{.Config.Image}}' "$prefix-auth") == "$image" ]] || fail 'Unexpected local Auth image.'
  [[ $(docker inspect -f '{{range $key,$value := .NetworkSettings.Networks}}{{$key}}{{end}}' "$prefix-auth") == "$network" ]]
  docker exec "$prefix-auth" wget -Y off -q -T 5 -O - http://127.0.0.1:9999/health >"$work/health"
  python3 - "$work" <<'PY'
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
if json.loads((work/'health').read_text()).get('version') != (work/'version').read_text():
    sys.exit('Local Auth health version differs from the production receipt.')
PY
  "${psql[@]}" -c 'SELECT version FROM auth.schema_migrations ORDER BY version COLLATE "C"' >"$work/after"
  cmp -s "$work/versions" "$work/after" || fail 'Starting Auth changed the source migration ledger.'
  echo 'Matched the Auth version, registry image and complete Auth migration ledger after startup.'
fi
