-- Add amd_skipped column to dialer_daily_stats and update increment function
ALTER TABLE dialer_daily_stats 
ADD COLUMN IF NOT EXISTS amd_skipped integer NOT NULL DEFAULT 0;

-- Update RPC function to handle p_amd_skipped
CREATE OR REPLACE FUNCTION increment_dialer_stats(
  p_agent_id uuid,
  p_calls_made integer DEFAULT 0,
  p_calls_connected integer DEFAULT 0,
  p_total_talk_seconds integer DEFAULT 0,
  p_policies_sold integer DEFAULT 0,
  p_session_started_at timestamptz DEFAULT NULL,
  p_amd_skipped integer DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO dialer_daily_stats (
    agent_id, 
    stat_date, 
    calls_made, 
    calls_connected, 
    total_talk_seconds, 
    policies_sold, 
    session_started_at, 
    amd_skipped,
    last_updated_at
  )
  VALUES (
    p_agent_id, 
    CURRENT_DATE, 
    p_calls_made, 
    p_calls_connected, 
    p_total_talk_seconds, 
    p_policies_sold, 
    p_session_started_at, 
    p_amd_skipped,
    now()
  )
  ON CONFLICT (agent_id, stat_date)
  DO UPDATE SET
    calls_made = dialer_daily_stats.calls_made + EXCLUDED.calls_made,
    calls_connected = dialer_daily_stats.calls_connected + EXCLUDED.calls_connected,
    total_talk_seconds = dialer_daily_stats.total_talk_seconds + EXCLUDED.total_talk_seconds,
    policies_sold = dialer_daily_stats.policies_sold + EXCLUDED.policies_sold,
    amd_skipped = dialer_daily_stats.amd_skipped + EXCLUDED.amd_skipped,
    session_started_at = COALESCE(dialer_daily_stats.session_started_at, EXCLUDED.session_started_at),
    last_updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
