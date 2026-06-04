# AI Testing — One-time setup

Code is in the repo. Remote Supabase deploy needs your **personal access token** or **database password** (CLI returned 401 from this machine).

## 1. Rotate API keys (important)

You pasted OpenAI, Deepgram, and xAI keys in chat. **Revoke and re-issue** them in each provider console, then update Supabase Edge secrets and Render env (never the browser).

## 2. Store keys for Edge Functions (production)

**Option A — Dashboard (fastest)**

1. [Supabase Dashboard](https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj/settings/functions) → Edge Functions → **Secrets**
2. Add:
   - `OPENAI_API_KEY` (OpenAI Realtime path + ConversationRelay LLM)
   - `AI_VOICE_MONITOR_URL` or `AI_VOICE_BRIDGE_WSS_URL` — Render host only, e.g. `wss://ai-voice-bridge.onrender.com` (no `/twilio` path, no query string, **no secrets in URL**)
   - Twilio outbound: `TWILIO_ACCOUNT_SID` or `TWILIO_MASTER_ACCOUNT_SID` + matching auth token

**Do not** put `DEEPGRAM_API_KEY` in Supabase — it stays on Render only.

**Option B — CLI**

```bash
npx supabase login
cd agentflow-life-insure
bash scripts/deploy-ai-testing.sh
```

## 3. Apply database migrations

Run all migrations under `supabase/migrations/` that touch `ai_test_sessions`, including:

- `20260519120000_ai_test_sessions.sql` (base table)
- `20260602150000_ai_test_sessions_deepgram_bridge_token.sql` (`deepgram_voice_agent` stack + `bridge_token`)
- `20260603120000_ai_test_sessions_usage_metrics.sql` (`usage_metrics` jsonb for Billing tab)
- `20260603130000_ai_test_sessions_hypercheap_stack.sql` (`hypercheap_voice_agent` stack + `tunables` jsonb; reuses `bridge_token`)
- `20260603140000_ai_test_sessions_pipeline_stack.sql` (`pipeline_voice_agent` stack)
- `20260603160000_ai_test_sessions_inworld_realtime_stack.sql` (`inworld_realtime_agent` stack)

**Option B — CLI**

```bash
export SUPABASE_DB_PASSWORD='your-db-password'
npx supabase db push --linked
```

## 4. Deploy edge functions

```bash
npx supabase login
bash scripts/deploy-ai-testing.sh
```

Minimum for phone tests: `ai-testing-place-call`, `ai-testing-end-call`, `ai-testing-twiml`, `ai-testing-status`, `ai-testing-recording-status`.

Legacy `ai-testing-stream-ws` is **not** used by the AI Testing page buttons (OpenAI uses Render `/twilio`).

## 5. Render — `services/ai-voice-bridge`

Deploy from repo root (`render.yaml`) or manual Web Service:

| Variable | Required | Notes |
|----------|----------|--------|
| `OPENAI_API_KEY` | OpenAI button | Realtime on `/twilio` |
| `OPENAI_REALTIME_MODEL` | Optional | Default `gpt-realtime` |
| `DEEPGRAM_API_KEY` | Deepgram button | Voice Agent on `/twilio/deepgram` only |
| `INWORLD_API_KEY` | Inworld button | Realtime on `/twilio/inworld` only — never Supabase/browser |
| `INWORLD_ROUTER_MODEL` | Optional | Default `inworld/latency-optimizer-ab-test` |
| `INWORLD_VOICE_ID` | Optional | Default `Sarah` |
| `INWORLD_TTS_MODEL` | Optional | Default `inworld-tts-2` |
| `INWORLD_REALTIME_WS_URL` | Optional | Default `wss://api.inworld.ai/api/v1/realtime/session` |
| `SUPABASE_URL` | Yes | Session + debug_log writes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role (server only) |
| `PORT` | Auto | Set by Render |
| `NODE_VERSION` | **22** | If Render Dashboard sets `NODE_VERSION=20`, either remove it or keep it — bridge passes `ws` as Supabase Realtime transport on Node 20+ |

**Instance:** paid always-on — free tier cold start → first call answers to silence.

**Health:** `GET /health` or `GET /healthz`

**Paths:**

