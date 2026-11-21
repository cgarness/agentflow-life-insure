#!/usr/bin/env bash
# Run from a checkout with npm ci, docker, node, Playwright, Chromium and Deno installed.
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
dir=$(mktemp -d)
prefix="af-auto-test-$$"
network="$prefix-net"
db="$prefix-db"
auth="$prefix-auth"
rest="$prefix-rest"
processes=()
created=()
cleanup() {
  for p in "${processes[@]}"; do kill "$p" 2>/dev/null || true; done
  for c in "${created[@]}"; do docker rm -fv "$c" >/dev/null || true; done
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
start "$db" -e POSTGRES_PASSWORD "${LOCAL_POSTGRES_IMAGE:-supabase/postgres:17.6.1.085}" postgres -D /etc/postgresql -c cron.launch_active_jobs=off
for _ in {1..90}; do
  if docker exec -e PGPASSWORD "$db" psql -h 127.0.0.1 -U supabase_admin -d postgres -Atqc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
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
  -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook supabase/gotrue:v2.177.0
start "$rest" -e PGRST_DB_URI -e PGRST_JWT_SECRET -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_SCHEMAS=public postgrest/postgrest:v13.0.4
LOCAL_AUTH_CONTAINER="$auth" LOCAL_REST_CONTAINER="$rest" node e2e/automations-local/gateway.mjs &
processes+=("$!")
curl --retry 30 --retry-all-errors --retry-delay 1 --fail --silent http://127.0.0.1:54340/auth/v1/health >/dev/null
bash e2e/automations-local/upgrade.sh prerequisites
bash e2e/automations-local/legacy-upgrade.sh
bash e2e/automations-local/upgrade.sh feature
for file in supabase/tests/automation_{sessions,authoring,runtime,messages,backlog}.sql; do
  docker exec -i -e PGPASSWORD "$db" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$file"
done
python3 e2e/automations-local/concurrency.py
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
node e2e/automations-local/bootstrap.mjs
anon=$(node -pe 'require(process.env.AUTOMATIONS_LOCAL_SETTINGS).ANON_KEY')
env -i PATH="$PATH" NO_PROXY='*' VITE_SUPABASE_ANON_KEY="$anon" VITE_SUPABASE_URL=http://127.0.0.1:54340 \
  node_modules/.bin/vite --config e2e/team-open-local/vite.local.config.ts >"$dir/vite.log" 2>&1 &
processes+=("$!")
curl --retry 30 --retry-all-errors --retry-delay 1 --fail --silent http://127.0.0.1:8089/login >/dev/null
export AUTOMATION_TEST_ACCOUNT_SUFFIX=b1
export AUTOMATION_IMPORT_MAP="$PWD/e2e/automations-local/import-map.json"
"${DENO_BIN:-deno}" cache --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" e2e/automations-local/worker.ts
node e2e/automations-local/builder.mjs
node e2e/automations-local/mobile-keyboard.mjs
node e2e/automations-local/session-tabs.mjs
# Dedicated fixture tenants for exact SMS consent and signed receipt tests follow the UI acceptance.
export AUTOMATION_TEST_SETTINGS="$AUTOMATIONS_LOCAL_SETTINGS"
export AUTOMATION_TEST_ACCOUNT_SUFFIX=a1
export PGOPTIONS="-c agentflow.synthetic_channels=on"
docker exec -i -e PGOPTIONS -e PGPASSWORD "$db" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/tests/automations/channel-fixture.sql
for script in scripts/tests/automations/{channel-native,receipt-native}.ts; do
  "${DENO_BIN:-deno}" cache --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" "$script"
  "${DENO_BIN:-deno}" run --cached-only --node-modules-dir=manual --no-lock --import-map="$AUTOMATION_IMPORT_MAP" \
    --allow-env --allow-read --allow-net=127.0.0.1:54340,127.0.0.1:54334 "$script"
done
