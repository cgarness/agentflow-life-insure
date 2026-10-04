# Leaderboard implementation handoff

Status: **SHIPPED to production October 3, 2026** as PR #412 / `ce0fd914694544049421fffbe3c2ee6b893f1afc`, with migration `20261004000819` applied and verified. Both Vercel production projects are READY and their live domain assets were verified. No test data was added to production. See the final production closeout below; earlier implementation-stage statuses are historical. Authenticated production sale smoke and historical repairs remain unclaimed.

## Changes

- Removed the entire No activity / Go to Dialer section; real stale, offline, maintenance and request-error states remain.
- TV podium and Agency Totals use the same centered 72rem maximum width independently of the lower panels. Equal flexible side tracks replace fixed unequal widths. Narrow layouts stack their panels; short layouts scroll instead of compressing avatars.
- TV metric/period switches remount podium and table state together; a slot's live card transition waits for its departing card. Ranking clones each agent record. The table reserves at least 48px per row and enough total panel height for all seven rows.
- Interactive Add Client sends an idempotent request ID through the new transaction. The visible sale option records a new primary-policy win only when Sold Date is present. Existing-book entries can opt out. Contact-only creation, generic/import client inserts and routine edits generate no wins. Failed saves retain the modal/request ID; pending saves reject repeated submits and closing.
- Lead conversion uses a new wrapper around the unchanged canonical converter and records primary/additional policy wins in the same transaction. Primary keys remain `conversion:<lead>`; additional keys use `:policy:<ordinal>`. Failed win persistence rolls back conversion. Legacy idempotent conversions are not backfilled.
- Notifications are delivery-only after commit; existing `notify_win` handles duplicate delivery. Snapshots include unknown/zero premium so additional policies cannot borrow the primary policy's premium. Legacy wins retain their existing fallback. `wins.created_at` remains the leaderboard reporting bucket, and monthly premium is annualized only for display/aggregation.
- Manual attribution validates the target profile and existing self/Admin/Super Admin/Team Leader permission in the real caller's organization, preserving authorized View As. The conversion wrapper denies nullable permission results explicitly. It preserves the original converter body, lineage, call/campaign graph operations and existing table RLS policies. Unassigned leads remain unassigned.

## Executed verification

