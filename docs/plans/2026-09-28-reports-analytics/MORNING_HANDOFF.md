# Reports & Analytics — Morning Handoff (2026-09-28)

Branch `claude/reports-analytics-overnight-c69826` (base `main` @ `5d37e5f`). Plan:
`docs/plans/2026-09-28-reports-analytics/implementation_plan.md` (rev 2, approved for branch implementation and testing
only). **Nothing was merged, applied, deployed or configured in production.** Production access during this work was
read-only catalog/aggregate SELECTs (listed in plan §1).

**Head at handoff:** see `git log -1 claude/reports-analytics-overnight-c69826`. The final commit only records docs;
the code and SQL under test are unchanged from `918603c` plus that docs commit. No PR has been opened (not requested).

## 1. What is finished

- **Security (Phase 1).**
  - Six new report RPCs: `get_report_scope`, `get_report_call_summary`, `get_report_call_volume`,
    `get_report_disposition_breakdown`, `get_report_campaign_performance` and `get_report_lead_source_performance`.
  - Every one is `STABLE SECURITY DEFINER`, uses `search_path = pg_catalog, pg_temp`, and grants EXECUTE only to
    `authenticated` and `service_role`.
  - None takes an organization or time-zone parameter. The actor comes from `private.campaign_actor()`, and the scope comes
    from the server-read `role_permissions`.
  - Eight private helpers are unreachable by any client role.
  - The four legacy `rpc_report_*` functions are **revoked** from PUBLIC, anon and authenticated. They are kept, sealed.
  - The migration has a drift/replay preflight (it pins the audited production body MD5s) and a postcondition block.
  - Fail-closed ops scripts: `reports_disable.sql` and `reports_enable.sql`. The rollback file drops the new objects and
    re-seals the legacy functions. **Nothing ever re-grants legacy.**
- **Core call analytics (Phase 2).**
  - One canonical fact source: `private.report_call_facts`. Outbound is keyed on `calls.created_at`.
  - Contacted uses the exact canon: No Answer first, then > 45 s, then `counts_as_contacted` by id, then an org-scoped name
    fallback.
  - Talk time is clamped at 0.
  - **Converted (unique contacts) and Policies Sold (`COUNT(wins)`) are kept separate.** There is **no conversion rate of any
    kind**; "Dials per policy sold" is the only dial-to-policy figure.
  - Appointments are attributed as in #23.
  - **Session time comes from server-timestamped `dialer_sessions` only, with each session clipped to the window.**
  - Null rates render "—".
  - The **agency time zone is resolved on the server**. It controls the window, the daily, hourly, weekday and heatmap
    buckets, the agency `today`, the presets and exports. It is DST-correct, including zones whose midnight occurs twice.
    The default is `America/Chicago`, labelled as a default. An invalid stored zone fails closed.
- **Campaign and lead-source reporting (Phase 3).**
  - Campaign Performance and Lead Source Performance now return real, scope-restricted rows (they were always empty
    before).
  - Unattributed calls are counted and labelled.
  - Lead-source Converted is explicitly "Not available". Cost, CPL and ROI are hidden.
- **Frontend (Phase 4).**
  - The rebuilt Reports page is scope-first:
    - `useReportsData` provides keyed state, generation guards, abort on supersede, a 25 s timeout, independent panel
      failure and no polling.
    - Payloads are Zod-validated.
    - Failures render as truthful loading, error, denied, unavailable or empty states, never zeros.
    - The agent filter lists only server-permitted agents.
    - Refresh re-resolves the scope. A stale-scope guard withholds any panel answered for a different scope.
  - All 12 section components and the stat cards are adapted to the canonical payloads. Every component file is under 200
    lines.
  - CSV exports are permission-gated (`can_export`), refused unless the panel is current, labelled from the payload (report,
    scope, agent filter, agency period, time zone, generated time) and formula-neutralized.
  - The non-functional saved/scheduled report buttons are unmounted; their files are kept.
- **Tests (Phase 5).**
  - SQL suite T0–T13 on real PostgreSQL, plus runner proofs: 2 negative controls, drift, replay, disable/enable and
    rollback.
  - 74 new Vitest tests.
  - CI workflow `reports-backend.yml` on postgres:17.6.
