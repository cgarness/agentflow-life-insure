-- =====================================================================================================
-- Google Sheets push — STOP ALL MONITORING (rollback level 2). NOT RUN. Needs approval.
-- Sets push mode 'off' (every claim, kick and registration is refused in the database) and marks every live
-- channel 'stopping' (or 'abandoned' when Google's resource id is unknown). The maintenance function stops them with
-- Google even while mode is off; afterwards run google_sheets_push_unschedule.sql. Notifications that still arrive
-- are durably queued but never processed while mode is off. Deletes nothing; Sync now keeps working.
-- =====================================================================================================
DO $stop$
DECLARE n int;
BEGIN
  IF to_regclass('private.google_sheets_push_config') IS NULL THEN RAISE EXCEPTION 'push sync migration not applied'; END IF;
  UPDATE private.google_sheets_push_config SET mode = 'off', updated_at = now();
  UPDATE private.google_sheets_watch_channels w
     SET resource_id = COALESCE(w.resource_id, w.observed_resource_id),
         state = CASE WHEN COALESCE(w.resource_id, w.observed_resource_id) IS NULL THEN 'abandoned' ELSE 'stopping' END,
         next_stop_at = NULL, last_error_code = 'stop_all', updated_at = now()
   WHERE w.state IN ('registering','active');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'google sheets push: mode off; % channel(s) marked for stopping', n;
END
$stop$;
