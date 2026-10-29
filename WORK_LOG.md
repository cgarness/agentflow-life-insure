# AgentFlow Work Log

## 2026-10-29 — Dashboard premium redesign + Client Milestones (G1 frontend on branch; G2 package prepared, NOT applied)

**Status:** Branch-only on `claude/great-clarke-c1gpw6`, base `main` `2a18e263`. Not merged and not deployed. Chris approved G1 (frontend) with revisions R1–R4. G2 (schema + RLS) is prepared as files only and needs its own approval. Plan: `docs/plans/2026-10-29-dashboard-premium-redesign/implementation_plan.md` (rev 1 + implementation status).

**What changed:**
- **Shared Dashboard UI kit** (`src/components/dashboard/ui/`): category tones (Blue calls/callbacks, Purple appointments/schedule, Green policies/goals, Gold premium/leaderboard, Red missed calls, Pink milestones), widget frame, list rows, accessible row menus, filter chips and a Radix modal shell.
  - The widget frame has a real "Open … details" button and named edit-mode controls.
  - The modal shell returns focus to its opener on close.
  - Motion is restrained; reduced-motion is honoured.
- **Widgets restyled; queries unchanged.**
  - Goal Progress bars use the category tones (appointments purple, premium gold) and are ARIA progressbars.
  - Callbacks "View all" opens the Callbacks modal (D11).
  - Schedule and Missed Calls say when they show a capped preview.
  - Leaderboard: no medallions, because the approved no-award-decoration rule stands.
- **Detail modals unified on the shell.** Every modal now has loaded-record filters/search, Retry, Load more and visible actions. Pagination, generations and error states moved unchanged into `useDashboardDetailFeed`.
- **Team Leader scope (R2):** a modal uses the scope of the surface that opened it (`src/lib/dashboard-scope.ts`). A TL in Team perspective sees an "own items" note on list surfaces. No permission, role or RLS change.
- **Client Milestones replace Anniversaries.** The persisted key stays `anniversaries`.
  - Client birthdays: clients only, 14 days, Feb 29 observed on Feb 28.
  - Policy anniversaries: primary + additional policies via the normalized model, 30/90 days, from year 1; never called a renewal or expiration.
  - First Payment Reminders: Draft Date, from 3 days before, pending until reviewed, one-time. No historical reminders: Draft Dates before the go-live date, or before the client was entered, never qualify. Existing clients with future Draft Dates stay eligible (R1).
  - Mark Reviewed / Remind Later (also after the date, as a follow-up; R3) / Undo go through two RPCs only. They stay hidden until `VITE_DASHBOARD_MILESTONE_REVIEWS=true`. First Payment Reminders also need `VITE_FIRST_PAYMENT_REMINDERS_START`. Both fail closed.
  - Exact-count keyset paging: a truncated client read is never presented as complete (R4).
- **Defects fixed in the old path:**
  - lead birthdays included;
  - errors swallowed into "No records found";
  - "Renewals" label;
  - UTC-parsed dates (a day early in US zones);
  - "today" anniversaries pushed a year;
  - year-0 "anniversaries";
  - additional policies ignored;
  - silent truncation at the server row limit.
- `Dashboard.tsx` (705 → 195 lines) and `DashboardDetailModal.tsx` (876 → 198 lines): logic moved verbatim into `useDashboardLayout` / `useDashboardDetailFeed`. **KPI cards (`StatCards.tsx`) untouched.**

**Files touched:**
- Frontend: `src/pages/Dashboard.tsx`; `src/components/dashboard/{DashboardDetailModal,DashboardCallbacksModal,DashboardRecordsModal,DashboardRecordRow,DashboardMilestonesModal,DashboardControls,DashboardLayoutEditorBar}.tsx`; `src/components/dashboard/dashboardRecordText.ts`; `src/components/dashboard/ui/*`; `src/components/dashboard/milestones/*`; widgets `Callbacks`, `Appointments`, `GoalProgress`, `Leaderboard`, `MissedCalls`, and `ClientMilestonesWidget` (renamed from `AnniversariesWidget`); `src/hooks/{useDashboardLayout,useDashboardDetailFeed,useMilestoneActions}.ts`; `src/lib/{calendar-date,dashboard-milestones,dashboard-milestones-data,dashboard-milestones-config,dashboard-scope,paged-exact-read}.ts`.
- Tests: new `src/lib/__tests__/{dashboardMilestones,dashboardMilestonesData,dashboardScope}.test.ts` and `src/components/dashboard/__tests__/{clientMilestonesWidget,dashboardMilestonesModal,dashboardModalShell,dashboardWidgetFrame}.test.tsx`. Updated `dashboardSections`, `dashboardRefresh` and `dashboardRefreshWiring` (renamed widget, Router wrapper, fixture with policy evidence). Browser harness: `scripts/tests/dashboard-ui/verify.mjs`.
- G2 package (NOT applied): `supabase/migrations/pending/20261029120000_dashboard_milestone_reviews.sql`, `supabase/migrations/rollback/20261029120000_dashboard_milestone_reviews.rollback.sql`, `supabase/tests/dashboard_milestone_reviews{,_harness}.sql`, `scripts/run_dashboard_milestone_tests.sh`, `.github/workflows/dashboard-milestones-backend.yml`.
- Docs: the plan, this entry, `AGENT_RULES.md`.

