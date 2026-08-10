-- Harden activity_logs: add category + ip_address, org-scoped RLS, immutable (no UPDATE/DELETE).
-- metadata column already exists from 20260516180000_activity_logs_enhancement.sql.

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ip_address text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_logs_category_check'
  ) THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT activity_logs_category_check
      CHECK (category IN ('user_management', 'contacts', 'campaigns', 'telephony', 'settings', 'system'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_created
  ON public.activity_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_category
  ON public.activity_logs (category);

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.activity_logs;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.activity_logs;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.activity_logs;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_org" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_insert_org" ON public.activity_logs;

CREATE POLICY "activity_logs_select_org" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR organization_id = public.get_org_id()
  );

CREATE POLICY "activity_logs_insert_org" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR organization_id = public.get_org_id()
  );

NOTIFY pgrst, 'reload schema';
