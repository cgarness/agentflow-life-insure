# Reports visual refresh and reporting accuracy audit — implementation plan (rev 2, final for approval)

**Status: Phase 1 complete. Awaiting Chris's approval to implement.** Revision 2 was prepared 2026-10-09 (UTC). It replaces rev 1 (commit `17378ef`). It adds Chris's design direction, the completeness-critic findings, the closed audit gaps, the locally proven session-rounding SQL fix, the traced Data basis wording and exact per-file budgets.

**Nothing has been changed:** no application code, migration, RLS policy, Edge Function, Vercel deployment or production row. Production access was read-only throughout.

| Companion file | Contents |
|---|---|
| `evidence-matrix.md` | Metric evidence matrix: 134 reachable metrics, reconciliation rows, Reports vs Leaderboard by policy identity, deployed formulas, completeness addendum |
| `data-basis-wording.md` | Every Data basis sentence and new caption, each traced to a constant, a deployed SQL line or an AGENT_RULES clause |
| `security-tasks.md` | S-1 (Team Leader can change the agency time zone) and S-3 (agents can write their own session timestamps): separate tasks, nothing changed |
| `screenshots/before/` | The current page from the isolated synthetic fixture (not production numbers) |

---

## 0. Chris's direction (2026-10-09)

**Approved design direction for planning:**
- premium, compact Reports interface
- dramatically reduce mobile filter height
- improve the visibility of important columns
- preserve existing customization and reporting contracts
- rename "Dials per appointment" to **"Dials per booking"**
- correct the duplicate-session-seconds rounding artifact
- add regression coverage for bucket values, session-end clipping and additional-policy premium isolation

**Separate decisions:**
- **Preserve the current late-ended session calculation.** This is D-1, now closed.
- **Document the Team Leader timezone RLS vulnerability as a separate security task.** Done in `security-tasks.md`. No RLS change without explicit approval.

---

## 1. Baseline and conflict check

