-- AI Testing: add openai_sip stack (OpenAI Realtime via direct SIP bridge).

ALTER TABLE public.ai_test_sessions
  DROP CONSTRAINT IF EXISTS ai_test_sessions_stack_check;

ALTER TABLE public.ai_test_sessions
  ADD CONSTRAINT ai_test_sessions_stack_check
  CHECK (stack IN ('twilio_cr', 'xai_s2s', 'openai_realtime', 'openai_sip'));

COMMENT ON COLUMN public.ai_test_sessions.stack IS
  'Voice stack: twilio_cr | xai_s2s | openai_realtime | openai_sip (Twilio Dial → OpenAI SIP, no media bridge).';
