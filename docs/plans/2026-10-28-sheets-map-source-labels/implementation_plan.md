# AgentFlow — Google Sheets source-column label cleanup

**Created:** October 28, 2026
**Status:** Approved for branch-only implementation; pending code review and CI.
**Approval:** Chris explicitly approved the six-file scope: remove visible spreadsheet letters and sample-value captions from the left side of mapping v2, retain all field/mapping behavior, branch and PR only.
**Repo:** `cgarness/agentflow-life-insure`; baseline `c707bd7cc3e6800ceb82840889f5f62bb9e37a3a`; branch `refactor/sheets-map-source-labels-20261028`.

## Understanding

In Settings → Google Sheets → Edit sheet, each source mapping row currently shows a sheet column letter, a header label, and a second line of "e.g." sample data. The adjacent picker is now a compact A–Z dropdown (PR #499). The left column should match that single-line visual treatment without losing the actual column name, its tooltip, or the `New` badge.

## Exact approved file list

1. `src/components/settings/google-sheets/MappingColumnRow.tsx` — remove visible column letter and example-value caption. Keep source header as a single ellipsized label with full native `title`, and `New` indicator; align with 36px dropdown on desktop; responsive mobile stacking. Remove unused sample prop. Preserve mapping controls, Move confirmation, inline custom field creation, disabled/validation semantics.
2. `src/components/settings/google-sheets/MappingStepV2.tsx` — stop extracting/passing display-only sample data to mapping rows. Keep header state, source mapping, ignore reconciliation, preview, and save gates unchanged.
3. `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx` — assert no visible column letters/example captions in mapping step, intact full header tooltips and `New` badge, and preview/selection behavior.
4. `scripts/tests/google-sheets-ui/verify.mjs` — extend existing 1440px desktop + 390px mobile fake-provider browser tests to show a nonempty sheet sample yet assert that sample and column-letter captions are absent from mapping rows; preserve independent Preview data tests and overflow check.
5. `docs/plans/2026-10-28-sheets-map-source-labels/implementation_plan.md` — this plan and observed verification.
6. `WORK_LOG.md` — add newest-first code-shipping entry with exact files, result, verification, risks and next steps.

No other files are in scope. No schema or Edge Function changes. No modifications to sheet source data, lead rows, mappings, auth or dialer.

## Technical approach

- Retain the existing `MappingColumnRow` semantic header text and `title={column.header}`. Replace the two-line letter/example markup with a single `min-h-9` flex row; `min-w-0` / `truncate` preserves long headers. Keep `New` badge with `shrink-0`.
- Keep the `grid-cols-1 sm:grid-cols-2` mapping layout; source header and target picker vertically center on desktop. On mobile, labels stack above their respective picker with no horizontal overflow.
- Do not change `MappingFieldPicker`, `headerState`, `usePreviewV2`, `previewGate`, server actions or persisted schemas. Sample values remain available through the existing preview API and Preview step; only the mapping-row captions disappear.

## Verification

1. Review source diff: only the six listed paths, no side effects or changed source mapping logic.
2. GitHub Google Sheets CI (exact PR head) runs focused Vitest, ESLint, `npx tsc --noEmit`, real app TypeScript comparison against the exact PR base (repo root command is vacuous), Vite build, Edge tests, isolated SQL/PostgREST/e2e and real pg_cron/pg_net checks.
3. Desktop/mobile browser harness with nonempty header sample verifies full header labels, no letters/example line, responsive fit, Preview still displays values, Save/Enable unchanged.
4. Check Vercel preview status only; do not promote/deploy or change project settings.
5. Open a PR for review, keep unmerged; production release needs separate explicit approval.

## Risks and rollbacks

- Long source headers: full value remains in native tooltip; visible label truncates rather than wrapping.
- New column warning must remain visible; testing asserts this.
- Current source mappings and imported leads are untouched.
- Rollback is frontend revert after separately approved merge/release, with no database changes.

## Context snapshot

**Decisions:** Compact one-line source labels; no example text or column letters; no change to Preview, ignored-column acknowledgment, custom field creation, target-picker A–Z behavior or mapping confirmation.
**Files planned:** Six paths above.
**Migrations/deploys:** None.
**Verification status:** Pending branch code/CI.
**Next:** Execute surgical frontend changes and tests, append `WORK_LOG.md`, open review PR. Never merge/push to main without Chris's separate approval.
