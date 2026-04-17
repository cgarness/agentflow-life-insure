-- Carrier branding and labeled contact methods (phones / emails)
ALTER TABLE public.carriers
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS contact_phones JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_emails JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.carriers.logo_url IS 'Carrier logo: HTTPS URL or data URL';
COMMENT ON COLUMN public.carriers.contact_phones IS 'JSON array of {label, value} for phone numbers';
COMMENT ON COLUMN public.carriers.contact_emails IS 'JSON array of {label, value} for email addresses';
