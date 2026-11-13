## November 12, 2026 Pacific — released

The exact approved PR #527 release is applied, merged and deployed. Canonical AgentFlow passed authenticated smoke checks. See [production-release.json](production-release.json) and the newest WORK_LOG entry for hashes, deployment references, verification and practical limitations. The historical status entries below are retained and superseded by this release record. No further production action is authorized by this documentation update.

## November 12 — approved bounded request budgets

Chris approved proceeding with the proposed 40-second cap after clarifying that the scale case represents one agency, not all agencies combined. The scope is exactly three new readers: `get_scoped_commission_overview`, `get_scoped_commission_installments`, and `get_scoped_commission_policy_list`. `get_scoped_commission_breakdown` remains at 20 seconds. Existing My APIs, helpers, role/database limits and security rules remain unchanged. Broader multi-agency concurrency work is deferred and has not been verified. This is implementation approval only; production release remains separately gated.

Exact intended files: the existing `20261112165503` migration and guarded rollback; release transaction packages/manifest and generator as needed; `measure_scoped_reads.sh`, `commission_scoped_scale_postgrest.mjs`, native harness/runner exact-setting assertions, `.github/workflows/policy-commission-tracking.yml` test wall-clock allowance, root/focused plans, verification/evidence, release document, narrow AGENT_RULES invariant and WORK_LOG. Preserve original failures and all financial/security assertions. Regenerate actual catalog pins and prove the 40/20-second caps and eight-second pooled default restoration, complete scale matrix and final-head CI before the production approval request.

Current prepared migration SHA-256 `0118728fde1d70d45c6595745a15109f997674e3801b608e037fd7f618debff1`; apply transaction `750d5c13a56d1a2b59e942d5fba2e7dcd68b4681535d107bbcd72a50c5ef8f5d`; rollback source `6c6a6cb2cc61d903624a91f1e65c5433dfeae0f887a164d5d530bf31b2cf34d0`; rollback transaction `6e4665af865fb5b70250ce3e3742c32a4ba46425bd008b3bc6bd55e96e1ebb2f`. Native catalog pins were refreshed from all 29 actual function postimages. Only the three approved new headers change; all function bodies and existing helper/legacy metadata remain unchanged. Full verification is pending.

Current status: approved budget changes and exact packages are prepared; full verification is running. No production changes. Historical entries and measurements below are retained; their earlier pending-budget language is superseded by this approval.

## Historical — November 12 candidate before budget approval

Current base `713aa48d2c71de7da595d74bee878324654e3255` includes released Carriers; its permission-hook bytes and histories are preserved. Refreshed hosted head `20261111192142` leaves all28 commission/auth preimages unchanged. New CLI source is `supabase/migrations/20261112165503_policy_commission_scoped_reads.sql`, with matching rollback; replaces only the older UNAPPLIED Team Commissions timestamp. Current migration SHA-256 `636b81d3f4ca4977f93fb728ec8dd5141b89debedf46822fa774d92be9d84366`. No production changes.

The first hosted run failed three largest-book timeout cases, despite earlier local passes; this remains blocking. Corrected browser readiness passed49checks in each of four runs (three cold, one4xCPU), without relaxing Escape/focus assertions. Current-base full checks and regenerated package rehearsal are being completed. Proposed40-second budgets for three affected new readers are detailed in release.md and are not implemented. No repeated feature-plan approval is required; only this measured performance tradeoff remains a decision. Exact current-head evidence supersedes historical results below where stated.

# Team Commissions — approved implementation, production not authorized

November 10, 2026 Pacific. Chris explicitly approved this complete implementation in the task prompt, including isolated tests, branch publication and a reviewable PR. Do not request the same implementation approval again. No production mutation, merge or deployment is authorized. Exact production actions will be consolidated after the candidate passes verification.

Baseline: main `e07d28bdef1d8a9a21f0eee408b181b625389527`, branch `feat/team-commissions-20261110`. Read authoritative rules, vision, latest work log and root plan plus the complete saved 51-scenario reference. Draft PR #486 remains separate at `2de28c320547983f68bed5f77d8ec9684ea3643d`; no optional-age/backfill import. Hosted history head `20261110205228` (Fidelity alias), preceding `20261110191037` (Reports cleanup). Both are already applied; pending files are immutable evidence, never replay actions. Current reader/authz function definitions, metadata, grants, RLS, index and profile column inventories captured read-only before editing. Refresh preimages before release.

Supabase CLI 2.84.5 generated `20261111015438_policy_commission_scoped_reads.sql`, which sorts after hosted history. Matching rollback restores fresh captured legacy definitions and removes new objects in explicit dependency order without CASCADE or business data changes.

## Historical — November 10 local candidate, production not authorized

Implementation, all 51 acceptance scenarios, final full native runner (exit 0), 36 repeated scale cases, exact SQL apply/history/rollback/reapply proofs, 48 browser checks, 163 focused frontend tests and production build are complete. Full frontend: 7,110 passed; unchanged one baseline failure/ten pending. Application TypeScript and global lint retain byte-equivalent base findings (79 diagnostics; 11 errors/145 warnings); scoped lint/root TypeScript pass. The only prepared budget extension is20 seconds on the three new public aggregate RPCs, verified through real PostgREST with 8-second role defaults/restoration. No RLS/auth/writer/role/database setting change.

Migration SHA-256 `553cf6d61c93cbe12de16e0c080b1cd58256b5d6ae659fc32dbd1d4fed346917`; exact source/security pins, full measurements, screenshots and rollback are in the focused release/evidence documents. Current main remains `e07d28bdef1d8a9a21f0eee408b181b625389527`, hosted head `20261110205228`; no production changes. Next: publish/inspect exact-head CI and deliver the single concrete production release request. Do not repeat implementation approval.

## Execution and ownership

One integration owner coordinates database migration, frontend scope/cache, reporting UI, native authorization/reconciliation and frontend/browser verification workstreams. Independent read-only review covers auth and publication automation. Existing shared plans/history are preserved by prepending this task. Tests use isolated synthetic fixtures only. No production impersonation or customer commission write.

Implement shared set-based invoker reads in `policy_commission_scoped`; seven new public readers; eight compatible self-only public My readers and two existing fact wrappers. Preserve saved integer cents, receipt aggregation, current hierarchy authorization, actual-caller client RLS, tenant predicates on every financial table, timezone fail-closed behavior, historical seller attribution and existing writer/recovery contracts. No new RLS, SECURITY DEFINER, private actor grant, table write grant, permission setting, index without measurement, or financial engine.

Discovery contract: `get_commission_agent_scope(p_search text default null,p_limit integer default 50,p_offset integer default 0,p_agent_scope text default null,p_agent_ids uuid[] default null)`; authorized paged agents and resolved selected_agents, available_count/total_count, can_view_own/can_select_others, default_scope/scope_revision. Each reporting API prepends `p_agent_scope text`, `p_agent_ids uuid[]` to its corresponding existing defaulted read arguments; full signatures will be recorded with the migration before release. Scoped responses retain existing fields plus meta.agent_scope {mode,agent_ids,revision}; team rows add credited_agent_id/agent_name. Selected self remains read-only on the server; UI may commit explicit Me.

URL commits agents/agent_ids independently of Scheduled date scope. Draft Apply/Cancel selector; full authorized All resolution; no protected View As requests; own-or-team navigation; keyed reporting subtree with Calculator/Hide amounts outside; scope-aware keys and cancellation; no unauthorized cached rows after detected revocation. Backend revalidates every request; no claim of instantaneous remote revocation.

