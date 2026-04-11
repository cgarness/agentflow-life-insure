# Inbound Calling System — Architecture Snapshot

**Status:** Phases 1–8 merged on `claude/inbound-calling-system-H8LN7`
**Last updated:** April 11, 2026
**Scope:** Server-side Telnyx Call Control routing for inbound PSTN → agent WebRTC SIP URIs, with simultaneous-ring fork, voicemail inbox, and agent call forwarding. **Outbound one-legged WebRTC dialer is untouched.**

---

## 1. High-level flow

```
Telnyx PSTN number
      │
      │  call.initiated (direction: inbound, no client_state)
      ▼
telnyx-webhook  ──►  handleInboundCall(payload)
      │
      │   1. phone_numbers.phone_number = payload.to  →  organization_id
      │   2. leads.phone = payload.from (same org)    →  lead?
      │   3. inbound_routing_settings                 →  { contacts_only, greeting_url, ring_timeout }
      │   4. INSERT calls row (direction=inbound, status=ringing)
      │
      ├─► contacts_only && !lead                       → startVoicemailFlow (org voicemail)
      │
      ├─► lead.assigned_agent_id                       → profiles lookup
      │        ├─ agent online + sip_username          → telnyxTransferToSip
      │        ├─ agent offline + forwarding           → telnyxTransferToPstn
      │        └─ agent offline + no forwarding        → startVoicemailFlow (personal)
      │
      └─► no assigned lead                             → getOnlineAgents(org)
               ├─ 0 agents                             → startVoicemailFlow (org)
               ├─ 1 agent                              → telnyxTransferToSip
               └─ N agents                             → FORK:
                        answer parent
                        for each agent: POST /v2/calls with client_state `fork:<parent_call_id>`
                        insert inbound_fork_legs rows (status=dialing)
                        on first call.answered for a fork leg:
                             tryHandleForkLegAnswered
                               → bridge(parent, winner)
                               → update calls.status=connected + agent_id
                               → hangup all siblings still dialing
                               → record_start (if org recording enabled)
                        on call.hangup for a losing leg:
                             tryHandleForkLegHangup
                               → mark failed
                               → if no siblings still live → startVoicemailFlow(org)
```

## 2. Routing priority (matches `handleInboundCall`)

| # | Condition | Action |
|---|-----------|--------|
| 1 | No `phone_numbers` match for called number | Insert bare `calls` row, abort routing (stranded org). |
| 2 | `contacts_only = true` and no lead match | Org voicemail. |
| 3 | `lead.assigned_agent_id` set, agent `inbound_enabled` and `last_seen_at` within 5 min and `sip_username` present | Direct SIP transfer. |
| 4 | Assigned agent offline with `call_forwarding_enabled` + `call_forwarding_number` | PSTN transfer (uses the called number as `from` for outbound caller ID). |
| 5 | Assigned agent offline with no forwarding | Personal voicemail (personal `agent_id` on voicemails row). |
| 6 | No lead match, 0 online agents | Org voicemail. |
| 7 | No lead match, 1 online agent | Direct SIP transfer. |
| 8 | No lead match, N online agents | Simultaneous fork (answer parent, dial all legs, first-answered bridges + kills siblings). |

## 3. Database surface (`20260410120000_inbound_calling_system`)

- **`inbound_routing_settings`** — per-org row: `routing_mode`, `auto_create_lead`, `after_hours_sms_enabled`, `after_hours_sms`, `contacts_only`, `voicemail_greeting_url`, `ring_timeout_seconds`, business-hours fields.
- **`voicemails`** — org-scoped inbox. Inserted at the start of the voicemail flow (with `telnyx_call_control_id` only); the recording URL is patched in `handleRecordingSaved` when Telnyx delivers `call.recording.saved`.
- **`inbound_fork_legs`** — simultaneous-ring state machine. Columns: `parent_call_id`, `parent_control_id`, `leg_control_id`, `agent_id`, `organization_id`, `status ∈ {dialing, answered, cancelled, failed, completed}`.
- **`profiles`** additions: `sip_username`, `inbound_enabled`, `call_forwarding_enabled`, `call_forwarding_number`, `last_seen_at`.
- **`voicemail-assets`** storage bucket: RLS on `(storage.foldername(name))[1] = public.get_org_id()::text` so each org can only access its own folder (`{org_id}/greeting-*.{mp3,wav}`).

