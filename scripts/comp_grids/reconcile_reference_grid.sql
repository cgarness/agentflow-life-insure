-- =====================================================================================================
-- Commission grids — independent reconciliation of ONE imported reference grid against its source CSV.
-- PostgreSQL parses the CSV itself (COPY, HEADER MATCH) and every product, variant, rate cell (exact text)
-- and reference is compared with the stored rows IN BOTH DIRECTIONS. Prints counts and PASS/FAIL only —
-- never a value. Raises (non-zero exit) on any difference.
--
-- LOCAL disposable database only. The private FFL CSV is reconciled only against a clearly identified
-- disposable local database (runbook); synthetic CSVs run in scripts/run_commission_grids_tests.sh.
-- Usage: psql "$LOCAL_DB_URL" -X -v grid_id=<uuid> -f scripts/comp_grids/reconcile_reference_grid.sql < source.csv
-- (a source the validator reported with a UTF-8 BOM is piped without its first 3 bytes: tail -c +4)
-- =====================================================================================================
\set ON_ERROR_STOP 1
\if :{?grid_id}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable grid_id is required'; END $$;
\endif

CREATE TEMP TABLE comp_recon_csv (
  category text, carrier text, product text, variant text, min_age text, max_age text, term_years text,
  "145" text, "140" text, "135" text, "130" text, "125" text, "120" text, "115" text, "110" text, "105" text,
  "100" text, "95" text, "90" text, "85" text, "80" text, "75" text, "70" text, "65" text,
  source text, notes text
);
\copy comp_recon_csv FROM pstdin WITH (FORMAT csv, HEADER MATCH)
SELECT set_config('comp_recon.grid_id', :'grid_id', false) IS NOT NULL AS grid_set \gset

