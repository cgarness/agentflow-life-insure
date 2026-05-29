# AgentFlow | AI System Instructions & Protocols (v5.0.0)
**Owner:** Chris Garness | **Last Updated:** May 17, 2026

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
- Control Center records live under the `control_center_*` namespace (`control_center_features`, `control_center_issues`, `control_center_health_checks`, `control_center_health_check_runs`). `organization_id` is nullable on these tables; v1 records are platform-global (org-null).
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

15. **Team/Open queue lock canon (Queue Build 1, 2026-05-29; migration `20260529211013_queue_lock_rpc_foundation.sql`)** —
- **Production lock schema is canonical:** `dialer_lead_locks(campaign_lead_id, locked_by, campaign_id, organization_id, expires_at)`, UNIQUE on `campaign_lead_id`. Never reintroduce `lead_id`/`agent_id` lock columns, and never reference `campaign_leads.assigned_agent_id` (it does not exist — lead ownership lives on `leads.assigned_agent_id`).
- **`public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb)` is the ONE canonical Team/Open claim RPC** (the live `useLeadLock.getNextLead` path). `SECURITY DEFINER`, `search_path = public, pg_temp`, org via `get_org_id()`, `FOR UPDATE SKIP LOCKED`, cleans expired locks first; waterfall order = owned callbacks (due ≤ now+5min) → new (0 attempts) → retries; excludes terminal statuses (`DNC`/`Completed`/`Removed`/`Failed`), max-attempts-reached, not-yet-retry-eligible, other-agent active locks, and the current agent's active suppressions; ownership guards keep another agent's callback (`callback_agent_id`) or hard-claimed lead (`leads.assigned_agent_id`) from surfacing.
- **`fetch_and_lock_next_lead` is a DEPRECATED wrapper** that calls `get_next_queue_lead`. Do **not** maintain two divergent claim implementations or restore its old 90s-TTL / `created_at`-only body.
- **Team/Open locks use a 5-minute TTL.** The heartbeat target is **`renew_lead_lock(p_campaign_lead_id uuid) → boolean`** (renews only the caller's own lock in the current org; `false` = lock lost).
- **Skip is per-agent suppression** via **`campaign_lead_agent_suppressions`** (RLS on, own-row writes) — never a global queue removal. The canonical claim RPC excludes the current agent's active (`suppressed_until > now()`) suppressions.
- **Personal campaigns remain no-lock / private** — direct `campaign_leads` query, `lockMode = false`, no `dialer_lead_locks` row.
- Retry interval canonical field is **`campaigns.retry_interval_minutes`** (`retry_interval_hours` is deprecated compat). Campaign calling window is **`campaigns.calling_hours_start`/`calling_hours_end`, default 08:00–21:00**; lead-local enforcement is deferred (no lead timezone column yet).
- **Frontend release/heartbeat/skip wiring remains Build 2:** `useLeadLock` still passes `p_lead_id` to `release_lead_lock`/`renew_lead_lock` (correct value, wrong arg name → per-lead release + heartbeat are no-ops until renamed); skip→suppression write path, Save Only/Save & Next lock lifecycle, and hard-claim ≥30s are all Build 2. Safe today: 0 Team/Open campaigns in production.

---

## 5. Schema Gotchas

| Topic | Rule |
|-------|------|
| Lead ownership column | **`assigned_agent_id`** on `leads` / `clients` / `recruits` — **not** on `campaign_leads` |
| Role strings | Exact: **`'Team Leader'`** — not `'Team Lead'` in new SQL (legacy policies may accept both) |
| Phone on `calls` | `contact_phone` may be unnormalized — use phone utils |
| **Contacted** (trusted) | Call **> 45 seconds** OR the call's disposition has **`counts_as_contacted = true`** (P1 Build 3A, `report-utils.isContactedCallRow`). Disposition match prefers `calls.disposition_id` (UUID FK, persisted on new rows via `saveCall`) and falls back to lowercased `disposition_name` for legacy rows. **Never inferred from agency-specific disposition labels.** DNC remains a legacy fallback. |
| **Hard claim** (dialer) | **≥ 30 seconds** connected on Team/Open (`useHardClaim`) |
| **Local presence sticky** | Prior call **≥ 45 seconds** (`CALLER_ID_STICKY_MIN_DURATION_SEC`) |
| `campaign_leads` | Queue entity; locks reference `campaign_leads.id`. `status` CHECK allows: `Queued, Locked, Claimed, Called, Skipped, Completed, Failed, Removed, DNC` (`Removed`/`DNC` added 2026-05-28 for disposition lifecycle — Remove-from-Campaign + DNC). |
| **Dispositions canonical fields** | `campaign_action` (queue/campaign action) and `dnc_auto_add` (DNC auto-add) are canonical. `remove_from_queue` and `auto_add_to_dnc` are **deprecated** — kept for compat, not dropped. New code must not read or write the deprecated columns except explicit migration/backfill compatibility. |
| Schema notes (2026-05-17) | `tasks` and `campaigns.leads_called` live on prod (Track B). **`dialer_sessions`** is the server-timestamped session table (P1 Build 1, migration `20260529003210_*`); frontend lifecycle wired in Build 2 (`useDialerSession` + `supabase-dialer-sessions.ts` — start on campaign **Start** or first dial, 45s heartbeat, explicit end). **`dialer_daily_stats`** is legacy/display-only as of Build 3 — trusted daily/session totals now come from `getTrustedTodayDialerStats` (`calls` + `wins` + `dialer_sessions`); never read `dialer_daily_stats` for talk time, contacted count, session duration, billing, or manager reporting. **P1 Build 3B:** that helper is now **selected-campaign scoped** (`.eq("campaign_id", …)` on all three sources) and uses **user-local-day bounds** (`userLocalDayBounds(timeZone)`, browser IANA via `resolveUserTimeZone`) — not UTC. `wins` are campaign+org-linked from the Dialer Sold path (`convertLeadToClient` → `triggerWin`). |
| Lead sources denormalization | Lead sources are denormalized as text on `leads.lead_source`. Rename/reassign operations must update `leads` by string match scoped to `organization_id` (use `public.rename_lead_source` / `public.reassign_and_delete_lead_source` RPCs). Future normalization to `lead_source_id` is deferred. |
| `custom_fields` ownership | **System templates** = `organization_id IS NULL AND created_by IS NULL` (read-only forever; not insertable/updatable/deletable from the app). **Agency-wide** = `organization_id` set, `created_by IS NULL` (Admin / Super Admin only). **Personal** = both set (creator only). Team Leader and Agent can manage personal fields only. `organization_id` and `created_by` remain nullable on this table because of system templates. |
| Contact field layout resolution | User layout (`user_preferences.settings.contact_field_layout` per type) → agency default (`contact_management_settings.field_order_<type>`) → system default (`getDefaultFieldOrder` in `src/lib/contactFieldLayout.ts`). User layout overrides agency default; agency default applies to users who have not customized their own layout. Custom field IDs are stored as `custom:<name>`. |
| Required-field enforcement | Application/service-layer validation only. `contact_management_settings.required_fields_<type>` plus `custom_fields.required` are validated in frontend save paths (Add/Edit Lead/Client/Recruit, FullScreenContactView) and in `import-contacts` (core fields only). Business-required columns are **not** enforced via DB `NOT NULL`. |

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
