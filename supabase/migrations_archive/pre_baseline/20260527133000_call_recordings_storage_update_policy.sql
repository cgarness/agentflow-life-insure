-- Browser recording uploads use upsert:true, which requires UPDATE (and SELECT) on storage.objects.
-- Without UPDATE policies, authenticated uploads fail with RLS violation even when INSERT policies exist.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'call_recordings_update_own_org'
  ) THEN
    CREATE POLICY call_recordings_update_own_org
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'call-recordings'
        AND (storage.foldername(name))[1] = public.get_org_id()::text
      )
      WITH CHECK (
        bucket_id = 'call-recordings'
        AND (storage.foldername(name))[1] = public.get_org_id()::text
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can update call recordings'
  ) THEN
    CREATE POLICY "Authenticated users can update call recordings"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'call-recordings')
      WITH CHECK (bucket_id = 'call-recordings');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
