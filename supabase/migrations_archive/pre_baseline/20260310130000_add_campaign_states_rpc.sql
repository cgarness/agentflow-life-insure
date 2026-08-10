-- Add RPC function to get unique states for a campaign
CREATE OR REPLACE FUNCTION get_campaign_states(p_campaign_id UUID)
RETURNS text[] AS $$
BEGIN
  RETURN ARRAY(
    SELECT DISTINCT state 
    FROM campaign_leads 
    WHERE campaign_id = p_campaign_id 
      AND state IS NOT NULL 
      AND state != ''
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
