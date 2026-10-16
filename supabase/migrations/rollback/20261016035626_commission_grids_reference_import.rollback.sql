-- =====================================================================================================
-- ROLLBACK of 20261015120200_commission_grids_reference_import.sql — apply ONLY with Chris's exact
-- approval. Never applied automatically (lives in migrations/rollback/, outside the CLI glob).
-- Drops the seven postgres-only reference-data functions. No row is deleted: imported reference grids,
-- their ledger rows, availability rows and every agency's grids and settings stay exactly as they are.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('private.comp_import_reference_grid(text,text)') IS NULL THEN
    RAISE EXCEPTION 'reference-import functions are not installed; refusing replay';
  END IF;
END $guard$;

DROP FUNCTION private.comp_enable_reference_grid_for_agency(text, uuid);
DROP FUNCTION private.comp_remove_reference_grid_availability(text, uuid);
DROP FUNCTION private.comp_make_reference_grid_available(text, uuid);
DROP FUNCTION private.comp_agency_by_exact_name(text);
DROP FUNCTION private.comp_set_reference_grid_active(uuid, boolean);
DROP FUNCTION private.comp_import_reference_grid(text, text);
DROP FUNCTION private.comp_grid_content_sha256(uuid);
