# AgentFlow | AI System Instructions & Protocols (v4.0.0)
**Owner:** Chris Garness | **Last Updated:** April 28, 2026

---

## 🛑 THE GOLDEN RULES FOR AI AGENTS
I am a core software engineer at AgentFlow. I must adhere to these absolute rules:

1.  **Read Before Building**: Always read `AGENT_RULES.md`, `VISION.md`, and `ROADMAP.md` at the start of every session.
2.  **Audit Compliance**: New additions must align with the **April 2026 Software Audit (Step 1 & 2)**. Specifically:
    *   Treat `organizations` as the mandatory multi-tenancy root.
    *   Enforce `user_id` as the primary lead ownership field (Standardized April 4, 2026).
3.  **No Ghost Plans**: I am strictly forbidden from creating `implementation_plan` artifacts unless the user explicitly asks for one. I must prioritize concise **Audit Reports** via regular artifacts first.
4.  **Supabase First**: Never use mock data. Use live tables. Never execute SQL directly; always generate a `supabase/migrations/` file.
5.  **Concise Orchestration**: Chris is non-technical. Use plain language. Focus on results, not technical jargon.
6.  **GitHub Synchronicity**: Approval of a task implies immediate authorization to stage, commit, and push to `origin main`.

---

## 🏗️ CORE ARCHITECTURE DIRECTIVES

### 1. Multi-Tenant Mastery (RLS)
Security is enforced at the database layer. No data bleed.
*   **Admins**: Access all records in their `organization_id`.
*   **Managers**: Access internal records + downline via `ltree` hierarchy.
*   **Agents**: Access only `user_id = auth.uid()`.

### 2. SaaS & Billing Readiness
Every architectural decision must support SaaS graduation:
*   **Billing**: Integration via Stripe SDK (Edge Functions only).
*   **Limits**: Plan-based enforcement (Starter/Pro/Agency) for User, Contact, and Lead caps.
*   **Organizations**: Centralized management of agency metadata and subscription status.

### 3. Database Null-Safety & Standards
*   **Selects**: Always use `.maybeSingle()` for singular lookups. Implement fallback UIs.
*   **Ownership**: Leads must always have a valid `user_id` and `organization_id`.
*   **Standardization**: Follow the `20260404000000_standardize_leads_user_id.sql` pattern for all future contact-based tables.

### 4. Telephony — Twilio Voice.js / WebRTC (Audited April 28, 2026)

#### Stack
*   **SDK**: `@twilio/voice-sdk` — `Device` class only. Import from `src/lib/twilio-voice.ts`. No Telnyx SDK exists in this codebase.
*   **Dialer model**: **Single-leg WebRTC outbound** only. Calls are placed from the browser via `device.connect()` (`twilioMakeCall`). Do NOT reintroduce two-legged flows (server REST dial + SIP bridge/transfer) unless Chris explicitly requests it.
*   **Inbound**: PSTN → Twilio → `twilio-voice-inbound` TwiML → registered WebRTC `Device` in browser.
*   **Audit Behavior**: Current system is a **1-line sequential dialer**. Do not attempt multi-line or predictive logic without specific instruction.

#### How a Call Starts (do not bypass this sequence)
1. `makeCall()` in `src/contexts/TwilioContext.tsx` runs all pre-call guards (see below).
2. Inserts a `calls` row (`status: 'ringing'`) into Supabase before the SDK fires.
3. Calls `twilioMakeCall({ to, callerId, callRowId, orgId })` → `device.connect()`.
4. `wireTwilioCall()` registers event handlers (`ringing`, `accept`, `disconnect`, `cancel`, `reject`, `error`).
5. On `accept`: starts call timer, attaches remote audio, optionally starts browser-side recording (gated on `phone_settings.recording_enabled`).

#### Security
*   **Zero-Exposure**: Twilio Account SID, Auth Token, API keys, and App SIDs must reside in **Supabase Vault** or Edge Secrets — never in client-side code or `.env` files committed to the repo.
*   **WebRTC Guard**: `initializeClient()` is gated behind a valid Supabase Auth session and a non-null `organization_id` on the profile. `makeCall()` additionally verifies the JWT `organization_id` claim before dialing.
*   **JWT algorithm**: Supabase issues ES256 access tokens. The Functions gateway rejects ES256 with `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM` when `verify_jwt = true`. All Twilio Edge Functions use `verify_jwt = false` and validate the Bearer JWT in Deno via `createClient(url, ANON_KEY).auth.getUser(jwt)`, then use service role for DB writes.

#### Twilio Edge Functions (all in `supabase/functions/`)
| Function | Auth | Purpose |
| :--- | :--- | :--- |
| `twilio-token` | Supabase JWT (in-code) | Generates Twilio capability token for WebRTC `Device` registration |
| `twilio-voice-webhook` | X-Twilio-Signature HMAC | Outbound TwiML — `<Dial answerOnBridge="true">` with action/status callbacks |
| `twilio-voice-inbound` | X-Twilio-Signature HMAC | Inbound PSTN TwiML — routes call to registered browser client |
| `twilio-voice-status` | X-Twilio-Signature HMAC | Twilio status callback — updates `calls` row (duration, status, SHAKEN/STIR) |
| `twilio-recording-status` | X-Twilio-Signature HMAC | Downloads Twilio recording → uploads to `call-recordings` Storage → clears Twilio copy |
| `twilio-reputation-check` | Supabase JWT (in-code) | Voice Insights v2 reputation pipeline; updates `phone_numbers` spam/carrier fields |
| `twilio-search-numbers` | Supabase JWT (in-code) | Searches Twilio for available numbers to purchase |
| `twilio-buy-number` | Supabase JWT (in-code) | Purchases a Twilio number and inserts into `phone_numbers` |
| `twilio-sms` | Supabase JWT (in-code) | Sends outbound SMS via Twilio; reads credentials from `phone_settings` |
| `twilio-trust-hub` | Supabase JWT (in-code) | SHAKEN/STIR Trust Hub registration/assignment (Admin/Super Admin only) |
| `inbound-call-claim` | Supabase JWT (in-code) | Claims an inbound `calls` row for the answering agent using service role; retried up to 18× from client |
| `recording-retention-purge` | `x-cron-secret` header | Nightly pg_cron job — deletes Storage recordings and clears `calls` fields per org `recording_retention_days` |