## Exact intended file manifest

The following paths are authorized for this task and listed before implementation. Three focused helper modules keep boundaries under 200 lines; dedicated parity, measurement and synthetic browser harness files are justified verification additions to the reference. Root owns documentation and evidence. No package/lock, usePermissions, telephony, Reports implementation or writer edits.

- `implementation_plan.md`
- `AGENT_RULES.md`
- `WORK_LOG.md`
- `docs/plans/2026-11-08-team-commissions/implementation_plan.md`
- `docs/plans/2026-11-08-team-commissions/verification.md`
- `src/lib/commission/centerScope.ts`
- `src/components/commissions/CommissionScopeProvider.tsx`
- `src/components/commissions/commissionScopeContext.ts`
- `src/components/commissions/CommissionAgentSelector.tsx`
- `src/pages/CommissionsPage.tsx`
- `src/components/layout/CommissionsNavItem.tsx`
- `src/hooks/useCommissionsCenter.ts`
- `src/lib/commission/centerApi.ts`
- `src/lib/commission/centerFilters.ts`
- `src/lib/commission/centerSchemas.ts`
- `src/components/commissions/CommissionsTabs.tsx`
- `src/components/commissions/CommissionDrawer.tsx`
- `src/components/commissions/overview/OverviewTab.tsx`
- `src/components/commissions/overview/SummaryCards.tsx`
- `src/components/commissions/overview/CommissionTimeline.tsx`
- `src/components/commissions/overview/CarrierBreakdown.tsx`
- `src/components/commissions/overview/ProductBreakdown.tsx`
- `src/components/commissions/overview/BreakdownDetails.tsx`
- `src/components/commissions/overview/MonthsTenToTwelve.tsx`
- `src/components/commissions/overview/NeedsReview.tsx`
- `src/components/commissions/overview/UpcomingList.tsx`
- `src/components/commissions/payments/ScheduledTable.tsx`
- `src/components/commissions/payments/HistoryView.tsx`
- `src/components/commissions/policies/PoliciesTab.tsx`
- `src/components/commissions/policies/PoliciesTable.tsx`
- `src/components/commissions/shared/Bits.tsx`
- `src/lib/commission/__tests__/centerScope.test.ts`
- `src/components/commissions/__tests__/agentScope.test.tsx`
- `src/hooks/__tests__/useCommissionsAccess.test.tsx`
- `src/hooks/__tests__/useCommissionsCenter.test.tsx`
- `src/pages/__tests__/commissionsPage.test.tsx`
- `src/pages/__tests__/commissionsHideAmounts.test.tsx`
- `src/components/commissions/__tests__/centerFixtures.ts`
- `src/components/commissions/__tests__/filterConsistency.test.tsx`
- `src/components/commissions/__tests__/drawer.test.tsx`
- `src/components/commissions/__tests__/lists.test.tsx`
- `src/components/commissions/__tests__/overview.test.tsx`
- `src/components/commissions/__tests__/breakdowns.test.tsx`
- `src/components/commissions/__tests__/goal.test.tsx`
- `src/lib/commission/__tests__/centerFilters.test.ts`
- `src/lib/commission/__tests__/centerSchemas.test.ts`
- `src/lib/commission/__tests__/centerInsights.test.ts`
- `scripts/policy_commission_scope_fixture.py`
- `supabase/tests/policy_commission_scoped_harness.sql`
- `supabase/tests/fixtures/policy_commission/scoped_hierarchy.json`
- `supabase/tests/policy_commission_scoped.sql`
- `scripts/tests/policy_commission/commission_scoped_postgrest.mjs`
- `scripts/run_policy_commission_tests.sh`
- `.github/workflows/policy-commission-tracking.yml`
- `src/hooks/useCommissionAgentRoster.ts`
- `src/hooks/commissionCenterQuery.ts`
- `src/components/commissions/CommissionScopeBoundary.tsx`
- `supabase/migrations/20261111015438_policy_commission_scoped_reads.sql`
- `supabase/migrations/rollback/20261111015438_policy_commission_scoped_reads.sql`
- `scripts/tests/policy_commission/measure_scoped_reads.sh`
- `supabase/tests/policy_commission_scoped_parity.sql`
- `scripts/tests/policy_commission/commission_scoped_browser.mjs`
- `scripts/tests/policy_commission/browser/index.html`
- `scripts/tests/policy_commission/browser/main.tsx`
- `scripts/tests/policy_commission/browser/vite.config.ts`
- `scripts/tests/policy_commission/browser/fixtures.ts`
- `docs/plans/2026-11-08-team-commissions/release.md`
- `docs/plans/2026-11-08-team-commissions/evidence/baseline.json`
- `docs/plans/2026-11-08-team-commissions/evidence/verification-summary.json`
- `docs/plans/2026-11-08-team-commissions/evidence/desktop.png`
- `docs/plans/2026-11-08-team-commissions/evidence/mobile.png`

## Manifest amendment — detected personal permission loss

Before editing these additional paths, integration review found that shared personal tracking denials do not notify the reporting scope. Add only a current-scope denial notification after the existing recovery handling; preserve request IDs, exact retry inputs, unknown-outcome registry and server writers unchanged. Calculator denial is observed through the provider query-cache subscriber without editing CalculatorTab.

- `src/hooks/useClientPolicyCommissions.ts`
- `src/hooks/__tests__/useClientPolicyCommissions.test.tsx`

## Manifest amendment — atomic release package

The migration API assigns an apply-time version. To preserve the CLI-generated version without creating new hosted/source drift, prepare the existing SQL Editor style transaction package. It pins the production project/head and exact SQL bytes, verifies preimages/postimages, and records the exact source in migration history atomically. It is a review artifact only; production execution remains separately gated. Recovery restores all shared legacy paths and removes only its exact guarded migration-history row, never a business row. Any uncertain result must be read back before retry.

- `scripts/prepare_commission_scope_release.py`
- `docs/plans/2026-11-08-team-commissions/release/apply.sql`
- `docs/plans/2026-11-08-team-commissions/release/rollback.sql`
- `docs/plans/2026-11-08-team-commissions/release/manifest.json`

## Manifest amendment — historical Reports migration ordering test

The full-suite comparison exposed two Reports contract assertions that require the released November 5 package to remain the final migrations forever. Adding any later root migration trips them. Update only `src/lib/__tests__/reportsV3Contracts.test.ts` to keep asserting the same 20-file contiguous package, exact predecessor, four enable positions, names, checksums and privilege classes while allowing later independent migrations. No Reports implementation or immutable migration changes; no assertion is waived.

- `src/lib/__tests__/reportsV3Contracts.test.ts`

## Scoped-helper performance refinement — recorded before editing

Measured native plans found avoidable join amplification and generic-plan cliffs at large scopes. Internal `policy_commission_scoped.installments` may add optional narrowing inputs `p_window_from date`, `p_window_to date`, `p_kind text`, and `p_include_undated boolean` to apply the caller's existing effective filters before irrelevant ledger rows reach joins/RLS. No public API or existing self-only helper signature/default/composite changes. Unfiltered calls must retain every existing row, including undated rows. New optional arguments are validated and never confer actor/seller authority. Breakdown and Scheduled may pass only predicates equivalent to their current result domains; Overview must preserve Upcoming beyond 90 days and every review/held/summary domain. Final parity tests are required.

