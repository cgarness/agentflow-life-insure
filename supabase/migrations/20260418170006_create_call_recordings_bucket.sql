-- Migration 6 of 7: Create call-recordings Supabase Storage bucket with org-scoped RLS.
-- Path convention: call-recordings/{org_id}/{date}/{filename}
-- Part of Twilio Migration Phase 1.

INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- INSERT policy: authenticated users may only upload into their own org's path prefix.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'call_recordings_insert_own_org'
  ) THEN
    CREATE POLICY call_recordings_insert_own_org
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'call-recordings'
        AND (storage.foldername(name))[1] = (
          SELECT organization_id::text
          FROM public.profiles
          WHERE id = auth.uid()
          LIMIT 1
        )
      );
  END IF;
END $$;

-- SELECT policy: authenticated users may only read recordings in their own org's path prefix.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'call_recordings_select_own_org'
  ) THEN
    CREATE POLICY call_recordings_select_own_org
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'call-recordings'
        AND (storage.foldername(name))[1] = (
          SELECT organization_id::text
          FROM public.profiles
          WHERE id = auth.uid()
          LIMIT 1
        )
      );
  END IF;
END $$;
