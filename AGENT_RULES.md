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
3. **Atomic queue claiming** — `SELECT … FOR UPDATE SKIP LOCKED` in `get_next_queue_lead` / `fetch_and_lock_next_lead`. Never fetch-then-lock in application code.
4. **Edge deploys** — Always `get_edge_function` (MCP) before deploy; ship full `index.ts` body.
5. **Migrations** — File on disk ≠ applied. Confirm with **`list_migrations`** (MCP) before assuming schema.
6. **Feature before permissions** — Ship working UI/data path, then tighten RLS/PermissionGate.
7. **Twilio webhook URLs** — Derive from **`SUPABASE_URL`** in all five voice/recording webhook functions; change all together.
8. **Re-entrancy guards in `TwilioContext.tsx`** — Do not remove:

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

---

## 5. Schema Gotchas

| Topic | Rule |
|-------|------|
| Lead ownership column | **`assigned_agent_id`** on `leads` / `clients` / `recruits` — **not** on `campaign_leads` |
| Role strings | Exact: **`'Team Leader'`** — not `'Team Lead'` in new SQL (legacy policies may accept both) |
| Phone on `calls` | `contact_phone` may be unnormalized — use phone utils |
| **Contacted** (reports) | Call **> 45 seconds** OR DNC disposition (`report-utils.ts`) |
| **Hard claim** (dialer) | **≥ 30 seconds** connected on Team/Open (`useHardClaim`) |
| **Local presence sticky** | Prior call **≥ 45 seconds** (`CALLER_ID_STICKY_MIN_DURATION_SEC`) |
| `campaign_leads` | Queue entity; locks reference `campaign_leads.id` |
| **Dispositions canonical fields** | `campaign_action` (queue/campaign action) and `dnc_auto_add` (DNC auto-add) are canonical. `remove_from_queue` and `auto_add_to_dnc` are **deprecated** — kept for compat, not dropped. New code must not read or write the deprecated columns except explicit migration/backfill compatibility. |
| Schema notes (2026-05-17) | `tasks` and `campaigns.leads_called` live on prod (Track B). `dial_sessions` intentionally not built — agent productivity in `dialer_daily_stats` (daily totals) and in-memory `sessionStats` (current session). Revisit for agency-owner reporting. |
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
