-- Standalone AI voice testing lab (POC). Not linked to calls/leads/campaigns.

CREATE TABLE IF NOT EXISTS public.ai_test_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  stack text NOT NULL CHECK (stack IN ('twilio_cr', 'xai_s2s', 'openai_realtime')),
  prompt text NOT NULL,
  to_number text NOT NULL,
  from_number text NOT NULL,
  twilio_call_sid text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled')),
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_test_sessions_org_created_idx
  ON public.ai_test_sessions (organization_id, created_at DESC);

ALTER TABLE public.ai_test_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_test_sessions_select_super_admin ON public.ai_test_sessions
  FOR SELECT
  USING (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_super_admin = true
    )
  );

COMMENT ON TABLE public.ai_test_sessions IS 'POC AI voice lab sessions; isolated from production calls CRM.';