All RLS policies use `public.get_org_id()` + `public.is_super_admin()` helpers (consistent with the rest of the app).

## 4. Webhook event routing (`telnyx-webhook`)

| Telnyx event | Handler | Notes |
|--------------|---------|-------|
| `call.initiated` (direction=inbound, no client_state) | `handleInboundCall` | Main router. |
| `call.initiated` (direction=outbound, `client_state` = `fork:<id>`) | Logged, ignored | Fork legs we originated. |
| `call.answered` | `tryHandleForkLegAnswered` then fallthrough to existing outbound `handleCallAnswered` | Fork winner bridges parent, kills siblings. |
| `call.hangup` | `tryHandleForkLegHangup` then fallthrough to existing `handleCallHangup` | On total fork exhaustion → org voicemail. |
| `call.playback.ended` | `handleInboundPlaybackEnded` | Chains into `record_start` after greeting finishes. |
| `call.recording.saved` | `handleRecordingSaved` | **Voicemail path first** — looks up `voicemails.telnyx_call_control_id`; falls back to `calls` if no voicemail row. |

Ed25519 signature verification is unchanged from pre-Phase 1.

## 5. Telnyx API quirks observed

- **Recording URL key variability.** Telnyx uses `recording_urls` (object with `mp3`/`wav`), `public_recording_urls`, or stringly-typed variants depending on account settings. `extractRecordingDownloadUrl` probes all known shapes before falling back to scanning nested objects for the first `http(s)` string.
- **`client_state` must be base64.** `telnyxDial` wraps with `btoa(...)`; the webhook decodes with `atob(...)` via `decodeClientState`.
- **Fork leg ring timeout** is capped at `min(org_ring_timeout_seconds, FORK_RING_TIMEOUT_MS/1000)` so a slow agent won't stall all siblings.
- **`call.machine.*` events** are intentionally ignored (AMD removed). If your connection still emits them, they're no-oped.
- **Fail-open signature verification** is still in place when `TELNYX_PUBLIC_KEY` secret is missing — set this before trusting the webhook.

## 6. Presence model

- Agents run `useInboundPresence()` on mount (60s interval) while the tab is visible.
- It upserts `profiles.last_seen_at = now()` only when `inbound_enabled = true`.
- The webhook defines "online" as `last_seen_at > now() - 5 minutes` (`ONLINE_WINDOW_SECONDS`).
- Turning off `inbound_enabled` immediately removes the agent from the fork pool on the next incoming call (no heartbeat → stale `last_seen_at`).

## 7. Voicemail playback (recording-proxy)

`recording-proxy` Edge Function accepts `{voicemail_id}` or `{call_id}`:

1. Resolves the row and verifies the caller's JWT org matches (`get_org_id()`).
2. Grabs the `telnyx_call_control_id`.
3. Queries the Telnyx Recordings API for the MP3 download URL using the org's API key.
4. Falls back to the stored `recording_url` if Telnyx returns empty.
5. Streams the audio back with the correct content type.

UI (`VoicemailInbox.tsx`) calls the proxy via `supabase.functions.invoke("recording-proxy", {body: {voicemail_id}})` and uses an `HTMLAudioElement` for play/pause.

## 8. Edge Function deployment state (as of April 11, 2026)

| Function | Local version (branch) | Deployed |
|----------|-----------------------|----------|
| `inbound-route` | Phase 3 | **v1** (deployed via MCP) |
| `recording-proxy` | Phase 6 | **v3** (deployed via MCP) |
| `telnyx-webhook` | Phase 2 (+ rest of dialer) | **PENDING** — currently deployed `v346` is pre-inbound. Must be redeployed before inbound routing goes live. |

