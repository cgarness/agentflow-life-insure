# Inbounds room V1 verification and release boundary

Status: branch build; not merged or applied to production. Feature flag `VITE_INBOUNDS_ROOM` defaults off. No numbers were changed and no customer calls were placed.

Desktop and mobile screenshots in this folder use synthetic demo data from the isolated browser harness. They show the implemented components, not production performance.

## Evidence

### November 3 release-preparation update

The dashboard missed-call test failed identically on a clean `e02342f` worktree: fixed October 29 rows were outside the widget's moving lookback. Its test clock is now anchored to the fixture day and restored afterward; an additional expired row must still be excluded. All seven tests pass. Dashboard production logic is unchanged.

Cloud Deno compilation identified two nullable-type mismatches in `twilio-voice-inbound/request.ts`: the dependency signature now accepts the same null input as the existing parser, and an absent child SID is passed as null to the existing identity verifier (which already treats null/undefined identically). The release manifest includes the updated request module hash. No deployed source changed.

The CDN serves two minifications of `tslib@2.8.1` at the same URL: SHA-256 `c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9` and `ebce3cd5facb654623020337f867b426ba95f71596ba87acc9e6c6f4e55905ca`. They differ only by six redundant grouping parentheses and normalize to the same 14,644-byte module (`b3841065312ee10cfd92df0ecd3616306b5c42fdddc8e8765ede04ee6433a30c`). **The final `deno.lock` is unchanged from base.** To avoid unstable CDN bytes, the A2P, SMS and Inbounds CI commands use `scripts/deno-ci-import-map.json`, mapping only that URL to `node_modules/tslib/tslib.es6.mjs`. `npm ci` verifies the existing package-lock integrity; the guard requires version 2.8.1. The original npm module exposes the same 33 exports. This is CI-only, with no fake library or production import-map change, and all other remote dependency checks remain intact.

