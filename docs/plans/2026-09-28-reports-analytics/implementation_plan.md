# Implementation Plan — Reports & Analytics: secure, canonical, truthful (overnight build, 2026-09-28)

**Status: rev 3.**
- Rev 2 was APPROVED by Chris (2026-09-28) for branch implementation and testing only, with four required changes
  recorded in §R2 before any implementation edit.
- Chris's three final corrections (2026-09-29) are recorded in §R3 and implemented on the branch.
- Precedence: §R3 supersedes §R2 where they conflict, and both supersede any conflicting text below.

## §R3. Chris's final corrections (2026-09-29; supersede §R2 and D-4 / D-10 where they conflict)

1. **Converted identity is contact-first.**
   - `private.report_call_facts.converted_key` is `contact_id`, else `campaign_lead_id`, else the call id. The keys are
     prefixed so that ids from different tables cannot collide.
   - The organization-level **Converted Leads/Clients** metric counts one person once, even when they convert through
     several `campaign_lead` memberships in the window.
   - **Campaign Performance's `converted_leads` stays campaign-specific:** it counts the distinct converting campaign leads
     of that campaign.
   - Tests:
     - T14, with fixtures k32/k33: the same contact L6 through CL6A and CL6B gives **Converted = 1**.
     - T14 April, with fixtures k34–k38: the fallbacks for NULL-contact calls, and Campaign Performance counting campaign
       leads rather than people.
     - Negative controls 2c, 2e and 2f.
   - **Known limit.** A converting call that carries no `contact_id` falls back to its campaign lead, then the call. The
     lead→client lineage (`clients.lead_id`) is not merged, so one person who converts once as a lead and again as a client
     counts twice. This is rare, and is recorded as a follow-up decision.
2. **A missing agency time zone fails closed.** This replaces D-10b.
   - **There is no default zone.** Each of these raises **SQLSTATE 55000**:
     - no `company_settings` row;
     - a NULL, blank or unknown zone;
     - a non-agency pseudo-zone (`Factory`, `localtime`, `posixrules`).
   - **When it is checked.** The check runs after authorization, so an unauthorized caller still gets 42501, and before any
     window, bucket or business read. It applies to `get_report_scope()` and all five report RPCs.
   - **The UI** maps 55000 to a *configuration-required* state: "The agency time zone must be configured before official
     Reports can be calculated. An admin must choose and save the agency time zone in Settings → Company Branding."
     - Nothing is shown in that state: no period, day or hour buckets, heatmap, stats, sections or exports.
     - Retry re-resolves the scope.
     - A panel that hits 55000 after the scope loaded withholds the whole report the same way.
   - **Metadata.** `time_zone_source` is always `'agency_settings'`, and the frontend schema rejects anything else.
   - **Tests.** T6 covers unconfigured O2 and its block-local configuration; T9 covers an invalid zone; T15 covers every RPC,
     NULL, blank, unknown and pseudo-zones, and authorization first. Negative control 2d covers the silent default.
   - **Production data is not touched.** Chris's organization already stores `America/Los_Angeles`. The other two production
     organizations have no row, so they will see the configuration-required state until an admin saves a zone.
   - **Residual.** A valid zone *stored* by other code cannot be told apart from a chosen one. Examples: the
     `company_settings.timezone` column default `America/Chicago`, the Super Admin provisioning wizard, or saving Company
     Branding while it displays its `America/Chicago` placeholder. Such a zone is used as the agency's setting. Changing
     those writers is outside Reports and needs its own approval.
   - **PostgREST** answers 55000 with HTTP 500. The JSON `code` is preserved, and the frontend maps on the code.
