-- Lead context JSON for AI Testing voice calls (POC).

ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS lead_context jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ai_test_sessions.lead_context IS 'Prospect fields injected into the agent system prompt (POC lab only).';
