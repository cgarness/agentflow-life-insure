#!/usr/bin/env bash
# Restore a reviewed PG17 schema-only bundle into run.sh's single, fresh, offline DB.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
fail() { echo "$1" >&2; exit 1; }
[[ $# == 1 && -d $1 ]] || fail 'A schema-only bundle directory is required.'
bundle=$(realpath -- "$1")
receipt=${AUTOMATIONS_SOURCE_RECEIPT:-docs/plans/2026-11-21-automations/production-schema-fingerprint.json}
[[ -f $receipt && ! $receipt -ef $bundle/source-fingerprint.json ]] || fail 'An independent source fingerprint is required.'
db=${AUTOMATIONS_DB_CONTAINER:?dedicated release-full test container required}
: "${PGPASSWORD:?disposable PostgreSQL password required}"
prefix="af-auto-test-$PPID"
network="$prefix-net"
[[ $db == "$prefix-db" ]] || fail 'Only the direct caller’s disposable DB can be restored.'
[[ $(docker inspect --format '{{index .Config.Labels "agentflow-test"}}' "$db") == automations ]]
[[ $(docker inspect --format '{{range $key, $value := .NetworkSettings.Networks}}{{$key}}{{end}}' "$db") == "$network" ]]
[[ $(docker network inspect --format '{{.Internal}} {{len .Containers}} {{index .Labels "agentflow-test"}}' "$network") == 'true 1 automations' ]] || fail 'Restore needs a dedicated internal-only network with just its DB.'
[[ $(docker inspect --format '{{.HostConfig.Privileged}} {{len .HostConfig.Binds}} {{len .HostConfig.PortBindings}}' "$db") == 'false 0 0' ]] || fail 'Unexpected DB privilege, host mounts or published ports.'
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
pg=(docker exec -i -e PGPASSWORD "$db")
psql=("${pg[@]}" psql -XqAt -U supabase_admin -v ON_ERROR_STOP=1)
[[ $("${psql[@]}" -d template1 -c "select current_setting('server_version_num')::int/10000, current_setting('cron.launch_active_jobs')") == '17|off' ]] || fail 'PG17 with cron execution disabled is required.'

# Copy the exact checked inputs privately before restoring. Never print DDL or role settings.
for name in agentflow-schema.dump roles.sql source-fingerprint.json SHA256SUMS; do
  [[ -f "$bundle/$name" && ! -L "$bundle/$name" ]] || fail "Missing regular input file: $name"
  cp -- "$bundle/$name" "$work/$name"
done
python3 - "$work" "$receipt" <<'PY'
import hashlib, json, pathlib, re, sys
work = pathlib.Path(sys.argv[1])
files = {'agentflow-schema.dump', 'roles.sql', 'source-fingerprint.json'}
seen = set()
for line in (work / 'SHA256SUMS').read_text().splitlines():
    match = re.fullmatch(r'([a-f0-9]{64})  ([a-zA-Z0-9.-]+)', line)
    if not match or match[2] not in files - seen:
        sys.exit('Unexpected checksum manifest entry')
    with (work / match[2]).open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if digest != match[1]:
        sys.exit('Bundle checksum mismatch')
    seen.add(match[2])
if seen != files:
    sys.exit('Bundle checksum manifest incomplete')
source = json.loads((work / 'source-fingerprint.json').read_text())
def valid(row):
    return (isinstance(row, dict) and set(row) == {'kind', 'objects', 'sha256'}
            and isinstance(row['kind'], str) and type(row['objects']) is int and row['objects'] > 0
            and isinstance(row['sha256'], str) and re.fullmatch('[0-9a-f]{64}',row['sha256']))
if (not isinstance(source,list) or not source or not all(valid(row) for row in source)
        or len({row['kind'] for row in source}) != len(source)
        or source != json.loads(pathlib.Path(sys.argv[2]).read_text())):
    sys.exit('Source fingerprint does not match the independently supplied receipt')
PY
"${pg[@]}" pg_restore --list --create <"$work/agentflow-schema.dump" >"$work/toc" 2>"$work/error" || fail 'Invalid custom archive.'
grep -Eq '^;[[:space:]]+dbname: postgres$' "$work/toc" &&
  grep -Eq '^;[[:space:]]+Format: CUSTOM$' "$work/toc" &&
  grep -Eq '^;[[:space:]]+Dumped from database version: 17\.' "$work/toc" &&
  grep -Eq '^;[[:space:]]+Dumped by pg_dump version: 17\.' "$work/toc" || fail 'Expected a native PostgreSQL 17 custom archive of postgres.'
if grep -Eq '^[0-9]+; [0-9]+ [0-9]+ (TABLE DATA|FOREIGN TABLE DATA|MATERIALIZED VIEW DATA|SEQUENCE SET|STATISTICS DATA|BLOB(S)?|LARGE OBJECT|SUBSCRIPTION|USER MAPPING|SERVER)( |$)' "$work/toc"; then
  fail 'Data-bearing or external connection archive entry detected.'
fi

# pg_dumpall emits one CREATE ROLE per non-built-in role. Fresh Supabase images already
# contain managed roles. Suppress only duplicate creates; retain all role attributes and grants.
"${psql[@]}" -d template1 -c 'select coalesce(json_agg(rolname), '\''[]'\'') from pg_roles' >"$work/local-roles.json"
python3 - "$work" <<'PY'
import json, pathlib, re, sys
work = pathlib.Path(sys.argv[1]); roles = set(json.loads((work / 'local-roles.json').read_text()))
ident = r'(?:[a-z_][a-z0-9_$]*|"(?:[^"]|"")+")'
source = (work / 'roles.sql').read_text()
if re.search(r'\bPASSWORD\b|SCRAM-SHA-256\$|\bmd5[0-9a-f]{32}\b', source, re.I):
    sys.exit('Role inventory contains a password directive or verifier')
found = set()
with (work / 'role-restore.sql').open('w') as out:
    for line in source.splitlines():
        value = line.strip()
        if not value or value.startswith('--'):
            continue
        create = re.fullmatch(rf'CREATE ROLE ({ident});',value)
        if create:
            name = create[1]
            if name.startswith('"'):
                name = name[1:-1].replace('""','"')
            found.add(name)
            if name in roles:
                continue
        elif not (re.fullmatch(r'\\(?:un)?restrict [A-Za-z0-9]+', value)
                  or re.fullmatch(r"SET (?:default_transaction_read_only|client_encoding|standard_conforming_strings) = [\w'\-]+;",value)
                  or re.fullmatch(r'(?:ALTER ROLE|GRANT|COMMENT ON ROLE) [^;\\]+;', value.replace(r'\\$user','$user'))):
            sys.exit('Unrecognized role inventory statement; review password-free pg_dumpall output')
        print(value, file=out)
if not {'postgres','supabase_admin'} <= found:
    sys.exit('Incomplete managed role inventory')
PY
"${psql[@]}" --single-transaction -d template1 -f - <"$work/role-restore.sql" >"$work/output" 2>"$work/error" || fail 'Restoring reviewed password-free role inventory failed.'

# Create the actual primary DB from archive metadata (template0, locale, owner, ACLs/settings).
# All DB connections below use the container's own Unix socket. No application service has started.
restore=(pg_restore --create --exit-on-error -U supabase_admin -d template1)
if grep -Eq '^[0-9]+; 0 0 ACL graphql_public FUNCTION graphql\(' "$work/toc"; then
  # Supabase's DDL event trigger establishes a native wrapper and initial GraphQL ACLs
  # during extension install. Restore its two original archive entries before the extension.
  # Native pg_dump expects the matching provider image's initial graphql_public grants
  # before it records pg_graphql's extension privileges. Capture only that image metadata.
  "${psql[@]}" -d postgres >"$work/graphql-schema-grants.sql" <<'SQL'
SELECT format('GRANT %s ON SCHEMA graphql_public TO %s%s GRANTED BY %I;', a.privilege_type,
  CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
  CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END,pg_get_userbyid(a.grantor))
FROM pg_namespace n JOIN pg_init_privs i ON i.classoid='pg_namespace'::regclass AND i.objoid=n.oid
CROSS JOIN LATERAL aclexplode(i.initprivs) WITH ORDINALITY a
WHERE n.nspname='graphql_public' AND i.privtype='e' AND pg_get_userbyid(n.nspowner)='supabase_admin'
ORDER BY a.ordinality;
SQL
  [[ -s "$work/graphql-schema-grants.sql" ]] || fail 'Matching managed GraphQL initial privileges required.'
  python3 - "$work" <<'PYTOC'
import pathlib, re, sys
work = pathlib.Path(sys.argv[1]); lines = (work/'toc').read_text().splitlines()
entries = [line for line in lines if re.match(r'^\d+;', line)]
def exactly(pattern):
    matches = [line for line in entries if re.search(pattern, line)]
    if len(matches) != 1:
        sys.exit('Managed GraphQL bootstrap entries missing or ambiguous')
    return matches[0]
anchor = exactly(r' EXTENSION - pg_graphql ')
function = exactly(r' FUNCTION extensions grant_pg_graphql_access\(\) supabase_admin$')
trigger = exactly(r' EVENT TRIGGER - issue_pg_graphql_access supabase_admin$')
pos = entries.index(anchor)
later_acls = [line for line in entries[:pos] if ' ACL - SCHEMA graphql_public ' in line]
first = [line for line in entries[:pos] if line not in later_acls] + [function, trigger]
remainder = later_acls + [line for line in entries[pos:] if line not in (function, trigger)]
if sorted(first + remainder) != sorted(entries):
    sys.exit('Native archive entry inventory changed')
(work/'bootstrap.list').write_text('\n'.join(first)+'\n')
(work/'remainder.list').write_text('\n'.join(remainder)+'\n')
PYTOC
  dest=$(docker exec "$db" mktemp -d /tmp/automation-schema.XXXXXX)
  docker cp "$work/bootstrap.list" "$db:$dest/bootstrap.list"
  docker cp "$work/remainder.list" "$db:$dest/remainder.list"
  restore+=(--use-list="$dest/bootstrap.list")
fi
"${psql[@]}" -d template1 -c 'DROP DATABASE postgres WITH (FORCE)' >"$work/output" 2>"$work/error" || fail 'Could not replace the fresh local primary database.'
"${pg[@]}" "${restore[@]}" <"$work/agentflow-schema.dump" >"$work/output" 2>"$work/error" || fail 'Native archive restore failed; baseline is unverified.'
if [[ -f "$work/remainder.list" ]]; then
  "${psql[@]}" --single-transaction -d postgres -f - <"$work/graphql-schema-grants.sql" >"$work/output" 2>"$work/error" || fail 'Initial managed GraphQL schema privileges could not be restored.'
  "${pg[@]}" pg_restore --exit-on-error -U supabase_admin -d postgres --use-list="$dest/remainder.list" <"$work/agentflow-schema.dump" >"$work/output" 2>"$work/error" || fail 'Native restore of remaining managed archive entries failed.'
fi
"${psql[@]}" -d postgres -f - <e2e/automations-local/schema-fingerprint.sql >"$work/restored.json" 2>"$work/error" || fail 'Restored schema fingerprint failed.'
python3 - "$work" <<'PY'
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
def load(name):
    return {row['kind']: row for row in json.loads((work / name).read_text())}
source = load('source-fingerprint.json'); restored = load('restored.json')
changed = sorted(key for key in source.keys() | restored.keys() if source.get(key) != restored.get(key))
if changed:
    sys.exit('Restored catalog differs in: '+', '.join(changed))
print(f'Restored the full supplied archive; all {len(source)} catalog fingerprint families match.')
PY
