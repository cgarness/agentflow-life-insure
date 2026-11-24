#!/usr/bin/env bash
# Bash 4.4 or newer (macOS ships 3.2: brew install bash, then open a new terminal so bash resolves to it).
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
  echo 'Run this with bash 4.4 or newer. On macOS: brew install bash, then open a new terminal.' >&2; exit 2
fi
# Run from a checkout with npm ci, docker, node, Playwright, Chromium and Deno installed.
set -euo pipefail
cd "$(dirname "$0")/../.."
abspath() { python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"; }  # realpath, without coreutils
umask 077
mode=${1:-builder}
case "$mode" in
  builder|release|backend-first|install-stops) [[ $# -le 1 ]] ;;
  release-full) [[ $# -eq 3 && -d "$2" && -d "$3" ]] || {
    echo 'release-full needs the schema-only archive directory and, separately, the receipts read from the source in the same window.' >&2; exit 2; } ;;
  synthetic-source) [[ $# -eq 2 && ! -e "$2" ]] || { echo 'synthetic-source needs a new output directory.' >&2; exit 2; } ;;
  *) echo 'Choose builder, release, backend-first, install-stops, release-full ARCHIVE RECEIPTS, or synthetic-source NEW_DIRECTORY.' >&2; exit 2 ;;
esac
dir=$(mktemp -d)
prefix="af-auto-test-$$"
network="$prefix-net"
db="$prefix-db"
auth="$prefix-auth"
rest="$prefix-rest"
processes=()
created=()
cleanup() {
  for p in ${processes[@]+"${processes[@]}"}; do kill "$p" 2>/dev/null || true; done
  for c in ${created[@]+"${created[@]}"}; do docker rm -fv "$c" >/dev/null || true; done
  docker network rm "$network" >/dev/null || true
  rm -rf -- "$dir"
}
docker network create --internal --label agentflow-test=automations "$network" >/dev/null
trap cleanup EXIT
export PGPASSWORD=$(openssl rand -hex 32)
export POSTGRES_PASSWORD="$PGPASSWORD"
export GOTRUE_JWT_SECRET=$(openssl rand -hex 32)
export AUTOMATIONS_DB_CONTAINER="$db"
export AUTOMATIONS_LOCAL_SETTINGS="$dir/settings.json"
start() {
  local name="$1"
  shift
  docker run --detach --name "$name" --network "$network" --label agentflow-test=automations "$@" >/dev/null
  created+=("$name")
}
postgres_image=supabase/postgres:17.6.1.085
auth_image=supabase/gotrue:v2.177.0
if [[ $mode == release-full ]]; then postgres_image=supabase/postgres:17.6.1.063; fi
start "$db" -e POSTGRES_PASSWORD "${LOCAL_POSTGRES_IMAGE:-$postgres_image}" postgres -D /etc/postgresql -c cron.launch_active_jobs=off
ready() {
  for _ in {1..90}; do
    if docker exec -e PGPASSWORD "$db" psql -h 127.0.0.1 -U supabase_admin -d postgres -Atqc 'select 1' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'The disposable database did not start.' >&2; exit 1
}
ready
if [[ $mode == release-full ]]; then
  bash e2e/automations-local/restore-full.sh "$2" "$3"
  bash e2e/automations-local/verify-canonical.sh "$2" "$3"
  auth_image=$(bash e2e/automations-local/restore-auth-state.sh prepare "$2" "$3")
  docker exec -i -e PGPASSWORD "$db" psql -XqAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f - \
    <e2e/automations-local/schema-fingerprint.sql >"$dir/restored.json"
fi
docker exec -i -e PGPASSWORD "$db" psql -Xq -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\getenv pw PGPASSWORD
ALTER ROLE postgres PASSWORD :'pw';
ALTER ROLE supabase_auth_admin PASSWORD :'pw';
ALTER ROLE authenticator PASSWORD :'pw';
SQL
export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PGPASSWORD@$db/postgres"
export PGRST_DB_URI="postgres://authenticator:$PGPASSWORD@$db/postgres"
export PGRST_JWT_SECRET="$GOTRUE_JWT_SECRET"
start "$auth" -e GOTRUE_DB_DATABASE_URL -e GOTRUE_JWT_SECRET -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_SITE_URL=http://127.0.0.1:8089 -e API_EXTERNAL_URL=http://127.0.0.1:54340/auth/v1 \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true \
  -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook "$auth_image"
start "$rest" -e PGRST_DB_URI -e PGRST_JWT_SECRET -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_SCHEMAS=public postgrest/postgrest:v13.0.4
LOCAL_AUTH_CONTAINER="$auth" LOCAL_REST_CONTAINER="$rest" node e2e/automations-local/gateway.mjs &
processes+=("$!")
curl --retry 30 --retry-all-errors --retry-delay 1 --fail --silent http://127.0.0.1:54340/auth/v1/health >/dev/null
node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
import {randomBytes,createHmac} from 'node:crypto';
function token(role) {
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const body = encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:'supabase-demo',role,exp:Math.floor(Date.now()/1000)+7200});
  return body+'.'+createHmac('sha256',process.env.GOTRUE_JWT_SECRET).update(body).digest('base64url');
}
writeFileSync(process.env.AUTOMATIONS_LOCAL_SETTINGS, JSON.stringify({
  API_URL:'http://127.0.0.1:54340', ANON_KEY:token('anon'), SERVICE_ROLE_KEY:token('service_role'),
  PASSWORD:randomBytes(24).toString('base64url'),DB_CONTAINER:process.env.AUTOMATIONS_DB_CONTAINER,
}),{mode:0o600});
JS
fingerprint() {
  docker exec -i -e PGPASSWORD "$db" psql -XqAt -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -f - \
    <e2e/automations-local/schema-fingerprint.sql >"$2"
}
if [[ $mode != release-full ]]; then
  echo 'Historical prerequisite fixture (105 migrations).'
  bash e2e/automations-local/upgrade.sh prerequisites