- `wss://<host>/twilio?sessionId=<uuid>` — OpenAI Realtime (µ-law Media Streams)
- `wss://<host>/twilio/deepgram?sessionId=<uuid>` — Deepgram Voice Agent
- `wss://<host>/twilio/inworld?sessionId=<uuid>` — Inworld Realtime (speech-to-speech)

Auth uses a **per-session `bridge_token`** in Twilio `<Parameter name="bridgeToken">` only — not the Stream URL and not a global bridge secret.

## 6. OpenAI Realtime phone test (`openai_realtime`)

1. Supabase secrets: `OPENAI_API_KEY`, `AI_VOICE_MONITOR_URL` (or `AI_VOICE_BRIDGE_WSS_URL`)
2. Render: OpenAI vars + Supabase service role
3. AI Testing → **Place OpenAI Phone Test Call**
4. Twilio → `ai-testing-twiml` → Media Stream → Render `/twilio` → OpenAI Realtime

Debug events use `stream_ws.*` prefix in `debug_log`.

## 7. Deepgram Voice Agent phone test (`deepgram_voice_agent`)

Architecture: **Twilio Media Streams → Render WebSocket bridge → Deepgram Voice Agent API** (single WebSocket for STT + LLM + TTS).

1. Render: set `DEEPGRAM_API_KEY` (Dashboard → Deepgram API key)
2. Supabase: `AI_VOICE_MONITOR_URL` pointing at Render host (same as OpenAI)
3. AI Testing → **Place Deepgram Phone Test Call**
4. On answer, TwiML connects stream to `/twilio/deepgram`
5. Bridge waits for Deepgram `Welcome`, sends `Settings` (Flux `flux-general-en` / `v2`, µ-law 8 kHz), then `KeepAlive` every 5s until close
6. Opening line uses lead context (agent name + prospect first name) via `agent.greeting` in Settings

Expected `debug_log` sequence includes: `session.created`, `place_call.*`, `twiml.returning_deepgram_stream`, `twilio.stream.connected`, `deepgram.ws.connected`, `deepgram.settings.sent`, `deepgram.settings_snapshot`, `deepgram.agent.ready`, `deepgram.greeting_sent`, transcript events, `call.completed`.

## 8. Compare Deepgram vs Inworld (AI Testing page)

| | Deepgram Voice Agent | Inworld Realtime |
|---|---------------------|------------------|
| Upstream | Deepgram Voice Agent (all-in-one WS) | Inworld Realtime API (speech-to-speech) |
| Render service | `ai-voice-bridge` (Node) | `ai-voice-bridge` (Node) |
| Render path | `/twilio/deepgram` | `/twilio/inworld` |
| STT / LLM / TTS | Bundled in Voice Agent | Inworld Realtime session (`session.model` router + `audio.output.model` TTS) |
| Telephony audio | µ-law 8 kHz Media Streams | µ-law 8 kHz (`audio/pcmu`) passthrough |
| Supabase WSS secret | `AI_VOICE_MONITOR_URL` | `INWORLD_VOICE_BRIDGE_WSS_URL` (same host as Deepgram is fine) |
| Provider keys | `DEEPGRAM_API_KEY` on Render only | `INWORLD_API_KEY` on Render only |
| Debug prefix | `deepgram.*`, `twilio.stream.*` | `inworld.*`, `user.transcript`, `twilio.stream.*` |

Use the same mock lead + prompt; compare latency, barge-in, and transcript quality in the Debug Panel.

Legacy stacks (OpenAI, Hypercheap, Pipeline) remain in Edge/TwiML for old sessions but are not exposed on the AI Testing page.

## 8d. Inworld Realtime phone test (`inworld_realtime_agent`)

Architecture: **Twilio Media Streams → `ai-voice-bridge` `/twilio/inworld` → Inworld Realtime WebSocket** (`wss://api.inworld.ai/api/v1/realtime/session?key=…&protocol=realtime`). OpenAI-compatible events; µ-law 8 kHz in/out. Agent speaks first: **"Hi, this is Sarah. Can you hear me okay?"**

### Provider keys — Render only

`INWORLD_API_KEY` on the **`ai-voice-bridge`** Render service (Basic auth — Portal key is already Base64). Never in Supabase Edge secrets or the browser.

### Supabase Edge secret

**`INWORLD_VOICE_BRIDGE_WSS_URL`** = `wss://ai-voice-bridge.onrender.com` (host only — no path, no query). Can match `AI_VOICE_MONITOR_URL`.

