# Toll-Free Number Purchasing — verification and release handoff

**Status:** Backend and production frontend released; exact deployment, aliases and public feature assets verified. Documentation closeout is published on a separate review branch.

**Completed:** November 4, 2026 UTC (November 3 Pacific).

**Branch:** `feat/toll-free-number-purchase-20261103`.

**Exact main baseline:** `0e74428259275c9281518832747a627a4f635a80`.

Chris approved branch implementation, a pending migration, documentation and isolated verification after reviewing the plan and intended files. This approval did not authorize a production migration, deployment, number purchase, assignment, call or SMS. None occurred. Main and the remote feature branch still pointed to the exact baseline at the final read-only conflict check. That was the build-stage status. Subsequent explicit release approval and actual backend/publication evidence are recorded below.

## Production backend release — November 3, 2026 Pacific

Chris approved the concrete release package. PR #513 initially published the exact approved tree as `4e0a18ad`; connected GitHub publication changed commit metadata only. After the documented Docker test-topology correction, native PostgreSQL 17.6 job `126382290719` passed all 131 assertions and 12 contention scenarios with 11 observed lock waits. Frozen-lock Edge checks passed on the same head.

Applied the exact SQL once as `20261104041151_phone_number_purchase_operations`; history contains one 19,224-byte statement with matching raw MD5 `abb94ea6f7df6b1b9fbb14c6fdcb548e` and SHA-256 `faa9910d421f86cd107f954b41586ceb9149ccaab09eaf8031172331db94e1e8`. The file moved from pending to its recorded path without changing bytes. Its PENDING comment is authoring history, not deployment state; never replay it.

All 8 new functions, 18 columns, 12 constraints and 5 indexes match the approved SQL. RLS is enabled; no anonymous, authenticated or service-role direct table access exists. All 605 pre-existing public/private functions, 13 relevant policies, Inbounds guards and phone ownership fingerprints remain unchanged. The ledger has zero rows; all 21 existing phone numbers remain non-Inbounds, with zero toll-free numbers. Advisors changed 264→265 solely for the expected private-ledger `rls_enabled_no_policy` INFO; no new WARN/ERROR. The deliberate RPC-only design must retain its no-direct-access boundary. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Released and read back SMS v61, workflow v50, consent worker v26, ClearPath v25, search v59 and buy v65 in that order. All 71 source modules match approved payloads; all 52 unrelated live module copies remain unchanged, including deployed callback/dispatch/signature/alert differences. All retain `verify_jwt=false`, no import map and ACTIVE status. Seven bare POST rejection checks returned expected 401/403/409 responses; no authentication, quote, purchase, worker action or provider transaction was executed.

The final cloud browser check exposed ANSI formatting in the Vite startup banner. The checker now verifies actual fixture HTTP readiness with every UI/security assertion retained; the complete browser check passed locally with CI color settings and zero external requests. Final-head CI, merge and production deployment are complete. Backend and frontend evidence is in [production-release.json](production-release.json). No application/SQL/payload byte change was needed for the CI corrections.

## Final CI, merge and production frontend verification

