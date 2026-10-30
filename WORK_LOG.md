# AgentFlow Work Log

## 2026-10-30 — Prebuilt SMS and Email Templates V1.1 branch build (NOT merged, seeded or deployed)

**Status:** Branch-only implementation in `claude/sharp-johnson-2ojnub`, continuing Claude's plan using the source ZIP previously supplied in ChatGPT. **Production database seed is NOT approved or run.** No schema/RLS, Twilio/Edge Function, workflow-executor, dialing, Vercel or frontend production changes.

**What changed:** Committed reviewed V1.1 library (12 SMS + 6 email) and exactly matching insert-only home-organization SQL under docs/ and supabase/ops/, plus a read-only fingerprint/collision report. The existing manual template picker now issues one warning toast for absent or unrecognized merge fields while preserving the editable draft and existing manual send logic. Workflow action choices exclude incompatible manual-merge templates, and re-saving such a selected template is refused rather than sending blank automation text. Existing agency/personal template editing and permissions remain in place; no new data fields were needed.

**Files touched:** `implementation_plan.md`, `AGENT_RULES.md`, `WORK_LOG.md`; `docs/plans/2026-10-30-starter-templates/agentflow_starter_templates_v1_1.json`; `supabase/ops/starter_templates_v1_1_{seed_home_agency,report}.sql`; `src/lib/messageTemplateMerge.ts`; `src/components/messaging/MessageTemplatesPickerModal.tsx`; `src/components/workflows/panels/ActionConfigPanel.tsx`; focused tests in `src/lib/__tests__/`, `src/components/messaging/__tests__/`, and `src/components/workflows/panels/__tests__/`.

**Migrations/deploys:** None. All new SQL is review-only; no production writes, emails or SMS were sent.

**Verification:** Data integrity validation (12/6, five supported categories, valid merge fields, STOP on seven marketing SMS drafts, matching SQL) staged in focused Vitest. Browser, TypeScript, lint, build and PR checks will be verified before recommending the separate frontend release gate. The production pre-seed audit checks only counts/fingerprints without changing data.

**Remaining gates:** Review source/CI in draft PR; explicitly approve frontend merge/release separately; explicitly approve the exact home-org seed SQL separately. After an authorized seed, independently compare pre-existing row fingerprints and verify 18 new agency rows. Personal templates must be unchanged.


## 2026-10-30 — Calling Settings teammate picker fits short viewports (follow-up; branch `claude/zen-cerf-tjf1gq`; PR open, NOT merged, NOT released)

**Status:** Chris approved the follow-up from the entry below. Same branch and PR as the modal fix. No merge or deploy.

**What changed:** One class in `src/components/dialer/CampaignUserPicker.tsx`. The teammate list (`CommandGroup`) cap went from `max-h-60` to `max-h-[min(15rem,calc(var(--radix-popover-content-available-height)-3.5rem))]`: still 240px where there is room, otherwise the space Radix reports on the open side minus the search row. Tailwind compiles it to `max-height:min(15rem,calc(var(--radix-popover-content-available-height) - 3.5rem))` (checked in the build CSS). `CommandList`'s 300px cap stays as the fallback. Search, filtering, selection toggling, chips, same-org profile list, permissions and keyboard navigation are unchanged. The picker is only used by the Calling Settings modal.

**Files touched:** `src/components/dialer/CampaignUserPicker.tsx`, `implementation_plan.md`, `WORK_LOG.md`.

**Migrations/deploys:** None.

**Verification:**
- **Browser, picker:** real Chromium, the same harness and 12 combinations as the entry below (320×568, 390×844, 1366×768, 1440×900, 200% zoom at 683×384 and 720×450, light and dark). The popover and its search box are fully on screen at every size. At 683×384 the popover went from top −37px (search box off-screen) to 17px, 241px tall.
- **Browser, rest of the modal:** search and Enter select, ArrowDown+Enter selects, Enter again deselects with the menu staying open; arrow keys scroll the list; Escape closes only the picker. All earlier modal checks still pass.
- **TypeScript:** root `npx tsc --noEmit` passes. The app project has 80 errors, identical to base `245f4b3`.
- **Lint and build:** ESLint on touched dialer files is clean; `vite build` passes.
- **Tests:** dialer Vitest 135/135. The full suite has the same 10 pre-existing failing files as on base.

**Correction to the entry below:** its "wheel-scroll" result was a false pass. Playwright `hover()` scrolled the list itself. Measured correctly, mouse-wheel scrolling over the teammate list does not work in the **original production modal either** (scroll position stays 0); it is not caused by this branch. The Dialog's scroll lock blocks wheel events on this dropdown, which renders outside the dialog. Arrow keys and typing to filter still work (verified). Not changed here, to keep existing behaviour as approved. Fixing it is a separate decision.

