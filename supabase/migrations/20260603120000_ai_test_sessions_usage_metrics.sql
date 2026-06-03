-- AI Testing lab — per-call usage metrics for billing estimates.

ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS usage_metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ai_test_sessions.usage_metrics IS
  'Measured usage for cost estimates: Twilio durations, media packet counts, Deepgram WS seconds, OpenAI tokens.';
