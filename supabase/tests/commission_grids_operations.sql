-- =====================================================================================================
-- Commission grids — operations suite. Every client operation run as a real agency admin (authenticated,
-- non-bypass): enable / disable / select semantics, private-grid creation (blank, structure copy, full
-- copy) with atomicity under injected failure, the atomic changeset (validation, exact decimals, stale
-- revisions, level and variant rules, references, deletions), the calculator context, the admin overview
-- and snapshot, and deletion. LOCAL disposable database only (invariant #28). Synthetic data only.
-- =====================================================================================================
\set ON_ERROR_STOP 1
DO $$ BEGIN PERFORM comp_test.seed_base(); END $$;

-- Test-only failure injection (owner-created, dropped below): fails or silently skips rows of a grid
-- with a marker name, to prove a copy is all-or-nothing and that the copy verifies its own counts.
CREATE FUNCTION comp_test.inject_failure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.comp_grids g WHERE g.id = NEW.grid_id AND g.name = 'Inject failure') THEN
    RAISE EXCEPTION 'injected failure' USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'comp_rates'
     AND EXISTS (SELECT 1 FROM public.comp_grids g WHERE g.id = NEW.grid_id AND g.name = 'Inject skip') THEN
    IF NEW.contract_level = 130 THEN  -- nested: the column exists only on comp_rates
      RETURN NULL;  -- silently drop one copied rate
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_inject_failure BEFORE INSERT ON public.comp_variant_references
  FOR EACH ROW EXECUTE FUNCTION comp_test.inject_failure();
CREATE TRIGGER zz_inject_skip BEFORE INSERT ON public.comp_rates
  FOR EACH ROW EXECUTE FUNCTION comp_test.inject_failure();

-- O1. Enable / disable / select: retry-safe, never silently overwrites a selection, compare-and-set.
DO $$
DECLARE v jsonb; a uuid := comp_test.p('admin_a'); agent uuid := comp_test.p('agent_a');
  org_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  s1 constant uuid := '51000000-0000-0000-0000-000000000001';
  s2 constant uuid := '52000000-0000-0000-0000-000000000001';
  s3 constant uuid := '53000000-0000-0000-0000-000000000001';
BEGIN
  v := comp_test.op_ok('O1a enable S1', a, format('SELECT public.comp_enable_shared_grid(%L)', s1));
  PERFORM comp_test.check('O1b first enable selects it (nothing was selected)',
    v @> jsonb_build_object('enabled', true, 'selected', true, 'kept_existing_selection', false, 'calculator_grid_id', s1));
  v := comp_test.op_ok('O1c enable S1 again (retry)', a, format('SELECT public.comp_enable_shared_grid(%L)', s1));
  PERFORM comp_test.check('O1d retry is a no-op',
    v @> jsonb_build_object('enabled', true, 'selected', false, 'kept_existing_selection', false, 'calculator_grid_id', s1)
    AND (SELECT count(*) FROM public.organization_comp_grids WHERE organization_id = org_a) = 1);
  v := comp_test.op_ok('O1e enable S2 while S1 is selected', a, format('SELECT public.comp_enable_shared_grid(%L)', s2));
  PERFORM comp_test.check('O1f the existing selection is kept and reported',
    v @> jsonb_build_object('selected', false, 'kept_existing_selection', true, 'calculator_grid_id', s1));
  PERFORM comp_test.op_refused('O1g an inactive shared grid cannot be enabled', a, format('SELECT public.comp_enable_shared_grid(%L)', s3), 'PT404');
  PERFORM comp_test.op_refused('O1h an unknown grid', a, $q$SELECT public.comp_enable_shared_grid('5f000000-0000-0000-0000-000000000001')$q$, 'PT404');
  PERFORM comp_test.op_refused('O1i no grid', a, 'SELECT public.comp_enable_shared_grid(NULL)', '22023');

  v := comp_test.op_ok('O1j disable S2 (not selected)', a, format('SELECT public.comp_disable_shared_grid(%L)', s2));
  PERFORM comp_test.check('O1k disabling another grid keeps the selection',
    v @> '{"disabled": true, "cleared_selection": false}'
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = org_a) = s1);
  v := comp_test.op_ok('O1l disable S2 again (retry)', a, format('SELECT public.comp_disable_shared_grid(%L)', s2));
  PERFORM comp_test.check('O1m the retry reports nothing to disable', v @> '{"disabled": false, "cleared_selection": false}');

  PERFORM comp_test.op_refused('O1n a grid that is not enabled cannot be selected', a, format('SELECT public.comp_select_calculator_grid(%L, %L)', s2, s1), 'PT404');
  PERFORM comp_test.op_refused('O1o a stale expected selection is refused', a, format('SELECT public.comp_select_calculator_grid(NULL, %L)', s2), 'PT409');
  v := comp_test.op_ok('O1p re-select the same grid', a, format('SELECT public.comp_select_calculator_grid(%L, %L)', s1, s1));
  PERFORM comp_test.check('O1q an unchanged selection is a no-op', v @> '{"changed": false}');
  v := comp_test.op_ok('O1r clear the selection', a, format('SELECT public.comp_select_calculator_grid(NULL, %L)', s1));
  PERFORM comp_test.check('O1s cleared: agents see "not configured"', v @> '{"changed": true, "calculator_grid_id": null}'
    AND comp_test.op_ok('O1s status', agent, 'SELECT public.get_commission_calculator_status()') = '{"status": "not_configured"}');
  v := comp_test.op_ok('O1t select S1 again', a, format('SELECT public.comp_select_calculator_grid(%L, NULL)', s1));
  PERFORM comp_test.check('O1u ready again', comp_test.op_ok('O1u status', agent, 'SELECT public.get_commission_calculator_status()')
    @> jsonb_build_object('status', 'ready', 'grid_id', s1));

  v := comp_test.op_ok('O1v disable the selected grid', a, format('SELECT public.comp_disable_shared_grid(%L)', s1));
  PERFORM comp_test.check('O1w disabling the selected grid clears it and selects nothing else',
    v @> '{"disabled": true, "cleared_selection": true}'
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = org_a) IS NULL);
  v := comp_test.op_ok('O1x re-enable S1', a, format('SELECT public.comp_enable_shared_grid(%L)', s1));
  PERFORM comp_test.check('O1y re-enabling selects it again only because nothing is selected', v @> '{"selected": true}');
  PERFORM comp_test.check('O1z every write stamped the acting admin',
    (SELECT updated_by FROM public.organization_comp_settings WHERE organization_id = org_a) = a
    AND (SELECT enabled_by FROM public.organization_comp_grids WHERE organization_id = org_a AND grid_id = s1) = a);
  RAISE NOTICE 'O1 enable / disable / select: ok';
