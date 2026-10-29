# AgentFlow Work Log

## 2026-10-29 — Dashboard Polish V2: G2 built on the feature branch (Clear / Dismiss, visual polish, Team-mode context); migration PREPARED, NOT applied

**Status:**
- G1 plan approved by Chris (D1–D16 as recommended, including the narrow protected `dashboard-callbacks.ts` edit).
- G2 is implemented on `claude/upbeat-cannon-uy6fpg` only.
- **Not merged, not deployed. No production SQL. No Vercel variable changed.**
- `VITE_DASHBOARD_ATTENTION_CLEARANCES` is unset everywhere real.
- Plan and evidence: `docs/plans/2026-10-29-dashboard-polish-v2/implementation_plan.md`.

**Correction to the entry below (stale):**
- G3 is no longer branch-only: PR #502 was merged as `7a03033`, and Vercel production deployment
  `dpl_EDZ4obVUw3dgB8fwxPi7PnbgkoUq` is READY.
- Whether `VITE_DASHBOARD_MILESTONE_REVIEWS=true` is set in production could not be read from this session (Vercel env
  listing returned 403).

**What changed:**
- **Clear (Missed Calls, Callbacks):**
  - Per-viewer, occurrence-specific alert state in the new `dashboard_attention_clearances`, written only by two
    SECURITY INVOKER RPCs.
  - A visible Clear button on widget and modal rows; Undo (toast and history); the Cleared view; "N cleared" links.
  - Persists across refresh and login (database, not the browser).
  - A rescheduled callback has a new due time, so it returns on its own.
  - Source records are never written: calls, voicemails, notifications, campaign leads (due, owner, status, queue),
    appointments.
- **Exact counts:**
  - Cleared items are excluded inside the paging math: each branch reads `K` rows deeper, then the merge and slice.
  - Totals subtract only clearances that still match under the same branch filters.
  - Widget rows, modal pages, active totals and "View All N" agree, including when campaign and appointment callbacks
    interleave.
- **Dismiss (Client Milestones):** a visible Dismiss button (stored as the existing `reviewed`); Pending · Snoozed ·
  Dismissed history; a "View dismissed" link. No schema change.
- **Missed Calls:**
  - One shared contract (`dashboard-missed-calls.ts`) for the widget and the modal. The modal can now call back linked
    contacts.
  - An explicit organization filter closes a latent Agency-Group peer exposure (0 groups exist today).
- **Visual polish:**
  - Shared status badges with text labels, in the approved colors.
  - A primary Calls-blue call action; Clear / Dismiss as secondary actions.
  - Blocked actions stay focusable and state their reason (`aria-disabled`).
  - Focus moves to the next row after a removal.
  - Rows wrap on narrow screens (no horizontal scroll at 390 px).
  - Normal-case typography; exact or "N+" callback bucket counts.
