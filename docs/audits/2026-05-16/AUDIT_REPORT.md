# AgentFlow Full System Audit — 2026-05-16

## Executive Summary

AgentFlow’s **live stack is Twilio Voice.js single-leg WebRTC** in the browser (`device.connect()` via `TwilioContext` / `twilio-voice.ts`), but **VISION.md**, **`docs/index.html`**, **`docs/SETTINGS_LAYOUT.md`**, and parts of **ROADMAP.md Section 1 & 4** still describe **Telnyx**. **AGENT_RULES.md v4.0.0 (April 28, 2026)** is largely accurate on telephony and is the best governing doc today.

**Supabase production** (`jncvvsvckxhqgqvkppmj`) still hosts **15+ legacy `telnyx-*` Edge Functions** plus **`dialer-start-call` / `dialer-hangup`** even though repo `supabase/functions/` has **zero Telnyx folders** and ROADMAP Phase 13 claims they were removed. **`organizations` exists (5 rows)**; ROADMAP’s “missing organizations” claim is **stale**. **`tasks`**, **`dial_sessions`**, and **`campaigns.leads_called`** are **still absent** on production despite disk migrations for `tasks` and UI TODOs for `leads_called`.

**Highest risks:** (1) doc-driven agents reintroducing Telnyx or two-legged dial paths; (2) orphaned Telnyx Edge Functions accepting traffic; (3) migration filename vs remote version drift causing “applied locally / not on prod” confusion; (4) **`DialerPage.tsx` at 3,806 lines** and **`TwilioContext.tsx` at 2,149 lines** violating component-size rules.

---

## 1. Telephony Provider

### Doc claims

| Source | Claim |
|--------|--------|
| `AGENT_RULES.md` | Twilio `@twilio/voice-sdk`, single-leg `device.connect()`, no Telnyx SDK |
| `VISION.md` L25, L48–49 | “single-leg **Telnyx** WebRTC dialer”; “**Telnyx WebRTC**” backbone |
| `ROADMAP.md` §1 Power Dialer | Twilio Voice.js (accurate) |
| `ROADMAP.md` §4 item 3 | “live **telnyx** connects” (stale) |
| `docs/index.html` | Telnyx tables, `telnyx-token`, `telnyx-webhook`, sequence diagram |
| `docs/SETTINGS_LAYOUT.md` | Telnyx API fields, transcription via Telnyx |

### Reality (code + Supabase)

**Active frontend:** `src/contexts/TwilioContext.tsx`, `src/lib/twilio-voice.ts` (`@twilio/voice-sdk`). **No** `TelnyxContext.tsx` on disk.

**`supabase/functions/` on disk:** Twilio family (`twilio-token`, `twilio-voice-*`, `twilio-sms*`, provisioning, agency groups, email, workflows). **No `telnyx-*` directories.**

**Production Edge Functions (still ACTIVE with `telnyx` slug):**  
`telnyx-token` (v522), `telnyx-webhook` (v382), `telnyx-sync-numbers`, `telnyx-buy-number`, `telnyx-search-numbers`, `telnyx-sms`, `telnyx-check-connection`, `telnyx-amd-start`, plus legacy **`dialer-start-call`**, **`dialer-hangup`**, **`recording-proxy`**, **`start-call-recording`**.

**Production Twilio functions (ACTIVE):** `twilio-token` (v16; ROADMAP cites v15 post-hotfix), `twilio-voice-webhook`, `twilio-voice-inbound`, `twilio-voice-status`, `twilio-recording-status`, `twilio-sms`, `twilio-sms-webhook`, `update-sms-urls` (v8), `inbound-call-claim`, `import-contacts`, agency-group quartet, Gmail/Calendar suite, workflow quartet, etc.

### Report

