-- message_templates: attachments metadata + optional category
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (
    category IS NULL OR category IN ('Prospecting', 'Follow-Up', 'Appointment', 'Re-Engagement', 'Closing')
  ) DEFAULT NULL;

NOTIFY pgrst, 'reload schema';

-- Private bucket for email template file attachments (paths: {organization_id}/...)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'template-attachments',
  'template-attachments',
  false,
  5242880,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "template_attachments_select" ON storage.objects;
DROP POLICY IF EXISTS "template_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "template_attachments_delete" ON storage.objects;

CREATE POLICY "template_attachments_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'template-attachments'
  AND split_part(name, '/', 1) = (
    SELECT organization_id::text FROM public.profiles WHERE id = auth.uid() LIMIT 1
  )
);

CREATE POLICY "template_attachments_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'template-attachments'
  AND split_part(name, '/', 1) = (
    SELECT organization_id::text FROM public.profiles WHERE id = auth.uid() LIMIT 1
  )
);

CREATE POLICY "template_attachments_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'template-attachments'
  AND split_part(name, '/', 1) = (
    SELECT organization_id::text FROM public.profiles WHERE id = auth.uid() LIMIT 1
  )
);
