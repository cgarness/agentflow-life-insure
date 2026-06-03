# Implementation Plan | AI Testing — Hypercheap Voice Agent (Fennec ASR → OpenRouter LLM → Inworld TTS)

**Status:** CODE DONE — pending migration apply + Edge/Render deploy (Chris go-ahead). Approved by Chris 2026-06-03.
**Resolved decisions:** OpenRouter default model `google/gemini-2.0-flash-001`; Inworld voice = full selectable UI catalog (server `INWORLD_VOICE_ID` default `Ashley`).
**Date:** 2026-06-03
**Branch:** `claude/hypercheap-voice-agent-testing-Bi4R5`
**Production project:** `jncvvsvckxhqgqvkppmj`
**Scope:** Add a **third** AI Testing provider path — `hypercheap_voice_agent` — alongside the existing OpenAI Realtime and Deepgram Voice Agent paths. **AI Testing only.**

---

## 0. WORK_LOG conflict gate

| Check | Result |
|-------|--------|
| `[IN PROGRESS]` AI Testing entries | **None** — newest entries are `[DONE]` (Node 20 hotfix, Billing tab, Deepgram tunables) |
| Recent OpenAI/Deepgram bridge work (2026-06-02/03) | **Compatible** — we reuse the same `ai-testing-place-call` / `ai-testing-twiml` / `ai_test_sessions` / `bridge_token` / `usage_metrics` patterns |
| Conflict | **None** |

### Hard "do NOT touch" list (confirmed)
Production `DialerPage.tsx`, `TwilioContext.tsx`, `twilio-*` Edge Functions, `dialer-*` Edge Functions, CRM dispositions, campaign calling, queue logic, single-leg WebRTC dialer. None of the files below are in those paths.

---

## 1. Target architecture

```
AI Testing Page (Place Hypercheap Phone Test Call)
  → ai-testing-place-call            (super-admin; insert ai_test_sessions stack=hypercheap_voice_agent; bridge_token; place Twilio call)
  → Twilio outbound call
  → ai-testing-twiml                 (validate signature; return <Connect><Stream> to hypercheap bridge)
  → Twilio Media Stream (µ-law 8k)
  → services/hypercheap-voice-bridge (NEW Python FastAPI on Render, always-on)
        ├── Fennec ASR        (µ-law 8k → PCM16 → 16k → Fennec)
        ├── OpenRouter LLM    (OpenAI-compatible streaming chat completions)
        └── Inworld TTS       (PCM → µ-law 8k → Twilio media)
  → Twilio audio back
```

**Key invariant:** `FENNEC_API_KEY`, `OPENROUTER_API_KEY`, `INWORLD_API_KEY` live **only on Render**. Never in Supabase anon/browser, never in the Stream URL. Auth to the bridge is the per-session `bridge_token` in a Twilio `<Parameter>` (same pattern as OpenAI/Deepgram).

---

## 2. Decisions / deviations to confirm

| # | Topic | Decision in this plan |
|---|-------|----------------------|
| D1 | **Separate Render service** | Spec requires a **new Python service** `services/hypercheap-voice-bridge` (not extending the Node `ai-voice-bridge`). Adds a **second always-on Render Web Service**. |
| D2 | **Separate WSS env** | Spec requires Supabase secret **`HYPERCHEAP_VOICE_BRIDGE_WSS_URL`** (distinct from `AI_VOICE_MONITOR_URL`). New helper `hypercheapBridgeWssBase()` / `buildHypercheapStreamUrl()` in `_shared/aiTestingBridgeToken.ts`. Path on the bridge = `/twilio/hypercheap`. |
| D3 | **`bridge_token` reuse** | Column already exists (Deepgram migration `20260602150000`). **Reuse it** — the new migration only extends the `stack` CHECK. |
| D4 | **Greeting** | Fixed: **"Hi, this is Sarah. Can you hear me okay?"** spoken first by the agent (matches spec PART 6/7). |
| D5 | **Hypercheap tunables** | New per-session fields surfaced in UI: Fennec VAD aggressiveness (low/med/high), OpenRouter model id, Inworld voice id, max response tokens, temperature. Stored on existing `ai_test_sessions` columns where possible (`model_id`, `voice_id`, `temperature`, `interruption_sensitivity`) + a small new `tunables` jsonb column for the rest (`max_response_tokens`, `vad_aggressiveness`). Safe server-side defaults if omitted. |
| D6 | **Billing** | Extend `usage_metrics` with a `hypercheap` block (Fennec ASR sec, Inworld chars/audio sec, OpenRouter prompt/completion tokens, bridge session sec). New rate-card entries + a `hypercheap_voice_agent` branch in `aiTestingBilling.ts`. Clearly labeled estimate. |
| D7 | **VAD/barge-in** | Fennec VAD speech-start cancels active TTS/LLM turn + sends Twilio `clear` event. |

