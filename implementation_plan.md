# Implementation Plan — Convert to Client: Sold Date, Effective Date, Draft Date, Payment Frequency

**Task branch:** `claude/convert-client-policy-dates-802g34`
**Date:** 2026-08-11
**Status:** PLAN — awaiting Chris's explicit approval. No source file, migration, or backend state has been modified. This file replaces the completed 2026-08-11 contact-name-fix plan (that task is fully recorded in WORK_LOG.md L7-33, including the declined R3/R4 scope and the forward-only/no-backfill ruling — those rulings remain in force and are not resurrected here).

---

## 0. Inspection summary (what was audited before writing this plan)

Read completely: `AGENT_RULES.md` (all 29+ invariants), `VISION.md`, `WORK_LOG.md` (all 8,728 lines mined for ConvertLeadModal / conversion / wins / policy dates / anniversaries / reporting entries). Audited: ConvertLeadModal and all four invocation sites, `conversionSupabaseApi.convertLeadToClient`, `convert_lead_to_client_atomic` SQL, `triggerWin`, every repo read/write of `issue_date`/`effective_date`/premium/frequency (zero hits for any sold/draft/frequency concept), every reporting surface's date source, anniversary logic, workflow-automation trigger machinery, the baseline migration DDL for `clients`/`wins`/`leads`, generated types, and live production schema + migration history via read-only Supabase MCP (`information_schema`, `pg_constraint`, `list_migrations`, aggregate counts only — no data reads, no writes).

**Two decisive production facts:**
1. **`public.clients` and `public.wins` both hold 0 rows in production** (verified read-only 2026-08-11). There is no historical Issue Date, premium, or win data to protect, backfill, or migrate. Backward compatibility is therefore about *code paths and column preservation*, not data.
2. No sold-date, draft-date, or payment-frequency concept exists anywhere in schema, types, UI, Edge Functions, or WORK_LOG history (the only `frequency` column is `scheduled_reports.frequency` — report email cadence, unrelated; not reusable). This is greenfield.

---

## 1. Current data model

**`public.clients`** (baseline `20260806000000` L7188-7213; confirmed live): flat single-primary-policy model — `policy_type` (text NOT NULL default `'Term'`), `carrier`, `policy_number`, `premium` (numeric, **canonical, monthly dollars**), `face_amount` (numeric), `issue_date` (**text** `YYYY-MM-DD`, nullable), `effective_date` (**text** `YYYY-MM-DD`, nullable), `beneficiary_*`, `custom_fields` (jsonb), `lead_id` (lineage, partial-unique = conversion idempotency), `premium_amount` (numeric — **deferred schema debt, never read/written**, per AGENT_RULES §5), `organization_id`, `state`. No CHECK constraints on the table. Table-level `GRANT ALL` to `authenticated` (no column-scoped grants → new columns are automatically covered; RLS is row/org-level and unaffected by column adds).

**`public.wins`** (baseline L8469-8485): `agent_id/name`, `contact_id/name`, `campaign_id/name`, `call_id`, `policy_type`, `premium_amount` (numeric, **monthly**; COMMENT: leaderboard annual = ×12), `celebrated`, `created_at` (timestamptz default `now()`, nullable), `organization_id`, `idempotency_key` (partial-unique `uq_wins_idempotency_key`). **No business sale-date column — `created_at` (system insert time) is the only timestamp.** Sole writer: `triggerWin` (`src/lib/win-trigger.ts:44-59`), called from `supabase-conversion.ts:106-116` (after-commit, only when RPC returns `idempotent:false`, key `conversion:<lead-id>`) and `FloatingDialer.tsx:790-797` (bare quick-win: no premium/campaign/key — intentional per Decision A1).

**No policies table exists.** Primary policy is flat on `clients`; additional policies from multi-policy conversions are stored as `clients.custom_fields.additional_policies` JSONB ("until a dedicated policies table exists", WORK_LOG 2026-04-22). Since production `clients` is empty, no `additional_policies` JSONB exists anywhere → its shape can be safely evolved.

