# Implementation Plan — OpenAI Realtime GA (S2S) for AI Testing

**Owner:** Chris Garness | **Branch:** `claude/openai-realtime-s2s-testing-7XJ0T` | **Date:** 2026-06-02

---

## STEP 1 — State of the world (audit, no code)

### WORK_LOG conflict check
No AI-testing task is `[IN PROGRESS]`. The newest log entries are all Queue/Campaign builds (Build 1–4). The
last AI-testing entries are `2026-05-19 [DONE]` (Deploy 1 diagnostics + Deploy 2 settings/bridge fixes) and
`2026-05-18 [DONE]` (POC). **No conflict — clear to proceed.**

### AI testing FRONTEND — already wired (NOT mock, NOT partial)
The testing tab is **fully wired to `ai-testing-place-call`** via `useAITestingSession.placeCall`:
- Route `/ai-testing` is gated by `<SuperAdminRoute>` in `src/App.tsx` (matches backend Super-Admin gate).
- `src/pages/AITestingPage.tsx` (134 lines) composes extracted sub-components: stack selector, voice picker,
  tunables, lead form, prompt editor, phone inputs, call buttons, live status, debug panel.
- Form fields present: To, From (fetched from `phone_numbers` where `status=active`, not hardcoded), stack,
  system prompt (defaults to `APPOINTMENT_SETTING_PROMPT`), full lead-context fields.
- Zod via `src/lib/aiTestingFormSchema.ts` (`PlaceCallFormSchema` + `TuningSchema`).
- `src/lib/aiTestingPrompt.ts` already exists with the life-insurance appointment-setter `APPOINTMENT_SETTING_PROMPT`
  (single goal = book a 15–20 min appointment, voice-optimized, honor opt-out, never guarantee rates).
- Status states (`queued → ringing → in-progress → ended/failed`) + error surfacing + transcript render +
  Super-Admin debug panel all present. End Test → `ai-testing-end-call`. Poll = `ai_test_sessions` row every 2s.

**Gaps to close in STEP 4 (small):**
1. Default stack is `twilio_cr`; task requires default = `openai_realtime`.
2. Stack labels: need `openai_realtime` = "Speech-to-speech (recommended)", `twilio_cr` = "Transcribed (fallback)",
   `xai_s2s` = disabled/experimental (currently `twilio_cr` carries the "Recommended" badge and `xai_s2s` is selectable).

Everything else in STEP 4 already exists and must be reused, not rebuilt.

### OpenAI Realtime GA facts confirmed from current docs (June 2026)
- **Model:** latest GA speech-to-speech model is **`gpt-realtime-2`** (GA since 2026-05-08). Beta preview id
  `gpt-4o-realtime-preview-2024-12-17` is stale.
- **Handshake (header-less Deno):** `wss://api.openai.com/v1/realtime?model=<model>`. Deno's `WebSocket` cannot set
  an `Authorization` header, so the key rides the **`openai-insecure-api-key.<key>`** subprotocol (still supported
  in GA for browser/Deno/Workers). The **`openai-beta.realtime-v1`** subprotocol is **deprecated → drop it**.
- **`session.update` GA schema** (nested under `session.audio`, `output_modalities` replaces `modalities`):

```jsonc
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "<full prompt>",
    "output_modalities": ["audio"],
    "audio": {
      "input": {
        "format": { "type": "audio/pcmu" },                 // g711 mu-law 8k (Twilio)
        "turn_detection": { "type": "server_vad", "threshold": 0.5, "silence_duration_ms": 500 },
        "transcription": { "model": "whisper-1" }            // enables user-side transcript events
      },
      "output": {
        "format": { "type": "audio/pcmu" },                 // g711 mu-law 8k (Twilio)
        "voice": "alloy"
      }
    }
  }
}
```

