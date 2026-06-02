# Implementation Plan | AI Testing — Render voice bridge (OpenAI Realtime)

**Status:** CODE DONE — TwiML v24 deployed; Chris deploys Render + sets Edge secrets before live test  
**Date:** 2026-06-02  
**Production project:** `jncvvsvckxhqgqvkppmj`  
**Scope:** Move Twilio Media Streams ↔ OpenAI Realtime bridge off Supabase Edge (502 on WebSocket upgrade) to Render Node. **Do NOT** touch DialerPage, TwilioContext, production dialer, or `ai-testing-stream-ws` deletion (keep as fallback reference).

---

## 0. WORK_LOG gate

Live `debug_log` shows `openai_realtime` and `twilio_cr` stop at `twiml.returning` — Twilio never completes the Media Streams WebSocket upgrade on Supabase Edge (gateway **502**). `openai_sip` fails at SIP 400. This plan fixes **OpenAI Realtime** only via Render; CR and SIP unchanged.

---

## 1. Doc verification (June 2026 GA — confirmed)

### 1a. OpenAI Realtime WebSocket (server / Node)

Source: [Realtime WebSocket guide](https://platform.openai.com/docs/guides/realtime-websocket), live `ai-testing-stream-ws` v20, OpenAI SIP shared module.

| Item | Confirmed value |
|------|-----------------|
| URL | `wss://api.openai.com/v1/realtime?model={OPENAI_REALTIME_MODEL}` — default **`gpt-realtime`** (env may set `gpt-realtime-2`) |
| Auth (Node) | **`Authorization: Bearer {OPENAI_API_KEY}`** — NOT `openai-insecure-api-key` subprotocol |
| `session.update` | `type: "session.update"`, `session.type: "realtime"` |
| `output_modalities` | `["audio"]` |
| Telephony audio | `audio.input.format.type` / `audio.output.format.type` = **`"audio/pcmu"`** (G.711 µ-law) — not legacy `g711_ulaw` |
| VAD | `audio.input.turn_detection`: `{ type: "server_vad", ... }` from interruption sensitivity |
| Voice | `audio.output.voice` (string id, e.g. `alloy`) |
| Speed | `audio.output.speed` (number) |
| Transcription | `audio.input.transcription: { model: "whisper-1" }` |
| Temperature | Optional; GA clamp **[0.6, 1.2]** |
| Ready events | `session.created` / `session.updated` |
| Caller audio in | `input_audio_buffer.append` with base64 µ-law in `audio` field |
| Caller audio out | `response.output_audio.delta` (legacy: `response.audio.delta`) — `delta` or `audio.delta` |
| Barge-in | On `input_audio_buffer.speech_started`: `input_audio_buffer.clear` + Twilio `{ event: "clear", streamSid }` |
| Greet first | `response.create` with `response.instructions` after `streamSid` known (lead-based greeting) |

### 1b. Twilio Media Streams (bidirectional)

Source: Twilio Media Streams docs + ported `ai-testing-stream-ws` logic.

| Event | Direction | Shape |
|-------|-----------|--------|
| `connected` | Twilio → app | Log only |
| `start` | Twilio → app | `start.streamSid`, `start.callSid`, `start.mediaFormat`, `start.customParameters` |
| `media` | Twilio → app | `media.payload` — base64 **PCMU 8 kHz** |
| `stop` | Twilio → app | Close upstream |
| `media` | app → Twilio | `{ event: "media", streamSid, media: { payload } }` |
| `clear` | app → Twilio | `{ event: "clear", streamSid }` — barge-in |
| Custom params | TwiML `<Parameter>` | Available on `start.customParameters` (e.g. `sessionId`, `bridgeSecret`) |

### 1c. Why Supabase Edge fails

Edge Functions return **502** on WebSocket upgrade for long-lived Media Streams. Live stream-ws v20 mitigates with upgrade-before-DB + `EdgeRuntime.waitUntil`, but Twilio upgrade still fails in production. Render Web Service holds persistent WebSockets.

---

## 2. Files to create or touch

| Path | Action |
|------|--------|
| `implementation_plan.md` | This plan |
| `services/ai-voice-bridge/package.json` | **Create** — Node service |
| `services/ai-voice-bridge/tsconfig.json` | **Create** |
| `services/ai-voice-bridge/src/*.ts` | **Create** — port bridge from `ai-testing-stream-ws` |
| `render.yaml` | **Create** — Render Web Service blueprint |
| `supabase/functions/ai-testing-twiml/index.ts` | **Edit** — `openai_realtime` → `AI_VOICE_BRIDGE_WSS_URL` + secret |
| `src/components/ai-testing/AITestingStackSelector.tsx` | **Edit** — remove xAI card; update OpenAI helper text |
| `WORK_LOG.md` | **Append** after handoff |

**Deploy:** `ai-testing-twiml` (`verify_jwt=false`). Edge secrets: `AI_VOICE_BRIDGE_WSS_URL`, `AI_VOICE_BRIDGE_SECRET`.

**Explicitly NOT touched:** DialerPage, TwilioContext, `twilio-*`, `ai-testing-stream-ws` (no delete), `ai-testing-relay-ws`, `openai_sip` / `twilio_cr` TwiML branches.

---

## 3. Expected debug_log sequence (successful `openai_realtime` call)

1. `place_call.start` → `place_call.placed`
2. `twiml.received` → `twiml.session_loaded` → `twiml.returning` (Stream URL = Render WSS)
3. `stream_ws.upgrade` → `stream_ws.twilio_socket_open` → `stream_ws.upstream_connecting` → `stream_ws.upstream_ready`
4. `stream_ws.twilio_connected` → `stream_ws.twilio_start` → `stream_ws.greeting_fired`
5. `stream_ws.first_media_out` + `stream_ws.first_media_in`
6. On hangup: `stream_ws.twilio_stop` → `stream_ws.twilio_socket_close`; session `completed` or `failed`

---

## 4. Render setup (Chris — console)

See WORK_LOG entry and §5 below. **Always-on (paid) instance required** — free tier spin-down causes first call to answer to silence.

---

## 5. WSS URL format

- Edge secret `AI_VOICE_BRIDGE_WSS_URL` = base only, e.g. `wss://ai-voice-bridge.onrender.com/twilio` (no query).
- TwiML builds: `{base}?sessionId={uuid}&secret={AI_VOICE_BRIDGE_SECRET}` plus `<Parameter name="sessionId">` and `<Parameter name="bridgeSecret">`.