The same listed migration/rollback, fixture, verification and package-generator files cover this refinement; no new file, security privilege, RLS/auth primitive, table/index, writer or production setting is authorized or changed. Fixed SQL with bound parameters may replace cached PL/pgSQL SELECT execution to avoid generic-plan cliffs; never interpolate browser input or weaken tenant/seller predicates. Record final helper signatures and hashes after measurement.

## New aggregate RPC execution budgets — prepared, not applied

The final safe query refinements remove repeated join/RLS amplification without changing authorization. Native 1,000-seller/50,000-policy diagnostics then complete Overview in 11.436 seconds and all-time/any Scheduled in 9.650 seconds; the existing general authenticated limit is eight seconds. Breakdown is below eight seconds with a narrow measured margin. Preserve full results and existing RLS rather than truncating the authorized universe or weakening access.

Prepare `SET statement_timeout = '20s'` only on the three new public aggregate RPCs: `get_scoped_commission_overview`, `get_scoped_commission_installments`, and `get_scoped_commission_breakdown`. This is bounded metadata on new read APIs, not a role/database timeout change. Keep every existing My reader's full metadata and eight-second role behavior unchanged. No permission, RLS, auth primitive, schema exposure or writer change is added. PostgREST 12.2 supports hoisting function settings at transaction start; prove the actual HTTP behavior with authenticator/authenticated defaults of eight seconds, repeated large-book requests, full financial reconciliation, cancellation, and restoration of defaults on subsequent requests. Direct SQL cannot prove timer hoisting. Record both the original eight-second refusals and the measured new API results; do not call the original gate passed or claim production concurrency/hardware capacity.

Regenerate the exact source/rollback/package hashes and postimage metadata, rerun the complete native/HTTP/legacy compatibility suites, and include these three 20-second function settings in the consolidated production release approval. Production version/hoisted-setting preflight remains necessary; the anonymous production OpenAPI endpoint is restricted to service_role, so do not bypass that control or acquire privileged keys for metadata. No hosted setting is changed during preparation. Existing listed files cover this refinement.

## Manifest amendment — real HTTP aggregate-budget proof

Add `scripts/tests/policy_commission/commission_scoped_scale_postgrest.mjs` before editing. It uses only the loopback synthetic large-book fixture with PostgREST 12.2.3, eight-second authenticator/authenticated defaults, repeated new aggregate calls, full totals, following-request default restoration and explicit bounded-timeout probes. Integrate it into the already listed native runner/workflow; do not use production credentials or modify hosted settings.

- `scripts/tests/policy_commission/commission_scoped_scale_postgrest.mjs`

## Verification and release sequence

Run all A01–A19, F01–F14 and U01–U18 scenarios with recorded evidence; native current-hierarchy PostgreSQL and PostgREST; legacy before/after/rollback parity; 1/10/100/1000 agents and 50,000 policies; focused regressions, actual app TypeScript, root TypeScript, lint, build and desktop/mobile/keyboard browser checks. Compare failures against exact base with equivalent tooling, never weaken assertions. Inspect GitHub/Supabase/Vercel automation before publication. Production request will name exact PR/head, migration/hash/effects, both linked Vercel projects, backend-first/frontend-second actions, readback and rollback. All test/result fields remain pending until executed.

## Accepted reference

# AgentFlow Team Commissions Implementation Plan

Version 1 • November 8, 2026 Pacific • Owner: Chris Garness

Add authorized team visibility to the existing Commissions Center so uplines can review their downlines’ policies, saved commission estimates, schedules, and recorded receipts from one agent selector. The selector supports Me, one agent, several agents, and All agents across the permitted hierarchy.

Chris has agreed to the product scope. This reference defines the implementation and verification work for the next build. Preparing this plan authorizes documentation and read-only inspection; implementation and production release follow the approval stages below.

The first release provides read-only team reporting. Personal commission actions remain available in Me. The selected agents’ figures remain distinct from an upline’s own override earnings.

## Agreed product scope

The feature stays within the existing Commissions page and its Overview, Payments, and Policies sections. It follows AgentFlow’s life insurance workflows and existing organization boundaries.

| Decision | Version 1 behavior |
| --- | --- |
| Default view | Me when the user can view their own commissions |
| Agent selection | Searchable dropdown with one or multiple exact agent selections |
| All agents | All agents the caller is currently authorized to view, including self when permitted |
| Hierarchy depth | Direct and indirect descendants at every authorized level |
| Individual selection | Only that individual’s credited policies and commissions |
| Team Leader scope | Same-organization authorized downline |
| Agency Admin scope | Authorized agents within the Admin’s organization |
| Ordinary Agent | Personal access only, even if profiles appear beneath them |
| Team editing | Team views are read-only, including the viewer’s own rows inside a combined view |
| Personal tools | Calculator and monthly goal remain personal |
| Historical attribution | Follow the credited selling agent and saved commission ownership |
| Visibility after a transfer | Follow the current authorized hierarchy without rewriting historical ownership |
| View As | Commissions remain unavailable; no roster or financial requests are issued |

Team visibility includes active agents without commission records, so an upline can select an agent and see a legitimate empty result. Inactive or retained deleted profiles with eligible historical records remain included when the existing authorization allows them. Account status does not silently remove historical money from All agents.

This release does not add override calculations, carrier reconciliation, team goals, financial exports, bulk adjustments, new permission settings, customer backfills, or changes to policy/sale writers. It does not alter the dialer, Reports metrics, or contact ownership.

## Current implementation and verified baseline

The implementation baseline is repository main at commit `40e2a962191780a1dbb25fa49c808f7b8b63d09d`. The latest commit is the Reports V2 frontend merge. Some older documentation still describes earlier release stages; use current source and live object definitions to establish implementation state, and preserve unrelated Reports work.

Read-only inspection of production project `jncvvsvckxhqgqvkppmj` confirmed migration head `20261105120044` and the installed commission tracking, expected-window, Center, insights, and hierarchy migrations. Commission tables, goals, wins, clients, and profiles have row-level security enabled.

The underlying `policy_commission_authz.access(agent_id)` function already grants authorized Team Leaders read access to downlines and recognizes existing same-organization administrative rights. The current Center restricts reporting to the signed-in seller through `get_my_*` readers and self-only helpers.

| Finding | Implementation consequence |
| --- | --- |
| The current viewer helper requires personal commission permission | Add a scope resolver that supports team-only access without requiring Own |
| Reporting helpers enforce the caller’s own agent ID | Add authorized multi-agent facts and shared aggregation; a dropdown alone is insufficient |
| Wins reads also admit Agency Group peers | Explicitly constrain every policy/sale query to the actor’s organization and approved sellers |
| Same-organization profile reads are broader than downline access | Filter agent discovery through the financial authorization helper on the server |
| Client access follows the contact’s current assigned agent | Keep contact visibility independent of commission ownership |
| Top-level tab links and generated drill-downs currently omit agent scope | Carry the committed selection through every navigation path |
| Some list rows advertise Record payment or Record estimate unconditionally | Gate those actions in the new read-only team view |
| Existing refresh paths may display cached data after an error | Permission or scope failures must clear affected financial data |
| Carrier choices persist in component refs | Remount the financial subtree when scope changes |

Relevant source references are collected at the end. The live inspection read catalog metadata and function definitions, not customer commission records.

## Agent selection and page behavior

### Selection model

