# AgentFlow | AI System Instructions & Protocols (v5.0.0)
**Owner:** Chris Garness | **Last Updated:** June 17, 2026

---

## 1. North Star

> Life insurance agents deserve enterprise velocity without the complexity of legacy tools. We build for **300+ dials per day** and **100% telemetry accuracy**.

---

## 2. Tech Stack Constants

Stable IDs agents must use before writing code. **Never commit secrets** — Edge secrets and Vault hold credentials.

| Constant | Value | Notes |
|----------|-------|-------|
| **Supabase project ID** | `jncvvsvckxhqgqvkppmj` | Production database + Edge Functions |
| **Supabase URL** | `https://jncvvsvckxhqgqvkppmj.supabase.co` | Callback base for Twilio webhooks — use `SUPABASE_URL`, not `X-Forwarded-Host` |
| **Chris home org UUID** | `a0000000-0000-0000-0000-000000000001` | Family First Life - Chris Garness; used in ops scripts and test data — not a bypass for RLS |
| **Twilio TwiML App SID** | `AP6ac23752609fdee79751693a2a223cd8` | Lives on **master** account — Voice JWT `sub` must be master SID |
| **Twilio Master Account SID** | Edge secret `TWILIO_MASTER_ACCOUNT_SID` | Voice JWT signing; subaccount SID is for REST purchase/CNAM only |
| **Twilio API Key SID** | Edge secret `TWILIO_API_KEY_SID` | JWT `iss` claim |
| **Vercel** | Production frontend on Vercel (linked repo) | Confirm project/domain in Vercel dashboard before DNS or env changes |
| **Resend** | Edge Functions only | Transactional email — never Supabase default SMTP |
| **Anthropic** | Optional AI features | Not wired to live AI Agents page (mock UI only) |

**Deprecated (do not use in new code):** Telnyx SDK, `telnyx-*` Edge Functions, `TelnyxContext`, `dialer-start-call` two-legged pattern. Telnyx fully removed (April 2026 from codebase; orphaned Edge Functions decommissioned 2026-05-17). If any file still references Telnyx (parameters, column names, comments), flag it as stale and do not replicate the pattern.

---

## 3. Multi-Tenancy Rules