- **Docs (Phase 6).**
  - Plan rev 2 (§R2), with the §11 as-built appendix.
  - AGENT_RULES invariant **#38**.
  - Root `implementation_plan.md` §16.
  - The WORK_LOG entry and this handoff.
- **Adversarial review.**
  - Five dimensions, each with independent verifiers. SQL security produced no findings.
  - 11 distinct issues (2 medium, 9 low) were fixed, or documented below.

## 2. What is partial

- **CI has not run on GitHub.** `reports-backend.yml` triggers on pull requests, and no PR was opened. The runner passed
  locally on PostgreSQL 16.13; CI will use 17.6.
- **No end-to-end browser test against a real backend.** Nothing with the migration applied exists outside local
  databases.
  - The page is tested with the query layer mocked.
  - The SQL is tested directly as `authenticated` with PostgREST-shaped claims.
  - How PostgREST maps SQLSTATE `42501`/`22023` into the JSON `code` is standard behaviour but was not exercised here.
- **Performance is not measured at production volume.**
  - Every RPC scans `calls` for the window through `idx_calls_org_created_at`.
  - A page load issues 5 panel RPCs plus 1 scope RPC.
  - Smoke test 9 measures this.
- **Deliberately not built, pending decisions (§8):**
  - lead-source Converted;
  - lead cost / CPL / ROI;
  - Goal Tracking;
  - saved and scheduled reports.

## 3. What remains (needs Chris)

1. Review the branch. Say whether to open the PR; none is open, because none was requested.
2. Make the metric decisions in §8.
3. Separately approve and run the release in §9, then the smoke tests in §11.
4. Follow-ups, not in this build:
   - a per-org unique key and cost periods for `lead_source_costs`;
   - a cleanup migration that drops the sealed legacy `rpc_report_*` functions;
   - a saved/scheduled reports redesign, or deleting those component files;
   - goals / Goal Tracking;
   - agency-zone alignment for Leaderboard and Dashboard, which stay browser-local;
   - adding the `get_report_*` RPCs to the generated Supabase types.

## 4. Exact changed files (`git diff --name-status 5d37e5f..HEAD`, 49 files)

**Backend, SQL and CI (8 files):**

- A `supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql`
- A `supabase/migrations/rollback/20260928120000_reports_secure_scoped_rpcs.rollback.sql`
- A `supabase/ops/reports_disable.sql`
- A `supabase/ops/reports_enable.sql`
- A `supabase/tests/reports_harness.sql`
- A `supabase/tests/reports_rpc.sql`
- A `scripts/run_reports_rpc_tests.sh`
- A `.github/workflows/reports-backend.yml`

**Frontend library, hook and page (8 files):**

- A `src/lib/reports-schemas.ts`
- M `src/lib/reports-queries.ts`
- A `src/lib/reports-format.ts`
- A `src/lib/reports-export.ts`
- M `src/lib/stat-computations.ts`
- M `src/lib/report-layout-constants.ts`
- A `src/hooks/useReportsData.ts`
- M `src/pages/Reports.tsx`

**Components (21 files):**

- A `src/components/reports/ReportPanelState.tsx`
- A `src/components/reports/ReportsToolbar.tsx`
- A `src/components/reports/reportSectionMap.tsx`
- M in `src/components/reports/`:
  - `AgentEfficiency.tsx`
  - `AgentPerformanceCards.tsx`
  - `CallDurationAnalysis.tsx`
  - `CallFlowAnalysis.tsx`
  - `CallVolumeChart.tsx`
  - `CallingHeatmap.tsx`
  - `CampaignPerformance.tsx`
  - `CommunicationsStats.tsx`
  - `DispositionDeepDive.tsx`
  - `DispositionsPieChart.tsx`
  - `GoalTracking.tsx`
  - `LeadSourceTable.tsx`
  - `PoliciesSoldChart.tsx`
  - `ReportCustomizer.tsx`
  - `ReportSection.tsx`
  - `SectionRenderer.tsx`
  - `StatCard.tsx`
  - `StatsGrid.tsx`

**Tests (7 files):**