Use a single typed selection with three modes: `me`, `selected`, and `all`. Selected mode contains one or more unique agent UUIDs. The server resolves All agents on every request; the browser never turns the visible dropdown results into the authoritative All list.

A single selection containing only the viewer normalizes to Me when personal access is available. All agents remains a team reporting mode even when it temporarily resolves to only the viewer.

If Own is disabled but the user has authorized downline agents, open All agents and omit Me. If no agents are authorized, show “No agents available” and issue no financial queries. A malformed or unauthorized explicit URL selection shows an invalid/unavailable selection state; it never silently falls back to Me or All.

### Dropdown interaction

Place one compact Agents control above the reporting content. Use the existing Radix/shadcn primitives and Tailwind styling.

- Show Me first when available, All agents, a search field, and checkboxes for individual agents.
- Keep checkbox edits in a temporary draft. Search and checkbox changes do not refresh financial data.
- Apply commits the complete selection once, resets pagination, and closes the dropdown.
- Cancel, Escape, or dismissal discards the draft.
- Disable Apply for an empty custom selection.
- Show the committed label outside the dropdown: Me, the agent’s name, “3 agents,” or All agents.
- All agents covers the full authorized roster, including results outside the current search or loaded picker page.
- Use profile IDs to distinguish identical names. Show only permitted profile information and a restrained inactive/archived label where needed.
- Hide the selector only when Me is applied and self is the only authorized agent. If an All or other non-Me URL resolves to self alone, retain the selector or a compact Back to Me action so the user can return to personal controls.

### Reporting sections

The applied selection controls Overview cards, comparisons, carrier/product breakdowns, timeline, Months 10–12, Needs review, Upcoming, Scheduled payments, payment History, Policies, and policy detail.

Preserve the existing Expected, Received, Remaining, and Next 90 days cards. The selected agents change their scope, not their meaning. “Next 90 days” still ignores the selected date period while respecting the agent selection.

Show an Agent column in team policy and payment lists. On mobile, put the agent name inside the record’s existing stacked layout. Keep the current policy fields and compact spacing. A single selected downline agent should remain clearly identified in the selector and detail drawer.

The drawer closes when the applied selection changes. Clicking a record opens its saved commission detail only when that record still belongs to the current permitted selection.

### Personal calculator and goals

Hide or disable Calculator when Own permission is unavailable. Direct navigation to /commissions/calculator by a team-only user shows the existing unavailable state without a calculator-context request.

Keep Calculator outside the financial subtree that remounts on agent changes. Its inputs remain tied to the signed-in user and organization. Hide the Agents control on Calculator while retaining the reporting selection for the user’s return. Opening Calculator must not load another agent’s compensation inputs.

Show and fetch monthly goals only in Me. Guard the goal read and write hooks, not only the visual component. Team receipt totals must never feed a personal goal’s progress.

Keep Hide amounts tied to the signed-in user and organization. It continues masking amounts, chart labels, accessible text, drawers, and dialogs across all scopes.

### Read-only team detail

Every non-Me mode, including a raw Selected request containing only self, has no Record payment, Record estimate, Edit dates, hold, replace, confirm, dismiss, or void controls. Apply this to list shortcuts and nested drawer components. The new scoped detail response carries effective read access for team views, even when an Admin has separate write privileges elsewhere.

Personal Me retains existing authorized actions and the original request IDs and recovery behavior. Changing views must not discard an unresolved financial write or treat an unknown outcome as cancelled.

## Authorization and historical visibility

Every financial read derives the signed-in actor and organization on the server. Requested agent IDs are filters, never authority. Reuse the existing active-profile validation, organization resolution, ancestry, and commission permissions.

| Actor or condition | Expected result |
| --- | --- |
| Own enabled, ordinary Agent | Self only |
| Own disabled, ordinary Agent | No commission agents |
| Active Team Leader with Others enabled | Authorized same-organization descendants |
| Team Leader with Own disabled and Others enabled | Downline view still works; self is excluded |
| Non-admin Team Leader with Others disabled | Personal access only when Own permits; existing Admin/Super Admin full-access handling is preserved |
| Same-organization Admin or recognized Super Admin | Existing authorized agency scope |
| Sibling, upline, unrelated branch, or another organization | No additional access through this feature |
| Stale privileged token after profile demotion/deactivation | Current database authority controls subsequent reads |
| View As | No commission roster, reporting, goal, or calculator requests |

The resolver uses `auth.uid()`, existing `policy_commission_authz.actor_org()`, and `policy_commission_authz.access(id)`. It does not duplicate role-permission parsing, grant access to private actor helpers, or introduce a new SECURITY DEFINER function.

For Selected mode, validate every submitted ID. Reject the whole selection if any requested agent is unauthorized or missing. Reject null IDs, malformed UUIDs, contradictory mode/ID combinations, and empty Selected lists. Deduplicate and sort IDs consistently.

Current hierarchy governs current viewing rights for historical periods. Moving an agent to another branch changes which uplines can review that agent’s history. It does not change the credited seller, saved compensation assumptions, receipts, or policy identity.

Financial access does not grant contact access. Names, links, and client-record fields come only from clients visible under the actual caller’s RLS. Otherwise show the existing Restricted contact treatment and permitted saved commission information. Never recover a hidden client name from the wins snapshot.

The backend checks authorization on every request. The frontend revalidates on relevant profile/permission changes, window focus or reconnect, selection application, and detail opening. Once a scope change or denial is detected, remove the previous roster/figures and close detail. Do not claim instantaneous revocation in another already-open browser without a verified notification mechanism.

## Financial definitions and reconciliation

Use the saved commission ledger and existing definitions. Preserve integer-cent arithmetic and the existing agency timezone rules. An unset or invalid timezone keeps the established error state.

| Measure | Definition retained |
| --- | --- |
| Policies | Distinct eligible stable policy IDs, using the existing sale-date filters |
| Estimated commission in sales breakdowns | ACTIVE saved first-year estimates on eligible sales; held estimates are separately disclosed and superseded estimates do not count |
| Expected | Scheduled estimated payments whose saved window starts in the selected period, with existing hold/date exclusions |
| Received | Non-voided manually recorded receipts by their received date |
| Remaining | Sum of each eligible installment’s max(expected minus valid receipts, 0) |
| Excess | Per-installment overpayment shown separately |
| Next 90 days | Remaining on eligible saved windows in the existing agency-calendar horizon |
| Months 10–12 | Remaining first-year installments in the existing next-month definition |
| Missing estimate | Missing/setup state, never a manufactured zero |
| Open capture | Existing awaiting-confirmation or needs-attention state, not a commission amount |

Aggregate receipts by installment before joining policies or agents. Count each policy once and each installment once. A large Advance receipt cannot settle another installment. Current active/on-hold and superseded status rules remain as defined today.

Combine amounts and underlying counts before computing averages or comparison percentages. Do not average per-agent averages. Use the same authorized agent scope for both comparison periods.

Preserve the differences between sale dates, expected dates, and received dates. New scope must compose with existing carrier, Unknown carrier, product, setup, status, and date filters. Policy entries without the existing stable sale/policy identity are not fabricated into the Center.

For example, in a synthetic fixture, Agent A can have a $600 saved first-year estimate and Agent B a $900 estimate. Their combined first-year estimate is $1,500; Expected still depends on each saved installment’s dates. Recorded receipts remain their own measure.

