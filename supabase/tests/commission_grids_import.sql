-- =====================================================================================================
-- Commission grids — reference-import suite. Runs the private-import workflow on a SYNTHETIC artifact that
-- scripts/run_commission_grids_tests.sh builds with scripts/comp_grids/reference_grid_importer.py from
-- supabase/tests/fixtures/commission_grids/synthetic_reference_grid.csv and passes in as
-- -v artifact_path=… -v artifact_sha256=…. Proves: postgres-only privileges; checksum and format checks;
-- all-or-nothing failures; count and fingerprint verification against the importer's independent
-- computation; idempotent re-run; drift refusal; activation by exact unique agency name (existing selection
-- kept); multi-agency deactivation. LOCAL disposable database only (invariant #28). Synthetic data only.
-- =====================================================================================================
\set ON_ERROR_STOP 1
\set artifact `cat :'artifact_path'`
CREATE TABLE comp_test.artifact AS SELECT :'artifact'::text AS doc, :'artifact_sha256'::text AS sha;
DO $$ BEGIN PERFORM comp_test.seed_base(); END $$;

CREATE FUNCTION comp_test.sha(p_text text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_text, 'UTF8')), 'hex')
$$;

-- Import as the operator (table owner) and report the outcome instead of raising.
CREATE FUNCTION comp_test.try_import(p_text text, p_sha text)
RETURNS TABLE (out_state text, out_message text, out_result jsonb) LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    out_result := private.comp_import_reference_grid(p_text, p_sha);
    out_state := '00000'; out_message := 'ok';
  EXCEPTION WHEN OTHERS THEN
    out_state := SQLSTATE; out_message := SQLERRM; out_result := NULL;
  END;
  RETURN NEXT;
END $$;

-- A modified copy of the artifact document, re-serialised with a matching checksum.
CREATE FUNCTION comp_test.try_import_doc(p_doc jsonb)
RETURNS TABLE (out_state text, out_message text, out_result jsonb) LANGUAGE sql AS $$
  SELECT * FROM comp_test.try_import(p_doc::text, comp_test.sha(p_doc::text))
$$;

CREATE FUNCTION comp_test.nothing_of(p_grid uuid, p_doc jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.comp_grids WHERE id = p_grid)
     AND NOT EXISTS (SELECT 1 FROM public.comp_products
                      WHERE id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_doc->'products') e))
     AND NOT EXISTS (SELECT 1 FROM public.comp_product_variants
                      WHERE id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_doc->'variants') e))
     AND NOT EXISTS (SELECT 1 FROM public.comp_reference_imports WHERE grid_id = p_grid)
$$;

-- I1. Privileged reference operations are postgres-only. anon (with and without forged Agency Admin claims), an
--     agent, an Agency Admin and service_role are refused, also when they supply both operator approval settings
--     (read only by the ops scripts) and a forged operation flag. None of them can change a shared grid through
--     the editor operation or a direct write either: every attempt is refused or changes no row, and the shared
--     grids' fingerprints, the import ledger and the revision are identical afterwards.
DO $$
DECLARE
  s1 constant uuid := '51000000-0000-0000-0000-000000000001';
  who_role   constant text[] := ARRAY['anon', 'anon', 'authenticated', 'authenticated', 'service_role'];
  who_claims constant text[] := ARRAY['', 'admin_a', 'agent_a', 'admin_a', ''];
  v_before text[]; v_after text[]; v_ledger bigint; v_rev bigint; v_claims jsonb; v_label text;
  r record; q text; v_who int; v_flags int;
