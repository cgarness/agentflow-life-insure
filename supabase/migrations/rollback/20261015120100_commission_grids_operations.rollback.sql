-- =====================================================================================================
-- ROLLBACK of 20261015120100_commission_grids_operations.sql — apply ONLY with Chris's exact approval.
-- Never applied automatically (lives in migrations/rollback/, outside the CLI glob).
-- Drops the client operations. No row is deleted. With the operations gone, no client role can write
-- the comp tables at all (the write policies need the operation context); reads stay RLS-scoped.
-- The reference-import rollback must be applied first.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('private.comp_import_reference_grid(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'roll back 20261015120200_commission_grids_reference_import first';
  END IF;
  IF to_regprocedure('public.comp_save_grid_changes(uuid,bigint,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'commission grid operations are not installed; refusing replay';
  END IF;
END $guard$;

DROP FUNCTION public.comp_delete_private_grid(uuid, bigint);
DROP FUNCTION public.comp_save_grid_changes(uuid, bigint, jsonb);
DROP FUNCTION public.comp_create_private_grid(text, text, date, uuid);
DROP FUNCTION public.comp_select_calculator_grid(uuid, uuid);
DROP FUNCTION public.comp_disable_shared_grid(uuid);
DROP FUNCTION public.comp_enable_shared_grid(uuid);
DROP FUNCTION public.comp_get_grid_snapshot(uuid);
DROP FUNCTION public.comp_get_admin_overview();
DROP FUNCTION public.comp_list_shared_grid_catalog();
DROP FUNCTION public.get_commission_calculator_context();
DROP FUNCTION public.get_commission_calculator_status();
DROP FUNCTION comp_authz.begin_admin_operation();