DO $recon$
DECLARE
  v_grid uuid := current_setting('comp_recon.grid_id')::uuid;
  v_rows bigint; v_products bigint; v_variants bigint; v_carriers bigint; v_rates bigint; v_refs bigint;
  d_products bigint; d_variants bigint; d_rates bigint; d_refs bigint; d_levels boolean; d_inactive bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.comp_grids g WHERE g.id = v_grid AND g.organization_id IS NULL) THEN
    RAISE EXCEPTION 'reconciliation FAIL: shared grid % not found', v_grid;
  END IF;

  CREATE TEMP TABLE recon_src_variants ON COMMIT DROP AS
  SELECT CASE c.category WHEN 'Term' THEN 'term' WHEN 'Whole Life' THEN 'whole_life' WHEN 'IUL' THEN 'iul'
              ELSE '?' || coalesce(c.category, '') END AS category,
         coalesce(c.carrier, '') AS carrier, coalesce(c.product, '') AS product, coalesce(c.variant, '') AS label,
         nullif(c.min_age, '')::integer AS min_age, nullif(c.max_age, '')::integer AS max_age,
         CASE WHEN coalesce(c.term_years, '') = '' THEN NULL ELSE string_to_array(c.term_years, '|')::integer[] END AS term_years,
         nullif(c.source, '') AS source, nullif(c.notes, '') AS notes,
         to_jsonb(c) - ARRAY['category', 'carrier', 'product', 'variant', 'min_age', 'max_age', 'term_years',
                             'source', 'notes'] AS rate_cells
    FROM comp_recon_csv c;

  CREATE TEMP TABLE recon_db_variants ON COMMIT DROP AS
  SELECT p.category, p.carrier, p.product_name AS product, v.label, v.min_age, v.max_age, v.term_years, v.id,
         p.is_active
    FROM public.comp_product_variants v JOIN public.comp_products p ON p.id = v.product_id
   WHERE v.grid_id = v_grid;

  SELECT count(*), count(DISTINCT (category, carrier, product)), count(DISTINCT carrier),
         count(*) FILTER (WHERE source IS NOT NULL OR notes IS NOT NULL)
    INTO v_rows, v_products, v_carriers, v_refs FROM recon_src_variants;
  SELECT count(*) INTO v_variants FROM recon_db_variants;
  SELECT count(*) INTO v_rates FROM recon_src_variants s, jsonb_each_text(s.rate_cells) r
   WHERE coalesce(r.value, '') <> '';

  SELECT count(*) INTO d_products FROM (
    (SELECT category, carrier, product FROM recon_src_variants
     EXCEPT SELECT p.category, p.carrier, p.product_name FROM public.comp_products p WHERE p.grid_id = v_grid)
    UNION ALL
    (SELECT p.category, p.carrier, p.product_name FROM public.comp_products p WHERE p.grid_id = v_grid
     EXCEPT SELECT category, carrier, product FROM recon_src_variants)) x;
  SELECT count(*) INTO d_variants FROM (
    (SELECT category, carrier, product, label, min_age, max_age, term_years FROM recon_src_variants
     EXCEPT ALL SELECT category, carrier, product, label, min_age, max_age, term_years FROM recon_db_variants)
    UNION ALL
    (SELECT category, carrier, product, label, min_age, max_age, term_years FROM recon_db_variants
     EXCEPT ALL SELECT category, carrier, product, label, min_age, max_age, term_years FROM recon_src_variants)) x;
  SELECT count(*) INTO d_rates FROM (
    (SELECT s.category, s.carrier, s.product, s.label, r.key::integer AS level, r.value AS rate
       FROM recon_src_variants s, jsonb_each_text(s.rate_cells) r WHERE coalesce(r.value, '') <> ''
     EXCEPT ALL
     SELECT d.category, d.carrier, d.product, d.label, x.contract_level, x.rate_percent::text
       FROM recon_db_variants d JOIN public.comp_rates x ON x.variant_id = d.id)
    UNION ALL
    (SELECT d.category, d.carrier, d.product, d.label, x.contract_level, x.rate_percent::text
       FROM recon_db_variants d JOIN public.comp_rates x ON x.variant_id = d.id
     EXCEPT ALL
     SELECT s.category, s.carrier, s.product, s.label, r.key::integer, r.value
       FROM recon_src_variants s, jsonb_each_text(s.rate_cells) r WHERE coalesce(r.value, '') <> '')) x;
  SELECT count(*) INTO d_refs FROM (
    (SELECT category, carrier, product, label, source, notes FROM recon_src_variants
      WHERE source IS NOT NULL OR notes IS NOT NULL
     EXCEPT ALL
     SELECT d.category, d.carrier, d.product, d.label, x.source, x.notes
       FROM recon_db_variants d JOIN public.comp_variant_references x ON x.variant_id = d.id)
    UNION ALL
    (SELECT d.category, d.carrier, d.product, d.label, x.source, x.notes
       FROM recon_db_variants d JOIN public.comp_variant_references x ON x.variant_id = d.id
     EXCEPT ALL
     SELECT category, carrier, product, label, source, notes FROM recon_src_variants
      WHERE source IS NOT NULL OR notes IS NOT NULL)) x;
  SELECT g.contract_levels IS DISTINCT FROM ARRAY[145,140,135,130,125,120,115,110,105,100,95,90,85,80,75,70,65]
    INTO d_levels FROM public.comp_grids g WHERE g.id = v_grid;
  SELECT count(*) INTO d_inactive FROM public.comp_products p WHERE p.grid_id = v_grid AND NOT p.is_active;

  RAISE NOTICE 'reconciliation counts: csv_rows=% products=% variants_stored=% carriers=% rate_cells=% references=%',
    v_rows, v_products, v_variants, v_carriers, v_rates, v_refs;
  RAISE NOTICE 'reconciliation differences: products=% variants=% rate_cells=% references=% levels=% inactive_products=%',
    d_products, d_variants, d_rates, d_refs, d_levels, d_inactive;
  IF d_products + d_variants + d_rates + d_refs + d_inactive > 0 OR d_levels THEN
    RAISE EXCEPTION 'reconciliation FAIL';
  END IF;
  RAISE NOTICE 'reconciliation PASS';
END $recon$;
