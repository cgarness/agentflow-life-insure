# Toll-Free Number Purchasing — verification and release handoff

**Status:** Implemented and verified on the local review branch; NOT released.

**Completed:** November 4, 2026 UTC (November 3 Pacific).

**Branch:** `feat/toll-free-number-purchase-20261103`.

**Exact main baseline:** `0e74428259275c9281518832747a627a4f635a80`.

Chris approved branch implementation, a pending migration, documentation and isolated verification after reviewing the plan and intended files. This approval did not authorize a production migration, deployment, number purchase, assignment, call or SMS. None occurred. Main and the remote feature branch still pointed to the exact baseline at the final read-only conflict check. The candidate was not pushed, merged or published; no GitHub/Vercel release workflow was triggered.

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
| Release preservation | **Passed** | Six payload hashes, 71 bundled module hashes, frontend files and pending SQL match the manifest; 52 unrelated live module copies are preserved byte-for-byte. |
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

The new GitHub workflow specifies native PostgreSQL 17.6 and the same synthetic runner. That workflow is prepared but has not run on GitHub because the candidate has not been published. The successful native run above used PostgreSQL 18.6. Local Deno could not reach its remote dependency URLs; the complete frozen-lock sandbox checks resolved that verification gap without changing the lock. The existing narrowly scoped CI `tslib` import map was retained.

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

Exact hashes and individual bundled files are in [release-manifest.json](release-manifest.json). The migration remains under `supabase/migrations/pending/20261104005554_phone_number_purchase_operations.sql`, not applied in production. Complete packages were assembled for these inspected live baselines:

| Function | Live baseline | Final files | Approved module replacement |
|---|---:|---:|---|
| `twilio-search-numbers` | 58 | 9 | Entry handler plus required new modules |
| `twilio-buy-number` | 64 | 9 | Entry handler plus required new modules |
| `twilio-sms` | 60 | 13 | `_shared/a2p/sending.ts` only |
| `workflow-executor` | 49 | 14 | `_shared/a2p/sending.ts` only |
| `sms-consent-worker` | 25 | 13 | `_shared/a2p/sending.ts` only |
| `clearpath-lead-alert` | 24 | 13 | `_shared/a2p/sending.ts` only |

All retain `verify_jwt=false`, no import map, and their unrelated deployed files. In particular, the buy package retains its live callback configuration, workflow/worker retain their deployed dispatch/signature modules, and ClearPath retains its already-live handler/copy. Source-main deployment without this reconciliation would not meet the preservation requirement.

### Separate approvals and next actions

1. Review the local candidate and arrange review-branch publication without an unintended deployment. The build approval has been fulfilled.
2. Re-fetch the six live functions, main/PR overlap, database history and relevant schema/RPC definitions immediately before release. Resolve drift with a new exact manifest if needed.
3. Authorize the exact pending migration for production. Apply once, reconcile the recorded timestamp/path, verify installed definitions/grants/RLS and run Supabase advisors. The existing Inbounds migration must not be replayed.
4. Authorize six complete Edge payloads. Release the four SMS guards first, then search/buy; read back every file and verify configuration. Do not replace unrelated live modules with newer main copies.
5. Authorize the frontend release after backend compatibility checks. Old purchase tabs must refresh for price review; the new handler deliberately refuses legacy unquoted buying.
6. Before an assistant-executed real purchase, present the actual current number and account quote and obtain separate transaction authorization. Inbounds designation and controlled real-call/media acceptance remain separate actions.

No actual account pricing permissions, real provider inventory, paid provisioning or live audio was exercised. Those are the remaining integration uncertainties. Unknown charged outcomes intentionally require reviewed support recovery; no reset/retry worker or automatic refund/release was added. Rollback must preserve the ledger, ownership, SMS denial and attempted barriers. Existing 79 application diagnostics, legacy sending lint annotations, bundle warnings and unrelated security-advisor findings remain outside this change.
