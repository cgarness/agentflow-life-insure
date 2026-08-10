CREATE TABLE IF NOT EXISTS dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3B82F6',
  is_default boolean NOT NULL DEFAULT false,
  require_notes boolean NOT NULL DEFAULT false,
  min_note_chars integer NOT NULL DEFAULT 0,
  callback_scheduler boolean NOT NULL DEFAULT false,
  automation_trigger boolean NOT NULL DEFAULT false,
  automation_id text,
  automation_name text,
  usage_count integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO dispositions (name, color, is_default, sort_order) VALUES
  ('Not Available', '#6B7280', true, 1),
  ('Left Voicemail', '#3B82F6', true, 2),
  ('Not Interested', '#EF4444', true, 3),
  ('Call Back Later', '#F59E0B', true, 4),
  ('Interested', '#10B981', true, 5),
  ('Appointment Set', '#8B5CF6', true, 6)
ON CONFLICT DO NOTHING;

ALTER TABLE dispositions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dispositions' AND policyname = 'Allow all dispositions'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow all dispositions" ON dispositions FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END
$$;
