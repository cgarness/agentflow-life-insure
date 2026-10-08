# SMS integration verification

This is an isolated build, not a production release. Original AgentFlow implementation baseline: `b90e12d3bdcfb188ca0fbc6f25e971aaf77ddbf1`. Current CI comparison base: `3f7fa519011ab22307dfdda802b045b2028cd7b2`. UV baseline: `8a1d81e78d096c521b325b2b8232c204007e881e`. The newer Reports releases were merged into the review branch, preserving both documentation histories; no application conflict occurred.

## Completed local evidence

- 43 real PostgreSQL-engine assertions in two disposable PGlite databases. All UV migrations and its real intake RPC run before the paired AF bridge tests. Covers neither/info/marketing/both choices, source evidence, outbox, repeated and unchecked forms, activation cutoff, nonce replay, browser ACLs/RLS, confirmation-before-recurring, durable receipts, duplicate attempts, STOP before/after grant, unknown-contact suppression, DNC normalization, immutable evidence, 30-minute expiry and uncertain outcome hold.
- 35 Deno tests: 13 new SMS boundary tests plus 22 existing A2P tests. Includes exact signed body/method/path/time, bounded body, sender/account/purpose failure, fresh eligibility mismatch, STOP variants/HELP/START, 21610, timeout and accepted-message history failure without duplicate automatic send.
- 170 frontend tests pass across the focused suites (167 existing/new composer/contact/A2P tests, plus 3 new status-hook isolation tests); 3 existing tests remain skipped. Covers preserved drafts, deliberate purpose, templates/workflows, same-render contact/actor isolation and View As.
- UV's 57 existing tests and production build pass. No UV frontend/legal changes.
- Both TypeScript checks: root passes; actual AgentFlow app comparison is base 87 / candidate 85, with zero added diagnostics. Two pre-existing template attachment diagnostics are resolved in the touched serialization path.
- Eight affected Edge entry points type-check. The local check maps the blocked direct Deno URL loader to the installed Supabase 2.98.0 SDK; the new UV code is pinned to that exact version. CI must also check the normal remote imports and lockfile.
- Existing A2P SQL regression passes. Scoped frontend ESLint has zero errors and only the existing Contact useLayoutEffect dependency warning. Both production builds and the synthetic visual-fixture build pass; existing Browserslist and bundle-size warnings remain.
- Existing voice/JWT/inbound-routing source and the canonical DNC migration are unchanged. SQL tests assert the private DNC helper definitions and ACLs are unchanged. No dependency manifest/lockfile changed.

## Pending gates — do not claim these passed

Native PostgreSQL contention/DNC regression and Chromium desktop/mobile execution are prepared in `.github/workflows/sms-consent.yml`. The local runtime refused the non-root PostgreSQL startup and Chromium's Unix socket; agent-browser also could not start its daemon. The synthetic fixture compiles, but no browser screenshot/pass is claimed. The CI job uses fresh local PostgreSQL databases and a browser fixture with no external services or real messages.

Actual pg_net post-commit delivery, recovery cron, Vault/Edge-secret parity, deployed-function preimages, live callback/account/service mapping, provider STOP/HELP settings, and an authorized controlled live message still require release-stage verification. Cross-project HTTP and Twilio are simulated at their boundaries locally; the SQL harness does not substitute for a live provider test.

Chris explicitly approved publication of both review branches, draft PRs and remaining CI on October 6. The earlier publication approval block is resolved. GitHub connector publication preserves the reviewed file trees while generating new commit identities because local Git has no credentials. Production deployment and live texting remain outside this approval.

## Reproduce

- `UV_SOURCE_ROOT=/path/to/reviewed/uv A2P_PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-sms-consent.mjs`
- Native equivalent: set `SMS_NATIVE_PG` to a disposable localhost cluster URL instead of the PGlite module. The harness rejects non-local hosts and uses new databases.
- `deno test --allow-env supabase/functions/_shared/sms/sms_test.ts supabase/functions/_shared/a2p/workflow_test.ts`
- CI pins the paired UV commit and runs native concurrency, existing DNC checks, Edge imports and the browser fixture. Inspect results for the exact published heads; publication does not authorize deployment.
