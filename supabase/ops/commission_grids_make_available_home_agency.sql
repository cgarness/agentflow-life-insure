-- REVIEW ONLY. Requires Chris's explicit approval of this exact action in this exact environment.
-- Availability (decision D5): makes the verified AgentFlow "FFL Compensation Grid" (effective 2025-11-20)
-- AVAILABLE to exactly ONE agency, resolved by exact unique name at execution. Availability only: nothing
-- is enabled or selected (that agency's admins decide, or the separately approved activation script
-- does). Zero or several name matches: refused. Retry-safe. No other agency is touched.
-- The agency id is never hardcoded; the grid id is the importer's deterministic id for that grid's name
-- and effective date (scripts/comp_grids/reference_grid_importer.py), and the grid must already have a
-- verified import ledger row (otherwise refused, PT404).
--
-- Usage: psql "$TARGET_URL" -X -v approve_comp_home_availability=yes \
--          -f supabase/ops/commission_grids_make_available_home_agency.sql
-- Approval is a psql client variable, not a database GUC.
\set ON_ERROR_STOP 1
\if :{?approve_comp_home_availability}
  SELECT :'approve_comp_home_availability' = 'yes' AS _agentflow_approved \gset
  \if :_agentflow_approved
  \else
    DO 'BEGIN RAISE EXCEPTION ''Set psql variable approve_comp_home_availability=yes only after exact release approval''; END';
  \endif
\else
  DO 'BEGIN RAISE EXCEPTION ''Set psql variable approve_comp_home_availability=yes only after exact release approval''; END';
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Reports organization_id, grid_id, available and newly_available.
SELECT private.comp_make_reference_grid_available(
         'Family First Life - Chris Garness',
         '6ad6d4e4-4024-5dae-bef5-de0202ab1b6e'::uuid) AS result;
COMMIT;
