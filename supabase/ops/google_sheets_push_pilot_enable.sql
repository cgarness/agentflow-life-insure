-- =====================================================================================================
-- Google Sheets push — OPEN THE PILOT (Gate E). NOT RUN. Needs Chris's separate approval of this exact file.
-- Sets push mode 'pilot' and allowlists EXACTLY ONE source: "AgentFlow Sheets Pilot B – Leads" in the home agency.
-- The database refuses every other source (claims, kicks, registrations) while mode is 'pilot'; the Edge kill switch
-- GOOGLE_SHEETS_PUSH_ENABLED must also be 'true' for anything to run. Reversible: google_sheets_push_stop_all.sql.
-- Touches no lead, receipt, ledger row, source or connection.
-- =====================================================================================================
DO $pilot$
DECLARE
  v_source uuid := '2a9ce6b6-0500-454d-8c46-48dfab8042b5';
  v_org    uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  IF to_regclass('private.google_sheets_push_config') IS NULL THEN RAISE EXCEPTION 'push sync migration not applied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.google_sheets_sources
                  WHERE id = v_source AND organization_id = v_org AND state = 'enabled'
                    AND display_name = 'AgentFlow Sheets Pilot B – Leads') THEN
    RAISE EXCEPTION 'Pilot B source not found exactly as expected; refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM private.google_sheets_push_pilot_sources WHERE source_id <> v_source) THEN
    RAISE EXCEPTION 'allowlist already holds another source; review first';
  END IF;
  IF (SELECT mode FROM private.google_sheets_push_config) = 'on' THEN
    RAISE EXCEPTION 'push mode is already on; review first';
  END IF;
  INSERT INTO private.google_sheets_push_pilot_sources (source_id, organization_id) VALUES (v_source, v_org)
  ON CONFLICT (source_id) DO NOTHING;
  UPDATE private.google_sheets_push_config SET mode = 'pilot', updated_at = now();
  RAISE NOTICE 'google sheets push: mode pilot; allowlist = %', v_source;
END
$pilot$;