### Database migration

Apply `20260603160000_ai_test_sessions_inworld_realtime_stack.sql`.

### Test

1. Super Admin → **AI Testing** → configure **Inworld Realtime call settings** (voice Sarah, router `inworld/latency-optimizer-ab-test`, TTS `inworld-tts-2`, temperature, interruption).
2. **Place Inworld Phone Test Call**.
3. Answer — hear Sarah greeting first, then two-way conversation.
4. Debug Panel expected sequence: `session.created` → `place_call.*` → `twiml.returning_inworld_stream` → `twilio.stream.connected` → `inworld.ws.connected` → `inworld.session.ready` → `inworld.greeting_sent` → `user.transcript` → `inworld.response.started` → `assistant.transcript` → `call.completed`.

### Cost estimate

Billing tab: Twilio outbound + Media Streams + Inworld STT/TTS/LLM lines from `usage_metrics.inworld` when `response.done` includes usage. **Estimated only — provider invoices remain authoritative.**

### Known limitation

AI Testing lab only — not production campaigns or the WebRTC dialer.

## 8b. Hypercheap Voice Agent phone test (`hypercheap_voice_agent`)

Architecture: **Twilio Media Streams → Python Render bridge `services/hypercheap-voice-bridge` → Fennec ASR → OpenRouter LLM → Inworld TTS → Twilio audio back.** The agent speaks first: **"Hi, this is Sarah. Can you hear me okay?"**

This is an **experimental cost/latency benchmark — not for production campaigns.** Like the other stacks it is a standalone lab and never touches `calls`, campaigns, dispositions, queue, or the production WebRTC dialer.

### Provider keys — Render only

`FENNEC_API_KEY`, `OPENROUTER_API_KEY`, and `INWORLD_API_KEY` live **only on Render** — never in Supabase Edge secrets and never in the browser. The bridge authenticates each Twilio stream with the per-session `bridge_token` (Twilio `<Parameter name="bridgeToken">`), not a URL secret.

### Render — `services/hypercheap-voice-bridge`

- **Root directory:** `services/hypercheap-voice-bridge`
- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Instance:** paid **always-on** (free-tier cold start → first call answers to silence)
- **Health:** `GET /health` or `GET /healthz`; readiness `GET /ready`

| Variable | Required | Notes |
|----------|----------|--------|
| `FENNEC_API_KEY` | Yes | Fennec ASR auth |
| `FENNEC_WS_URL` | Recommended | Default `wss://api.fennec-asr.com/v1/realtime` — confirm against Fennec docs |
| `FENNEC_SAMPLE_RATE` | — | Default `16000` |
| `FENNEC_CHANNELS` | — | Default `1` |
| `OPENROUTER_API_KEY` | Yes | OpenRouter auth |
| `OPENROUTER_BASE_URL` | — | Default `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | — | Default `google/gemini-2.5-flash` (fast/cheap; UI overrides per call). `google/gemini-2.0-flash-001` is deprecated/unrouted on OpenRouter (404 "No endpoints found") |
| `OPENROUTER_FALLBACK_MODEL` | — | Default `openai/gpt-4o-mini` — used automatically if the selected model returns 404 / "no endpoints" so a stale slug never silently kills a call |
| `OPENROUTER_SITE_URL` | — | Default `https://app.agentflowcrm.com` (attribution) |
| `OPENROUTER_APP_NAME` | — | Default `AgentFlow` (attribution) |
| `INWORLD_API_KEY` | Yes | Inworld auth |
| `INWORLD_MODEL_ID` | — | Default `inworld-tts-1` |
| `INWORLD_VOICE_ID` | Recommended | Default `Ashley`; UI overrides per call |
| `INWORLD_SAMPLE_RATE` | — | Default `48000` (resampled to 8k µ-law for Twilio) |
| `SUPABASE_URL` | Yes | Session + debug_log writes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role (server only) |

### Supabase Edge secret

Add **`HYPERCHEAP_VOICE_BRIDGE_WSS_URL`** = `wss://<hypercheap-bridge>.onrender.com` (host only — no `/twilio/hypercheap`, no query, no secrets). This is the only Hypercheap-related Supabase secret; the provider keys stay on Render.

### Database migration

Apply `20260603130000_ai_test_sessions_hypercheap_stack.sql` (adds `hypercheap_voice_agent` to the `stack` CHECK + a `tunables` jsonb column; reuses the existing `bridge_token`).