else
  bash e2e/automations-local/restore-auth-state.sh verify "$2" "$3"
  # Booting the native Auth service must also preserve the independently attested schema.
  fingerprint postgres "$dir/after-auth.json"
  python3 e2e/automations-local/receipts.py compare "$dir/restored.json" "$dir/after-auth.json" 'The restored database after Auth started'
  python3 e2e/automations-local/receipts.py restored "$3/schema-fingerprint.json" "$dir/after-auth.json" 'The restored database after Auth started (against the receipt)'
fi
# The installation base: a faithful copy of the primary database (faithful-copy.sh), which nothing may be connected
# to while it is copied. The services stop, and the cluster restarts without the pg_cron and pg_net workers, which
# keep a session on postgres. The copy keeps their catalogs: only the background processes are left out.
faithful_base() {
  kill ${processes[@]+"${processes[@]}"} 2>/dev/null || true
  docker stop "$auth" "$rest" >/dev/null
  local keep
  keep=$(docker exec -e PGPASSWORD "$db" psql -XAtq -U supabase_admin -d postgres -c "select string_agg(quote_literal(btrim(x)),', ')
    from unnest(string_to_array(current_setting('shared_preload_libraries'),',')) x where btrim(x) not in ('pg_cron','pg_net')")
  docker exec -e PGPASSWORD "$db" psql -XAtq -U supabase_admin -d postgres -c "alter system set shared_preload_libraries = $keep" >/dev/null
  docker restart "$db" >/dev/null
  ready
  [[ $(docker exec -e PGPASSWORD "$db" psql -XAtq -U supabase_admin -d postgres -c \
    "select count(*) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid()") == 0 ]] || {
    echo 'Something is still connected to postgres; it cannot be copied faithfully.' >&2; exit 1; }
  bash e2e/automations-local/faithful-copy.sh postgres "$1"
  fingerprint postgres "$dir/primary.json"
  fingerprint "$1" "$dir/$1.json"
  python3 e2e/automations-local/receipts.py compare "$dir/primary.json" "$dir/$1.json" "The installation base $1 (against the primary database)"
  # The rehearsals then run with the same preloaded libraries as production. The workers serve only postgres, so
  # copies of the base are never held open by them.
  docker exec -e PGPASSWORD "$db" psql -XAtq -U supabase_admin -d postgres -c 'alter system reset shared_preload_libraries' >/dev/null
  docker restart "$db" >/dev/null
  ready
}
v2_files=(supabase/migrations/2026112410{00,01,02,03,04,05,06}00_automation_v2_*.sql)
if [[ $mode == install-stops ]]; then
  # Production's order up to today, then the seven V2 files stopped after each one, resumed and backed out.
  bash e2e/automations-local/upgrade.sh pilot
  faithful_base install_base
  bash e2e/automations-local/install-stops.sh install_base
  exit
fi
if [[ $mode == synthetic-source ]]; then
  # A stand-in for production (its migrations up to today), the bundle its operator would make, and the receipts read
  # separately afterwards, for testing release-full end to end without production. Kept in the directory given.
  bash e2e/automations-local/upgrade.sh pilot
  synthetic=$(abspath "$2")
  mkdir -m 700 -p "$synthetic"
  # PostgreSQL 17 client tools in the disposable cluster, used as the operator uses theirs, as the postgres role.
  mkdir "$dir/pg-bin"
  for tool in psql pg_dump pg_dumpall pg_restore; do
    printf '#!/usr/bin/env bash\nexec docker exec -i -e PGPASSWORD -e PGOPTIONS -e PGDATABASE -e PGCONNECT_TIMEOUT -e PGAPPNAME -e TZ -e PGSSLMODE=disable -e PGUSER=postgres %q %s "$@"\n' \
      "$db" "$tool" >"$dir/pg-bin/$tool"
    chmod +x "$dir/pg-bin/$tool"
  done
  PG_BIN="$dir/pg-bin" bash e2e/automations-local/make-schema-bundle.sh "$synthetic/bundle"
  mkdir -m 700 "$synthetic/receipts"
  # The receipts are read through another connection than the bundle's, as the Management API reads production's.
  reader=(docker exec -i -e PGPASSWORD -e PGAPPNAME=agentflow-receipt-channel "$db" psql -XqAt -U postgres -d postgres -v ON_ERROR_STOP=1 -f -)
  "${reader[@]}" <e2e/automations-local/schema-fingerprint.sql >"$synthetic/receipts/schema-fingerprint.json"
  python3 e2e/automations-local/canonical-receipt.py query | "${reader[@]}" >"$synthetic/receipts/canonical.json"
  # The same reading through a channel that kept its own search_path, as a connector might: it must not pass.
  mkdir -m 700 "$synthetic/variants"
  sed 's/SET LOCAL search_path=pg_catalog;/SET LOCAL search_path="$user",public,extensions;/' e2e/automations-local/schema-fingerprint.sql \
    | "${reader[@]}" >"$synthetic/variants/other-settings.json"
  "${reader[@]}" <e2e/automations-local/auth-receipt.sql >"$dir/auth-reading.json"
  docker exec "$auth" wget -Y off -q -T 5 -O - http://127.0.0.1:9999/health >"$dir/auth-health.json"
  python3 e2e/automations-local/receipts.py auth-receipt "$dir/auth-reading.json" \
    "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$dir/auth-health.json")" \
    "$(docker image inspect --format '{{index .RepoDigests 0}}' "$auth_image" | cut -d@ -f2)" synthetic-release-full \
    "$synthetic/receipts/auth.json"
  # The target check finds a copy that is not faithful: a plain template copy loses the database's own privileges.
  faithful_base synthetic_base
  docker exec -e PGPASSWORD "$db" createdb -U supabase_admin -O postgres -T synthetic_base synthetic_plain
  fingerprint synthetic_plain "$dir/plain.json"
  if python3 e2e/automations-local/receipts.py compare "$dir/synthetic_base.json" "$dir/plain.json" 'A plain template copy' 2>"$dir/plain.err"; then
    echo 'A plain template copy passed the target check.' >&2; exit 1
  fi
  grep -q 'differs from the expected schema in: database' "$dir/plain.err"
  echo "PASS synthetic source: bundle and receipts written to $synthetic; a plain template copy is caught by the target check."
  exit
