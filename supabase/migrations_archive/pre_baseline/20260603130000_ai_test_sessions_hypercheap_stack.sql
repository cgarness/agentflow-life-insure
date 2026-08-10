-- AI Testing: Hypercheap Voice Agent stack (Fennec ASR → OpenRouter LLM → Inworld TTS).
-- AI Testing only — does not touch production dialer, campaigns, queue, or dispositions.

ALTER TABLE public.ai_test_sessions
  DROP CONSTRAINT IF EXISTS ai_test_sessions_stack_check;

ALTER TABLE public.ai_test_sessions
  ADD CONSTRAINT ai_test_sessions_stack_check
  CHECK (stack IN (
    'twilio_cr',
    'xai_s2s',
    'openai_realtime',
    'openai_sip',
    'deepgram_voice_agent',
    'hypercheap_voice_agent'
  ));

COMMENT ON COLUMN public.ai_test_sessions.stack IS
  'Voice stack: twilio_cr | xai_s2s | openai_realtime | openai_sip | deepgram_voice_agent | hypercheap_voice_agent';

-- bridge_token already added by the Deepgram migration (20260602150000). Reuse it
-- for the Hypercheap Render bridge; keep this idempotent for fresh databases.
ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS bridge_token text;

-- Per-stack extra tunables that do not have a dedicated column. For
-- hypercheap_voice_agent this holds { max_response_tokens, vad_aggressiveness }.
ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS tunables jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ai_test_sessions.tunables IS
  'Per-stack extra tunables (jsonb). hypercheap_voice_agent: max_response_tokens, vad_aggressiveness.';
