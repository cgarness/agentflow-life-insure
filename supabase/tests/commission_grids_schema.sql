-- =====================================================================================================
-- Commission grids — schema / integrity suite. LOCAL disposable database only (invariant #28).
-- Runs as the TABLE OWNER on purpose: RLS is bypassed, so every refusal below is proven to come from the
-- constraints and triggers alone, which therefore also bind privileged writers (import, migrations,
-- service_role). Client-role behaviour is in commission_grids_access.sql. Synthetic data only.
-- =====================================================================================================
\set ON_ERROR_STOP 1
DO $$ BEGIN PERFORM comp_test.seed_base(); END $$;

-- S1. Scope: the shared sentinel is reserved; child scope must equal parent scope (NULL case included).
DO $$ BEGIN
  PERFORM comp_test.owner_refused('S1a nil organization on a grid',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES ('00000000-0000-0000-0000-000000000000', 'x', '2025-01-01', ARRAY[100], 'blank')$q$, '23514', '%scope_reserved%');
  PERFORM comp_test.owner_refused('S1b nil organization on a product',
    $q$INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name)
       VALUES ('51000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'term', 'X', 'Y')$q$, '23514', '%scope_reserved%');
  PERFORM comp_test.owner_refused('S1c private product under a shared grid',
    $q$INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name)
       VALUES ('51000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'term', 'X', 'Y')$q$, '23503');
  PERFORM comp_test.owner_ok('S1d private grid for agency A',
    $q$INSERT INTO public.comp_grids (id, organization_id, name, effective_date, contract_levels, origin)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A private', '2025-01-01', ARRAY[120,100,80], 'blank')$q$);
  PERFORM comp_test.owner_refused('S1e shared (NULL) product under a private grid',
    $q$INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name)
       VALUES ('a1000000-0000-0000-0000-000000000001', NULL, 'term', 'X', 'Y')$q$, '23503');
  PERFORM comp_test.owner_refused('S1f product of agency B under agency A grid',
    $q$INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'term', 'X', 'Y')$q$, '23503');
  PERFORM comp_test.owner_ok('S1g product of agency A under its own grid',
    $q$INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name)
       VALUES ('a1000000-0000-0000-0000-000000000101', 'a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'term', 'Carrier P', 'Product P')$q$);
  PERFORM comp_test.owner_refused('S1h variant linking a product of another grid (cross-grid link)',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label)
       VALUES ('a1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x')$q$, '23503');
  PERFORM comp_test.owner_refused('S1i rate linking a variant of another grid',
    $q$INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
       VALUES ('a1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000201', 'aaaaaaaa-0000-0000-0000-00000000000a', 80, 10)$q$, '23503');
  PERFORM comp_test.owner_refused('S1j reference under a mismatched scope',
    $q$INSERT INTO public.comp_variant_references (variant_id, grid_id, organization_id, notes)
       VALUES ('51000000-0000-0000-0000-000000000201', '51000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'n')$q$, '23503');
  PERFORM comp_test.owner_refused('S1k scope_key is not writable',
    $q$UPDATE public.comp_grids SET scope_key = '00000000-0000-0000-0000-000000000000' WHERE id = 'a1000000-0000-0000-0000-000000000001'$q$, '428C9');
  PERFORM comp_test.owner_refused('S1l access row may not name a private grid',
    $q$INSERT INTO public.organization_comp_grids (organization_id, grid_id)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001')$q$, 'PT404');
  PERFORM comp_test.owner_refused('S1m shared grid must be agentflow_reference',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES (NULL, 'x', '2025-01-01', ARRAY[100], 'blank')$q$, '23514', '%origin_scope%');
  PERFORM comp_test.owner_refused('S1n private grid may not claim agentflow_reference',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', '2025-01-01', ARRAY[100], 'agentflow_reference')$q$, '23514', '%origin_scope%');
  RAISE NOTICE 'S1 scope integrity: ok';
END $$;

-- S2. Contract levels.
DO $$ BEGIN
  PERFORM comp_test.owner_refused('S2a ascending levels',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', '2025-01-01', ARRAY[80,100], 'blank')$q$, '23514', '%highest first%');
  PERFORM comp_test.owner_refused('S2b duplicate levels',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', '2025-01-01', ARRAY[100,100], 'blank')$q$, '23514', '%highest first%');
  PERFORM comp_test.owner_refused('S2c empty levels',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', '2025-01-01', '{}', 'blank')$q$, '23514', '%levels_valid%');
  PERFORM comp_test.owner_refused('S2d zero level',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', '2025-01-01', ARRAY[100,0], 'blank')$q$, '23514', '%levels_valid%');
  PERFORM comp_test.owner_refused('S2e NULL level',
    $q$INSERT INTO public.comp_grids (organization_id, name, effective_date, contract_levels, origin)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'x', '2025-01-01', ARRAY[100,NULL], 'blank')$q$, '23514', '%levels_valid%');
  PERFORM comp_test.owner_refused('S2f rate at a level not on the grid',
    $q$INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
       VALUES ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000202', NULL, 115, 10)$q$, '23514', '%not on this grid%');
  PERFORM comp_test.owner_refused('S2g removing a level that still has rates',
    $q$UPDATE public.comp_grids SET contract_levels = ARRAY[130,120,110,90,80] WHERE id = '51000000-0000-0000-0000-000000000001'$q$, '23514', '%Remove the rates%');
  PERFORM comp_test.owner_ok('S2h adding a level',
    $q$UPDATE public.comp_grids SET contract_levels = ARRAY[130,120,110,105,100,90,80] WHERE id = '51000000-0000-0000-0000-000000000001'$q$);
  PERFORM comp_test.owner_ok('S2i removing a level without rates',
    $q$UPDATE public.comp_grids SET contract_levels = ARRAY[130,120,110,100,90,80] WHERE id = '51000000-0000-0000-0000-000000000001'$q$);
  RAISE NOTICE 'S2 contract levels: ok';
END $$;

-- S3. Rate precision and range: rejected, never rounded.
DO $$
DECLARE v text;
BEGIN
  PERFORM comp_test.owner_refused('S3a 87.555', $q$UPDATE public.comp_rates SET rate_percent = 87.555 WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$, '23514', '%rate_valid%');
  PERFORM comp_test.owner_refused('S3b 0.1+0.2 float artefact', $q$UPDATE public.comp_rates SET rate_percent = 0.30000000000000004 WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$, '23514', '%rate_valid%');
  PERFORM comp_test.owner_refused('S3c 300.01', $q$UPDATE public.comp_rates SET rate_percent = 300.01 WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$, '23514', '%rate_valid%');
  PERFORM comp_test.owner_refused('S3d negative', $q$UPDATE public.comp_rates SET rate_percent = -0.01 WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$, '23514', '%rate_valid%');
  PERFORM comp_test.owner_refused('S3e NaN', $q$UPDATE public.comp_rates SET rate_percent = 'NaN' WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$, '23514', '%rate_valid%');
  PERFORM comp_test.owner_refused('S3f Infinity', $q$UPDATE public.comp_rates SET rate_percent = 'Infinity' WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$, '23514', '%rate_valid%');
  PERFORM comp_test.owner_ok('S3g 300 and two decimals', $q$UPDATE public.comp_rates SET rate_percent = 300.00 WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$);
  SELECT rate_percent::text INTO v FROM public.comp_rates WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100;
  PERFORM comp_test.check('S3h stored exactly as written (300.00)', v = '300.00');
  PERFORM comp_test.owner_ok('S3i 87.5', $q$UPDATE public.comp_rates SET rate_percent = '87.5' WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$);
  SELECT rate_percent::text INTO v FROM public.comp_rates WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100;
  PERFORM comp_test.check('S3j stored exactly as written (87.5)', v = '87.5');
  PERFORM comp_test.check('S3k explicit zero is a stored row',
    EXISTS (SELECT 1 FROM public.comp_rates WHERE variant_id = '51000000-0000-0000-0000-000000000204' AND contract_level = 100 AND rate_percent = 0));
  PERFORM comp_test.owner_refused('S3l one rate per variant and level',
    $q$INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
       VALUES ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000204', NULL, 100, 1)$q$, '23505');
  RAISE NOTICE 'S3 rate precision and range: ok';
END $$;

-- S4. Variants: ages, terms, overlaps, mixed definitions, blank labels.
DO $$ BEGIN
  PERFORM comp_test.owner_refused('S4a min > max',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x', 60, 50)$q$, '23514', '%age_order%');
  PERFORM comp_test.owner_refused('S4b age above 100',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, max_age)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x', 101)$q$, '23514');
  PERFORM comp_test.owner_refused('S4c empty term list is not a catch-all',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x', '{}')$q$, '23514', '%terms_valid%');
  PERFORM comp_test.owner_refused('S4d zero term length',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x', ARRAY[0])$q$, '23514', '%terms_valid%');
  PERFORM comp_test.owner_refused('S4e duplicate term length in one variant',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x', ARRAY[10,10])$q$, '23514', '%same term length twice%');
  PERFORM comp_test.owner_ok('S4f term variant 18-50 (10,15)',
    $q$INSERT INTO public.comp_product_variants (id, grid_id, product_id, organization_id, label, min_age, max_age, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000201', 'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'a', 18, 50, ARRAY[10,15])$q$);
  PERFORM comp_test.owner_refused('S4g overlapping ages AND a shared term',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'b', 50, 60, ARRAY[15,20])$q$, '23P01');
  PERFORM comp_test.owner_ok('S4h overlapping ages, disjoint terms',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'c', 40, 60, ARRAY[20])$q$);
  PERFORM comp_test.owner_ok('S4i shared term, adjacent ages (inclusive bounds do not touch)',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'd', 51, 60, ARRAY[10])$q$);
  PERFORM comp_test.owner_refused('S4j inclusive boundary touch (50 in both)',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'e', 0, 18, ARRAY[15])$q$, '23P01');
  PERFORM comp_test.owner_refused('S4k mixed term and non-term variants',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'f', 90, 95)$q$, '23514', '%cannot mix%');
  PERFORM comp_test.owner_refused('S4l unbounded ages overlap everything (both non-term)',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label)
       VALUES ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000102', NULL, 'all ages')$q$, '23P01');
  PERFORM comp_test.owner_refused('S4m blank label alongside another variant',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age)
       VALUES ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000103', NULL, 'second', 81, 90)$q$, '23514', '%blank%');
  PERFORM comp_test.owner_refused('S4n duplicate label within a product',
    $q$INSERT INTO public.comp_product_variants (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
       VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'a', 70, 80, ARRAY[30])$q$, '23505');
  RAISE NOTICE 'S4 variant rules: ok';
END $$;

-- S5. Immutable identity; server-assigned stamps; revision.
DO $$
DECLARE r1 bigint; r2 bigint; v_by uuid; v_created timestamptz;
BEGIN
  PERFORM comp_test.owner_refused('S5a grid organization is fixed',
    $q$UPDATE public.comp_grids SET organization_id = 'bbbbbbbb-0000-0000-0000-00000000000b' WHERE id = 'a1000000-0000-0000-0000-000000000001'$q$, '42501', '%fixed%');
  PERFORM comp_test.owner_refused('S5b private-to-shared conversion is impossible',
    $q$UPDATE public.comp_grids SET organization_id = NULL WHERE id = 'a1000000-0000-0000-0000-000000000001'$q$, '42501', '%fixed%');
  PERFORM comp_test.owner_refused('S5c origin is fixed',
    $q$UPDATE public.comp_grids SET origin = 'full_copy' WHERE id = 'a1000000-0000-0000-0000-000000000001'$q$, '42501', '%fixed%');
  PERFORM comp_test.owner_refused('S5d product grid is fixed',
    $q$UPDATE public.comp_products SET grid_id = '51000000-0000-0000-0000-000000000001' WHERE id = 'a1000000-0000-0000-0000-000000000101'$q$, '42501', '%fixed%');
  PERFORM comp_test.owner_refused('S5e rate level is fixed',
    $q$UPDATE public.comp_rates SET contract_level = 120 WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100$q$, '42501', '%fixed%');
  PERFORM comp_test.owner_refused('S5f copied_from cannot be repointed',
    $q$UPDATE public.comp_grids SET copied_from_grid_id = '52000000-0000-0000-0000-000000000001' WHERE id = 'a1000000-0000-0000-0000-000000000001'$q$, '42501');
  PERFORM comp_test.owner_ok('S5g0 enable a shared grid for agency B',
    $q$INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', '52000000-0000-0000-0000-000000000001')$q$);
  PERFORM comp_test.owner_refused('S5g access rows are not updatable',
    $q$UPDATE public.organization_comp_grids SET enabled_at = now() - interval '1 day' WHERE organization_id = 'bbbbbbbb-0000-0000-0000-00000000000b'$q$, '42501');

  SELECT revision INTO r1 FROM public.comp_grids WHERE id = '51000000-0000-0000-0000-000000000001';
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-0000000000ad"}', true);
  UPDATE public.comp_rates SET rate_percent = 60 WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100;
  SELECT revision, updated_by INTO r2, v_by FROM public.comp_grids WHERE id = '51000000-0000-0000-0000-000000000001';
  PERFORM comp_test.check('S5h a child change bumps the parent revision', r2 = r1 + 1);
  PERFORM comp_test.check('S5i the parent records the actor of a nested edit', v_by = 'aaaaaaaa-0000-0000-0000-0000000000ad');
  SELECT updated_by, created_at INTO v_by, v_created FROM public.comp_rates WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100;
  PERFORM comp_test.check('S5j child stamped with the actor', v_by = 'aaaaaaaa-0000-0000-0000-0000000000ad');
  PERFORM set_config('request.jwt.claims', '{}', true);
  UPDATE public.comp_rates SET rate_percent = 61, created_at = now() + interval '1 day', updated_by = 'bbbbbbbb-0000-0000-0000-0000000000ad'
   WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100;
  PERFORM comp_test.check('S5k stamps are server-assigned (no invented user; created_at preserved)',
    (SELECT updated_by IS NULL AND created_at = v_created FROM public.comp_rates
      WHERE variant_id = '51000000-0000-0000-0000-000000000202' AND contract_level = 100));
  RAISE NOTICE 'S5 identity, stamps and revision: ok';
END $$;

-- S6. Calculator selection: active and eligible only; cleanup on disable / deactivate / delete.
DO $$ BEGIN
  INSERT INTO public.organization_comp_settings (organization_id) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a');
  PERFORM comp_test.owner_refused('S6a select a shared grid that is not enabled',
    $q$UPDATE public.organization_comp_settings SET calculator_grid_id = '51000000-0000-0000-0000-000000000001' WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$, 'PT404');
  PERFORM comp_test.owner_refused('S6b enable an inactive shared grid',
    $q$INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '53000000-0000-0000-0000-000000000001')$q$, 'PT404');
  INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-000000000001'),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-000000000001');
  PERFORM comp_test.owner_refused('S6c select another agency''s private grid',
    $q$WITH g AS (INSERT INTO public.comp_grids (id, organization_id, name, effective_date, contract_levels, origin)
                  VALUES ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'B private', '2025-01-01', ARRAY[100], 'blank') RETURNING id)
       UPDATE public.organization_comp_settings SET calculator_grid_id = 'b1000000-0000-0000-0000-000000000001' WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$, 'PT404');
  PERFORM comp_test.owner_ok('S6d select an enabled shared grid',
    $q$UPDATE public.organization_comp_settings SET calculator_grid_id = '51000000-0000-0000-0000-000000000001' WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$);
  DELETE FROM public.organization_comp_grids WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND grid_id = '52000000-0000-0000-0000-000000000001';
  PERFORM comp_test.check('S6e disabling another grid keeps the selection',
    (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = '51000000-0000-0000-0000-000000000001');
  DELETE FROM public.organization_comp_grids WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND grid_id = '51000000-0000-0000-0000-000000000001';
  PERFORM comp_test.check('S6f disabling the selected grid clears the selection (no replacement)',
    (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a') IS NULL);
  UPDATE public.organization_comp_settings SET calculator_grid_id = 'a1000000-0000-0000-0000-000000000001' WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  UPDATE public.comp_grids SET is_active = false WHERE id = 'a1000000-0000-0000-0000-000000000001';
  PERFORM comp_test.check('S6g deactivating the selected private grid clears the selection',
    (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a') IS NULL);
  PERFORM comp_test.owner_refused('S6h an inactive grid cannot be selected',
    $q$UPDATE public.organization_comp_settings SET calculator_grid_id = 'a1000000-0000-0000-0000-000000000001' WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$, 'PT404');
  UPDATE public.comp_grids SET is_active = true WHERE id = 'a1000000-0000-0000-0000-000000000001';
  UPDATE public.organization_comp_settings SET calculator_grid_id = 'a1000000-0000-0000-0000-000000000001' WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  DELETE FROM public.comp_grids WHERE id = 'a1000000-0000-0000-0000-000000000001';
  PERFORM comp_test.check('S6i deleting the selected grid clears the selection',
    (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a') IS NULL);
  PERFORM comp_test.check('S6j the grid''s children were deleted with it',
    NOT EXISTS (SELECT 1 FROM public.comp_products WHERE grid_id = 'a1000000-0000-0000-0000-000000000001'));
  RAISE NOTICE 'S6 calculator selection integrity: ok';
END $$;

SELECT 'commission_grids_schema: ALL PASSED' AS result;
