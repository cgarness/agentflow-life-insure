# AgentFlow | Living Roadmap 🚀

**Owner:** Chris Garness | **Last Updated:** April 9, 2026
**Niche Focus:** Life Insurance Agencies (High-Velocity CRM & Power Dialer)

---

## 1. System Status & Module Health

### 🔐 Authentication & Tenant Isolation `[STABLE]`
- **State**: Supabase Auth triggers `profiles` mirroring. Multi-tenant isolation is enforced via custom JWT claims (`organization_id`, `role`) and hierarchical `ltree` logic for downline management.
- **Recent Update**: Standardized `leads.user_id` and implemented `standardize_leads_user_id.sql` to ensure perfect ownership tracking.
- **Next Up**: Finalize invitation logic for Managers to invite downline Agents with auto-assigned `upline_path`.

### 🏗️ Database Infrastructure `[AUDITED — REWORKING]`
- **State**: The core table audit (Step 2) identified critical missing root objects.
- **Gaps**: Missing physical `organizations` table, `tasks` (follow-ups), and `dial_sessions` (metrics blocks).
- **Next Up**: Execute **SaaS Core Migration Block** to create `organizations` (multi-tenancy root), `tasks`, and `dial_sessions`.

### 📞 Power Dialer & Telephony `[PRODUCTION-READY]`
- **State**: 1-Line WebRTC Dialer (Telnyx) with Auto-Dial support. State management is decentralized via Supabase Edge functions and real-time triggers.
- **Features**: Smart Caller ID (Local Presence), Ring Timeout, and mandatory dispositions. (Answering Machine Detection was removed — bridge on answer only.)
- **Next Up**: Optimize campaign refresh logic and integrate `dial_sessions` to track agent efficiency in real-time.

### 💼 SaaS & Infrastructure `[PLANNED — CRITICAL]`
- **State**: Entirely missing billing and SaaS partitioning layer.
- **Features Required**: Stripe integration, subscription tiers (Starter, Pro, Agency), and plan-based limiting (User caps, Dialing limits).
- **Next Up**: Initialize Stripe SDK and construct the `billing` Edge Function for subscription lifecycle management.

---

## 2. Recent Database Migration History (April 2026)

| Migration ID | Topic | Outcome |
| :--- | :--- | :--- |
| `20260404000000` | `standardize_leads_user_id.sql` | Aligned all lead ownership to unified `user_id` field for RLS performance. |
| `20260404000001` | `fix_leads_user_id_drift.sql` | Repaired historical lead data drift where ownership mapping was disconnected. |
| `20260404100000` | `dialer_rls_audit.sql` | Hardened Row-Level Security for campaigns and dialer state components. |
| `20260405000000` | `sync_leads_user_id_trigger.sql` | Added real-time trigger to sync master lead ownership with campaign states. |
| `20260405100000` | `smart_queue_lock_system.sql` | Atomic fetch-and-lock for Team/Open Pool campaigns. `dialer_lead_locks` table + 3 RPCs. |
| `20260406000000` | `hard_claim_engine.sql` | `claim_lead` RPC (SECURITY DEFINER) for permanent ownership transfer via `leads.assigned_agent_id`. Added `queue_filters` JSONB column to `campaigns`. |
| `20260406200000` | `add_leads_to_campaign_rpc.sql` | `add_leads_to_campaign` RPC (SECURITY DEFINER) enforcing Personal/Team/Open ownership rules before inserting into `campaign_leads`. |
| `20260406400000` | `dialer_lead_locks.sql` | `fetch_and_lock_next_lead` RPC (90s TTL, no leads JOIN) + `release_all_agent_locks` RPC + composite index on `(campaign_id, expires_at)`. |
| `20260406500000` | `fix_campaign_leads_user_id.sql` | Hotfix: ensures `user_id` column exists on `campaign_leads` (IF NOT EXISTS + backfill from `claimed_by`); recreates `add_leads_to_campaign` without `user_id` in INSERT (column DEFAULT handles it). Resolves "column user_id does not exist" runtime error. |
| `20260406600000` | `campaign_leads_scheduled_callback.sql` | Added `scheduled_callback_at` (TIMESTAMPTZ) to `campaign_leads` for native prioritization. |
| `20260406700000` | `enterprise_waterfall_rpc.sql` | `get_enterprise_queue_leads` RPC: full DB-level filtering (Timezones, Max Attempts, Retry Intervals). |
| `20260406800000` | `fix_enterprise_rpc_columns.sql` | Fixed column mismatch in `get_enterprise_queue_leads` RPC; ensured perfect `SETOF` alignment. |
| `20260406900000` | `patch_enterprise_rpc_nulls.sql` | Patched RPC with `COALESCE` guards for NULL states, statuses, and call_attempts. |
| `20260406950000` | `robust_rpc_signature.sql` | Aligned RPC signature with JS payload; cleared schema cache overloads. |
| `20260407000000` | `dialer_telemetry_hardening.sql` | `get_org_id()` graceful fallback to profiles table; re-applied `get_enterprise_queue_leads` with `SET search_path`; PostgREST cache reload. |
| `20260409120000` | `hierarchical_calls_rls.sql` | Replaced strict owner-only `calls` RLS with Admin (org) + Team Leader / `Team Lead` (downline via `is_ancestor_of`) + Agent (own); backfill `contact_activities.organization_id` from `leads`. |

---

## 3. Work Log (Recent History)

- **2026-04-09 | [DONE] Call recordings — hierarchy, library scope, webhook hardening, UI**
  *Files Modified:* `supabase/migrations/20260409120000_hierarchical_calls_rls.sql`, `supabase/functions/telnyx-webhook/index.ts`, `src/components/settings/CallRecordingLibrary.tsx`, `src/lib/dialer-api.ts`, `src/components/dialer/ConversationHistory.tsx`, `ROADMAP.md`
  *Developer Note:* **`calls` RLS** matched the leads model so managers/admins see downline recordings in Conversation History and can update coaching flags; agents still see only their own calls. Policy allows both JWT role strings **`Team Leader`** and **`Team Lead`** (same as `campaign_leads`). **Recording Library** filters `calls` and `dispositions` by current `organization_id` (via `useOrganization`); super-admins without an org still use RLS-only scope. **`telnyx-webhook`:** `call.recording.saved` tries `telnyx_call_control_id` first, then falls back to `telnyx_call_id` = `call_session_id`; hangup activity rows now use `activity_type` (was invalid `type`), plus `organization_id` and `agent_id` for org-scoped history. **`getLeadHistory`** loads disposition colors for call badges; **Conversation History** labels the inline player as “Call recording” and uses `preload="metadata"`. **Apply** the new migration on Supabase and **redeploy** `telnyx-webhook`.

- **2026-04-09 | [DONE] Docs — VISION, agent rules, internal docs: single-leg dialer**
  *Files Modified:* `VISION.md`, `AGENT_RULES.md`, `docs/index.html`, `src/pages/DialerPage.tsx` (ring-timeout comment)
  *Developer Note:* Product copy and AI protocols now describe **single-leg WebRTC** (`newCall` in browser) as canonical. `AGENT_RULES` forbids reintroducing two-legged server dial + SIP bridge flows unless explicitly requested. `docs/index.html` telephony module and sequence diagram updated; stale two-legged comment in `DialerPage` removed.

- **2026-04-09 | [DONE] Architecture — Switch to One-Legged WebRTC Calling (eliminate SIP transfer)**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `supabase/functions/telnyx-webhook/index.ts`, `supabase/functions/telnyx-token/index.ts`, `ROADMAP.md`
  *Edge Functions Deployed:* `telnyx-webhook` (project `jncvvsvckxhqgqvkppmj`, `verify_jwt: false`), `telnyx-token`
  *Developer Note:* **ROOT CAUSE** of no-audio-on-either-side: the two-legged architecture (REST API outbound call + SIP transfer back to agent WebRTC) required SIP URI Calling on the Connection and exact `sip_username` matching — both of which were broken. The SIP transfer was going to a `sip:{credential_name}@sip.telnyx.com` address that nobody was registered at, so the bridge never formed. With AMD removed, there is no reason for server-side call initiation.
  **Fix — One-legged WebRTC calling:** Replaced the entire call flow. `makeCall()` now uses the `@telnyx/webrtc` SDK's `client.newCall()` to dial the customer directly. Audio flows natively through the WebRTC channel — no SIP transfer, no bridge, no `handleHumanDetected`. The SDK handles all media negotiation (SDP, ICE, SRTP) automatically. `clientState: btoa(callRecord.id)` is passed so Telnyx webhooks (`call.initiated`, `call.answered`, `call.hangup`) still link back to our DB record. The `dialer-start-call` Edge Function is no longer invoked (kept in repo for reference).
  **Removed:** `telnyxTransfer()`, `handleHumanDetected()`, `bridgeAutoAnsweredRef`, auto-answer bridge logic. These were all part of the two-legged approach.
  **Kept:** `handleCallInitiated` (links `call_control_id` to DB), `handleCallAnswered` (updates status + starts recording if enabled), `handleCallHangup` (finalizes DB + activity log), `dialer-hangup` Edge Function (server-side PSTN teardown), ring timeout, call recording, smart caller ID.
  **Hangup detection now works:** With one-legged calling, when the customer hangs up, the WebRTC session itself ends. The SDK fires `telnyx.notification` with `state: "destroy"` and the `RTCPeerConnection` `connectionstatechange` also fires — both trigger `setCallState("ended")`.
  **telnyx-token:** Also fixed credential `sip_username` sync (saves real Telnyx `gencred*` username to profile). This is still needed for future inbound call support.

- **2026-04-09 | [DONE] Dialer — ring timeout vs two-legged answer + bridge auto-answer + dial payload**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `supabase/functions/dialer-start-call/index.ts`, `supabase/config.toml`, `ROADMAP.md`
  *Developer Note:* **Root cause:** `DialerPage` enforced a strict ring timer on `telnyxCallState === "dialing"` even when the PSTN leg was already answered — the webhook sets `calls.status` to `connected` before the agent WebRTC leg reaches `active`, so the UI hung up a live call at 15s. **Fix:** Before strict hangup, read `calls.status`; if `connected`, skip hangup and set `callWasAnswered`. Added optional Realtime subscription on `calls` for the same (requires `calls` in `supabase_realtime` publication to receive events; timeout check works regardless). **TelnyxContext:** Ring-timeout hangup now also skips when the call row is `connected`. Bridge auto-answer runs on `early` as well as `ringing`/`trying`, uses `bridgeAutoAnsweredRef`, and allows `activeCallIdRef` when React state lags. **dialer-start-call:** Removed `answering_machine_detection: 'premium'` to align with AMD removal and reduce answer delay.
  *Production (2026-04-09):* **Edge Function** `dialer-start-call` deployed to project `jncvvsvckxhqgqvkppmj`. **Migration** applied via Supabase MCP as `session_duration_increment_dialer_stats` (same SQL as `20260408010000_session_duration.sql`: `session_duration_seconds` column + `increment_dialer_stats` 8-arg signature + `GRANT` + `NOTIFY pgrst, 'reload schema'`).
  *Hotfix (2026-04-09):* `dialer-start-call` **v59** — set **`verify_jwt: false`** on the function (gateway was returning `401 Invalid JWT` before the handler; auth remains `anonClient.auth.getUser` inside the function, same pattern as `dialer-hangup`). `supabase/config.toml` updated with comment.

- **2026-04-09 | [DONE] Telephony — bidirectional audio (WebRTC + bridge)**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `supabase/functions/telnyx-webhook/index.ts`, `ROADMAP.md`
  *Developer Note:* Per `@telnyx/webrtc` README, **`client.remoteElement`** must be set so the SDK attaches remote RTP to an `<audio>` element; manual `srcObject` alone is unreliable for bridged calls. **Auto-answer:** refresh `getUserMedia` if tracks are dead, set **`call.options.localStream`** before **`await call.answer()`** so the mic reaches the customer. Log when `active` has no `remoteStream` tracks. **telnyx-webhook:** `telnyxTransfer` sends optional **`from`** (E.164) for the new SIP leg; **`handleHumanDetected`** falls back to DB lookup by **`telnyx_call_control_id`** when `client_state` is missing on `call.answered`. **Deploy:** `telnyx-webhook` redeployed to `jncvvsvckxhqgqvkppmj` (CLI).