**Conversion path (single, atomic):** `ConvertLeadModal` (one shared component; hosts: DialerPage gated dispositions with `campaignId`, Contacts row-action / inline-status-select / Kanban-drop, FullScreenContactView via Contacts' `onConvert`) → `conversionSupabaseApi.convertLeadToClient` → `public.convert_lead_to_client_atomic(p_lead_id, p_client)` (SECURITY DEFINER, idempotent on `clients.lead_id`, fixed INSERT column list incl. `issue_date`/`effective_date` via `NULLIF(...,'')`) → after commit, `triggerWin`.

## 2. Current use of Issue Date

`clients.issue_date` is a **real database column** (task pre-work question: option **B**), but with **zero production data** (0 client rows) and **zero reporting/anniversary consumers**:
- **Writers:** `supabase-clients.ts` (`clientToRow`/`update` via `normalizeDateOrNull`) fed by AddClientModal + edit paths; `convert_lead_to_client_atomic` INSERT fed by ConvertLeadModal's "Issue Date" DateInput (defaults empty → NULL).
- **Readers:** Contacts clients-table column + text-chronological sort (`_contacts_filtered_clients` / `search_contacts_clients` sort key), FullScreenContactView `issueDate` render case, field-layout/required-fields/settings registries, tests. **No reporting, dashboard, leaderboard, anniversary, or automation surface reads it.**

**Ruling for this task (answers pre-work step 7):** Issue Date is a real column that must be **preserved in storage and API mapping for backward compatibility** (invariant: never drop/repurpose a production column for a UI change) but can safely be **retired from the user-facing UI** and replaced by Sold Date — there is no historical data and no downstream consumer that would change meaning.

## 3. Current use of Effective Date

`clients.effective_date` (text, nullable) is the **sole anniversary driver**: AnniversariesWidget (30-day window), DashboardDetailModal "Upcoming Renewals" (90-day window), `{{policy_anniversary_date}}` merge-token fallback chain. Written by AddClientModal + ConvertLeadModal; **captured but never displayed** on the client record (FullScreenContactView has no `effectiveDate` case — an existing inconsistency), not a table column, not sortable. It stays fully distinct from Sold Date in this plan and keeps its anniversary role unchanged.

## 4. Current canonical source for policy sold timing

There are **three coexisting "policies sold" definitions** today (pre-existing, documented in WORK_LOG; NOT unified by this task):
| Surface | Source | Date bucket |
|---|---|---|
| Leaderboard (`get_org_leaderboard_stats`), Dialer trusted stats (`get_trusted_today_dialer_stats`), GoalProgress, scorecards, wins feed | `COUNT(wins)` | **`wins.created_at`** |
| Dashboard StatCards / DashboardDetailModal (flagged "KNOWN INCORRECT SOURCE"), `get_agency_group_leaderboard` | `clients` rows | `clients.created_at` |
| Reports pages (`rpc_report_*`), campaign Converted | disposition-converted `calls` | `calls.started_at` |

**`wins.created_at` is the trusted-telemetry canon** (invariants #12/#14/#23) and is *system event time* — `triggerWin` writes no timestamp; the DB default stamps insert time. No editable business sale date exists anywhere. Annualized premium = ×12 of monthly `wins.premium_amount` (fallback `clients.premium`), applied "exactly once" server-side in the leaderboard RPC.

## 5. Schema changes required — YES (one migration)

New nullable columns (all legitimately unknowable for historical/manual records → nullable, no defaults, no backfill):

| Column | Type | Rationale |
|---|---|---|
| `clients.sold_date` | `date` | Business-effective sale date of the primary policy. Real `date` (not text) chosen deliberately: new automation-grade fields get DB-validated types and date arithmetic for future draft/reporting queries; PostgREST serializes `date` as `YYYY-MM-DD` strings so the frontend contract is identical to the existing text columns. The legacy text columns are left untouched. |
| `clients.draft_date` | `date` | Next expected premium draft date — a full date, not day-of-month, per task requirement, so future recurrence automations have a reliable anchor. |
| `clients.payment_frequency` | `text` + named CHECK `IN ('monthly','quarterly','semi_annual','annual')` | Controlled values (no free text). No existing canonical enum to reuse (verified). Text+CHECK matches house style (`scheduled_reports.frequency`, `profiles.billing_type`); extending later = one CHECK swap, no Postgres enum-type migration pain. UI labels: Monthly / Quarterly / Semi-Annual / Annual. |
| `wins.sold_date` | `date` | Business sale date stamped at win creation (see §6 decision D1). **Unread by all reporting in this task.** |

Plus: `CREATE OR REPLACE public.convert_lead_to_client_atomic` — extend the `p_client` keys read (`sold_date`, `draft_date`, `payment_frequency`, each `NULLIF(...,'')`, dates cast `::date`) and the fixed INSERT column list. Everything else in the function body is restated verbatim (SECURITY DEFINER, `search_path`, authorization, idempotency, contact-graph transfer, grants unchanged; `CREATE OR REPLACE` preserves ACLs). If D4 is approved, the same migration also re-creates `_contacts_filtered_clients` + `search_contacts_clients` with a `sold_date` sort key (date-typed, `NULLS LAST`, mirroring the existing `issue_date` text key).

**Migration file:** `supabase/migrations/<ts>_client_policy_sold_draft_payment_fields.sql`, timestamped strictly after `20260807165620` via `supabase migration new`. Per invariants #25/#28 and the S-gate regime: **file on disk only; NOT applied to production until Chris separately approves the apply.** Expect MCP `apply_migration` to re-stamp the version at apply time (as with M1–M3; noted so the S1 divergence bookkeeping is not a surprise). Supabase advisors run after an approved production apply. No RLS changes (new columns inherit existing org-scoped row policies), no grants needed (table-level GRANT ALL), no realtime/publication changes.

## 6. Key design decisions (D1–D6) — with recommendations; Chris rules

- **D0 (structural, baked into the plan): field placement.** Sold Date + Effective Date stay **per-policy-row** in the modal (they replace/sit where the per-row Issue/Effective dates are today; additional-policy rows carry `soldDate`/`effectiveDate` in the `additional_policies` JSONB — shape change is safe, zero rows exist). Draft Date + Payment Frequency are **client-level** (shared section beside beneficiary/notes) because the task defines Draft Date as "the **client's** next expected premium draft date," and they persist on `clients`. 
- **D1 — add `wins.sold_date` now (RECOMMENDED: yes).** Both tables are empty, so stamping the business date from day one gives a complete history with no backfill ever needed; wins are "destined one-per-policy" (Chris's Reports direction), so per-policy sale dates structurally belong on `wins` (a client row can hold only one). Not two competing truths, by explicit contract: **`wins.created_at` = when AgentFlow recorded the event — remains the reporting bucket everywhere; `wins.sold_date` = business-effective sale date — display/future use only.** Any future move of reporting onto `sold_date` is a separate approved semantics migration (and remains behind the standing D1 sales-lifecycle hard block from Dashboard Build 1). Alternative: clients-only (cheaper, but future wins-level business dating becomes an unreliable join/backfill).
- **D2 — Effective Date default (RECOMMENDED: start blank + one-click "Copy sold date" affordance).** Auto-defaulting Effective = Sold would silently fabricate coverage dates that feed the anniversary widgets (effective_date is their sole driver) — a wrong-looking-authoritative anniversary is worse than a blank. Blank → NULL → safely excluded from anniversaries. The task permits either; the affordance keeps entry fast without fabricating data. Alternative: prefill = Sold Date, editable.
- **D3 — Payment Frequency default (RECOMMENDED: preselect `Monthly`).** Monthly is the dominant life-insurance mode, the premium field is already labeled "Monthly Premium ($)", and a preselected value keeps the modal fast. Alternative: blank/NULL = "unknown" (more honest for automation; slower UX). Either way the Zod schema treats it as the 4-value enum (nullable only if Chris picks blank-default).
- **D4 — retire user-facing "Issue Date" beyond the modal (RECOMMENDED: yes).** Swap `issueDate` → `soldDate` in the Contacts clients-table column, default field layout, ContactManagement standard-fields registry, and required-fields labels; keep the `issueDate` render case in FullScreenContactView so saved user layouts containing it still render; `clients.issue_date` column + `supabase-clients.ts` mapping stay intact (storage compat, option D of the pre-work rubric). Requires the two clients-list RPCs re-created for the sold_date sort key (same migration). Alternative: modal-only change (leaves "Issue Date" visible app-wide while conversion writes Sold Date — confusing).
- **D5 — FloatingDialer quick-win stamp (RECOMMENDED: yes, one line).** Pass `soldDate = <agent-local today>` in its `triggerWin` call so quick-call wins also carry the business date. No other change to that intentionally-bare path (still no campaign/premium/idempotency key).
- **D6 — AddClientModal parity (RECOMMENDED: yes).** Manual client CRUD must use the same columns as conversion (AGENT_RULES §5 "Client policy columns"). Replace the Issue Date input with Sold Date and add Draft Date + Payment Frequency (Zod: optional ISO dates + enum). Issue Date remains writable via API for compat but is no longer surfaced.

**Explicit non-decision (invariant preserved):** `payment_frequency` describes the **draft schedule only**. `clients.premium` and `wins.premium_amount` remain **monthly dollars** regardless of frequency; the "Monthly Premium ($)" label and every ×12 annualization (leaderboard RPC, leaderboardTypes, dashboard) are untouched. Storing per-mode premium amounts would silently corrupt Annualized Premium in five places and is out of scope.

## 7. Exact files to change (complete list — nothing else)

**Core scope:**
1. `supabase/migrations/<ts>_client_policy_sold_draft_payment_fields.sql` — NEW (see §5)
2. `src/lib/policyPaymentFields.ts` — NEW: canonical `PAYMENT_FREQUENCIES` values/labels, Zod enum + ISO-date schema helpers, `formatPaymentFrequency`
3. `src/components/contacts/ConvertLeadModal.tsx` — per-row Sold Date (default agent-local today, editable, replaces Issue Date) + Effective Date (+ copy affordance per D2); shared Draft Date + Payment Frequency; **Zod validation** for the new fields (+ existing carrier rule); payload extension; UI stays the same compact Tailwind/DateInput pattern
4. `src/lib/supabase-conversion.ts` — `p_client` gains `sold_date`/`draft_date`/`payment_frequency`; `additional_policies` entries gain `soldDate`; passes `soldDate` to `triggerWin`
5. `src/lib/win-trigger.ts` — additive optional `soldDate` param → `wins.sold_date` (signature stays backward-compatible; DialerPage/invariant-#11 flow untouched)
6. `src/lib/supabase-clients.ts` — `rowToClient`/`clientToRow`/`update` map the three new columns (NULL-for-blank rule, `normalizeDateOrNull` reuse)
7. `src/lib/types.ts` — `Client` gains `soldDate`, `draftDate`, `paymentFrequency`
8. `src/integrations/supabase/types.ts` — surgical Row/Insert/Update additions for `clients` + `wins` new columns (full regen only after approved prod apply, per house precedent)
9. `src/components/contacts/AddClientModal.tsx` — D6 parity
10. `src/components/contacts/FullScreenContactView.tsx` — render/edit cases: `soldDate` (date), `draftDate` (date), `paymentFrequency` (select), **plus the missing `effectiveDate` case** (fixes the existing captured-but-invisible inconsistency); `issueDate` case kept for saved layouts
11. `src/lib/contactFieldLayout.ts` — default client order: `soldDate` replaces `issueDate`; adds `effectiveDate`, `draftDate`, `paymentFrequency`
12. `src/components/settings/ContactManagement.tsx` — STANDARD_FIELDS_CLIENT + CLIENT_OPTIONAL updates
13. `src/lib/contactRequiredFields.ts` — label/key entries for the new fields
14. Tests — update: `src/lib/__tests__/conversionContract.test.ts` (new pinned `p_client` shape; still never `premium_amount`/`organization_id`), `clientMapping.test.ts`, `contactFieldLayout.test.ts`; NEW: `src/components/contacts/__tests__/convertLeadModalPolicyFields.test.tsx` (today-default, edited dates persist, frequency enum, Zod rejection, cancel/success callback ordering unchanged); extend `supabase/tests/lead_conversion_integration.sql`
15. `WORK_LOG.md` — newest-first entry after ship; proposed AGENT_RULES §5 row (below) submitted for approval, not silently added

**Only with D4:** 16. `src/components/contacts/contactsTableConfig.ts` 17. `src/pages/Contacts.tsx` (`renderClientCell`) 18. `src/lib/contactsFilters.ts` + `contactsSort.test.ts` (and the two RPC re-creations inside the same migration)
**Only with D5:** 19. `src/components/layout/FloatingDialer.tsx` (one-line `soldDate` arg)

**Deliberately untouched:** DialerPage gating/telemetry (`handleConversionSuccess`/`handleConversionCancel`/`proceedSave*`, lock release, `pendingConversionAction`, `conversionSucceededRef` — the modal keeps its synchronous `onSuccess → onClose` ordering), all reporting RPCs/readers, anniversary widgets, workflow engine, Twilio/telephony, import pipeline (no client CSV import exists; documented as future work), `clients.issue_date`/`premium_amount` columns, RLS.

## 8. Reporting / dashboard impact — NONE (by design)

Every surface keeps its current source and date bucket: Leaderboard + Dialer trusted stats + goals/scorecards (`wins` by `created_at`), campaign card stats (`COUNT(wins)`, no date filter), Dashboard StatCards/DetailModal + agency-group leaderboard (`clients.created_at` — known-incorrect, untouched per its D1 hard-block), Reports (`calls.started_at`). `wins.sold_date` is written but read by nothing. Annualized Premium math untouched. Consequence to be aware of: a **backdated** Sold Date still counts in trusted "policies sold today" on the day it was recorded (that is today's behavior too — `wins.created_at`); moving reporting to business-date buckets is the documented future migration, not this task.

## 9. Policy anniversary impact — NONE

Anniversaries continue to derive **only from `clients.effective_date`** (widget 30-day, modal 90-day, merge token) — verified correct business meaning, so no change. Sold Date never feeds anniversaries. This is also why D2 recommends *not* auto-defaulting Effective = Sold.

## 10. Workflow / automation impact — data-ready, nothing built

No reminders/recurrence built (per task). `draft_date` (real `date`) + `payment_frequency` (controlled enum) give a future automation everything needed to advance drafts (+1/+3/+6/+12 months). No redundant schedule storage. Honest readiness note from inspection: the workflow engine **cannot currently trigger on client date columns at all** — `custom_date_approaching` scans `leads.custom_fields` only, time-based dispatches hardcode `contact_type:'lead'`, and the pg_cron jobs for the time-based evaluator were never scheduled in production. So there is no "minimal wiring" shortcut worth taking now; a draft-reminder workflow is a properly-scoped future task (new/extended trigger type + evaluator + cron scheduling).

## 11. Existing-record behavior

All new columns nullable; production has zero client/win rows, so no backfill exists even in principle. Historical/manual records legitimately lacking values stay NULL and render blank/`—` (Decision-D1 blank rule; never a fabricated value, never `created_at` substitution, **never deriving Sold Date from Effective or Issue Date**). `clients.issue_date` data (none today, but any future writes via API) is never destroyed or repurposed.

## 12. Verification plan

Local-only until approval (invariant #28): fresh **localhost** Supabase stack (locality proven) replaying baseline + M1–M3 + the new migration; extended `lead_conversion_integration.sql` proving sold/draft/frequency persist through the RPC, idempotent retry unchanged, invalid frequency rejected by CHECK. App gates: root `npx tsc --noEmit` (exit 0, reported-not-credited), `npx tsc -p tsconfig.app.json --noEmit` (error multiset identical to main's 73 baseline), focused Vitest suites (conversion/client-mapping/layout/new modal tests, fail-first where new), full Vitest, `npm run build`, ESLint parity on touched files, `git diff --check`. Manual browser matrix (local stack, synthetic data): the task's 14 scenarios — including Sold=Effective, Sold≠Effective, Draft later than Effective, all four frequencies, Dialer disposition-gated conversion (cancel saves/advances/releases nothing; success uses returned `clientId`, preserves win/campaign/org attribution), regular CRM conversion, legacy clients render blank-safe, dashboard/leaderboard totals unchanged, anniversaries still effective_date-driven, zero console errors. Production apply (if approved): `apply_migration` + advisors + types regen, each as separately-approved steps.

## 13. Proposed AGENT_RULES §5 addition (submitted for approval with the ship, not self-added)

> **Client policy schedule columns** — `clients.sold_date`/`draft_date` are `date`, `clients.payment_frequency` is CHECK-constrained (`monthly|quarterly|semi_annual|annual`). `sold_date` = business-effective sale date (editable; never derived from effective/issue date). `wins.sold_date` = business sale date stamped at win creation; **`wins.created_at` remains the sole reporting bucket** until a separately-approved semantics migration. `premium`/`wins.premium_amount` stay MONTHLY dollars regardless of `payment_frequency` (×12 annualization untouched). `clients.issue_date` is retired from default UI but preserved in storage/API.

---

## STOP — approval needed from Chris before any implementation

Please rule on **D1–D6** (recommendations inline above) and approve the plan + file list. Explicitly gated even after plan approval: applying the migration to production, any Edge/deploy action, and the AGENT_RULES addition.
