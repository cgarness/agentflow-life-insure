# AI Testing — One-time setup

Code is in the repo. Remote Supabase deploy needs your **personal access token** or **database password** (CLI returned 401 from this machine).

## 1. Rotate API keys (important)

You pasted OpenAI, Deepgram, and xAI keys in chat. **Revoke and re-issue** them in each provider console, then update `supabase/functions/.env`.

## 2. Store keys for Edge Functions (production)

**Option A — Dashboard (fastest)**

1. [Supabase Dashboard](https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj/settings/functions) → Edge Functions → **Secrets**
2. Add:
   - `OPENAI_API_KEY`
   - `XAI_API_KEY`
   - `DEEPGRAM_API_KEY` (optional; Stack A uses Twilio’s Deepgram)

**Option B — CLI**

```bash
npx supabase login
cd agentflow-life-insure
bash scripts/deploy-ai-testing.sh
```

## 3. Apply database migration

**Option A — SQL Editor**

Paste and run: [`supabase/migrations/20260519120000_ai_test_sessions.sql`](../supabase/migrations/20260519120000_ai_test_sessions.sql)

**Option B — CLI / script**

```bash
export SUPABASE_DB_PASSWORD='your-db-password'   # Dashboard → Settings → Database
node scripts/apply-ai-test-migration.mjs
```

## 4. Deploy edge functions

```bash
npx supabase login
bash scripts/deploy-ai-testing.sh
```

Or deploy each function from Dashboard → Edge Functions → Deploy.

Functions: `ai-testing-place-call`, `ai-testing-end-call`, `ai-testing-twiml`, `ai-testing-status`, `ai-testing-recording-status`, `ai-testing-openai-webhook`, `ai-testing-relay-ws`, `ai-testing-stream-ws`

### OpenAI Realtime (SIP) stack (`openai_sip`)

Direct Twilio ↔ OpenAI audio (no AgentFlow media WebSocket). Requires Edge secrets:

- `OPENAI_API_KEY`
- `OPENAI_PROJECT_ID` (`proj_…` from OpenAI Project → General)
- `OPENAI_WEBHOOK_SECRET` (`whsec_…` from OpenAI after registering the webhook)
- `OPENAI_REALTIME_MODEL` (e.g. `gpt-realtime-2`)

**Chris — register webhook in OpenAI console**

1. [OpenAI Project → Webhooks](https://platform.openai.com/settings/project/webhooks)
2. URL: `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/ai-testing-openai-webhook`
3. Event: `realtime.call.incoming`
4. Copy the signing secret → Supabase secret `OPENAI_WEBHOOK_SECRET`

## 5. Twilio

- Enable **ConversationRelay** + **ElevenLabs** on your Twilio account
- Use an active org **From** number (must exist on the Twilio **master** account — same numbers as the human dialer)

## 6. Test

1. Log in as **Super Admin**
2. Sidebar → **AI Testing**
3. Enter your mobile as **To**, pick stack, **Place test call**

## 7. Settings (Phase 2)

The form supports per-call settings:

- **Voice** — provider-specific voice catalog (`src/lib/aiTestingVoices.ts`):
  - Stack A (ConversationRelay + ElevenLabs): Rachel, Bella, Elli, Adam, Antoni, Josh, Sam, Domi.
  - Stack B (xAI Grok Voice): eve, ara, alec, ben (experimental — xAI catalog not publicly enumerated).
  - Stack C (OpenAI Realtime): alloy, ash, ballad, coral, echo, sage, shimmer, verse.
- **Tunables** (collapsible):
  - **Temperature** 0.0–1.2 (default 0.7) — wired to OpenAI / xAI session config.
  - **Speaking rate** 0.5–1.5 (default 1.0) — Stack A only; B/C disabled because the realtime provider controls pacing.
  - **Interruption sensitivity** low/medium/high (default medium) — Stack A maps to ConversationRelay `interruptible` + `speechTimeout`; Stacks B/C tune the VAD `threshold` + `silence_duration_ms` on the upstream Realtime session.

All settings persist on `ai_test_sessions` (`voice_id`, `temperature`, `speaking_rate`, `interruption_sensitivity`, `model_id`) and are validated client-side with Zod (`src/lib/aiTestingFormSchema.ts`) and server-side in `ai-testing-place-call`.

## 8. Debug Panel

Super-Admin–only collapsible panel under `/ai-testing` shows the full `debug_log` JSONB for the most recent session (bridge lifecycle: Twilio signature checks with computed vs received signatures, WS upgrades, upstream open/close codes, first inbound/outbound media frames, errors with stack traces). Use this to diagnose bridge failures end-to-end.
