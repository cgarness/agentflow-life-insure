-- =====================================================================================================
-- Commission grids — access suite: permission matrix as REAL non-bypass client roles (anon /
-- authenticated with JWT claims), direct table writes, forged claims, operation-role isolation, peer
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
                           'organization_comp_grids','organization_comp_settings','comp_reference_imports',
                           'organization_comp_grid_availability'] LOOP
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

-- A4. Other agencies (including an ACTIVE Agency Group peer of A) read nothing of A's grids. Agency B can
-- enable a shared grid only once AgentFlow has made it available to B (decision D5); being an agency
-- admin is not enough.
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
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), 'SELECT jsonb_agg(c.name ORDER BY c.name) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.check('A4l B''s catalog lists only what is available to B (S2, not S1)',
    r.out_state = '00000' AND r.out_result = '["Synthetic Shared Two"]'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), $q$SELECT public.comp_enable_shared_grid('51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.refused('A4m B cannot enable S1 by id while it is not available to B', r.out_state, r.out_message, 'PT404');
  PERFORM comp_test.check('A4n the refusal created no access row for B',
    NOT EXISTS (SELECT 1 FROM public.organization_comp_grids WHERE organization_id = 'bbbbbbbb-0000-0000-0000-00000000000b'));
  INSERT INTO public.organization_comp_grid_availability (organization_id, grid_id)
    VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', '51000000-0000-0000-0000-000000000001');
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), $q$SELECT public.comp_enable_shared_grid('51000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.ok('A4o once AgentFlow makes S1 available to B, B''s admin enables it', r.out_state, r.out_message);
  PERFORM comp_test.check('A4p agent B now reads it', comp_test.visible('A4p', comp_test.p('agent_b'), 'comp_rates') = 6);
  PERFORM comp_test.check('A4q agent B still cannot read A''s private copy',
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

-- A7. Browser roles have no base-table write privileges.
DO $$
DECLARE r record; who text; v_private uuid; q text;
BEGIN
 SELECT id INTO v_private FROM public.comp_grids WHERE name='A private';
 FOREACH who IN ARRAY ARRAY['admin_a','agent_a'] LOOP
  FOREACH q IN ARRAY ARRAY[
   format('INSERT INTO public.comp_grids (organization_id,name,effective_date,contract_levels,origin) VALUES (%L,%L,%L,ARRAY[100],%L) RETURNING to_jsonb(id)','aaaaaaaa-0000-0000-0000-00000000000a','direct','2025-01-01','blank'),
   format('UPDATE public.comp_grids SET name=%L WHERE id=%L RETURNING to_jsonb(id)','direct update',v_private),
   format('DELETE FROM public.comp_grids WHERE id=%L RETURNING to_jsonb(id)',v_private),
   'UPDATE public.organization_comp_settings SET calculator_grid_id=NULL RETURNING to_jsonb(organization_id)',
   'DELETE FROM public.organization_comp_grids RETURNING to_jsonb(grid_id)'] LOOP
   SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who),q);
   PERFORM comp_test.refused('A7 '||who||' direct write',r.out_state,r.out_message,'42501','permission denied%');
  END LOOP;
 END LOOP;
 PERFORM comp_test.check('A7z selection unchanged',(SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id='aaaaaaaa-0000-0000-0000-00000000000a')='51000000-0000-0000-0000-000000000001');
 RAISE NOTICE 'A7 browser base-table writes: ok';
END $$;

