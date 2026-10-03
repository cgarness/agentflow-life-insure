# Leaderboard implementation handoff

Status: implemented on `codex/leaderboard-data-tv-20261003`, based on main `c8b3a682f701a6421ba7439288f87b1e7d33b80f`. Not pushed, merged, migrated or deployed. Chris approved isolated implementation on October 3, 2026. Production queries in this task were read-only.

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