### Test

1. Log in as **Super Admin** → **AI Testing**.
2. Set the **Hypercheap call settings** (Inworld voice, OpenRouter model, Fennec VAD aggressiveness, max response tokens, temperature) or leave the safe defaults.
3. Enter **To** (your mobile) + an org **From** number; **Place Hypercheap Phone Test Call**.
4. Answer — you should hear **"Hi, this is Sarah. Can you hear me okay?"** first, then two-way conversation.
5. Expand the **Debug Panel** for the full sequence.

Expected `debug_log` sequence: `session.created`, `place_call.start`, `place_call.placed`, `twiml.received`, `twiml.returning_hypercheap_stream`, `twilio.stream.connected`, `fennec.ws.connecting`, `fennec.ws.ready`, `hypercheap.greeting_sent`, `twilio.media.track`, `fennec.audio.sent_first`, `fennec.vad.received` (caller starts speaking), `fennec.final.received` → `user.transcript`, `openrouter.reply.started`, `openrouter.reply.completed`, `inworld.tts.started`, `inworld.tts.completed`, `assistant.transcript`, `hypercheap.barge_in` (if interrupted), `twilio.stream.closed`, `hypercheap.closed`, `call.completed`. Failures log the exact stage event + `error_message`.

**Fennec transcription debug events** (added 2026-06-03 to diagnose the silent-ASR path): `fennec.audio.sent_first` (first PCM chunk reached Fennec), `fennec.audio.sent_every_100_chunks` (throughput heartbeat), `fennec.vad.received` (VAD `vad`/`utterance`/`state=speech`/`phase=begin`), `fennec.partial.received`, `fennec.final.received`, and `fennec.no_transcript_timeout` (~8 s of caller audio sent with no VAD/transcript back — points at a Fennec-side config/key/billing issue, not the Twilio path). The bridge also requests VAD events (`events: true`, `event_hz: 8`) in every VAD preset and only replays the **last ~500 ms** of pre-ready caller audio (older buffered audio is dropped and counted in `hypercheap.pending_audio_dropped`) so stale audio never pollutes the ASR stream.

### Fennec connectivity probe (ops diagnostic)

`GET https://<hypercheap-bridge>.onrender.com/fennec-probe` opens a Fennec streaming socket with the **same `source_default` VAD config** (incl. `events`/`event_hz`) the live bridge uses, streams a synthetic tone + silence, and returns every Fennec message. `ok: true` with a non-empty `texts` **or** `vad_event_count > 0` proves the `FENNEC_API_KEY` / account / VAD wiring works end-to-end (a pure tone exercises connectivity + VAD, not word transcription). If the probe fails, fix the Fennec key/billing before another phone test — no provider secrets are returned.

### Cost estimate

The Billing tab adds Twilio outbound ($0.014/min) + Media Streams ($0.004/min) plus the Hypercheap provider stack (Fennec ASR seconds, Inworld generated characters, OpenRouter prompt/completion tokens) and shows a total per-call estimate. **Estimated only — provider invoices remain authoritative.** Twilio is billed by Twilio regardless of the AI stack.

### Known limitation

Experimental benchmark, not production campaigns. `FENNEC_WS_URL` / `INWORLD_BASE_URL` and message shapes are configurable on Render; confirm against the live provider docs and adjust `app/fennec.py` / `app/inworld.py` if a field differs.

## 8c. Pipeline Voice Agent phone test (`pipeline_voice_agent`)

Architecture: **Twilio Media Streams → same Python Render service → Deepgram Flux v2 ASR (`/v2/listen`) → OpenRouter LLM → Inworld TTS.** Replaces Fennec in the Hypercheap design when Fennec ASR is silent in production. Same Sarah-first greeting.

**Not** the same as the **Deepgram** button — that uses the all-in-one **Voice Agent** API on the Node bridge. Pipeline uses **Flux listen only** for STT; you pick the OpenRouter model and Inworld voice yourself.

### Provider keys — Render only

Add **`DEEPGRAM_API_KEY`** to the existing `hypercheap-voice-bridge` Render service (same key as the Node bridge; never in Supabase). Also `OPENROUTER_API_KEY` and `INWORLD_API_KEY`.

### Pre-flight probe

