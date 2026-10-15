-- REVIEW ONLY. Requires Chris's explicit approval of this exact action in this exact environment.
-- Availability (decision D5): makes the verified AgentFlow "FFL Compensation Grid" (effective 2025-11-20)
-- AVAILABLE to exactly ONE agency, resolved by exact unique name at execution. Availability only: nothing
-- is enabled or selected (that agency's admins decide, or the separately approved activation script
-- does). Zero or several name matches: refused. Retry-safe. No other agency is touched.
-- The agency id is never hardcoded; the grid id is the importer's deterministic id for that grid's name
-- and effective date (scripts/comp_grids/reference_grid_importer.py), and the grid must already have a
-- verified import ledger row (otherwise refused, PT404).
--
-- Usage: PGOPTIONS='-c agentflow.approve_comp_home_availability=yes' psql "$TARGET_URL" -X \
--          -f supabase/ops/commission_grids_make_available_home_agency.sql
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_setting('agentflow.approve_comp_home_availability', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Set agentflow.approve_comp_home_availability=yes only after exact release approval';
  END IF;
END $$;
-- Reports organization_id, grid_id, available and newly_available.
SELECT private.comp_make_reference_grid_available(
         'Family First Life - Chris Garness',
         '6ad6d4e4-4024-5dae-bef5-de0202ab1b6e'::uuid) AS result;
COMMIT;
