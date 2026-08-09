-- Remove Project Status overlay table (feature removed from app).

DROP POLICY IF EXISTS "project_status_overlays_super_admin_all" ON public.project_status_overlays;

DROP TABLE IF EXISTS public.project_status_overlays;

NOTIFY pgrst, 'reload schema';