### Deploying telnyx-webhook (manual follow-up)

From a workstation with a Supabase access token:

```bash
supabase link --project-ref jncvvsvckxhqgqvkppmj
supabase functions deploy telnyx-webhook --no-verify-jwt
```

Or via the MCP `deploy_edge_function` tool with the content of `supabase/functions/telnyx-webhook/index.ts` (committed in `d4a3bbe`), `verify_jwt: false`, entrypoint `index.ts`.

**Verification checklist after deploy:**
- [ ] Send a test inbound call from an external PSTN line. Confirm a `calls` row is created with `direction=inbound, status=ringing`.
- [ ] With one online agent: confirm SIP transfer succeeds and `status → connected`.
- [ ] With two+ online agents: confirm fork legs appear in `inbound_fork_legs` with `status=dialing`, and on answer one row flips to `answered` while siblings go to `cancelled`.
- [ ] Let a call go unanswered: confirm a `voicemails` row exists with a `recording_url` after `call.recording.saved`.
- [ ] Confirm `handleRecordingSaved` patches the voicemail row (not the calls row) when `telnyx_call_control_id` matches both.
- [ ] Upload an org voicemail greeting through the settings UI and confirm `playback_start → call.playback.ended → record_start` chains correctly.

## 9. E2E test priorities

1. **Fork winner bridge** — two online agents on two browsers, confirm whichever answers first actually gets audio both ways; the loser's UI drops.
2. **Assigned-agent direct transfer** — lead's `assigned_agent_id` is online; confirm the call reaches only that agent, no fork legs are created.
3. **Offline forwarding** — assigned agent is offline + `call_forwarding_number` set; confirm the PSTN `from` header is the called number (not the caller's number) so the forwarded-to phone displays the business.
4. **Contacts-only gate** — unknown caller + `contacts_only=true` goes straight to org voicemail; same caller after being added as a lead rings agents.
5. **Greeting playback → record chain** — upload greeting, trigger voicemail, confirm playback plays through and recording starts when it ends.
6. **Fork exhaustion** — all agents offline (or none answer within `FORK_RING_TIMEOUT_MS`) → confirm org voicemail row is created and caller hears greeting.
7. **Recording URL patching** — confirm voicemail row is patched (not the calls row) when both match the same `telnyx_call_control_id`.
8. **Presence TTL** — agent closes tab → 5 min later they should no longer appear in `getOnlineAgents`.

## 10. File map

```
supabase/
  migrations/
    20260410120000_inbound_calling_system.sql      Phase 1 — schema
  functions/
    telnyx-webhook/index.ts                        Phase 2 — inbound router + fork + voicemail
    inbound-route/index.ts                         Phase 3 — read API (counts, settings)
    recording-proxy/index.ts                       Phase 6 — voicemail audio proxy (org-scoped)
src/
  components/
    calling/InboundCallBanner.tsx                  Phase 4 — ringing banner (accept/decline)
    voicemail/VoicemailInbox.tsx                   Phase 6 — inbox list + audio playback
    settings/
      InboundCallRouting.tsx                       Phase 7 — thin orchestrator
      inbound/
        types.ts
        BusinessHoursCard.tsx                      (preserved)
        RoutingModeCard.tsx
        ContactsOnlyCard.tsx
        VoicemailSettingsCard.tsx                  (greeting upload + ring timeout)
        AutoCreateLeadCard.tsx
        AfterHoursSmsCard.tsx                      (preserved)
      CallForwardingSettings.tsx                   Phase 7 — profile-level card
      MyProfile.tsx                                (wires CallForwardingSettings)
  hooks/
    useInboundPresence.ts                          Phase 5 — 60s heartbeat
  pages/
    VoicemailPage.tsx                              Phase 6 — inbox route wrapper
docs/
  INBOUND_CALLING_ARCHITECTURE.md                  this file
ROADMAP.md                                         Section 2 migration + Section 3 work log
```