## 2026-10-30 — Dialer Calling Settings modal fits the viewport (branch `claude/zen-cerf-tjf1gq`; NOT merged, NOT released)

**Status:** Approved by Chris and implemented. Frontend layout only. Pushed to `claude/zen-cerf-tjf1gq`; no PR, merge or production release. Plan: top entry of `implementation_plan.md`.

**Problem:** Dialer → Campaign Selection → Settings ("Calling Settings", `CampaignSettingsModal`) used `DialogContent` with only `max-w-md`. Measured before the fix, the dialog was 1,087–1,207px tall, so the title, Close X, Save and Cancel were off-screen at every tested size, including 1440×900.

**What changed:** The modal frame (local classes only; shared `ui/dialog.tsx` untouched) is now `max-h-[calc(100dvh-2rem)]` × `w-[calc(100vw-1.5rem)] max-w-md`, `flex-col`.
- **Fixed header:** the title is padded clear of the Close X; long campaign names wrap, with the full name in a `title` tooltip.
- **Scroll body:** only the settings scroll (`min-h-0 flex-1 overflow-y-auto overscroll-contain`).
- **Pinned error:** the save/validation error moved above the buttons as `role="alert"`, so it is never scrolled out of view.
- **Footer:** Cancel and Save always visible, side by side with a gap.
- **Keyboard:** a control that gets focus inside the scroll body is scrolled into view. Radix wraps Tab with `preventScroll`, which otherwise left the wrapped-to field hidden.
- **320px wrapping:** time inputs, Retry Interval and Ring Timeout rows wrap; toggle switches `shrink-0`.
- **Line limit:** Max Call Attempts and Calling Window moved verbatim into `campaignSettingsControls.tsx`, keeping both files under 200 lines (191 / 189).

Values, Zod validation, `handleSaveCallingSettings`, `canEditSettings` / licensed-state gating, Settings Access options, same-org teammate list, `update_campaign_settings` RPC, `organization_id` and RLS are all unchanged.

**Files touched:**
- `src/components/dialer/CampaignSettingsModal.tsx`
- `src/components/dialer/campaignSettingsControls.tsx`
- `src/components/dialer/__tests__/campaignSettingsModal.test.tsx` (new, 13 tests)
- `implementation_plan.md`
- `WORK_LOG.md`

No `DialerPage.tsx`, schema, permissions, Twilio, queue, Edge Function or Vercel changes.

**Migrations/deploys:** None.

**Verification:**
- **TypeScript:** root `npx tsc --noEmit` passes. The app project (`-p tsconfig.app.json`) has 80 errors, an identical set to base `245f4b3`.
- **Lint and build:** ESLint on touched files is clean; `vite build` passes.
- **Focused tests:** Vitest on `src/components/dialer/__tests__` passes, 135/135.
- **Full suite:** 10 files fail (1 test, plus 9 files that cannot load without `VITE_SUPABASE_URL` in this container). The same 10 fail identically on the unchanged base, so they are not regressions.
- **Browser QA:** real Chromium on a git-ignored `scratch/` harness rendering the real modal with app CSS and stub props (no Supabase or network). Sizes: 320×568, 390×844, 1366×768, 1440×900, and 200% zoom (683×384, 720×450), each in light and dark.
  - Every check passed at each size: dialog inside the viewport; header, X, Save and Cancel visible; all eight sections reachable by scrolling; no horizontal overflow.
  - Interactions checked: Settings Access Select, teammate picker (search, select, wheel-scroll, Escape closes only the picker), custom retry input, toggles.
  - Tab and Shift+Tab stay in the dialog and the focused control stays visible; Save, Cancel and Escape work.
  - Loading, saving and error states checked, with the error visible with the body scrolled to top and bottom; long campaign name and long teammate chips checked.

**Follow-up (needs separate approval):** At 683×384, `CampaignUserPicker`'s popover (~280px) opens upward with its search box just above the viewport; list, selection and typing still work. Before this fix the picker was not reachable at all at that size. Proposed one-class fix: on its `CommandGroup`, `max-h-60` → `max-h-[min(15rem,calc(var(--radix-popover-content-available-height)-3.5rem))]`. Validated in the browser by injecting the CSS: the popover fits at 683×384, 720×450, 320×568 and 1366×768.

## 2026-10-29 — Dashboard Polish V2 G3 production complete; G4 reconciliation staged on draft PR #504

**Status:** G3 BACKEND COMPLETE. Protected GitHub Actions runs `40967614726` (check), `40968145912` (apply-migration), and `40968675025` (record-history) succeeded for production `jncvvsvckxhqgqvkppmj`. Supabase independently confirms **352 migration-history entries**, version `20261029200000_dashboard_attention_clearances`, **24 statements**, recorded digest `43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693`. The table, 3 RLS policies, 3 indexes, guard trigger and 2 SECURITY INVOKER RPCs are installed. Security advisor 256 findings (unchanged); performance 465 (+1 informational unused-index notice on the new empty table).

