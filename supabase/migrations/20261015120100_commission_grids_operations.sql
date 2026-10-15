-- =====================================================================================================
-- Commission grids — client operations (Commission Calculator + agency comp grids).
-- Plan: docs/plans/2026-10-15-commission-calculator/implementation_plan.md. Apply ONLY with Chris's
-- separate, exact approval, after 20261015120000_commission_grids_schema.sql. Contains NO data.
--
-- Read operations stay SECURITY INVOKER. The six agency-write operations are SECURITY DEFINER owned by
-- the dedicated NOLOGIN/NOBYPASSRLS role agentflow_comp_operator. Authenticated clients have no base-table
-- write grants; the operator role has only reviewed comp-table privileges, remains subject to RLS, and
-- every write policy/trigger re-resolves the real JWT/profile actor through the canonical campaign_actor()
-- chain. Only postgres is a member of the operation role so reviewed migrations/rollback can manage its
-- owned functions. Each write operation first locks the caller's organization_comp_settings row (created
-- on first use), so all comp writes of one agency serialize in the order settings -> grid -> availability
-- -> access -> product -> children.
-- The one SECURITY DEFINER function here is the metadata-only shared-grid catalog: RLS cannot expose
-- four columns of a shared grid row while hiding its content from an agency that has not enabled it. It
-- lists only grids AgentFlow has made available to the caller's agency (decision D5).
-- Errors: 42501 not permitted · PT404 not available (HTTP 404) · PT409 stale/conflict (HTTP 409) ·
--         22023 invalid request · 23xxx validation (constraints and triggers).
-- Rollback: supabase/migrations/rollback/20261015120100_commission_grids_operations.rollback.sql
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $guard$
BEGIN
  IF to_regclass('public.comp_grids') IS NULL OR to_regnamespace('comp_authz') IS NULL THEN
    RAISE EXCEPTION 'apply 20261015120000_commission_grids_schema first';
  END IF;
  IF to_regprocedure('public.comp_save_grid_changes(uuid,bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'commission grid operations already exist; refusing replay';
  END IF;
END $guard$;


-- ── Production-compatible write authority ────────────────────────────────────────────────────────────
-- Managed Supabase production rejected the original function-level custom-GUC SET for its non-superuser
-- postgres role. Migration 1 is already production history, so this still-unapplied migration forward-
-- corrects that authority model without rewriting history.
DO $role_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agentflow_comp_operator') THEN
    RAISE EXCEPTION 'agentflow_comp_operator already exists; refusing an ambiguous authority role';
  END IF;
END $role_guard$;

CREATE ROLE agentflow_comp_operator
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT agentflow_comp_operator TO postgres;
GRANT USAGE ON SCHEMA public, comp_authz, auth TO agentflow_comp_operator;
GRANT EXECUTE ON FUNCTION auth.uid() TO agentflow_comp_operator;
-- CREATE on public is temporary and exists only so PostgreSQL permits ALTER FUNCTION ... OWNER below.
GRANT CREATE ON SCHEMA public TO agentflow_comp_operator;
GRANT EXECUTE ON FUNCTION comp_authz.actor_org_id(), comp_authz.actor_is_admin(), comp_authz.readable_grid_ids()
  TO agentflow_comp_operator;

CREATE OR REPLACE FUNCTION private.comp_require_operation_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog, pg_temp
AS $$
DECLARE v_row_org uuid;
BEGIN
  IF current_user='agentflow_comp_operator' THEN
    IF TG_OP='DELETE' THEN v_row_org:=OLD.organization_id; ELSE v_row_org:=NEW.organization_id; END IF;
    IF v_row_org IS NULL OR v_row_org IS DISTINCT FROM comp_authz.actor_org_id()
       OR NOT comp_authz.actor_is_admin() THEN
      RAISE EXCEPTION 'Only an agency admin can change their own agency''s commission grids' USING ERRCODE='42501';
    END IF;
  ELSIF current_user<>'postgres' THEN
    RAISE EXCEPTION 'Commission grid data can only be changed through AgentFlow operations' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

ALTER POLICY comp_grids_select ON public.comp_grids TO authenticated,agentflow_comp_operator;
ALTER POLICY comp_products_select ON public.comp_products TO authenticated,agentflow_comp_operator;
ALTER POLICY comp_product_variants_select ON public.comp_product_variants TO authenticated,agentflow_comp_operator;
ALTER POLICY comp_rates_select ON public.comp_rates TO authenticated,agentflow_comp_operator;
ALTER POLICY comp_variant_references_select ON public.comp_variant_references TO authenticated,agentflow_comp_operator;
ALTER POLICY organization_comp_grids_select ON public.organization_comp_grids TO authenticated,agentflow_comp_operator;
ALTER POLICY organization_comp_settings_select ON public.organization_comp_settings TO authenticated,agentflow_comp_operator;

ALTER POLICY comp_grids_insert ON public.comp_grids TO agentflow_comp_operator
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_grids_update ON public.comp_grids TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_grids_delete ON public.comp_grids TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_products_insert ON public.comp_products TO agentflow_comp_operator
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_products_update ON public.comp_products TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_products_delete ON public.comp_products TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_product_variants_insert ON public.comp_product_variants TO agentflow_comp_operator
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_product_variants_update ON public.comp_product_variants TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_product_variants_delete ON public.comp_product_variants TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_rates_insert ON public.comp_rates TO agentflow_comp_operator
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_rates_update ON public.comp_rates TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_rates_delete ON public.comp_rates TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_variant_references_insert ON public.comp_variant_references TO agentflow_comp_operator
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_variant_references_update ON public.comp_variant_references TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY comp_variant_references_delete ON public.comp_variant_references TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY organization_comp_grids_insert ON public.organization_comp_grids TO agentflow_comp_operator
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY organization_comp_grids_delete ON public.organization_comp_grids TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY organization_comp_settings_insert ON public.organization_comp_settings TO agentflow_comp_operator
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
ALTER POLICY organization_comp_settings_update ON public.organization_comp_settings TO agentflow_comp_operator
  USING (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK (organization_id=(SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

REVOKE INSERT(id,organization_id,name,effective_date,is_active,contract_levels,origin,copied_from_grid_id) ON public.comp_grids FROM authenticated;
REVOKE UPDATE(name,effective_date,is_active,contract_levels) ON public.comp_grids FROM authenticated;
REVOKE DELETE ON public.comp_grids FROM authenticated;
REVOKE INSERT(grid_id,organization_id,category,carrier,product_name,is_active) ON public.comp_products FROM authenticated;
REVOKE UPDATE(category,carrier,product_name,is_active) ON public.comp_products FROM authenticated;
REVOKE DELETE ON public.comp_products FROM authenticated;
REVOKE INSERT(grid_id,product_id,organization_id,label,min_age,max_age,term_years) ON public.comp_product_variants FROM authenticated;
REVOKE UPDATE(label,min_age,max_age,term_years) ON public.comp_product_variants FROM authenticated;
REVOKE DELETE ON public.comp_product_variants FROM authenticated;
REVOKE INSERT(grid_id,variant_id,organization_id,contract_level,rate_percent) ON public.comp_rates FROM authenticated;
REVOKE UPDATE(rate_percent) ON public.comp_rates FROM authenticated;
REVOKE DELETE ON public.comp_rates FROM authenticated;
REVOKE INSERT(variant_id,grid_id,organization_id,source,notes) ON public.comp_variant_references FROM authenticated;
REVOKE UPDATE(source,notes) ON public.comp_variant_references FROM authenticated;
REVOKE DELETE ON public.comp_variant_references FROM authenticated;
REVOKE INSERT(organization_id,grid_id) ON public.organization_comp_grids FROM authenticated;
REVOKE DELETE ON public.organization_comp_grids FROM authenticated;
REVOKE INSERT(organization_id,calculator_grid_id) ON public.organization_comp_settings FROM authenticated;
REVOKE UPDATE(calculator_grid_id) ON public.organization_comp_settings FROM authenticated;

GRANT SELECT ON public.comp_grids,public.comp_products,public.comp_product_variants,public.comp_rates,
  public.comp_variant_references,public.organization_comp_grids,public.organization_comp_settings TO agentflow_comp_operator;
GRANT INSERT(id,organization_id,name,effective_date,is_active,contract_levels,origin,copied_from_grid_id) ON public.comp_grids TO agentflow_comp_operator;
GRANT UPDATE(name,effective_date,is_active,contract_levels) ON public.comp_grids TO agentflow_comp_operator;
GRANT DELETE ON public.comp_grids TO agentflow_comp_operator;
GRANT INSERT(grid_id,organization_id,category,carrier,product_name,is_active) ON public.comp_products TO agentflow_comp_operator;
GRANT UPDATE(category,carrier,product_name,is_active) ON public.comp_products TO agentflow_comp_operator;
GRANT DELETE ON public.comp_products TO agentflow_comp_operator;
GRANT INSERT(grid_id,product_id,organization_id,label,min_age,max_age,term_years) ON public.comp_product_variants TO agentflow_comp_operator;
GRANT UPDATE(label,min_age,max_age,term_years) ON public.comp_product_variants TO agentflow_comp_operator;
GRANT DELETE ON public.comp_product_variants TO agentflow_comp_operator;
GRANT INSERT(grid_id,variant_id,organization_id,contract_level,rate_percent) ON public.comp_rates TO agentflow_comp_operator;
GRANT UPDATE(rate_percent) ON public.comp_rates TO agentflow_comp_operator;
GRANT DELETE ON public.comp_rates TO agentflow_comp_operator;
GRANT INSERT(variant_id,grid_id,organization_id,source,notes) ON public.comp_variant_references TO agentflow_comp_operator;
GRANT UPDATE(source,notes) ON public.comp_variant_references TO agentflow_comp_operator;
GRANT DELETE ON public.comp_variant_references TO agentflow_comp_operator;
GRANT INSERT(organization_id,grid_id) ON public.organization_comp_grids TO agentflow_comp_operator;
GRANT DELETE ON public.organization_comp_grids TO agentflow_comp_operator;
GRANT INSERT(organization_id,calculator_grid_id) ON public.organization_comp_settings TO agentflow_comp_operator;
GRANT UPDATE(calculator_grid_id) ON public.organization_comp_settings TO agentflow_comp_operator;

-- ── Shared prologue for write operations ─────────────────────────────────────────────────────────────
-- Agency admin of the caller's home organization only; callable only by the dedicated operation role.
CREATE FUNCTION comp_authz.begin_admin_operation()
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog, pg_temp
AS $$
DECLARE v_org uuid:=comp_authz.actor_org_id();
BEGIN
  IF current_user<>'agentflow_comp_operator' THEN
    RAISE EXCEPTION 'Commission grid data can only be changed through AgentFlow operations' USING ERRCODE='42501';
  END IF;
  IF v_org IS NULL OR NOT comp_authz.actor_is_admin() THEN
    RAISE EXCEPTION 'Only an agency admin can change commission grids' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.organization_comp_settings(organization_id) VALUES(v_org) ON CONFLICT(organization_id) DO NOTHING;
  PERFORM 1 FROM public.organization_comp_settings s WHERE s.organization_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agency commission settings are unavailable' USING ERRCODE='42501'; END IF;
  RETURN v_org;
END $$;
REVOKE ALL ON FUNCTION comp_authz.begin_admin_operation() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION comp_authz.begin_admin_operation() TO agentflow_comp_operator;

-- ── Reads ────────────────────────────────────────────────────────────────────────────────────────────
-- Light availability check for navigation and the route gate.
CREATE FUNCTION public.get_commission_calculator_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid := comp_authz.actor_org_id();
  v_id  uuid;
  v_rev bigint;
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', 'no_access');
  END IF;
  SELECT g.id, g.revision INTO v_id, v_rev
    FROM public.organization_comp_settings s
    JOIN public.comp_grids g ON g.id = s.calculator_grid_id AND g.is_active
   WHERE s.organization_id = v_org;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_configured');
  END IF;
  RETURN jsonb_build_object('status', 'ready', 'grid_id', v_id, 'revision', v_rev);
END $$;

-- One-snapshot calculator read: the agency's selected ACTIVE eligible grid, its active products, their
-- variants and rates (rate as exact text), and the caller's OWN raw contract level. Never source/notes.
CREATE FUNCTION public.get_commission_calculator_context()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH actor AS (
    SELECT comp_authz.actor_org_id() AS org_id
  ), grid AS (
    SELECT g.id, g.name, g.effective_date, g.contract_levels, g.revision
      FROM actor a
      JOIN public.organization_comp_settings s ON s.organization_id = a.org_id
      JOIN public.comp_grids g ON g.id = s.calculator_grid_id AND g.is_active
  ), products AS (
    SELECT p.id, p.category, p.carrier, p.product_name
      FROM public.comp_products p JOIN grid g ON p.grid_id = g.id
     WHERE p.is_active
  ), variants AS (
    SELECT v.id, v.product_id, v.label, v.min_age, v.max_age, v.term_years
      FROM public.comp_product_variants v JOIN products p ON v.product_id = p.id
  ), rates AS (
    SELECT r.variant_id, r.contract_level, r.rate_percent
      FROM public.comp_rates r JOIN variants v ON r.variant_id = v.id
  )
  SELECT CASE
    WHEN (SELECT a.org_id FROM actor a) IS NULL THEN jsonb_build_object('status', 'no_access')
    WHEN NOT EXISTS (SELECT 1 FROM grid) THEN jsonb_build_object('status', 'not_configured')
    ELSE jsonb_build_object(
      'status', 'ready',
      'commission_level', (SELECT p.commission_level FROM public.profiles p WHERE p.id = auth.uid()),
      'grid', (SELECT jsonb_build_object('id', g.id, 'name', g.name, 'effective_date', g.effective_date,
                                         'contract_levels', to_jsonb(g.contract_levels), 'revision', g.revision)
                 FROM grid g),
      'products', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'category', p.category,
                                   'carrier', p.carrier, 'product_name', p.product_name)
                                   ORDER BY p.category, p.carrier, p.product_name) FROM products p), '[]'::jsonb),
      'variants', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'product_id', v.product_id,
                                   'label', v.label, 'min_age', v.min_age, 'max_age', v.max_age,
                                   'term_years', to_jsonb(v.term_years))
                                   ORDER BY v.product_id, v.label) FROM variants v), '[]'::jsonb),
      'rates', coalesce((SELECT jsonb_agg(jsonb_build_object('variant_id', r.variant_id,
                                'contract_level', r.contract_level, 'rate_percent', r.rate_percent::text)
                                ORDER BY r.variant_id, r.contract_level) FROM rates r), '[]'::jsonb))
  END