| Check | Result |
| --- | --- |
| Focused leaderboard, request gate, avatars, page/status, Dashboard, client API/custom-fields, legacy win trigger, conversion, and new sale/TV tests | 256 passed in 14 files (including the modal suite) |
| New Add Client modal retry/intent/double-submit tests | 3 passed |
| Production Vite build | Passed; existing large-chunk warning |
| `npx tsc --noEmit` | Passed (solution root; not sufficient alone) |
| `npx tsc -p tsconfig.app.json --noEmit` | Same 88 pre-existing diagnostics as exact base; no new diagnostics (comparison excludes npm's environment warning) |
| Embedded PostgreSQL fixture + exact new migration + SQL assertions | Passed |
| Existing function preimages in SQL fixture | Converter `641ba66c96ca4a76f80c9c85eb9caa42`; org aggregate `c8b1f9d0c7cf5f8dfb7e437577029278` matched |
| Original converter after migration | Exact definition hash unchanged |
| Script syntax and `git diff --check` | Passed |

The SQL fixture extracts real table definitions and the converter/helper functions, and reconstructs the exact live org aggregate using its original guarded migrations. Tests execute public entry points under actual `authenticated`/`anon` database roles with synthetic session claims **only inside the disposable fixture**. They verify manual/contact-only intent, stable receipts, changed-payload refusal, monthly snapshots, zero/unknown additional premium, all-policy counts, legacy replay, client edits/imports, source graph transfer, original duration/disposition/campaign IDs, late validation rollback, forced win-storage rollback, missing/inactive/cross-org actors, peer/NULL ownership denial, Admin/TL attribution, private-helper denial, receipt RLS and deleted-client retry refusal.

The fixture omits unrelated production triggers/integrations and is not a claim of complete production-stack parity. The embedded runtime cannot test independent concurrent sessions.

## Blocked / required before release

1. **Native PostgreSQL and contention:** the workspace forbids switching to the PostgreSQL OS account; its granular approval policy rejected starting the disposable native cluster with elevated permissions. A materially safer embedded PostgreSQL runtime completed the SQL suite. Run `PGURL=postgres://...@127.0.0.1:<port> bash scripts/run_policy_sale_recording_tests.sh` on a disposable cluster. The included scoped CI workflow runs this suite, including two real backends submitting identical manual and conversion requests. It has not run yet because this branch has not been pushed.
2. **Rendered browser verification:** agent-browser's daemon failed to start; direct Chromium identified a forbidden local socket (`Operation not permitted`). No rendered screenshots, pixel centerline measurements, or authenticated walkthroughs are claimed. `scripts/tests/leaderboard-visual/` contains a local-only fixture and runnable browser checks for 1366×768, 1920×1080, 4K, zoom-sized viewport, photos, centerline, clipping, metric/period switches, roster sizes, entry/exit and rotation. Run it in a permitted browser environment and inspect screenshots; also verify native zoom, delayed image loading and live rank changes.
3. **Authenticated Agent/Admin smoke test:** verify the real CRM flow in an authorized test environment, then the separately approved production release. No customer calls, fake production JWTs, or production test sales were used here.
4. **Historical sales:** the two confirmed source mismatches remain unchanged. See `historical-sale-review.md` for exact conditional values and the unresolved sale legitimacy/credit/event-time confirmation.

## Migration / rollout

New, unapplied migration: `supabase/migrations/20261003205341_leaderboard_sale_recording.sql`. It adds a private receipt table, two narrow public RPCs and internal validators/writer, the `wins.premium_snapshot` column, and one guarded CASE expression in the org aggregate. It refuses an unexpected aggregate definition/ACL. There is no historical DML, notification send, RLS-policy change or original converter-body replacement.

After remaining verification and separate release approval, apply this migration **before** deploying the frontend: older clients remain compatible, while the new frontend requires its two RPCs and snapshot column. Verify exact new function owner/ACL/search_path, original converter bytes, aggregate metadata and request guard. Refresh/recheck both role sessions. Do not replay superseded leaderboard PRs #382/#383.

A frontend rollback can restore the prior bundle while leaving this additive schema in place, but old browser sale paths retain their old missing-win risk. Do not drop canonical wins, receipt tombstones or schema while new callers still use them. Any database rollback requires its own reviewed migration and preservation of newly recorded sales.

## File manifest

UI: `src/pages/Leaderboard.tsx`; `src/components/leaderboard/TVMode.tsx`, `TVPodium.tsx`, `TVRankingsTable.tsx`, `tvPodiumMetal.ts`, `useTVRankMotion.ts`, `leaderboardPremium.ts`, `leaderboardTypes.ts`; `src/components/contacts/AddClientModal.tsx`; `src/pages/Contacts.tsx` (new-client save handler).

Data/validation: `src/lib/supabase-clients.ts`, `supabase-conversion.ts`, `policySaleRecording.ts`, `clientSaleForm.ts`; `src/integrations/supabase/types.ts`; the new migration.

Verification: `src/pages/__tests__/leaderboardPage.test.tsx`; `src/lib/__tests__/conversionContract.test.ts`, `policySaleRecording.test.ts`; `src/components/leaderboard/__tests__/tvModeRegression.test.tsx`; `src/components/contacts/__tests__/addClientSale.test.tsx`; `supabase/tests/policy_sale_recording.sql`; `scripts/policy_sale_fixture.py`, `run_policy_sale_recording_tests.sh`, `scripts/tests/policy-sale-embedded.mjs`; `scripts/tests/leaderboard-visual/`; `.github/workflows/policy-sale-recording.yml`.

Documentation: this folder, additive root `implementation_plan.md` link, newest-first `WORK_LOG.md` entry, and the narrowly scoped `AGENT_RULES.md` addendum. TwilioContext, Dialer call admission, DNC, A2P, Contact History migration bytes, polling/request gates and avatar cache are unchanged.

Embedded reproduction: install/use an isolated `@electric-sql/pglite` package and run `PGLITE_PACKAGE=/absolute/path/to/node_modules/@electric-sql/pglite node scripts/tests/policy-sale-embedded.mjs` from the repository root. No database URL is accepted by this fallback.

## Production authorization — October 3, 2026, 15:58 PDT

Chris explicitly requested live production instead of a sample-data preview. This authorizes the required additive schema rollout, merge and frontend deployment. Latest main 3ccbfb0b has been integrated, preserving Contact fixes; only WORK_LOG needed an additive conflict resolution. The policy-sale workflow now runs the existing browser fixture on isolated CI localhost alongside native PostgreSQL contention checks. No fixture or preview build override is used by the production application. Historical repair is still excluded because sale legitimacy and event timestamps remain unconfirmed.

## Production database applied — October 3, 2026, 17:08 PDT

Migration applied as `20261004000819_leaderboard_sale_recording.sql` (renamed from the CLI-generated filename without changing SQL bytes). Recorded SQL MD5 `5444695dafcacc3544be883a79cba606` matches the file. All four new function source hashes, owner/search_path/ACLs, private receipt RLS/ACL, and non-null false-default snapshot column verified. Original converter and campaign_actor hashes are unchanged; reversing only the intended aggregate expression restores its exact original hash. Receipt count remained zero; no test/customer sale was inserted. Native PostgreSQL contention passed in run 37163927392; existing leaderboard backend and DNC workflows passed. Browser geometry passed 1366x768, 1920x1080, 3840x2160 and 1093x614 with exact centerline and no avatar overlap. Manual-switch assertion raced React remount, so it now waits for the exact expected agent IDs before asserting, without changing the expectation. Remaining browser and frontend checks are rerunning.

Browser run 37164197402 ruled out a simple remount delay: Escape was closing the Radix settings popover and then bubbling to the TV exit handler. The settings handler now prevents the consumed Escape event, and the TV handler honors defaultPrevented. A focused regression checks settings-only close and subsequent TV exit; browser failure evidence now includes page errors, visible text and a screenshot. The geometry assertions and exact expected metric roster remain unchanged.

## Final production closeout — October 3, 2026, 19:47 PDT

Chris's repeated production authorization was fulfilled. Latest Contact field/history changes through main `9112c8f1` were integrated, with additive documentation conflict resolution only. Final green head `e8f1cf1befed096fd1302ff9969574afea81e4d0` and squash merge `ce0fd914694544049421fffbe3c2ee6b893f1afc` have identical tree `9da1baf201d338ef0b33c50fa2271e4ad6f236ec`.

- Full frontend comparison **37171370417 passed**: 4,119 candidate tests passed vs 4,091 base; identical pre-existing failure set (one failed test, 11 failed files) and 88 unchanged raw app type diagnostics; zero unhandled runtime errors. Root tsc, scoped lint, Reports tests and build pass. Existing failures were not suppressed.
- Native PostgreSQL and browser workflow **37171370396 passed**, including independent-session manual/conversion retry contention. Leaderboard backend **37171370403** and Dialer/DNC **37171370408** passed.
- Browser: zero measured podium/Agency Totals centerline error and no avatar overlap/clipping at 1366x768, 1920x1080, 3840x2160 and 1093x614. Manual metric switch, Month tab, rosters 1/2/3/14, TV reentry and 30-second rotation pass with zero page errors. Screenshots were inspected. The selector uses the actual period `tab` role, retaining the same assertion. Artifact `11291411682`, ZIP SHA256 `3116ec6d0b5c6242eb6571a5b65eb5e765a4f8352e1f6d6d84db546277604bc7`.
- Production migration and all new function source hashes match the approved SQL exactly. Security advisor notices for the two authenticated SECURITY DEFINER entry points and the deny-all private receipt table are intentional: actor/org/owner checks are enforced by the narrow public wrappers, direct private access is revoked, and no receipt policy exposes rows. No existing table RLS policy was changed.

### Live deployment evidence

| Target | Deployment | Live asset | SHA256 |
| --- | --- | --- | --- |
| www.fflagent.com | dpl_RCQYCcahwWaKyNJxgf722DG2nhmJ | /assets/index-CUt9Y-BT.js | c668b130b3c886830bcc7b1bbc15d5b5a20539ea953658bc50185963f2f43f4f |
| agentflow-life-insure.vercel.app | dpl_G2Aar65mtpK2Dq8vsgHm4MwQpqkc | /assets/index-ByHW23Cg.js | f40176425fb8b9772509421818276163dab3f8918c88fe52fe0bdd825d2da81e |

Both target **production**, are **READY** at `ce0fd914`, and live `/leaderboard` HTML plus entry assets returned **HTTP 200**. Both bundles contain `create_client_with_sale`, `convert_lead_to_client_with_sales`, `tv-podium`, the shared 72rem center width and 26rem minimum table panel. The removed no-activity banner text and the abandoned sample-preview entry point are absent.

### Verification boundaries and recovery

The verified story is explicit policy save → authenticated atomic RPC → canonical wins and immutable snapshots → existing leaderboard aggregation/rendering. Client request/response/error contracts are covered by focused/full frontend tests; server transaction/authorization behavior by native PostgreSQL; rendering and interactions by isolated browser tests; deployed source and function definitions by production read-back. No synthetic JWT, sale, customer call or message was used in production. A real authenticated Agent/Admin sale smoke is **not** claimed. Native browser zoom, delayed external photo loading and all real-time production update timings are not exhaustively verified.

The two historical source omissions were not backfilled; sale legitimacy, attribution and event time need confirmation under `historical-sale-review.md`. Restore the prior frontend if necessary while retaining additive schema, receipt tombstones and any newly recorded canonical wins. Never reapply the migration under the old authoring filename or drop sales as a rollback. Refresh existing browser tabs after active calls finish.
