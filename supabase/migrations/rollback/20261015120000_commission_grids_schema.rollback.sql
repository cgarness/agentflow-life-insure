-- =====================================================================================================
-- ROLLBACK of 20261015120000_commission_grids_schema.sql — apply ONLY with Chris's exact approval.
-- Never applied automatically (lives in migrations/rollback/, outside the CLI glob).
--
-- NON-DESTRUCTIVE BY CONSTRUCTION (AGENT_RULES invariant #28): it refuses unless every commission-grid
-- table is EMPTY — no reference import, no agency grid, no access row, no settings row. Once any row
-- exists the supported rollback is: revert the frontend, optionally clear calculator selections with a
-- separately approved write, and leave these tables dormant. Never delete live data to make this pass.
-- The operations rollback (and the reference-import rollback before it) must be applied first.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_rows bigint;
BEGIN
  IF to_regclass('public.comp_grids') IS NULL THEN
    RAISE EXCEPTION 'commission grid schema is not installed; refusing replay';
  END IF;
  IF to_regprocedure('public.comp_save_grid_changes(uuid,bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'roll back 20261015120100_commission_grids_operations first';
  END IF;
  SELECT (SELECT count(*) FROM public.comp_grids) + (SELECT count(*) FROM public.comp_products)
       + (SELECT count(*) FROM public.comp_product_variants) + (SELECT count(*) FROM public.comp_rates)
       + (SELECT count(*) FROM public.comp_variant_references) + (SELECT count(*) FROM public.organization_comp_grids)
       + (SELECT count(*) FROM public.organization_comp_settings) + (SELECT count(*) FROM public.comp_reference_imports)
    INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'commission grid tables hold % row(s); refusing a destructive rollback (leave them dormant instead)', v_rows;
  END IF;
END $guard$;

DROP TABLE public.comp_reference_imports;
DROP TABLE public.organization_comp_settings;
DROP TABLE public.organization_comp_grids;
DROP TABLE public.comp_variant_references;
DROP TABLE public.comp_rates;
DROP TABLE public.comp_product_variants;
DROP TABLE public.comp_products;
DROP TABLE public.comp_grids;

DROP FUNCTION private.comp_access_revoked();
DROP FUNCTION private.comp_access_rules();
DROP FUNCTION private.comp_selection_rules();
DROP FUNCTION private.comp_variant_rules();
DROP FUNCTION private.comp_bump_grid_revision();
DROP FUNCTION private.comp_child_rules();
DROP FUNCTION private.comp_grid_deactivated();
DROP FUNCTION private.comp_grid_rules();
DROP FUNCTION private.comp_stamp_access();
DROP FUNCTION private.comp_stamp_and_freeze();
DROP FUNCTION private.comp_require_operation_context();

DROP FUNCTION comp_authz.readable_grid_ids();
DROP FUNCTION comp_authz.actor_is_admin();
DROP FUNCTION comp_authz.actor_org_id();
DROP SCHEMA comp_authz;