END $$;

-- O2. Private grids: blank / structure copy / full copy; exact copies with new identities; atomic.
DO $$
DECLARE v jsonb; a uuid := comp_test.p('admin_a');
  org_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  s1 constant uuid := '51000000-0000-0000-0000-000000000001';
  s2 constant uuid := '52000000-0000-0000-0000-000000000001';
  c_default constant integer[] := ARRAY[145,140,135,130,125,120,115,110,105,100,95,90,85,80,75,70,65];
  g_blank uuid; g_struct uuid; g_full uuid; v_rows bigint;
BEGIN
  PERFORM comp_test.op_refused('O2a unknown mode', a, $q$SELECT public.comp_create_private_grid('clone', 'x', '2025-01-01')$q$, '22023');
  PERFORM comp_test.op_refused('O2b a blank grid takes no source', a, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'blank', 'x', '2025-01-01', s1), '22023');
  PERFORM comp_test.op_refused('O2c a copy needs a source', a, $q$SELECT public.comp_create_private_grid('full', 'x', '2025-01-01')$q$, '22023');
  PERFORM comp_test.op_refused('O2d an effective date is required', a, $q$SELECT public.comp_create_private_grid('blank', 'x', NULL)$q$, '22023');
  PERFORM comp_test.op_refused('O2e blank name', a, $q$SELECT public.comp_create_private_grid('blank', '   ', '2025-01-01')$q$, '23514');
  PERFORM comp_test.op_refused('O2f name too long', a, format('SELECT public.comp_create_private_grid(%L, %L, %L)', 'blank', repeat('x', 121), '2025-01-01'), '23514');
  PERFORM comp_test.op_refused('O2g untrimmed name is refused, not repaired', a, $q$SELECT public.comp_create_private_grid('blank', ' Padded ', '2025-01-01')$q$, '23514');

  v := comp_test.op_ok('O2h blank grid', a, $q$SELECT public.comp_create_private_grid('blank', 'Blank one', '2025-03-01')$q$);
  g_blank := (v->>'grid_id')::uuid;
  PERFORM comp_test.check('O2i blank grid: default levels 145..65, no content, revision 1, own agency, stamped',
    v @> '{"products": 0, "variants": 0, "rates": 0, "references": 0}'
    AND (SELECT contract_levels = c_default AND origin = 'blank' AND copied_from_grid_id IS NULL AND revision = 1
                AND is_active AND organization_id = org_a AND updated_by = a
           FROM public.comp_grids WHERE id = g_blank)
    AND comp_test.content(g_blank) = '{}');

  PERFORM comp_test.op_refused('O2j a private grid is never a copy source', a, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'full', 'x', '2025-01-01', g_blank), 'PT404');
  PERFORM comp_test.op_refused('O2k a shared grid the agency has not enabled', a, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'structure', 'x', '2025-01-01', s2), 'PT404');

  v := comp_test.op_ok('O2l structure copy of S1', a, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'structure', 'Structure one', '2025-04-01', s1));
  g_struct := (v->>'grid_id')::uuid;
  PERFORM comp_test.check('O2m structure copy: default levels, structure only, zero rate rows, provenance',
    v @> '{"products": 3, "variants": 5, "rates": 0, "references": 0}'
    AND (SELECT contract_levels = c_default AND origin = 'structure_copy' AND copied_from_grid_id = s1
           FROM public.comp_grids WHERE id = g_struct)
    AND comp_test.content(g_struct, 'RN') = '{}');
  PERFORM comp_test.check('O2n structure copy: identical products, ages, terms and labels (inactive kept inactive)',
    comp_test.content(g_struct, 'PV') = comp_test.content(s1, 'PV'));
  PERFORM comp_test.check('O2o structure copy: every row has a new identity',
    NOT EXISTS (SELECT 1 FROM public.comp_products WHERE grid_id = g_struct AND id IN (SELECT id FROM public.comp_products WHERE grid_id = s1))
    AND NOT EXISTS (SELECT 1 FROM public.comp_product_variants WHERE grid_id = g_struct AND id IN (SELECT id FROM public.comp_product_variants WHERE grid_id = s1)));

  v := comp_test.op_ok('O2p full copy of S1', a, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'full', 'Full one', '2025-05-01', s1));
  g_full := (v->>'grid_id')::uuid;
  PERFORM comp_test.check('O2q full copy: counts', v @> '{"products": 3, "variants": 5, "rates": 7, "references": 1}');
  PERFORM comp_test.check('O2r full copy: same levels, structure, every rate (explicit zero included) and references',
    (SELECT contract_levels FROM public.comp_grids WHERE id = g_full) = (SELECT contract_levels FROM public.comp_grids WHERE id = s1)
    AND comp_test.content(g_full) = comp_test.content(s1)
    AND 'R|whole_life|Carrier North|Final Plan|71+|100|0' = ANY (comp_test.content(g_full, 'R')));
  PERFORM comp_test.check('O2s full copy: new identities, provenance recorded',
    NOT EXISTS (SELECT 1 FROM public.comp_rates WHERE grid_id = g_full AND id IN (SELECT id FROM public.comp_rates WHERE grid_id = s1))
    AND (SELECT origin = 'full_copy' AND copied_from_grid_id = s1 FROM public.comp_grids WHERE id = g_full));

  SELECT (SELECT count(*) FROM public.comp_grids) + (SELECT count(*) FROM public.comp_products)
       + (SELECT count(*) FROM public.comp_product_variants) + (SELECT count(*) FROM public.comp_rates)
       + (SELECT count(*) FROM public.comp_variant_references) INTO v_rows;
  PERFORM comp_test.op_refused('O2t a failure in the last copy step', a, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'full', 'Inject failure', '2025-05-01', s1), 'P0001', 'injected failure');
  PERFORM comp_test.op_refused('O2u a copy that does not match its source is refused', a, format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'full', 'Inject skip', '2025-05-01', s1), 'XX000', 'The copy did not match its source%');
  PERFORM comp_test.check('O2v nothing of either failed copy remains',
    comp_test.gid('Inject failure') IS NULL AND comp_test.gid('Inject skip') IS NULL
    AND v_rows = (SELECT (SELECT count(*) FROM public.comp_grids) + (SELECT count(*) FROM public.comp_products)
                       + (SELECT count(*) FROM public.comp_product_variants) + (SELECT count(*) FROM public.comp_rates)
                       + (SELECT count(*) FROM public.comp_variant_references)));
  RAISE NOTICE 'O2 private grid creation: ok';