**Open question for Chris (non-blocking):** preferred default `OPENROUTER_MODEL` (fast+cheap, optimize first-token latency) — plan default suggestion: `openai/gpt-4o-mini` or `google/gemini-2.0-flash-001`. And default Inworld voice id. These live only as Render env defaults; the UI can override per session.

---

## 3. Files to create / change (approval required)

### A. Database (migration — NOT applied until approved)

| Path | Action |
|------|--------|
| `supabase/migrations/20260603130000_ai_test_sessions_hypercheap_stack.sql` | **Create** — extend `stack` CHECK to add `hypercheap_voice_agent`; add `tunables jsonb` column (`max_response_tokens`, `vad_aggressiveness`) `DEFAULT '{}'::jsonb`; keep existing `bridge_token` (reuse, no-op `ADD COLUMN IF NOT EXISTS`). Update `stack` comment. |

### B. Supabase Edge — AI Testing only

| Path | Action |
|------|--------|
| `supabase/functions/_shared/aiTestingSession.ts` | Add `"hypercheap_voice_agent"` to `AiTestStack`; add `tunables` to `AiTestSessionRow` + `loadSession` select. |
| `supabase/functions/_shared/aiTestingBridgeToken.ts` | Add `hypercheapBridgeWssBase()` (reads `HYPERCHEAP_VOICE_BRIDGE_WSS_URL`) + `buildHypercheapStreamUrl(sessionId)` (path `/twilio/hypercheap`). |
| `supabase/functions/ai-testing-place-call/index.ts` | Accept `hypercheap_voice_agent` in Zod enum; require `HYPERCHEAP_VOICE_BRIDGE_WSS_URL`; generate `bridge_token`; accept + store `model_id`, `voice_id`, `temperature`, `max_response_tokens`, `vad_aggressiveness` (→ `tunables`); logs `session.created` / `place_call.start` / `place_call.placed` (already present). |
| `supabase/functions/ai-testing-twiml/index.ts` | Add `hypercheap_voice_agent` branch → `<Connect><Stream url=".../twilio/hypercheap?sessionId=…" track="inbound_track"><Parameter sessionId/><Parameter bridgeToken/></Stream></Connect>`; log `twiml.returning_hypercheap_stream`; no `<Say>`, no `answerOnBridge`, no OpenAI SIP, no Deepgram path. Twilio signature already validated upstream. |

### C. NEW Python Render service — `services/hypercheap-voice-bridge`

