-- REVIEW ONLY. Requires Chris's explicit approval of this exact action in this exact environment.
-- Imports ONE AgentFlow shared reference grid from a PRIVATE, checksum-verified artifact
-- (docs/plans/2026-10-15-commission-calculator/reference-import-runbook.md). The artifact never enters Git;
-- this script carries no compensation data. Transactional, idempotent (same artifact => already_imported),
-- and drift-refusing (different content for an existing grid => PT409, nothing overwritten).
--
-- Usage (artifact built by scripts/comp_grids/reference_grid_importer.py build, stored privately):
--   psql "$TARGET_URL" -X -v approve_comp_reference_import=yes \
--     -v artifact_path=/private/path/ffl.comp_reference_grid.json -v artifact_sha256=<sha256 of that file> \
--     -f supabase/ops/commission_grids_import_reference_grid.sql
-- Approval is a psql client variable, not a database GUC: managed production postgres cannot SET
-- arbitrary agentflow.* parameters.
\set ON_ERROR_STOP 1
\if :{?artifact_path}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable artifact_path is required'; END $$;
\endif
\if :{?artifact_sha256}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable artifact_sha256 is required'; END $$;
\endif
\set artifact `cat :'artifact_path'`
\if :{?approve_comp_reference_import}
  SELECT :'approve_comp_reference_import' = 'yes' AS _agentflow_approved \gset
  \if :_agentflow_approved
  \else
    \echo 'ERROR: Set psql variable approve_comp_reference_import=yes only after exact release approval'
    \quit 3
  \endif
\else
  \echo 'ERROR: Set psql variable approve_comp_reference_import=yes only after exact release approval'
  \quit 3
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- Prints status, grid id, import id, counts and the content fingerprint — never a compensation value.
SELECT private.comp_import_reference_grid(:'artifact', :'artifact_sha256') AS result;
COMMIT;
