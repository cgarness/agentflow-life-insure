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

Functions: `ai-testing-place-call`, `ai-testing-twiml`, `ai-testing-status`, `ai-testing-recording-status`, `ai-testing-relay-ws`, `ai-testing-stream-ws`

## 5. Twilio

- Enable **ConversationRelay** + **ElevenLabs** on your Twilio account
- Use an active org **From** number (must exist on the Twilio **master** account — same numbers as the human dialer)

## 6. Test

1. Log in as **Super Admin**
2. Sidebar → **AI Testing**
3. Enter your mobile as **To**, pick stack, **Place test call**
