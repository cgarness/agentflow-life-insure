#!/usr/bin/env bash
# Rehearse the guarded Automations V2 rollback on a copy of an upgraded database in the disposable cluster.
# Usage: rollback-rehearsal.sh UPGRADED_DATABASE   (a database nobody is connected to)
set -euo pipefail
cd "$(dirname "$0")/../.."
db=${AUTOMATIONS_DB_CONTAINER:?disposable database container required}
: "${PGPASSWORD:?disposable postgres password required}"
[[ "$(docker inspect -f '{{index .Config.Labels "agentflow-test"}}' "$db")" == automations ]]
net=$(docker inspect -f '{{range $name, $config := .NetworkSettings.Networks}}{{$name}}{{end}}' "$db")
[[ "$(docker network inspect -f '{{.Internal}}' "$net")" == true ]]
source_db=${1:?upgraded database required}
copy="automation_rollback_rehearsal_$$"
rollback=20261124100600_automation_v2.rollback.sql
pg=(docker exec -i -e PGPASSWORD "$db")
dest=$(docker exec "$db" mktemp -d /tmp/automation-rollback.XXXXXX)
docker exec "$db" mkdir -p "$dest/tests" "$dest/migrations/rollback"
docker cp -q "supabase/migrations/rollback/$rollback" "$db:$dest/migrations/rollback/"
docker cp -q supabase/tests/automation_v2_rollback.sql "$db:$dest/tests/"
# A faithful copy, checked against its source in every schema fingerprint family before the rehearsal touches it.
bash e2e/automations-local/faithful-copy.sh "$source_db" "$copy"
prints=$(mktemp -d)
trap 'rm -rf -- "$prints"' EXIT
for name in "$source_db" "$copy"; do
  "${pg[@]}" psql -XqAt -U postgres -d "$name" -v ON_ERROR_STOP=1 -f - <e2e/automations-local/schema-fingerprint.sql >"$prints/$name.json"
done
python3 e2e/automations-local/receipts.py compare "$prints/$source_db.json" "$prints/$copy.json" 'The rollback rehearsal copy'
sql=("${pg[@]}" psql -X -q -U postgres -d "$copy" -v ON_ERROR_STOP=1)
apply=("${sql[@]}" -1 -f "$dest/migrations/rollback/$rollback")

# 1. Real V2 work in one transaction: what stops, what pauses, what keeps running and what is retained.
"${sql[@]}" -f "$dest/tests/automation_v2_rollback.sql"

# 2. Refused while any agency still has enrollment or message delivery on.
"${sql[@]}" <<'SQL'
insert into public.organizations(id,name) values ('7a600000-0000-4000-8000-000000000001','Rollback fence fixture');
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values ('7a600000-0000-4000-8000-000000000001',true,false,true);
SQL
if refused=$("${apply[@]}" 2>&1); then echo 'The rollback applied while message delivery was on.' >&2; exit 1; fi
grep -q 'turn enrollment and message delivery off for every agency first' <<<"$refused"

# 3. Refused when not run as one transaction, so it can never stop half way.
"${sql[@]}" -c 'update private.automation_release_controls set enrollment_enabled=false,dispatch_enabled=false'
if refused=$("${sql[@]}" -f "$dest/migrations/rollback/$rollback" 2>&1); then echo 'The rollback ran outside a transaction.' >&2; exit 1; fi
grep -q 'run this file as one transaction' <<<"$refused"
# The same without the documented flags: the file turns ON_ERROR_STOP on itself, so psql stops at the refusal and
# nothing after it runs.
if refused=$("${pg[@]}" psql -X -q -U postgres -d "$copy" -f "$dest/migrations/rollback/$rollback" 2>&1); then
  echo 'The rollback carried on after refusing, when run without its flags.' >&2; exit 1
fi
grep -q 'run this file as one transaction' <<<"$refused"
[[ "$("${sql[@]}" -Atc "select to_regprocedure('private.automation_v2_rollback_guard()') is null")" == t ]]
# 4. Applies once every agency is fenced. 5. Refuses a second run because the functions are no longer the V2 ones.
"${apply[@]}"
if refused=$("${apply[@]}" 2>&1); then echo 'The rollback applied twice.' >&2; exit 1; fi
grep -q 'automations v2 rollback drift' <<<"$refused"

# 6. The first-release suites pass on the rolled-back functions with the V2 tables and columns retained.
for file in supabase/tests/automation_{sessions,authoring,runtime,messages,backlog,legacy_dispatch}.sql; do
  "${sql[@]}" -f - <"$file"
done
"${pg[@]}" dropdb -U supabase_admin "$copy"
docker exec "$db" rm -rf "$dest"
echo 'PASS guarded V2 rollback: refused until fenced and outside a transaction (with or without psql flags), applied once, refused a second run, stopped and paused only V2 work, kept every V2 record, and the six first-release suites pass afterwards.'
