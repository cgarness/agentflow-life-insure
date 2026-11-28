#!/usr/bin/env bash
# Copy one database of the disposable test cluster to a new name, exactly: a template copy of every object, plus what
# CREATE DATABASE does not carry over (the owner, the database's own privileges, connection limit and comment, and its
# database and role-in-database settings). Nobody may be connected to the source; for postgres that means the cluster
# runs without the pg_cron and pg_net workers (see run.sh). Usage: faithful-copy.sh SOURCE COPY
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# == 2 && $1 != "$2" ]] || { echo 'Usage: faithful-copy.sh SOURCE COPY' >&2; exit 2; }
db=${AUTOMATIONS_DB_CONTAINER:?disposable database container required}
: "${PGPASSWORD:?disposable postgres password required}"
[[ "$(docker inspect -f '{{index .Config.Labels "agentflow-test"}}' "$db")" == automations ]]
net=$(docker inspect -f '{{range $name, $config := .NetworkSettings.Networks}}{{$name}}{{end}}' "$db")
[[ "$(docker network inspect -f '{{.Internal}}' "$net")" == true ]]
docker exec -i -e PGPASSWORD "$db" psql -XqAt -U supabase_admin -d template1 -v ON_ERROR_STOP=1 -v src="$1" -v dst="$2" <<'SQL'
SELECT count(*)=1 AS found FROM pg_database WHERE datname=:'src' \gset
\if :found
\else
  \echo 'The source database does not exist.'
  \quit 3
\endif
SELECT format('CREATE DATABASE %I TEMPLATE %I OWNER %I', :'dst', :'src', pg_get_userbyid(datdba))
  FROM pg_database WHERE datname=:'src' \gexec
BEGIN;
UPDATE pg_database t SET datacl=s.datacl,datconnlimit=s.datconnlimit
  FROM pg_database s WHERE s.datname=:'src' AND t.datname=:'dst';
INSERT INTO pg_db_role_setting(setdatabase,setrole,setconfig)
  SELECT t.oid,r.setrole,r.setconfig FROM pg_db_role_setting r
  JOIN pg_database s ON s.oid=r.setdatabase AND s.datname=:'src' CROSS JOIN pg_database t WHERE t.datname=:'dst';
SELECT format('COMMENT ON DATABASE %I IS %L', :'dst', d.description)
  FROM pg_shdescription d JOIN pg_database s ON s.oid=d.objoid AND d.classoid='pg_database'::regclass
  WHERE s.datname=:'src' \gexec
COMMIT;
SQL
