-- Migration: backfill_legacy_licenses
-- Date: 2026-05-22
-- Goal: Idempotently backfill legacy profiles.licensed_states data to agent_state_licenses.

DO $$
BEGIN
  -- Insert legacy records into agent_state_licenses
  INSERT INTO public.agent_state_licenses (agent_id, organization_id, state, license_number)
  SELECT 
    id as agent_id, 
    organization_id, 
    CASE 
      WHEN TRIM(raw_state) IN ('AL', 'al') THEN 'Alabama'
      WHEN TRIM(raw_state) IN ('AK', 'ak') THEN 'Alaska'
      WHEN TRIM(raw_state) IN ('AZ', 'az') THEN 'Arizona'
      WHEN TRIM(raw_state) IN ('AR', 'ar') THEN 'Arkansas'
      WHEN TRIM(raw_state) IN ('CA', 'ca') THEN 'California'
      WHEN TRIM(raw_state) IN ('CO', 'co') THEN 'Colorado'
      WHEN TRIM(raw_state) IN ('CT', 'ct') THEN 'Connecticut'
      WHEN TRIM(raw_state) IN ('DE', 'de') THEN 'Delaware'
      WHEN TRIM(raw_state) IN ('FL', 'fl') THEN 'Florida'
      WHEN TRIM(raw_state) IN ('GA', 'ga') THEN 'Georgia'
      WHEN TRIM(raw_state) IN ('HI', 'hi') THEN 'Hawaii'
      WHEN TRIM(raw_state) IN ('ID', 'id') THEN 'Idaho'
      WHEN TRIM(raw_state) IN ('IL', 'il') THEN 'Illinois'
      WHEN TRIM(raw_state) IN ('IN', 'in') THEN 'Indiana'
      WHEN TRIM(raw_state) IN ('IA', 'ia') THEN 'Iowa'
      WHEN TRIM(raw_state) IN ('KS', 'ks') THEN 'Kansas'
      WHEN TRIM(raw_state) IN ('KY', 'ky') THEN 'Kentucky'
      WHEN TRIM(raw_state) IN ('LA', 'la') THEN 'Louisiana'
      WHEN TRIM(raw_state) IN ('ME', 'me') THEN 'Maine'
      WHEN TRIM(raw_state) IN ('MD', 'md') THEN 'Maryland'
      WHEN TRIM(raw_state) IN ('MA', 'ma') THEN 'Massachusetts'
      WHEN TRIM(raw_state) IN ('MI', 'mi') THEN 'Michigan'
      WHEN TRIM(raw_state) IN ('MN', 'mn') THEN 'Minnesota'
      WHEN TRIM(raw_state) IN ('MS', 'ms') THEN 'Mississippi'
      WHEN TRIM(raw_state) IN ('MO', 'mo') THEN 'Missouri'
      WHEN TRIM(raw_state) IN ('MT', 'mt') THEN 'Montana'
      WHEN TRIM(raw_state) IN ('NE', 'ne') THEN 'Nebraska'
      WHEN TRIM(raw_state) IN ('NV', 'nv') THEN 'Nevada'
      WHEN TRIM(raw_state) IN ('NH', 'nh') THEN 'New Hampshire'
      WHEN TRIM(raw_state) IN ('NJ', 'nj') THEN 'New Jersey'
      WHEN TRIM(raw_state) IN ('NM', 'nm') THEN 'New Mexico'
      WHEN TRIM(raw_state) IN ('NY', 'ny') THEN 'New York'
      WHEN TRIM(raw_state) IN ('NC', 'nc') THEN 'North Carolina'
      WHEN TRIM(raw_state) IN ('ND', 'nd') THEN 'North Dakota'
      WHEN TRIM(raw_state) IN ('OH', 'oh') THEN 'Ohio'
      WHEN TRIM(raw_state) IN ('OK', 'ok') THEN 'Oklahoma'
      WHEN TRIM(raw_state) IN ('OR', 'or') THEN 'Oregon'
      WHEN TRIM(raw_state) IN ('PA', 'pa') THEN 'Pennsylvania'
      WHEN TRIM(raw_state) IN ('RI', 'ri') THEN 'Rhode Island'
      WHEN TRIM(raw_state) IN ('SC', 'sc') THEN 'South Carolina'
      WHEN TRIM(raw_state) IN ('SD', 'sd') THEN 'South Dakota'
      WHEN TRIM(raw_state) IN ('TN', 'tn') THEN 'Tennessee'
      WHEN TRIM(raw_state) IN ('TX', 'tx') THEN 'Texas'
      WHEN TRIM(raw_state) IN ('UT', 'ut') THEN 'Utah'
      WHEN TRIM(raw_state) IN ('VT', 'vt') THEN 'Vermont'
      WHEN TRIM(raw_state) IN ('VA', 'va') THEN 'Virginia'
      WHEN TRIM(raw_state) IN ('WA', 'wa') THEN 'Washington'
      WHEN TRIM(raw_state) IN ('WV', 'wv') THEN 'West Virginia'
      WHEN TRIM(raw_state) IN ('WI', 'wi') THEN 'Wisconsin'
      WHEN TRIM(raw_state) IN ('WY', 'wy') THEN 'Wyoming'
      WHEN TRIM(raw_state) IN ('DC', 'dc') THEN 'District of Columbia'
      ELSE TRIM(raw_state)
    END as state,
    NULLIF(TRIM(license_number), '') as license_number
  FROM (
    SELECT 
      id, 
      organization_id, 
      CASE 
        WHEN jsonb_typeof(elem) = 'object' THEN elem->>'state'
        WHEN jsonb_typeof(elem) = 'string' THEN elem #>> '{}'
        ELSE NULL 
      END as raw_state,
      CASE 
        WHEN jsonb_typeof(elem) = 'object' THEN elem->>'licenseNumber'
        ELSE NULL 
      END as license_number
    FROM public.profiles,
    LATERAL jsonb_array_elements(licensed_states) as elem
    WHERE licensed_states IS NOT NULL AND jsonb_array_length(licensed_states) > 0
  ) sub
  WHERE raw_state IS NOT NULL AND TRIM(raw_state) <> ''
  ON CONFLICT (agent_id, state) DO NOTHING;
END $$;
