-- Create dialer_daily_stats table for persisting daily agent dialer statistics
CREATE TABLE IF NOT EXISTS dialer_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stat_date date NOT NULL DEFAULT CURRENT_DATE,
  calls_made integer NOT NULL DEFAULT 0,
  calls_connected integer NOT NULL DEFAULT 0,
  total_talk_seconds integer NOT NULL DEFAULT 0,
  policies_sold integer NOT NULL DEFAULT 0,
  session_started_at timestamptz NULL,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, stat_date)
);

-- Enable RLS
ALTER TABLE dialer_daily_stats ENABLE ROW LEVEL SECURITY;

-- Agent can read their own rows
CREATE POLICY "agent_select_own" ON dialer_daily_stats
  FOR SELECT USING (auth.uid() = agent_id);

-- Agent can insert their own rows
CREATE POLICY "agent_insert_own" ON dialer_daily_stats
  FOR INSERT WITH CHECK (auth.uid() = agent_id);

-- Agent can update their own rows
CREATE POLICY "agent_update_own" ON dialer_daily_stats
  FOR UPDATE USING (auth.uid() = agent_id);

-- Agent can delete their own rows (for reset)
CREATE POLICY "agent_delete_own" ON dialer_daily_stats
  FOR DELETE USING (auth.uid() = agent_id);

-- Admin / Team Leader can read all rows
CREATE POLICY "admin_select_all" ON dialer_daily_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.is_super_admin = true OR p.role IN ('Admin', 'Team Leader'))
    )
  );

-- RPC function: increment dialer stats (upsert with increment-on-conflict)
CREATE OR REPLACE FUNCTION increment_dialer_stats(
  p_agent_id uuid,
  p_calls_made integer DEFAULT 0,
  p_calls_connected integer DEFAULT 0,
  p_total_talk_seconds integer DEFAULT 0,
  p_policies_sold integer DEFAULT 0,
  p_session_started_at timestamptz DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO dialer_daily_stats (agent_id, stat_date, calls_made, calls_connected, total_talk_seconds, policies_sold, session_started_at, last_updated_at)
  VALUES (p_agent_id, CURRENT_DATE, p_calls_made, p_calls_connected, p_total_talk_seconds, p_policies_sold, p_session_started_at, now())
  ON CONFLICT (agent_id, stat_date)
  DO UPDATE SET
    calls_made = dialer_daily_stats.calls_made + EXCLUDED.calls_made,
    calls_connected = dialer_daily_stats.calls_connected + EXCLUDED.calls_connected,
    total_talk_seconds = dialer_daily_stats.total_talk_seconds + EXCLUDED.total_talk_seconds,
    policies_sold = dialer_daily_stats.policies_sold + EXCLUDED.policies_sold,
    session_started_at = COALESCE(dialer_daily_stats.session_started_at, EXCLUDED.session_started_at),
    last_updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