- **2026-04-09 | [DONE] Floating dialer — preserve WebRTC client + drag handle only on header**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/components/layout/FloatingDialer.tsx`, `ROADMAP.md`
  *Developer Note:* Opening the floating panel called `initializeClient()`, which always disconnected the existing Telnyx client — dropping the live call object (`callRef`) while the UI still showed in-call, so mute/hold did nothing. Init is now skipped when `client.connected` and the same `organization_id` as last `telnyx.ready` (`telnyxConnectedOrgIdRef`). Floating dialer no longer calls `destroyClient` on panel close (shared client with campaign dialer). Drag listeners moved from the full panel to the header row only; `setPointerCapture` on the header still allows dragging outside the bar.

- **2026-04-09 | [DONE] Remove Answering Machine Detection (AMD)**
  *Files Modified:* `supabase/functions/telnyx-webhook/index.ts`, `supabase/config.toml`, `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/components/dialer/DialerActions.tsx`, `src/components/dialer/CampaignSettingsModal.tsx`, `src/components/settings/PhoneSettings.tsx`, `src/hooks/useDialerStateMachine.ts`, `ROADMAP.md`
  *Files Removed:* `supabase/functions/telnyx-amd-start/index.ts` (unused; AMD was started inline from webhook)
  *Developer Note:* Outbound `call.answered` now always runs `handleHumanDetected` (SIP bridge + optional recording). Telnyx `call.machine.*` webhooks are logged and ignored so stray connection-level AMD does not double-bridge or auto-hangup. Frontend: removed AMD UI, realtime `calls` subscription, ring-timeout “human confirmed” guard, and campaign/phone settings toggles. Saving calling settings sets `phone_settings.amd_enabled` to `false`. DB columns (`amd_enabled`, `calls.amd_result`, `dialer_daily_stats.amd_skipped`) left in place for history; no migration. **Deploy:** redeploy `telnyx-webhook`. **Telnyx portal:** disable AMD on the Connection/App if it was enabled there.

- **2026-04-09 | [DONE] Feature — Wire Call Recording End-to-End**
  *Files Modified:* `supabase/functions/telnyx-webhook/index.ts`, `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `src/components/dialer/ConversationHistory.tsx`, `ROADMAP.md`
  *Edge Function Deployed:* `telnyx-webhook` v339 (project `jncvvsvckxhqgqvkppmj`, `verify_jwt: false`)
  *Developer Note:* Wired automatic call recording end-to-end. Added `isRecordingEnabled()` helper and `telnyxRecordStart()` helper to the telnyx-webhook Edge Function. After `handleHumanDetected()` bridges the agent via `telnyxTransfer()`, the webhook now queries `phone_settings.recording_enabled` and issues `POST /v2/calls/{id}/actions/record_start` (mp3, dual channel, no beep) if enabled. Recording failure is wrapped in try/catch — never crashes the call. The existing `handleRecordingSaved()` handler already writes `recording_url` to the `calls` table (no changes needed). On the frontend, `getLeadHistory()` now fetches `recording_url` from the calls table and passes it through the `HistoryItem` interface. `ConversationHistory.tsx` renders an inline `<audio>` player (`preload="none"`) for call items with a recording URL. `CallRecordingLibrary.tsx` already had the correct `.not('recording_url', 'is', null)` filter and audio player column — no changes needed. Verified with `npx tsc --noEmit`.
  *Context Snapshot:* Recording toggle in Settings controls `phone_settings.recording_enabled`. When a human is detected and the agent is bridged, recording starts automatically. Telnyx fires `call.recording.saved` on hangup, which writes the URL to `calls.recording_url`. The Conversation History and Recording Library both surface recordings with inline audio players. Next: test with a live call with `recording_enabled = true`.

- **2026-04-09 | [DONE] Floating dialer — mute/hold, remote hangup, mid-call ring**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/components/layout/FloatingDialer.tsx`, `ROADMAP.md`
  *Developer Note:* Hold button in `FloatingDialer` had no click handler; it now calls `toggleHold` with Resume/Hold UI from `isOnHold`. Mute uses `toggleAudioMute` when available, then `muteAudio`/`unmuteAudio`, then local `MediaStream` track fallback. When the call becomes `active`, the Telnyx SDK’s `stopRingback` / `stopRingtone` run so local ringback does not continue into the conversation. Remote party hang-up is also detected via `RTCPeerConnection` `connectionstatechange` (`failed` / `closed`) when Verto does not emit `destroy`/`hangup` or `-32002`. Fixed stale React `callState` in the Verto notification handler by using `callStateRef` for the bridge auto-answer guard. Hang-up-during-dial race uses `callStateRef` instead of a stale `[]`-closure `callState`. Finalize duration on remote hang-up uses `callDurationRef` for accurate seconds.

- **2026-04-09 | [DONE] Refactor — CreateCampaignModal & TagInput Extraction**
  *Files Created:* `src/components/campaigns/CreateCampaignModal.tsx`, `src/components/shared/TagInput.tsx`
  *Files Modified:* `src/pages/Campaigns.tsx`, `src/pages/CampaignDetail.tsx`, `src/components/contacts/ImportLeadsModal.tsx`, `ROADMAP.md`
  *Developer Note:* Refactored the monolithic `CreateCampaignModal` in `Campaigns.tsx` into a standalone, Zod-validated component. Streamlined the "Personal" campaign creation workflow by auto-assigning the current user and hiding redundant agent selection UI, replaced by a badge. Successfully extracted the inline `TagInput` component into a shared utility, reducing code duplication across `Campaigns.tsx`, `CampaignDetail.tsx`, and `ImportLeadsModal.tsx`. Fixed type errors in `CampaignDetail.tsx` related to missing Supabase RPC definitions for `add_leads_to_campaign`. Used Zod for form validation to ensure data integrity. Total code reduction in `Campaigns.tsx` and `CampaignDetail.tsx` is over 300 lines. Verified with `npx tsc --noEmit`.

- **2026-04-08 | [DONE] Fix Dialer Flickering — End-State Double-Fire + isAdvancing Ref Guard**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/components/dialer/DialerActions.tsx`, `ROADMAP.md`
  *Developer Note:* Dialer was flickering between leads on hangup and skip because the call-ended effect fired twice per call end. Root cause: TelnyxContext's `hangUp()` sets `callState("ended")`, then 200ms later resets to `"idle"` via a deferred timeout. When the WebRTC `"destroy"` notification arrived afterward and set `"ended"` again, `hasProcessedEndedState` had already been reset on the `"idle"` transition — so the call-ended effect processed the same hangup a second time, causing a double advance (lead A → B → C flicker).
  **Fix 1 — endStateProcessedRef (TelnyxContext):** Added `endStateProcessedRef` that is set by whichever handler processes the call end first (`hangUp()`, `telnyx.error -32002`, or `telnyx.notification destroy`). Subsequent handlers check the ref and skip re-triggering `setCallState("ended")` and deferred reset timers. Reset at the start of each new `makeCall()`.
  **Fix 2 — hasProcessedEndedState reset on dialing only (DialerPage):** Changed the reset condition from `telnyxCallState !== "ended"` (which fired on every `"idle"` transition) to `telnyxCallState === "dialing"` (only when a genuinely new call begins). Also clears `lastProcessedCallIdRef` in the same guard.
  **Fix 3 — isAdvancingRef (DialerPage):** Replaced stale-closure-prone `isAdvancing` state reads in `handleAdvance`, `handleSkip`, `handleLeadSelect`, and `fetchHistory` with a `useRef`-backed guard (`isAdvancingRef.current`). The ref is always current regardless of callback identity, eliminating the race where a stale closure reads `isAdvancing = false` when it's actually `true`.
  **Fix 4 — Skip button disabled during calls (DialerActions):** Skip button is now `disabled` when `telnyxCallState === "active" || "dialing"`, preventing agents from skipping mid-call.
  **Fix 5 — endResetRef cleanup (TelnyxContext):** All three deferred reset sites (`hangUp`, `telnyx.error`, `telnyx.notification`) now `clearTimeout(endResetRef.current)` before setting a new timeout, preventing overlapping timers from double-firing the idle reset.

- **2026-04-08 | [DONE] Auto-dial — stable next-contact transition (state machine + queue index)**
  *Files Modified:* `src/hooks/useDialerStateMachine.ts`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Auto-dial was resetting or firing with the wrong lead because `handleCall` lived in the effect dependency array (identity changes on every `dialerStats` bump), stale `setTimeout` closures read old Telnyx flags, and `isAdvancing` was never passed so timers could arm during queue/URL settling. The hook now uses refs for `onCall` / guards, keys the delay off `leadKey` only, clears or replaces pending timers when the lead changes, validates `leadKey` at fire time, and exposes `autoDialCountdownActive` + `cancelAutoDialCountdown` again. `applyQueueLifecycle` no longer uses `queueMicrotask` for `setCurrentLeadIndex` (one frame could show `leadQueue[i]` with a stale `i`); `pendingLifecycleIndexRef` + `useLayoutEffect` applies the new index before paint. `isAdvancing` clear delay set to ~320ms to cover URL/index sync.

- **2026-04-08 | [DONE] Orphan banner after refresh — silent recovery + hangup DB scoping**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `supabase/functions/dialer-hangup/index.ts`, `ROADMAP.md`
  *Developer Note:* `dialer-hangup` no longer adds `.eq(organization_id, …)` on the `calls` update (NULL/mismatch could match **zero rows** without surfacing an error, leaving `connected` forever). Update is scoped by `id` + `agent_id`, with `.select('id')` to fail if no row changed. On orphan detection, the app now **silently** calls `dialer-hangup` then a **client RLS fallback** update before showing the orange banner — refresh self-heals ghost rows. `finalizeCallRecord` drops the redundant `organization_id` filter for the same reason.

- **2026-04-08 | [DONE] Hotfix — Orphan-call banner loop + Vercel build (`ended_at`, `getTodayCallCount`)**
  *Files Modified:* `src/lib/dialer-api.ts`, `src/contexts/TelnyxContext.tsx`, `supabase/functions/dialer-hangup/index.ts`, `ROADMAP.md`
  *Developer Note:* The `calls` table column is **`ended_at`** (see generated types). `dialer-hangup` and `finalizeCallRecord` were updating a non-existent **`end_at`** field, so Postgres rejected the update and rows stayed `ringing`/`connected`. The orphan-call detector then kept finding the same row after every hang-up / navigation. Fixed both writers to use `ended_at`; `dialer-hangup` now throws if the DB update fails so we do not return success with a stale row. Restored **`getTodayCallCount`** in `dialer-api.ts` (referenced by `DialerPage` but missing after the history refactor), which unblocked the Vite/Rollup production build on Vercel.