- **Team-mode context** (an Admin's Team view; the Team Leader list scope is unchanged):
  - owner, campaign, assignee, client agent and writing-agent names, from batched organization-scoped reads;
  - missed-call recipients from routing metadata, never `calls.agent_id`, and never one agent for a call that rang
    several;
  - initials only.
- **Unchanged:** the four KPI cards (pixel-identical), telephony, Twilio, the Dialer, the scope rules, contact identity
  and RLS on existing tables.

**Files touched:**
- **Backend package (not applied):**
  - `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql`;
  - `supabase/migrations/rollback/20261029200000_dashboard_attention_clearances.rollback.sql`;
  - `supabase/tests/dashboard_attention_clearances{,_harness}.sql`;
  - `scripts/run_dashboard_attention_tests.sh`;
  - `.github/workflows/dashboard-attention-backend.yml`.
- **New frontend:**
  - `src/lib/dashboard-attention{,-config,-sources}.ts`, `dashboard-missed-calls.ts`, `dashboard-people.ts`,
    `dashboard-widget-loads.ts`;
  - `src/hooks/useAttentionClearActions.ts`, `useAttentionDetailFeed.ts`, `useRowFocusRecovery.ts`;
  - `src/components/dashboard/DashboardAttentionModal.tsx`, `DashboardMissedCallsModal.tsx`,
    `attention/AttentionModalLayout.tsx`, `callbacks/CallbackRow.tsx`, `missed-calls/MissedCallRow.tsx`;
  - `ui/DashboardActionButton.tsx`, `ui/DashboardPersonChip.tsx`, `ui/DashboardAttentionSummary.tsx`.
- **Modified frontend:**
  - `src/lib/dashboard-callbacks.ts` (approved exception), `dashboard-milestones{,-data}.ts`;
  - `src/hooks/useDashboardDetailFeed.ts`, `useMilestoneActions.ts`;
  - `src/pages/Dashboard.tsx`;
  - `DashboardCallbacksModal.tsx`, `DashboardDetailModal.tsx`, `DashboardMilestonesModal.tsx`, `DashboardRecordRow.tsx`,
    `DashboardRecordsModal.tsx`, `dashboardRecordText.ts`;
  - `milestones/MilestoneRow.tsx`, `milestoneCopy.ts`;
  - `ui/dashboardTones.ts`, `DashboardListRow.tsx`, `DashboardRowActions.tsx`, `DashboardModalShell.tsx`,
    `DashboardFilterChips.tsx`, `DashboardWidgetFrame.tsx`;
  - all six widgets and `LeaderboardPreviewRow.tsx`;
  - `src/integrations/supabase/types.ts` (surgical: one table and two RPCs).
- **Tests:**
  - new: `dashboardCallbacksClearances`, `attentionClearActions`, `dashboardMissedCallsModal`, `dashboardTeamContext`,
    `dashboardStatusBadges`, `src/lib/__tests__/dashboardAttention`, `dashboardMissedCalls`, `dashboardPeople`, and
    `src/test/fakePostgrest.ts`;
  - updated: `dashboardCallbacks`, `dashboardCallbacksModal`, `dashboardDetailModalVoicemail`,
    `clientMilestonesWidget`, `dashboardMilestonesModal`;
  - `scripts/tests/dashboard-ui/verify.mjs`;
  - `.github/workflows/dashboard-g3-frontend.yml`.
- **Docs:** `AGENT_RULES.md` (new attention-clearance invariant, #22 amendment, milestone wording and status), the plan,
  root `implementation_plan.md`, this log.

**Migrations/deploys:**
- None applied or deployed.
- Read-only production catalog / aggregate reads during G1 only.
- Migration SHA-256 `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8` (16,396 bytes).
- Rollback SHA-256 `9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55`.

**Verification (local; CI not yet run):**
- **SQL** (disposable PostgreSQL 16.15, `plpgsql.variable_conflict = error`):
  - 69 behaviour checks, plus the replay guard, the concurrency check, three negative controls and the rollback proof;
  - all passed.
- **Vitest:** 492 passed and 12 skipped across the 33 Dashboard and milestone files (base: 440).
  - The new tests include an exclusion property test against a brute-force oracle, 40 seeded scenarios × 2 scopes ×
    4 page sizes.
  - The milestone engine passed under America/Los_Angeles, Pacific/Auckland and UTC.
- **Full Vitest:** 6,637 passed. The 10 failing files fail identically on untouched `main` `7a03033`: 9 need
  `VITE_SUPABASE_URL`, 1 is a recording-retention byte check. None is caused by this change.
- **Type checks:** `npx tsc --noEmit` clean. App typecheck against `7a03033`: base 80, candidate 80, new 0.
- **ESLint:** clean on all 59 touched TypeScript files.
- **Build:** `npm run build` passed (the existing chunk-size warning only).
- **Browser** (`verify.mjs`, mocked Supabase, 1440/390 px, light/dark, reduced motion): 80/80 checks.
  - Covered: Clear, Undo and the Cleared view on Callbacks; Clear on Missed Calls; keyboard Dismiss and the Dismissed
    history; focus after a removal; no horizontal overflow.
  - KPI cards are pixel-identical to `main` in all four captures (0 changed pixels).

**Blockers / next (each separately approved):**
1. Chris reviews the G2 package. A PR for CI (G4 checks) only on request.
2. **G3:** approval of the exact migration bytes and RLS. Then the apply through the approved route (recommended: a
   protected-workflow release-only PR), catalog read-back, advisors against the 256 / 466 baseline, the history record,
   a byte-identical move out of `pending/`, and a regenerated-types diff.
3. **G4:** CI and Vercel preview, plus visual verification.
4. **G5:** frontend merge, then Chris sets `VITE_DASHBOARD_ATTENTION_CLEARANCES=true`.
5. Confirm `VITE_DASHBOARD_MILESTONE_REVIEWS` in production (Dismiss needs it).
6. Follow-ups needing their own approval: `get_performance_details` agent / carrier fields; Team Leader downline lists.

**Context snapshot:** frontend and migration package on the branch only. Production database, Vercel and flags
unchanged.

## 2026-10-29 — G2 production closeout; G3 Dashboard release candidate prepared on current main

**Status:** G2 PRODUCTION COMPLETE. Protected PR #501 merged at `78d532b` (release workflow only). `check` [#40925336827], `apply-migration` [#40925926281], and `record-history` [#40926621789] succeeded; independently verified in production on project `jncvvsvckxhqgqvkppmj`. G3 visual release is **branch-only**, not merged, not activated or deployed.

**Production database and history:** `20261029120000_dashboard_milestone_reviews` recorded as history #351, 28 statements, approved digest `07cabc94f4a42c2c0d9a7c1265c9aa622eee65af14bb26dc9889b878d9765ec7`. Table, two SECURITY INVOKER RPCs and guard trigger exist; RLS enabled with four authenticated-only policies, 12 columns, five indexes, 3 cascading FKs, five checks. No client/policy/call data migration; review table initially empty. Security advisors remain 256 findings (no new milestone finding); performance 466 versus 464 baseline (two new unused-index INFO notices on the empty milestone table).

**G3 candidate changes (not production):** New branch `claude/dashboard-g3-finalize-20261029` based on production `main` `78d532b`; copied only approved G1 dashboard source, tests and `AGENT_RULES.md` from `claude/great-clarke-c1gpw6`. Four existing KPI cards remain untouched. Reconciled approved migration blob (SHA-256 `e673749357f7612991cccf7405aa0f5f0a9ac49c798bfbd13b006d34f78d8806`) from `pending/` to `supabase/migrations/20261029120000_dashboard_milestone_reviews.sql`, unchanged bytes. Re-pinned protected G2 runner/workflow/rehearsal to the new path. Generated live Supabase TS types, added **only** milestone table and two RPC signatures to `src/integrations/supabase/types.ts`, and switched milestone read/write queries to the typed client instead of `as any`. Existing unrelated live-schema type drift was deliberately not copied.

**Files touched:** Approved G1 `src/pages/Dashboard.tsx`, dashboard widgets, detail modals, UI components, hooks, milestone engine, tests, browser harness; `AGENT_RULES.md`; `src/integrations/supabase/types.ts`; `src/lib/dashboard-milestones-data.ts`; G2 migration path (move only); `scripts/dashboard_milestones_release.py`; `scripts/tests/dashboard_milestones_release_test.py`; `.github/workflows/dashboard-milestones-release.yml`; Dashboard plan and G2 release-design docs; `WORK_LOG.md`.

**Migrations/deploys:** G2 production applied/recorded through the previously approved protected workflow. **No additional production backend writes or G3 Vercel changes** during this preparation.

**Verification:** Prior G1 branch: 440 focused Dashboard tests, 44 browser checks, byte-identical KPI captures and no new app type errors; G2 protected runner/SQL suite passed on PostgreSQL 17.6. Current G3 branch CI / typecheck / browser verification still needs fresh runs and PR review. Do not describe G3 as ready for merge until those pass.

**Blockers / next:** Open a G3 draft PR, run full applicable CI and browser verification, resolve any new failures, confirm final activation date and Vercel flags, then request Chris's distinct **G3 production release approval**. Do not merge, change Vercel env vars, or deploy until that approval.


## 2026-10-29 — G2 protected release workflow for Dashboard milestone reviews (release-only PR; NOT merged, NOT dispatched)

**Status:** Chris approved the G2 release-workflow design with safeguards.
- Implemented and rehearsed on an isolated PostgreSQL.
- Proposed to `main` as a release-only PR, with no `src/` change.
- **Not merged. No stage has been dispatched. The G2 migration is NOT applied** (production read back: 350 history rows, head `20261028040215`, none of the objects).
- No Vercel variable changed. The Dashboard frontend (G3) is not released.
- Design and evidence: `docs/plans/2026-10-29-dashboard-premium-redesign/g2-release-workflow-design.md`.

**What changed:**
- **New `.github/workflows/dashboard-milestones-release.yml`:**
  - dispatch only, main only, behind the protected `google-sheets-production` environment (reviewer cgarness, admin bypass off);
  - four typed, confirmed stages: `check` → `apply-migration` → `record-history` → `rollback-migration`;
  - only `SUPABASE_DB_PASSWORD` / `SUPABASE_POOLER_HOST`, a pinned checkout and CLI 2.121.0.
- **New `scripts/dashboard_milestones_release.py`.**
  - It executes only the approved migration, fed from its checksummed bytes (16,405 B, SHA-256 `e6737493…`), in one psql transaction.
  - It records history with `migration repair` from a temporary workdir that holds only that file. Never `db push` or `migration up`.
  - **Rollback refuses while any milestone review row exists:** a pre-check, then a re-check under `ACCESS EXCLUSIVE` inside the rollback transaction.
  - **CRM activity can't cause a false failure:** the invariants are a schema-only fingerprint and the migration history. No CRM rows are read.
- **New `scripts/tests/dashboard_milestones_release_test.py`:** the rehearsal (real CLI, TLS loopback, synthetic data).
- `dashboard-milestones-backend.yml` gains two jobs: `release-runner` (`postgres:17.6` pinned by digest) and a live, secret-free `environment-guard`.

**Unchanged:**
- the migration and rollback bytes;
- the Google Sheets and hierarchy release workflows;
- unrelated migrations: 12 local files drift from production history; they are listed in the design and untouched.

**Migrations/deploys:** none.
- Read-only production checks only: the state classifier, the `get_org_id` digest, and the fingerprint query (5,892 entries).

**Verification:**
- Rehearsal (local PostgreSQL 16.15, TLS, port 5432; pinned CLI 2.121.0, release checksum verified): `ALL PASSED: 38 checks`.
  - Security failures: refs, confirmations, bytes, copies, CLI, hosts, identity, environment settings, drifted states.
  - The full release under live CRM traffic: about 1,400 committed client write cycles.
  - Interrupted-stage recovery: lock timeout, watchdog, SIGTERM, a lost runner, a lost CLI, a lost rollback.
  - Rollback refusal with review rows, including the race.
  - 13 read-back tamper cases, decoy migrations never run, and no secret in any output.
- SQL suite: 45 checks, both negative controls and the rollback proof pass.
- CI on PostgreSQL 17.6: see the PR.

**Blockers / next (each separately approved):**
1. Chris's merge decision on the release-only PR.
2. Dispatch `check` → `apply-migration` → independent read-back and advisors → `record-history`.
3. Follow-up: move the file out of `pending/` byte-identically, re-pin the runner, regenerate types.
4. G3.

**Context snapshot:** the release machinery is ready for review; production is unchanged; G2 and G3 are still gated.

## 2026-10-28 — Google Sheets v2 source-column UI cleanup (approved, PR candidate)

**Status:** Branch-only frontend refactor `refactor/sheets-map-source-labels-20261028` from `c707bd7cc3e6800ceb82840889f5f62bb9e37a3a`; not merged to `main`, not released to production. Chris explicitly approved removing column letters and sample captions on the mapping screen, retaining the full source header, New indicators and all mapping/Preview behavior.

**What changed:** The source side of each mapping row is now a single ellipsized, full-header-tooltip label vertically aligned with its 36px target dropdown. The source-letter and `e.g.` captions are no longer shown in the mapping step. The Preview step and its server-provided values remain unchanged, as do field options, mapping targets, duplicate confirmation, ignored-column acknowledgments and access checks.

**Files touched:**
- `src/components/settings/google-sheets/MappingColumnRow.tsx`
- `src/components/settings/google-sheets/MappingStepV2.tsx`
- `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx`
- `scripts/tests/google-sheets-ui/verify.mjs`
- `docs/plans/2026-10-28-sheets-map-source-labels/implementation_plan.md`
- `WORK_LOG.md`

**Migrations/deploys:** None; no Supabase queries or mutations; no Edge, Twilio, Google Sheets source or Vercel production changes.

**Verification:** Focused Vitest, ESLint, `npx tsc --noEmit`, meaningful app typecheck against the exact PR base, Vite build, SQL/Edge and 1440px/390px browser CI are **pending on the PR head**. Browser fake provider now supplies a nonempty sample row to verify the mapping step does not display that sample, while Preview values remain intact. Confirm CI results before requesting release.

**Blockers / next:** Open a review PR; obtain Chris's separate explicit merge approval. Teo's mapping correction and Alexa's intentionally retained v1 mapping remain out of scope.

**Context snapshot:** The change only touches frontend presentation and regression tests plus its plan/log; no tenant-data writes, schema changes, new integrations, or backend deployments. Existing imports and mappings remain governed by the original v2 preview/save validation.
## 2026-10-28 — Google Sheets mapping v2 production release closeout and picker polish (PR #499 CI verified; awaiting merge approval)

**Status:** Production R2–R7 live/verified, R8 owner opt-in 3/4; documentation + frontend polish prepared **only on `chore/sheets-v2-closeout-picker-20261028`**, [PR #499](https://github.com/cgarness/agentflow-life-insure/pull/499). **Google Sheets CI passed all 5 jobs** on tested code SHA `9d30a8c2`; merge still needs separate Chris approval. Do **not** describe the new A–Z dropdown as live until the PR is merged and production deployment verified.

**Production history (prior approved actions, not actions of this branch):**
- PR #498 merged to main at `f870755586a94f16caf1af631391de0237d82f31`. Vercel v2 deployment `dpl_ApDSmKFJtJTnfNy4mwdzqLsQk58X` READY, flag `VITE_GOOGLE_SHEETS_MAPPING_V2=true` in production.
- M1 actual version `20261028034425_google_sheets_context_field_types`; M2 actual version `20261028040215_standard_lead_fields`; both bytes matched the exact production statements (MD5 `e93a8f1e3904fa5c6da6cf3843fe2ad4`, `d8a405763974cdccd616b800e4314883` respectively).
- Sheets API v12, Push v6, Worker v11 ACTIVE with `verify_jwt=false`. R7 conversion approved exact Address, City, Zip Code IDs in Chris's organization; 3 audits, no existing lead-value changes, provisioning complete.
- 4 connected sources healthy: 3 v2 (Chris Pilot B, Alexa FEX Real Time, Teo Goat Leads), 1 retained v1 (Alexa FEX Aged). Big Test automatic v2 import succeeded with one receipt and no duplicate. Latest audit had 2,046 leads and 15 import receipts (a snapshot, not a permanent target).

**This branch changes (no Supabase/Vercel data or deployment writes):**
- Renames the two forward migration files from `pending/` to `supabase/migrations/` with their actual history versions, **without changing any as-applied SQL byte**; renames the two never-applied rollback files. Updates runner, CI path filters, and unit test's migration path.
- Updates historical release runbook, `AGENT_RULES.md` mapping v2 status, adds `docs/plans/2026-10-28-sheets-v2-closeout/implementation_plan.md`.
- UI-only: `MappingFieldPicker.tsx` now displays fields A–Z in one searchable list, with no group headings; missing standard field choices are sorted in, and compact In use/Unavailable labels retain tooltips, screen-reader reasons, disabled states and Move confirmation. Updates focused UI tests.

**Files touched:** `AGENT_RULES.md`, `WORK_LOG.md`, `docs/plans/2026-10-27-sheets-mapping-reliability/release.md`, `docs/plans/2026-10-28-sheets-v2-closeout/implementation_plan.md`, `scripts/run_google_sheets_tests.sh`, `.github/workflows/google-sheets.yml`, `src/lib/google-sheets/__tests__/mappingV2.test.ts`, `src/components/settings/google-sheets/MappingFieldPicker.tsx`, `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx`, the two renamed forward SQL files and two renamed rollback SQL files.

**Verification:** Re-read production migration history and original GitHub source checksums; source SQL matched production bytes at reconciliation. Google Sheets CI [run 40751281029](https://github.com/cgarness/agentflow-life-insure/actions/runs/40751281029) completed **SUCCESS (5/5 jobs)** on code SHA `9d30a8c2`: SQL/PostgREST/e2e, Deno Edge, real isolated pg_cron/pg_net, frontend focused Vitest (190 passing tests), ESLint, `npx tsc --noEmit`, app type-check against exact PR base, Vite build, and desktop/mobile (1440/390 px) browser flow. Vercel preview checks passed; no production deployment. Root `npx tsc --noEmit` is vacuous by itself, while the app type baseline check was meaningful. The final commit only updates plan/log test evidence, not tested application code.

**Risks and follow-ups:** Teo owner to fix Beneficiary Name → Full Name and review ignored address fields; Alexa FEX Aged remains v1 by choice; Alexa FEX Real Time ignores Trusted Form URL/OTP/IP (review consent-evidence implications separately). Nine historical Pilot B receipts point to absent leads; no deletion, repair or inferred cause. Do not change mapping JSON or release backend. Review PR CI, obtain Chris's distinct approval for merge and automatic Vercel production build, then verify deployment and signed-in desktop/mobile picker behavior.

**Context snapshot:** No new migrations applied, Edge deployed, Vercel config changed, or production data mutated in this task. Changes are branch-only; next action is CI review and separate merge approval.
