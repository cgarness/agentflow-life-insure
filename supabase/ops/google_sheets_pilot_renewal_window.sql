-- Gate E renewal drill only, separately approved. Wait until the current channel
-- has <=23h left; never change expires_at or forge Google channel state.
DO $renew$
BEGIN
  IF (SELECT mode <> 'pilot' OR renew_before_s <> 10800 FROM private.google_sheets_push_config)
     OR (SELECT count(*) FROM private.google_sheets_push_pilot_sources) <> 1
     OR NOT EXISTS (SELECT 1 FROM private.google_sheets_push_pilot_sources
                    WHERE source_id='2a9ce6b6-0500-454d-8c46-48dfab8042b5') THEN
    RAISE EXCEPTION 'unexpected pilot scope or renewal window';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_channels
                 WHERE state='active' AND expires_at>now()+interval '15 minutes'
                   AND expires_at<=now()+interval '23 hours') THEN
    RAISE EXCEPTION 'wait for a valid channel with at most 23 hours left';
  END IF;
  UPDATE private.google_sheets_push_config SET renew_before_s=82800, updated_at=now();
END $renew$;
