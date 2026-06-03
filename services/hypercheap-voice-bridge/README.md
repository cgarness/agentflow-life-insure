# hypercheap-voice-bridge

AI Testing only. Python FastAPI bridge that connects a **Twilio Media Stream** to
the **Hypercheap** provider stack:

```
Twilio Media Stream (µ-law 8k)
  → Fennec ASR (PCM16 16k)
  → OpenRouter LLM (OpenAI-compatible streaming chat completions)
  → Inworld TTS (inworld-tts-1)
  → Twilio audio back (µ-law 8k)
```

The agent speaks first: **"Hi, this is Sarah. Can you hear me okay?"**

This service is **not** connected to the production dialer, campaigns, queue, or
dispositions. It only reads/writes `ai_test_sessions` rows whose
`stack = hypercheap_voice_agent`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health`, `/healthz` | Liveness |
| GET | `/ready` | Readiness (which providers configured — no secrets) |
| WS | `/twilio/hypercheap?sessionId=<uuid>` | Twilio Media Stream bridge |

Auth is the per-session `bridge_token` passed in a Twilio `<Parameter>` (never in
the Stream URL, never a global secret).

## Render setup

- **Root directory:** `services/hypercheap-voice-bridge`
- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Instance:** paid **always-on** (free-tier cold start → first call answers to silence)
- **Health check path:** `/healthz`

### Environment variables (Render only — never Supabase/browser)

| Variable | Default | Notes |
|----------|---------|-------|
| `FENNEC_API_KEY` | — | Fennec ASR auth |
| `FENNEC_WS_URL` | `wss://api.fennec-asr.com/v1/realtime` | Confirm against Fennec docs |
| `FENNEC_SAMPLE_RATE` | `16000` | |
| `FENNEC_CHANNELS` | `1` | |
| `OPENROUTER_API_KEY` | — | OpenRouter auth |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` | Fast/cheap; UI can override |
| `OPENROUTER_SITE_URL` | `https://app.agentflowcrm.com` | OpenRouter attribution |
| `OPENROUTER_APP_NAME` | `AgentFlow` | OpenRouter attribution |
| `INWORLD_API_KEY` | — | Inworld auth |
| `INWORLD_BASE_URL` | `https://api.inworld.ai/tts/v1/voice` | Confirm against Inworld docs |
| `INWORLD_MODEL_ID` | `inworld-tts-1` | |
| `INWORLD_VOICE_ID` | `Ashley` | UI can override |
| `INWORLD_SAMPLE_RATE` | `48000` | Resampled to 8k µ-law for Twilio |
| `INWORLD_AUTH_SCHEME` | `Basic` | `Basic` or `Bearer` |
| `SUPABASE_URL` | — | Session + debug_log writes |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role (server only) |

The Supabase Edge secret `HYPERCHEAP_VOICE_BRIDGE_WSS_URL` (e.g.
`wss://hypercheap-voice-bridge.onrender.com`) points the TwiML at this service.

## Local run

```bash
cd services/hypercheap-voice-bridge
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 10000
# GET http://localhost:10000/healthz  -> {"ok": true, ...}
```

## Notes / known limitations

- Experimental latency/cost benchmark — not for production campaigns.
- `FENNEC_WS_URL` / `INWORLD_BASE_URL` and message shapes are configurable; verify
  against the live provider docs and adjust `app/fennec.py` / `app/inworld.py` if a
  field name differs. Failures are logged to `debug_log` with the exact stage.