### Field-by-field changes (beta → GA) in `connectUpstream()` openai branch
| Beta (current) | GA (target) |
|---|---|
| subprotocols `["realtime", "openai-insecure-api-key.<k>", "openai-beta.realtime-v1"]` | drop `openai-beta.realtime-v1` → `["realtime", "openai-insecure-api-key.<k>"]` |
| model fallback `gpt-4o-realtime-preview-2024-12-17` | `gpt-realtime-2` |
| `modalities: ["text","audio"]` | `output_modalities: ["audio"]` |
| `input_audio_format: "g711_ulaw"` (string) | `audio.input.format: { type: "audio/pcmu" }` |
| `output_audio_format: "g711_ulaw"` (string) | `audio.output.format: { type: "audio/pcmu" }` |
| `voice: "alloy"` (top-level) | `audio.output.voice: "alloy"` |
| `turn_detection: {...}` (top-level) | `audio.input.turn_detection: {...}` |
| (none) | `session.type: "realtime"` (GA discriminator) |
| (none — user transcript never enabled) | `audio.input.transcription: { model: "whisper-1" }` |
| `temperature: <n>` (top-level) | **removed** — GA gpt-realtime rejects session `temperature`; omit to avoid a session error (the #1 silent/garbled cause). Temperature stays wired for `twilio_cr`/`xai_s2s` only. |

**Preserved unchanged:** caller-audio buffering before bridge-ready, `input_audio_buffer.append/clear`,
barge-in on `input_audio_buffer.speech_started`, deferred opening greeting via `response.create` gated on
`streamSid`, defensive dual handling of `response.output_audio.delta`/`response.audio.delta` and
`response.output_audio_transcript.delta`/`response.audio_transcript.delta`, `conversation.item.input_audio_transcription.completed`
user transcript, all debug logging, `waitForUpstreamReady` (`session.created`/`session.updated`). The **xai branch is
left untouched** (known-broken, experimental). The **twilio_cr / relay-ws path is not touched.**

## STEP 2 — Secrets (verify by behavior; cannot read values)
- `OPENAI_API_KEY` — present (historical: `twilio_cr` calls placed, which requires it; place-call returns 503 if absent).
- `TWILIO_MASTER_AUTH_TOKEN` — present (calls were successfully placed in prior deploys).
- `OPENAI_REALTIME_MODEL` — **new, likely unset.** Code defaults the fallback to `gpt-realtime-2`, so an unset value
  is **non-blocking** (recommended config, not a hard blocker). Documented in WORK_LOG so Chris can set it to pin the model.

## STEP 3 — Files: backend
- `supabase/functions/ai-testing-stream-ws/index.ts` — modernize `connectUpstream()` openai branch + session.update to GA.
- Redeploy via `deploy_edge_function` with `index.ts` + `_shared/aiTestingSession.ts` + `_shared/aiTestingPrompt.ts`,
  `verify_jwt=false`. (Live v6 confirmed identical to repo before edit.)

## STEP 4 — Files: frontend
- `src/pages/AITestingPage.tsx` — default stack `twilio_cr` → `openai_realtime` (+ initial voice default).
- `src/components/ai-testing/AITestingStackSelector.tsx` — relabel + reorder; recommended badge on `openai_realtime`,
  `twilio_cr` = "Transcribed (fallback)", `xai_s2s` = disabled "Experimental".

## STEP 5 — Verify
`npx tsc --noEmit` (0 errors); `git diff` shows no DialerPage/TwilioContext/production dialer changes and no
twilio_cr/relay-ws path change. Live test per task. Append newest-first WORK_LOG entry + Context Snapshot.

## Files touched (complete list)
1. `implementation_plan.md` (this file)
2. `supabase/functions/ai-testing-stream-ws/index.ts`
3. `src/pages/AITestingPage.tsx`
4. `src/components/ai-testing/AITestingStackSelector.tsx`
5. `WORK_LOG.md`

**NOT touched:** DialerPage, TwilioContext, production dialer/Voice.js, `ai-testing-relay-ws`, the twilio_cr branch
of `ai-testing-twiml`, the xai branch of stream-ws, `verify_jwt` settings, any migration, any secret value.
