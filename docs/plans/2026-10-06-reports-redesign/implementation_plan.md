# Reports Phase 2 — executive workspace and personal customization

## Authorization and baseline
Chris's current instruction, “Let's start the next phase of the redesign. Make it somewhat customizable as well,” authorizes implementing the previously approved Phase 2 Reports direction. Phase 1 was deployed and closed out at main `92e486ca4bd84ff1ee2938ad38fe94ba39635eba`, with its documented historical-data and hosted-browser limits retained. This plan precedes implementation. Production rollout is a separate final decision after a reviewable candidate exists.

## Scope
Keep the app shell and all v2 reporting definitions/queries. Add permission-derived Personal / Team / Agency tabs, retaining server-selected maximum scope by default. Build a fixed production hero (Policies Sold, Known Annual Premium with coverage), six-metric grouped strip, production and calling charts, an honestly labeled activity-to-production flow, people/campaign/source panels, then grouped dialer intelligence. Never invent previous-period comparisons, cohort conversions, premium attribution or unavailable metrics.

Customize only this viewer's layout in the existing report_layouts table: up to six approved activity/support metrics and visible/order preferences within performance and dialer groups. Keep production heroes, trends, scope/date/basis controls fixed. Preserve old preferences through a pure versioned migration. Use explicit Save / Cancel / Reset, named mobile/keyboard controls, real pending/error states, and owner-bound async state. Read existing organization defaults as fallback but expose no organization-wide writes in this personal customization UI.

## Files planned
- `src/pages/Reports.tsx`: integration; preserve scope, request and export safeguards.
- `src/components/reports/ReportsToolbar.tsx`, `ReportScopeTabs.tsx`: scope controls and calm header.
- `src/components/reports/ReportsOverview.tsx`, `ReportsActivityFlow.tsx`: production and non-cohort flow.
- `src/components/reports/ReportCustomizer.tsx`, `SectionRenderer.tsx`, `ReportSection.tsx`, `StatCard.tsx`: bounded customization and presentation.
- `src/components/reports/PoliciesSoldChart.tsx`, `CallVolumeChart.tsx`, `AgentPerformanceCards.tsx`: truthful trends and performance table.
- `src/lib/report-layout-constants.ts`, `report-layout.ts`, `src/hooks/useReportLayout.ts`: validation, migration, owner-bound persistence.
- Focused tests under `src/lib/__tests__`, `src/hooks/__tests__`, `src/pages/__tests__`, and component tests as needed.
- Existing isolated native SQL browser fixture under `scripts/tests/reports-visual/` and its payload exporter, if needed for scope/customization checks.
- This plan, verification/context snapshot, `WORK_LOG.md`, and a narrowly scoped `AGENT_RULES.md` invariant if warranted.

## Integrity constraints
No schema/RLS/RPC/provider/writer changes. Existing available_scopes are authoritative. Scope selections bind to viewer/org and clear agent filtering. View As continues to block report requests and preference reads/writes. Loading/error must not show old numbers or zero. Preserve exact premium cents, seconds, premium coverage and unavailable attribution; every export remains bound to current payload identity and server authorization. No production fixtures or secrets. No protected hosted browser session access.

## Verification and completion
1. Focused layout normalization/persistence tests: malformed/legacy config, limits, errors, auth mismatch, owner changes and saved draft lifetime.
2. Real-hook scope integration: explicit scope request, agent reset, stale payload/export invalidation, role-independent permission options, View As.
3. Existing report math/contract/query/export tests and focused lint.
4. Required root TypeScript command, actual app TypeScript against baseline, production build; report existing failures separately.
5. Isolated native-backed browser desktop/mobile checks where runtime permits: hierarchy, overflow, charts, customization save/cancel/reset/failure, scopes and existing export/race checks. No bypass of runtime restrictions.
6. Independent code review; update work log and context snapshot. Commit/publish reviewable branch and draft PR with exact validation evidence; production remains unchanged until rollout authorization.
