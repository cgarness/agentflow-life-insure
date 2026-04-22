-- Audit + rate-limit log for on-demand Twilio Voice Insights reputation checks.
-- Max 3 checks per phone_numbers row per UTC day (enforced in Edge); Super Admin bypass in app logic.

CREATE TABLE IF NOT EXISTS public.phone_number_reputation_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  phone_number_id uuid NOT NULL REFERENCES public.phone_numbers (id) ON DELETE CASCADE,
  checked_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phone_number_reputation_checks_phone_created_idx
  ON public.phone_number_reputation_checks (phone_number_id, created_at DESC);

CREATE INDEX IF NOT EXISTS phone_number_reputation_checks_org_idx
  ON public.phone_number_reputation_checks (organization_id);

COMMENT ON TABLE public.phone_number_reputation_checks IS
  'Twilio reputation check invocations; used for 3 checks/number/UTC day rate limit (Edge Function).';

ALTER TABLE public.phone_number_reputation_checks ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT policies for authenticated users; Edge uses service role. Keeps logs server-side.

NOTIFY pgrst, 'reload schema';
