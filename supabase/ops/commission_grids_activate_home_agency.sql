-- REVIEW ONLY. Requires Chris's explicit approval of this exact action in this exact environment.
-- Initial activation (decision C6): enables the verified AgentFlow "FFL Compensation Grid" (effective
-- 2025-11-20) for exactly ONE agency, resolved by exact unique name at execution, and selects it for the
-- calculator only when that agency has no selection. An existing selection is kept and reported, never
-- silently overwritten. Zero or several name matches: refused. Retry-safe. No other agency is touched.
-- The agency id is never hardcoded; the grid id is the importer's deterministic id for that grid's name
-- and effective date (scripts/comp_grids/reference_grid_importer.py), and the grid must already have a
-- verified import ledger row (otherwise refused, PT404). The grid must also already be AVAILABLE to that
-- agency (commission_grids_make_available_home_agency.sql, decision D5); otherwise the enable is refused
-- (PT404) and nothing changes.
--
-- Usage: psql "$TARGET_URL" -X -v approve_comp_home_activation=yes \
--          -f supabase/ops/commission_grids_activate_home_agency.sql
-- Approval is a psql client variable, not a database GUC.
\set ON_ERROR_STOP 1
\if :{?approve_comp_home_activation}
  SELECT :'approve_comp_home_activation' = 'yes' AS _agentflow_approved \gset
  \if :_agentflow_approved
  \else
    DO $ BEGIN RAISE EXCEPTION 'Set psql variable approve_comp_home_activation=yes only after exact release approval'; END $;
  \endif
\else
  DO $ BEGIN RAISE EXCEPTION 'Set psql variable approve_comp_home_activation=yes only after exact release approval'; END $;
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Reports organization_id, selected, existing_selection and existing_selection_kept.
SELECT private.comp_enable_reference_grid_for_agency(
         'Family First Life - Chris Garness',
         '6ad6d4e4-4024-5dae-bef5-de0202ab1b6e'::uuid) AS result;
COMMIT;