- **2026-04-08 | [DONE] Perf — Faster, smoother dialer conversation history**
  *Files Modified:* `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `src/components/dialer/ConversationHistory.tsx`, `src/components/dialer/DialerSkeletons.tsx`, `ROADMAP.md`
  *Developer Note:* `getLeadHistory` now selects only columns needed for the timeline, orders + limits at the database (80 per source), and returns the last 100 merged events (smaller payloads). Lead transition drops the 150ms debounce (0ms tick), shows **cached** history immediately when revisiting a lead in the same session, and runs history + assigned-agent profile in **parallel** via `Promise.allSettled` so profile errors do not block history. Conversation list no longer animates every row on paint; skeleton drops the 200ms delay and uses a shorter fade.

- **2026-04-08 | [DONE] Bugfix — Dialer navigation glitch (arrows, queue, save & next vs `?contact=`) (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Two effects fought: (1) URL was not updated from `currentLead` while `isAdvancing` was true (advance/skip/selection), so `?contact=` stayed stale; (2) the contact→index effect listed `currentLeadIndex` in its dependency array, so it re-ran on every arrow/advance and reset the index to the **old** `?contact=` before the URL could update. Fix: always sync `?contact=` from `currentLead` whenever not `loadingLeads` (drop `isAdvancing` gate); drive contact→index only off `contactParam` + `leadQueue` and use a functional `setCurrentLeadIndex` to avoid redundant sets.

- **2026-04-08 | [DONE] Bugfix — Dialer queue clicks ignored when `?contact=` in URL (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* `handleLeadSelect` sets `isAdvancing` for 500ms, which blocked the effect that writes `contact` into the URL. A separate effect still read the **stale** `contact` param and called `setCurrentLeadIndex` to match it — snapping the index back to the old lead. Fix: update `?contact=` immediately inside `handleLeadSelect`, and skip the contact→index effect while `isAdvancing` or `loadingLeads`.

- **2026-04-08 | [DONE] Bugfix — Personal dialer: queue/contact gone + stuck navigation after hangup (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Root causes addressed: (1) `handleAdvance` / `handleSkip` used `Math.min(prev + 1, leadQueue.length - 1)`, which is **-1** when the queue is empty — `currentLeadIndex` became -1, `currentLead` null, and both chevrons stayed disabled until refresh. (2) `applyQueueLifecycle` read a **stale `leadQueue` closure** from the call-ended effect, so auto-disposition could run against an empty array and corrupt queue state. Fix: guard advance/skip when `length <= 0`; rewrite `applyQueueLifecycle` with functional `setLeadQueue` + `queueMicrotask` for index; clamp index in an effect when `leadQueue` changes; move `hasProcessedEndedState.current = true` to after duplicate-call-id early returns so guards cannot strand processing.

- **2026-04-08 | [DONE] Dialer Queue Hardening — 9-Change Build (Personal & Team Campaigns)**
  *Migration:* `20260408000000_add_queue_tier_columns.sql`
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/components/dialer/QueuePanel.tsx`, `src/lib/dialer-api.ts`, `src/hooks/useDialerStateMachine.ts`, `ROADMAP.md`
  *Developer Note:* Comprehensive 9-change hardening pass for the dialer queue system to reach PhoneBurner/Five9 parity.
  **Change 1 — Pin Active Lead at Position 0**: Active lead always renders as a pinned first card with a pulsing "DIALING" badge, visually separated from the remaining queue. Queue count shows "X remaining" instead of "Showing X of Y".
  **Change 2 — Auto-Dial Countdown Animation**: When auto-dial is ON and idle on a new lead, a left-to-right CSS fill animation (primary color, 15% opacity, 3s duration via `clip-path` keyframes) sweeps across the active card during the auto-dial delay. Clicking the card during countdown cancels auto-dial instantly. Exposed `autoDialCountdownActive` and `cancelAutoDialCountdown` from `useDialerStateMachine` through to `QueuePanel`.
  **Change 3 — Hide Past (Dialed) Leads**: Leads with `originalIndex < currentLeadIndex` are filtered out of the display queue entirely. A muted "X dialed" label appears when `currentLeadIndex > 0`. Arrow buttons on the lead card header still allow navigating back.
  **Change 4 — Session Resume 60-Min Staleness Window**: `loadWithResume` now checks `updated_at` from `dialer_queue_state`. If older than 60 minutes, ignores the saved index and starts at `currentLeadIndex = 0` with a toast.
  **Change 5 — Calls Made from Live DB Count**: Added `getTodayCallCount(agentId, campaignId)` to `dialer-api.ts` — runs `SELECT COUNT(*)` from `calls` table filtered by today's UTC date. On session load, this grounds `calls_made` in `dialerStats` and `sessionStats` from reality; subsequent dials still optimistically increment.
  **Change 6 — Skip Persists to campaign_leads**: `handleSkip` now writes `retry_eligible_at = NOW() + retryIntervalHours` and `status = 'Called'` to `campaign_leads` via fire-and-forget `.update()`. Defaults to 24h if `retryIntervalHours` is 0/null. Local `_skipped` flag preserved for instant UI removal.
  **Change 7 — 4-Tier Smart Sort**: Added `'smart'` sort case to `displayQueue` useMemo implementing the 4-tier waterfall (Callback Due → New → Retry Eligible → Pending). Set as default `queueSort` value. Added "Smart Sort" as first option in dropdown, renamed old "Default" to "Queue Order". Migration adds `callback_due_at` and `retry_eligible_at` TIMESTAMPTZ NULL columns + partial indexes to `campaign_leads`.
  **Change 8 — Fix Stale call_attempts**: After `saveCallData()` success, both `handleSaveOnly` and `handleSaveAndNext` now update local `leadQueue` with `call_attempts + 1`, `last_called_at`, and `status`. The `handleSaveAndNext` non-lock path also passes the updated lead to `applyQueueLifecycle` so the re-sort uses fresh data.
  **Change 9 — Always-Visible Attempt Count + Last Disposition**: Every queue card (active and remaining) now renders a fixed bottom row with "X attempt(s)" and "Last Disp: status" (if not Queued/New), styled at 9px muted. This row is independent of the two configurable `queuePreviewFields` slots.
  Zero TypeScript errors. No new npm packages. All Supabase writes include `organization_id` where applicable. Migration file output only — not executed.

- **2026-04-08 | [DONE] Fix: left contact column blank after lead advance**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* `handleAdvance`, `handleSkip`, and `handleAutoDispose` did not reset `isEditingContact` or `editForm`. When advancing mid-edit, the left contact info column stayed in edit mode but `editForm` was stale/empty for the incoming lead, rendering it blank. Fix: added `setIsEditingContact(false)` and `setEditForm({})` to all three advance handlers. `autoSaveNoAnswer` inherits the fix via its `handleAdvance()` call; `handleMachineDetectedAction` inherits via `handleAutoDispose`/`handleSkip`. No `useEffect` auto-sync for `editForm` exists (intentional — `startEditing()` is the sole initializer), so the on-advance reset is sufficient.