| Item | Finding (rechecked 2026-10-09 14:35 UTC) |
|---|---|
| Documents | `AGENT_RULES.md` (incl. #8, #12–#14, #23, #38–#41, the Reports personal layout invariant, §7 component standards: components under 200 lines, Zod on forms, Tailwind only), `VISION.md`, newest `WORK_LOG.md` entries, all earlier Reports plans and release records. There is no `AGENTS.md` in the repository. |
| Repository | `origin/main` = `8d53531`; no newer commits. This branch = `8d53531` + plan docs only. |
| Production frontend | Vercel `agentflow` production `dpl_28cKkn6bUSTKXTCoRgZ39iSCKTkP` = `8d53531`, READY, aliased to `www.fflagent.com`. |
| Production database | Newest Reports migrations `20261006043725` → `…31` → `…38` → `20261006044003`. After them come only six SMS migrations (newest `20261008151523`). |
| Deployed SQL | `md5(prosrc)` of every Reports function and helper equals the repository migration body (30+ bodies). The 15 bodies pinned by the guarded enable match. |
| Grants | Only the six v2 RPCs grant `authenticated`/`service_role`. v1 and legacy `rpc_report_*` are sealed. Private helpers are `postgres`-only. |
| Open PRs | 8 open; none touches Reports, Leaderboard, policy, appointment or call reporting code. **No conflicts.** |
| Saved layouts | `report_layouts` has **0 rows**, so every user sees `DEFAULT_LAYOUT`. Default ids, order and visibility therefore stay unchanged. |

**Verification baseline at `8d53531` (before any change):**
- Root `tsc --noEmit` passes, but checks nothing (`files: []`).
- `tsc -p tsconfig.app.json`: **85** diagnostics, none in Reports.
- Reports vitest: 218/218 (with SQL payloads).
- ESLint on 61 Reports files: 0 problems.
- `vite build`: passes.
- Full vitest: 4,321 passed, 1 failed, 34 skipped. The 10 failing files are exactly the pre-existing list, and none is a Reports file.
- Native SQL suites (local PostgreSQL 16, loopback) pass: `run_reports_rpc_tests`, `run_reports_integrity_tests`, `run_profile_rpc_tests`, `run_reporting_integrity_tests`.
- Chromium fixture gate `verify.mjs`: PASS 6/6.
- A golden CSV baseline was captured at the base for byte comparison: 74 deterministic downloads covering all 13 export controls, every view toggle and grouping, in Agency, Team and Personal. A second capture matched 74/74.

**Evidence labels used throughout:**

| Label | Meaning |
|---|---|
| **[DB-sim]** | v2 RPC called as a real profile inside `begin read only … rollback`. Not a signed-in browser. |
| **[Indep]** | Expected value recomputed from source tables without `private.report_*` helpers. |
| **[Static]** | Code or deployed SQL inspection. |
| **[Synth]** | Local native PG16 suites, local synthetic SQL fixtures, real Chromium on the isolated fixture. |
| **Hosted browser** | **BLOCKED.** The egress proxy denies `www.fflagent.com` (CONNECT 403) and there are no credentials. The live CSV download, filter and refresh walkthrough stays **Unverified**; see §9.4. |

---

## 2. Findings about the current design

All measured on the synthetic fixture with the app chrome emulated.

1. **Header and filters:**
   - **427 px** (preset) to **479–483 px** (Custom) at 390 px wide.
   - 223 / 275 px at 1440.
   - Seven preset buttons wrap onto three rows on mobile.
   - On a phone, Known Annual Premium starts below the first screen (value bottom ≈ y983 for the Custom fixture).
2. **About 45 always-visible explanation strings.** The methodology is repeated inline: `PREMIUM_BASIS` ×3, `CURRENT_ASSIGNMENT_NOTE` ×4, `POLICY_SOURCE_NOTE` ×2. The only disclosure is at the bottom, and it shows the as-of time as raw ISO UTC.
3. **Heroes** are about 297 px tall each, with mismatched accents. A partial premium prints at full emphasis, with coverage only in a sentence below.
4. **Six-metric strip:**
   - grey filler tiles when fewer than 6 metrics are visible
   - formula-jargon subtitles
   - three duration formats ("3:21", "2h 0m 0s", "0h 3m 21s")
5. **Trends:**
   - dual y-axes
   - the grouping control sits inside the Calling card but also regroups Production
   - status colours used as series colours
   - the call contact rate on a 0–100% axis, so 7.4% looks flat
   - dashed grids and "left axis / right axis" legends
6. **The activity strip draws arrows between independent totals.** It then needs a 70-word disclaimer.
7. **Tables hide important columns in horizontal scrollers with no cue:**
   - Campaign Performance shows 5 of 12 columns at 1440; policy and premium are hidden.
   - Agent Performance shows only Agent and Policies at 390.
   - The heatmap scroller isn't focusable.
   - Lead Source shows an always-"Not available" Converted column.
8. **Diagnostics** carry the same weight as performance. Captions are 9–10 px uppercase `font-black`.
9. **Accessibility:**
   - disposition identity is colour-only, and two live dispositions share `#EF4444`
   - campaign rows are `tr role=link`
   - toggles have no `aria-pressed`
   - heatmap values exist only in hover tooltips
   - error text is 1.81:1 on the dark card
   - `aria-controls` dangles
   - a customizer move to the first or last position drops focus
10. **Dead code:** `GoalTracking.tsx`, `DraggableSection.tsx`.

---

## 3. Accuracy audit — results

**Headline.** For every audited metric, window, scope and export, the Reports numbers match an independent recalculation from source tables under the approved contracts. The exceptions are the confirmed issues in §4. **No all-history certification is claimed** (§3.5).

### 3.1 Coverage

| Area | Evidence | Result |
|---|---|---|
| Six v2 payloads: every total, agent row, daily/hourly/day-of-week/heatmap series, disposition and duration bucket, campaign and lead-source row | [Indep] vs [DB-sim]: W1 Oct 1–7, W2 Sep, W3 Sep 8–Oct 7, W4 Oct 6, W5 366 days | Verified (except R-3) |
| Presets touching the open day: Today, Yesterday, Last 7, This Month, Last 30 (default) | [Indep] vs [DB-sim] for Admin, Agent and Team Leader in one snapshot each; the stale-heartbeat cap exercised on 3 live stale sessions | Verified |
| Browser-derived metrics and **every CSV** | Live payloads ([DB-sim]) rendered through the real page in a test harness and diffed against an independent re-implementation | **1,332 / 1,333 values matched; 140 / 140 CSV files byte-identical.** The one mismatch is R-5. |
| Scopes and access | Admin personal/team/agency/narrowed; Team Leader personal/team (agency refused); Agent personal; other-org Admin; Deleted actors; `anon` | Verified (25+ cases) |
| Campaign visibility for Agent and Team Leader callers | [DB-sim] + [Indep] visibility predicate; a live restricted case (Agent `d396d777`, 64 calls unavailable); local restricted shapes | Verified; hidden campaigns never appear |
| Dates | DST 23 h / 25 h days, Havana double midnight, month boundaries, Monday weeks, 366-day limit | Verified ([DB-sim] window math; [Synth] calls on DST days) |
| Session clipping | All 6 production sessions that cross local midnight, per day and 2-day window, plus local synthetic edges | Verified. Two 1 s differences come from flooring each window separately; no screen sums per-day seconds. |
| Bookings | Live; local synthetic setter-vs-assignee, cancelled, completed, no-show, `created_by` NULL, callback vs disposition, reviewed duplicate mapping | Verified (29/29 local checks) |
| Reports vs Leaderboard by policy identity | Live: 9 policies, 9 identities, 9 events. Local synthetic: reassignment, premium edit after snapshot, removal, client deletion, additional policies, legacy events, month-crossing dates (16 stages) | Verified; each basis behaves as specified |
| Dialer header vs Reports | `get_trusted_today_dialer_stats` per campaign and agent-local day vs Reports for the same agent and day | Every difference is attributable to zone, campaign scope, stale cap or policy basis |
| Deployed SQL parity | `md5(prosrc)` = repository; 15 guard pins match | Verified |

### 3.2 Representative values (W1 = Oct 1–7, agency; independent = RPC)

| Metric | Value |
|---|---|
| Calls made | 1,833 (49 inbound separate) |
| Contacted calls / call contact rate | 135 / 7.4%. 45 s → not contacted; 46 s → contacted unless No Answer. A ≥45 s rule would give 140. |
| Talk time | 39,893 s |
| Duration buckets | 1,548 / 196 / 56 / 19 / 14 |
| Bookings created (all types) | 25 (5 appointment, 5 callback, 15 unknown kind) |
| Callback dispositions | 6, separate from bookings |
| Dialer session time | 95,862 s |
| Matched / unmatched calls | 1,118 / 715 |
| Policies sold / known annual premium | 1 / $1,281.60 (1 of 1 known) |

Other windows: W3 4 / $3,831.72 (average $957.93); W5 9 / $10,655.52.

**Additive reconciliations** pass in every window:
- daily, hourly, day-of-week and heatmap totals = summary
- agent rows + unattributed = summary
- disposition and duration buckets = matched + unmatched = calls made
- campaigns + unavailable = lead sources + unlinked = calls made
- known + unknown = policy count

### 3.3 Reports vs Leaderboard

Production has 9 stored policies, 9 identities and exactly one original sale event each. The monthly totals are equal on both bases:

| Month | Policies | Premium |
|---|---|---|
| August | 4 | $6,168.60 |
| September | 4 | $3,205.32 |
| October | 1 | $1,281.60 |

Day and week buckets differ for four policies, because the event times differ from the backdated sold dates (+12, +5 and +1 days, and one approved creation-time proxy +1). One legacy event (`0d9a147d`) has no premium snapshot, so its Leaderboard premium follows the current client premium (an approved fallback). No ownership differences exist today. Per-policy table: `evidence-matrix.md` B.3. **Neither basis changes.**

### 3.4 Owner-decided or explained behaviours (no defect)

- **Late-ended sessions (D-1, decided: preserve).**
  - Ended sessions count until their recorded end.
  - Oct 1–7: 6,754 s fall after the last heartbeat (89,829 s if capped at heartbeat + 3 min).
  - Two of the midnight-crossing sessions add about 35 k s each of next-day time after their last heartbeat.
  - The Data basis wording describes this rule (B8.3).
- **Campaign lead identity (G11, recommend keep).**
  - 294 legacy calls (110 in August, 161 + 22 in September) count in a campaign's `calls_made` but have no same-campaign lead, so they are not in `leads_dialed`.
  - Cause: Team `e6d957a3` leads were moved to Open Pool `acb108ab` on 2026-09-25, plus 22 unlinked calls.
  - The default Last 30 is affected by only 20 calls.
  - The approved guard is intended. No change is proposed. AGENT_RULES line 130's "identical coverage" wording should be corrected in docs (§12).
- **Sessions with no campaign (G12, recommend keep).**
  - 0 s in W1, 49 s in Last 30, 144,599 s (17.9%) in W5, all from May to September.
  - They count in the session-rate denominators but can never match a call.
  - The Data basis states the denominator (B8.5).
- **Team scope excludes Deleted downline history** (approved, tested). Agency shows Deleted agents as labelled rows.
- **Agency "today" refreshes on Refresh**, not automatically at midnight (approved no-polling contract).

### 3.5 Not certified, and why

- **Historical duplicate candidates** (277 calls, 12 bookings) are still present and counted, as the contract requires. Their row hashes are unchanged since the 2026-10-04 freeze, and 0 new candidates exist after it.

  | Window | Calls | Contacted (via the disposition flag) | Bookings |
  |---|---|---|---|
  | W1 | 20 of 1,833 (1.1%) | 0 | 4 of 25 (16%) |
  | Last 30 | 112 of 4,364 (2.6%) | 8 of 323 | 6 of 63 (9.5%) |
  | W5 | 277 of 5,639 (4.9%) | 60 of 452 (13.3%) | 12 of 99 |

  The page and CSV disclose this only as "Unreviewed historical candidates remain included", with no count. A numeric disclosure would be a future backend item (X-3). Resolving candidates needs provider evidence and separate approval.
- **Legacy duration provenance:** 3,559 of 4,364 last-30-day calls have unknown provenance and 690 have duration conflicts (at most 4 s; none changes Contacted).
- **Not exercisable with production data:** cancelled or completed bookings, estimated durations, additional policies, unknown or zero premiums, calls on DST days. Each is covered by local synthetic tests only.
- **Hosted signed-in browser behaviour:** blocked here (§9.4).

---

## 4. Issues and what this plan does with each

Every item survived independent two-lens adversarial verification unless marked.

### 4.1 Fix in this branch — frontend

| ID | Sev. | Issue | Root cause | Fix |
|---|---|---|---|---|
| **R-1** | low | The optional "Dials per appointment" tile divides calls by **all** bookings | Oct 5 renamed the count but not this ratio (`stat-computations.ts:127,261-262`) | **Approved:** label "Dials per booking", subtitle "all booking types" (C13). The id and value are unchanged; labels are not persisted. |
| **R-4** | low | Refresh and scope Retry re-paint the **previous** payloads for about one frame (12 ms, 5/5 real-browser runs) | `useReportPanels` returns early on a null key without clearing stored panels (`useReportsData.ts:196,226`) | `if (!key \|\| !request) { setStored(null); return; }` plus hook and browser frame-probe tests. This is directly the brief's "old payloads must not reappear". |
| **R-5** | low | Call Duration double-rounds seconds: the server returns `round(avg,1)` and the browser rounds again. Live: exact mean 152.487 s → payload 152.5 → shown "2:33" instead of 2:32. | `CallDurationAnalysis.tsx:52,105,113,121`, `reports-format.ts:196-200`; same latent path for "Avg talk time per dial" | Display the payload's 0.1 s exactly: "2m 32.5s", "38.9s". No server change; CSV unchanged. |
| **U-1** | Chris's request | Activity arrows imply a funnel | `ReportsActivityFlow.tsx:38` | Equal independent "Period totals" tiles, no arrows, no percentages |
| **U-2** | low a11y | Disposition identity is colour-only; duplicate `#EF4444` | `DispositionsPieChart.tsx:109`, `DispositionDeepDive.tsx` | Ranked list with text identity; Deep Dive duplicate colour gets opacity + ring; configured colours never recoloured |
| **U-3** | low a11y | `<tr role="link">` campaign rows | `CampaignPerformance.tsx:118-131` | `<th scope=row>` containing a real `<Link>` with a visible focus ring |
| **U-4** | low a11y | Toggles expose no selected state | `DispositionDeepDive.tsx:48-53,109-124`, heatmap | Shared `ReportSegmented` (`role=group`, `aria-pressed`) |
| **U-5** | low | Grey filler tiles in the strip | `SectionRenderer.tsx:41-43` | Flex-wrap bordered tiles |
| **U-6** | low | Invisible edit mode while the Custom range is incomplete | `Reports.tsx:105,144-147` | Entry disabled with no sections; editor rendered outside the tabpanel **only** for a pending Custom range (scope ready, same owner, not withheld) (§5.10) |
| **U-7** | low a11y | Heatmap values only in hover tooltips | `CallingHeatmap.tsx:118-133` | Semantic table, `th` headers, sr-only cell text, focusable region |
| **U-8** | low a11y | `aria-controls` points at a panel that may not exist | `ReportScopeTabs.tsx:27` | Emit only when the panel renders |
| **U-9** | low a11y | Focus lost when an item moves to the first or last position | `ReportCustomizer.tsx:35,84-89` | Restore focus to the moved item's enabled button |
| **U-10** | low a11y | Low-contrast error, amber and small primary text (1.81 / 3.19 / 3.63:1) | `StatCard.tsx:27-28`, `ReportsToolbar.tsx:106-107` | Foreground text + coloured icon |
| **U-11** | low | Important columns hidden without a cue | `CampaignPerformance.tsx:99`, `AgentPerformanceCards.tsx:61`, `CallingHeatmap.tsx` | **Approved direction:** see §5.7 |
| **F-1** | test | Browser-gate assertion `verify.mjs:76` can never fail (case-sensitive label regex) | `verify.mjs:76` | Correct the regex and add a positive control |
| **R-6** | low copy | Data-quality note reads "1 estimates" / "1 conflicts" | `reports-integrity-text.ts` | Singular when 1. Changes that CSV note text only when a count is 1 (optional; **recommended**). |

### 4.2 Fix in this branch — duplicate-session-seconds rounding (R-3, approved)

`quality.sessions.overlap_seconds_removed` shows 1–5 s when no sessions overlap: W1 3, W2 4, W3 2, W4 1, W5 5, Last 30 4, with `overlapping_rows` 0. The page and every CSV print "0 overlapping rows; 3 duplicate seconds removed."

**Root cause:** `20261006043731…:348-349` subtracts per-agent floored unions from one floored grand total. Session totals are correct and do not change.

**Two-part correction:**

1. **Server (the exact fix).** Replace only the `overlap_seconds_removed` expression in `private.report_integrity_quality`: sum the exact per-agent raw-minus-union difference, then floor once (diff in §8).
   - Locally proven:
     - all four SQL suites pass
     - 60 payloads are identical apart from the corrected field
     - zero, exact, sub-second and multi-day fixtures behave
     - three negative controls trip
     - rollback restores the byte-identical preimage
     - a 4,000-trial randomized oracle shows 0 mismatches
   - A production read-only SELECT of the new expression gives **0** for W1–W5, with session seconds unchanged.
   - Adding the migration files is covered by plan approval. **Applying them to production needs a separate exact approval**, using the #41 Reports-only disabled window (about 1–2 minutes).
2. **Frontend guard (recommended, ships with the UI).** `qualityNotes` prints `0` duplicate seconds whenever `overlapping_rows = 0`. The sentence shape is unchanged, so the synthetic golden CSVs (0/0 and 2/1800) stay byte-identical. This is correct by construction, matches the server fix, keeps screen and CSV identical, and fixes the display even before the SQL window. With the server fix applied, it is redundant but harmless.

**CSV effect:** the "Sessions assessed …" note changes "3" → "0" in affected windows. That is the only intended CSV byte change besides R-6.

### 4.3 Regression coverage (approved: buckets, session-end clipping, additional-policy isolation)

All synthetic SQL fixtures use a **separate synthetic organization**. The browser payload JSON is generated from the same database run, and `verify.mjs` pins the Oct 1 values. Each item gets an `rt.reject_mutation` negative control.

| ID | Test | Catches (proven by local mutation probes) |
|---|---|---|
| **T-1** | v2 bucket values: `by_hour`, `by_date`, `by_day_of_week`, heatmap; DST 23 h / 25 h days; Havana first midnight; inbound vs outbound; disposition name fallback; Converted identity | UTC bucketing, elapsed-hours-since-midnight bucketing, UTC daily buckets, call-id converted key (all currently survive the suite) |
| **T-2** | Session crossing the window **end** and the **start** (agency midnight), per day and 2-day union; overlap fixture with exact removed seconds | Removing the end clip (currently survives) |
| **T-3** | Primary premium beside a premium-less additional policy, and an explicit additional zero | Additional policy borrowing the primary premium (currently survives) |
| **T-4** | Frozen registry snapshot (ids, groups, teamOnly, `DEFAULT_LAYOUT`, `MAX_VISIBLE_STATS`) + saved-layout page test | Silent loss or reset of saved layouts |
| **T-5** (recommended) | v2 booking credit per agent, status independence, user_id fallback, reviewed-mapping exclusion, `callback_calls` independent of bookings | 4 booking mutations that currently survive |
| **T-6** (recommended) | v2 Agent-caller campaign visibility: no restricted ids or names in any payload | A visibility leak (the partition check alone cannot detect one) |

### 4.4 Separate tasks — NOT in this branch

| ID | Severity | Item | Status |
|---|---|---|---|
| **S-1** | medium, security | Team Leaders can `UPDATE company_settings.timezone` (RLS meant for the TV banner); the validator accepts `NULL` and `Factory` | Documented in `security-tasks.md`. Needs `#APPROVE_RLS_CHANGE` and its own plan. |
| **S-3** | medium, security | Agents can directly `INSERT`/`UPDATE` their own `dialer_sessions` timestamps; "server-timestamped" is not enforced | Documented in `security-tasks.md`; its own plan |
| S-2 | low | Team Leaders can write org-default `report_layouts` (original design) | Recorded only |
| X-1 | low, Dialer | Header session ticker spans local midnight | Recorded; Dialer scope |
| X-2 | docs | AGENT_RULES line 130 "identical coverage" is contradicted by 294 legacy calls | Wording correction proposed (§12) |
| X-3 | future | Numeric disclosure of unreviewed duplicate candidates | Backend; not proposed now |

### 4.5 Decisions requested (defaults in bold)

| ID | Question | Default if you approve without comment |
|---|---|---|
| D-3 | Period presets become one "Report period" select. This is the main lever for the mobile filter height. | **Yes** |
| D-4 | Disposition donut → ranked share list; Call summary collapsed by default | **Yes** |
| D-5 | Ties for "Most policies — current assignments" | **Show "N agents tied · X policies each"** |
| D-6 | Screen-only columns: Agent "Contacted calls", Efficiency "Session-matched calls"; Lead-source "Converted" hidden on screen (CSV unchanged) | **Yes** |
| C-1 | Campaign CSV "Known / total policies" is written as `4/4`, which spreadsheets turn into dates | **No change in this branch** (CSV values preserved); fix later if wanted |
| R-3b | Frontend guard in addition to the server fix | **Yes** |
| R-6 | Singular "1 estimate" / "1 conflict" | **Yes** |
| W | New Data basis sentences marked N/O in `data-basis-wording.md` (B1.5, B2.4, B2.5, B8.4, B9.3, C13 subtitle) | **Include N rows; omit O rows (B1.5, B8.4)** |

---

## 5. Proposed page layout

The direction came from a judged comparison of three independent proposals. The executive-hierarchy direction won; it absorbed the best table and accessibility ideas of the analyst proposal and the first-screen economy of the mobile proposal.

**Principles:**
- production first
- numbers over prose (about 45 → about 12 always-visible strings)
- one accent (`--primary`; status colours never act as series colours)
- one table style, one duration format, sentence case
- **no number, payload, export guard, registry id, group, cap or default changes**

### 5.1 Wireframes

```
DESKTOP 1440 (header ≤ 150 px; today 223/275)
Reports                                                    [⚙ Customize] [⤓ Export] [↻]
[Personal | Team | Agency]  [📅 Last 30 days ▾]  [👥 All agents ▾]
Sep 9 – Oct 8, 2026 · America/Los_Angeles · Summary as of 8:44 PM PDT        ⓘ Data basis
┌ Policies sold ───────────────┬ Known annual premium ───────────────────── (● Partial)* ┐
│ 4                            │ $3,831.72                                               │
│ Primary + additional policies│ ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  4 of 4 premiums known                 │
│ Most policies — current      │ Known monthly $319.31 · Avg per known policy $957.93    │
│ assignments: <agent> · N     │                                                         │
├──────────────────────────────┴─────────────────────────────────────────────────────────┤
│ Current book · stored policies by sale date · monthly premium ×12 · client's current agent ⓘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
[Calls made][Contacted calls][Call contact rate][Bookings created (all types)][Talk time][Dialer session time]
Trends                                                         [ Daily | Weekly | Monthly ]
[Production trend: Policies sold bars / Known annual premium line] [Calling trend: Outbound calls bars / Call contact rate line]
Period totals · Independent period totals, not one cohort.   (5 equal tiles, no arrows)
Performance: Agent performance · Agent efficiency (collapsed) · Campaign performance · Lead sources (all full width)
Dialer intelligence: Disposition breakdown (ranked list) | Calling heatmap (semantic table); others collapsed

MOBILE 390×844 (filter block ≤ 216 px; today 427 preset / 479 custom)
Reports                               [⚙] [⤓] [↻]       40 px targets, sr-only names
[  Personal  |   Team   |  Agency  ]
[📅 Last 30 days ▾] [👥 All agents ▾]
Sep 9 – Oct 8, 2026 · America/Los_Angeles
Summary as of 8:44 PM PDT              ⓘ Data basis
┌Policies sold │ Known annual premium ┐  both values end ≤ y380 (today ≈ y710–983)
│4             │ $3,831.72            │
└──────────────┴──────────────────────┘
Six metrics in a 2 × 3 grid, complete ≤ y844 (today ≈ y1,723)
```

\* "Partial" appears only when `0 < known < count`. All-unknown shows "Unavailable" with no meter. The empty cohort shows $0.00 and "Avg per known policy —".

A prototype built with the repository's own Tailwind measured the new mobile header at **205 px** (preset) and **253 px** (Custom), −52% and −47%.

### 5.2 Header and filters

- "Reports" heading, no subtitle. Customize, Export and Refresh keep their order and accessible names; below `sm` they are 40 px icon buttons with sr-only labels.
- **Scope tabs:** server `available_scopes`; every selection still clears the agent drilldown; skeleton while loading.
- **Period:** one Radix Select, `aria-label="Report period"`. Options in this exact order: Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom range.
  - Still computed from the server agency `today`.
  - Custom shows the existing Start and End date pickers.
- **Agent:** Select with `aria-label="Agent filter"`; options only from `get_report_scope().agents`.
- **Context line:**
  - period
  - zone
  - `data-testid="report-as-of"` "Summary as of h:mm TZ", with `<time dateTime>`, only for a ready, current summary and never cached
  - Data basis trigger: 20 px visual, 40 px hit area
- **Structure:** the toolbar root stays `<header>`, a direct child of `[data-reports-workspace]`.

### 5.3 Production band (fixed; unregistered)

- **Layout:** one card. Policies sold (2fr) | Known annual premium (3fr), values `data-report-value="hero"`, `tabular-nums`. A long premium (>12 characters) stacks instead of shrinking.
- **Premium logic:** unchanged. Exact cents.
- **Coverage:**
  - shadcn `Progress` meter (no new inline styles)
  - "3 of 8 premiums known · 5 unknown excluded"
  - Partial chip
  - no percentage
  - average "—" at zero known
- **"Most policies — current assignments":** now from the **same summary payload**. This removes today's cross-panel join and its guard.
- **Basis bar:** "Current book · stored policies by sale date · monthly premium ×12 · client's current agent · ⓘ Data basis".
- **Policy-quality note:** still shown verbatim when non-zero.

### 5.4 Six-metric strip

- **Unchanged:** `SectionRenderer`, saved order and visibility, 6-cap, team-only filter, ids and `DEFAULT_LAYOUT`.
- **Tiles:** flex-wrap with no filler; compact (68–84 px).
- **Subtitles** only where they change how a number reads:
  - duration caution "Durations: 1,263 unknown source or amount · 484 conflicting" (caution dot)
  - "2 stale, capped at last heartbeat"
  - "Dials per booking — all booking types"
- **Label:** "Contacted" → "Contacted calls".
- **One duration format, `formatElapsed`:** "28h 4m 3s / 3m 21s / 45s", matching the Leaderboard. 0.1 s precision is used only for the two fractional payload fields (R-5). CSVs keep raw seconds.

### 5.5 Trends (fixed; unregistered)

- "Trends" heading (`h2#report-trends-title`) with **one** Daily/Weekly/Monthly control for both charts; Monday weeks.
- **Stacked single-axis panels per card**, sharing one series array and a hover sync, so the dual axes go away.
- **Chart chrome:** solid subtle grid, 11 px ticks, aligned 48 px y-axes, `accessibilityLayer`, and CSS height classes (not JS breakpoints).
- **Data rules:**
  - **gaps stay gaps** (`connectNulls={false}`)
  - partial premium bucket = hollow dot plus a legend line shown only when one exists
  - rate axis zero-based with a nice maximum
  - zero-call buckets read "rate unavailable"
- **Touch:** tooltips pin to the top.
- **No comparisons, sparklines, growth percentages or goals.**

### 5.6 Period totals (replaces "Activity and production")

- `section[aria-labelledby="report-totals-title"]`: five equal `dt`/`dd` tiles.
- **Captions:**

  | Tile | Caption |
  |---|---|
  | Calls made | by call date |
  | Contacted calls | by call date |
  | Bookings created (all types) | **by date created** |
  | Converted leads/clients | distinct people · by call date |
  | Policies sold | by sale date |

- **No arrows or percentages.**
- One line: "Independent period totals, not one cohort." The full cohort statement moves verbatim to Data basis.

### 5.7 Tables — visibility of important columns (approved direction)

1. **One shared frame:** `ReportTableFrame` is a focusable labelled region (`role="region"`, `aria-label`, `tabIndex=0`) with a sticky first column. Every `tr > :first-child` is sticky with opaque `bg-card`, `tfoot` included. A right-edge fade is a sibling of the scroller.
2. **Table style:** sentence-case headers; right-aligned `tabular-nums`; `py-2.5`. Below `sm`, `th` wraps with a max width, so "Policies (current assignment)" is visible at scroll position 0.
3. **All performance tables go full width.**
4. **Campaign performance screen order:** Campaign | Policies (campaign-attributed) | Known annual premium | Known / total policies | Calls made | Contacted calls | Call contact rate | Leads dialed | Contacted leads | Converted leads | Type.
   - A separate `EXPORT_HEADERS` keeps today's CSV order.
   - Campaign names become real links (U-3).
   - The campaign chart is hidden below `sm`.
5. **`tfoot` rows replace paragraphs,** with one cell per column (no colSpan):
   - "Unattributed"
   - "Attribution unavailable" (calls, policies, known premium, coverage, so the partition reconciles on screen)
   - "Not linked to a current lead": **still rendered when there are 0 sources and some unlinked calls**, so that disclosure never disappears
6. **Heatmap:** uses the same frame with a sticky day column (U-7).
7. **Agent table drilldown:** keeps `aria-pressed`; server ids only.
8. **CSV notes:** `CAMPAIGN_ATTRIBUTION_NOTE` is split into two constants whose concatenation stays byte-identical.

### 5.8 Dialer intelligence (secondary)

- Smaller heading weight.
- **Open by default:** Disposition breakdown, Heatmap. **Collapsed:** Call summary, Call flow, Call duration, Disposition deep dive. Not persisted.
- Ranked disposition list (U-2), semantic heatmap (U-7), segmented toggles (U-4).
- No `font-black` uppercase captions.

### 5.9 Data basis disclosure

- shadcn `Sheet`: bottom sheet below 768 px, right sheet above.
- **Two triggers**, each owning its own `SheetTrigger`, so focus returns to the one that opened it. Enter and Space open it; Esc closes it.
- **Content:** final traced wording in `data-basis-wording.md`. Sections:
  - policies sold
  - premium
  - agent credit (incl. why the Leaderboard differs)
  - calls
  - bookings
  - converted
  - period totals
  - talk time and sessions (incl. the preserved late-ended rule and the session-rate denominator)
  - attribution
  - live data quality (only for a ready, current summary; screen = CSV sentences; never zeros)
  - time zone and freshness
- **Placement of the wording:**
  - new policy sentences → constants in `reports-policy-text.ts`
  - other sentences → `src/lib/reports-basis-text.ts`
  - neither is referenced by the CSV note builders

### 5.10 Customization: preserved exactly

- **Unchanged:**
  - 38 registered ids and groups, `DEFAULT_LAYOUT`, `MAX_VISIBLE_STATS = 6`, the v4 normalizer
  - owner/epoch binding, no write-on-read, Save/Cancel/Reset, failed-draft retention, truthful save errors
  - View As gating, no org-default writes
  - the toolbar Customize button cancels in edit mode (today's behaviour, kept)
- The band, trends, period totals, Data basis and toolbar stay fixed and unregistered.
- **Only changes:** one intro line, mobile ergonomics (larger move targets, sticky Save/Cancel bar below `sm`), U-6 and U-9.
- **U-6 guard:**
  - `customRangePending = scopeData && !withheld && preset === "custom" && (range === null || rangeProblem !== null)`
  - `customizationReady` requires sections, except while already editing
  - the editor renders outside the tabpanel **only** when `customRangePending`
  - owner masking and View As (`viewerId = null`) keep it disabled

### 5.11 Copy cleanup (main items)

| Current | Proposed |
|---|---|
| "Production and the activity behind it." | removed |
| 7 preset buttons | "Report period" select |
| "Your agency · America/Los_Angeles" | "· America/Los_Angeles · Summary as of …" (the tab shows scope) |
| Policy and premium methodology paragraphs (×9 repeats) | basis bar + Data basis |
| "3 of 8 policies have a known premium." + "excluded from amount" | "3 of 8 premiums known · 5 unknown excluded" + meter + Partial chip |
| Strip formula subtitles | none, or a data-quality caution |
| Axis legends, trend footnotes, Peak/Total tiles | metric captions; conditional partial/gap legend |
| "Activity and production" + 70-word disclaimer | "Period totals · Independent period totals, not one cohort." |
| Section subtitles and table paragraphs | removed / `tfoot` rows / Data basis |
| Bottom "Report basis and data quality" (raw ISO) | top "Data basis" sheet, localized as-of |
| "Dials per appointment" | **"Dials per booking"** |

**Kept verbatim:**
- "Call contact rate", "Policies (current assignment)", "Most policies — current assignments", "Policies (campaign-attributed)", "Bookings created (all types)", "Callback dispositions", "Dials per policy sold"
- "No policies sold in this period.", "No outbound calls; rate unavailable."
- "This is not a zero — …", the time-zone configuration message, "You don't have access to Reports.", "Use default report scope"
- the 6-cap copy and the Reset line

---

## 6. Data basis wording

See `data-basis-wording.md`. Rule scans pass on all 72 strings:
- "call contact rate" only
- no conversion rate except negations
- no "%" in the band

---

## 7. Exact files

### 7.1 Frontend — modify (current → projected lines; every component stays under 200)

| File | Now | Proj. | Change |
|---|---:|---:|---|
| `src/pages/Reports.tsx` | 165 | ~160 | compose band, trends, notices; U-6 guard; as-of; remove bottom data-quality block |
| `src/hooks/useReportsData.ts` | 228 | 228 | R-4 only (one line) |
| `src/components/reports/ReportsToolbar.tsx` | 134 | ~85 | three compact rows; period and context extracted |
| `src/components/reports/ReportScopeTabs.tsx` | 35 | ~42 | skeleton; U-8 |
| `src/components/reports/ReportsOverview.tsx` | 89 | ~130 | production band, leader row, basis bar |
| `src/components/reports/SectionRenderer.tsx` | 57 | ~60 | U-5 strip; headings; performance full width |
| `src/components/reports/StatCard.tsx` | 32 | ~42 | `noteTone`; U-10 |
| `src/components/reports/StatsGrid.tsx` | 14 | ~16 | pass `noteTone` |
| `src/components/reports/ReportSection.tsx` | 46 | ~48 | `meta` slot replaces `badge` |
| `src/components/reports/PoliciesSoldChart.tsx` | 186 | ~125 | stacked single-axis panels; tiles and join removed |
| `src/components/reports/CallVolumeChart.tsx` | 148 | ~120 | stacked panels; grouping control moved; nice rate max |
| `src/components/reports/ReportsActivityFlow.tsx` | 51 | ~45 | Period totals (U-1) |
| `src/components/reports/AgentPerformanceCards.tsx` | 120 | ~118 | table frame; Contacted calls; `tfoot` |
| `src/components/reports/AgentEfficiency.tsx` | 191 | ~135 | table frame; Session-matched calls; scatter extracted |
| `src/components/reports/CampaignPerformance.tsx` | 173 | ~130 | Link (U-3); screen column order; separate export headers; `tfoot` extracted |
| `src/components/reports/LeadSourceTable.tsx` | 135 | ~115 | Converted hidden on screen; `tfoot` always shown when unlinked > 0 |
| `src/components/reports/CommunicationsStats.tsx` | 128 | ~125 | screen/export arrays split; `formatElapsed`; R-5 |
| `src/components/reports/CallingHeatmap.tsx` | 171 | ~110 | grid extracted; segmented toggle |
| `src/components/reports/DispositionsPieChart.tsx` | 174 | ~130 | ranked share list (U-2) |
| `src/components/reports/DispositionDeepDive.tsx` | 185 | ~172 | segmented (U-4); duplicate-colour treatment |
| `src/components/reports/CallFlowAnalysis.tsx` | 145 | ~138 | chart theme; captions |
| `src/components/reports/CallDurationAnalysis.tsx` | 160 | ~150 | chart theme; R-5 |
| `src/components/reports/ReportPanelState.tsx` | 91 | 91 | weight/icon only; copy verbatim |
| `src/components/reports/ReportCustomizer.tsx` | 119 | ~135 | U-9; intro line; sticky mobile bar |
| `src/components/reports/reportSectionMap.tsx` | 99 | ~92 | drop `summary`/`onGroupingChange`/`goal_tracking`; sentence-case titles |
| `src/components/reports/ReportDataQuality.tsx` | 13 | ~32 | live list inside Data basis |
| `src/lib/stat-computations.ts` (lib) | 307 | ~318 | R-1; "Contacted calls"; `formatElapsed`; quality notes |
| `src/lib/reports-format.ts` (lib) | 227 | ~262 | `formatElapsed`, `formatAsOf`, sentence-case presets |
| `src/lib/reports-policy-text.ts` | 58 | ~62 | byte-identical campaign-note split; new policy basis constants |
| `src/lib/reports-integrity-text.ts` | 29 | ~31 | R-3 guard; R-6 singulars |

### 7.2 Frontend — create

| File | Proj. | Purpose |
|---|---:|---|
| `src/components/reports/ReportsNotices.tsx` | ~48 | existing notices moved verbatim |
| `src/components/reports/ReportPeriodControl.tsx` | ~95 | period select, date pickers, validation |
| `src/components/reports/ReportContextLine.tsx` | ~40 | period · zone · as-of · Data basis |
| `src/components/reports/PremiumCoverage.tsx` | ~45 | meter, coverage text, Partial chip |
| `src/components/reports/ReportTrends.tsx` | ~45 | Trends heading + one grouping control |
| `src/components/reports/ReportSegmented.tsx` | ~35 | `role=group` + `aria-pressed` |
| `src/components/reports/reportChartTheme.tsx` | ~55 | grid, tick and margin constants, `PartialDot` |
| `src/components/reports/ReportTableFrame.tsx` | ~30 | focusable labelled region, caption, fade |
| `src/components/reports/reportTableStyles.ts` | ~20 | shared table classes |
| `src/components/reports/ReportDataBasis.tsx` | ~75 | trigger + Sheet shell |
| `src/components/reports/DataBasisSections.tsx` | ~85 | static + live sections |
| `src/components/reports/AgentEfficiencyScatter.tsx` | ~60 | extraction |
| `src/components/reports/HeatmapGrid.tsx` | ~80 | extraction (semantic table) |
| `src/components/reports/CampaignTotalsFoot.tsx` | ~35 | extraction |
| `src/lib/reports-basis-text.ts` | ~75 | basis text composed from existing constants |

**Optional:** `CampaignCallsChart.tsx` (~50); `src/lib/reports-page-state.ts` (~30, pure U-6 predicate). Delete `GoalTracking.tsx` and `DraggableSection.tsx` in a separate commit (unreachable). Do not delete `CustomReportBuilder.tsx` or `ScheduledReportsModal.tsx`; they are still referenced.

### 7.3 SQL (R-3 server correction; production apply separately approved)

| File | New / modified | Purpose |
|---|---|---|
| `supabase/migrations/2026100917xxxx_reports_overlap_release_disable.sql` | new | exact bytes of `supabase/ops/reports_disable.sql` |
| `supabase/migrations/2026100917xxxx_reports_integrity_quality_overlap_seconds.sql` | new | guarded replacement of `private.report_integrity_quality`: refuses replay, preimage/dependency/ACL drift, and any client-executable Reports function; postcondition checks md5, metadata and ACL |
| `supabase/migrations/2026100917xxxx_reports_overlap_release_enable.sql` | new | exact bytes of the updated ops enable |
| `supabase/migrations/rollback/…_reports_integrity_quality_overlap_seconds.rollback.sql` | new | restores the byte-identical preimage only while disabled |
| `supabase/ops/reports_integrity_enable.sql` | modified | line 11 pin only: `d330c5be…` → `c1355d55…` |
| `scripts/reports_integrity_fixture.py` | modified | historical steps use the applied `20261006044003` enable; finds migrations by suffix; asserts release copies equal the ops sources; adds the release and regression steps |

Final version numbers are assigned at commit. After a production apply, the files are renamed to the recorded versions, per the established practice.

### 7.4 Tests

**Update** (exact per-line changes recorded in the review notes):
- **Strict Reports set** (must pass in CI): `ReportsOverview.test.tsx`, `reportsControls.test.tsx`, `reportStatComputations.test.ts`, `reportsPage.test.tsx`, `reportsContracts.test.ts` (extend the "call contact rate" scan to the new `.ts` text modules; add the under-200-lines rule)
- **Non-strict:** `reportTrendCharts.test.tsx`, `agentPerformanceTable.test.tsx`, `reportPresentation.test.tsx`, `reportCustomizer.test.tsx`

**New** (named into the strict set):
- `src/lib/__tests__/`: `reportsFormatElapsed.test.ts`, `reportsRegistrySnapshot.test.ts` (T-4), `reportsBasisText.test.ts` (golden constants and CSV notes)
- `src/components/reports/__tests__/`: `reportsCallDuration.test.tsx` (R-5), `reportsDataBasis.test.tsx`, `reportsTables.test.tsx`, `reportsTrends.test.tsx`
- extended: `reportsIntegrity.test.ts` (R-3, R-6), `reportsPolicySource.test.ts` (byte-identical split), `useReportsData.test.tsx` (R-4 key → null → same key)

**SQL:** `supabase/tests/reports_integrity.sql`, `reports_integrity_negative.sql` (T-1, T-2, T-3, and T-5/T-6 if approved), plus `supabase/tests/reports_integrity_overlap_fixture.sql` and `reports_integrity_overlap.sql` (R-3).

**Browser gate:**
- `scripts/tests/reports-visual/verify.mjs`:
  - every protective assertion kept
  - about 25% of selectors replaced (period combobox, Data basis instead of `<details>`, ranked list instead of pie sectors, sentence-case CSV button names; filenames unchanged)
  - F-1 fixed
  - new first-screen budgets, table cues, Data basis keyboard and focus, R-4 frame probe, R-1/U-6/U-8/U-9
- `scripts/tests/reports-visual/entry.tsx`: geometry-only app-chrome stand-ins
- `scripts/tests/reports-visual/README.md`
- **Unchanged:** `stubs.ts`, `vite.config.ts`, workflow files.

### 7.5 Docs

This plan and its companions; `verification.md` (new, at implementation); `WORK_LOG.md` (newest-first); `AGENT_RULES.md` amendments (§12).

### 7.6 Do not touch

- `src/lib/report-layout-constants.ts`, `src/lib/report-layout.ts`, `src/hooks/useReportLayout.ts`
- `src/lib/reports-queries.ts`, `src/lib/reports-schemas.ts`, `src/lib/reports-export.ts`
- `src/index.css`, `tailwind.config.ts`
- any RLS policy, grant, Edge Function
- `TwilioContext.tsx` and the Dialer
- any SQL other than §7.3 and tests

---

## 8. Backend release for R-3 (separate exact approval to apply)

**Body change** (only this expression in `private.report_integrity_quality`; body md5 `d330c5be…` → `c1355d55…`):

```diff
-    'overlap_seconds_removed',greatest(0,(SELECT coalesce(floor(sum(extract(epoch FROM span_end-span_start))),0) FROM s WHERE span_end>span_start)
-      -(SELECT coalesce(sum(session_seconds),0) FROM private.report_session_seconds(p_org,p_start,p_end,p_agents)))));
+    'overlap_seconds_removed',greatest(0,(SELECT coalesce(floor(sum(u.raw_seconds-u.union_seconds)),0) FROM (
+      SELECT g.raw_seconds,(SELECT sum(extract(epoch FROM upper(r)-lower(r))) FROM unnest(g.spans) r) union_seconds
+      FROM (SELECT sum(extract(epoch FROM s.span_end-s.span_start)) raw_seconds,range_agg(tstzrange(s.span_start,s.span_end,'[)')) spans
+            FROM s WHERE s.span_end>s.span_start GROUP BY s.agent_id) g) u))));
```

**Unchanged:** signature, `jsonb`, `sql`, `STABLE`, security invoker, owner `postgres`, pinned `search_path`, ACL `{postgres=X/postgres}`, session facts, session seconds, the late-ended rule.

| Fixture | Exact | Current | Proposed |
|---|---|---|---|
| No overlap, 3 agents | 0 | 2 | **0** |
| Overlap | 1,810.75 | 1,811 | **1,810** |
| Sub-second overlap | 0.4 | 1 | **0** |
| Four days | 1,811.15 | 1,813 | **1,811** |

**Release order** (AGENT_RULES #41 pattern; each step read back):

| Step | Action | Expect |
|---|---|---|
| 0 | Exact-head CI green (reports-backend native PG 17.6 + browser, reports-frontend, reporting-integrity, sms-consent, dialer-dnc-backend); read-only preflight of 34 functions, pins and grants | — |
| 1 | Disable | 0 client-executable Reports functions; Reports shows "temporarily unavailable" for about 1–2 minutes |
| 2 | Correction | new md5, unchanged ACL |
| 3 | Guarded enable | fifteen pins; grants only on the six v2 functions; anon denied on all 34 |
| 4 | Read-back | W1–W5 role simulation shows 0 removed seconds and unchanged session seconds |

**If a step fails:**
- If step 2 refuses: re-enable with the `20261006044003` bytes as a new migration.
- If step 3 refuses: investigate; if the cause is the reader pin, run the rollback while disabled, then the historical enable. Reports stays disabled (fail closed) until resolved.

**Approvals:** adding the files is covered by plan approval. **Applying them, and any rollback, needs Chris's separate exact approval** (#28/#41). No RLS change, data write or Edge change is involved.

**Unverified:**
- DDL and guards ran on PostgreSQL 16 only; CI's 17.6 job will run them. (The new expression itself ran on production 17.6 as a read-only SELECT.)
- The hosted apply and rollback have not been executed.

---

## 9. Verification strategy

### 9.1 Implementation (after approval)

- **Branch:** `claude/reports-refresh-audit-20261009`.
- **Reviewable commits, each independently revertible:**
  1. defect fixes R-1, R-4, R-5, R-6, R-3 guard, with tests
  2. shell (toolbar, period, context line, notices, Data basis)
  3. production band and strip
  4. trends
  5. period totals
  6. table system (U-11, U-3)
  7. dispositions
  8. heatmap
  9. customizer (U-6, U-9)
  10. SQL tests T-1..T-6
  11. R-3 SQL migration set
  12. browser gate (`verify.mjs`/`entry.tsx`)
  13. docs
- **Rule:** tests that pass removed props are updated in the same commit; `tsconfig.app.json` type-checks tests.

### 9.2 Gates before requesting release

1. `npx tsc --noEmit`; `npx tsc --noEmit -p tsconfig.app.json`: still 85, no new signatures.
2. Reports vitest (strict set + all Reports files, with `REPORTS_SQL_PAYLOADS`). Full-suite base comparison: same 10 pre-existing failing files, no new failures or runtime errors. ESLint on changed files. `vite build`.
3. **Assertion diff review:** every removed or changed `expect`, with its reason. A grep confirms the protected guards remain ("This is not a zero", "Unavailable", "—" for zero denominators, export identity).
4. **Native SQL** on local PG16 (and CI 17.6): all Reports suites, new T-* assertions, negative controls, the R-3 release, drift refusals and rollback proof.
5. **Real Chromium on the fixture:**
   - Viewports: 390×844, 390×664, 768, 1024, 1440×900. Light and dark. Personal, Team and Agency.
   - **390×844 gates:** filter block ≤ 216 px; both production values ≤ y380; six tiles complete ≤ y844; header targets ≥ 40 px; hero values on one line.
   - **1440 gate:** header ≤ 150 px; strip and Trends heading on the first screen.
   - No page overflow; no clipped money; table cues and important columns; Data basis keyboard and focus return.
   - Customization save/cancel/reset/failed save; stale-export withholding; partial failure and retry; R-4 frame probe; axe.
   - Before and after screenshots.
6. **CSV byte comparison** against the golden base: 74 deterministic downloads covering all 13 export controls, every view toggle and grouping, in Agency, Team and Personal.
   - The clock is pinned and downloads are paced.
   - The synthetic set is expected to be **byte-identical**. Neither the R-3 guard nor R-6 changes those fixtures' text.
   - On live data, only the R-3 digit (and R-6 when a count is 1) may differ in the "Sessions assessed …" note.
7. **Read-only production re-check:** rerun the W1–W5 reconciliation and catalog parity.
8. Independent code review of the diff.

### 9.3 Release (separate approval)

1. Publish the branch and a draft PR; all exact-head CI gates must pass.
2. On approval, merge (no direct push to `main`). Vercel deploys.
3. Verify through the Vercel API:
   - deployment READY
   - `githubCommitSha` = merge SHA
   - `www.fflagent.com` alias moved
   - the served entry contains the new strings

   Direct HTTPS to the site is blocked here.
4. The R-3 SQL window (§8) runs only on its own exact approval. The frontend guard keeps the display correct either way.
5. **Rollback:** revert the merge. No layout or data migration is involved.

### 9.4 Hosted checklist for Chris (cannot be run from this environment)

Run on a desktop and a real iPhone, as Admin and, where available, as Team Leader and Agent:
- first screen shows both production values
- period select, scope tabs, agent filter
- Refresh
- Data basis open and close
- Customize → save, cancel, reset
- download the Summary, Agent and Campaign CSVs and open them in a spreadsheet
- an A→B→A filter switch

Until this is done, hosted behaviour is recorded as **Unverified**.

---

## 10. Risks

- **Test churn:** about 30 assertions in 9 files. The guards for zero, unknown, Unavailable and export identity are rewritten, never loosened.
- **Sticky cells inside overflow regions** on iOS Safari are unverified until the hosted checklist.
- **Stacked charts** render four chart containers instead of two.
- **The CSV notes' byte identity** depends on the constant split; a test pins it.
- **The heatmap and disposition rewrites** are the largest UI changes, each in its own commit.
- **The R-3 SQL window** briefly disables Reports. It fails closed, and the rollback is proven locally.

---

## 11. Approval requested

1. Implement §5–§7 on the isolated branch, including:
   - R-1 (the approved "Dials per booking")
   - R-4, R-5, R-6
   - U-1..U-11, F-1
   - the R-3 frontend guard
   - the R-3 SQL migration **files**
   - T-1..T-4, plus T-5/T-6 if you accept them
2. Accept or change the defaults in §4.5.
3. Confirm the separate security tasks S-1 and S-3 stay out of this branch.

**What happens after approval:**
- I implement, run every §9.2 gate, update `WORK_LOG.md`, and provide before/after screenshots and a context snapshot.
- I don't push to `main`, deploy, apply migrations, change RLS or write production data without your separate exact approval.

---

## 12. Context snapshot

- **State:** Phase 1 complete. Main and production `8d53531`. Reports SQL as deployed Oct 6, with no drift. 0 saved layouts.
- **Accuracy:**
  - Verified across W1–W5, open-day presets, every simulated scope, every browser-derived metric and every CSV (1,332/1,333 values; 140/140 CSVs).
  - Confirmed issues: R-3 (disclosure rounding), R-5 (display double rounding), R-1 (label), R-4 (one-frame repaint).
  - Reports and Leaderboard agree by month on 9/9 policy identities.
- **Decisions recorded:** late-ended sessions preserved; S-1 separate.
- **New separate security finding:** S-3 (session timestamps writable by agents).
- **Migrations and deployments:** none.
- **Blockers:** hosted signed-in verification is impossible from this environment.
- **Proposed `AGENT_RULES.md` updates at implementation:**
  - Amend the Reports personal layout invariant to name the fixed production band, trends, period totals and Data basis, and to require that screen basis text and CSV notes come from shared constants.
  - Amend #41 when R-3 is applied (new `report_integrity_quality` pin; still fifteen pins).
  - Correct line 130 "identical coverage" (294 legacy calls differ).
  - After S-3 is decided, qualify "server-timestamped" in #12 and #38.