Per-agent amounts must reconcile to the corresponding existing personal view for the same underlying records and effective filters. Contact names and fallback carrier/product grouping may legitimately differ when the upline cannot access a client that the seller can access; test Restricted contact and Unknown grouping explicitly.

These figures remain AgentFlow projections and manual receipt records. Keep the current short explanation in one information control. No new carrier-verified, earned-income, payroll, override-income, or overdue-payment claims are introduced.

## Backend implementation contract

### Shared implementation

Use one new migration with logical name `policy_commission_scoped_reads`. Generate the actual filename with the Supabase CLI during build preparation and confirm its version sorts after the current hosted migration head. The timestamp is intentionally not assigned in this reference.

The migration adds a non-PostgREST schema, `policy_commission_scoped`, for validated scope resolution, set-based facts, aggregations, and serialization. All new financial readers and helpers are STABLE SECURITY INVOKER, with fixed search paths and explicit schema qualification.

Factor the existing calculation logic into that shared implementation. Retain the eight existing public My reporting APIs as compatibility wrappers with the same arguments, defaults, response shapes, and self-only rules. Retain the old policy/installment helper signatures as self-only wrappers over the shared facts. The existing viewer helper remains unchanged for legacy personal checks. Keep the old fact composite types and pure formatting/period helpers intact; use new scoped types to add seller identity. The current suites expect seven helpers in policy_commission_reporting and six in policy_commission_insights, so new helpers belong in the new schema.

This migration therefore adds new objects and replaces specific existing reader/helper bodies. It does not edit or replay applied migration files, change RLS policies, add table write grants, or rewrite business rows.

New scoped facts retain credited_agent_id alongside the existing policy/installment facts. Apply actor organization and permitted seller predicates to wins, estimates, captures, installments, and receipts, including nested queries and fallback paths. Never impersonate a selected agent or alter request claims to invoke a personal reader.

Non-exposed helpers are still callable by roles granted EXECUTE. They must validate their own actor, organization, and requested scope rather than trusting a browser-constructible internal parameter.

### New public read APIs

The following names are the planned contract. Final SQL signatures and grants belong in the implementation plan before coding.

| New API | Purpose |
| --- | --- |
| get_commission_agent_scope | Authorized agent discovery, personal availability, default scope, and scope revision |
| get_scoped_commission_overview | Cards, timeline, upcoming preview, and review counts |
| get_scoped_commission_installments | Scheduled payment rows and full-filter totals |
| get_scoped_commission_receipt_list | Recorded receipt history and totals |
| get_scoped_commission_policy_list | Eligible policies, setup state, and totals |
| get_scoped_commission_breakdown | Carrier/product groups, comparisons, and Months 10–12 |
| get_scoped_policy_commission | One policy’s permitted commission detail |

Reporting requests accept named arguments p_agent_scope text (me, all, or selected) and p_agent_ids uuid[] (Selected only), plus the corresponding existing period/filter/pagination arguments. Reject IDs supplied with Me or All. A raw selected request containing only self remains read-only; the interface can normalize that choice by committing an explicit Me request. Do not accept a caller role, authority token, trusted organization, or an alternate actor ID.

Agent discovery returns only the permitted profile identifiers, display names, relevant status, self marker, available count, can_view_own, can_select_others, default scope, and a non-authoritative scope revision. The revision identifies the validated membership/permission context for cache isolation; the server still recomputes access on every read.

For a large roster, search and page the permitted options with deterministic name/ID ordering. Selected IDs must be resolved against the full authorized set rather than only a loaded picker page. All totals always cover the complete matching authorized set.

Return agent identity on team rows and applied scope metadata on scoped responses. Detail must reject a policy outside the selected agent set even when the viewer could separately access that seller.

Use existing error conventions: 42501 for denied scope, 22023 for invalid selections/filters, PT404 for unavailable policy detail, and 55000 for the timezone condition. Invalid selection and denied access never return an unrestricted report.

### Compatibility objects

Preserve these public reporting signatures and personal semantics:

- get_my_commission_overview
- get_my_commission_installments
- get_my_commission_receipts
- get_my_commission_policies
- get_my_commission_receipt_list
- get_my_commission_policy_list
- get_my_commission_breakdown
- get_my_policy_commission

The two existing internal compatibility wrappers are policy_commission_reporting.policies and policy_commission_reporting.installments. Preserve the existing goal APIs, get_client_policy_commissions, tracking writers, authorization functions, shared-grid access, and all sale/appointment/reporting writers.

### Grants and performance

Grant execution only to the intended authenticated application role for the new APIs and required helpers. Explicitly revoke new-function EXECUTE from PUBLIC, anon, and service_role before granting authenticated; grant no CREATE privilege on the helper schema. Add no service-role browser path, new privileged fallback, broad schema grants, or RLS bypass.

Perform set-based filtering and aggregation in the database. Do not make one browser request per selected agent or sum only the loaded 25-row page. Reuse existing indexes first. Any additional index must be justified by isolated query-plan evidence and listed explicitly in the migration proposal.

Measure representative fixtures of 1, 10, 100, and 1,000 authorized agents, including a 50,000-policy synthetic agency case. Record timings and query plans; establish a measured baseline and address material regressions before release. These fixture sizes are verification targets, not production performance claims or UI selection limits.

## Frontend implementation contract

### State and URLs

Add a Zod-validated CommissionAgentScope model and URL codec. Use distinct query parameters such as `agents=me`, `agents=all`, or `agents=selected&agent_ids=...`. Scheduled payments already has a date-scope concept; do not overload it.

Treat the URL as the committed selection. Preserve it across refresh, back/forward, top-level tabs, Scheduled/History, filters, pagination, and every card/chart/detail link. Keep destination-specific date and status semantics correct instead of copying unrelated parameters indiscriminately.

Deduplicate and sort Selected IDs for a stable identity. A missing scope parameter takes the server-approved default; an explicitly invalid parameter is blocked. Draft checkbox changes remain local until Apply.

### Component boundaries

Within the existing user/organization-keyed Center, add a scope provider, selector, and financial subtree. Key the financial subtree by canonical applied selection and validated scope revision. This remount clears old drawers, carrier-option refs, pagination state, and temporary report UI.

Keep Calculator and the Hide amounts provider outside that selection-keyed subtree. Split the provider/context or hooks as necessary to keep components under 200 lines. Avoid a circular dependency between scope resolution and reporting hooks.

Use the existing access hook to expose own/team page eligibility while preserving no-request behavior under View As and the current navigation loading layout. Server discovery and every read remain authoritative. Do not modify the byte-pinned usePermissions implementation.

### Cache and invalidation

Retain the policy-commissions query prefix so existing personal tracking changes invalidate reporting and detail. Add actor, organization, canonical selection, validated scope revision, resource, and effective filters to every financial key.

Replace the current positional pagination-identity assumptions with an explicit identity helper. Previous-page placeholders are allowed only within the same actor, organization, agent scope, authorization revision, resource, and effective filters. Scope changes show loading.

Cancel obsolete requests. An A-to-B-to-All sequence must never display A’s response under B or All. When a response indicates a changed scope revision, reconcile the reporting boundary before presenting incompatible sections together.

On authorization denial, lost hierarchy access, changed identity, or invalid selected agents, clear affected cached roster and financial data, close detail, and require a valid selection. A transport failure may retain the current scope’s last result only when authorization is still valid and existing stale-state presentation remains accurate.

