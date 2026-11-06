## Reports V2 review preparation — November 5, 2026 Pacific

Approved scope: local review branch only; no publication/PR/hosted execution until separately approved. Frozen source 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c. Independent reviewer/sign-off pending. Validate exact B6 hash 181e8b55e38f787fe3cf567d3b311ee3f56b92901ff9579e0668ed7beb597729 before unchanged read-only production execution. Build integrated 3.3.0 synthetic evidence using frozen harness. No settings, production writes or source changes.

Exact intended file list:

- `supabase/migrations/20261105120010_reports_v3_foundation.sql`
- `supabase/migrations/20261105120011_reports_v3_sale_facts.sql`
- `supabase/migrations/20261105120012_reports_v3_call_journey_helpers.sql`
- `supabase/migrations/20261105120013_reports_v3_appointment_facts_stub.sql`
- `supabase/migrations/20261105120014_reports_v3_state_helpers.sql`
- `supabase/migrations/20261105120015_reports_v3_readers.sql`
- `supabase/migrations/20261105120016_reports_v3_calls_campaign_lead_index.sql`
- `supabase/migrations/20261105120017_reports_v3_release_enable.sql`
- `supabase/migrations/20261105120020_policy_sale_premium_corrections.sql`
- `supabase/migrations/20261105120021_reports_v3_sale_premium_basis.sql`
- `supabase/migrations/20261105120022_reports_v3_release_enable_pkg_b.sql`
- `supabase/migrations/20261105120030_policy_sale_call_links.sql`
- `supabase/migrations/20261105120031_policy_sale_call_link_capture.sql`
- `supabase/migrations/20261105120032_reports_v3_sale_call_links.sql`
- `supabase/migrations/20261105120033_reports_v3_release_enable_pkg_c.sql`
- `supabase/migrations/20261105120040_appointment_type_categories.sql`
- `supabase/migrations/20261105120041_appointment_occurrence_evidence.sql`
- `supabase/migrations/20261105120042_policy_appointment_attributions.sql`
- `supabase/migrations/20261105120043_reports_v3_appointment_facts.sql`
- `supabase/migrations/20261105120044_reports_v3_release_enable_pkg_d.sql`
- `supabase/ops/appointment_type_category_baseline.sql`
- `supabase/migrations/rollback/20261105120043_reports_v3_appointment_facts.rollback.sql`
- `supabase/migrations/rollback/20261105120042_policy_appointment_attributions.rollback.sql`
- `supabase/migrations/rollback/20261105120041_appointment_occurrence_evidence.rollback.sql`
- `supabase/migrations/rollback/20261105120040_appointment_type_categories.rollback.sql`
- `supabase/migrations/rollback/20261105120032_reports_v3_sale_call_links.rollback.sql`
- `supabase/migrations/rollback/20261105120031_policy_sale_call_link_capture.rollback.sql`
- `supabase/migrations/rollback/20261105120020_policy_sale_premium_corrections.rollback.sql`
- `supabase/ops/reports_v3_disable.sql`
- `supabase/ops/reports_all_disable.sql`
- `supabase/ops/reports_v3_readback.sql`
- `supabase/ops/reports_v3_preflight.sql`
- `supabase/ops/appointment_type_category_baseline_revert.sql`
- `supabase/ops/reports_v3_enable.sql`
- `scripts/reports_release.py`
- `.github/workflows/reports-release.yml`
- `AGENT_RULES.md`
- `implementation_plan.md`
- `WORK_LOG.md`
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md`
- `docs/plans/2026-10-31-reports-v2/release-proposal.md`
- `docs/plans/2026-10-31-reports-v2/evidence/map-provenance.md`
- `docs/plans/2026-10-31-reports-v2/evidence/security-review-2026-11-06.md`
- `docs/plans/2026-10-31-reports-v2/evidence/release-readiness-2026-11-06.md`

Validation: root tsc, app typecheck, lint, build and existing relevant tests, comparing baseline failure identities. Record actual findings in focused release-readiness evidence.

# AgentFlow Reports V2: implementation plan, revision 2.1 (branch work approved with binding conditions)

**Date:** 2026-11-01 (UTC). Revision 2 was written 2026-10-31; revision 2.1 records Chris's 2026-11-01 review.
**Base:** `main` = `6e39c15ee638d2f553686bd3281a28449fe64af5`, re-fetched 2026-11-01 and unchanged.
**Migration versions (2026-11-04):** the placeholder versions in this plan and its appendices were renumbered on the branches from `202611010000NN` to `202611041200NN`, keeping their order and full suffixes, because the production head became `20261103191631`. This is the approved branch-only mapping; no hosted change was made. Historical records (the WORK_LOG, the frozen differential reference at `4236b8a`, and `evidence/`) keep the original names.
**Production migration head:** `20261029200000`, unchanged.
**Supabase project:** `jncvvsvckxhqgqvkppmj`
**Vercel project:** `agentflow`
**Branch:** `claude/great-goodall-911azc` (PKG-A). Per-package branches `claude/great-goodall-911azc-pkg-b`, `-pkg-c`, `-pkg-d` and `-pkg-f` are approved for B, C, D and F.

**Status: branch implementation approved, with binding conditions BC1–BC5 (§5.2).** Chris's 2026-11-01 message approved branch-only implementation of PKG-A, B, C, D and F from revision 2's reviewed file list. It is **not** blanket approval of the plan's defaults or of any AGENT_RULES text, and it grants **no production authority**.

**What revision 2.1 changes.** Only what the 2026-11-01 review requires:
- BC1–BC5 applied to the contract (§2.2 truth table, §2.9, §2.11, §2.12, §2.13), the proposed rule texts (§6), the decisions (§5), the tests (§10.1a) and the appendices;
- decisions ★2, ★3 and ★5–★9 recorded; ★1 and ★4 recorded as **pending** (a proposed design only);
- every AGENT_RULES text marked **proposed, not approved**.

**Not authorized:** production SQL or data mutation, migration application, protected-runner execution, production repair, RLS change, push to `main`, merge, deploy or settings change. **No push or draft PR** without separate authorization. A new path, a wider exception or an additional backend action needs a bounded change request and Chris's explicit approval first.

**Inputs.**
- Revision 1 plan and its appendices.
- Owner review of 2026-10-31, items R01–R11 (`review/review_R01_R11.md` in the package).
- Revision 1 cross-section corrections X1–X19.
- Chris's revision 2 branch-work review of 2026-11-01 (BC1–BC5 and the decisions in §5).

Discovery was not repeated.

---

## 0. Executive summary

### What changed in revision 2

- **Completion scope (R01).**
  - Reports V2 is complete only when PKG-A, B, C, D and F are all live.
  - Order: A → B → divergence manifest → C and D → F. Capture therefore starts before the page opens, and no stub is live at launch.
  - F has a protected preview from PKG-A onward. An earlier public release is only an explicitly approved partial release.
  - Tracked inbound sales get the smallest end-to-end integration, which needs **no TwilioContext change**.
- **Calls made (R02).**
  - Calls are split into confirmed attempts, proven non-attempts (3 refused admissions, which the webhook never dials) and unverified rows (9 with no admission record).
  - Only attempts count.
  - Four new v3 call readers replace the v2 projections, so the heatmap, trend, outcomes, breakdowns and map all reconcile to KPI 5. Old tabs keep v2.
- **Conversion KPIs (R03).** Cohort KPIs show the observed result to date with a compact *In progress* chip instead of a blank. Evidence status and maturity are separate fields.
- **Privacy (R04).** Unrelated identities never affect scoped results. Linked in-scope identities may change scoped results only through six named aggregate effects (E1–E6), and only on member-specific evidence (BC1). Tests run in both directions, and security review is on the actual code.
- **Privileges (R05).** Exact privilege classes and allowlists: creation, report enable, application RPC and revoke-only. A GRANT parser plus an inherited-privilege matrix enforce them.
- **AP corrections (R06).** The lifecycle is complete:
  - a correction is distinct from a later policy change;
  - the refresh behavior of every AP surface is specified, with no new polling;
  - the two divergent policies are classified in a reviewed manifest, with Sold Date reviewed separately.
- **Failure boundaries and recovery (R07, R09).**
  - The non-blocking guarantee is exact: cancellation aborts atomically and is never caught.
  - Capture is bounded, and appointment completeness is shown by reconciliation.
  - Selected links are recoverable after navigation or network failure.
- **Appointments (R08).** History is preserved through type deactivation and renames. Credit is a labelled proxy: the agent assigned at the appointment time.
- **History standard (R10).** It is now defined, and it uses lookback over all history, not only the selected period.
- **Consistency (R11).**
  - A complete metric/unit registry and truth tables.
  - Values are rounded exactly once.
  - The retyped-appointment finding is corrected (0 of 45).
  - Amendment texts land with the first PR that needs them.
  - All six appendices were edited to agree with the main plan.

### What the release delivers

All 23 KPIs on one Example 2 page. The table below gives the state at completion; §7 has the evidence behind it.

| State | KPIs |
|---|---|
| Fully available | 1, 2, 3, 4, 6, 10, 24, 25 |
| Implemented, with quantified historical limits | 5, 7, 8, 9, 11, 14, 19, 21, 34 |
| Implemented with forward-only capture (grow from capture start) | 12, 15, 16, 17, 18, 38 |

None is a stub at release.

### Approval recorded 2026-11-01: branch work only

1. **Branch implementation of PKG-A, B, C, D and F is approved** per the §8 file list (288 distinct paths): code, prepared and **unapplied** migrations, synthetic tests, the release runner, CI and the repository plan file.
   - PKG-A is built on `claude/great-goodall-911azc`; B, C, D and F on their approved per-package branches, with explicit shared-file ownership. A parallel branch never overwrites another package's changes.
   - C and D include the telephony-adjacent **branch** edits (DialerPage clauses (a) and (b), the sale modals, Calendar). The current `TwilioContext.tsx` is read first and stays unchanged.
2. **Binding conditions BC1–BC5** (§5.2) are added as tests and resolved in the affected package.
3. **Decisions** (§5.1): ★2, ★3, ★5, ★6, ★7, ★8 and ★9 are decided. ★1 and ★4 stay **pending**: only a clearly marked proposed design is built, in isolation. No security reviewer has been appointed, and the default disclosures are not recorded as accepted.
4. **AGENT_RULES texts (§6)** are **proposed, not approved**. Each needs Chris's explicit approval of its exact wording before it lands.

**Not authorized by this approval:** any production write, migration or runner stage; any push, draft PR, merge or deploy; any settings change; the category baseline write; any data repair. Each is a separate approval (§4.3).

## 1. Discovery findings (Phase 1, read-only)

Discovery (revision 1) ran 9 parallel read-only agents. Seven covered code areas; two ran aggregate-only production queries, each wrapped in `begin transaction read only; …; rollback;`. Nothing in the repo, production, GitHub or Vercel was changed. `git status` is clean at `6e39c15`.

### 1.1 Baseline and process

| Item | Finding |
| --- | --- |
| Base commit | `main` = `6e39c15ee638d2f553686bd3281a28449fe64af5`, identical to the brief baseline. Work branch `claude/great-goodall-911azc` is at the same commit. |
| Production migration head | `20261029200000` (352 recorded). Every report-related repo migration is recorded and byte-identical (md5 compared for 28 versions). |
| Stale docs | `20261021200000` (lead→client conversion preservation) **is applied**. Standard lead fields are applied as **`20261028040215`**, not `20261028120100`. The rules headers at `AGENT_RULES.md:582` and `:972` are stale. WORK_LOG.md was cut from 18,042 lines to ~424 by PR #499 (`c707bd7`); the earlier Reports release history is in `git show c707bd7^:WORK_LOG.md` and in `docs/plans/*/production-release.md`. |
| Version drift | 11–16 SMS/UV migration files have repo versions that differ from production. `supabase db push` is therefore unsafe; every release must use an explicit per-file route. |
| Overlapping work | Dashboard Polish V2 (#504), Premium Dashboard G3 (#502), commissions insights (#474), conversion preservation (#476), carrier selection (#479), AP-only Leaderboard (#475) and starter templates (#507) are **all merged**. No open PR touches Reports, sale, appointment, dialer or performance files. **Draft #486** (commission libs + unapplied migration `20261023180000`) overlaps the AP-correction consumers. |
| Release infrastructure | There is no Reports release workflow. Earlier Reports releases used MCP `apply_migration` inside a disable → change → guarded-enable window. The protected GitHub runner (check / apply-migration / record-history / rollback; main only; environment `google-sheets-production`, reviewer cgarness) handles exactly one migration. `main` has no branch protection. |
| CI | `reports-backend.yml` triggers only on migration names containing `reports`. `policy-sale-recording.yml` triggers only on `20261004000819`. The visual gate asserts 6 metrics and fixed first-screen budgets, with no 320 px, zoom or reduced-motion checks. |
| Checks at base | Root `tsc` passes but checks no files. App `tsc` has **80 pre-existing errors**, none in Reports (relevant: `AppointmentModal:237`, `ConvertLeadModal:182`, `TwilioContext` ×6). Reports Vitest: 28 files, 429 pass. Adjacent policy/performance/appointment suites: 18 files, 228 pass. Full Vitest: 6,687 pass, 2 fail, 11 failing files (9 need `VITE_SUPABASE_URL`, 1 known recording-retention check, 1 new clock-dependent failure in `dashboardMissedCalls`). ESLint on Reports: 0 problems. Vite build passes; the main chunk is 4.72 MB and Reports is imported eagerly. |
| Advisors baseline | Security 256 (ERROR 2 / WARN 213 / INFO 41); performance 462 (WARN 232 / INFO 230). `get_campaign_card_stats` and `super_admin_dashboard_snapshot` are anon-executable SECURITY DEFINER functions. They are pre-existing and out of scope, and noted only for the post-release advisor diff. |

### 1.2 Live report contract

- All **15 md5 pins** in `supabase/ops/reports_integrity_enable.sql` match live, including owner, SECURITY DEFINER, volatility and `search_path`.
- Exactly the **six `get_report_*_v2`** RPCs grant EXECUTE, to `authenticated` and `service_role`. Anon is denied on all 34 report functions.
- The four legacy `rpc_report_*` functions are **sealed**: no anon/authenticated/service_role EXECUTE and no PUBLIC ACL. They remain SECURITY DEFINER, VOLATILE, `search_path=public` and take `p_org_id`, so they must never be re-granted.
- **Hazards for any new reader:**
  1. The default ACL in `public` grants anon/authenticated/service_role EXECUTE on every new function.
  2. `reports_integrity_enable.sql` revokes every `get_report_%`/`report_%`/`rpc_report_%` and re-grants only the six v2 names. Running it after a v3 release would silently switch v3 off.
  3. `reports_disable.sql` names v1/v2 signatures only, so it would not disable v3.
  4. Twelve transitive helpers are **unpinned**: `report_window`, `report_meta`, `report_agent_name`, `report_visible_campaigns`, `report_policy_quality`, `report_policy_facts`, `report_policy_campaign_lineage`, `report_agency_time_zone`, `report_permission_flags`, `campaign_actor`, `resolve_downline_ids`, `profile_parse_iso_date`. `report_agency_time_zone` and `report_permission_flags` are shared with the performance/leaderboard readers.
- `report_layouts`, `saved_reports` and `scheduled_reports` have **0 rows** in production, so a layout v5 change carries no saved preferences to migrate.

### 1.3 Production data coverage (aggregates only, as of 2026-10-31 02:37 UTC)

Only **org A** (`a0000000-…-0001`, America/Los_Angeles) has real data. It is also the only org with `company_settings`. Org `525671d1` has 42 outbound calls whose `contact_id` points at org A leads (cross-tenant leftover); these must stay unresolved.

| Area | Live fact | Affected KPIs |
| --- | --- | --- |
| Policies | 35 wins = 35 policy identities = 35 stored policies (34 primary, 1 additional). 0 missing policy id / Sold Date / seller, 0 duplicates, 0 removed from the book, 0 `sold_date_proxy` entries. Original seller equals the current owner for all 35. | 1–4 |
| Premium | 29 wins have `premium_snapshot`, 6 do not, and 1 has a NULL premium. Two primary policies were edited after the sale (later client Sold Date and different premium). All-time AP is **$33,019.92 from sale events vs $34,686.72 from the current book**. October: 27 policies on both bases, $24,546.00 from sale events. The one additional-policy premium is stored as a JSON **number** (not the string assumed by #34). | 1, 4 |
| Calls | Org A: 8,367 outbound rows (8,355 confirmed attempts under revision 2, §1.5) and 239 inbound. **2,298 outbound (27.5%; 34% in October) have no contact and no campaign link.** `calls.lead_id` is never written. `attempt_id` exists only from 2026-10-05 18:16 UTC. 5 shared-SID groups (10 rows) are unreviewed and the duplicate map is empty. Skip receipts (15) never create call rows. | 5, 7, 11, 19, 21, 34 |
| Contacted | The live rule tests No Answer **before** duration > 45 s. That gives **521 contacted outbound calls** (204 in October); 205 calls over 45 s carry No Answer and do not count. A naive OR would give 726. | 6, 8, 10 |
| Unique prospects | The current reader's 417 includes **175 `call:<id>` fallbacks**. Only **233** are real tracked identities (October: 180 vs 114). | 7, 11 |
| Talk time | All rows before 2026-10-05 are `legacy_unknown`. **2,615 of 3,288** October provider durations are flagged conflict. | 24 |
| Sessions | 647 sessions: 3 stale-active and 15 late-ended, all handled by the heartbeat cap; 0 same-agent overlaps. | 25 |
| Sale ↔ call | **0 of 35** wins carry `call_id`, and dialer receipts never record a converted client. No sale can be linked to its producing call. | 38 |
| Lead lineage | 18 of 34 clients came from leads, and **0** of those source leads still exist (conversion deletes them). 6 have a `lead_conversion` snapshot and 9 have any receipt evidence (1 contradicts). 16 buyers were entered by hand with no calls or appointments. | 14, 19, 34 |
| Appointments | 134 (122 Sales Call, 12 Follow Up), **all Scheduled or Confirmed**: 0 Completed / No Show / Cancelled, and 128 past start with no outcome. 27 have no creator and 89 have no `booking_kind`. **Retyping (corrected in revision 2):** 0 of the 45 receipt-backed bookings changed type after booking. The earlier "2 changed" compared the 2 receipts that omit `type` with the default "Sales Call" that `persist_booking` stored. Retyping cannot be determined for the 89 legacy rows, which have no booking-time record. `type` is free text with no FK. `appointment_types` has no sales flag. | 12, 15–18 |
| Geography | 0 invalid states but 93 raw variants each in leads and campaign_leads. No state at event time on calls, wins or appointments. Mapped to a recorded state: **71.2% of outbound calls, 60.7% of contacted calls, 34 of 35 policies**. No AK, HI or DC records. `normalize_us_state` is IMMUTABLE (md5 `c80ff9ad…`) and passes unknown values through. | Regional |

### 1.4 Code-level facts that shape the design

- **Sales.** Each sale is one `public.wins` row written only by `private.insert_policy_sale`, called by 4 SECURITY DEFINER RPCs. `private.guard_policy_win` makes sale fields immutable for every role. Premium edits change only the client record, so Reports (current book) follows edits while Leaderboard, Dashboard, Goals, Group and Recent Wins (sale snapshot) do not. All performance AP goes through `private.performance_sale_monthly`.
- **Calls.** `report_call_facts` (pinned md5 `bacbfd06…`) forces contacted = false for every non-outbound call. Since 2026-10-03 a trigger owns `calls.contact_id`. Conversion re-points calls to the client and deletes the lead. Lineage survives only in `clients.lead_id` (not guarded), `private.dialer_conversion_lineage` (since 2026-10-03) and `clients.lead_conversion`.
- **Appointments.** All Dialer booking paths omit `type`, so `persist_booking` defaults it to Sales Call. The standalone Dialer callback is stored as kind `appointment`, type Sales Call, title "Callback"; rule #22 protects that writer. Google inbound sync overwrites linked rows to type Other and status Scheduled. Status is overwritten in place with no outcome timestamp or conducting agent.
- **Frontend.** `Reports.tsx` renders four fixed parts plus a registry of 38 ids frozen by `reportsRegistrySnapshot.test.ts` (`MAX_VISIBLE_STATS` = 6). There is no geo package; only recharts 2.15.4 is installed. The calling heatmap already matches §19 on the server (outbound, agency zone, Sunday-first, 168 cells). On the client it lacks keyboard/tap cell detail and a CSV rate column, and it uses an inline-style shade.
- **CSV golden.** The "74-file CSV golden" named in AGENT_RULES is **not in the repo**. What exists is a 61-file comparison procedure (`docs/plans/2026-10-11-ui-copy-cleanup-v2/evidence/csv-capture`), 13 recorded export hashes in `verify.mjs` and SHA pins in `reportsBasisText.test.ts`.

### 1.5 Targeted evidence added in revision 2 (read-only, 2026-10-31)

Every check below is a code read, a read-only Edge Function fetch, or an aggregate query in a rolled-back read-only transaction. No personal data was returned.

| Item | Finding | Used in |
|---|---|---|
| Base | `main` and the work branch are still `6e39c15`. The production head is still `20261029200000`. No new open PRs. VISION.md and WORK_LOG.md are unchanged since discovery | §13 |
| Call admission | `private.dialer_outbound_admissions` holds one row per admitted or refused call. `twilio-voice-webhook` returns empty TwiML (no `<Dial>`) unless `admit_twilio_outbound` returns `admitted = true`. This holds in the repository and in deployed version 60 (`ezbr 4291b340…`). Org A has 3,309 admission-required rows: 3,297 admitted (all with a parent SID; 3,285 with a provider duration SID), 3 refused for `lock_lost` (parent SID present, provider duration 0, no disposition), and 9 with no admission row (no SID, no provider duration, no recording, no disposition; dates 2026-10-13 to 10-29). That leaves 5,058 legacy rows | §2.10 |
| Inbound call identity | TwilioContext exposes `currentCall`, `callState` and `lastCallDirection`. Inbound browser legs carry the server-issued `af_call_row_id` in `customParameters`, and the exported pure helper `extractAfCallRowId` reads it. The FloatingDialer wrap-up keeps a call id only for outbound calls (`FloatingDialer.tsx:573`) | §2.15 |
| AP surfaces | Recent Wins renders `premiumSold`, the effective value. Dashboard records use `get_performance_details`, whose premium is effective. The raw-premium helpers in `leaderboardPremium.ts` and `AgentScorecardModal.tsx` have no importers. The Leaderboard polls every 30 s on visible tabs and its realtime channel hears only `wins` INSERT. The Dashboard refreshes only on load or Refresh | §2.14 |
| Appointments | No column records who held a meeting. `user_id` is the assignee. `updated_at` is server-maintained by `appointments_updated_at`. `appointment_types.is_active` exists | §2.12, §2.13 |
| Unlinked-call numbers | All 2,298 unlinked outbound calls carry `contact_phone`; 1,368 were placed after admission began. 1,817 dial numbers match no current lead, client, membership or recruit record. 110 of 2,062 leads have a matching unlinked call after creation (250 at any time); 1 of 34 clients after creation | §2.11 |


## 2. The frozen contract (normative; revision 2)

This section is the single source for every package, test and appendix. Revision 2 applies review items R01–R11 on top of the revision 1 corrections X1–X19. The appendices were edited to match this section. Where any text still disagreed, the appendix was corrected; there is no "main overrides appendix" rule left to rely on.

### 2.1 Readers (R4, R02)

**Common properties.**
- Every reader is `plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp`, owned by `postgres`.
- Every reader is created sealed and takes no organization, time-zone or `as_of` argument. `as_of = now()`.
- Windowed readers run three checks in order:
  1. `private.report_access_v2(p_requested_scope, p_agent_id)` → 42501. NULL never widens scope.
  2. `private.report_window` → 22023, then 55000.
  3. Compute.

**Nine v3 readers.** The new page requests only these.

| # | Reader | Contents | Panel key |
|---|---|---|---|
| 1 | `public.get_report_scope_v3(p_requested_scope text DEFAULT NULL)` | Scope gate (mirrors the scope_v2 fields) plus v3 meta | (page gate) |
| 2 | `public.get_report_summary_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL, p_requested_scope text DEFAULT NULL)` | KPIs 1–11, 24, 25, 34; `by_agent`; `production_by_date`; `call_population` | `summary` |
| 3 | `public.get_report_journey_v3(same four)` | KPIs 14, 19, 21, 38; `by_agent` | `journey` |
| 4 | `public.get_report_sales_appointments_v3(same four)` | KPIs 12, 15, 16, 17, 18; `by_agent` | `salesAppointments` |
| 5 | `public.get_report_state_breakdown_v3(same four)` | `metrics: []`; `modes`, `jurisdictions` (51), `unmapped` (6 reasons), `totals`, `call_population` (same counts as KPI 5) | `states` |
| 6 | **`public.get_report_call_volume_v3(same four)`** (new, R02) | Heatmap (168 zero-filled weekday × hour cells: `calls_made`, `contacted`), `by_date`, `by_hour`, `by_weekday`, `inbound_calls`, `call_population` | `volume` |
| 7 | **`public.get_report_disposition_breakdown_v3(same four)`** (new, R02) | Outcomes by disposition (key `none` = "No outcome recorded"), duration buckets, per-disposition deep dive, `call_population` | `dispositions` |
| 8 | **`public.get_report_campaign_calls_v3(same four)`** (new, R02) | Rows: Campaign, Type, Calls made, Contacted calls, contact-rate numerator/denominator. Campaign names come only through `private.report_visible_campaigns`. Two reconciliation rows follow: "Calls without a campaign" and "Other campaigns" (in-scope calls on campaigns the viewer cannot see; Calls made, Contacted calls and the rate counts only, with no name or type). Rows sum to KPI 5 | `campaigns` |
| 9 | **`public.get_report_lead_source_calls_v3(same four)`** (new, R02) | Rows: Source, New leads, Calls made, Contacted calls, contact-rate numerator/denominator, plus a "Not linked to a current lead" row. Call columns sum to KPI 5 | `leadSources` |

Readers 6–9 port the four v2 call readers. They return `metrics: []`, and their `call_population` block carries the evidence status. They differ from v2 in two ways:
- they read `private.report_v3_call_facts` with the R02 attempt classes;
- they return **call-only fields**: no policies, premium, `policies_in_period`, `*_attribution_unavailable`, `leads_dialed`, `contacted_leads` or `converted_leads`.

**Old tabs** (bundles built before PKG-F) keep calling the six v2 readers. Those readers are byte-identical, pinned and granted, and keep their v2 meaning. The new page never requests a v2 reader, and no number from one reader family is ever shown under the other's meaning.

**Payload meta** (`private.report_v3_envelope`):
- `basis_version: 'reports_v3'`;
- `contract_version` (from `report_v3_basis_flags()`: 3.0.0 at PKG-A, then a minor bump per package);
- `reader`, `scope`, `requested_scope`, `filter_agent_id`;
- `window` (verbatim `report_meta`);
- `as_of`, `agency_today`, `period_open`;
- `basis: {corrections, sale_call_links, appointment_evidence}`;
- `policy_basis: {source, credit, date, premium}`.

Zod accepts `^3\.\d+\.\d+$`. A change of meaning requires `_v4` names.

### 2.2 KPI envelope: evidence status and maturity are separate (R03, R11)

```
{ id, value,                                   // number | null
  status: 'available' | 'partial' | 'unavailable',   // evidence completeness of `value`
  reason: <registry code> | null,              // primary reason; null iff status = available
  numerator, denominator,                      // exact integers (or exact cents) where the KPI is a ratio or rate
  coverage: { eligible, assessable, unassessable, reasons: { <code>: int } } | null,
  maturity: null | { window_days: 30, state: 'complete' | 'in_progress',
                     members, pending, successes_to_date,
                     mature_members, mature_successes, fully_mature_on },
  detail: object | null }
```

**Rules.** `private.report_v3_metric` and the Zod superRefine in `reports-v3-schemas.ts` enforce the same rules. A violation raises P0001 and fails only that panel, closed.

1. **Status describes evidence; maturity describes pending outcomes.** They are independent. A KPI can be partial and in progress at the same time.
2. **unavailable** ⇒ `value` is null and `reason` is non-null. The reason is one of:
   - a config code;
   - a zero code, when the KPI's denominator (or, for count KPIs, its population) is genuinely empty and nothing is unassessable;
   - a coverage code, when the side that decides the value has no known items but has unknown ones: `coverage.assessable = 0`, or a known denominator of 0 with `coverage.unassessable > 0` (BC4).
3. **partial** ⇒ `value` is non-null and `reason` is a coverage code. Coverage is non-null with `unassessable > 0`, or a **window-level** condition applies. Window-level conditions are:
   - `outcome_capture_partial_period`: the window straddles capture start;
   - `capture_gap` for a disabled-capture interval, and for KPI 15 bookings whose capture failed. Such a booking is counted from its receipt or current row and classified like a legacy row; for KPIs 16–18, gap items stay unassessable;
   - `history_incomplete` from numberless unresolved calls (§2.11);
   - `legacy_booking_basis`: legacy-classified bookings are **counted**, with the basis disclosed. A window made only of legacy rows is therefore Partial, not unavailable.

   These allow Partial without per-item unassessable counts. A window-level condition's count lives in `coverage.reasons[<code>]`, with `coverage.unassessable` left at 0.
4. **available** ⇒ `value` is non-null, `reason` is null, and coverage is null or `unassessable = 0`.
5. **Values never erase evidence states.** A numerator of 0 over a positive denominator gives `value = 0` under whatever status the coverage implies. A count KPI on an empty window is `available 0` only when its evidence for the window is complete. For example, KPI 15 before PKG-D is `unavailable/evidence_not_captured`, not 0.
6. **Zero values come from complete evidence only (BC4).** Each KPI is judged on its own numerator and denominator, as defined in the truth table below. A genuinely complete zero numerator over a positive denominator is a valid 0. Missing numerator evidence is never turned into 0, and a zero denominator never yields a ratio.
7. **Maturity** applies only to the 30-day group KPIs 12, 18 and 19. The `maturity` block is present whenever the cohort has members, **including when the value is unavailable**, so known pending-outcome metadata is never discarded (BC4). The one exception is a config reason: no cohort is read (or, for `journey_scope_restricted`, none is disclosed), so the block is null.
   - Success means Sold Date − anchor agency date ∈ [0, 30].
   - A member matures at `private.report_v3_local_day_start(anchor + 31, tz)`. `pending` counts members not yet mature.
   - `state = 'in_progress'` iff `pending > 0`. `fully_mature_on` = max anchor + 31 (agency date).
   - **`value` is the observed result to date over the same assessable cohort.** Pending members stay in the denominator (18, 19) or the numerator (12), and no early successes are selected. A first-contact prospect who has not bought is a valid member: pending until mature, then a non-success.
   - `mature_members` and `mature_successes` count only members whose window has elapsed. They are never mixed with immature successes. This mature-only subset appears in details and in the CSV under its own column names, never as a second rate under the metric's name.
   - **Whole group.** `members`, `pending`, `mature_members` and `fully_mature_on` count every group member, assessable or not, so the block survives an unavailable value. `successes_to_date` and `mature_successes` count only verified successes. When unassessable members exist, the mature-only subset is therefore a lower bound, and the details say so (copy reviewed with the PKG-F preview).
   - **Block invariants** (enforced by `private.report_v3_metric` and Zod): `mature_members + pending = members`; `mature_successes ≤ successes_to_date`; for 18 and 19, `successes_to_date ≤ members` and `mature_successes ≤ mature_members` (12 counts policies, which can exceed members); `state = 'in_progress'` iff `pending > 0`; `fully_mature_on` is non-null.
   - ★2 is decided: observed-to-date is the primary value, with a compact In progress status and mature-only details on demand.
8. **Reason precedence.**
   - `reason` = the first applicable code in registry order (§2.3: config, then zero, then coverage).
   - `coverage.reasons` carries counts for every applicable coverage code.
9. **Coverage.** `assessable + unassessable = eligible`. Coverage describes the side whose unknown items decide the status (the "unknown" column below). Its population is defined in §2.4.
10. **Precision.** See §2.5. The server never pre-rounds a value that the client rounds again.
11. **No panel raises** on fixtures with unresolved identities, unverified calls, unresolved appointments, empty windows or open windows.

**Status truth table (BC4).** For each KPI, **N** is the numerator (or the count or sum) and **D** is the denominator. Each side has a known part and an unknown part (unassessable items that could change it). Every reader evaluates each KPI in this order and stops at the first match:
1. any applicable **config** code → `unavailable`;
2. **denominator** (ratios, percentages, medians):
   - D known = 0 and D unknown = 0 → `unavailable` with the zero code;
   - D known = 0 and D unknown > 0 → `unavailable` with the first applicable coverage code.
   - KPIs 1 and 4 override this when policies > 0 but no premium is usable: `premium_invalid` if any premium is invalid, else `premium_not_entered`;
3. **numerator** (and count or sum KPIs): N known = 0 and N unknown > 0 → `unavailable` with the first applicable coverage code. A fabricated exact zero is never shown;
4. any unknown part > 0, or a window-level condition (rule 3) → `partial`, with the value computed over the known parts;
5. otherwise `available`. A complete 0 is a valid value.

The maturity block is attached for 12, 18 and 19 whenever members > 0, whatever the status.

For 12, 17 and 18, gap and unclassified items are candidates that could be sales appointments. A zero code (`no_held_sales_appointments`, `no_due_sales_appointments`, `no_attributed_policies`) therefore needs no known item **and** no candidate; otherwise the first applicable coverage code is used (rule 2).

| KPI | N (numerator, count or sum) | D (denominator) | Unknown parts | Config codes | Zero code | Coverage codes |
|---|---|---|---|---|---|---|
| 1 AP | Σ usable premium × 12 | — | policies with missing or invalid premium | — | — (0 policies → available $0.00; policies > 0 with no usable premium → `premium_invalid` / `premium_not_entered`) | `premium_invalid`, `premium_missing` |
| 2, 3 | policies; distinct buyers | — | — | — | — (0 → available 0) | — |
| 4 | Σ usable premium × 12 | usable-premium policies | policies with missing or invalid premium | — | `no_policies_sold`; `premium_invalid` / `premium_not_entered` (override) | `premium_invalid`, `premium_missing` |
| 5 | attempts | — | unverified rows | — | — (0 attempts, 0 unverified → available 0) | `attempt_unverified` |
| 6 | contacted calls | — | — (unverified rows can never be contacted) | — | — (0 → available 0) | — |
| 7 | tracked identities reached | — | contacted calls without a tracked identity | — | — | `unlinked_contacted_calls` |
| 8 | contacted attempts | attempts | D: unverified rows | — | `no_calls_made` | `attempt_unverified` |
| 9 | attempts | policies | N: unverified rows | — | `no_policies_sold` (even with calls) | `attempt_unverified` |
| 10 | contacted calls | policies | — | — | `no_policies_sold` | — |
| 11 | tracked identities reached | policies | N: contacted calls without a tracked identity | — | `no_policies_sold` | `unlinked_contacted_calls` |
| 12 | held group members | policies attributed to resolved members | D: unresolved members; N: gap and unclassified items | `evidence_not_captured`, `classification_not_configured`, `outcome_capture_not_started`, `journey_scope_restricted` | `no_held_sales_appointments` (no members); `no_attributed_policies` (resolved members, no attributed policy, none unresolved) | `capture_gap`, `outcome_capture_partial_period`, `appointment_type_unclassified`, `attribution_unresolved` |
| 14 | median days, receipt → first sale | assessable first-time buyers | unassessable buyers (receipt or sale gates only, BC2) | `journey_scope_restricted` | `no_first_time_buyers` | `lead_receipt_unknown` (receipt unknown); `history_incomplete` (receipt contradicted or after the first sale, or first sale not assessable; **never** call history, phone changes or numberless calls, BC2) |
| 15 | bookings | — | unclassified bookings | `evidence_not_captured`, `classification_not_configured` | — (0 → available 0) | `capture_gap` and `legacy_booking_basis` (window-level, counted), `appointment_type_unclassified` |
| 16 | held occurrences | — | due occurrences without an outcome; gap and unclassified items | `evidence_not_captured`, `classification_not_configured`, `outcome_capture_not_started` | — (0 → available 0 only when every due outcome is resolved) | `capture_gap`, `outcome_capture_partial_period`, `appointment_type_unclassified`, `outcomes_unresolved` |
| 17 | held | resolved due occurrences | D: unresolved due occurrences; gap and unclassified items | as 16 | `no_due_sales_appointments` | as 16 |
| 18 | successes | assessable held members | D: unresolved members; gap and unclassified items | as 12 | `no_held_sales_appointments` | `capture_gap`, `outcome_capture_partial_period`, `appointment_type_unclassified`, `attribution_unresolved` |
| 19 | successes | assessable first-contact members, **including non-buyers** | D: unassessable members (BC2 gates) | `journey_scope_restricted` | `no_first_contacts` | `history_incomplete`, `lead_receipt_unknown` |
| 21 | median attempts through first contact | assessable first-contact members, including non-buyers | unassessable members (BC2 gates) | `journey_scope_restricted` | `no_first_contacts` | `history_incomplete`, `lead_receipt_unknown`, `attempt_unverified` |
| 24, 25 | seconds | — | — (quality only in `detail.quality`) | — | — (0 → available 0) | — |
| 34 | lead-stage attempts | lead identities | N: unverified lead-stage rows; D: calls not linked to a lead | — | `no_lead_calls` | `unlinked_calls_excluded`, `attempt_unverified` |
| 38 | Yes | Yes + No | D: Unclassified buyers | `sale_call_link_not_captured`, `journey_scope_restricted` | `no_first_time_buyers` | `sale_call_link_missing`, `history_incomplete` |

**Required truth-table cases (BC4).** These are shared by the SQL contract test, the Zod schema test, the tile test and the CSV test, and each row is asserted in all four:

| Scenario | Result |
|---|---|
| 0 confirmed calls, 0 unverified, 2 policies (complete) | KPI 9 = 0, available |
| 0 contacted calls, 2 policies (complete) | KPI 10 = 0, available |
| 0 prospects reached, complete identity coverage, 2 policies | KPI 11 = 0, available |
| Positive calls, 0 policies | KPI 9 unavailable, `no_policies_sold` |
| 0 confirmed calls, 3 unverified, 2 policies | KPI 9 unavailable, `attempt_unverified`; KPI 5 unavailable, `attempt_unverified` (never an exact 0) |
| 5 confirmed calls, 3 unverified, 2 policies | KPI 9 partial 2.5, `attempt_unverified` |
| 0 attempts, 0 unverified | KPI 8 unavailable, `no_calls_made`; KPI 5 available 0 |
| First-contact prospects, none bought, all mature | KPI 19 = 0.0 %, available, maturity complete |
| First-contact prospects, none bought, some pending | KPI 19 = 0.0 %, available, maturity in progress |
| KPI 12: every member unresolved | unavailable `attribution_unresolved`, maturity block kept |
| KPI 12: resolved members, no attributed policy, none unresolved | unavailable `no_attributed_policies`, maturity block kept |

`journey_scope_restricted` applies only under privacy options (c) and (b′) (★1). Before PKG-D, the stub returns `evidence_not_captured` for KPIs 12 and 15–18. Before PKG-C, KPI 38 is `sale_call_link_not_captured`. Neither state exists at completion.

### 2.3 Reason registry (closed, 29 codes; R2 + X2 + R02/R03/R08 changes)

Registry order is the precedence order. The codes live in three places, and `reportsV3ReasonRegistry.test.ts` asserts all three are equal:
- SQL: `private.report_v3_reason_codes()`;
- Zod: `REPORT_V3_REASON_CODES`;
- text: `Object.keys(REASON_NOTICES)` = `Object.keys(SHORT_CUES)` in `reports-v3-text.ts`.

The test finds the foundation migration by its `*_reports_v3_foundation.sql` suffix.

| # | Code | Kind | Short cue (tile) | Notice (details, CSV) | KPIs |
|---|---|---|---|---|---|
| 1 | `evidence_not_captured` | config | Not tracked yet | Not tracked yet | 12, 15–18 (before PKG-D) |
| 2 | `sale_call_link_not_captured` | config | Not tracked yet | Sale-call link not recorded yet | 38 (before PKG-C) |
| 3 | `classification_not_configured` | config | Not set up | Sales appointment type not set up | 12, 15–18 (only when no item in the window has a trustworthy classification and the org has no classified type) |
| 4 | `outcome_capture_not_started` | config | Not recorded | Appointment outcomes not recorded for this period | 12, 16, 17, 18 |
| 5 | `journey_scope_restricted` | config | Agency only | Available at agency scope | 12, 14, 18, 19, 21, 38 (privacy options c/b′ only) |
| 6 | `no_policies_sold` | zero | No policies | No policies sold in this period | 4, 9, 10, 11 |
| 7 | `no_calls_made` | zero | No calls | No calls made in this period | 8 |
| 8 | `no_lead_calls` | zero | No lead calls | No lead calls in this period | 34 |
| 9 | `no_first_time_buyers` | zero | No first-time buyers | No first-time buyers in this period | 14, 38 |
| 10 | `no_first_contacts` | zero | No first contacts | No first contacts in this period | 19, 21 |
| 11 | `no_due_sales_appointments` | zero | None due | No sales appointments due in this period | 17 |
| 12 | `no_held_sales_appointments` | zero | None completed | No completed sales appointments in this period | 12, 18 |
| 13 | `no_attributed_policies` | zero | No linked policies | No policies linked to these appointments | 12 |
| 14 | `premium_not_entered` | zero | Premium not entered | Premium not entered | 1, 4 |
| 15 | `capture_gap` | coverage | Partial | Some appointment changes were not recorded | 12, 15–18 |
| 16 | `outcome_capture_partial_period` | coverage | Partial | Outcomes recorded from {date} | 12, 16–18 |
| 17 | `appointment_type_unclassified` (new, R08) | coverage | Partial | {n} appointments with an unclassified type | 12, 15–18 |
| 18 | `outcomes_unresolved` | coverage | Partial | {n} due appointments without an outcome | 16, 17 |
| 19 | `attribution_unresolved` | coverage | Partial | {n} completed appointments not resolved | 12, 18 |
| 20 | `legacy_booking_basis` | coverage | Partial | Includes {n} bookings classified from older records | 15 |
| 21 | `attempt_unverified` (new, R02) | coverage | Partial | {n} calls not verified as dialed | 5, 8, 9, 21, 34 |
| 22 | `unlinked_contacted_calls` | coverage | Partial | {n} contacted calls without a tracked contact | 7, 11 |
| 23 | `unlinked_calls_excluded` | coverage | Partial | {n} calls not linked to a lead | 34 |
| 24 | `history_incomplete` | coverage | Partial | Based on {a} of {e} | 14, 19, 21, 38 |
| 25 | `lead_receipt_unknown` | coverage | Partial | {n} without a recorded lead start | 14, 19, 21 |
| 26 | `sale_call_link_missing` | coverage | Partial | {n} first-time buyers unclassified | 38 (after PKG-C) |
| 27 | `premium_invalid` | coverage | Partial | {n} premiums need review | 1, 4 |
| 28 | `premium_missing` | coverage | Partial | {n} policies missing premium | 1, 4 |
| 29 | `panel_not_loaded` | export | (none) | CSV row status; never emitted by SQL | CSV |

**Removed in revision 2** (folded into the rules above; they are no longer emitted):
- `window_in_progress`: maturity is no longer a reason;
- `no_assessable_buyers` and `not_enough_call_history`: the KPI now returns a coverage code with `assessable = 0`.

When a coverage code makes a KPI unavailable (assessable = 0), the tile cue is "Not enough data".

### 2.4 Metric and unit registry (exactly 23; R11)

There is one registry. SQL `private.report_v3_metric_registry()` (in …10) and `src/lib/reports-kpi-registry.ts` must be equal; a Vitest parses the foundation migration to check this. The registry drives denominator rules, units, precision, credit and date basis. It also defines which KPIs are percentages: **exactly 8, 17, 18, 19, 38**.

| ID | Label | Reader | Unit | Kind | Eligible population (coverage) | 30-day group | Credit | Date basis | Display | CSV |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Annual premium (AP) | summary | currency | sum (effective monthly × 12) | policies sold | no | original_seller | sold_date | formatPremium | 2 dp |
| 2 | Policies sold | summary | count | count | — | no | original_seller | sold_date | integer | integer |
| 3 | Clients who purchased | summary | count | distinct count | — | no | original_seller | sold_date | integer | integer |
| 4 | Average AP per policy | summary | currency | AP ÷ usable-premium policies | policies sold | no | original_seller | sold_date | formatPremium | 2 dp |
| 5 | Calls made | summary | calls | count of `attempt` rows | attempt + unverified rows | no | placing_agent | call_created_at | integer | integer |
| 6 | Contacted calls | summary | calls | count | — | no | placing_agent | call_created_at | integer | integer |
| 7 | Unique prospects reached | summary | people | distinct identities | contacted calls excluding recruit-resolved | no | placing_agent | call_created_at | integer | integer |
| 8 | Call contact rate | summary | percent | 6 ÷ 5 × 100 | as 5 | no | placing_agent | call_created_at | 1 dp | 1 dp |
| 9 | Calls per policy | summary | ratio | 5 ÷ 2 | as 5 | no | placing_agent_and_original_seller | call_created_at + sold_date | 1 dp | 2 dp |
| 10 | Contacted calls per policy | summary | ratio | 6 ÷ 2 | — | no | placing_agent_and_original_seller | call_created_at + sold_date | 1 dp | 2 dp |
| 11 | Prospects reached per policy | summary | ratio | 7 ÷ 2 | as 7 | no | placing_agent_and_original_seller | call_created_at + sold_date | 1 dp | 2 dp |
| 12 | Sales appointments per policy | sales_appointments | ratio | held group members ÷ attributed policies | held group members | **yes** | assigned_agent_at_start | occurrence_date | 1 dp | 2 dp |
| 14 | Days to first sale | journey | days | median | first-time buyers in period | no | original_seller | first_sale_date | 1 dp (".0" dropped) | 1 dp |
| 15 | Sales appointments booked | sales_appointments | bookings | count | bookings in period | no | setter | booking_created_at | integer | integer |
| 16 | Sales appointments completed | sales_appointments | appointments | count | due occurrences | no | assigned_agent_at_start | occurrence_date | integer | integer |
| 17 | Appointment show rate | sales_appointments | percent | held ÷ due × 100 | due occurrences | no | assigned_agent_at_start | occurrence_date | 1 dp | 1 dp |
| 18 | Appointment close rate | sales_appointments | percent | successes ÷ held × 100 | held group members | **yes** | assigned_agent_at_start | occurrence_date | 1 dp | 1 dp |
| 19 | Contact-to-sale rate | journey | percent | successes ÷ first contacts × 100 | first contacts in period | **yes** | first_contact_agent | first_contact_date | 1 dp | 1 dp |
| 21 | Calls to first contact | journey | attempts | median | first contacts in period | no | first_contact_agent | first_contact_date | 1 dp (".0" dropped) | 1 dp |
| 24 | Total talk time | summary | duration | sum of canonical seconds | — (quality in detail) | no | placing_agent | call_created_at | formatElapsed | integer seconds |
| 25 | Time in dialer | summary | duration | sum of clipped session seconds | — (quality in detail) | no | session_agent | session_interval | formatElapsed | integer seconds |
| 34 | Calls per lead | summary | ratio | lead-stage calls ÷ lead identities | lead-stage attempt + unverified rows | no | placing_agent | call_created_at | 1 dp | 2 dp |
| 38 | 1 Call Close | journey | percent | Yes ÷ (Yes + No) × 100 | first-time buyers in period | no | original_seller | first_sale_date | 1 dp | 1 dp |

**`by_agent` rows** have the shape `{agent_id, name, status, credit: {"<kpi id>": credit_basis}, metrics: [envelopes]}`.
- `credit_basis` ∈ {`original_seller`, `placing_agent`, `setter`, `assigned_agent_at_start`, `first_contact_agent`, `session_agent`, `placing_agent_and_original_seller`}. This applies X5, with R08 replacing `conducting_agent` and `responsible_agent`.
- Distinct-person KPIs (3, 7, 11, 19 and the lead identities in 34) are deduplicated again at scope level. A total is never a sum of rows.

**`production_by_date`** has one row per agency Sold Date: `{date, policies_sold, annual_premium, premium_known, premium_missing, premium_invalid}`.

**Standard `detail` fields** (X6). Consumers read exactly these names:

| KPI | Field | Contents |
|---|---|---|
| 1 | `unattributed_annual_premium` | agency scope only |
| 1 | `premium` | `{known, missing, invalid, legacy_record_fallback}` |
| 2 | `quality.unattributed_policies` | agency scope only |
| 2 | `stored_without_sale` | agency scope only |
| 5 | `call_population` | `{attempts, non_attempts, unverified, duplicates_excluded}` |
| 24 | `quality` | `{estimated, unknown, conflicting, inconsistent, provider_confirmed, duplicates_excluded}` (amendment `kpi24-quality-a1`) |
| 25 | `quality` | `{stale_capped, late_ended}` |
| 16, 17 | `due_outcomes` | `{due, resolved, unresolved}` |
| 12, 18 | `attribution` | `{members, resolved, unresolved}` |
| 12, 18 | `unresolved_breakdown` | `{unlinked_purchase, identity_unresolved}` |
| 12 | `policies` | `{attributed, unattributed_eligible}` |
| 15 | `basis_counts` | `{receipt, capture, legacy}`; mirrors `coverage.reasons.legacy_booking_basis` |
| 17 | `classes` | `{held, no_show, cancelled_at_or_after_start, unresolved}` |
| 12, 15–18 | `unattributed` | agency scope only; items with no creditable agent |
| 12, 15–18 | `capture` | `{outcomes_started_at, outcomes_started_on}` |
| 15 | `disclosures` | `{setter_from_assignee, writer_default_type, deleted_bookings_counted, legacy_callback_title_excluded, callback_signature_excluded, non_sales_excluded, unclassified_excluded, duplicates_excluded, retyped_after_booking}` |
| 14, 19, 21, 38 | `history` | `{assessable, unassessable_by: {lead_receipt_unknown, receipt_contradicted, possibly_related_unlinked_call, phone_changed, sold_before_receipt, imported_already_sold, hand_entered_client}, numberless_unresolved_calls}` |
| 14, 19, 21, 38 | `unresolved_activity` | in-scope credited unresolved calls within the members' lookback |
| 38 | `classification` | `{yes, no, unclassified}` |

### 2.5 Precision: round exactly once (R11)

- **Server.** It returns:
  - exact `numerator` and `denominator` for every ratio and percentage: integers, or cents for currency;
  - `value` computed at full precision, transported at most to 6 decimal places;
  - exact cents for sums of money;
  - exact `percentile_cont` results for medians;
  - integer seconds for durations.
- **Client display and CSV export.** Each rounds **once**, half-up, at its own precision (§2.4), using the single `roundHalfUp` exported by `src/lib/reports-kpi-format.ts` (PKG-F), which `buildKpiCoverageRows` also imports. It works:
  - from `numerator`/`denominator` with integer arithmetic: `roundHalfUp(n, d, k) = floor((2·n·10^k + d) / (2·d)) / 10^k`, using BigInt when the product exceeds 2^53;
  - for percentages, n is multiplied by 100 first;
  - medians and currency are rounded from the exact value.

  Display is never computed from the CSV value, and neither is computed from a pre-rounded server value.
- **Tests.**
  - (1249, 1000) → display 1.2, CSV 1.25. The old double rounding gave 1.3.
  - (9, 4) → 2.3.
  - (115, 100) → 1.2 (avoids the float trap).
  - (0, 5) → 0.0.
  - 1/3 as a percentage → 33.3.

### 2.6 Private helpers (frozen signatures)

All helpers are in `private`, SECURITY INVOKER, `search_path = pg_catalog, pg_temp`, created sealed, and pinned by md5(prosrc) in `reports_v3_enable.sql`.

| Helper | File | Contract |
|---|---|---|
| `report_v3_envelope(p_reader text, p_scope text, p_requested_scope text, p_filter_agent uuid, p_time_zone text, p_time_zone_source text, p_start_date date, p_end_date date, p_start_at timestamptz, p_end_at timestamptz) RETURNS jsonb` | …10 | meta, markers, basis flags |
| `report_v3_metric(p_id int, p_status text, p_value numeric, p_numerator numeric, p_denominator numeric, p_coverage jsonb, p_maturity jsonb, p_reason text, p_detail jsonb) RETURNS jsonb IMMUTABLE`; `report_v3_ratio` / `report_v3_rate(p_id int, p_num numeric, p_den numeric, p_coverage jsonb DEFAULT NULL, p_maturity jsonb DEFAULT NULL, p_reason text DEFAULT NULL, p_detail jsonb DEFAULT NULL)` | …10 | enforces §2.2; P0001 on violation; value unrounded (scale ≤ 6) |
| `report_v3_kpi_ids(p_reader text) RETURNS int[]`; `report_v3_reason_codes() RETURNS text[]`; `report_v3_metric_registry() RETURNS jsonb`; `report_v3_basis_flags() RETURNS jsonb` | …10 | registries; stub flags `{contract_version: '3.0.0', corrections: 'not_installed', sale_call_links: 'not_installed', appointment_evidence: 'not_installed'}`. The metric registry encodes each §2.4 row with fixed values (unit, kind, eligible population, credit, date basis, display, csv) that `src/lib/reports-kpi-registry.ts` mirrors exactly; an unknown reader raises P0001 |
| `report_v3_sold_window(p_start date, p_end date, p_agency_today date) RETURNS TABLE(sold_from date, sold_until date)` | …10 | half-open `(p_start, least(p_end, p_agency_today) + 1)`; raises 22023 if any date is NULL |
| `report_v3_evaluate(p_id int, p_config text, p_n_known numeric, p_d_known numeric, p_coverage jsonb) RETURNS jsonb IMMUTABLE` | …10 | Internal (D1, Batch 1). The §2.2 status truth table in one place; unknown parts come from `coverage.reasons` through each KPI's side map (N, D, ND, W) |
| `report_v3_total(p_id int, p_value numeric, p_coverage jsonb DEFAULT NULL, p_reason text DEFAULT NULL, p_detail jsonb DEFAULT NULL)`; `report_v3_median(p_id int, p_value numeric, p_members numeric, p_coverage jsonb DEFAULT NULL, p_reason text DEFAULT NULL, p_detail jsonb DEFAULT NULL)` | …10 | Internal builders (D1, Batch 1) for counts and sums, and for medians. With `report_v3_ratio` and `report_v3_rate` they are the only way readers build envelopes; `p_reason` accepts only an applicable config code |
| `report_v3_reason_kind(p_code text) RETURNS text`; `report_v3_kpi_codes() RETURNS jsonb` | …10 | Internal registries (D1, Batch 1): the kind of each code by registry position, and each KPI's config, zero and coverage codes with the coverage side |
| `report_v3_sale_premium(p_win public.wins, p_client numeric) RETURNS TABLE(monthly numeric, premium_source text, premium_state text, revision int)` | …11 | PKG-B stub; delegates to `performance_sale_monthly` |
| `report_v3_sale_facts(p_org uuid, p_agents uuid[], p_sold_from date, p_sold_until date)` | …11 | NULL bound = unbounded; returns `win_id, policy_id, buyer_id, seller_id, sold_date, created_at, recorded_at, event_time_source, monthly_premium, premium_source, premium_state ∈ {known, missing, invalid}, correction_revision`; **callers filter `recorded_at <= as_of`** |
| `report_v3_production`, `report_v3_production_kpis`, `report_v3_stored_without_sale` | …11 | internal to D2 |
| `report_v3_call_facts(p_org uuid, p_start timestamptz, p_end timestamptz)` | …12 | all agents; adds **`attempt_class ∈ {attempt, non_attempt, unverified}`** and `is_attempt := direction_class = 'outbound' AND attempt_class = 'attempt'` (§2.10); reviewed duplicates excluded first |
| `report_v3_contact_predicate`, `report_v3_local_day_start(p_day date, p_time_zone text)`, `report_v3_client_identity_key(p_org uuid, p_client_id uuid)`, `report_v3_contact_identity`, `report_v3_identity_receipts`, `report_v3_identity_numbers(p_org uuid, p_identity_keys text[])` (new, R10), `report_v3_first_sales(p_org uuid, p_as_of timestamptz)`, `report_v3_journey_facts`, `report_v3_sale_call_links(p_org uuid, p_as_of timestamptz) RETURNS TABLE(win_id uuid, call_id uuid, call_direction text, link_source text)` (stub: 0 rows) | …12 | D3; `first_sales` is D3's only |
| `report_v3_journey_rows(…)` and `report_v3_journey_facts_by(p_org uuid, p_agents uuid[], p_by_agent boolean, …)` (Batch 6, internal: one history pass; per-group counts from one member set); `report_v3_journey_members(p_org uuid, p_agents uuid[], p_time_zone text, p_start_at timestamptz, p_end_at timestamptz, p_sold_from date, p_sold_until date, p_as_of timestamptz)`; `report_v3_call_counts(p_org uuid, p_agents uuid[], p_start timestamptz, p_end timestamptz) RETURNS jsonb`; `report_v3_call_kpis(p_counts jsonb, p_policies numeric) RETURNS jsonb`; `report_v3_journey_kpis(p_facts jsonb) RETURNS jsonb` | …12 | Internal (D3, Batch 3). One internal row per journey member and KPI (never returned to a client); the call KPI counts for one scope; and the KPI 5–11, 34 and 14, 19, 21, 38 envelopes, built only through the foundation builders. `call_facts` also carries `could_qualify` and `phone_last10` for the journey gates; a number is exclusion evidence only |
| `report_v3_appointment_facts(p_org uuid, p_agents uuid[], p_roster uuid[], p_start_at timestamptz, p_end_at timestamptz, p_time_zone text, p_reader_as_of timestamptz) RETURNS jsonb STABLE` | …13 | stub: five envelopes `evidence_not_captured`; the reader passes `now()` (X1) |
| `report_v3_state_classify(p_raw text, OUT state_code text, OUT reason text)`; `report_v3_identity_states(p_org uuid, p_identity_keys text[])` | …14 | over the unchanged `public.normalize_us_state` |
| `report_v3_roster(p_org uuid, p_agent_ids uuid[], p_filter_agent uuid, p_credited uuid[])`; `report_v3_credit_map(p_reader text)`; `report_v3_agent_call_stats(p_org uuid, p_agents uuid[], p_start timestamptz, p_end timestamptz)`; `report_v3_session_quality(p_org uuid, p_start timestamptz, p_end timestamptz, p_agents uuid[])`; `report_v3_summary_metrics(p_production jsonb, p_calls jsonb, p_talk_seconds numeric, p_talk_quality jsonb, p_session_seconds numeric, p_session_quality jsonb)` | …15 | Internal (D1, Batch 5). The by_agent roster (§2.4 rule, as v2); the per-KPI credit map from the registry; per-agent call counts with `report_v3_call_counts`' exact keys plus the KPI 24 talk-time parts; the KPI 25 quality counts (`stale_capped`, `late_ended`); and the 14 summary envelopes in registry order, built only through the foundation builders |

### 2.7 Migrations by package (unique suffixes; X4)

All version numbers are placeholders. They are renumbered above the then-current production head (today `20261029200000`), keeping their order, in a filename-only commit before each backend merge.

| Package | Files, in order | Runner stages |
|---|---|---|
| PKG-A | …10 `reports_v3_foundation` (builders, registries, metric registry), …11 `reports_v3_sale_facts`, …12 `reports_v3_call_journey_helpers` (with attempt classes and identity numbers), …13 `reports_v3_appointment_facts_stub`, …14 `reports_v3_state_helpers` (with the private lineage index, transactional), …15 `reports_v3_readers` (**all nine** public readers), …16 `reports_v3_calls_campaign_lead_index` (CONCURRENTLY, its own stage), …17 `reports_v3_release_enable` | check → apply ×6 → apply-index-concurrently → **STOP: independent read-only verification** → apply-enable → read-back → record-history |
| PKG-B | …20 `policy_sale_premium_corrections` (ledger, guards, writers, guarded `performance_sale_monthly` switch, RPCs created sealed), …21 `reports_v3_sale_premium_basis` (stub and flags replacement at 3.1.0; W grants on the 2 PKG-B RPCs), …22 `reports_v3_release_enable_pkg_b` | check → **disable-v3** → …20 → …21 → apply-enable (…22) → read-back → advisors → record-history. Both …20 and …21 run inside the v3-only window (X19) |
| PKG-C | …30 `policy_sale_call_links` (`clients_lead_id_guard` first, then the link table and its guard), …31 `policy_sale_call_link_capture` (capture helper with function-level `SET lock_timeout = '100ms'`, failure table, `_v2` wrappers, retry RPC; W grants), …32 `reports_v3_sale_call_links` (stub and flags replacement), …33 `reports_v3_release_enable_pkg_c` | …30 → …31 → **disable-v3** → …32 → apply-enable (…33) → read-back → record-history |
| PKG-D | …40 `appointment_type_categories` (category, guard, audit of classification, rename and `is_active` changes), …41 `appointment_occurrence_evidence` (windows, occurrences, assignment and outcome events, gaps, non-blocking trigger with function-level `SET lock_timeout = '200ms'`, `record_appointment_outcome`; W grant), …42 `policy_appointment_attributions` (attributions; W grants), …43 `reports_v3_appointment_facts` (stub and flags replacement, with evidence reconciliation), …44 `reports_v3_release_enable_pkg_d` | …40 → (separately approved baseline ops script) → …41 → …42 → **disable-v3** → …43 → apply-enable (…44) → read-back → record-history |

- The byte check compares the **highest-version** `*_reports_v3_release_enable*.sql` with `supabase/ops/reports_v3_enable.sql`. Earlier release-enable files are checked against the sha256 constants in the runner.
- Whichever of PKG-C and PKG-D lands second regenerates the `report_v3_basis_flags` preimage.
- Because PKG-C and PKG-D release **before PKG-F** (§4), every v3-only window runs while v3 has no consumers.

**Indexes.**
- Transactional index creation is allowed only on private tables (D5's `report_v3_lineage_original_lead`).
- `report_v3_calls_org_campaign_lead ON public.calls(organization_id, campaign_lead_id, created_at)` is built CONCURRENTLY with `lock_timeout 2s` and an `indisvalid` check. A pre-existing invalid index refuses.

**Performance gate.** At 500k calls, 5k sales and 10k appointments per org, under `SET LOCAL statement_timeout = '8s'`:
- p95 ≤ 2 s for scope, summary, state, sales_appointments and the four call readers;
- p95 ≤ 4 s for journey.

The read-back fails on 57014 or on any reader above 4 s.

### 2.8 Privilege classes and exact allowlists (R05)

Every Reports V2 SQL file is assigned one class. The static test `reportsV3Contracts.test.ts` holds the file → class map and parses every GRANT. Each GRANT must be in that file's allowlist exactly, by function signature and role list. A GRANT that is missing, extra, broader or narrower fails the test.

| Class | Files | GRANTs allowed (nothing else) |
|---|---|---|
| **C: object creation** | …10–…16, …20, …30, …32, …40, …43, every rollback file | **None.** Each created function gets `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`. |
| **E: report enable** | `supabase/ops/reports_v3_enable.sql` and its byte copies …17, …22, …33, …44 | `GRANT EXECUTE … TO authenticated, service_role` on exactly the **15 report readers**: the 6 v2 readers (`get_report_scope_v2(text)`, `get_report_call_summary_v2`, `get_report_call_volume_v2`, `get_report_disposition_breakdown_v2`, `get_report_campaign_performance_v2`, `get_report_lead_source_performance_v2`; each `(date, date, uuid, text)` except scope) and the 9 v3 readers (§2.1). This preserves today's report contract (authenticated + service_role). It is preceded by a pattern REVOKE on every `get_report_%`, `private.report_%` and `rpc_report_%` from all four roles. |
| **W: application RPCs (not report readers)** | …21; …31; …41; …42; `supabase/ops/appointment_evidence_enable.sql` | `GRANT EXECUTE … TO authenticated` only, never service_role, anon or PUBLIC. …21: `correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)`, `get_client_policy_sale_premiums(uuid)`. …31: `record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid)`, `convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid)`, `retry_policy_sale_call_link(uuid)`, `get_policy_sale_call_link_status(uuid[])`. …41 and the evidence enable: `record_appointment_outcome(uuid, uuid, timestamptz, text)`. …42: `get_policy_appointment_links(uuid)`, `link_policy_appointment(uuid, uuid, uuid, timestamptz, text, text)`, `correct_policy_appointment_link(uuid, uuid, uuid, uuid, timestamptz, text)`. |
| **R: revoke-only and read-only ops** | `reports_v3_disable.sql`, `reports_all_disable.sql`, `appointment_evidence_disable.sql`, and every read-only script (`reports_v3_preflight.sql`, `reports_v3_readback.sql`, `reporting-accuracy/*`, `check_sale_correction_manifest.sql`, `appointment_evidence_preflight.sql`). The category baseline and revert scripts are data writes with no GRANT | None. REVOKE only, or no privilege statement at all. |

Rules that hold for every class:
- No GRANT to `anon` or `PUBLIC` anywhere.
- No GRANT on any `rpc_report_%` function, in any file or recovery path.
- The private helpers are never granted, and client roles never get USAGE on `private`.

**Effective-privilege test** (`reports_v3_security.sql` S1–S3, S15). It uses `has_function_privilege` for anon, authenticated, service_role and a fresh role that only inherits PUBLIC. A second fresh role is made a member of `authenticated` to check inherited grants. The expected matrix covers each state:
- enabled: report readers for authenticated and service_role; W functions for authenticated only;
- v3 disabled: v2 readers only, W unchanged;
- all disabled: no report reader;
- rolled back: every v3 object absent.

In every state, `rpc_report_*` is false for every role and the private helpers are false for every client role. The production read-back cannot create roles, so it checks the same matrix through catalog ACLs and the existing role memberships. The fresh-role and inherited-role cases run on the harness.

### 2.9 Privacy contract (R04)

**Definitions.**
- An identity is *in scope* for a payload when it has at least one event credited to an in-scope agent that enters any of that payload's populations.
- An identity is *unrelated* when it has no event credited to an in-scope agent at any time.
- Cross-organization rows are never read.

**S14a, unrelated identities.** Adding any activity on unrelated identities leaves every personal and team payload of every reader byte-identical apart from `as_of`. This covers, by out-of-scope agents:
- calls of every attempt class, contacted calls and unresolved calls;
- sales, appointments, outcomes and attributions;
- links and state changes.

The same holds when matching activity is added in another organization.

**BC1 additions to S14a.** These must also leave every personal and team value, status, coverage block and reason code unchanged; they may change only unfiltered agency-scope diagnostics:
- adding or removing an unrelated out-of-scope **numberless** unresolved call;
- adding or removing unrelated unresolved activity elsewhere in the organization while an in-scope person has a captured phone change.

Organization-wide unknown-history diagnostics appear only at authorized, unfiltered agency scope.

**S14b, linked in-scope identities.** Activity by out-of-scope agents on an in-scope identity may change a scoped payload **only** through these expressly listed aggregate effects. Each is subject to the option chosen in ★1.

| Effect | KPIs | What may change |
|---|---|---|
| E1 earlier contact or sale | 14, 19, 21, 38 | An earlier contact or sale by an out-of-scope agent removes the person from an in-scope first-contact or first-time-buyer population, or makes their 1 Call Close "No" |
| E2 earlier attempts | 21 | Out-of-scope outbound attempts before the person's first contact count in that person's attempt count |
| E3 purchase from anyone | 19, 18, 12 | A purchase from any seller within 30 days on the same identity counts as a success or an attributed policy. For 12 and 18, an eligible purchase that is not linked leaves the member unresolved, and one linked to another appointment resolves it as no sale |
| E4 recorded state | Regional | The in-scope event is grouped by the identity's current recorded state, whoever set it, including a campaign-membership copy reached through any same-org call on that identity (applies under every option) |
| E5 possibly related unlinked call | 19, 21, 38 coverage (never 14) | Member-specific evidence only. An unresolved call by any agent whose recorded number equals a number recorded for the in-scope member, placed before the member's anchor, makes that member unassessable for the KPIs whose gate it touches (§2.11): 19 only if the call could have qualified as a contact; 21 for any call; 38 only if it could have qualified before the linked sale call. A captured phone change on the member's own record counts the same way, whoever made it. Nothing is attributed to the person. Numberless calls and other members' activity are **not** E5 effects; they never change personal or team results (BC1) |
| E6 lead assignment | Lead-source breakdown "New leads" | New leads counts leads currently assigned to in-scope agents (the v2 rule, unchanged), so a reassignment by anyone changes it |

Never exposed in any option:
- row identities, phone numbers, timestamps or other agents' records;
- out-of-scope agents' names or rows (`by_agent` stays within scope);
- names or metadata of campaigns not visible to the viewer;
- an unattributed bucket below agency scope;
- cross-organization data.

Coverage counts and `unresolved_activity` count only in-scope credited items.

**Tests in both directions.**
1. For each of E1–E6, a fixture asserts the exact expected change and that nothing else changes: no new `by_agent` rows, no ids or names, no other KPI.
2. Removing the activity restores the original payload byte-identically.
3. A negative fixture covers out-of-scope activity of a kind not listed on an in-scope identity: calls after the anchor, appointments, purchases outside 30 days. The payload must stay unchanged.

**Filtered comparisons.** A viewer can difference adjacent windows or agent filters and so isolate one person's linked effect. Aggregation and minimum cohort sizes do not prevent this.
- Option (a) accepts that, for the effects above, within the viewer's own credited population.
- Option (b′) narrows it to whole agency months with n ≥ 5 but does not eliminate it.
- Option (c) removes E1–E3 and E5 below agency scope (E4 and E6 stay, because they are not journey effects).

★1 remains open. The linked-history design is developed only as a clearly marked **proposed** design, in isolation and with BC1/BC2 applied. Production acceptance of these disclosures and the named security review of the exact SQL are pending. No reviewer has been appointed.

**Review gate.** A named security reviewer reviews the actual SQL of every reader body and the permission test results (S1–S15, S14a/S14b) on the exact commit, before the reader bodies are frozen and before the PKG-A production approval. The sign-off is recorded in `production-release.md`. This plan is not that sign-off.

### 2.10 Calls made population (R02)

`report_v3_call_facts` classifies every outbound row after reviewed duplicates are excluded:

| Class | Rule | Evidence | Live (org A) |
|---|---|---|---|
| `attempt` | `dialer_admission_required = false` (pre-admission rows; brief §4: a missing provider id is not permission to exclude), **or** an admission row with `admitted = true` | Admission row and parent SID; 3,285 of 3,297 admitted rows also carry a provider duration SID | 5,058 legacy + 3,297 admitted = 8,355 |
| `non_attempt` | An admission row with `admitted = false` | The server refused. `twilio-voice-webhook` returns empty TwiML, with no `<Dial>`, whenever `admit_twilio_outbound` does not return `admitted = true`. This was verified in the repository and in the deployed version 60 (`ezbr 4291b340…`). Provider duration is 0 on the browser leg | 3 (`lock_lost`), 2026-10-12 → 10-20 |
| `unverified` | `dialer_admission_required = true` and **no** admission row | No provider SID, no provider duration, no recording, no disposition. A disposition is impossible without admission. The code implies no PSTN leg could be created, but the provider has not confirmed it | 9, 2026-10-13 → 10-29 |

- **Calls made and every call surface on the new page** use `attempt` only. That covers KPIs 5, 6, 8, 9, 10, 24 and 34, the call readers 6–9, the state map and journey attempt counts.
- **Non-attempts** are excluded as proven and disclosed on demand (`detail.call_population.non_attempts`). Their raw rows stay untouched.
- **Unverified rows** (default, ★3) are excluded from the value and shown as missing evidence: KPI 5 is `partial` with `attempt_unverified`, and coverage = {eligible: attempts + unverified, assessable: attempts, unassessable: unverified}.
  - KPIs 8, 9 and 34 inherit the code.
  - KPI 21 marks a member unassessable when an unverified linked call precedes the first contact.
  - KPIs 6, 10 and 24 are unaffected: unverified rows have duration 0 and no disposition, so they can never be contacted or add talk time.
  - Each call reader's `call_population` block carries the same counts, and its panel shows the compact Partial cue when `unverified > 0`.
  - Genuine failed attempts (admitted calls with status `failed`, `busy` or `no-answer`) stay counted.
- **Invariants** (per window and scope, same `as_of`):
  - KPI 5 = Σ heatmap.calls_made = Σ by_date = Σ by_hour = Σ disposition buckets = Σ campaign rows (including "Calls without a campaign" and "Other campaigns") = Σ lead-source call rows (including "Not linked") = state total.
  - KPI 6 = Σ heatmap.contacted.
  - v2 `calls_made` − v3 KPI 5 = non_attempts + unverified.
- **Other surfaces are unchanged.** Leaderboard, Dashboard, Trusted Dialer and old Reports tabs keep counting every outbound row. "How it's calculated" states the difference in one line. Aligning those surfaces is a separate optional proposal (§5, ★9) with an exact scope; it is not in this plan.

### 2.11 Journey history: metric-specific evidence gates (R10, BC1, BC2)

**Proposed design** (★4 is pending; developed in isolation with BC1/BC2 applied).

**Principles.**
- A gate makes a member unassessable for a **specific KPI**, and only on evidence specific to that member and that KPI. Activity unrelated to the member never changes personal or team results (BC1).
- A phone number is **exclusion evidence only**. It can mark a member unassessable when an unresolved call to one of that member's recorded numbers might belong to them. It never links identities, attributes a sale or deduplicates.
- The absence of a matching number does **not** prove complete history. "Assessable" means "no conflicting recorded evidence", not "complete history".
- Recorded numbers come from `private.report_v3_identity_numbers`: the member's current lead, client and campaign-membership numbers. The call's recorded number is `calls.contact_phone`; for admitted outbound calls since 2026-10-03 it is server-verified by `admit_twilio_outbound`. Unresolved **answered inbound** calls with a matching caller number count; unanswered inbound calls do not. Direction follows the pinned v2 `direction_class`.
- The lookback is the member's whole history before the anchor, not only the selected period.

**Gates by KPI.**

| KPI | Population | Member is unassessable when | Not a gate |
|---|---|---|---|
| 14 Days to first sale | First-time buyers whose first sale is in the period | The lead receipt is unknown or contradicted; the first sale is not assessable (`first_sales.assessable` false, or `sold_date_proxy`); or the receipt date is after the first Sold Date | Call history, unresolved calls, phone changes and missing call links: none of these alone erases a valid receipt-to-sale time |
| 19 Contact-to-sale rate | Prospects whose first qualifying contact is in the period, **including prospects who never buy** | Not lead-origin, or the receipt is unknown, contradicted or after the first contact. A possibly related unresolved call that **could have qualified as a contact** exists before the anchor: a recorded duration > 45 s, a qualifying disposition, or no recorded duration. A No Answer disposition is a non-contact at any duration. Or the member's own record shows a captured phone change before the anchor (`unassessable_by.phone_changed`) | Purchases (a non-buyer is pending until mature, then a non-success). Confirmed non-contact attempts |
| 21 Calls to first contact | As 19 | As 19. Also: **any** possibly related unresolved call before the anchor (the attempt count must be complete), or an unverified linked call before the anchor | Purchases |
| 38 1 Call Close | First-time buyers whose first sale is in the period | The first sale is not assessable. No explicit sale-call link → **Unclassified** (`sale_call_link_missing`). A possibly related unresolved call that could have qualified, or a captured phone change, before the linked call → **Unclassified** (`history_incomplete`): this is uncertainty, never an automatic No | A **confirmed** earlier unanswered or non-contact attempt does not disqualify a verified one-call close |

**1 Call Close classification** among assessable buyers:
- **Yes**: the first sale is explicitly linked to the member's first qualifying contacted call.
- **No**: a **confirmed** earlier qualifying contact exists.
- **Unclassified**: everything else (no link, or uncertain order).

**Numberless unresolved calls** (0 today) cannot be shown unrelated.
- At **unfiltered agency scope only**, they make KPIs 19, 21 and 38 `partial/history_incomplete` as a window-level condition. Their org-level count is `detail.history.numberless_unresolved_calls`.
- At personal and team scope, and with an agent filter, they have **no effect** (BC1).

**Phone changes.** A captured phone change is evidence about the member's own record. It applies to 19, 21 and 38 (never 14) and never depends on other activity in the organization (BC1). Changes before 2026-10-03 are undetectable; this is a disclosed residual.

**Synthetic checks (BC1/BC2), required before PKG-A freeze:**

| Fixture | Expected |
|---|---|
| Verified lead receipt Oct 1, first sale Oct 5, no recorded call | KPI 14 = 4 days. KPI 38 Unclassified (`sale_call_link_missing`) |
| First-contact prospect who never buys | In KPI 19's cohort (pending, then a non-success) and contributes to KPI 21 |
| Prior confirmed no-answer call, then a verified linked first qualifying contact that closes the sale | KPI 38 = Yes |
| Unrelated out-of-scope numberless call added or removed | Personal and team values, status, coverage and reasons unchanged; only agency diagnostics change |
| In-scope person with a captured phone change; unrelated unresolved activity added elsewhere | Personal and team results unchanged |
| Possibly related unresolved call (number match) before the anchor with duration 0 and No Answer | KPI 21 member unassessable; KPI 19 member still assessable |

**Live impact** (org A, aggregates, to be re-measured at preflight):
- All 2,298 unlinked outbound calls carry a number; 1,817 match no current record.
- 110 of 2,062 leads have a matching unlinked call after creation (250 at any time). Under the metric-specific gates, fewer are affected for 19 and 38, because only could-qualify calls count there.

### 2.12 Capture failure boundaries and recovery (R07, R09)

**Exact guarantee.** Capture runs inside the sale or booking transaction, in an exception block (savepoint). Any error **other than `QUERY_CANCELED` and `ASSERT_FAILURE`** is caught. The capture step rolls back to its savepoint, a failure or gap row is recorded where possible, and the core write commits. PL/pgSQL `OTHERS` excludes those two conditions by design.

A statement timeout or a cancel (`QUERY_CANCELED`, 57014) or an assertion failure aborts the **whole** statement atomically: no sale or booking, no link, no evidence. The caller receives the error, and the existing idempotent retry applies. No path reports a commit that did not happen, and cancellation is never caught.

**Bounding.**
- `private.capture_policy_sale_call_link` declares a function-level `SET lock_timeout = '100ms'`. The evidence trigger function declares `SET lock_timeout = '200ms'`. Lock waits therefore fail fast into the caught class (55P03) and do not consume the 8 s statement budget.
- Capture work is limited to primary-key or unique lookups and single-row inserts. Harness budget: p99 capture < 20 ms at gate scale.
- A function-level `SET` applies only while that function runs.

**PKG-C, producing-call link.**

| Outcome | Server | Client (`parseSaleResult`, Zod) |
|---|---|---|
| linked / already_linked | Link row, idempotent by (org, win_id) | none |
| rejected (validation) | No link | No retry; buyer Unclassified |
| capture_failed, recorded | Savepoint rolled back; `private.policy_sale_call_link_failures` row with call id and SQLSTATE, in its own savepoint | Bounded automatic retry from a **module-level** function (not tied to the modal's lifecycle; 3 attempts at 1 s, 4 s and 15 s) via `public.retry_policy_sale_call_link(p_win_id)`, which uses the server-recorded call id. If it still fails, a "Call link not saved · Retry" action appears in the policy section for the seller or an Admin. It appears only for wins with an open failure row, read after any reload through `public.get_policy_sale_call_link_status(p_win_ids uuid[])` (STABLE SECURITY DEFINER, seller/Admin authority, status only, no call details) |
| capture_failed, unrecorded (both writes failed) | WARNING; nothing persisted | Buyer Unclassified. A missing link is always Unclassified, never "No", so there is no false completeness |
| statement cancelled | Entire call rolled back | Error shown. `classifySaleError` treats 57014 as a rejection, so the modal returns to editing with the **same request id**, and a resubmission is idempotent (exactly once). A lost response uses the existing frozen replay. Either way the handoff part is idempotent and the link step runs again |

The sale's success state is never altered by any link outcome. Navigation or modal unmount does not lose an in-flight link, because the link step runs in the same server transaction as the sale.

**PKG-D, appointment evidence.**
- The trigger fires on every INSERT, UPDATE and DELETE of `public.appointments`. It appends one observation per write, holding the previous and new state, so a lost write is detectable even when a later write is captured. The performance gate covers this at 10k appointments per org.
- Errors in the non-blocking trigger (except the two uncaught conditions) write `private.appointment_evidence_capture_gaps` in a nested block.
- **Completeness is never inferred from the absence of gap rows.** Readers reconcile evidence against current `public.appointments` rows. `updated_at` is server-maintained by the existing `appointments_updated_at` BEFORE UPDATE trigger. A row is a `capture_gap` when:
  - its current state or `updated_at` differs from the last captured evidence;
  - it was created after capture start but has no booking evidence;
  - evidence says it exists but the row is gone with no deletion evidence.

  This covers several cases where both the evidence write and the gap-row write fail, **but not all of them** (BC5).
- **Detection depends on a durable source surviving** (BC5). The sources are: the current appointment row (state, `updated_at`, existence); a booking receipt (`private.booking_receipts`, written by `persist_booking` and `save_disposition_with_booking`); and earlier evidence rows.
  - **Known unobservable case:** an appointment inserted and then deleted while both capture paths failed, written by a writer that leaves no receipt (a direct Calendar insert or a Google inbound-sync insert), leaves no trace. That limit is documented and disclosed ("Appointments created and removed while capture was failing cannot be detected"). It is never claimed as detected.
  - No new tracking subsystem is added to close it.
- **PKG-D test gate (BC5).** Insert, update and delete sequences run with both capture and gap logging forced to fail, for each supported writer: `persist_booking`, `save_disposition_with_booking`, Calendar UI insert, update and delete, and Google inbound sync. They include create-then-delete with no current row left, and later successful writes after a failed capture. Each case asserts the durable source that detects it, or asserts the documented unobservable limit.
- `record_appointment_outcome` is evidence-first and fails closed.

**PKG-D, closing-appointment attributions.**
- They are sent after the sale commits: `link_policy_appointment(p_request_id, p_win_id, p_appointment_id, p_occurrence_start, p_declaration, p_source)` with one stable request id per selection. Calls are idempotent by (org, request_id, win_id), so one request id covers a multi-policy sale.
- The call starts from `sendPreparedSale` in `src/lib/policySaleRecording.ts` through `appointmentLinkRetry.onSaleSaved(saleRequestId, winIds)`. That shared file is owned by PKG-C, with PKG-D contributing; the second package to land rebases.
- The call is made from a module-level function with the same bounded retry.
- On final failure, a global toast that survives navigation says "Sale saved. Closing appointment not linked — Retry", using the same request id.
- Later explicit linking stays available from the appointment outcome panel and the policy section.
- A missing link leaves the member unresolved (`attribution_unresolved`). It never counts as a failed appointment.

**Tests** (multi-session node-postgres on PG 17.6, plus Vitest):

| Test | Scenario | Expected |
|---|---|---|
| T-LOCK | Another session holds the conflicting lock | 55P03 caught; core commits; failure or gap row written |
| T-CANCEL | Harness-only slow capture body plus `statement_timeout` or `pg_cancel_backend` | Whole statement rolled back; no partial rows; 57014 returned; replay commits exactly once |
| T-REPLAY | Lost response | Same request id: one sale, one link |
| T-DOUBLE | Capture and failure/gap write both fail | Core commits; WARNING; link → Unclassified; appointment → `capture_gap` via reconciliation |
| T-ASSERT | Assertion failure | Propagates |
| T-UNMOUNT | Navigation or unmount during an in-flight link or retry; network failure | As specified above |
| T-RECOVER | Retry after reload from the policy section | Link saved |

### 2.13 Sales Appointment classification and credit (R08)

- **Classification is preserved history.**
  - Every booking and occurrence evidence row snapshots the type's `business_category` at booking, and at each later human retype.
  - Deactivating (`is_active = false`), renaming or reclassifying a type later never changes stored snapshots.
  - Pre-capture legacy rows resolve their category from the **audited category history** of the type that carried that name at booking time. …40 audits classification, rename and `is_active` changes. Before the first classification, the D-C1 first-classification rule applies (audited).
- **The configuration overlay is narrowed.**
  - `classification_not_configured` applies only when no item in the window has a trustworthy category **and** the organization has no classified type.
  - Otherwise, items whose category is unclassified are unassessable (`appointment_type_unclassified`, partial), and every other item counts normally.
- **Credit is a documented proxy, not proof.**
  - KPIs 12, 16, 17 and 18 credit `assigned_agent_at_start`: the appointment's assignee (`appointments.user_id`) in effect at the occurrence's scheduled start.
  - It is derived from captured assignment events, because the evidence trigger records every `user_id` change.
  - It is labelled "Assigned agent at the appointment time". AgentFlow does not record who actually attended.
  - **When no trustworthy assignee was in effect at the scheduled start, no individual is credited (BC3).** The item stays in valid agency totals, counted in `detail.unattributed` at agency scope only. The booking creator is **never** substituted. The preflight counts the NULL-assignee rows. KPI 15 keeps its separately defined setter credit.
  - A late outcome entry stores `recorded_by` separately and never moves credit.
  - KPI 15 keeps setter credit (creator, else the assignee at booking, disclosed as `setter_from_assignee`).
- **Tests.**
  - Missing assignee at start: no individual credit; the item counts only in agency totals (`detail.unattributed`), never under the creator (BC3).
  - Reassignment before start: credit goes to the new assignee.
  - Reassignment after start: credit stays with the assignee at start.
  - Late outcome by another user: credit unchanged, `recorded_by` stored.
  - Type deactivated or renamed after booking: history unchanged.
  - An unclassified custom type: the KPI is partial, not all five unavailable.
  - Organization with no classified type and no classified evidence: `classification_not_configured`.

### 2.14 AP correction lifecycle (R06)

1. **Two kinds of premium change.**
   - A *correction* fixes an entry error in the original sale. It goes only through **Correct sale premium**, which writes `public.correct_policy_sale_premium` (a ledger revision). It restates that sale's AP on its original seller and Sold Date everywhere performance and Reports V2 read.
   - A *later policy change* goes through the existing edit paths (Edit Client premium, additional-policy edits). It updates the current policy record only. It moves v2 book readers and the commission basis as today. It does **not** move sale AP, with one existing #40 exception: a legacy primary sale with `premium_snapshot = false` and no event amount is defined by its current primary premium (`legacy_record_fallback`; 1 sale today).
     - That sale's AP follows book edits until an Admin records a correction.
     - For `legacy_record_fallback` sales only, the correction RPC accepts a revision equal to the current amount (`freeze`, an exception to `no_change`). The sale then stops following the book.
     - How it's calculated shows "1 older sale uses its current policy premium" while that count is > 0.
   - Edit paths are unchanged and never write the ledger.
   - The policy section shows "Sale premium $X/mo (as sold)" next to the current premium when they differ, plus a "Corrected" badge when a revision exists. Admins see "Correct sale premium". There is no new prompt in edit forms.
2. **Permission (proposed default, ★5).** Admin or Super Admin, home organization only (`private.campaign_actor()`). Agents and Team Leaders get 42501. This was not previously approved.
3. **Refresh** (no new polling or realtime):
   - **Same tab:** success invalidates `['policy-sale-premiums', clientId]` and `['policy-commissions']`. Saved commission rows are never touched.
   - **Reports V2:** loads on mount; open tabs update on filter change or Refresh (no polling, by design).
   - **Leaderboard and TV:** the existing 30 s poll on visible, online tabs (`LEADERBOARD_POLL_DEFAULT_MS`). The realtime channel hears only `wins` INSERT, and a correction inserts no win.
   - **Dashboard** (stat cards, Goal progress, Leaderboard widget, records modal): on load or the existing Refresh (no automatic refresh by design).
   - **Recent Wins** renders `premiumSold`, the effective × 12, from `get_leaderboard_recent_wins` (`RecentWinsPanel.tsx:169-241`). The raw `premium_amount` stays in that payload for compatibility and is **never rendered**; a new test pins this.
   - **Dashboard policies-sold records** use `get_performance_details`, whose `premium_amount` is already `performance_sale_monthly`, so they show the effective amount after the switch.
   - **Not live:** `leaderboardPremium.ts`'s raw helpers and `AgentScorecardModal.tsx` read `wins.premium_amount` directly but have **no importers**. A static test keeps it that way.
   - **Copy on success:** "Sale premium corrected. Performance totals show the new amount on their next refresh." It names no surface. Old v2 Reports tabs read the book and never show corrections.
4. **Visible verification for every affected surface.**
   - SQL harness: `consumer_consistency_after_correction` checks Leaderboard snapshot, org stats, performance summary and details, recent wins, Reports v3 KPI 1/4, `by_agent`, `production_by_date` and state AP.
   - Component harness (PKG-B): before/after payloads from the synthetic database render the Leaderboard row, the Dashboard AP card and Goal progress, and Recent Wins (`correctedPremiumSurfaces.test.tsx`).
   - Browser harness (PKG-F): Reports KPI 1/4, the production trend and state AP.
   - Production: no test data. If a real correction is made at B6 (the manifest step), a read-only aggregate check confirms each server payload for that period, and Chris checks the screens after their refresh.
5. **Two-policy classification: the evidence source.**
   - A reviewed manifest, `docs/plans/2026-10-31-reports-v2/evidence/sale-book-divergence.md`, is committed through a reviewed PR. For each policy_id it records:
     - a **premium classification** ∈ {entry_error, genuine_later_change};
     - a **Sold Date classification** ∈ {entry_error, genuine_later_change}, reviewed independently and never inferred from the premium;
     - decided_by, decided_at, and the ledger `request_id` for each premium correction (the correction result and the Admin history return it);
     - for a Sold Date `entry_error`, either the separately scoped correction or Chris's recorded acceptance.
   - Gate check: Chris approves the manifest PR, and the read-only `check_sale_correction_manifest.sql` confirms a real ledger revision exists for every premium `entry_error` win. No database count is invented for `genuine_later_change`, whose record is the reviewed manifest.
   - A Sold Date `entry_error` blocks completion until either a separately scoped Sold Date correction package ships or Chris records an explicit acceptance to release with the disclosed difference.

### 2.15 Tracked inbound sales (R01; no TwilioContext change)

**Investigation (read-only).**
- `TwilioContext` already publishes the Voice SDK `currentCall`, `callState` and `lastCallDirection`.
- An inbound browser leg carries the server-issued exact row id in `currentCall.customParameters` (`af_call_row_id`, set by TwiML `<Parameter>`). The exported pure helper `extractAfCallRowId` (`src/lib/inboundCallOwnership.ts:26`) reads it.
- The FloatingDialer wrap-up keeps a call id only for outbound calls (`setCurrentCallId` after `makeCall`, `FloatingDialer.tsx:573`). An inbound sale therefore has no call id on any current UI path.

**Smallest integration (IN-A, PKG-C, owner decision ★6).**
- New hook `useActiveInboundCallRow` reads only the public context values. While an inbound call is active it captures `extractAfCallRowId(currentCall.customParameters)`.
- It keeps the id in a module-level store `recentTrackedCall`, keyed by row id. The store holds the id for 30 minutes after the call ends and is cleared on sign-out or organization change.
- **The hook runs for the whole signed-in session.** A new null-rendering `TrackedCallObserver` is mounted once in `src/components/layout/AppLayout.tsx` (72 lines, inside `TwilioProvider`), next to `FloatingDialer` and under the same `!isImpersonating` condition. A call is therefore captured even when no sale modal is open during it.
- New `SaleSourceCallChip` is mounted in `RecordPolicyModal` and `ConvertLeadModal` when no `sourceCallId` prop was given:
  - **during** an active inbound call, the call is attached automatically and shown as a removable chip (the same rule as the Dialer's automatic `currentCallId`);
  - **after** the call ends, within 30 minutes, it is offered **unselected** as a one-tap "Sold on the call with {caller} at {time}".
- The server validates every call id. For inbound: same organization, `agent_id = auth.uid()` (claimed), `voicemail_id IS NULL`, the call identity equals the buyer identity, and the call is within 24 h of the sale.
- **★6 (decided):**
  - The selected source call is **frozen with the sale submission**: it is part of the frozen prepared sale and reused unchanged on every retry.
  - The store is cleared on sign-out and organization change.
  - The most recent call is **never** substituted for the selected one.
- No calls-row write, no TwilioContext edit and no change to call initiation, audio or guards. The #9 re-entrancy refs are untouched. `dialerPageReportsV2Exceptions.test.ts` also pins `TwilioContext.tsx` byte-identical to base.

**Without IN-A,** inbound-origin buyers stay Unclassified for 1 Call Close. That would be a documented limitation of the completed release and needs Chris's explicit acceptance. Forwarded-to-mobile answers have no browser leg and stay Unclassified. The outside-sales declaration field stays deferred.

### 2.16 Page presentation (brief §18; R11 UX)

- **Section order (brief §18, exactly):**
  1. Production (1–4).
  2. Activity and sales effort: highlights 9, 10, 12, 38; the single Period averages line; the compact activity strip (default 5, 6, 7, 8, 15); expandable "More metrics" for 11, 14, 16, 17, 18, 19, 21, 24, 25, 34.
  3. Trends and call outcomes.
  4. Agent performance.
  5. Regional performance.
  6. Calling heatmap.
  7. Detailed breakdowns.

  The header and filters sit above section 1. Revision 1's main-plan summary listed this order wrongly; D6 was already correct.
- **Tiles stay compact.** A tile shows its value, or "—" when unavailable. It carries at most two chips: a status chip ("Partial") and a maturity chip ("In progress"). An unavailable tile shows its short cue (§2.3) instead of a chip. Notices, a/e counts, pending counts, "Fully mature on" and the mature-only subset are **on demand**: the chip opens a compact accessible disclosure, and the same lines appear in How it's calculated → Coverage in this report. There is no sentence under every tile. Status is never conveyed by colour alone.
- **CSV.** One `buildKpiCoverageRows` writes 21 columns: Metric ID, Metric, Status, In progress, Value, Unit, Numerator, Denominator, Eligible, Assessable, Unassessable, Reason, Basis, Date basis, Credit, Window days, Members, Pending, Mature members, Mature successes, Fully mature on.
  - Basis is `observed_to_date` for 12, 18 and 19, and `period` for every other KPI.
  - In progress is `yes` or `no` for 12, 18 and 19, and blank otherwise.
  - The maturity columns are blank for KPIs other than 12, 18 and 19.
  - Each value is rounded once (§2.5).
  - **No page CSV stays byte-identical**, because the call CSVs now use the v3 attempt population. The CSV golden classifies them as approved-changed.


## 3. R01–R11: how each review item is resolved

| Item | Resolution | Where | Disagreement or clarification |
|---|---|---|---|
| **R01** Completion scope | A, B, C, D and F are all in the completion gate. Order is A → B → manifest → C and D → F, so capture runs before the page opens. F has a protected preview from PKG-A onward. An earlier public F is only an explicitly approved, labelled partial release. Inbound: a read-only investigation found an exact server-issued row id already exposed by TwilioContext's public `currentCall`. The proposed integration IN-A uses it with **no TwilioContext change**: one session-wide observer mounted in `AppLayout`, plus a chip in the sale modals. It is server-validated and covered by UI tests, not only a classifier test. The outside-sales field stays deferred. | §2.15, §4 | None. |
| **R02** Calls made | Three evidence classes: `attempt` (legacy or admitted), `non_attempt` (admission refused, so no `<Dial>`; verified in the repository and the deployed webhook), and `unverified` (no admission row; 9 rows; not treated as proof). Calls made counts attempts only. Non-attempts are excluded and disclosed; unverified rows are excluded and shown as Partial (`attempt_unverified`). Raw rows are untouched and real failed attempts stay counted. Four v3 call readers replace the v2 projections, so every new-page call surface reconciles to KPI 5. Old tabs keep v2. Cross-surface alignment is a separate optional scope (★9). | §2.1, §2.10 | How to treat the 9 unverified rows is ★3. The default excludes them from the value and marks the KPI Partial. |
| **R03** Conversion window | Evidence status and maturity are separate fields. Cohort KPIs (12, 18, 19) show the **observed result to date** over the same assessable cohort, with pending members in the denominator. They carry an *In progress* chip, with pending count, "Fully mature on" and a separately labelled mature-only subset available on demand. Zero denominators still give no ratio. One rule covers UI, CSV and numerator/denominator. | §2.2, §2.16 | The presentation choice is ★2 (observed to date recommended; mature-only is the alternative). |
| **R04** Privacy | S14a: unrelated identities never affect scoped payloads. S14b: on linked in-scope identities, only the listed aggregate effects E1–E6 may change a payload. Tests run in both directions, including a negative fixture. Identities, other agents' records, hidden campaign metadata and cross-org data are never exposed. The plan states that differencing filtered results is not prevented by aggregation. The review gate is on the actual SQL and test results, and no sign-off is claimed. | §2.9 | The option and its accepted effects are ★1. |
| **R05** Privileges | Four classes with exact allowlists. **C** creation: no GRANT. **E** report enable: 15 readers to authenticated and service_role, preserving today's contract. **W** application RPCs: listed functions to authenticated only. **R** revoke-only. A static GRANT parser enforces the file → class map, and an effective- and inherited-privilege matrix runs in every enable state. `rpc_report_*` is never granted. | §2.8, A-41 | None. |
| **R06** AP lifecycle | Correction (entry error, Admin RPC) is separated from later policy change (existing edits, book only). The policy section shows sale versus current premium. Refresh needs no new polling or realtime: Leaderboard 30 s poll on visible tabs, Dashboard on load or Refresh, Reports on mount or Refresh, same-tab cache invalidation. Visible verification is defined for each surface. The two policies are classified in a reviewed manifest, with premium and Sold Date separate, checked against real ledger rows; a Sold Date entry error blocks completion unless separately resolved. | §2.14 | Recent Wins already renders the effective `premiumSold`; raw `premium_amount` is in the payload but never shown, and a test now pins that. Two client paths that read raw premium have no importers. Admin-only correction is ★5. |
| **R07** Non-blocking claim | The guarantee is now exact. Errors other than QUERY_CANCELED and ASSERT_FAILURE are isolated; cancellation or timeout aborts the whole write atomically and is retried idempotently. Capture is bounded by function-level `lock_timeout`. Tests cover lock timeout, cancellation, replay, double failure and assertion failure. Appointment completeness comes from reconciling evidence against current rows (server-maintained `updated_at`, one observation per write), never from the absence of gap rows. | §2.12, A-10, A-618 | None. Cancellation is not caught. The recoverable mechanism is the failure record plus the retry RPC. |
| **R08** Appointment history and credit | Category snapshots at booking. Audited history covers classification, rename and deactivation. The overlay is narrowed, so only items without a trustworthy category are unassessable. Credit is `assigned_agent_at_start`, a documented proxy (falling back to the booking's creator, disclosed), and late outcome entry never moves credit. Tests cover reassignment before and after start and late entry. | §2.13 | AgentFlow stores no "held by" field. The proxy is labelled as such, and no new required field is proposed. |
| **R09** Recoverable links | Call links are captured in the sale transaction, so navigation-safe. Failures are recorded server-side and retried by a module-level bounded retry plus a policy-section Retry. Appointment links are post-commit with a stable request id, module-level retry, a global Retry toast and later explicit linking. `parseSaleResult` now parses the link status. Missing links stay Unclassified or unresolved. | §2.12 | None. |
| **R10** History standard | Assessable means lineage and order are known **and** no unresolved call to a number recorded for the person exists anywhere before the anchor (lookback is not limited to the period). Numbers only rule out relatedness, never link. Numberless unresolved calls mark the KPI Partial at org level. Live: 110 of 2,062 leads become unassessable after creation (250 at any time); the rest stay assessable. | §2.11, A-38h | Using recorded numbers this way touches the phone-matching rules, so it is ★4. |
| **R11** Consistency | Value is separate from evidence. Truth tables via a single evaluation order: config → zero → coverage → maturity (appointment table in D4). KPI 16 is now partial or unavailable when outcomes are missing. A 23-row metric/unit registry fixes the percentage set (8, 17, 18, 19, 38). Values are rounded once from exact counts (1.249 → 1.2). Retyped appointments: **0 of 45 receipt-backed; unknown for 89 legacy**. Amendments land in the first PR that depends on them. The appendices were edited, not just overridden. | §2.2–§2.5, §6.3, appendices | The wrong section order was in the revision 1 main-plan summary; D6 already matched the brief. |
| **Map provenance** | An isolated documentation task records the asset version and hash, the full notice, transformation hashes and the Census metadata. It blocks only the PKG-F map merge. Network policy is not bypassed. | D5 | Revision 1 made this an implementation-approval blocker; it no longer stops the other packages. |

### 3.1 BC1–BC5 (2026-11-01): how each binding condition is resolved

Each condition is a test first (§10.1a), then an implementation in the affected package. None of these resolutions claims a privacy or security sign-off.

| Condition | Resolution | Where | Tests |
|---|---|---|---|
| **BC1** Unrelated uncertainty | Numberless unresolved calls, and unresolved activity elsewhere after an in-scope person's phone change, never change a personal or team payload. They raise the global unknown-history diagnostic only at authorized, **unfiltered agency** scope. E5 is narrowed to member-specific evidence for KPIs 19, 21 and 38 (never 14) | §2.9 (S14a BC1 additions, E1–E6), §2.11, A-38s (proposed); D1, D3 | `reports_v3_security.sql` S14a additions; §2.11 synthetic checks |
| **BC2** Metric-specific history gates | Gates are per KPI. KPI 14 needs only a valid receipt and first sale (no call needed). Prospects without a sale stay in KPI 19's population. A confirmed unanswered attempt does not invalidate a verified 1 Call Close (KPI 38 Yes). Phone checks only rule relatedness out, never link identities, and "no matching number" is never treated as proof of complete history | §2.11 gates table, A-38h (proposed); D3 | `reports_v3_journey.sql` BC2 cases (§10.1a) |
| **BC3** Appointment credit | KPIs 12, 16, 17 and 18 credit the recorded assignee at occurrence start. When it is unknown, the occurrence counts in agency totals and `detail.unattributed` only, with no individual credit. The creator fallback is removed everywhere, including the `credit_from_creator` disclosure. KPI 15 keeps its setter credit | §2.13, Sales Appointment invariant (proposed); D4, D6 | `reports_v3_appointment_facts.sql` BC3 cases; D6 schema and tile tests |
| **BC4** Empty-population rule | Status comes from each KPI's own numerator and denominator evidence (§2.2 truth table). A complete zero numerator over a positive denominator is 0, available. A known-zero denominator gives the KPI's zero code (for example `no_policies_sold`), or a coverage code when unknown denominator evidence exists. Unknown numerator evidence never becomes 0. The maturity block is kept whenever members > 0. SQL, Zod, UI and CSV assert the same 11 required cases | §2.2, rules 2, 6 and 7; D1, D6 | `reports_v3_contract.sql`, `reportsV3Schemas.test.ts`, `reportsKpiTile.test.tsx` and `reportsV3Export.test.ts`, from the shared `reportsV3Fixtures.ts` cases |
| **BC5** Capture and gap writes both failing | Create, update and delete sequences are tested with both the evidence write and the gap write failing. Each case names its durable detecting source (the current row, `booking_receipts`, or earlier evidence). Create-then-delete by a writer with no receipt, with both writes failing, is the stated **unobservable limit**: it is listed, not silently tracked by new capture | §2.12, A-10 (proposed); D4 | `appointment-evidence-failure-boundaries.mjs` (§10.1a) |


## 4. Full-scope package order, completion gate and approval separation (R01)

### 4.1 Order

| Step | Package | Contents | Contract after | User-visible effect |
|---|---|---|---|---|
| 1 | **PKG-A** | v3 contract: 8 ordered migrations, with all nine readers created sealed and then enabled; ops scripts; protected release runner; CI | 3.0.0 | None. v3 has no consumer yet |
| 2 | **PKG-B** | Audited AP corrections: ledger, effective-premium reader behind `performance_sale_monthly`, Admin correction UI and policy-section display | 3.1.0 | Leaderboard and Dashboard values are identical at release (empty ledger). Admins can correct a sale premium |
| 3 | Data step | Reviewed manifest classifying the 2 divergent policies. Premium and Sold Date are classified **separately**, and corrections go only through the PKG-B RPC | — | As decided |
| 4 | **PKG-C** | `clients.lead_id` guard; producing-call capture for Dialer, FloatingDialer and **tracked inbound (IN-A)**; failure record and retry; v3-only window | 3.2.0 (or 3.3.0 if D lands first) | Sale modals gain an optional call chip for inbound sales. No change to calling |
| 5 | **PKG-D** | Appointment categories with a reviewed baseline; non-blocking evidence capture; outcome panel; attributions with recoverable linking; optional closing-appointment field; the DialerPage `type` line; v3-only window | 3.3.0 (or 3.2.0) | Calendar outcome panel, settings category control, optional closing field |
| 6 | **PKG-F** | One-page Example 2 Reports V2 | ≥ 3.3.0 | The new Reports page. **This release completes Reports V2.** |

- C and D are independent and may release in either order, both after B. Whichever lands second regenerates the `report_v3_basis_flags` preimage.
- Capture is forward-only. Shipping C and D **before** F means the new page opens with real captured evidence, and every v3-only window happens while v3 has no consumers.
- New capture does not wait for 30-day groups to mature. Those groups simply show *In progress* until they do.
- **Protected preview.** PKG-F's protected Vercel preview is available as soon as PKG-A is enabled, for Chris's review only. It does not merge.
- **Partial public release.** A public PKG-F merge before C and D are live is possible only as an **explicitly approved partial release**. It would be labelled in the WORK_LOG and release notes as "partial: KPIs 12, 15–18 and/or 38 not yet implemented". It is never described as completion. The recommendation is no partial release (★7).
- **PKG-E** (event-time state snapshots) stays deferred. The Regional map is functional without it, using the recorded-state fallback, and it never describes historical grouping as event-time residence.

### 4.2 Completion gate ("Reports V2 complete")

All of the following must hold:
1. PKG-A, B, C, D and F are released and verified: read-backs, advisor comparison, served-bundle check, and both Vercel projects READY at the merge SHA.
2. No stub is live: `report_v3_basis_flags()` = `{corrections: 'audited_ledger', sale_call_links: 'installed', appointment_evidence: 'installed'}`.
3. The divergence manifest is approved and its check passes (§2.14). Every Sold Date `entry_error` is either corrected by a separately scoped package or explicitly accepted by Chris.
4. The release matrix (§7) has no row in "Data capture not implemented". Every historical limit is quantified.
5. Either IN-A shipped, or Chris's explicit acceptance of inbound-origin buyers staying Unclassified is recorded.
6. The AGENT_RULES amendments have landed per §6.3, with WORK_LOG entries and a context snapshot.

### 4.3 What each approval covers

**Approved 2026-11-01 (branch work only; the binding conditions in §5.2 apply):**
- Implementation on branches of PKG-A, B, C, D and F: code, prepared and **unapplied** migrations, synthetic tests, the release runner, CI, and the repository copy of this plan.
- PKG-A uses `claude/great-goodall-911azc`. Per-package branches for B, C, D and F are approved (`claude/great-goodall-911azc-pkg-b`, `-pkg-c`, `-pkg-d`, `-pkg-f`), with explicit shared-file ownership. A parallel branch never overwrites another package's changes.
- Telephony-adjacent **branch** edits are included only if Chris names C and D: the two DialerPage lines, the sale modals, the Calendar and settings files. The current `TwilioContext.tsx` is read first, and no TwilioContext change is proposed.
- No push, draft PR or merge without separate authorization. Local, isolated, synthetic test databases are permitted.
- A new path, a wider protected-file exception or any additional backend action needs a bounded change request and Chris's explicit approval first.

**Separate later approvals (none authorized by this plan):**

| Gate | What Chris approves |
|---|---|
| PKG-A production | The exact mutation, after preflight, rehearsal and the security sign-off (§2.9). Confirm Supabase "Deploy to production" is OFF. Merge the backend-only PR. Approve each runner stage in the `cgarness` environment |
| PKG-B production | Ledger, RLS/security write review, consumer switch, coordination with draft PR #486; then the correction UI merge |
| Divergence manifest | Classification of each policy, one dimension at a time; corrections only through the RPC |
| PKG-C production | `clients_lead_id_guard` (#APPROVE_RLS_CHANGE level), capture functions, DialerPage clause (a), IN-A; then the frontend merge after the telephony gate |
| PKG-D production | Categories, the **baseline write by count** (36 rows), the evidence trigger, attributions, DialerPage clause (b); then the frontend merge after the telephony gate |
| PKG-F | Protected preview review, then the production merge (it deploys both Vercel projects), or an explicitly labelled partial release |
| Completion | Chris confirms the §4.2 checklist |
| Future packages | Any repair, Sold Date correction, cross-surface Calls-made alignment, TwilioContext change or PKG-E: each needs its own reviewed scope |


## 5. Owner decisions and binding conditions (recorded 2026-11-01)

Chris's message of 2026-11-01 approved **branch-only** implementation of PKG-A, B, C, D and F, with the binding conditions below. It did **not** approve the plan's defaults wholesale, any AGENT_RULES text, or any production action.

### 5.1 Decisions

| # | Decision | Status | Recorded outcome |
|---|---|---|---|
| ★1 | Journey privacy at personal and team scope | **Pending** | Develop only a clearly marked **proposed** linked-history design, in isolation, with BC1 applied. Production acceptance of the disclosures and a named security review of the exact SQL are pending. No reviewer has been appointed. The default disclosures are **not** recorded as accepted |
| ★2 | Cohort presentation | Decided | Observed-to-date value, compact In progress status, details (pending, Fully mature on, mature-only subset) on demand |
| ★3 | Calls made evidence classes | Decided | Exclude proven non-attempts. Exclude unverified rows from the attempt value and keep truthful Partial coverage. Raw records and genuine failed attempts are preserved. Legacy pre-admission rows are counted under the retained legacy rule, and described that way, not as freshly provider-verified |
| ★4 | Phone-number exclusion evidence | **Pending** | No blanket approval of §2.11. Develop only the metric-specific, member-specific **proposed** design (BC1/BC2), in isolation. Never identity linking, sale attribution or deduplication |
| ★5 | Historical premium corrections | Decided | Admin and Super Admin, in their own organization only. Ordinary edits stay distinct; corrections are audited |
| ★6 | Tracked inbound sales (IN-A) | Decided | Include exact call-row propagation with same-org, contact and actor validation. The selected source call is **frozen with the sale submission**. The context is cleared on sign-out and organization change. The latest call is **never** substituted. TwilioContext and call behavior stay unchanged |
| ★7 | Partial public release | Decided | None by default. A+B+C+D+F remain the completion scope; a private preview can happen early |
| ★8 | Production release route | Decided | Protected runner, with exact approval and verification of each production package |
| ★9 | Calls made on other screens | Decided | A separate reviewed alignment scope. The temporary basis disclosure stays. AP-correction consistency and the documented refresh behavior remain in this project |

**Proposed fallback if ★1 or ★4 is declined** (for Chris's decision; **not approved** and not implemented):
- ★1 declined: option (c). KPIs 12, 14, 18, 19, 21 and 38 return `journey_scope_restricted` at personal and team scope. Agency scope is unchanged.
- ★4 declined: phone numbers are never read. Below agency scope the journey KPIs follow option (c), so unrelated unresolved calls cannot affect scoped results (BC1). At agency scope, unresolved calls become a window-level `history_incomplete` condition for 19, 21 and 38.

### 5.2 Binding branch conditions (each resolved and tested in the affected package)

| ID | Condition | Where |
|---|---|---|
| **BC1** | Unrelated out-of-scope uncertainty never changes personal or team results. This covers numberless unresolved calls and arbitrary unresolved activity elsewhere after an in-scope person's phone change. Global unknown-history diagnostics appear only at authorized, unfiltered agency scope. S14a, S14b, E1–E6, the proposed rules, appendices and test inventories are reconciled. No privacy sign-off is claimed | §2.9, §2.11, A-38s; D1, D3; tests S14a (BC1 additions) |
| **BC2** | History gates are metric-specific. A valid receipt and first sale support Days to first sale without a recorded call. Prospects without sales stay eligible for first-contact metrics. A confirmed unanswered attempt does not invalidate a verified 1 Call Close. Phone checks never link identities, and no match is not proof of complete history | §2.11, A-38h; D3; journey fixtures |
| **BC3** | Appointment outcome and closing credit (12, 16, 17, 18) uses the recorded assignee at occurrence start. When it is unknown, agency totals stay and there is no individual credit; the creator fallback is removed. KPI 15 keeps its setter rule | §2.13, Sales Appointment invariant; D4 |
| **BC4** | Each KPI is judged on its own numerator and denominator evidence. A complete zero over a positive denominator is 0, unknown numerator evidence never becomes 0, and maturity metadata is preserved. SQL, Zod, UI and export use the same cases | §2.2 truth table and required cases; D1, D6 |
| **BC5** | PKG-D tests create, update and delete sequences with both capture and gap writes failing, including create-then-delete with no current row. Each case shows its durable detecting source, or the unobservable limit is stated. No silent tracking expansion | §2.12; D4 |

### 5.3 Package-gate approvals (later, each separate)

- `clients_lead_id_guard` (#APPROVE_RLS_CHANGE level).
- DialerPage clauses (a) and (b).
- The category baseline write, by count.
- Each AGENT_RULES text, exactly as worded.
- Each production mutation, runner stage and merge (§4.3).

**Copy review:** the new on-demand lines are reviewed with the PKG-F protected preview (F4).


## 6. AGENT_RULES conflicts, amendment texts and landing schedule

Brief §23 says current repository rules take precedence over the brief. Each conflict below is therefore surfaced, not overridden.
- v2 keeps the existing rules.
- v3 changes only through these amendments.
- Line numbers are at `6e39c15`.
- **These are the only amendment texts.** The appendices point here and carry no texts of their own.
- **Status: every text below is PROPOSED, not approved.** The 2026-11-01 branch-work approval explicitly did not approve them. Each text lands only after Chris approves that exact text, in the PR that first depends on it (§6.3). Until then, `AGENT_RULES.md` is unchanged, and no production invariant is claimed to have changed because branch code exists.

### 6.1 Conflict register

| Rule (line) | Brief requirement | Conflict | Resolution |
|---|---|---|---|
| #38 metric canon (:500) | Percentages 17, 18, 19, 38 | "There is no conversion rate of any kind" | A-38c, which references the metric registry (§2.4). v2 keeps the rule |
| #38 (:502), Part B (:715) | KPIs 9–11 at every scope | "Dials per policy sold" is organization-only | A-38d |
| #38 (:501–:502), #42 (:557) | Original seller and sale-event premium | Reports credits the current assignee and uses stored policies and book premium | A-38e, A-42 (scoped to v2) |
| #38 (:500), §5 Contacted (:574) | Inbound history for journeys | Contacted is outbound-only | A-§5 (journey evidence only; never in 5/6/8/24) |
| #38 Calls made canon (:500) | KPI 5 excludes clicks without an attempt | Report Calls made = all outbound rows | A-38c attempt classes, for v3 only. Other surfaces are unchanged (§2.10) |
| #38 (:497, :506) | v3 must be disable-able | `reports_disable.sql` is named the safe state but leaves v3 on | A-38a, A-38b |
| #41 (:536–547) | 15 executable report readers | "only six v2 RPCs"; integrity enable is the full enable | A-41 |
| #41 (:543) | KPI 15 = Sales Appointments only | Booking count covers all types | A-41b |
| #40 (:521, :618) | An audited correction restates the sale | The snapshot amount is final | A-40 (a ledger beside the immutable row) |
| #34 (:456) | A known $0 corrected premium | 0 means "not recorded" | A-34 |
| #10 (:94) | Appointment evidence capture | Triggers must not block CRM writes | A-10, with exact failure classes |
| #22 (:244) | Dialer appointment type honoured | The writer "writes no `type`" | A-22 |
| §7 (:610) protected and oversized files | One DialerPage line in each of C and D; prop/mount additions | DialerPage is protected; files over 200 lines are frozen | A-§7, clauses (a)–(c) plus size exceptions |
| §7 (:612) Tailwind only | User-configured disposition colours | No inline styles | A-§7(c) |
| #30 (:334) | Protected release runner | "deliberate MCP path" | A-30 |
| Conversion lineage (:591) | `clients.lead_id` must be trustworthy | Lineage is unguarded | A-591 |
| Layout invariant (:699–719) | One page, 23 KPIs, layout v5, compact status | Four fixed parts; 38-id registry; leader row | A-L1–A-L3 |
| #28 production read-only default | Baseline write; package installs | Production writes need explicit approval | Separate exact approvals (§4.3); the baseline is approved by count |
| Identity rules ("never infer lineage from matching phone numbers") | The history-completeness standard | Uses recorded numbers | Numbers only **exclude** relatedness, never link (§2.11). A-38h states it. Owner/security decision ★4 |

### 6.2 Approved exact amendment texts — staged by package

# Proposed exact AGENT_RULES amendments

Candidate `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c`. Draft only; none applied. Chris must approve the exact text. Each clause lands no later than its first dependent package, with later-package behavior described as effective only when that package is installed. Unrelated rules stay unchanged.

The premium implementation, PR #515 counting and conditional privacy text correct the stale plan. The lineage clause now describes the actual UPDATE trigger; the CSV-history reference points to evidence that exists. Source line numbers are locators, not permission to edit neighboring rules.

## Package A — backend

**A-30 (#30, :334).** "…until then production schema/function changes go through the deliberate MCP path or a protected dispatch-only, main-only runner with a cgarness environment reviewer (Reports V2: `.github/workflows/reports-release.yml`), never a git merge."

**A-38 lead (#38, new first bullet).** "Reports V2 (`basis_version reports_v3`) reads only get_report_scope_v3, get_report_summary_v3, get_report_journey_v3, get_report_sales_appointments_v3, get_report_state_breakdown_v3, get_report_call_volume_v3, get_report_disposition_breakdown_v3, get_report_campaign_calls_v3 and get_report_lead_source_calls_v3. Pages built before Reports V2 keep reading the v2 readers with their v2 meaning; a page never shows one family's numbers under the other's meaning. The v3 call readers return call-only fields."

**A-38a (:497, replacing the parenthetical).** "(before Reports V2: `supabase/ops/reports_disable.sql`; after reports_v3 ships: `supabase/ops/reports_all_disable.sql`. reports_disable.sql alone leaves v3 executable; reports_integrity_enable.sql re-enables v2 only.)"

**A-38b (:506, prefix).** "With v3 live, run reports_v3_disable.sql (or reports_all_disable.sql) first."

**A-38s (:498, security contract; Option A and ★4 conditionally approved; independent sign-off pending).** "v3 readers may read same-organization history inside SECURITY DEFINER only to classify the in-scope credited population, and return scoped aggregates. Activity on identities with no in-scope credited event never changes a personal or team payload. On in-scope identities, out-of-scope activity may change only these aggregate effects (Option A, ★4 and E1–E6 conditionally approved by Chris; named independent exact-SQL security review, organization-isolation and permission verification, S1–S15/S14a/S14b verification, and separately authorized production-user read-back remain release gates):
(E1) an earlier contact or sale removes the person from an in-scope first-contact or first-time-buyer population, or makes 1 Call Close No;
(E2) earlier out-of-scope attempts count in Calls to first contact;
(E3) a purchase from any seller within 30 days counts as a success or an attributed policy, or leaves an appointment unresolved when it is not linked;
(E4) state grouping uses the identity's current recorded state, including a campaign-membership copy reached through any same-org call;
(E5) an unresolved call to a number recorded for the person, placed before the person's anchor, makes that person unassessable for the KPI whose gate it touches (19 could-qualify calls; 21 any call; 38 could-qualify calls before the linked sale call). Numberless calls and other people's activity never change personal or team results; organization-wide unknown-history diagnostics appear only at unfiltered agency scope;
(E6) New leads in the lead-source breakdown follows current lead assignment.
Coverage and unresolved counts use only in-scope credited items. Differencing filtered results can isolate one person's effect; this is conditionally accepted only for E1–E6 and is not a security certification. No production-user impersonation or read-back is authorized by this rule."

**A-38c (:500, metric canon for v3).**
- Replace "There is no conversion rate of any kind" with: "v2 has no conversion rate. v3 percentages are exactly those marked percent in the Reports V2 metric registry (8 Call contact rate, 17 Appointment show rate, 18 Appointment close rate, 19 Contact-to-sale rate, 38 1 Call Close), each over an explicit population with numerator, denominator and coverage; 18 and 19 use 30-day groups (Sold Date 0–30 days after the anchor, mature at the agency day start of anchor+31) and show the observed result to date with an In progress status while any member is pending; dividing unrelated period totals stays forbidden."
- Add: "v3 Calls made counts confirmed attempts only: eligible pre-admission rows and server-admitted rows, including the signed admission projection preserved by PR #515. Refused admissions are excluded as proven non-attempts, and rows with no admission record are excluded and disclosed as not verified as dialed. Raw rows are never changed. Production v2 Reports already uses the admitted-attempt basis from PR #515: for identical scope and bounds, v2 calls_made equals v3 KPI 5. Do not describe v2 Reports as counting every raw outbound row. Leaderboard, Dashboard and Trusted Dialer retain their existing production definitions; changing those definitions needs separate approval. Preserve PR #515/#516 provider admission, re-entrancy and telemetry behavior. Unique prospects use the structural identity lead:<root lead>/client:<id> with unresolved calls disclosed, never a call: fallback. For v3, Sales Appointments follow the Sales Appointment evidence invariant, not #23."

**A-38d (:502 and Part B :715).** "Reports V2 computes Calls per policy, Contacted calls per policy and Prospects reached per policy for every permitted scope and agent filter (placing-agent calls ÷ original-seller policies, same period), labelled Period averages; the organization-only restriction applies to v2 payloads only."

**A-38e (:501).** Prefix the existing text with "v2:", then add: "Reports V2 (reports_v3) counts original policy sale events (wins with policy_id and sold_date) on the agency Sold Date, credited to the original seller, at the effective sale premium; stored policies without a sale event are excluded and disclosed at agency scope only."

**A-38h (#38, new bullet; history completeness).** "v3 journey gates are metric-specific. Days to first sale needs a trustworthy lead receipt, an assessable first sale and their order, and never depends on call history. Contact-to-sale rate and Calls to first contact include prospects who never buy; they exclude a person only on that person's own conflicting evidence: an unknown or later receipt, a captured phone change, or an unresolved call to one of the person's recorded numbers that could have qualified (any such call for Calls to first contact). 1 Call Close needs an explicit sale-call link; uncertainty makes a buyer Unclassified, never No, and a confirmed unanswered attempt does not disqualify a verified one-call close. Recorded numbers are used only to rule out relatedness — never to link, merge, deduplicate or attribute a call — and the absence of a match is not proof of complete history."

**A-38p (#38, new bullet; precision and status).** "Report values are rounded exactly once at display or export, from exact numerators and denominators. Evidence status (available / partial / unavailable) and 30-day maturity are separate; a zero value never hides incomplete evidence."

**A-41 (#41, :536–547).**
- "The full enable is reports_v3_enable.sql: a harness-generated md5(prosrc) list of the 15 v2 pins, 12 closure helpers, every v3 body and their non-report dependencies. It grants EXECUTE on exactly six v2 + nine v3 readers to authenticated and service_role and nothing else."
- "reports_integrity_enable.sql is the v2-only enable (it seals v3); use it only in recovery R2 after a frontend rollback. reports_disable.sql is pre-v3 only."
- "Additive v3 objects are created sealed and need no v2 downtime. Helpers pinned in reports_integrity_enable.sql need the full window; helpers pinned only in reports_v3_enable.sql use the v3-only window. A change to report_agency_time_zone or report_permission_flags makes reports_v3_enable refuse until its pins are regenerated."
- "Reports V2 SQL files carry a privilege class (creation: no GRANT; enable: the 15 report readers to authenticated, service_role; application RPC: the listed functions to authenticated only); a static test enforces the class map. rpc_report_* are never granted."
- Mark the current-owner premium bullet as v2-only.

**A-42 (#42, :557).** "**Reports v2 (`*_v2`) are unchanged** (#38, #41): stored policies, Sold Date and current assignment. **Reports V2 (`*_v3`)** counts `wins` events by agency Sold Date, credited to the original seller, at the effective sale premium (#40)."

**A-§5 (Contacted, :574).** "Order: resolved No Answer → not contacted even above 45 s; then duration > 45; then counts_as_contacted. Reports V2 journeys apply it to answered inbound calls (agent_id or forwarded_answered, no voicemail) without adding them to outbound totals."

**Hygiene (same PR as A-38).**
- `:582`: standard lead fields are applied as `20261028040215`.
- `:972`: `20261021200000` is applied.
- `:286`, `:508`, `:532` and the `:618` parenthetical: the "Proposed #42, NOT applied" notes are superseded, because #42 shipped on 2026-10-16.
- Replace claims of a complete 74-file CSV golden with the verified historical evidence at `docs/plans/2026-10-11-ui-copy-cleanup-v2/evidence/csv-capture`: the old cleanup comparison recorded 61 captures and explicitly could not reconstruct 13 historical files. That evidence is not Reports V2 CSV acceptance; use the itemized V2 review and its stated gaps.

## Package B — backend

**A-40 (#40: new bullet after :521; replaces the :618 sentence "`wins.premium_snapshot=true` means … existing fallback.").** "Effective sale premium: `wins`, `premium_snapshot` and `guard_policy_win` stay immutable. A sale's effective monthly premium is its latest revision in `private.policy_sale_premium_corrections` (known, $0 or unknown); else the immutable snapshot amount (unknown and zero included, never a fallback); else, for legacy `premium_snapshot=false` primary sales only, the non-zero event amount and then the current primary premium. `private.policy_sale_effective_premium` exposes the effective amount, source, state and revision. `private.performance_sale_monthly` implements the equivalent rule as the optimized scalar expression: latest correction when present, otherwise the existing `private.performance_monthly` rule with primary-only legacy fallback. It does not delegate to the set-returning effective reader. `private.report_v3_sale_premium` uses the optimized monthly result and supplies premium metadata. Per-sale equality with `policy_sale_effective_premium` and agreement across performance/report consumers must remain verified. A correction (an entry error in the original sale) comes only from `public.correct_policy_sale_premium` (Admin / Super Admin, home organization) and restates the original seller's original Sold Date period; it never writes `wins`, notifies, celebrates or writes commission rows. Ordinary policy edits change the current policy only and never the sale's AP, except for a legacy primary sale with `premium_snapshot=false` and no event amount: its AP follows its current primary premium until an Admin records a correction or a same-amount freeze. The ledger has no FK to `wins`: a ticketed reversal leaves its rows inert. Never drop the ledger."

**A-34 (#34, after :456).** "A sale corrected to a known $0 lives only in the correction ledger. The writer never writes 0 to `clients.premium` for a primary policy (`book_zero_unsupported`). An explicit additional `premiumAmount: 0` stays known."

**A-851 (saved policy commissions, after :851).** "An AP correction never changes saved estimates, installments, receipts, captures or events. Record-later and replacement estimates keep their existing premium basis until a separately approved change."

## Package B — frontend

**Narrow size exception.** "The Package B FullScreenContactView.tsx exception permits only the existing single `onPolicyRecordChanged` prop. It does not authorize another component mount or unrelated refactoring."

## Package C — backend

**A-618 (sale recording, :618).** "Dialer-originated and tracked-inbound sales may call `*_handoff_v2`, which delegate unchanged to the Phase 2A companions and then record the producing-call link in a savepoint. A link error other than QUERY_CANCELED or ASSERT_FAILURE never fails or alters the sale, its request hash or its receipt; it is recorded in `private.policy_sale_call_link_failures` for retry. A statement cancellation or timeout aborts the whole call atomically, and the existing idempotent retry applies. A missing link is always Unclassified, never No."

**A-591 (conversion lineage).** "`clients.lead_id` updates are rejected by `clients_lead_id_guard` when the value changes and `current_user` is not `postgres`. Normal application edit paths must not write lineage; approved postgres-owned conversion companions establish it. The guard is an UPDATE restriction, not a claim that privileged postgres can never change lineage. It remains installed during the approved Package C recovery path."

## Package C — frontend

**A-§7(a).** "DialerPage.tsx may pass `sourceCallId={currentCallId}` to ConvertLeadModal for Reports V2 producing-call attribution. FloatingDialer.tsx and ConvertLeadModal.tsx receive only required props, forward them unchanged to an existing call, and mount at most one new component per package. New logic stays in components/hooks under 200 lines. TwilioContext.tsx remains unchanged; outbound dialing originates from browser Voice.js `device.connect()`."

## Package D — backend

**A-10 (#10, :94, append).** "The Reports V2 appointment evidence trigger does not abort an appointment write for errors other than QUERY_CANCELED and ASSERT_FAILURE: those errors are caught and recorded as a capture gap where possible, and readers reconcile evidence against current appointment rows and booking receipts, so a lost capture shows as a gap wherever a durable source survives; the documented unobservable case (created and removed while capture failed, with no receipt) is disclosed and never claimed as detected. A statement cancellation or timeout aborts the whole write as it does today. Only record_appointment_outcome, which writes nothing but an outcome transition, is evidence-first and fails closed."

**A-41b (#41, :543, append).** "That all-types count is the v2 contract only. v3 Sales appointments booked counts bookings classified `sales` at booking time with the same setter credit, creation date and status rule; receipt- or capture-backed deletions are counted and disclosed. All-kind counts remain integrity diagnostics."

**New invariant: Sales Appointment evidence (Reports V2 PKG-D).** "`appointment_types.business_category` is the only classification. Evidence snapshots the category at booking and at each human retype; deactivating, renaming or reclassifying a type never rewrites history, and a missing classification makes only the affected items unassessable. Locked system rows are immutable through the API, and their categories change only through the approved baseline/revert scripts; custom types are classified in Settings with an audit. Observation, occurrence, assignment, outcome and gap evidence is append-only and captured by `appointments_v3_evidence_capture` under the #10 failure classes; readers reconcile evidence with current rows. Appointment KPIs credit the agent assigned at the occurrence's scheduled start — a documented proxy, not proof of who attended; with no trustworthy assignee the item stays in agency totals with no individual credit (never the booking's creator); late outcome entry never moves credit. At most one effective closing-appointment attribution per policy, set explicitly after sale commit with a recoverable retry, requiring a caller-visible appointment, never inferred; a link failure never fails a sale. Nothing is backfilled."

## Package D — frontend

**A-22 (#22, :244, replace).** "It stamps `user_id = created_by =` the dialing agent. `saveAppointment` writes `type` only when its caller passes one: the Dialer AppointmentModal passes the agent's selected type (Reports V2 PKG-D); the standalone callback (`handleSaveCallback`) and disposition bookings pass none, so the callback shadow keeps the DB default and suppression is unchanged. Never add a type to the standalone callback writer."

**A-§7(b) and narrow size exceptions.** "DialerPage.tsx may add `type: data.type` to the AppointmentModal onSave saveAppointment payload. AppointmentModal.tsx and CalendarSettings.tsx receive only required props and at most one new component mount per package; new logic stays in components/hooks under 200 lines. ConvertLeadModal.tsx receives the same narrow prop/mount exception for appointment attribution. Do not change the standalone callback writer or use these exceptions for unrelated refactoring."

## Package F

**A-L1 (layout invariant, :699–711).** "Reports V2 (`reports_v3`) page, in brief §18 order: Production (1–4); Activity and sales effort (highlights 9, 10, 12, 38 with the Period averages line, the activity strip, More metrics); Trends and call outcomes; Agent performance; Regional performance; Calling heatmap; Breakdowns. Fixed: Production, the effort highlights, Trends and call outcomes, and How it's calculated. Registered (layout v5): the activity strip (≤6), the three sections (visibility only) and Breakdowns. Exactly 23 KPIs, each rendered once. The v5 normalizer reads v1–v5, maps an untouched v4 default to the v5 default, writes v5 and never writes on read. `reportsRegistrySnapshot.test.ts` freezes the registry, `DEFAULT_LAYOUT`, the cap and `V4_TO_V5`."

**A-L2 (:713–715).** "'How it's calculated' replaces 'Data basis'. Tiles carry only a value and at most two short chips (Partial, In progress) or a short unavailable cue; notices, coverage, pending counts and maturity dates are on demand and in 'Coverage in this report'. v3 text and Note rows come from `reports-v3-text.ts`. The single Period averages line and the conditional one-line Regional 'not mapped' notice are the only permitted helper lines."

**A-L3 (:717).** "No leader row. The gate enforces the Reports V2 budgets, including 320 px, 200% emulation and reduced motion."

**A-§7(c).** "The Tailwind exception is limited to the user-configured disposition colour swatch `style={{backgroundColor}}` in DispositionsPieChart and DispositionDeepDive."

**New invariant: Reports Regional performance.** "Regional performance reads only `get_report_state_breakdown_v3`. State = the current recorded prospect/client state of the D3 identity (a campaign-membership copy only when every same-org record is blank; event snapshots only if a separately approved capture exists), classified by `private.report_v3_state_classify` over the unchanged `normalize_us_state`; historical grouping is never described as event-time residence. One state per call or policy; calls and policies grouped separately; six unmapped reasons; mapped + unmapped = the KPI 5/6/2/1 totals. Selection is local. No geographic rates, rankings, or inference from phone, agent, address or device. Geometry is the generated us-atlas 3.0.1 module with its recorded provenance and notices; its checksum refusal stays."


### 6.3 Landing schedule (R11)

1. **Explicit approval per text.** Chris approved the revised clause text in the November 5 preparation request, with the Package B FullScreenContactView limitation to the existing single onPolicyRecordChanged prop. This approval does not authorize publication, merge or execution. Root AGENT_RULES includes only Package A clauses in the present branch; later clauses stay in this plan until their applicable stage.
2. **Earliest landing.** Each text then lands on `main` in the **first PR that depends on it**.
3. **Never later.** No amendment lands after the backend stages it governs.
4. **No early rules.** No amendment describes code that is not yet on `main`.

| Lands in | Amendments | Must be on `main` before |
|---|---|---|
| PKG-A backend PR | A-30, A-38 lead, A-38a, A-38b, A-38s, A-38c, A-38d, A-38e, A-38h, A-38p, A-41, A-42, A-§5, hygiene | The first PKG-A runner stage |
| PKG-B backend PR | A-40, A-34, A-851 | The PKG-B runner stages |
| PKG-B frontend PR | the §7 size exception for FullScreenContactView | Its merge |
| PKG-C backend PR | A-618, A-591 | The PKG-C runner stages |
| PKG-C frontend PR | A-§7(a); the §7 size exceptions for FloatingDialer and ConvertLeadModal | Its merge |
| PKG-D backend PR | A-10, A-41b, the Sales Appointment evidence invariant | The PKG-D runner stages |
| PKG-D frontend PR | A-22, A-§7(b); the §7 size exceptions for AppointmentModal and CalendarSettings (and ConvertLeadModal, if D's frontend lands before C's) | Its merge |
| PKG-F PR | A-L1, A-L2, A-L3, A-§7(c), the Regional performance invariant | The PKG-F merge |


## 7. Coverage at completion: the 23-KPI matrix (R21, revised)

Categories follow brief §21:
- **Available**;
- **Implemented, historical coverage limited**: computed correctly, with missing history quantified and shown as Partial;
- **Implemented, forward-only capture**: the evidence exists from its capture start. Earlier periods show the capture-start state, and new 30-day groups show *In progress* until they mature.

Because C and D now release before F, **no KPI is "Data capture not implemented" at completion.**

Figures are org A, read-only aggregates, as of 2026-10-31. A historical gap affects only the KPI that depends on it (brief §15).

| # | KPI | Reader | At completion (A–F live) | Live coverage evidence (org A, read-only aggregates) | Notes |
|---|---|---|---|---|---|
| 1 | Annual premium (AP) | `summary` | Available | Org A all-time 35/35 premiums known (29 sale_snapshot, 5 legacy_sale_event, 1 legacy_record_fallback); October 2026 27/27, $24,546.00 | Original seller, agency Sold Date, effective sale premium × 12; corrections only through the PKG-B audited ledger; the 2 divergent policies classified in the reviewed manifest (premium and Sold Date separately); exact cents, rounded once; legacy fallback line only when its count > 0 |
| 2 | Policies sold | `summary` | Available | 35/35 eligible (October 27); 0 undated, 0 missing identity, 0 duplicates | Original seller credit; the read-back asserts the count of wins in the sold window |
| 3 | Clients who purchased | `summary` | Available | 34 distinct buyers (October 26) | Deduplicated again at scope level |
| 4 | Average AP per policy | `summary` | Available | Usable-premium denominator 35 (October 27) | Exact cents ÷ usable-premium policies, rounded once; inherits KPI 1 premium states |
| 5 | Calls made | `summary` | Implemented, historical coverage limited | 8,355 attempts all-time (5,058 pre-admission + 3,297 admitted); 3 refused admissions excluded as proven (lock_lost, 2026-10-12 → 10-20); 9 rows with no admission record excluded and disclosed (2026-10-13 → 10-29); v2 calls_made 8,367 = 8,355 + 3 + 9 | Partial attempt_unverified only in windows that contain unverified rows (★3, decided); 0 confirmed calls with unverified rows is unavailable attempt_unverified, never an exact 0 (BC4); new unverified rows can still occur until a separately approved dialer fix exists; detail.call_population; KPI 5 = Σ call-reader rows = state total; Leaderboard, Dashboard, Trusted Dialer and old tabs keep counting every outbound row (★9) |
| 6 | Contacted calls | `summary` | Available | 521 all-time (October 204); 205 calls over 45 s with No Answer excluded; unverified rows can never be contacted | Attempt rows only; KPI 6 = Σ heatmap.contacted; re-measured at preflight |
| 7 | Unique prospects reached | `summary` | Implemented, historical coverage limited | 233 tracked identities; 175 unlinked contacted calls all-time; October 114 identities, 66 unlinked. The all-time unassessable count is 204 = 175 with no link + 29 with a dangling contact_id | Partial unlinked_contacted_calls; eligible excludes recruit-resolved calls (X18); drops from v2's 417 because the call: fallback is removed |
| 8 | Call contact rate | `summary` | Implemented, historical coverage limited | 521 / 8,355 attempts all-time | Percent, rounded once at 1 dp; inherits attempt_unverified in windows with unverified rows; 0 attempts and 0 unverified → no_calls_made (BC4) |
| 9 | Calls per policy | `summary` | Implemented, historical coverage limited | 8,355 attempts ÷ 35 policies all-time; both sides credited at every scope | Ratio, rounded once (display 1 dp, CSV 2 dp); inherits attempt_unverified; 0 complete calls over policies > 0 is a valid 0, no_policies_sold only with 0 policies, 0 confirmed + unverified rows → unavailable attempt_unverified (BC4); A-38d; credit placing_agent_and_original_seller |
| 10 | Contacted calls per policy | `summary` | Available | 521 / 35 (KPI 6 ÷ KPI 2) | Unaffected by unverified rows; 0 contacted calls over policies > 0 is a valid 0 (BC4); Period averages |
| 11 | Prospects reached per policy | `summary` | Implemented, historical coverage limited | Inherits KPI 7 identity coverage | Partial unlinked_contacted_calls; can legitimately be < 1; 0 prospects with complete identity coverage over policies > 0 is a valid 0 (BC4) |
| 12 | Sales appointments per policy | `sales_appointments` | Implemented, forward-only capture | 0 held outcomes and 0 appointment-policy links before PKG-D; forward-only from capture start; earlier periods outcome_capture_not_started | Observed result to date with In progress until the first groups mature 31 agency days after capture; resolved members, no attributed policy and none unresolved → no_attributed_policies, every member unresolved → attribution_unresolved, with the maturity block kept in both (BC4); credit assigned_agent_at_start, with no individual credit when the assignee is unknown (agency totals only, BC3) |
| 14 | Days to first sale | `journey` | Implemented, historical coverage limited | Lead receipt evidence for 9 of 18 converted clients (1 contradicts); 16 hand-entered buyers unassessable; D3 counts 8 of 34 buyers assessable all-time; gated only by receipt and first-sale evidence, never by call history (BC2) | lead_receipt_unknown / history_incomplete under the proposed metric-specific §2.11 gates (★4 pending); the PKG-C lead_id guard protects forward lineage only |
| 15 | Sales appointments booked | `sales_appointments` | Implemented, forward-only capture | Booking evidence forward-only from PKG-D capture start; earlier bookings classified from older records: 104 Sales Appointment bookings since 2026-05-28 (Aug 23, Sep 30, Oct 51) of 134 appointments (122 Sales Call, 12 Follow Up; 89 without booking_kind), Partial legacy_booking_basis | Setter credit; detail.disclosures and basis_counts; legacy_booking_basis is window-level, so a legacy-only window (Aug-Sep 2026) is Partial with a value, not unavailable; before PKG-D the stub gives unavailable/evidence_not_captured (not 0) |
| 16 | Sales appointments completed | `sales_appointments` | Implemented, forward-only capture | 0 held outcomes ever stored; forward-only after PKG-D | Partial outcomes_unresolved when due outcomes are missing; due outcomes in detail.due_outcomes; credit assigned_agent_at_start |
| 17 | Appointment show rate | `sales_appointments` | Implemented, forward-only capture | 128 past-due legacy rows excluded, not shown as unresolved; forward-only | Percent held ÷ due; partial outcomes_unresolved when due outcomes are missing; unavailable/outcomes_unresolved when none is resolved |
| 18 | Appointment close rate | `sales_appointments` | Implemented, forward-only capture | 0 held evidence and 0 attributions before PKG-D; the first groups mature 31 agency days after capture | Observed result to date with In progress while members are pending (pending held members stay in the denominator); mature-only counts on demand and in the CSV under their own names |
| 19 | Contact-to-sale rate | `journey` | Implemented, historical coverage limited | 175 unlinked contacted calls cannot enter first-contact groups; non-buyers stay in the cohort (BC2); proposed gates (★4 pending): a possibly related unresolved call that could have qualified as a contact, or a captured phone change, before the anchor makes a member unassessable; 110 of 2,062 leads have a matching unlinked call after creation (250 at any time), fewer under the could-qualify gate (re-measured at preflight) | Observed result to date with In progress for recent groups; a cohort where none bought is 0.0 % available (BC4); history_incomplete / lead_receipt_unknown; numberless calls affect only unfiltered agency scope (BC1) |
| 21 | Calls to first contact | `journey` | Implemented, historical coverage limited | 2,298 unlinked outbound calls, all with a recorded number (1,368 after 2026-10-03); any possibly related unresolved call, a linked unverified call or a captured phone change before the first contact makes a member unassessable (proposed, ★4 pending); non-buyers stay in the cohort | Median, rounded once; a linked unverified call before the first contact also makes the member unassessable (attempt_unverified); never-reached prospects excluded |
| 24 | Total talk time | `summary` | Available | Canonical stored durations; 2,615 of 3,288 October provider durations conflicting; pre-2026-10-05 legacy_unknown | Attempt rows only (unverified rows add no talk time); quality in detail.quality, Coverage in this report and CSV Note rows |
| 25 | Time in dialer | `summary` | Available | 647 org A sessions; 3 stale-active capped, 15 late-ended; 0 same-agent overlaps | Session agent credit; quality in detail.quality |
| 34 | Calls per lead | `summary` | Implemented, historical coverage limited | 2,354 unresolved attempt rows (2,298 no link + 56 dangling) of 8,355 (28.2%) excluded from both sides; the 12 excluded rows carry campaign links, so none is among the 2,354 | Partial unlinked_calls_excluded; inherits attempt_unverified |
| 38 | 1 Call Close | `journey` | Implemented, forward-only capture | 0 of 35 wins and 0 of 2,547 dialer receipts carry a sale-call link before PKG-C; forward-only after PKG-C for Dialer, FloatingDialer and tracked inbound (IN-A) sales | Historical buyers stay Unclassified (sale_call_link_missing, partial); a missing link is never No; forwarded-to-mobile answers and untracked outside sales stay Unclassified; without IN-A, inbound-origin buyers stay Unclassified, which needs Chris's acceptance (§4.2 item 5); uncertain order is Unclassified, never No, and a confirmed unanswered attempt does not disqualify a verified one-call close (BC2) |


**At completion:** 8 available (1, 2, 3, 4, 6, 10, 24, 25); 9 implemented with quantified historical limits (5, 7, 8, 9, 11, 14, 19, 21, 34); 6 implemented with forward-only capture (12, 15, 16, 17, 18, 38); 0 not implemented.

### 7.1 Coverage gaps that remain (listed only; none is authorized)

Each needs its own reviewed package, with aggregate counts, a fingerprint, and pre- and post-image evidence (#28, #40).

| Gap | Size (org A) | Affects | Possible future package |
|---|---|---|---|
| Calls with no admission record | 9 unverified rows, 2026-10-13 to 10-29 | 5, 8, 9, 21, 34 (Partial) | Reviewed classification (★3) |
| Sale ↔ producing-call links for past sales | 0 of 35 wins; 0 of 2,547 dialer receipts carry a converted client | 38 (past periods Unclassified) | Historical link repair (no candidates today) |
| Unlinked outbound calls | 2,298 of 8,367 rows (27.5%) with no contact or campaign link, plus 56 dangling pointers | 7, 11, 34; history standard for 14, 19, 21, 38; Regional unresolved | Call-identity repair with reviewed evidence |
| Lead receipt evidence | 9 of 18 converted clients have any receipt (1 contradicts); 16 hand-entered buyers | 14, 19, 21, 38 | Lead-receipt repair |
| Outcomes for past appointments | 128 past start with no outcome; no outcome ever stored | 12, 16, 17, 18 (before capture start) | None. There is nothing to repair from |
| Duplicate mappings | 5 shared-SID groups (10 rows); 12 booking-duplicate candidates | 5, 15 | Reviewed duplicate mapping |
| Event-time state | Not captured on calls, wins or appointments; 18 state changes since 2026-10-03 | Regional (grouped by current recorded state, disclosed) | PKG-E (deferred) |
| Forwarded-to-mobile inbound answers and outside sales | No browser leg; no tracked evidence | 38 (Unclassified) | None (outside-sales field deferred) |
| Pre-2026-10-05 call durations | All `legacy_unknown`; 2,615 of 3,288 October provider durations conflicting | 24 (quality detail only) | None |


## 8. Exact intended file list

**Counts.** 288 distinct paths and 328 package rows; a path can change in more than one package.
- 179 paths are new and 109 exist at base.
- 12 are deleted, all inside Reports.
- 65 are must-not-touch.

**Generation.** The list is generated from the six reconciled sections and checked against the repository at `6e39c15`: 0 exceptions across 288 paths; every modify, delete and protected-exception path exists at base, every create path is absent, and no path is created in two packages. One owner per path, with contributors in brackets (X16). Migration versions are placeholders (§2.7).

**Deleted files.** Every importer of a deleted file is itself changed or deleted in PKG-F.

**No generated types.** Nothing is created under `src/integrations/supabase/types.ts`; v3 calls use the existing narrow `.rpc` cast (`reports-queries.ts:129`).

**Protected and oversized files** (A-§7):
- DialerPage: one prop (C) and one payload key (D);
- FullScreenContactView: one prop (B only; must-not-touch in D);
- FloatingDialer, ConvertLeadModal, AppointmentModal and CalendarSettings: props or one mount only.

**TwilioContext.** `src/contexts/TwilioContext.tsx` is must-not-touch in every package and pinned byte-identical by a test.


#### PKG-A (48 paths)

| Path | Action | Owner (+contributors) | Purpose | At base |
|---|---|---|---|---|
| `.github/workflows/reports-release.yml` | create | D1 | Dispatch-only, main-only workflow, environment google-sheets-production (reviewer cgarness), CLI 2.121.0 (★8, A-30) | new |
| `scripts/reports_release.py` | create | D1 | Protected multi-stage runner: PKG-A stages plus the stage machinery (apply-index-concurrently, STOP, disable-v3, disable-all, rollback stages, record-history, sha256 constants for earlier release-enab | new |
| `scripts/reports_v3_fixture.py` | create | D1 | Builds the disposable DB from verbatim dependencies; finds migrations by unique suffix; asserts the highest-version *_reports_v3_release_enable*.sql == supabase/ops/reports_v3_enable.sql and earlier o | new |
| `scripts/run_reports_v3_tests.sh` | create | D1 | Loopback-only runner (refuses non-loopback and platform roles) for the fixed list of supabase/tests/reports_v3_*.sql suites incl. call_readers; writes $RUNNER_TEMP/reports-v3-payloads.json through rep | new |
| `supabase/migrations/20261104120010_reports_v3_foundation.sql` | create | D1 | Class C (no GRANT). D1 builders and registries: report_v3_envelope, report_v3_metric, report_v3_ratio and report_v3_rate (with p_maturity), report_v3_kpi_ids, report_v3_reason_codes (the 29 codes in § | new |
| `supabase/migrations/20261104120011_reports_v3_sale_facts.sql` | create | D2 | PKG-A runner stage apply-sale-facts: report_v3_sale_premium (PKG-B stub returning monthly, premium_source, premium_state, revision), report_v3_sale_facts (main plan §2.6 signature and exact columns),  | new |
| `supabase/migrations/20261104120012_reports_v3_call_journey_helpers.sql` | create | D3 | Runner stage apply-call-journey (one transaction, after …10/…11, before …13): report_v3_contact_predicate, report_v3_local_day_start, report_v3_client_identity_key, report_v3_contact_identity, report_ | new |
| `supabase/migrations/20261104120013_reports_v3_appointment_facts_stub.sql` | create | D4 | Class C (§2.8). Stub private.report_v3_appointment_facts(p_org uuid, p_agents uuid[], p_roster uuid[], p_start_at timestamptz, p_end_at timestamptz, p_time_zone text, p_reader_as_of timestamptz) RETUR | new |
| `supabase/migrations/20261104120014_reports_v3_state_helpers.sql` | create | D5 | Privilege class C (§2.8). Stage apply-state-helpers, the fifth of PKG-A's six transactional apply stages (placeholder version, renumbered above the production head with order kept). Creates private.re | new |
| `supabase/migrations/20261104120015_reports_v3_readers.sql` | create | D1 (+D5) | Class C. All nine public readers created sealed (REVOKE ALL FROM PUBLIC, anon, authenticated, service_role), no GRANT. D1 writes scope, summary, journey, sales_appointments and the four call readers ( | new |
| `supabase/migrations/20261104120016_reports_v3_calls_campaign_lead_index.sql` | create | D1 | Class C; D1 owner, co-authored with D3 (X16). Single statement CREATE INDEX CONCURRENTLY IF NOT EXISTS report_v3_calls_org_campaign_lead ON public.calls(organization_id, campaign_lead_id, created_at); | new |
| `supabase/migrations/20261104120017_reports_v3_release_enable.sql` | create | D1 | Class E. Byte-equal copy of the PKG-A supabase/ops/reports_v3_enable.sql, applied by apply-enable; later packages add …22_pkg_b, …33_pkg_c and …44_pkg_d (X4) | new |
| `supabase/migrations/rollback/20261104120015_reports_v3_readers.rollback.sql` | create | D1 | Class C (no GRANT). R5 structural rollback for every PKG-A function (all nine readers and every helper) and D5's private lineage index; refuses unless v3 is disabled and the v2 pins match; re-asserts  | new |
| `supabase/migrations/rollback/20261104120016_reports_v3_calls_campaign_lead_index.rollback.sql` | create | D1 | Class C. R5 optional non-transactional DROP INDEX CONCURRENTLY IF EXISTS public.report_v3_calls_org_campaign_lead | new |
| `supabase/ops/reporting-accuracy/reconcile_reports_v3_production.sql` | create (ops) | D2 | Read-only at a frozen as-of: v3 totals vs Σ performance_rows, v2→v3 identity, and per-period agreement of AP and policy count across Leaderboard snapshot, org stats, performance summary and details, r | new |
| `supabase/ops/reporting-accuracy/reconcile_sale_book_divergence.sql` | create (ops) | D2 | Read-only pre-cutover inventory: aggregates plus the policy_id worklist for the B6 manifest; check for effective monthly amounts with more than 2 decimals | new |
| `supabase/ops/reports_all_disable.sql` | create (ops) | D1 | Class R. Pattern-based all Reports off (v1/v2/v3 get_report_%, rpc_report_*, private.report_%); class W functions untouched; asserts no report function is client-executable | new |
| `supabase/ops/reports_v3_disable.sql` | create (ops) | D1 | Class R. Pattern-based v3 off (get_report_%_v3, private.report_v3_%) from PUBLIC/anon/authenticated/service_role; legacy re-seal; v2 and class W functions untouched; refuses if no v3 reader | new |
| `supabase/ops/reports_v3_enable.sql` | create (ops) | D1 | Class E. Full enable: harness-generated md5(prosrc) pins (15 v2, 12 closure, every v3 body incl. the nine readers, non-report deps), completeness, pattern REVOKE on get_report_%, private.report_% and  | new |
| `supabase/ops/reports_v3_preflight.sql` | create (ops) | D1 (+D5) | Class R (read-only; no privilege statement). Preflight (begin read only ... rollback): head, absence of v3, closure and v2 tuples, privilege matrix, default ACL, tz coverage, aggregate baselines incl. | new |
| `supabase/ops/reports_v3_readback.sql` | create (ops) | D1 (+D5) | Class R (read-only; no privilege statement). Read-back: pins, the 15-name grant set and the §2.8 matrix checked through catalog ACLs and the existing role memberships (the fresh-role and inherited-rol | new |
| `scripts/tests/reports_release_test.py` | create (test) | D1 | Runner state-machine rehearsal on disposable PG 17.6 with synthetic schema_migrations: PKG-A stages and the machinery; PKG-B/C/D cases are added by their packages (X7) | new |
| `src/lib/__tests__/reportsV3Contracts.test.ts` | create (test) | D1 | Static SQL: search_path on every CREATE FUNCTION; REVOKE ALL per created function; the §2.8 file → class map keyed by suffix with a GRANT parser (C none; E exactly the 15 report readers TO authenticat | new |
| `supabase/tests/reports_v3_appointment_facts.sql` | create (test) | D4 | PKG-A stub assertions (ids and order, five evidence_not_captured envelopes with null coverage and maturity, by_agent = roster, created sealed, shape equal to the PKG-D body); run by scripts/run_report | new |
| `supabase/tests/reports_v3_call_readers.sql` | create (test) | D3 (+D1) | Owner D3, contributor D1. V1–V9 for the four v3 call readers: attempt-class population, §2.10 invariants, call_population blocks and the Partial cue, 'Calls without a campaign', 'Other campaigns' and  | new |
| `supabase/tests/reports_v3_calls_identity.sql` | create (test) | D3 | C1–C13: contact boundary, row-set and column parity with report_call_facts, inbound exclusion, attempt classes and KPI 5 attempt_unverified, identity and key parity, aggregation, KPIs 9–11 credit map, | new |
| `supabase/tests/reports_v3_contract.sql` | create (test) | D1 | §2.2 envelope rules (one fixture per rule incl. partial + in progress, window-level partial conditions and X3), the BC4 truth table on each KPI's own N/D evidence and its 11 required cases, no-raise f | new |
| `supabase/tests/reports_v3_controls.sql` | create (test) | D1 | rt.assert_sealed_v3(p_v2,p_v3), rt.v3_pins() (harness list), the S15 privilege-matrix helper, payload id/name scanner | new |
| `supabase/tests/reports_v3_dependencies.sql` | create (test) | D1 | Stubs for the October columns/tables v3 reads, incl. the admission columns behind attempt_class; checked against the live column inventory at preflight | new |
| `supabase/tests/reports_v3_fixtures.sql` | create (test) | D1 | Orgs O1 (LA), O2 (NY, cross-org rows), O3 (no settings), O4 (Havana); roles incl. a fresh PUBLIC-only role and a fresh member of authenticated (S15); attempt, non-attempt and unverified call rows; unr | new |
| `supabase/tests/reports_v3_journey.sql` | create (test) | D3 (+D2) | J1–J22 incl. J1b (inbound link Yes/No), J12 (first_sales cases moved from D2), J15 (metric-specific history gates), J16 (journey coverage reasons) and J17–J22 (the six §2.11 BC1/BC2 synthetic checks,  | new |
| `supabase/tests/reports_v3_journey_fixtures.sql` | create (test) | D3 | Synthetic org/lead/client/call/admission (admitted, refused, missing)/lineage/receipt/win/link fixtures; prospects who never buy; unresolved calls with matching, unrelated and missing numbers before a | new |
| `supabase/tests/reports_v3_negative.sql` | create (test) | D1 (+D5) | rt.reject_mutation controls: removed narrowing guard, other-agent rows, unavailable emitted as 0, GRANT to anon, v2 policy fields in a call reader, a non-attempt or unverified row counted in Calls mad | new |
| `supabase/tests/reports_v3_performance.sql` | create (test) | D1 (+D5) | Gate at 500k/5k/10k under SET LOCAL statement_timeout='8s' for all nine readers (p95 <= 2s; journey <= 4s); EXPLAIN (ANALYZE, BUFFERS) recorded | new |
| `supabase/tests/reports_v3_release.sql` | create (test) | D1 (+D5) | Replay/drift refusal, created sealed, the enable grants exactly the 15 readers and its refusals, pin list, script state matrix incl. reports_disable after v3 = (v2 off, v3 on), rollback proofs, finger | new |
| `supabase/tests/reports_v3_sale_facts.sql` | create (test) | D2 | Sale-facts contract (main plan §2.6 columns) and bounds, original-seller credit and per-KPI credit map, premium source/state matrix, KPI 1-4 status/reason matrix in registry order, exact values with n | new |
| `supabase/tests/reports_v3_security.sql` | create (test) | D1 (+D2,D3,D5) | S1-S15: grants (15 report readers to authenticated and service_role; W to authenticated only), metadata, 42501/55000/22023, cross-org, legacy seal, markers, payload privacy scan, S14a unrelated identi | new |
| `supabase/tests/reports_v3_state_breakdown.sql` | create (test) | D5 | Covers the classifier, identity resolution, cardinality, premium states (including all-invalid → unavailable/premium_invalid and the recorded_at <= now() filter, X14), the §2.10 attempt classes (call_ | new |
| `supabase/tests/reports_v3_state_harness.sql` | create (test) | D5 | Harness extension: state columns on leads, clients and campaign_leads; recruits; private.dialer_conversion_lineage; contact_history_events with RLS on. Asserts that the verbatim normalize_us_state has | new |
| `AGENT_RULES.md` | docs | D1 (+D3) | The proposed PKG-A texts of main plan §6.2: A-30, A-38 lead, A-38a, A-38b, A-38s, A-38c, A-38d, A-38e, A-38h, A-38p, A-41, A-42, A-§5 and hygiene. Pending: each lands in the PKG-A backend PR, before t | exists |
| `WORK_LOG.md` | docs | D1 | Newest-first entry per shipping stage | exists |
| `docs/plans/2026-10-31-reports-v2/implementation_plan.md` | docs | D1 | Repository copy of the plan, written on the branch under the 2026-11-01 branch-work approval | new |
| `docs/plans/2026-10-31-reports-v2/production-release.md` | docs | D1 | Pins, preflight and read-back evidence, advisors, history per package, and the named security reviewer's sign-off record (§2.9) | new |
| `docs/plans/2026-10-31-reports-v2/verification.md` | docs | D1 | Check results per shipping stage | new |
| `implementation_plan.md` | docs | D1 | Prepend one dated pointer entry to docs/plans/2026-10-31-reports-v2/implementation_plan.md when the plan file is written; existing entries untouched | exists |
| `scripts/reconcile_reporting.mjs` | modify | D2 | Optional allowlisted query selector (reconcile / sold_date / sale_book_divergence / reports_v3_production); default output unchanged | exists |
| `.github/workflows/reports-backend.yml` | modify (CI) | D1 | Paths (:5-23): add the v3 runner, fixture and release tooling, reports-release.yml, src/hooks/useReport*.ts (the :18 src/lib/stat-computations.ts filter stays until PKG-F deletes that file; D6 drops i | exists |
| `scripts/reporting_fixture.py` | modify (test) | D2 | PKG-A: read-only divergence-query step in reconciliation_steps() | exists |

#### PKG-B (30 paths)

| Path | Action | Owner (+contributors) | Purpose | At base |
|---|---|---|---|---|
| `src/components/contacts/policy-correction/CorrectSalePremiumDialog.tsx` | create | D2 | Zod-validated correction dialog (<200 lines); pre-submit line 'Changes this sale's AP for its seller and Sold Date. No new sale is recorded.'; for a legacy_record_fallback sale the line 'This older sa | new |
| `src/components/contacts/policy-correction/PolicySalePremiumSection.tsx` | create | D2 | Lazy per-policy section (<120 lines): 'Sale premium $X/mo (as sold)' next to the current premium when they differ, 'Corrected' badge when a revision exists, History (n), and 'Correct sale premium' onl | new |
| `src/components/contacts/policy-correction/SalePremiumHistory.tsx` | create | D2 | Audit revision list (<90 lines); shows each revision's request id to Admins for the B6 manifest | new |
| `src/hooks/usePolicySalePremiums.ts` | create | D2 | React Query read of get_client_policy_sale_premiums with key ['policy-sale-premiums', clientId, userId, orgId], which the success invalidation key prefix-matches; disabled under View As | new |
| `src/hooks/usePremiumCorrectionSubmission.ts` | create | D2 | Frozen-retry submission state machine; on success shows 'Sale premium corrected. Performance totals show the new amount on their next refresh.' (RL-16) and invalidates exactly ['policy-sale-premiums', | new |
| `src/lib/policySaleCorrection.ts` | create | D2 | Zod form/args/result (with request_id and freeze)/state schemas, frozen builders, RPC transport, error and DETAIL mapping (imports classifySaleError only); the no-change refinement allows a same-amoun | new |
| `supabase/migrations/20261104120020_policy_sale_premium_corrections.sql` | create | D2 | PKG-B, class C (no GRANT): ledger (no FK to wins; pspc_changed allows a same-amount row only when previous_source = 'legacy_record_fallback', the RL-15 freeze), append-only guard triggers, policy_sale | new |
| `supabase/migrations/20261104120021_reports_v3_sale_premium_basis.sql` | create | D2 | PKG-B v3-only window, class W: md5(pg_get_functiondef)-guarded replacement of report_v3_sale_premium and report_v3_basis_flags (contract 3.1.0, corrections 'audited_ledger'), per-win value identity, t | new |
| `supabase/migrations/20261104120022_reports_v3_release_enable_pkg_b.sql` | create | D2 | Class E: byte-equal copy of the PKG-B version of supabase/ops/reports_v3_enable.sql (grants only the 15 report readers to authenticated, service_role); the highest-version release-enable file after PK | new |
| `supabase/migrations/rollback/20261104120020_policy_sale_premium_corrections.rollback.sql` | create | D2 | Class C. Refuses unless v3 is disabled; always seals the writer; restores the performance_sale_monthly and PKG-A stub/basis_flags preimages only when the ledger is empty and the PKG-B postimages are s | new |
| `supabase/ops/reporting-accuracy/check_sale_correction_manifest.sql` | create (ops) | D2 | Read-only B6 gate check ($1 org, $2 the manifest's premium entry_error rows as JSON [{policy_id, request_id}]): per row, whether the org's sale for that policy_id has a ledger revision with that reque | new |
| `scripts/tests/sale-premium-correction-concurrency.mjs` | create (test) | D2 | Two-backend races: same request, same expected revision, correction vs client edit | new |
| `src/components/contacts/__tests__/correctSalePremiumDialog.test.tsx` | create (test) | D2 | Content, book-mode gating, primary zero, sending lock, pre-submit line, same-amount freeze allowed only for a legacy_record_fallback sale (with its line), no notify_win/win-trigger import | new |
| `src/components/leaderboard/__tests__/correctedPremiumSurfaces.test.tsx` | create (test) | D2 | RL-17 component harness: parses the correction.before/after bundles through the existing performanceQueries.ts and performanceSummary.ts schemas and renders the Leaderboard row (LeaderboardRankingsTab | new |
| `src/components/leaderboard/__tests__/recentWinsPremium.test.tsx` | create (test) | D2 | Recent Wins renders the formatted premiumSold (effective × 12) and never the raw premium_amount; a win with premiumSold null shows no premium badge | new |
| `src/hooks/__tests__/usePremiumCorrectionSubmission.test.tsx` | create (test) | D2 | Frozen replay identity, phase transitions, exact invalidation keys ['policy-sale-premiums', clientId] and ['policy-commissions'], and the success copy (RL-16) | new |
| `src/lib/__tests__/policySaleCorrection.test.ts` | create (test) | D2 | Amount grammar, cap, decimals, note, no-change, PT409/22023 DETAIL mapping, permission-denied to unavailable | new |
| `src/lib/__tests__/rawPremiumConsumers.test.ts` | create (test) | D2 | Static guard: no non-test file under src/ imports leaderboardPremium.ts or AgentScorecardModal.tsx (__tests__ folders and *.test.* files skipped) | new |
| `supabase/tests/policy_sale_premium_correction.sql` | create (test) | D2 (+D5) | Correction semantics, ★5 proposed-default permissions, book modes, zero/unknown, edit paths that never write the ledger or move sale AP, the legacy-fallback freeze (RL-15), append-only, reversal of a  | new |
| `AGENT_RULES.md` | docs | D2 | A-40, A-34 and A-851 land with the PKG-B backend PR before its stages. The separate FullScreenContactView single-prop exception lands only with the PKG-B frontend PR (§6.2–§6.3). | exists |
| `scripts/reports_release.py` | modify | D2 | PKG-B stage constants: check, disable-v3, apply-premium-corrections, apply-sale-premium-basis, apply-enable, record-history; pinned bytes, sha256 and digests, including the …17 sha256 for the earlier  | new |
| `src/components/contacts/ClientPolicies.tsx` | modify | D2 | Mount the section next to PolicyCommission (:56-58, :96), passing the displayed current monthly premium (policy.premiumMonthly); optional onPolicyRecordChanged prop (104 → ~125 lines) | exists |
| `supabase/ops/reports_v3_enable.sql` | modify | D2 | PKG-B md5(prosrc) pins: new performance_sale_monthly, report_v3_sale_premium, report_v3_basis_flags; add policy_sale_effective_premium (D1-owned file; its grants are unchanged) | new |
| `.github/workflows/reports-backend.yml` | modify (CI) | D2 | PKG-B: add paths supabase/tests/policy_sale_premium_correction.sql (X7), scripts/tests/sale-premium-correction-concurrency.mjs, supabase/ops/reporting-accuracy/check_sale_correction_manifest.sql and s | exists |
| `src/components/contacts/FullScreenContactView.tsx` | modify (protected/size exception) | D2 | Only the existing single onPolicyRecordChanged prop on <ClientPolicies>; no additional component mount or unrelated refactoring. The exception lands with the PKG-B frontend PR (§6.3). | exists |
| `scripts/reporting_fixture.py` | modify (test) | D2 | PKG-B: apply …20 after the performance migrations so performance_reporting_contract.sql runs on the switched choke point | exists |
| `scripts/reports_v3_fixture.py` | modify (test) | D2 | PKG-B step set (disable-v3, …20, …21, …22) plus verbatim commission migrations for fingerprint checks; read-only check_sale_correction_manifest.sql step with pass/fail fixtures; writes the correction. | new |
| `scripts/run_reports_v3_tests.sh` | modify (test) | D2 | Add policy_sale_premium_correction.sql and the concurrency script to the fixed list | new |
| `scripts/tests/reports_release_test.py` | modify (test) | D2 | PKG-B step list exact; apply refuses before disable-v3; pinned bytes; byte check on the highest-version release-enable file (…22) with …17 by sha256 | new |
| `src/components/contacts/__tests__/clientPolicies.test.tsx` | modify (test) | D2 | Section mount in both branches with the current premium; 'Sale premium $X/mo (as sold)' only when it differs; Corrected badge only with a revision; button only when can_correct; hidden under View As,  | exists |

#### PKG-B (B6 manifest step) (1 paths)

| Path | Action | Owner (+contributors) | Purpose | At base |
|---|---|---|---|---|
| `docs/plans/2026-10-31-reports-v2/evidence/sale-book-divergence.md` | docs | D2 | Reviewed divergence manifest, created at B6 in its own reviewed PR: per policy_id a premium classification and a separately reviewed Sold Date classification ∈ {entry_error, genuine_later_change}, dec | new |

#### PKG-C (48 paths)

| Path | Action | Owner (+contributors) | Purpose | At base |
|---|---|---|---|---|
| `src/components/contacts/PolicySaleCallLinkStatus.tsx` | create | D3 | Reads win statuses through get_policy_sale_call_link_status(p_win_ids) on mount and after any reload (RL-21); shows 'Call link not saved · Retry' only for open_failure wins, which the RPC returns only | new |
| `src/components/contacts/SaleSourceCallChip.tsx` | create | D3 | Mounted with the modal's request id in RecordPolicyModal and ConvertLeadModal when no sourceCallId prop was given: during an active inbound call an auto-attached removable chip (only while nothing is  | new |
| `src/components/layout/TrackedCallObserver.tsx` | create | D3 | RL-20: null-rendering component that calls useActiveInboundCallRow for the whole signed-in session, so an inbound call is captured even when no sale modal is open; under 200 lines | new |
| `src/hooks/useActiveInboundCallRow.ts` | create | D3 | Reads only public useTwilio() values (currentCall, callState, lastCallDirection, caller display values); while an inbound call is active captures extractAfCallRowId(currentCall.customParameters) into  | new |
| `src/lib/recentTrackedCall.ts` | create | D3 | Module-level store keyed by row id (row id, caller label, end time, user, organization); held 30 minutes after the call ends; also each open chip's selection keyed by the modal's request id, cleared w | new |
| `src/lib/saleCallLinkRetry.ts` | create | D3 | Module-level bounded retry (3 attempts at 1 s, 4 s, 15 s) through retry_policy_sale_call_link(p_win_id); deduplicated per win; not tied to any modal's lifecycle; stops on linked, already_linked, rejec | new |
| `supabase/migrations/20261104120030_policy_sale_call_links.sql` | create | D3 | PKG-C stage 1 (class C): clients_lead_id_guard (private.guard_client_lead_id, BEFORE UPDATE OF lead_id, 42501 unless postgres) first; then private.policy_sale_call_links (PK (organization_id, win_id), | new |
| `supabase/migrations/20261104120031_policy_sale_call_link_capture.sql` | create | D3 | PKG-C stage 2 (class W): md5(pg_get_functiondef) handoff preimage guard; private.policy_sale_call_link_failures; private.capture_policy_sale_call_link with function-level SET lock_timeout = '100ms' (v | new |
| `supabase/migrations/20261104120032_reports_v3_sale_call_links.sql` | create | D3 | v3-only window body (class C): md5(pg_get_functiondef)-guarded CREATE OR REPLACE of report_v3_sale_call_links (links joined to same-org wins/calls, captured_at <= p_as_of) and report_v3_basis_flags (s | new |
| `supabase/migrations/20261104120033_reports_v3_release_enable_pkg_c.sql` | create | D3 | NEW (X4), class E: byte copy of supabase/ops/reports_v3_enable.sql after the PKG-C pin update (EXECUTE on the 15 report readers TO authenticated, service_role after the pattern REVOKE); runner stage a | new |
| `supabase/migrations/rollback/20261104120031_policy_sale_call_link_capture.rollback.sql` | create | D3 | Preimage-guarded (class C): capture helper returns {status:'disabled'}; wrappers, retry RPC and status read stay callable; links and failure rows retained | new |
| `supabase/migrations/rollback/20261104120032_reports_v3_sale_call_links.rollback.sql` | create | D3 | Inside a v3-only window (class C): restore the zero-row stub and the previous basis_flags; links retained | new |
| `scripts/tests/sale-call-link-failure-boundaries.mjs` | create (test) | D3 | Multi-session Node harness on loopback PG 17.6 (§2.12): T-LOCK, T-CANCEL (harness-only slow capture body plus statement_timeout or pg_cancel_backend), T-REPLAY, T-DOUBLE, T-ASSERT and the server half  | new |
| `src/components/contacts/__tests__/policySaleCallLinkStatus.test.tsx` | create (test) | D3 | Reads statuses through get_policy_sale_call_link_status; the action shows only for open_failure wins; omitted wins show nothing; Retry calls the RPC once and shows the saved state; a failure keeps the | new |
| `src/components/contacts/__tests__/saleSourceCallChip.test.tsx` | create (test) | D3 | Active inbound call → auto-attached removable chip; ended within 30 minutes → unselected 'Sold on the call with {caller} at {time}'; later → nothing; not mounted when a sourceCallId prop is given; the | new |
| `src/components/layout/__tests__/trackedCallObserver.test.tsx` | create (test) | D3 | RL-20: renders nothing; an inbound call answered while no sale modal is open is captured and then offered by the chip after it ends; reads TwilioContext only | new |
| `src/hooks/__tests__/useActiveInboundCallRow.test.tsx` | create (test) | D3 | Captures af_call_row_id only while an inbound call is active; ignores outbound calls and malformed ids; only reads TwilioContext | new |
| `src/lib/__tests__/recentTrackedCall.test.ts` | create (test) | D3 | Keyed by row id; held 30 minutes after the call ends; cleared on sign-out and on organization change (★6); mismatched entries dropped on read; memory only | new |
| `src/lib/__tests__/saleCallLinkRetry.test.ts` | create (test) | D3 | T-UNMOUNT (navigation or unmount during an in-flight link or retry, network failure; 3 attempts at 1 s, 4 s, 15 s with fake timers; dedupe per win) and the client half of T-RECOVER (after a reload the | new |
| `supabase/tests/policy_sale_call_links.sql` | create (test) | D3 | L1–L16 in the commission harness: capture, idempotency, rejected validation never failing the sale, immutability, class W grants, capture_failed with a failure row, md5/same_payload, PT409, rollback,  | new |
| `AGENT_RULES.md` | docs | D3 | No D3 amendment text (§6.3, RL-28; every text pending until Chris approves it exactly): A-618 and A-591 land in the PKG-C backend PR before the PKG-C runner stages; A-§7(a) and the §7 size exceptions  | exists |
| `scripts/reports_release.py` | modify | D3 | PKG-C stage constants (X7): …30–…33 bytes, sha256 and statement digests; disable-v3 → …32 → apply-enable (…33) → read-back → record-history; D1-owned runner | new |
| `src/components/contacts/ClientPolicies.tsx` | modify | D3 | One PolicySaleCallLinkStatus mount per policy next to the commission section (104 lines at base; PKG-B's premium section mounts first and PKG-C rebases); stays under 200 lines | exists |
| `src/components/contacts/RecordPolicyModal.tsx` | modify | D3 | Optional sourceCallId prop forwarded unchanged to recordClientPolicyHandoff and one SaleSourceCallChip mount (with the request id) when no prop is given (108 lines, no exception needed) | exists |
| `src/components/layout/AppLayout.tsx` | modify | D3 | RL-20: one TrackedCallObserver mount next to FloatingDialer, under the same !isImpersonating condition and inside TwilioProvider (72 lines at base); nothing else | exists |
| `src/lib/policySaleOutcome.ts` | modify | D3 | PreparedSale (:17-28) gains readonly sourceCallId, frozen, not in saleArgs; parseSaleResult (:156) reads source_call_link through a Zod schema into SaleHandoffResult.sourceCallLink (absent → not_reque | exists |
| `src/lib/policySaleRecording.ts` | modify | D3 | Shared file (RL-27): D3 owns it in PKG-C. COMPANION_WITH_CALL map, Zod uuid check, _v2 routing with p_source_call_id and a single PGRST202 fallback (:36-72); optional sourceCallId in prepareRecordPoli | exists |
| `src/lib/supabase-conversion.ts` | modify | D3 | Optional sourceCallId in prepareConversion and convertLeadToClientHandoff (:90-102, :146-148): the forwarded prop, else the chip selection recorded under the request id (RL-24, RL-41), frozen into Pre | exists |
| `supabase/ops/reports_v3_enable.sql` | modify | D3 | Regenerated harness pin list (md5(prosrc)) for the two replaced bodies; D1 is the sole creator of the file | new |
| `.github/workflows/policy-commission-tracking.yml` | modify (CI) | D3 | Path filters supabase/migrations/*_policy_sale_call_link*.sql, its rollback, supabase/tests/policy_sale_call_links.sql and scripts/tests/sale-call-link-failure-boundaries.mjs; node step for the failur | exists |
| `.github/workflows/reports-backend.yml` | modify (CI) | D3 | Path filters for the PKG-C migrations and tests whose names do not contain 'reports'; D1 owns the rest of the file | exists |
| `src/components/contacts/ConvertLeadModal.tsx` | modify (protected/size exception) | D3 | A-§7 size exception (518 lines), RL-24: PKG-C adds only sourceCallId, forwarded unchanged to the existing conversion handoff call, and the SaleSourceCallChip mount (with the request id); PKG-D adds on | exists |
| `src/components/layout/FloatingDialer.tsx` | modify (protected/size exception) | D3 | A-§7 size exception (1,350 lines), props only: pass policyClient.callId and pendingConversion?.callId ?? null to the modals (:780-805); no call, guard or mount change | exists |
| `src/pages/DialerPage.tsx` | modify (protected/size exception) | D3 | A-§7(a): single line sourceCallId={currentCallId} on <ConvertLeadModal> at :4691-4697 after campaignId (:4696); nothing else | exists |
| `scripts/reports_v3_fixture.py` | modify (test) | D3 | PKG-C mode applies …30–…33 on the synthetic database; highest-version release-enable byte check (X4, X7) | new |
| `scripts/run_policy_commission_tests.sh` | modify (test) | D3 | Apply …30 and …31 after the commission companions; run policy_sale_call_links.sql, the rollback step and sale-call-link-failure-boundaries.mjs | exists |
| `scripts/run_reports_v3_tests.sh` | modify (test) | D3 | PKG-C suites (reports_v3_journey.sql PKG-C mode) in the fixed list (X7) | new |
| `scripts/tests/reports_release_test.py` | modify (test) | D3 | PKG-C step list exact; window stages refuse outside the v3-only window; preimage refusal cases (X7) | new |
| `src/components/contacts/__tests__/clientPolicies.test.tsx` | modify (test) | D3 | PolicySaleCallLinkStatus mounted per policy; nothing shown without an open failure row (rebased on PKG-B) | exists |
| `src/components/contacts/__tests__/convertLeadModalPolicyFields.test.tsx` | modify (test) | D3 | sourceCallId forwarded to the conversion handoff; chip mount and end-to-end inbound capture as for RecordPolicyModal | exists |
| `src/components/contacts/__tests__/policyCommissionHandoffModals.test.tsx` | modify (test) | D3 | Adds a @/contexts/TwilioContext mock (the chip calls useTwilio()); no chip without an inbound call; existing assertions unchanged | exists |
| `src/components/contacts/__tests__/policyCommissionPreviewModals.test.tsx` | modify (test) | D3 | Adds a @/contexts/TwilioContext mock (the chip calls useTwilio()); no chip without an inbound call; existing assertions unchanged | exists |
| `src/components/contacts/__tests__/recordPolicyModal.test.tsx` | modify (test) | D3 | sourceCallId forwarded; absent means chip; end-to-end: a mocked active inbound currentCall with af_call_row_id reaches _v2 as p_source_call_id; removing the chip sends the old companion; frozen retry  | exists |
| `src/components/layout/__tests__/floatingDialerDisposition.test.tsx` | modify (test) | D3 | Current outbound call id reaches RecordPolicyModal and ConvertLeadModal | exists |
| `src/components/layout/__tests__/viewAsRouteAllowlist.test.tsx` | modify (test) | D3 | Mocks ../TrackedCallObserver as a layout child (it calls useTwilio): mounted normally next to FloatingDialer, never mounted and issuing nothing under View As | exists |
| `src/lib/__tests__/policySaleOutcome.test.ts` | modify (test) | D3 | parseSaleResult reads source_call_link through Zod for every status; absent → not_requested; malformed → unknown; the sale result is never failed or altered | exists |
| `src/lib/__tests__/policySaleRecording.test.ts` | modify (test) | D3 | _v2 routing only with an id, null keeps old name and args, PGRST202 fallback once, frozen retry keeps id, invalid id dropped; the chip selection under the request id is used only when no id was forwar | exists |
| `src/lib/__tests__/saleHandoffApis.test.ts` | modify (test) | D3 | PreparedSale.sourceCallId outside saleArgs for record and convert; prepareRecordPolicy/prepareConversion take the forwarded id, else the chip selection under the same request id; a frozen retry reuses | exists |

#### PKG-C/PKG-D (1 paths)

| Path | Action | Owner (+contributors) | Purpose | At base |
|---|---|---|---|---|
| `src/pages/__tests__/dialerPageReportsV2Exceptions.test.ts` | create (test) | D3 (+D4) | test_create by whichever of PKG-C/PKG-D lands first (X16): DialerPage equals the pinned base after removing only the approved PKG-C sourceCallId line (and the PKG-D type line once PKG-D lands); Twilio | new |

#### PKG-D (67 paths)

| Path | Action | Owner (+contributors) | Purpose | At base |
|---|---|---|---|---|
| `src/components/calendar/AppointmentOutcomePanel.tsx` | create | D4 | Held / No show buttons via record_appointment_outcome, original-slot nudge, closes the modal on success, mounts PolicyLinkPrompt for held sales appointments | new |
| `src/components/calendar/PolicyLinkPrompt.tsx` | create | D4 | Later linking from the appointment side (source outcome_entry) | new |
| `src/components/calendar/appointmentOutcomeGate.ts` | create | D4 | Pure original-slot due/nudge helper | new |
| `src/components/contacts/ClosingAppointmentField.tsx` | create | D4 | Optional selector (appointment / none / not_recorded; default Not recorded; never preselected); owns useClosingAppointmentLink and the validate/link calls (X11); hidden while loading, on load failure  | new |
| `src/components/contacts/PolicyAppointmentLinkStatus.tsx` | create | D4 | Policy-section entry for later linking (§2.12): 'Closing appointment: Not recorded · Link' for a policy with no effective appointment link (source policy_entry); renders only when get_policy_appointme | new |
| `src/components/settings/calendar/AppointmentTypeCategoryControl.tsx` | create | D4 | Row category control: read-only for locked rows; select for custom rows writing business_category with .select('id') | new |
| `src/hooks/useClosingAppointmentCandidates.ts` | create | D4 | RLS read of Completed sales-type appointments for the client, its lead_id or the converting lead within [Sold Date - 30, Sold Date] | new |
| `src/hooks/useClosingAppointmentLink.ts` | create | D4 | Owned by ClosingAppointmentField: choice state, closingAppointmentChoiceSchema validation, one link request id per selection, registration under the modal's sale request id in appointmentLinkRetry.ts; | new |
| `src/lib/appointmentLinkRetry.ts` | create | D4 | Module-level, not tied to any component: selection registry keyed by sale request id; onSaleSaved(saleRequestId, winIds) sends one link_policy_appointment per win (sale_entry) with the selection's req | new |
| `src/lib/appointmentOutcome.ts` | create | D4 | RPC adapter, appointmentOutcomeResultSchema, error mapping (PT409, 42501, 22023, permission denied; 55P03 and 57014 -> try again) | new |
| `src/lib/policyAppointmentLinks.ts` | create | D4 | get/link adapters with policyAppointmentLinksSchema and policyAppointmentLinkResultSchema, used by PolicyLinkPrompt, PolicyAppointmentLinkStatus and appointmentLinkRetry | new |
| `supabase/migrations/20261104120040_appointment_type_categories.sql` | create | D4 | Class C. business_category (CHECK) with classified_by/at; guard_appointment_type_classification (BEFORE, INVOKER; closes the locked-row API gap without an RLS change); private.appointment_type_categor | new |
| `supabase/migrations/20261104120041_appointment_occurrence_evidence.sql` | create | D4 | Class W. Capture windows, appointment_evidence_observations (previous and new start_time/status/type/user_id/updated_at per write), appointment_occurrences, appointment_assignment_events (every user_i | new |
| `supabase/migrations/20261104120042_policy_appointment_attributions.sql` | create | D4 | Class W. private.policy_appointment_attributions (one effective row per policy; idempotent by (org, request_id, win_id); no FK to wins; source sale_entry/outcome_entry/policy_entry/admin_correction),  | new |
| `supabase/migrations/20261104120043_reports_v3_appointment_facts.sql` | create | D4 | Class C, v3-only window step: md5(pg_get_functiondef)-preimage-guarded CREATE OR REPLACE of only report_v3_appointment_facts (real body: populations, evidence reconciliation, the §3.6 BC4 truth table  | new |
| `supabase/migrations/20261104120044_reports_v3_release_enable_pkg_d.sql` | create | D4 | Class E (renamed from …44_reports_v3_release_enable.sql, X4): byte copy of the updated supabase/ops/reports_v3_enable.sql (harness md5(prosrc) pins incl. the new helper body, basis flags and appointme | new |
| `supabase/migrations/rollback/20261104120040_appointment_type_categories.rollback.sql` | create | D4 | Class C. Drop the guard and audit triggers and functions; keep the column and the audit table | new |
| `supabase/migrations/rollback/20261104120041_appointment_occurrence_evidence.rollback.sql` | create | D4 | Class C. Drop the trigger, apply/classify functions and record_appointment_outcome; keep evidence, observation and gap tables; close the capture window | new |
| `supabase/migrations/rollback/20261104120042_policy_appointment_attributions.rollback.sql` | create | D4 | Class C. Drop the link RPCs and the visibility replica; keep the attribution table | new |
| `supabase/migrations/rollback/20261104120043_reports_v3_appointment_facts.rollback.sql` | create | D4 | Class C. Restore the stub helper and the prior basis flags inside a v3-only window (disable-v3 -> rollback -> the prior release enable) | new |
| `supabase/ops/appointment_evidence_disable.sql` | create (ops) | D4 | Class R (REVOKE only): trigger off, record_appointment_outcome revoked, outcomes window closed with ended_reason; evidence retained; the disabled interval reads as window-level capture_gap | new |
| `supabase/ops/appointment_evidence_enable.sql` | create (ops) | D4 | Class W: md5 pins checked, trigger on, GRANT EXECUTE on record_appointment_outcome(uuid, uuid, timestamptz, text) TO authenticated only, new capture window | new |
| `supabase/ops/appointment_type_category_baseline.sql` | create (ops) | D4 | Class R data write with no privilege statement (§2.8): separately approved exact-count baseline (36 rows: 6 sales, 6 follow_up, 6 recruiting, 12 review, 6 other) with per-name preimage guard and 36 op | new |
| `supabase/ops/appointment_type_category_baseline_revert.sql` | create (ops) | D4 | Class R data write with no privilege statement: recovery plan (C2-16), postimage-guarded reset of the 36 baseline rows to unclassified with 36 ops_revert events; captured snapshots keep their categori | new |
| `supabase/ops/reporting-accuracy/appointment_evidence_preflight.sql` | create (ops) | D4 | Class R (read-only script): aggregate preflight and post-release read-back: counts (incl. appointments with no assignee), trigger inventory (appointments_updated_at), writer and seed md5s, stub and fl | new |
| `scripts/tests/appointment-evidence-failure-boundaries.mjs` | create (test) | D4 | Multi-session node-postgres on PG 17.6: T-LOCK, T-CANCEL, T-REPLAY, T-DOUBLE, T-ASSERT for the evidence trigger and the outcome RPC, plus the BC5 writer gate (persist_booking, save_disposition_with_bo | new |
| `src/components/calendar/__tests__/appointmentOutcomeGate.test.ts` | create (test) | D4 | Original-slot gating incl. a past-due slot moved to the future | new |
| `src/components/calendar/__tests__/appointmentOutcomePanel.test.tsx` | create (test) | D4 | Visible only when due and open; single submit; per-open request id; closes on success | new |
| `src/components/contacts/__tests__/closingAppointmentField.test.tsx` | create (test) | D4 | Optional default 'Not recorded'; never preselected; hidden while loading, on failure or with none; never blocks; one request id per selection | new |
| `src/components/contacts/__tests__/policyAppointmentLinkStatus.test.tsx` | create (test) | D4 | T-RECOVER after reload: Not recorded · Link; linking with policy_entry; rendered only when the server returns the policy | new |
| `src/components/settings/__tests__/appointmentTypeCategoryControl.test.tsx` | create (test) | D4 | Locked read-only; custom select; zero-row update is a failure | new |
| `src/lib/__tests__/appointmentLinkRetry.test.ts` | create (test) | D4 | T-UNMOUNT and T-RECOVER: link continues after unmount or navigation; bounded retry; global Retry toast with the same request ids; rejection not retried | new |
| `src/lib/__tests__/appointmentOutcome.test.ts` | create (test) | D4 | Adapter args, Zod, error mapping | new |
| `src/lib/__tests__/policyAppointmentLinks.test.ts` | create (test) | D4 | Link adapters, schemas, rejection reasons | new |
| `src/lib/calendar/__tests__/appointmentTypeCategories.test.ts` | create (test) | D4 | Labels and selectable set exclude unclassified | new |
| `supabase/tests/appointment_occurrence_evidence.sql` | create (test) | D4 | E1–E14: transitions, Google system actor, RPC replay/PT409, writers still succeed, non-blocking E10/E10b/E10c with reconciliation, assignment events, observation chain | new |
| `supabase/tests/appointment_type_categories.sql` | create (test) | D4 | CHECK, locked guard, audit of classification/rename/is_active, provisioning seed categories, RLS md5 unchanged, baseline preimage refusal, revert postimage guard and its reporting effect | new |
| `supabase/tests/policy_appointment_attributions.sql` | create (test) | D4 | Authority (policy predicate + visible appointment), supersede-once, replica parity, non-raising rejections, Admin correction, idempotency by (org, request_id, win_id), reversal retention | new |
| `AGENT_RULES.md` | docs | D4 | All texts are proposed and pending: each lands only after Chris approves that exact text (§6.3 rule 1). Split landing (§6.3, RL-28): A-10, A-41b and the Sales Appointment evidence invariant with the P | exists |
| `docs/plans/2026-10-31-reports-v2/production-release.md` | docs | D4 | PKG-D evidence: preflight, baseline count approval, per-stage read-back, advisors, record-history and the permitted-environment telephony check (D1 creates the file) | new |
| `scripts/reports_release.py` | modify | D4 | X7: PKG-D stage constants (bytes, sha256, digests) for …40, the baseline step, …41, …42, disable-v3, …43, …44, read-back and record-history; D1 owns the stage machinery (PKG-A) | new |
| `src/components/contacts/ClientPolicies.tsx` | modify | D4 | One mount of PolicyAppointmentLinkStatus per policy (104 lines; also edited by PKG-B and PKG-C; the later package rebases) | exists |
| `src/components/contacts/RecordPolicyModal.tsx` | modify | D4 | One mount of ClosingAppointmentField fed from existing state (clientId, form.sold_date, requestId.current); nothing else (108 lines) | exists |
| `src/hooks/useAppointmentTypes.ts` | modify | D4 | Map business_category | exists |
| `src/lib/calendar/appointmentTypes.ts` | modify | D4 | AppointmentBusinessCategory, APPOINTMENT_BUSINESS_CATEGORIES, selectable subset, labels, appointmentBusinessCategorySchema, businessCategory on AppointmentTypeRecord | exists |
| `src/lib/dialer-api.ts` | modify | D4 | saveAppointment accepts optional type and spreads it only when non-empty (:373-381); A-22 | exists |
| `src/lib/policySaleRecording.ts` | modify | D4 | PKG-D contribution (RL-27): sendPreparedSale calls appointmentLinkRetry.onSaleSaved(prepared.requestId, result.winIds) right after the confirmed result, inside a guard that can never alter the sale; P | exists |
| `supabase/ops/reports_v3_enable.sql` | modify | D4 | PKG-D pin update (new report_v3_appointment_facts and report_v3_basis_flags md5s, appointment_evidence_classify); still grants exactly the 15 report readers TO authenticated, service_role; D1 is the s | new |
| `.github/workflows/reporting-integrity.yml` | modify (CI) | D4 | Add supabase/ops/appointment_* to path filters | exists |
| `src/components/calendar/AppointmentModal.tsx` | modify (protected/size exception) | D4 | A-§7 size exception (711 lines): one mount of AppointmentOutcomePanel after the status grid (:619-628); nothing else | exists |
| `src/components/contacts/ConvertLeadModal.tsx` | modify (protected/size exception) | D4 | A-§7 size exception (518 lines; forwarded props and at most one mount per package, RL-24; PKG-C adds sourceCallId and the SaleSourceCallChip mount), strictly mount-only for PKG-D (X11): one mount of C | exists |
| `src/components/settings/CalendarSettings.tsx` | modify (protected/size exception) | D4 | A-§7 size exception (1,061 lines): one mount of AppointmentTypeCategoryControl in the type list row (:655-662); nothing else | exists |
| `src/pages/DialerPage.tsx` | modify (protected/size exception) | D4 | A-§7(b): add 'type: data.type,' to the AppointmentModal onSave saveAppointment payload at :4677 only; :3566 and :4013-4030 byte-identical | exists |
| `scripts/reporting_fixture.py` | modify (test) | D4 | Add 'appointments' mode extending the booking harness (steps at :63-68) | exists |
| `scripts/reports_v3_fixture.py` | modify (test) | D4 | X7: PKG-D mode applies …40, the baseline, …41–…44 (found by suffix); release-enable byte check against the highest version | new |
| `scripts/run_reporting_integrity_tests.sh` | modify (test) | D4 | Add appointments to the TASK_MODE loop (:22) | exists |
| `scripts/run_reports_v3_tests.sh` | modify (test) | D4 | X7: adds the PKG-D suites (reports_v3_appointment_facts full suite and the evidence suites) and scripts/tests/appointment-evidence-failure-boundaries.mjs | new |
| `scripts/tests/reports_release_test.py` | modify (test) | D4 | X7: PKG-D stage-sequence rehearsal on disposable PG 17.6; refusal on byte or preimage drift; …44 compared as the highest-version release enable | new |
| `src/components/contacts/__tests__/clientPolicies.test.tsx` | modify (test) | D4 | One PolicyAppointmentLinkStatus mount per policy; nothing else changes | exists |
| `src/components/contacts/__tests__/convertLeadModalPolicyFields.test.tsx` | modify (test) | D4 | Exactly one field mount (X11); onSuccess/onClose not delayed; the optional field never blocks the Dialer conversion gate (#11) | exists |
| `src/components/contacts/__tests__/recordPolicyModal.test.tsx` | modify (test) | D4 | One field mount; the sale saves and the modal closes when the link is rejected or fails; the link starts from the sale library with the win ids | exists |
| `src/lib/__tests__/policySaleRecording.test.ts` | modify (test) | D4 | onSaleSaved runs once after a confirmed result (fresh or frozen retry), never on error, conflict or not-sent; a throwing hook never changes the sale result | exists |
| `src/lib/__tests__/reportsV3Contracts.test.ts` | modify (test) | D4 | Class map entries for …13, …40–…44, the rollbacks and the PKG-D ops scripts; exact W allowlists for …41, …42 and appointment_evidence_enable.sql; D1 creates the file | new |
| `src/lib/__tests__/saveAppointmentPayload.test.ts` | modify (test) | D4 | No type key when omitted (standalone callback, :94-102); type present when passed | exists |
| `src/pages/__tests__/dialerAppointmentSaveContract.test.ts` | modify (test) | D4 | Replace the 'no type:' assertion (:90-95) with 'type only through the conditional spread' | exists |
| `supabase/tests/reports_v3_appointment_facts.sql` | modify (test) | D4 | PKG-D full suite: brief §14 cases, the §3.6 truth table row by row, maturity (observed to date), credit, classification history, reconciliation, capture states, S14a/S14b/negative fixtures, as-of, reg | new |
| `supabase/tests/reports_v3_security.sql` | modify (test) | D4 | S15 effective/inherited privilege matrix gains the four PKG-D W functions (authenticated only in every state; record_appointment_outcome false after appointment_evidence_disable.sql); D1 creates the f | new |

#### PKG-F (133 paths)

| Path | Action | Owner (+contributors) | Purpose | At base |
|---|---|---|---|---|
| `THIRD_PARTY_NOTICES.md` | create | D5 | The full us-atlas 3.0.1 ISC notice (verbatim) and the Census 2017 cartographic boundary attribution, as recorded in the map provenance record | new |
| `scripts/geo/build-us-state-paths.mjs` | create | D5 | Generator using Node built-ins only, run by hand on npm pack us-atlas@3.0.1 in an empty temp directory outside the repo (tarball read as data). Pinned to the discovery-measured registry integrity sha5 | new |
| `src/components/reports/ActivityStrip.tsx` | create | D6 | Registered activity strip (cap 6, saved order) (<=60) | new |
| `src/components/reports/CustomizerGroup.tsx` | create | D6 | One customizer fieldset (Activity/Sections/Breakdowns) split out to keep ReportCustomizer <200 | new |
| `src/components/reports/KpiStatusNote.tsx` | create | D6 | Partial and In progress text chips (at most two) and the compact accessible disclosure (aria-expanded, keyboard, Escape) with notices, a of e, numerator/denominator, pending, Fully mature on and matur | new |
| `src/components/reports/KpiTile.tsx` | create | D6 | KPI tile: value (observed to date while In progress, never blanked), '—' with the short cue when unavailable, at most two text chips, loading/error; an unavailable 12/18/19 tile keeps its maturity blo | new |
| `src/components/reports/MoreMetrics.tsx` | create | D6 | Inline disclosure, open by default, every KPI not in the strip grouped Appointments/Journey/Time/Effort (<=100) | new |
| `src/components/reports/PremiumDetails.tsx` | create | D6 | Replaces PremiumCoverage: premium status content for KPIs 1 and 4 inside the chip disclosure and the production trend's 'Premium details' readout (known/missing/invalid from detail.premium), in the RL | new |
| `src/components/reports/ProductionCard.tsx` | create | D6 | One production card (KPIs 1-4) following the tile rules: value, at most two text chips, or '—' with the short cue; accent, hero sizing via heroValueSize, one-line money (<=90) | new |
| `src/components/reports/ReportBreakdowns.tsx` | create | D6 | Section 7 renderer for registered breakdowns (collapsed ReportSections) (<=60) | new |
| `src/components/reports/ReportExportMenu.tsx` | create | D6 | Toolbar Export menu (trigger keeps name 'Export'): Report summary, Journey, Sales appointments, each gated by panel currency (<=80) | new |
| `src/components/reports/ReportsEffortSection.tsx` | create | D6 | Section 2 shell: highlights 9/10/12/38, Period averages line, ActivityStrip, MoreMetrics (<=120) | new |
| `src/components/reports/ReportsProduction.tsx` | create | D6 | Section 1: four production cards (KPIs 1-4) following the tile rules; premium status on demand; sheet trigger (<=140) | new |
| `src/components/reports/ScaleLegend.tsx` | create | D6 (+D5) | Single unit-aware 5-step legend with no-activity (and D5 hatch) swatches, used by heatmap and state map (<=80) | new |
| `src/components/reports/agentPerformanceColumns.ts` | create | D6 | Agent table screen/CSV column definitions and envelope joins (12 from salesAppointments, 38 from journey); compact cell status; values rounded once at display and CSV precision | new |
| `src/components/reports/regional/RegionalPerformance.tsx` | create | D5 | Section shell mounted by D6 as section 5 (after Agent performance, before the Calling heatmap): 4-mode control, Map/Table toggle, compact status cue (Partial chip or unavailable cue) with an on-demand | new |
| `src/components/reports/regional/StateDetails.tsx` | create | D5 | Selected-state details (4 values plus premium completeness) and a Clear button | new |
| `src/components/reports/regional/StateMap.tsx` | create | D5 | SVG map: SCALE_FILL classes, roving keyboard focus, aria-pressed, hatch pattern paired with a labelled legend swatch, reduced motion | new |
| `src/components/reports/regional/StateMapSmallStates.tsx` | create | D5 | Buttons of at least 24 px for VT, NH, MA, RI, CT, NJ, DE, MD and DC | new |
| `src/components/reports/regional/StateTable.tsx` | create | D5 | Sortable accessible table with 51 rows and Mapped total, Unmapped (with reason disclosure) and Total footer rows | new |
| `src/components/reports/regional/UnmappedNotice.tsx` | create | D5 | Conditional one-line Regional 'not mapped' notice ('{n} calls not mapped to a state'), shown only when the mode's unmapped count is above 0, with the six reasons on demand. A-L2 permits it as one of t | new |
| `src/components/reports/regional/usStatePaths.ts` | create | D5 | Generated 51-path geometry under a /*! */ header carrying the full ISC copyright and permission notice and the 2017 Census source statement, plus in-object notice/license/source fields. viewBox -58 12 | new |
| `src/components/reports/useGridNavigation.ts` | create | D6 | Roving-focus grid keyboard logic for the heatmap | new |
| `src/hooks/useReportExports.ts` | create | D6 | exportFor and the KPI CSV menu with payload-identity gating; Note routing from reports-v3-text.ts (Coverage lines, CALLS_MADE_BASIS_NOTE, attempt_unverified notice, BREAKDOWN_CALLS_NOTE); writes no v2 | new |
| `src/hooks/useReportsPage.ts` | create | D6 | Selection, range, request, resolvedScope, drift across the 8 v3 panels and zone withholding (from Reports.tsx:30-74) | new |
| `src/lib/reports-kpi-format.ts` | create | D6 | Envelope -> display: roundHalfUp(n, d, k) from exact numerator/denominator (BigInt above 2^53; percentages n x 100 first), medians and currency rounded once from the exact value, '.0' trim, duration;  | new |
| `src/lib/reports-kpi-registry.ts` | create | D6 | Exactly 23 KPI definitions: the §2.4 fields (id, label, reader, unit, kind, eligible population, 30-day group, credit, date basis, display and CSV precision) equal to private.report_v3_metric_registry | new |
| `src/lib/reports-panels.ts` | create | D6 | PANEL_KEYS = [summary, journey, salesAppointments, states, volume, dispositions, campaigns, leadSources], each bound in FETCHERS to its v3 reader (volume, dispositions, campaigns, leadSources -> the f | new |
| `src/lib/reports-regional-rows.ts` | create | D5 | Table rows, sortStateRows, and buildStateCsv headers and rows | new |
| `src/lib/reports-regional.ts` | create | D5 | US_STATE_CODES, SMALL_STATE_CODES, REGIONAL_MODES, modeValue, formatModeValue (rounded once, §2.5) and reconcileStateBreakdown | new |
| `src/lib/reports-scale.ts` | create | D6 (+D5) | Single scale module (R19): SCALE_BG/SCALE_FILL/SCALE_TEXT, NO_ACTIVITY_* literal class arrays, bucketLevel; D5 adds buildStateScale | new |
| `src/lib/reports-v3-export.ts` | create | D6 (+D5) | Report summary (23 rows), journey, sales-appointments, production-trend and agent-performance CSV rows via buildKpiCoverageRows (21 columns, each value rounded once; RL-5 Basis/In progress/maturity va | new |
| `src/lib/reports-v3-queries.ts` | create | D1 (+D6) | D1 owner (+D6). REPORT_RPC_V3 with the nine v3 reader names and nine fetchers (fetchReportScopeV3, fetchReportSummaryV3, fetchReportJourneyV3, fetchReportSalesAppointmentsV3, fetchReportStateBreakdown | new |
| `src/lib/reports-v3-schemas.ts` | create | D1 (+D5,D6) | D1 owner (+D5, D6). All v3 Zod: REPORT_V3_KPI_IDS (23) and per-reader ids, REPORT_V3_REASON_CODES (29, registry order) with kinds, envelope superRefine per §2.2 with the maturity block, meta (reports_ | new |
| `src/lib/reports-v3-text.ts` | create | D6 (+D5) | REASON_NOTICES and SHORT_CUES (keys equal REPORT_V3_REASON_CODES: 29 codes in registry order, premium_invalid before premium_missing; attribution_unresolved = '{n} completed appointments not resolved' | new |
| `src/components/reports/__tests__/reportsEffortSection.test.tsx` | create (test) | D6 | Highlights, strip, More metrics exactly once | new |
| `src/components/reports/__tests__/reportsHeatmapKeyboard.test.tsx` | create (test) | D6 | Heatmap grid keyboard, tap and CSV | new |
| `src/components/reports/__tests__/reportsKpiTile.test.tsx` | create (test) | D6 | Tile states per §2.16: chips, cues, disclosure, In progress never blank; the 11 BC4 required cases; unavailable cohort tiles keep maturity details on demand | new |
| `src/components/reports/__tests__/reportsProduction.test.tsx` | create (test) | D6 | Production section | new |
| `src/components/reports/__tests__/reportsRegionalMap.test.tsx` | create (test) | D5 | Roving keyboard, aria-pressed, small-state buttons, summary line | new |
| `src/components/reports/__tests__/reportsRegionalPerformance.test.tsx` | create (test) | D5 | Modes, default, legend and units, compact status cues and disclosure, local selection, toggle, notice, lazy-load fallback | new |
| `src/components/reports/__tests__/reportsRegionalTable.test.tsx` | create (test) | D5 | aria-sort sorting, fixed footer rows, reason disclosure | new |
| `src/hooks/__tests__/useReportsPage.test.tsx` | create (test) | D6 | Selection and drift hook | new |
| `src/lib/__tests__/reportsKpiFormat.test.ts` | create (test) | D6 | REASON_NOTICES = SHORT_CUES = registry keys, placeholders and plurals, single rounding (§2.5 cases), chips and cues | new |
| `src/lib/__tests__/reportsKpiRegistry.test.ts` | create (test) | D6 | 23-entry registry, labels, partitions, percent and rate allow-lists, 30-day groups, dateBasis/credit enum strings per id | new |
| `src/lib/__tests__/reportsLayoutV5.test.ts` | create (test) | D6 | V4_TO_V5 and the R23 default rule | new |
| `src/lib/__tests__/reportsRegionalGeometry.test.ts` | create (test) | D5 | 51 keys, viewBox bounds, size caps, full ISC notice present, single importer | new |
| `src/lib/__tests__/reportsRegionalRows.test.ts` | create (test) | D5 | CSV headers and row order, unmapped and total rows, unavailable blanks, Note rows (including partial-mode notices), single rounding, formula neutralization, golden file | new |
| `src/lib/__tests__/reportsScale.test.ts` | create (test) | D6 (+D5) | Bucket thresholds, literal classes | new |
| `src/lib/__tests__/reportsV3Export.test.ts` | create (test) | D6 | 21 KPI CSV columns, Basis, maturity columns, single rounding, meta, panel_not_loaded, Note rows; the 11 BC4 required cases as CSV rows (maturity columns kept on unavailable 12/18/19 rows) | new |
| `src/lib/__tests__/reportsV3Fixtures.ts` | create (test) | D6 (+D5) | Synthetic v3 payload builders for the nine readers, plus the 11 BC4 required truth-table cases shared by the schema, tile and CSV tests (test path only) | new |
| `src/lib/__tests__/reportsV3MetricRegistry.test.ts` | create (test) | D1 | SQL report_v3_metric_registry() parsed from the *_reports_v3_foundation.sql migration = src/lib/reports-kpi-registry.ts: 23 ids with unit, kind, eligible population, 30-day group, credit, date basis,  | new |
| `src/lib/__tests__/reportsV3Queries.test.ts` | create (test) | D1 (+D5,D6) | D1 owner (+D5, D6). The page's RPC names are exactly the nine v3 readers, never a v2 reader, v1 or rpc_report_*; error mapping incl. 57014/PGRST202/platform 42501; call reader responses carry no polic | new |
| `src/lib/__tests__/reportsV3ReasonRegistry.test.ts` | create (test) | D1 | SQL registry parsed from the *_reports_v3_foundation.sql migration (found by suffix, X4) = REPORT_V3_REASON_CODES = Object.keys(REASON_NOTICES) = Object.keys(SHORT_CUES): 29 codes in registry order | new |
| `src/lib/__tests__/reportsV3Schemas.test.ts` | create (test) | D1 (+D5,D6) | D1 owner (+D5, D6). §2.2 superRefine cases (incl. partial + in progress, the X3 cases and the 11 required BC4 truth-table cases), markers, exact ids, v2 payload rejected, unknown or removed code rejec | new |
| `src/pages/__tests__/reportsV2Page.test.tsx` | create (test) | D6 | One-page structure in §18 order, v3-off behaviour (R23), only the nine v3 readers requested, View As, races | new |
| `src/pages/__tests__/reportsV3Compatibility.test.tsx` | create (test) | D1 | Revoked/missing/v2-shaped/wrong-major v3 responses fail closed; never v2 numbers (zero panel requests on v3-off asserted in D6 reportsV2Page.test.tsx) | new |
| `src/components/reports/AgentEfficiency.tsx` | delete | D6 | Retired (Calls per session hour, unselected #36) | exists |
| `src/components/reports/AgentEfficiencyScatter.tsx` | delete | D6 | Retired with AgentEfficiency | exists |
| `src/components/reports/CampaignTotalsFoot.tsx` | delete | D6 | Every cell is a *_attribution_unavailable field, which the v3 call readers do not return (§2.1); only CampaignPerformance imports it | exists |
| `src/components/reports/CommunicationsStats.tsx` | delete | D6 | Call summary retired | exists |
| `src/components/reports/PremiumCoverage.tsx` | delete | D6 | Replaced by PremiumDetails | exists |
| `src/components/reports/ReportsActivityFlow.tsx` | delete | D6 | Period totals retired | exists |
| `src/components/reports/ReportsOverview.tsx` | delete | D6 | Replaced by ReportsProduction | exists |
| `src/components/reports/StatCard.tsx` | delete | D6 | Superseded by KpiTile | exists |
| `src/components/reports/StatsGrid.tsx` | delete | D6 | Legacy stat rendering retired | exists |
| `src/components/reports/__tests__/ReportsOverview.test.tsx` | delete | D6 | Component retired | exists |
| `src/lib/__tests__/reportStatComputations.test.ts` | delete | D6 | stat-computations retired | exists |
| `src/lib/stat-computations.ts` | delete | D6 | Client-side stat registry and ratios retired | exists |
| `AGENT_RULES.md` | docs | D5 (+D6) | The Reports Regional performance invariant, verbatim from main plan §6.2, landing in the PKG-F PR before the PKG-F merge (§6.3). D5 carries no amendment text of its own; A-41 (the 15-reader enable all | exists |
| `docs/plans/2026-10-31-reports-v2/evidence/map-provenance.md` | docs | D5 | Isolated map provenance record (§5), written at implementation from the artifact actually downloaded: us-atlas 3.0.1 registry integrity (sha512) and tarball sha256; states-albers-10m.json sha256; the  | new |
| `docs/plans/2026-10-31-reports-v2/implementation_plan.md` | docs | D6 | Repository copy of the plan (branch work, §4.3); D6 section and the evidence/csv-capture procedure copy | new |
| `scripts/tests/reports-visual/README.md` | docs | D6 | Document the new checks (chips, disclosures, v3 request keys) and emulation limits | exists |
| `src/App.tsx` | modify | D6 | Lazy Reports route (:28 import -> lazy, precedent :47; :155 Suspense fallback) | exists |
| `src/components/reports/AgentPerformanceCards.tsx` | modify | D6 | Combined v3 table, viewer highlight, 12/38 joins with '—' when not current, compact cell status (value, short cue, text chips), AP sub-line only when detail.premium.missing or .invalid > 0, agency Una | exists |
| `src/components/reports/CallDurationAnalysis.tsx` | modify | D6 | outcomeLabel in chart and CSV; v3 disposition reader type (duration buckets) | exists |
| `src/components/reports/CallFlowAnalysis.tsx` | modify | D6 | Call flow from get_report_call_volume_v3 by_hour/by_weekday; rates rounded once; call-flow CSVs approved-changed (attempt population, v3 meta and Note rows) | exists |
| `src/components/reports/CallVolumeChart.tsx` | modify | D6 | Calling trend from get_report_call_volume_v3 by_date (weekly/monthly sums of exact counts); rate rounded once from the counts; call-volume CSV with v3 meta and Note rows (approved-changed) | exists |
| `src/components/reports/CallingHeatmap.tsx` | modify | D6 | Heatmap from get_report_call_volume_v3 (confirmed attempts); restyle, ScaleLegend, live details line, cell rate rounded once, Partial chip when call_population.unverified > 0, CSV 'Call contact rate % | exists |
| `src/components/reports/CampaignCallsChart.tsx` | modify | D6 | v3 campaign-calls row type | exists |
| `src/components/reports/CampaignPerformance.tsx` | modify | D6 | Call-only columns and CSV from get_report_campaign_calls_v3 plus the 'Calls without a campaign' and 'Other campaigns' rows (RL-4; Other campaigns shows Calls made, Contacted calls and the rate only, n | exists |
| `src/components/reports/DataBasisSections.tsx` | modify | D6 (+D5) | v3 sheet sections (definitions, credit labels incl. 'Assigned agent at the appointment time' and the BC3 rule (no individual credit without an assignee at start; agency totals and detail.unattributed  | exists |
| `src/components/reports/DispositionDeepDive.tsx` | modify | D6 | outcomeLabel in legend and CSV; v3 disposition reader type; swatch exception (A-§7(c)) | exists |
| `src/components/reports/DispositionsPieChart.tsx` | modify | D6 | Title 'Call outcomes' from get_report_disposition_breakdown_v3, outcomeLabel ('none' -> No outcome recorded), Progress share bar (replaces :121 style), swatch exception (A-§7(c)), Partial chip when ca | exists |
| `src/components/reports/HeatmapGrid.tsx` | modify | D6 | role=grid roving cells; token bucket classes replace inline style (:82); tooltip supplementary | exists |
| `src/components/reports/LeadSourceTable.tsx` | modify | D6 | Call-only columns from get_report_lead_source_calls_v3 plus the 'Not linked to a current lead' row (call columns sum to Calls made; New leads blank); Leads dialed/Contacted leads/Converted and convert | exists |
| `src/components/reports/PoliciesSoldChart.tsx` | modify | D6 | Production trend from summary production_by_date (daily, summed for week/month in exact cents); AP labels; 'Premium details' readout; production-trend CSV rounded once | exists |
| `src/components/reports/ReportContextLine.tsx` | modify | D6 | Sheet trigger rename; as_of from the summary reader | exists |
| `src/components/reports/ReportCustomizer.tsx` | modify | D6 | v5 groups: Activity (cap 6), Sections (visibility only), Breakdowns | exists |
| `src/components/reports/ReportDataBasis.tsx` | modify | D6 | 'How it's calculated' title and description | exists |
| `src/components/reports/ReportDataQuality.tsx` | modify | D6 | 'Coverage in this report' from current envelopes: every KPI not available or In progress, with the same lines as its chip disclosure, plus quality lines for KPIs 1, 2 (agency), 5, 15 (detail.disclosur | exists |
| `src/components/reports/ReportTableFrame.tsx` | modify | D6 | focus='region'/'grid' prop; grid mode omits scroller tabIndex (:49) | exists |
| `src/components/reports/ReportTrends.tsx` | modify | D6 | Heading 'Trends and call outcomes'; Call outcomes below the two trends | exists |
| `src/components/reports/ReportsToolbar.tsx` | modify | D6 | Sheet trigger rename; ReportExportMenu replaces the single Export button | exists |
| `src/components/reports/SectionRenderer.tsx` | modify | D6 | Render v5 'sections' (fixed order) and 'breakdowns' groups | exists |
| `src/components/reports/reportSectionMap.tsx` | modify | D6 | Bind the 8 v3 panels, mount D5 RegionalPerformance at position 5, pass currentUserId to the agent table (:82-90), drop stat components | exists |
| `src/hooks/useReportLayout.ts` | modify | D6 | :78 normalize drafts as version 5 | exists |
| `src/hooks/useReportsData.ts` | modify | D6 | Generic over the fetcher map from reports-panels.ts (8 panels, every one a v3 reader); panelGenRef from PANEL_KEYS (:155); scope via fetchReportScopeV3; key/abort/generation/readyDataRef/isCurrent and | exists |
| `src/index.css` | modify | D6 | Additive report tokens (:root and .dark): accents and scale-1..5 with foregrounds | exists |
| `src/lib/report-layout-constants.ts` | modify | D6 | Rewrite (1-98): v5 groups/registry (23 ids), MAX_VISIBLE_ACTIVITY=6, DEFAULT_LAYOUT v5, frozen V4_TO_V5 with literal V4_STAT_IDS/V4_DEFAULT_VISIBLE_STATS, v4-default rule (R23), normalizer v1-v5 -> v5 | exists |
| `src/lib/reports-basis-text.ts` | modify | D6 | Data basis wording replaced by How it's calculated (delegates to reports-v3-text); v2-only screen notes and convertedBySourceNote removed | exists |
| `src/lib/reports-export.ts` | modify | D1 (+D6) | D1 owner (+D6). buildKpiCoverageRows with the 21 §2.16 columns, each value rounded once at CSV precision with the one roundHalfUp exported by src/lib/reports-kpi-format.ts (PKG-F, §2.5, RL-45); typed  | exists |
| `src/lib/reports-queries.ts` | modify | D1 | D1 owner (+D6). Only: export callReportRpc (:107-159) and windowArgs (:161); widen ReportRpcName (:71) to the nine v3 names; 57014 -> timeout in kindForProviderError (:86-93); REPORT_RPC (:62-69) unch | exists |
| `src/pages/Reports.tsx` | modify | D6 | Seven-section one-page composition in brief §18 order (replaces :136-160); state moved to useReportsPage/useReportExports; <=150 lines | exists |
| `tailwind.config.ts` | modify | D6 | Expose report.* colour tokens | exists |
| `.github/workflows/reports-backend.yml` | modify (CI) | D6 | Change :72 REPORTS_SQL_PAYLOADS to ${{ runner.temp }}/reports-v3-payloads.json (written by D1's PKG-A v3 step before the 'Real Reports page' step at :69); drop the :18 'src/lib/stat-computations.ts' f | exists |
| `scripts/verify_reports_frontend.py` | modify (CI) | D6 | Must-pass Vitest tokens add 'report' and 'agentperformance' (:85-86) so the 7 orphan report tests run | exists |
| `scripts/tests/reports-visual/stubs.ts` | modify (test) | D6 (+D5) | :40-44 maps the nine v3 RPC names to scopeV3/summaryV3/journeyV3/salesAppointmentsV3/statesV3/volumeV3/dispositionsV3/campaignsV3/leadSourcesV3; a v2 name has no mapping; v5 layout stub | exists |
| `scripts/tests/reports-visual/verify.mjs` | modify (test) | D6 (+D2,D5) | Budgets, §18 hierarchy, 23-KPI inventory with at most two chips per tile and no sentence beneath, only the Period averages line and D5's conditional 'not mapped' notice as helper lines (A-L2), 320/zoo | exists |
| `scripts/tests/reports-visual/vite.config.ts` | modify (test) | D6 | :7-19 load $RUNNER_TEMP/reports-v3-payloads.json (REPORTS_SQL_PAYLOADS, D1's PKG-A step; RL-1: the nine v3 keys for agency, personal and team plus the v2 keys for the base-bundle CSV capture and old-t | exists |
| `src/components/reports/__tests__/agentPerformanceTable.test.tsx` | modify (test) | D6 | Viewer highlight, 12/38 joins, compact cell status, Unattributed tfoot from §2.4 detail names | exists |
| `src/components/reports/__tests__/reportCustomizer.test.tsx` | modify (test) | D6 | v5 groups, cap, fixed section order | exists |
| `src/components/reports/__tests__/reportPresentation.test.tsx` | modify (test) | D6 | SectionRenderer v5 | exists |
| `src/components/reports/__tests__/reportTrendCharts.test.tsx` | modify (test) | D6 | Production trend from v3 daily series in exact cents; calling trend rates rounded once from summed counts | exists |
| `src/components/reports/__tests__/reportsCallDuration.test.tsx` | modify (test) | D6 | Label mapping on the v3 disposition reader's duration buckets | exists |
| `src/components/reports/__tests__/reportsControls.test.tsx` | modify (test) | D6 | Toolbar Export menu trigger keeps name 'Export'; items gated by panel currency | exists |
| `src/components/reports/__tests__/reportsDataBasis.test.tsx` | modify (test) | D6 | Sheet name, Coverage in this report lines equal to the chip disclosures, quality lines (incl. numberless-calls and KPI 15 disclosures), credit labels, Calls made difference line | exists |
| `src/components/reports/__tests__/reportsDialerIntelligence.test.tsx` | modify (test) | D6 | No outcome recorded, Call outcomes from the v3 disposition reader, heatmap rate column, Partial cue when unverified > 0 | exists |
| `src/components/reports/__tests__/reportsTables.test.tsx` | modify (test) | D6 | Agent v3 columns; call-only campaign and lead-source screen and CSV with the 'Calls without a campaign', 'Other campaigns' and 'Not linked' rows reconciling to Calls made | exists |
| `src/components/reports/__tests__/reportsTrends.test.tsx` | modify (test) | D6 | Heading and Call outcomes placement | exists |
| `src/hooks/__tests__/useReportLayout.test.tsx` | modify (test) | D6 | v5 fixtures and drafts | exists |
| `src/hooks/__tests__/useReportsData.test.tsx` | modify (test) | D6 (+D5) | 8 v3 panels, stale/abort per panel, every fetcher a v3 reader | exists |
| `src/lib/__tests__/reportLayoutNormalization.test.ts` | modify (test) | D6 | v5 output and migrations | exists |
| `src/lib/__tests__/reportLayoutPersistence.test.ts` | modify (test) | D6 | Saves v5 snapshot | exists |
| `src/lib/__tests__/reportsBasisText.test.ts` | modify (test) | D6 | v2 SHA pins unchanged; How it's calculated golden; v3 constant pins | exists |
| `src/lib/__tests__/reportsContracts.test.ts` | modify (test) | D6 (+D5) | Allow-list (percent KPIs exactly 8, 17, 18, 19, 38; four 'rate' labels); recursive scans skipping __tests__ and *.test.*; surfaceFiles update; lazy route; swatch-only style (A-§7(c)) | exists |
| `src/lib/__tests__/reportsExportFormat.test.ts` | modify (test) | D1 | buildKpiCoverageRows: 21 columns, single rounding ((1249, 1000) -> 1.25; 1/3 % -> 33.3), maturity, Basis and In progress columns, Contract version row only when present, neutralization unchanged | exists |
| `src/lib/__tests__/reportsIntegrity.test.ts` | modify (test) | D6 | Native v3 payloads parse; §2.10 reconciliation invariants across the v3 panels (runIf REPORTS_SQL_PAYLOADS) | exists |
| `src/lib/__tests__/reportsPolicySource.test.ts` | modify (test) | D6 | v3 basis and policy_basis markers; cross-version rejection; no v2 policy Note string on v3 files | exists |
| `src/lib/__tests__/reportsQueries.test.ts` | modify (test) | D1 | D1 owner (+D6). Keeps the v2 error mapping (42501 -> denied; 'permission denied for function' -> unavailable; 55000 -> configuration; PGRST202 -> unavailable) and adds 57014 -> timeout (RL-49) | exists |
| `src/lib/__tests__/reportsRegistrySnapshot.test.ts` | modify (test) | D6 | Freeze v5 registry, DEFAULT_LAYOUT, cap, V4_TO_V5 | exists |
| `src/pages/__tests__/reportsPage.test.tsx` | modify (test) | D6 | Remove band/leader/Period totals/Dials cases; scope/drift/zone/export cases on v3 | exists |
| `src/pages/__tests__/reportsScopeIntegration.test.tsx` | modify (test) | D6 | Panel set (8 v3 panels) and scope_v3 | exists |

#### Must not touch in any package (65 paths)

`package-lock.json`, `package.json`, `scripts/dashboard_attention_release.py`, `scripts/reports_integrity_fixture.py`, `scripts/run_reports_rpc_tests.sh`, `src/components/dashboard/StatCards.tsx`, `src/components/dashboard/widgets/GoalProgressWidget.tsx`, `src/components/leaderboard/AgentScorecardModal.tsx`, `src/components/leaderboard/LeaderboardRankingsTable.tsx`, `src/components/leaderboard/RecentWinsPanel.tsx`, `src/components/leaderboard/leaderboardPremium.ts`, `src/components/reports/CustomReportBuilder.tsx`, `src/components/reports/ScheduledReportsModal.tsx`, `src/components/settings/calendar/appointmentTypeSchema.ts`, `src/config/permissionDefaults.ts`, `src/constants/us-geo.ts`, `src/contexts/CalendarContext.tsx`, `src/contexts/TwilioContext.tsx`, `src/hooks/useLeaderboardData.ts`, `src/hooks/usePermissions.ts`, `src/hooks/usePolicySaleSubmission.ts`, `src/lib/__tests__/conversionEntryPoints.test.ts`, `src/lib/contactFollowUps.ts`, `src/lib/dashboard-callbacks.ts`, `src/lib/inboundCallOwnership.ts`, `src/lib/leaderboardRequestGate.ts`, `src/lib/performanceQueries.ts`, `src/lib/performanceSummary.ts`, `src/lib/report-layout.ts`, `src/lib/report-utils.ts`, `src/lib/reports-integrity-text.ts`, `src/lib/reports-policy-text.ts`, `src/lib/reports-schemas.ts`, `src/lib/supabase-clients.ts`, `src/lib/us-states.ts`, `src/lib/viewAsSurfaces.ts`, `src/lib/win-trigger.ts`, `src/pages/Contacts.tsx`, `src/utils/stateUtils.ts`, `supabase/functions/_shared/googleSheets/values.ts`, `supabase/functions/google-calendar-inbound-sync/index.ts`, `supabase/functions/import-contacts/index.ts`, `supabase/functions/twilio-voice-inbound/twiml.ts`, `supabase/functions/twilio-voice-webhook/index.ts`, `supabase/migrations/20260806000000_baseline_production_schema.sql`, `supabase/migrations/20260823222528_inbound_identity_foundation.sql`, `supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql`, `supabase/migrations/20261003043122_dialer_disposition_dnc_integrity.sql`, `supabase/migrations/20261003192907_contact_history_operational_events.sql`, `supabase/migrations/20261004000819_leaderboard_sale_recording.sql`, `supabase/migrations/20261005161611_policy_identity_sale_integrity.sql`, `supabase/migrations/20261005161623_performance_reporting_contract.sql`, `supabase/migrations/20261005161629_booking_disposition_receipts.sql`, `supabase/migrations/20261006043731_reports_integrity_readers.sql`, `supabase/migrations/20261006043738_reports_scopes_and_policy_premium.sql`, `supabase/migrations/20261010043358_reports_overlap_release_disable.sql`, `supabase/migrations/20261010043517_reports_overlap_release_enable.sql`, `supabase/migrations/20261017043142_performance_sold_date_basis.sql`, `supabase/migrations/20261019170000_policy_commission_tracking.sql`, `supabase/migrations/20261020040000_policy_commission_expected_windows.sql`, `supabase/migrations/20261020212000_policy_commission_center_reads.sql`, `supabase/migrations/20261021200000_lead_client_conversion_preservation.sql`, `supabase/ops/reports_disable.sql`, `supabase/ops/reports_enable.sql`, `supabase/ops/reports_integrity_enable.sql`

#### Must not touch in the named packages only (changed elsewhere; 4 paths)

`src/components/contacts/FullScreenContactView.tsx` (not in PKG-D); `src/components/layout/FloatingDialer.tsx` (not in PKG-D); `src/lib/policySaleOutcome.ts` (not in PKG-D); `src/pages/DialerPage.tsx` (not in PKG-A/PKG-B, PKG-F)


## 9. Backend actions per package, in order, with gates

**Nothing here is authorized by approving branch work.**
- Every production action below needs its own approval (§4.3).
- Every runner stage also needs the `cgarness` environment approval.
- Read-only steps run as `begin transaction read only; <SELECT>; rollback;`, return aggregates only, and write nothing.
- Every package stops on any refusal.

### 9.1 PKG-A: v3 contract

| # | Action | Gate |
|---|---|---|
| A1 | **Read-only preflight** (`supabase/ops/reports_v3_preflight.sql`) checks: head and migration count; no v3 object exists; the 15 v2 tuples and 12 closure-helper tuples; privilege matrix and default ACL; time-zone coverage. Aggregate baselines: KPI 5 attempt classes (attempts, non-attempts, unverified), KPIs 1–4, KPI 7, the unlinked-call number counts (§2.11), and the count of members with a captured phone change before their anchor (RL-19). It also covers the NULL-assignee appointment rows (RL-32), plus the D5 state × reason and contacted cells with the 12 excluded call rows re-measured. Every release-matrix figure is re-measured under the attempt classes and the history standard. It reads the deployed `twilio-voice-webhook` and compares its admission branch with the repository. Advisors are captured by finding identity | Phase 4, before the PKG-A approval |
| A2 | **Rehearsal** on PG 17.6 loopback: every SQL suite, the runner state machine, the performance gate (all nine readers) and EXPLAIN plans | Exact-head CI green. **Open (PKG-A release checklist, updated 2026-11-02, Batch 6):** `reports_v3_performance.sql` is built and runs in the v3 runner; it records p95, budget, EXPLAIN (ANALYZE, BUFFERS) and a verdict per combination. The journey reads one member set for the scope and every by_agent row, with candidates first and full history kept. The gate is **not passed**: locally (PG 16.15), summary and state at 366-day agency scope and journey at every combination miss their p95 targets; PG 17.6 CI at the final head misses the same combinations, and a faster runner missed only at 366-day agency scope (see `WORK_LOG.md`). `reports_v3_release.sql` with the ops scripts is still to come |
| A3 | **Security review** of the actual reader SQL and the S1–S15 / S14a / S14b results on the exact commit (§2.9). The sign-off is recorded in `production-release.md` | Named reviewer; bodies frozen afterwards |
| A4 | Renumber the placeholders above the then-current head (filename-only commit). Merge the backend-only PR, which includes the PKG-A AGENT_RULES amendments (§6.3); it has no application code change, and test-only paths are allowed. **Chris confirms the Supabase "Deploy to production" integration is OFF** | Chris approval |
| A5 | Runner `check`: read-only state, pins, grants, no v3 objects | Environment approval |
| A6 | Runner apply …10 → …11 → …12 → …13 → …14 → …15. Each runs as `psql --single-transaction` of the pinned bytes, with `lock_timeout 2s`, replay refusal, dependency guards and postconditions. Every object is created sealed: class C, no GRANT | One environment approval per stage |
| A7 | Runner apply-index-concurrently (…16): outside a transaction, `lock_timeout 2s`, `indisvalid` check | Environment approval |
| A8 | **STOP.** Independent read-only verification over MCP: all v3 objects sealed, tuples equal the harness, index valid, v2 unchanged | Chris go-ahead |
| A9 | apply-enable (…17 = `reports_v3_enable.sql`): pins, completeness, seal, class E grants (15 readers to authenticated and service_role), effective-privilege check | Chris approval |
| A10 | Read-back (`reports_v3_readback.sql`), in one read-only transaction: pins; the §2.8 privilege matrix including inherited roles; role-simulated reads of all nine readers at agency, team, personal and agent-filter scope under 8 s (fails on 57014 or above 4 s); the §2.10 invariants, including v2 − v3 = non-attempts + unverified. Advisors: expected `authenticated_security_definer_function_executable` +9 and `unused_index` +2 | Required before record-history |
| A11 | record-history: `migration repair <version> --status applied` per file, in order, each digest verified. No `db push`. Release evidence is then committed on the branch and lands with the next package PR; it has no rule text. It covers the WORK_LOG entry, `production-release.md`, `verification.md` and the context snapshot | Chris approval |

### 9.2 PKG-B: audited AP corrections

| # | Action | Gate |
|---|---|---|
| B1 | Read-only preflight: `performance_sale_monthly` preimage md5(`pg_get_functiondef`) `51e06b46a13c3a8eec4d672bec158376`; pins `deb0d333…` and `performance_monthly 7e706331…`; advisors baseline; coordination with draft PR #486 (its functiondef pin changes) | Separate Chris PKG-B approval, including the RLS/security write review |
| B2 | Merge the PKG-B backend PR with its amendments (A-40, A-34, A-851). Renumber first | Chris approval |
| B3 | Runner `check` → disable-v3 → …20 (ledger, guard trigger, book parser, effective reader, guarded `performance_sale_monthly` replacement, RPCs created sealed) → …21 (stub and flags replacement to 3.1.0; class W grants on the 2 RPCs) → apply-enable (…22) | Environment approval per stage; …20 refuses unless v3 is disabled |
| B4 | Read-back: definitions and pins; RPC ACLs (authenticated only); ledger with RLS, 0 rows and 3 triggers; per-win value identity (`reconcile_reports_v3_production.sql`); the summary under 8 s. Advisors: only +2 `authenticated_security_definer_function_executable`. Then record-history | Environment approval |
| B5 | Merge the PKG-B frontend (correction dialog, history, policy-section sale-versus-current display, one FullScreenContactView prop) with the §7 FullScreenContactView size exception | Chris approval |
| B6 | **Divergence manifest.** For each of the 2 policies, Chris or an Admin classifies premium and Sold Date separately. A premium entry error is corrected through the UI/RPC. The manifest PR is reviewed. `check_sale_correction_manifest.sql` confirms a ledger revision exists for each premium entry error. A Sold Date entry error goes to a separately scoped package or an explicit acceptance. Optionally, an Admin freezes the 1 legacy-fallback sale at its current amount (RL-15); the freeze is also recorded in the manifest | Chris/Admin decision; no direct SQL, no batch |

### 9.3 PKG-C: producing-call capture (including IN-A)

| # | Action | Gate |
|---|---|---|
| C1 | Read-only preflight: handoff md5 pins (`record_client_policy_handoff` `d39e03a7…`, `convert_lead_to_client_with_sales_handoff` `4d6803ff…`); catalog and grep check of every `clients.lead_id` writer; link and failure tables absent; advisors baseline | Separate Chris PKG-C approval, including ★6 and DialerPage clause (a) |
| C2 | Merge the PKG-C backend PR with its amendments (A-618, A-591) | Chris approval |
| C3 | Runner …30: `clients_lead_id_guard` **first**, then `private.policy_sale_call_links` (RLS on, no policies, REVOKE ALL, no FK) and its guard | Environment approval; #APPROVE_RLS_CHANGE level for the guard |
| C4 | Runner …31: `capture_policy_sale_call_link` (function-level `SET lock_timeout = '100ms'`), `private.policy_sale_call_link_failures`, the two `_v2` wrappers, `retry_policy_sale_call_link`; class W grants to authenticated. Followed by a synthetic smoke test of the wrappers and grants | Environment approval |
| C5 | **Telephony gate, then the frontend merge:** read the current `TwilioContext.tsx` (unchanged); run the Save Only / Save & Next suites, `floatingDialerDisposition`, `saveAppointmentPayload`, dialer-dnc-backend and the IN-A UI tests; check call-row creation, status, dispositions and logs in a permitted environment. No real prospects or messages. Merge with A-§7(a) and the FloatingDialer and ConvertLeadModal size exceptions. Forward capture starts at merge | Chris merge approval |
| C6 | v3-only window: disable-v3 → …32 (preimage-guarded stub and flags replacement) → apply-enable (…33) → read-back (KPI 38 statuses, privilege matrix) → record-history | Environment approval per stage; no user impact (no v3 consumer yet) |

### 9.4 PKG-D: Sales Appointment evidence

| # | Action | Gate |
|---|---|---|
| D1 | Read-only preflight (`appointment_evidence_preflight.sql`): kind, type and status counts; receipt writer signatures; per-name category counts (baseline preimage: 36 locked defaults, 0 custom); trigger inventory; md5 of `persist_booking` and the booking guards | Separate Chris PKG-D approval, including ★1 for 12/18 and DialerPage clause (b) |
| D2 | Merge the PKG-D backend PR with its amendments (A-10, A-41b, the Sales Appointment invariant) | Chris approval |
| D3 | Runner …40: category column, guard, and an audit covering classification, rename and `is_active` | Environment approval |
| D4 | **Category baseline write** `appointment_type_category_baseline.sql`: 36 rows (6 sales, 6 follow_up, 6 recruiting, 12 review, 6 other) with 36 audit events, under a per-name preimage guard. The revert script is rehearsed first | **Separate exact production-write approval by count (#28)** |
| D5 | Runner …41 (windows, occurrences, assignment and outcome events, gaps, non-blocking trigger with function-level `SET lock_timeout = '200ms'`, `record_appointment_outcome` with a class W grant) and …42 (attributions; class W grants). Each is followed by a read-back: md5s, owner, search_path, 0 anon-executable, trigger enabled, one open window, gaps 0. **BC5 precondition:** the branch suites show, for every writer, the create, update and delete sequences with both capture and gap writes failing, each with its detecting durable source or the stated unobservable limit (§2.12) | Environment approval per stage |
| D6 | **Telephony gate, then the frontend merge:** category control, outcome panel, policy-link prompt, closing-appointment field (optional on every path) with recoverable linking, optional `saveAppointment` type, the DialerPage :4677 line. Merge with A-22, A-§7(b) and the AppointmentModal and CalendarSettings size exceptions | Chris merge approval |
| D7 | v3-only window: disable-v3 → …43 (preimage-guarded replacement, including evidence reconciliation) → apply-enable (…44) → read-back → record-history | Environment approval per stage; no user impact |
| D8 | Incident-only scripts: `appointment_evidence_disable.sql` / `_enable.sql` and the baseline revert | Separate approval at use |

### 9.5 PKG-F: the Reports V2 page

| # | Action | Gate |
|---|---|---|
| F1 | Read-only: the 9 v3 readers are executable only by authenticated and service_role; `report_v3_basis_flags()` shows all three bases installed; `report_layouts` count by version (0 today) | After A–D |
| F2 | Read-only manifest check passes, and any Sold Date entry error is resolved or accepted | Completion precondition |
| F3 | CSV golden rebaseline: itemized approved-changed / new / retired diff on the combined payload. Base bundle on v2 keys, candidate on v3 keys. No page CSV stays identical, because the call CSVs now use the attempt population | Chris approves the diff |
| F4 | Protected preview review (available from PKG-A onward): desktop and mobile, three scopes, exports, every data state | Chris review; no merge |
| F5 | Merge to main with the PKG-F amendments (A-L1–A-L3, A-§7(c), Regional invariant). Verify both Vercel projects READY at the merge SHA. Served-bundle check: requests only v3 readers. Targeted reconciliation, WORK_LOG entry, context snapshot | **Chris explicit frontend release approval**, which is also the completion confirmation (§4.2) |
| F6 | Rollback R4: promote the previous Vercel deployment. No database action | Chris approval |

### 9.6 Recovery (defined before any production approval)

**Never:**
- re-grant `rpc_report_*`;
- drop correction, evidence, link or failure tables;
- break old tabs (v2 stays granted throughout).

| Situation | Steps |
|---|---|
| R1: v3 off | `reports_v3_disable.sql`. The new page shows "Reports unavailable" and old tabs work |
| R2: all Reports off | `reports_all_disable.sql`. Restore with `reports_v3_enable.sql`, or with `reports_integrity_enable.sql` (v2 only; seals v3) after a frontend rollback |
| R3: re-enable | `reports_v3_enable.sql`. A drift refusal fails closed |
| R4: frontend rollback | Promote the previous Vercel deployment |
| R5: PKG-A structural rollback | The rollback file runs only while v3 is disabled and drops only v3 objects; then the optional concurrent index drop |
| R6: appointment capture incident | `appointment_evidence_disable.sql`. Evidence is retained; the disabled interval reads as `capture_gap` |

### 9.7 Future packages (listed only; each needs its own reviewed scope)

- Historical sale-call link repair (0 candidates today).
- Reviewed classification of the 9 unverified call rows (★3).
- Call-identity repair for the 2,298 unlinked calls.
- Lead-receipt repair.
- Duplicate mappings: 5 shared-SID groups and 12 booking candidates.
- Sold Date correction and duplicate voids (D2-9).
- Commission estimates on the corrected premium (D2-8).
- Google inbound sync display fix.
- Cross-surface Calls-made alignment (★9).
- PKG-E event-time state snapshots.


## 10. Tests

All tests use synthetic fixtures: a disposable loopback PostgreSQL 17.6 with multi-session node-postgres for concurrency and cancellation, Vitest, the Python runner rehearsal, and the Playwright/axe visual gate. There is no production data and there are no real calls or messages. The full per-case list, with the file, kind and package of each case, is in `appendix/tests.md`. That list is generated from the six reconciled sections.

### 10.1 New in revision 2

| Review item | Tests |
|---|---|
| R01 inbound end-to-end | `saleSourceCallChip.test.tsx` and `useActiveInboundCallRow.test.tsx`. Active inbound call → attached and removable; ended < 30 min → offered unselected; nothing when no call. `policy_sale_call_links.sql` adds inbound validation (another agent's inbound call, voicemail, wrong identity, > 24 h → rejected; a claimed answered call → linked). `dialerPageReportsV2Exceptions.test.ts` pins `TwilioContext.tsx` byte-identical. J1b stays as the classifier test |
| R02 attempt classes | `reports_v3_call_readers.sql`: one fixture per class (legacy, admitted, refused, missing admission, reviewed duplicate, admitted-but-failed); every invariant in §2.10, including v2 − v3 = non-attempts + unverified; the "Calls without a campaign", "Other campaigns" and "Not linked" rows; `call_population` on all four readers; Partial when unverified > 0. C4 and C11 updated |
| R03 maturity | Contract fixtures: in progress with a non-null observed value; the mature subset never includes immature successes; a zero denominator stays unavailable; partial and in progress together. J8 and R4 assert the maturity instant and `fully_mature_on`. `reportsKpiTile.test.tsx` shows at most two chips. `reportsV3Export.test.ts` covers the Basis, Pending and Mature columns |
| R04 privacy | `reports_v3_security.sql`: S14a (unrelated identities, every reader, personal and team, including cross-org); S14b (E1–E6 each: the exact expected change, nothing else, removal restores bytes; plus a negative fixture) |
| R05 privileges | `reportsV3Contracts.test.ts`: file → class map; GRANT parser with exact allowlists; no anon/PUBLIC; no `rpc_report_*`. S15 effective and inherited matrix across the enabled, v3-off, all-off and rolled-back states |
| R06 AP lifecycle | `policy_sale_premium_correction.sql` `consumer_consistency_after_correction` (including state AP); `check_sale_correction_manifest` pass/fail fixtures; `recentWinsPremium.test.tsx` (renders `premiumSold`, never `premium_amount`); `rawPremiumConsumers.test.ts` (no live importer of the raw-premium helpers or `AgentScorecardModal`); `usePremiumCorrectionSubmission.test.tsx` (invalidation keys, success copy); `correctedPremiumSurfaces.test.tsx` (Leaderboard row, Dashboard AP card and Goal progress, Recent Wins before/after); the PKG-F Reports browser before/after scenario; the legacy-fallback `freeze` test |
| R07 failure boundaries | `sale-call-link-failure-boundaries.mjs` and `appointment-evidence-failure-boundaries.mjs`: T-LOCK, T-CANCEL, T-REPLAY, T-DOUBLE, T-ASSERT. E10/E10b/E10c rewritten; E10b now proves reconciliation reports the gap |
| R08 appointment credit and history | `reports_v3_appointment_facts.sql`: reassignment before and after start; late outcome entry; no assignee at start → creator credit (`credit_from_creator`) or agency-only; deactivate and rename after booking; unclassified custom type gives Partial; no classification at all gives unavailable; a reverted baseline is skipped; a legacy-only KPI 15 window is Partial with a value |
| R09 recovery | `saleCallLinkRetry.test.ts`, `appointmentLinkRetry.test.ts`, `closingAppointmentField.test.tsx`, `recordPolicyModal.test.tsx`: unmount and navigation during in-flight retry; network failure; replay with the same request id; recovery after reload via the policy-section Retry; rejected links not retried; sale success state unchanged |
| R10 history standard | `reports_v3_journey.sql`: an unresolved earlier call **outside the window** to the member's number → unassessable; an unrelated number → assessable; numberless → Partial at org level; phone-change history; E5 in S14b |
| R11 consistency | `reportsKpiFormat.test.ts` single rounding: (1249, 1000) → 1.2 display / 1.25 CSV; (9, 4) → 2.3; (115, 100) → 1.2; (0, 5) → 0.0. `reportsV3MetricRegistry.test.ts` (SQL = TS; percentages exactly 8, 17, 18, 19, 38). Truth-table fixtures for every KPI class (KPI 16 Partial when outcomes are missing). `reportsV3ReasonRegistry.test.ts` (29 codes; registry = notices = short cues) |

### 10.1a Binding-condition tests (2026-11-01)

| Condition | Tests (added failing first, then fixed in the affected package) |
|---|---|
| BC1 | `reports_v3_security.sql` S14a additions: an unrelated out-of-scope numberless call added or removed, and unrelated unresolved activity while an in-scope person has a phone change. Personal and team values, status, coverage and reasons are unchanged; agency diagnostics may change. S14b keeps E1–E6, with E5 member-specific only |
| BC2 | `reports_v3_journey.sql`: receipt Oct 1 and sale Oct 5 with no call give KPI 14 = 4 days and KPI 38 Unclassified; a non-buyer first contact sits in KPI 19's cohort and contributes to KPI 21; a prior confirmed no-answer call still allows KPI 38 Yes; a number-matched no-answer call makes the person unassessable for KPI 21 but not for KPI 19 |
| BC3 | `reports_v3_appointment_facts.sql`: a missing assignee gives agency totals only and no individual credit (never the creator); reassignment before and after start; late outcome entry. KPI 15 setter rule unchanged |
| BC4 | The §2.2 required truth-table cases, asserted identically in `reports_v3_contract.sql` (SQL), `reportsV3Schemas.test.ts` (Zod), `reportsKpiTile.test.tsx` (UI) and `reportsV3Export.test.ts` (CSV). The maturity block is kept when the value is unavailable |
| BC5 | `appointment-evidence-failure-boundaries.mjs`: insert, update and delete with both capture and gap writes failing, for each writer, including create-then-delete with no current row and later successful writes. Each case asserts its detecting durable source, or the documented unobservable limit |

### 10.2 Brief §14 acceptance cases → tests

| Case | Where proven |
|---|---|
| Two policies for one buyer | `policy_sale_premium_correction.sql` two-policies; `reports_v3_sale_facts.sql` rollups (KPI 3 dedup); J4 |
| Retry or unrelated edit | E1; L1–L11 idempotent; correction retries; T-REPLAY |
| Premium typo correction | typo_100_to_120 ($1,200 → $1,440); state_ap_after_correction (TX +$240) |
| Correction concurrency | idempotent_retry_and_conflicts; `sale-premium-correction-concurrency.mjs` |
| Commission dependency | append_only_and_no_side_effects (all `policy_commission_*` fingerprints unchanged) |
| Reassignment | sale_facts original-seller credit; C10; appointment reassignment before and after start (R08) |
| Contact boundary | C1 (45 s fails, 46 s passes, qualifying disposition passes, No Answer fails) |
| Ordinary inbound activity | C3 |
| Inbound journey evidence | J1, J1b, plus the IN-A UI tests (end to end) |
| Appointment category | R1, plus the classification-history tests (R08) |
| Reschedule and missed occurrence | E2/E3; R2 |
| Missing appointment outcome | R3 (KPI 17 Partial with coverage; KPI 16 Partial `outcomes_unresolved`) |
| Cross-month conversion | J9; R4 (observed to date, maturity instant) |
| Multiple policies from one appointment | R5 |
| Missing conversion attribution | R6 (attribution_unresolved; `no_attributed_policies`) |
| One-call wrap-up | J3 |
| One-call unknowns | J4; T-DOUBLE (an unrecorded link → Unclassified) |
| Outside sales | J5; state outside sale |
| History and imports | J6; the R10 history-standard fixtures |
| Selected-agent history | J7; S14b E1/E2 |
| Calls per lead | C8 (including `attempt_unverified`) |
| Zero and missing values | Contract truth tables; kpi_1_4_status_reason_matrix; C12 |
| Aggregate correctness | C6; rollups; state event cardinality |
| Time | C9 (2026-11-01 PDT→PST); J8; shared DST fixture |
| Security and races | S1–S15, S14a/S14b; `useReportsData.test.tsx` (late responses dropped, stale export refused) |
| Contract cutover | `reportsV3Compatibility.test.tsx`; `reportsV2Page.test.tsx` (v3-off → "Reports unavailable", zero panel requests, never a v2 request) |
| Copy and scope | `reportsKpiRegistry.test.ts` (exactly 23); `reportsEffortSection.test.tsx`; `reportsBasisText.test.ts`; compact-chip visual checks |

### 10.3 Brief §21 checks → tests

| Check | Where proven |
|---|---|
| Scope/layout and section order | `reportsV2Page.test.tsx`; visual gate (brief §18 order) |
| Metric inventory | `reportsKpiRegistry.test.ts`; 23-KPI visual inventory |
| Reference fidelity | Visual gate (no arrows or comparisons) |
| Dense detail | `reportsKpiTile.test.tsx` (chips only; details on demand); `reportsDataBasis.test.tsx` |
| Time heatmap | `reportsHeatmapKeyboard.test.tsx`; Σ heatmap = KPI 5 (v3) in `reportsIntegrity.test.ts` |
| Regional metric modes | `reportsRegionalPerformance.test.tsx` |
| Event cardinality, geographic identity, legacy basis, normalization | `reports_v3_state_breakdown.sql` |
| Reconciliation | R1/R9 cross-reader equalities (v3 population); state_ap_after_correction |
| Missing premium, outside sale | State premium states; J5 |
| Scope change/race | `useReportsData.test.tsx` |
| Map selection, small states/mobile | `reportsRegionalMap.test.tsx`, `reportsRegionalTable.test.tsx`; visual gate |
| Responsive quality | `verify.mjs` |
| CSV | `reportsV3Export.test.ts` (21 columns, single rounding); `reportsRegionalRows.test.ts`; `reportsExportFormat.test.ts`; CSV golden |
| Performance | `reports_v3_performance.sql`; build check; no per-state fan-out |
| Release recovery | `reports_v3_release.sql`; `reports_release_test.py` |


## 11. Required checks for every shipping stage (against the exact base)

Base for comparison: `6e39c15`, or the exact base of each package branch. Pre-existing failures are compared, not fixed.

| Check | Command or entry point | Pass condition |
|---|---|---|
| Root TypeScript | `npx tsc --noEmit` | Passes. It checks no files at base, so it is necessary but not sufficient |
| App TypeScript | `npx tsc -p tsconfig.app.json --noEmit` | Error set ⊆ the 80 pre-existing base errors (none in Reports). No new error in any touched file |
| Scoped lint | `npx eslint` on every touched file plus `src/components/reports src/lib/reports-* src/lib/report-* src/pages/Reports.tsx src/hooks/useReport*` | 0 problems (base: 0) |
| Reports Vitest | The reports filter in `scripts/verify_reports_frontend.py` (now including the `report` and `agentperformance` tokens) | Base: 28 files, 429 pass. All pass after approved snapshot and contract rebaselines |
| Adjacent Vitest | Policy, performance, leaderboard, appointment, calendar and dialer suites touched by B, C and D | Base: 18 files, 228 pass. All pass |
| Full Vitest | `npx vitest run` | No new failing file beyond the 11 known at base |
| SQL suites | `scripts/run_reports_v3_tests.sh` (new; includes `reports_v3_call_readers.sql`, S14a/S14b/S15), `run_reports_integrity_tests.sh`, `run_reports_rpc_tests.sh`, `run_reporting_integrity_tests.sh` (B, D), `run_policy_commission_tests.sh` (C), dialer-dnc-backend (C, D) | All pass on disposable loopback PG 17.6 (CI). The runners refuse non-loopback hosts. Local branch runs use the container's PG 16.15 loopback cluster; each batch snapshot names the version, and PG 17.6 CI on the exact head remains the gate |
| Privilege classes | `reportsV3Contracts.test.ts` (file → class map and GRANT parser) plus the effective/inherited matrix in `reports_v3_security.sql` | Exact allowlists (§2.8). `rpc_report_*` sealed in every state |
| Failure boundaries (C, D) | `scripts/tests/sale-call-link-failure-boundaries.mjs`, `scripts/tests/appointment-evidence-failure-boundaries.mjs` (multi-session node-postgres) | T-LOCK, T-CANCEL, T-REPLAY, T-DOUBLE and T-ASSERT behave as specified in §2.12 |
| Release rehearsal | `scripts/tests/reports_release_test.py` | Every stage and refusal for each package's constants |
| Performance gate | `supabase/tests/reports_v3_performance.sql` | p95 ≤ 2 s (scope, summary, state, sales appointments, four call readers) and ≤ 4 s (journey) at 500k/5k/10k under 8 s |
| Build | `npm run build` | Passes. The Reports route is lazy, the main entry chunk does not grow, and the geometry chunk is ≤ 11 KB gzip |
| Visual gate | `scripts/tests/reports-visual/verify.mjs` | 320/390/768/1440, 200 % emulation, reduced motion, light and dark, axe clean, no page overflow, brief §18 order, 23-KPI inventory, compact chips (at most two per tile; no notice sentence under tiles), new first-screen budgets |
| CSV golden | Procedure copied to `docs/plans/2026-10-31-reports-v2/evidence/csv-capture` | Itemized approved-changed / new / retired (no page CSV stays identical); Chris approves the diff |
| Advisors (backend stages) | Supabase `get_advisors`, security and performance, before and after | Compared by finding identity against the baseline (security ERROR 2 / WARN 213 / INFO 41; performance WARN 232 / INFO 230). Expected deltas only, in `authenticated_security_definer_function_executable`: A +9 (and +2 `unused_index`); B +2; C +4 (two wrappers, the retry RPC and the link-status read); D +3 (the three attribution RPCs; `record_appointment_outcome` is SECURITY INVOKER). Any new anon-executable SECURITY DEFINER finding, mutable search_path finding or ERROR stops the release |

**Telephony-adjacent stages (C, D)** additionally require:
- reading the current `TwilioContext.tsx`, which stays unchanged;
- `dialerPageReportsV2Exceptions.test.ts`, which pins DialerPage to the approved lines and TwilioContext byte-identical;
- the converting-disposition Save Only / Save & Next suites, `floatingDialerDisposition`, `saveAppointmentPayload` and the dialer-dnc-backend workflow;
- the IN-A UI tests (C);
- a permitted-environment check of call-row creation, status updates, dispositions and logs. No real prospects and no real messages.

**For every shipping stage:** a newest-first WORK_LOG.md entry, and advisors after any approved backend or security change.


## 12. Principal risks

| Risk | Mitigation |
|---|---|
| **An accidental merge is a production release.** `main` is unprotected and auto-deploys both Vercel projects. | No merge without Chris's explicit approval. Backend-only PRs carry no application code change. Test-only paths such as `src/lib/__tests__/reportsV3Contracts.test.ts` are allowed, and they do not change the built bundle. Served-bundle check after F. |
| **The Supabase GitHub "Deploy to production" setting cannot be read by tools.** | A hard manual gate before every backend merge. |
| **Anon EXECUTE by default ACL** on every new `public` function. | Class C creation with REVOKE; the GRANT parser; the effective-privilege matrix; advisors stop the release. |
| **Wrong ops script after v3 ships** (`reports_integrity_enable.sql` seals v3; `reports_disable.sql` leaves v3 on). | A-38a, A-41 and named scripts; the runner accepts pinned bytes only; a release test pins each script's resulting state. |
| **8 s timeout at heavy scopes**, now with four more call readers. | Every call reader reuses the window-bounded `report_v3_call_facts`. p95 gate for all nine readers. The read-back fails above 4 s. The remedy is a reviewed identity table, never a timeout increase. |
| **Calls made differs between Reports V2 and Leaderboard/Dashboard** by non-attempts and unverified rows (12 in October for org A). | One line in How it's calculated. ★9 offers a separately scoped alignment. Old tabs keep v2. |
| **Partial on Calls made whenever unverified rows exist** (9 rows over 17 days). | A truthful compact cue with the count on demand. ★3 alternatives. A future reviewed classification package can resolve historical rows. |
| **PKG-B replaces `performance_sale_monthly`**, live for Leaderboard and Dashboard. | Value identity proven per win with an empty ledger. Draft PR #486 must rebase onto the new functiondef pin. |
| **A statement timeout during capture aborts the sale or booking.** | Bounded capture (function-level `lock_timeout`, single-row work, p99 < 20 ms). An atomic rollback plus the existing idempotent retry means no partial state and no false success. T-CANCEL test. |
| **A systemic evidence-capture bug** degrades evidence into gaps. | Reconciliation against current rows shows gaps even when gap rows are missing. Gap counts appear in read-backs. The disable script is prepared. |
| **Journey disclosures E1–E6 at personal and team scope**, including via differencing. | ★1 with the security reviewer; S14a/S14b tests; options (c) and (b′). |
| **The phone-based "possibly related" rule** marks about 5–12% of people unassessable and leans on recorded numbers. | Numbers only exclude relatedness, never link (A-38h). Residual limits are disclosed. ★4. |
| **Unique prospects visibly drops** (417 → 233 all-time) without the `call:` fallback. | Release note, Coverage line, Partial status. |
| **The inbound chip relies on `currentCall.customParameters`**; a future change to TwilioContext's parameter handling would break capture silently. | The TwilioContext pin test plus the IN-A UI tests. The server validates every id, and a failed attach means Unclassified, never a wrong link. |
| **`clients_lead_id_guard` changes a business table.** | Writer grep and catalog check; test L12; the telephony gate. |
| **Adoption.** If outcomes and links are rarely recorded, KPIs 12, 16, 17 and 18 stay Partial. | Optional fields by design. Later explicit linking from either side is supported. |
| **Harness drift** from production columns. | `reports_v3_dependencies.sql` is checked against the live column inventory at preflight. |
| **Repository/production version drift** (11–16 SMS/UV files) makes `db push` unsafe. | Per-file runner stages; renumber immediately before release; record-history per file. |
| **Map provenance is not yet recorded** (census.gov is blocked here). | An isolated documentation task (D5) that blocks only the PKG-F map merge. |


## 13. Context snapshot (revision 2.1, 2026-11-01)

- **Changes.** Revision 2.1 records Chris's 2026-11-01 branch-work review: BC1–BC5 (§5.2, §3.1, §10.1a), the decisions (§5.1), and every AGENT_RULES text marked proposed. In the repository, only the plan copy (`docs/plans/2026-10-31-reports-v2/implementation_plan.md`) and one dated pointer entry at the top of the root `implementation_plan.md` are written, committed locally on `claude/great-goodall-911azc`. Nothing is pushed. There is no PR, migration, deploy, production write or settings change.
- **Base refresh (2026-11-01).** `main` is still `6e39c15`. The newest open PR was last updated 2026-10-23 (#486, already in the PKG-B coordination step). No other open PR or remote branch overlaps the Reports V2 files.
- **Production reads in revision 2.1.** None.
- **Local test environment.** A disposable PG 16.15 loopback cluster with trust authentication, synthetic data only. The existing `run_reports_integrity_tests.sh` suite passes on it at base. PG 17.6 CI on the exact head remains the gate (§11).
- **Decisions.**
  - Decided: ★2, ★3, ★5, ★6, ★7, ★8, ★9 (§5.1).
  - Pending: ★1 and ★4. Only a clearly marked proposed design is built. No security reviewer is appointed, and no disclosure is recorded as accepted.
- **Migrations and deploys.** None.
- **Blockers.**
  - Push authorization: the branch exists only in this session's container until Chris authorizes a push.
  - Appendices D1–D6 are not on the reviewed file list. Committing them under `docs/plans/2026-10-31-reports-v2/appendix/` needs a bounded change request; until then they stay in the plan package.
  - ★1 and ★4 security review (named reviewer) before any PKG-A production approval.
  - Map provenance (network-restricted) blocks only the PKG-F map merge.
- **Next step.** PKG-A Batch 1: list the exact files, add the failing contract tests (BC4 truth table, registries, privilege classes), then implement the foundation migration until they pass.


## 14. Phase B design delta: the maintained identity-pointer layer (Batch 7 checkpoint review, 2026-11-03; PROPOSAL ONLY: nothing approved, built or applied)

This updates the Batch 7 proposal's §3 pointer layer and does not restate it.

**Unchanged from §3 of that proposal:**
- one row per organization and pointer (`contact` or `membership`), holding the identity kind, uuid and resolution;
- maintenance triggers on `recruits`, `clients`, `leads`, `campaign_leads` and `private.dialer_conversion_lineage` only, and **no trigger on `public.calls`**;
- organization-scoped, sealed `private` objects with RLS on and no client grants;
- set-based maintenance under row locks taken in key order;
- the same rules 1–8 and current-state semantics; payloads identical in stored and live mode.

Where this section differs from that proposal, this section governs. It does not repurpose `…17`, shift enable versions, add a first-contact cache or authorize any implementation.

### 14.A Performance justification (the three misses)

| Miss (CI run 41541165337, run 2, AMD EPYC 7763) | Measured p95 | Gap to target | Pointer cost the layer can remove (local instrumented plans of `66663f4`; timings overlap) | Estimate after the layer (not measured) |
|---|---|---|---|---|
| summary agency-366 | 2,770.9 ms | 771 ms (28%) | building the contact-pointer (82,812) and membership-pointer (16,376) maps: 394 + 146 ms. Attaching them to 457,311 calls (about 390 ms) stays, as a lookup in the stored rows. | −0.25 to −0.45 s: **still over 2 s** |
| state agency-366 | 2,752.9 ms | 753 ms (27%) | the same two maps (401 + 125 ms). The identity-state resolver (about 0.47 s), sale facts (about 0.29 s) and the per-call pass (about 1.4 s) are untouched. | −0.3 to −0.45 s: **still over 2 s** |
| journey agency-366 | 4,426.8 ms | 427 ms (10%) | inside the parallel history pass, each process builds its own maps (489 + 118 ms; about 0.6 s wall) | −0.35 to −0.5 s wall: **borderline, around 4 s** |

- **Measured:** the p95 values (CI), and the node times listed (local PostgreSQL 16.15, instrumented). Instrumented timings overlap and inflate many-row nodes; they are not additive or end-to-end.
- **Estimated:** the "after" column. Reading the stored rows still costs a scan and hash of the organization's pointer rows (about 225k in the fixture), which the estimate charges at 0.1–0.2 s.
- **Superseded by measurement (X1, §14.F):** the "after" estimates above overstated what resolution costs. The node times listed are dominated by building the window's distinct pointer sets from a second pass over the calls, not by the resolver's joins.
- **Conclusion:** the layer alone is not expected to clear summary or state. The rest of their cost is the base pass over about 457k calls (about 0.9 s instrumented) and grouping (about 0.5 s). For the journey it is plausible but unproven.
- **Proposed isolated experiment X1** (needs approval; disposable databases only; no migration file):
  - In the 500k fixture database, create a scratch schema holding a pointer table filled from the live resolver, and scratch copies of the three readers' statements that read it.
  - Prove the payloads equal the current code for every differential case and the scale cases.
  - Measure a same-session interleaved A/B with 20 samples under production session settings: locally on PostgreSQL 16.15, and on PostgreSQL 17.6 only if a scratch CI mode is separately approved.
  - Until X1 is measured, the benefit is a hypothesis.

### 14.B Correctness under failure

**B1. Maintenance and marker failing together** (supersedes §3.5 "only the warning remains").
- **Pending journal.** Each maintenance trigger first appends the affected keys to `private.report_v3_identity_journal`, in the CRM statement's own transaction and outside any exception handler.
- **Maintenance.** It then runs in a `BEGIN … EXCEPTION WHEN OTHERS` block and, on success, deletes exactly the journal rows it appended.
  - If maintenance fails, its subtransaction rolls back, those deletes with it, so the journal rows commit together with the CRM write.
  - If the append itself fails, it is uncaught, so the CRM statement fails.
- **Result:** no committed state exists in which the base change is present while both the mapping and its pending marker are absent.
- **Reader rule.** A reader uses stored mappings for an organization only when it has no pending journal row and no unresolved global row (B6).

**B2. Exact failure boundary.**
- **Caught, CRM write commits:** everything `WHEN OTHERS` catches. That includes `lock_not_available` (55P03), serialization failures, deadlock victims (40P01), constraint and data errors, and bugs.
- **Not caught:** PL/pgSQL's `OTHERS` does **not** catch `QUERY_CANCELED` (57014: statement timeout or a cancel) or `ASSERT_FAILURE` (P0004). These propagate and abort the CRM statement, as the cancel itself already would.
- Maintenance code therefore uses no `ASSERT`; invariant checks `RAISE` a SQLSTATE that `OTHERS` catches.
- **The append's own failure classes** (it can fail the CRM write): out-of-memory or out-of-disk, cancellation, and a lock wait on the journal table. Only explicit `LOCK` or DDL conflicts with its RowExclusiveLock, so repair never takes one.
- An insert without a unique key can still wait: on relation extension, on DDL, or on I/O. It has no foreign key, so it never waits on a referenced row.

**B3. Triggers disabled and later re-enabled, bypassed writes, restores.**
- The freshness check includes `pg_trigger.tgenabled = 'O'` for every maintenance trigger. A disabled trigger makes every organization live.
- **Not detectable after re-enable:** writes made while the triggers were disabled, writes under `session_replication_role = replica`, and restores loaded with triggers off.
- Mitigations, each a decision (E-list):
  - (i) an event trigger on `ddl_command_end` for `ALTER TABLE … DISABLE/ENABLE TRIGGER` on the five tables appends a global journal row. It cannot see `session_replication_role` or restores, and hosted support must be confirmed;
  - (ii) a runbook rule: any restore, replica-mode load or trigger change is followed by a global journal row, then repair and verify;
  - (iii) an optional scheduled verify.
- **Verify does not protect a report read before it runs.** The read path does not verify, so the exposure window after an undetected bypass lasts until the next verify and repair.

**B4. Snapshot consistency.**
- Freshness is evaluated **inside the reader's single statement**, not in an earlier statement as §3.7 proposed. That statement takes one READ COMMITTED snapshot.
- The statement contains a stored branch gated by `fresh` and a live branch gated by `NOT fresh`. Both are planned; one-time filters execute only one of them.
- So the decision and the mapping rows come from the same snapshot. A concurrent, uncommitted maintenance or base change is invisible to both.

**B5. Concurrent repair and new structural writes.**
- Repair records the organization's journal high-water mark (the largest committed journal id) before it starts.
- It then recomputes in key-ordered batches under the maintenance lock protocol: row locks `FOR UPDATE`, then a fresh READ COMMITTED recompute.
  - So it waits for in-flight maintenance and never overwrites a newer mapping with an older snapshot.
- Finally it deletes only journal rows with id ≤ the high-water mark. Rows appended during repair remain, and the organization stays live until they clear.
- Repair takes no table lock, so CRM writes never wait on it beyond one row's lock.

**B6. Global stale rows when one organization is repaired.**
- A global journal row (`organization_id` NULL: TRUNCATE, trigger-state events or a restore rule) makes every organization live.
- Repairing organization X records `repairs(X, hwm, completed_at)`. X is fresh only when it has no pending row of its own and every global row's id is ≤ X's recorded high-water mark.
- A global row is deleted only after every organization's high-water mark has passed it, or after a full repair.

**B5/B6 correction (X1 review, 2026-11-03): as written, B5 and B6 are unsafe under out-of-order commits.**
- **The flaw.** Their high-water-mark rule (`id ≤ hwm` means observed and repaired) does not hold. A `bigserial` journal id is allocated when the row is inserted, not when its transaction commits.
- **Counterexample:**
  1. Transaction A appends journal id 100 for organization X and stays uncommitted. Its CRM change is invisible to everyone else.
  2. Transaction B appends id 101 and commits.
  3. Repair starts. The largest committed id is 101, so it records hwm = 101, then recomputes X's pointers. A's change is still invisible, so it is not repaired.
  4. A commits.
  5. Repair's cleanup deletes the journal rows with id ≤ 101, which now includes 100.
  6. X has no pending row, so readers use the stored rows even though A's change was never applied. Nothing marks X stale until something else touches it.
- **Global acknowledgments fail the same way.** A global row whose id is at or below X's recorded mark, but which committed after repair's snapshot, counts as acknowledged without being observed. "A global row is deleted only after every organization's mark has passed it" inherits the flaw.
- **Status: a pending concurrency proof, not a mechanism.** Nothing is chosen or built.
  - Any later design must show, in a test of this interleaving and its variants, that a journal row is removed or acknowledged only after repair has observed its committed change.
  - The variants: A commits during the recompute; A commits after cleanup; A is a global row; two concurrent repairs; maintenance deleting its own rows.
  - Candidate directions, unproven and unapproved: cleanup deletes exactly the ids repair saw rather than a range, and global acknowledgment records exact ids; or a horizon taken from the transaction snapshot (`pg_snapshot_xmin`) instead of a sequence value.
- **B1's tradeoff also remains unapproved.** The mandatory journal append can fail the CRM write, for the classes listed in B2.

**B7. Missing layer tables or functions.**
- The reader's PL/pgSQL checks `to_regclass` and `to_regprocedure` for every layer object before choosing its statement. If any is missing, it runs the live statement's constant text, which never mentions the layer.
- A drop that races with a running stored statement must wait for the reader's AccessShareLock, or the reader errors with an undefined object. It never returns a wrong payload.
- The enable and the read-back refuse a partial layer.

### 14.C CRM and dialing-workflow impact

- **"No calls trigger" does not mean "no dialing impact".** Dialing workflows write triggered tables:
  - inbound auto-create inserts a lead while the caller is ringing;
  - a converting disposition runs `convert_lead_to_client_atomic`, which inserts a client, deletes the lead (cascading SET NULL to memberships, plus a lineage insert), and re-points calls (not maintained);
  - campaign attach inserts memberships, 500 per call.
  - `advance_campaign_lead`'s queue updates set no key column, so they do not fire `AFTER UPDATE OF <key columns> … WHEN (changed)`. This is still measured.
- **Total budget, not per-lock.**
  - `lock_timeout = 200ms` bounds each wait, not the total: a statement can wait once per key, and a speculative-insert `ON CONFLICT` wait on another transaction counts as a separate wait.
  - Maintenance therefore processes at most K keys per statement and checks a deadline B, measured from `statement_timestamp()`, between batches. Over either limit, it stops and leaves its journal rows: the organization goes live until repair.
  - So the extra latency per triggered statement is at most B plus one lock wait (≤ 200 ms). K and B are decisions, proposed at K = 1,000 keys and B = 50 ms.
- **Subtransactions.** Each triggered statement opens one subtransaction. A transaction with many triggered statements (imports, undo, bulk deletes) can overflow the per-backend subtransaction cache (64), which slows snapshots for every session. This is measured, not assumed.
- **Contention and latency tests (X2, needs approval).** Run with prototype triggers in a disposable 500k database, comparing with and without the layer: p50, p95 and max latency, lock waits (`log_lock_waits`), deadlocks and subtransaction overflow.
  - single-row lead, client and recruit writes;
  - inbound auto-create bursts;
  - conversion: single, and concurrent on the same and on different leads;
  - CSV import of 1,000 and 10,000 rows;
  - membership attach of 500;
  - import undo;
  - delete-all-matching in 1,000-row statements;
  - campaign-delete and lead-delete cascades;
  - concurrent repair under write load;
  - fault injection (maintenance forced to fail; the journal append forced to fail).

### 14.D Installation and recovery

- **Lock duration.** `CREATE TRIGGER` takes ShareRowExclusiveLock on each of the five tables, which blocks their writes until commit.
  - **Smallest safe rollout:** one short transaction (lock_timeout 2 s, retried) creates the tables, functions and enabled triggers, plus one global journal row, so every organization reads live.
  - Backfill then runs **online**, per organization, through the repair procedure (B5): row locks only, no table lock.
  - Each organization becomes fresh only after its own verify returns 0.
  - The table-lock window is thus trigger creation alone. It is not yet measured, so it is measured on the 500k fixture and on a production-sized copy before approval is requested.
  - The §3.6 single-transaction backfill (pausing writes for the whole backfill) is dropped.
- **Rollback and repair are built and rehearsed with the implementation, not deferred** (supersedes §3.9's deferral). The rehearsal, in a disposable database, covers:
  - install, then write load, then repair under load;
  - fault injection, readers going live, repair, readers going stored;
  - trigger disable and re-enable with the runbook rule;
  - a restore drill;
  - rollback: drop the layer with v3 disabled, readers return to the live statement, and v2 is untouched;
  - re-install.

### 14.E Approval list (nothing here is approved)

1. **Version placement** (decision). The layer must precede enable, `…17` cannot be repurposed and enable versions cannot shift, so either:
   - (a) fold the layer into an unpublished PKG-A file, whose stage then gains table locks and a rollback scope; or
   - (b) give it its own later range, installed after enable, with readers running live until it is verified; or
   - (c) renumber the placeholders in a later, separately approved filename-only commit.
2. **Proposed files:**
   - the layer migration and `supabase/migrations/rollback/…_reports_v3_identity_pointers.rollback.sql`, versions per decision 1;
   - changes to `…15` (in-statement freshness and the live fallback; the readers' bodies otherwise unchanged);
   - `supabase/tests/reports_v3_identity_pointers.sql`;
   - `scripts/reports_v3_identity_concurrency.sh`;
   - `supabase/ops/reports_v3_identity_verify.sql` and `supabase/ops/reports_v3_identity_repair.sql`;
   - the differential (stored-versus-live equality), the fixture script, the static contract test, and the workflow lines to run them;
   - D1, D3, D5, `backend_actions.md` and `tests.md`.
3. **Database objects:**
   - tables `private.report_v3_identity_pointers`, `…_identity_layer`, `…_identity_journal` and `…_identity_repairs`;
   - functions for the universe, resolve, maintenance triggers, freshness, verify and repair;
   - triggers on the five tables;
   - optionally the event trigger (B3 i).
4. **Isolated experiments:** X1 (benefit, payload equality) and X2 (write path, contention, fault injection), plus the install-lock measurement (D).
5. **Maintenance mechanisms to approve:** the journal in the outer transaction; the WHEN OTHERS boundary (57014 and P0004 propagate); the key order; K and B; online repair; the global-row rule; the restore runbook; whether to add a scheduled verify.
6. **Acceptance criteria:**
   - stored and live payloads are identical in every differential case;
   - verify returns 0 after every X2 scenario;
   - every injected fault leaves the affected organization live, never stale-stored;
   - write-path p95 increases within bounds approved with X2's results;
   - no deadlock, and no unbounded wait;
   - the install lock duration is measured and approved;
   - rollback and repair are rehearsed;
   - the unchanged two-run, 147-combination acceptance passes.

   Phase B is not implemented, and no first-contact cache is proposed.

### 14.F X1 measured result and recommendation (2026-11-03; isolated experiment; diagnostic only)

**Scope.** X1 was approved alone (Phase B and X2 are not approved). It ran in disposable loopback databases on PostgreSQL 16.15, with:
- a 4-vCPU Intel Xeon at 2.30 GHz and 16 GB of memory;
- production session settings and the 8 s statement timeout;
- the 500k-call fixture at `772e883`.

It is diagnostic evidence, **not an acceptance run**. No migration, production reader change or hosted command was made. The scripts, generated SQL, hashes, raw samples and plans are in the downloadable bundle `reports_v3_x1_evidence_772e883.tar.gz` (sha256 `fddeed87a710489fd1f1cafc0dd9038b6a028664413155410e016c73d1d08225`), outside the repository.

**Prototype.** The scratch schema `x1.pointers` holds one row per organization, pointer kind and pointer id:
- the scale organization has 225,500 rows, populated from the live resolver text in 1.07 s;
- storage is 48 MB: heap 25 MB, primary key 18 MB, reverse index 5.3 MB.

Each arm copies the installed function and replaces only its `@call-pointers` block; byte identity is asserted.
- **W:** the window's pointer sets (one pass over the window's calls), each mapped by one keyed lookup.
- **U:** every stored row of the organization, with no pointer pass over the calls (summary and journey only; for the state reader, U would widen the identity-state input).
- **F:** W plus the B4/B7 shape: `to_regclass` checks, and an in-statement freshness CTE gating the stored branch and the unchanged live branch.

**Excluded:** maintenance and write-path cost, a non-empty journal, concurrent repair, lock waits, and the fallback's execution.

**Equivalence before timing: 2,732 comparisons with the current code, 0 differences.**
- every fixture inventory reader case of the three readers for every arm: 1,408 payloads and 704 refusals;
- 540 journey-helper cases;
- the 15 scale inventory cases;
- the 18 measured combinations for every arm (48);
- 6 scale journey-helper cases;
- `x1.verify` over every pointer of every call of 11 organizations.

**Controls: 8 of 8 behaved as expected.** A planted stored-row change is caught for every arm. F switches correctly to live on an organization journal row, a global row above the mark and a not-ready layer, and back to stored at the mark.

**Primary results** (p95 in ms; 20 interleaved samples after one warm-up; 0 timeouts):

| Reader, agency-366 | Baseline | W | U | F | Remaining gap to target, best arm (local) |
|---|---|---|---|---|---|
| summary (2 s) | 2,387.3 | 2,330.6 (−56.7, −2.4%; paired −30.8) | **2,042.7 (−344.6, −14.4%; paired −265.0)** | 2,316.4 (−70.9, −3.0%) | U: **+42.7 over** |
| state (2 s) | 2,342.8 | **2,302.5 (−40.3, −1.7%; paired −9.3)** | n/a | 2,298.1 (−44.7, −1.9%; paired −8.1) | W: **+302.5 over** |
| journey (4 s) | 3,813.8 | 3,900.1 (+86.3; paired +29.0) | **3,473.0 (−340.8, −8.9%; paired −229.5)** | 4,575.8 (**+762.0, +20.0%**) | U: 527 under; the baseline is already 186 under locally |

- **Controls** (short windows, personal, team, agent-filtered):
  - W and F are within about ±40 ms paired of the baseline for summary and state.
  - U **regresses** small summary scopes: agency-1 +104 ms paired (p95 +62%), personal-366 +38 ms, agency-366-one-agent +42 ms. Every scope pays to hash the whole organization's rows.
  - F costs **+0.78 to +0.83 s on every journey combination**.
- **Plans** (instrumented, separate from the samples):
  - The live resolver's own joins are negligible (recruits, clients-by-lead and lineage each finish within about 1 ms). Its cost is building the window's distinct pointer sets from a second pass over the calls: 399 ms for contacts and 156 ms for memberships in summary agency-366. W keeps that pass (333 and 196 ms), and U removes it (121 and 94 ms).
  - F's freshness CTE removes the journey history pass's parallel plan (one Gather with one worker becomes none), because a CTE scan is parallel-restricted. That is the +0.8 s.
- **Local versus CI.** The local baseline is faster than CI run 2 by a ratio of 1.16–1.18. Applying each measured percentage to CI run 2 gives **estimates, not measurements**:
  - summary U about 2.37 s;
  - state W about 2.71 s;
  - journey U about 4.03 s.

**Decision per failing reader** (unchanged targets):
- **Summary:**
  - Gain: at best −345 ms p95 (U), but U regresses every small scope. The shape that does not regress (W or F) gains −2 to −3%.
  - Gap: +43 ms locally; about +370 ms estimated on CI.
  - Verdict: **does not support** maintained infrastructure.
  - Still needed: the remaining cost is the base pass over about 457k calls and the grouping, which no pointer layer touches.
- **State:**
  - Gain: −40 ms (−1.7%), within noise.
  - Gap: +303 ms locally.
  - Verdict: **does not support** it.
  - Still needed: the miss is in the identity-state resolver, sale facts and the per-call pass.
- **Journey:**
  - Gain: −341 ms p95 (U) at best, while the B4 freshness shape costs +762 ms.
  - Gap: under target locally even at baseline; about +33 ms estimated on CI with U.
  - Verdict: alone, **does not justify** a maintained layer and its CRM write-path risk (B1, the B5/B6 correction).
  - Not measured: PostgreSQL documents that a STABLE function's statements use the snapshot of the calling query. A PL/pgSQL-level branch could therefore keep the B4 snapshot guarantee without the two-branch statement.

**Recommendation: stop the maintained pointer layer.** Do not proceed to X2, Phase B or migration placement on its account.
- X1's useful finding is that the attributable pointer cost is the second pass over the window's calls, not resolution. Any change to that pass needs no maintained table, trigger or journal.
- Pursuing it would be separate read-path performance work under its own approval; nothing is started.
- A PostgreSQL 17.6 rerun of X1 needs a CI experiment mode and tracked scripts. It is returned as a proposed change only (`scripts/proposed_ci_x1_mode.patch` in the bundle) and is not needed for the no-go.

### 14.G Batch 8 query-only result (2026-11-03; no reader change retained)

**Decision recorded.** Chris accepted the §14.F recommendation. The maintained pointer layer, X2 and Phase B are off the implementation path; §14 and the X1 evidence are kept as history and are not built. Batch 8 tried only query-shape changes to the redundant pointer pass that X1 identified, with live structural identity resolution kept.

**Candidates** (scratch schemas in a disposable 500k database on PostgreSQL 16.15, the same 4-vCPU machine as X1, built from `80c1ba6`, which has the same code as `bf7d5d6`). Each copies the installed function and changes only its `@call-pointers` block, with byte identity asserted:
- **Q1 (summary, state, journey rows):** one `MATERIALIZED` pass over the window's calls collects both pointer kinds, instead of one DISTINCT pass per kind. It keeps the window bound, so no scope gets an organization-wide scan.
- **JU (journey rows only):** the pointer sets are every id the rules can match in the organization (the CRM tables' ids), resolved live, so the history pass needs no pointer pass over the calls. The journey is already organization-wide (the full lookback), so this widens nothing.

**Equivalence before timing: 1,448 comparisons with the current code, 0 differences.**
- Q1: 816 reader cases (fixture and scale; 552 payloads, 264 refusals) and 180 journey-helper cases.
- JU: 272 reader cases (184 payloads, 88 refusals) and 180 journey-helper cases.

**Measurements** (interleaved, same session, the arm order rotated each round, 0 timeouts; p95 in ms):

| Reader | Combination | Current | Q1 | Change (paired median) |
|---|---|---|---|---|
| summary | agency-366 (miss) | 2,316.5 | 2,334.4 | +17.9 (−16.0) |
| summary | agency-30 | 606.4 | 552.0 | −54.4 (−68.5) |
| summary | personal-366 | 243.4 | 197.2 | −46.2 (−45.8) |
| summary | agency-366, one agent | 268.7 | 203.5 | −65.2 (−46.1) |
| state | agency-366 (miss) | 2,346.5 | 2,344.4 | −2.1 (−27.1) |
| state | team-30 | 494.9 | 415.2 | −79.7 (−40.8) |
| state | agency-366, one agent | 463.4 | 399.6 | −63.8 (−80.5) |
| journey | agency-366 (miss) | 4,330.6 | 4,898.7 | **+568.1 (+687.7)** |

- Summary and state: 20 samples after warm-up over eight combinations each (agency 1/30/366, agency-366 with one agent, personal 1/366, team 30/366).
- Journey: a screen of 8 samples over seven combinations. Both candidates regressed every combination, so no 20-sample run was spent on them:
  - Q1: +745 to +798 ms paired;
  - JU: +849 to +994 ms paired.

**Per reader:**
- **Summary:**
  - Q1 gives repeatable gains of 10–70 ms at narrow and medium scopes.
  - At the agency-366 miss its p95 is +18 ms (paired −16 ms), which is noise.
  - **Rejected:** it does not move the miss, and it would split the shared `@call-pointers` text into two variants for the gain at scopes that already pass.
- **State:**
  - The same pattern: −2 ms p95 (paired −27 ms) at the miss, with gains only where the reader already passes.
  - **Rejected.**
- **Journey:**
  - Both candidates remove the history pass's parallel plan (one Gather with one worker becomes none), as X1's F did: a `MATERIALIZED` CTE and the CRM-universe union are parallel-restricted.
  - JU's universe resolution (465 + 160 ms) also costs as much as the calls pass it removes (457 + 121 ms).
  - **Both rejected** as repeatable regressions.

**Outcome.** No reader or helper is changed. `…12`, `…14` and `…15` are byte-identical to `bf7d5d6`, so the enforced two-run acceptance was not rerun on unchanged code. The gate result stands as reported in Batch 7: **not passed** (summary and state at agency-366; journey at agency-366 on the slower CI runner). With the maintained layer stopped, no remedy is named here. The next step is Chris's decision.

**Journey reader scale coverage (permanent).**
- The scale inventory gains six public journey-reader cases compared with the frozen baseline's reader:
  - agency at 1, 30 and 366 days;
  - team 30;
  - personal 366;
  - agency 366 filtered to one agent.
- The baseline's journey reader takes **31 minutes to more than 2 hours per call** at this scale (1,880 s at agency 1 day alone; agency 30 and 366 days did not finish in 2.4 hours, locally). Six cases exceed the CI differential job's 60-minute limit, which already holds a 36.6-minute run, and the workflow is outside this batch.
- `reports_v3_differential.sql` therefore runs them only with `REPORTS_V3_DX_JOURNEY_SCALE=1`. Without it:
  - it asserts that the six cases are pinned;
  - it prints and records `journey_reader_cases: not run`;
  - it never counts them as compared.
- The candidate's 8 s acceptance timeout is unchanged.
- Running them in CI needs an approved workflow change, for example a separate dispatch-only job with a longer limit.
- The local opt-in result is recorded in the Batch 8 `WORK_LOG.md` entry.

## Appendices

**In the repository** (`docs/plans/2026-10-31-reports-v2/appendix/`, added 2026-11-01 under Chris's documentation approval). These are the current implementation references. They agree with §2–§13, and revision 2.1 applied BC1–BC5 to D1, D3, D4 and D6.

| File | Contents |
|---|---|
| `D1.md` … `D6.md` | Section designs: D1 contract, security, ops and release; D2 production and AP corrections (PKG-B); D3 calls, identity, journeys and PKG-C; D4 Sales Appointments and PKG-D; D5 Regional performance and map provenance; D6 the one-page frontend (PKG-F) |
| `tests.md` | Test index: every test case (name, file, kind, package, covers) |
| `backend_actions.md` | Backend-action index: per-section backend actions with gates (§9 is the merged order) |
| `lead_rulings.md` | Ruling index: the 50 lead rulings (RL-1–RL-50) applied to the contract and every appendix |

**Plan package only** (history, not build input, not committed): `reconciliation_log.md`, the structured JSON sources of §7, §8 and the indexes, revision 1 arbitration (`A_arbitration.md`), and the verifier and critic outputs (`verifier.json`, `critics_summary.md`). Where history conflicts with revision 2.1, revision 2.1 governs.

★1 and ★4 remain pending, and every AGENT_RULES text in §6 remains proposed. Adding these documents approves neither privacy option nor the proposed agency-only fallback in §5.1.

### 14.H Agency journey reader verification replaced (2026-11-04; verification only)
- **Superseded, not passed.** The full-scale baseline comparisons (agency 30 and 366 days) could not finish: run `41753175853` hit the 320-minute deadline inside the baseline reader. They remain unresolved and superseded.
- **Replacement, approved by Chris:**
  - an exact complete-payload comparison with the frozen reference on the same fixture at `rt.perf_divisor = 50` (10,000 calls, full 400-day history);
  - independent assertions and invariants on the full 500,000-call fixture, with planted-error controls.
- **Result:** both passed on PostgreSQL 17.6 (run `41796758878`).
- **Unchanged:** no reader, target or timeout. Full-scale baseline equality is not claimed. Details are in the WORK_LOG.


## Preparation verification result — November 6, 2026 UTC

44-file scope prepared; all 36 frozen files unchanged. B6 completed after 55/55 synthetic checks and returned 2 distinct discrepant sale events (premium and Sold Date flags separate). Three reporting zones remain unconfirmed. Final contract-3.3.0 synthetic package: 44 screenshots, 37 CSVs, 474/474 browser checks plus 30/30 supplemental checks. Root typecheck/build pass; app typecheck/lint findings match main by identity; Reports tests 384 passed/1 skipped. Independent reviewer remains unappointed; owner visual/CSV/map acceptance and publication approval are pending. See evidence/release-readiness-2026-11-06.md in the focused plan directory for the full closeout and disclosed embedded-database limits. No production mutation or hosted execution.
