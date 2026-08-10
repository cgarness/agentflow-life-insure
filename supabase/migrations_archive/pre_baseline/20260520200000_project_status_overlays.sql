-- Project Status overlays: super-admin working notes/status/sort on top of repo docs.

CREATE TABLE IF NOT EXISTS public.project_status_overlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key text NOT NULL UNIQUE,
  section text NOT NULL,
  status text,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS project_status_overlays_section_sort_idx
  ON public.project_status_overlays (section, sort_order);

ALTER TABLE public.project_status_overlays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_status_overlays_super_admin_all" ON public.project_status_overlays;

CREATE POLICY "project_status_overlays_super_admin_all"
  ON public.project_status_overlays
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

NOTIFY pgrst, 'reload schema';