| Path | Action |
|------|--------|
| `services/hypercheap-voice-bridge/requirements.txt` | `fastapi`, `uvicorn[standard]`, `websockets`, `httpx`, `openai`, `supabase`, `audioop-lts` (Py3.13 µ-law) / `numpy` + `samplerate`/`soxr` for resample, `pydantic`. |
| `services/hypercheap-voice-bridge/app/__init__.py` | Package init. |
| `services/hypercheap-voice-bridge/app/config.py` | Pydantic settings: Fennec/OpenRouter/Inworld/Supabase env + defaults (sample rates, base URL, model, voice). |
| `services/hypercheap-voice-bridge/app/main.py` | FastAPI app: `GET /health`, `GET /healthz`, `WS /twilio/hypercheap`. |
| `services/hypercheap-voice-bridge/app/session.py` | Supabase service-role client; `load_session`, `update_session`, `append_transcript`, `append_debug_log`, `merge_usage_metrics` (mirror Node `session.ts`/`usageMetrics.ts` event names + `bridge_token` check). |
| `services/hypercheap-voice-bridge/app/audio.py` | µ-law↔PCM16, 8k↔16k resample, Inworld PCM→µ-law 8k. |
| `services/hypercheap-voice-bridge/app/fennec.py` | Fennec ASR client (WS/HTTP streaming) — VAD speech-start + final transcript callbacks. |
| `services/hypercheap-voice-bridge/app/openrouter.py` | OpenRouter streaming chat-completions via `openai` SDK (`base_url=OPENROUTER_BASE_URL`, OpenRouter headers); cancellable turn; usage capture. |
| `services/hypercheap-voice-bridge/app/inworld.py` | Inworld TTS streaming client (`inworld-tts-1`); PCM out + char/audio-sec metering. |
| `services/hypercheap-voice-bridge/app/bridge.py` | Orchestrator: Twilio WS lifecycle, greeting, media in/out, barge-in, transcripts, debug_log sequence, usage_metrics on close. |
| `services/hypercheap-voice-bridge/app/prompt.py` | Port of `buildAgentPrompt` + lead-context block + Sarah greeting + appointment-setting system instructions (PART 7). |
| `services/hypercheap-voice-bridge/.python-version` | `3.13` (or `3.12`). |
| `services/hypercheap-voice-bridge/README.md` | Build/start/env notes. |

### D. `render.yaml`

| Path | Action |
|------|--------|
| `render.yaml` | Add a **second** Web Service `hypercheap-voice-bridge` (rootDir `services/hypercheap-voice-bridge`, env `python`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health `/healthz`, paid plan, all provider env vars `sync: false`). Existing `ai-voice-bridge` service untouched. |

### E. Frontend — AI Testing only

| Path | Action |
|------|--------|
| `src/lib/aiTestingVoices.ts` | Add `hypercheap_voice_agent` to `VoiceStack` + a small Inworld voice catalog (configurable; server default authoritative). |
| `src/lib/aiTestingFormSchema.ts` | Add `PlaceHypercheapCallSchema` (prompt/to/from + `model_id`, `voice_id`, `temperature`, `max_response_tokens`, `vad_aggressiveness`). |
| `src/lib/aiTestingHypercheap.ts` | **Create** — Hypercheap defaults (Fennec 16000/1, OpenRouter base URL, Inworld `inworld-tts-1`) + VAD enum. |
| `src/components/ai-testing/AITestingHypercheapSettings.tsx` | **Create** — Tailwind-only tuning section: Fennec VAD aggressiveness, OpenRouter model id, Inworld voice id, max response tokens, temperature. |
| `src/components/ai-testing/AITestingCallButtons.tsx` | Add **Place Hypercheap Phone Test Call** button + `onPlaceHypercheap`; widen `PlacingStack`. |
| `src/hooks/useAITestingSession.ts` | Add `placeHypercheapCall`; add `"hypercheap_voice_agent"` to `PlacingStack`; toast label. |
| `src/pages/AITestingPage.tsx` | Wire Hypercheap settings section + third button + `handlePlaceHypercheap`; keep mock lead form, prompt editor, phone inputs, debug panel, live status, billing tab; stack badge label. |
| `src/lib/aiTestingUsageMetrics.ts` | Add `hypercheap` block to `AiTestUsageMetrics` type. |
| `src/lib/aiTestingBillingRates.ts` | Add Fennec / OpenRouter (per-1M tokens, configurable model) / Inworld (per-char or per-min) rate entries + `RATES_AS_OF` bump + source URLs. |
| `src/lib/aiTestingBilling.ts` | Add `hypercheap_voice_agent` branch: Twilio legs + Fennec ASR + Inworld + OpenRouter lines; "Estimated only — provider invoices remain authoritative." |