- A `src/lib/__tests__/reportsFixtures.ts`
- A `src/lib/__tests__/reportsQueries.test.ts`
- A `src/lib/__tests__/reportsExportFormat.test.ts`
- A `src/lib/__tests__/reportStatComputations.test.ts`
- A `src/lib/__tests__/reportsContracts.test.ts`
- A `src/hooks/__tests__/useReportsData.test.tsx`
- A `src/pages/__tests__/reportsPage.test.tsx`

**Docs (5 files):**

- A `docs/plans/2026-09-28-reports-analytics/implementation_plan.md`
- A `docs/plans/2026-09-28-reports-analytics/MORNING_HANDOFF.md`
- M `implementation_plan.md` (§16 appended; prior bytes preserved)
- M `AGENT_RULES.md` (invariant #38)
- M `WORK_LOG.md` (a new top entry; prior bytes preserved)

**Deliberately unchanged:**

- The Dialer-owned `src/lib/report-utils.ts` and `src/lib/supabase-dialer-stats.ts`, plus `src/hooks/usePermissions.ts`
  and `src/config/permissionDefaults.ts`. Their blob SHAs are pinned by `reportsContracts.test.ts`.
- `src/lib/report-layout.ts`, `types.ts`, `CustomReportBuilder.tsx`, `ScheduledReportsModal.tsx` and
  `DraggableSection.tsx`.

## 5. Exact migration filenames

| Role | File | SHA-256 |
|------|------|---------|
| **The only migration to apply in the release** | `supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql` (64,253 bytes) | `7d6168a23e0ed282fd6843a536859328baba080a4f5fe985cd1bf3d6e2e7642b` |
| Emergency disable (apply only if needed, as a new migration `reports_disable`) | `supabase/ops/reports_disable.sql` | `8cc967c47c506200a4b36ffd792a734bafe1aa8a94e7050bfe2e5322ede6afad` |
| Re-enable after a disable (new migration `reports_enable`) | `supabase/ops/reports_enable.sql` | `a7e0245541e581006159734dcb3f7c04b70945b1740db6d0c5a41905a7431d9c` |
| Remove the new objects (new migration `reports_secure_scoped_rpcs_rollback`) | `supabase/migrations/rollback/20260928120000_reports_secure_scoped_rpcs.rollback.sql` | `51a7f5781998f58313d9c9b27075bc272a2674794aa3200cffae7257413a8cc3` |

The version prefix `20260928120000` is a placeholder. `apply_migration` assigns the real version, and §9 step 4 reconciles
the filename without touching the SQL bytes. The migration's SHA-256 changed during the review (the DST boundary fix), so
use only the value above.

## 6. Test results (final head; all local; synthetic tenants only)

| Gate | Result |
|------|--------|
| `scripts/run_reports_rpc_tests.sh` (PostgreSQL 16.13) | **PASS.** T0–T13 all OK. Both negative controls caught: a broken No Answer rule and a removed agent-narrowing guard. Drift refusal and replay refusal are atomic. Disable/enable re-runs the whole suite. Rollback leaves data unchanged, re-seals legacy even after a simulated manual re-grant, and a re-apply recreates all 14 functions. |
| DST negative control (manual) | Restoring the old boundary formula fails T9, with `got 2026-11-01T05:00:00Z want 04:00:00Z`. The fix is restored. |
| Boundary property (ad hoc) | 0 mismatches over 677,904 zone-days (every IANA zone, 2024–2027); the old formula had 8. |
| `scripts/run_profile_rpc_tests.sh` (regression; its resolver is reused) | **PASS** (suite, negative control and rollback). |
| Reports Vitest (6 files) | **74 / 74 pass.** |
| Full `npx vitest run` | 3,507 passed, 1 failed, 14 skipped (3,522 total) across 232 files. The 12 failing files are **identical to the `main` baseline** (3,433 / 1 / 14): 11 fail for missing Supabase env (`caller-id-selection`, `custom-fields-settings`, `dialer-api-attempt-cap`, `dialerCampaignPresenceHook`, `clientMapping`, `contactName`, `leadDisposition`, `contactScope`, `userLocalDayBounds`, `runtimeEventLogger`, `addLeadAssignmentGate`), plus the existing `recordingRetentionVoicemail` v29 assertion. **+74 new tests, all passing; no status change in any existing test.** |
| `npx tsc -p tsconfig.app.json --noEmit` | 90 errors, **equal to the baseline**. None is in a Reports file; the only match is the pre-existing `Sidebar.tsx` `/reports` comparison. |
| Root `npx tsc --noEmit` | Exit 0. This is vacuous: the root project is empty. |
| ESLint on every touched TS/TSX file | Clean. |
| `npm run build` | **PASS** (built in ~23 s; only the existing chunk-size warning). |

## 7. Known risks

1. **Frontend-first window (intended).** Between the Vercel deploy and the migration, Reports shows "Reports are
   temporarily unavailable" to everyone. It never shows zeros. Keep that gap short.
2. **Tabs already open on the old app show zeros after the migration.**
   - Reports is bundled eagerly, so a tab opened before the deploy keeps running the old Reports code.
   - Once step 3 seals the legacy RPCs, the old code swallows the errors and renders 0s until the tab reloads.
   - This is not a leak, but it is misleading. Apply the migration a few minutes after the deploy is READY, and ask users
     to hard-refresh.
3. **The numbers intentionally change from today's Reports.**
   - Contacted is now canonical. Calls Made is outbound only. Boundaries follow the agency zone.
   - Campaigns and lead sources are populated for the first time.
   - Reports matches the Leaderboard only when the viewer's browser zone equals the agency zone, because the Leaderboard
     stays browser-local.
   - 2 of 3 production orgs have no `company_settings` row and will report in `America/Chicago` (labelled "agency default
     — not configured") until they set a time zone.
4. **Permissions are enforced on the server.**
   - Only 1 org has `role_permissions` rows. The others get the pinned defaults: Agent Reports page **off**, Team Leader
     team scope.
   - An Agent in those orgs gets the permission-denied state. This matches the client-side defaults they already had.
5. **The preflight pins the audited legacy bodies.** If anyone changes a legacy `rpc_report_*` body in production before the
   release, the migration aborts atomically with nothing applied, and needs a fresh audit. This is safe, but it blocks the
   release.
6. **Security advisor.** It will list six more `authenticated`-executable SECURITY DEFINER functions. This is intentional:
   it is the same aggregate-RPC pattern as the existing ones, with the contract in #38.
7. **Load is unmeasured.** Six RPCs run per page load (no polling). Each is window-bounded and uses
   `idx_calls_org_created_at`. A 366-day organization report is the heaviest case.
8. **Scope-drift notice.** If an admin changes a user's report permissions, or the agency zone, while the user has Reports
   open, the user sees "Your report access changed while this page was open" and reloads. This is intended.

## 8. Metric decisions still required (implemented as the recommended default unless Chris says otherwise)

1. **Default zone.** Orgs with no `company_settings` row report in `America/Chicago`, labelled as the default. Confirm this,
   or set a time zone for the two unconfigured orgs before the release.
2. **Outbound population (D-3).** Calls Made, Talk Time, Contacted, Contact Rate, dispositions and volume charts count
   outbound calls only. Inbound is shown separately.
3. **Contact rate** is contacted outbound calls ÷ outbound calls made (call-level, not lead-level).
4. **Converted key.** Converted counts the campaign lead when present, else the contact, else the call. It counts once per
   window, with no conversion rate.
5. **Session ratios** ("Calls per session hour", "Talk time share of session") count only agents with session time: their
   calls and talk ÷ their session time. This is new from the review.
6. **Unattributed calls (D-11).** They count in organization totals, show as an "Unattributed" line, and are excluded from
   per-agent tables.
7. **Lead source (D-6).** Converted-by-source stays unavailable, and costs, CPL and ROI stay hidden. Approve the per-org
   cost-key follow-up, or keep them hidden.
8. **Goal Tracking (D-7).** It stays unavailable until goals have a maintained writer.
9. **Saved / scheduled reports (D-8).** They stay unmounted. Decide whether to redesign or delete them.
10. **Legacy functions (D-9).** Decide when to drop the sealed `rpc_report_*` functions.
11. **Leaderboard / Dashboard.** Decide whether and when to move them to agency-zone reporting. They are browser-local today.

## 9. Exact production migration / deployment sequence (requires Chris's separate approval)

Preconditions:
- The PR is reviewed.
- The `Reports backend verification` CI check is green.
- Local gates (§6: the SQL runner, Reports and full Vitest, app typecheck, ESLint and build) are re-run on the final head.
- There is no active dialing concern: this change touches no telephony. The migration only creates functions and revokes
  EXECUTE, and it takes a 5 s `lock_timeout`.

1. **Merge the PR to `main`.** Vercel builds production from `main` automatically.
   - Until step 3, the new frontend shows "Reports are temporarily unavailable" with Retry, because the new RPCs do not
     exist yet. It never shows zeros.
   - Tabs opened **before** this deploy keep the old bundle. After step 3 they show zeros on Reports until they are
     reloaded (§7 risk 2). Wait a few minutes after READY, and ask users to hard-refresh.
   - No other page changes behaviour.
   - Wait for the deployment to be READY.
2. **Read-only preflight** (Supabase MCP `execute_sql`, SELECT only):
   ```sql
   SELECT p.oid::regprocedure, md5(p.prosrc), p.proacl::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'rpc_report%' ORDER BY 1;
   -- expect md5 eb741e0d…, 7d17e968…, 521abcbc…, 9dc9273f… and ACL {postgres,anon,authenticated,service_role}
   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname='public' AND p.proname LIKE 'get\_report\_%') OR (n.nspname='private' AND p.proname LIKE 'report\_%');
   -- expect 0
   SELECT to_regprocedure('private.campaign_actor()'), to_regprocedure('private.resolve_downline_ids(uuid,uuid)');
   -- expect both non-null
   ```
   (The migration's own preflight repeats these checks and aborts atomically on any drift or replay.)
3. **Apply the migration** with `apply_migration`, name `reports_secure_scoped_rpcs`. The query is the exact bytes of
   `supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql`, verified by SHA-256 against the file
   (`7d6168a23e0ed282fd6843a536859328baba080a4f5fe985cd1bf3d6e2e7642b`, 64,253 bytes; e.g. `sha256sum` locally, and compare the `query` text you pass byte-for-byte).
4. **Reconcile the repository filename** to the version `apply_migration` records, in a record-only commit. Do not edit
   the SQL bytes. Update `scripts/run_reports_rpc_tests.sh`, `src/lib/__tests__/reportsContracts.test.ts` and
   `.github/workflows/reports-backend.yml` if they reference the filename.
5. **Read-back** (SELECT only):
   - Six `public.get_report_*` functions exist with `prosecdef = true`, `provolatile = 's'`,
     `proconfig = {search_path=pg_catalog, pg_temp}`, and ACL `{postgres, authenticated, service_role}`.
   - Eight `private.report_*` functions exist with ACL `{postgres}`.
   - The legacy `rpc_report_*` ACL is `{postgres, service_role}`.
   - `has_function_privilege('anon', 'public.get_report_scope()', 'EXECUTE') = false`.
6. **Bounded authenticated-role reads** in a READ ONLY transaction: `SET LOCAL ROLE authenticated` plus
   `request.jwt.claims` for Chris's own profile. Run `get_report_scope()` and `get_report_call_summary(<this month>)`.
   - Record the timings.
   - Compare calls made, talk time and policies against an independent SQL count at the same UTC bounds.
7. **Signed-in smoke tests** (§11).

## 10. Exact rollback / re-disable procedure (fail-closed — plan §R2.3)

**No procedure below re-grants EXECUTE on the legacy `rpc_report_*` functions.** They stay sealed in every state.

- **(a) Re-disable — preferred, reversible.**
  - Apply `supabase/ops/reports_disable.sql` as a new migration named `reports_disable`.
  - It revokes the six `get_report_*` from authenticated, PUBLIC and anon, and re-asserts the legacy seal.
  - The page then shows "Reports are temporarily unavailable" with Retry. A revoked-EXECUTE `permission denied for
    function` maps to *unavailable*, never to "You don't have access"; `reportsQueries.test.ts` pins this. No data is
    touched.
  - Re-enable later with `supabase/ops/reports_enable.sql`. It grants only the new RPCs, and refuses if their security
    metadata drifted.
- **(b) Remove the new functions.**
  - Apply `supabase/migrations/rollback/20260928120000_reports_secure_scoped_rpcs.rollback.sql` as a new migration.
  - It drops the six public and eight private report functions, re-asserts the legacy seal, and aborts if any legacy
    function remains client-executable.
  - Reports stays unavailable.
- **(c) Frontend rollback.**
  - Promote the previous Vercel deployment, only together with (a) or (b).
  - The old frontend calls the sealed legacy RPCs and would render zeros through its old error-swallowing.
  - Prefer fixing forward.
- **Verification after any of these:**
  - `has_function_privilege('anon'|'authenticated', 'public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE')`
    is false.
  - After (a): `has_function_privilege('authenticated', 'public.get_report_scope()', 'EXECUTE')` is false.

All three SQL paths are exercised by `scripts/run_reports_rpc_tests.sh`, including when a legacy grant has been
re-added by hand.

## 11. Recommended smoke tests after release

1. **Admin, "This Month".**
   - The toolbar shows "Organization · America/Los_Angeles", or the labelled default zone for orgs without settings.
   - Calls made / talk time / policies equal an independent SQL count at the same agency-zone bounds.
   - The Leaderboard month matches only when your browser zone equals the agency zone. The Leaderboard stays
     browser-local.
2. **Admin, agent filter.** Pick one agent: every panel narrows to that agent, and the CSV header says
   "Agent filter: <name>".
3. **Agent (own scope, production org permissions: page on, View Own on).**
   - There is no agent selector.
   - No other agent's name appears anywhere, CSVs included.
   - The Export button is absent, because the org's Agent "Export Reports" is off.
4. **Team Leader.**
   - The selector lists self and downline only.
   - Calling `get_report_call_summary` by hand with a non-downline agent id returns HTTP 403 / 42501.
5. **Anonymous.**
   - `POST /rest/v1/rpc/get_report_scope` with only the anon key is denied.
   - `POST /rest/v1/rpc/rpc_report_call_summary` with any org id is denied.
6. **Previously broken panels.** Campaign Performance and Lead Source Performance render real rows (they were
   permanently empty before). Lead-source Converted reads "Not available".
7. **Permission change takes effect.** Turn the org's Agent "Reports" page permission off. On the next load the Agent
   sees the permission-denied state, and the server returns 42501. Turn it back on.
8. **Failure is not zero.** Take the network offline, then reload the Reports tab. Panels show "Couldn't load … This is
   not a zero" with Retry, and Export is disabled.
9. **Load.** In the API logs, each report RPC for This Month should come in under about 1 s at current volume, with no
   periodic Reports traffic (there is no polling).

## 12. Dialer / Leaderboard boundary confirmation

**Confirmed: no Dialer, Twilio, Leaderboard, Dashboard, RLS or Edge Function behaviour was changed.**

- **No file in those areas changed.**
  - `git diff --name-only 5d37e5f..HEAD` contains nothing under the Dialer, Twilio/`TwilioContext`, queue, recording,
    inbound, Leaderboard or Dashboard code, or `supabase/functions`.
  - The only filename that matches those keywords is `src/components/reports/PoliciesSoldChart.tsx`, a Reports chart.
- **Byte-identical to `main`, and enforced in CI** (blob SHAs pinned in `reportsContracts.test.ts`):
  - the Dialer-owned `src/lib/report-utils.ts` and `src/lib/supabase-dialer-stats.ts`;
  - `src/hooks/usePermissions.ts` and `src/config/permissionDefaults.ts`.
- **What the migration does:**
  - It creates only new `public.get_report_*` and `private.report_*` functions.
  - Its only GRANTs are EXECUTE on those six public RPCs, to `authenticated` and `service_role`.
  - Its only REVOKEs are on the four legacy `rpc_report_*` functions and the new functions.
- **What the migration does not do:** no table DDL, no RLS policy, no trigger and no data write. It does not touch any
  Dialer or Leaderboard function (the Leaderboard recovery, payload, request-gate, polling and metric code is untouched).
- **Unchanged:**
  - `device.connect()`, single-leg WebRTC, re-entrancy guards, call ownership, queue locking, retry, dispositions,
    recording, inbound routing and campaign claiming;
  - the Dialer's agent-local "Today" counters (#14);
  - the Leaderboard's browser-local periods.
- **Production actions taken: NONE.** No merge, no `apply_migration`, no Edge Function deploy, no Vercel deploy and no
  configuration change. Production access was limited to the read-only catalog and aggregate SELECTs listed in plan §1.