END $$;

DROP TRIGGER zz_inject_failure ON public.comp_variant_references;
DROP TRIGGER zz_inject_skip ON public.comp_rates;
DROP FUNCTION comp_test.inject_failure();

-- O3. The atomic changeset on a private grid ("Full one", a full copy of S1).
DO $$
DECLARE v jsonb; a uuid := comp_test.p('admin_a'); a2 uuid := comp_test.p('admin_a2');
  g uuid := comp_test.gid('Full one'); s1_before text[] := comp_test.content('51000000-0000-0000-0000-000000000001');
  rev bigint; rev2 bigint; before text[];
  v_term uuid; v_term20 uuid; v_wl uuid; v_wl71 uuid; p_term uuid; p_iul uuid; p_new uuid;
  c_levels jsonb := '[130, 120, 110, 100, 90, 80]';
BEGIN
  rev := comp_test.rev(g);
  v_term := comp_test.vid(g, 'Level Term', '10-15 yr'); v_term20 := comp_test.vid(g, 'Level Term', '20 yr');
  v_wl := comp_test.vid(g, 'Final Plan', '0-70');       v_wl71 := comp_test.vid(g, 'Final Plan', '71+');
  p_term := comp_test.pid(g, 'Level Term');             p_iul := comp_test.pid(g, 'Index Plan');
  before := comp_test.content(g);

  -- Request validation: refused before anything is written.
  PERFORM comp_test.save_refused('O3a unknown field', a, g, rev, '{"rows": []}', '22023');
  PERFORM comp_test.save_refused('O3b a list that is not an array', a, g, rev, '{"rates": {}}', '22023');
  PERFORM comp_test.save_refused('O3c both an id and a key', a, g, rev, jsonb_build_object('products', jsonb_build_array(
    jsonb_build_object('id', p_term, 'key', 'k', 'category', 'term', 'carrier', 'X', 'product_name', 'Y'))), '22023');
  PERFORM comp_test.save_refused('O3d duplicate keys', a, g, rev,
    '{"products": [{"key": "k", "category": "term", "carrier": "X", "product_name": "Y"}, {"key": "k", "category": "term", "carrier": "X", "product_name": "Z"}]}', '22023');
  PERFORM comp_test.save_refused('O3e a rate without a value field', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100))), '22023');
  PERFORM comp_test.save_refused('O3f a rate value of the wrong type', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', true))), '22023');
  PERFORM comp_test.save_refused('O3g a blank for a cell of a new variant', a, g, rev,
    '{"variants": [{"key": "v", "product_key": "p", "label": "x"}], "products": [{"key": "p", "category": "term", "carrier": "X", "product_name": "Y"}], "rates": [{"variant_key": "v", "contract_level": 100, "rate_percent": null}]}', '22023');
  PERFORM comp_test.save_refused('O3h a rate naming a key that is not in the change set', a, g, rev,
    '{"rates": [{"variant_key": "nope", "contract_level": 100, "rate_percent": "1"}]}', '22023', 'A change refers to a new item%');
  PERFORM comp_test.save_refused('O3i a variant naming a product key that is not in the change set', a, g, rev,
    '{"variants": [{"key": "v", "product_key": "nope", "label": "x"}]}', '22023', 'A change refers to a new item%');
  PERFORM comp_test.save_refused('O3j incomplete grid details', a, g, rev, '{"grid": {"name": "X"}}', '22023');
  PERFORM comp_test.save_refused('O3k an active flag that is not boolean', a, g, rev, jsonb_build_object('grid', jsonb_build_object(
    'name', 'Full one', 'effective_date', '2025-05-01', 'is_active', 'true', 'contract_levels', c_levels)), '22023');
  PERFORM comp_test.save_refused('O3l no change set', a, g, rev, 'null', '22023');
  PERFORM comp_test.check('O3m refused requests saved nothing', comp_test.rev(g) = rev AND comp_test.content(g) = before);

  -- Two admins: the second save against the first one's revision is refused as stale.
  v := comp_test.save('O3n admin 2 changes the effective date', a2, g, rev, jsonb_build_object('grid', jsonb_build_object(
    'name', 'Full one', 'effective_date', '2025-05-02', 'is_active', true, 'contract_levels', c_levels)));
  rev2 := (v->>'revision')::bigint;
  PERFORM comp_test.check('O3o the revision advanced, is returned, and the editor is stamped',
    rev2 = rev + 1 AND rev2 = comp_test.rev(g)
    AND (SELECT updated_by = a2 AND effective_date = '2025-05-02' FROM public.comp_grids WHERE id = g));
  PERFORM comp_test.save_refused('O3p a save at the old revision is stale', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', '71'))), 'PT409');
  rev := rev2;

  -- Values: exact decimal text, an explicit zero, a blank (deletes that cell).
  v := comp_test.save('O3q set values', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
         jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', '71.25'),
         jsonb_build_object('variant_id', v_term, 'contract_level', 90, 'rate_percent', '0'),
         jsonb_build_object('variant_id', v_wl, 'contract_level', 120, 'rate_percent', null))));
  rev := (v->>'revision')::bigint;
  PERFORM comp_test.check('O3r stored exactly; zero kept as a value; blank cell removed',
    comp_test.rate(v_term, 100) = '71.25' AND comp_test.rate(v_term, 90) = '0' AND comp_test.rate(v_wl, 120) IS NULL);
  PERFORM comp_test.save_refused('O3s three decimals are refused, never rounded', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', '87.555'))), '23514');
  PERFORM comp_test.save_refused('O3t a binary-float artefact is refused', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', 0.30000000000000004))), '23514');
  PERFORM comp_test.save_refused('O3u above 300', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', '300.01'))), '23514');
  PERFORM comp_test.save_refused('O3v negative', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', '-1'))), '23514');
  PERFORM comp_test.save_refused('O3w not a number', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 100, 'rate_percent', '7O'))), '22P02');
  PERFORM comp_test.save_refused('O3x a level that is not on the grid', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', v_term, 'contract_level', 115, 'rate_percent', '1'))), '23514', 'Contract level 115%');
  PERFORM comp_test.save_refused('O3y a cell of another grid''s variant', a, g, rev, jsonb_build_object('rates', jsonb_build_array(
    jsonb_build_object('variant_id', '51000000-0000-0000-0000-000000000201', 'contract_level', 100, 'rate_percent', '1'))), 'PT409');
  PERFORM comp_test.check('O3z refused values changed nothing', comp_test.rev(g) = rev AND comp_test.rate(v_term, 100) = '71.25'
    AND comp_test.content('51000000-0000-0000-0000-000000000001') = s1_before);
  RAISE NOTICE 'O3 changeset validation, staleness and exact values: ok';
END $$;

-- O4. Changeset structure: new items by key, updates, variant rules, references, deletions, levels.
DO $$
DECLARE v jsonb; a uuid := comp_test.p('admin_a');
  g uuid := comp_test.gid('Full one'); rev bigint; before text[];
  v_term uuid; v_term20 uuid; v_wl uuid; v_wl71 uuid; p_term uuid; p_iul uuid; p_new uuid;
BEGIN
  rev := comp_test.rev(g);
  v_term := comp_test.vid(g, 'Level Term', '10-15 yr'); v_term20 := comp_test.vid(g, 'Level Term', '20 yr');
  v_wl := comp_test.vid(g, 'Final Plan', '0-70');       v_wl71 := comp_test.vid(g, 'Final Plan', '71+');
  p_term := comp_test.pid(g, 'Level Term');             p_iul := comp_test.pid(g, 'Index Plan');

  v := comp_test.save('O4a a new product, two variants, rates and a reference in one save', a, g, rev,
    '{"products": [{"key": "p1", "category": "term", "carrier": "Carrier Synthetic", "product_name": "New Term", "is_active": true}],
      "variants": [{"key": "v1", "product_key": "p1", "label": "10 yr", "min_age": 18, "max_age": 65, "term_years": [10],
                    "reference": {"source": "Synthetic sheet", "notes": "Synthetic note"}},
                   {"key": "v2", "product_key": "p1", "label": "20 yr", "min_age": 18, "max_age": 55, "term_years": [20]}],
      "rates": [{"variant_key": "v1", "contract_level": 100, "rate_percent": "60"},
                {"variant_key": "v2", "contract_level": 100, "rate_percent": "55.5"}]}');
  rev := (v->>'revision')::bigint;
  p_new := comp_test.pid(g, 'New Term');
  PERFORM comp_test.check('O4b new rows exist with server ids and exact values',
    p_new IS NOT NULL
    AND comp_test.content(g) @> ARRAY['P|term|Carrier Synthetic|New Term|t',
                                      'V|term|Carrier Synthetic|New Term|10 yr|18|65|{10}',
                                      'R|term|Carrier Synthetic|New Term|10 yr|100|60',
                                      'R|term|Carrier Synthetic|New Term|20 yr|100|55.5',
                                      'N|term|Carrier Synthetic|New Term|10 yr|Synthetic sheet|Synthetic note']
    AND (SELECT updated_by FROM public.comp_rates WHERE variant_id = comp_test.vid(g, 'New Term', '10 yr')) = a);

  v := comp_test.save('O4c update a product by id (rename, deactivate)', a, g, rev, jsonb_build_object('products', jsonb_build_array(
    jsonb_build_object('id', p_new, 'category', 'term', 'carrier', 'Carrier Synthetic', 'product_name', 'New Term Plus', 'is_active', false))));
  rev := (v->>'revision')::bigint;
  PERFORM comp_test.check('O4d product updated in place', comp_test.pid(g, 'New Term Plus') = p_new
    AND NOT (SELECT is_active FROM public.comp_products WHERE id = p_new));
  PERFORM comp_test.save_refused('O4e a product id from another grid is stale', a, g, rev, jsonb_build_object('products', jsonb_build_array(
    jsonb_build_object('id', '51000000-0000-0000-0000-000000000101', 'category', 'term', 'carrier', 'X', 'product_name', 'Y'))), 'PT409');
  PERFORM comp_test.save_refused('O4f a duplicate product', a, g, rev,
    '{"products": [{"key": "d", "category": "term", "carrier": "Carrier North", "product_name": "Level Term"}]}', '23505');

  -- Variant rules (deferred trigger, forced at the end of the save).
  PERFORM comp_test.save_refused('O4g overlapping age and term', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('key', 'x', 'product_id', p_term, 'label', 'dup', 'min_age', 30, 'max_age', 40, 'term_years', '[10]'::jsonb))), '23P01');
  PERFORM comp_test.save_refused('O4h mixing term and non-term variants', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('key', 'x', 'product_id', p_term, 'label', 'no term', 'min_age', 71, 'max_age', 80))), '23514', '%mix variants%');
  PERFORM comp_test.save_refused('O4i a blank label on a product with several variants', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('id', v_term, 'label', '', 'min_age', 18, 'max_age', 70, 'term_years', '[10, 15]'::jsonb))), '23514', '%label blank%');
  PERFORM comp_test.save_refused('O4j the same term twice', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('key', 'x', 'product_id', p_term, 'label', 'twice', 'min_age', 71, 'max_age', 80, 'term_years', '[25, 25]'::jsonb))), '23514', '%same term length twice%');
  PERFORM comp_test.save_refused('O4k ages out of order', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('key', 'x', 'product_id', p_term, 'label', 'order', 'min_age', 50, 'max_age', 40, 'term_years', '[30]'::jsonb))), '23514');
  PERFORM comp_test.save_refused('O4l a variant under another grid''s product', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('key', 'x', 'product_id', '51000000-0000-0000-0000-000000000101', 'label', 'foreign', 'min_age', 71, 'max_age', 80, 'term_years', '[30]'::jsonb))), '23503');
  PERFORM comp_test.save_refused('O4m a variant id from another grid is stale', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('id', '51000000-0000-0000-0000-000000000201', 'label', 'x', 'min_age', 18, 'max_age', 70, 'term_years', '[10, 15]'::jsonb))), 'PT409');

  -- Protected references: set (empty notes stored as absent), replace, remove.
  v := comp_test.save('O4n set a reference on an existing variant', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('id', v_wl71, 'label', '71+', 'min_age', 71, 'max_age', NULL, 'term_years', NULL,
                       'reference', jsonb_build_object('source', 'Synthetic page 2', 'notes', '')))));
  rev := (v->>'revision')::bigint;
  PERFORM comp_test.check('O4o reference stored, the empty note as absent',
    (SELECT source = 'Synthetic page 2' AND notes IS NULL FROM public.comp_variant_references WHERE variant_id = v_wl71));
  v := comp_test.save('O4p replace and remove references', a, g, rev, jsonb_build_object('variants', jsonb_build_array(
    jsonb_build_object('id', v_wl71, 'label', '71+', 'min_age', 71, 'max_age', NULL, 'term_years', NULL, 'reference', NULL),
    jsonb_build_object('id', v_wl, 'label', '0-70', 'min_age', NULL, 'max_age', 70, 'term_years', NULL,
                       'reference', jsonb_build_object('source', 'Synthetic page 3', 'notes', 'Synthetic note 3')))));
  rev := (v->>'revision')::bigint;
  PERFORM comp_test.check('O4q one reference removed, the other replaced',
    NOT EXISTS (SELECT 1 FROM public.comp_variant_references WHERE variant_id = v_wl71)
    AND (SELECT source = 'Synthetic page 3' AND notes = 'Synthetic note 3' FROM public.comp_variant_references WHERE variant_id = v_wl));

  -- Deletions cascade; an id that is not in this grid means the admin's view is stale.
  PERFORM comp_test.save_refused('O4r deleting a variant of another grid', a, g, rev,
    '{"delete_variant_ids": ["51000000-0000-0000-0000-000000000202"]}', 'PT409');
  v := comp_test.save('O4s delete a variant and a product', a, g, rev, jsonb_build_object(
    'delete_variant_ids', jsonb_build_array(v_term20, v_term20), 'delete_product_ids', jsonb_build_array(p_iul)));
  rev := (v->>'revision')::bigint;
  PERFORM comp_test.check('O4t deleted with their rates and variants',
    comp_test.vid(g, 'Level Term', '20 yr') IS NULL AND comp_test.pid(g, 'Index Plan') IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.comp_rates WHERE variant_id IN (v_term20))
    AND NOT EXISTS (SELECT 1 FROM public.comp_product_variants WHERE product_id = p_iul));
  PERFORM comp_test.save_refused('O4u deleting it again is stale', a, g, rev, jsonb_build_object('delete_variant_ids', jsonb_build_array(v_term20)), 'PT409');

  -- Contract levels: never removed while rates remain; removal with its blanks in one save; a new level
  -- can take rates in the same save.
  PERFORM comp_test.save_refused('O4v removing a level that still has rates', a, g, rev, jsonb_build_object('grid', jsonb_build_object(
    'name', 'Full one', 'effective_date', '2025-05-02', 'is_active', true, 'contract_levels', '[120, 110, 100, 90, 80]'::jsonb)), '23514', 'Remove the rates%');
  v := comp_test.save('O4w remove level 130 together with its rate', a, g, rev, jsonb_build_object(
    'grid', jsonb_build_object('name', 'Full one', 'effective_date', '2025-05-02', 'is_active', true, 'contract_levels', '[120, 110, 100, 90, 80]'::jsonb),
    'rates', jsonb_build_array(jsonb_build_object('variant_id', v_term, 'contract_level', 130, 'rate_percent', NULL))));
  rev := (v->>'revision')::bigint;
  v := comp_test.save('O4x add level 125 and a rate there in one save', a, g, rev, jsonb_build_object(
    'grid', jsonb_build_object('name', 'Full one', 'effective_date', '2025-05-02', 'is_active', true, 'contract_levels', '[125, 120, 110, 100, 90, 80]'::jsonb),
    'rates', jsonb_build_array(jsonb_build_object('variant_id', v_term, 'contract_level', 125, 'rate_percent', '88'))));
  rev := (v->>'revision')::bigint;
  PERFORM comp_test.check('O4y levels and rates updated together',
    (SELECT contract_levels FROM public.comp_grids WHERE id = g) = ARRAY[125,120,110,100,90,80]
    AND comp_test.rate(v_term, 130) IS NULL AND comp_test.rate(v_term, 125) = '88');
  PERFORM comp_test.save_refused('O4z levels must be listed highest first', a, g, rev, jsonb_build_object('grid', jsonb_build_object(
    'name', 'Full one', 'effective_date', '2025-05-02', 'is_active', true, 'contract_levels', '[110, 125, 120, 100, 90, 80]'::jsonb)), '23514');
  PERFORM comp_test.save_refused('O4z2 a grid needs at least one level', a, g, rev, jsonb_build_object('grid', jsonb_build_object(
    'name', 'Full one', 'effective_date', '2025-05-02', 'is_active', true, 'contract_levels', '[]'::jsonb)), '23514');
  RAISE NOTICE 'O4 changeset structure, references, deletions and levels: ok';
