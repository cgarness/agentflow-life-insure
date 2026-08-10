-- Enable Realtime on `calls` so clients can subscribe to inbound rows (e.g. contact_id from telnyx-webhook).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