Pinned Deno 2.5.2 cloud compilation checks all four complete phone-handler entrypoints with `--frozen`. The full handler check, PostgreSQL contention, regression tests and frontend build passed on `e4ce3a06c6d977d0a13ed3348682e16d4e0c917d` ([run 41699221196](https://github.com/cgarness/agentflow-life-insure/actions/runs/41699221196)); final cloud results after the CI dependency mapping remain to be recorded in the PR.

The NumberReputation correction removes its premature raw-row assertion and validates the final calculated query result as `Promise<PhoneNumber[]>`. Root TypeScript and scoped ESLint pass; exact-base application comparison is **base=80, candidate=79, new=0**. Both baseline comparison scripts are unchanged. This supersedes the original 80/80 type count below.

Read-only production preflight reverified all three guarded SQL definitions and all 15 live source files in the four Edge bundles against base `e02342f`. Versions and `verify_jwt=false` remain unchanged. Room schema is absent; all 17 unique files in `release-hashes.json` still match. Vercel production is READY at `e02342f`. No production changes or live-call tests were performed. Pending SQL/Edge approval and frontend/number gates below still apply.

### Original build evidence

- `npx tsc --noEmit`: passes (the repository root is a references-only config). The stronger `npx tsc --noEmit -p tsconfig.app.json` reports the same 80 existing diagnostics as clean base `e02342fa74afddea2342e9640fb18a274da2367a`; no added error locations/codes. Do not call the application-wide type check clean.
- Production build with `VITE_INBOUNDS_ROOM=true`: passes; existing large-bundle warning remains.
- Inbound regression + room phone + settings + statistics tests: 288 passing tests across 22 files, including failed-save retention and canonical disposition confirmation.
- PGlite, exact migration bytes and captured live function preimages: passes tenant isolation, admin/agent authorization, dedicated DID tagging, all eligible agents, same-agent session exclusion, busy reservations, first signed answer wins, room-only identity claiming, pending wrap-up after refresh, outbound blocking, receipt release, caller details, scoped counts and expired session voicemail.
- PGlite does not prove contention. `.github/workflows/inbounds-room.yml` runs the same harness against a disposable PostgreSQL 17.6 service plus two true simultaneous-transaction cases: two inbound planners, and outbound insertion versus inbound planning. Its result must be recorded before production approval. Chris explicitly approved publication on November 3. PR #509 is published; PostgreSQL CI is running. Its first run exposed a test-runner connection reservation requirement; the harness now uses a reserved connection for migration transactions while retaining a separate pool for concurrency tests.
- Synthetic Playwright against the actual room components: enter, script collapse/expand, ring/answer/hang up, blocked receiving while wrap-up is pending, required outcome/notes, confirmed save and unlock; desktop 1440px and mobile 390px without horizontal overflow. Calls, data, tokens and SDK are synthetic and all non-local requests are blocked. This does not test Twilio audio or signed-in production behavior.
- Edge source baseline equals the read-only live bundles: inbound v71 (10 files), token v57, claim v62, outbound webhook v60. Full remote Deno check was blocked by dependency network access. Offline import-map comparison is not a deployment verification; production bundle checks remain required. The offline check reports the same 31 diagnostics on the clean base and this branch (including import-map typing artifacts).
- New React components are under 200 lines; form controls have labels, call states are announced, keyboard focus is visible, stale requests and identity changes cannot release pending wrap-up.

## Reproduce

- `npx vitest run src/lib/__tests__/inbound src/hooks/__tests__/useInboundsVoice.test.tsx src/hooks/__tests__/useRoomDisposition.test.tsx src/hooks/__tests__/useFloatingDialerDispositions.test.tsx src/components/inbounds/__tests__`
- Disposable local PostgreSQL, empty database only: `PGURL=postgresql://...@127.0.0.1:5432/disposable_room node scripts/tests/inbounds/run.mjs`. The harness refuses remote hosts.
- PGlite alternative (single-session only): install `@electric-sql/pglite` outside the application, set `PGLITE_MODULE` to its local `dist/index.js`, then run that same script.
- Browser harness: install Playwright outside the application, set `PLAYWRIGHT_MODULE` to its local `index.mjs`, then `node scripts/tests/inbounds/browser/check.mjs`. It starts a local test-only Vite server and uses test aliases, never the real Supabase client or phone SDK.

## Exact production release preparation

1. Re-read live definitions and bundles. The pending migration aborts if `is_agent_busy`, `plan_inbound_route` or `claim_inbound_call` differs from the captured preimage. Do not remove the drift guards to force a deployment.
2. Obtain exact approval for `supabase/migrations/pending/20261103170954_inbounds_room_v1.sql` and the four complete Edge bundles listed in `release-hashes.json`. Apply the migration through the normal reviewed migration process. It adds no enabled numbers and backfills no calls.
3. Deploy `twilio-token`, `twilio-voice-inbound`, `inbound-call-claim`, and `twilio-voice-webhook`, including their complete current dependencies and the new `_shared/inbounds-room.ts`. Preserve `verify_jwt=false`, master-account JWT scope and signed Twilio callbacks. Backend first: new webhook handlers require the new RPC/column even for ordinary calls.
4. Check grants/RLS and security advisors, then use approved synthetic identities/numbers to verify real simultaneous ringing, first answer, ongoing CRM-call exclusion, media, cancellation, missed calls, voicemail playback, duplicate callback replay, refresh/rejoin and mandatory dispositions. Confirm existing non-room inbound/outbound behavior.
5. Separately approve frontend merge/flag and exact experiment DIDs. An active agency number must not be the default, personal or a direct line. The room is a 10-agent pilot (Twilio client fan-out limit), with 45-second leases renewed every 10 seconds. Reload/closed-tab recovery can wait up to 45 seconds.
6. Safe rollback starts with frontend flag off and pausing room sessions; coordinate existing calls before changing number routing. Turning a number off intentionally returns future calls to ordinary routing; never do that silently during an ad experiment. Retain tagged call history, frozen identities and pending disposition receipts. Do not drop the schema while these handlers are deployed.

Known boundaries: Today uses the viewer's local midnight; activity lists show latest 50 records today. An unresolved provider ownership callback deliberately keeps the accepting browser paused. This build does not authorize production migration, deploy, configuration changes or live call testing.