END $$;

-- O5. Calculator context for a private grid; deactivation clears the selection.
DO $$
DECLARE v jsonb; a uuid := comp_test.p('admin_a'); agent uuid := comp_test.p('agent_a');
  org_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  s1 constant uuid := '51000000-0000-0000-0000-000000000001';
  g uuid := comp_test.gid('Full one'); rev bigint;
BEGIN
  v := comp_test.op_ok('O5a select the private grid', a, format('SELECT public.comp_select_calculator_grid(%L, %L)', g, s1));
  v := comp_test.op_ok('O5b agent context', agent, 'SELECT public.get_commission_calculator_context()');
  PERFORM comp_test.check('O5c the context is the selected private grid: active products only, exact rates',
    v->>'status' = 'ready' AND v#>>'{grid,id}' = g::text AND v#>'{grid,contract_levels}' = '[125, 120, 110, 100, 90, 80]'
    AND v#>>'{grid,name}' = 'Full one' AND v#>>'{grid,effective_date}' = '2025-05-02'
    AND (v#>>'{grid,revision}')::bigint = comp_test.rev(g)
    AND jsonb_array_length(v->'products') = 2 AND jsonb_array_length(v->'variants') = 3
    AND jsonb_array_length(v->'rates') = 5
    AND v->'rates' @> jsonb_build_array(jsonb_build_object('variant_id', comp_test.vid(g, 'Level Term', '10-15 yr'), 'contract_level', 100, 'rate_percent', '71.25'))
    AND v->'rates' @> jsonb_build_array(jsonb_build_object('variant_id', comp_test.vid(g, 'Final Plan', '71+'), 'contract_level', 100, 'rate_percent', '0'))
    AND position('New Term' IN v::text) = 0 AND NOT (v ? 'references') AND position('Synthetic page' IN v::text) = 0);
  PERFORM comp_test.check('O5d each caller gets their own raw contract level',
    comp_test.op_ok('O5d1', a, 'SELECT public.get_commission_calculator_context()')->>'commission_level' = '120%'
    AND comp_test.op_ok('O5d2', comp_test.p('leader_a'), 'SELECT public.get_commission_calculator_context()')->>'commission_level' = '110');

  rev := comp_test.rev(g);
  v := comp_test.save('O5e deactivate the selected grid', a, g, rev, jsonb_build_object('grid', jsonb_build_object(
    'name', 'Full one', 'effective_date', '2025-05-02', 'is_active', false, 'contract_levels', '[125, 120, 110, 100, 90, 80]'::jsonb)));
  rev := (v->>'revision')::bigint;
  PERFORM comp_test.check('O5f deactivation cleared the selection; nothing else selected',
    (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = org_a) IS NULL
    AND comp_test.op_ok('O5f status', agent, 'SELECT public.get_commission_calculator_status()') = '{"status": "not_configured"}');
  PERFORM comp_test.op_refused('O5g an inactive grid cannot be selected', a, format('SELECT public.comp_select_calculator_grid(%L, NULL)', g), 'PT404');
  PERFORM comp_test.check('O5h agents cannot read the inactive grid; admins still can',
    comp_test.op_ok('O5h1', agent, format('SELECT to_jsonb(count(*)) FROM public.comp_grids WHERE id = %L', g)) = '0'
    AND comp_test.op_ok('O5h2', agent, format('SELECT to_jsonb(count(*)) FROM public.comp_rates WHERE grid_id = %L', g)) = '0'
    AND comp_test.op_ok('O5h3', a, format('SELECT to_jsonb(count(*)) FROM public.comp_grids WHERE id = %L', g)) = '1');
  v := comp_test.save('O5i reactivate', a, g, rev, jsonb_build_object('grid', jsonb_build_object(
    'name', 'Full one', 'effective_date', '2025-05-02', 'is_active', true, 'contract_levels', '[125, 120, 110, 100, 90, 80]'::jsonb)));
  v := comp_test.op_ok('O5j select it again', a, format('SELECT public.comp_select_calculator_grid(%L, NULL)', g));
  RAISE NOTICE 'O5 calculator context and deactivation: ok';
END $$;

-- O6. Admin overview and snapshot.
DO $$
DECLARE v jsonb; a uuid := comp_test.p('admin_a');
  s1 constant uuid := '51000000-0000-0000-0000-000000000001';
  g uuid := comp_test.gid('Full one');
BEGIN
  v := comp_test.op_ok('O6a overview', a, 'SELECT public.comp_get_admin_overview()');
  PERFORM comp_test.check('O6b overview: the selection, the enabled shared grid first, then own grids by name',
    v->>'calculator_grid_id' = g::text
    AND (SELECT array_agg(e->>'name' ORDER BY n) FROM jsonb_array_elements(v->'grids') WITH ORDINALITY AS t(e, n))
        = ARRAY['Synthetic Shared One', 'Blank one', 'Full one', 'Structure one']
    AND v->'grids' @> jsonb_build_array(jsonb_build_object('id', s1, 'shared', true, 'origin', 'agentflow_reference', 'product_count', 3))
    AND v->'grids' @> jsonb_build_array(jsonb_build_object('id', g, 'shared', false, 'origin', 'full_copy', 'product_count', 3,
                                                           'updated_by_name', 'Ada One')));
  v := comp_test.op_ok('O6c another agency''s overview', comp_test.p('admin_b'), 'SELECT public.comp_get_admin_overview()');
  PERFORM comp_test.check('O6d agency B sees none of A''s grids', v = '{"calculator_grid_id": null, "grids": []}');
  v := comp_test.op_ok('O6e snapshot of the shared grid', a, format('SELECT public.comp_get_grid_snapshot(%L)', s1));
  PERFORM comp_test.check('O6f shared snapshot: read-only, inactive products and references included',
    v#>'{grid,editable}' = 'false' AND v#>'{grid,shared}' = 'true'
    AND jsonb_array_length(v->'products') = 3 AND jsonb_array_length(v->'references') = 1);
  v := comp_test.op_ok('O6g snapshot of the private grid', a, format('SELECT public.comp_get_grid_snapshot(%L)', g));
  PERFORM comp_test.check('O6h private snapshot: editable, exact rate text, current revision',
    v#>'{grid,editable}' = 'true' AND (v#>>'{grid,revision}')::bigint = comp_test.rev(g)
    AND v->'rates' @> '[{"contract_level": 125, "rate_percent": "88"}]');
  RAISE NOTICE 'O6 overview and snapshot: ok';
END $$;

-- O7. Deletion.
DO $$
DECLARE v jsonb; a uuid := comp_test.p('admin_a');
  org_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  s1 constant uuid := '51000000-0000-0000-0000-000000000001';
  g uuid := comp_test.gid('Full one'); s1_content text[] := comp_test.content('51000000-0000-0000-0000-000000000001');
BEGIN
  PERFORM comp_test.op_refused('O7a deleting at a stale revision', a, format('SELECT public.comp_delete_private_grid(%L, %s)', g, comp_test.rev(g) - 1), 'PT409');
  PERFORM comp_test.op_refused('O7b a shared grid cannot be deleted by an agency', a, format('SELECT public.comp_delete_private_grid(%L, %s)', s1, comp_test.rev(s1)), 'PT404');
  v := comp_test.op_ok('O7c delete the selected private grid', a, format('SELECT public.comp_delete_private_grid(%L, %s)', g, comp_test.rev(g)));
  PERFORM comp_test.check('O7d deleted with all content; selection cleared; the shared source untouched',
    v @> '{"deleted": true, "cleared_selection": true}'
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = org_a) IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.comp_products WHERE grid_id = g)
    AND NOT EXISTS (SELECT 1 FROM public.comp_rates WHERE grid_id = g)
    AND NOT EXISTS (SELECT 1 FROM public.comp_variant_references WHERE grid_id = g)
    AND comp_test.content(s1) = s1_content);
  PERFORM comp_test.op_refused('O7e deleting it again', a, format('SELECT public.comp_delete_private_grid(%L, 1)', g), 'PT404');
  RAISE NOTICE 'O7 deletion: ok';
END $$;

SELECT 'commission_grids_operations: ALL PASSED' AS result;