Preserve unresolved personal mutation state in the existing recovery registry. An agent-filter change cannot reset an unknown operation’s request ID or create a fresh duplicate submission.

### Interface quality

Use the existing visual system, Tailwind only, keyboard-operable checkboxes, clear focus states, and responsive list layouts. Keep the selector compact and use existing informational controls for definitions. Hide amounts must cover new agent rows and accessible chart/detail text. No mock values enter production paths.

## Planned file manifest

These are the intended paths for the later approved build. This reference does not edit the repository. Before implementation, copy the final manifest into root implementation_plan.md and the focused plan, refresh main/open work, and list any justified amendment before touching an additional file.

### Documentation

Modify:

- implementation_plan.md
- AGENT_RULES.md
- WORK_LOG.md

Add:

- docs/plans/2026-11-08-team-commissions/implementation_plan.md
- docs/plans/2026-11-08-team-commissions/verification.md

Update the Commissions Center invariant to describe the approved scoped readers while preserving the saved-estimate, contact-access, goals, View As, and writer rules. Append a newest-first work-log entry for each shipping stage.

### Frontend additions

- src/lib/commission/centerScope.ts
- src/components/commissions/CommissionScopeProvider.tsx
- src/components/commissions/commissionScopeContext.ts
- src/components/commissions/CommissionAgentSelector.tsx

### Frontend modifications

- src/pages/CommissionsPage.tsx
- src/components/layout/CommissionsNavItem.tsx
- src/hooks/useCommissionsCenter.ts
- src/lib/commission/centerApi.ts
- src/lib/commission/centerFilters.ts
- src/lib/commission/centerSchemas.ts
- src/components/commissions/CommissionsTabs.tsx
- src/components/commissions/CommissionDrawer.tsx
- src/components/commissions/overview/OverviewTab.tsx
- src/components/commissions/overview/SummaryCards.tsx
- src/components/commissions/overview/CommissionTimeline.tsx
- src/components/commissions/overview/CarrierBreakdown.tsx
- src/components/commissions/overview/ProductBreakdown.tsx
- src/components/commissions/overview/BreakdownDetails.tsx
- src/components/commissions/overview/MonthsTenToTwelve.tsx
- src/components/commissions/overview/NeedsReview.tsx
- src/components/commissions/overview/UpcomingList.tsx
- src/components/commissions/payments/ScheduledTable.tsx
- src/components/commissions/payments/HistoryView.tsx
- src/components/commissions/policies/PoliciesTab.tsx
- src/components/commissions/policies/PoliciesTable.tsx
- src/components/commissions/shared/Bits.tsx

The keyed reporting boundary should allow PaymentsTab, ScheduledView, PoliciesFilters, CarrierSelect, useCarrierOptions, GoalProgress, CalculatorTab, shared tracking dialogs, and AppLayout to retain their existing implementation. CommissionsNavItem needs a small comment correction so it describes personal or team eligibility; preserve its existing loading slot and View As behavior. Their behavior remains covered by tests. If a comment or actual integration dependency requires an edit, add its exact path to the scope amendment.

### Frontend tests

Add:

- src/lib/commission/__tests__/centerScope.test.ts
- src/components/commissions/__tests__/agentScope.test.tsx

Extend:

- src/hooks/__tests__/useCommissionsAccess.test.tsx
- src/hooks/__tests__/useCommissionsCenter.test.tsx
- src/pages/__tests__/commissionsPage.test.tsx
- src/pages/__tests__/commissionsHideAmounts.test.tsx
- src/components/commissions/__tests__/centerFixtures.ts
- src/components/commissions/__tests__/filterConsistency.test.tsx
- src/components/commissions/__tests__/drawer.test.tsx
- src/components/commissions/__tests__/lists.test.tsx
- src/components/commissions/__tests__/overview.test.tsx
- src/components/commissions/__tests__/breakdowns.test.tsx
- src/components/commissions/__tests__/goal.test.tsx
- src/lib/commission/__tests__/centerFilters.test.ts
- src/lib/commission/__tests__/centerSchemas.test.ts
- src/lib/commission/__tests__/centerInsights.test.ts

### Database and isolated verification

Add:

- One CLI-generated supabase/migrations file named with the generated version and policy_commission_scoped_reads.sql
- The matching reviewed rollback file under supabase/migrations/rollback
- scripts/policy_commission_scope_fixture.py
- supabase/tests/policy_commission_scoped_harness.sql
- supabase/tests/fixtures/policy_commission/scoped_hierarchy.json
- supabase/tests/policy_commission_scoped.sql
- scripts/tests/policy_commission/commission_scoped_postgrest.mjs

Modify these existing runner paths to load the new isolated fixture/migration and execute the new tests:

- scripts/run_policy_commission_tests.sh
- .github/workflows/policy-commission-tracking.yml

The new isolated fixture must restore the current authorization functions and hierarchy policies from their immutable source migrations, checked against the live reference digests. The older commission-only fixture is insufficient to prove current hierarchy behavior. Keep the existing permission_defaults.json, Center/insights fixtures, and regression suites unchanged where possible and run them against the final migrated state.

Keep applied migration files immutable. Do not modify package manifests/lockfiles, usePermissions.ts, TwilioContext.tsx, sale writers, Reports implementation, RLS policies, or shared tracking mutation code as incidental cleanup.

## Acceptance tests

Run authorization and calculation tests on isolated synthetic data with actual authenticated database roles and PostgREST where applicable. Load current hierarchy authorization rather than the older commission-only fixture. Include both a retained deleted seller and a retained deleted intermediate upline node. Use no customer write, production impersonation, or real commission receipt as a test.

### Access matrix

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Ordinary Agent selects Me | Existing personal records and totals |
| A02 | Ordinary Agent submits a descendant or sibling ID | Denied, including an Agent with profiles beneath them |
| A03 | Active Team Leader selects a direct downline | Correct read-only data |
| A04 | Active Team Leader selects an indirect downline | Correct read-only data |
| A05 | Team Leader selects sibling, upline, or another branch | Denied |
| A06 | Any request supplies another organization or Agency Group peer agent | Denied |
| A07 | Admin selects All agents | Only authorized agents in that organization |
| A08 | Own disabled and Others enabled | Sidebar and direct reporting entry work, default All; zero personal financial, goal, or calculator-context requests; direct Calculator route unavailable |
| A09 | Non-admin Team Leader with Others disabled | Downline cannot be selected or fetched; Admin/Super Admin full-access semantics remain unchanged |
| A10 | Demotion, deactivation, organization mismatch, or removed ancestry with stale token | Former downline access is refused; All recomputes current permitted membership; valid personal access survives demotion, while an invalid/inactive actor is denied |
| A11 | Mixed allowed and forbidden Selected IDs | Whole request refused |
| A12 | Empty/malformed/null/contradictory selection | Validation error, no scope widening |
| A13 | Allowed actor has no permitted members | Clean empty scope, no financial request |
| A14 | View As active | Navigation absent and direct entry unavailable; zero roster/reporting/goal/calculator requests |
| A15 | Hidden client, visible commission | Restricted contact and no client link/name leak |
| A16 | Direct invocation of granted internal helpers | Same actor/org/scope restrictions as public readers |
| A17 | Anonymous or unintended role invokes a new API | EXECUTE/access denied |
| A18 | Policy belongs to permitted seller outside the current selection | Detail refused |
| A19 | Raw Selected request containing self only | Effective detail access stays read-only; only an explicit Me request enables existing personal controls |

