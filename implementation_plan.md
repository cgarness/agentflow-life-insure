# Implementation Plan — Permanent AgentFlow inbound calling and agent voicemail

**Label:** BUGFIX (Alexa's missed inbound call) + the routing/voicemail behavior Chris decided in the brief.
**Repository:** `cgarness/agentflow-life-insure` · branch `claude/agentflow-inbound-plan-fkl6zi` · base `main` @ `1b93f89` (= reviewed commit; `origin/main` has not moved).
**Status:** PLAN FOR REVIEW. Nothing in this document is implemented. No application code, migration, Edge Function, Twilio configuration, or production row was changed while preparing it. **STOP point: Chris's explicit implementation-plan approval is required before any application edit or backend command.**
**Authored:** 2026-09-10. Supersedes the root `implementation_plan.md` of PR #370 (kept in git history at `1b93f89`).

> Decision namespace. Chris's twelve settled decisions are referred to as **D1–D12** exactly as in the brief. The 2026-08 inbound plan also used `D1…D8` for its own defaults and those labels are embedded in code comments (`twiml.ts:3`, `routing.ts:3`, `index.ts:434`, migration `20260823222528`). New code comments and docs will write **`INB-D4`** etc. to avoid the collision; this document says D-numbers refer to the brief unless it says "2026-08 plan".

---

## 0. Read me first — what is settled, what is proposed

| Kind | Items | Treatment |
|---|---|---|
| **Settled by Chris (not re-asked)** | D1–D12 | Implemented as stated. §4 maps each to a mechanism. |
| **Supporting defaults proposed for review** | P1–P14 in §5 | Reasoned defaults; any can be vetoed without changing D1–D12. |
| **Approval tokens this plan needs** | `#APPROVE_RLS_CHANGE` for the new tables' policies and the new storage policies (§7.6); separate approvals for each production apply/deploy/release (§15). | Listed explicitly; none assumed. |
| **Not in scope** | Transcription/AI, IVR builder, inbox redesign, RLS Phase 2, campaign redesign, historical cleanup, reconciliation of the seven legacy migration versions, Deploy-to-production re-enable, outbound dialer changes. | Untouched. |

---

## 1. What was inspected (read-only) and what changed since the brief

**Repository.** `AGENT_RULES.md` (all 418 lines, invariants #8, #9, #20, #25, #28, #30, #31 in particular), `VISION.md`, `WORK_LOG.md` (newest entries through 2026-09-01 and the full inbound-call-flow release trail 2026-08-22 → 08-25), the approved 2026-08 inbound plan (`git show 81df588:implementation_plan.md`, rulings R1–R23 / C1–C14, §13 staging matrix). Full reads of `TwilioContext.tsx`, `twilio-voice.ts`, `FloatingDialer.tsx`, the relevant regions of `DialerPage.tsx`, `TopBar.tsx`, `AgentStatusContext.tsx`, `incomingCallAlerts.ts`, `NotificationContext.tsx`, `InboundRoutingManager.tsx` + `inbound-routing/*`, all five inbound Edge Functions, `_shared/notifications.ts`, `_shared/notification-recipients.ts`, the four inbound migrations, the notifications migration, the baseline DDL for `calls`/`profiles`/`phone_numbers`/`phone_settings`/`inbound_routing_settings`/`business_hours`/`notifications`/`dialer_sessions`/storage, and the Voice SDK 2.18.1 typings (`audiohelper.d.ts`, `outputdevicecollection.d.ts`, `device.d.ts`, `device.js`, `sound.js`) from the npm tarball.

**Live production (read-only, project `jncvvsvckxhqgqvkppmj`).**
- Edge Functions are exactly the brief's versions: `inbound-call-claim` v38, `twilio-voice-status` v40, `twilio-voice-inbound` v44, `twilio-recording-status` v34, `repair-twilio-number-ownership` v3, all `verify_jwt=false`, `ezbr_sha256` equal to the WORK_LOG-recorded byte-verified hashes. None of their source files changed in git since the squash-merge `81df588`.
- Newest applied migration is `20260823222926`. No inbound-related migration has been applied since.
- `calls.status` CHECK = `ringing | connected | completed | failed | no-answer`. `notifications.type` CHECK has **no `voicemail`** value.
- `profiles.availability_status` exists (`text NOT NULL DEFAULT 'Available'`, no CHECK; live values: `Available` ×6, `Offline` ×5) and `authenticated` holds a column-scoped UPDATE grant on it (plus `phone`, `status`, `role`, … — the trigger guard, not the grant, protects the authorization columns).
- Home org routing: `inbound_routing_settings.routing_mode='all-ring'`, `inbound_fallback_chain=['last_agent','all_available']`, `fallback_action='voicemail'` **but `voicemail_enabled=false`** (so the terminal action is greeting + hangup), `auto_create_lead=false`, after-hours SMS off. `phone_settings.ring_timeout=15`, `recording_enabled=true`, `recording_retention_days=7`. 16 numbers: one (`3101d3c0…`, the default) is `inbound_routing_mode='assigned'` + `fallback_action='forward'` with a forwarding number; the dialed number in the incident (`0d3ac8bd…`) has no per-number overrides.
- Storage: `call-recordings` is private with **org-wide** authenticated SELECT/INSERT/UPDATE keyed on the path prefix `<org_id>/…`; `voicemail-assets` is **public** with no object policies (greeting assets only).
- Non-terminal `calls` rows: 5 with `ended_at IS NULL` and `agent_id IS NULL` (oldest 2026-05-28); **0** non-terminal rows with `agent_id` set.

**Tooling baseline in this environment.** `npx tsc --noEmit` exits 0 (repo gate); `npx tsc --noEmit -p tsconfig.app.json` reports **81** pre-existing errors on `main` (WORK_LOG's last recorded baseline was 73 at `19c6a95`; the delta is unrelated to inbound). The ten focused inbound vitest suites run green here (139/139). `deno` is not installed; `esbuild` is; `psql` and `docker` binaries exist (a local PostgreSQL stack for the SQL suites still has to be proven at implementation time). **Twilio documentation URLs are blocked by the egress proxy** — Twilio platform facts below are marked (SDK-verified) when read from the 2.18.1 typings/sources, or (to verify live) when they depend on TwiML behavior.

---

## 2. Revalidation of the brief's pinned findings against HEAD `1b93f89`

| # | Brief's finding | Verdict | Evidence (file:line) |
|---|---|---|---|
| 1 | Closing the floating dialer while idle destroys the shared Device | **CONFIRMED, and worse** | `FloatingDialer.tsx:306-316` — the `open=false` branch runs `if (!onCallRef.current) twilioDestroy();`. `onCall` is forced **false while an inbound call is ringing** (`:666-672`), so closing the panel mid-ring destroys the Device and drops the ring. The same else-branch also runs on **first mount** (`open` defaults false, `:132`). |
| 2 | Ending a campaign session destroys the Device | **CONFIRMED** | `DialerPage.tsx:2353-2384` `handleEndDialerSession` calls `twilioDestroy()` unconditionally (`:2370`). Nothing re-registers until the panel opens, a campaign is selected, or a browser `online` event (`TwilioContext.tsx:2309-2316`). |
| 3 | Unregistration does not update the visible Ready state | **CONFIRMED** | `TwilioContext.tsx:2356` `isReady = status === "ready"`; `onUnregistered` (`:1968-1970`) only clears `twilioVoiceReadyRef`. `makeCall` refuses on the ref (`:2085`) while the UI stays green, and `handleOnline` (`:2312`) never re-inits because `status !== "error"`. `tokenWillExpire` failures are `console.error` only (`twilio-voice.ts:109-118`). |
| 4 | Manual availability is only local UI state | **CONFIRMED for TopBar; PARTLY REFUTED app-wide** | `TopBar.tsx:69` `useState(0)`, `:289-292` only `setStatusIdx`. But `profiles.availability_status` already exists and is written by `ProfileInfoCard.tsx:124-131` and read by four surfaces (`TeamMembersTable`, `Contacts`, `AgentModal`, `supabase-users`). Two disconnected sources of truth; **no server code reads it**. `AgentStatusContext.setDialerOverride` has zero callers (dead). `AgentModal.tsx:105` "Availability updated" toasts but writes only an activity row with `agentId:"u1"`. |
| 5 | Ring eligibility does not check actual browser presence | **CONFIRMED** | `twilio-voice-inbound/index.ts:430-448` + `routing.ts:25-42`: same-org, `status='Active'`, non-blank `twilio_client_identity` — nothing else. `twilio_client_identity` is minted once by `twilio-token` and never cleared, so it means "ever requested a token". |
| 6 | Existing assigned mode refers to the dialed number's owner | **CONFIRMED** | `index.ts:1089-1098` → `resolveAssignedTarget(phoneRow.assigned_to)`; direct lines `:1071-1088`. The contact's `assigned_agent_id` is never consulted; only the `last_agent` tier (`find_last_agent_for_inbound`) approximates it. |
| 7 | Forwarding is agency/number-level; no per-agent tables | **CONFIRMED** | `index.ts:371` merges `phone_numbers.forwarding_number || inbound_routing_settings.forwarding_number`; used once as the terminal action (`twiml.ts:91-107`, `index.ts:781-801`). No presence/agent-forwarding/voicemail/mailbox/attempt table exists (baseline grep; live `list_tables`). `profiles.phone` is a free-text display field. |
| 8 | Browser ringtone hooks are no-ops; priming uses a separate AudioContext | **CONFIRMED** | `incomingCallAlerts.ts:150-154` empty functions; `:57-85` private `AudioContext` + `sessionStorage` flag. The SDK plays the ringtone through **its own** static context (`device.js:559-568`) and **swallows playback failures** while still emitting `incoming` (`device.js:1358-1378`, 2 s race). A granted Notification permission is reported as "Twilio plays the ringtone" (`TwilioContext.tsx:940-950`). |
| 9 | inbound-call-claim validates Client identities; must not admit numbers | **CONFIRMED** | `claim-callback.ts:37-40, 55-67` exact `client:`-stripped equality against `profiles.twilio_client_identity`; `index.ts:204-224` plus `routed_agent_ids` membership; one `rpc("claim_inbound_call")` site pinned by `claimIdentityFailClosed.test.ts:237-246`. A PSTN `Called` value can never match. |
| 10 | Recording pipeline stores one source per row; voicemail not distinguished | **CONFIRMED, with a sharper consequence** | `twilio-recording-status/index.ts:138-143` never reads `RecordingSource`; `<Dial record>` and `<Record>` post to the same bare URL (`index.ts:108-110`). `idempotency.ts:69-86`: a second `RecordingSid` on a stored row is `skip_already_stored` → acked and **left at Twilio, never surfaced**. |

Additional confirmed facts that shape the design: the `<Number>` forward TwiML carries **no** `statusCallback`, no `timeout`, no `callerId` (`twiml.ts:134-143`); the forwarded child leg therefore emits nothing to AgentFlow and `twilio-voice-status` can never see it. After-hours today skips all ringing (`index.ts:1058-1067`). The `<Dial>` timeout is `phone_settings.ring_timeout` clamped 5–120 (`twiml.ts:28-32`), with no UI. `twilio-voice-inbound`'s fatal handler answers **200 + empty TwiML** (`index.ts:1178-1180`). `get_dialer_campaign_presence` is campaign-session presence only (`20260820233402:106-117`) and is never written by the browser.

---

## 3. Incident diagnosis (row + edge logs, read-only) — attribution stays unproven

Row `0bb30fa8…` (Twilio `CA053cca…`): created 20:31:27.36 UTC, `ended_at` 20:31:28.87, `status='no-answer'`, `is_missed=true`, `duration=8`, `updated_at` 20:31:35.30, `routed_agent_ids` = five agents (all `Active` with a client identity), `contact_type='lead'`, lead `assigned_agent_id` = one of the five (`7c692e64…`). Edge-log timeline (168 rows, 20:25–20:45, one inbound call in the window):

| UTC | Event |
|---|---|
| 20:31:24.07 | `[twilio-voice-inbound] incoming` |
| 20:31:27.61 | identity resolution `unique`, `linked:true`, `lead` |
| **20:31:27.84** | initial webhook returns TwiML (≈3.8 s after `incoming` — cold start / sequential settings loads) |
| **20:31:28.07** | `chain step { chainStep:0, dialStatus:"no-answer" }` — the `<Dial action>` fired **≈0.23 s** after TwiML was served |
| 20:31:28.07–.39 | five `inbound-call-claim` POSTs (one per agent), all 200, **zero** `claimed`/`rejected` console lines ⇒ all five `<Client>` legs ended with a non-claim status |
| 20:31:28.51–.55 | `chain tier "last_agent" → 0 (resolved 1, excluded 1)`, `"all_available" → 0 (resolved 5, excluded 5)`, `chain exhausted — terminal fallback` |
| 20:31:28.86 | `finalize_inbound_call_terminal` (hangup terminal: `voicemail_enabled=false`) |
| 20:31:35.30 | `twilio-voice-status` parent `completed`, `callDuration: 8` |

What this **proves**: the primary wave dialed five `<Client>` identities; every leg terminated within a quarter second; `DialCallStatus` was literally `no-answer`; no leg was answered; the caller then heard the greeting and was hung up (voicemail disabled at org level). What it **strongly suggests**: no Voice SDK Device was registered for any of the five identities at 20:31:27.8 — the classic signature of unregistered `<Client>` identities. What it **cannot show**: per-browser delivery, whether a Device was registered but rejected, the identity strings actually registered, child-leg CallStatus/SIP codes. A browser tab of Alexa's agency **was** alive (the same Chrome/macOS user agent polled `get_dialer_campaign_presence` every 15 s throughout) — consistent with, not proof of, "app open, Device destroyed by findings #1/#2". The exact mechanism of Alexa's miss therefore remains **unproven**; the plan removes every path that can produce it and adds the evidence that would prove it next time.

---

## 4. Design overview — one call, one plan, one attempt record

```
Twilio → twilio-voice-inbound (initial)
  resolve DID/org → ingest_inbound_call (resolve_inbound_contact, unchanged)
  plan = planInboundRoute():
     owner   := contact owner (assigned_agent_id) | direct-line owner (P1)   → mode 'owner'
     none    := no/ambiguous/inactive/cross-org owner                        → mode 'group'
  persist inbound_route_attempts (CAS-created BEFORE any TwiML)              ← new R14-style gate
  ┌─ mode 'owner' ─────────────────────────────────────────────────────────────┐
  │ availability ∈ {On Break, DND} ─────────────────────────────→ owner_voicemail (D11)
  │ busy (calls / in-flight attempt) ───────────────────────────→ owner_voicemail (D7)
  │ not connected (presence stale/false or no identity) ────────→ owner_mobile   (D3)
  │ else owner_browser: <Client> 20 s (D4) ──no answer──────────→ owner_mobile   (D3)
  │ owner_mobile: <Number url=whisper> mobile_ring_seconds, Press 1 (P6) ──no accept──→ owner_voicemail (D6)
  │ owner_voicemail: agent greeting + <Record> → voicemails row (mailbox = owner)
  └────────────────────────────────────────────────────────────────────────────┘
  ┌─ mode 'group' ─────────────────────────────────────────────────────────────┐
  │ members = configured group ∩ Active ∩ identity ∩ Available ∩ connected ∩ ¬busy (D5, D10)
  │ empty ───────────────────────────────────────────────────────→ group_voicemail (P3)
  │ else group_browser: simultaneous <Client> wave, 20 s ─no answer→ group_voicemail
  │ group_voicemail: org greeting + <Record> → voicemails row (mailbox = group snapshot + admins)
  └────────────────────────────────────────────────────────────────────────────┘
After hours: identical plan (D8); only the after-hours SMS stays hours-gated.
```

Signals, kept separate as the brief requires:
- **Intent** = `profiles.availability_status` (existing column; TopBar becomes its writer; server reads it).
- **Reachability** = new `agent_phone_presence` heartbeat written by the browser from Device `registered`/`unregistered` + a 60 s timer; server treats `registered AND last_seen_at ≥ now()-3 min` as connected. Advisory only: Twilio's own `<Dial>` outcome always drives the next stage.
- **Occupancy (busy)** = derived server-side, never stored as a flag: a `calls` row owned by the agent (`agent_id` or new `answered_by_agent_id`) with `status IN ('ringing','connected') AND ended_at IS NULL` inside a freshness ceiling, OR a non-terminal `inbound_route_attempts` row targeting the agent inside a shorter ceiling.
- **Answered-ness** stays `calls.agent_id` (browser claim) or `outcome='forwarded_answered'` (external); the mobile path adds **attribution** (`answered_by_agent_id`) without touching `agent_id`.

---

## 5. Confirmed decisions → mechanism, and the supporting defaults for review

### 5.1 D1–D12 (settled)

| D | Mechanism |
|---|---|
| D1 | Browser eligibility = signed-in real profile + org (`TwilioProvider` eager init, pinned to `realProfile`) + Device actually registered (presence heartbeat) + `availability_status='Available'` + not busy. Server-side check in `planInboundRoute`; Device lifetime becomes provider-owned (§6.1). |
| D2 | Owner-first: after `ingest_inbound_call` returns `(contact_id, contact_type)`, look up `leads/clients/recruits.assigned_agent_id` by id (never a second phone probe — invariant #30). Ambiguous/unlinked ⇒ no owner. |
| D3 | `owner_mobile` stage uses the agent's configured E.164 mobile (`agent_inbound_settings`), reached when the owner is not connected or the 20 s browser ring is unanswered. |
| D4 | `inbound_routing_settings.browser_ring_seconds` DEFAULT 20 feeds `<Dial timeout>` for every `<Client>` stage. `phone_settings.ring_timeout` stays outbound-only. |
| D5 | Admin-selected group in `inbound_routing_settings.inbound_group_agent_ids` (+ `inbound_group_mode`, P2). |
| D6 | Mobile unanswered / not accepted ⇒ `owner_voicemail` with the agent's greeting; the `voicemails` row's mailbox is the owner. |
| D7 | Busy owner ⇒ `owner_voicemail` immediately; no `<Client>` and no `<Number>` leg is created for a busy agent. Browser side, the SDK's default `allowIncomingWhileBusy=false` (SDK-verified `device.js:97, 317-320`) is left untouched, so a second invite can never seize an active call. |
| D8 | The after-hours branch (`index.ts:1058-1067`) no longer short-circuits to the terminal action; it runs the same plan. `business_hours` rows, the calendar and campaign calling windows are untouched; the after-hours SMS keeps its gate. |
| D9 | New `ringtoneOutputs` module: default mode `all` = every concrete `audiooutput` device (speakers + headset) via `device.audio.ringtoneDevices.set([...ids])` (SDK-verified `outputdevicecollection.d.ts:39`, accepts `string[]`); honest fallback when `isOutputSelectionSupported=false`; user-gesture **Test ringtone** via `ringtoneDevices.test(incomingUrl)`. Conversation audio (`speakerDevices`) untouched. |
| D10 | `group_browser` = one simultaneous `<Client>` wave over eligible members (Available ∩ connected ∩ ¬busy). No round robin, no sequential mobiles. |
| D11 | `On Break` / `Do Not Disturb` ⇒ `owner_voicemail` directly (bypasses browser **and** mobile); for the group path the member is simply excluded. Reconnect never writes availability. |
| D12 | The mobile `<Dial>`/`<Number>` builder is structurally unable to emit `record*` attributes; a source-audit test pins it; no call-level recording API is ever used; the `<Client>` stage's `record-from-answer-dual` records only that `<Dial>`'s bridged answer, which never occurs on the mobile stage. Voicemail `<Record>` is independent of `recording_enabled`. |

### 5.2 Supporting defaults proposed for review (P1–P14)

| P | Proposal | Why this default |
|---|---|---|
| **P1 Direct lines** | A number with `is_direct_line=true` treats `phone_numbers.assigned_to` as the **owner** for the whole owner pipeline (browser → mobile → voicemail, D7/D11 included), regardless of the caller's contact assignment. Non-direct numbers ignore `assigned_to`. | Keeps today's explicit direct-line promise; the number owner gets D3/D6 benefits. |
| **P2 Group default** | `inbound_group_mode text CHECK ('all_active','selected') DEFAULT 'all_active'`. `all_active` = every same-org Active agent with an identity (today's all-ring set, further filtered by D1/D10). Admin switches to `selected` and picks ids. | Avoids a production backfill and avoids silently sending every unassigned caller to voicemail on deploy. |
| **P3 Shared mailbox** | Empty/unreachable/unanswered group ⇒ `group_voicemail` with the org greeting; `voicemails.recipient_kind='group'`, `recipient_group_ids` = the eligible-member snapshot **or**, if that is empty, the configured group; access = snapshot ∪ current group ∪ org Admin/Super Admin. No sequential forwarding to members' mobiles. | Matches the brief's fallback; bounded access. |
| **P4 Ineligible owner** | Missing, `Deleted/Inactive/Pending`, or cross-org owner ⇒ group path (no personal forwarding, no leak of the other contact). | Fail-safe. |
| **P5 Mobile ring** | `inbound_routing_settings.mobile_ring_seconds DEFAULT 20` (clamped 5–120), applied to the `owner_mobile` `<Dial timeout>`. | Parity with D4; short enough to reach voicemail quickly. |
| **P6 Press 1 acceptance** | `<Number url>` whisper TwiML: `<Gather numDigits="1" timeout="5" action=…><Say>AgentFlow call from {name or 'a caller'}. Press 1 to accept.</Say></Gather><Hangup/>`. Only a signed Gather action with `Digits=1` counts as human acceptance; a personal-voicemail pickup never presses 1 and is hung up before bridging. `mobile_accept_mode CHECK ('press_1','auto') DEFAULT 'press_1'` lets an admin turn the step off. | Brief's proposal; the only robust human-acceptance proof without AMD. **TwiML behavior to verify live** (§14 #8). |
| **P7 Mobile caller ID** | Leave `<Dial callerId>` unset so Twilio presents the original caller's number to the agent's mobile (Twilio default for a `<Dial>` inside an inbound call — **to verify live**); the whisper announces AgentFlow. | Agent sees who is calling; no caller-ID ownership issue. |
| **P8 Busy ceilings** | `calls` rows count as busy only when `created_at > now() - interval '4 hours'`; in-flight attempts only when `stage_started_at > now() - interval '10 minutes'`. Stale rows never block forever. | Reconciliation is still waived, so stale `connected` rows are possible. |
| **P9 Presence freshness** | Connected = `registered AND last_seen_at ≥ now() - 3 min`; browser heartbeat every 60 s while registered, immediate write on `registered`/`unregistered`/logout; multi-tab via `session_id` (a tab may only mark *its own* registration false). Background-tab timer throttling (≥1/min) fits inside the window. | Mirrors the existing 3-minute `dialer_sessions` convention. |
| **P10 Voicemail toggle** | `voicemail_enabled` and `fallback_action` are retired from the routing path (columns kept, UI hidden). D6/D7/D11 require AgentFlow voicemail, so an org cannot disable it. Legacy `routing_mode` and `inbound_fallback_chain` likewise retire (P2 replaces `all-ring`; the chain's tiers are superseded by owner-first + group). | The home org's `voicemail_enabled=false` is why the September 9 caller was hung up. |
| **P11 Per-number override** | `phone_numbers.inbound_routing_mode` / `forwarding_number` / `voicemail_*` overrides are ignored by the new planner (UI hidden); `is_direct_line` (P1) is the one per-number routing switch that survives. | One planner, fewer contradictory settings. |
| **P12 Attribution column** | `calls.answered_by_agent_id uuid NULL` (service-role written) records which agent accepted on mobile; `agent_id` stays the `<Client>`-claim proof so `claim_inbound_call` and RLS Phase 1's `(direction IS DISTINCT FROM 'inbound' OR agent_id IS NOT NULL)` exclusion are untouched. History surfaces read `COALESCE(agent_id, answered_by_agent_id)` for display. | Attribution without weakening R13. |
| **P13 Voicemail retention** | `voicemails` follow the org's `recording_retention_days` through a sibling of `calls_expired_recording_batch` in the nightly purge. | No unbounded PII retention. |
| **P14 availability CHECK** | Add `CHECK (availability_status IN ('Available','On Break','Do Not Disturb','Offline'))` on `profiles` (live preflight: only `Available`/`Offline` exist). `Offline` remains a value written by deactivate/delete paths and is treated like "not connected" (mobile → voicemail), never selectable in TopBar. | Server can trust the value. |

---

## 6. Change set A — Browser

### 6.1 Device lifetime owned by the authenticated provider (`TwilioContext.tsx`, `twilio-voice.ts`, `FloatingDialer.tsx`, `DialerPage.tsx`)

1. **Remove the two UI destroy paths.** `FloatingDialer.tsx:303-316`: the close branch keeps `setIsVisible(false); setMinimized(false);` only; drop `twilioDestroy` from deps and from the `useTwilio()` destructure (`:185`); update the comment. `DialerPage.tsx:2370`: delete `twilioDestroy();` and its dep (`:2383`, destructure `:511`); every other statement of `handleEndDialerSession` stays. No test pins either destroy (`dialerRenderStability.test.tsx:132` mocks but never asserts).
2. **Provider-owned teardown.** After the eager init effect (`TwilioContext.tsx:2001-2005`) add a symmetric effect: when `profile`/`organizationId` become null and a Device exists ⇒ `destroyClient()`; plus an unmount cleanup through a `destroyClientRef` mirror (same pattern as `hangUpRef`). Org change keeps its existing destroy+recreate branch (`:1927-1941`). "View As" never unmounts the provider (AGENT_RULES §31 rule at line 300 stands).
3. **Readiness truth.** `onUnregistered` (`:1968-1970`) also `setStatus(s => s === "ready" ? "connecting" : s)`; `handleOnline` (`:2312`) condition becomes `status === "error" || !deviceRef.current || !twilioVoiceReadyRef.current`. `onError` unchanged. Add a bounded recovery that does not fight the SDK's own signaling reconnect: if the Device is still not `Registered` 30 s after an `unregistered` event (and no call is active), one `initializeClient()` attempt (guarded by `initializeInFlightRef` and the existing same-org skip path), then rely on `online`. Every transition is recorded in the readiness ring buffer (§6.4).
4. **Close the destroy/init race** (`twilio-voice.ts`): add a module-private `destroying: Promise<void> | null` set by `destroyTwilioDevice` and awaited at the top of `initTwilioDevice`, so the Registered fast-path (`:126-133`) can never return a Device that is mid-teardown. Public signatures unchanged (the `twilioViewAsIdentity` mock replaces the whole module).
5. **Ring surface.** `FloatingDialer.tsx:666-673` adds `setMinimized(false)` so Answer/Decline are visible during the 20 s ring on every route. `IncomingCallModal.tsx` (unmounted, F11) is deleted to keep one answer surface.
6. **Invariant #9** — all ten refs plus `inboundCallRowIdRef` untouched. **Invariant #30 audits** — no new `.from("calls")` write site; `inboundBrowserLifecycleWrites.test.ts` (exactly 6 sites, 3 `status: 'completed'`, `C14` marker) and `inboundBrowserZeroWrites.test.ts` stay green. New named imports into `TwilioContext.tsx` come from **new modules** (`src/lib/phonePresence.ts`, `src/lib/ringtoneOutputs.ts`), never from `@/lib/twilio-voice`, so `twilioViewAsIdentity.test.tsx`'s fixed mock list is unaffected.

### 6.2 Reachability heartbeat (`src/lib/phonePresence.ts` new, wired from `TwilioContext.tsx`)

- `reportPhonePresence({ state: 'registered'|'unregistered'|'error', detail?: string })` → `supabase.rpc('heartbeat_phone_presence', { p_registered, p_session_id, p_state, p_detail })`; `p_session_id` is a per-tab `crypto.randomUUID()` kept in `sessionStorage`; `p_detail` ≤ 64 chars, allow-listed codes only (`token_expired`, `audio_output_unsupported`, `sdk_error:<code>`), never tokens/SDP/URLs.
- Calls: `onRegistered` ⇒ registered; `onUnregistered`/`onError`/`destroyClient`/logout ⇒ unregistered (only if the stored `session_id` is this tab's — enforced in SQL); a 60 s interval while registered; `visibilitychange` to visible ⇒ one immediate heartbeat. Best-effort: failures are logged and never affect the Device.
- Identity: `profile.id` from the `realProfile` alias only; no call while `realProfile` is null (fail closed, matches `twilioViewAsIdentity`'s "zero queries" assertion because the RPC is only invoked from Device events that cannot fire without a Device).

### 6.3 Manual availability (`AgentStatusContext.tsx`, `TopBar.tsx`, `ProfileInfoCard.tsx`, `AgentModal.tsx`)

- `AgentStatusProvider` (already mounted in `AppLayout.tsx:37`) becomes the one owner: reads `useAuth().realProfile?.availability_status`, exposes `{ availability, setAvailability, onCall }`; `setAvailability` calls `updateProfile({ availability_status })` (own row; column grant exists; invariant #20 layers untouched) with optimistic UI + rollback toast; no-op while `isImpersonating`. `onCall` derives from `useTwilio().callState ∈ {dialing, incoming, active}`; `dialerOverride`/`setDialerOverride` removed (dead). Test mocks `topBarViewAsShell.test.tsx:56-57` and `viewAsRouteAllowlist.test.tsx:47-48` updated to the new shape.
- `TopBar.tsx`: picker offers **Available / On Break / Do Not Disturb** only; `Offline` and `On a Call` render as derived labels (`useTwilio().status !== 'ready'`, `onCall`) and are never selectable; the availability block is hidden under "View As" like the Dialer/Notifications controls (`:133, :173`); `dialerOnCall` window-event mirror replaced by `onCall` (fixes the stale-true on unmount).
- `ProfileInfoCard.tsx`: remove the duplicate availability select (`:22-27, :50, :128, :270-280`); `AgentModal.tsx:105-133`: remove the phantom dropdown. `supabase-users.ts:512-514, 669-671` (deactivate/delete ⇒ `Offline`) unchanged.
- Reconnect/refresh: nothing in the telephony path writes availability; `fetchProfile` re-hydrates the persisted value, so DND survives reload and reconnect.

### 6.4 Ringtone outputs and alerts (`src/lib/ringtoneOutputs.ts` new, `incomingCallAlerts.ts`, `ProfileRingtoneOutputCard.tsx` new)

- Policy module (pure, vitest-covered): `loadRingtoneOutputPrefs(userId)`/`save…` in `localStorage` key `agentflow_ringtone_outputs_v1:<realProfileId>` (`{ mode:'all'|'custom', deviceIds:[] }`; device ids are per-browser, so they never go to the server); `resolveRingtoneSinkIds(prefs, availableOutputDevices)` — `all` = every concrete `audiooutput` id, dropping the `default`/`communications` pseudo-ids when a concrete id exists, else `['default']`; `custom` = saved ∩ available, fallback `['default']`, reporting `missing`; `applyRingtoneOutputs(device)` — no-op with `{supported:false}` when `!device.audio?.isOutputSelectionSupported`, else `ringtoneDevices.set(ids)` with `.catch` → `set('default')`; `attachRingtoneDeviceChange(device, onChange)` re-applies on `deviceChange`; `testRingtoneOutputs(device)` wraps `ringtoneDevices.test(INCOMING_URL)` (the SDK default test tone is `outgoing.mp3`, `outputdevicecollection.js:9`) and maps `NotSupportedError`/`InvalidStateError`/`NotAllowedError`/`NotFoundError` to UI results. Never touches `speakerDevices` (the app's parallel `#twilio-remote-audio` element makes conversation-output selection a separate ticket).
- Hook point: `twilio-voice.ts` gains an additive `opts.onDeviceReady?.(device)` invoked after `device.audio?.outgoing(false)` on both the fresh and the already-registered paths (the AudioHelper is per-Device, `device.js:1269-1275`); `TwilioContext` applies outputs + attaches `deviceChange` there and exposes `ringtoneOutputs` + `testRingtoneOutputs` in its value.
- Honesty: `audioPrimed`/`isIncomingAudioPrimed`/the private `AudioContext`/`sessionStorage` flag are deleted; the four dead `start/stopIncomingRingtone` calls and exports are deleted; toasts at `TwilioContext.tsx:940-950` no longer claim audibility. Desktop pop-ups: `enableIncomingCallAlertsFromUserGesture` becomes `requestIncomingDesktopNotificationPermission()` (Notification only); `showIncomingDesktopNotification` gates on `Notification.permission==='granted'` and the operator's `push_notifications_enabled` (via `NotificationContext`), removing the second localStorage opt-in path.
- Settings card `ProfileRingtoneOutputCard.tsx` (<200 lines, mounted after `ProfilePreferencesCard` in `MyProfile.tsx`): states *connecting*, *unsupported* ("This browser does not let AgentFlow choose which speaker rings; the ringtone plays on your system default output" — Safari and some Firefox), *supported* (radio all/custom + checkbox list with label fallback and "not currently connected" notes), **Play test ringtone** button (gesture-only), caption "If you did not hear it, check the device volume or mute switch — the app cannot detect that."
- Browser readiness evidence (bounded): a 50-entry in-memory ring buffer of Device/audio events (`registered`, `unregistered`, `error:<code>`, `output_unsupported`, `ringtone_test:<result>`, `invite`, `accept`, `cancel`) rendered in the FloatingDialer "Connection details" popover; the last state/detail also travels with the presence heartbeat (§6.2). No tokens, SDP, or caller data.

### 6.5 Settings surfaces

- **Settings → Phone System → Inbound Calls** (`InboundRoutingManager.tsx` + `inbound-routing/*`, Zod extended): new *Inbound agent group* card (mode + Active-agent multiselect showing availability badges), *Browser ring (seconds)* [20], *Mobile ring (seconds)* [20], *Mobile acceptance* [Press 1 / Automatic]; copy rewritten for D2/D5/D8/D12 (routing strategy, business-hours, after-hours SMS); a static recording note (D12) also added to `CallRecordingSettings.tsx`. Under P10/P11 the routing-mode radio, fallback-chain section, voicemail toggle and per-number routing modal fields are hidden (code retained). Component-size rule: the new cards are separate files under `src/components/settings/inbound-routing/`.
- **My Profile → Inbound Calls card** (`ProfileInboundCard.tsx` new, Zod): mobile forward number (E.164, validated + normalized), enable toggle, personal voicemail greeting text (≤ 500 chars) or greeting URL (https, ≤ 2048), saved to `agent_inbound_settings` (own row). Loop guard preview: the form rejects a number equal to any org `phone_numbers.phone_number`.
- **Voicemail playback**: `VoicemailPlayer.tsx` (new, mirrors `RecordingPlayer` but downloads from the `voicemails` bucket by `voicemails.storage_path`); rendered by `ConversationThread.tsx`, `ConversationHistory.tsx` and `FullScreenContactView.tsx` call items when `calls.voicemail_id` is set; notification rows of type `voicemail` deep-link to the contact thread. History rows show "Answered on mobile by …" when `answered_by_agent_id` is set (P12). No new inbox page.

---

## 7. Change set B — Database (four new migrations; none touch applied files)

Versions are authored as `2026091HHHMMSS_*` and renamed to the production apply-time version on apply (repo convention from 2026-08-23). Each migration is additive DDL with **no data UPDATE/backfill** (invariant #28). Rollback SQL for each lives in `supabase/migrations/rollback/` (outside the CLI glob).

### 7.1 M4 `…_inbound_agent_settings_and_presence.sql`
```sql
CREATE TABLE public.agent_inbound_settings (
  agent_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mobile_forward_number text CHECK (mobile_forward_number IS NULL OR mobile_forward_number ~ '^\+[1-9][0-9]{7,14}$'),
  mobile_forward_enabled boolean NOT NULL DEFAULT true,
  voicemail_greeting_text text CHECK (voicemail_greeting_text IS NULL OR length(voicemail_greeting_text) <= 500),
  voicemail_greeting_url  text CHECK (voicemail_greeting_url IS NULL OR voicemail_greeting_url ~ '^https://'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.agent_phone_presence (
  agent_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  registered boolean NOT NULL DEFAULT false,
  session_id uuid, registered_at timestamptz, last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_state text NOT NULL DEFAULT 'unregistered' CHECK (last_state IN ('registered','unregistered','error')),
  last_detail text CHECK (last_detail IS NULL OR length(last_detail) <= 64),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.agent_phone_presence (organization_id, registered, last_seen_at);
-- RPC (authenticated): identity from auth.uid()/get_org_id(); server now(); a tab may only clear ITS OWN session
CREATE FUNCTION public.heartbeat_phone_presence(p_registered boolean, p_session_id uuid, p_state text, p_detail text DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp …
  -- INSERT … ON CONFLICT (agent_id) DO UPDATE SET registered = CASE WHEN EXCLUDED.registered THEN true
  --   WHEN agent_phone_presence.session_id IS NULL OR agent_phone_presence.session_id = EXCLUDED.session_id THEN false
  --   ELSE agent_phone_presence.registered END, session_id = CASE WHEN EXCLUDED.registered THEN EXCLUDED.session_id ELSE … END,
  --   registered_at = CASE WHEN EXCLUDED.registered AND NOT agent_phone_presence.registered THEN now() ELSE agent_phone_presence.registered_at END,
  --   last_seen_at = now(), last_state = EXCLUDED.last_state, last_detail = EXCLUDED.last_detail, updated_at = now()
  --   WHERE agent_phone_presence.organization_id = get_org_id();
-- Helper (STABLE, service_role + authenticated): is_phone_connected(agent_id) := registered AND last_seen_at >= now() - interval '3 minutes'
```
Policies (**#APPROVE_RLS_CHANGE**): both tables `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL FROM PUBLIC, anon`; `GRANT SELECT ON both TO authenticated`; `GRANT INSERT, UPDATE ON agent_inbound_settings TO authenticated`; `GRANT ALL ON both TO service_role`.
- `agent_inbound_settings_self_select/insert/update` — `TO authenticated USING (agent_id = auth.uid() AND organization_id = public.get_org_id()) WITH CHECK (same)`.
- `agent_inbound_settings_admin_select` — org Admin/Super Admin read (`organization_id = get_org_id() AND (get_user_role() IN ('Admin') OR is_super_admin())`) for support; no admin write (P: agents own their mobile number).
- `agent_phone_presence_self_select` and `agent_phone_presence_org_select` (org-wide SELECT for the group editor's availability/connected badges; no PII beyond timestamps); **no** client INSERT/UPDATE policies — writes only through the RPC. `REVOKE EXECUTE … FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`.

### 7.2 M5 `…_inbound_routing_owner_group_ring_settings.sql`
```sql
ALTER TABLE public.inbound_routing_settings
  ADD COLUMN inbound_group_mode text NOT NULL DEFAULT 'all_active' CHECK (inbound_group_mode IN ('all_active','selected')),
  ADD COLUMN inbound_group_agent_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN browser_ring_seconds integer NOT NULL DEFAULT 20 CHECK (browser_ring_seconds BETWEEN 5 AND 120),
  ADD COLUMN mobile_ring_seconds  integer NOT NULL DEFAULT 20 CHECK (mobile_ring_seconds BETWEEN 5 AND 120),
  ADD COLUMN mobile_accept_mode   text NOT NULL DEFAULT 'press_1' CHECK (mobile_accept_mode IN ('press_1','auto'));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_availability_status_check
  CHECK (availability_status IN ('Available','On Break','Do Not Disturb','Offline'));  -- P14; preflight done (only Available/Offline live)
```
No new policies: the existing Admin-only insert/update + org select on `inbound_routing_settings` cover the new columns. `COMMENT ON COLUMN` records the decision each column implements and that mobile legs are never recorded.

### 7.3 M6 `…_inbound_route_attempts.sql`
```sql
CREATE TABLE public.inbound_route_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES public.calls(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('owner','group')),
  owner_agent_id uuid, owner_source text CHECK (owner_source IN ('contact','direct_line')),
  eligibility_reason text NOT NULL,          -- e.g. 'owner_available_connected','owner_dnd','owner_busy','owner_offline','no_owner','group_empty'
  stage text NOT NULL CHECK (stage IN ('owner_browser','owner_mobile','owner_voicemail','group_browser','group_voicemail','done')),
  stage_started_at timestamptz NOT NULL DEFAULT now(),
  browser_targets uuid[] NOT NULL DEFAULT '{}',
  mobile_number_dialed text, mobile_child_call_sid text, mobile_accepted boolean NOT NULL DEFAULT false, mobile_accepted_at timestamptz,
  voicemail_kind text CHECK (voicemail_kind IN ('agent','group')), voicemail_agent_id uuid, voicemail_group_ids uuid[],
  provider_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,   -- bounded (last 20) {stage, dial_call_status, child_sid, at}
  final_outcome text, terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.inbound_route_attempts (owner_agent_id, terminal, stage_started_at);
ALTER TABLE public.calls ADD COLUMN answered_by_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;  -- P12
```
RPCs, all `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE … FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`:
- `create_inbound_route_attempt(p_call_row_id, p_org_id, p_mode, p_owner_agent_id, p_owner_source, p_eligibility_reason, p_stage, p_browser_targets uuid[])` → `INSERT … ON CONFLICT (call_id) DO NOTHING RETURNING`, returns `{created, attempt}` (a duplicate initial webhook is read-only).
- `advance_inbound_route_stage(p_attempt_id, p_org_id, p_from_stage, p_to_stage, p_patch jsonb)` → single `UPDATE … WHERE id AND organization_id AND stage = p_from_stage AND NOT terminal` CAS; appends a bounded `provider_outcomes` entry; returns `{updated:boolean, reason}`. Replayed `<Dial action>` callbacks therefore cannot re-run a stage.
- `record_inbound_mobile_accept(p_attempt_id, p_org_id, p_call_row_id, p_agent_id, p_child_call_sid)` → one transaction: CAS on the attempt (`stage='owner_mobile' AND NOT mobile_accepted AND owner_agent_id = p_agent_id`) then `UPDATE public.calls SET outcome='forwarded_answered', answered_by_agent_id = COALESCE(answered_by_agent_id, p_agent_id), provider_session_id = COALESCE(provider_session_id, p_child_call_sid), status = CASE WHEN status='ringing' THEN 'connected' ELSE status END, is_missed = false, updated_at = now() WHERE id = p_call_row_id AND organization_id = p_org_id AND direction='inbound' AND agent_id IS NULL AND (answered_by_agent_id IS NULL OR answered_by_agent_id = p_agent_id)`; redelivery ⇒ `{accepted:true, idempotent:true}` with zero writes. Never writes `duration` (invariant #8).
- `is_agent_busy(p_org_id, p_agent_id)` `STABLE` → `EXISTS calls (organization_id, (agent_id = p OR answered_by_agent_id = p), status IN ('ringing','connected'), ended_at IS NULL, created_at > now() - interval '4 hours') OR EXISTS inbound_route_attempts (owner_agent_id = p, NOT terminal, stage IN ('owner_browser','owner_mobile'), stage_started_at > now() - interval '10 minutes')` (P8).
- `finalize_inbound_call_terminal` is **unchanged** (its `p_external_answer` path remains valid for the `auto` accept mode).
Policies: `ENABLE ROW LEVEL SECURITY` with **no** authenticated policies and `REVOKE ALL … FROM PUBLIC, anon, authenticated` (service-role only). Listed under the same **#APPROVE_RLS_CHANGE** request for transparency.

### 7.4 M7 `…_voicemails.sql`
```sql
CREATE TABLE public.voicemails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.inbound_route_attempts(id) ON DELETE SET NULL,
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('agent','group')),
  recipient_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_group_ids uuid[] NOT NULL DEFAULT '{}',
  recording_sid text NOT NULL UNIQUE CHECK (recording_sid ~ '^RE[0-9a-f]{32}$'),
  recording_source text NOT NULL DEFAULT 'RecordVerb',
  storage_bucket text NOT NULL DEFAULT 'voicemails', storage_path text UNIQUE,
  duration_seconds integer, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','stored','failed','purged')),
  listened_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((recipient_kind='agent' AND recipient_agent_id IS NOT NULL) OR recipient_kind='group'));
ALTER TABLE public.calls ADD COLUMN voicemail_id uuid REFERENCES public.voicemails(id) ON DELETE SET NULL;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check, ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('win','missed_call','lead_claimed','appointment_reminder','anniversary','system','inbound_sms','inbound_email','voicemail'));
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('voicemails','voicemails', false, 26214400, ARRAY['audio/mpeg']) ON CONFLICT (id) DO NOTHING;
-- One visibility predicate, used by the table policy AND the storage policy:
CREATE FUNCTION public.can_access_voicemail(p_voicemail_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.voicemails v
    LEFT JOIN public.inbound_routing_settings irs ON irs.organization_id = v.organization_id
    WHERE v.id = p_voicemail_id AND v.organization_id = public.get_org_id() AND auth.uid() IS NOT NULL AND (
      v.recipient_agent_id = auth.uid()
      OR (v.recipient_kind = 'group' AND (auth.uid() = ANY (v.recipient_group_ids) OR auth.uid() = ANY (COALESCE(irs.inbound_group_agent_ids,'{}'))))
      OR public.get_user_role() = 'Admin' OR public.is_super_admin())) $$;
CREATE POLICY voicemails_select ON public.voicemails FOR SELECT TO authenticated USING (public.can_access_voicemail(id));
CREATE POLICY voicemails_update_listened ON public.voicemails FOR UPDATE TO authenticated USING (public.can_access_voicemail(id)) WITH CHECK (public.can_access_voicemail(id));
-- column-scoped: GRANT UPDATE (listened_at) ON public.voicemails TO authenticated; no INSERT/DELETE for authenticated
CREATE POLICY voicemail_objects_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'voicemails' AND EXISTS (SELECT 1 FROM public.voicemails v WHERE v.storage_path = storage.objects.name AND public.can_access_voicemail(v.id)));
-- service_role only for INSERT/DELETE on the bucket (Edge Functions). RPCs: upsert_voicemail_from_recording(...) and voicemails_expired_batch(p_org, p_cutoff, p_limit) (P13), both service_role only.
```
**#APPROVE_RLS_CHANGE** covers `voicemails_select`, `voicemails_update_listened`, `voicemail_objects_select`. `call-recordings` policies are untouched (its org-wide read is exactly why voicemails get their own bucket).

### 7.5 Generated types
`src/integrations/supabase/types.ts` is regenerated after M4–M7 and every RPC typing must match the SQL signature (AGENT_RULES #30 rev 8(b)); narrow `(supabase as any).rpc` casts are avoided.

### 7.6 Approval tokens summary
`#APPROVE_RLS_CHANGE` requested for: `agent_inbound_settings` (4 policies), `agent_phone_presence` (2 SELECT policies; RPC-only writes), `inbound_route_attempts` (RLS on, zero policies), `voicemails` (2 policies) and `storage.objects` `voicemail_objects_select`. **No existing policy on `calls`, `profiles`, `notifications`, `phone_numbers`, `inbound_routing_settings` or `call-recordings` is modified.** The RLS Phase 1 postconditions (`scripts/run_rls_phase1_tests.sh`) remain satisfied because no new ALL/UPDATE/DELETE policy is added to `public.calls`.

---

## 8. Change set C — Server routing (`supabase/functions/twilio-voice-inbound/`)

### 8.1 Planner (`planner.ts` new, pure + vitest; wired from `index.ts:handleInitialInbound`)
1. After `ingestInboundCall` (`index.ts:1039-1057`): `resolveContactOwner(supabase, orgId, contact_id, contact_type)` reads `leads|clients|recruits.assigned_agent_id` by id (`sync_leads_user_id` keeps `leads.user_id` mirrored, so `assigned_agent_id` is canonical per AGENT_RULES §5); direct line (P1) ⇒ `phone_numbers.assigned_to`. Validate the owner with the existing `validateAssignedProfile` (same org, Active); otherwise P4 ⇒ group.
2. Load in one round trip: the owner's `availability_status`, `agent_inbound_settings`, `is_phone_connected`, `is_agent_busy`; for the group path the member set (P2) with the same three signals per member (`resolveActiveRingTargetsByAgentIds` + new `partitionByEligibility` in `routing.ts`, unit-tested).
3. Decide the first stage per §4 and persist via `create_inbound_route_attempt` **before** any TwiML. On failure take the existing safe path (`buildWavePlan` suppression semantics at `index.ts:851-872`): voicemail TwiML with `voicemail_kind` unknown ⇒ shared mailbox, telemetry line `attempt-persist FAILED`.
4. `persistRoutedAgents(append_call_routed_agents)` still precedes every `<Client>` wave (R14) — also for the single owner, so notification recipients (tier 1) and the claim's `routed_agent_ids` membership work unchanged.
5. After-hours (D8): `checkBusinessHours` still runs (SMS only); the `return await emitTerminalFallback` at `index.ts:1058-1067` is removed.
6. Initial-webhook latency: the six sequential settings reads (`phone_numbers`, `inbound_routing_settings` ×2, `phone_settings`, `company_settings`, `business_hours`) are issued with `Promise.all` — a bounded, behavior-neutral fix for the observed ≈3.8 s first-response time.

### 8.2 Stage handlers (`stages.ts` new; `index.ts` dispatcher)
- Dispatcher reads `stage` from the signed query **before** the legacy `fallback` checks; legacy `fallback=chain|voicemail|hangup` handlers stay for one release so in-flight calls at deploy time complete (P: remove in a follow-up).
- `emitOwnerBrowserStage`: `buildClientDialTwiml` unchanged except `timeoutSec = browser_ring_seconds` (D4) and `actionUrl = selfUrl({stage:'owner_browser', call_row_id, org_id, phone_number_id, attempt_id, agent_id})`.
- `emitOwnerMobileStage`: requires `mobile_forward_enabled AND mobile_forward_number`, plus loop guard (number ∉ org `phone_numbers`, ≠ DID, ≠ caller ANI last-10) — else skip to voicemail with reason; `advance_inbound_route_stage(owner_browser|initial → owner_mobile, {mobile_number_dialed})`; `buildMobileForwardTwiml` (§9).
- `emitOwnerVoicemailStage` / `emitGroupVoicemailStage`: `advance…(→ *_voicemail, {voicemail_kind, voicemail_agent_id | voicemail_group_ids})`; `markMissedAndNotify(callRowId, orgId, { preferredRecipientIds })` exactly once (existing single missed-marking point; `insertMissedCallNotifications` gains an optional tier-0 recipient list, validated Active + same org); `buildVoicemailTwiml` with the agent greeting (`agent_inbound_settings.voicemail_greeting_*`) or the org greeting, `recordingStatusCallback = recordingStatusUrl({source:'voicemail', call_row_id, org_id, attempt_id, mailbox:'agent:<uuid>'|'group'})#rc=3&rp=5xx,ct,rt`, `action = selfUrl({stage:'voicemail_done', …})`.
- `emitGroupBrowserStage`: eligible members ⇒ one wave (`buildClientDialTwiml`, 20 s, `stage:'group_browser'`); empty ⇒ `emitGroupVoicemailStage` (P3).
- `handleStageReturn(stage, params)` on `<Dial action>` POSTs: `owner_browser`/`group_browser` answered (`DialCallStatus completed|answered`) ⇒ the claim already wrote `agent_id`; `advance…(→ done, terminal)` + `finalizeTerminalWithRetry('completed', false)` (unchanged); unanswered ⇒ next stage per §4. `owner_mobile`: if `attempt.mobile_accepted` ⇒ done + finalize `completed`; else (any `DialCallStatus`, including `completed` from a voicemail machine that never pressed 1) ⇒ `owner_voicemail`. In `mobile_accept_mode='auto'` the answered `DialCallStatus` path keeps today's `shouldRecordExternalAnswerProof` + `finalize(..., p_external_answer=true)` and additionally writes `answered_by_agent_id` through `record_inbound_mobile_accept`. `voicemail_done` ⇒ `advance(→ done)` + `finalize('completed', false)` (today's `fallback=hangup`).
- Response policy: the initial request and every `<Dial action>` answer **200 with TwiML** (a 5xx there would drop the caller). Persistence failures on those requests choose the safe next TwiML and log; the `<Number statusCallback>` and recording callbacks answer **503 on transient failure** (they carry the retry fragment). The fatal handler's empty-TwiML-200 stays only for the initial request.

### 8.3 Signed callback contracts (all HMAC-SHA1 over the full SUPABASE_URL-origin URL including the server-issued query, sorted form params, `TWILIO_AUTH_TOKEN`; fragments never transmitted)

| Emitted by | URL (query = server-issued, signature-covered) | Handler & checks | Retry fragment |
|---|---|---|---|
| `<Dial action>` (all stages) | `twilio-voice-inbound?stage=<stage>&call_row_id&org_id&phone_number_id&attempt_id[&agent_id]` | signature; row org/direction; attempt id ↔ call id; CAS stage transitions | none (must answer TwiML) |
| `<Client statusCallback>` | unchanged `inbound-call-claim?call_row_id&agent_id` | unchanged (R13) | `#rc=3&rp=5xx,ct,rt` |
| `<Number url>` whisper | `twilio-voice-inbound?stage=mobile_whisper&call_row_id&org_id&attempt_id&agent_id` | signature; `CallSid ≠ ParentCallSid`; `ParentCallSid = calls.twilio_call_sid`; attempt `owner_agent_id = agent_id`, stage `owner_mobile`; `Called/To` last-10 = `mobile_number_dialed`; records `mobile_child_call_sid` | none (TwiML) |
| `<Gather action>` | `twilio-voice-inbound?stage=mobile_accept&…same…` | same checks + `Digits === '1'` ⇒ `record_inbound_mobile_accept` ⇒ `<Say>Connecting.</Say>` (bridge); else `<Hangup/>` | none (TwiML) |
| `<Number statusCallback>` | `twilio-voice-inbound?stage=mobile_leg_status&…same…` `statusCallbackEvent="initiated ringing answered completed"` | signature + same cross-checks; appends `provider_outcomes` only; never transitions stages; transient ⇒ 503 | `#rc=3&rp=5xx,ct,rt` |
| `<Record recordingStatusCallback>` | `twilio-recording-status?source=voicemail&call_row_id&org_id&attempt_id&mailbox=<agent:uuid|group>` | signature; voicemail pipeline (§10) | `#rc=3&rp=5xx,ct,rt` |
| `<Record action>` | `twilio-voice-inbound?stage=voicemail_done&…` | finalize completed | none |

Nothing in any URL is trusted without the signature; `agent_id`/`attempt_id` are cross-checked against the persisted attempt, not believed. `checkAnsweredClientIdentity` and `claim_inbound_call` are **never** called for a PSTN leg.

### 8.4 First-answer concurrency and races
- Browser waves keep the existing CAS (`claim_inbound_call`, first-writer `provider_session_id`); losing legs never claim (C1).
- Owner vs. group cannot overlap on one call (one attempt row, one stage at a time).
- Two inbound calls for the same owner: the second planner sees the first attempt (`is_agent_busy`, 10-minute in-flight window) ⇒ `owner_voicemail`, so the first ring/mobile leg is never interrupted (D7, brief's race scenario).
- Duplicate `<Dial action>` / whisper / Gather deliveries: every transition is a CAS keyed on the persisted stage; redeliveries are read-only classifications (`{updated:false, reason:'stage_mismatch'}`) and answer the same TwiML class as the winner (whisper/accept re-derive from the attempt row: already accepted ⇒ `<Say>Connecting.</Say>`).
- Mobile accepted while the parent `<Dial>` ends (caller hung up during the whisper): `record_inbound_mobile_accept` still marks attribution; `twilio-voice-status` terminalizes the parent; no double ownership because `agent_id` stays NULL.

---

## 9. Change set D — Mobile handoff TwiML (`twiml.ts`)

```xml
<Dial timeout="{mobile_ring_seconds}" action="{stage=owner_mobile}" method="POST">
  <Number url="{stage=mobile_whisper}" method="POST"
          statusCallback="{stage=mobile_leg_status}#rc=3&amp;rp=5xx,ct,rt"
          statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">+1XXXXXXXXXX</Number>
</Dial>
```
- `buildMobileForwardTwiml(opts)` takes **no** recording option at all; a vitest source audit asserts the builder's output never contains `record` for any input and that the string `<Start>`/`<Record` never appears outside `buildVoicemailTwiml`. `buildForwardTwiml` (legacy org forwarding) is retained only for the legacy `fallback=` handlers.
- Whisper (P6, `mobile_accept_mode='press_1'`): `<Response><Gather numDigits="1" timeout="5" action="{stage=mobile_accept}" method="POST"><Say voice="Polly.Joanna">AgentFlow call from {escaped contact name | 'a caller'}. Press 1 to accept.</Say></Gather><Say>No answer. Goodbye.</Say><Hangup/></Response>`. `mobile_accept_mode='auto'` serves `<Response><Say>AgentFlow call from …</Say></Response>` (bridges immediately) and the answered `DialCallStatus` is the proof (today's semantics).
- Caller ID: unset (P7).
- **Twilio behaviors to verify on a live call before this stage is called done** (docs unreachable from this environment): (a) the callee-side `url` TwiML runs before bridging and a `<Hangup/>` there ends the leg without bridging; (b) after the Gather action returns non-hangup TwiML the legs bridge; (c) the parent `<Dial action>` then reports `DialCallStatus` (`completed` when bridged; `no-answer`/`busy`/`failed`/`canceled` otherwise; possibly `completed` for an answered-then-hung-up whisper — which is why acceptance never depends on `DialCallStatus`); (d) `<Number statusCallbackEvent>` values `initiated ringing answered completed`; (e) the default `callerId` for a `<Dial>` inside an inbound call.

---

## 10. Change set E — AgentFlow voicemail pipeline

- `twilio-recording-status/index.ts`: branch on the signed `source=voicemail` query (belt-and-braces: if the form carries `RecordingSource` and it is not `RecordVerb`, log a mismatch and still trust the signed query). Voicemail branch reuses `runRecordingPipeline`/`classifyRecordingRow`/CAS from `idempotency.ts` parameterized to the `voicemails` row: download `${RecordingUrl}.mp3` → upload to `voicemails/<org>/<call_row_id>/<RecordingSid>.mp3` (upsert) → `upsert_voicemail_from_recording` (status `stored`, path, duration, mailbox from the signed query, `calls.voicemail_id` set) → only then `DELETE` the Twilio recording → `insertVoicemailNotifications` (event key `voicemail:<call_id>`, recipients = mailbox agent, or group snapshot ∪ current group ∪ org Admins; `ignoreDuplicates` upsert on `(user_id,event_key)`). Any failure before verified persistence ⇒ row `status='failed'`-sentinel + **503** so Twilio redelivers; delete failure after persistence ⇒ 503 `stored_cleanup_failed` (cleanup-only retry, exact-SID match). A second `RecordingSid` for the same call becomes a second `voicemails` row (unique on `recording_sid`), never a skip; `calls.voicemail_id` keeps pointing at the first stored row and history surfaces list every stored voicemail for the call.
- Conversation recordings (no `source` param) take the untouched existing path: `recording_*` columns, `call-recordings` bucket.
- Media preservation rules carried over from R17/C6: never overwrite the first recording, never delete a different Twilio source, never show an unstored voicemail as ready (`status='stored'` gates playback).
- Retention (P13): `recording-retention-purge` gains a voicemail pass (`voicemails_expired_batch` + object removal + `status='purged'`).
- Missed-call semantics: the missed mark and notification still happen once at the voicemail-entry (or hangup) moment, with the owner as tier-0 recipient for D7/D11 paths where no browser wave rang (`notification-recipients.ts` tiers 1–4 unchanged after tier 0). Missed-call and voicemail notifications never imply a human answered.

---

## 11. Files to touch (complete list) and explicit non-touches

**Frontend (edit):** `src/contexts/TwilioContext.tsx` (lifecycle/readiness/presence/ringtone wiring only), `src/lib/twilio-voice.ts` (`destroying` promise, `onDeviceReady`), `src/components/layout/FloatingDialer.tsx`, `src/pages/DialerPage.tsx` (one deletion), `src/contexts/AgentStatusContext.tsx`, `src/components/layout/TopBar.tsx`, `src/components/settings/profile/ProfileInfoCard.tsx`, `src/components/contacts/AgentModal.tsx`, `src/lib/incomingCallAlerts.ts`, `src/components/settings/InboundRoutingManager.tsx`, `src/components/settings/inbound-routing/inboundRoutingSchema.ts`, `src/components/settings/CallRecordingSettings.tsx`, `src/components/settings/MyProfile.tsx`, `src/components/conversations/ConversationThread.tsx`, `src/components/dialer/ConversationHistory.tsx`, `src/components/contacts/FullScreenContactView.tsx`, `src/components/notifications/*` (type `voicemail` presentation), `src/integrations/supabase/types.ts` (regenerated), test mocks `src/components/layout/__tests__/topBarViewAsShell.test.tsx`, `viewAsRouteAllowlist.test.tsx`.
**Frontend (new):** `src/lib/phonePresence.ts`, `src/lib/ringtoneOutputs.ts`, `src/lib/voicemails.ts`, `src/components/settings/profile/ProfileRingtoneOutputCard.tsx`, `src/components/settings/profile/ProfileInboundCard.tsx`, `src/components/settings/inbound-routing/InboundGroupCard.tsx`, `src/components/settings/inbound-routing/RingDurationsCard.tsx`, `src/components/ui/VoicemailPlayer.tsx`, `src/components/dialer/ConnectionDiagnostics.tsx`.
**Frontend (delete):** `src/components/dialer/IncomingCallModal.tsx`.
**Edge (edit):** `supabase/functions/twilio-voice-inbound/index.ts`, `routing.ts`, `twiml.ts`; `twilio-recording-status/index.ts`, `idempotency.ts`; `_shared/notifications.ts`, `_shared/notification-recipients.ts`; `recording-retention-purge/index.ts`. **Edge (new):** `twilio-voice-inbound/planner.ts`, `stages.ts`. `inbound-call-claim`, `twilio-voice-status`, `twilio-voice-webhook`, `twilio-token`, `repair-twilio-number-ownership`, `_shared/twilioNumberConfig.ts` — **not modified** (no number-level webhook change ⇒ no `reconcile_callbacks` dependency for the new behavior).
**Database (new):** M4–M7 under `supabase/migrations/`, their rollback files under `supabase/migrations/rollback/`, SQL suites under `supabase/tests/` (§12), `scripts/run_inbound_sql_tests.sh` extended to apply M4–M7.
**Docs:** `implementation_plan.md` (this), `WORK_LOG.md` (newest-first entry), `AGENT_RULES.md` (§16 proposals).
**Explicitly NOT touched:** applied migrations; `calls` RLS; `profiles` grants/guard; `claim_inbound_call`; `finalize_inbound_call_terminal`; `dialer_sessions`/`get_dialer_campaign_presence`; campaign calling windows; `business_hours` data; outbound `makeCall`/`device.connect()` path and browser `.webm` recording; `call-recordings` policies; Supabase GitHub integration settings; Twilio number configuration.

---

## 12. Tests (fail-first) and static gates

**Vitest (pure modules and UI):**
- `src/lib/__tests__/inboundPlanner.test.ts` — every eligibility branch of §4 (owner DND/busy/offline/available; ineligible owner ⇒ group; group filtering; empty group ⇒ shared voicemail; after-hours identical plan; presence advisory).
- `src/lib/__tests__/inboundStages.test.ts` — stage machine on `DialCallStatus` × accepted flag; replay of each callback is read-only; legacy `fallback=` handlers still dispatch.
- `src/lib/__tests__/inboundTwiml.test.ts` (extend) — `buildMobileForwardTwiml` never emits `record*`; whisper/accept TwiML shapes; 20 s timeouts; all signed URLs carry the expected params; retry fragment on `statusCallback`/`recordingStatusCallback` only.
- `src/lib/__tests__/mobileAcceptCallback.test.ts` — signature-first, cross-checks, `Digits!=='1'` ⇒ hangup, never imports `checkAnsweredClientIdentity`/`claim_inbound_call` (source audit).
- `src/lib/__tests__/voicemailRecordingBranch.test.ts` — `source=voicemail` routing, verified-persist-then-delete order, 503 on failure, second `RecordingSid` ⇒ second row, conversation path untouched (existing recording suites stay green).
- `src/lib/__tests__/voicemailNotifications.test.ts` — recipients (agent/group/admins), idempotent event key, tier-0 missed-call recipients for D7/D11.
- `src/lib/__tests__/phonePresence.test.ts`, `ringtoneOutputs.test.ts`, `availabilityContext.test.tsx` (writes own row only; no-op under View As; reconnect never writes), `deviceLifetime.test.tsx` (render `TwilioProvider` + `FloatingDialer`/`DialerPage` stubs: close/minimize/end-session never call `destroyTwilioDevice`; realProfile→null and unmount do), `topBarAvailability.test.tsx`, `profileRingtoneOutput.test.tsx` (test tone only on click), source audits extended: `inboundBrowserLifecycleWrites` (still exactly 6 write sites) and a new `mobileLegNeverRecorded.test.ts`.
**SQL suites (disposable localhost only, `BEGIN…ROLLBACK`, harness extended with M4–M7):** `inbound_presence.sql` (heartbeat identity from `auth.uid()`, other-tab cannot unregister, freshness helper), `inbound_route_attempts.sql` (create idempotent, CAS advance, replay read-only, `record_inbound_mobile_accept` idempotent and never sets `agent_id`/`duration`, `is_agent_busy` ceilings incl. stale rows), `inbound_voicemails.sql` (RLS: recipient/group/admin/other-agent/other-org; storage predicate; second recording row), plus re-runs of the four existing suites and the RLS Phase 1 postconditions.
**Static gates:** `npx tsc --noEmit` (exit 0) and `tsc -p tsconfig.app.json` multiset-compared to the 81-error `main` baseline (zero new); `npx eslint` on touched files; `npm run build`; esbuild bundle check per touched Edge function (`deno check` unavailable here — reported, not routed around); migration static checks (no top-level DML; localhost replay).

---

## 13. Verification matrix (evidence required for closeout; live rows need Chris's authorized real calls)

| Scenario (from the brief) | How it is proven | Where this session cannot prove it |
|---|---|---|
| Panel closed/minimized; campaign session ended | vitest `deviceLifetime` + live: close panel, end session, then a real inbound rings the same browser | live call |
| Different CRM route and background tab | live: audible ringtone on selected outputs; desktop pop-up while hidden; ring UI un-minimizes | audible proof is human-only |
| Browser disconnected / session expired / computer asleep | presence goes stale ⇒ planner skips browser; UI shows `connecting`, not green (unit + live) | live |
| Availability changed or page reloaded | `availabilityContext` tests + live reload/reconnect keeps DND; server routes on DB value | live |
| On Break / DND incl. after reconnect | planner tests + live: neither browser nor mobile rings; voicemail lands in the agent's mailbox | live |
| Assigned contact | planner tests + live: owner rings first, no agency-wide wave; attempt row shows `mode='owner'` | live |
| Browser unanswered | live: 20 s ring then the mobile rings; `provider_outcomes` shows both | live |
| Mobile accepted / rejected / personal voicemail picked up | stage tests + live ×3: `mobile_accepted` and `answered_by_agent_id` only on Press 1; machine pickup ⇒ AgentFlow voicemail | live (TwiML semantics §9) |
| Mobile answered, agency recording on and off | source audit + live: no recording on parent or child; `calls.duration` from parent; subsequent voicemail still recorded when applicable | live |
| Agent busy; two inbound calls race | `is_agent_busy` SQL tests + live two-call test: first survives, second ⇒ voicemail, no double ownership | live |
| After hours | planner tests + live after-hours call routes normally; SMS behavior unchanged; `business_hours` rows untouched | live |
| Unknown caller / empty group / ambiguous contact | planner tests + SQL RLS tests on the shared mailbox + live | live |
| Two tabs, delayed callbacks, repeated webhooks | SQL replay tests + a controlled redelivery (re-POST a captured signed callback) | partial |
| Voicemail media upload failure and retry | recording-branch tests (503 path) + a controlled storage failure in staging | staging |
| Ordinary outbound call | existing outbound snapshot tests + live outbound: `device.connect()`, `calls` insert, duration/status, recording, disposition, locks, reports | live |

**Unproven items that stay unproven until executed:** the Twilio callback reconciliation (waived), the unsigned `inbound-call-claim` probe (waived), the earlier live inbound validation (deferred) — this plan neither depends on them being passed nor describes them as passed. The new TwiML-embedded callbacks carry their own retry fragment; parent-leg redelivery on legacy number webhooks remains the documented residual risk.

---

## 14. Release order, gates, rollback and recovery

1. **Plan approval** (this document) — then implementation on this branch (fail-first tests → M4–M7 authored + localhost replay → Edge changes → frontend → gates → WORK_LOG/AGENT_RULES → push). No PR is opened unless Chris asks.
2. **Production migrations** (separate approval + `#APPROVE_RLS_CHANGE` token): read-only preflights (`list_migrations`, `availability_status` distinct values, no duplicate `inbound_routing_settings` rows) → apply M4 → M5 → M6 → M7 via MCP `apply_migration`, verify each with catalog postconditions → regenerate types → Supabase security/performance advisors, reporting only findings caused by these objects.
   Rollback: `rollback/…M7.sql` (drop policies/bucket/objects/table, restore `notifications_type_check`, drop `calls.voicemail_id`), then M6, M5, M4 — additive objects only, no data loss for existing tables; `voicemails` objects would be lost, so rollback of M7 is gated on zero stored voicemails or an export.
3. **Edge deploys** (separate approval; each: `get_edge_function` first, full package, `verify_jwt=false` preserved, byte-verified after): `twilio-recording-status` (inert until TwiML emits `source=voicemail`) → `recording-retention-purge` → `twilio-voice-inbound` (activates the new planner). Ordering guarantees the recording branch exists before any voicemail callback can hit it. Rollback = redeploy the preserved byte-verified v44/v34 packages; the legacy `fallback=` handlers remain in the new build so in-flight calls at either switch complete.
4. **Frontend release** (Vercel, separate approval) — can ship before or after step 3: the lifecycle/availability/audio changes are compatible with the current server; presence heartbeats are best-effort and require M4 (if released before M4 the RPC call fails softly and is logged). Rollback = Vercel redeploy of the previous build.
5. **Live acceptance** — the §13 matrix with Chris's authorized real calls (mobile acceptance and audible ringtone are human-verified), then closeout with a context snapshot. Twilio configuration and number webhooks are **not** changed by this plan.

---

## 15. Conflicts with repository invariants (flagged, not weakened)

| Invariant | Interaction | Resolution |
|---|---|---|
| #30 "answered-ness has exactly two durable proofs" | Mobile acceptance adds attribution (`answered_by_agent_id`) but no third *answered-ness* proof: outcome stays `forwarded_answered`. | Rule text amended to name the attribution column (§16); `agent_id` semantics unchanged. |
| #30 R13 strict Client identity | A PSTN leg must never pass the claim validator. | Separate signed stage handlers; source audit forbids importing the validator or the claim RPC in the mobile path. |
| #30 C13 zero browser inbound calls-row writes | Presence heartbeat is a browser write — to a **new** table, never `calls`. | Audited: `inboundBrowserLifecycleWrites` unchanged at 6 sites. |
| #30 R14 routed persistence precedes ringing | Extended: the attempt row and `append_call_routed_agents` both precede TwiML. | Suppression path mirrors today's. |
| #8 sole duration writer | No new writer; `record_inbound_mobile_accept` and stage RPCs never touch `duration`. | SQL test pins it. |
| #9 re-entrancy refs | Untouched; `destroyClientRef` is additive like `hangUpRef`. | — |
| #20 profiles protection | No new profile column; one CHECK on `availability_status`; TopBar writes through the existing own-row grant. | Guard/grants unchanged. |
| #25 immutable migrations | Four new files; nothing edited. | — |
| #28 read-only production | All production steps are approval-gated; no backfill (P2 avoids one); no deletes. | — |
| RLS gate | New tables' policies + storage policy need `#APPROVE_RLS_CHANGE`. | Requested in §7.6. |
| #31 realProfile pin | Presence, availability writes, ringtone prefs and diagnostics key on `realProfile`; nothing runs under the effective profile; View As hides the picker and blocks writes. | — |
| §7 component size | New UI in new files < 200 lines; `TwilioContext`/`DialerPage` receive wiring only. | — |
| Tests that pin source strings | `twilioViewAsIdentity` mock list, `inboundBrowserZeroWrites` tokens, C14 marker — all preserved; new imports live in new modules. | — |

---

## 16. Proposed durable rule updates (authored with the change, not before approval)

- **AGENT_RULES #32 (new)** — *Inbound routing v2:* the Device's lifetime is owned by `TwilioProvider` (register on real identity, unregister on identity loss/unmount; UI panels and campaign sessions never destroy it); manual availability is `profiles.availability_status` written only by explicit user action; reachability is the advisory `agent_phone_presence` heartbeat (3-minute freshness); busy is derived, never stored; one `inbound_route_attempts` row per inbound call is created before TwiML and every stage transition is a CAS; mobile legs are built by `buildMobileForwardTwiml`, which cannot emit recording attributes, and human acceptance is proven only by the signed Gather action (`Digits=1`) recorded via `record_inbound_mobile_accept`, which writes `answered_by_agent_id` and never `agent_id`; voicemail media lives in the `voicemails` bucket/table with its own mailbox authorization and is never written to `calls.recording_*`; `notifications.type='voicemail'` uses event key `voicemail:<call_id>`.
- **AGENT_RULES #30 amendment** — attribution column named; the legacy `fallback=` handlers' removal tracked as a follow-up.
- **WORK_LOG** — newest-first entry per step (implementation, applies, deploys, verification, blockers), keeping the waived/deferred items stated as not passed.

---

## 17. What Chris is asked to rule on (supporting defaults only — D1–D12 are not re-asked)

P1 direct-line owner · P2 `all_active` default group · P3 shared-mailbox access set · P4 ineligible owner ⇒ group · P5 mobile ring 20 s · P6 Press-1 with an `auto` off-switch · P7 caller ID on the mobile leg · P8 busy ceilings (4 h / 10 min) · P9 presence freshness (3 min / 60 s) · P10 retiring `voicemail_enabled`/`fallback_action`/`routing_mode`/fallback chain from routing · P11 retiring per-number overrides except `is_direct_line` · P12 `answered_by_agent_id` · P13 voicemail retention · P14 availability CHECK — plus the `#APPROVE_RLS_CHANGE` token for §7.6 and the go-ahead to implement.

---

## 18. Limits of this planning session (stated, not hidden)

- Twilio documentation could not be fetched (egress proxy); TwiML-level behaviors in §9 are marked for live verification; SDK facts are from the 2.18.1 package sources.
- `deno` is not installed; Edge code will be checked with esbuild bundling and vitest over the pure modules, as in the 2026-08 release.
- The automated adversarial review pass over this plan could not run (subagent session limit until 2026-09-11 09:20 UTC); the invariant table in §15 and the refutation table in §2 were produced by direct code reads. A second independent review before implementation is recommended.
- No live inbound call, Twilio console, or child-leg call records were available; the incident attribution in §3 is evidence-based and remains unproven.