$$;

-- Metadata-only catalog for an agency admin: the ACTIVE shared grids AgentFlow has made AVAILABLE to the
-- caller's agency (decision D5), with id, name, effective date, levels and whether the agency has enabled
-- it. A grid that is not available to the agency is not listed at all. Never products, variants, rates or
-- references.
CREATE FUNCTION public.comp_list_shared_grid_catalog()
RETURNS TABLE (id uuid, name text, effective_date date, contract_levels integer[], is_enabled boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_org uuid := comp_authz.actor_org_id();
BEGIN
  IF v_org IS NULL OR NOT comp_authz.actor_is_admin() THEN
    RAISE EXCEPTION 'Only an agency admin can view the AgentFlow grid catalog' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT g.id, g.name, g.effective_date, g.contract_levels,
           EXISTS (SELECT 1 FROM public.organization_comp_grids a
                    WHERE a.organization_id = v_org AND a.grid_id = g.id)
      FROM public.comp_grids g
     WHERE g.organization_id IS NULL AND g.is_active
       AND EXISTS (SELECT 1 FROM public.organization_comp_grid_availability v
                    WHERE v.organization_id = v_org AND v.grid_id = g.id)
     ORDER BY g.name, g.effective_date DESC, g.id;
END $$;

-- Agency admin overview: the calculator selection plus every grid the admin can read (own private
-- grids, and the shared grids the agency has enabled, active or not).
CREATE FUNCTION public.comp_get_admin_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_org uuid := comp_authz.actor_org_id();
BEGIN
  IF v_org IS NULL OR NOT comp_authz.actor_is_admin() THEN
    RAISE EXCEPTION 'Only an agency admin can manage commission grids' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'calculator_grid_id', (SELECT s.calculator_grid_id FROM public.organization_comp_settings s
                              WHERE s.organization_id = v_org),
      'grids', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', g.id, 'name', g.name, 'effective_date', g.effective_date, 'is_active', g.is_active,
                 'contract_levels', to_jsonb(g.contract_levels), 'revision', g.revision, 'origin', g.origin,
                 'shared', g.organization_id IS NULL, 'updated_at', g.updated_at,
                 'updated_by_name', nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
                 'product_count', (SELECT count(*) FROM public.comp_products p WHERE p.grid_id = g.id))
               ORDER BY g.organization_id IS NOT NULL, g.name, g.effective_date DESC, g.id)
          FROM public.comp_grids g
          LEFT JOIN public.profiles u ON u.id = g.updated_by), '[]'::jsonb))
  );
