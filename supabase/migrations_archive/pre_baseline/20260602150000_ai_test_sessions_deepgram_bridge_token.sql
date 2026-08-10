-- AI Testing: Deepgram Voice Agent stack + per-session Render bridge token.

ALTER TABLE public.ai_test_sessions
  DROP CONSTRAINT IF EXISTS ai_test_sessions_stack_check;

ALTER TABLE public.ai_test_sessions
  ADD CONSTRAINT ai_test_sessions_stack_check
  CHECK (stack IN (
    'twilio_cr',
    'xai_s2s',
    'openai_realtime',
    'openai_sip',
    'deepgram_voice_agent'
  ));

COMMENT ON COLUMN public.ai_test_sessions.stack IS
  'Voice stack: twilio_cr | xai_s2s | openai_realtime | openai_sip | deepgram_voice_agent';

ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS bridge_token text;

COMMENT ON COLUMN public.ai_test_sessions.bridge_token IS
  'Single-use token for Render Media Stream auth (Twilio Parameter bridgeToken). Not exposed in Stream URL.';
