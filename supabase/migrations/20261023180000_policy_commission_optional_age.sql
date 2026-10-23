-- Allow a genuinely unknown insured age only for products with no age-bound compensation variants.
-- Code branch: chatgpt/commission-age-optional-20261023. Local disposable-database testing only; NO production authorization.
-- Existing commission write functions, RLS, role grants, sale writers, historical amounts and receipts remain unchanged.
-- Prerequisite: policy_commission_tracking + expected_windows + center + insights.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE r record;
BEGIN
  IF to_regclass('public.policy_commission_captures') IS NULL
     OR to_regclass('public.policy_commission_estimates') IS NULL
     OR to_regprocedure('public.record_policy_commission_estimate_later(uuid,uuid,jsonb,uuid,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'optional insured age requires saved policy commissions';
  END IF;
  -- Refuse replay or a changed column shape. The deployed tables currently disallow NULL in both.
  IF (SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'public.policy_commission_captures'::regclass
        AND a.attname = 'insured_age' AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM TRUE
     OR (SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'public.policy_commission_estimates'::regclass
        AND a.attname = 'insured_age' AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'optional insured age already applied or column drift; refusing replay';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('private.policy_commission_valid_slot(jsonb,boolean)', '34f369b701745683107e77c5304dddfb'),
      ('private.policy_commission_grid_facts(uuid,jsonb)', '034fbd8853d749ad95daa62e192b2598')
    ) v(signature,digest)
  LOOP
    IF to_regprocedure(r.signature) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(r.signature))) <> r.digest THEN
      RAISE EXCEPTION 'optional insured age: % differs from reviewed preimage; refusing', r.signature;
    END IF;
  END LOOP;
END $guard$;

-- A NULL means "unknown/not needed", never "age zero". Existing 0..100 checks still reject bad non-NULL ages.
ALTER TABLE public.policy_commission_captures ALTER COLUMN insured_age DROP NOT NULL;
ALTER TABLE public.policy_commission_estimates ALTER COLUMN insured_age DROP NOT NULL;