3. **"Call contact rate".**
   - The formula is unchanged: contacted outbound calls ÷ outbound calls made.
   - It is labelled **"Call contact rate"** (sentence case, as the UI's other labels are) on every user-visible Reports
     surface: stat card and picker, tables, chart series and axes, tooltips, captions and CSV headers.
   - "Best call contact rate" and its subtitle follow the same wording. The inverse ratio is labelled **"Dials per contacted
     call"**.
   - No lead-level rate is added. The two lead-level placeholders ("First dial contact rate", "Follow-up contact rate")
     stay explicitly unavailable.
   - A source contract test and a render test fail on any other "contact rate" wording.

## §R2. Chris's required changes (approved 2026-09-28; supersede §3/§6/§9 where they conflict)

1. **Agency timezone is the reporting authority (replaces D-10).**
   - **Where the zone comes from.** The server resolves it: `company_settings.timezone` for the actor's database-resolved organization (org-unique row, IANA-validated by the existing `trg_company_settings_validate_timezone`).
   - **No caller-supplied zone.** The Reports RPCs accept **no timezone parameter**.
   - **Local agency calendar dates.** The RPCs take `p_start_date date, p_end_date date` (inclusive), and the server computes the half-open window as `[p_start_date 00:00, p_end_date + 1 day 00:00)` in that zone via `AT TIME ZONE`. PostgreSQL's IANA rules handle DST, so a 23- or 25-hour day is exact.
   - **What the zone controls.** The same zone controls:
     - the window;
     - the daily, hourly and day-of-week buckets;
     - the heatmap;
     - "today" and "this week" derived stats;
     - any comparison;
     - exports.
   - **Metadata.** Every payload returns `window: {time_zone, time_zone_source, start_date, end_date, start_at, end_at}`. `get_report_scope()` also returns `time_zone`, `time_zone_source` and the agency `today`, so the presets are agency calendar days.
   - **Missing setting (D-10b) — SUPERSEDED by §R3.2 (2026-09-29): there is no default; a missing, NULL, blank, unknown or pseudo zone fails closed (55000, configuration required).**
     - *(Historical rev 2 text: an organization with no settings row or a NULL zone used `America/Chicago`, labelled `time_zone_source = 'default'`.)*
     - An **invalid** stored value fails closed (the report is unavailable).
     - Production today: 1 of 3 orgs has a row (`America/Los_Angeles`); the other 2 will see the configuration-required state.
   - **Unchanged.** The personal Dialer "Today" counters stay agent-local (#14) and are not touched. Any future agent-local Reports view must be a separately labelled mode.
   - **Docs.** New AGENT_RULES invariant #38 records that Reports now implements agency-timezone reporting. Leaderboard and Dashboard stay browser-local until their own approved change.
2. **Converted vs. Policies Sold (tightens D-4).**
   - **Converted Leads/Clients** is the number of unique converted contacts. **Policies Sold** is the count of canonical `wins`. The two are always labelled separately.
   - **No generic "Conversion Rate" anywhere.** `policies_sold ÷ calls_made` is never called a conversion rate, and no lead conversion rate is introduced.
   - Every existing conversion-rate stat or column (call-to-close, contacted-to-close, appointment-to-close, best-converting agent, per-campaign or per-source conversion %) becomes **unavailable**: there is no approved denominator.
   - A dial-to-policy figure appears only under its explicit name, "Dials per Policy Sold" (calls made ÷ policies sold; "—" when 0).
3. **Rollback and disable fail closed (replaces the rollback text in §3.1/§9).**
   - **Never re-grant.** No rollback, inverse, emergency script or recovery procedure ever re-grants PUBLIC, anon or authenticated EXECUTE on the legacy `rpc_report_*` functions.
   - **The safe state.** Reports is unavailable or disabled, and the legacy RPCs stay inaccessible.
   - **The rollback file** drops the new objects, **re-asserts the legacy revocation** (idempotent REVOKE), and aborts if any legacy function is still executable by PUBLIC, anon or authenticated.
   - **`reports_disable.sql`** revokes the new RPCs from `authenticated` and asserts the legacy state. **`reports_enable.sql`** grants only the new RPCs.
   - There is no full inverse that restores the vulnerable grants.
4. **Session duration overlap (tightens the session metric).**
   - **Source.** Only server-timestamped `dialer_sessions`. Never browser timers, never `dialer_daily_stats`.
   - **Which sessions count.** Every session that **overlaps** `[start, end)` counts, including ones that began before the window.
   - **Effective end.** Uses the canonical span rule (#12/#14):
     - `ended_at`;
     - else `now()` for an active session with no `ended_at`;
     - else `coalesce(last_heartbeat_at, started_at)`.
   - **Clipping.** Each session contributes `greatest(0, least(effective_end, end) − greatest(started_at, start))`.

Everything else in rev 1 stands as approved.

**Rev 1 status line (historical): AWAITING CHRIS'S APPROVAL. No implementation file has been modified.**
Branch `claude/reports-analytics-overnight-c69826`, based on `main` @ `5d37e5f98dc16b08d11359b1506153aac014b25a` (re-checked 2026-09-28).
Approval of this plan authorizes **local implementation and testing only**. It is **not** approval to merge, apply any
Supabase migration, deploy an Edge Function, trigger a Vercel production deployment or change production configuration
(AGENT_RULES #28). Those steps are listed in §9 for a separate decision.

---

## §0. TL;DR

1. **There is a live cross-tenant exposure today.** All four `public.rpc_report_*` functions are `SECURITY DEFINER`,
   take `p_org_id` from the caller without checking it, run with `search_path=public`, and grant EXECUTE to **`anon`**.
   Anyone holding the public anon key can read any organization's call aggregates and agent names, and any
   authenticated user can pass another organization's id or a null agent id. (This was confirmed read-only in production on
   2026-09-28: the ACL is `{postgres, anon, authenticated, service_role}` on all four.)
2. **Reports numbers are not trustworthy even inside one tenant.** Specifically:
   - `rpc_report_campaign_performance` reads a column that does not exist (`campaigns.campaign_type`; the real column is `type`), so it errors on every call.
   - The frontend turns that failure, and every other error, into zeros or "No data".
   - Contacted uses the retired `dnc_auto_add` rule instead of the canonical one (`counts_as_contacted`, No Answer excluded).
   - "Policies sold" is actually a count of converting *calls*, not wins.
   - Lead-source totals ignore the agent filter and the date range, so restricted users see organization-wide totals.
   - Hours and days are bucketed in UTC.
   - The calling heatmap is synthesized from its two marginal distributions instead of the real data.
   - Goal Tracking reads a table nothing maintains (0 rows in production).
   - Scheduled Reports inserts a column that does not exist and nothing ever sends them.
   - Team Leaders get only their own data, because the team scope is marked "deferred".
3. **The plan** (security > metric correctness > filters > exports > polish):
   - **One new migration** creates a new, secured `public.get_report_*` RPC family:
     - Scope is derived only from `auth.uid()` and the database-authoritative profile, through the existing `private.campaign_actor()`.
     - Team scope uses the existing `private.resolve_downline_ids()`.
     - The existing configurable Reports permissions (page access, View Own / View Team Reports, Dashboard & Reports data scope) are enforced server-side.
     - A caller-supplied agent id can only narrow the scope.
     - Metrics follow the documented canon only (Leaderboard #23, Contacted #13, campaign cards #17).
     - In the same transaction it **revokes EXECUTE on the four legacy functions from PUBLIC, anon and authenticated**. They are kept, not dropped, so rollback stays cheap.
   - The frontend is rebuilt around a keyed, generation-guarded data hook with per-panel loading / empty / error / denied states, server-driven filter options, permission-gated and sanitized exports, and no polling.
   - Tests cover a real-PostgreSQL SQL suite (authorization matrix, metric canon, drift and replay refusal, rollback, negative control) plus vitest (query layer, hook races, page states, exports, source contracts).
4. **Nothing Dialer- or Leaderboard-owned changes.** `src/lib/report-utils.ts` stays frozen because it is Dialer-owned. No RLS policy, table, trigger, grant on any non-Reports object, telephony, queue or leaderboard file is touched.

---

## §1. Inputs read and evidence

- AGENT_RULES.md (all of it), VISION.md, WORK_LOG.md (newest entries through the 2026-09-26 leaderboard payload release).
- The existing Reports implementation (21 components, `Reports.tsx`, `reports-queries.ts`, `stat-computations.ts`, `report-layout*.ts`) was audited by six parallel read-only reviewers: components, page/permissions, shared-lib consumers, test infrastructure, leaderboard/dialer boundary, and metric canon. Their raw findings are summarized in §2.
- **Read-only production catalog reads (`jncvvsvckxhqgqvkppmj`, 2026-09-28, SELECT only, no customer rows exported):**
  - `pg_get_functiondef` / `prosrc` MD5 / owner / volatility / `SECURITY DEFINER` / `proconfig` / ACL of the four legacy RPCs. The live bodies are **byte-identical** to `20260806000000_baseline_production_schema.sql` (prosrc MD5 `eb741e0d…`, `7d17e968…`, `521abcbc…`, `9dc9273f…`), and all four are `VOLATILE`, `search_path=public`, owner `postgres`.
  - No other function, view or cron job references `rpc_report_*`. No `public.get_report*` function exists yet.
  - `private.campaign_actor()` and `private.resolve_downline_ids(uuid,uuid)` exist in production (postgres-only EXECUTE, `search_path=pg_catalog, pg_temp`). `authenticated` has no USAGE on schema `private`.
  - Column inventory of `calls`, `campaigns` (confirms `type`, no `campaign_type`), `campaign_leads`, `leads`, `clients` (no `lead_source`), `dispositions` (`counts_as_contacted` present), `pipeline_stages`, `wins`, `appointments`, `dialer_sessions`, `role_permissions`, `lead_source_costs`, `goals`, `agent_scorecards`, `saved_reports`, `scheduled_reports`, `report_layouts`. RLS policies of the tables Reports reads directly. Indexes on `calls` (`idx_calls_org_created_at` exists).
  - Aggregate shape counts only: 3 orgs; roles Admin 4 / Agent 8 / Team Leader 2 / 0 `'Super Admin'` role strings; 1 super admin; 10 profiles with `upline_id`.
    - `role_permissions` rows exist for **1** org (Agent: Reports page **on**, View Own on, View Team off, scope own; Team Leader: page on, View Own/Team on, scope team). Other orgs use the code defaults.
    - Calls: 2,963 outbound / 100 inbound / 0 NULL direction; 83 have a NULL agent; 27 name-only dispositions.
    - `campaign_leads.source` is populated on 0 rows. `lead_source_costs` has 0 rows. `agent_scorecards` has 0, `goals` 0, `saved_reports` 0, `scheduled_reports` 0 and `report_layouts` 0 rows. 360 `dialer_sessions`, 6 wins, 65 appointments.
- A local PostgreSQL 16.13 harness was verified by running the existing `scripts/run_profile_rpc_tests.sh` (all proofs pass).
- **Baseline gates on clean main `5d37e5f`:**
  - Root `npx tsc --noEmit` exits 0, but it checks nothing: it is a solution-style tsconfig.
  - `npx tsc -p tsconfig.app.json --noEmit` reports **90** errors, all pre-existing.
  - `npx vitest run`: **3,433 passed / 1 failed / 14 skipped** (3,448 tests); 12 files fail. 11 of those fail only for lack of Supabase environment variables. The remaining failure is the known voicemail-v29 byte check. The failing set matches the 2026-09-26 record.

---

## §2. What is wrong today (condensed audit)

### 2.1 Security (critical)
| # | Finding | Evidence |
|---|---------|----------|
| S1 | 4 legacy RPCs: SECURITY DEFINER, caller-controlled `p_org_id`, no `auth.uid()` check, EXECUTE to `anon` + `authenticated` | prod ACL; baseline :5032-5336, :14334-14358 |
| S2 | `p_agent_id` unchecked → null = whole org; own-scope enforced only by the browser choosing its own id | `Reports.tsx:111-114`, `reports-queries.ts:278-336` |
| S3 | `search_path = public` without `pg_temp`; unqualified object names; VOLATILE | baseline |
| S4 | `fetchProfiles` sends every active org profile's **email** to every Reports viewer; `fetchLeads` pulls lead **phone/state** only to count rows | `reports-queries.ts:38-47,103-113` |
| S5 | Per-section CSV buttons ignore the "Export Reports" permission; CSV cells are not formula-neutralized | `ReportSection.tsx:40-50`, `reports-queries.ts:219-228` |
| S6 | `View Own Reports` / `View Team Reports` are configurable in Settings but read nowhere | grep |
| S7 | Admin write controls (org default layout, lead cost edit) gated on *data scope* = "all", not on role | `Reports.tsx:75,354-381` |

### 2.2 Accuracy
| # | Finding |
|---|---------|
| A1 | `rpc_report_campaign_performance` selects `cmp.campaign_type` (does not exist) → 42703 every call → Campaign Performance and Lead Source panels permanently empty |
| A2 | Contacted = `duration > 45 OR dnc_auto_add` — not the canon (No Answer excluded first, `duration > 45`, `counts_as_contacted` by id with org-scoped name fallback); includes inbound |
| A3 | "Policies sold"/"Sold"/"Leads converted" all display the count of *converting calls*; `wins` is never read |
| A4 | `started_at` with inclusive `<= end`; canon is `calls.created_at` half-open `[start, end)` |
| A5 | Talk time / averages include inbound and zero-duration rows; `avg_duration_seconds` is integer division; "Avg talk time (contacted only)" is not contacted-only |
| A6 | ≥5 different "contact rate" denominators and ≥6 "conversion" definitions across components |
| A7 | Hour / day-of-week / date buckets in UTC but displayed as local |
| A8 | Campaign: calls joined by `contact_id = campaign_leads.lead_id` (breaks after conversion); `total_leads` all-time and not agent-scoped |
| A9 | Lead source: `total` = all org leads of that source, all-time, **not agent-scoped** (restricted users see org counts) |
| A10 | Session stats always "—" (reads a nonexistent `duration_seconds`); AgentEfficiency recomputes sessions in the browser from RLS-visible rows (a Team Leader's RLS shows **all org sessions** → out-of-scope rows) |
| A11 | CallingHeatmap fabricates cells (`dow_total × hour_total / total`); "Speed to Lead" tab is a fixed sentence; "Avg Deal Cycle" hardcoded "N/A"; DispositionDeepDive receives `dispositions={[]}` so it draws no bars; PoliciesSoldChart sorts formatted labels alphabetically |
| A12 | Goal Tracking reads `agent_scorecards` goal flags that nothing writes (0 rows in prod) |
| A13 | "Active leads" stat = org-wide raw count, ignores agent and date; appointments/DNC/callbacks inferred client-side by disposition **name** |

### 2.3 Reliability
- No loading vs. empty vs. failed distinction anywhere; every fetcher returns zero-shaped data on error.
- No request generation or abort. A late response can overwrite a newer filter, and the first `finally` clears loading early.
- A profile with no org spins forever. Nothing is keyed to the viewer.
- Scheduled Reports: every insert fails (`send_time` vs. real column `time_of_day`), there are no recipients, and nothing sends. "My Reports → Play" is a no-op.

---

## §3. Design

### 3.1 Backend: one new migration

`supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql` is a placeholder version. `apply_migration` stamps its own version, and the filename is reconciled after any production apply (AGENT_RULES #34/#37 practice); the SQL bytes are never edited.

**Preflight (fails the whole transaction):**
- The four legacy functions must exist with **exactly** the audited `prosrc` MD5s, owner `postgres`, `SECURITY DEFINER`, and ACL grantees ⊆ {postgres, anon, authenticated, service_role}. On body drift it refuses: someone changed them, so a human must look.
- No `public.get_report_*` or `private.report_*` object may already exist. It refuses a replay.
- `private.campaign_actor()` and `private.resolve_downline_ids(uuid,uuid)` must exist.

**New private helpers** (`SECURITY DEFINER STABLE`, `search_path = pg_catalog, pg_temp`, every object schema-qualified, `REVOKE ALL … FROM PUBLIC, anon, authenticated`):

1. `private.report_permission_flags(p_org uuid, p_role text)` returns page_access, view_own, view_team, can_export and data_scope. It reads `role_permissions.permissions` for `(org, role)` and mirrors `usePermissions`:
   - Role key: `'Agent'` reads `agent`; `'Team Leader'` reads `teamLeader`.
   - Page: `p[name='Reports']`.
   - Features: `f[*].features[name IN ('View Own Reports','View Team Reports','Export Reports')]`.
   - Scope: `d[label='Dashboard & Reports']`.
   - With no row, or a non-array block, it uses the `permissionDefaults.ts` defaults:

     | Role | Page | View Own | View Team | Export | Scope |
     |---|---|---|---|---|---|
     | Agent | false | true | false | false | own |
     | Team Leader | true | true | true | true | team |

   - **Fail-closed tightening vs. the browser:** a value that is not a JSON boolean counts as `false`. A scope outside {own, team, all} counts as `own`, the narrowest scope. A vitest source-contract test pins these defaults equal to `permissionDefaults.ts`.
2. `private.report_access(p_agent_id uuid)` returns uid, org_id, role, scope (`own` | `team` | `organization`), can_export, agent_ids uuid[] (NULL means the whole organization) and filter_agent_id. It raises **SQLSTATE 42501** on denial.
   - **Actor:** from `private.campaign_actor()`. That function requires `auth.uid()` and organization context, reads the profile row (never the JWT role), requires the profile org to equal `get_org_id()` and the profile to be `Active`, and raises 42501 otherwise.
   - **Admin, Super Admin role, or `is_super_admin`:** `organization` scope over the actor's **home** org, which `campaign_actor` proves is the profile org. There is no cross-tenant path, because nothing accepts an org id.
   - **Agent or Team Leader:**
     - Reports page access off → denied.
     - Data scope `own`: requires View Own → `{self}`.
     - Data scope `team`: View Team → `{self} ∪ private.resolve_downline_ids(self, org)` (upline_id walk, org-constrained, cycle-safe, the same resolver the approved Team Profile uses). Without View Team but with View Own → `{self}`. Neither → denied.
     - Data scope `all`: View Team → `organization`. Without View Team but with View Own → `{self}`. Neither → denied. **This composition is decision D-1.**
   - Any other role string → denied.
   - **`p_agent_id` narrows only.** In organization scope it must be a profile in the actor's org. In own or team scope it must be in `agent_ids`. Otherwise it is denied (42501, "agent outside report scope"). A null agent never widens: own stays `{self}` and team stays the team.
3. `private.report_call_facts(p_org, p_start, p_end, p_agent_ids uuid[])` returns one row per call in scope, with canonical classification computed **once** for every Reports RPC:
   - Window: `created_at >= p_start AND created_at < p_end`.
   - Scope: `organization_id = p_org` and `(p_agent_ids IS NULL OR agent_id = ANY(p_agent_ids))`.
   - Direction class: `outbound` = `lower(coalesce(direction,'')) IN ('outbound','outgoing')`, `inbound` = `IN ('inbound','incoming')`, otherwise `other`.
   - Duration: `greatest(coalesce(duration,0),0)`, the canonical Twilio-written value (#8).
   - Disposition: resolved by id first (organization-guarded), then by `lower(name)` fallback within the org only when `disposition_id IS NULL`.
   - `is_contacted` uses the exact canonical CASE from `get_campaign_card_stats` / `get_trusted_today_dialer_stats`, applied to outbound calls only:

     ```sql
     CASE
       WHEN lower(coalesce(di.name, dn.name, disposition_name, '')) = 'no answer' THEN false
       WHEN duration > 45 THEN true
       WHEN di.counts_as_contacted THEN true
       WHEN disposition_id IS NULL AND dn.counts_as_contacted THEN true
       ELSE false
     END
     ```

   - `is_converting`: the resolved disposition's pipeline stage has `convert_to_client = true` (organization-guarded).
   - Disposition flags: `dnc_auto_add`, `callback_scheduler` and `appointment_scheduler` (the canonical columns, never names).
   - Campaign: `calls.campaign_id` (organization-guarded join to `campaigns`, the Dialer's per-campaign canon), plus `campaign_lead_id`, which must belong to that campaign and org.
   - Linked lead: the #5 compatibility relation (`lead_id`, else `contact_id` with `contact_type` of `'lead'` or NULL), with the lead in the same org.

**New public RPCs.** All are `SECURITY DEFINER STABLE`, `search_path = pg_catalog, pg_temp`, and **take no organization parameter**. EXECUTE is revoked from PUBLIC and anon and granted to `authenticated` and `service_role`. Each validates the window: non-null, `end > start`, at most 366 days (**D-12**), otherwise `22023`. Each returns JSON aggregates only: no phone numbers, emails, notes, lead names or contact ids.

| RPC | Returns (all counts are integers; rates `numeric(5,1)` or **null when the denominator is 0**) |
|-----|------|
| `get_report_scope()` | scope, role, can_export, self_id, agents `[{id, name}]` (the allowed set only: org roster = non-Deleted org profiles; team = resolved ids; own = self). This is the **only** source of the agent selector. |
| `get_report_call_summary(p_start, p_end, p_agent_id := NULL)` | **Totals:**<br>• calls_made (outbound)<br>• inbound_calls, other_calls, total_calls<br>• contacted and contact_rate_pct (contacted ÷ calls_made)<br>• talk_time_seconds (outbound Σ duration) and avg_talk_per_dial_seconds<br>• inbound_talk_seconds<br>• converted (distinct contacts, **D-4**)<br>• policies_sold (`COUNT(wins)` by `wins.created_at`, attributed to `wins.agent_id`)<br>• appointments_set (canonical #23: `appointments.created_at`, `COALESCE(created_by, user_id)`, no status filter)<br>• dnc_calls and callback_calls (by disposition flag)<br>• session_seconds (canonical `dialer_sessions` span, window on `started_at`)<br>**Breakdowns:**<br>• by_agent: per in-scope agent (Active roster plus anyone with activity): name, calls_made, contacted, contact_rate_pct, talk_time_seconds, converted, policies_sold, appointments_set, session_seconds<br>• unattributed: calls with no agent (organization scope only)<br>• scope metadata |
| `get_report_call_volume(p_start, p_end, p_agent_id, p_time_zone)` | by_date: zero-filled **local** days in the validated IANA zone, with calls_made, contacted, inbound_calls and policies_sold. by_hour (0-23), by_day_of_week (0-6) and heatmap (dow×hour): real counts of calls_made and contacted. An unknown or null zone raises `22023`; it never silently falls back to UTC. |
| `get_report_disposition_breakdown(p_start, p_end, p_agent_id)` | Outbound calls only (**D-3**).<br>• by_disposition: key, name, color, count, avg_duration_seconds, and the flags counts_as_contacted, converts, dnc, callback and appointment; sorted by count; includes an "(No disposition)" bucket.<br>• by_agent[{agent_id, name, counts{key:n}}]<br>• by_campaign[{campaign_id, name, counts}]<br>• duration_histogram: fixed, ordered and zero-filled (0-30s, 30s-1m, 1-2m, 2-5m, 5m+). |
| `get_report_campaign_performance(p_start, p_end, p_agent_id)` | Only campaigns with an in-scope call or win in the window. Per campaign: name, type, calls_made, contacted_calls, contact_rate_pct, leads_dialed / contacted_leads / converted_leads (distinct `campaign_lead_id`, the card canon), policies_sold (`wins.campaign_id`). **No all-time or organization-wide campaign size is returned**, which removes leak A8. unattributed_calls counts outbound calls in scope that carry no campaign. |
| `get_report_lead_source_performance(p_start, p_end, p_agent_id)` | Per `trim(leads.lead_source)` (blank becomes "(No source)"), for calls linked to a current lead:<br>• calls_made, contacted_calls, contact_rate_pct<br>• leads_dialed, contacted_leads<br>• new_leads: leads created in the window; organization scope counts all org leads, restricted scope counts `assigned_agent_id ∈ scope`<br>**converted is returned as null with `converted_available=false`** and a reason (**D-6**): conversion deletes the source lead and `clients` has no `lead_source`. unattributed_calls counts calls not linked to a current lead. |

**Legacy RPCs:** `REVOKE EXECUTE ON FUNCTION public.rpc_report_*(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC, anon, authenticated;` The functions stay owned by postgres, and `service_role` keeps EXECUTE. They are **not dropped** (**D-9**); a later cleanup migration can drop them once the release is verified.

**No table, column, index, RLS policy, trigger or grant on any table changes.** The functions only read `profiles`, `role_permissions`, `calls`, `dispositions`, `pipeline_stages`, `campaigns`, `campaign_leads`, `leads`, `wins`, `appointments` and `dialer_sessions`.

**Rollback / re-disable artefacts:**
- **`supabase/migrations/rollback/20260928120000_reports_secure_scoped_rpcs.rollback.sql`** is the exact inverse. It drops every new object and re-grants the legacy EXECUTE to anon and authenticated. It carries a loud header: **this re-opens exposure S1** and must be used only with Chris's explicit acceptance.
- **`supabase/ops/reports_disable.sql`** is the recommended emergency switch. It revokes EXECUTE on the new public RPCs from `authenticated`; the UI then shows "Reports are temporarily unavailable" and never zeros.
- **`supabase/ops/reports_enable.sql`** is its inverse.
- Both ops files refuse unless the objects are in the expected state. The filenames deliberately avoid the word `leaderboard`, because the leaderboard CI path filter matches `*leaderboard*`.

### 3.2 Frontend

- **`src/lib/reports-schemas.ts`** (new) holds Zod schemas and inferred types for each RPC payload. A payload that fails validation becomes an **unavailable error, never a zero**.
- **`src/lib/reports-queries.ts`** (rewrite) contains one typed fetcher per RPC:
  - Each uses the narrow `(supabase as any).rpc` cast, as the new RPCs are absent from generated types (the house pattern of #14/#16/#17), and forwards an `AbortSignal`.
  - Each **throws** a `ReportsQueryError` whose kind is `denied` (SQLSTATE 42501), `configuration` (55000, agency time zone required — §R3.2), `invalid` (22023), `timeout`, `aborted` or `unavailable`. `{data:null}` and schema failures count as unavailable.
  - No `|| []`, no zero fallbacks and no `p_org_id`.
  - Removed:
    - dead fetchers: `fetchCallsRaw`, `fetchPipelineStages`, `fetchCampaignsWithStats` and `fetchCampaignLeads`;
    - the PII fetchers `fetchProfiles` (email) and `fetchLeads` (phone);
    - browser session math (`fetchDialerSessions`) and `fetchActiveLeadsCount`;
    - `upsertLeadSourceCost`, which was broken anyway.
  - Kept: the date and format helpers.
- **`src/lib/reports-export.ts`** (new) is the single CSV writer:
  - It neutralizes a leading `= + - @ \t \r` by prefixing `'`.
  - Every file carries a header block: scope, agent filter, local period and generated-at.
  - It refuses to export a panel that is not `ready` **for the current key**, so stale data cannot be exported.
  - It revokes the object URL after the click has dispatched.
- **`src/hooks/useReportsData.ts`** (new) is the keyed state machine:
  - **Keys.** The scope key is `viewerId|orgId`. The panel key is `viewerId|orgId|startISO|endISO|agentFilter|timeZone`.
  - **Loading order.** Scope loads first; panels load only after the scope is ready. A selected agent that is not in `scope.agents` resets to "all in scope" before any request, so the UI never sends an agent the backend will reject.
  - **Panels.** Five panels run in parallel: summary, volume, dispositions, campaigns and leadSources. Each settles independently. One panel failing leaves the others valid, which is the partial-failure requirement.
  - **Request lifetime.**
    - There is one `AbortController` per generation and per-panel generation counters.
    - A superseded key aborts in-flight requests, and a late answer commits nothing: no rows, no error, no loading flag (AGENT_RULES #31).
    - State is stored **with its key** and read through a render-time key match, so another viewer's, period's or agent's rows are never painted, not even for one frame.
    - A key that is about to fetch reads as `loading`, never as empty.
  - **Timeouts and retry.** Each request is bounded at 25 s and then fails with `timeout`. Retry is per panel and for all panels, manual only, with **no polling and no realtime subscription**.
  - **Scope errors.** If the scope is denied, the page shows the permission-denied state and sends no panel request. If the scope is unavailable, the page shows an error with Retry.
  - **Identity.** Identity comes from `useAuth().profile`, which is the real profile here because Reports stays withheld under "View As" (unchanged). On logout or a user or org change, the key changes, the cleanup aborts in-flight requests, and render-time keying hides the old data.
- **`src/pages/Reports.tsx`** (rewrite, under 200 lines):
  - It composes `ReportsToolbar` and the section grid.
  - It removes the "Schedule" and "My Reports" buttons and mounts (**D-8**: both are non-functional). The component files stay on disk, unreferenced.
  - Team sections are shown when the server scope is `team` or `organization`, not based on `isAdmin`.
  - Admin writes (org default layout, and lead-cost editing if it is ever re-enabled) require the real role Admin or `is_super_admin`, not the data scope.
- **`src/components/reports/ReportsToolbar.tsx`** (new) holds:
  - the presets and the custom range (validated: end ≥ start, at most 366 days);
  - an agent selector populated **only** from `scope.agents` (for own scope it shows the user's own name, disabled);
  - a scope badge ("Your activity" / "Your team (n)" / "Organization");
  - the Refresh control;
  - a permission-gated Export button, disabled unless the summary is ready for the current key.
- **`src/components/reports/ReportPanelState.tsx`** (new) is a shared wrapper with loading skeleton, "Couldn't load … — this is not a zero" plus Retry, denied, and "unavailable (reason)" states. Children render only on `ready`, and the true empty message appears only after a successful empty result.
- **Section components.** These are surgical adaptations to the new payloads and states. Visual language is unchanged (Tailwind, premium dark), and hardcoded white or slate tooltip and section backgrounds are fixed to theme tokens.
  - `StatsGrid`, `StatCard` and `stat-computations.ts`:
    - Every stat is computed from canonical server fields.
    - A stat without a canonical backing is marked **unavailable**, with a reason and no number, and is removed from the defaults and the picker. The 23 "coming soon" stubs are also removed from the defaults.
    - A failed summary renders "—" plus an error on every card, never 0.
    - `report-layout-constants.ts` default-visible stats change to canonical ones only. Stat IDs are kept, so saved layouts stay compatible; there are 0 rows in production today.
  - `CallVolumeChart`: local-day series, with the grouping toggle actually regrouping (exact sums of daily counts).
  - `DispositionsPieChart`: server breakdown, plus honest counts of calls made, contacted and contact rate; there is no fake nested funnel.
  - `CommunicationsStats`: canonical fields.
  - `CallingHeatmap`: the **real** heatmap in local time; cell rate = contacted ÷ calls_made, or "—" when the cell is 0; the fabricated "Peak windows" advice is removed.
  - `CallFlowAnalysis`: local by-hour and by-day data; the "Speed to Lead" placeholder tab is removed.
  - `CallDurationAnalysis`: fixed ordered histogram; insight driven by the `converts` flag, never by disposition name.
  - `DispositionDeepDive`: series come from the payload (top 8 by count plus "Other").
  - `PoliciesSoldChart`: **wins** by local date, chronological; "Avg Deal Cycle N/A" is removed.
  - `CampaignPerformance` and `LeadSourceTable`: new fields. Converted-by-source is shown as "Not available" with a tooltip. Cost/ROI editing and columns are replaced by a "Cost tracking unavailable" note (**D-6**).
  - `AgentPerformanceCards`: new per-agent fields; the meaningless goal bar is removed.
  - `AgentEfficiency`: server session seconds. Calls/hr = calls_made ÷ session hours. Conversion is shown as policies ÷ calls_made (the documented #23 canon).
  - `GoalTracking`: an "unavailable" notice (**D-7**); the `agent_scorecards` read is removed.
  - `ReportSection`: accepts a `canExport` gate plus the export handler through `reports-export`.
  - `SectionRenderer`: team gating comes from the scope.
  - `ReportCustomizer`: the org-default button is gated on role.
- **Not modified:**
  - `src/lib/report-utils.ts` (Dialer-owned; frozen)
  - `src/integrations/supabase/types.ts`
  - `src/config/permissionDefaults.ts`
  - `src/hooks/usePermissions.ts`
  - `src/components/settings/Permissions.tsx`
  - `src/lib/report-layout.ts`
  - `CustomReportBuilder.tsx` and `ScheduledReportsModal.tsx` (unmounted only)
  - `DraggableSection.tsx`
  - every leaderboard, Dashboard and Dialer file

### 3.3 Why a new RPC family rather than editing the four in place
- **A clean contract.** The new functions take no org parameter, have typed windows and use a time zone (the legacy signature carries `p_org_id` and no zone).
- **A clean rollback.** The legacy bodies are untouched: revocation is reversible with one GRANT, and the rollback never has to reconstruct SQL.
- **A clean release.** The new frontend calls only the new functions. The release order in §9 means users see an honest "temporarily unavailable" state for the few minutes between deploy and apply, never zeros.

---

## §4. Exact files to touch

**New (backend / tests / CI / ops)**
1. `supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql`
2. `supabase/migrations/rollback/20260928120000_reports_secure_scoped_rpcs.rollback.sql`
3. `supabase/ops/reports_disable.sql`
4. `supabase/ops/reports_enable.sql`
5. `supabase/tests/reports_harness.sql` — synthetic schema. It is production-faithful for the columns it uses: the four legacy bodies are installed verbatim from the baseline with the production ACL, and `campaign_actor` and `resolve_downline_ids` are installed verbatim.
6. `supabase/tests/reports_rpc.sql` — the behaviour and authorization suite.
7. `scripts/run_reports_rpc_tests.sh` — localhost-only runner: suite + negative control + drift refusal + replay refusal + rollback proof + disable/enable proof.
8. `.github/workflows/reports-backend.yml` — a PR check using the postgres 17.6 service container (the production version), path-filtered to the Reports SQL files. No production credentials.

**New (frontend)**

9. `src/lib/reports-schemas.ts`
10. `src/lib/reports-export.ts`
11. `src/hooks/useReportsData.ts`
12. `src/components/reports/ReportPanelState.tsx`
13. `src/components/reports/ReportsToolbar.tsx`

**New (tests)**

14. `src/lib/__tests__/reportsQueries.test.ts`
15. `src/lib/__tests__/reportsExport.test.ts`
16. `src/lib/__tests__/reportsContracts.test.ts` — source contracts:
    - the migration's REVOKEs, `SECURITY DEFINER` and search_path;
    - no org parameter;
    - SQL defaults equal `permissionDefaults.ts`;
    - no zero fallbacks in the query layer;
    - no raw-table reads in `Reports.tsx`;
    - `report-utils.ts` untouched.
17. `src/lib/__tests__/reportStatComputations.test.ts`
18. `src/hooks/__tests__/useReportsData.test.tsx`
19. `src/pages/__tests__/reportsPage.test.tsx`
20. `src/components/reports/__tests__/reportSections.test.tsx`

**Modified (frontend)**

21. `src/lib/reports-queries.ts`
22. `src/lib/stat-computations.ts`
23. `src/lib/report-layout-constants.ts`
24. `src/pages/Reports.tsx`
25. `src/components/reports/StatsGrid.tsx`
26. `src/components/reports/StatCard.tsx`
27. `src/components/reports/ReportSection.tsx`
28. `src/components/reports/SectionRenderer.tsx`
29. `src/components/reports/ReportCustomizer.tsx`
30. `src/components/reports/AgentPerformanceCards.tsx`
31. `src/components/reports/CallVolumeChart.tsx`
32. `src/components/reports/DispositionsPieChart.tsx`
33. `src/components/reports/PoliciesSoldChart.tsx`
34. `src/components/reports/CampaignPerformance.tsx`
35. `src/components/reports/LeadSourceTable.tsx`
36. `src/components/reports/CommunicationsStats.tsx`
37. `src/components/reports/CallingHeatmap.tsx`
38. `src/components/reports/CallDurationAnalysis.tsx`
39. `src/components/reports/AgentEfficiency.tsx`
40. `src/components/reports/CallFlowAnalysis.tsx`
41. `src/components/reports/DispositionDeepDive.tsx`
42. `src/components/reports/GoalTracking.tsx`

**Docs**

43. `WORK_LOG.md` — additive newest-first entry; all prior bytes preserved.
44. `AGENT_RULES.md` — new invariant **#38**, the Reports security and metric contract (required by the Doc Update Rule §9).
45. `implementation_plan.md` (root) — a new §16 that indexes this plan. The leaderboard sections are unchanged.
46. `docs/plans/2026-09-28-reports-analytics/implementation_plan.md` — this file, plus an as-built appendix.
47. `docs/plans/2026-09-28-reports-analytics/MORNING_HANDOFF.md`

The scope does not expand without recording why in this plan's as-built appendix. If a file outside this list turns out to be necessary, I stop that portion and document it.

---

## §5. Interaction analysis (Dialer / Leaderboard / security)

| Area | Interaction | Conclusion |
|------|-------------|-----------|
| Dialer | Reports reads `calls`, `dispositions`, `dialer_sessions` read-only via STABLE functions. `report-utils.ts` (Dialer/win-owned: `isConvertedDisposition`, `buildDNCDispositionSet`, `buildContactedDispositionLookup`) is **not modified**; the canonical Contacted CASE is replicated in SQL exactly as `get_campaign_card_stats` / `get_trusted_today_dialer_stats` already do. | No Dialer behaviour, telemetry writer, `calls.duration`, queue, lock, claim, retry, disposition save, recording or inbound path changes. |
| Leaderboard | No import edge exists in either direction (audited). `get_org_leaderboard_stats`, the request gate, Dashboard lanes, `useDashboardStats` (which also reads `getDataScope("reports")`) and every leaderboard migration/ops/CI file are untouched. `usePermissions` / permission storage semantics are unchanged, so Dashboard scoping is unaffected. New migration/ops filenames avoid `leaderboard` (its CI path filter). | No conflict. |
| Database load | 6 RPCs per explicit filter change or Refresh; no polling, no realtime. Windows capped at 366 days; outbound/window predicates use `idx_calls_org_created_at`. Small tier. | Bounded; release smoke includes a timing read. |
| Security | New SECURITY DEFINER functions bypass RLS by design, so each enforces its own authorization (actor, org, role, permission, scope, agent narrowing) before any business read, and returns aggregates + agent display names only. Agent names are already organization-readable via `profiles_select_org`; team/own scopes return only in-scope names. | Strictly narrower than today (anon removed, org and agent scope enforced server-side). |
| RLS | No policy added, changed or relied upon for authorization. | `#APPROVE_RLS_CHANGE` not needed. |

---

## §6. Decisions for Chris (recommended default first; implemented as the default unless you say otherwise)

| ID | Decision | Default |
|----|----------|---------|
| D-1 | How Reports permissions combine | Page access is required. Data scope **own** requires View Own. **team** gives self plus downline when View Team is on, otherwise self when View Own is on. **all** gives the organization when View Team is on, otherwise self when View Own is on. Admin and Super Admin are locked to the whole home organization. |
| D-2 | Call timestamp and window | `calls.created_at`, half-open `[start, end)`, matching the Leaderboard canon (#23). Reports numbers will match the Leaderboard for the same period. |
| D-3 | Population for Calls Made, Talk Time, Contacted, Call Contact Rate (§R3.3), the disposition breakdown and the volume charts | **Outbound** only, as canon. Inbound is shown separately as its own count. |
| D-4 | Converted | **(§R3.1 supersedes the identity order: contact, else campaign lead, else call; Campaign Performance counts campaign leads.)** **(rev 2, §R2.2)** Converted Leads/Clients means distinct contacts with at least one outbound call in the window whose disposition converts. **Policies Sold means wins.** They are labelled separately. **No conversion rate of any kind.** The only dial-to-policy figure is "Dials per Policy Sold". |
| D-5 | A rate whose denominator is 0 | "—", never 0%. |
| D-6 | Lead source | Attribution comes only from current leads (the #5 compatibility link). **Converted by source is shown as unavailable**, because conversion deletes the lead and clients have no lead source. Lead-cost editing and the CPL/ROI columns are hidden: the table's global `UNIQUE(lead_source)` makes cross-tenant costs impossible, and there are 0 rows in production. A follow-up migration would add a per-org unique key and give cost-period semantics a definition. |
| D-7 | Goal Tracking | Shown as unavailable. `agent_scorecards` has no maintained writer and holds 0 rows; `goals` holds 0 rows. |
| D-8 | Schedule / My Reports buttons | Removed from the page. Neither works today: inserts fail, nothing is sent, and "Play" is a no-op. The component files are kept. |
| D-9 | Legacy `rpc_report_*` | Revoke EXECUTE from PUBLIC, anon and authenticated in this migration. Keep the functions; drop them in a later cleanup. |
| D-10 | Time zone | **(rev 2, §R2.1)** The agency timezone, resolved server-side from `company_settings.timezone`, drives both the window and the buckets. There is no caller timezone. **(§R3.2 supersedes: there is no default; an unconfigured or invalid zone fails closed with 55000, configuration required.)** |
| D-11 | Calls with no agent under organization scope | Included in totals and shown as an "Unattributed" line. They are excluded from per-agent tables. |
| D-12 | Longest allowed window | 366 days, enforced both server- and client-side. |
| D-13 | Release order | Frontend first, then the migration (see §9). |

---

## §7. Verification plan

**SQL (real PostgreSQL; local 16.13, CI 17.6; synthetic tenants only; the runner refuses anything that is not localhost)**
- **T0 — installation metadata:** `SECURITY DEFINER`, `STABLE`, search_path `pg_catalog, pg_temp`, owner, and no uuid organization parameter.
- **T1 — grants:** anon cannot EXECUTE any new function (checked by privilege **and** by an actual call under `SET ROLE anon`). Legacy functions are no longer executable by anon or authenticated. Private helpers are not callable by authenticated.
- **T2:** an unauthenticated caller, a missing profile, an inactive profile, a JWT organization that differs from the profile organization, and an unknown role are each denied (42501).
- **T3 — Agent:** own scope only. Asking for another agent is denied. A null agent equals self.
- **T4 — Team Leader:** sees the downline; a non-downline agent in the same org is denied; a null agent equals the team, never the organization.
- **T5 — Admin:** organization scope. **Super Admin:** home organization only; an agent id from another org is denied.
- **T6:** cross-organization agent id denied; no org parameter exists, so a forged org parameter cannot be expressed, and a forged JWT org claim is refused by `campaign_actor`.
- **T7:** permission revocation takes effect on the next call. Covers page access off, View Own off, View Team off (team falls back to own), and a malformed permission shape (fails closed).
- **T8 — metric canon:**
  - Calls Made are outbound-only.
  - Talk time comes from `calls.duration`, including negative clamping.
  - Contacted covers >45 s, `counts_as_contacted` by id, the name fallback, No Answer excluded (even when >45 s) and inbound excluded.
  - The zero-call denominator is null.
  - Converted is distinct; Policies Sold equals the number of wins.
  - Appointments follow the canon.
  - Session seconds follow the canon.
- **T9:** half-open date bounds, a reversed or oversized window rejected (22023), an unknown time zone rejected, and local-day bucketing across UTC midnight.
- **T10:** disposition grouping by id, the name fallback, the "(No disposition)" bucket and the fixed histogram order.
- **T11:** campaign attribution; restricted users never receive organization totals; campaign membership after lead deletion.
- **T12:** lead-source scope. An agent sees only in-scope calls and assigned new leads; converted is unavailable.
- **T13:** a successful empty result is valid JSON with zeros where counts are genuinely zero and nulls for rates.
- **Runner proofs:**
  - negative controls (as built: 2a broken Contacted rule, 2b removed narrowing guard, 2c campaign-lead-first Converted, 2d silent default zone, 2e Converted without its campaign-lead fallback, 2f campaign converted leads counted as people);
  - drift refusal (a changed legacy body makes the migration abort with nothing applied);
  - replay refusal;
  - rollback proof (objects dropped, legacy grants restored, data unchanged);
  - disable/enable proof.

**Vitest**
- The query layer:
  - calls the exact RPC names with exact arguments (no org);
  - maps 42501 → denied (a `permission denied for …` 42501 → unavailable), 55000 → configuration, 22023 → invalid, `{data:null}` → unavailable and a schema mismatch → unavailable;
  - passes the abort signal through;
  - applies the 25 s timeout.
- The hook covers:
  - scope before panels, and no panel request when access is denied;
  - a stale resolve or stale reject after key changes (range, agent, viewer, org);
  - partial-panel failure keeps the other panels;
  - retry per panel;
  - an agent outside the scope resets before any request;
  - no timers or polling after settle;
  - a frame recorder proving the previous key's rows are never painted.
- The page covers loading, error (no digits rendered), denied, empty, partial, the selector showing only scope agents, and export gated and disabled until ready.
- Exports cover formula neutralization, the header block, and refusing stale or not-ready panels.
- Stat computations: canonical stats are correct and non-canonical ones are unavailable.
- Sections: the heatmap uses the real matrix, charts are chronological, and empty differs from error.

**Repository gates:**
- `npx tsc --noEmit` (reported, and noted as vacuous) and `npx tsc -p tsconfig.app.json --noEmit` (must not exceed the 90 baseline errors, with no new diagnostic in a touched file).
- Full `npx vitest run` compared with the baseline.
- ESLint on the touched files.
- `npm run build`.
- The new SQL runner, and the existing profile RPC runner for regression, since its resolver is reused.
- An adversarial review round (independent reviewer agents on the diff) before the handoff.

---

## §8. Explicit non-actions

- No merge. No `apply_migration` or any other production write. No Edge Function deploy, Vercel deploy or Supabase / Vercel configuration change.
- No production data is read beyond the catalog and aggregate reads listed in §1.
- No RLS change, and no change to Dialer, Twilio, queue, retry, disposition, recording, inbound or leaderboard code or SQL.
- No change to the `wins`, `agent_scorecards` or `lead_source_costs` schema or data.

---

## §9. Release sequence (for a separate approval), rollback and smoke tests

1. **Review and CI.** Review the PR. CI `reports-backend.yml` must be green, and the local gates are recorded in the handoff.
2. **Frontend first.** Merge; Vercel builds production from `main`. Until step 3, Reports shows an honest "temporarily unavailable" error: the new RPCs do not exist yet and the page never shows zeros. Every other page is unaffected.
3. **Preflight.** Immediately after the deploy is READY, run read-only checks that the four legacy bodies still match the audited hashes and that no `get_report_*` object exists.
4. **Migration.** `apply_migration` with the **exact** file bytes. Then reconcile the repository filename to the recorded version; the SQL bytes are not edited.
5. **Read-back.** Confirm the new function metadata and ACLs, and that the legacy ACLs are `{postgres, service_role}`. Run a bounded READ ONLY authenticated-role call for one Admin and one Agent at identical bounds, and compare the totals with the Leaderboard month for the same window.
6. **Smoke tests** (§10).
7. **Rollback / re-disable.**
   - **(a) Re-disable (preferred).** Apply `supabase/ops/reports_disable.sql` as a new migration. The page then shows "temporarily unavailable", and the legacy functions stay inaccessible.
   - **(b) Remove the new functions.** Apply the rollback file as a new migration. It drops the new objects and **re-asserts** the legacy revocation (§R2.3). Reports stays unavailable, and nothing vulnerable is re-granted.
   - **(c) Frontend rollback.** Promote the previous Vercel deployment, only together with (a) or (b). The old frontend's legacy calls are denied, so it shows zeros (its old error-swallowing). Prefer fixing forward.
   - **There is no path that restores legacy EXECUTE to PUBLIC, anon or authenticated.**

## §10. Smoke tests after release

1. Admin: This Month totals equal the Leaderboard month (calls made, talk time, policies sold, appointments). Organization badge shown. Agent selector lists org agents; picking one narrows.
2. Agent (own): selector disabled on self; numbers equal the Dialer's per-campaign sums for today; no other agent's name appears anywhere, including CSV.
3. Team Leader: selector lists self + downline only; a non-downline agent id sent by hand via the API returns 42501.
4. Anonymous `POST /rest/v1/rpc/get_report_call_summary` with the anon key → 401/permission denied; legacy `rpc_report_call_summary` → permission denied.
5. Campaign Performance and Lead Source panels render real rows (previously always empty).
6. Toggle the org's Agent "Reports" page permission off → Agent sees the permission-denied state on next load (no data).
7. Kill the network mid-load → panels show "Couldn't load — this is not a zero" with Retry; export disabled.
8. Timing: each RPC for This Month < 1 s at current volume (log the request times; no polling traffic in logs).

---

## §11. As-built appendix

Built on the branch only. Nothing was merged, applied, deployed or configured. The final file list, migration hashes, test
counts and the release packet are in `MORNING_HANDOFF.md` next to this plan.

**Deviations from rev 1 / rev 2, with reasons**

1. **Day boundaries are the first instant of each agency day** (tightens §R2.1).
   - A bare `date::timestamp AT TIME ZONE tz` picks the *later* instant when local midnight occurs twice, i.e. a
     fall-back at midnight (for example America/Havana, 2026-11-01). That moved the day's first hour into the previous
     day's report, and outside that report's `by_date`.
   - `private.report_window` now takes `least(d AT TZ, ((d − 1 h) AT TZ) + 1 h)` for each boundary. This is identical
     everywhere else: a property check found 0 mismatches across 677,904 zone-days (every IANA zone, 2024–2027); the bare
     form had 8.
   - Suite T9 pins the Havana fall-back and spring-forward, plus an every-day property for four zones. A negative control
     confirmed that the old formula fails T9.
   - Found by the adversarial review (low).
2. **42501 is split** (§7 said "42501 → denied").
   - The RPCs' own refusals, and `campaign_actor`'s, stay `denied`.
   - `permission denied for function/schema/table …` becomes `unavailable` with Retry. That message means EXECUTE was
     revoked by `reports_disable.sql`, or grants drifted; it is a platform state, not the viewer's permission.
   - Without the split, the documented emergency-disable state told every user, Admins included, "You don't have access"
     (AGENT_RULES #37).
   - Found by review (medium).
3. **Refresh re-resolves the scope** (§3.2).
   - Refresh reloads `get_report_scope()` before the panels, and the panel key includes the resolved scope, zone and
     agency `today`. Before this, a page left open past agency midnight kept the old `today` for presets and "Calls today".
     A mid-session permission or zone change also kept stale labels.
   - A payload whose scope, zone or agent filter differs from the toolbar's is withheld, with a reload prompt.
   - CSV labels are taken from the payload itself.
   - Found by review (medium).
4. **Session-based ratios use one population.**
   - "Calls per session hour" and "Talk time share of session" divide the calls and talk time *of agents with session time*
     by those agents' session time.
   - Before this, organization totals (including unattributed calls and agents without sessions) were divided by agent-only
     session time. That could exceed 100 %.
   - Found by review (low).
5. **Empty states name the population.**
   - Outbound-only panels say "No outbound calls in this period".
   - Disposition Deep Dive says "None of the N outbound calls … has a campaign / an assigned agent" instead of "No
     dispositioned calls".
   - Found by review (low).
6. **`formatHours`** rounds to whole minutes once, then splits, so it never renders "1h 60m". Found by review (low).
7. **Runner hardening.**
   - The host check is exact.
   - A backstop refuses any cluster that has Supabase platform roles.
   - The "re-apply after rollback" step now actually fails the run under `set -e`, and asserts that all 14 functions were
     recreated.
   - Found by review (low).
8. **§7 runner text "rollback proof (… legacy grants restored …)"** is superseded by §R2.3. The rollback proof asserts that
   the legacy functions are **re-sealed**, including after a simulated hand-made re-grant, and never re-granted.
9. **§10 smoke test 2 ("Agent: selector disabled on self; numbers equal the Dialer's … today")** is superseded.
   - An own-scope viewer has **no** agent selector.
   - The Dialer's "Today" is agent-local, so equality holds only when the agent's zone equals the agency zone.
   - The handoff's smoke tests are authoritative.

**Not built (unchanged decisions):** no conversion rate of any kind; lead-source Converted unavailable; lead cost / CPL / ROI
hidden; Goal Tracking unavailable; saved and scheduled reports unmounted (component files kept); legacy `rpc_report_*` kept
but sealed.

**Adversarial review.** Five dimensions were reviewed on the full diff, with independent verifiers: SQL security, SQL
metrics, frontend state, frontend truthfulness and release safety.
- SQL security had **no findings**.
- The other four dimensions produced 14 reports, which de-duplicate to **11 distinct issues**:
  - **two medium:** Refresh never re-resolved the scope; the emergency-disable state was shown as a permission denial;
  - **nine low.**
- All 11 were fixed as described above, or are documented as release risks (the handoff was incomplete; old open tabs
  after the migration — see the handoff).

**Final corrections (2026-09-29, §R3)**
- **What was built.** All three corrections are implemented as described in §R3, in commits `0d14cbb` and `c60021a` plus the
  docs commit.
- **Adversarial review of the three changes.** Five reviewers, three refutation-leaning verifiers per finding, and a
  completeness critic.
  - No finding touched security, and no finding changed a reported number.
  - Confirmed findings, all fixed:
    - The docs had not yet been updated for the new contracts.
    - The fixtures did not exercise the Converted fallbacks, and did not show that Campaign Performance counts campaign
      leads. Fixed with April fixtures and negative controls 2e and 2f.
    - The pseudo-zones `Factory`, `localtime` and `posixrules` were accepted. They now fail closed, tested in T15.
    - The toolbar said "Loading your report scope…" under the configuration notice.
    - A 55000 on a panel after the scope loaded showed generic error cards. It now withholds the page, and Retry reloads
      the scope.
    - The label guard missed lowercase and line-start occurrences. It is now position- and case-independent, and
      mutation-checked against five reverts.
    - Stale migration comments.
  - Documented rather than changed:
    - 55000 surfaces as HTTP 500.
    - A valid zone stored by provisioning, a column default or the Company Branding placeholder counts as configured.
  - The critic flagged "Dials per contact"; it is relabelled "Dials per contacted call".