fi
if [[ $mode == release-full ]] && [[ $(docker exec -e PGPASSWORD "$db" psql -XAtq -U postgres -d postgres -c \
    "select to_regclass('private.automation_runs') is not null") == t ]]; then
  # The current production schema already holds the first release. Every migration and rollback target is a faithful
  # copy of the restored database, checked against the independent receipt before anything is applied to it.
  receipt=$(abspath "$3")/schema-fingerprint.json
  faithful_base install_base
  python3 e2e/automations-local/receipts.py restored "$receipt" "$dir/install_base.json" 'The migration and rollback target (install_base)'
  AUTOMATIONS_BASE_RECEIPT="$receipt" bash e2e/automations-local/install-stops.sh install_base
  # The guarded full rollback on real V2 work, on another faithful copy of the same verified target.
  bash e2e/automations-local/faithful-copy.sh install_base v2_work
  fingerprint v2_work "$dir/v2_work.json"
  python3 e2e/automations-local/receipts.py compare "$dir/install_base.json" "$dir/v2_work.json" 'The rollback rehearsal target before V2'
  python3 e2e/automations-local/receipts.py restored "$receipt" "$dir/v2_work.json" 'The rollback rehearsal target before V2 (against the receipt)'
  for file in "${v2_files[@]}"; do
    docker exec -i -e PGPASSWORD "$db" psql -Xq -U postgres -d v2_work -v ON_ERROR_STOP=1 -f - <"$file" >/dev/null
  done
  # A schema-only archive carries no rows. Production holds the one row the first release's session migration wrote,
  # which signing in to Automations needs, so the rehearsal target gets it the same way.
  docker exec -e PGPASSWORD "$db" psql -XAtq -U postgres -d v2_work -v ON_ERROR_STOP=1 -c \
    'insert into private.automation_session_cutover(singleton,installed_at) values (true,clock_timestamp()) on conflict do nothing' >/dev/null
  bash e2e/automations-local/rollback-rehearsal.sh v2_work
  fingerprint install_base "$dir/install_base-after.json"
  python3 e2e/automations-local/receipts.py compare "$dir/install_base.json" "$dir/install_base-after.json" 'The migration and rollback target after the rehearsals'
  python3 e2e/automations-local/receipts.py restored "$receipt" "$dir/install_base-after.json" 'The migration and rollback target after the rehearsals (against the receipt)'
  evidence=${AUTOMATION_UI_EVIDENCE:-/tmp/automation-ui-evidence}
  mkdir -p "$evidence"
  python3 - "$dir" "$receipt" "$evidence" "${LOCAL_POSTGRES_IMAGE:-$postgres_image}" <<'PY'