-- Keep all other payload keys, exact numeric constraints, original writer role and immutable audit path unchanged.
CREATE OR REPLACE FUNCTION private.policy_commission_valid_slot(p jsonb, p_with_slot boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  -- Fails closed: any NULL along the way (missing key, empty object) is false, never unknown.
  SELECT coalesce(jsonb_typeof(p) = 'object'
     AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) =
         (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY['credited_agent_id', 'grid_id', 'grid_revision', 'product_id',
            'variant_id', 'insured_age', 'term_years', 'contract_level', 'rate_percent', 'monthly_premium',
            'first_year_cents', 'advance_cents'] || CASE WHEN p_with_slot THEN ARRAY['slot'] ELSE ARRAY[]::text[] END) k)
     AND (NOT p_with_slot OR (jsonb_typeof(p->'slot') = 'string'
          AND (p->>'slot' = 'primary' OR p->>'slot' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')))
     AND (SELECT bool_and(jsonb_typeof(p->k) = 'string'
                          AND p->>k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            FROM unnest(ARRAY['credited_agent_id', 'grid_id', 'product_id', 'variant_id']) k)
     AND (SELECT bool_and(jsonb_typeof(p->k) = 'number' AND (p->>k)::numeric = trunc((p->>k)::numeric)
                          AND (p->>k)::numeric BETWEEN 0 AND 1000000000000)
            FROM unnest(ARRAY['grid_revision', 'contract_level', 'first_year_cents', 'advance_cents']) k)
     AND (jsonb_typeof(p->'insured_age') = 'null'
       OR (jsonb_typeof(p->'insured_age') = 'number'
           AND (p->>'insured_age')::numeric = trunc((p->>'insured_age')::numeric)
           AND (p->>'insured_age')::numeric BETWEEN 0 AND 100))
     AND (p->>'grid_revision')::numeric >= 1
     AND (p->>'contract_level')::numeric BETWEEN 1 AND 999
     AND (jsonb_typeof(p->'term_years') = 'null' OR (jsonb_typeof(p->'term_years') = 'number'
          AND (p->>'term_years')::numeric = trunc((p->>'term_years')::numeric) AND (p->>'term_years')::numeric BETWEEN 1 AND 100))
     AND jsonb_typeof(p->'rate_percent') = 'string' AND p->>'rate_percent' ~ '^\d{1,3}(\.\d{1,6})?$'
     AND (p->>'rate_percent')::numeric <= 300
     AND (p->>'rate_percent')::numeric = round((p->>'rate_percent')::numeric, 2)
     AND jsonb_typeof(p->'monthly_premium') = 'string' AND p->>'monthly_premium' ~ '^\d{1,9}(\.\d{1,2})?$'
     AND (p->>'monthly_premium')::numeric > 0, false)
$function$;

-- Preserve the original SECURITY DEFINER and owner/ACL. Product-level guard is stricter than
-- matching one unbounded variant: if any variant uses age, the unknown-age input cannot match.
CREATE OR REPLACE FUNCTION private.policy_commission_grid_facts(p_agent uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE a record; g record; v_raw text; v_level integer; v_out jsonb := '[]'::jsonb; it jsonb; pr record;
  v_age integer; v_term integer; v_termed boolean; v_count integer; v_variant_id uuid; v_variant_label text; v_kind text;
  v_rate text;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF policy_commission_authz.access(p_agent) IS NULL THEN
    RAISE EXCEPTION 'Commission access denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Invalid commission items' USING ERRCODE = '22023';
  END IF;
  SELECT gr.id, gr.revision, gr.name, gr.effective_date, gr.contract_levels INTO g
    FROM public.organization_comp_settings s
    JOIN public.comp_grids gr ON gr.id = s.calculator_grid_id AND gr.is_active
   WHERE s.organization_id = a.org_id
     AND (gr.organization_id = a.org_id OR (gr.organization_id IS NULL AND EXISTS (
            SELECT 1 FROM public.organization_comp_grids x WHERE x.organization_id = a.org_id AND x.grid_id = gr.id)));
  IF NOT FOUND THEN RETURN jsonb_build_object('grid', NULL, 'items', '[]'::jsonb); END IF;
  SELECT p.commission_level INTO v_raw FROM public.profiles p WHERE p.id = p_agent AND p.organization_id = a.org_id;
  v_level := CASE WHEN v_raw ~ '^\s*\d{1,9}%?\s*$' THEN substring(v_raw FROM '\d{1,9}')::integer END;
  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_age := (it->>'age')::integer;
    v_term := (it->>'term')::integer;
    SELECT p.id, p.category, p.carrier, p.product_name, p.is_active INTO pr
      FROM public.comp_products p WHERE p.id = (it->>'product_id')::uuid AND p.grid_id = g.id;
    IF NOT FOUND THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', it->>'key', 'product', NULL));
      CONTINUE;
    END IF;
    v_termed := EXISTS (SELECT 1 FROM public.comp_product_variants v WHERE v.product_id = pr.id AND v.term_years IS NOT NULL);
    v_variant_id := NULL; v_variant_label := NULL; v_rate := NULL;
    -- Age unknown is allowed only if the entire selected product has no age-bound variants.
    -- Mixed bounded/unbounded products must not silently resolve to a generic rate.
    IF v_age IS NULL AND EXISTS (
      SELECT 1 FROM public.comp_product_variants v
      WHERE v.product_id = pr.id AND (v.min_age IS NOT NULL OR v.max_age IS NOT NULL)
    ) THEN
      v_kind := 'age_required';
    ELSIF v_termed AND v_term IS NULL THEN
      v_kind := 'term_required';
    ELSIF NOT v_termed AND v_term IS NOT NULL THEN
      v_kind := 'term_not_applicable';
    ELSE
      SELECT count(*) INTO v_count FROM public.comp_product_variants v
       WHERE v.product_id = pr.id
         AND (v.min_age IS NULL OR v_age >= v.min_age) AND (v.max_age IS NULL OR v_age <= v.max_age)
         AND (NOT v_termed OR v_term = ANY (v.term_years));
      IF v_count > 1 THEN
        v_kind := 'ambiguous';
      ELSIF v_count = 1 THEN
        v_kind := 'matched';
        SELECT v.id, v.label INTO v_variant_id, v_variant_label FROM public.comp_product_variants v
         WHERE v.product_id = pr.id
           AND (v.min_age IS NULL OR v_age >= v.min_age) AND (v.max_age IS NULL OR v_age <= v.max_age)
           AND (NOT v_termed OR v_term = ANY (v.term_years));
        IF v_level IS NOT NULL THEN
          SELECT r.rate_percent::text INTO v_rate FROM public.comp_rates r
           WHERE r.variant_id = v_variant_id AND r.contract_level = v_level;
        END IF;
      ELSIF v_termed AND NOT EXISTS (SELECT 1 FROM public.comp_product_variants v
                                      WHERE v.product_id = pr.id AND v_term = ANY (v.term_years)) THEN
        v_kind := 'no_term';
      ELSIF NOT EXISTS (SELECT 1 FROM public.comp_product_variants v WHERE v.product_id = pr.id
                          AND (v.min_age IS NULL OR v_age >= v.min_age) AND (v.max_age IS NULL OR v_age <= v.max_age)) THEN
        v_kind := 'no_age';
      ELSE
        v_kind := 'no_age_term_combination';
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', it->>'key',
      'product', jsonb_build_object('id', pr.id, 'category', pr.category, 'carrier', pr.carrier,
                                    'name', pr.product_name, 'active', pr.is_active),
      'match', jsonb_build_object('kind', v_kind, 'variant_id', v_variant_id, 'label', v_variant_label),
      'rate', v_rate));
  END LOOP;
  RETURN jsonb_build_object(
    'grid', jsonb_build_object('id', g.id, 'revision', g.revision, 'name', g.name, 'effective_date', g.effective_date,
                               'levels', to_jsonb(g.contract_levels)),
    'level_raw', v_raw, 'level', v_level, 'items', v_out);
END $function$;

-- Smoke-read invariants; nothing is inserted or backfilled by this migration.
DO $verify$
BEGIN
  IF (SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'public.policy_commission_captures'::regclass
      AND a.attname = 'insured_age') OR
     (SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'public.policy_commission_estimates'::regclass
      AND a.attname = 'insured_age') THEN
    RAISE EXCEPTION 'optional insured age: nullable columns check failed';
  END IF;
  IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid =
       'private.policy_commission_grid_facts(uuid,jsonb)'::regprocedure) <> 'postgres'
     OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid =
       'private.policy_commission_grid_facts(uuid,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'optional insured age: owner/definer changed';
  END IF;
END $verify$;