### Reconciliation matrix

| ID | Scenario | Required result |
| --- | --- | --- |
| F01 | Same fixture before/after migration using old personal APIs | Identical public contracts and financial results |
| F02 | Two agents individually versus combined | Amounts and eligible policy counts reconcile |
| F03 | Multiple receipts/installments for one policy | No duplicated policy or multiplied money |
| F04 | Voided receipt and replacement | Existing valid-receipt math retained |
| F05 | Advance overpayment | Excess separate; other installments unchanged |
| F06 | Superseded estimate, held estimate, open capture, missing estimate, stored zero | Each retains its existing meaning |
| F07 | More than one 25-row page | Totals include all matching rows |
| F08 | Month-end, leap date, daylight-saving boundary, and agency timezone | Existing period/window rules retained |
| F09 | Missing Sold Date or expected date | Existing eligibility/review behavior; no invented date |
| F10 | Card, chart, carrier/product group, and drill-down | Same selection and effective filters; totals reconcile |
| F11 | Weighted averages and comparison periods | Compute from combined underlying values/counts |
| F12 | Current hierarchy transfer | Visibility changes; historical seller/estimates/receipts stay identical |
| F13 | Inactive or retained deleted seller with authorized history | Included in historical totals and selectable when appropriate |
| F14 | Financially permitted but hidden client | Correct saved amounts, permitted Unknown grouping, no client fallback leak |

### Interface and recovery matrix

| ID | Scenario | Required result |
| --- | --- | --- |
| U01 | Checkbox drafting/search/Cancel | No committed selection or financial fetch change |
| U02 | Apply multiple agents | One selection commit; pagination resets |
| U03 | Refresh, back/forward, all tabs, Scheduled/History | Applied selection preserved |
| U04 | Every card/chart/month/review/Upcoming link | Same selected agents at destination |
| U05 | A to B to All with late responses | No stale scope displayed |
| U06 | Same IDs in different orders | Same canonical selection/cache identity |
| U07 | Pagination within one scope | Only permitted same-filter placeholder rows, actions disabled while updating |
| U08 | Access revocation detected with drawer open | Cached figures, names, carrier options, and detail cleared |
| U09 | Team view including Admin or self row | No financial mutation controls or mutation requests |
| U10 | Me after team view or UI self-only selection | UI commits explicit Me, and existing personal actions work under server permissions |
| U11 | Personal unknown write then scope change | Exact request ID and recovery state survive |
| U12 | Team totals and personal goal | Goal does not load/display or accept writes |
| U13 | Calculator round trip | Personal inputs preserved; no selected-agent rate fetch |
| U14 | Hide amounts | Every new financial value and accessible label masked |
| U15 | Desktop, 390-pixel mobile, keyboard, screen reader labels | Usable selector and readable records without new overflow |
| U16 | Failed scope resolution or invalid deep link | Clear error; no silent All/Me fallback |
| U17 | Picker search/page excludes some permitted agents | All still covers the complete authorized set |
| U18 | All URL resolves only to self | Selector or Back to Me remains available; no read-only navigation trap |

Run the focused commission and hierarchy suites, the existing sale/commission handoff regressions affected by the shared database harness, scoped lint, production build, and `npx tsc --noEmit`. Compare any existing repository-wide failures against the exact base; do not fix unrelated debt or claim baseline failures as new regressions.

Perform a React review after the component edits. Verify actual request counts and set-based query behavior for the scale fixtures. Capture desktop/mobile visual evidence with synthetic data. Verification.md records what ran, its result, remaining limitations, and the exact commit.

## Build and release sequence

### Stage 1 Prepare the build

When Chris authorizes implementation, refresh AGENT_RULES.md, VISION.md, WORK_LOG.md, current main, open commission work, and live function/grant baselines. Create an isolated feature branch. Record this scope and exact files in implementation_plan.md before editing.

Generate the migration filename through the CLI after checking the hosted head. Review the final RPC signatures, compatibility wrappers, helper grants, rollback dependencies, and test manifest together. Routine implementation choices within this approved scope do not create repeated approval stops.

### Stage 2 Implement and verify in isolation

Build the scope resolver and shared read engine, preserve legacy personal contracts, add the selector and scope-aware interface, and run the acceptance matrix. Keep all database fixtures disposable. Update the focused plan, verification record, AGENT_RULES invariant, and newest-first WORK_LOG entry.

Prepare a reviewable candidate with the migration, frontend diff, test evidence, screenshots, rollback procedure, and known limitations. Identify any automatic CI, Supabase preview, or Vercel preview effects before publishing the branch/PR.

### Stage 3 Review the concrete release

Request production approval only when the candidate is complete and reviewable. The request must identify the exact migration file/hash and SQL effects, the reviewed PR/head, the intended production project, and the merge/frontend deployment action.

Chris may approve those concrete backend and frontend actions together. The approved sequence remains backend first, frontend second. Do not request the same authorization again unless the approved scope materially changes.

### Stage 4 Release and confirm

1. Recheck production preimages and migration ordering.
2. Apply the exact approved migration once through the approved production workflow.
3. Verify migration history, new/legacy function signatures, grants, RLS preservation, and unchanged writer definitions.
4. Run Supabase security/performance advisors and compare changes with the baseline.
5. Merge the approved frontend candidate and verify the expected Vercel production deployment.
6. Perform authorized read-only acceptance in a real permitted session for Me, one downline, and All agents. Keep synthetic security tests distinct from live-user acceptance.
7. Record commit, migration version/hash, deployment, results, and any follow-up in WORK_LOG.md and verification.md.

No Edge Function deployment, new cron, environment-secret change, Twilio action, carrier integration, or production business-data write is required by the planned feature.

## Rollback and failure handling

The first recovery option is reverting the frontend to the last verified personal Commissions page. The preserved legacy APIs continue to serve older clients. This restores the existing experience while leaving saved estimates, receipts, and policies intact.

Prepare a database rollback before release. It must restore the exact pre-build definitions of the eight personal readers and two helper wrappers, then remove the new public readers and shared schema objects in verified dependency order. Use explicit object names and restrictive drops; do not use a broad CASCADE.

For an access-control problem, the reviewed incident action must disable or restore every affected entry point and shared helper path. Revoking only the new public APIs is insufficient when the defect also affects the shared implementation used by legacy My readers. Accept temporary financial unavailability when necessary, then revert the frontend and restore the exact reviewed database state. Changing the UI alone is not an access-control fix.

The rollback contains no deletion of commission/business rows and no replay of historical migrations. Confirm that goals, tracking writers, get_client_policy_commissions, RLS policies, and shared-grid permissions retain their recorded definitions/grants.

Any production rollback requires authorization for its concrete actions unless already included in the approved release/rollback package. Verify the personal APIs and catalog state afterward and record the outcome.

## Dependencies and implementation decisions

Open commission PR #486, headed at `2de28c320547983f68bed5f77d8ec9684ea3643d` during planning, contains optional-age commission and historical-backfill preparation. Coordinate its shared documentation, fixtures, and commission test-runner changes. This feature does not depend on merging it or executing its backfill.

Current main contains Reports V2 work. Preserve its commission snapshot and premium-correction boundaries, including the rule that correcting policy AP does not silently recalculate saved commission estimates.

The agreed product decisions are settled. The remaining build-time work is technical: generate the ordered migration filename, finalize SQL signatures/grants, measure the proposed queries, and confirm the exact reviewed diff against refreshed main. Do not invent a new product approval requirement for those routine tasks.

