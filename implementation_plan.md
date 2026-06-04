# Implementation Plan | AI Testing — Inworld Realtime Voice Agent

**Status:** CODE DONE — pending migration apply + Edge/Render deploy (Chris).  
**Date:** 2026-06-03  
**Branch:** `main` (UI already simplified to Deepgram-only; backend still has OpenAI / Hypercheap / Pipeline paths)  
**Production project:** `jncvvsvckxhqgqvkppmj`  
**Scope:** Add `inworld_realtime_agent` as a **second** AI Testing button (alongside Deepgram). **AI Testing only.**

---

## 0. WORK_LOG conflict gate

| Check | Result |
|-------|--------|
| `[IN PROGRESS]` AI Testing | **None** — latest entries are `[DONE]` (Hypercheap Fennec fixes, Pipeline stack `be21751`) |
| Chris UI direction | **`AITestingPage.tsx` on `main` exposes Deepgram only** — OpenAI / Hypercheap / Pipeline buttons removed from the page; legacy components and Edge/TwiML branches remain in repo for old sessions |
| Conflict with this build | **None** — new stack is additive; we **do not** re-expose Hypercheap / Pipeline / OpenAI on the UI |
| Uncommitted local work | `services/hypercheap-voice-bridge` has local edits (git status) — **out of scope**; Inworld Realtime uses Node `ai-voice-bridge`, not Hypercheap |

### Hard "do NOT touch" list
`DialerPage.tsx`, `TwilioContext.tsx`, production `twilio-*` / `dialer-*` Edge Functions, CRM dispositions, campaigns, queue, single-leg WebRTC dialer.

---

## 1. Target architecture

```
AI Testing Page
  → Place Deepgram Phone Test Call          (existing — baseline)
  → Place Inworld Phone Test Call           (new)
  → ai-testing-place-call                   (stack=inworld_realtime_agent)
  → ai_test_sessions + bridge_token
  → Twilio outbound
  → ai-testing-twiml                        (Media Stream, no SIP, no Say filler)
  → wss://<INWORLD_VOICE_BRIDGE_WSS_URL>/twilio/inworld?sessionId=…
  → services/ai-voice-bridge (Node)         NEW path, same service as Deepgram
  → wss://api.inworld.ai/api/v1/realtime/session?key=…&protocol=realtime
  → Inworld Realtime API (speech-to-speech, OpenAI-compatible events)
  → Twilio µ-law 8 kHz back
```

**Key invariant:** `INWORLD_API_KEY` stays on **Render only** (`ai-voice-bridge`). Supabase gets host-only secret `INWORLD_VOICE_BRIDGE_WSS_URL` (can point at the **same** Render service as Deepgram — different WS path).

---

## 2. PART 1 — Inworld Realtime API protocol (from official docs)

