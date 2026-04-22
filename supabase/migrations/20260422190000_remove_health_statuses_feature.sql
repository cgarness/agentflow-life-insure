-- Remove Health Statuses feature: settings table + leads.health_status column.
-- CASCADE drops dependent RLS policies and triggers on health_statuses.

DROP TABLE IF EXISTS public.health_statuses CASCADE;

ALTER TABLE public.leads DROP COLUMN IF EXISTS health_status;

-- Remove obsolete required-field toggle key (UI label was "Health Status")
UPDATE public.contact_management_settings
SET required_fields_lead = required_fields_lead - 'Health Status'
WHERE required_fields_lead ? 'Health Status';

NOTIFY pgrst, 'reload schema';