### F. Docs / log

| Path | Action |
|------|--------|
| `docs/AI_TESTING_SETUP.md` | New Hypercheap section: architecture, Fennec/OpenRouter/Inworld keys (Render-only), Render setup, `HYPERCHEAP_VOICE_BRIDGE_WSS_URL` Supabase secret, cost estimate + Twilio caveat, test steps, known limitation (experimental benchmark, not production campaigns). |
| `WORK_LOG.md` | Append newest-first after implementation + verification. |
| `implementation_plan.md` | This file. |

### Explicitly NOT touched
`DialerPage.tsx`, `TwilioContext.tsx`, `twilio-*`, `dialer-*`, `ai-testing-stream-ws`, `ai-testing-relay-ws`, `ai-testing-openai-webhook`, the Node `services/ai-voice-bridge`, campaigns/queue/dispositions.

---

## 4. Bridge behavior (PART 6) — debug_log contract (PART 9)

Greeting: **"Hi, this is Sarah. Can you hear me okay?"** (agent speaks first).

Expected `debug_log` order:
```
session.created            (place-call)
place_call.start           (place-call)
place_call.placed          (place-call)
twiml.received             (twiml)
twiml.returning_hypercheap_stream  (twiml)
twilio.stream.connected    (bridge)
fennec.ws.connecting       (bridge)
fennec.ws.ready            (bridge)
hypercheap.greeting_sent   (bridge)
user.transcript            (bridge, per turn)
openrouter.reply.started   (bridge)
openrouter.reply.completed (bridge)
inworld.tts.started        (bridge)
inworld.tts.completed      (bridge)
assistant.transcript       (bridge, per turn)
hypercheap.barge_in        (bridge, if interrupted)
twilio.stream.closed       (bridge)
hypercheap.closed          (bridge)
call.completed             (bridge)
```
Failures include exact stage event + `error_message` on the session row.

Lifecycle:
- On WS connect: read `sessionId` + `bridgeToken` from `start.customParameters`; load session; verify `stack === hypercheap_voice_agent` and token match; else close.
- On `start`: start Fennec/OpenRouter/Inworld; send Sarah greeting via Inworld → µ-law 8k → Twilio.
- On `media`: base64 µ-law 8k → PCM16 → resample 16k → Fennec.
- Fennec final → append user transcript → OpenRouter stream → segment → Inworld stream → Twilio; append assistant transcript.
- Fennec VAD speech-start → cancel TTS/LLM turn → Twilio `clear` → `hypercheap.barge_in`.
- On close: close upstreams → `hypercheap.closed` → write `usage_metrics` if measurable.

---

## 5. Verification (PART 11)

- [ ] `npx tsc --noEmit` (repo root) clean
- [ ] `cd services/hypercheap-voice-bridge && pip install -r requirements.txt` + `python -c "import app.main"` import check / `uvicorn` boot locally if env allows
- [ ] Migration file present (applied only after approval)
- [ ] AI Testing page shows **three** buttons; existing OpenAI + Deepgram unaffected
- [ ] Hypercheap button places call; lead hears Sarah greeting first; two-way conversation
- [ ] Debug log populates per §4; billing estimate appears
- [ ] No production dialer files in diff; no provider keys in browser/Supabase anon

---

## 6. Deploy order (after approval + green checks)

1. Apply migration `20260603130000` (Supabase MCP).
2. Set Supabase Edge secret `HYPERCHEAP_VOICE_BRIDGE_WSS_URL = wss://<hypercheap-bridge>.onrender.com`.
3. Deploy Edge: `ai-testing-place-call`, `ai-testing-twiml`.
4. Create Render Python service (paid always-on) with Fennec/OpenRouter/Inworld/Supabase env.
5. Vercel frontend.
6. Super Admin → AI Testing → Place Hypercheap Phone Test Call.

---

**Next step:** Reply **approve** (or note amendments). On approval I implement parts 1–11 surgically, typecheck, append WORK_LOG, and end with a context snapshot. I will NOT modify files or run backend commands before approval.
```
