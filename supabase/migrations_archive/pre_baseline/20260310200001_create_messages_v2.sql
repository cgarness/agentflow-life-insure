-- Drop the old messages table (from 20260310120000) and recreate with new schema
DROP TABLE IF EXISTS public.messages;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  agent_id uuid REFERENCES auth.users(id),
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text,
  subject text,
  status text DEFAULT 'sent',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read messages"
  ON messages FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert messages"
  ON messages FOR INSERT
  TO authenticated WITH CHECK (true);
