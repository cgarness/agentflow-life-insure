-- =====================================================================================================
-- Commission grids — access suite: permission matrix as REAL non-bypass client roles (anon /
-- authenticated with JWT claims), direct table writes, forged claims, a forged operation context, peer
-- agencies, and the function/table privilege and SECURITY DEFINER inventories.
-- LOCAL disposable database only (invariant #28). Synthetic data only.
-- =====================================================================================================
\set ON_ERROR_STOP 1
DO $$ BEGIN PERFORM comp_test.seed_base(); END $$;

-- A1. anon: no table or function privilege at all.
DO $$
DECLARE r record; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comp_grids','comp_products','comp_product_variants','comp_rates','comp_variant_references',
                           'organization_comp_grids','organization_comp_settings','comp_reference_imports'] LOOP
    SELECT * INTO r FROM comp_test.run_as('anon', '{}'::jsonb, format('SELECT to_jsonb(count(*)) FROM public.%I', t));
    PERFORM comp_test.refused('A1 anon reads ' || t, r.out_state, r.out_message, '42501', 'permission denied%');
  END LOOP;
  SELECT * INTO r FROM comp_test.run_as('anon', '{}'::jsonb, 'SELECT public.get_commission_calculator_status()');
  PERFORM comp_test.refused('A1 anon status', r.out_state, r.out_message, '42501', 'permission denied%');
  SELECT * INTO r FROM comp_test.run_as('anon', '{}'::jsonb, $q$SELECT public.comp_enable_shared_grid('51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.refused('A1 anon enable', r.out_state, r.out_message, '42501', 'permission denied%');
  SELECT * INTO r FROM comp_test.run_as('anon', '{}'::jsonb, 'SELECT to_jsonb(count(*)) FROM public.comp_list_shared_grid_catalog()');
  PERFORM comp_test.refused('A1 anon catalog', r.out_state, r.out_message, '42501', 'permission denied%');
  RAISE NOTICE 'A1 anon: ok';
END $$;

-- A2. Before the agency enables anything: catalog metadata for admins only; no content for anyone.
DO $$
DECLARE r record; v jsonb;
BEGIN
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT public.get_commission_calculator_status()');
  PERFORM comp_test.check('A2a agent status not_configured', r.out_result->>'status' = 'not_configured');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT public.get_commission_calculator_context()');
  PERFORM comp_test.check('A2b agent context not_configured', r.out_result = '{"status": "not_configured"}'::jsonb);
  PERFORM comp_test.check('A2c agent sees no grid', comp_test.visible('A2c', comp_test.p('agent_a'), 'comp_grids') = 0);
  PERFORM comp_test.check('A2d admin sees no shared rates before enabling', comp_test.visible('A2d', comp_test.p('admin_a'), 'comp_rates') = 0);
  PERFORM comp_test.check('A2e admin sees no shared products before enabling', comp_test.visible('A2e', comp_test.p('admin_a'), 'comp_products') = 0);

  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), 'SELECT jsonb_agg(c ORDER BY c.name) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.ok('A2f admin catalog', r.out_state, r.out_message);
  v := r.out_result;
  PERFORM comp_test.check('A2g catalog lists the two ACTIVE shared grids only', jsonb_array_length(v) = 2
    AND v->0->>'name' = 'Synthetic Shared One' AND v->1->>'name' = 'Synthetic Shared Two');
  PERFORM comp_test.check('A2h catalog entry is metadata only',
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v->0) k) = ARRAY['contract_levels','effective_date','id','is_enabled','name']);
  PERFORM comp_test.check('A2i nothing enabled yet', (v->0->>'is_enabled')::boolean = false);

  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$SELECT public.comp_get_grid_snapshot('51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.refused('A2j admin cannot fetch shared content before enabling', r.out_state, r.out_message, 'PT404');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT to_jsonb(count(*)) FROM public.comp_list_shared_grid_catalog()');
  PERFORM comp_test.refused('A2k agent cannot read the catalog', r.out_state, r.out_message, '42501');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('leader_a'), 'SELECT to_jsonb(count(*)) FROM public.comp_list_shared_grid_catalog()');
  PERFORM comp_test.refused('A2l team leader cannot read the catalog', r.out_state, r.out_message, '42501');
  RAISE NOTICE 'A2 before enablement: ok';
END $$;

