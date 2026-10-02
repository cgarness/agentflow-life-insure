# Reports policy-source release — October 2, 2026

## Released scope

Chris explicitly approved releasing PR #399 and applying its reviewed policy-reporting migration.
PR #399 was squash-merged as `e04eb16dc6fc70734f85868ab5235186d0ce4813` from tested head
`71d6f6fa188cf9ab654bf910df8b25b127327a58`.

The production `agentflow` frontend deployment `dpl_5buBwabArVu9BBvqMoAeu7dSwEe5` reached READY on
that merge commit, with `fflagent.com` and `www.fflagent.com` aliases and no alias error.
The deployment's `/reports` route returned HTTP 200. This proves the application shell is served,
not that a signed-in browser walkthrough has been performed.

## Exact production migration

- Production project: `jncvvsvckxhqgqvkppmj`.
- Name: `reports_policies_sold_normalized_source`.
- Recorded version: **`20261002160849`**.
- Canonical repository path after reconciliation:
  `supabase/migrations/20261002160849_reports_policies_sold_normalized_source.sql`.
- Authored filename: `20260930120000_reports_policies_sold_normalized_source.sql`.
- SQL size: **51,115 bytes**.
- SHA-256: **`15355717f39fe2cb6b33386334d785f672e167ea5774866322b262dcd9d551d5`**.

The migration-history read-back contains one statement with exactly this byte count and checksum.
The earlier wrapped submission was blocked and verified to have changed nothing; the original,
unwrapped reviewed SQL was then applied successfully once. No SQL bytes were edited for release.
Filename reconciliation preserves the authored references inside SQL comments and rollback bytes.

## Live reconciliation

Read-only authenticated database-context checks for Chris's organization, September 1–29, 2026,
resolved organization scope and `America/Los_Angeles`. The timestamp window was
`2026-09-01T07:00:00Z` through (excluding) `2026-09-30T07:00:00Z`.
Policies use their sale DATE within the selected calendar dates, not their creation timestamp.

| Check | Verified result |
|---|---:|
| Policies Sold | **4**, previously 2 win events |
| Policy chart sum | **4** |
| September 2 / September 17 / September 28 | **1 / 1 / 2** |
| Alexa / Teo / Will, current assignment | **2 / 1 / 1** |
| Each of those three individual agent filters | Matches its count; zero rows outside the filter |
| Undated / malformed policy-quality counts, scope-wide all dates | **0 / 0** |
| Campaign policies in period | **4** |
| Campaign-attributed / attribution unavailable | **0 / 4** |
| Calls Made / disposition call total | **2,582 / 2,582** |
| Outbound talk time | **62,192 seconds** |

The underlying dated primary-policy records independently reconcile to the same 2 / 1 / 1 counts.
Scope, summary, volume, campaign, disposition, and lead-source RPCs returned successfully.
Summary returns `policy_source=normalized_policies` and `policy_basis.agent_attribution=current_assignment`.
Both campaign breakdowns return `campaign_visibility=caller_authorized`.
No missing campaign link was guessed to make a number appear.

## Database read-back

All four updated public RPCs remain postgres-owned, STABLE, SECURITY DEFINER, with
`search_path=pg_catalog, pg_temp`. Authenticated/service-role execution is retained; anonymous
execution is denied. Their body MD5 values are:

- summary: `826736e666a12d0d85ec3797b2556792`;
- volume: `b4f7d891d7fb29962c86b668a1a2aee6`;
- campaign: `843c9dd0e11dfd560d78d7d9f30f3729`;
- dispositions: `ec8af7622230b39a92247a66d9c4c961`.

The four new private helpers are postgres-only and not executable by anon/authenticated roles.
The four legacy `rpc_report_*` functions remain sealed from anon/authenticated callers.
Pre-release activity checks showed zero active recent dialer sessions and zero recent open calls.

Security and performance advisors were run after application. The updated Reports functions are
not flagged as anonymously executable. The advisor notes authenticated SECURITY DEFINER execution,
which is intentional and guarded inside these Reports RPCs. Unrelated existing findings remain,
including RLS disabled on `app_config` / `webhook_debug_log`, other broad function grants, mutable
search paths, and index/RLS performance findings. They were not changed under this release.

## Verification before release

Both exact-head CI jobs passed: PostgreSQL 17.6 run `37028513273`, frontend run `37028513513`.
The backend proof includes policy/privacy regressions, 14 behavioral mutation controls, fatal fixture
setup errors, drift/replay refusal, disabled-only recovery, and Profile SQL regression checks.
Focused Reports/policy-normalization tests passed 132/132. Full Vitest passed 3,890 tests versus
3,860 on the exact main baseline, with the same existing failed assertion and failed-file set.
Root typecheck passed; application typecheck retains the identical 90 baseline errors. Touched-file
ESLint and build passed. The application typecheck is not claimed clean.

## Limitations and remaining checks

- Policy attribution uses the client's current assignment, not an immutable original seller.
- Campaign attribution is limited to provable, caller-visible conversion lineage.
- Undated/malformed policies are handled as documented; no dates, clients or wins were backfilled.
- Dialer, Dashboard, Leaderboard and Group board definitions were not changed.
- No customer rows, RLS policies, Edge Functions, calling, queue or conversion behavior were changed.
- Production verification used read-only authenticated database context, not a signed-in browser
  session. Admin/Agent/Team Leader visual interaction and production-volume load testing remain unproven.
- Reload old browser tabs to obtain the new labels and response contracts.

Recovery remains fail-closed: disable Reports before any optional preimage restoration, keep the
legacy functions sealed, and re-enable only the verified normalized-policy implementation.
This release did not execute a production rollback or disable Reports.