import hashlib, json, pathlib, sys
work, receipt, evidence, image = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), sys.argv[4]
stops = json.loads((evidence / 'automations-v2-install-stops.json').read_text())
families = json.loads(receipt.read_text())
target = {row['kind']: row for row in json.loads((work / 'install_base.json').read_text())['families']}
# Families the target matched only on PostgreSQL's precedence-aware printing (receipts.py restored allows that only for
# the families holding parsed expressions); every other family matched the receipt exactly.
reprinted = sorted(row['kind'] for row in families['families'] if row['sha256'] != target[row['kind']]['sha256'])
(evidence / 'automations-v2-release-full.json').write_text(json.dumps({
    'result': 'pass', 'postgres_image': image, 'receipt_sha256': hashlib.sha256(receipt.read_bytes()).hexdigest(),
    'receipt_captured_at': families['captured_at'], 'receipt_client': families['client']['application_name'],
    'fingerprint_families': len(families['families']),
    'families_matched_exactly': len(families['families']) - len(reprinted),
    'families_matched_on_precedence_aware_printing': reprinted,
    'matched_receipt': ['restored primary', 'after Auth start', 'install_base', 'rollback rehearsal target',
                        'install_base after the rehearsals'],
    'install_stop_targets_verified': stops['targets_verified'], 'install_stops': stops['result'],
    'rollback_rehearsal_on_v2_work': 'pass'}, indent=2) + '\n')
PY
  echo 'PASS release-full: the restored database, the installation base and every migration and rollback target matched the independent production receipt.'
  exit