| Layer | Live provider | Stale provider artifacts |
|-------|---------------|---------------------------|
| Browser dialer | **Twilio** | 1 comment in `incomingCallAlerts.ts` |
| Edge (deployed) | **Twilio + orphaned Telnyx** | Telnyx functions not in repo |
| Governing docs | Mixed | **VISION**, **docs/**, ROADMAP §4 |

**Conclusion:** Twilio is the **operational** outbound/inbound WebRTC path. Telnyx remains as **deployed legacy** and **documentation debt**, not as active frontend code.

---

## 2. Dialer Model

### Doc claims

- `AGENT_RULES.md`: single-leg WebRTC only; forbid two-legged REST + SIP bridge unless requested.
- `ROADMAP.md` (2026-04-09 entries): documents switch **from** two-legged Telnyx **to** single-leg.
- `VISION.md`: still says Telnyx single-leg (provider name wrong, model right).

### Reality

```170:189:agentflow-life-insure/src/lib/twilio-voice.ts
export async function twilioMakeCall(params: {
  to: string;
  callerId: string;
  callRowId: string;
  orgId: string;
}): Promise<Call> {
  const device = twilioDevice;
  if (!device || device.state !== Device.State.Registered) {
    throw new Error("[twilio-voice] device is not registered — call initTwilioDevice() first");
  }

  const call = await device.connect({
    params: {
      To: params.to,
      CallerId: params.callerId,
      CallRowId: params.callRowId,
      OrgId: params.orgId,
    },
  });
  return call;
}
```

`TwilioContext.makeCall` inserts a `calls` row then calls `twilioMakeCall` — **not** `dialer-start-call` Edge Function from the live path.

**Stale references:** `docs/DIALER_DIAGNOSTIC_REPORT.md` describes two-legged Telnyx; `docs/CAMPAIGN_AND_DIALER_ARCHITECTURE.md` references `telnyxStatus` / `telnyxCallState`.

**Conclusion:** **Single-leg WebRTC via Twilio `Device.connect()`** is confirmed. Do not reintroduce `dialer-start-call` two-legged pattern without explicit product approval.

---

## 3. Database Schema — Gap & Presence Reconciliation

Queries run against production `jncvvsvckxhqgqvkppmj` on 2026-05-16.

| Object | ROADMAP / old audit claim | Production | Row count |
|--------|---------------------------|------------|-----------|
| `organizations` | Missing | **Present** | **5** |
| `tasks` | Missing | **Absent** | — |
| `dial_sessions` | Missing | **Absent** | — |
| `campaigns.leads_called` | Missing | **Absent** (UI uses `?? 0`) | — |
| `agency_groups` | Undocumented → built May 14 | **Present** | **0** |
| `agency_group_members` | — | **Present** | **0** |
| `agency_group_resources` | — | **Present** | **0** |
| `contact_emails` | Two-way email | **Present** | **0** |
| `messages` | Conversations | **Present** | **0** |
| `profiles.billing_type` | Agency Groups groundwork | **Present** | (column exists) |
| `profiles.is_super_admin` | Super Admin | **Present** | (column exists) |

**Note:** `supabase/migrations/20260505221000_create_tasks_table.sql` exists on disk but **`tasks` is not on production** — migration not applied (or applied under different version name not present in remote list).

**Conclusion:** Update ROADMAP “missing organizations” to **resolved**. Keep `tasks`, `dial_sessions`, `leads_called` as **real gaps** or explicit deferrals.

---

## 4. Edge Functions Inventory

Project: **`jncvvsvckxhqgqvkppmj`**. Below: slug | remote version | `verify_jwt` (remote MCP) | in `config.toml` |

### Twilio / dialer (expected — live)

| Function | Ver | verify_jwt (deployed) | config.toml |
|----------|-----|----------------------|-------------|
| `twilio-token` | 16 | false | (default false) |
| `twilio-voice-webhook` | 17 | false | false |
| `twilio-voice-inbound` | 17 | false | false |
| `twilio-voice-status` | 19 | false | false |
| `twilio-recording-status` | 15 | false | false |
| `twilio-sms` | 15 | false | false |
| `twilio-sms-webhook` | 3 | false | false |
| `twilio-search-numbers` | 16 | false | false |
| `twilio-buy-number` | 20 | **true** | false |
| `twilio-trust-hub` | 16 | **true** | false |
| `twilio-reputation-check` | 19 | false | false |
| `inbound-call-claim` | 19 | false | false |
| `update-sms-urls` | 8 | false | false |
| `import-contacts` | 22 | false | false |
| `provision-twilio-subaccount` | 3 | false | false |
| `retry-twilio-provisioning` | 2 | false | false |
| `recording-retention-purge` | 11 | false | false |

**Drift:** `twilio-buy-number` and `twilio-trust-hub` deployed with **`verify_jwt: true`** while `config.toml` documents **`false`** (ES256 pattern). Redeploy with `--no-verify-jwt` to match repo intent.

### Agency Groups (expected — live)

| Function | Ver | verify_jwt |
|----------|-----|------------|
| `invite-to-agency-group` | 2 | false |
| `accept-agency-group-invite` | 3 | false |
| `leave-agency-group` | 2 | false |
| `remove-from-agency-group` | 2 | false |

### Gmail / Calendar (expected — live)

`google-oauth-start`, `google-oauth-callback`, `google-calendar-*` (7 functions), all **ACTIVE**, `verify_jwt: false`.

### Email module (expected — live)

`email-connect-start`, `email-connect-callback`, `email-disconnect`, `email-send-contact-message`, `email-sync-incremental` (v11).

### Workflow builder (undocumented in AGENT_RULES — live)

`workflow-trigger-evaluator`, `workflow-executor`, `workflow-resume-paused`, `workflow-time-based-trigger`, `a2p-diagnostic`.

### Legacy Telnyx (doc says removed — still deployed)

`telnyx-token`, `telnyx-webhook`, `telnyx-sync-numbers`, `telnyx-buy-number`, `telnyx-search-numbers`, `telnyx-sms`, `telnyx-check-connection`, `telnyx-amd-start`, plus **`dialer-start-call`**, **`dialer-hangup`**, **`recording-proxy`**, **`start-call-recording`**.

### Doc-referenced but absent / renamed

- None critical for Twilio path; Telnyx names should be treated as **deprecated endpoints**.

### Live but thinly documented

- `create-organization`, `create-user`, `invite-user`, `accept-invite` (**verify_jwt: true** on `accept-invite`)
- `daily-briefing`, `daily-tip`, `send-welcome-email`, `send-invite-email`
- `debug-reputation`, `test-spam-check`, `daily-call-limit-reset`

---

## 5. Migration History Since ROADMAP Last Updated (2026-05-16)

ROADMAP **Last Updated: May 16, 2026**. Remote migration tail (applied):

| Version | Name | One-line summary |
|---------|------|------------------|
| `20260517003617` | `fix_lead_workflow_trigger_source_column` | Fixes `workflow_on_lead_created` using `lead_source` not `source` |
| `20260517011220` | `campaign_selection_realtime` | Realtime publication for campaign picker |
| `20260517031806` | `leaderboard_wins_realtime` | Enables realtime on `wins` |
| `20260517031828` | `agency_group_leaderboard_today_and_peer_read` | Group leaderboard `today` period + peer-read RLS |
| `20260517033209` | `normalize_company_settings_timezone` | IANA timezone guard on `company_settings` |

**On disk, not in remote history (representative — same logical change often applied under different timestamp):**

- `20260517140000_normalize_company_settings_timezone.sql` — likely duplicate of `20260517033209` (ROADMAP notes applied under different name)
- `20260516150000` / `20260516150100` — leaderboard files on disk vs `20260517031806` / `20260517031828` on remote
- `20260505221000_create_tasks_table.sql` — **tasks table not present on prod**

**Filename vs version drift:** Many repo migrations use human-readable timestamps while Supabase records MCP/CLI apply timestamps (e.g. `20260514170610` remote vs `20260514120000` on disk). **Always confirm with `list_migrations`, never filename alone.**

---

## 6. Feature Status Matrix

| Feature | Doc claim | Actual state | Delta |
|---------|-----------|--------------|-------|
| **Power Dialer & Telephony** | Twilio 1-line WebRTC; inbound via TwiML | Twilio live; Telnyx EF orphaned | Decommission Telnyx EF; fix docs |
| **Auth & Tenant Isolation** | `is_super_admin`, JWT claims, RLS | Column + RPC `is_super_admin()` + JWT in `AuthContext`; role strings **Team Leader** in UI | Accurate; avoid “Team Lead” in new SQL |
| **Campaigns** | Hard claim, Personal/Team/Open | Migrations + `useHardClaim` (30s), queue locks, RPCs live | “Contacted” in reports = **45s** (not 30s) |
| **Agency Groups** | 5-prompt feature | Schema + 4 EF + Settings UI + leaderboard integration | **0 groups** in prod data |
| **Two-Way Email** | Gmail OAuth, `contact_emails` | 5 email EF ACTIVE; table empty | Feature built, low usage |
| **Conversations** | Placeholder (Apr 6) vs built | Full page: SMS via Twilio + email via API | **Built** — update VISION/ROADMAP |
| **AI Agents** | Coming Soon (Apr 6) | `AIAgentsPage` uses **MOCK_AGENTS** only | **Placeholder UI** |
| **Inbound SMS** | Live | `twilio-sms-webhook` v3, `update-sms-urls` v8 | Live; confirm numbers patched in Twilio console |
| **Billing / Stripe** | Deferred | **No Stripe** in `src` or migrations grep | Confirmed absent |

---

## 7. Stale References & Tech Debt

### Telnyx in `.ts` / `.tsx` (live code)

| Path | Line | Snippet |
|------|------|---------|
| `src/lib/incomingCallAlerts.ts` | 150 | Comment: "Legacy Telnyx-era hook" |

### Telnyx in `.sql` (migrations — historical)

20 migration files retain `telnyx` in names or column rename comments (expected archive).

### Telnyx in `.md` (should be updated)

`VISION.md`, `docs/index.html`, `docs/SETTINGS_LAYOUT.md`, `docs/DIALER_DIAGNOSTIC_REPORT.md`, `docs/CAMPAIGN_AND_DIALER_ARCHITECTURE.md`, `TELNYX_AUDIT.md`, large sections of `ROADMAP.md` (pre-2026-04-18 work log entries).

### Component size

| File | Lines |
|------|-------|
| `src/pages/DialerPage.tsx` | **3,806** |
| `src/contexts/TwilioContext.tsx` | **2,149** |

`useQueueManager` — **not found** (not extracted).

### Hardcoded UUIDs

| Path | UUID | Notes |
|------|------|-------|
| `InboundCallRouting.tsx` | `00000000-0000-0000-0000-000000000000` | Singleton routing row pattern |
| `scratch/test_webrtc_ring.ts` | `a0000000-0000-0000-0000-000000000001` | Test script only |
| ROADMAP ops entry | `a0000000-...0001` | Chris home org — intentional for wipe script |

No `00000000-...0001` in `InboundRoutingManager.tsx` (ROADMAP flag appears resolved).

### Semantic drift: “contacted” vs “claim”

- **Hard claim timer:** 30s (`useHardClaim.ts`, migration `hard_claim_engine`)
- **Reports “contacted”:** **>45s** or DNC (`report-utils.ts` `CONTACTED_DURATION_THRESHOLD = 45`)
- **Local presence sticky (Tier 0):** **≥45s** (`CALLER_ID_STICKY_MIN_DURATION_SEC = 45`)

---

## 8. AGENT_RULES.md Compliance

| Rule / section | Accurate? | Notes |
|----------------|-----------|-------|
| Read ROADMAP/VISION/AGENT_RULES | Partial | VISION contradicts telephony |
| `organizations` multi-tenancy root | **Yes** | Exists on prod |
| `.maybeSingle()` | Yes | Widely used |
| Twilio stack + call sequence | **Yes** | Matches code |
| Re-entrancy refs in TwilioContext | **Yes** | Table matches `useRef` guards |
| “Known Telnyx artifacts” | Yes | Still valid; add **deployed Telnyx EF** |
| DialerPage >3k lines exception | Yes | Now **3,806** lines |
| Git push on approval | Process | Unchanged |
| 30s ownership in user rules vs 45s contacted | **Conflict** | User rules say 30s claim; reports use 45s — document both |

**Add to AGENT_RULES (production learnings):**

- Voice JWT **`sub` = master account SID** (TwiML App on master)
- `verify_jwt: false` + in-code JWT for ES256
- **`list_migrations`** before assuming schema
- **`assigned_agent_id` on `leads`, not `campaign_leads`**
- Role string **`Team Leader`**
- Decommission/remind: orphaned **`telnyx-*`** functions on Supabase

---

## 9. Open Questions for Product Owner

1. **Decommission legacy Telnyx Edge Functions** on `jncvvsvckxhqgqvkppmj` now, or keep for rollback?
2. **`tasks` table:** apply `20260505221000` to prod, or keep workflow `create_task` skipped?
3. **`campaigns.leads_called`:** ship column + trigger, or remove UI “Called” tile?
4. **`dial_sessions`:** still planned, or drop in favor of `dialer_daily_stats` + in-memory session stats?
5. **Conversations / AI Agents:** mark Conversations **GA** and AI Agents **mock-only** in VISION?
6. **Chris home org UUID** (`a0000000-...0001`): document as canonical test org in AGENT_RULES?
7. **pg_cron / workflow_engine_config:** confirm populated so time-based workflows run?
8. **Redeploy `twilio-buy-number` / `twilio-trust-hub`** with `verify_jwt: false` to match config?