- **2026-04-08 | [DONE] Bugfix — Add setHistoryLeadId(null) to !currentLead branch in serialized fetch effect (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* One-line patch: `setHistoryLeadId(null)` added to the `!currentLead` early-return branch so the guard state is cleared when the queue empties, preventing stale history from flashing on next lead load.

- **2026-04-08 | [DONE] Fix Dialer Flickering — Serialize Fetches, historyLeadId Guard, Instant Scroll**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Three surgical fixes targeting Supabase auth lock contention and stale-history flash on lead advance:
  **Fix 1 — Serialize Supabase Fetches (eliminates lock contention):** Replaced `Promise.allSettled` parallel execution in the orchestration `useEffect` with sequential `await` — history first, then agent name. Added `setLoadingHistory(true)` at the start of the history fetch so the skeleton appears immediately. On rapid lead changes, the `AbortController` cancels the in-flight history request before the profile fetch even begins, dropping simultaneous Supabase requests from 8+ to 1.
  **Fix 2 — historyLeadId Transition Guard (eliminates stale-history flash):** Added `historyLeadId` state (`useState<string | null>(null)`). Set in the `finally` block of the history fetch so it always clears regardless of success/error. In the JSX, `ConversationHistory` receives `history` only when `historyLeadId === (currentLead?.lead_id || currentLead?.id)` — otherwise an empty array is passed and `loadingHistory` is forced true, showing the skeleton. This prevents the previous lead's history from flashing while the next lead's history loads.
  **Fix 3 — Instant Scroll Anchor (already in place):** `historyEndRef` sentinel is the first child of the `flex-col-reverse` scroll container in `ConversationHistory.tsx`, anchoring to visual bottom. `scrollIntoView({ behavior: 'instant' })` fires via `requestAnimationFrame` on `history.length` or `currentLead` change. No smooth animation that could be mistaken for a render glitch.

- **2026-04-07 | [DONE] Hotfix — Dialer Lead Transition Stabilization & UI Restoration**
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/components/dialer/DialerActions.tsx`, `src/hooks/useDialerStateMachine.ts`, `ROADMAP.md`
  *Developer Note:* Resolved critical UI "glitching" and state-thrashing during lead selection.
  **Pillar 1 — UI Restoration**: Restored missing `Queue` and `Scripts` tabs to the `DialerActions` right-hand panel. Updated the component to conditionally render `QueuePanel` and `Script` list based on the active tab, passing through all necessary state from the parent.
  **Pillar 2 — State Guard (Revolving Door)**: Implemented `isAdvancing` guard in `DialerPage` and `useDialerStateMachine`. Created `handleLeadSelect` to block rapid-fire state updates and prevent real-time database locks from triggering infinite re-render loops.
  **Pillar 3 — Timer Hardening**: Updated the auto-dialer state machine to be more resilient against rapid state changes by improving timer cleanup and post-delay precondition verification.
  **Pillar 4 — Technical Debt Roadmap**: Added a high-priority [TODO] item to decompose the 3,000+ line `DialerPage.tsx` into single-responsibility sub-components.

- **2026-04-07 | [DONE] Dialer Concurrency, Telemetry, State Machine & Bugfix Overhaul**
  *Migration:* `20260407000000_dialer_telemetry_hardening.sql`
  *Files Created:* `src/hooks/useDialerStateMachine.ts`
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/components/layout/FloatingDialer.tsx`, `src/lib/auto-dialer.ts`, `src/lib/dialer-api.ts`, `ROADMAP.md`
  *Developer Note:* Comprehensive overhaul: 
  **Pillar 1 — WebRTC Concurrency & Auth**: Added `isDialingRef` execution lock to `TelnyxContext.makeCall` preventing rapid-fire call loops. Integrated `refreshSession()` for all Edge Function auth to avoid 401s. Explicit `setCallState("idle")` in cleanup to unblock auto-dial. `callWasAnswered` ref added to gate wrap-up vs. silent auto-disposition on timeout.
  **Pillar 2 — Backend Telemetry Hardening**: Created migration adding graceful fallback to `get_org_id()` (profile lookup when JWT claim is missing). Re-applied `get_enterprise_queue_leads` with `SET search_path = public`.
  **Pillar 3 — Two-Lane State Machine**: Created `useDialerStateMachine` hook formalizing Fast Path (timeout/AMD auto-advance) and Deliberate Path (Save & Next manual disposition). Replaced 63-line scattered `triggerAutoCall` `useEffect` in DialerPage with 14-line hook invocation. 
  **Pillar 4 — Maintenance**: Deprecated `AutoDialer.saveDispositionAndNext` (added warning). Consolidated `FloatingDialer` to use `TelnyxContext.makeCall` directly. Verified: `npx tsc --noEmit` = 0 errors.

- **2026-04-07 | [DONE] Auto-Dialer Stabilization & Circuit Breaker Implementation**
  *Files Created:* `src/lib/CircuitBreaker.ts`
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/contexts/TelnyxContext.tsx`, `src/lib/dialer-api.ts`, `src/hooks/useDialerStateMachine.ts`
  *Developer Note:* Hardened the dialer against infinite loops and network flooding. 
  **Pillar 1 — Circuit Breaker**: Implemented `CircuitBreaker` utility to track rapid-fire call failures (>5 failures in 60s window). Toggles Auto-Dial OFF permanently when tripped to protect Supabase/WebRTC resources.
  **Pillar 2 — Network Throttling**: Integrated `AbortController` into all lead data fetching (history, activities, profile) to cancel stale requests during rapid "Skip" actions.
  **Pillar 3 — Lock Hardening**: Refactored `isDialingRef` in `TelnyxContext` to synchronize exclusively with `callState` (idle/ended), preventing concurrent call initiation race conditions.
  **Pillar 4 — Timing Stabilization**: Increased `AUTO_DIAL_DELAY_MS` to 3000ms and added `isAdvancing` guards to all async fetch/advance paths to ensure atomic lead transitions.

- **2026-04-07 | [DONE] Bugfix — Ring Timeout PSTN Leak + Queue Index Reset + Background Re-sort Disruption**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/lib/auto-dialer.ts`, `ROADMAP.md`
  *Developer Note:* (1) Async ring timeout with polling for `call_control_id`. (2) `applyQueueLifecycle` advances to next valid lead instead of resetting to 0. (3) Background re-sort preserves lead queue tail and guards active call state.

- **2026-04-07 | [DONE] Fix Auto-Dial — Telnyx Status Guard + resumeAutoDialer for Team/Open Campaigns**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`

- **2026-04-07 | [DONE] Fix Dialer Leads Bug — Direct Query Rewrite + Status Filter + maxAttempts Safety**
  *Files Modified:* `src/lib/dialer-api.ts`, `ROADMAP.md`

- **2026-04-06 | [DONE] Campaign & Dialer Technical Architecture — Ultimate Source of Truth**
  *Files Created:* `docs/CAMPAIGN_AND_DIALER_ARCHITECTURE.md`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Generated a comprehensive, deep-dive diagnostic document covering the entire campaign lifecycle, selector logic, behavioral settings, RBAC enforcement, and the Enterprise Waterfall Queue. This document serves as the authoritative source of truth for the dialer's technical implementation and state management patterns.

- **2026-04-06 | [DONE] Fix Dialer Queue PostgREST Routing — RPC Signature Realignment**
  *Migration:* `20260406950000_robust_rpc_signature.sql`
  *Files Modified:* `src/lib/dialer-api.ts`, `ROADMAP.md`
  *Developer Note:* Resolved the `Could not find the function ... in the schema cache` error. **Fix 1 — Signature Realignment**: Reordered SQL arguments to `(p_campaign_id, p_limit, p_offset, p_org_id)` to match the observed PostgREST preference in the error log. **Fix 2 — Strict JS Payload**: Modified `dialer-api.ts` to explicitly pass all 4 parameters, using `null` instead of `undefined` for `p_org_id`. This prevents PostgREST from falling back to a 3-argument signature during introspection. **Fix 3 — Overload Cleanup**: Added `DROP FUNCTION IF EXISTS` to the migration to ensure no stale signatures remained in the DB. Force-reloaded the PostgREST cache via `NOTIFY`. Verified with `npx tsc --noEmit`.

- **2026-04-06 | [DONE] Fix Dialer Queue NULL Handling — Fresh Lead Loading Patch**
  *Migration:* `20260406900000_patch_enterprise_rpc_nulls.sql`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Resolved a critical bug where fresh/imported leads were not appearing in the dialer queue. **Fix — COALESCE Guards**: SQL comparisons like `call_attempts < max_attempts` fail (return NULL) if either side is NULL, causing Postgres to drop the row in a `WHERE` clause. Added `COALESCE(cl.call_attempts, 0)` and `COALESCE(v_max_att, 9999)` to ensure comparisons evaluate correctly even for first-time dials or unlimited campaigns. Also patched `cl.status` and `cl.state` with fallbacks ('Queued' and 'America/New_York' respectively) to prevent leads with incomplete data from being filtered out of the dashboard.

- **2026-04-06 | [DONE] Fix Dialer Queue Crash — RPC Column Alignment + Error Exposure**
  *Migration:* `20260406800000_fix_enterprise_rpc_columns.sql`
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Resolved a critical queue loading crash. **Fix 1 — RPC Column Alignment**: The `get_enterprise_queue_leads` RPC (v1) was missing the `user_id` column in its `SELECT` statement, violating its `RETURNS SETOF public.campaign_leads` contract and causing PostgREST to fail the associated `.select("*, lead:leads(*)")` join. Fixed by recreating the RPC using `SELECT cl.*` from the base table, ensuring perfect column order and membership matching. **Fix 2 — Error Exposure**: Updated `DialerPage.tsx` catch blocks in `fetchLeadsBatch` and `loadWithResume` to un-swallow PostgREST errors. Added `console.error` and appended `err.message` to the UI toast, enabling faster diagnostics for future schema or permission issues. Verified fix with `npx tsc --noEmit`.

- **2026-04-06 | [DONE] Enterprise Waterfall Queue — DB Refactor + Timezone Compliance + Auto-Dial Fix**
  *Migration:* `20260406700000_enterprise_waterfall_rpc.sql`, `20260406600000_campaign_leads_scheduled_callback.sql`
  *Files Modified:* `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `src/integrations/supabase/types.ts`, `src/components/dialer/CampaignSettingsModal.tsx`, `ROADMAP.md`
  *Developer Note:* Massive architectural upgrade to the dialer queue. **Fix 1 — Enterprise Waterfall RPC**: Created `get_enterprise_queue_leads` RPC which moves all queue logic (Timezone-aware calling hours, Max Attempts, and Retry Intervals) to the database level. This fixes broken pagination where JS-level filtering caused "empty" batches. The RPC maps US states to IANA timezones and handles the US Daylight Savings transitions natively. **Fix 2 — Zero-Interval Support**: Explicitly bypasses time-checks if `retry_interval_hours` is set to 0, enabling high-velocity immediate retries. **Fix 3 — Auto-Dial Initiation**: Resolved a bug where auto-dial would stall after dispositioning. Added explicit `autoDialer.resumeAutoDialer()` calls to `handleSaveAndNext` and `handleAdvance`. Added detailed console instrumentation to the `triggerAutoCall` reactive trigger to trace initiation blocks. Verified zero TypeScript regressions.

- **2026-04-06 | [DONE] Ring Timeout Enforcement + Call Count UI + Auto-Dial Stall Fix**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Three targeted fixes. **Fix 1 — Strict Ring Timeout**: New `useEffect` monitors `telnyxCallState === "dialing"` and fires a `setTimeout` at `ringTimeoutRef.current * 1000`ms. If still dialing when the timer fires (and AMD hasn't confirmed human), calls `telnyxHangUp()` + toast. This closes the gap where TelnyxContext's built-in ring timeout could be bypassed by early state transitions. **Fix 2 — Call Count UI**: `handleSaveOnly`, `handleSaveAndNext` (lock-mode path already correct), and `autoSaveNoAnswer` now inject `call_attempts: (l.call_attempts || 0) + 1` into the local `setLeadQueue` update alongside the status change. This ensures the queue panel and `displayQueue`'s max_attempts filter reflect the true attempt count without waiting for a DB round-trip. **Fix 3 — Auto-Dial Stall**: Added `showWrapUp` to the inner `setTimeout` guard inside the auto-dial reactive trigger. Previously, if the wrap-up modal opened during the 2000ms delay, the auto-dial would fire behind the modal. Now it aborts and re-triggers only when `showWrapUp` flips to `false` (already in the outer dependency array from the prior commit). Zero schema changes, zero TypeScript errors.

- **2026-04-06 | [DONE] Dialer Hangup Lag Fix — Wrap-Up Phase Enforcement**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Root cause: TelnyxContext was dispatching `auto-dial-next-lead` CustomEvents from inside `hangUp`, `telnyx.error`, and `telnyx.notification` handlers. This caused the WebRTC layer to short-circuit the UI's wrap-up phase, skipping dispositions and triggering UI shift lag. Fix removes all three `window.dispatchEvent(new CustomEvent("auto-dial-next-lead"))` calls, deletes the `isAutoDialingRef` tracking ref (no longer needed), and collapses the delayed `setCallState("idle")` reset — `callState` now stays `"ended"` until DialerPage's wrap-up phase explicitly transitions it via `handleAdvance`. Also removed the matching event listener in DialerPage. Added a `useEffect` that syncs `autoDialEnabled` from the campaign's `auto_dial_enabled` column when a campaign is selected — ensures the auto-dial toggle obeys campaign settings. Added `max_attempts` filtering to `displayQueue` memo so over-attempted leads that slipped through initial fetch are excluded from the display queue. Zero schema changes, zero new dependencies, zero TypeScript errors.

- **2026-04-06 | [DONE] Fix campaign_leads user_id Column + RPC Hotfix**
  *Migration:* `20260406500000_fix_campaign_leads_user_id.sql`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Root cause was a two-part failure: migration `20260403100000_campaigns_rls.sql` added `user_id` to `campaign_leads` on local but was not fully applied on the remote database, leaving the column absent. The previously deployed `add_leads_to_campaign` function body referenced `user_id` in its INSERT column list (an older version), causing the runtime error "column user_id does not exist." The hotfix migration (1) adds `user_id UUID REFERENCES auth.users(id)` to `campaign_leads` using `IF NOT EXISTS` (idempotent), (2) backfills from `claimed_by` for existing rows, (3) sets `DEFAULT auth.uid()`, and (4) `CREATE OR REPLACE`s the function with the correct body that omits `user_id` from the INSERT — the column DEFAULT handles assignment automatically. No frontend code was modified.

- **2026-04-06 | [DONE] Dialer Queue Routing by Campaign Type — Atomic Lock RPC + DialerPage Wiring**
  *Migration:* `20260406400000_dialer_lead_locks.sql`
  *Files Created:* `src/lib/dialer-queue.ts`, `src/components/dialer/LockTimerArc.tsx`
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Built `fetch_and_lock_next_lead` RPC (90-second TTL, SECURITY DEFINER) and `release_all_agent_locks` RPC for bulk cleanup. Added composite index `(campaign_id, expires_at)` on `dialer_lead_locks`. Extracted `fetchNextQueuedLead`, `buildFiltersFromQueueState`, `releaseAllAgentLocks`, and `releaseAllAgentLocksBeacon` into `src/lib/dialer-queue.ts` to keep DialerPage under 200-line-per-section limit. DialerPage `handleSaveAndNext` lock-mode path now calls `release_lead_lock` → `fetchNextQueuedLead` → enrich → set queue → `startHeartbeat`. Both End Session buttons (header + dialog) call `releaseAllAgentLocks`. `beforeunload` handler uses `releaseAllAgentLocksBeacon` with `fetch(..., { keepalive: true })` for reliable delivery during page unload; access token is cached in a ref via `onAuthStateChange` listener for synchronous access. Created `LockTimerArc` component (CSS `@property`-driven conic-gradient arc, 90s duration) displayed for Team/Open campaigns only. `fetch_and_lock_next_lead` filters only on `campaign_leads` columns (state, max_attempts) — no JOIN to `leads` table to avoid deadlock risk with `FOR UPDATE SKIP LOCKED`. The existing `get_next_queue_lead` RPC (5-min TTL, JOINs leads) is preserved for the `useLeadLock` hook; both RPCs are documented in the migration header.

- **2026-04-06 | [DONE] campaign_leads RLS Refinement — Personal Campaign Scoping**
  *Migration:* `20260406300000_campaign_leads_rls_personal_scope.sql`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Replaced the overly permissive `campaign_leads_select` RLS policy (which allowed any org member to see all campaign leads) with a campaign-type-aware policy. Agents in Personal campaigns now see only leads where `claimed_by` or `user_id` matches their auth UID. Agents in Team/Open/Open Pool campaigns see all leads (required for queue display and lock-mode dialing). Admins and Team Leaders see all campaign leads org-wide. Also fixed the `'Team Lead'` vs `'Team Leader'` role string inconsistency in `campaigns_select`, `campaigns_update`, and `campaigns_delete` policies — all three now accept both variants via `IN ('Admin', 'Team Leader', 'Team Lead')`. No INSERT/UPDATE/DELETE policies on `campaign_leads` were touched. CampaignDetail.tsx reviewed: its frontend `filteredLeads` filter for agents (`claimed_by === currentUserId`) is complementary, not conflicting — no code change needed.

- **2026-04-06 | [DONE] add_leads_to_campaign RPC with Ownership Validation**
  *Migration:* `20260406200000_add_leads_to_campaign_rpc.sql`
  *Files Modified:* `src/components/contacts/AddToCampaignModal.tsx`, `src/pages/CampaignDetail.tsx`, `ROADMAP.md`
  *Developer Note:* Created a SECURITY DEFINER Postgres RPC `add_leads_to_campaign(p_campaign_id, p_lead_ids)` that enforces campaign-type ownership rules at the database layer. Personal campaigns require `lead.assigned_agent_id = campaign.user_id`; Team campaigns require the lead's agent to be in the campaign creator's downline (via `is_ancestor_of`); Open campaigns only check organization membership. Function performs dedup (skips leads already in campaign), batch-inserts valid leads with `status='Queued'`, and returns `{added, skipped, skipped_ids}` as JSONB. Refactored 3 frontend insert paths (AddToCampaignModal `handleAdd` + `handleCreateAndAdd`, CampaignDetail `handleAdd` + `doImport`) to call the RPC instead of direct `.insert()`. Toast notifications now show skip counts. `import-contacts` Edge Function was NOT touched — it has its own validation path. All columns are native UUID — no type casts needed.

- **2026-04-06 | [DONE] Total Leads Auto-Trigger**
  *Migration:* `20260406100000_campaign_leads_count_trigger.sql`
  *Files Modified:* `src/pages/CampaignDetail.tsx`, `src/components/contacts/AddToCampaignModal.tsx`, `ROADMAP.md`
  *Developer Note:* Replaced 6 manual `total_leads` count-and-update calls with a single Postgres trigger (`trg_sync_campaign_total_leads`) that fires AFTER INSERT/DELETE/UPDATE on `campaign_leads`. Returns `NEW` for INSERT/UPDATE, `OLD` for DELETE — per Postgres AFTER trigger contract. Trigger function uses `GREATEST(..., 0)` on decrements to prevent negative counts. One-time backfill `UPDATE` syncs all existing campaigns from live row counts. Also fixed `.single()` → `.maybeSingle()` on the campaign INSERT fetch in `AddToCampaignModal`. All `organization_id` scoping on `campaign_leads` rows is unchanged — trigger is count-only and does not touch org fields.

- **2026-04-06 | [DONE] Intelligent Queue Lifecycle Management**
  *Files Created:* `src/lib/queue-manager.ts`
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/components/dialer/QueuePanel.tsx`, `ROADMAP.md`
  *No migrations required — all queue state is in-memory only.*
  *Developer Note:* Implemented fully managed queue lifecycle with priority-tiered ordering. Foundational to 300+ dials/day with zero manual queue management.
  **queue-manager.ts** — New library containing all queue logic: `CampaignLead` interface with in-memory `retry_eligible_at` / `callback_due_at` fields; `DISPOSITION_QUEUE_BEHAVIOR` map (No Answer/Not Available/Left Voicemail/Interested → retry, DNC/Not Interested/Appointment Set → permanent remove, Call Back → callback hold); `sortQueue()` (4 tiers: Callback Due Now → New Leads → Retry Eligible → Pending); `applyDispositionToQueue()` (removes + re-inserts + re-sorts after every save); `queueOrderChanged()` (position-by-position ID comparison); `formatTimeUntil()` (human countdown); `getLeadTier()` (tier 1–4 classifier for UI badges).
  **DialerPage.tsx** — `loadWithResume` now fetches `retry_interval_hours` from campaigns, pre-populates `retry_eligible_at` for any previously-called leads whose interval hasn't expired, then runs `sortQueue()` before `setLeadQueue`. `applyQueueLifecycle` callback centralizes disposition → queue change wiring. `handleAutoDispose` now calls `applyQueueLifecycle` instead of incrementing index. `handleSaveAndNext` (Personal/non-lock path) calls `applyQueueLifecycle` + resets to index 0 instead of calling `handleAdvance`; lock-mode path is unchanged. 60-second `setInterval` effect re-sorts the queue and toasts if order changed (clears on unmount and `selectedCampaignId → null`).
  **QueuePanel.tsx** — Lead rows now compute tier via `getLeadTier`. Tier 1 rows show amber "Callback Due" badge; Tier 3 rows show green "Ready" badge; Tier 4 rows show muted countdown ("Retry in Xh Ym" / "Callback in Xd Yh") and apply `opacity-50` to signal not-yet-callable status.

- **2026-04-06 | [DONE] Dialer Behavioral Bugfixes (Three-Fix Block)**
  *Files Modified:* `src/lib/auto-dialer.ts`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Three targeted fixes applied to the power dialer.
  **Fix 1 — Campaign Settings Enforcement**: `AutoDialer.startSession()` now fetches `calling_hours_start`/`calling_hours_end` from the `campaigns` table and `ring_timeout`/`amd_enabled` from `phone_settings`. Added `checkCallingHours(state)` public method with a full 50-state `STATE_TO_TZ` map using `Intl.DateTimeFormat` for timezone-aware comparison. Added `getRingTimeout()` getter. In `DialerPage`, `triggerAutoCall` (auto-dial path only) calls `checkCallingHours` before dialing; if outside hours it toasts a warning, calls `handleSkip()`, and returns. Ring timeout stored in `ringTimeoutRef` after async `startSession` resolves. Manual Call button is unaffected.
  **Fix 2 — No Auto-Dial on First Entry**: Added `hasDialedOnce` ref. `triggerAutoCall` returns immediately unless `hasDialedOnce.current === true`. `handleCall` (manual press) sets it to `true`. Ref resets to `false` in a `useEffect` that watches `selectedCampaignId`, so switching campaigns restores the guard.
  **Fix 3 — Session Timer + Session-Scoped Stats**: Session timer interval stored in `sessionTimerRef` so all three exit paths (unmount, `selectedCampaignId → null`, End Session button) reliably clear it and reset `sessionElapsed` to 0. Added `sessionStats` local state (`calls_made`, `calls_connected`, `total_talk_seconds`, `policies_sold`) reset on campaign entry. Incremented in `handleCall`, `handleHangUp` (≥7s), and both save handlers when disposition contains "sold". Stat cards in the header now read from `sessionStats` (session-scoped) instead of `dialerStats` (all-day cumulative). `dialer_daily_stats` persistence is unchanged — daily table remains the source of truth for reports.

- **2026-04-06 | [DONE] Campaign-Aware Dialer UI + Hard Claim Engine**
  *Migration:* `20260406000000_hard_claim_engine.sql`
  *Files Created:*
  - `src/hooks/useHardClaim.ts`
  - `src/components/dialer/LeadCard.tsx`
  - `src/components/dialer/LeadCardBlurred.tsx`
  - `src/components/dialer/QueuePanel.tsx`
  - `src/components/dialer/QueuePanelLocked.tsx`
  - `src/components/dialer/ClaimRing.tsx`
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Built the campaign-aware dialer UI with full staged lead reveal, hidden queue for Team/Open, 30s claim ring animation, and campaign type visual identity stripe + badge. Also built the missing Hard Claim Engine (useHardClaim) that was a blocker for this task — the previous task left it incomplete. Schema gaps discovered and resolved: `claim_lead` RPC (SECURITY DEFINER, updates `leads.assigned_agent_id` ONLY — never `campaign_leads`) and `queue_filters` JSONB column on campaigns for manager-set filters. Lock-mode lead loading (Team/Open) uses atomic `getNextLead()` one lead at a time; Personal still uses batch queue. beforeunload listener cleans up lock + heartbeat + claim timer.

- **2026-04-06 | [DONE] Implement Coming Soon Placeholders**  
  *Developer Note:* Implemented a premium, animated "Coming Soon" experience across Conversations, AI Agents, and Training modules. Created a reusable `ComingSoon` component alignment with the platform's vision for high-velocity agency operations.

- **2026-04-06 | [DONE] Settings Layout Documentation Audit**  
  *Developer Note:* Completed a comprehensive field-level map of the AgentFlow Settings architecture. Audited all components in `src/components/settings/` and generated the authoritative `docs/SETTINGS_LAYOUT.md` reference for future development.

- **2026-04-06 | [DONE] Campaigns Architecture Diagnostic Audit**  
  *Developer Note:* Perform a comprehensive end-to-end audit of the Campaigns feature. Mapped RLS security, lead state transitions, and AutoDialer integration. Identified bottlenecks in CSV ingestion and campaign action automation. [See Campaigns_Diagnostic_Report.md for details].


- **2026-04-05 | [DONE] Permanent Dark Sidebar (Command Center)**  
  *Developer Note:* Enforced a constant dark theme for the Sidebar (Slate-900) to maintain a premium "Command Center" aesthetic across all global themes. Decoupled navigation elements from Light Mode styles to ensure 100% mission-critical visibility and consistency.
  
- **2026-04-04 | [DONE] Lead Ownership Standardization**  
  *Developer Note:* Massive schema refactor to ensure every lead record across all states (Master, Campaign, Dialer) is pinned to a correct, RLS-checked `user_id`. Optimized hierarchical reporting for agency managers.

- **2026-04-04 | [DONE] Agent Rule & Documentation Generalization**  
  *Developer Note:* Decoupled codebase from Lovable/Notion. Established **VISION.md** and **ROADMAP.md** as repository-native sources of truth. Updated **AGENT_RULES.md (v2.3.0)** to focus on the Antigravity (AI Orchestrator) workflow.

- **2026-04-02 | [DONE] Production Readiness Audit**  
  *Developer Note:* Verified security boundaries. Confirmed absolute RLS isolation for Leads, Clients, and Appointments. Verified Telnyx WebRTC stability for agent "Power Hours."

---

## 4. Phase 4 Deployment Strategy (Q2 2026)
1.  **SaaS Infrastructure**: Deploy `organizations` table and Stripe billing loops.
2.  **Follow-up Engine**: Deploy `tasks` and unified `notifications` for agent follow-ups.
3.  **Real-Time Metrics**: Connect `dial_sessions` to custom agent leaderboards based on live telnyx connects.
4.  **GO-LIVE**: Final production rollout for agency trial users.

---

## 5. Refactor & Technical Debt [TODO]
- `[TODO]` **Break down `DialerPage.tsx`**: (High Priority) Component is currently >3,000 lines. Refactor into `src/components/dialer/` sub-modules (e.g., `DialerHeader`, `DialerLeadSection`, `DialerHistory`, `DialerModals`) to meet the <200-line standard and improve maintainability.

---

## 19. Context Snapshot — Lead Transition Stabilization (2026-04-07)

### What Was Built
A "revolving door" state guard system to stabilize the Dialer during lead transitions, and restoration of the missing Queue/Scripts UI panels.

**Frontend layer (`src/pages/DialerPage.tsx`):**
- `isAdvancing` — Boolean state used as a global guard for all transitionary logic.
- `handleLeadSelect(idx)` — Debounced selection handler (500ms cooldown) that sets `isAdvancing` to `true` while the new lead's history and metadata are fetched.
- **UI Restoration**: Updated `DialerActions` to conditionally render `QueuePanel` and `Script` lists, ensuring agents can manage their workflow without leaving the dialer view.

**State Machine layer (`src/hooks/useDialerStateMachine.ts`):**
- Added `isAdvancing` as an external guard to the auto-dial trigger.
- **Timer Hardening**: Auto-dial timer now re-verifies `telnyxStatus` and `isAutoDialEnabled` AFTER the 3s delay but BEFORE the call fires, preventing race conditions where an agent disables auto-dial or switches leads during the countdown.

### Schema & UI Decisions Made
| Decision | Rationale |
|---|---|
| `QueuePanel` in `DialerActions` | Maximizes vertical space for conversation history by keeping controls in the right-hand column. |
| 500ms `isAdvancing` cooldown | Sufficient to allow Supabase Realtime and Telnyx context to settle before accepting the next user input. |
| Pass-through props to `DialerActions` | Maintains `DialerPage` as the single source of truth for dialer state, even if at high complexity. |
| `[TODO]` for `DialerPage` refactor | Acknowledges the >3,000 line technical debt while prioritizing an immediate stability hotfix. |

### What's Next
- **Refactor `DialerPage.tsx`**: Must be broken down into `<DialerHeader />`, `<LeadSection />`, `<HistorySection />`, and `<ActionPanel />` to meet the <200-line standard.
- **Persistent Filters**: Queue filters are currently transient in the UI; consider persisting them to `localStorage` or `dialer_queue_state`.

---

## 5. Context Snapshot — Smart Queue Lock System (2026-04-05)

### What Was Built
A zero-race-condition queue system for Team and Open Pool campaigns. Two agents can never be served the same lead simultaneously because fetching and locking happens in a single Postgres transaction using `SELECT … FOR UPDATE SKIP LOCKED`.

**Database layer:**
- `public.dialer_lead_locks` — lock registry with 5-minute TTL per lock
  - Unique partial index `(lead_id) WHERE expires_at > now()` → one active lock per lead, enforced at the DB constraint level
  - RLS: org-scoped; agents see/modify only their own locks; Admins/TLs see all org locks
- `public.get_next_queue_lead(p_campaign_id, p_filters)` — SECURITY DEFINER RPC
  - Deletes stale locks → reads campaign type → filters eligible pool → `SELECT … FOR UPDATE OF cl SKIP LOCKED` → inserts lock → returns `campaign_leads` row
- `public.renew_lead_lock(p_lead_id)` — heartbeat extension, returns boolean
- `public.release_lead_lock(p_lead_id)` — immediate lock release

**Frontend layer (`src/hooks/useLeadLock.ts`):**
- `getNextLead(campaignId, campaignType, filters)` — branches on campaign type; Personal = direct query, Team/Open Pool = RPC
- `releaseLock(leadId)` — call on skip, disposition save, session end, beforeunload
- `startHeartbeat(leadId, onLockLost?)` — setInterval at 30s, warns if lock is lost
- `stopHeartbeat()` — clears interval

### Schema Decisions Made
| Decision | Rationale |
|---|---|
| `lead_id` references `campaign_leads(id)` | No `contacts` table exists; `campaign_leads` is the dialer's queue entity |
| Team pool via `campaigns.assigned_agent_ids` | No `team_members` table; agent membership stored as JSONB array on the campaign |
| `SECURITY DEFINER` on `get_next_queue_lead` | Required to read the full campaign pool across all agents (RLS would block cross-agent reads) |
| Filters as flat JSONB object | Enables future plan-based count limiting (e.g. "Starter = 2 filters max") without changing the function signature |
| `FOR UPDATE OF cl SKIP LOCKED` with JOIN | Locks only the `campaign_leads` row; leaves `leads` row unlocked (not needed) |

### What Prompts 2 and 3 Depend On
- **Prompt 2 (Dialer Integration)**: Call `useLeadLock.getNextLead()` on campaign start and after each disposition. Wire `startHeartbeat` / `stopHeartbeat` around the active lead. Add `beforeunload` listener calling `releaseLock` on `DialerPage`.
- **Prompt 3 (Campaign Settings — Queue Filters UI)**: Managers need a filter editor on the Campaign Settings modal that saves `queue_filters` JSONB onto the `campaigns` table. The hook reads this from the campaign record and passes it to `getNextLead`. Fields: `status`, `state`, `lead_source`, `max_attempts`, `min_score`, `max_score`. Plan-tier enforcement hooks here (count active filter keys before calling RPC).

---

## 6. Context Snapshot — Campaign-Aware Dialer UI (2026-04-06)

### What Was Built

Full campaign-type-aware dialer UI with staged lead reveal, claim ring, queue visual identity, and hard claim ownership engine.

### Components Built

| Component | File | Props Contract |
|---|---|---|
| `LeadCard` | `src/components/dialer/LeadCard.tsx` | `lead, callStatus, callAttempts, maxAttempts, lastDisposition, isClaimed, isEditing, editForm, onEditChange` |
| `LeadCardBlurred` | `src/components/dialer/LeadCardBlurred.tsx` | `firstName, state, age, callAttempts, maxAttempts, lastDisposition` (internal, used by LeadCard) |
| `QueuePanel` | `src/components/dialer/QueuePanel.tsx` | `campaignType, campaignId, organizationId, userRole` + all Personal queue props |
| `QueuePanelLocked` | `src/components/dialer/QueuePanelLocked.tsx` | `campaignId, organizationId, userRole` (fetches its own counts, polls every 15s) |
| `ClaimRing` | `src/components/dialer/ClaimRing.tsx` | `active, onClaim, campaignType` |

### Hooks Built

| Hook | File | Exports |
|---|---|---|
| `useHardClaim` | `src/hooks/useHardClaim.ts` | `startClaimTimer, cancelClaimTimer, claimOnDisposition, claimedLeadIds` |

### Schema Decisions Made

| Decision | Rationale |
|---|---|
| `claim_lead` RPC — SECURITY DEFINER | Must write `leads.assigned_agent_id` across agent boundaries; agent-level RLS would block cross-agent writes |
| Writes to `leads.assigned_agent_id` ONLY | Per codebase invariant — `campaign_leads.assigned_agent_id` is read-only from dialer layer |
| `queue_filters` JSONB on `campaigns` | Manager-set filters persist per campaign, all agents share them; agents cannot see/override |
| `callStatus` derived from `telnyxCallState` + `showWrapUp` | Keeps wrap-up card fully revealed after call ends; no separate state needed |
| Lock-mode = one-lead-at-a-time queue | Team/Open campaigns serve one locked lead per agent; `leadQueue` is always a 1-element array in lock mode |
| `QueuePanelLocked` polls every 15s via `setInterval` | Counts are informational; no Realtime socket needed, avoids unnecessary connections |
| `ClaimRing.onClaim` is UI-only | The actual DB claim is handled by `useHardClaim.startClaimTimer` running in parallel; the ring fires a visual signal only |

### State Management Decisions

- `claimRingActive: boolean` — owned by DialerPage, driven by Telnyx `active` state for Team/Open only
- `lockMode: boolean` — derived from `campaignType`, memoized
- `callStatus: 'idle' | 'ringing' | 'connected'` — memoized from `telnyxCallState` + `lockMode` + `showWrapUp`
- `campaign stripe` — rendered via inline IIFE in JSX, no additional state needed
- `campaign badge` — replaces old static badge, type-aware with colored dot

### What the Next Developer Needs to Know

1. **Lock mode lead loading** (`loadLockModeLead`) fetches the campaign's `queue_filters` from DB on each call — this is intentional so manager filter changes take effect immediately without session restart.
2. **`handleAdvance` and `handleSkip`** both branch on `lockMode` — if lockMode, they call `releaseLock` + `loadLockModeLead` instead of incrementing `currentLeadIndex`.
3. **`claimedLeadIds`** is a session-scoped `Set<string>` of master `leads.id` values. It resets on page reload — this is intentional; the DB is the source of truth for permanent ownership.
4. **Campaign type string matching**: always `.toUpperCase()` before comparison. Values in DB: `'Personal'`, `'Team'`, `'Open Pool'`. Lock mode = `type === 'TEAM' || type.includes('OPEN')`.
5. **QueuePanelLocked** manager filter panel saves `queue_filters` JSONB to `campaigns` table. The dialer reads this on `loadLockModeLead`. No real-time sync — filters apply on the next lead load.
6. **`beforeunload` listener** only calls `releaseLock` if `lockMode && currentLead?.id`. Safe for Personal campaigns (no lock to release).

---

## 7. Context Snapshot — Dialer Behavioral Bugfixes (2026-04-06)

### What Was Changed

Three focused behavioral fixes applied to `src/lib/auto-dialer.ts` and `src/pages/DialerPage.tsx`. No new components, no schema migrations.

**Fix 1 — Campaign Settings Enforcement:**
- `AutoDialer` now stores `callingHoursStart`, `callingHoursEnd` (from `campaigns`), `ringTimeout` (from `phone_settings`). *(Historical: `amdEnabled` was removed 2026-04-09.)*
- `checkCallingHours(state)` uses a hardcoded `STATE_TO_TZ` record (all 50 states) + `Intl.DateTimeFormat.formatToParts` to determine local time. Returns `true` if within window.
- `getRingTimeout()` exposes the stored value; `ringTimeoutRef` in DialerPage caches it post-`startSession`.
- `triggerAutoCall` in DialerPage calls `checkCallingHours` on the auto-dial path only. Outside hours → toast + `handleSkip()` + early return. Manual Call button is unaffected.

**Fix 2 — No Auto-Fire on Entry:**
- `hasDialedOnce` ref starts `false` per campaign.
- `triggerAutoCall` returns immediately if `hasDialedOnce.current === false`.
- `handleCall` sets it `true` (manual press is the gate).
- A dedicated `useEffect` on `selectedCampaignId` resets the ref in its setup AND cleanup so campaign switches always re-engage the gate.

**Fix 3 — Session Timer + Stat Cards:**
- `sessionTimerRef` holds the interval ID, cleared in all three exit paths (unmount, `selectedCampaignId → null`, End Session click).
- `sessionStats` local state (calls_made, calls_connected, total_talk_seconds, policies_sold) is the source of truth for the header stat cards. Reset to zeros on campaign entry.
- `dialer_daily_stats` (Supabase) is still persisted unchanged for reports and dashboard.

### What's Next
- Consider wiring `ringTimeoutRef.current` into a setRingTimeout API on TelnyxContext if per-campaign ring timeout overrides are needed (currently TelnyxContext reads global `phone_settings` itself).
- Session stats are in-memory only; if `dial_sessions` table is implemented (see Roadmap Phase 4), `sessionStats` should persist there on `endSession`.

---

## 8. Context Snapshot — Intelligent Queue Lifecycle Management (2026-04-06)

### What Was Built

A fully managed in-memory queue lifecycle system that dynamically re-positions leads after every disposition. All logic is isolated in `src/lib/queue-manager.ts`.

### Architecture

| Function | Behavior |
|---|---|
| `sortQueue(leads, now)` | 4-tier priority sort: Callback Due → New → Retry Eligible → Pending |
| `applyDispositionToQueue(...)` | Removes disposed lead, applies behavior from `DISPOSITION_QUEUE_BEHAVIOR`, re-inserts with timestamps, re-sorts |
| `queueOrderChanged(a, b)` | Position-by-position ID comparison — drives 60s poll toast |
| `formatTimeUntil(ts, now)` | "Xh Ym" / "Xd Yh" / "Due now" countdown strings |
| `getLeadTier(lead, now)` | Returns 1–4 for QueuePanel badge rendering |

### Disposition Routing

| Disposition | Queue Action |
|---|---|
| No Answer, Not Available, Left Voicemail, Interested | `remove_until_retry` — re-enters after `retry_interval_hours` |
| Not Interested, DNC, Appointment Set, Appt Set | `remove_permanent` — gone from session queue |
| Call Back, Call Back Later | `remove_until_callback` — re-enters at scheduled callback time |
| (anything else) | `keep_at_bottom` — pushed to end of sorted queue |

### Advance Model Change

Previous model: `currentLeadIndex++` after every disposition.
New model: disposed lead is removed → queue re-sorted → `currentLeadIndex` reset to 0 (head of sorted queue is always the next-to-dial). The auto-dial reactive `useEffect` on `currentLead?.id` naturally fires on the new head.

Lock-mode (Team / Open Pool) is **unchanged** — these campaigns use atomic DB locks via `useLeadLock` and bypass all in-memory queue lifecycle.

### Deferred Edge Cases

- `callback_at` / `scheduled_callback_at` columns not confirmed present on `campaign_leads`; `callbackDueAt` is derived from the inline callback scheduler UI (`callbackDate` + `callbackTime` state) and falls back to 48h if null.
- `handleSaveOnly` (save without advance) intentionally does NOT apply queue lifecycle — the agent may save and continue reviewing the lead.
- `autoSaveNoAnswer` (rapid no-answer path) uses `handleAdvance` — consider migrating to `applyQueueLifecycle` in a future pass if you want no-answer leads to re-sort immediately.

### What's Next

- Connect `dial_sessions` persistence so re-insertion timing is visible in agency reports.
- Expose retry interval in the queue UI so agents can see "when this lead re-enters" at a glance from the Queue tab.
- Consider persisting `retry_eligible_at` / `callback_due_at` as actual DB columns if multi-session lifecycle continuity is required (currently in-memory only, resets on page reload).

---

## 9. Context Snapshot — Total Leads Auto-Trigger (2026-04-06)

### What Was Built

A Postgres trigger that makes `campaigns.total_leads` a fully DB-managed counter. No frontend code is responsible for maintaining this value.

### Database Layer

| Object | Type | Behavior |
|---|---|---|
| `sync_campaign_total_leads()` | Trigger function | INSERT → +1; DELETE → GREATEST(-1, 0); UPDATE w/ campaign_id change → decrement old, increment new |
| `trg_sync_campaign_total_leads` | AFTER trigger | Fires FOR EACH ROW on INSERT OR DELETE OR UPDATE of `campaign_leads` |
| Backfill `UPDATE` | One-time | Sets `total_leads` from live `campaign_leads` row counts for all existing campaigns |

**Return contract (per Postgres AFTER trigger spec):**
- `INSERT` → returns `NEW`
- `DELETE` → returns `OLD`
- `UPDATE` → returns `NEW`

### Frontend Changes

6 manual update calls removed across 2 files:

| File | Removed |
|---|---|
| `src/pages/CampaignDetail.tsx` | 4 blocks — `handleAdd` (post-INSERT), CSV import (post-INSERT), `handleRemoveLead` (post-DELETE), `handleBulkRemove` (post-DELETE) |
| `src/components/contacts/AddToCampaignModal.tsx` | 2 blocks — `handleAddToExisting` (post-INSERT), `handleCreateAndAdd` (post-INSERT) |

**Also fixed:** `AddToCampaignModal.tsx` campaign INSERT `.single()` → `.maybeSingle()` per AGENT_RULES null-safety standard.

**Left intact:** `total_leads: 0` initial value on new campaign INSERT rows — this is a valid seed value on the `campaigns` record, not a `campaign_leads` mutation.

### What Prompt 2 Depends On

- `campaigns.total_leads` is now always accurate; any future UI that displays this count can trust it directly without a re-count query.
- If a future migration adds bulk-delete or TRUNCATE paths on `campaign_leads`, those paths will bypass the FOR EACH ROW trigger. Add a statement-level trigger or re-run the backfill UPDATE in that migration.
- `organization_id` scoping is untouched — trigger is count-only and never reads or writes org fields.

---

## 10. Context Snapshot — add_leads_to_campaign RPC (2026-04-06)

### What Was Built

A server-side Postgres RPC that validates lead ownership rules before inserting into `campaign_leads`, enforcing Personal/Team/Open campaign type logic at the database layer.

### Database Layer

| Object | Type | Behavior |
|---|---|---|
| `add_leads_to_campaign(p_campaign_id, p_lead_ids)` | SECURITY DEFINER function | Validates org membership, campaign type ownership rules, dedup, then batch-inserts valid leads |

**Ownership Rules by Campaign Type:**

| Type | Rule | Skip Reason |
|---|---|---|
| Personal | `lead.assigned_agent_id = campaign.user_id` | `not_owned_by_campaign_creator` |
| Team | `is_ancestor_of(campaign.user_id, lead.assigned_agent_id)` OR direct match | `outside_team_downline` |
| Open / Open Pool | `lead.organization_id = get_org_id()` (org membership only) | `outside_organization` |

**Additional skip conditions:**
- Lead not found or wrong org → `outside_organization`
- Lead already in `campaign_leads` for this campaign → `already_in_campaign`

**Return contract:** `JSONB { added: int, skipped: int, skipped_ids: uuid[] }`

### Frontend Changes

3 direct `.insert()` calls replaced with `supabase.rpc('add_leads_to_campaign')`:

| File | Function | Change |
|---|---|---|
| `AddToCampaignModal.tsx` | `handleAdd` | Removed client-side dedup query + filter; RPC handles dedup |
| `AddToCampaignModal.tsx` | `handleCreateAndAdd` | Replaced post-create `.insert()` with RPC call |
| `CampaignDetail.tsx` | `handleAdd` (AddLeadsModal) | Replaced inline `.insert()` with RPC call |
| `CampaignDetail.tsx` | `doImport` (CSV import) | Replaced `.insert(processedLeads)` with RPC; master lead creation loop unchanged |

All toast notifications now show skip counts when leads are skipped (e.g. "12 leads added, 3 skipped").

### Schema Decisions Made

| Decision | Rationale |
|---|---|
| Both `leads.assigned_agent_id` and `campaigns.user_id` are UUID | Migration `20260331200100` standardized `assigned_agent_id` to UUID; no casts needed |
| SECURITY DEFINER | Must read leads across agent boundaries for Team/Open validation |
| Dedup inside RPC, not client | Single source of truth; eliminates race conditions from concurrent adds |
| `UPPER(campaign.type)` comparison | DB stores mixed-case values ('Personal', 'Team', 'Open Pool'); normalizing avoids case bugs |
| CSV import still creates master leads client-side | RPC only validates + inserts into `campaign_leads`; master lead creation is a separate concern |
| `import-contacts` Edge Function untouched | Has its own server-side validation path; not part of this refactor |

### What's Next (Prompts 3 & 4)

- **Prompt 3**: Campaign Settings UI — queue filters editor, campaign configuration modal
- **Prompt 4**: Campaign integrity tests or additional hardening
- The `total_leads` trigger (`trg_sync_campaign_total_leads`) fires automatically on the RPC's INSERT — no manual count needed
- If bulk-remove or TRUNCATE paths are added to `campaign_leads`, they bypass the FOR EACH ROW trigger; add a statement-level trigger in that migration

---

## 11. Context Snapshot — campaign_leads RLS Refinement (2026-04-06)

### What Was Changed

Replaced the `campaign_leads_select` RLS policy with a campaign-type-aware version that scopes agent visibility based on campaign type. Also fixed role string inconsistency across three `campaigns` table policies.

### Findings Before Writing

| Finding | Detail |
|---|---|
| Old policy name | `"campaign_leads_select"` (from `20260403100000_campaigns_rls.sql`, line 115) |
| Old USING clause | `is_super_admin() OR organization_id = get_org_id()` — no role or campaign-type scoping |
| Role strings from `get_user_role()` | Function reads `profiles.role` directly; profile creation stores `'Team Leader'` (with "er") |
| Role string bug in campaigns RLS | `20260403100000` used `'Team Lead'` (without "er") in SELECT/UPDATE/DELETE — Team Leaders fell through to `user_id`/`assigned_agent_ids` fallback |
| Campaigns SELECT policy fix needed | **Yes** — also UPDATE and DELETE policies had the same `'Team Lead'` string |

### New campaign_leads_select Logic

| Role | Campaign Type | Visibility |
|---|---|---|
| Super Admin | Any | All rows |
| Admin | Any | All rows in org |
| Team Leader / Team Lead | Any | All rows in org |
| Agent | Team / Open / Open Pool | All leads in that campaign (needed for queue display + lock-mode dialing) |
| Agent | Personal | Only leads where `claimed_by = auth.uid()` OR `user_id = auth.uid()` |

### CampaignDetail.tsx Review

- `fetchLeads` (line 701): `supabase.from("campaign_leads").select("*, lead:leads(*)").eq("campaign_id", id)` — no additional campaign-type filter
- `filteredLeads` memo (lines 770-794): applies frontend role filter — agents see only `claimed_by === currentUserId`
- **No breakage**: For Personal campaigns, RLS now enforces the same constraint at DB level (frontend filter is redundant but harmless). For Team/Open campaigns, RLS returns all leads; the frontend filter then shows only claimed ones in the management UI, which is correct behavior. The dialer page uses separate query paths (`useLeadLock` / `get_next_queue_lead` RPC).
- **No code change required.**

### What's Next

- Consider a future migration to normalize all `profiles.role` values to a single canonical string and update all RLS policies to match, eliminating the need for dual-variant `IN` checks

---

## 12. Context Snapshot — Dialer Queue Routing by Campaign Type (2026-04-06)

### RPC Signatures Built

| RPC | Params | Returns | TTL | Notes |
|---|---|---|---|---|
| `fetch_and_lock_next_lead` | `(p_campaign_id UUID, p_filters JSONB)` | `SETOF campaign_leads` | 90s | No JOIN to leads; filters on campaign_leads only |
| `release_all_agent_locks` | `(p_campaign_id UUID)` | `VOID` | n/a | Deletes all locks for `auth.uid()` in campaign |

**Pre-existing RPCs preserved (20260405100000):**

| RPC | TTL | Notes |
|---|---|---|
| `get_next_queue_lead` | 5 min | JOINs leads table for lead_score/lead_source filters; used by `useLeadLock.ts` |
| `renew_lead_lock` | extends 5 min | Heartbeat renewal |
| `release_lead_lock` | n/a | Single lock release by lead_id |

### Column Names Verified from Schema

**campaign_leads columns used in `fetch_and_lock_next_lead`:**
- `campaign_id`, `organization_id`, `status`, `state`, `call_attempts`, `created_at`

**Columns NOT on campaign_leads (live on `leads` table only):**
- `lead_score` — score filtering is NOT supported in lock-mode `fetch_and_lock_next_lead` by design
- `lead_source` — source filtering is NOT supported in lock-mode by design
- Rationale: adding a JOIN to `leads` inside `FOR UPDATE SKIP LOCKED` increases lock scope and creates deadlock risk

### Campaign Type Routing Confirmed

| Campaign Type | Queue Fetch Method | Lock? | Filter Source |
|---|---|---|---|
| Personal | Direct `campaign_leads` query scoped to `userId` | No | Frontend `queueFilter` state (all keys) |
| Team | `fetch_and_lock_next_lead` RPC | 90s TTL | `buildFiltersFromQueueState` (state, max_attempts only) |
| Open / Open Pool | `fetch_and_lock_next_lead` RPC | 90s TTL | `buildFiltersFromQueueState` (state, max_attempts only) |

### Lock Lifecycle Wired

| Event | Action |
|---|---|
| `handleSaveAndNext` (lock mode) | `release_lead_lock` → `fetchNextQueuedLead` → enrich → `startHeartbeat` |
| `handleAdvance` / `handleSkip` (lock mode) | `releaseLock` → `loadLockModeLead` (existing useLeadLock path) |
| End Session (header button) | `releaseAllAgentLocks(campaignId)` |
| End Session (dialog button) | `releaseAllAgentLocks(campaignId)` |
| `beforeunload` | `releaseAllAgentLocksBeacon` via `fetch(..., { keepalive: true })` |

### Extractions to Helper Files

| File | Exports | Purpose |
|---|---|---|
| `src/lib/dialer-queue.ts` | `fetchNextQueuedLead`, `buildFiltersFromQueueState`, `releaseAllAgentLocks`, `releaseAllAgentLocksBeacon`, `LockModeFilters` | Campaign-type-aware queue operations extracted from DialerPage |
| `src/components/dialer/LockTimerArc.tsx` | `LockTimerArc` | 90-second CSS conic-gradient arc for Team/Open lock window visualization |

### What the Next Developer Needs to Know

1. **Two lock RPCs coexist** — `get_next_queue_lead` (5-min, with leads JOIN) and `fetch_and_lock_next_lead` (90s, no JOIN). Do NOT consolidate without understanding the TTL and deadlock implications.
2. **`accessTokenRef`** caches the Supabase access token for synchronous `beforeunload` usage. Updated via `onAuthStateChange` listener.
3. **`LockTimerArc`** uses CSS `@property` for animatable `--lock-progress` custom property. Requires browser support for `@property` (Chrome 85+, Edge 85+, Safari 15.4+).
4. **`buildFiltersFromQueueState`** intentionally drops `minScore`, `maxScore`, and `leadSource` — these require a leads table JOIN that is unsafe inside `FOR UPDATE SKIP LOCKED`.
5. **Lock-mode `handleSaveAndNext`** enriches the RPC result with a secondary `campaign_leads.select("*, lead:leads(*)")` query. This is the same pattern used by `loadLockModeLead`.

---

## 13. Context Snapshot — Dialer Hangup Lag Fix (2026-04-06)

### What Was Changed

Removed all `auto-dial-next-lead` CustomEvent dispatching from TelnyxContext. The WebRTC layer no longer dictates when the lead advances — this is now exclusively controlled by the UI's wrap-up phase in DialerPage.

### TelnyxContext Changes

| Item | Before | After |
|---|---|---|
| `isAutoDialingRef` | Tracked whether current call was auto-initiated | **Deleted** — no longer needed |
| `hangUp()` endResetRef timeout | Set `callState("idle")` + dispatched `auto-dial-next-lead` after 200ms | Sets refs to null synchronously; deferred timeout only clears `currentCall`, `isMuted`, `isOnHold` — `callState` stays `"ended"` |
| `telnyx.error` (code -32002) timeout | Read `isAutoDialingRef` → dispatched `auto-dial-next-lead` | Deferred timeout only clears cosmetic state |
| `telnyx.notification` (destroy/hangup) timeout | Read `isAutoDialingRef` → dispatched `auto-dial-next-lead` | Deferred timeout only clears cosmetic state |
| `makeCall()` | Set `isAutoDialingRef.current = !!clientState` | Removed |

### DialerPage Changes

| Item | Before | After |
|---|---|---|
| `auto-dial-next-lead` listener | `useEffect` listening for CustomEvent → `handleAdvance()` | **Deleted** — event no longer exists |
| `autoDialEnabled` sync | Not synced from campaign on selection | New `useEffect` reads `selectedCampaign.auto_dial_enabled` and sets local state |
| `displayQueue` memo | No max_attempts filtering | Filters out leads where `call_attempts >= campaign.max_attempts` |
| `handleHangUp` | Correctly does NOT touch `currentLeadIndex` | Unchanged — confirmed correct |

### Call Lifecycle After Fix

```
Agent presses Call → handleCall() → initiateCall() → TelnyxContext.makeCall()
→ Telnyx notification (active) → callState = "active"
→ Agent hangs up → handleHangUp() → TelnyxContext.hangUp()
  → callState = "ended" (INSTANT)
  → DialerPage useEffect detects "ended" → setShowWrapUp(true)
  → Agent selects disposition → handleSaveAndNext() / handleSaveOnly()
  → handleAdvance() → currentLeadIndex++ or loadLockModeLead()
  → Reactive auto-dial useEffect fires on new currentLead?.id (if auto-dial ON)
```

### What the Next Developer Needs to Know

1. **`callState` stays `"ended"` after hangup** — it is NOT auto-reset to `"idle"` by TelnyxContext. DialerPage's wrap-up phase is the only code path that triggers lead advancement.
2. **Auto-dial still works** — it's driven by the reactive `useEffect` on `currentLead?.id` that fires after `handleAdvance()` moves the queue head. No event listener needed.
3. **Campaign `auto_dial_enabled`** is now synced on campaign selection. If a manager disables auto-dial on a campaign, agents entering that campaign will have auto-dial off by default.
4. **`displayQueue` now enforces `max_attempts`** at the display layer. This is a safety net — the RPC and initial fetch also filter, but leads that slip through (e.g. race conditions with concurrent agents) are hidden.

---

## 14. Context Snapshot — Ring Timeout + Call Count + Auto-Dial Stall Fix (2026-04-06)

### What Was Changed

Three behavioral fixes applied to `src/pages/DialerPage.tsx`. No new components, no schema migrations.

### Fix 1 — Strict Ring Timeout Enforcement

| Aspect | Detail |
|---|---|
| Location | New `useEffect` after AMD detecting effect |
| Trigger | `telnyxCallState === "dialing"` |
| Timer | `ringTimeoutRef.current * 1000` ms |
| Guard | Aborts if AMD has confirmed `'human'` |
| Action | `telnyxHangUp()` + `toast.info()` |
| Why needed | TelnyxContext has its own ring timeout effect, but it checks `callRef.current.state` which may not always reflect the actual ringing state accurately. This DialerPage-level timeout is a belt-and-suspenders enforcement. |

### Fix 2 — Call Count UI Increment

| Handler | Before | After |
|---|---|---|
| `handleSaveOnly` | `setLeadQueue` updated `status` only | Also sets `call_attempts: (l.call_attempts \|\| 0) + 1` |
| `autoSaveNoAnswer` | No local queue update | Adds `setLeadQueue` with `status: d.name` + `call_attempts` increment before `handleAdvance()` |
| `handleSaveAndNext` (Personal) | Queue update via `applyQueueLifecycle` | `applyQueueLifecycle` already removes the lead — attempts are tracked in the re-inserted copy |
| `handleSaveAndNext` (Lock) | Queue replaced with fresh DB data | Already correct — DB row has updated `call_attempts` |

### Fix 3 — Auto-Dial Stall After Wrap-Up

| Aspect | Detail |
|---|---|
| Root cause | Inner `setTimeout` guard (2000ms delay) did not check `showWrapUp` |
| Fix | Added `showWrapUp` to the guard: `if (... \|\| showWrapUp) return;` |
| Outer dependency | `showWrapUp` was already in the outer `useEffect` dependency array (added in previous commit) |
| Behavior | When wrap-up closes → `showWrapUp` flips to `false` → effect re-fires → `triggerAutoCall` evaluates → 2000ms delay → inner guard passes → `handleCall()` |

### What the Next Developer Needs to Know

1. **Two ring timeout mechanisms exist**: TelnyxContext has one based on `callRef.current.state`, DialerPage has one based on `telnyxCallState`. Both are intentional — they cover different edge cases.
2. **`call_attempts` is updated locally AND in the DB** — the DB update happens inside `saveCall` / `updateLeadStatus`. The local `setLeadQueue` update is for instant UI feedback only.
3. **Auto-dial flow after wrap-up**: Agent dispositions → `handleSaveAndNext` → `applyQueueLifecycle` resets index to 0 → `showWrapUp` set to `false` → reactive trigger fires on `currentLead?.id` change AND `showWrapUp` change → 2000ms delay → `handleCall()`.

---

## 15. Context Snapshot — Enterprise Queue Waterfall (2026-04-06)

### What Was Built

A database-first waterfall queue that handles compliance and prioritization at the RPC level, ensuring the frontend only receives "dial-ready" leads.

### RPC: `get_enterprise_queue_leads`

| Logic | Implementation |
|---|---|
| **Max Attempts** | `cl.call_attempts < campaign.max_attempts` |
| **Retry Interval** | `cl.last_called_at + retry_interval <= now()` (Bypassed if `retry_interval = 0`) |
| **Calling Hours** | Timezone-aware map: `cl.state` → `IANA timezone`. Compares `now() AT TIME ZONE l.tz` to campaign `start`/`end` times. |
| **Waterfall Sort** | 1. Due Callbacks (`scheduled_callback_at <= now`) 2. New Leads 3. Retry Eligible |
| **Terminal Filter** | Excludes `DNC`, `Completed`, `Removed` at the DB layer. |

### Frontend Integration

- **`dialer-api.ts`**: `getCampaignLeads` now calls the RPC with `p_limit` and `p_offset`. It uses `.select("*, lead:leads(*)")` on the RPC result to maintain type consistency with joined master contact data.
- **`DialerPage.tsx`**: 
    - The reactive `triggerAutoCall` now has detailed logging for `isEnabled`, `telnyxCallState`, and `showWrapUp`.
    - `autoDialer.resumeAutoDialer()` is explicitly called during advance/save-next transitions to ensure the class-based state matches the UI state.
    - `scheduled_callback_at` (new TIMESTAMPTZ column) is synced from the UI disposition modal to drive the DB priority waterfall.

### Decisions Made

| Decision | Rationale |
|---|---|
| Move filtering to DB | Pagination (`limit`/`offset`) is impossible to calculate in JS if most leads are ineligible. |
| Timezone Map in SQL | Centralizes compliance. Mapping `CA` → `America/Los_Angeles` allows Postgres to handle DST offsets correctly without JS libraries like `moment-timezone`. |
| Zero-hour bypass | Explicitly checking `IF v_retry_hrs = 0` prevents `interval '0 hours'` math that could lead to edge-case exclusions. |
| `SETOF public.campaign_leads` | Returning the full table row allows PostgREST to join the `leads` table on the result, keeping the API clean and type-safe. |
---

## 17. Context Snapshot — Dialer Queue NULL Handling (2026-04-06)

### What Was Built

A robustness patch to the Enterprise Waterfall RPC to handle `NULL` state comfortably without dropping leads.

### The Problem: Strict NULL Exclusion

In PostgreSQL, boolean comparisons with `NULL` (e.g., `attempts < 10` where attempts is `NULL`) result in `NULL`. In a `WHERE` clause, any row that evaluates to `NULL` is treated as `FALSE`. This meant that:
1. **Fresh Leads** (status=NULL or call_attempts=NULL) were invisible.
2. **Unlimited Campaigns** (max_attempts=NULL) were returning 0 leads.
3. **Unknown States** (state=NULL) could not be mapped to a timezone and were dropped.

### The Fix: COALESCE wrappers

The patch introduces fallback values for all critical filtering columns:

| Column | Fallback | Purpose |
|---|---|---|
| `call_attempts` | `0` | New leads start at 0 attempts for comparison. |
| `max_attempts` | `9999` | Treat NULL as unlimited (effectively). |
| `status` | `'Queued'` | Treat missing status as ready-to-dial. |
| `lead_tz` | `'America/New_York'` | Default to EST for calling hour checks if state is unknown. |

### Verified Logic: New Lead Bypass

New leads where `last_called_at IS NULL` now correctly bypass the retry interval block (Bucket C) and are categorized as 'Queued' (Bucket B) via the internal `COALESCE(status, 'Queued') = 'Queued'` logic.

### Status Verified
1. **Migration 20260406900000** applied.
2. **Dialer Page** verified for fresh lead loading.

### Next Steps for Future Developers

1. **Type Regeneration**: If you run `npx supabase gen types`, ensure `scheduled_callback_at` and the RPC are preserved or re-generated into `types.ts`.
2. **Calling Hours Edge Cases**: States with multiple timezones (e.g. `KY`, `TN`) are defaulted to the primary state timezone. If pin-point accuracy is needed, map by `cl.phone` (area code) instead of `cl.state`.
3. **Queue Panel Sync**: The `QueuePanel` still uses `displayQueue` (memoized). Ensure `displayQueue` remains synced with the RPC results fetched via `fetchLeadsBatch`.
---

## 16. Context Snapshot — Dialer Queue Crash & Column Alignment (2026-04-06)

### What Was Built

A hotfix to the Enterprise Waterfall Queue that ensures the database RPC perfectly satisfies the PostgREST join requirements.

### The Problem: SETOF Column Mismatch

Current Supabase PostgREST behavior requires that any RPC returning `SETOF table_name` must output **every column** of that table in the **exact order** defined in the database. If columns are missing (like `user_id` in this case) or returned in a different order, PostgREST will fail to resolve relations in the `.select()` chain, resulting in a 400 Bad Request or 500 Internal Server Error.

### The Fix: cl.* Dynamic Selection

Instead of manually listing columns in the RPC which is brittle to schema changes, the revised RPC uses an inner JOIN to `public.campaign_leads cl` and returns `SELECT cl.*`.

```sql
  -- Revised logic ensures perfect SETOF matching
  SELECT cl.*
  FROM public.campaign_leads cl
  JOIN eligible_leads l ON cl.id = l.id
  WHERE ...
```

### UI Error Exposure

Previous `catch { toast.error("Failed to load leads") }` blocks were hiding the descriptive error messages returned by Supabase (e.g., "column user_id does not exist"). These have been converted to `catch (err: any)` blocks that log to the console and display the specific message.

### Verified State

1. **Migration 20260406800000** applied.
2. **PostgREST Schema Reload** notified.
3. **DialerPage.tsx** telemetry updated.
4. **`npx tsc`** confirmed 0 regressions.
---

## 18. Context Snapshot — RPC PostgREST Routing & Signature Alignment (2026-04-06)

### What Was Built

A stabilization patch to the dialer API and database RPC to resolve "Function Not Found" routing errors in the production environment.

### The Problem: PostgREST Introspection Drift

PostgREST's schema-caching layer uses the presence and order of arguments to route RPC requests. We encountered the `Could not find function ... in schema cache` error because:
1. **Implicit Defaults**: Passing `undefined` in JS (omitting keys) caused PostgREST to search for a 3-argument variant, even if a 4-argument variant with defaults existed.
2. **Signature Overloads**: Frequent migrations changed argument order/counts, leaving stale function signatures in the Postgres catalog that confused the introspection engine.

### The Fix: Non-Optional Signatures

We transitioned the RPC from an "optional/default" signature to a **"strict/explicit"** signature:

**SQL Signature:**
```sql
CREATE OR REPLACE FUNCTION get_enterprise_queue_leads(
  p_campaign_id uuid,
  p_limit int,
  p_offset int,
  p_org_id uuid
)
```

**JS Payload:**
```typescript
.rpc("get_enterprise_queue_leads", {
  p_campaign_id: id,
  p_limit: 100,
  p_offset: 0,
  p_org_id: orgId || null  -- Explicit null, never undefined
})
```

By passing `null` explicitly, we guarantee that the 4-argument signature is always matched, bypassing PostgREST's "closest match" heuristics which were failing due to cache staleness.

### Schema Cache Management

The migration now includes an explicit `DROP` and a `NOTIFY pgrst, 'reload schema'` command to force an immediate refresh across the entire cluster.

### Verified State

1. **Migration 20260406950000** applied.
2. **JS Payload** updated to 4-param explicit.
3. **`npx tsc`** zero errors.

---

## 19. Context Snapshot — Campaign & Dialer Architecture (2026-04-06)

### What Was Built
A terminal-grade technical architecture document (`docs/CAMPAIGN_AND_DIALER_ARCHITECTURE.md`) that serves as the Source of Truth for the entire campaign and dialer module.

### Key Technical Pillars Documented
1.  **Dual-Table Entity Separation:** Differentiation between master `leads` (CRM) and `campaign_leads` (Execution).
2.  **State-to-TZ Compliance Mapping:** The database-level logic that ensures leads are only dialed during legal branch hours for their specific US state.
3.  **Water-Fall Queue Sorting:** The 3-tier prioritization logic (Callbacks → Fresh → Retry) implemented in the `get_enterprise_queue_leads` RPC.
4.  **Auto-Dial Reactive Feedback Loop:** The `DialerPage.tsx` state machine that watches Telnyx WebRTC status and the wrap-up modal to trigger the next dial atomically.

### Rationale Behind Logic
| Feature | Implementation | Rationale |
|---|---|---|
| **RPC-Level Filtering** | `get_enterprise_queue_leads` | Prevents "empty page" syndrome when many leads are ineligible; ensures 300+ dials/day payload delivery. |
| **0-Hour Retry Bypass** | SQL `COALESCE` + bypass | Enables high-velocity "Power Hour" mode where agents can immediately redial no-answers without cool-down resets. |
| **hasDialedOnce Ref** | `DialerPage` guard | Essential safety measure; prevents the dialer from auto-initiating a call the second an agent enters a campaign before they've oriented themselves. |

### What's Next
This document should be the first file read by any agent tasking with "Dialer" or "Campaign" modifications. It serves as a guard against architectural regression during future SaaS graduation steps.