fi
if [[ $mode == backend-first ]]; then
  # The release order rehearsed end to end: the database first, the clients afterwards, then the rollback.
  first_release=d85434f635bbf2d4118781e6d254798eef699363
  git cat-file -e "$first_release^{commit}" || { echo 'The first-release commit is not in this checkout. Fetch feat/self-service-automations.' >&2; exit 2; }
  psql=(docker exec -i -e PGPASSWORD "$db" psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1)
  bash e2e/automations-local/upgrade.sh pilot
  "${psql[@]}" -f - <e2e/automations-local/inflight-before.sql
  bash e2e/automations-local/upgrade.sh v2
  "${psql[@]}" -c "notify pgrst,'reload schema'"
  "${psql[@]}" -f - <e2e/automations-local/inflight-after.sql
  node e2e/automations-local/bootstrap.mjs
  anon=$(node -pe 'require(process.env.AUTOMATIONS_LOCAL_SETTINGS).ANON_KEY')
  mkdir "$dir/first-release"
  git archive "$first_release" | tar -x -C "$dir/first-release"
  ln -s "$PWD/node_modules" "$dir/first-release/node_modules"
  frontend=
  serve() { # One signed-in app at a time on the fixed loopback origin, built from the given checkout.
    if [[ -n $frontend ]]; then kill "$frontend" 2>/dev/null || true; wait "$frontend" 2>/dev/null || true; fi
    (cd "$1" && exec env -i PATH="$PATH" NO_PROXY='*' VITE_SUPABASE_ANON_KEY="$anon" VITE_SUPABASE_URL=http://127.0.0.1:54340 \
      node_modules/.bin/vite --config e2e/team-open-local/vite.local.config.ts) >>"$dir/vite.log" 2>&1 &
    frontend=$!
    processes+=("$frontend")
    curl --retry 30 --retry-all-errors --retry-delay 1 --fail --silent http://127.0.0.1:8089/login >/dev/null
  }
  export AUTOMATION_TEST_ACCOUNT_SUFFIX=b1
  # 1. The first release's own acceptance script, frontend and worker, unchanged, on the V2 database.
  serve "$dir/first-release"
  (cd "$dir/first-release"
    export AUTOMATION_IMPORT_MAP="$PWD/e2e/automations-local/import-map.json"
    "${DENO_BIN:-deno}" cache --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" e2e/automations-local/worker.ts
    node e2e/automations-local/builder.mjs)
  echo 'PASS the first-release frontend and worker passed their own acceptance script on the V2 database.'
  # 2. The V2 frontend on the automations the first release just published.
  serve "$PWD"
  node e2e/automations-local/backend-first.mjs candidate
  # 3. Rollback in its order: fence every agency, restore the first-release frontend, apply the guarded file.
  "${psql[@]}" -c 'update private.automation_release_controls set enrollment_enabled=false,dispatch_enabled=false'
  serve "$dir/first-release"
  "${psql[@]}" -1 -f - <supabase/migrations/rollback/20261124100600_automation_v2.rollback.sql
  "${psql[@]}" -c "notify pgrst,'reload schema'"
  node e2e/automations-local/backend-first.mjs rolled-back
  exit
fi
if [[ $mode == release || $mode == release-full ]]; then
  if [[ $mode == release ]]; then bash e2e/automations-local/legacy-upgrade.sh; fi
  bash e2e/automations-local/release-builds.sh "$dir"
  export AUTOMATION_TEST_ACCOUNT_SUFFIX=b1 AUTOMATION_IMPORT_MAP="$PWD/e2e/automations-local/import-map.json"
  "${DENO_BIN:-deno}" cache --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" e2e/automations-local/worker.ts
  node e2e/automations-local/release-cutover.mjs "$dir"
  for file in supabase/tests/automation_{messages,legacy_dispatch}.sql; do
    docker exec -i -e PGPASSWORD "$db" psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1 -f - <"$file"
  done
  exit
fi
bash e2e/automations-local/legacy-upgrade.sh
bash e2e/automations-local/upgrade.sh feature
for file in supabase/tests/automation_{sessions,authoring,runtime,messages,backlog,legacy_dispatch}.sql \
    supabase/tests/automation_v2_{authoring,tasks,appointments,inbound,policies}.sql; do
  docker exec -i -e PGPASSWORD "$db" psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$file"