-- A8. Operation-role trigger and RLS independently enforce the real actor.
DO $$
DECLARE r record; v_b uuid;
BEGIN
 SELECT id INTO v_b FROM public.comp_grids WHERE name='B private';
 SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'),$q$WITH forged AS (SELECT set_config('agentflow.comp_operation','on',true)) INSERT INTO public.comp_grids(organization_id,name,effective_date,contract_levels,origin) SELECT 'aaaaaaaa-0000-0000-0000-00000000000a','forged','2025-01-01',ARRAY[100],'blank' FROM forged RETURNING to_jsonb(id)$q$);
 PERFORM comp_test.refused('A8a forged legacy GUC irrelevant',r.out_state,r.out_message,'42501','permission denied%');
 SELECT * INTO r FROM comp_test.run_as('agentflow_comp_operator',comp_test.claims(comp_test.p('admin_a'),'aaaaaaaa-0000-0000-0000-00000000000a','Admin'),$q$INSERT INTO public.comp_products(grid_id,organization_id,category,carrier,product_name) VALUES('51000000-0000-0000-0000-000000000001',NULL,'term','Forged','Forged') RETURNING to_jsonb(id)$q$);
 PERFORM comp_test.refused('A8b trigger shared row',r.out_state,r.out_message,'42501','Only an agency admin%');
 SELECT * INTO r FROM comp_test.run_as('agentflow_comp_operator',comp_test.claims(comp_test.p('admin_a'),'aaaaaaaa-0000-0000-0000-00000000000a','Admin'),format('INSERT INTO public.comp_products(grid_id,organization_id,category,carrier,product_name) VALUES(%L,%L,%L,%L,%L) RETURNING to_jsonb(id)',v_b,'bbbbbbbb-0000-0000-0000-00000000000b','term','Forged','Forged'));
 PERFORM comp_test.refused('A8c trigger cross-org',r.out_state,r.out_message,'42501','Only an agency admin%');
 SELECT * INTO r FROM comp_test.run_as('agentflow_comp_operator',comp_test.claims(comp_test.p('agent_a'),'aaaaaaaa-0000-0000-0000-00000000000a','Agent'),$q$INSERT INTO public.comp_grids(organization_id,name,effective_date,contract_levels,origin) VALUES('aaaaaaaa-0000-0000-0000-00000000000a','Agent forged','2025-01-01',ARRAY[100],'blank') RETURNING to_jsonb(id)$q$);
 PERFORM comp_test.refused('A8d trigger non-admin',r.out_state,r.out_message,'42501','Only an agency admin%');
 BEGIN
  ALTER TABLE public.comp_products DISABLE TRIGGER comp_00_operation_context;
  SELECT * INTO r FROM comp_test.run_as('agentflow_comp_operator',comp_test.claims(comp_test.p('admin_a'),'aaaaaaaa-0000-0000-0000-00000000000a','Admin'),format('INSERT INTO public.comp_products(grid_id,organization_id,category,carrier,product_name) VALUES(%L,%L,%L,%L,%L) RETURNING to_jsonb(id)',v_b,'bbbbbbbb-0000-0000-0000-00000000000b','term','Forged','Forged'));
  PERFORM comp_test.refused('A8e RLS alone cross-org',r.out_state,r.out_message,'42501','%row-level security%');
  RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='rollback';
 EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
 PERFORM comp_test.check('A8f trigger restored',(SELECT bool_and(t.tgenabled='O') FROM pg_trigger t WHERE t.tgname='comp_00_operation_context'));
 RAISE NOTICE 'A8 operation-role isolation: ok';
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
    $q$WITH x AS (DELETE FROM public.organization_comp_settings RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
    $q$WITH x AS (INSERT INTO public.organization_comp_grid_availability (organization_id, grid_id) VALUES ('cccccccc-0000-0000-0000-00000000000c', '51000000-0000-0000-0000-000000000001') RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
    $q$WITH x AS (DELETE FROM public.organization_comp_grid_availability RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$] LOOP
    SELECT * INTO r FROM comp_test.run_as('service_role', '{}'::jsonb, q);
    PERFORM comp_test.refused('A9c service_role cannot write: ' || left(q, 60), r.out_state, r.out_message, '42501', 'permission denied%');
  END LOOP;
  SELECT * INTO r FROM comp_test.run_as('service_role', '{}'::jsonb, $q$SELECT to_jsonb(count(*)) FROM public.comp_rates$q$);
  PERFORM comp_test.ok('A9d service_role can read', r.out_state, r.out_message);
  FOREACH q IN ARRAY ARRAY[
    $q$SELECT private.comp_make_reference_grid_available('Synthetic Agency C', '51000000-0000-0000-0000-000000000001')$q$,
    $q$SELECT private.comp_remove_reference_grid_availability('Synthetic Agency A', '51000000-0000-0000-0000-000000000001')$q$] LOOP
    SELECT * INTO r FROM comp_test.run_as('service_role', '{}'::jsonb, q);
    PERFORM comp_test.refused('A9e service_role cannot run: ' || left(q, 60), r.out_state, r.out_message, '42501', 'permission denied%');
  END LOOP;
  RAISE NOTICE 'A9 service_role (read-only): ok';
END $$;

-- A10. Privilege, role and SECURITY DEFINER inventories.
DO $$
DECLARE v_bad text; v_role record;
BEGIN
 SELECT string_agg(n.nspname||'.'||p.proname,', ') INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (p.proname LIKE 'comp\_%' OR n.nspname='comp_authz' OR p.proname LIKE '%commission_calculator%') AND n.nspname IN('public','private','comp_authz') AND has_function_privilege('anon',p.oid,'EXECUTE');
 PERFORM comp_test.check('A10a anon executes none',v_bad IS NULL);
 SELECT string_agg(p.proname,', ') INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'comp\_%' AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('agentflow_comp_operator',p.oid,'EXECUTE'));
 PERFORM comp_test.check('A10b private functions postgres-only',v_bad IS NULL);
 SELECT * INTO v_role FROM pg_roles WHERE rolname='agentflow_comp_operator';
 PERFORM comp_test.check('A10e operation role narrow',v_role.rolname IS NOT NULL AND NOT v_role.rolcanlogin AND NOT v_role.rolsuper AND NOT v_role.rolcreatedb AND NOT v_role.rolcreaterole AND NOT v_role.rolinherit AND NOT v_role.rolreplication AND NOT v_role.rolbypassrls AND NOT has_schema_privilege('agentflow_comp_operator','public','CREATE') AND has_schema_privilege('agentflow_comp_operator','auth','USAGE') AND has_function_privilege('agentflow_comp_operator','auth.uid()','EXECUTE'));
 PERFORM comp_test.check('A10f only postgres member',NOT pg_has_role('anon','agentflow_comp_operator','MEMBER') AND NOT pg_has_role('authenticated','agentflow_comp_operator','MEMBER') AND NOT pg_has_role('service_role','agentflow_comp_operator','MEMBER') AND pg_has_role('postgres','agentflow_comp_operator','MEMBER') AND (SELECT count(*) FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='agentflow_comp_operator'))=1);
 SELECT string_agg(c.relname||'.'||k.priv||'.'||a.attname,', ') INTO v_bad FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN(VALUES('INSERT'),('UPDATE'))k(priv) WHERE c.relname IN('comp_grids','comp_products','comp_product_variants','comp_rates','comp_variant_references','organization_comp_grids','organization_comp_settings','comp_reference_imports','organization_comp_grid_availability') AND has_column_privilege('authenticated',c.oid,a.attnum,k.priv);
 PERFORM comp_test.check('A10h authenticated no column writes',v_bad IS NULL);
 SELECT string_agg(p.proname,', ' ORDER BY p.proname) INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='agentflow_comp_operator');
 PERFORM comp_test.check('A10j operator owns six write RPCs',v_bad='comp_create_private_grid, comp_delete_private_grid, comp_disable_shared_grid, comp_enable_shared_grid, comp_save_grid_changes, comp_select_calculator_grid');
 SELECT string_agg(n.nspname||'.'||p.proname,', ' ORDER BY n.nspname,p.proname) INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname IN('public','private','comp_authz') AND (p.proname LIKE 'comp\_%' OR n.nspname='comp_authz');
 PERFORM comp_test.check('A10c SECURITY DEFINER exact',v_bad='comp_authz.actor_is_admin, comp_authz.actor_org_id, comp_authz.readable_grid_ids, private.comp_access_revoked, private.comp_access_rules, private.comp_bump_grid_revision, private.comp_child_rules, private.comp_grid_deactivated, private.comp_grid_rules, private.comp_selection_rules, private.comp_variant_rules, public.comp_create_private_grid, public.comp_delete_private_grid, public.comp_disable_shared_grid, public.comp_enable_shared_grid, public.comp_list_shared_grid_catalog, public.comp_save_grid_changes, public.comp_select_calculator_grid');
 SELECT string_agg(n.nspname||'.'||p.proname,', ') INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','comp_authz') AND (p.proname LIKE 'comp\_%' OR n.nspname='comp_authz' OR p.proname LIKE '%commission_calculator%') AND NOT EXISTS(SELECT 1 FROM unnest(coalesce(p.proconfig,'{}'))c WHERE c='search_path=pg_catalog, pg_temp');
 PERFORM comp_test.check('A10d search_path pinned',v_bad IS NULL);
 RAISE NOTICE 'A10 privilege/role inventories: ok';
