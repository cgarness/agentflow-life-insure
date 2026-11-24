#!/usr/bin/env bash
# release-full only, after a verified native restore and before auth, fixtures and feature SQL.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
fail() { echo "$1" >&2; exit 1; }
[[ $# == 2 && -d $1 && -d $2 ]] || fail 'A schema-only bundle directory and its independent receipts directory are required.'
bundle=$(realpath -- "$1")
# restore-full.sh has already checked that the receipts are independent of the bundle and from its window.
expected="$(realpath -- "$2")/canonical.json"
source_receipt="$bundle/canonical-source.json"
[[ ! "$expected" -ef "$source_receipt" ]] || fail 'Supply the independently captured repository fingerprint receipt.'
gate=e2e/automations-local/canonical-receipt.py
python3 "$gate" check "$expected" "$source_receipt"
: "${PGPASSWORD:?Disposable database password required}"
prefix="af-auto-test-$PPID"
db=${AUTOMATIONS_DB_CONTAINER:?Dedicated test DB container required}
[[ $db == "$prefix-db" ]] || fail 'Canonical scope must be the calling harness database.'
network="$prefix-net"
[[ $(docker inspect --format '{{index .Config.Labels "agentflow-test"}} {{.HostConfig.Privileged}} {{len .HostConfig.Binds}} {{len .HostConfig.PortBindings}}' "$db") == 'automations false 0 0' ]] || fail 'Unexpected canonical DB container privileges, mounts or ports.'
[[ $(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$db") == "$network" ]] || fail 'Unexpected canonical DB network.'
[[ $(docker network inspect --format '{{.Internal}} {{len .Containers}} {{index .Labels "agentflow-test"}}' "$network") == 'true 1 automations' ]] || fail 'Rehearsal must have one database on its private internal network.'
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
pg=(docker exec -i -e PGPASSWORD "$db" psql -XqAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1)
[[ $("${pg[@]}" -c "select current_setting('server_version_num')::int/10000,current_setting('cron.launch_active_jobs')") == '17|off' ]] || fail 'Expected isolated PostgreSQL 17 with scheduled jobs disabled.'
bucket_args=()
if [[ -n ${AUTOMATIONS_BUCKET_CONFIG:-} ]]; then bucket_args=(--reviewed-config "$AUTOMATIONS_BUCKET_CONFIG"); fi
python3 "$gate" buckets "${bucket_args[@]}" > "$scratch/bucket-config.sql"
"${pg[@]}" -f - < "$scratch/bucket-config.sql" > "$scratch/local-output" 2> "$scratch/local-error" || fail 'Reviewed storage bucket configuration did not apply to the isolated restore.'
python3 "$gate" query > "$scratch/canonical.sql"
"${pg[@]}" -f - < "$scratch/canonical.sql" > "$scratch/restored.json" 2> "$scratch/local-error" || fail 'Canonical repository queries failed on restored schema.'
python3 "$gate" restored "$expected" "$scratch/restored.json"
echo 'Verified repository per-object, per-kind and storage-configuration digests on the isolated pre-feature database.'
