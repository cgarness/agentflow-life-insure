# Implementation Plan | AI Testing — `openai_sip` GA fix (two-way voice)

**Status:** DONE — bare SIP URI + no control WS (2026-06-02, Chris retest pending)  
**Date:** 2026-06-02  
**Production project:** `jncvvsvckxhqgqvkppmj`  
**Scope:** Fix existing `openai_sip` path only. **Do NOT** touch DialerPage, TwilioContext, production dialer, `ai-testing-stream-ws`, or `ai-testing-relay-ws`.

---

## 0. WORK_LOG gate

Prior `[DONE]` entry (2026-06-02) documented Media Streams pivot; this task **re-opens `openai_sip`** per Chris directive — surgical GA + correlation + greeting control WS fixes only.

---

## 1. Doc verification (June 2026 GA — confirmed)

### 1a. `POST /v1/realtime/calls/{call_id}/accept` (GA)

Source: [Realtime SIP guide](https://platform.openai.com/docs/guides/realtime-sip), accept curl example.

| Field | GA value |
|-------|----------|
| `type` | `"realtime"` (required) |
| `model` | `"gpt-realtime-2"` in official SIP example; env `OPENAI_REALTIME_MODEL` (fallback `gpt-realtime-2`) |
| `instructions` | string — same as client-secret / accept |
| `output_modalities` | `["audio"]` — **not** legacy `modalities` |
| `audio.input.format.type` | `"audio/pcmu"` for telephony µ-law — **not** `g711_ulaw` or flat `input_audio_format` |
| `audio.output.format.type` | `"audio/pcmu"` |
| `audio.output.voice` | voice id string (e.g. `alloy`) |
| `audio.input.turn_detection` | `{ "type": "server_vad", ... }` — required for model to listen on SIP leg |
| `temperature` | optional; GA range **[0.6, 1.2]** when present |

Minimal accept in docs works for voice-only; we send full audio + VAD so conversation continues even if control WS fails.

### 1b. Control WebSocket after accept (GA)

| Item | Confirmed |
|------|-----------|
| URL | `wss://api.openai.com/v1/realtime?call_id={call_id}` — `model` query **not** used when `call_id` set |
| Preferred auth | `Authorization: Bearer {OPENAI_API_KEY}` header (Node `ws` / Python `websockets`) |
| Deno / Edge | `new WebSocket(url, ["realtime", "openai-insecure-api-key.{OPENAI_API_KEY}"])` — per [openai-node GA `realtime/websocket.ts`](https://github.com/openai/openai-node/blob/master/src/realtime/websocket.ts); **no** `openai-beta.realtime-v1` subprotocol |
| Greeting | `response.create` with `response.instructions` after `open` |
| Lifetime | Close WS on first `response.done` / `response.completed` — do not hold 30+ min |

### 1c. Twilio → OpenAI SIP correlation (updated after live 13224)

| Item | Confirmed |
|------|-----------|
| SIP URI | **Bare only:** `sip:proj_…@sip.api.openai.com;transport=tls` — query-string custom headers caused Twilio **13224** / SIP **400** on live tests |
| Correlation | **`X-Twilio-CallSid`** in OpenAI `sip_headers` → `ai_test_sessions.twilio_call_sid` (confirmed working on failed calls) |
| Greeting WS | **Disabled** on Supabase Edge — Deno cannot pass Bearer auth to control WS; `server_vad` on accept lets caller speak first |

**Diagnostic branch (Chris next call):** If bare URI bridges → header was the problem. If SIP 400 persists → media/SDP/trunk topology (Elastic SIP Trunk + Secure Trunking), not code.

---

## 2. Files to touch

| File | Change |
|------|--------|
| `implementation_plan.md` | This plan + doc answers |
| `supabase/functions/_shared/openaiRealtimeSip.ts` | GA accept body, GA WS handshake, close on greeting done, SIP URI header, resolve header names |
| `supabase/functions/ai-testing-twiml/index.ts` | Pass `sessionId` into `openaiSipUri(sessionId)` |
| `supabase/functions/ai-testing-openai-webhook/index.ts` | (no logic change if shared module carries fixes) |
| `supabase/functions/ai-testing-place-call/index.ts` | Confirm / document sync `twilio_call_sid` write (already present) |
| `WORK_LOG.md` | Newest-first entry after deploy |

**Deploy (verify_jwt=false):** `ai-testing-openai-webhook`, `ai-testing-twiml` (if twiml changed)

**Explicitly NOT touched:** DialerPage, TwilioContext, `twilio-*`, `ai-testing-stream-ws`, `ai-testing-relay-ws`

---

## 3. Expected debug_log sequence (successful call)

1. `place_call.start` → `place_call.placed` (includes `callSid`)
2. `twiml.received` → `twiml.session_loaded` → `twiml.returning` (bare Dial Sip URI)
3. `openai_webhook.incoming` → `openai_webhook.accepted`
4. *(no control WS events)* — caller speaks first; AI responds via `server_vad`

If step 2 fails with `status.dial_action` / `DialSipResponseCode: 400`: capture full dial_action payload → trunk topology decision.

---

## 4. Live test (Chris only)

OpenAI Project webhook → `ai-testing-openai-webhook`, event `realtime.call.incoming`, secrets `OPENAI_API_KEY`, `OPENAI_PROJECT_ID`, `OPENAI_WEBHOOK_SECRET`, `OPENAI_REALTIME_MODEL`.