done
python3 e2e/automations-local/concurrency.py
python3 e2e/automations-local/concurrency_v2.py
node e2e/automations-local/bootstrap.mjs
anon=$(node -pe 'require(process.env.AUTOMATIONS_LOCAL_SETTINGS).ANON_KEY')
env -i PATH="$PATH" NO_PROXY='*' VITE_SUPABASE_ANON_KEY="$anon" VITE_SUPABASE_URL=http://127.0.0.1:54340 \
  node_modules/.bin/vite --config e2e/team-open-local/vite.local.config.ts >"$dir/vite.log" 2>&1 &
vite=$!
processes+=("$vite")
curl --retry 30 --retry-all-errors --retry-delay 1 --fail --silent http://127.0.0.1:8089/login >/dev/null
export AUTOMATION_TEST_ACCOUNT_SUFFIX=b1
export AUTOMATION_IMPORT_MAP="$PWD/e2e/automations-local/import-map.json"
"${DENO_BIN:-deno}" cache --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" e2e/automations-local/worker.ts
node e2e/automations-local/builder.mjs
node e2e/automations-local/mobile-keyboard.mjs
node e2e/automations-local/session-tabs.mjs
# Automations V2: the five workflows through the CRM's own entry points, then the editor in both layouts and themes.
node e2e/automations-local/v2-workflows.mjs
node e2e/automations-local/v2-editor.mjs
# The CRM screens V2 changed. The Inbounds room is a build option, so the same checkout is served again with it on.
kill "$vite" 2>/dev/null || true
wait "$vite" 2>/dev/null || true
env -i PATH="$PATH" NO_PROXY='*' VITE_SUPABASE_ANON_KEY="$anon" VITE_SUPABASE_URL=http://127.0.0.1:54340 VITE_INBOUNDS_ROOM=true \
  node_modules/.bin/vite --config e2e/team-open-local/vite.local.config.ts >>"$dir/vite.log" 2>&1 &
processes+=("$!")
curl --retry 30 --retry-all-errors --retry-delay 1 --fail --silent http://127.0.0.1:8089/login >/dev/null
node e2e/automations-local/v2-crm.mjs
# Dedicated fixture tenants for exact SMS consent and signed receipt tests follow the UI acceptance.
export AUTOMATION_TEST_SETTINGS="$AUTOMATIONS_LOCAL_SETTINGS"
export AUTOMATION_TEST_ACCOUNT_SUFFIX=a1
export PGOPTIONS="-c agentflow.synthetic_channels=on"
docker exec -i -e PGOPTIONS -e PGPASSWORD "$db" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/tests/automations/channel-fixture.sql
native() {
  "${DENO_BIN:-deno}" cache --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" "$1"
  "${DENO_BIN:-deno}" run --cached-only --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" \
    --allow-env --allow-read --allow-net=127.0.0.1:54340,127.0.0.1:54334 "$@"
}
for script in scripts/tests/automations/{channel-native,receipt-native}.ts; do native "$script"; done
# Appointment reminders the worker has picked up, then moved or cancelled before the provider handoff.
docker exec -i -e PGOPTIONS -e PGPASSWORD "$db" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/tests/automations/appointment-handoff-fixture.sql
native scripts/tests/automations/appointment-handoff-native.ts
docker exec -i -e PGPASSWORD "$db" psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/tests/automations/appointment-handoff-check.sql
# A reminder refused at its final authorization (outside sending hours) is held without spending its step: once the
# window opens, the next lease sends it exactly once.
refusal() { docker exec -i -e PGOPTIONS -e PGPASSWORD "$db" psql -Xq -U postgres -d postgres -v ON_ERROR_STOP=1 -v phase="$1" -f - \
  < scripts/tests/automations/appointment-refusal.sql; }
refusal refuse
native scripts/tests/automations/appointment-refusal-native.ts refuse
refusal open
native scripts/tests/automations/appointment-refusal-native.ts send
refusal check