END $$;

-- One-snapshot editor read for an agency admin: grid, all products (inactive included), variants,
-- rates (exact text) and protected references. `editable` is false for AgentFlow shared grids.
CREATE FUNCTION public.comp_get_grid_snapshot(p_grid_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org    uuid := comp_authz.actor_org_id();
  v_result jsonb;
BEGIN
  IF v_org IS NULL OR NOT comp_authz.actor_is_admin() THEN
    RAISE EXCEPTION 'Only an agency admin can manage commission grids' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
           'grid', jsonb_build_object(
             'id', g.id, 'name', g.name, 'effective_date', g.effective_date, 'is_active', g.is_active,
             'contract_levels', to_jsonb(g.contract_levels), 'revision', g.revision, 'origin', g.origin,
             'shared', g.organization_id IS NULL, 'editable', g.organization_id IS NOT NULL,
             'updated_at', g.updated_at,
             'updated_by_name', (SELECT nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), '')
                                   FROM public.profiles u WHERE u.id = g.updated_by)),
           'products', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'category', p.category,
                                        'carrier', p.carrier, 'product_name', p.product_name, 'is_active', p.is_active)
                                        ORDER BY p.category, p.carrier, p.product_name)
                                   FROM public.comp_products p WHERE p.grid_id = g.id), '[]'::jsonb),
           'variants', coalesce((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'product_id', v.product_id,
                                        'label', v.label, 'min_age', v.min_age, 'max_age', v.max_age,
                                        'term_years', to_jsonb(v.term_years))
                                        ORDER BY v.product_id, v.label)
                                   FROM public.comp_product_variants v WHERE v.grid_id = g.id), '[]'::jsonb),
           'rates', coalesce((SELECT jsonb_agg(jsonb_build_object('variant_id', r.variant_id,
                                     'contract_level', r.contract_level, 'rate_percent', r.rate_percent::text)
                                     ORDER BY r.variant_id, r.contract_level)
                                FROM public.comp_rates r WHERE r.grid_id = g.id), '[]'::jsonb),
           'references', coalesce((SELECT jsonb_agg(jsonb_build_object('variant_id', x.variant_id,
                                          'source', x.source, 'notes', x.notes) ORDER BY x.variant_id)
                                     FROM public.comp_variant_references x WHERE x.grid_id = g.id), '[]'::jsonb))
    INTO v_result
    FROM public.comp_grids g
   WHERE g.id = p_grid_id;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'That grid is not available' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_result;
