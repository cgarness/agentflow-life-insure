# AgentFlow — Google Sheets Mapping V2 Closeout & Field Picker Polish

**Plan date:** October 28, 2026
**Source:** Approved October 28 plan (Chris's explicit approval before branch changes)
**Repository:** `cgarness/agentflow-life-insure`
**Base:** `f870755586a94f16caf1af631391de0237d82f31`
**Branch:** `chore/sheets-v2-closeout-picker-20261028`
**Scope:** Repository documentation and frontend picker only. No production/database/Edge/Vercel mutations, no mapped-source changes, no merge to `main` without separate approval.

## 1. Production evidence and boundaries

- Vercel production feature flag enabled; production mapping-v2 build READY at base commit; Supabase `google-sheets-api` v12, `google-sheets-push` v6, `google-sheets-sync-worker` v11, with `verify_jwt=false`.
- Four connected sources healthy. Chris Pilot B, Alexa FEX Real Time, Teo Goat Leads are `mapping.v=2`; Alexa FEX Aged remains supported `mapping.v=1` intentionally.
- Big Test imported automatically through Pilot B v2: one matching lead, one linked receipt; no duplicate.
- R7 created three audited agency-wide field conversions (Address, City, Zip Code), without changing existing lead values.
- Teo's saved Goat mapping has Beneficiary Name → Full Name, plus ignored Address/City/Zip and 14 other headers. Owner correction postponed; preserve mapping.
- Alexa's FEX Real Time excludes Trusted Form URL, OTP Code and IP Address by owner choice; separately document any consent-evidence implication, do not silently remap.
- Nine historical Pilot B receipts point at absent leads. No new-v2 causality established; no repair without separate design and approval.
- `WORK_LOG.md` on base is empty. Repo migration paths and release status lines have become stale.
- Actual production migration history:
  - M1 `20261028034425_google_sheets_context_field_types` (pending filename incorrectly `20261028120000`)
  - M2 `20261028040215_standard_lead_fields` (pending filename incorrectly `20261028120100`)
  - Both original forward SQL files were verified **byte-identical** to `supabase_migrations.schema_migrations.statements[1]` (M1 md5 `e93a8f1e3904fa5c6da6cf3843fe2ad4`; M2 `d8a405763974cdccd616b800e4314883`).

## 2. Exact approved paths to change

**Moves without editing as-applied SQL bytes:**
1. `supabase/migrations/pending/20261028120000_google_sheets_context_field_types.sql` → `supabase/migrations/20261028034425_google_sheets_context_field_types.sql`.
2. `supabase/migrations/pending/20261028120100_standard_lead_fields.sql` → `supabase/migrations/20261028040215_standard_lead_fields.sql`.
3. `supabase/migrations/rollback/20261028120000_google_sheets_context_field_types.rollback.sql` → `supabase/migrations/rollback/20261028034425_google_sheets_context_field_types.rollback.sql`.
4. `supabase/migrations/rollback/20261028120100_standard_lead_fields.rollback.sql` → `supabase/migrations/rollback/20261028040215_standard_lead_fields.rollback.sql`.
   Rollbacks were never run; their headers may be adjusted. **Do not execute rollback SQL.**

**Referenced path updates (no test coverage removal):**
5. `scripts/run_google_sheets_tests.sh`
6. `.github/workflows/google-sheets.yml`
7. `src/lib/google-sheets/__tests__/mappingV2.test.ts`

**Release documentation:**
8. `docs/plans/2026-10-27-sheets-mapping-reliability/release.md` — dated actual outcome, historical runbook retained, 3/4 opt-in and exceptions.
9. `AGENT_RULES.md` — update stale v2 status heading and record as-applied migration versions, preserving invariants.
10. `docs/plans/2026-10-28-sheets-v2-closeout/implementation_plan.md` (this document).
11. `WORK_LOG.md` — newest-first release entry, files, verification, known follow-ups, no production mutation in this branch.

**UI-only picker polish:**
12. `src/components/settings/google-sheets/MappingFieldPicker.tsx` — flat case-insensitive A–Z options list with stable tie-break. No category headings; Don't import first, Create custom field last. Include missing standard-field creation choices alphabetically. Compact one-line labels; “In use” instead of verbose duplicate-status copy; concise inaccessible/unavailable indication with full accessible reason. Preserve search, keyboard, selected checkmark, disabled semantics, ownership protections, duplicate-target Move confirmation.
13. `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx` — A–Z/missing field order; top/bottom actions; search; used status; disabled reason; keyboard selection; confirmation tests.

## 3. Guardrails

- Follow `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md`; no unapproved files, no backend or tenant-data writes, no Twilio change, no changes to existing sheet mappings.
- Preserve `organization_id`/RLS, `.maybeSingle()` when zero rows possible, Zod for forms, Tailwind only, no mock data in production, no frontend service secrets.
- Keep components under 200 lines. No new migrations or Edge functions.
- The forward SQL is immutable: **the renamed file content must remain byte-for-byte as recorded in production**. Header text inside the already applied file is historical, even where outdated; do not edit it.
- Never push directly to `main`. Open a review PR; no merge or Vercel production build without Chris's separate approval.

## 4. Verification gates

1. Confirm `main` base, competing PRs, migration names and byte match.
2. Confirm every dependent reference resolves, and old references disappear from executable runner/test paths (historical release notes may quote old paths).
3. Run `npx tsc --noEmit` (root command vacuous due to solution-style config) and `npx tsc -p tsconfig.app.json --noEmit` (real check; compare preexisting baseline).
4. Run focused Vitest for Google Sheets v2 UI and mapping unit tests.
5. Run full Google Sheets CI including Postgres/Edge/browser workflow. Do not claim successful checks unless observed.
6. Exercise desktop and narrow-screen search, alphabetical order, keyboard focus, disabled/in-use options, Save/Preview/ignored acknowledgement unchanged.
7. Inspect complete PR diff, then request separate authorization before merge and production deployment.

## 5. Acceptance / deferred items

- Software available in production at R6; one owner sheet on v1 remains intentionally supported.
- Teo correction postponed (Beneficiary Name mapped to Full Name, address fields ignored); Alexa ignored consent metadata is intentional, compliance implications not assessed.
- Nine old Pilot B receipts whose leads no longer exist are an open historical provenance audit, not automatic v2 failure.
- All release documentation accurate and workflow CI green before PR merge recommendation.

## 6. Execution snapshot

**Approved:** October 28, 2026 — repository branch edits, CI, and PR preparation only. No approval to merge to `main` or mutate production.  
**Branch created:** `chore/sheets-v2-closeout-picker-20261028` from `f870755586a94f16caf1af631391de0237d82f31`.  
**Branch preparation as of October 28:** Applied-forward SQL files moved byte-for-byte into recorded production versions; never-applied rollback files renamed; shell runner, workflow, and mapping unit-test file paths reconciled. Flat alphabetical dropdown and compact labels implemented with focused UI test additions. Release docs and work log reconciled. **No production mutation and no merge to `main`.**
**Observed verification (PR #499, code head `9d30a8c2f2a483e365ebb6aa36b365ac75bbafbf`):** Google Sheets Actions run [40751281029](https://github.com/cgarness/agentflow-life-insure/actions/runs/40751281029) completed **SUCCESS — all 5 jobs**: real `pg_cron`/`pg_net` (isolated), SQL/PostgREST/e2e, Deno Edge, focused frontend Vitest/ESLint/root TypeScript/app baseline comparison/Vite build, and mocked-host desktop/mobile browser flow (1440 and 390 px). The focused UI suite contains 190 passing tests. Two Vercel preview commit statuses were also SUCCESS; **not production deployment**. Other repository workflows are separately tracked by GitHub checks. Root `npx tsc --noEmit` alone is vacuous in this solution-style repo; the meaningful app check compares real `tsconfig.app.json` diagnostics to the PR base.

**PR ready for review:** [#499](https://github.com/cgarness/agentflow-life-insure/pull/499). Final branch tip includes these documentation-only test-result notes; no frontend code or migration SQL bytes were altered after the successful test run. Merge to `main` and subsequent Vercel production build still require separate explicit Chris approval.  