All four webhook functions (`twilio-voice-webhook`, `twilio-voice-status`, `twilio-voice-inbound`, `twilio-recording-status`) derive callback URLs and signature base URL from `SUPABASE_URL` — never from `X-Forwarded-Host`. Do not change this without updating all four simultaneously and redeploying.

#### Key Re-Entrancy Guards (never remove or bypass)
All guards live in `src/contexts/TwilioContext.tsx` as `useRef` values:

| Ref | Blocks |
| :--- | :--- |
| `isDialingRef` | Concurrent `makeCall()` invocations; released when `callState` → `idle` or `ended` |
| `twilioVoiceReadyRef` | Any `makeCall()` when the Twilio `Device` has not fired `registered`; this is the authoritative readiness gate |
| `initializeInFlightRef` | Overlapping `initializeClient()` runs |
| `twilioVoiceOrgIdRef` | Redundant Device re-initialization when org hasn't changed |
| `endStateProcessedRef` | Double-processing of call-end across `hangUp()`, Device `error`, and per-call event handlers |
| `callLogSentRef` | Duplicate `call_logs` inserts for the same `calls.id` |
| `callIdsDbSyncedRef` | Duplicate DB syncs of CallSID to `calls.twilio_call_sid` |
| `recordingStartedRef` | Duplicate browser-side recording starts per call |
| `outboundRemoteAnsweredRef` | Ring-timeout watchdog firing hangup after PSTN is already answered (set only on Voice.js `accept`) |
| `hangUpRef` | Stable ref to `hangUp()` for the ring-timeout interval — prevents the watchdog from resetting via dep change |

Do not refactor these refs away or consolidate them without a full audit of the call lifecycle.

#### Known Telnyx Artifacts (do not delete; flag for future cleanup)
The April 2026 Twilio migration removed `TelnyxContext.tsx`, the `telnyx_settings` table, and renamed `telnyx_call_control_id`/`telnyx_call_id`/`telnyx_error_code` columns on `calls`. The following residual references remain and are known:

1.  **Migrations `20260413230000` and `20260413240000`** — define `peek_inbound_call_identity` with parameters named `p_telnyx_session_id` / `p_telnyx_call_control_id` and column refs `telnyx_call_id` / `telnyx_call_control_id`. These migrations predate the column rename (`20260418170001`). The live RPC (called from `TwilioContext.tsx` with `p_provider_session_id` / `p_twilio_call_sid`) was updated by a later migration. The old migration files are historical record only — do not re-run them.
2.  **`ROADMAP.md` Phase 4 item 3** — says "live telnyx connects"; should read "live Twilio connects." Update when editing that section.
3.  **`src/lib/incomingCallAlerts.ts:150`** — comment says "Legacy Telnyx-era hook." Harmless; update opportunistically.

If you encounter any other `telnyx_` column names, `TelnyxContext` imports, or Telnyx SDK usage in live code (not migration history), treat it as a critical bug and flag immediately.

---

## 🛠️ THE TECH STACK & TOOLS

| Tool | Role |
| :--- | :--- |
| **Primary Engineering Agent** | UI/UX, Component Refactoring, Frontend Logic (Tailwind + Shadcn). |
| **Advanced Architectural Agent** | Supabase Migrations, Edge Functions, Core Telephony, and RLS lockdown. |
| **Orchestrator** | Documentation, Audit Reports, Roadmap tracking, and PR reviews. |

---

## 📦 COMPONENT STANDARDS
*   **Size Limit**: React components must be **<200 lines**. Proactively refactor massive files into single-responsibility sub-components in `src/components/ui/` or domain folders.
*   **Exception on record**: `src/pages/DialerPage.tsx` is currently >3,000 lines. This is a known `[TODO HIGH PRIORITY]` technical debt item. Do not add further complexity to it; route new dialer features into `src/components/dialer/` sub-components.
*   **Validation**: Use **Zod** for all form/modal entry points. Reject invalid numeric or phone formats at the frontend layer.
*   **Styling**: Strictly use Tailwind CSS. Custom inline styles or foreign CSS frameworks are forbidden.

---

## 📝 LIVING DOCUMENTATION PROTOCOL
1.  **Check-In**: Read `ROADMAP.md` and most recent Git logs.
2.  **The Work**: Execute tasks using surgical code edits.
3.  **Check-Out**: Update `ROADMAP.md` with:
    *   Date & Status ([DONE]/[IN PROGRESS]).
    *   New Environment Variables or Migrations created.
    *   Developer Note on architectural impact.

---

## 🚀 THE NORTH STAR
> "Life insurance agents deserve enterprise velocity without the complexity of legacy tools. We build for 300+ dials a day and 100% telemetry accuracy."