**Migrations/deploys:** None applied or deployed.
- Read-only only:
  - `list_migrations`;
  - `execute_sql` checks of metadata, object existence, dependencies and the history comparison;
  - the security and performance advisors, as baselines (256 / 464 findings).
- `list_migrations` showed `20261021200000_lead_client_conversion_preservation` IS applied, so `clients.date_of_birth` exists; the AGENT_RULES heading that said otherwise is corrected.
- No Supabase, Edge, Twilio or Vercel writes.

**Verification:**
- Focused Vitest: 25 files, 440 passed / 12 skipped (452 total), under `TZ` America/Los_Angeles (452 passed), Pacific/Auckland and UTC.
- Full Vitest: 6,585 passed, 1 failed, 10 files failed. The identical 10 files and 1 test fail on the untouched base `2a18e263`: missing `VITE_SUPABASE_URL` in this container, and a deployed-bytes comparison in `recordingRetentionVoicemail`. None of them are Dashboard files.
- `npx tsc --noEmit` exit 0 (vacuous). `npx tsc -p tsconfig.app.json --noEmit`: 80 errors, the identical set to base, none new.
- ESLint on changed files is clean. `npm run build` OK.
- Browser (mocked Supabase, `verify.mjs`): 44/44 checks at 1440 and 390 px × light and dark (dark with reduced motion). Covered:
  - no horizontal scroll;
  - three category icons;
  - no renewal/expiration wording;
  - keyboard: Details → modal → row menu → Mark reviewed, toast with Undo, the widget behind updates, Escape closes and focus returns;
  - no page errors.
- KPI cards captured on base and branch are **byte-identical PNGs** in all four viewport/theme combinations.
- G2 SQL suite on a disposable local PostgreSQL 16.15 (CI uses 17.6; not yet run there):
  - 45 checks: metadata/ACL, isolation, RLS, constraints, one-time first payment, conditional Undo, identity agreement, cascade;
  - replay guard;
  - two negative controls, each failing at the expected check (T1.3, T2.2a);
  - rollback proof.

**G2 release attempts (Chris approved G2 for the exact file, SHA-256 `e6737493…8806`). Production is still unchanged.**
- **Supabase MCP `apply_migration`:** called twice, with the exact bytes and the name `dashboard_milestone_reviews`.
  - Both calls timed out after 60 s: Supabase's confirmation question never reached Chris.
  - Read back after each call: head `20261028040215 standard_lead_fields`, no history row, and the table, both RPCs and the guard function absent.
- **Supabase CLI from the cloud session:** stopped before any CLI call to production.
  - No production authentication: no access token, no DB password, no linked project.
  - The network policy denies `api.supabase.com` (proxy 403) and the database and pooler hosts.
  - No credential was requested in chat.
- **`supabase db push` is unsafe and rejected.** A read-only comparison against 350 history rows found:
  - 278 recorded versions have no local file;
  - 12 local files are not recorded under their own version; 11 of them are live under another version, plus the baseline.
  - The list is in the design below. These unrelated files were not touched.
- **The SQL Editor was not used:** an untracked workaround, per the instruction.
- **Prepared for separate review (design only, nothing implemented or dispatched):** `docs/plans/2026-10-29-dashboard-premium-redesign/g2-release-workflow-design.md`.
  - The exact new workflow `dashboard-milestones-release.yml` and the runner contract. Existing release workflows are unchanged.
  - Production environment `google-sheets-production`: required reviewer cgarness, main only.
  - Stages: check → apply-migration (psql, single transaction, exact file) → record-history (`migration repair`, CLI 2.121.0) → rollback-migration.
  - A release-only PR to `main` with no `src/` change, so G3 stays gated.
- No flags set, no merge, no Vercel change.

**Blockers / next:**
1. Chris reviews the G2 release-workflow design (or picks another authorized route).
2. If approved: implement the runner, test and workflow; rehearse them on loopback PostgreSQL with the pinned CLI; release-only PR (Chris's merge approval); dispatch check → apply-migration → record-history; independent read-back + advisors.
3. After apply: move the file out of `pending/` byte-identically (recorded version `20261029120000`), regenerate types, focused verification. Set the two Vercel variables only at G3.
4. G3 merge approval.

Follow-ups, not started:
- TL downline lists through `getAgentScopeIds` (needs the protected `dashboard-callbacks.ts` contract change).
- Contact-type lookup for modal Missed Calls / Calls rows.
- A server-side milestones RPC for very large books.

**Context snapshot:**
- The frontend is complete behind a fail-closed flag.
- The G2 files are tested locally. G2 is approved but NOT applied: MCP confirmation is unreachable, and the cloud CLI has no auth and no network access.
- A protected-workflow design awaits review.
- No production data was read beyond migration metadata and object existence.
- No merge or deploy.


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