**G4 branch-only reconciliation:** Draft PR #504 `claude/upbeat-cannon-uy6fpg` moves the approved 16,396-byte SQL Git blob `4ab80696278eb8a0bf2b6731b0d8c64e708a52da` unchanged from `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql` to `supabase/migrations/20261029200000_dashboard_attention_clearances.sql`. Approved SHA-256 remains `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8`. Rollback Git blob `647e78d16ba39480da5e7ec754f1f43598f9c3d6` is unchanged. Protected release runner, rehearsal path guards and workflow comments follow the new path; recorded-state gates still refuse apply/history replay and rollback with existing clearance records. **No production SQL executed during reconciliation.**

**Live-generated TypeScript types:** `dashboard_attention_clearances`, `clear_dashboard_attention_item` and `undo_dashboard_attention_clear` declarations already on PR #504 match live Supabase-generated definitions byte-for-byte. No `types.ts` edit or wholesale regeneration required.

**Files touched:** migration path move (same Git blob), `scripts/dashboard_attention_release.py`, `scripts/tests/dashboard_attention_release_test.py`, `.github/workflows/dashboard-attention-release.yml` (comments), `AGENT_RULES.md`, `WORK_LOG.md`, Dashboard Polish V2 and G3 release plans. No frontend `src/`, Twilio, Dialer or Edge Function edits.

**Verification:** Production G3 history/advisors verified. New PR #504 CI (PostgreSQL 17.6 rehearsal, Dashboard regression/typecheck/lint/build, desktop/mobile dark/light browser and KPI parity) is pending after this reconciliation. The frontend is NOT released; `VITE_DASHBOARD_ATTENTION_CLEARANCES` remains unverified in production.

**Next:** Review all PR #504 checks and Vercel preview, resolve any new failures on draft branch only, then request Chris's separate **G5 production frontend release approval**. No merge, Vercel configuration or deployment until then.

## 2026-10-29 — Private homepage V2 production test-route release approved

Chris authorized merging PR #503 to production for testing before replacing the current homepage. Release only the existing Super Admin-gated `/homepage-v2`; keep `/` and `/homepagetest1` unchanged. Incorporate current main without changing its CRM/backend files. No migration dispatch, environment change, auth change or public-homepage replacement is authorized. Deployment and production-route verification are recorded in PR #503.

## 2026-10-29 — Private homepage V2 authentic demos and review candidate (PR #503)

**Status:** The earlier secure-login blocker is resolved. The test account signed
in through browserAuth; rendered UI confirms Super Admin access to private V2.
Branch-only review candidate; PR remains unmerged and production approval is
still required. Shared real agency names were excluded from every recording.

**What changed:** Replaced all four V2 concept/illustrative panels with actual
shipped dashboard, dialer, AP board and messaging component recordings. Each
approximately six-second loop uses synthetic fixtures in an isolated capture
workspace, with real numeric/rank/glow animations, local call/message simulation,
explicit demo disclosure, blocked backend access and no real calls or sends.
Authorized AgentFlow imagery consists of existing brand assets and genuine
product frames. Removed the illustrative component module and stale pending
labels. Optimized H.264 MP4/VP9 WebM/WebP set totals 656,701 bytes; every encoded
frame decodes, with no audio and stripped source metadata. Added reproducible capture/encoding
tools, provenance, budgets and hashes. No runtime dependency was added.

**Files touched:** V2 page, DemoShell/ProductSections/media and page tests;
`public/marketing-v2/*`; non-production `scripts/tests/homepage-v2/capture/*`;
private V2 plan, claims/capture evidence and media manifest; this work log.

**Verification:** 22 focused Vitest checks; scoped ESLint, including capture
tools with zero warnings (entry component exported for development hot refresh); root TypeScript;
meaningful app types versus exact base `7a03033492c55fd16ea1bacd049934102fe340e4`
(80 baseline, zero added errors); Vite production build. Actual footage checked
on desktop 1440/mobile 390 CSS viewports with no horizontal overflow, muted
viewport autoplay, deferred offscreen sources, offscreen pause, manual pause
retained on resize, mobile menu and FAQ. Capture fixtures remain outside dist.
Both Git-linked preview outcomes and the final signed-in walkthrough are
recorded in PR #503 after push, along with protection/production read-back.

**Migrations/deploys:** No backend/data write, schema/RLS/auth/telephony change,
Vercel configuration change, main update, merge or production release. Only
protected branch previews. Live homepage and CRM functionality are unchanged.

**Review:** See PR #503 and its protected `/homepage-v2` URL. Separate user
approval is required before merging or releasing the homepage.

