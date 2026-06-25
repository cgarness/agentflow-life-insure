#!/usr/bin/env bash
# Deploy AI Testing POC: migration, edge secrets, and functions.
# Prereq: npx supabase login  (or valid SUPABASE_ACCESS_TOKEN with project access)
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="${SUPABASE_PROJECT_REF:-jncvvsvckxhqgqvkppmj}"
ENV_FILE="supabase/functions/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy keys from Supabase Dashboard or create from template."
  exit 1
fi

echo "==> Linking project $PROJECT_REF"
npx supabase link --project-ref "$PROJECT_REF" || true

echo "==> Pushing migration"
npx supabase db push --linked --yes

echo "==> Setting edge secrets from $ENV_FILE"
npx supabase secrets set --env-file "$ENV_FILE" --project-ref "$PROJECT_REF"

FUNCS=(
  ai-testing-place-call
  ai-testing-start-browser-session
  ai-testing-end-call
  ai-testing-twiml
  ai-testing-status
  ai-testing-recording-status
  ai-testing-openai-webhook
  ai-testing-relay-ws
  ai-testing-stream-ws
)

for fn in "${FUNCS[@]}"; do
  echo "==> Deploying $fn"
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

echo "Done. Open app as Super Admin → AI Testing."
