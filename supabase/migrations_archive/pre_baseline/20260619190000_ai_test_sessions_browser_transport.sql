-- AI Testing: browser transport. Lets a super admin test an agent through the
-- browser mic/speakers (WebSocket to ai-voice-bridge /browser/*) instead of a
-- Twilio phone call. Phone sessions remain the default.

ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS transport text NOT NULL DEFAULT 'phone';

ALTER TABLE public.ai_test_sessions
  DROP CONSTRAINT IF EXISTS ai_test_sessions_transport_check;

ALTER TABLE public.ai_test_sessions
  ADD CONSTRAINT ai_test_sessions_transport_check
  CHECK (transport IN ('phone', 'browser'));

-- Browser sessions have no phone numbers.
ALTER TABLE public.ai_test_sessions
  ALTER COLUMN to_number DROP NOT NULL;

ALTER TABLE public.ai_test_sessions
  ALTER COLUMN from_number DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ai_test_sessions_org_transport_created_idx
  ON public.ai_test_sessions (organization_id, transport, created_at DESC);

COMMENT ON COLUMN public.ai_test_sessions.transport IS
  'How the test audio is carried: phone (Twilio Media Streams) | browser (mic/speakers over WebSocket to ai-voice-bridge /browser/*).';
