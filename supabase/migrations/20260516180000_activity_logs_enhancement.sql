-- Enhancement: add entity_type, entity_id, metadata columns to activity_logs
-- for structured audit trails (permission changes, etc.)

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_created
  ON public.activity_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_entity
  ON public.activity_logs (entity_type, entity_id);

NOTIFY pgrst, 'reload schema';