-- A3. Agency A enables S1: agents read the active content (never notes); admins also see inactive
-- products and the protected references.
DO $$
DECLARE r record; v jsonb;
BEGIN
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$SELECT public.comp_enable_shared_grid('51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.ok('A3a admin enables S1', r.out_state, r.out_message);
  PERFORM comp_test.check('A3b first enable selects it', (r.out_result->>'selected')::boolean);

  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT public.get_commission_calculator_context()');
  v := r.out_result;
  PERFORM comp_test.check('A3c agent context ready', v->>'status' = 'ready' AND v#>>'{grid,id}' = '51000000-0000-0000-0000-000000000001');
  PERFORM comp_test.check('A3d agent context: active products only', jsonb_array_length(v->'products') = 2);
  PERFORM comp_test.check('A3e agent context: variants of active products only', jsonb_array_length(v->'variants') = 4);
  PERFORM comp_test.check('A3f agent context: rates of active products, explicit zero kept as "0"',
    jsonb_array_length(v->'rates') = 6 AND v->'rates' @> '[{"rate_percent": "0", "contract_level": 100}]');
  PERFORM comp_test.check('A3g agent context: own raw level', v->>'commission_level' = '100');
  PERFORM comp_test.check('A3h agent context never carries source/notes',
    NOT (v ? 'references') AND position('Synthetic protected note' IN v::text) = 0 AND position('Synthetic schedule' IN v::text) = 0);
  PERFORM comp_test.check('A3i agent: active products', comp_test.visible('A3i', comp_test.p('agent_a'), 'comp_products') = 2);
  PERFORM comp_test.check('A3j agent: variants', comp_test.visible('A3j', comp_test.p('agent_a'), 'comp_product_variants') = 4);
  PERFORM comp_test.check('A3k agent: rates', comp_test.visible('A3k', comp_test.p('agent_a'), 'comp_rates') = 6);
  PERFORM comp_test.check('A3l agent: no references', comp_test.visible('A3l', comp_test.p('agent_a'), 'comp_variant_references') = 0);
  PERFORM comp_test.check('A3m team leader: no references', comp_test.visible('A3m', comp_test.p('leader_a'), 'comp_variant_references') = 0);
  PERFORM comp_test.check('A3n admin: inactive product visible', comp_test.visible('A3n', comp_test.p('admin_a'), 'comp_products') = 3);
  PERFORM comp_test.check('A3o admin: references visible', comp_test.visible('A3o', comp_test.p('admin_a'), 'comp_variant_references') = 1);
  PERFORM comp_test.check('A3p agent: own settings and access rows', comp_test.visible('A3p1', comp_test.p('agent_a'), 'organization_comp_settings') = 1
    AND comp_test.visible('A3p2', comp_test.p('agent_a'), 'organization_comp_grids') = 1);
  RAISE NOTICE 'A3 enabled-agency reads: ok';
END $$;

-- A4. Other agencies (including an ACTIVE Agency Group peer of A) read nothing of A's grids; agency B can
-- still enable the shared grid for itself (self-service by design).
DO $$
DECLARE r record; v_private uuid;
BEGIN
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$SELECT public.comp_create_private_grid('full', 'A private', '2025-02-01', '51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.ok('A4a admin A full copy', r.out_state, r.out_message);
  v_private := (r.out_result->>'grid_id')::uuid;
  PERFORM comp_test.check('A4b peer helper says C is A''s peer (from C''s side)',
    (SELECT out_result FROM comp_test.as_profile(comp_test.p('agent_c'), $q$SELECT to_jsonb(public.is_agency_group_peer_organization('aaaaaaaa-0000-0000-0000-00000000000a'))$q$) ) = 'true'::jsonb);
  PERFORM comp_test.check('A4c peer agent C reads nothing', comp_test.visible('A4c1', comp_test.p('agent_c'), 'comp_grids') = 0
    AND comp_test.visible('A4c2', comp_test.p('agent_c'), 'comp_rates') = 0 AND comp_test.visible('A4c3', comp_test.p('agent_c'), 'comp_products') = 0);
  PERFORM comp_test.check('A4d peer admin C reads nothing', comp_test.visible('A4d1', comp_test.p('admin_c'), 'comp_grids') = 0
    AND comp_test.visible('A4d2', comp_test.p('admin_c'), 'comp_variant_references') = 0);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_c'), format('SELECT public.comp_get_grid_snapshot(%L)', v_private));
  PERFORM comp_test.refused('A4e peer admin cannot open A''s private grid', r.out_state, r.out_message, 'PT404');
  PERFORM comp_test.check('A4f agent B reads nothing', comp_test.visible('A4f1', comp_test.p('agent_b'), 'comp_rates') = 0
    AND comp_test.visible('A4f2', comp_test.p('agent_b'), 'comp_grids') = 0);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), $q$SELECT public.comp_select_calculator_grid('51000000-0000-0000-0000-000000000001', NULL)$q$);
  PERFORM comp_test.refused('A4g B cannot select a grid it has not enabled', r.out_state, r.out_message, 'PT404');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), $q$SELECT public.comp_create_private_grid('full', 'B copy', '2025-02-01', '51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.refused('A4h B cannot copy a grid it has not enabled', r.out_state, r.out_message, 'PT404');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), format('SELECT public.comp_select_calculator_grid(%L, NULL)', v_private));
  PERFORM comp_test.refused('A4i B cannot select A''s private grid', r.out_state, r.out_message, 'PT404');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), format('SELECT public.comp_save_grid_changes(%L, 1, %L::jsonb)', v_private, '{}'));
  PERFORM comp_test.refused('A4j B cannot edit A''s private grid', r.out_state, r.out_message, 'PT404');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), format('SELECT public.comp_delete_private_grid(%L, 1)', v_private));
  PERFORM comp_test.refused('A4k B cannot delete A''s private grid', r.out_state, r.out_message, 'PT404');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), $q$SELECT public.comp_enable_shared_grid('51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.ok('A4l B self-enables the shared grid', r.out_state, r.out_message);
  PERFORM comp_test.check('A4m agent B now reads it', comp_test.visible('A4m', comp_test.p('agent_b'), 'comp_rates') = 6);
  PERFORM comp_test.check('A4n agent B still cannot read A''s private copy',
    (SELECT out_result FROM comp_test.as_profile(comp_test.p('agent_b'), format('SELECT to_jsonb(count(*)) FROM public.comp_grids WHERE id = %L', v_private))) = '0'::jsonb);
  RAISE NOTICE 'A4 other and peer agencies: ok';
END $$;

-- A5. Agents, team leaders and inactive admins cannot mutate through any operation.
DO $$
DECLARE r record; who text; q text; v_private uuid;
BEGIN
  SELECT id INTO v_private FROM public.comp_grids WHERE name = 'A private';
  FOREACH who IN ARRAY ARRAY['agent_a', 'leader_a', 'inactive_a'] LOOP
    FOREACH q IN ARRAY ARRAY[
      $q$SELECT public.comp_enable_shared_grid('52000000-0000-0000-0000-000000000001')$q$,
      $q$SELECT public.comp_disable_shared_grid('51000000-0000-0000-0000-000000000001')$q$,
      $q$SELECT public.comp_select_calculator_grid(NULL, '51000000-0000-0000-0000-000000000001')$q$,
      $q$SELECT public.comp_create_private_grid('blank', 'x', '2025-01-01')$q$,
      format('SELECT public.comp_save_grid_changes(%L, 1, %L::jsonb)', v_private, '{}'),
      format('SELECT public.comp_delete_private_grid(%L, 1)', v_private),
      'SELECT public.comp_get_admin_overview()',
      format('SELECT public.comp_get_grid_snapshot(%L)', v_private)] LOOP
      SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), q);
      PERFORM comp_test.refused('A5 ' || who || ': ' || left(q, 60), r.out_state, r.out_message, '42501');
    END LOOP;
  END LOOP;
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('inactive_a'), 'SELECT public.get_commission_calculator_status()');
  PERFORM comp_test.check('A5b inactive profile has no access', r.out_result->>'status' = 'no_access');
  RAISE NOTICE 'A5 non-admin mutations refused: ok';
