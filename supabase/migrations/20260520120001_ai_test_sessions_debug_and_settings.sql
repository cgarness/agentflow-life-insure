-- AI Testing lab — Deploy 1 (logging) + Deploy 2 (settings) schema.
-- Additive: original table was created via Management API SQL and is not
-- registered in supabase_migrations; everything here uses IF NOT EXISTS so
-- it's safe to run against the live shape.

ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS lead_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS debug_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS voice_id text,
  ADD COLUMN IF NOT EXISTS temperature numeric(3,2) DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS speaking_rate numeric(3,2) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS interruption_sensitivity text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS model_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_test_sessions_interruption_sensitivity_check'
  ) THEN
    ALTER TABLE public.ai_test_sessions
      ADD CONSTRAINT ai_test_sessions_interruption_sensitivity_check
      CHECK (interruption_sensitivity IN ('low', 'medium', 'high'));
  END IF;
END$$;

COMMENT ON COLUMN public.ai_test_sessions.debug_log IS
  'Append-only bridge lifecycle log written by ai-testing-* Edge Functions: [{at, level, event, data}]';
COMMENT ON COLUMN public.ai_test_sessions.voice_id IS
  'Provider-specific voice id (ElevenLabs voice name for Stack A, OpenAI/xAI voice name for B/C).';
