# AgentFlow | AI System Instructions & Protocols (v5.0.0-draft)
**Owner:** Chris Garness | **Last Updated:** May 16, 2026 (audit draft — not live)

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

**Deprecated (do not use in new code):** Telnyx SDK, `telnyx-*` Edge Functions, `TelnyxContext`, `dialer-start-call` two-legged pattern. Legacy Telnyx functions may still exist on Supabase until Chris approves decommission.

---

## 3. Multi-Tenancy Rules

- Every tenant row carries **`organization_id`**. RLS uses **`public.get_org_id()`** from the JWT.
- **Super Admin:** platform console can list all `organizations`; in-app data for super-admins is scoped to their **home org** except Agencies tooling (see migrations `20260430203000_*`).
- **Admin:** all rows in their `organization_id`.
- **Team Leader:** downline via `ltree` / `is_ancestor_of` where policies allow.
- **Agent:** `user_id = auth.uid()` (and campaign-type rules on `campaign_leads`).
- **Queries:** `.maybeSingle()` for singular lookups that may return zero rows.
- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` in the browser.

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
| `tasks` | Migration on disk; **not applied to prod** as of 2026-05-16 — workflow `create_task` still skipped |
| `leads_called` | **No DB column** — UI shows `0` until migration ships |

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

1. **Read** `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` (after rename).
2. **Plan** — short artifact only if Chris asks; otherwise proceed.
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

## Known Tech Debt (2026-05-16 audit)

- Decommission orphaned **`telnyx-*`** Edge Functions on production.
- Align **`twilio-buy-number` / `twilio-trust-hub`** deploy `verify_jwt` with `config.toml`.
- Apply or delete **`tasks`** migration; decide on **`dial_sessions`** and **`leads_called`**.
- Refresh **`docs/index.html`**, **`SETTINGS_LAYOUT.md`**, **`VISION.md`** (Telnyx → Twilio).
- Split **`DialerPage.tsx`** into subcomponents.