Sources: [WebSocket connect](https://docs.inworld.ai/realtime/connect/websocket), [API reference](https://docs.inworld.ai/api-reference/realtimeAPI/realtime/realtime-websocket), [Configuring models](https://docs.inworld.ai/realtime/usage/using-realtime-models), [OpenAI migration](https://docs.inworld.ai/realtime/openai-migration).

| Topic | Confirmed detail |
|-------|------------------|
| **WebSocket URL** | `wss://api.inworld.ai/api/v1/realtime/session?key=<app-session-id>&protocol=realtime` — `key` and `protocol=realtime` are **required** |
| **Auth (server-side)** | Header `Authorization: Basic <credentials>` — Inworld Portal API key is **already Base64-encoded** (same pattern as OpenAI bridge uses Bearer for OpenAI) |
| **Auth (browser)** | `Authorization: Bearer <JWT>` minted on backend — **not used** in our Twilio bridge |
| **Protocol** | OpenAI Realtime–compatible client/server events; extended `session` shape |
| **Input audio** | `input_audio_buffer.append` with base64 audio; format via `session.audio.input.format`: **`audio/pcmu`** = G.711 µ-law @ **8000 Hz fixed** (ideal for Twilio — **no PCM resample path required**) |
| **Output audio** | `response.output_audio.delta` (base64 µ-law if configured); `session.audio.output.format`: **`audio/pcmu`** @ 8 kHz |
| **Session config** | Client sends `session.update` after `session.created`; server replies `session.updated` |
| **Instructions** | `session.instructions` (system prompt) — we use existing `sessionAgentInstructions()` + lead context |
| **LLM / router model** | `session.model` string: `provider/model` (e.g. `openai/gpt-4o-mini`) or Inworld router `inworld/<routerId>` (e.g. `inworld/latency-optimizer-ab-test`). **Default if omitted:** `google-ai-studio/gemini-2.5-flash` |
| **TTS voice** | `session.audio.output.voice` (e.g. `Sarah`, `Dennis`) — [voice library](https://platform.inworld.ai/voice-library) |
| **TTS model** | `session.audio.output.model` — e.g. `inworld-tts-1`, `inworld-tts-2` (UI label Mini vs Max tier) |
| **Temperature** | `session.temperature` (number) |
| **Max tokens** | `session.max_output_tokens` (integer 1–4096 or `"inf"`) — maps from UI `max_response_tokens` |
| **Turn detection** | `session.audio.input.turn_detection`: `server_vad` (threshold, silence_duration_ms, interrupt_response) **or** `semantic_vad` (`eagerness`: low \| medium \| high \| auto, interrupt_response). **Default plan:** `semantic_vad` + `eagerness: medium`, `interrupt_response: true` |
| **Barge-in** | `input_audio_buffer.speech_started` → bridge sends Twilio `clear` (same as OpenAI bridge) |
| **User transcript** | `conversation.item.input_audio_transcription.completed` → log `user.transcript` |
| **Assistant transcript** | `response.output_audio_transcript.delta` / `.done` → log `assistant.transcript` |
| **Response lifecycle** | `response.created` → `response.output_audio.delta` → `response.done` |
| **Usage / billing signals** | On `response.done`, `response.usage` includes `llm.model`, `tts.model`, `tts.characters`, `tts.audio_seconds`, `stt.model`, `stt.audio_seconds`, token counts — store in `usage_metrics.inworld` |
| **Configurable URL** | Optional Render env `INWORLD_REALTIME_WS_URL` defaulting to `wss://api.inworld.ai/api/v1/realtime/session` for doc drift |

**Probe (only if live call fails at connect):** add `GET /inworld-probe` on `ai-voice-bridge` — short-lived WS, `session.update` with µ-law, log event types only (no API key in response). Not required for v1 if docs-aligned config works.

**Do not guess:** marketing pages sometimes show `modelId` — API reference uses `session.model` in `session.update`; implementation follows API reference.

---

## 3. Decisions

| # | Topic | Decision |
|---|-------|----------|
| D1 | **Bridge host** | Extend existing Node **`services/ai-voice-bridge`** (active Deepgram path). New file `inworldBridge.ts` mirrors `bridge.ts` OpenAI realtime loop with Inworld URL + Basic auth. |
| D2 | **WSS secret** | New Supabase secret **`INWORLD_VOICE_BRIDGE_WSS_URL`** — host only (e.g. `wss://ai-voice-bridge.onrender.com`). May equal `AI_VOICE_MONITOR_URL` host; separate secret keeps Inworld deploy independent. |
| D3 | **UI** | **Two buttons only:** Deepgram + Inworld. No stack selector, no OpenAI / Hypercheap / Pipeline sections on `AITestingPage`. |
| D4 | **Legacy Edge/TwiML** | Keep existing `openai_realtime` / `hypercheap` / `pipeline` branches in Edge for **historical sessions**; do not add new UI for them. |
| D5 | **`bridge_token`** | Reuse existing column (no migration column add). |
| D6 | **`tunables` jsonb** | Store `tts_model`, `turn_detection_type`, `vad_eagerness`, `max_response_tokens` when not mapped to top-level columns. |
| D7 | **Greeting** | Agent speaks first: **"Hi, this is Sarah. Can you hear me okay?"** via `conversation.item.create` (assistant) + `response.create` (or equivalent Inworld pattern validated against OpenAI bridge). No trigger words. |
| D8 | **Default router model** | UI default `inworld/latency-optimizer-ab-test` or `google-ai-studio/gemini-2.5-flash` (cost/latency) — Chris can pick on approval. |
| D9 | **Default TTS** | Voice `Sarah`, TTS model `inworld-tts-2`, temperature `0.7` |

---

## 4. Files to create / change (after approval)

### A. Database — **create only; do not apply until approved**

| Path | Action |
|------|--------|
| `supabase/migrations/20260603160000_ai_test_sessions_inworld_realtime_stack.sql` | Add `inworld_realtime_agent` to `ai_test_sessions.stack` CHECK; comment update only (reuse `bridge_token`, `tunables`) |

### B. Supabase Edge — AI Testing only

| Path | Action |
|------|--------|
| `supabase/functions/_shared/aiTestingSession.ts` | Add `inworld_realtime_agent` to `AiTestStack` |
| `supabase/functions/_shared/aiTestingBridgeToken.ts` | `inworldBridgeWssBase()` + `buildInworldStreamUrl()` → `/twilio/inworld` |
| `supabase/functions/ai-testing-place-call/index.ts` | Zod stack enum; require `INWORLD_VOICE_BRIDGE_WSS_URL`; persist voice/model/temperature/tunables |
| `supabase/functions/ai-testing-twiml/index.ts` | `inworld_realtime_agent` Media Stream branch; log `twiml.returning_inworld_stream` |

### C. Render — `services/ai-voice-bridge` (Node)

| Path | Action |
|------|--------|
| `services/ai-voice-bridge/src/config.ts` | `INWORLD_API_KEY`, `INWORLD_REALTIME_WS_URL`, defaults for model/voice/TTS |
| `services/ai-voice-bridge/src/inworldBridge.ts` | **Create** — Twilio WS ↔ Inworld Realtime; µ-law passthrough; debug_log + usage_metrics |
| `services/ai-voice-bridge/src/index.ts` | Register `WS /twilio/inworld`; `/ready` lists inworld configured |
| `services/ai-voice-bridge/src/usageMetrics.ts` | `inworld` block from `response.done.usage` |
| `render.yaml` | `INWORLD_API_KEY`, optional `INWORLD_REALTIME_WS_URL`, `INWORLD_REALTIME_MODEL`, `INWORLD_VOICE_ID`, `INWORLD_TTS_MODEL` on `ai-voice-bridge` |

### D. Frontend — AI Testing only

| Path | Action |
|------|--------|
| `src/lib/aiTestingInworld.ts` | **Create** — router model catalog, TTS tier enum, defaults, Zod helpers |
| `src/lib/aiTestingVoices.ts` | Add `inworld_realtime_agent` voice catalog (reuse Sarah/Ashley/… list) |
| `src/lib/aiTestingFormSchema.ts` | `PlaceInworldCallSchema` |
| `src/components/ai-testing/AITestingInworldSettings.tsx` | **Create** — voice, router model, TTS model, temperature, eagerness, max tokens |
| `src/components/ai-testing/AITestingCallButtons.tsx` | Second button: Place Inworld Phone Test Call |
| `src/hooks/useAITestingSession.ts` | `placeInworldCall`, `PlacingStack` includes `inworld_realtime_agent` |
| `src/pages/AITestingPage.tsx` | Two sections (Deepgram + Inworld); shared lead/prompt/phone/debug/billing |
| `src/lib/aiTestingUsageMetrics.ts` | `inworld` usage type |
| `src/lib/aiTestingBillingRates.ts` | Inworld Realtime STT/TTS/LLM estimate lines (from public pricing + usage fields) |
| `src/lib/aiTestingBilling.ts` | `inworld_realtime_agent` estimate branch |
| `src/components/ai-testing/AITestingBillingPanel.tsx` | Label for Inworld stack |

### E. Docs / log

| Path | Action |
|------|--------|
| `docs/AI_TESTING_SETUP.md` | New § Inworld Realtime; trim comparison table to **Deepgram vs Inworld** for the page Chris uses |
| `WORK_LOG.md` | Newest-first after implementation + verification |
| `implementation_plan.md` | This file |

### Explicitly NOT touched
Production dialer, `TwilioContext`, campaign/queue paths. **No new UI** for OpenAI / Hypercheap / Pipeline. **No** changes to `services/hypercheap-voice-bridge` for this feature (unless probe proves Node bridge blocked — unlikely).

---

## 5. debug_log contract (`inworld_realtime_agent`)

```
session.created
place_call.start
place_call.placed
twiml.received
twiml.signature_check
twiml.returning_inworld_stream
twilio.stream.connected
inworld.ws.connecting
inworld.ws.connected
inworld.session.config_sent
inworld.session.ready          (session.updated)
inworld.greeting_sent
inworld.user_speech_started    (input_audio_buffer.speech_started)
user.transcript
inworld.response.started       (response.created)
assistant.transcript
inworld.audio.sent             (optional heartbeat on output_audio.delta)
twilio.stream.closed
inworld.ws.closed
call.completed
```

Failures: `inworld.ws.connect_failed`, `inworld.session.config_failed`, `inworld.audio.forward_failed`, `inworld.no_transcript_timeout`, `inworld.response.failed` — each with `error_message`.

---

## 6. Billing estimate (initial)

| Line | Source |
|------|--------|
| Twilio outbound | $0.014/min |
| Twilio Media Streams | $0.004/min |
| Inworld STT | `usage.stt.audio_seconds` × rate from Inworld pricing page |
| Inworld TTS | `usage.tts.audio_seconds` or `usage.tts.characters` |
| LLM/router | `usage` token fields + `usage.llm.model`; if missing → "unknown / router cost" line |

Label: **Estimated only — provider invoices remain authoritative.**

---

## 7. Verification (after implementation)

- [ ] `npx tsc --noEmit`
- [ ] `cd services/ai-voice-bridge && npm run build`
- [ ] `GET /health` + optional `GET /inworld-probe`
- [ ] AI Testing page: **Deepgram + Inworld only**
- [ ] Inworld call: Sarah greeting first → user transcript → assistant audio
- [ ] Debug panel shows §5 sequence
- [ ] Billing tab shows Inworld estimate
- [ ] `git diff` excludes production dialer files

---

## 8. Deploy order (after approval + green checks)

1. Apply migration `20260603160000` (`supabase db push`).
2. Supabase secret: `INWORLD_VOICE_BRIDGE_WSS_URL=wss://ai-voice-bridge.onrender.com` (or dedicated host).
3. Render `ai-voice-bridge`: set `INWORLD_API_KEY` (+ optional model/voice defaults).
4. Deploy Edge: `ai-testing-place-call`, `ai-testing-twiml`.
5. Redeploy Render `ai-voice-bridge`.
6. Vercel frontend.
7. Super Admin → place one Inworld call → compare to Deepgram.

---

**Next step:** Reply **approve** (or note amendments: default router model, TTS tier default `inworld-tts-1` vs `inworld-tts-2`, whether `INWORLD_VOICE_BRIDGE_WSS_URL` should share the Deepgram bridge host). On approval: implement surgically, run typechecks, append WORK_LOG, context snapshot. **No file edits before approval.**