END $$;

-- ── Agency configuration ─────────────────────────────────────────────────────────────────────────────
-- Enable an ACTIVE shared grid for the caller's agency (retry-safe). Only a grid AgentFlow has made
-- available to that agency can be enabled (access trigger, decision D5); anything else, an id supplied
-- directly included, is PT404. Selects it for the calculator only when nothing is selected; an existing
-- selection is kept and reported.
CREATE FUNCTION public.comp_enable_shared_grid(p_grid_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org     uuid;
  v_current uuid;
BEGIN
  IF p_grid_id IS NULL THEN
    RAISE EXCEPTION 'A grid is required' USING ERRCODE = '22023';
  END IF;
  v_org := comp_authz.begin_admin_operation();
  INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES (v_org, p_grid_id)
    ON CONFLICT (organization_id, grid_id) DO NOTHING;
  SELECT s.calculator_grid_id INTO v_current
    FROM public.organization_comp_settings s WHERE s.organization_id = v_org;
  IF v_current IS NULL THEN
    UPDATE public.organization_comp_settings s SET calculator_grid_id = p_grid_id
     WHERE s.organization_id = v_org;
  END IF;
  RETURN jsonb_build_object(
    'grid_id', p_grid_id, 'enabled', true,
    'calculator_grid_id', coalesce(v_current, p_grid_id),
    'selected', v_current IS NULL,
    'kept_existing_selection', v_current IS NOT NULL AND v_current <> p_grid_id);
END $$;

-- Disable a shared grid for the caller's agency (retry-safe). Clears the calculator selection only if
-- it was this grid; private copies are untouched; no replacement is chosen.
CREATE FUNCTION public.comp_disable_shared_grid(p_grid_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org     uuid;
  v_current uuid;
  v_removed integer;
BEGIN
  IF p_grid_id IS NULL THEN
    RAISE EXCEPTION 'A grid is required' USING ERRCODE = '22023';
  END IF;
  v_org := comp_authz.begin_admin_operation();
  SELECT s.calculator_grid_id INTO v_current
    FROM public.organization_comp_settings s WHERE s.organization_id = v_org;
  DELETE FROM public.organization_comp_grids a
   WHERE a.organization_id = v_org AND a.grid_id = p_grid_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN jsonb_build_object(
    'grid_id', p_grid_id, 'disabled', v_removed > 0,
    'cleared_selection', v_removed > 0 AND v_current IS NOT DISTINCT FROM p_grid_id);
END $$;

-- Compare-and-set the calculator grid (NULL = no calculator). p_expected_current must equal the
-- selection the admin last saw, so two admins cannot silently overwrite each other.
CREATE FUNCTION public.comp_select_calculator_grid(p_grid_id uuid, p_expected_current uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org     uuid;
  v_current uuid;
BEGIN
  v_org := comp_authz.begin_admin_operation();
  SELECT s.calculator_grid_id INTO v_current
    FROM public.organization_comp_settings s WHERE s.organization_id = v_org;
  IF v_current IS DISTINCT FROM p_expected_current THEN
    RAISE EXCEPTION 'The calculator grid was changed by someone else. Reload and try again.'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_grid_id IS NOT DISTINCT FROM v_current THEN
    RETURN jsonb_build_object('calculator_grid_id', v_current, 'changed', false);
  END IF;
  UPDATE public.organization_comp_settings s SET calculator_grid_id = p_grid_id
   WHERE s.organization_id = v_org;
  RETURN jsonb_build_object('calculator_grid_id', p_grid_id, 'changed', true);
END $$;

-- ── Private grids ────────────────────────────────────────────────────────────────────────────────────
-- Create a private grid for the caller's agency:
--   blank      empty, default levels 145..65 (step 5)
--   structure  products/variants/ages/terms of an ENABLED shared grid, default levels, ZERO rate rows
--   full       levels, structure, every rate (explicit zeros included) and references of an ENABLED
--              shared grid
-- The destination organization is the caller's; it is never a parameter. New ids are server-generated.
-- Inserting the grid row locks the source grid and the agency's access row FOR SHARE (trigger), so the
-- source cannot change, be deactivated or deleted, and access cannot be revoked until this commits;
-- every copy statement below runs after that lock and therefore reads one unchanging source.
CREATE FUNCTION public.comp_create_private_grid(p_mode text, p_name text, p_effective_date date,
                                                p_source_grid_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org        uuid;
  v_new        uuid;
  v_products   bigint := 0;
  v_variants   bigint := 0;
  v_rates      bigint := 0;
  v_references bigint := 0;
  v_expect_p   bigint;
  v_expect_v   bigint;
  v_expect_r   bigint;
  v_expect_x   bigint;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('blank', 'structure', 'full') THEN
    RAISE EXCEPTION 'Unknown grid creation mode' USING ERRCODE = '22023';
  END IF;
  IF (p_mode = 'blank') <> (p_source_grid_id IS NULL) THEN
    RAISE EXCEPTION 'A copy needs a source grid; a blank grid takes none' USING ERRCODE = '22023';
  END IF;
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'An effective date is required' USING ERRCODE = '22023';
  END IF;
  v_org := comp_authz.begin_admin_operation();

  -- Server-generated id (no RETURNING: a new row is not yet in the caller's readable-grid list).
  v_new := gen_random_uuid();
  INSERT INTO public.comp_grids (id, organization_id, name, effective_date, is_active, contract_levels, origin,
                                 copied_from_grid_id)
  VALUES (v_new, v_org, p_name, p_effective_date, true,
          ARRAY[145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70, 65],
          CASE p_mode WHEN 'blank' THEN 'blank' WHEN 'structure' THEN 'structure_copy' ELSE 'full_copy' END,
          p_source_grid_id);

  IF p_mode = 'blank' THEN
    RETURN jsonb_build_object('grid_id', v_new, 'mode', p_mode,
                              'products', 0, 'variants', 0, 'rates', 0, 'references', 0);
  END IF;

  SELECT count(*) INTO v_expect_p FROM public.comp_products p WHERE p.grid_id = p_source_grid_id;
  SELECT count(*) INTO v_expect_v FROM public.comp_product_variants v WHERE v.grid_id = p_source_grid_id;
  SELECT count(*) INTO v_expect_r FROM public.comp_rates r WHERE r.grid_id = p_source_grid_id;
  SELECT count(*) INTO v_expect_x FROM public.comp_variant_references x WHERE x.grid_id = p_source_grid_id;

  IF p_mode = 'full' THEN
    UPDATE public.comp_grids g
       SET contract_levels = (SELECT s.contract_levels FROM public.comp_grids s WHERE s.id = p_source_grid_id)
     WHERE g.id = v_new;
  END IF;

  INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name, is_active)
  SELECT v_new, v_org, p.category, p.carrier, p.product_name, p.is_active
    FROM public.comp_products p WHERE p.grid_id = p_source_grid_id;
  GET DIAGNOSTICS v_products = ROW_COUNT;

  INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
  SELECT v_new, np.id, v_org, sv.label, sv.min_age, sv.max_age, sv.term_years
    FROM public.comp_product_variants sv
    JOIN public.comp_products sp ON sp.id = sv.product_id
    JOIN public.comp_products np ON np.grid_id = v_new AND np.category = sp.category
                                AND np.carrier = sp.carrier AND np.product_name = sp.product_name
   WHERE sv.grid_id = p_source_grid_id;
  GET DIAGNOSTICS v_variants = ROW_COUNT;

  IF p_mode = 'full' THEN
    INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
    SELECT v_new, nv.id, v_org, r.contract_level, r.rate_percent
      FROM public.comp_rates r
      JOIN public.comp_product_variants sv ON sv.id = r.variant_id
      JOIN public.comp_products sp ON sp.id = sv.product_id
      JOIN public.comp_products np ON np.grid_id = v_new AND np.category = sp.category
                                  AND np.carrier = sp.carrier AND np.product_name = sp.product_name
      JOIN public.comp_product_variants nv ON nv.product_id = np.id AND nv.label = sv.label
     WHERE r.grid_id = p_source_grid_id;
    GET DIAGNOSTICS v_rates = ROW_COUNT;

    INSERT INTO public.comp_variant_references (variant_id, grid_id, organization_id, source, notes)
    SELECT nv.id, v_new, v_org, x.source, x.notes
      FROM public.comp_variant_references x
      JOIN public.comp_product_variants sv ON sv.id = x.variant_id
      JOIN public.comp_products sp ON sp.id = sv.product_id
      JOIN public.comp_products np ON np.grid_id = v_new AND np.category = sp.category
                                  AND np.carrier = sp.carrier AND np.product_name = sp.product_name
      JOIN public.comp_product_variants nv ON nv.product_id = np.id AND nv.label = sv.label
     WHERE x.grid_id = p_source_grid_id;
    GET DIAGNOSTICS v_references = ROW_COUNT;
  END IF;

  IF v_products <> v_expect_p OR v_variants <> v_expect_v
     OR (p_mode = 'full' AND (v_rates <> v_expect_r OR v_references <> v_expect_x)) THEN
    RAISE EXCEPTION 'The copy did not match its source; nothing was saved' USING ERRCODE = 'XX000';
  END IF;

  SET CONSTRAINTS ALL IMMEDIATE;
  RETURN jsonb_build_object('grid_id', v_new, 'mode', p_mode, 'products', v_products,
                            'variants', v_variants, 'rates', v_rates, 'references', v_references);
END $$;

-- Atomic changeset for one PRIVATE grid of the caller's agency, guarded by the grid revision the admin
-- loaded (stale => PT409, nothing saved). Shape (every key optional):
--   grid              {name, effective_date, is_active, contract_levels}    (all four when present)
--   delete_product_ids / delete_variant_ids   [uuid]     (cascade; the UI confirms first)
--   products          [{id | key, category, carrier, product_name, is_active}]
--   variants          [{id | key, product_id | product_key (new variants), label, min_age, max_age,
--                       term_years, reference?: {source, notes} | null}]
--   rates             [{variant_id | variant_key, contract_level, rate_percent: "decimal text" | null}]
-- A null rate deletes that cell (explicit blank); "0" stores a zero. Precision beyond two decimals is
-- rejected by the table constraint, never rounded. New rows get server-generated ids; client keys are
-- only resolved through natural keys inside this call. Order: rate deletions, variant/product
-- deletions, products, variants, references, grid details (levels), rate values — so removing a level
-- requires deleting its rates in the same save, and new levels exist before rates are written there.
CREATE FUNCTION public.comp_save_grid_changes(p_grid_id uuid, p_expected_revision bigint, p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org      uuid;
  v_revision bigint;
  v_count    bigint;
  v_expected bigint;
  v_grid     jsonb;
  v_pmap     jsonb;
  v_vmap     jsonb;
  c_stale    constant text := 'This grid was changed by someone else. Reload to see the latest version.';
BEGIN
  IF p_grid_id IS NULL OR p_expected_revision IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'A grid, its revision and a change set are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k
              WHERE k NOT IN ('grid', 'delete_product_ids', 'delete_variant_ids', 'products', 'variants', 'rates')) THEN
    RAISE EXCEPTION 'Unknown change set field' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_changes) e WHERE e.key <> 'grid' AND jsonb_typeof(e.value) <> 'array') THEN
    RAISE EXCEPTION 'Change set lists must be arrays' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(coalesce(p_changes->'products', '[]')) > 500
     OR jsonb_array_length(coalesce(p_changes->'variants', '[]')) > 2000
     OR jsonb_array_length(coalesce(p_changes->'rates', '[]')) > 40000
     OR jsonb_array_length(coalesce(p_changes->'delete_product_ids', '[]')) > 500
     OR jsonb_array_length(coalesce(p_changes->'delete_variant_ids', '[]')) > 2000 THEN
    RAISE EXCEPTION 'The change set is too large' USING ERRCODE = '22023';
  END IF;
  -- Shape: exactly one of id/key per product and variant; one variant reference per rate; keys unique.
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(coalesce(p_changes->'products', '[]')) AS x(id uuid, key text)
              WHERE (x.id IS NULL) = (x.key IS NULL))
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]'))
                       AS x(id uuid, key text, product_id uuid, product_key text)
                 WHERE (x.id IS NULL) = (x.key IS NULL)
                    OR (x.id IS NULL AND (x.product_id IS NULL) = (x.product_key IS NULL)))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_changes->'rates', '[]')) e,
                       jsonb_to_record(e.value) AS x(variant_id uuid, variant_key text, contract_level integer)
                 WHERE (x.variant_id IS NULL) = (x.variant_key IS NULL) OR x.contract_level IS NULL
                    OR NOT (e.value ? 'rate_percent')
                    OR jsonb_typeof(e.value->'rate_percent') NOT IN ('string', 'number', 'null')
                    OR (x.variant_key IS NOT NULL AND jsonb_typeof(e.value->'rate_percent') = 'null'))
     OR (SELECT count(x.key) <> count(DISTINCT x.key)
           FROM jsonb_to_recordset(coalesce(p_changes->'products', '[]')) AS x(key text))
     OR (SELECT count(x.key) <> count(DISTINCT x.key)
           FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]')) AS x(key text)) THEN
    RAISE EXCEPTION 'Each item needs exactly one id or key, and keys must be unique' USING ERRCODE = '22023';
  END IF;
  -- A key always names a NEW item of this same change set.
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]')) AS x(product_key text)
              WHERE x.product_key IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(coalesce(p_changes->'products', '[]')) AS p(key text)
                                 WHERE p.key = x.product_key))
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(coalesce(p_changes->'rates', '[]')) AS x(variant_key text)
                 WHERE x.variant_key IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]')) AS v(key text)
                                    WHERE v.key = x.variant_key)) THEN
    RAISE EXCEPTION 'A change refers to a new item that is not in the change set' USING ERRCODE = '22023';
  END IF;

  v_org := comp_authz.begin_admin_operation();

  -- RLS: inside an operation only the caller's own PRIVATE grids pass the UPDATE policy needed to lock.
  SELECT g.revision INTO v_revision FROM public.comp_grids g WHERE g.id = p_grid_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That grid is not available to edit' USING ERRCODE = 'PT404';
  END IF;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION '%', c_stale USING ERRCODE = 'PT409';
  END IF;

  -- 1. Explicit blanks: delete those rate cells.
  DELETE FROM public.comp_rates r
   USING (SELECT x.variant_id, x.contract_level
            FROM jsonb_array_elements(coalesce(p_changes->'rates', '[]')) e,
                 jsonb_to_record(e.value) AS x(variant_id uuid, contract_level integer)
           WHERE jsonb_typeof(e.value->'rate_percent') = 'null') c
   WHERE r.grid_id = p_grid_id AND r.variant_id = c.variant_id AND r.contract_level = c.contract_level;

  -- 2. Deletions (cascade). Every listed id must still exist in this grid, or the admin's view is stale.
  SELECT count(DISTINCT (d #>> '{}')::uuid) INTO v_expected
    FROM jsonb_array_elements(coalesce(p_changes->'delete_variant_ids', '[]')) d;
  DELETE FROM public.comp_product_variants v
   WHERE v.grid_id = p_grid_id
     AND v.id IN (SELECT (d #>> '{}')::uuid FROM jsonb_array_elements(coalesce(p_changes->'delete_variant_ids', '[]')) d);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> v_expected THEN RAISE EXCEPTION '%', c_stale USING ERRCODE = 'PT409'; END IF;

  SELECT count(DISTINCT (d #>> '{}')::uuid) INTO v_expected
    FROM jsonb_array_elements(coalesce(p_changes->'delete_product_ids', '[]')) d;
  DELETE FROM public.comp_products p
   WHERE p.grid_id = p_grid_id
     AND p.id IN (SELECT (d #>> '{}')::uuid FROM jsonb_array_elements(coalesce(p_changes->'delete_product_ids', '[]')) d);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> v_expected THEN RAISE EXCEPTION '%', c_stale USING ERRCODE = 'PT409'; END IF;

  -- 3. Products: updates by id (must belong to this grid), inserts by key.
  SELECT count(*) INTO v_expected
    FROM jsonb_to_recordset(coalesce(p_changes->'products', '[]')) AS x(id uuid) WHERE x.id IS NOT NULL;
  UPDATE public.comp_products p
     SET category = c.category, carrier = c.carrier, product_name = c.product_name,
         is_active = coalesce(c.is_active, true)
    FROM jsonb_to_recordset(coalesce(p_changes->'products', '[]'))
         AS c(id uuid, category text, carrier text, product_name text, is_active boolean)
   WHERE c.id IS NOT NULL AND p.id = c.id AND p.grid_id = p_grid_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> v_expected THEN RAISE EXCEPTION '%', c_stale USING ERRCODE = 'PT409'; END IF;

  INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name, is_active)
  SELECT p_grid_id, v_org, c.category, c.carrier, c.product_name, coalesce(c.is_active, true)
    FROM jsonb_to_recordset(coalesce(p_changes->'products', '[]'))
         AS c(id uuid, key text, category text, carrier text, product_name text, is_active boolean)
   WHERE c.id IS NULL;
  SELECT coalesce(jsonb_object_agg(c.key, p.id), '{}'::jsonb) INTO v_pmap
    FROM jsonb_to_recordset(coalesce(p_changes->'products', '[]'))
         AS c(id uuid, key text, category text, carrier text, product_name text)
    JOIN public.comp_products p ON p.grid_id = p_grid_id AND p.category = c.category
                               AND p.carrier = c.carrier AND p.product_name = c.product_name
   WHERE c.id IS NULL;

  -- 4. Variants: updates by id, inserts by key (product by id or by a new product's key). The composite
  -- foreign key rejects a product from another grid or scope.
  SELECT count(*) INTO v_expected
    FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]')) AS x(id uuid) WHERE x.id IS NOT NULL;
  UPDATE public.comp_product_variants v
     SET label = coalesce(c.label, ''), min_age = c.min_age, max_age = c.max_age, term_years = c.term_years
    FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]'))
         AS c(id uuid, label text, min_age integer, max_age integer, term_years integer[])
   WHERE c.id IS NOT NULL AND v.id = c.id AND v.grid_id = p_grid_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> v_expected THEN RAISE EXCEPTION '%', c_stale USING ERRCODE = 'PT409'; END IF;

  INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
  SELECT p_grid_id, coalesce(c.product_id, (v_pmap->>c.product_key)::uuid), v_org, coalesce(c.label, ''),
         c.min_age, c.max_age, c.term_years
    FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]'))
         AS c(id uuid, product_id uuid, product_key text, label text, min_age integer, max_age integer,
              term_years integer[])
   WHERE c.id IS NULL;
  SELECT coalesce(jsonb_object_agg(c.key, v.id), '{}'::jsonb) INTO v_vmap
    FROM jsonb_to_recordset(coalesce(p_changes->'variants', '[]'))
         AS c(id uuid, key text, product_id uuid, product_key text, label text)
    JOIN public.comp_product_variants v
      ON v.grid_id = p_grid_id AND v.product_id = coalesce(c.product_id, (v_pmap->>c.product_key)::uuid)
     AND v.label = coalesce(c.label, '')
   WHERE c.id IS NULL;

  -- 5. Protected references (admin-only): {source, notes} upsert; null or empty deletes.
  DELETE FROM public.comp_variant_references x
   USING (SELECT coalesce(c.id, (v_vmap->>c.key)::uuid) AS variant_id, e.value->'reference' AS reference
            FROM jsonb_array_elements(coalesce(p_changes->'variants', '[]')) e,
                 jsonb_to_record(e.value) AS c(id uuid, key text)
           WHERE e.value ? 'reference') r
   WHERE x.grid_id = p_grid_id AND x.variant_id = r.variant_id
     AND (jsonb_typeof(r.reference) <> 'object'
          OR (nullif(r.reference->>'source', '') IS NULL AND nullif(r.reference->>'notes', '') IS NULL));
  INSERT INTO public.comp_variant_references (variant_id, grid_id, organization_id, source, notes)
  SELECT coalesce(c.id, (v_vmap->>c.key)::uuid), p_grid_id, v_org,
         nullif(e.value->'reference'->>'source', ''), nullif(e.value->'reference'->>'notes', '')
    FROM jsonb_array_elements(coalesce(p_changes->'variants', '[]')) e,
         jsonb_to_record(e.value) AS c(id uuid, key text)
   WHERE jsonb_typeof(e.value->'reference') = 'object'
     AND (nullif(e.value->'reference'->>'source', '') IS NOT NULL
          OR nullif(e.value->'reference'->>'notes', '') IS NOT NULL)
  ON CONFLICT (variant_id) DO UPDATE SET source = EXCLUDED.source, notes = EXCLUDED.notes;

  -- 6. Grid details (all four fields together).
  v_grid := p_changes->'grid';
  IF v_grid IS NOT NULL THEN
    IF jsonb_typeof(v_grid) <> 'object'
       OR NOT (v_grid ?& ARRAY['name', 'effective_date', 'is_active', 'contract_levels'])
       OR jsonb_typeof(v_grid->'contract_levels') <> 'array'
       OR jsonb_typeof(v_grid->'is_active') <> 'boolean' THEN
      RAISE EXCEPTION 'Grid details need a name, effective date, active flag and levels' USING ERRCODE = '22023';
    END IF;
    UPDATE public.comp_grids g
       SET name = v_grid->>'name',
           effective_date = (v_grid->>'effective_date')::date,
           is_active = (v_grid->>'is_active')::boolean,
           contract_levels = ARRAY(SELECT (l #>> '{}')::integer
                                     FROM jsonb_array_elements(v_grid->'contract_levels') WITH ORDINALITY AS t(l, n)
                                    ORDER BY t.n)
     WHERE g.id = p_grid_id;
  END IF;

  -- 7. Rate values (blank cells were deleted in step 1). Exact decimal text; the CHECK rejects excess
  -- precision instead of rounding. Every cell must belong to a variant of THIS grid (one deleted
  -- meanwhile => stale), so the upsert below can only ever meet a conflicting row of this grid.
  SELECT count(*) INTO v_count
    FROM jsonb_array_elements(coalesce(p_changes->'rates', '[]')) e
    CROSS JOIN LATERAL jsonb_to_record(e.value) AS c(variant_id uuid, variant_key text)
    LEFT JOIN public.comp_product_variants v
           ON v.id = coalesce(c.variant_id, (v_vmap->>c.variant_key)::uuid) AND v.grid_id = p_grid_id
   WHERE jsonb_typeof(e.value->'rate_percent') <> 'null' AND v.id IS NULL;
  IF v_count > 0 THEN RAISE EXCEPTION '%', c_stale USING ERRCODE = 'PT409'; END IF;

  INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
  SELECT p_grid_id, coalesce(c.variant_id, (v_vmap->>c.variant_key)::uuid), v_org, c.contract_level,
         (e.value->>'rate_percent')::numeric
    FROM jsonb_array_elements(coalesce(p_changes->'rates', '[]')) e,
         jsonb_to_record(e.value) AS c(variant_id uuid, variant_key text, contract_level integer)
   WHERE jsonb_typeof(e.value->'rate_percent') <> 'null'
  ON CONFLICT (variant_id, contract_level) DO UPDATE SET rate_percent = EXCLUDED.rate_percent;

  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT g.revision INTO v_revision FROM public.comp_grids g WHERE g.id = p_grid_id;
  RETURN jsonb_build_object('grid_id', p_grid_id, 'revision', v_revision);
END $$;

-- Delete one of the caller's PRIVATE grids (cascade) at the revision the admin loaded. A calculator
-- selection pointing at it is cleared (FK ON DELETE SET NULL); nothing else is selected. A missing grid or
-- a missing, zero or negative revision is refused before the operation starts (a NULL revision would
-- otherwise skip the stale check below).
CREATE FUNCTION public.comp_delete_private_grid(p_grid_id uuid, p_expected_revision bigint)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org      uuid;
  v_revision bigint;
  v_selected boolean;
BEGIN
  IF p_grid_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'A grid and its current revision are required' USING ERRCODE = '22023';
  END IF;
  v_org := comp_authz.begin_admin_operation();
  SELECT g.revision INTO v_revision FROM public.comp_grids g WHERE g.id = p_grid_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That grid is not available to delete' USING ERRCODE = 'PT404';
  END IF;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'This grid was changed by someone else. Reload to see the latest version.' USING ERRCODE = 'PT409';
  END IF;
  SELECT s.calculator_grid_id IS NOT DISTINCT FROM p_grid_id INTO v_selected
    FROM public.organization_comp_settings s WHERE s.organization_id = v_org;
  DELETE FROM public.comp_grids g WHERE g.id = p_grid_id;
  RETURN jsonb_build_object('grid_id', p_grid_id, 'deleted', true, 'cleared_selection', coalesce(v_selected, false));
END $$;

-- ── Privileges ──────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.get_commission_calculator_status(), public.get_commission_calculator_context(),
  public.comp_list_shared_grid_catalog(), public.comp_get_admin_overview(), public.comp_get_grid_snapshot(uuid),
  public.comp_enable_shared_grid(uuid), public.comp_disable_shared_grid(uuid),
  public.comp_select_calculator_grid(uuid, uuid), public.comp_create_private_grid(text, text, date, uuid),
  public.comp_save_grid_changes(uuid, bigint, jsonb), public.comp_delete_private_grid(uuid, bigint)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_commission_calculator_status(), public.get_commission_calculator_context(),
  public.comp_list_shared_grid_catalog(), public.comp_get_admin_overview(), public.comp_get_grid_snapshot(uuid),
  public.comp_enable_shared_grid(uuid), public.comp_disable_shared_grid(uuid),
  public.comp_select_calculator_grid(uuid, uuid), public.comp_create_private_grid(text, text, date, uuid),
  public.comp_save_grid_changes(uuid, bigint, jsonb), public.comp_delete_private_grid(uuid, bigint)
TO authenticated;
ALTER FUNCTION public.comp_enable_shared_grid(uuid) OWNER TO agentflow_comp_operator;
ALTER FUNCTION public.comp_disable_shared_grid(uuid) OWNER TO agentflow_comp_operator;
ALTER FUNCTION public.comp_select_calculator_grid(uuid,uuid) OWNER TO agentflow_comp_operator;
ALTER FUNCTION public.comp_create_private_grid(text,text,date,uuid) OWNER TO agentflow_comp_operator;
ALTER FUNCTION public.comp_save_grid_changes(uuid,bigint,jsonb) OWNER TO agentflow_comp_operator;
ALTER FUNCTION public.comp_delete_private_grid(uuid,bigint) OWNER TO agentflow_comp_operator;
REVOKE CREATE ON SCHEMA public FROM agentflow_comp_operator;