END $$;

-- A6. Super Admin: agency admin of the HOME organization only; forged claims are not authority.
DO $$
DECLARE r record; v_b uuid;
BEGIN
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('super_a'), $q$SELECT public.comp_enable_shared_grid('52000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.ok('A6a super admin manages the home agency', r.out_state, r.out_message);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), $q$SELECT public.comp_create_private_grid('blank', 'B private', '2025-01-01')$q$);
  v_b := (r.out_result->>'grid_id')::uuid;
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('super_a'), format('SELECT public.comp_get_grid_snapshot(%L)', v_b));
  PERFORM comp_test.refused('A6b super admin cannot open another agency''s grid', r.out_state, r.out_message, 'PT404');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('super_a'), format('SELECT public.comp_delete_private_grid(%L, 1)', v_b));
  PERFORM comp_test.refused('A6c super admin cannot delete another agency''s grid', r.out_state, r.out_message, 'PT404');
  -- Super admin presenting agency B's id in the JWT org claim: profile org A ≠ claim ⇒ no authority.
  SELECT * INTO r FROM comp_test.run_as('authenticated',
    comp_test.claims(comp_test.p('super_a'), 'bbbbbbbb-0000-0000-0000-00000000000b', 'Admin', true),
    $q$SELECT public.comp_enable_shared_grid('51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.refused('A6d forged organization claim (super admin)', r.out_state, r.out_message, '42501');
  SELECT * INTO r FROM comp_test.run_as('authenticated',
    comp_test.claims(comp_test.p('admin_a'), 'bbbbbbbb-0000-0000-0000-00000000000b', 'Admin'),
    'SELECT public.get_commission_calculator_status()');
  PERFORM comp_test.check('A6e forged organization claim (admin) has no access', r.out_result->>'status' = 'no_access');
  SELECT * INTO r FROM comp_test.run_as('authenticated',
    comp_test.claims(comp_test.p('agent_a'), 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin'),
    $q$SELECT public.comp_enable_shared_grid('52000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.refused('A6f forged role claim (agent claiming Admin)', r.out_state, r.out_message, '42501');
  SELECT * INTO r FROM comp_test.run_as('authenticated',
    comp_test.claims('dddddddd-0000-0000-0000-0000000000dd', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin'),
    'SELECT public.get_commission_calculator_status()');
  PERFORM comp_test.check('A6g unknown subject has no access', r.out_result->>'status' = 'no_access');
  RAISE NOTICE 'A6 super admin home org and forged claims: ok';
END $$;

-- A7. Direct table writes are refused for every client, admins included (no operation context).
DO $$
DECLARE r record; who text; v_private uuid; v_product uuid; v_variant uuid;
BEGIN
  SELECT id INTO v_private FROM public.comp_grids WHERE name = 'A private';
  SELECT id INTO v_product FROM public.comp_products WHERE grid_id = v_private AND category = 'whole_life';
  SELECT id INTO v_variant FROM public.comp_product_variants WHERE product_id = v_product AND label = '0-70';
  FOREACH who IN ARRAY ARRAY['admin_a', 'agent_a'] LOOP
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'direct', '2025-01-01', ARRAY[100], 'blank') RETURNING to_jsonb(id)$q$);
    PERFORM comp_test.refused('A7 ' || who || ' direct grid insert', r.out_state, r.out_message, '42501');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), format('INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES (%L, %L, %L, %L, %L) RETURNING to_jsonb(id)', v_private, 'aaaaaaaa-0000-0000-0000-00000000000a', 'term', 'Direct', 'Direct'));
    PERFORM comp_test.refused('A7 ' || who || ' direct product insert', r.out_state, r.out_message, '42501');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), format('INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent) VALUES (%L, %L, %L, 110, 1) RETURNING to_jsonb(id)', v_private, v_variant, 'aaaaaaaa-0000-0000-0000-00000000000a'));
    PERFORM comp_test.refused('A7 ' || who || ' direct rate insert', r.out_state, r.out_message, '42501');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), $q$INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING RETURNING to_jsonb(grid_id)$q$);
    PERFORM comp_test.refused('A7 ' || who || ' direct access insert', r.out_state, r.out_message, '42501');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), format('WITH x AS (UPDATE public.comp_rates SET rate_percent = 1 WHERE grid_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x', v_private));
    PERFORM comp_test.check('A7 ' || who || ' direct rate update touches nothing', r.out_state = '00000' AND r.out_result = '0'::jsonb);
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), format('WITH x AS (DELETE FROM public.comp_grids WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x', v_private));
    PERFORM comp_test.check('A7 ' || who || ' direct grid delete touches nothing', r.out_state = '00000' AND r.out_result = '0'::jsonb);
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), $q$WITH x AS (UPDATE public.organization_comp_settings SET calculator_grid_id = NULL RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$);
    PERFORM comp_test.check('A7 ' || who || ' direct settings update touches nothing', r.out_state = '00000' AND r.out_result = '0'::jsonb);
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), $q$WITH x AS (DELETE FROM public.organization_comp_grids RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$);
    PERFORM comp_test.check('A7 ' || who || ' direct access delete touches nothing', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  END LOOP;
  PERFORM comp_test.check('A7z selection unchanged after the attempts',
    (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = '51000000-0000-0000-0000-000000000001');
  RAISE NOTICE 'A7 direct table writes refused: ok';
END $$;

-- A8. Defense in depth. PostgREST clients have no way to set agentflow.comp_operation; only the
-- operations set it (function-level SET). Here it is FORGED for the whole block, standing in for a
-- hypothetical buggy operation: the operation-context trigger (00) still refuses every row outside the
-- caller's own agency or by a non-admin BEFORE any SECURITY DEFINER trigger runs (so before any lock),
-- RLS hides other rows from UPDATE/DELETE, and column privileges keep ownership/audit columns fixed.
DO $$
DECLARE r record; v_b uuid; v_private uuid;
BEGIN
  SELECT id INTO v_b FROM public.comp_grids WHERE name = 'B private';
  SELECT id INTO v_private FROM public.comp_grids WHERE name = 'A private';
  PERFORM set_config('agentflow.comp_operation', 'on', true);

  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES ('51000000-0000-0000-0000-000000000001', NULL, 'term', 'Forged', 'Forged') RETURNING to_jsonb(id)$q$);
  PERFORM comp_test.refused('A8a shared product row (NULL org)', r.out_state, r.out_message, '42501', 'Only an agency admin%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES ('51000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'term', 'Forged', 'Forged') RETURNING to_jsonb(id)$q$);
  PERFORM comp_test.refused('A8b own-org row under the shared grid (shared grid never locked)', r.out_state, r.out_message, '23503', 'Grid not found');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES (%L, %L, %L, %L, %L) RETURNING to_jsonb(id)', v_b, 'aaaaaaaa-0000-0000-0000-00000000000a', 'term', 'Forged', 'Forged'));
  PERFORM comp_test.refused('A8c own-org row under another agency''s grid', r.out_state, r.out_message, '23503', 'Grid not found');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES (%L, %L, %L, %L, %L) RETURNING to_jsonb(id)', v_b, 'bbbbbbbb-0000-0000-0000-00000000000b', 'term', 'Forged', 'Forged'));
  PERFORM comp_test.refused('A8d another agency''s row', r.out_state, r.out_message, '42501', 'Only an agency admin%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin) VALUES (NULL, 'Manufactured', '2025-01-01', ARRAY[100], 'agentflow_reference') RETURNING to_jsonb(id)$q$);
  PERFORM comp_test.refused('A8e an agency cannot manufacture a shared grid', r.out_state, r.out_message, '42501', 'Only an agency admin%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', '52000000-0000-0000-0000-000000000001') RETURNING to_jsonb(grid_id)$q$);
  PERFORM comp_test.refused('A8f enabling for another agency', r.out_state, r.out_message, '42501', 'Only an agency admin%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.organization_comp_settings (organization_id, calculator_grid_id) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', NULL) RETURNING to_jsonb(organization_id)$q$);
  PERFORM comp_test.refused('A8g settings for another agency', r.out_state, r.out_message, '42501', 'Only an agency admin%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('UPDATE public.organization_comp_settings SET calculator_grid_id = %L WHERE organization_id = %L RETURNING to_jsonb(calculator_grid_id)', v_b, 'aaaaaaaa-0000-0000-0000-00000000000a'));
  PERFORM comp_test.refused('A8h selecting another agency''s private grid', r.out_state, r.out_message, 'PT404');

  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$WITH x AS (UPDATE public.comp_rates SET rate_percent = 1 WHERE grid_id = '51000000-0000-0000-0000-000000000001' RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$);
  PERFORM comp_test.check('A8i shared rates not updatable', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$WITH x AS (UPDATE public.comp_grids SET is_active = false WHERE id = '51000000-0000-0000-0000-000000000001' RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$);
  PERFORM comp_test.check('A8j shared grid cannot be deactivated by an agency', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$WITH x AS (DELETE FROM public.comp_products WHERE grid_id = '51000000-0000-0000-0000-000000000001' RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$);
  PERFORM comp_test.check('A8k shared products not deletable', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('WITH x AS (UPDATE public.comp_grids SET name = %L WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x', 'Hijack', v_b));
  PERFORM comp_test.check('A8l another agency''s private grid not updatable', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('WITH x AS (DELETE FROM public.comp_grids WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x', v_b));
  PERFORM comp_test.check('A8m another agency''s private grid not deletable', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('UPDATE public.comp_grids SET organization_id = NULL WHERE id = %L RETURNING to_jsonb(id)', v_private));
  PERFORM comp_test.refused('A8n ownership column not writable', r.out_state, r.out_message, '42501', 'permission denied%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('UPDATE public.comp_grids SET revision = 1 WHERE id = %L RETURNING to_jsonb(id)', v_private));
  PERFORM comp_test.refused('A8o revision not writable', r.out_state, r.out_message, '42501', 'permission denied%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('UPDATE public.comp_grids SET updated_by = %L WHERE id = %L RETURNING to_jsonb(id)', 'bbbbbbbb-0000-0000-0000-0000000000ad', v_private));
  PERFORM comp_test.refused('A8p audit actor not writable (spoofing)', r.out_state, r.out_message, '42501', 'permission denied%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('UPDATE public.comp_rates SET contract_level = 90 WHERE grid_id = %L RETURNING to_jsonb(id)', v_private));
  PERFORM comp_test.refused('A8q a rate cannot move level', r.out_state, r.out_message, '42501', 'permission denied%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('UPDATE public.comp_products SET grid_id = %L WHERE grid_id = %L RETURNING to_jsonb(id)', v_b, v_private));
  PERFORM comp_test.refused('A8r a product cannot move grid', r.out_state, r.out_message, '42501', 'permission denied%');

  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'Agent grid', '2025-01-01', ARRAY[100], 'blank') RETURNING to_jsonb(id)$q$);
  PERFORM comp_test.refused('A8s an agent still cannot write', r.out_state, r.out_message, '42501', 'Only an agency admin%');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), format('WITH x AS (UPDATE public.comp_rates SET rate_percent = 1 WHERE grid_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x', v_private));
  PERFORM comp_test.check('A8t an agent still cannot update', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT to_jsonb(count(*)) FROM public.comp_variant_references');
  PERFORM comp_test.check('A8u an agent still cannot read references', r.out_state = '00000' AND r.out_result = '0'::jsonb);
  PERFORM set_config('agentflow.comp_operation', '', true);
  RAISE NOTICE 'A8 forged operation context still refused: ok';
END $$;

-- A8 (layer independence). With the operation-context trigger DISABLED inside a probe that is always
-- rolled back, RLS alone still refuses the same forged writes. Proves the two layers do not depend on
-- each other.
DO $$
DECLARE r record; v_b uuid;
BEGIN
  SELECT id INTO v_b FROM public.comp_grids WHERE name = 'B private';
  BEGIN
    ALTER TABLE public.comp_products DISABLE TRIGGER comp_00_operation_context;
    ALTER TABLE public.comp_grids DISABLE TRIGGER comp_00_operation_context;
    ALTER TABLE public.organization_comp_grids DISABLE TRIGGER comp_00_operation_context;
    PERFORM set_config('agentflow.comp_operation', 'on', true);
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES ('51000000-0000-0000-0000-000000000001', NULL, 'term', 'Forged', 'Forged') RETURNING to_jsonb(id)$q$);
    PERFORM comp_test.refused('A8v RLS alone: shared product row', r.out_state, r.out_message, '42501', '%row-level security%');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES (%L, %L, %L, %L, %L) RETURNING to_jsonb(id)', v_b, 'bbbbbbbb-0000-0000-0000-00000000000b', 'term', 'Forged', 'Forged'));
    PERFORM comp_test.refused('A8w RLS alone: another agency''s row', r.out_state, r.out_message, '42501', '%row-level security%');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin) VALUES (NULL, 'Manufactured', '2025-01-01', ARRAY[100], 'agentflow_reference') RETURNING to_jsonb(id)$q$);
    PERFORM comp_test.refused('A8x RLS alone: manufactured shared grid', r.out_state, r.out_message, '42501', '%row-level security%');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'Agent grid', '2025-01-01', ARRAY[100], 'blank') RETURNING to_jsonb(id)$q$);
    PERFORM comp_test.refused('A8y RLS alone: agent write', r.out_state, r.out_message, '42501', '%row-level security%');
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), $q$INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', '52000000-0000-0000-0000-000000000001') RETURNING to_jsonb(grid_id)$q$);
    PERFORM comp_test.refused('A8z RLS alone: enabling for another agency', r.out_state, r.out_message, '42501', '%row-level security%');
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'probe rollback';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    NULL;
  END;
  PERFORM comp_test.check('A8 probe rolled back: triggers enabled again',
    (SELECT bool_and(t.tgenabled = 'O') FROM pg_trigger t WHERE t.tgname = 'comp_00_operation_context'));
  RAISE NOTICE 'A8 RLS alone (trigger layer removed in a rolled-back probe): ok';
