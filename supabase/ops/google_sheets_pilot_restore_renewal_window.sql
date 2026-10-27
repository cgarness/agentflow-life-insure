-- Run as the separately approved paired stage immediately after a replacement
-- channel is observed. Does not stop the superseded channel's 900-second overlap.
DO $restore$
BEGIN
  IF (SELECT mode <> 'pilot' OR renew_before_s <> 82800 FROM private.google_sheets_push_config) THEN
    RAISE EXCEPTION 'unexpected pilot renewal window';
  END IF;
  UPDATE private.google_sheets_push_config SET renew_before_s=10800, updated_at=now();
END $restore$;
