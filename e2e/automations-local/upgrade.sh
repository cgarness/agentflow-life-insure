#!/usr/bin/env bash
# Isolated upgrade against the repository baseline and the feature's historical dependencies.
# The GoTrue service must already have migrated auth.sessions.
set -euo pipefail
cd "$(dirname "$0")/../.."
db=${AUTOMATIONS_DB_CONTAINER:?disposable database container required}
[[ "$(docker inspect -f '{{index .Config.Labels "agentflow-test"}}' "$db")" == automations ]]
net=$(docker inspect -f '{{range $name, $config := .NetworkSettings.Networks}}{{$name}}{{end}}' "$db")
[[ "$(docker network inspect -f '{{.Internal}}' "$net")" == true ]]
: "${PGPASSWORD:?disposable postgres password required}"
sql=(docker exec -i -e PGPASSWORD "$db" psql -X -q -1 -v ON_ERROR_STOP=1 -U postgres -d postgres)
if [[ ${1:-} == prerequisites ]]; then
  # pg_cron must never launch copied scheduler jobs in this fixture.
  [[ "$("${sql[@]}" -Atc 'show cron.launch_active_jobs')" == off ]]
  # Schema-only Storage fixtures. Storage transport is outside the browser scenarios.
  docker exec -i -e PGPASSWORD "$db" psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres <<'SQL'
CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE IF NOT EXISTS storage.objects(id uuid PRIMARY KEY, name text NOT NULL, bucket_id text NOT NULL, owner uuid);
ALTER TABLE storage.objects OWNER TO postgres;
ALTER TABLE storage.buckets OWNER TO postgres;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
SQL
  ids=(20260806000000 20260811200920 20260811201250 20260811201401 20260819163413
    20260823203257 20260823222528 20260823222805 20260823222926 20260914000530 20260915025931
    20260915035141 20260919183544 20260925183605 20261002184930 20261002184954 20261002203426 20261003042846
    20261003043122 20261003043738 20261003174429 20261003192857 20261003192907 20261005161632
    20261005194649 20261008144711 20261103191631 20261104041151 20261114003115 20261114003337
    20261114004102 20261121040200 20261121040202)
elif [[ ${1:-} == feature ]]; then
  ids=(20261121075959 20261121080000 20261121080100 20261121080200)
else
  echo 'Choose prerequisites or feature.' >&2
  exit 1
fi
for id in "${ids[@]}"; do
  files=(supabase/migrations/"$id"_*.sql)
  [[ ${#files[@]} == 1 && -f ${files[0]} ]]
  echo "Applying ${files[0]}"
  "${sql[@]}" -f - < "${files[0]}"
done