If an existing endpoint or test pin requires a file outside this manifest, explain the dependency and list the exact amendment before editing that additional path. If the implementation would need a broader permission change, new SECURITY DEFINER reader, production backfill, or altered financial meaning, stop that expansion and bring the concrete change to Chris.

Completion means the approved selector works across all reporting sections, the authorization and reconciliation tests pass, old personal clients remain compatible, release evidence is recorded, and live acceptance is reported at its actual level of verification.

## Build handoff prompt

Use this after Chris authorizes starting the implementation. It carries the agreed scope forward and makes production actions a separate concrete release decision.

```text
FEATURE — AgentFlow Team Commissions

Implement the approved Team Commissions reference plan for cgarness/agentflow-life-insure.
Read the complete plan before proposing scope changes.

1. Read AGENT_RULES.md, VISION.md, and the newest WORK_LOG.md entries.
   Refresh main and open work, especially commission PR #486. Preserve unrelated work.

2. Create/update root implementation_plan.md and
   docs/plans/2026-11-08-team-commissions/implementation_plan.md.
   List every intended file and the exact migration/rollback path before editing.
   Wait for Chris's explicit implementation approval unless it is already present
   in this session for this exact scope. His instruction to begin this approved
   build satisfies that gate; do not ask for the same approval again.
   Do not execute production backend commands beyond read-only inspection without
   explicit authorization for the exact action.

3. Add Me, one agent, multiple exact agents, and All agents to the existing
   Commissions Center. All includes every authorized same-organization descendant
   plus self when allowed; Admin scope follows existing agency permissions.
   Ordinary Agents gain no downline authority. Preserve the View As exclusion.

4. Derive every request's actor/org on the server. Reuse existing commission
   authorization and RLS. Fail closed on invalid/unauthorized selections.
   Support Others-on/Own-off. Preserve restricted-contact behavior and history
   for authorized inactive/retained deleted sellers.

5. Use shared set-based database facts/aggregations for new scoped readers and
   legacy My compatibility wrappers. Preserve old API shapes and self-only behavior.
   Add no new SECURITY DEFINER function, RLS relaxation, business-data migration,
   alternate commission engine, or frontend service-role path.

6. Generate the new migration using the Supabase CLI and current hosted history.
   Never edit/replay applied migrations. Prepare and test the exact rollback.
   Keep saved estimates, receipts, tracking writers, goals, sale writers, and
   current commission definitions intact.

7. Carry committed agent scope through every tab, URL, card, chart, list, and
   drawer. Isolate caches by actor/org/scope/revision. Clear stale financial data
   on detected authorization loss. Preserve unresolved personal-write request IDs.

8. Make all team reporting read-only. Keep personal goals/calculator personal.
   Preserve Hide amounts, keyboard access, mobile layout, and compact UI.

9. Keep changes surgical. Use organization_id consistently; use .maybeSingle()
   when zero rows are possible; Zod for selectors/forms/modals/responses;
   Tailwind only; components under 200 lines unless an existing approved exception.
   No mock data in production paths, hardcoded secrets, frontend service-role keys,
   new packages, telephony edits, or incidental cleanup.

10. Run the plan's isolated access, financial reconciliation, URL/cache/recovery,
    compatibility, and responsive-browser tests. Run npx tsc --noEmit, scoped lint,
    production build, and applicable existing commission/hierarchy regressions.
    Compare unrelated baseline failures accurately. Run Supabase advisors after
    approved database changes.

11. Prepare the reviewed PR and exact production release packet according to
    current authorization. Do not push directly to main. Do not apply production
    migrations, merge, trigger production deployment, change settings, or mutate
    customer records without the relevant explicit approval.

12. Append a newest-first WORK_LOG.md entry and maintain verification.md.
    End with a context snapshot: changes, files, decisions, actual migration/deploy
    status, tests, blockers, and the next concrete step.
```

Suggested coding mode: a strong reasoning model in Claude Code, Cursor, or Google Antigravity. Use parallel read-only review for authorization and reconciliation; use one coordinated implementation branch and one migration owner.

## Evidence and reference sources

### Repository references

All repository links below are pinned to the reviewed main commit.

- [Agent rules and invariants](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/AGENT_RULES.md)
- [Product vision](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/VISION.md)
- [Work log](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/WORK_LOG.md)
- [Commissions page](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/src/pages/CommissionsPage.tsx)
- [Commission access and queries](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/src/hooks/useCommissionsCenter.ts)
- [Current URL filters and drill-downs](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/src/lib/commission/centerFilters.ts)
- [Commission authorization and tracking](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/supabase/migrations/20261019170000_policy_commission_tracking.sql)
- [Current Center readers](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/supabase/migrations/20261020212000_policy_commission_center_reads.sql)
- [Insights and goal contracts](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/supabase/migrations/20261021180000_policy_commission_center_insights.sql)
- [Hierarchy authorization](https://github.com/cgarness/agentflow-life-insure/blob/40e2a962191780a1dbb25fa49c808f7b8b63d09d/supabase/migrations/20261023210027_hierarchy_authorization_boundaries.sql)
- [Open commission work to coordinate](https://github.com/cgarness/agentflow-life-insure/pull/486)

### Live metadata baseline

Read-only catalog inspection on November 8, 2026 Pacific confirmed these deployed definitions. Recheck before implementation/release; these digests are reference evidence, not permission to execute changes.

| Function | Definition MD5 |
| --- | --- |
| private.campaign_actor() | f582e43731a968fb2e0961e80939ff7e |
| public.is_ancestor_of(uuid,uuid) | c6d121db50b7ea2e37ce4a620cc855af |
| policy_commission_authz.actor_org() | 29be135fe6edfb5082838eeb22d48790 |
| policy_commission_authz.access(uuid) | a6da4418b7010c609d5be650615ae643 |
| policy_commission_reporting.viewer() | b6cfc70bebf0a007f303d486e81748bf |
| policy_commission_reporting.policies(uuid,uuid,uuid) | 58e2a95cb1975631d9e1daaafd1599c5 |
| policy_commission_reporting.installments(uuid,uuid,date,uuid[]) | b661f4fd5fc186849c0834c47f446605 |
| public.get_client_policy_commissions(uuid) | 5765e4dad8ec9c8b4bbb85fb32651c94 |
| public.get_my_policy_commission(uuid) | 6581348373a83dc8e09975220d1ca79d |

The verified migration versions are 20261019170000, 20261020040000, 20261020212000, 20261021180000, 20261023210027, 20261023232435, and 20261024045812. Current hosted head is 20261105120044.

The live wins SELECT policy admits the same organization or an Agency Group peer. The live clients policy applies assigned-agent/hierarchy access. Commission SELECT policies require actor organization plus policy_commission_authz.access(credited_agent_id). These findings support explicit seller/org filtering and independent contact privacy in the planned readers.

### Platform references

Use [Supabase database function guidance](https://supabase.com/docs/guides/database/functions) for invoker privileges and function execution grants, and [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) for preserving caller row policies. Recheck the [Supabase changelog](https://supabase.com/changelog) before implementation for applicable platform changes.

## Context snapshot

Product scope: agreed. Reference plan: complete for implementation review. Application code changes: not started. Production migration or deployment: not performed for this feature. Next step: Chris authorizes the implementation phase against this plan and its refreshed file manifest.

