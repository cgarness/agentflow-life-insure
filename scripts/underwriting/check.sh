#!/usr/bin/env bash
set -euo pipefail
mkdir -p .underwriting-check
printf '{"type":"commonjs"}\n' > .underwriting-check/package.json
npx --no-install tsc --noEmit
npx --no-install tsc --noEmit -p tsconfig.underwriting.json
npx --no-install tsc -p tsconfig.underwriting.core.json
node --test tests/underwriting/*.test.cjs
npx --no-install vitest run src/underwriting/__tests__/host.test.tsx
npm run build
