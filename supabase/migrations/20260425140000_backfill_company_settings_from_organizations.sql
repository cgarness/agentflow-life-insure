-- Backfill Company Branding (`company_settings.company_name`) for orgs missing a row
-- or with a blank name, using `organizations.name` so Agencies / org detail match legacy data.

INSERT INTO public.company_settings (organization_id, company_name, updated_at)
SELECT o.id, o.name, now()
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_settings cs WHERE cs.organization_id = o.id
);

UPDATE public.company_settings cs
SET company_name = o.name, updated_at = now()
FROM public.organizations o
WHERE cs.organization_id = o.id
  AND (cs.company_name IS NULL OR btrim(cs.company_name) = '');

NOTIFY pgrst, 'reload schema';
