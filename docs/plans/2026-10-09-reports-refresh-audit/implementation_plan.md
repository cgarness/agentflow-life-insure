# Reports visual refresh and reporting accuracy audit — implementation plan

**Status: Phase 1 complete. Awaiting Chris's approval.** Prepared 2026-10-09 (UTC). No implementation file, migration, RLS policy, Edge Function, Vercel deployment or production row was changed. Production access was read-only throughout.

Companion files in this directory:
- `evidence-matrix.md`: the metric evidence matrix, reconciliation rows, Reports vs Leaderboard by policy identity, and deployed formulas.
- `screenshots/before/`: current page from the isolated synthetic fixture (not production numbers).

---

## 1. Baseline and source review

| Item | Finding |
|---|---|
| Documents read | `AGENT_RULES.md` in full (incl. #8, #12–#14, #23, #38–#41 and the Reports personal layout invariant), `VISION.md`, newest `WORK_LOG.md` entries, the 2026-09-28, 10-04, 10-05 and 10-06 Reports plans, release records and verification files. There is no `AGENTS.md` in the repository. |
| Repository | `main` @ `8d53531` (Oct 8 inbound forwarding fix). Working tree clean. |
| Production frontend | Vercel `agentflow` production deployment `dpl_28cKkn6bUSTKXTCoRgZ39iSCKTkP` = `8d53531`, READY, aliased to `www.fflagent.com`. The last Reports frontend change is Phase 2 (PR #421, Oct 6). |
| Production database | Newest Reports migrations applied: `20261006043725` → `20261006043731` → `20261006043738` → `20261006044003`. Nothing Reports-related since. Later migrations are SMS only. |
| Deployed SQL | `md5(prosrc)` of every Reports function and helper (30+ bodies) equals the newest repository migration body. The 15 bodies pinned by `20261006044003` match. No drift. |
| Grants | Only the six v2 RPCs grant `authenticated`/`service_role`. All v1 `get_report_*` and legacy `rpc_report_*` deny `authenticated` and `anon`. Private helpers are `postgres`-only. |
| Open work | 8 open PRs. None touches Reports, Leaderboard, policy, appointment or call reporting code (SMS START, Twilio balance, underwriting, old leaderboard drafts, Google OAuth, OpenAI realtime). |
| Saved layouts | `report_layouts` has **0 rows** in production. Every user sees `DEFAULT_LAYOUT`. Changing default order or visibility would change everyone's page. |

### Verification baseline at `8d53531` (recorded before any change)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | exit 0. The root project has `files: []`, so it checks nothing on its own. |
| `npx tsc --noEmit -p tsconfig.app.json` | 85 diagnostics, none in a Reports file. Earlier records say 87. |
| Reports vitest (19 files) | 217 passed, 1 skipped. 218/218 with `REPORTS_SQL_PAYLOADS`. Also 218/218 under five browser time zones. |
| ESLint, 61 Reports files | 0 problems |
| `npx vite build` | exit 0 |
| Full vitest | 4,321 passed, 1 failed, 34 skipped. The 10 failing files are exactly the pre-existing list, and none is a Reports file. |
| Native SQL (local PostgreSQL 16, loopback) | `run_reports_rpc_tests`, `run_reports_integrity_tests`, `run_profile_rpc_tests` and `run_reporting_integrity_tests` all PASS. CI uses 17.6. |
| Real Chromium fixture gate (`scripts/tests/reports-visual/verify.mjs`) | PASS (6/6) against the native SQL payloads |

### Evidence methods and their limits

- **Database-role simulation (live production):** Reports RPCs called inside `begin read only … rollback` as real profiles: Admin, Team Leader, Agent, another organization's Admin, Deleted profiles, and `anon`. This is not a signed-in browser or HTTP test.
- **Independent source queries:** expected values were computed from `calls`, `dispositions`, `pipeline_stages`, `dialer_sessions`, `appointments`, `campaign_leads`, `leads`, `clients`, `wins` and `profiles` without calling the `private.report_*` helpers.
- **Static inspection:** code and deployed SQL bodies.
- **Local synthetic:** vitest, native PG16 SQL suites, and real Chromium against the isolated fixture.
- **Hosted browser: BLOCKED, Unverified.** This environment's egress proxy refuses `www.fflagent.com` (CONNECT 403), and there are no credentials. The live CSV download, filter and refresh walkthrough left open by the Oct 5–6 releases therefore remains **unverified**. See §9 step 7.

---

## 2. Findings about the current design

Sources: the before screenshots, measured geometry from the synthetic fixture, and live magnitudes from the database-role simulation (Agency, Last 30 days).

1. **Header and filters cost too much space.** About 298px on desktop and about 490px on a 390px phone. Seven preset buttons wrap onto three rows on mobile. With the app TopBar, Known Annual Premium starts **below the first phone screen**.
2. **Too much always-visible explanation.** About 45 explanatory strings. The methodology repeats inline: `PREMIUM_BASIS` ×3, `CURRENT_ASSIGNMENT_NOTE` ×4, `POLICY_SOURCE_NOTE` ×2. The only disclosure is at the very bottom, and it shows the as-of time as raw ISO UTC.
3. **Heroes are tall (about 297px each) and inconsistent.** Different accents and icons. A partial premium prints at full emphasis, with coverage only as a sentence below it. (Good, and kept: exact cents, `tabular-nums`, "Unavailable" never $0.00.)
4. **The six-metric strip** shows grey filler tiles when fewer than 6 metrics are visible. Its subtitles are formula jargon. Durations use three formats side by side ("3:21", "2h 0m 0s", "0h 3m 21s").
5. **Trends:**
   - Both trend charts use two y-axes.
   - The Daily/Weekly/Monthly control sits inside the Calling card but also regroups Production.
   - Series use status colours (success, warning).
   - The call contact rate is drawn on a 0–100% axis, so a live 7.4% lies almost flat.
   - Gridlines are dashed, and the legends say "left axis / right axis".
6. **The activity strip draws `ArrowRight` between independent totals** (Calls → Contacted → Bookings → Converted → Policies). It needs a 70-word disclaimer to undo what the arrows imply. Four of its five values repeat the strip and heroes.
7. **Tables:**
   - Four different header and padding styles.
   - Wide tables silently hide columns inside horizontal scrollers. Campaign Performance shows 5 of 12 columns at 1440px, so its policy and premium columns are hidden. Agent Performance shows only Agent and Policies at 390px.
   - Lead Source has an always-"Not available" Converted column (23 live rows).
8. **Diagnostics** carry equal visual weight to performance. Captions use `text-[9–10px] font-black uppercase tracking-widest`.
9. **Accessibility:**
   - Dispositions are identified by colour only, and two live dispositions share `#EF4444`.
   - Campaign rows use `<tr role="link">`.
   - Toggles have no `aria-pressed`.
   - Heatmap values exist only in mouse-hover tooltips.
   - StatCard error text measures 1.81:1 contrast on the dark card.
   - Scope tabs have a dangling `aria-controls`.
10. **Dead code:** `GoalTracking.tsx` (built, never rendered) and `DraggableSection.tsx` (no importers).

---

## 3. Accuracy audit — results

**Headline.** For the audited metrics, windows and scopes, every Reports number on screen and in CSV matched an independent recalculation from source tables under the approved contracts. The only exceptions are the confirmed issues in §4. This is **not** an all-history certification; see §3.4.

### 3.1 Coverage

**Windows** (agency calendar dates, America/Los_Angeles):

| Window | Dates |
|---|---|
| W1 | 2026-10-01..10-07 |
| W2 | 2026-09-01..09-30 |
| W3 | 2026-09-08..10-07 |
| W4 | 2026-10-06 |
| W5 | 2025-10-08..2026-10-07 (366-day maximum) |

Also checked: a month boundary, a single day, and the DST days.

**Scopes simulated:**
- Admin: personal, team, agency, and agency narrowed to Alexa and to Will
- Team Leader: personal and team; agency is refused
- Agent: personal; team and agency are refused
- Another organization's Admin
- Deleted actors
- `anon`

**Panels:** all six v2 payloads. Every summary total, agent row, daily/hourly/day-of-week/heatmap series, disposition bucket, duration bucket, campaign row and lead-source row. Completed windows returned identical values on every rerun (as-of 03:40–03:53 UTC).

### 3.2 Representative results (W1 = Oct 1–7, agency)

| Metric | Expected (independent) | Actual (RPC) | Status |
|---|---|---|---|
| Calls made (outbound) | 1,833 | 1,833 | Verified (also W2 2,946; W3 4,136; W4 177; W5 5,639) |
| Inbound calls | 49 (5 attributed + 44 unattributed) | 49 | Verified |
| Contacted / call contact rate | 135 / 7.4% | 135 / 7.4% | Verified. 45 s → not contacted; 46 s → contacted unless No Answer. A ≥45 s rule would give 140. |
| Talk time | 39,893 s | 39,893 s | Verified |
| Duration buckets | 1,548 / 196 / 56 / 19 / 14 | same | Verified (sum = 1,833) |
| Duration provenance | 1,263 unknown, 484 conflict, 0 estimated | same | Verified (disclosed) |
| Bookings created (all types) | 25 (5 appointment / 5 callback / 15 unknown kind) | 25 | Verified |
| Callback dispositions / DNC dispositions | 6 / 17 | 6 / 17 | Verified (separate from bookings) |
| Converted leads/clients | 0 (W5: 2) | 0 (W5: 2) | Verified |
| Dialer session time | 95,862 s | 95,862 s | Verified (see D-1 for the ended-session rule) |
| Session-matched / unmatched calls | 1,118 / 715 | 1,118 / 715 | Verified (sum = 1,833) |
| Policies sold | 1 | 1 | Verified (W2 4; W3 4; W5 9) |
| Known annual premium | $1,281.60 (1/1 known) | $1,281.60 | Verified (W3 $3,831.72, average $957.93; W5 $10,655.52) |
| Campaign split | 1,146 attributed + 687 unavailable | same | Verified |
| `quality.sessions.overlap_seconds_removed` | 0 (no overlapping rows) | **3** | **Incorrect** (R-3) |

**Additive reconciliations** passed in every window:
- daily, hourly, day-of-week and heatmap totals = summary totals
- agent rows + unattributed = summary
- disposition buckets = duration buckets = matched + unmatched = calls made
- campaigns + unavailable = calls made
- lead sources + unlinked = calls made
- known + unknown premium count = policy count

### 3.3 Reports vs Leaderboard (stable policy identity)

Production holds **9 stored policies with 9 policy identities and exactly one original sale event each**. There are no identity gaps, removals or duplicate events. AGENT_RULES #40 records 8 policies / $9,373.92 as of Oct 5. One genuine new sale on Oct 5 (`e171ccaf`) makes 9 / $10,655.52.

Month totals are **equal** on both bases:

| Month | Policies | Premium |
|---|---|---|
| August | 4 | $6,168.60 |
| September | 4 | $3,205.32 |
| October | 1 | $1,281.60 |

The live `get_leaderboard_snapshot` month value agrees. Day and week buckets differ for four policies. This is expected, because the two bases use different dates:
- Three legacy events are 1, 5 and 12 days after the backdated `sold_date`.
- One repaired event uses the approved client-creation proxy, one day after the sale date.

No ownership differences exist today: every original seller is still the current assignee. Per-policy detail is in `evidence-matrix.md` Appendix B.3. **No change to either basis is proposed.**

### 3.4 Not certified, with the reason for each

- 277 historical call and 12 booking duplicate candidates remain unreviewed. `private.performance_duplicate_rows` has 0 rows, so nothing is excluded, as the contract requires. Example: five legacy pairs that share a provider call ID add +3 calls to W1.
- 3,559 of 4,364 last-30-day calls have legacy unknown duration provenance, and 690 are flagged duration conflicts (parent/child leg differences of at most 4 s; none changes Contacted).
- Not exercisable in production data (covered by synthetic SQL tests only):
  - bookings cancelled or completed after creation (every appointment is Scheduled or Confirmed)
  - estimated-duration provenance
  - additional policies, unknown, invalid or zero premiums (every live policy is primary with a known premium)
  - calls on a DST transition day
  - the America/Havana double-midnight case (sweep and code-checked: 596 zones × every day of 2026, 0 failures)
- Hosted browser behaviour (see §1).

---

## 4. Confirmed issues and proposed fixes

Every item below survived independent adversarial verification. "Disputed" means one verifier confirmed the facts while another judged the behaviour to be approved; those items are listed as owner decisions, not bugs.

### 4.1 In scope for this branch (frontend and tests only)

| ID | Severity | Issue | Root cause | Proposed fix |
|---|---|---|---|---|
| R-1 | low | The optional "Dials per appointment" tile divides calls by **Bookings created (all types)**. Live W1: 73.3 shown. With appointment and unknown-kind bookings only it would be about 91.7. | Oct 5 renamed the count but not this ratio (`stat-computations.ts:127,261-262`). | Relabel to "Dials per booking created (all types)". The id is unchanged; labels are not persisted. |
| R-2 | low | Campaign CSV "Known / total policies" is written as `4/4`, which spreadsheets turn into dates (4-Apr). | `CampaignPerformance.tsx:58-59` text template | **Decision C-1**: either split it into two numeric columns (changes CSV headers) or write "4 of 4". |
| R-3 | low | Data quality says "0 overlapping rows; 3 duplicate seconds removed" when nothing overlapped (1–5 s per window). | Server floors each agent's union separately and subtracts the sum from one floored grand total (`20261006043731:29-38, 348-349`). | **Decision C-2**: frontend omits the seconds clause when `overlapping_rows = 0` (recommended now), and/or a later approved SQL correction (B-3). Session totals are correct either way. |
| R-4 | low | Refresh and scope Retry re-paint the **previous** panel payloads for about one frame (12 ms in 5/5 real-browser runs) before loading. No wrong CSV is possible, because the export identity is already cleared. | `useReportPanels` returns early on a null key without clearing stored panels (`useReportsData.ts:196,226`). | `if (!key \|\| !request) { setStored(null); return; }` plus hook and page frame-probe tests. |
| U-1 | — (Chris's request) | Activity arrows imply a funnel. | `ReportsActivityFlow.tsx:38` | Remove the arrows; use equal independent tiles (§5.6). |
| U-2 | low a11y | Disposition series are identified by colour only; two live dispositions share `#EF4444`. | `DispositionsPieChart.tsx:109`, `DispositionDeepDive.tsx` | Ranked list with text identity; duplicate colour gets opacity and a ring (§5.8). |
| U-3 | low a11y | `<tr role="link" tabIndex>` campaign rows. | `CampaignPerformance.tsx:118-131` | `<th scope=row>` containing a real `<Link>` with a visible focus ring. |
| U-4 | low a11y | Deep Dive toggles expose no selected state. | `DispositionDeepDive.tsx:48-53,109-124` | Shared segmented control with `role=group` and `aria-pressed`. |
| U-5 | low | Strip shows grey filler tiles with fewer than 6 metrics. | `SectionRenderer.tsx:41-43` (`gap-px bg-border`) | Flex-wrap tiles with borders; no filler. |
| U-6 | low | Customize enters an invisible edit mode while the Custom range is incomplete. | `Reports.tsx:105,144-147` | Disable entry while there are no sections; render the customizer outside the `sections` block. |
| U-7 | low a11y | Heatmap values are reachable only by mouse hover. | `CallingHeatmap.tsx:118-133` | Semantic table with `th` headers and sr-only cell text. |
| U-8 | low a11y | Scope tabs point `aria-controls` at a panel that doesn't exist yet. | `ReportScopeTabs.tsx:27` | Emit it only when the panel renders. |
| U-9 | low a11y | Moving an item to the end of a group drops keyboard focus. | `ReportCustomizer.tsx:35,84-89` | Restore focus to the moved item's button. |
| U-10 | low a11y | Error text is 1.81:1 on the dark card; amber validation text is 3.19:1; small `text-primary` text is 3.63:1. | `StatCard.tsx:27-28`, `ReportsToolbar.tsx:106-107` | Foreground text plus a coloured icon. |
| U-11 | low | Wide tables hide policy and premium columns in scrollers with no cue. | `CampaignPerformance.tsx:99`, `AgentPerformanceCards.tsx:61` | Full-width performance tables, a sticky first column, a focusable labelled region and an edge fade (§5.7). |
| T-1 | test gap | v2 hourly, daily and day-of-week buckets, Converted, disposition fallback and inbound have no SQL value assertions. A UTC-bucketing mutation passes CI. | `supabase/tests/reports_integrity.sql` | Add value assertions and negative controls (§8). |
| T-2 | test gap | Session end-of-window clip is untested (a mutation survives). Production has 6 sessions that cross local midnight. | same | Add fixtures for crossing the end and the start, plus a negative control. |
| T-3 | test gap | Nothing detects an additional policy borrowing the primary premium. | same | Add a fixture with a primary premium and a premium-less additional policy, plus a negative control. |
| T-4 | test gap | No frozen registry contract test, and page tests only use `DEFAULT_LAYOUT`. | layout tests | Add a frozen ids/groups/teamOnly/cap snapshot and a saved-layout page test. |

### 4.2 Backend or security findings — separate, NOT part of this branch

Each needs its own exact approval.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| S-1 | **medium, security** | RLS policy `company_settings_team_leader_update`, written for the TV banner, lets any Team Leader `UPDATE` the whole `company_settings` row, **including `timezone`**, through PostgREST. `validate_iana_timezone` also accepts `NULL` and `'Factory'`. A Team Leader could shift every agency Reports, Leaderboard and Dashboard window, or force an org-wide 55000 outage. Verified read-only (policy, grants, trigger, role-simulation `USING` match, `EXPLAIN`); no update was executed. | Separate security task under `#APPROVE_RLS_CHANGE`: restrict Team Leader writes to the banner column (column grant or a guard trigger), and reject NULL / `Factory` / `localtime` / `posixrules` on update. I'll prepare the migration and tests only if you ask. |
| S-2 | low (disputed) | `report_layouts` org-default rows are writable by Team Leaders (original 2026-05-13 design), with no status check and no size CHECK. The Reports UI never writes them, and the normalizer sanitizes them, so numbers are unaffected. | Record only. Reconsider when an admin-only default editor is built. Not changed here (the brief excludes org-wide layout writes). |
| B-3 | low | The server-side form of R-3. | Fold into the next approved Reports SQL migration (guarded disable → fix → enable, #41). Not proposed as its own release. |

### 4.3 Owner decisions (no defect claimed)

| ID | Question | Evidence | Options |
|---|---|---|---|
| D-1 | **Ended sessions count the whole gap after the last heartbeat.** The contract caps only stale *active* sessions. `end_dialer_session` sets `ended_at = now()` with no liveness check. | 11 sessions, 100,255 s all-time; Oct 1–7: 6,753 s of 95,862 s (7.0%). One 13.9 h gap has 0 calls, but another gap contains 30 calls, so a gap does not prove idleness. | (a) Keep and describe it in Data basis (frontend text only; **recommended for this branch**). (b) Later Reports SQL: disclose a count and seconds in `quality.sessions`. (c) Cap ended spans unless same-campaign calls prove activity (changes the basis). Changing `end_dialer_session` is Dialer telemetry and out of scope. |
| D-2 | Team scope silently excludes Deleted downline history; agency shows it as labelled rows. | W5 Admin team: 28 calls and 2 bookings excluded. | Keep (approved, tested), or add a disclosure later (SQL). |
| D-3 | Period presets: seven buttons → one "Report period" select. | Saves about 100px on phones and calms desktop; costs one extra tap. | Recommended: yes. |
| D-4 | Disposition donut → ranked share list; Call summary collapsed by default; donut-only chrome removed. | 98.9% of live calls sit in two grey slices. | Recommended: yes. |
| D-5 | Ties for "Most policies — current assignments". | Today an alphabetical tie-break silently names one agent. | Show "N agents tied · X policies each", or keep today's behaviour. |
| D-6 | Screen-only columns: "Contacted calls" (Agent performance) and "Session-matched calls" (Agent efficiency) added; Lead-source "Converted" hidden on screen (always "Not available"). | CSV headers unchanged. | Recommended: yes. |
| C-1 | CSV fix for R-2 | — | Two numeric columns (header change) **or** "k of n" text (no header change, recommended). |
| C-2 | Fix for R-3 | — | Frontend guard now (recommended); server fix only with a future Reports migration. |

---

## 5. Proposed page layout

The direction came from a judged comparison of three independent proposals: executive hierarchy, analyst density and mobile-first. The winner is the executive-hierarchy direction, with the best table and accessibility ideas from the analyst proposal and the first-screen economy of the mobile proposal.

**Principles:**
- **Production first.**
- **Numbers over prose.** About 45 → about 12 always-visible strings.
- **One accent** (`--primary`; status colours never act as series colours).
- **One table style, one duration format, sentence case.**
- **No number, payload, export guard, registry id, group, cap or default changes.**

### 5.1 Wireframes (estimates; Playwright will assert the budgets)

```
DESKTOP 1440
Reports                                                    [⚙ Customize] [⤓ Export] [↻]
[Personal | Team | Agency]  [📅 Last 30 days ▾]  [👥 All agents ▾]
Sep 9 – Oct 8, 2026 · America/Los_Angeles · Summary as of 8:44 PM PDT        ⓘ Data basis
┌ Policies sold ───────────────┬ Known annual premium ───────────────────── (● Partial)* ┐
│ 4                    (56px)  │ $3,831.72                                    (56px)     │
│ Primary + additional policies│ ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  4 of 4 policies known                  │
│ Most policies — current      │ Known monthly $319.31 · Avg per known policy $957.93    │
│ assignments: <agent> · N     │                                                         │
├──────────────────────────────┴─────────────────────────────────────────────────────────┤
│ Current book · stored policies by sale date · monthly premium ×12 · client's current agent ⓘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
┌Calls made┬Contacted calls┬Call contact rate┬Bookings created (all types)┬Talk time┬Dialer session time┐
│ 4,364    │ 323           │ 7.4%            │ 63                         │28h 4m 3s│ 114h 37m 51s      │
│          │               │                 │                            │● 3,559 unknown · 690 conflicting │
└──────────┴───────────────┴─────────────────┴────────────────────────────┴─────────┴───────────────────┘
Trends                                                         [ Daily | Weekly | Monthly ]
┌ Production trend                ⤓ ┐  ┌ Calling trend   121 inbound (not in rate)   ⤓ ┐
│ Policies sold (bars)        220px │  │ Outbound calls (bars)                    220px │
│ Known annual premium (line) 112px │  │ Call contact rate (line, 0–nice max)     112px │
└───────────────────────────────────┘  └────────────────────────────────────────────────┘
Period totals · Independent period totals, not one cohort.
[Calls made · by call date][Contacted calls][Bookings created (all types)][Converted leads/clients][Policies sold · by sale date]
Performance          Agent performance (full width, sticky first column, tfoot Unattributed)
                     Agent efficiency (collapsed) · Campaign performance (full width, tfoot Attribution unavailable)
                     Lead sources (full width, tfoot Not linked to a current lead)
Dialer intelligence  Disposition breakdown (ranked list) | Calling heatmap (semantic table)
                     Call summary · Call flow · Call duration · Disposition deep dive (collapsed)

MOBILE 390 (first screen ≈ 844px including the app TopBar)
Reports                               [⚙] [⤓] [↻]       40px targets, names kept for SR
[  Personal  |   Team   |  Agency  ]                    one tap, full width
[📅 Last 30 days ▾] [👥 All agents ▾]
Sep 9 – Oct 8, 2026 · America/Los_Angeles
Summary as of 8:44 PM PDT              ⓘ Data basis
┌Policies sold │ Known annual premium ┐  side by side; both values end ≈ y340
│4             │ $3,831.72            │
│              │ ▰▰▰▰ 4 of 4 known    │
└──────────────┴──────────────────────┘
Six metrics, 2 × 3                                      all six end ≈ y730
```

\* "Partial" appears only when `0 < known < policy count`. All-unknown shows "Unavailable" with no meter. The empty cohort shows $0.00 with "Avg per known policy —".

### 5.2 Header and filters

- "Reports" stays the heading. The subtitle is removed.
- Customize, Export and Refresh keep their order and accessible names. Below `sm` they become 40px icon buttons with sr-only labels.
- Scope tabs still come from server `available_scopes`. Every selection still clears the agent drilldown. A skeleton (not `null`) shows while the scope loads.
- **Period**: one select (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom range), still computed from the server agency `today`. Custom shows the existing Start and End date pickers. Validation uses foreground text with an icon.
- **Agent**: a select with `aria-label="Agent filter"`, listing only `get_report_scope().agents`.
- **Context line**: period · zone · "Summary as of h:mm TZ" (only for a ready, current summary; never cached) · Data basis trigger. "Summary as of" is deliberate: panels are independent responses (#41).

### 5.3 Production band (fixed; unregistered)

- One card with Policies sold (2fr) and Known annual premium (3fr). Values use `tabular-nums` at up to 56px. A long premium (>12 characters) stacks instead of shrinking.
- Premium state logic is unchanged. Exact cents. **Coverage is visible**: a meter, "3 of 8 policies known · 5 unknown excluded", and a Partial chip. No percentage. The average shows "—" at zero known.
- The "Most policies — current assignments" row (team and agency) now comes from the **same summary payload**. This removes today's cross-panel join and its guard.
- Basis bar: "Current book · stored policies by sale date · monthly premium ×12 · client's current agent · ⓘ Data basis".
- The policy-quality note still appears verbatim when non-zero.

### 5.4 Six-metric strip

- Same `SectionRenderer`, saved order and visibility, 6-cap, team-only filter, ids and `DEFAULT_LAYOUT`.
- No filler tiles. Compact tiles (68–84px).
- Subtitles only where they change the reading:
  - duration quality: "3,559 unknown · 690 conflicting durations", with a caution dot
  - session quality: "N stale capped", when greater than 0
- "Contacted" → "Contacted calls". R-1 relabel.
- One exact duration format: "28h 4m 3s / 3m 21s / 45s", the same as the Leaderboard. CSV keeps raw seconds.

### 5.5 Trends (fixed; unregistered; more prominent)

- A "Trends" heading with **one** Daily/Weekly/Monthly control that visibly governs both charts. Weeks still start Monday.
- Each card stacks two single-axis panels sharing a hover sync, which removes the dual axes. Captions name the metric, so counts, currency and percent are never on the same axis.
- Solid subtle grid, 11px ticks, aligned 48px y-axes, `accessibilityLayer`.
- **Gaps stay gaps** (`connectNulls={false}`). A partial premium bucket gets a hollow dot plus a legend line that appears only when a partial bucket exists.
- The rate axis is zero-based with a "nice" maximum, so 7.4% is readable. Zero-call buckets stay "rate unavailable".
- Touch tooltips pin to the top.
- No comparisons, sparklines, growth percentages or goals.

### 5.6 Period totals (replaces "Activity and production")

- Five equal tiles: Calls made, Contacted calls, Bookings created (all types), Converted leads/clients, Policies sold. Each has a basis caption ("by call date", "by booking date", "distinct people · by call date", "by sale date").
- **No arrows, no ordering geometry, no percentages.**
- One line on the page: "Independent period totals, not one cohort." The full 70-word cohort statement moves verbatim to Data basis.

### 5.7 Tables (Agent, Efficiency, Campaign, Lead source)

- One shared frame and class set: focusable labelled scroll region, sticky first column with opaque cells, right-edge fade on mobile, sentence-case headers, right-aligned `tabular-nums`, `py-2.5` density, restrained hover.
- `tfoot` rows replace paragraphs: Unattributed; "Attribution unavailable" (calls, policies, known premium, coverage, so the partition reconciles on screen); "Not linked to a current lead".
- All performance tables go full width.
- Campaign names become real links (U-3). The campaign chart is hidden below `sm`.
- The Agent drilldown keeps `aria-pressed` and uses server ids only.
- `CAMPAIGN_ATTRIBUTION_NOTE` is split into two constants whose concatenation stays **byte-identical**, so CSV notes don't change.

### 5.8 Dialer intelligence (secondary)

- Smaller heading weight.
- Disposition breakdown and Heatmap open by default; Call summary, Call flow, Call duration and Deep dive collapsed. This is a local default, not persisted.
- Ranked disposition list with text identity (U-2).
- Semantic heatmap table with sr-only values (U-7).
- Deep Dive: segmented control (U-4) and a duplicate-colour treatment that never recolours configured colours.
- No `font-black` uppercase captions anywhere.

### 5.9 Data basis disclosure

- A shadcn `Sheet`: bottom sheet below 768px (85dvh, safe-area padding), right sheet above.
- Two triggers, each owning its `SheetTrigger`, so focus returns to the one that opened it. Esc closes it; keyboard and touch both work.
- Sections:
  - policies sold
  - known annual premium
  - agent credit (incl. why the Leaderboard differs)
  - calls / contacted
  - bookings
  - converted
  - period totals (verbatim cohort sentence)
  - talk time and sessions (incl. the D-1 sentence)
  - attribution
  - live data quality (only for a ready, current summary; never zeros)
  - time zone and freshness ("Summary as of Oct 8, 2026, 8:44:11 PM PDT", ISO in `<time>`)
- The wording is composed from the existing constants, so screen and CSV cannot diverge. **CSV `Note` rows are unchanged.**

### 5.10 Customization: preserved exactly

- 38 registered ids and groups, `DEFAULT_LAYOUT`, `MAX_VISIBLE_STATS = 6`, the v4 normalizer, owner/epoch binding, no write-on-read, Save/Cancel/Reset semantics, failed-draft retention, truthful save errors, View As gating, and no org-default writes.
- The band, trends, period totals, Data basis and toolbar stay fixed and unregistered.
- Only changes:
  - one intro line
  - mobile ergonomics (larger move targets, sticky Save/Cancel bar below `sm`)
  - U-6 and U-9
- The toolbar Customize button keeps today's behaviour in edit mode (it cancels, like the Cancel button). A verifier ruled that behaviour intended, so it is not changed.

### 5.11 Copy cleanup (main items; full table in the design notes)

| Current | Proposed |
|---|---|
| "Production and the activity behind it." | removed |
| 7 preset buttons | "Report period" select |
| "Your agency · America/Los_Angeles" | "· America/Los_Angeles · Summary as of …" (the tab shows scope) |
| "Stored policies sold in this period." + POLICY_SOURCE_NOTE block | "Primary + additional policies" (zero case unchanged) + Data basis |
| PREMIUM_BASIS + CURRENT_ASSIGNMENT_NOTE paragraphs | one basis bar + Data basis |
| "3 of 8 policies have a known premium." / "Unknown premium · 5 policies · excluded from amount" | "3 of 8 policies known · 5 unknown excluded" + meter + Partial chip |
| strip subtitles ("contacted calls ÷ calls made", "outbound, stored canonical duration", …) | none, or a data-quality caution |
| "· left axis / · right axis" legends, three trend footnotes, Peak/Total tiles | metric captions; conditional partial/gap legend |
| "Activity and production" + 70-word disclaimer | "Period totals · Independent period totals, not one cohort." |
| Section subtitles, campaign paragraphs, lead-source paragraphs | removed / `tfoot` rows / Data basis |
| "Report basis and data quality" (bottom `<details>`, raw ISO) | "Data basis" sheet (top), localized as-of |

**Kept verbatim** (contract- or test-bound):
- "Call contact rate", "Policies (current assignment)", "Most policies — current assignments", "Policies (campaign-attributed)", "Bookings created (all types)", "Callback dispositions", "Dials per policy sold"
- "No policies sold in this period.", "Known premium unavailable for this period.", "No outbound calls; rate unavailable."
- "This is not a zero — …", the time-zone configuration message, "You don't have access to Reports.", "Use default report scope"
- the 6-cap copy and the Reset line

---

## 6. Reporting inventory and audit approach

- **Inventory**: 134 reachable metrics (heroes, all 28 registrable strip metrics, trend series and tooltips, period totals, every table column and total row, data-quality numbers, drilldowns, and all 13 CSV exports with their Note rows). See `evidence-matrix.md` Appendix A.
- **Method (Phase 1, done):**
  1. Deployed-SQL hash parity.
  2. Formula extraction against the approved contracts.
  3. Independent source-table recomputation vs RPC actuals over W1–W5 and every simulated scope.
  4. Additive cross-panel reconciliation.
  5. Reports vs Leaderboard by policy identity.
  6. Two-lens adversarial verification of every claimed defect.
- **Phase 4 re-verification after implementation:**
  - Rerun the W1–W5 reconciliation queries against production (read-only) to confirm the backend is unchanged.
  - Prove that every rendered value and CSV cell comes from the same ready payload. Use the synthetic fixture with real CSV downloads, plus new tests for each moved number (band leader row, premium average, `tfoot` partitions, Data basis live list).
  - Keep these unchanged: "errors never zero", export payload identity, stale-scope withholding, partial failure and retry.

---

## 7. Exact files

**Modify (frontend):**
- `src/pages/Reports.tsx`
- `src/hooks/useReportsData.ts` (R-4 one-line fix only)
- `src/components/reports/`:
  - `ReportsToolbar.tsx`, `ReportScopeTabs.tsx`
  - `ReportsOverview.tsx`
  - `SectionRenderer.tsx`, `StatCard.tsx`, `StatsGrid.tsx`, `ReportSection.tsx`
  - `PoliciesSoldChart.tsx`, `CallVolumeChart.tsx`, `ReportsActivityFlow.tsx`
  - `AgentPerformanceCards.tsx`, `AgentEfficiency.tsx`, `CampaignPerformance.tsx`, `LeadSourceTable.tsx`
  - `CommunicationsStats.tsx`, `CallingHeatmap.tsx`, `DispositionsPieChart.tsx`, `DispositionDeepDive.tsx`
  - `CallFlowAnalysis.tsx`, `CallDurationAnalysis.tsx`
  - `ReportPanelState.tsx`, `ReportCustomizer.tsx`
  - `reportSectionMap.tsx`, `ReportDataQuality.tsx`
- `src/lib/stat-computations.ts`
- `src/lib/reports-format.ts` (`formatElapsed`, `formatAsOf`, sentence-case preset labels)
- `src/lib/reports-policy-text.ts` (byte-identical split)
- `src/lib/reports-integrity-text.ts` (only if C-2 frontend guard is approved)

**Create (frontend):**
- `src/components/reports/`:
  - `ReportsNotices.tsx` (existing notices moved verbatim)
  - `ReportPeriodControl.tsx`, `ReportContextLine.tsx`
  - `PremiumCoverage.tsx`
  - `ReportTrends.tsx`, `ReportSegmented.tsx`, `reportChartTheme.tsx`
  - `ReportTableFrame.tsx`, `reportTableStyles.ts`
  - `ReportDataBasis.tsx`
- `src/lib/reports-basis-text.ts`

**Optional delete (separate commit):** `GoalTracking.tsx`, `DraggableSection.tsx`. Not `CustomReportBuilder.tsx` or `ScheduledReportsModal.tsx`, which are still referenced by `reports-queries.ts` and a contract test.

**Tests (update or add):**
- `src/components/reports/__tests__/`: `ReportsOverview`, `reportTrendCharts`, `reportsControls`, `agentPerformanceTable`, `reportPresentation`, `reportCustomizer`, `useReportsData`
- `src/pages/__tests__/reportsPage.test.tsx`
- `src/lib/__tests__/`: `reportsContracts.test.ts` (extend the "call contact rate" scan to new `.ts` text modules; add a 200-line rule), new registry snapshot test
- `supabase/tests/reports_integrity.sql` (+ `reports_integrity_negative.sql`, `scripts/reports_integrity_fixture.py` if needed) for T-1..T-3 (synthetic SQL tests only)
- `scripts/tests/reports-visual/verify.mjs`: first-screen budgets, no hidden-column cue regression, Data basis keyboard flow

**Docs:** this plan, `verification.md` (new), `WORK_LOG.md` (newest-first), and an `AGENT_RULES.md` amendment to the Reports personal layout invariant (fixed band, trends, period totals, Data basis; screen/CSV text from shared constants).

**Do not touch:**
- `report-layout-constants.ts`, `report-layout.ts`, `useReportLayout.ts`
- `reports-queries.ts`, `reports-schemas.ts`, `reports-export.ts`
- `index.css`, `tailwind.config.ts`
- any migration, RPC, RLS policy or Edge Function
- `TwilioContext.tsx` and the Dialer

Every component stays under 200 lines; current maximum targets are about 195. `stat-computations.ts` and `reports-format.ts` are library modules (307 and 227 lines today) and are not components.

---

## 8. Backend changes (separately identified)

**None are required for this refresh.** The proposed branch is frontend plus synthetic SQL test files. If approved separately:
- **S-1 security (recommended soon):** one new migration narrowing `company_settings_team_leader_update` and hardening `validate_iana_timezone`. Requires `#APPROVE_RLS_CHANGE` and exact approval to apply. Includes native SQL tests, a read-only preflight and a rollback.
- **B-3 / D-1(b):** a small Reports SQL change using the guarded disable → apply → enable window, only when there is another reason to touch Reports SQL.

SQL test additions (T-1..T-3) run only on disposable loopback databases and CI. They do not change production.

---

## 9. Verification and release steps

1. Work on branch `claude/reports-refresh-audit-20261009` from fresh `main`. Commit in reviewable slices:
   1. defect fixes R-1..R-4 with tests
   2. shell (toolbar, context line, notices, Data basis)
   3. production band and strip
   4. trends
   5. period totals
   6. table system
   7. dispositions (own commit)
   8. heatmap (own commit)
   9. customizer fixes
   10. SQL tests
   11. docs
2. `npx tsc --noEmit` and `npx tsc --noEmit -p tsconfig.app.json`. The second must stay at 85 diagnostics with no new signatures.
3. Reports vitest (all 19+ files, with `REPORTS_SQL_PAYLOADS`), the full vitest comparison against the base (same 10 pre-existing failing files, no new failures), ESLint on changed files, and the production build.
4. Native SQL suites on local PG16 (and CI 17.6). The new T-1..T-3 assertions must pass, and their negative controls must reject the mutations.
5. Real Chromium (fixture) at 390×844, 390×664, 768, 1024 and 1440, light and dark, Personal/Team/Agency:
   - first-screen budgets (both production values ≤ y360 and six metrics ≤ y760 at 390)
   - no page overflow, no clipped money, hero values never wrap
   - Data basis keyboard and touch flow
   - customization save/cancel/reset/failed-save
   - stale-export withholding, partial failure and retry
   - real CSV downloads byte-compared against base CSVs (only the approved R-2 change may differ)
   - axe pass
   - before/after screenshots
6. Independent code review; read-only rerun of the W1–W5 production reconciliation.
7. **Release (needs your approval):**
   1. Publish the branch and a draft PR; the exact-head CI gates (Reports frontend, Reports backend incl. browser, Reporting integrity, Dialer DNC) must pass.
   2. On approval, merge; Vercel deploys.
   3. Verify the deployment state and served-asset markers from the Vercel API (direct HTTPS to `www.fflagent.com` is blocked here).
   4. **A hosted signed-in walkthrough (filters, Refresh, Data basis, CSV download, customization) must be done by you or in an environment that can reach the site.** It cannot be claimed from here.
   5. Rollback: revert the merge. No data or schema migration is involved, and layout JSON is unchanged.

---

## 10. Risks

- **Test churn** (about 30 assertions in 7 files). The guards for "never zero", unknown, Unavailable and export identity are rewritten, never loosened.
- **Synced stacked charts** rely on the same series array; render cost rises a little (four chart containers instead of two).
- **Sticky table cells inside overflow regions** on iOS Safari are unverified until device testing.
- **Changing defaults affects everyone**, because there are 0 saved layouts. Default ids, order and visibility are therefore unchanged.
- **The CSV byte-identity of notes** depends on the constant split; a test pins it.
- **The heatmap and disposition rewrites** are the largest component changes, so each is its own commit and can be reverted alone.

---

## 11. Approval requested

Please approve or adjust:
1. The visual direction and file list (§5, §7) for implementation on an isolated branch.
2. Fixes R-1..R-4 and U-1..U-11, plus tests T-1..T-4.
3. Decisions D-1 (a recommended), D-2 (keep), D-3, D-4, D-5, D-6, C-1 (recommended "k of n"), C-2 (recommended frontend guard).
4. Whether to prepare S-1 (security RLS fix) as a separate task.

No production migration, RLS change, Edge deploy, data change, push to `main` or deployment will happen without a separate exact approval.

---

## 12. Context snapshot

- **State:** Phase 1 only. Main/production `8d53531`. Reports SQL as deployed Oct 6, with no drift. 0 saved layouts.
- **Accuracy:** all audited Reports numbers are verified in W1–W5 across the simulated scopes. One low data-quality disclosure is incorrect (R-3). The ended-session rule is an owner decision (D-1). Leaderboard and Reports agree by month on 9/9 policy identities.
- **New finding outside Reports:** S-1, Team Leader write access to the agency time zone (medium, security).
- **Migrations/deployments:** none.
- **Blockers:** hosted signed-in browser verification is not possible from this environment (proxy denies `www.fflagent.com`; no credentials).
- **Next:** on approval, implement §9 steps 1–6, then request release approval.
- **Proposed `AGENT_RULES.md` update** (at implementation): amend the Reports personal layout invariant to name the fixed production band, trends, period totals and Data basis, and to require that screen basis text be composed from the same constants as CSV notes. If S-1 is approved, add a rule that `company_settings.timezone` is Admin-only authority for agency reporting.