After deploy: `GET https://<bridge-host>/deepgram-flux-probe` — expect `ok: true` and non-empty `texts` before placing a phone test.

### Database migration

Apply `20260603140000_ai_test_sessions_pipeline_stack.sql`.

### Test

1. Super Admin → **AI Testing** → **Pipeline call settings**.
2. **Place Pipeline Phone Test Call**.
3. Debug Panel should show: `twiml.returning_pipeline_stream` → `deepgram.flux.connecting` → `deepgram.flux.ready` → `pipeline.greeting_sent` → **`user.transcript`** after you speak → `openrouter.reply.started` → `inworld.tts.started` → `call.completed`.

### Deploy order

1. Apply DB migration (`pipeline_voice_agent` on `stack` CHECK)
2. Redeploy Edge functions (`ai-testing-place-call`, `ai-testing-twiml`)
3. Redeploy Render `hypercheap-voice-bridge` with `DEEPGRAM_API_KEY`
4. Frontend (Vercel on push)

## 9. Twilio

- Use an active org **From** number on the Twilio **master** account (same as the human dialer)
- ConversationRelay optional (legacy stack; not exposed on the AI Testing page)

## 10. Test

1. Log in as **Super Admin**
2. Sidebar → **AI Testing**
3. Enter mobile as **To**, org **From** number
4. **Place Deepgram** or **Inworld** phone test call
5. Answer the phone; confirm greeting and two-way audio
6. Expand **Debug Panel** for full `debug_log`

## 11. Settings

- **OpenAI** — voice + tunables (`PlaceOpenAICallSchema` in `src/lib/aiTestingFormSchema.ts`)
- **Deepgram** — separate section: Aura voice, LLM model (managed by Deepgram), temperature, speaking rate, interruption; lead form drives opening greeting

## 12. Known limitation

AI Testing is a **standalone lab**. It does not write to `calls`, campaigns, dispositions, or the production WebRTC dialer.

## 13. Debug Panel

Collapsible panel under `/ai-testing` shows `debug_log` for the active session: Twilio signature checks, stream lifecycle, Deepgram Welcome/Settings/KeepAlive, transcripts, and exact failure reasons.

## 14. Billing tab

**Test** and **Billing** tabs on `/ai-testing`. Billing shows a per-call **estimate** from measured usage (vendor invoices remain authoritative).

**What gets measured**

| Source | Field | Written by |
|--------|--------|------------|
| Twilio status | `call_duration_sec` | `ai-testing-status` on `completed` |
| Twilio recording | `recording_duration_sec` | `ai-testing-recording-status` |
| Media stream | `media_in_count`, `media_out_count`, `media_stream_sec`, audio seconds | Render `ai-voice-bridge` on stream close |
| Deepgram | `agent_ws_sec` | Bridge on Deepgram WS close |
| OpenAI | Audio/text tokens (API usage when present, else derived) | Bridge on `response.done` |
| Hypercheap | `fennec_asr_sec`, `inworld_chars`, `inworld_audio_sec`, `openrouter_prompt_tokens`, `openrouter_completion_tokens`, `bridge_session_sec` | Python bridge on stream close |
| Inworld Realtime | `stt_audio_sec`, `tts_audio_sec`, `tts_characters`, `input_tokens`, `output_tokens`, `router_model`, `tts_model` | Node bridge on `response.done` |

Stored on `ai_test_sessions.usage_metrics`. Legacy sessions without metrics can show **Estimated from debug log** (lower confidence).

**Rate card (US pay-as-you-go, June 2026)** — see `src/lib/aiTestingBillingRates.ts`:

- Twilio outbound $0.0140/min, Media Streams $0.0040/min, recording $0.0025/min — [Twilio US Voice pricing](https://www.twilio.com/en-us/voice/pricing/us)
- Deepgram Voice Agent **Standard** $0.075/min (websocket connection time) — [Deepgram pricing](https://deepgram.com/pricing)
- OpenAI Realtime: rates for **configured** `OPENAI_REALTIME_MODEL` on Render (default `gpt-realtime`) — [OpenAI API pricing](https://openai.com/api/pricing/); audio token rules — [Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs)

**Deploy note:** After pulling billing changes, apply migration `20260603120000`, redeploy `ai-testing-status`, `ai-testing-recording-status`, and Render `ai-voice-bridge`, then Vercel frontend.
