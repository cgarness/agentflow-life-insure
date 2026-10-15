-- =====================================================================================================
-- ROLLBACK of 20261015120100_commission_grids_operations.sql — apply ONLY with Chris's exact approval.
-- Never applied automatically (lives in migrations/rollback/, outside the CLI glob).
-- Drops the client operations and dedicated operation role, then restores migration 1's dormant authority shape.
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
ALTER POLICY comp_grids_select ON public.comp_grids TO authenticated;
ALTER POLICY comp_products_select ON public.comp_products TO authenticated;
ALTER POLICY comp_product_variants_select ON public.comp_product_variants TO authenticated;
ALTER POLICY comp_rates_select ON public.comp_rates TO authenticated;
ALTER POLICY comp_variant_references_select ON public.comp_variant_references TO authenticated;
ALTER POLICY organization_comp_grids_select ON public.organization_comp_grids TO authenticated;
ALTER POLICY organization_comp_settings_select ON public.organization_comp_settings TO authenticated;
CREATE OR REPLACE FUNCTION private.comp_require_operation_context() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_row_org uuid;
BEGIN
 IF current_user IN ('authenticated','anon') THEN
  IF current_setting('agentflow.comp_operation',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Commission grid data can only be changed through AgentFlow operations' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN v_row_org:=OLD.organization_id; ELSE v_row_org:=NEW.organization_id; END IF;
  IF v_row_org IS NULL OR v_row_org IS DISTINCT FROM comp_authz.actor_org_id() OR NOT comp_authz.actor_is_admin() THEN RAISE EXCEPTION 'Only an agency admin can change their own agency''s commission grids' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
-- Restore original GUC-gated write policies by replaying migration 1's policy definitions.
DROP POLICY comp_grids_insert ON public.comp_grids; DROP POLICY comp_grids_update ON public.comp_grids; DROP POLICY comp_grids_delete ON public.comp_grids;
DROP POLICY comp_products_insert ON public.comp_products; DROP POLICY comp_products_update ON public.comp_products; DROP POLICY comp_products_delete ON public.comp_products;
DROP POLICY comp_product_variants_insert ON public.comp_product_variants; DROP POLICY comp_product_variants_update ON public.comp_product_variants; DROP POLICY comp_product_variants_delete ON public.comp_product_variants;
DROP POLICY comp_rates_insert ON public.comp_rates; DROP POLICY comp_rates_update ON public.comp_rates; DROP POLICY comp_rates_delete ON public.comp_rates;
DROP POLICY comp_variant_references_insert ON public.comp_variant_references; DROP POLICY comp_variant_references_update ON public.comp_variant_references; DROP POLICY comp_variant_references_delete ON public.comp_variant_references;
DROP POLICY organization_comp_grids_insert ON public.organization_comp_grids; DROP POLICY organization_comp_grids_delete ON public.organization_comp_grids;
DROP POLICY organization_comp_settings_insert ON public.organization_comp_settings; DROP POLICY organization_comp_settings_update ON public.organization_comp_settings;
CREATE POLICY comp_grids_insert ON public.comp_grids FOR INSERT TO authenticated WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_grids_update ON public.comp_grids FOR UPDATE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin())) WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_grids_delete ON public.comp_grids FOR DELETE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_products_insert ON public.comp_products FOR INSERT TO authenticated WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_products_update ON public.comp_products FOR UPDATE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin())) WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_products_delete ON public.comp_products FOR DELETE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_product_variants_insert ON public.comp_product_variants FOR INSERT TO authenticated WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_product_variants_update ON public.comp_product_variants FOR UPDATE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin())) WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_product_variants_delete ON public.comp_product_variants FOR DELETE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_rates_insert ON public.comp_rates FOR INSERT TO authenticated WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_rates_update ON public.comp_rates FOR UPDATE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin())) WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_rates_delete ON public.comp_rates FOR DELETE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_variant_references_insert ON public.comp_variant_references FOR INSERT TO authenticated WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_variant_references_update ON public.comp_variant_references FOR UPDATE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin())) WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_variant_references_delete ON public.comp_variant_references FOR DELETE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY organization_comp_grids_insert ON public.organization_comp_grids FOR INSERT TO authenticated WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY organization_comp_grids_delete ON public.organization_comp_grids FOR DELETE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY organization_comp_settings_insert ON public.organization_comp_settings FOR INSERT TO authenticated WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY organization_comp_settings_update ON public.organization_comp_settings FOR UPDATE TO authenticated USING ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin())) WITH CHECK ((SELECT current_setting('agentflow.comp_operation',true))='on' AND organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
GRANT INSERT(id,organization_id,name,effective_date,is_active,contract_levels,origin,copied_from_grid_id) ON public.comp_grids TO authenticated;
GRANT UPDATE(name,effective_date,is_active,contract_levels) ON public.comp_grids TO authenticated; GRANT DELETE ON public.comp_grids TO authenticated;
GRANT INSERT(grid_id,organization_id,category,carrier,product_name,is_active) ON public.comp_products TO authenticated; GRANT UPDATE(category,carrier,product_name,is_active) ON public.comp_products TO authenticated; GRANT DELETE ON public.comp_products TO authenticated;
GRANT INSERT(grid_id,product_id,organization_id,label,min_age,max_age,term_years) ON public.comp_product_variants TO authenticated; GRANT UPDATE(label,min_age,max_age,term_years) ON public.comp_product_variants TO authenticated; GRANT DELETE ON public.comp_product_variants TO authenticated;
GRANT INSERT(grid_id,variant_id,organization_id,contract_level,rate_percent) ON public.comp_rates TO authenticated; GRANT UPDATE(rate_percent) ON public.comp_rates TO authenticated; GRANT DELETE ON public.comp_rates TO authenticated;
GRANT INSERT(variant_id,grid_id,organization_id,source,notes) ON public.comp_variant_references TO authenticated; GRANT UPDATE(source,notes) ON public.comp_variant_references TO authenticated; GRANT DELETE ON public.comp_variant_references TO authenticated;
GRANT INSERT(organization_id,grid_id) ON public.organization_comp_grids TO authenticated; GRANT DELETE ON public.organization_comp_grids TO authenticated;
GRANT INSERT(organization_id,calculator_grid_id) ON public.organization_comp_settings TO authenticated; GRANT UPDATE(calculator_grid_id) ON public.organization_comp_settings TO authenticated;
REVOKE ALL ON public.comp_grids,public.comp_products,public.comp_product_variants,public.comp_rates,public.comp_variant_references,public.organization_comp_grids,public.organization_comp_settings FROM agentflow_comp_operator;
REVOKE EXECUTE ON FUNCTION auth.uid() FROM agentflow_comp_operator;
REVOKE EXECUTE ON FUNCTION comp_authz.actor_org_id(),comp_authz.actor_is_admin(),comp_authz.readable_grid_ids() FROM agentflow_comp_operator;
REVOKE USAGE ON SCHEMA public,comp_authz,auth FROM agentflow_comp_operator;
REVOKE agentflow_comp_operator FROM postgres;
DROP ROLE agentflow_comp_operator;
