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
| `SUPABASE_URL` | Yes | Session + debug_log writes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role (server only) |
| `PORT` | Auto | Set by Render |
| `NODE_VERSION` | **22** | If Render Dashboard sets `NODE_VERSION=20`, either remove it or keep it — bridge passes `ws` as Supabase Realtime transport on Node 20+ |

**Instance:** paid always-on — free tier cold start → first call answers to silence.

**Health:** `GET /health` or `GET /healthz`

**Paths:**

- `wss://<host>/twilio?sessionId=<uuid>` — OpenAI Realtime (µ-law Media Streams)
- `wss://<host>/twilio/deepgram?sessionId=<uuid>` — Deepgram Voice Agent

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

## 8. Compare OpenAI vs Deepgram

| | OpenAI button | Deepgram button |
|---|---------------|-----------------|
| Upstream | OpenAI Realtime | Deepgram Voice Agent |
| Render path | `/twilio` | `/twilio/deepgram` |
| STT/TTS | OpenAI bundled | Deepgram Flux + Aura |
| LLM | OpenAI Realtime | Managed OpenAI via Deepgram `think` (picker: gpt-4o-mini / gpt-4o) |
| Tunables | Voice, temperature, interruption | Voice (Aura), LLM model, temperature, speaking rate, interruption (Flux turn-taking) |
| Debug prefix | `stream_ws.*` | `twilio.stream.*` / `deepgram.*` |

Use the same mock lead + prompt; compare latency, barge-in, and transcript quality in the Debug Panel.

## 9. Twilio

- Use an active org **From** number on the Twilio **master** account (same as the human dialer)
- ConversationRelay optional (legacy stack; not exposed on the AI Testing page)

## 10. Test

1. Log in as **Super Admin**
2. Sidebar → **AI Testing**
3. Enter mobile as **To**, org **From** number
4. **Place OpenAI Phone Test Call** or **Place Deepgram Phone Test Call**
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

Stored on `ai_test_sessions.usage_metrics`. Legacy sessions without metrics can show **Estimated from debug log** (lower confidence).

**Rate card (US pay-as-you-go, June 2026)** — see `src/lib/aiTestingBillingRates.ts`:

- Twilio outbound $0.0140/min, Media Streams $0.0040/min, recording $0.0025/min — [Twilio US Voice pricing](https://www.twilio.com/en-us/voice/pricing/us)
- Deepgram Voice Agent **Standard** $0.075/min (websocket connection time) — [Deepgram pricing](https://deepgram.com/pricing)
- OpenAI Realtime: rates for **configured** `OPENAI_REALTIME_MODEL` on Render (default `gpt-realtime`) — [OpenAI API pricing](https://openai.com/api/pricing/); audio token rules — [Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs)

**Deploy note:** After pulling billing changes, apply migration `20260603120000`, redeploy `ai-testing-status`, `ai-testing-recording-status`, and Render `ai-voice-bridge`, then Vercel frontend.
