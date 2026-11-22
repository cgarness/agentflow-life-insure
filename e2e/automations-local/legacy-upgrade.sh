#!/usr/bin/env bash
# Rehearse the feature on a nonempty legacy graph inside the disposable PG cluster.
# The caller supplies the test-only pre-feature archive or invokes before the feature migrations.
set -euo pipefail
cd "$(dirname "$0")/../.."
db=${AUTOMATIONS_DB_CONTAINER:?disposable database container required}
: "${PGPASSWORD:?disposable postgres password required}"
[[ "$(docker inspect -f '{{index .Config.Labels "agentflow-test"}}' "$db")" == automations ]]
net=$(docker inspect -f '{{range $name, $config := .NetworkSettings.Networks}}{{$name}}{{end}}' "$db")
[[ "$(docker network inspect -f '{{.Internal}}' "$net")" == true ]]
dest=$(docker exec "$db" mktemp -d /tmp/automation-legacy.XXXXXX)
legacy="automation_legacy_rehearsal_$$"
pg=(docker exec -i -e PGPASSWORD "$db")
if [[ -n ${1:-} ]]; then
  docker cp "$1" "$db:$dest/base.dump"
else
  [[ "$("${pg[@]}" psql -U postgres -Atqc "select to_regclass('public.workflow_versions') is null")" == t ]]
  "${pg[@]}" pg_dump -U supabase_admin -Fc -d postgres -f "$dest/base.dump"
fi
"${pg[@]}" createdb -U supabase_admin -O postgres -T template0 "$legacy"
docker exec "$db" sh -eu -c '
  pg_restore -l "$1/base.dump" | awk "!/ (pg_cron|cron)( |$)/ && !/ACL graphql_public FUNCTION graphql/" > "$1/toc"
  mkdir -p "$1/tests" "$1/migrations"
' -- "$dest"
"${pg[@]}" pg_restore -L "$dest/toc" -U supabase_admin -d "$legacy" --exit-on-error "$dest/base.dump"
for migration in supabase/migrations/202611210{75959,80000,80100,80200}_*.sql supabase/migrations/202611221*_automation_v2_*.sql; do
  docker cp "$migration" "$db:$dest/migrations/"
done
docker cp supabase/tests/fixtures "$db:$dest/tests/"
docker cp supabase/tests/automation_upgrade.sql "$db:$dest/tests/"
"${pg[@]}" psql -X -q -U postgres -d "$legacy" -v ON_ERROR_STOP=1 -f "$dest/tests/automation_upgrade.sql"
"${pg[@]}" psql -X -q -U postgres -d "$legacy" -v ON_ERROR_STOP=1 -f - < supabase/tests/automation_authoring.sql
"${pg[@]}" psql -X -q -U postgres -d "$legacy" -v ON_ERROR_STOP=1 -f - < supabase/tests/automation_v2_authoring.sql
echo 'Populated legacy graph, IDs, folders and history survived the complete feature upgrade.'
# The legacy fixture has no candidate runtime events or runs. Reuse this isolated clone for actual lead intake.
"${pg[@]}" psql -Xq -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE $legacy RENAME TO automation_release_channel_test"
"${pg[@]}" psql -Xq -U postgres -d automation_release_channel_test -v ON_ERROR_STOP=1 -f - <supabase/tests/automation_intake_eligibility.sql
