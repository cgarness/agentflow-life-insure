-- Enable Realtime on `wins` for leaderboard live win feed and stats refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wins'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wins;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
