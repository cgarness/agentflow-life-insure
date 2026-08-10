-- Optional per-campaign outbound ring timeout (seconds).
-- NULL = use organization phone_settings.ring_timeout; frontend default fallback is 25s.

ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS ring_timeout_seconds INTEGER;

COMMENT ON COLUMN public.campaigns.ring_timeout_seconds IS
  'Outbound ring timeout for this campaign (seconds). NULL falls back to phone_settings.ring_timeout.';

NOTIFY pgrst, 'reload schema';