BEGIN
  SELECT array_agg(private.comp_grid_content_sha256(g.id) ORDER BY g.id) INTO v_before
    FROM public.comp_grids g WHERE g.organization_id IS NULL;
  SELECT count(*) INTO v_ledger FROM public.comp_reference_imports;
  v_rev := comp_test.rev(s1);
  FOR v_who IN 1 .. array_length(who_role, 1) LOOP
    v_claims := CASE WHEN who_claims[v_who] = '' THEN '{}'::jsonb ELSE comp_test.claims_for(comp_test.p(who_claims[v_who])) END;
    FOR v_flags IN 0 .. 2 LOOP  -- 0: none; 1: both approval settings; 2: approval settings + forged operation flag
      PERFORM set_config('agentflow.approve_comp_reference_import', CASE WHEN v_flags >= 1 THEN 'yes' ELSE '' END, true);
      PERFORM set_config('agentflow.approve_comp_home_activation', CASE WHEN v_flags >= 1 THEN 'yes' ELSE '' END, true);
      PERFORM set_config('agentflow.comp_operation', CASE WHEN v_flags = 2 THEN 'on' ELSE '' END, true);
      v_label := format('I1 %s%s flags=%s: ', who_role[v_who], CASE WHEN who_claims[v_who] = '' THEN '' ELSE '/' || who_claims[v_who] END, v_flags);
      FOREACH q IN ARRAY ARRAY[
        $q$SELECT private.comp_import_reference_grid('{}', repeat('0', 64))$q$,
        format($q$SELECT private.comp_enable_reference_grid_for_agency('Synthetic Agency A', %L)$q$, s1),
        format($q$SELECT private.comp_set_reference_grid_active(%L, false)$q$, s1),
        format($q$SELECT to_jsonb(private.comp_grid_content_sha256(%L))$q$, s1)] LOOP
        SELECT * INTO r FROM comp_test.run_as(who_role[v_who], v_claims, q);
        PERFORM comp_test.refused(v_label || left(q, 50), r.out_state, r.out_message, '42501');
      END LOOP;
      FOREACH q IN ARRAY ARRAY[
        format($q$SELECT public.comp_save_grid_changes(%L, %s, jsonb_build_object('rates', jsonb_build_array(jsonb_build_object('variant_id', '51000000-0000-0000-0000-000000000201', 'contract_level', 100, 'rate_percent', '1'))))$q$, s1, v_rev),
        format($q$WITH x AS (UPDATE public.comp_rates SET rate_percent = 1 WHERE grid_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$, s1),
        format($q$WITH x AS (INSERT INTO public.comp_products (grid_id, organization_id, category, carrier, product_name) VALUES (%L, NULL, 'term', 'x', 'y') RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$, s1),
        format($q$WITH x AS (DELETE FROM public.comp_variant_references WHERE grid_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$, s1),
        format($q$WITH x AS (UPDATE public.comp_grids SET is_active = false WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$, s1),
        $q$WITH x AS (INSERT INTO public.comp_reference_imports DEFAULT VALUES RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$,
        $q$WITH x AS (DELETE FROM public.comp_reference_imports RETURNING 1) SELECT to_jsonb(count(*)) FROM x$q$] LOOP
        SELECT * INTO r FROM comp_test.run_as(who_role[v_who], v_claims, q);
        PERFORM comp_test.check(v_label || left(q, 50) || ' (' || r.out_state || ' ' || left(r.out_message, 40) || ')',
          r.out_state <> '00000' OR r.out_result = to_jsonb(0));
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM set_config('agentflow.approve_comp_reference_import', '', true);
  PERFORM set_config('agentflow.approve_comp_home_activation', '', true);
  PERFORM set_config('agentflow.comp_operation', '', true);
  SELECT array_agg(private.comp_grid_content_sha256(g.id) ORDER BY g.id) INTO v_after
    FROM public.comp_grids g WHERE g.organization_id IS NULL;
  PERFORM comp_test.check('I1 shared grids, import ledger and revision unchanged',
    v_after = v_before AND (SELECT count(*) FROM public.comp_reference_imports) = v_ledger AND comp_test.rev(s1) = v_rev);
  RAISE NOTICE 'I1 postgres-only privileges, with approval settings and a forged operation flag: ok';
END $$;

-- I2. Request checks: nothing is imported from a wrong checksum or an unrecognised document.
DO $$
DECLARE r record; a record; v_doc jsonb; v_grid uuid;
BEGIN
  SELECT * INTO a FROM comp_test.artifact;
  v_doc := a.doc::jsonb; v_grid := (v_doc#>>'{grid,id}')::uuid;
  SELECT * INTO r FROM comp_test.try_import(NULL, a.sha);
  PERFORM comp_test.refused('I2a no artifact', r.out_state, r.out_message, '22023');
  SELECT * INTO r FROM comp_test.try_import(a.doc, 'not-a-checksum');
  PERFORM comp_test.refused('I2b malformed checksum', r.out_state, r.out_message, '22023');
  SELECT * INTO r FROM comp_test.try_import(a.doc, comp_test.sha(a.doc || ' '));
  PERFORM comp_test.refused('I2c checksum of different text', r.out_state, r.out_message, '22023', 'Import artifact checksum mismatch%');
  SELECT * INTO r FROM comp_test.try_import(a.doc || ' ', a.sha);
  PERFORM comp_test.refused('I2d artifact changed by one byte', r.out_state, r.out_message, '22023', 'Import artifact checksum mismatch%');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{format}', '"agentflow.comp_reference_grid.v0"'));
  PERFORM comp_test.refused('I2e unknown format', r.out_state, r.out_message, '22023', 'Unrecognised import artifact');
  SELECT * INTO r FROM comp_test.try_import_doc(v_doc - 'rates');
  PERFORM comp_test.refused('I2f missing section', r.out_state, r.out_message, '22023', 'Unrecognised import artifact');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{importer_version}', '"1.0"'));
  PERFORM comp_test.refused('I2g malformed importer version', r.out_state, r.out_message, '22023', 'Unrecognised import artifact');
  PERFORM comp_test.check('I2h nothing was imported', comp_test.nothing_of(v_grid, v_doc));
  RAISE NOTICE 'I2 checksum and format checks: ok';
END $$;

-- I3. All-or-nothing: every failure after the first insert leaves no row behind.
DO $$
DECLARE r record; a record; v_doc jsonb; v_grid uuid; v_dup jsonb;
BEGIN
  SELECT * INTO a FROM comp_test.artifact;
  v_doc := a.doc::jsonb; v_grid := (v_doc#>>'{grid,id}')::uuid;
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{expected,rate_cells}', to_jsonb((v_doc#>>'{expected,rate_cells}')::integer + 1)));
  PERFORM comp_test.refused('I3a counts differ from the artifact', r.out_state, r.out_message, '22023', 'Imported counts do not match%');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{expected,content_sha256}', to_jsonb(repeat('a', 64))));
  PERFORM comp_test.refused('I3b fingerprint differs from the artifact', r.out_state, r.out_message, '22023', 'Imported content does not match%');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{rates,0,rate_percent}', '"87.555"'));
  PERFORM comp_test.refused('I3c excess precision is refused, never rounded', r.out_state, r.out_message, '23514');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{rates,0,contract_level}', '146'));
  PERFORM comp_test.refused('I3d a level that is not on the grid', r.out_state, r.out_message, '23514', 'Contract level 146%');
  v_dup := jsonb_set(jsonb_set(v_doc->'variants'->0, '{id}', to_jsonb(gen_random_uuid())), '{label}', '"overlapping"');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{variants}', (v_doc->'variants') || jsonb_build_array(v_dup)));
  PERFORM comp_test.refused('I3e overlapping variants', r.out_state, r.out_message, '23P01');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{products,0,category}', '"annuity"'));
  PERFORM comp_test.refused('I3f an unknown category', r.out_state, r.out_message, '23514');
  PERFORM comp_test.check('I3g nothing of any failed attempt remains', comp_test.nothing_of(v_grid, v_doc));
  RAISE NOTICE 'I3 all-or-nothing failures: ok';
END $$;

-- I4. The import: exact rows, server provenance, ledger, fingerprint equal to the importer's.
DO $$
DECLARE r record; a record; v_doc jsonb; v_grid uuid;
BEGIN
  SELECT * INTO a FROM comp_test.artifact;
  v_doc := a.doc::jsonb; v_grid := (v_doc#>>'{grid,id}')::uuid;
  SELECT * INTO r FROM comp_test.try_import(a.doc, a.sha);
  PERFORM comp_test.ok('I4a import', r.out_state, r.out_message);
  PERFORM comp_test.check('I4b reported counts and fingerprint equal the importer''s',
    r.out_result->>'status' = 'imported'
    AND r.out_result->'counts' = (v_doc->'expected') - 'content_sha256'
    AND r.out_result->>'content_sha256' = v_doc#>>'{expected,content_sha256}'
    AND private.comp_grid_content_sha256(v_grid) = v_doc#>>'{expected,content_sha256}');
  PERFORM comp_test.check('I4c a shared AgentFlow grid with no invented editor',
    (SELECT organization_id IS NULL AND origin = 'agentflow_reference' AND is_active AND updated_by IS NULL
            AND name = v_doc#>>'{grid,name}' AND effective_date = (v_doc#>>'{grid,effective_date}')::date
            AND contract_levels = ARRAY[145,140,135,130,125,120,115,110,105,100,95,90,85,80,75,70,65]
       FROM public.comp_grids WHERE id = v_grid)
    AND NOT EXISTS (SELECT 1 FROM public.comp_rates WHERE grid_id = v_grid AND (organization_id IS NOT NULL OR updated_by IS NOT NULL)));
  PERFORM comp_test.check('I4d ledger records provenance and verification, never values',
    (SELECT count(*) FROM public.comp_reference_imports WHERE grid_id = v_grid) = 1
    AND (SELECT importer_version = v_doc->>'importer_version' AND source_sha256 = v_doc#>>'{source,sha256}'
                AND artifact_sha256 = a.sha AND content_sha256 = v_doc#>>'{expected,content_sha256}'
                AND counts = (v_doc->'expected') - 'content_sha256' AND imported_by = current_user
                AND verification = '{"counts": "match", "constraints": "pass", "content_sha256": "match", "artifact_sha256": "match"}'
           FROM public.comp_reference_imports WHERE grid_id = v_grid));
  PERFORM comp_test.check('I4e source values stored exactly: scale kept, zeros kept, blanks absent, text verbatim',
    'R|term|Synthetic Carrier, Beta & Co.|Beta Term w/ Rider||65|0' = ANY (comp_test.content(v_grid, 'R'))
    AND 'R|whole_life|Synthetic Carrier Alpha|Alpha Final Expense|0-70|115|87.50' = ANY (comp_test.content(v_grid, 'R'))
    AND 'R|iul|Synthetic Carrier Delta|Delta Index Builder|18-80|65|0.5' = ANY (comp_test.content(v_grid, 'R'))
    AND (SELECT count(*) FROM public.comp_rates WHERE variant_id = comp_test.vid(v_grid, 'Alpha Level Term', '30 yr')) = 10
    AND (SELECT notes FROM public.comp_variant_references WHERE variant_id = comp_test.vid(v_grid, 'Alpha Final Expense', '0-70'))
        = E'Synthetic line one\nSynthetic line two — not a real carrier'
    AND (SELECT count(*) FROM public.comp_products WHERE grid_id = v_grid AND product_name = 'Gamma Dual Plan') = 2);
  RAISE NOTICE 'I4 import: ok';
END $$;

-- I5. Re-running is a no-op; drift is refused and never overwrites.
DO $$
DECLARE r record; a record; v_doc jsonb; v_grid uuid; v_before text; v_import uuid;
BEGIN
  SELECT * INTO a FROM comp_test.artifact;
  v_doc := a.doc::jsonb; v_grid := (v_doc#>>'{grid,id}')::uuid;
  v_before := private.comp_grid_content_sha256(v_grid);
  SELECT id INTO v_import FROM public.comp_reference_imports WHERE grid_id = v_grid;
  SELECT * INTO r FROM comp_test.try_import(a.doc, a.sha);
  PERFORM comp_test.check('I5a the same artifact again: already imported, nothing duplicated',
    r.out_state = '00000' AND r.out_result->>'status' = 'already_imported' AND (r.out_result->>'import_id')::uuid = v_import
    AND (SELECT count(*) FROM public.comp_reference_imports WHERE grid_id = v_grid) = 1
    AND (SELECT count(*) FROM public.comp_rates WHERE grid_id = v_grid) = (v_doc#>>'{expected,rate_cells}')::integer);
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{source,sha256}', to_jsonb(repeat('b', 64))));
  PERFORM comp_test.refused('I5b same grid from a different source file', r.out_state, r.out_message, 'PT409');
  SELECT * INTO r FROM comp_test.try_import_doc(jsonb_set(v_doc, '{rates,0,rate_percent}', '"1"'));
  PERFORM comp_test.refused('I5c same grid with a changed value', r.out_state, r.out_message, 'PT409');
  -- Out-of-band drift in the database itself is detected too (probe rolled back).
  BEGIN
    UPDATE public.comp_rates SET rate_percent = rate_percent + 1
     WHERE id = (SELECT id FROM public.comp_rates WHERE grid_id = v_grid ORDER BY id LIMIT 1);
    SELECT * INTO r FROM comp_test.try_import(a.doc, a.sha);
    PERFORM comp_test.refused('I5d stored content drifted', r.out_state, r.out_message, 'PT409');
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'probe rollback';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
  PERFORM comp_test.check('I5e nothing was overwritten', private.comp_grid_content_sha256(v_grid) = v_before);
  RAISE NOTICE 'I5 idempotency and drift: ok';
END $$;

-- I6. Activation for ONE agency by exact unique name; an existing selection is kept and reported.
DO $$
DECLARE r jsonb; v jsonb; a record; v_grid uuid;
  s1 constant uuid := '51000000-0000-0000-0000-000000000001';
  org_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  org_b constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
BEGIN
  SELECT * INTO a FROM comp_test.artifact;
  v_grid := (a.doc::jsonb#>>'{grid,id}')::uuid;
  v := comp_test.op_ok('I6a agency A already selected S1', comp_test.p('admin_a'), format('SELECT public.comp_enable_shared_grid(%L)', s1));
  INSERT INTO public.organizations (name) VALUES ('Synthetic Twin Agency'), ('Synthetic Twin Agency');

  PERFORM comp_test.owner_refused('I6b no agency with that name', format('SELECT private.comp_enable_reference_grid_for_agency(%L, %L)', 'No Such Agency', v_grid), 'PT409', '%found 0');
  PERFORM comp_test.owner_refused('I6c the name must match exactly (case)', format('SELECT private.comp_enable_reference_grid_for_agency(%L, %L)', 'synthetic agency b', v_grid), 'PT409', '%found 0');
  PERFORM comp_test.owner_refused('I6d the name must match exactly (spaces)', format('SELECT private.comp_enable_reference_grid_for_agency(%L, %L)', 'Synthetic Agency B ', v_grid), 'PT409', '%found 0');
  PERFORM comp_test.owner_refused('I6e two agencies with that name', format('SELECT private.comp_enable_reference_grid_for_agency(%L, %L)', 'Synthetic Twin Agency', v_grid), 'PT409', '%found 2');
  PERFORM comp_test.owner_refused('I6f a grid without a verified import', format('SELECT private.comp_enable_reference_grid_for_agency(%L, %L)', 'Synthetic Agency B', s1), 'PT404');

  r := private.comp_enable_reference_grid_for_agency('Synthetic Agency B', v_grid);
  PERFORM comp_test.check('I6g agency B: enabled and selected (nothing was selected)',
    r @> jsonb_build_object('organization_id', org_b, 'enabled', true, 'selected', true, 'existing_selection_kept', false)
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = org_b) = v_grid);
  r := private.comp_enable_reference_grid_for_agency('Synthetic Agency B', v_grid);
  PERFORM comp_test.check('I6h retry-safe',
    r @> '{"selected": false, "existing_selection_kept": false}'
    AND (SELECT count(*) FROM public.organization_comp_grids WHERE organization_id = org_b) = 1);
  r := private.comp_enable_reference_grid_for_agency('Synthetic Agency A', v_grid);
  PERFORM comp_test.check('I6i agency A: enabled; its existing selection kept and reported',
    r @> jsonb_build_object('selected', false, 'existing_selection_kept', true, 'existing_selection', s1)
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = org_a) = s1
    AND EXISTS (SELECT 1 FROM public.organization_comp_grids WHERE organization_id = org_a AND grid_id = v_grid));
  PERFORM comp_test.check('I6j no other agency touched',
    NOT EXISTS (SELECT 1 FROM public.organization_comp_settings WHERE organization_id NOT IN (org_a, org_b))
    AND NOT EXISTS (SELECT 1 FROM public.organization_comp_grids WHERE organization_id NOT IN (org_a, org_b)));

  v := comp_test.op_ok('I6k agent B context', comp_test.p('agent_b'), 'SELECT public.get_commission_calculator_context()');
  PERFORM comp_test.check('I6l agent B estimates from the imported grid; protected notes never included',
    v->>'status' = 'ready' AND v#>>'{grid,id}' = v_grid::text
    AND jsonb_array_length(v->'products') = 6 AND jsonb_array_length(v->'variants') = 9
    AND jsonb_array_length(v->'rates') = 138
    AND position('Synthetic line one' IN v::text) = 0 AND position('Synthetic schedule' IN v::text) = 0);
  v := comp_test.op_ok('I6m admin B full copy of the imported grid', comp_test.p('admin_b'),
    format('SELECT public.comp_create_private_grid(%L, %L, %L, %L)', 'full', 'B reference copy', '2025-02-01', v_grid));
  PERFORM comp_test.check('I6n the full copy is exact (every value, blank, zero and reference)',
    comp_test.content((v->>'grid_id')::uuid) = comp_test.content(v_grid));
  RAISE NOTICE 'I6 activation by exact unique name: ok';
END $$;

-- I7. Deactivating a shared grid clears every agency's selection of it (and nothing else).
DO $$
DECLARE r jsonb; v jsonb; a record; v_grid uuid; v_before text;
  org_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  org_b constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
BEGIN
  SELECT * INTO a FROM comp_test.artifact;
  v_grid := (a.doc::jsonb#>>'{grid,id}')::uuid;
  v_before := private.comp_grid_content_sha256(v_grid);
  v := comp_test.op_ok('I7a agency A switches to the imported grid', comp_test.p('admin_a'),
    format('SELECT public.comp_select_calculator_grid(%L, %L)', v_grid, '51000000-0000-0000-0000-000000000001'));
  r := private.comp_set_reference_grid_active(v_grid, false);
  PERFORM comp_test.check('I7b both selections cleared and reported; access rows kept; no replacement',
    r @> '{"is_active": false, "cleared_selections": 2}'
    AND (SELECT count(*) FROM public.organization_comp_settings WHERE calculator_grid_id IS NULL AND organization_id IN (org_a, org_b)) = 2
    AND (SELECT count(*) FROM public.organization_comp_grids WHERE grid_id = v_grid) = 2
    AND comp_test.op_ok('I7b agent', comp_test.p('agent_b'), 'SELECT public.get_commission_calculator_status()') = '{"status": "not_configured"}');
  r := private.comp_set_reference_grid_active(v_grid, true);
  PERFORM comp_test.check('I7c reactivation selects nothing by itself; content unchanged',
    r @> '{"is_active": true, "cleared_selections": 0}'
    AND (SELECT calculator_grid_id FROM public.organization_comp_settings WHERE organization_id = org_b) IS NULL
    AND private.comp_grid_content_sha256(v_grid) = v_before);
  PERFORM comp_test.owner_refused('I7d a private grid is not a reference grid',
    format('SELECT private.comp_set_reference_grid_active(%L, false)', comp_test.gid('B reference copy')), 'PT404');
  PERFORM comp_test.check('I7e the artifact is still recognised as imported',
    (SELECT out_result->>'status' FROM comp_test.try_import(a.doc, a.sha)) = 'already_imported');
  RAISE NOTICE 'I7 multi-agency deactivation: ok';
END $$;

SELECT 'commission_grids_import: ALL PASSED' AS result;
