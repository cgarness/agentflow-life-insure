CREATE TABLE telnyx_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  label text,
  assigned_to uuid REFERENCES auth.users(id),
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE telnyx_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read telnyx_numbers"
  ON telnyx_numbers FOR SELECT
  TO authenticated USING (true);

INSERT INTO telnyx_numbers (phone_number, label, is_default)
VALUES ('+19097381193', 'Main Line', true);
