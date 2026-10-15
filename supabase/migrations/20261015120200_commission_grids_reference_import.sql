-- =====================================================================================================
-- Commission grids — privileged reference-data operations (AgentFlow shared grids).
-- Plan: docs/plans/2026-10-15-commission-calculator/implementation_plan.md §7 and
--       docs/plans/2026-10-15-commission-calculator/reference-import-runbook.md.
-- Apply ONLY with Chris's separate, exact approval, after the schema and operations migrations.
-- Contains NO compensation data: reference DATA arrives later as a private, checksum-verified artifact
-- passed to private.comp_import_reference_grid() in an approved, separately recorded operation (the
-- import ledger public.comp_reference_imports is the record; this is not a migration-history entry).
--
-- Every function here is postgres-only (no client, anon or service_role EXECUTE) and SECURITY INVOKER:
-- it runs as the operator and is still subject to every constraint and trigger on the comp tables.
--   comp_grid_content_sha256       canonical, value-free fingerprint of one grid's full content
--   comp_import_reference_grid     transactional, idempotent import that refuses drift
--   comp_set_reference_grid_active activate/deactivate a shared grid (multi-agency lock order)
--   comp_enable_reference_grid_for_agency  enable + select-if-empty for ONE agency by exact unique name
-- Rollback: supabase/migrations/rollback/20261015120200_commission_grids_reference_import.rollback.sql
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $guard$
BEGIN
  IF to_regclass('public.comp_reference_imports') IS NULL OR to_regprocedure('public.comp_save_grid_changes(uuid,bigint,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'apply the commission grid schema and operations migrations first';
  END IF;
  IF to_regprocedure('private.comp_import_reference_grid(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'commission grid reference-import functions already exist; refusing replay';
  END IF;
END $guard$;

-- Canonical content fingerprint. One ASCII line per grid / product / variant / rate / reference; every
-- free-text field is hex-encoded UTF-8 (unambiguous, delimiter-safe); NULL is '-'; lines are sorted
-- bytewise and joined with '\n'; SHA-256, hex. The importer computes the same fingerprint from its
-- artifact independently, so equality proves an exact load without revealing any value.
CREATE FUNCTION private.comp_grid_content_sha256(p_grid_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH g AS (
    SELECT * FROM public.comp_grids WHERE id = p_grid_id
  ), p AS (
    SELECT p.id, p.category, p.is_active,
           encode(convert_to(p.carrier, 'UTF8'), 'hex') AS carrier_hex,
           encode(convert_to(p.product_name, 'UTF8'), 'hex') AS product_hex
      FROM public.comp_products p WHERE p.grid_id = p_grid_id
  ), v AS (
    SELECT v.id, p.category, p.carrier_hex, p.product_hex, v.min_age, v.max_age, v.term_years,
           encode(convert_to(v.label, 'UTF8'), 'hex') AS label_hex
      FROM public.comp_product_variants v JOIN p ON p.id = v.product_id
  ), lines AS (
    SELECT concat_ws('|', 'G', encode(convert_to(g.name, 'UTF8'), 'hex'), to_char(g.effective_date, 'YYYY-MM-DD'),
                     array_to_string(g.contract_levels, ','), CASE WHEN g.is_active THEN 't' ELSE 'f' END) AS line
      FROM g
    UNION ALL
    SELECT concat_ws('|', 'P', p.category, p.carrier_hex, p.product_hex, CASE WHEN p.is_active THEN 't' ELSE 'f' END)
      FROM p
    UNION ALL
    SELECT concat_ws('|', 'V', v.category, v.carrier_hex, v.product_hex, v.label_hex,
                     coalesce(v.min_age::text, '-'), coalesce(v.max_age::text, '-'),
                     coalesce(array_to_string(v.term_years, ','), '-'))
      FROM v
    UNION ALL
    SELECT concat_ws('|', 'R', v.category, v.carrier_hex, v.product_hex, v.label_hex,
                     r.contract_level::text, r.rate_percent::text)
      FROM public.comp_rates r JOIN v ON v.id = r.variant_id
    UNION ALL
    SELECT concat_ws('|', 'N', v.category, v.carrier_hex, v.product_hex, v.label_hex,
                     coalesce(encode(convert_to(x.source, 'UTF8'), 'hex'), '-'),
                     coalesce(encode(convert_to(x.notes, 'UTF8'), 'hex'), '-'))
      FROM public.comp_variant_references x JOIN v ON v.id = x.variant_id
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM g)
              THEN encode(sha256(convert_to(string_agg(l.line, E'\n' ORDER BY l.line COLLATE "C"), 'UTF8')), 'hex')
         END
    FROM lines l
$$;

-- Transactional, idempotent, drift-refusing import of ONE shared reference grid from a private artifact.
--   p_artifact         the exact artifact text produced by scripts/comp_grids/reference_grid_importer.py
--   p_artifact_sha256  its SHA-256 (hex); a mismatch imports nothing
-- New grid: inserts everything, re-verifies counts and the content fingerprint, runs every constraint,
-- and records the ledger row. The byte-identical artifact again, with the stored content unchanged since
-- its import: no-op. Same grid id with anything different: refused (PT409) — never overwritten.
CREATE FUNCTION private.comp_import_reference_grid(p_artifact text, p_artifact_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_doc      jsonb;
  v_grid_id  uuid;
  v_hash     text;
  v_counts   jsonb;
  v_expected jsonb;
  v_import   uuid;
BEGIN
  IF p_artifact IS NULL OR p_artifact_sha256 IS NULL OR p_artifact_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'An artifact and its SHA-256 are required' USING ERRCODE = '22023';
  END IF;
  IF encode(sha256(convert_to(p_artifact, 'UTF8')), 'hex') <> p_artifact_sha256 THEN
    RAISE EXCEPTION 'Import artifact checksum mismatch; nothing was imported' USING ERRCODE = '22023';
  END IF;
  v_doc := p_artifact::jsonb;
  IF v_doc->>'format' IS DISTINCT FROM 'agentflow.comp_reference_grid.v1'
     OR coalesce(v_doc->>'importer_version', '') !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
     OR coalesce(v_doc#>>'{source,sha256}', '') !~ '^[0-9a-f]{64}$'
     OR coalesce(v_doc#>>'{expected,content_sha256}', '') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(v_doc->'grid') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_doc->'products') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_doc->'variants') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_doc->'rates') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_doc->'references') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_doc->'expected') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Unrecognised import artifact' USING ERRCODE = '22023';
  END IF;
  v_grid_id := (v_doc#>>'{grid,id}')::uuid;
  v_expected := (v_doc->'expected') - 'content_sha256';

  -- One import at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('agentflow.comp_reference_import', 0));

  IF EXISTS (SELECT 1 FROM public.comp_grids g WHERE g.id = v_grid_id) THEN
    PERFORM 1 FROM public.comp_grids g WHERE g.id = v_grid_id FOR UPDATE;
    -- A no-op only for the byte-identical artifact that was imported, and only while the stored content
    -- still has the fingerprint recorded then. Anything else for an existing grid is drift.
    SELECT i.id, i.content_sha256 INTO v_import, v_hash
      FROM public.comp_reference_imports i
     WHERE i.grid_id = v_grid_id AND i.artifact_sha256 = p_artifact_sha256;
    IF v_import IS NOT NULL AND private.comp_grid_content_sha256(v_grid_id) = v_hash THEN
      RETURN jsonb_build_object('status', 'already_imported', 'grid_id', v_grid_id, 'import_id', v_import,
                                'content_sha256', v_doc#>>'{expected,content_sha256}');
    END IF;
    RAISE EXCEPTION 'Reference grid % already exists with different content or provenance; refusing to overwrite', v_grid_id
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.comp_grids (id, organization_id, name, effective_date, is_active, contract_levels, origin)
  VALUES (v_grid_id, NULL, v_doc#>>'{grid,name}', (v_doc#>>'{grid,effective_date}')::date, true,
          ARRAY(SELECT (l #>> '{}')::integer
                  FROM jsonb_array_elements(v_doc#>'{grid,contract_levels}') WITH ORDINALITY AS t(l, n)
                 ORDER BY t.n),
          'agentflow_reference');

  INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name, is_active)
  SELECT x.id, v_grid_id, NULL, x.category, x.carrier, x.product_name, coalesce(x.is_active, true)
    FROM jsonb_to_recordset(v_doc->'products')
         AS x(id uuid, category text, carrier text, product_name text, is_active boolean);

  INSERT INTO public.comp_product_variants (id, grid_id, product_id, organization_id, label, min_age, max_age, term_years)
  SELECT x.id, v_grid_id, x.product_id, NULL, coalesce(x.label, ''), x.min_age, x.max_age, x.term_years
    FROM jsonb_to_recordset(v_doc->'variants')
         AS x(id uuid, product_id uuid, label text, min_age integer, max_age integer, term_years integer[]);

  INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent)
  SELECT v_grid_id, x.variant_id, NULL, x.contract_level, x.rate_percent::numeric
    FROM jsonb_to_recordset(v_doc->'rates') AS x(variant_id uuid, contract_level integer, rate_percent text);

  INSERT INTO public.comp_variant_references (variant_id, grid_id, organization_id, source, notes)
  SELECT x.variant_id, v_grid_id, NULL, x.source, x.notes
    FROM jsonb_to_recordset(v_doc->'references') AS x(variant_id uuid, source text, notes text);

  SET CONSTRAINTS ALL IMMEDIATE;

  v_counts := jsonb_build_object(
    'products',   (SELECT count(*) FROM public.comp_products p WHERE p.grid_id = v_grid_id),
    'variants',   (SELECT count(*) FROM public.comp_product_variants v WHERE v.grid_id = v_grid_id),
    'carriers',   (SELECT count(DISTINCT p.carrier) FROM public.comp_products p WHERE p.grid_id = v_grid_id),
    'rate_cells', (SELECT count(*) FROM public.comp_rates r WHERE r.grid_id = v_grid_id),
    'references', (SELECT count(*) FROM public.comp_variant_references x WHERE x.grid_id = v_grid_id));
  IF v_counts IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Imported counts do not match the artifact; nothing was imported' USING ERRCODE = '22023';
  END IF;
  v_hash := private.comp_grid_content_sha256(v_grid_id);
  IF v_hash IS DISTINCT FROM v_doc#>>'{expected,content_sha256}' THEN
    RAISE EXCEPTION 'Imported content does not match the artifact; nothing was imported' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.comp_reference_imports
    (grid_id, importer_version, source_sha256, artifact_sha256, content_sha256, counts, verification)
  VALUES (v_grid_id, v_doc->>'importer_version', v_doc#>>'{source,sha256}', p_artifact_sha256, v_hash, v_counts,
          jsonb_build_object('artifact_sha256', 'match', 'counts', 'match', 'content_sha256', 'match',
                             'constraints', 'pass'))
  RETURNING id INTO v_import;

  RETURN jsonb_build_object('status', 'imported', 'grid_id', v_grid_id, 'import_id', v_import,
                            'counts', v_counts, 'content_sha256', v_hash);
END $$;

-- Activate or deactivate a SHARED grid. Lock order for a multi-agency change: the settings rows that
-- currently select it (ordered by organization) BEFORE the grid row; deactivation then clears every such
-- selection (trigger) and never chooses a replacement.
CREATE FUNCTION private.comp_set_reference_grid_active(p_grid_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_found   boolean;
  v_shared  boolean;
  v_cleared bigint := 0;
BEGIN
  IF p_grid_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'A grid and the target state are required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.organization_comp_settings s
    WHERE s.calculator_grid_id = p_grid_id ORDER BY s.organization_id FOR UPDATE;
  SELECT true, g.organization_id IS NULL INTO v_found, v_shared
    FROM public.comp_grids g WHERE g.id = p_grid_id FOR UPDATE;
  IF v_found IS NOT TRUE OR v_shared IS NOT TRUE THEN
    RAISE EXCEPTION 'Not an AgentFlow shared grid' USING ERRCODE = 'PT404';
  END IF;
  IF NOT p_active THEN
    SELECT count(*) INTO v_cleared FROM public.organization_comp_settings s WHERE s.calculator_grid_id = p_grid_id;
  END IF;
  UPDATE public.comp_grids g SET is_active = p_active WHERE g.id = p_grid_id;
  RETURN jsonb_build_object('grid_id', p_grid_id, 'is_active', p_active, 'cleared_selections', v_cleared);
END $$;

-- Environment-specific activation for ONE agency, resolved by exact unique name at execution. Enables a
-- verified shared grid (retry-safe) and selects it only when the agency has no selection; an existing
-- selection is kept and reported, never silently overwritten. Zero or several matches: refused.
CREATE FUNCTION private.comp_enable_reference_grid_for_agency(p_agency_name text, p_grid_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_orgs    uuid[];
  v_org     uuid;
  v_current uuid;
BEGIN
  IF p_agency_name IS NULL OR p_grid_id IS NULL THEN
    RAISE EXCEPTION 'An agency name and a grid are required' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(o.id ORDER BY o.id) INTO v_orgs FROM public.organizations o WHERE o.name = p_agency_name;
  IF coalesce(cardinality(v_orgs), 0) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one agency with that exact name, found %', coalesce(cardinality(v_orgs), 0)
      USING ERRCODE = 'PT409';
  END IF;
  v_org := v_orgs[1];
  IF NOT EXISTS (SELECT 1 FROM public.comp_reference_imports i WHERE i.grid_id = p_grid_id) THEN
    RAISE EXCEPTION 'That grid has no verified reference import' USING ERRCODE = 'PT404';
  END IF;

  INSERT INTO public.organization_comp_settings (organization_id) VALUES (v_org)
    ON CONFLICT (organization_id) DO NOTHING;
  SELECT s.calculator_grid_id INTO v_current
    FROM public.organization_comp_settings s WHERE s.organization_id = v_org FOR UPDATE;
  INSERT INTO public.organization_comp_grids (organization_id, grid_id) VALUES (v_org, p_grid_id)
    ON CONFLICT (organization_id, grid_id) DO NOTHING;
  IF v_current IS NULL THEN
    UPDATE public.organization_comp_settings s SET calculator_grid_id = p_grid_id WHERE s.organization_id = v_org;
  END IF;
  RETURN jsonb_build_object(
    'organization_id', v_org, 'grid_id', p_grid_id, 'enabled', true,
    'selected', v_current IS NULL,
    'existing_selection', v_current,
    'existing_selection_kept', v_current IS NOT NULL AND v_current <> p_grid_id);
END $$;

REVOKE ALL ON FUNCTION
  private.comp_grid_content_sha256(uuid), private.comp_import_reference_grid(text, text),
  private.comp_set_reference_grid_active(uuid, boolean), private.comp_enable_reference_grid_for_agency(text, uuid)
FROM PUBLIC, anon, authenticated, service_role;
