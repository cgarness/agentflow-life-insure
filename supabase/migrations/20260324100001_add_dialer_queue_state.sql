CREATE TABLE IF NOT EXISTS dialer_queue_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  current_lead_id UUID NOT NULL,
  queue_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, campaign_id)
);

ALTER TABLE dialer_queue_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own queue state"
  ON dialer_queue_state
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