## 2026-10-29 — Private homepage V2 playback/access polish (PR #503; capture BLOCKED)

**Status:** Explicitly requested by Chris on `feat/private-homepage-v2-20261029`.
Branch-only preparation; draft PR remains open, not merged or released.
**Not complete:** secure AgentFlow sign-in returned `Invalid login credentials`;
authentic dashboard/dialer/AP board/messaging clips and authenticated preview QA
remain pending. No footage is represented as real and no real prospect was
called or messaged.

**What changed:** Preserved the approved dark navy/sky layout; split V2 into
small components; lazy-loaded only V2 behind the unchanged SuperAdminRoute.
Player attaches sources near the viewport, plays only in view/active tab, honors
reduced motion, Save-Data and slow networks, preserves manual pause, handles
blocked autoplay and per-source format failure, and reserves media space.
Added accessible navigation, FAQ relationships and private metadata cleanup.
Removed V2 links to unsupported pricing/trial promises and the contact form
that only shows a local success toast. Get started uses the existing `/signup`
setup flow; no purchase, trial or immediate-access promise.

**Files touched:** `src/pages/LandingPageV2.tsx`; V2 lazy import/route wrapper in
`src/App.tsx`; `src/components/marketing-v2/*` and focused tests;
`scripts/tests/homepage-v2/*` (isolated, non-production visual/playback harness);
`docs/plans/2026-10-29-private-homepage-v2/{implementation_plan,claims-and-capture}.md`;
`WORK_LOG.md`.

**Migrations/deploys:** No backend commands, data writes, Edge deploys, RLS,
telephony changes, Vercel settings or production release. Only the existing
Git-linked protected branch previews may build from this update. `/`,
`/homepagetest1`, SuperAdminRoute, live pricing/contact and CRM functionality
remain byte-identical.

**Verification:** 21 focused Vitest checks; scoped ESLint; root TypeScript;
meaningful app TypeScript against exact base `7a03033492c55fd16ea1bacd049934102fe340e4`
(80 baseline errors, 0 added); Vite production build. Browser QA on isolated
1440/390px viewports: no horizontal overflow, mobile navigation/FAQ, real video
loading/autoplay/manual pause/offscreen pause with an explicitly technical
six-second color-pattern fixture. Fixture/harness excluded from dist. Both
Vercel projects retain SSO protection `all_except_custom_domains`. Final deployed
branch SHA/URL and Ready state are recorded in the PR, not assumed here.

**Blockers / next:** Secure sign-in via browser handoff; locate a safe synthetic
capture workspace; record/review/encode all four authentic loops, replace the
legacy concepts, complete signed-in protected-preview review. See the capture
document for exact boundaries and provenance requirements. Separate approval is
still required before merge or production release.

## 2026-10-29 — Dashboard attention G3 protected backend release PR prepared (NOT applied)

**Status:** Chris approved exact Gate 3 migration and RLS bytes with separately controlled protected workflow stages. This change is release-only, staged on `release/dashboard-attention-g3-20261029`, and **does not apply any database migration or merge Dashboard PR #504**. No Vercel flag, production frontend, CRM source row or Twilio/telephony change.

**Files:** New `.github/workflows/dashboard-attention-release.yml`, `scripts/dashboard_attention_release.py`, `scripts/tests/dashboard_attention_release_test.py`, `docs/plans/2026-10-29-dashboard-polish-v2/g3-release/implementation_plan.md`; extended `.github/workflows/dashboard-attention-backend.yml`; copied byte-identically from PR #504 the forward SQL, rollback, 2 SQL tests and `scripts/run_dashboard_attention_tests.sh`. This newest-first `WORK_LOG.md` entry. No `src/` changed.

**Pinned files:** forward 16,396 bytes SHA-256 `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8`, rollback 2,338 bytes SHA-256 `9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55`; Git blobs match approved PR #504.

**Read-only production preflight:** PostgreSQL 17.6, 351 migration history rows, latest `20261029120000`, all new objects absent, `get_org_id` MD5 `fb1d12f537aac3b3ed18c9e0628f2251`, advisors 256 security / 464 performance findings. The protected release workflow uses manual stage+confirm, main-only, existing `google-sheets-production` environment with reviewer, a protected stage, pinned CLI 2.121.0, and 2 existing database secrets. Never `db push` or automatically execute migrations.

**Verification/next:** Existing 69-test SQL suite passed in PR #504. The release-only PR must pass PostgreSQL 17.6 rehearsal, verify the pinned 24-statement CLI digest 43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693, and check protected environment settings before a separate merge approval. Then read-only `check`, separately approved production `apply-migration`, read-back/advisors, separately approved `record-history`, and later distinct G5 frontend approval. No production work executed in this task.

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