- Every tenant row carries **`organization_id`**. RLS uses **`public.get_org_id()`** from the JWT.
- **Super Admin:** platform console can list all `organizations`; in-app data for super-admins is scoped to their **home org** except Agencies tooling (see migrations `20260430203000_*`).
- **Admin:** all rows in their `organization_id`.
- **Team Leader:** downline via `ltree` / `is_ancestor_of` where policies allow.
- **Agent:** `user_id = auth.uid()` (and campaign-type rules on `campaign_leads`).
- **Queries:** `.maybeSingle()` for singular lookups that may return zero rows.
- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` in the browser.

### Platform-level roles (Control Center)

- Platform-level roles live on **`profiles.platform_role`** (nullable text). v1 enum: `NULL` or `'platform_admin'`. Future values: `platform_manager`, `platform_viewer` — extend the CHECK constraint in a new migration.
- `platform_role` is **independent** of the agency role string (`Agent` / `Admin` / `Team Leader` / `Super Admin`) **and** of `is_super_admin`. `is_super_admin` = AgentFlow staff with cross-org tenant power; `platform_role` = AgentFlow staff with internal-ops (Control Center) visibility. **Do not auto-promote one to the other.**
- Control Center RLS uses **`public.is_platform_admin()`** which reads `profiles` directly — **not the JWT**. The role takes effect on the next request without a token refresh / `custom_access_token_hook` change.
- Control Center records live under the `control_center_*` namespace (`control_center_features`, `control_center_issues`, `control_center_health_checks`, `control_center_health_check_runs`, and the `control_center_tracker_*` Tracker tables — `systems`, `items`, `issues`, `marketing_claims`, `references`). `organization_id` is nullable on these tables; v1 records are platform-global (org-null).
- **Known exception (intentional, do not "fix"):** Control Center tables are **platform-global** and RLS-gated on `public.is_platform_admin()` — NOT scoped by `organization_id` / `public.get_org_id()`. This is the one approved exception to the "every table scoped by `organization_id`" rule. The `control_center_tracker_*` tables (added 2026-06-05) keep `organization_id` nullable for forward-compat but are org-null in v1; their derived `completion_percent` is intentionally NOT stored (computed in the UI from item statuses). Do not rewrite these policies to org-scoping or add org-NOT-NULL constraints without Chris's approval.
- Control Center routes (`/control-center/*`) are mounted **outside** the CRM `<AppLayout />` shell. Do **not** add Control Center links to the CRM sidebar.

---

## 4. Architectural Invariants

Non-negotiables from production:

1. **Twilio Voice JWT** — Sign with **`TWILIO_MASTER_ACCOUNT_SID`** as JWT `sub`. Subaccount SID in `sub` causes **ConnectionError 53000** (TwiML App is on master).
2. **`verify_jwt: false`** on Edge Functions called from the frontend (and webhooks). Validate Bearer JWT in Deno via `createClient(url, ANON_KEY).auth.getUser(jwt)` because Supabase gateway rejects ES256 when `verify_jwt = true`.
3. **Atomic queue claiming** — `SELECT … FOR UPDATE SKIP LOCKED` in the **canonical** `get_next_queue_lead` (see invariant #15; `fetch_and_lock_next_lead` is now a deprecated wrapper). Never fetch-then-lock in application code.
4. **Edge deploys** — Always `get_edge_function` (MCP) before deploy; ship full `index.ts` body.
5. **Migrations** — File on disk ≠ applied. Confirm with **`list_migrations`** (MCP) before assuming schema.
6. **Feature before permissions** — Ship working UI/data path, then tighten RLS/PermissionGate.
7. **Twilio webhook URLs** — Derive from **`SUPABASE_URL`** in all five voice/recording webhook functions; change all together.
8. **Canonical call duration** — `twilio-voice-status` is the **sole writer** of `calls.duration`; it is the canonical source for billing minutes, contacted logic, talk time, and reporting. Browser timers are UI-only and must not write `calls.duration` (P0B, 2026-05-28, removed all three `TwilioContext.tsx` writes — `finalizeCallRecord`, `checkOrphanedCalls`, `hangUpOrphan`; those paths still write `status`/`ended_at`. P0B follow-up, 2026-05-28, removed the remaining write in `dialer-api.ts` `saveCall()` (`sharedCallFields.duration`) — the wrap-up "Save & Next" path; `duration_seconds` is still passed for the `contact_activities` description only). In `twilio-voice-status`: prefer `CallDuration`, fall back to `DialCallDuration`; terminal non-answer statuses (`no-answer`/`busy`/`canceled`/`failed`) with no Twilio duration write `0`; a late/out-of-order callback must never regress an existing positive duration (monotonic guard). `call_logs.duration` and `dialer_daily_stats.*duration_seconds` are separate telemetry and may still be browser-derived.
9. **Re-entrancy guards in `TwilioContext.tsx`** — Do not remove:

| Ref | Blocks |
|-----|--------|
| `isDialingRef` | Concurrent `makeCall()` |
| `twilioVoiceReadyRef` | Dial before Device `registered` |
| `initializeInFlightRef` | Overlapping `initializeClient()` |
| `twilioVoiceOrgIdRef` | Redundant Device re-init |
| `endStateProcessedRef` | Double end-of-call handling |
| `callLogSentRef` | Duplicate `call_logs` inserts |
| `callIdsDbSyncedRef` | Duplicate CallSid sync |
| `recordingStartedRef` | Duplicate browser recording |
| `outboundRemoteAnsweredRef` | Ring-timeout after answer |
| `hangUpRef` | Stable `hangUp` for watchdog |

10. **Workflow automation must never block core CRM writes** — Workflow trigger functions (`handle_*_workflow_events`, `workflow_on_lead_created`/`workflow_on_lead_updated`/`workflow_on_call_created`) dispatch via `public.workflow_dispatch_event` (a swallowing wrapper over `private.workflow_dispatch_event`). Every dispatch is wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING`. Appointments, calls, leads, clients, DNC, notes, and `campaign_leads` saves **must still commit** even when workflow dispatch fails. Do not reintroduce a trigger that can abort a core write on automation failure without Chris's explicit approval. (Hardened 2026-05-28, migration `20260528220000_fix_dialer_dispositions_workflow_triggers.sql`.) Note: `public.leads` has **no** `pipeline_stage_id` and **no** `tags` column — lead-update workflow paths guard those via `to_jsonb(NEW) ? '<col>'` and must not assume the columns exist.

11. **Converting dispositions in the Dialer are gated behind `ConvertLeadModal`** — A disposition is "converting" when its `pipeline_stage_id` maps to a `pipeline_stages` row with `convert_to_client = true` (detected via `isConvertedDisposition`). When the agent picks such a disposition and clicks Save Only / Save & Next, the Dialer must open `ConvertLeadModal` and **block** the call/disposition/notes save, the queue advance, the Team/Open lock release, and the `policies_sold` increment until conversion succeeds. On a cancelled/closed modal: clear pending state, deselect the disposition, keep wrap-up open, save/advance nothing. On success: run the stored action and attach all follow-up data (call, note, status, pipeline activity) to the **returned `clientId`**, not the now-deleted lead id — `contact_id` is a polymorphic `(contact_id, contact_type)` ref with no FK, and `getLeadHistory` reads by `contact_id`. (Added 2026-05-28; `src/pages/DialerPage.tsx` only — uses existing `conversionSupabaseApi.convertLeadToClient`; no schema/migration change.)

12. **Trusted dialer stats and session duration (P1 Build 1)** — **Talk time for billing/reporting:** only `calls.duration` written by `twilio-voice-status`. **Session duration for reporting:** only server-timestamped `dialer_sessions` (`started_at`, `last_heartbeat_at`, `ended_at`) via `start_dialer_session` / `heartbeat_dialer_session` / `end_dialer_session`. Browser timers and `dialer_daily_stats.calls_connected` / `total_talk_seconds` / `session_duration_seconds` are **display/legacy only** — not billing, manager truth, or contacted counts. **`increment_dialer_stats`:** legacy/display compatibility RPC only; hardened to require `public.get_org_id()` and `auth.uid() = p_agent_id`; not granted to `anon`/`PUBLIC`. **`dialer_daily_stats` and `dialer_sessions`:** must carry `organization_id`; RLS uses `public.get_org_id()`. **Stale session cleanup:** `private.close_stale_dialer_sessions` (3-minute threshold) runs opportunistically from `start_dialer_session` and `heartbeat_dialer_session` only — scoped to current org + current agent; not exposed to authenticated callers. (Migration `20260529003210_dialer_stats_sessions_backend_foundation.sql`; frontend session RPC wiring in Build 2 — `src/hooks/useDialerSession.ts`, `src/lib/supabase-dialer-sessions.ts`.) **P1 Build 3 (2026-05-29):** trusted Dialer daily/session totals now derive from canonical sources via `getTrustedTodayDialerStats({ agentId, organizationId, date?, dncDispositionNames? })` in `src/lib/supabase-dialer-stats.ts` — **calls made / talk time / contacted** from `calls` (talk time = `SUM(calls.duration)`; contacted = `report-utils.isContactedCall` → `duration > 45 OR DNC disposition`, no browser `>= 7s` logic), **policies sold** from `wins`, **session duration** from `dialer_sessions`. `DialerPage` reconciles `sessionStats` from this helper on mount, campaign change, ~4s after hangup, after Save Only / Save & Next, and after session end. The browser **no longer** feeds trusted connected/talk/session-duration (the old `handleHangUp` `twilioCallDuration >= 7` write was removed). Header stat relabeled **"Connected" → "Contacted"** and **"Answer Rate" → "Contact Rate"** (`SessionStats.calls_connected` → `contacted_calls`). `upsertDialerStats` / `getTodayStats` / `deleteTodayStats` (`dialer_daily_stats`) remain **legacy/display-only** for `calls_made` / `session_started_at` / `policies_sold` compatibility — never trusted, never fed browser talk/connected/session duration. No migration/RPC added (direct queries suffice). (`src/lib/supabase-dialer-stats.ts`, `src/hooks/useDialerSession.ts`, `src/components/dialer/DialerHeaderStats.tsx`, `src/pages/DialerPage.tsx`.)

13. **Contacted is configurable, never label-inferred (P1 Build 3A, 2026-05-29)** — Trusted Contacted = **Twilio-backed `calls.duration > 45` OR `disposition.counts_as_contacted = true`**. `counts_as_contacted` is a `dispositions` boolean (`NOT NULL DEFAULT false`, migration `20260529120000_add_counts_as_contacted_to_dispositions.sql`), toggled per disposition in Disposition Settings ("Counts as Contacted"). Runtime classification (`report-utils.isContactedCallRow` via `buildContactedDispositionLookup`, consumed by `getTrustedTodayDialerStats`) must **never** hardcode agency-specific disposition names. Disposition match **prefers `calls.disposition_id`** (UUID FK now persisted on new rows — `dialer-api.saveCall` writes `disposition_id`, callers `DialerPage`/`FloatingDialer` pass `disp.id`) and **falls back to lowercased `disposition_name`** for legacy rows where `disposition_id` is null. DNC name set remains an optional legacy fallback. Backfill credited `dnc_auto_add` / `appointment_scheduler` / `callback_scheduler` / linked `convert_to_client` stages; "Busy / Failed / Bad Number / Voicemail / skip-only" stay false unless a flag applies. **Exception — the locked/system `No Answer` disposition must ALWAYS be not-contacted:** migration force-sets it false, the Settings toggle is disabled for it ("No Answer is system-controlled and never counts as contacted."), and runtime `isContactedCallRow` + `buildContactedDispositionLookup` hard-exclude it via `isSystemNoAnswerName` (the canonical locked identifier `name = 'No Answer'` — the one allowed name check; no dedicated system-type column exists). No `calls.duration` / Twilio change.

14. **Dialer header stats are selected-campaign scoped + user-timezone daily (P1 Build 3B, 2026-05-29)** — `getTrustedTodayDialerStats` now **requires `campaignId` + `timeZone`** and filters `calls`, `wins`, and `dialer_sessions` by `.eq("campaign_id", campaignId)`. With no campaign selected the header shows neutral zeros (never all-campaign totals). **Daily reset uses the agent's local day, not UTC and not the agency timezone:** `userLocalDayBounds(timeZone)` returns the user's local midnight→midnight as UTC ISO for Supabase `gte`/`lt`. Timezone source is **browser IANA** (`resolveUserTimeZone` → `Intl.DateTimeFormat().resolvedOptions().timeZone`, UTC last resort) — `profiles.timezone` stores Rails/ActiveSupport labels ("Eastern Time (US & Canada)") that are NOT IANA and cannot drive `Intl` math (deferred future enhancement). **Session Duration is cumulative per campaign/user-local day:** the helper returns `session_duration_seconds` (closed spans + live active delta) and `closed_session_duration_seconds` (ended/abandoned only). The browser display = `closed base` + live active elapsed (`useDialerSession.setBaseSessionSeconds` + the display ticker), so leaving/re-entering a campaign **persists and resumes** the duration; with no active session it freezes on the accumulated total (never 0). Browser timers remain **display-only** — trusted stats come from `calls`/`wins`/`dialer_sessions`; `dialer_daily_stats` stays legacy/display-only. **Wins are now campaign+org-linked from the Dialer Sold path:** `convertLeadToClient(lead, policyInfo, organizationId, campaignId)` passes both `campaignId` and `organizationId` to `triggerWin`; `ConvertLeadModal` gained an optional `campaignId` prop that DialerPage feeds from `selectedCampaignId` (FloatingDialer/quick-call wins stay non-campaign by design — no campaign session). No migration (all FKs/columns pre-existed); no `calls.duration`/Twilio/queue/disposition-save change.
   - **Header stats fetch is now a server-side aggregate RPC (2026-06-05; migration `20260606020000_get_trusted_today_dialer_stats_rpc.sql`, APPLIED to prod).** `getTrustedTodayDialerStats` delegates to `public.get_trusted_today_dialer_stats(p_campaign_id, p_start, p_end)` — a read-only `SECURITY DEFINER STABLE` aggregate that returns ONE row (counts only, no PII): `calls_made`, `contacted_calls`, `total_talk_seconds`, `policies_sold`, `session_duration_seconds`, `closed_session_duration_seconds`, `active_session_id`, `active_session_started_at`. It hard-scopes to **`auth.uid()`** (an agent reads only their OWN stats — no `p_agent_id`) + `get_org_id()` + the one campaign + the caller-supplied UTC `[p_start, p_end)` window (the agent's local day, still computed client-side via `userLocalDayBounds`). **Contacted is defined server-side** (duration > 45 OR `disposition.counts_as_contacted`, excluding system `No Answer`; prefers `calls.disposition_id`, falls back to lowercased `disposition_name`) mirroring `get_campaign_card_stats` — the **single source of truth**; do NOT reintroduce client-side per-row fetch + JS aggregation (that scaled O(call volume) over the wire). Called via narrow `(supabase as any).rpc(...)` cast (absent from generated types). Frontend keeps a per org/agent/campaign/local-day `localStorage` instant-paint cache + hover prefetch on the selection cards for perceived-instant loads; the RPC is the authoritative refresh. The `contactedDispositions`/`dncDispositionNames` args remain on the helper for API compat but are now server-computed (ignored).

15. **Team/Open queue lock canon (Queue Build 1, 2026-05-29; migration `20260529211013_queue_lock_rpc_foundation.sql`)** —
- **Production lock schema is canonical:** `dialer_lead_locks(campaign_lead_id, locked_by, campaign_id, organization_id, expires_at)`, UNIQUE on `campaign_lead_id`. Never reintroduce `lead_id`/`agent_id` lock columns, and never reference `campaign_leads.assigned_agent_id` (it does not exist — lead ownership lives on `leads.assigned_agent_id`).
- **`public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb)` is the ONE canonical Team/Open claim RPC** (the live `useLeadLock.getNextLead` path). `SECURITY DEFINER`, `search_path = public, pg_temp`, org via `get_org_id()`, `FOR UPDATE SKIP LOCKED`, cleans expired locks first; waterfall order = owned callbacks (due ≤ now+5min) → new (0 attempts) → retries; excludes terminal statuses (`DNC`/`Completed`/`Removed`/`Failed`), max-attempts-reached, not-yet-retry-eligible, other-agent active locks, and the current agent's active suppressions; ownership guards keep another agent's callback (`callback_agent_id`) or hard-claimed lead (`leads.assigned_agent_id`) from surfacing.
- **`fetch_and_lock_next_lead` is a DEPRECATED wrapper** that calls `get_next_queue_lead`. Do **not** maintain two divergent claim implementations or restore its old 90s-TTL / `created_at`-only body.
- **Team/Open locks use a 5-minute TTL.** The heartbeat target is **`renew_lead_lock(p_campaign_lead_id uuid) → boolean`** (renews only the caller's own lock in the current org; `false` = lock lost).
- **Skip is per-agent suppression** via **`campaign_lead_agent_suppressions`** (RLS on, own-row writes) — never a global queue removal. The canonical claim RPC excludes the current agent's active (`suppressed_until > now()`) suppressions.
- **Personal campaigns remain no-lock / private** — direct `campaign_leads` query, `lockMode = false`, no `dialer_lead_locks` row.
- Retry interval canonical field is **`campaigns.retry_interval_minutes`** (`retry_interval_hours` is deprecated compat). Campaign calling window is **`campaigns.calling_hours_start`/`calling_hours_end`, default 08:00–21:00**; lead-local enforcement is deferred (no lead timezone column yet).
- **Frontend queue lifecycle wired in Queue Build 2 (2026-05-29, frontend-only, no migration):**
  - `useLeadLock` now passes **`p_campaign_lead_id`** (= `campaign_leads.id`, the lock key) to both `release_lead_lock` and `renew_lead_lock` — the prior `p_lead_id` arg was a no-op. Heartbeat renews every 30s while a Team/Open lead is on screen; on renew failure it logs only (never crashes the dialer or silently advances). Personal campaigns never heartbeat/lock.
  - **Save Only keeps the Team/Open lock** (lead stays on screen, heartbeat continues, no advance); `saveCallData` no longer releases the lock and has no lock-release `finally`. **Save & Next** saves → releases lock → advances (`proceedSaveAndNext`). A failed save does not advance and keeps the lock.
  - **Skip = per-agent suppression, not global retry:** `handleSkip` (Team/Open) upserts `campaign_lead_agent_suppressions` (`organization_id, campaign_id, campaign_lead_id, agent_id, suppressed_until = now + retry_interval_minutes, reason='skip'`; conflict target `organization_id,campaign_lead_id,agent_id,reason`) then releases the lock + advances. Skip does **not** increment attempts and does **not** write a global `retry_eligible_at`. Personal skip keeps its local-session behavior (own private queue).
  - **Retryable actual calls set `campaign_leads.retry_eligible_at = now + retry_interval_minutes`** (and No Answer too); terminal/owned dispositions (remove-from-campaign, DNC, Sold/Convert, scheduled callback/appointment) clear it to null. Attempt increment stays owned by `saveCall` (actual-call only).
  - **`campaigns.retry_interval_minutes`** is the canonical frontend retry field now (read in all 3 campaign-config load sites; `getRetryIntervalMinutes()` falls back to `retry_interval_hours*60` then 1440). `types.ts` got a surgical `retry_interval_minutes` add on `campaigns` Row/Insert/Update; `campaign_lead_agent_suppressions` is written via a narrow `(supabase as any)` cast (table not in generated types).
  - Hard claim: see §5 "Hard claim" gotcha (duration>45 OR countsAsContacted OR callbackScheduler, excluding No Answer AND DNC; 46s timer).
  - `dialer-queue.ts:fetchNextQueuedLead` remains DEAD CODE (deprecation comment added); the one live claim path is `useLeadLock.getNextLead` → `get_next_queue_lead`.

16. **Team/Open queue metrics + callback ownership + no-eligible states (Queue Build 3, 2026-05-29; migration `<ts>_get_queue_metrics_rpc.sql`)** —
- **Team/Open queue panel metrics MUST come from `public.get_queue_metrics(p_campaign_id uuid)`** — an org-scoped, campaign-scoped, read-only `SECURITY DEFINER` aggregate RPC — **never** from direct client `dialer_lead_locks` reads. Reason: the `dialer_lead_locks` SELECT policy only exposes a regular agent's own lock (`locked_by = auth.uid()`), so client-side org-wide `locked` / `active agents` counts are impossible (that produced the stale `0 locked / 0 active agents`). The old panel also queried a **nonexistent `agent_id`** column (canonical is `locked_by`).
- **Metrics MUST mirror the canonical claim eligibility** (`get_next_queue_lead`): exclude terminal (`DNC`/`Completed`/`Removed`/`Failed`), respect `max_attempts`, `retry_eligible_at`, callback ownership (`callback_agent_id`), hard-claim ownership (`leads.assigned_agent_id`), other-agent active locks, and the current agent's active suppressions. Returns aggregate counts only (no lead PII): `total_leads, eligible_leads, locked_leads, active_agents, available_leads, suppressed_for_current_agent, retry_blocked_leads, callback_waiting_leads, next_eligible_at`. Manager `queue_filters` are **not** applied to metrics in v1 (decision D4). RPC called via narrow `(supabase as any).rpc(...)` cast (absent from generated types).
- **Queue panel must distinguish total campaign leads from currently-callable.** "Available" = `available_leads` (to the current agent now), with a separate `total` / `callable` line. Panel refetches on 15s poll **and** on the `queue-metrics-refresh` window event DialerPage dispatches after claim / Save Only / Save & Next / Skip / advance / lock release / End Session / heartbeat-lock-lost.
- **"No leads" messaging must distinguish** empty (`total_leads = 0`) vs. exhausted (`eligible_leads = 0`) vs. temporarily ineligible (`available_leads = 0` but `eligible_leads > 0`, show `next_eligible_at`) vs. locked-by-others (`locked_leads > 0`). Team/Open empty state uses `QueueExhaustedNotice` (RPC-driven); Personal keeps its cheap static message.
- **Callback ownership is canonical via `callback_agent_id`.** New callback saves write the canonical due column **`callback_due_at`** (+ `scheduled_callback_at` in sync for compat) **and** `callback_agent_id = current user` **and** `callback_note` (when present). Non-callback dispositions clear **all four** (`callback_due_at`, `scheduled_callback_at`, `callback_agent_id`, `callback_note`). Neither due column is dropped/renamed; the claim RPC reads `COALESCE(callback_due_at, scheduled_callback_at)`.
- **Auto-dial must not fire an owned callback before its due time** (manual dial in the 5-min early window stays allowed). `useDialerStateMachine` gained `shouldDeferAutoDial(lead)` — defers (does not skip) when `COALESCE(callback_due_at, scheduled_callback_at) > now()`.
- **Deferred (documented, do NOT fake):** appointment queue priority — `appointments` has only polymorphic `contact_id` + `user_id` (no `campaign_id`/`campaign_lead_id`/`lead_id`); lead-local calling-hour enforcement — `leads` has no timezone column (only `state`, free-text `best_time_to_call`). **Known divergence:** the pre-existing `src/utils/dialerUtils.ts` `checkCallingHours` approximates timezone from `lead.state` and auto-skips in auto-dial — left untouched this build (decision D3), to retire when a real lead-timezone model lands. Do not add new state/phone/area-code/free-text timezone approximation.

17. **Campaign card stats are a derived read-only aggregate, not stored counters (Queue Build 4, 2026-05-29; migration `20260530051039_get_campaign_card_stats_rpc.sql`, APPLIED to prod)** —
- **The Campaigns page cards (Total / Called / Contacted / Converted) MUST read `public.get_campaign_card_stats(p_campaign_ids uuid[])`** — an org-scoped (`get_org_id()`), read-only `SECURITY DEFINER STABLE` aggregate (counts only, no PII) returning one row per visible campaign in a single call (no N+1). Pass the page's already-visible/assignee-filtered campaign ids. Called via narrow `(supabase as any).rpc(...)` cast (absent from generated types). `Campaigns.tsx` no longer renders the stored `campaigns.leads_contacted` / `leads_converted` columns.
- **Stored counter status:** `campaigns.total_leads` and `campaigns.leads_called` ARE trigger-maintained and accurate (`sync_campaign_total_leads` / `sync_campaign_leads_called` on `campaign_leads`). **`campaigns.leads_contacted` and `campaigns.leads_converted` have NO triggers — they are unmaintained/legacy (always 0). Do not trust them; do not add contacted/converted triggers or backfill without Chris's approval.** Other surfaces still reading the stored columns (`CampaignDetail.tsx`, `supabase-dashboard.ts`, `reports-queries.ts`) inherit the same `0` bug and are deferred to a later build.
- **Card Contacted mirrors the trusted Dialer model** (`report-utils.isContactedCallRow`): distinct campaign leads with ≥1 call where `calls.duration > 45` OR the disposition's `counts_as_contacted = true`, excluding the system/locked `No Answer` (`isSystemNoAnswerName`). Disposition match **prefers `calls.disposition_id`**, falls back to lowercased `disposition_name` (org-scoped) for legacy rows. DNC may count Contacted if its disposition is flagged, but never implies Converted.
- **Card Converted = unique converted leads/clients via the conversion pipeline-stage path** — distinct campaign leads with ≥1 call whose disposition maps to a `pipeline_stages` row with **`convert_to_client = true`** (the confirmed live field). **NEVER `COUNT(wins)`:** wins are policy-level production (a client may hold multiple policies) and belong in Reports — counting them would inflate Converted. Conversion survives lead deletion: `campaign_leads.lead_id` is `ON DELETE SET NULL` (the campaign_lead row remains in the campaign → stays in Total), and the converting `calls` row keeps `campaign_lead_id` + `disposition_id`. `clients` has **no `campaign_id`** and the conversion path does not set `clients.lead_id`, so there is **no reliable client→campaign fallback** — do not use one.
- **Wins/policies sold are a separate metric.** The RPC returns a forward-compat `policies_sold = COUNT(wins)` field for future Reports, **separately labeled and NOT rendered on the card** in this build. Reports (later) will show both unique Converted clients/leads AND policies sold (multiple policies per client = multiple wins).
- **Called source = `campaign_leads.call_attempts > 0`** (matches `sync_campaign_leads_called` + queue + `saveCall`). Skip does not increment attempts → not Called. No Answer after an actual call increments attempts → counts Called but not Contacted. **Total = `COUNT(campaign_leads)`** in the campaign — keeps terminal/DNC/converted rows that remain in the campaign.
- Calls are campaign-scoped via **`calls.campaign_lead_id → campaign_leads.campaign_id`** (identical coverage to `calls.campaign_id`; ties each call to its lead so the DISTINCT counts are per-lead). The Dialer campaign-select screen (`CampaignSelection.tsx`) shows contacts/state chips, not the 4-stat grid, and is unaffected (deferred to QA).

18. **A phone number's outbound role is controlled by `phone_numbers.assignment_type`, NOT by `assigned_to` alone and NOT by `is_direct_line` (Phone Assignment Pass 1, 2026-06-01; migration `20260601193140_add_phone_numbers_assignment_type.sql`, APPLIED to prod)** —
- **Definitions:** `agency` = shared outbound pool number (AI/local presence + dialer rotation). `personal` = user-owned number where **`assigned_to` is required** and which **cannot be the org default**. Column is `assignment_type text NOT NULL DEFAULT 'agency'` with three CHECKs: `IN ('agency','personal')`; `assignment_type <> 'personal' OR assigned_to IS NOT NULL`; `assignment_type <> 'personal' OR COALESCE(is_default,false)=false`.
- **`assigned_to` alone never implies Personal.** Existing rows with `assigned_to` (incl. the org default) backfilled to `agency` and stay shared. Never infer Personal from `assigned_to`.
- **`is_direct_line` is inbound caller-display only** — it must **never** be used for outbound eligibility. (It stays boolean NOT NULL; not dropped/mutated.)
- **Caller-ID enforcement (Phone Assignment Pass 2, 2026-06-01; frontend-only, no migration):**
  - **`assignment_type = 'agency'` is the ONLY automatic local-presence / dialer pool role.** The automatic pool (`TwilioContext.callerIdPool`, fed to `selectOutboundCallerId`) contains only active Agency numbers under daily cap. **`assignment_type = 'personal'` is NEVER automatic** — excluded from power-dialer rotation, campaign number rotation, AI/local presence, smart caller-ID, and fallback caller-ID.
  - **`assigned_to` is meaningful only for Personal ownership.** Agency numbers with `assigned_to` populated remain Agency and stay in the automatic pool (`assigned_to` is ignored for Agency).
  - **Manual selection:** any agent may manually select an active Agency number; a Personal number may be manually selected **only by its owner** (`assigned_to === auth.uid()`). No agent ever sees/uses another user's Personal number — From-Number dropdowns (`ConversationHistory`, `FloatingDialer`) filter via `filterManualCallerIdOptions(rows, userId)`.
  - **Stale manual overrides are cleared:** `getSmartCallerId` validates `selectedCallerNumber`/`voice_manual_caller_id` via `isManualCallerIdAllowed`; if no longer allowed it clears React state + `localStorage` and falls through to automatic Agency selection.
  - **Campaign number groups cannot override Personal ownership.** When a campaign has `number_group_id`, the automatic pool = eligible Agency numbers **from that group only**; Personal numbers in the group are never automatic. **If the group has no eligible Agency number (empty, all ineligible, or member-fetch error), the call is BLOCKED** with a clear toast — never a silent fallback to the full org pool, and `getSmartCallerId` passes `defaultFallback=""` so the org default cannot leak past the group.
  - **Final makeCall caller-ID validation is MANDATORY before inserting a `calls` row** and before `twilioMakeCall`: `caller_id_used` must be an org number this user may use (Agency, or own Personal; and — when a group is active — an Agency number must be in the group pool). On failure: no `calls` row is inserted, no Twilio call starts, `isDialingRef` is released, call state resets, and a toast shows *"No eligible outbound caller ID is available for this campaign. Check Phone Number settings."* This is the last guard against stale localStorage / stale UI / future UI bugs.
  - **`is_direct_line` is NOT read for outbound eligibility** (D1, Pass 2) — the automatic-pool fetch filters `assignment_type='agency'` and no longer filters `is_direct_line`. Inbound direct-line display/routing is unchanged. Helpers live in `src/lib/caller-id-selection.ts` (`isAgencyCallerIdEligible`, `isPersonalCallerIdOwnedByUser`, `isAutomaticCallerIdAllowed`, `isManualCallerIdAllowed`, `filterAutomaticCallerIdPool`, `filterManualCallerIdOptions`, `findAllowedCallerId`). Unknown/missing `assignment_type` is treated as `agency` (prod is `NOT NULL DEFAULT 'agency'`; only affects dev/test rows).
- **Number groups cannot override phone-number ownership/scope safety.** `number_groups` / `number_group_members` logic is unchanged.
- **Do not ship a live editable Agency/Personal Settings control yet** (Pass 3 / Chris approval). Settings UI shows a **read-only** Agency/Personal badge only (`NumberManagementSection.tsx`). Pause/cool-off is **deferred to Pass 3** — no pause/cooldown columns, UI, or jobs in Pass 1/2.

19. **`campaign_leads` queue advancement after a call goes through ONE canonical RPC, never a client-side UPDATE (Dialer Redial-Loop Fix, 2026-06-04; migration `20260604190000_advance_campaign_lead_rpc.sql`, APPLIED to prod)** —
- **Root cause it fixes:** a client `campaign_leads` UPDATE whose `WHERE`/`SET` references a column **also requires the row to pass the SELECT policy**. The Open Pool / Team **Agent** SELECT branch needs `get_user_role() = 'Agent'`, and **`get_user_role()` reads ONLY the JWT `app_metadata.role` claim with NO profiles fallback** (unlike `get_org_id()`, which falls back to `profiles`). A stale/missing role claim ⇒ pool lead invisible to SELECT ⇒ every dialer `campaign_leads` UPDATE silently affected **0 rows, no error**. That is why `call_attempts`/`last_called_at`/`retry_eligible_at`/callback/terminal-status never persisted and `get_next_queue_lead` re-served the same lead (redial loop). The `calls` INSERT and `dialer_lead_locks` writes were unaffected (INSERT needs no SELECT visibility; lock RPCs are SECURITY DEFINER).
- **Canonical path:** `public.advance_campaign_lead(p_campaign_lead_id, p_call_id, p_disposition_id, p_callback_due_at, p_callback_note, p_release_lock)` — `SECURITY DEFINER`, `search_path = public, pg_temp`, org-scoped via `get_org_id()` (with its profiles fallback), `FOR UPDATE`. Persists, **exactly once per call** (idempotent on `campaign_leads.last_advance_call_id` = the `calls.id`): `call_attempts +1`, `last_called_at = now()`, `retry_eligible_at = now() + retry interval` (retryable outcomes only), canonical `status` (`Called`; `Completed` at `max_attempts`/convert; `DNC`; `Removed`), callback fields (set for callback dispositions, cleared otherwise), and releases the agent's lock via `release_lead_lock` when `p_release_lock`. Disposition classification (retryable vs terminal/owned) is derived **server-side from `disposition_id`** so the auto No-Answer and manual Save paths can't diverge. **It NEVER writes `calls.duration` or any Twilio telemetry.** Cooperates with `trg_sync_campaign_leads_called` (one increment ⇒ `leads_called +1` once).
- **Frontend:** `advanceCampaignLead()` (`src/lib/dialer-api.ts`) wraps the RPC (throws on error — no swallow). DialerPage routes **all** advancement-after-call paths through `runAdvanceCampaignLead` (sets the `pendingAdvanceRef` re-dial guard): `handleAutoDispose` (ring-timeout No Answer — the primary auto path), `autoSaveNoAnswer` (manual No-Answer select), and `saveCallData` (Save Only `releaseLock:false` / Save & Next). Local React queue state is **derived from the persisted RPC row**, never an optimistic local-only increment. `saveCall` **no longer** writes `call_attempts`/`last_called_at` (removed). **Guard:** `handleCall` refuses to dial a lead whose advancement is still mid-persist (`pendingAdvanceRef`).
- **Do NOT** reintroduce a client-side `campaign_leads` UPDATE for call-advancement fields (attempts / last_called_at / retry_eligible_at / status / callback). The Personal-skip retry write and contact-edit denormalization are separate, non-advancement paths (Personal SELECT branch uses `user_id = auth.uid()`, not `get_user_role()`, so they are not subject to this trap).

---

## 5. Schema Gotchas

| Topic | Rule |
|-------|------|
| Lead ownership column | **`assigned_agent_id`** on `leads` / `clients` / `recruits` — **not** on `campaign_leads` |
| Role strings | Exact: **`'Team Leader'`** — not `'Team Lead'` in new SQL (legacy policies may accept both) |
| Phone on `calls` | `contact_phone` may be unnormalized — use phone utils |
| **Phone number outbound role** | `phone_numbers.assignment_type` (`'agency'` default / `'personal'`) is the canonical outbound-role field (invariant #18). `agency` = shared pool; `personal` = user-owned (requires `assigned_to`, cannot be `is_default`). **`assigned_to` alone ≠ Personal**; **`is_direct_line` = inbound display only, never outbound eligibility.** Pass 2 (live) enforces it in caller-ID selection: automatic pool = active Agency only; Personal excluded from all auto-selection; owner-only manual select; campaign-group empty → block (no org fallback); mandatory final `makeCall` validation before the `calls` insert. Helpers in `src/lib/caller-id-selection.ts`. |
| **Contacted** (trusted) | Call **> 45 seconds** OR the call's disposition has **`counts_as_contacted = true`** (P1 Build 3A, `report-utils.isContactedCallRow`). Disposition match prefers `calls.disposition_id` (UUID FK, persisted on new rows via `saveCall`) and falls back to lowercased `disposition_name` for legacy rows. **Never inferred from agency-specific disposition labels.** DNC remains a legacy fallback. |
| **Hard claim** (dialer) | Team/Open `claim_lead` ownership when: `calls.duration > 45` **OR** disposition `countsAsContacted` **OR** `callbackScheduler` — **excluding system `No Answer` AND DNC/`dncAutoAdd`** (DNC checked *before* `countsAsContacted`). Ordered short-circuit in `useHardClaim.shouldHardClaim`. Live-call auto-claim timer = **46_000ms** (just past the >45s line). DNC still saves call/disposition + adds to DNC + terminally excludes from queue + stays agent-attributable via `calls.*` — only the `claim_lead` call is skipped. Never direct-update `leads.assigned_agent_id` from the client (Queue Build 2, 2026-05-29). |
| **Local presence sticky** | Prior call **≥ 45 seconds** (`CALLER_ID_STICKY_MIN_DURATION_SEC`) |
| `campaign_leads` | Queue entity; locks reference `campaign_leads.id`. `status` CHECK allows: `Queued, Locked, Claimed, Called, Skipped, Completed, Failed, Removed, DNC` (`Removed`/`DNC` added 2026-05-28 for disposition lifecycle — Remove-from-Campaign + DNC). |
| **Dispositions canonical fields** | `campaign_action` (queue/campaign action) and `dnc_auto_add` (DNC auto-add) are canonical. `remove_from_queue` and `auto_add_to_dnc` are **deprecated** — kept for compat, not dropped. New code must not read or write the deprecated columns except explicit migration/backfill compatibility. |
| Schema notes (2026-05-17) | `tasks` and `campaigns.leads_called` live on prod (Track B). **`dialer_sessions`** is the server-timestamped session table (P1 Build 1, migration `20260529003210_*`); frontend lifecycle wired in Build 2 (`useDialerSession` + `supabase-dialer-sessions.ts` — start on campaign **Start** or first dial, 45s heartbeat, explicit end). **`dialer_daily_stats`** is legacy/display-only as of Build 3 — trusted daily/session totals now come from `getTrustedTodayDialerStats` (`calls` + `wins` + `dialer_sessions`); never read `dialer_daily_stats` for talk time, contacted count, session duration, billing, or manager reporting. **P1 Build 3B:** that helper is now **selected-campaign scoped** (`.eq("campaign_id", …)` on all three sources) and uses **user-local-day bounds** (`userLocalDayBounds(timeZone)`, browser IANA via `resolveUserTimeZone`) — not UTC. `wins` are campaign+org-linked from the Dialer Sold path (`convertLeadToClient` → `triggerWin`). |
| Lead sources denormalization | Lead sources are denormalized as text on `leads.lead_source`. Rename/reassign operations must update `leads` by string match scoped to `organization_id` (use `public.rename_lead_source` / `public.reassign_and_delete_lead_source` RPCs). Future normalization to `lead_source_id` is deferred. |
| `custom_fields` ownership | **System templates** = `organization_id IS NULL AND created_by IS NULL` (read-only forever; not insertable/updatable/deletable from the app). **Agency-wide** = `organization_id` set, `created_by IS NULL` (Admin / Super Admin only). **Personal** = both set (creator only). Team Leader and Agent can manage personal fields only. `organization_id` and `created_by` remain nullable on this table because of system templates. |
| Contact field layout resolution | User layout (`user_preferences.settings.contact_field_layout` per type) → agency default (`contact_management_settings.field_order_<type>`) → system default (`getDefaultFieldOrder` in `src/lib/contactFieldLayout.ts`). User layout overrides agency default; agency default applies to users who have not customized their own layout. Custom field IDs are stored as `custom:<name>`. |
| Required-field enforcement | Application/service-layer validation only. `contact_management_settings.required_fields_<type>` plus `custom_fields.required` are validated in frontend save paths (Add/Edit Lead/Client/Recruit, FullScreenContactView) and in `import-contacts` (core fields only). Business-required columns are **not** enforced via DB `NOT NULL`. |
| **Client policy columns** (Contacts Build 1, 2026-06-17) | Canonical: **`clients.premium`** (numeric), **`clients.face_amount`** (numeric), **`clients.issue_date`** / **`clients.effective_date`** (text `YYYY-MM-DD`, blank → `NULL`). **`clients.premium_amount` is deferred schema debt — never write it** (don't drop/rename/backfill it either). Manual Client CRUD (`supabase-clients.ts` `rowToClient`/`clientToRow`/`update`) must use the **same columns as `conversionSupabaseApi.convertLeadToClient`**. Display: missing/zero premium & face → blank/`—` (**never a fabricated `$0`**); missing issue/effective dates → blank (**never substitute `created_at`**). Blank optional values persist as `NULL`, not `0`. |
| **Contacts Last Disposition** (Contacts Build 1, 2026-06-17) | The Contacts/Leads "Last Disposition" derives from **`calls.disposition_id`** / trimmed **`calls.disposition_name`** of the newest *dispositioned* call (`deriveLastDisposition` in `supabase-contacts.ts`) — **NEVER `calls.status`** (that's telephony status). A call with neither disposition field is not a disposition. Filter matching normalizes (trim + lowercase, `normalizeDispositionValue`) so options align with stored values; legacy `disposition_name`-only rows still match. (Mirrors the trusted-Contacted prefer-id/fallback-name rule, invariant #13.) |
| **Manual contact ownership** (Contacts Build 1, 2026-06-17) | New Client/Recruit require an authenticated `user.id` **and** `organization_id` — **no `u1` fallback**; block the save with an error on missing context. `clientsSupabaseApi.create` / `recruitsSupabaseApi.create` throw without `organizationId`. Bulk assignment persists **before** clearing selection: Leads write `assigned_agent_id` **and** `user_id` (RLS sync); Clients/Recruits write `assigned_agent_id`. On failure keep the selection + prior ownership (no fake success). Assign targets limited to the viewer-authorized set; **select-all-leads disables Assign** (deferred to Build 2). `getById` on leads/clients/recruits uses `.maybeSingle()` and returns a not-found error — never map `null`. |
| **`calls.contact_type` is often NULL for lead calls** (Contacts Build 2, 2026-06-19) | The Dialer writers (`dialer-api.createCall`/`saveCall`) put the contact's id in **`calls.contact_id`** but persist **`contact_type` as `contact_type \|\| null`** — so most real lead calls have `contact_type = NULL` (and **`calls.lead_id` has no current writer** → 0 populated in prod). Any code linking calls→leads must use the **compatibility relation**: `c.lead_id = l.id OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))` — **never** a strict `contact_type = 'lead'` (matches 0 real rows) and **never** a PostgREST `!inner` embed-order for agent sorting (drops unassigned). The Contacts attempt-count + Last-Disposition RPCs (`_contacts_filtered_leads` / `search_contacts_leads`, migration `20260619180000`) use this. **Open follow-up:** normalize the call writers to consistently set `contact_type='lead'` (telephony change — needs its own review for telemetry/calling impact); after that the fallback may tighten to `= 'lead'`. |

---

## 6. Dialer Model

**Single-leg WebRTC only.**

1. `TwilioContext.makeCall()` → guards → insert `calls` row.
2. `twilioMakeCall()` → `device.connect({ params: { To, CallerId, CallRowId, OrgId } })`.
3. Webhooks update `calls`; inbound via `twilio-voice-inbound` + `inbound-call-claim`.

Do **not** reintroduce server REST outbound + SIP bridge (`dialer-start-call`) unless Chris explicitly requests it.

---

## 7. Component Standards

- React components **< 200 lines** — extract to `src/components/...`.
- **Exceptions (refactor scheduled):** `DialerPage.tsx` (~3,800 lines), `TwilioContext.tsx` (~2,150 lines). Do not add features inline — use `src/components/dialer/`.
- **Zod** on forms/modals.
- **Tailwind only** — no inline styles.

---

## 8. Workflow Protocol

1. **Read** `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md`.
2. **Plan** — Always create a detailed implementation plan artifact (`implementation_plan.md`) and wait for Chris's explicit approval before modifying files or executing backend commands.
3. **List** files to touch.
4. **Code** — surgical diffs.
5. **`npx tsc --noEmit`** before handoff.
6. **Update `WORK_LOG.md`** — append entry (newest first).
7. **Context snapshot** — decisions, migrations, deploys, blockers.

---

## 9. Doc Update Rule

Every task that ships code **must** append a `WORK_LOG.md` entry. If the task discovered a new invariant (JWT rule, schema trap, deploy quirk), update **`AGENT_RULES.md`** in the same commit.

---

## 10. Forbidden Patterns

- Mock/seed data in production paths (life-insurance-specific samples only when explicitly requested).
- `service_role` in client code.
- Hardcoded API keys.
- Ad-hoc SQL in production — use **`supabase/migrations/`**.
- New **Telnyx** references or SDK imports.
- Dropping/bypassing RLS without Chris **`#APPROVE_RLS_CHANGE`**.
- Replacing `dialer_lead_locks` SKIP LOCKED with two-step fetch/lock.
- Maintaining two divergent Team/Open claim RPCs — `get_next_queue_lead` is canonical; `fetch_and_lock_next_lead` stays a thin deprecated wrapper (invariant #15).

---

## 11. Tools & Resources

| Tool | Use |
|------|-----|
| **Supabase MCP** | `list_migrations`, `list_tables`, `list_edge_functions`, `execute_sql` (read-only audit), `apply_migration`, deploy |
| **Vercel MCP** | Deployments, env vars |
| **GitHub (`gh`)** | PRs, issues, CI |
| **Telephony** | Twilio Voice SDK, TwiML webhooks, Trust Hub, subaccounts in Vault |
| **Email** | Gmail OAuth Edge Functions + `contact_emails` |
| **Workflows** | `workflow-*` Edge Functions + `WORKFLOW_INTERNAL_SECRET` |

---

## Known Tech Debt (2026-05-16 audit; updated 2026-05-17)

- Split **`DialerPage.tsx`** into subcomponents.
- **Cron schedules for time-based workflows** — `pg_cron` extension enabled and `workflow_engine_config` secrets populated (verified 2026-05-17), but cron jobs for birthday / stale-lead / resume-paused workflows are not yet scheduled. Schedules exist as commented blocks in `supabase/migrations/20260514160000_workflow_builder_schema.sql`.
