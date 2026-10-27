-- =====================================================================================================
-- Google Sheets mapping v2 → v1 (ROLLBACK AID). NOT RUN. Needs Chris's separate approval, and only before an Edge
-- rollback to code that predates mapping v2 (that code refuses a v2 mapping and the source would go to Needs review).
--   psql "$DB" -1 -v ON_ERROR_STOP=1 -v confirm='DOWNGRADE-V2-MAPPINGS' -f supabase/ops/google_sheets_mapping_v2_to_v1.sql
-- For every source whose mapping is v2: keeps the EXACT same columns (header → field), drops only the acknowledged
-- `ignored` list, sets v = 1 and bumps config_version (an in-flight run then finishes stale and the next run uses the
-- v1 mapping). Imports continue with raw (v1) custom values. Leads, receipts, the identity ledger, connections and
-- every other source field are untouched; identity (fingerprints, Lead ID keys) does not depend on the version.
-- =====================================================================================================
CREATE TEMP TABLE v2v1_input AS SELECT :'confirm'::text AS confirm;

DO $down$
DECLARE n int;
BEGIN
  IF (SELECT confirm FROM v2v1_input) IS DISTINCT FROM 'DOWNGRADE-V2-MAPPINGS' THEN RAISE EXCEPTION 'confirm is required'; END IF;
  PERFORM 1 FROM public.google_sheets_sources WHERE mapping->>'v' = '2' FOR UPDATE;
  UPDATE public.google_sheets_sources
     SET mapping = jsonb_build_object('v', 1, 'columns', mapping->'columns'), config_version = config_version + 1, updated_at = now()
   WHERE mapping->>'v' = '2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF EXISTS (SELECT 1 FROM public.google_sheets_sources WHERE mapping->>'v' = '2') THEN RAISE EXCEPTION 'v2 mappings remain'; END IF;
  RAISE NOTICE 'google sheets: % mapping(s) downgraded to v1 (columns unchanged)', n;
END
$down$;