END $$;

-- A9. service_role: read-only. No client operations, no import, and no direct write to any comp table, so a
--     server key cannot change a shared grid outside the postgres-only import or a reviewed migration.
DO $$
DECLARE r record; q text;
BEGIN
  SELECT * INTO r FROM comp_test.run_as('service_role', '{}'::jsonb, 'SELECT public.get_commission_calculator_status()');
  PERFORM comp_test.refused('A9a service_role has no operation EXECUTE', r.out_state, r.out_message, '42501', 'permission denied%');
  SELECT * INTO r FROM comp_test.run_as('service_role', '{}'::jsonb, $q$SELECT private.comp_import_reference_grid('{}', repeat('0', 64))$q$);
  PERFORM comp_test.refused('A9b service_role cannot run the import', r.out_state, r.out_message, '42501', 'permission denied%');
  FOREACH q IN ARRAY ARRAY[
    $q$WITH x AS (INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin) VALUES (NULL, 'x', '2025-01-01', ARRAY[100], 'agentflow_reference') RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
    $q$WITH x AS (INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES ('51000000-0000-0000-0000-000000000001', NULL, 'term', 'x', 'y') RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
    $q$WITH x AS (UPDATE public.comp_rates SET rate_percent = 1 WHERE organization_id IS NULL RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
    $q$WITH x AS (UPDATE public.comp_grids SET is_active = false WHERE organization_id IS NULL RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
    $q$WITH x AS (DELETE FROM public.comp_variant_references WHERE organization_id IS NULL RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
    $q$WITH x AS (DELETE FROM public.organization_comp_settings RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$] LOOP
    SELECT * INTO r FROM comp_test.run_as('service_role', '{}'::jsonb, q);
    PERFORM comp_test.refused('A9c service_role cannot write: ' || left(q, 60), r.out_state, r.out_message, '42501', 'permission denied%');
  END LOOP;
  SELECT * INTO r FROM comp_test.run_as('service_role', '{}'::jsonb, $q$SELECT to_jsonb(count(*)) FROM public.comp_rates$q$);
  PERFORM comp_test.ok('A9d service_role can read', r.out_state, r.out_message);
  RAISE NOTICE 'A9 service_role (read-only): ok';
END $$;

-- A10. Privilege and SECURITY DEFINER inventories.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE (p.proname LIKE 'comp\_%' OR n.nspname = 'comp_authz' OR p.proname LIKE '%commission_calculator%')
     AND n.nspname IN ('public', 'private', 'comp_authz')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  PERFORM comp_test.check('A10a anon executes no commission function (' || coalesce(v_bad, '') || ')', v_bad IS NULL);

  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private' AND p.proname LIKE 'comp\_%'
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'));
  PERFORM comp_test.check('A10b private commission functions are postgres-only (' || coalesce(v_bad, '') || ')', v_bad IS NULL);

  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef AND n.nspname IN ('public', 'private', 'comp_authz')
     AND (p.proname LIKE 'comp\_%' OR n.nspname = 'comp_authz');
  PERFORM comp_test.check('A10c SECURITY DEFINER inventory is exactly the reviewed set: ' || v_bad,
    v_bad = 'comp_authz.actor_is_admin, comp_authz.actor_org_id, comp_authz.readable_grid_ids, '
         || 'private.comp_access_revoked, private.comp_access_rules, private.comp_bump_grid_revision, '
         || 'private.comp_child_rules, private.comp_grid_deactivated, private.comp_grid_rules, '
         || 'private.comp_selection_rules, private.comp_variant_rules, public.comp_list_shared_grid_catalog');

  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private', 'comp_authz')
     AND (p.proname LIKE 'comp\_%' OR n.nspname = 'comp_authz' OR p.proname LIKE '%commission_calculator%')
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c = 'search_path=pg_catalog, pg_temp');
  PERFORM comp_test.check('A10d every commission function pins search_path (' || coalesce(v_bad, '') || ')', v_bad IS NULL);

  SELECT string_agg(c.relname || ':' || g.privilege_type, ', ') INTO v_bad
    FROM pg_class c
    JOIN information_schema.table_privileges g ON g.table_schema = 'public' AND g.table_name = c.relname
   WHERE c.relname IN ('comp_grids','comp_products','comp_product_variants','comp_rates','comp_variant_references',
                       'organization_comp_grids','organization_comp_settings','comp_reference_imports')
     AND (g.grantee IN ('anon', 'PUBLIC') OR (g.grantee = 'authenticated' AND g.privilege_type NOT IN ('SELECT', 'DELETE'))
          OR (g.grantee = 'authenticated' AND c.relname = 'comp_reference_imports'));
  PERFORM comp_test.check('A10e table grants: no anon/PUBLIC; authenticated table-level SELECT/DELETE only, never the ledger (' || coalesce(v_bad, '') || ')', v_bad IS NULL);

  -- Column-level write grants for authenticated: exactly the reviewed set (no id/scope/revision/audit
  -- column, no ownership or parent column on UPDATE). comp_grids.id is insertable only so the create
  -- operation can supply a server-generated id (no RETURNING through the not-yet-readable row).
  SELECT string_agg(x, ', ' ORDER BY x COLLATE "C") INTO v_bad
    FROM (SELECT c.relname || '.' || k.priv || '.' || a.attname AS x
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS k(priv)
           WHERE c.relname IN ('comp_grids','comp_products','comp_product_variants','comp_rates','comp_variant_references',
                               'organization_comp_grids','organization_comp_settings','comp_reference_imports')
             AND has_column_privilege('authenticated', c.oid, a.attnum, k.priv)) s;
  PERFORM comp_test.check('A10f authenticated column write grants are exactly the reviewed set: ' || coalesce(v_bad, ''),
    v_bad = (SELECT string_agg(x, ', ' ORDER BY x COLLATE "C") FROM unnest(ARRAY[
      'comp_grids.INSERT.id', 'comp_grids.INSERT.organization_id', 'comp_grids.INSERT.name',
      'comp_grids.INSERT.effective_date', 'comp_grids.INSERT.is_active', 'comp_grids.INSERT.contract_levels',
      'comp_grids.INSERT.origin', 'comp_grids.INSERT.copied_from_grid_id',
      'comp_grids.UPDATE.name', 'comp_grids.UPDATE.effective_date', 'comp_grids.UPDATE.is_active',
      'comp_grids.UPDATE.contract_levels',
      'comp_products.INSERT.grid_id', 'comp_products.INSERT.organization_id', 'comp_products.INSERT.category',
      'comp_products.INSERT.carrier', 'comp_products.INSERT.product_name', 'comp_products.INSERT.is_active',
      'comp_products.UPDATE.category', 'comp_products.UPDATE.carrier', 'comp_products.UPDATE.product_name',
      'comp_products.UPDATE.is_active',
      'comp_product_variants.INSERT.grid_id', 'comp_product_variants.INSERT.product_id',
      'comp_product_variants.INSERT.organization_id', 'comp_product_variants.INSERT.label',
      'comp_product_variants.INSERT.min_age', 'comp_product_variants.INSERT.max_age',
      'comp_product_variants.INSERT.term_years',
      'comp_product_variants.UPDATE.label', 'comp_product_variants.UPDATE.min_age',
      'comp_product_variants.UPDATE.max_age', 'comp_product_variants.UPDATE.term_years',
      'comp_rates.INSERT.grid_id', 'comp_rates.INSERT.variant_id', 'comp_rates.INSERT.organization_id',
      'comp_rates.INSERT.contract_level', 'comp_rates.INSERT.rate_percent', 'comp_rates.UPDATE.rate_percent',
      'comp_variant_references.INSERT.variant_id', 'comp_variant_references.INSERT.grid_id',
      'comp_variant_references.INSERT.organization_id', 'comp_variant_references.INSERT.source',
      'comp_variant_references.INSERT.notes', 'comp_variant_references.UPDATE.source',
      'comp_variant_references.UPDATE.notes',
      'organization_comp_grids.INSERT.organization_id', 'organization_comp_grids.INSERT.grid_id',
      'organization_comp_settings.INSERT.organization_id', 'organization_comp_settings.INSERT.calculator_grid_id',
      'organization_comp_settings.UPDATE.calculator_grid_id']) x));

  -- service_role: SELECT on all eight comp tables and nothing else (table- or column-level).
  SELECT string_agg(c.relname || ':' || k.priv, ', ') INTO v_bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS k(priv)
   WHERE c.relname IN ('comp_grids','comp_products','comp_product_variants','comp_rates','comp_variant_references',
                       'organization_comp_grids','organization_comp_settings','comp_reference_imports')
     AND (CASE WHEN k.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
               THEN has_any_column_privilege('service_role', c.oid, k.priv)
               ELSE has_table_privilege('service_role', c.oid, k.priv) END) <> (k.priv = 'SELECT');
  PERFORM comp_test.check('A10g service_role privileges (' || coalesce(v_bad, '') || ')', v_bad IS NULL);
  RAISE NOTICE 'A10 privilege inventories: ok';
END $$;

SELECT 'commission_grids_access: ALL PASSED' AS result;
