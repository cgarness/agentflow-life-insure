-- Replace call-recordings storage policies with one clean org-scoped set.
-- Path: {organization_id}/{YYYYMMDD}/{callId}.webm
-- Uses public.get_org_id() + split_part (matches company-branding pattern).
-- Removes broad dashboard policies and profiles-subquery policies that can
-- trigger 42P17 / infinite recursion during Storage upsert evaluation.

-- DROP all existing call-recordings policies (dashboard + migrations)
DROP POLICY IF EXISTS "Authenticated users can read call recordings" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload call recordings" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update call recordings" ON storage.objects;
DROP POLICY IF EXISTS call_recordings_select_own_org ON storage.objects;
DROP POLICY IF EXISTS call_recordings_insert_own_org ON storage.objects;
DROP POLICY IF EXISTS call_recordings_update_own_org ON storage.objects;

-- SELECT (required for upsert + playback signed/download URLs)
CREATE POLICY call_recordings_select_own_org
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND split_part(name, '/', 1) = public.get_org_id()::text
);

-- INSERT
CREATE POLICY call_recordings_insert_own_org
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'call-recordings'
  AND split_part(name, '/', 1) = public.get_org_id()::text
);

-- UPDATE (required for upsert: true)
CREATE POLICY call_recordings_update_own_org
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND split_part(name, '/', 1) = public.get_org_id()::text
)
WITH CHECK (
  bucket_id = 'call-recordings'
  AND split_part(name, '/', 1) = public.get_org_id()::text
);

NOTIFY pgrst, 'reload schema';