END $$;

-- A11. Availability (decision D5). S4 is a shared grid AgentFlow has made available to agency A only.
-- Every other agency (its admins, a Super Admin who is also a platform admin, A's Agency Group peer) cannot
-- list it, enable it by id, read, snapshot, copy or select it. Nobody but the postgres operator can grant
-- or withdraw availability: not an agent, team leader, agency admin, Super Admin or service_role (A9).
-- Availability alone opens no content; the home agency's admin still decides to enable it. Disabling
-- keeps availability; withdrawing it removes that agency's enabled access and clears its selection,
-- while a private copy made earlier stays intact, readable, selectable and editable.
DO $$
DECLARE
  r record; who text; q text; t text; v jsonb; v_copy uuid; v_copy_content text[]; v_home_content text[]; v_prof uuid;
  c_home  constant uuid := '54000000-0000-0000-0000-000000000001';
  c_org_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  c_org_b constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  c_s1    constant uuid := '51000000-0000-0000-0000-000000000001';
  c_super_b    constant uuid := 'bbbbbbbb-0000-0000-0000-0000000000b4';
  c_platform   constant uuid := 'dddddddd-0000-0000-0000-0000000000a5';
BEGIN
  INSERT INTO public.comp_grids (id, organization_id, name, effective_date, contract_levels, origin) VALUES
    (c_home, NULL, 'Synthetic Home Only', '2025-11-20', ARRAY[100,90], 'agentflow_reference');
  INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name) VALUES
    ('54000000-0000-0000-0000-000000000101', c_home, NULL, 'whole_life', 'Carrier East', 'Home Plan');
  INSERT INTO public.comp_product_variants (id, grid_id, product_id, organization_id, label) VALUES
    ('54000000-0000-0000-0000-000000000201', c_home, '54000000-0000-0000-0000-000000000101', NULL, '');
  INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent) VALUES
    (c_home, '54000000-0000-0000-0000-000000000201', NULL, 100, 55.5),
    (c_home, '54000000-0000-0000-0000-000000000201', NULL, 90, 0);
  INSERT INTO public.comp_variant_references (variant_id, grid_id, organization_id, source, notes) VALUES
    ('54000000-0000-0000-0000-000000000201', c_home, NULL, 'Synthetic home schedule', 'Synthetic home note');
  INSERT INTO public.organization_comp_grid_availability (organization_id, grid_id) VALUES (c_org_a, c_home);
  -- Agency B's Super Admin who also holds the platform_admin platform role, and a platform admin with no
  -- agency at all: neither flag is availability.
  INSERT INTO public.profiles (id, organization_id, role, status, is_super_admin, platform_role, commission_level, first_name, last_name) VALUES
    (c_super_b,  c_org_b, 'Super Admin', 'Active', true, 'platform_admin', '100', 'Pat',  'Platform'),
    (c_platform, NULL,    'Admin',       'Active', true, 'platform_admin', '100', 'Nora', 'Noagency');
  v_home_content := comp_test.content(c_home);

  -- Catalog: the home agency only.
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), 'SELECT jsonb_agg(c ORDER BY c.name) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.check('A11a the home agency''s admin sees the grid in its catalog, not yet enabled',
    r.out_state = '00000' AND r.out_result @> jsonb_build_array(jsonb_build_object('id', c_home, 'is_enabled', false)));
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_b'), 'SELECT jsonb_agg(c.name ORDER BY c.name) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.check('A11b agency B''s admin sees only B''s available grids, not this one',
    r.out_state = '00000' AND r.out_result = '["Synthetic Shared One", "Synthetic Shared Two"]'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(c_super_b, 'SELECT jsonb_agg(c.name ORDER BY c.name) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.check('A11c agency B''s Super Admin / platform admin sees the same, not this one',
    r.out_state = '00000' AND r.out_result = '["Synthetic Shared One", "Synthetic Shared Two"]'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_c'), 'SELECT coalesce(jsonb_agg(c.name), ''[]''::jsonb) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.check('A11d A''s Agency Group peer C has nothing available: empty catalog',
    r.out_state = '00000' AND r.out_result = '[]'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(c_platform, 'SELECT to_jsonb(count(*)) FROM public.comp_list_shared_grid_catalog()');
  PERFORM comp_test.refused('A11e a platform admin without an agency has no catalog', r.out_state, r.out_message, '42501');

  -- Enable by id: refused for every other agency; nothing is written.
  FOREACH v_prof IN ARRAY ARRAY[comp_test.p('admin_b'), c_super_b, comp_test.p('admin_c')] LOOP
    SELECT * INTO r FROM comp_test.as_profile(v_prof, format('SELECT public.comp_enable_shared_grid(%L)', c_home));
    PERFORM comp_test.refused('A11f another agency''s admin cannot enable it by id (' || v_prof || ')', r.out_state, r.out_message,
      'PT404', 'That AgentFlow grid is not available');
  END LOOP;
  SELECT * INTO r FROM comp_test.as_profile(c_platform, format('SELECT public.comp_enable_shared_grid(%L)', c_home));
  PERFORM comp_test.refused('A11g a platform admin without an agency cannot enable it', r.out_state, r.out_message, '42501');
  SELECT * INTO r FROM comp_test.run_as('authenticated', comp_test.claims(c_super_b, c_org_a, 'Super Admin', true),
    format('SELECT public.comp_enable_shared_grid(%L)', c_home));
  PERFORM comp_test.refused('A11h B''s Super Admin claiming agency A in the token is refused', r.out_state, r.out_message, '42501');
  PERFORM comp_test.check('A11i the refusals wrote no access row and no selection',
    NOT EXISTS (SELECT 1 FROM public.organization_comp_grids WHERE grid_id = c_home)
    AND NOT EXISTS (SELECT 1 FROM public.organization_comp_settings WHERE calculator_grid_id = c_home)
    AND NOT EXISTS (SELECT 1 FROM public.organization_comp_settings WHERE organization_id = 'cccccccc-0000-0000-0000-00000000000c'));

  -- Snapshot, copy (full and structure) and select: refused for every other agency, by id.
  FOREACH v_prof IN ARRAY ARRAY[comp_test.p('admin_b'), c_super_b, comp_test.p('admin_c')] LOOP
    SELECT * INTO r FROM comp_test.as_profile(v_prof, format('SELECT public.comp_get_grid_snapshot(%L)', c_home));
    PERFORM comp_test.refused('A11j snapshot by id refused (' || v_prof || ')', r.out_state, r.out_message, 'PT404');
    FOREACH q IN ARRAY ARRAY['full', 'structure'] LOOP
      SELECT * INTO r FROM comp_test.as_profile(v_prof, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', q, 'Taken ' || q, '2025-11-20', c_home));
      PERFORM comp_test.refused('A11k ' || q || ' copy by id refused (' || v_prof || ')', r.out_state, r.out_message,
        'PT404', 'Enable that AgentFlow grid for your agency before copying it');
    END LOOP;
    SELECT * INTO r FROM comp_test.as_profile(v_prof, format(
      'SELECT public.comp_select_calculator_grid(%L, (SELECT s.calculator_grid_id FROM public.organization_comp_settings s))', c_home));
    PERFORM comp_test.refused('A11l select by id refused (' || v_prof || ')', r.out_state, r.out_message,
      'PT404', 'That grid is not available for the calculator');
  END LOOP;
  PERFORM comp_test.check('A11m no copy was made from it', NOT EXISTS (SELECT 1 FROM public.comp_grids WHERE copied_from_grid_id = c_home));

  -- Direct reads: no row of the grid for any other agency's member, nor for the home agency before it enables.
  FOREACH v_prof IN ARRAY ARRAY[comp_test.p('admin_b'), comp_test.p('agent_b'), c_super_b, comp_test.p('admin_c'),
                                comp_test.p('agent_c'), comp_test.p('admin_a'), comp_test.p('agent_a')] LOOP
    SELECT * INTO r FROM comp_test.as_profile(v_prof, format('SELECT to_jsonb(count(*)) FROM public.comp_grids WHERE id = %L', c_home));
    PERFORM comp_test.check('A11n no grid row (' || v_prof || ')', r.out_state = '00000' AND r.out_result = '0'::jsonb);
    FOREACH t IN ARRAY ARRAY['comp_products', 'comp_product_variants', 'comp_rates', 'comp_variant_references'] LOOP
      SELECT * INTO r FROM comp_test.as_profile(v_prof, format('SELECT to_jsonb(count(*)) FROM public.%I WHERE grid_id = %L', t, c_home));
      PERFORM comp_test.check('A11n no ' || t || ' row (' || v_prof || ')', r.out_state = '00000' AND r.out_result = '0'::jsonb);
    END LOOP;
  END LOOP;
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('SELECT public.comp_get_grid_snapshot(%L)', c_home));
  PERFORM comp_test.refused('A11o availability alone opens no content: the home admin cannot snapshot it before enabling',
    r.out_state, r.out_message, 'PT404');

  -- Availability is managed by nobody but the postgres operator: agents, team leaders, agency admins and
  -- Super Admins cannot read, grant, withdraw, or run the private availability operations.
  FOREACH v_prof IN ARRAY ARRAY[comp_test.p('agent_a'), comp_test.p('leader_a'), comp_test.p('admin_a'), comp_test.p('super_a'),
                                comp_test.p('admin_b'), c_super_b] LOOP
    FOREACH q IN ARRAY ARRAY[
      'SELECT to_jsonb(count(*)) FROM public.organization_comp_grid_availability',
      format('INSERT INTO public.organization_comp_grid_availability (organization_id, grid_id) VALUES (%L, %L) RETURNING to_jsonb(grid_id)', c_org_b, c_home),
      format('INSERT INTO public.organization_comp_grid_availability (organization_id, grid_id) VALUES (%L, %L) ON CONFLICT DO NOTHING RETURNING to_jsonb(grid_id)', c_org_a, c_home),
      format('WITH x AS (DELETE FROM public.organization_comp_grid_availability WHERE grid_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x', c_home),
      format('SELECT private.comp_make_reference_grid_available(%L, %L)', 'Synthetic Agency B', c_home),
      format('SELECT private.comp_remove_reference_grid_availability(%L, %L)', 'Synthetic Agency A', c_home),
      format('SELECT private.comp_enable_reference_grid_for_agency(%L, %L)', 'Synthetic Agency B', c_home)] LOOP
      SELECT * INTO r FROM comp_test.as_profile(v_prof, q);
      PERFORM comp_test.refused('A11p cannot manage availability (' || v_prof || '): ' || left(q, 70), r.out_state, r.out_message,
        '42501', 'permission denied%');
    END LOOP;
  END LOOP;
  FOREACH who IN ARRAY ARRAY['agent_a', 'leader_a'] LOOP
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p(who), format('SELECT public.comp_enable_shared_grid(%L)', c_home));
    PERFORM comp_test.refused('A11q ' || who || ' cannot enable even an available grid', r.out_state, r.out_message, '42501');
  END LOOP;
  PERFORM comp_test.check('A11r availability unchanged: agency A only',
    (SELECT array_agg(organization_id) FROM public.organization_comp_grid_availability WHERE grid_id = c_home) = ARRAY[c_org_a]);

  -- The home agency's admin enables it (the existing selection is kept), selects it, and copies it.
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('SELECT public.comp_enable_shared_grid(%L)', c_home));
  PERFORM comp_test.ok('A11s the home agency''s admin enables it', r.out_state, r.out_message);
  PERFORM comp_test.check('A11t the existing selection is kept', (r.out_result->>'kept_existing_selection')::boolean
    AND r.out_result->>'calculator_grid_id' = c_s1::text);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('SELECT public.comp_select_calculator_grid(%L, %L)', c_home, c_s1));
  PERFORM comp_test.ok('A11u the home agency''s admin selects it', r.out_state, r.out_message);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT public.get_commission_calculator_context()');
  PERFORM comp_test.check('A11v the home agency''s agent now reads it',
    r.out_result->>'status' = 'ready' AND r.out_result#>>'{grid,id}' = c_home::text AND jsonb_array_length(r.out_result->'rates') = 2);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'full', 'A home copy', '2025-11-20', c_home));
  PERFORM comp_test.ok('A11w the home agency''s admin makes a full private copy', r.out_state, r.out_message);
  v_copy := (r.out_result->>'grid_id')::uuid;
  v_copy_content := comp_test.content(v_copy);
  PERFORM comp_test.check('A11x the copy is exact', v_copy_content = v_home_content);
  PERFORM comp_test.check('A11y B and C still read nothing of it or of the copy',
    comp_test.visible('A11y1', comp_test.p('agent_b'), 'comp_rates') = 6
    AND (SELECT out_result FROM comp_test.as_profile(comp_test.p('admin_b'), format('SELECT to_jsonb(count(*)) FROM public.comp_grids WHERE id IN (%L, %L)', c_home, v_copy))) = '0'::jsonb
    AND (SELECT out_result FROM comp_test.as_profile(comp_test.p('admin_c'), format('SELECT to_jsonb(count(*)) FROM public.comp_grids WHERE id IN (%L, %L)', c_home, v_copy))) = '0'::jsonb);

  -- Disabling keeps availability (and clears the selection that pointed at it); re-enabling works.
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('SELECT public.comp_disable_shared_grid(%L)', c_home));
  PERFORM comp_test.ok('A11z the home agency''s admin disables it', r.out_state, r.out_message);
  PERFORM comp_test.check('A11z1 disabling removed access and the selection, never availability',
    (r.out_result->>'cleared_selection')::boolean
    AND NOT EXISTS (SELECT 1 FROM public.organization_comp_grids WHERE organization_id = c_org_a AND grid_id = c_home)
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = c_org_a) IS NULL
    AND EXISTS (SELECT 1 FROM public.organization_comp_grid_availability WHERE organization_id = c_org_a AND grid_id = c_home));
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), 'SELECT jsonb_agg(c ORDER BY c.name) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.check('A11z2 still in the home catalog, as not enabled',
    r.out_result @> jsonb_build_array(jsonb_build_object('id', c_home, 'is_enabled', false)));
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('SELECT public.comp_enable_shared_grid(%L)', c_home));
  PERFORM comp_test.check('A11z3 re-enabling works and selects it (nothing was selected)',
    r.out_state = '00000' AND (r.out_result->>'selected')::boolean);

  -- Withdrawing availability (postgres operator): access and the selection go; the copy stays.
  v := private.comp_remove_reference_grid_availability('Synthetic Agency A', c_home);
  PERFORM comp_test.check('A11z4 withdrawal reports removed, disabled and the cleared selection: ' || v::text,
    v = jsonb_build_object('organization_id', c_org_a, 'grid_id', c_home, 'removed', true, 'disabled', true, 'cleared_selection', true));
  PERFORM comp_test.check('A11z5 no availability, no access and no selection of the grid remain',
    NOT EXISTS (SELECT 1 FROM public.organization_comp_grid_availability WHERE grid_id = c_home)
    AND NOT EXISTS (SELECT 1 FROM public.organization_comp_grids WHERE grid_id = c_home)
    AND NOT EXISTS (SELECT 1 FROM public.organization_comp_settings WHERE calculator_grid_id = c_home)
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = c_org_a) IS NULL);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT public.get_commission_calculator_context()');
  PERFORM comp_test.check('A11z6 the home agent''s calculator is not configured (no unauthorized selection left)',
    r.out_result = '{"status": "not_configured"}'::jsonb);
  PERFORM comp_test.check('A11z7 the home agent reads nothing of the grid any more',
    (SELECT out_result FROM comp_test.as_profile(comp_test.p('agent_a'), format('SELECT to_jsonb(count(*)) FROM public.comp_rates WHERE grid_id = %L', c_home))) = '0'::jsonb);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), 'SELECT jsonb_agg(c.id) FROM public.comp_list_shared_grid_catalog() c');
  PERFORM comp_test.check('A11z8 gone from the home catalog', r.out_state = '00000' AND NOT r.out_result @> jsonb_build_array(c_home));
  FOREACH q IN ARRAY ARRAY[
    format('SELECT public.comp_enable_shared_grid(%L)', c_home),
    format('SELECT public.comp_get_grid_snapshot(%L)', c_home),
    format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'full', 'Late copy', '2025-11-20', c_home),
    format('SELECT public.comp_select_calculator_grid(%L, NULL)', c_home)] LOOP
    SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), q);
    PERFORM comp_test.refused('A11z9 after withdrawal the home admin is refused: ' || left(q, 60), r.out_state, r.out_message, 'PT404');
  END LOOP;
  PERFORM comp_test.check('A11z10 the private copy is intact and the shared grid untouched',
    comp_test.content(v_copy) = v_copy_content AND comp_test.content(c_home) = v_home_content);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('admin_a'), format('SELECT public.comp_select_calculator_grid(%L, NULL)', v_copy));
  PERFORM comp_test.ok('A11z11 the private copy can still be selected', r.out_state, r.out_message);
  SELECT * INTO r FROM comp_test.as_profile(comp_test.p('agent_a'), 'SELECT public.get_commission_calculator_context()');
  PERFORM comp_test.check('A11z12 and the home agent reads the copy',
    r.out_result->>'status' = 'ready' AND r.out_result#>>'{grid,id}' = v_copy::text);
  PERFORM comp_test.save('A11z13 the private copy stays editable', comp_test.p('admin_a'), v_copy, comp_test.rev(v_copy),
    jsonb_build_object('rates', jsonb_build_array(jsonb_build_object(
      'variant_id', comp_test.vid(v_copy, 'Home Plan', ''), 'contract_level', 100, 'rate_percent', '56'))));
  PERFORM comp_test.check('A11z14 the edit changed the copy only',
    comp_test.rate(comp_test.vid(v_copy, 'Home Plan', ''), 100) = '56'
    AND comp_test.rate('54000000-0000-0000-0000-000000000201', 100) = '55.5');
  PERFORM comp_test.check('A11z15 agency B is unaffected: S1 still enabled and selected',
    EXISTS (SELECT 1 FROM public.organization_comp_grids WHERE organization_id = c_org_b AND grid_id = c_s1)
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = c_org_b) = c_s1);
  v := private.comp_remove_reference_grid_availability('Synthetic Agency A', c_home);
  PERFORM comp_test.check('A11z16 withdrawing again is a no-op: ' || v::text,
    v = jsonb_build_object('organization_id', c_org_a, 'grid_id', c_home, 'removed', false, 'disabled', false, 'cleared_selection', false));
  RAISE NOTICE 'A11 availability (one agency only; withdrawal keeps private copies): ok';
END $$;

SELECT 'commission_grids_access: ALL PASSED' AS result;
