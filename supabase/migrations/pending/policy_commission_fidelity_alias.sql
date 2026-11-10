-- Fidelity carrier aliases only. No policy, sale, estimate, grant or owner changes.
-- Requires separate exact production approval. Run atomically; historical migrations remain immutable.
-- Generated with Supabase CLI 2.84.5, source version 20261110201839; pending release approval.
DO $fidelity_alias$
DECLARE
  target regprocedure := 'private.policy_commission_evaluate(jsonb,jsonb,jsonb,jsonb,text)'::regprocedure;
  before_metadata jsonb;
  after_metadata jsonb;
  definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc' INTO definition, before_metadata
    FROM pg_proc p WHERE p.oid = target;
  IF md5(definition) IS DISTINCT FROM 'f1e6cbc2e17d2ca2c2b8652ce8a5e6d1'
     OR pg_get_userbyid((before_metadata->>'proowner')::oid) IS DISTINCT FROM 'postgres'
     OR (before_metadata->>'prosecdef')::boolean IS DISTINCT FROM false
     OR before_metadata->>'provolatile' IS DISTINCT FROM 'i'
     OR before_metadata->'proconfig' IS DISTINCT FROM '["search_path=pg_catalog, pg_temp"]'::jsonb
     OR (SELECT proacl::text FROM pg_proc WHERE oid = target)
        IS DISTINCT FROM '{postgres=X/postgres,agentflow_policy_commission_writer=X/postgres}' THEN
    RAISE EXCEPTION 'Fidelity alias preimage or security metadata drift; review before applying' USING ERRCODE = '55000';
  END IF;
  definition := replace(definition, $old$lower(regexp_replace(coalesce(p_item->'product'->>'carrier', ''), '^\s+|\s+$', '', 'g'))$old$, $new$(CASE lower(regexp_replace(coalesce(p_item->'product'->>'carrier', ''), '^\s+|\s+$', '', 'g')) WHEN 'instabrain' THEN 'fidelity life' WHEN 'fidelity' THEN 'fidelity life' WHEN 'fidelity life' THEN 'fidelity life' ELSE lower(regexp_replace(coalesce(p_item->'product'->>'carrier', ''), '^\s+|\s+$', '', 'g')) END)$new$);
  definition := replace(definition, $old$lower(regexp_replace(coalesce(p_policy->>'carrier', ''), '^\s+|\s+$', '', 'g'))$old$, $new$(CASE lower(regexp_replace(coalesce(p_policy->>'carrier', ''), '^\s+|\s+$', '', 'g')) WHEN 'instabrain' THEN 'fidelity life' WHEN 'fidelity' THEN 'fidelity life' WHEN 'fidelity life' THEN 'fidelity life' ELSE lower(regexp_replace(coalesce(p_policy->>'carrier', ''), '^\s+|\s+$', '', 'g')) END)$new$);
  IF md5(definition) IS DISTINCT FROM '74e05e9bcab074d959c9ed6896bf0f20' THEN
    RAISE EXCEPTION 'Fidelity alias replacement differs from reviewed postimage' USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
  SELECT to_jsonb(p) - 'prosrc' INTO after_metadata FROM pg_proc p WHERE p.oid = target;
  IF before_metadata IS DISTINCT FROM after_metadata
     OR md5(pg_get_functiondef(target)) IS DISTINCT FROM '74e05e9bcab074d959c9ed6896bf0f20' THEN
    RAISE EXCEPTION 'Fidelity alias changed unrelated function metadata' USING ERRCODE = '55000';
  END IF;
END $fidelity_alias$;