All **seven workflows and eleven jobs** passed on `049750716b1e176d24847722d20078df7405e371`. [PR #513](https://github.com/cgarness/agentflow-life-insure/pull/513) merged as `2b6f5cefe4f4d7980ab670067a5634e320cd20fd`, with an identical Git tree. The final phone workflow passed its 68 focused UI/Inbounds tests, 99 mocked purchase/SMS tests, frozen-lock Edge checks, native PostgreSQL 17.6 checks (131 assertions, 12 concurrency scenarios, 11 observed lock waits), and browser interactions with zero external requests.

The first full Reports comparison found an immediate mapping-readiness assertion in an unchanged Google Sheets test: expected First Name, received Don't import. Control presence can precede the separate automatic-mapping effect. One paired local run passed all 26 tests on both revisions (Node 24.22.1; cloud uses 22.16.0). One **unchanged** cloud rerun passed the complete gate: baseline 6,705 passed / 3 failed / 35 pending; candidate 6,765 passed / 1 pre-existing failed / 35 pending. The unchanged baseline also exhibited two different Google Sheets readiness failures, while the candidate passed all 26 Google Sheets tests. No test, timeout or comparison rule was weakened. Application diagnostics remained 79/79, with no additions or removals; runtime errors were baseline 1 / candidate 0. The candidate retains the pre-existing recording-retention assertion and shared environment-related failed suites; this is a passing **no-new-regressions comparison**, not a claim that the entire repository is error-free. Reports-specific tests passed 360 with 1 skipped; changed-TypeScript lint and build passed. [Successful job](https://github.com/cgarness/agentflow-life-insure/actions/runs/41773138479/job/126394075072).

**Resolved blocker history:** At `2026-11-04T05:05:58Z`, Vercel rejected the initial production deployment with “Deployment rate limited — retry in 24 hours.” Both linked status contexts failed, and production then remained at `0e744282` with its incompatible unquoted purchase UI. Chris subsequently reported upgrading to Pro and explicitly requested a retry. The normal approved production deployment succeeded; no assistant billing or project-settings change was made.

**Production deployment:** `dpl_6Ue8L6EDqwhqfThT4UJeUA9wuDZc` is READY for project `agentflow`, target `production`, exact main commit `2b6f5cefe4f4d7980ab670067a5634e320cd20fd`. READY time is `2026-11-04T06:42:04.207Z` (November 3, 10:42 p.m. Pacific). Provider metadata assigns both `www.fflagent.com` and `fflagent.com` to it; the apex redirects to `www`.

**Public artifact verification:** Unauthenticated GETs of `https://www.fflagent.com/` and `/assets/index-DFiSUeNt.js` returned 200. All six markers were present: agency-number selection, purchase review, Toll-Free, SMS unavailable, search endpoint and buy endpoint. HTML SHA-256 is `4f2fc027f0801b62faf1941219de709d634b7448c8dff525edd8a3ac515f87b0`; entry-module SHA-256 is `212971f7aa7f3306735152fd09a45bd3852e6d3add5d4032c4c5f1ac1bd0cb58`. The verifier did not execute JavaScript, authenticate, call backend APIs or test purchasing. The eight manifest source hashes match the approved merge; downloaded bundle hashes are evidence, not a claimed comparison against an approved compiled-bundle hash.

**Observation and limits:** The Vercel error/fatal query from `2026-11-04T06:41:28Z` through `2026-11-04T06:42:59.804Z` returned no matching logs; browser JavaScript and Supabase Edge Functions are outside that scan. No real inventory/account-pricing/provisioning, signed-in UI or live media was tested. Purchases, assignments, calls and SMS remain zero. SQL and Edge deployments were not repeated. No release blocker remains. These repository bookkeeping updates are published on the documentation-only review branch; PR #513's body records the live release.

## Implemented behavior

The existing purchase surface defaults to Local and supports Toll-Free with Prefer 800, 800 only and 888 only. Local filters and subaccount inventory remain supported. Toll-free inventory, exact-number quote checks and every purchase use the existing master credential resolver. The UI displays the actual selected numbers, account current monthly rental, inbound voice price per minute, currency, expiration and exact decimal cart totals before confirmation. Usage and applicable taxes are identified as additional.

Search, quote, status and purchase authenticate the bearer token and require the current database profile to be Active and Admin/Super Admin in its actual organization. Client scope is only a consistency check. View As, stale context, inactive profiles, unsupported roles, cross-organization requests and suspended/unconfigured telephony are denied. Service credentials remain server-side. The database rechecks authorization and expiry after waiting for the purchase lock.

The private ledger binds the original actor, organization, master account, exact number and quote. Only the atomic claim winner may issue the single provisioning POST. Organization/request keys, attempted account/number pairs and provider PN SIDs have unique constraints. Unknown provider outcomes retain the attempted barrier indefinitely; no new key, timeout, browser refresh or rollback authorizes another POST. Recovery verifies only an already-recorded matching PN receipt and retries atomic database finalization. It never adopts an unrelated master-owned number by E.164.

Finalization saves the phone row and completion together: original `organization_id`, `assignment_type='agency'`, null assignee, nondefault, no direct line, no Inbounds-only flag, active status and pending Trust Hub status. Existing rows are not overwritten. An administrator may then use the existing authenticated `set_inbounds_number` workflow. The small caller-ID fallback correction prevents an all-dedicated input from returning its first excluded number.

The shared SMS guard rejects all seven NANP toll-free prefixes before the existing A2P legacy bypass. This build offers no SMS enablement or verification submission. The release must include all four existing consumers of the shared gate.

## Results

Counts describe the named suites; the repeated assembled-package checks are additional executions, not unique tests to sum into a single coverage count.

| Check | Result | Evidence and scope |
|---|---:|---|
| Frontend, caller-ID and existing Inbounds suites | **68 passed**, seven files | Schema 6; purchase hook 19; dialog 11; caller ID 22; Inbounds API 3; room voice 4; disposition 3. |
| Search/shared/purchase handler suites | **44 passed** | Search 9; shared contracts/auth/inventory/pricing 14; purchase/recovery 21. Repeated successfully against the exact final live-derived search/buy packages. |
| Source SMS/A2P/ClearPath regressions | **55 passed** | New toll-free gate 6; A2P 22; SMS 20; manual sender 5; wire 1; ClearPath 1. The six new gate tests were rerun after a test-only lint correction. |
| Four complete live-derived SMS packages | **24 passed** | Six toll-free gate tests against each sending bundle, including its preserved live dependencies. |
| Full Edge packages | **Six compiled** | Search, buy, twilio-sms, workflow-executor, sms-consent-worker and clearpath-lead-alert; Deno 2.5.6 and the original frozen dependency lock. |
| Native PostgreSQL | **131 SQL assertions + 12 concurrency scenarios passed** | Eleven actual lock waits proven with `pg_blocking_pids`; final command exited 0. |
| Independent in-memory SQL run | **131 assertions passed** | PGlite validates SQL semantics; native PostgreSQL supplies the concurrency evidence. |
| Browser fixture | **Passed** | Actual dialog/hook: desktop and 390px mobile; Local/Toll-Free and 800 order; mixed cart; exact prices; keyboard confirmation/close; timeout/status-only recovery; role/View As denial; old protocol rejection. Zero external requests or page errors. |
| `npx tsc --noEmit` | **Passed** | Required root command. |
| Actual application type comparison | **Base 79 / candidate 79 / new 0** | Exact main baseline; existing diagnostics remain. Root TypeScript alone is not used to claim an error-free application. |
| Scoped frontend ESLint and new backend Deno lint | **Passed** | All new backend modules/handler tests and new SMS gate test. The unchanged legacy `sending.ts` still has two existing `no-explicit-any` diagnostics; its narrow gate introduces neither. |
| Production build | **Passed** | Existing dynamic-import and large-chunk warnings remain; no build limits were relaxed. |
| Release preservation | **Passed** | Six payload hashes, 71 bundled module hashes, frontend files and approved SQL match the manifest; 52 unrelated live module copies are preserved byte-for-byte. |
| Release drift rejection | **Passed** | Changed captured version, source bytes or `verify_jwt` each fails before writing a package. |
| Whitespace and runner syntax | **Passed** | `git diff --check`, Node syntax checks; no package/lockfile changes. |

### Security, payment and ownership coverage

The mocked provider tests cover Local versus master TollFree inventory, 800 ordering/888 fallback, unavailable numbers, malformed responses, actual pricing fields, price changes and quote expiry. The final decoder uses the documented Voice Pricing v2 `destination_number`. Only wholly null/absent selected-number inbound pricing permits a unique matching US number-type `current_price` lookup. Identity/currency mismatches, partial nulls, read failures, malformed prices and ambiguous country rates fail closed.

Billable-boundary tests assert one POST for simultaneous/replayed requests, no POST from quote/status or incompatible old clients, no automatic repurchase after provider timeout, invalid success or lost receipt, and no cross-tenant adoption. A failed claim that expires and a timed-out request that never claimed can leave status-only recovery safely after quote expiry. Changes in authorization immediately before an attempt are rejected.

The SQL harness asserts service-only RPC execution, no direct ledger grants even to service role, RLS, pinned search paths, immutable binding, expired quotes, request collisions, receipt conflicts, post-revocation original ownership and fault-injected atomic rollback/recovery. It compares every pre-existing function definition/ACL and table RLS/ACL before and after the additive migration.

Existing Inbounds migrations and guards are loaded into the fresh fixture. The real authenticated RPC accepts purchased 800 and 888 fixtures and denies non-admin, cross-organization, default, personal, direct-line, inactive and routing-v1 cases. A service-role shortcut is denied. Existing outbound insertion guards reject the designated toll-free numbers while an ordinary local number remains eligible.

Native contention scenarios include identical requests, different request keys, different organizations targeting the same master number, request collisions, shared receipt SIDs, simultaneous completion, independent numbers, permission revocation while waiting, telephony suspension while waiting and expiry while waiting. The runner requires a fresh loopback database named `phone_number_purchases_*`, rejects connection override parameters and refuses any pre-existing public/private/auth data tables.

## Isolated environment evidence

The native database and full frozen-lock Edge checks ran in a temporary, nonpersistent Vercel Sandbox with no application deployment, exposed route, production database connection or Twilio credentials. Image:

`vercel/sandbox/node@sha256:54359c96acc5ed74855d78883f6e1199a2f8f25381c65a4e9f0cc41d8196ebff`

Runtime: Ubuntu 26.04.1, Node 22.23.4, Deno 2.5.6, PostgreSQL 18.6 and `postgres` 3.4.9. Session `sbx_xOoD4Oq7v0cN5J7RzOjrgar5NuaA` was explicitly stopped after logs were exported. No persistent snapshot was created.

| Final command | Result |
|---|---|
| `cmd_1a44c02410bf4b27a63966bee43f` — six frozen-lock package checks | Exit 0 |
| `cmd_531ad9f30d6543e4af4ad6118adc` — 44 assembled purchase tests | Exit 0 |
| `cmd_9bfb2a22ded44cac9264ad22832d` — 24 assembled SMS gate tests | Exit 0 |
| `cmd_6df24e83628d4bc28762e0641553` — native SQL and contention | Exit 0 |

Native-tested file SHA-256 values matched the workspace:

```text
faa9910d421f86cd107f954b41586ceb9149ccaab09eaf8031172331db94e1e8  pending migration
e437d4ee781aa0ea56b836c00b9dad8bd527a68970a9c9b4786976838f47309b  SQL assertions
0c60d15b657d4cd22f272736ccc9fcf76c5b2cad695aab86bad2c7bcb74307d9  run.mjs
ae16c248e65f74eeab6197194ca5c6ef53dff4681f1a47aedfa354dd44c9a7e3  concurrency.mjs
```

The initial isolated run used PostgreSQL 18.6. The subsequently published GitHub workflow also passed the same unchanged synthetic runner on production-matching PostgreSQL 17.6; see the release update above. Local Deno could not reach its remote dependency URLs; the complete frozen-lock sandbox checks resolved that verification gap without changing the lock. The existing narrowly scoped CI `tslib` import map was retained.

## Reproduction

Use the repository's existing dependency installation and the commands in `.github/workflows/phone-number-purchases.yml`. The focused checks are:

```bash
npx tsc --noEmit
A2P_BASE_SHA=0e74428259275c9281518832747a627a4f635a80 node scripts/verify-a2p-types.mjs
npx vitest run src/components/settings/phone/__tests__/NumberPurchaseDialog.test.tsx src/components/settings/phone/__tests__/useNumberPurchase.test.tsx src/components/settings/phone/__tests__/numberSearchSchema.test.ts src/lib/caller-id-selection.test.ts src/lib/__tests__/inboundsRoom.test.ts src/hooks/__tests__/useInboundsVoice.test.tsx src/hooks/__tests__/useRoomDisposition.test.tsx
npm run build
node scripts/tests/phone-number-purchases/browser/check.mjs
```

The browser runner needs Playwright 1.56.1 and Chromium. Its explicit module path can be supplied through `PLAYWRIGHT_MODULE`; dependency installation stays outside the repository.

For native SQL, point `PGURL` only at a new empty loopback `phone_number_purchases_*` database and run `node scripts/tests/phone-number-purchases/run.mjs`. Without `PGURL`, `PGLITE_MODULE` may point to an installed PGlite module; that mode cannot prove concurrent locks. Never use a production or hosted database for this runner.

For Edge, use Deno 2.5.6 with `--lock deno.lock --frozen --import-map scripts/deno-ci-import-map.json`; the exact source suite and six entrypoints are listed in the workflow. Assembled checks must target each package's entrypoint and use its captured dependencies, particularly the live purchasing callback helper. Test files are verification inputs and are not included in deployable payloads.

Prepare packages without a deploy operation:

```bash
node scripts/prepare-phone-number-release.mjs --live-dir /absolute/path/to/refreshed-captures --out-dir /absolute/path/to/empty-review-directory
```

The output must stay outside the checkout. Capture all six functions read-only. If any baseline differs, stop and review the drift before assembling a replacement candidate; do not weaken the baseline assertions.

## Concrete release candidate

Exact hashes and individual bundled files are in [release-manifest.json](release-manifest.json). The approved migration is now recorded as `supabase/migrations/20261104041151_phone_number_purchase_operations.sql` and applied in production. The earlier pending path and reviewed bytes remain in the release record. Complete packages were assembled for these inspected live baselines:

| Function | Live baseline | Final files | Approved module replacement |
|---|---:|---:|---|
| `twilio-search-numbers` | 58 | 9 | Entry handler plus required new modules |
| `twilio-buy-number` | 64 | 9 | Entry handler plus required new modules |
| `twilio-sms` | 60 | 13 | `_shared/a2p/sending.ts` only |
| `workflow-executor` | 49 | 14 | `_shared/a2p/sending.ts` only |
| `sms-consent-worker` | 25 | 13 | `_shared/a2p/sending.ts` only |
| `clearpath-lead-alert` | 24 | 13 | `_shared/a2p/sending.ts` only |

All retain `verify_jwt=false`, no import map, and their unrelated deployed files. In particular, the buy package retains its live callback configuration, workflow/worker retain their deployed dispatch/signature modules, and ClearPath retains its already-live handler/copy. Source-main deployment without this reconciliation would not meet the preservation requirement.

### Completed release steps and remaining actions

1. Completed: candidate review/publication, conflict and live-drift checks, all final CI gates, exact migration application/readback, six full Edge releases/readbacks, and PR #513 merge.
2. Completed: after Chris's Pro upgrade and explicit retry request, approved main `2b6f5cef` reached production READY; correct project/commit, aliases and public HTML/entry-module markers were verified.
3. Completed: publish the seven-file documentation closeout on `docs/toll-free-production-release-20261103` for review independent of the live release. Do not replay migration 20261104041151 or the six Edge packages. Preserve the ledger, SMS guard and attempted barriers; an old unquoted-buy rollback is unsafe.
4. Before any assistant-executed real purchase, present the current selected number and actual quote and obtain separate transaction authorization. Inbounds designation and controlled live media remain separate actions. Refresh older purchasing tabs for quote review.

No actual account pricing permissions, real provider inventory, paid provisioning, signed-in UI or live audio was exercised. Those are the remaining integration uncertainties, not observed release blockers. Unknown charged outcomes intentionally require reviewed support recovery; no reset/retry worker or automatic refund/release was added. Rollback must preserve the ledger, ownership, SMS denial and attempted barriers. Existing 79 application diagnostics, legacy sending lint annotations, bundle warnings and unrelated security-advisor findings remain outside this change.
