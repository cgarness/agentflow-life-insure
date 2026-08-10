-- ============================================================================
-- Build 2b · Phase 2 — State normalization to 2-letter USPS codes
-- ============================================================================
-- Canonical state representation across the app is the 2-letter USPS code
-- (50 states + DC). Source data is split-format: agent_state_licenses holds full
-- names ("California"); leads / campaign_leads are mostly 2-letter with some full
-- names + blanks. This migration introduces ONE canonical SQL normalizer and runs
-- a one-time backfill so Phase 3's licensed-state filter compares clean 2-letter
-- data on both sides (lead state vs. agent_state_licenses.state).
--
-- Parity contract (must stay IDENTICAL in all three implementations):
--   • SQL  : public.normalize_us_state(text)        — THIS function (canonical)
--   • TS   : normalizeUsState() in src/utils/stateUtils.ts (going-forward writes)
--   • Deno : normalizeUsState() in supabase/functions/import-contacts/index.ts
--   Behavior: trim + case-insensitive recognition; a valid 2-letter code → its
--   UPPERCASE form; a full state name (50 + DC) → its code; blanks (NULL / empty /
--   whitespace) and UNRECOGNIZED values (territories like PR/GU/VI, typos, non-US)
--   are returned UNCHANGED ("don't invent"). Recognized inputs map to identical
--   codes everywhere — that identity is what prevents Phase 3 from dropping leads.
--
-- EXCLUSIONS: does NOT touch email_oauth_states.state (OAuth token) or
-- area_code_mapping.state (full-name reference table for Local Presence).
--
-- *** FILE ONLY — PENDING APPLY. Do NOT apply standalone. When applying Build 2b,
--     apply THIS migration BEFORE 20260608170100_licensed_state_access.sql so the
--     filter compares normalized data. ***
-- ============================================================================

-- 1. Canonical normalizer ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_us_state(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_trim  text;
  v_upper text;
  v_code  text;
BEGIN
  -- Blanks (NULL / empty / whitespace-only) are left untouched.
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN
    RETURN p_raw;
  END IF;

  v_trim  := btrim(p_raw);
  v_upper := upper(v_trim);

  -- Already a valid 2-letter USPS code → canonical uppercase.
  IF v_upper IN (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC'
  ) THEN
    RETURN v_upper;
  END IF;

  -- Full state name (case-insensitive) → code.
  v_code := CASE lower(v_trim)
    WHEN 'alabama'              THEN 'AL'
    WHEN 'alaska'              THEN 'AK'
    WHEN 'arizona'             THEN 'AZ'
    WHEN 'arkansas'            THEN 'AR'
    WHEN 'california'          THEN 'CA'
    WHEN 'colorado'            THEN 'CO'
    WHEN 'connecticut'         THEN 'CT'
    WHEN 'delaware'            THEN 'DE'
    WHEN 'florida'             THEN 'FL'
    WHEN 'georgia'             THEN 'GA'
    WHEN 'hawaii'              THEN 'HI'
    WHEN 'idaho'               THEN 'ID'
    WHEN 'illinois'            THEN 'IL'
    WHEN 'indiana'             THEN 'IN'
    WHEN 'iowa'                THEN 'IA'
    WHEN 'kansas'              THEN 'KS'
    WHEN 'kentucky'            THEN 'KY'
    WHEN 'louisiana'           THEN 'LA'
    WHEN 'maine'               THEN 'ME'
    WHEN 'maryland'            THEN 'MD'
    WHEN 'massachusetts'       THEN 'MA'
    WHEN 'michigan'            THEN 'MI'
    WHEN 'minnesota'           THEN 'MN'
    WHEN 'mississippi'         THEN 'MS'
    WHEN 'missouri'            THEN 'MO'
    WHEN 'montana'             THEN 'MT'
    WHEN 'nebraska'            THEN 'NE'
    WHEN 'nevada'              THEN 'NV'
    WHEN 'new hampshire'       THEN 'NH'
    WHEN 'new jersey'          THEN 'NJ'
    WHEN 'new mexico'          THEN 'NM'
    WHEN 'new york'            THEN 'NY'
    WHEN 'north carolina'      THEN 'NC'
    WHEN 'north dakota'        THEN 'ND'
    WHEN 'ohio'                THEN 'OH'
    WHEN 'oklahoma'            THEN 'OK'
    WHEN 'oregon'              THEN 'OR'
    WHEN 'pennsylvania'        THEN 'PA'
    WHEN 'rhode island'        THEN 'RI'
    WHEN 'south carolina'      THEN 'SC'
    WHEN 'south dakota'        THEN 'SD'
    WHEN 'tennessee'           THEN 'TN'
    WHEN 'texas'               THEN 'TX'
    WHEN 'utah'                THEN 'UT'
    WHEN 'vermont'             THEN 'VT'
    WHEN 'virginia'            THEN 'VA'
    WHEN 'washington'          THEN 'WA'
    WHEN 'west virginia'       THEN 'WV'
    WHEN 'wisconsin'           THEN 'WI'
    WHEN 'wyoming'             THEN 'WY'
    WHEN 'district of columbia' THEN 'DC'
    ELSE NULL
  END;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  -- Unrecognized (territories, typos, non-US): leave untouched. Don't invent.
  RETURN p_raw;
END;
$$;

COMMENT ON FUNCTION public.normalize_us_state(text) IS
  'Canonical US state normalizer → 2-letter USPS code (50 states + DC). '
  'Trim + case-insensitive; valid 2-letter → uppercase; full name → code; '
  'blanks/unrecognized returned unchanged. Mirror of TS/Deno normalizeUsState (Build 2b).';

-- 2. One-time backfill (calls the canonical function — no inline map) ---------
DO $do$
DECLARE
  v_leads        int;
  v_clients      int;
  v_recruits     int;
  v_cl           int;
  v_asl          int;
  v_unrecognized text;
BEGIN
  UPDATE public.leads SET state = public.normalize_us_state(state)
    WHERE state IS DISTINCT FROM public.normalize_us_state(state);
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  UPDATE public.clients SET state = public.normalize_us_state(state)
    WHERE state IS DISTINCT FROM public.normalize_us_state(state);
  GET DIAGNOSTICS v_clients = ROW_COUNT;

  UPDATE public.recruits SET state = public.normalize_us_state(state)
    WHERE state IS DISTINCT FROM public.normalize_us_state(state);
  GET DIAGNOSTICS v_recruits = ROW_COUNT;

  UPDATE public.campaign_leads SET state = public.normalize_us_state(state)
    WHERE state IS DISTINCT FROM public.normalize_us_state(state);
  GET DIAGNOSTICS v_cl = ROW_COUNT;

  UPDATE public.agent_state_licenses SET state = public.normalize_us_state(state)
    WHERE state IS DISTINCT FROM public.normalize_us_state(state);
  GET DIAGNOSTICS v_asl = ROW_COUNT;

  RAISE NOTICE 'normalize_us_state backfill rows changed: leads=%, clients=%, recruits=%, campaign_leads=%, agent_state_licenses=%',
    v_leads, v_clients, v_recruits, v_cl, v_asl;

  -- Surface any non-blank values that did NOT resolve to a valid 2-letter code
  -- (territories, typos, non-US). These were left untouched — report, don't guess.
  SELECT string_agg(DISTINCT q.val, ', ' ORDER BY q.val) INTO v_unrecognized
  FROM (
    SELECT state AS val FROM public.leads
    UNION ALL SELECT state FROM public.clients
    UNION ALL SELECT state FROM public.recruits
    UNION ALL SELECT state FROM public.campaign_leads
    UNION ALL SELECT state FROM public.agent_state_licenses
  ) q
  WHERE q.val IS NOT NULL
    AND btrim(q.val) <> ''
    AND public.normalize_us_state(q.val) NOT IN (
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
      'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
      'VA','WA','WV','WI','WY','DC'
    );

  IF v_unrecognized IS NULL THEN
    RAISE NOTICE 'normalize_us_state: no unrecognized non-blank state values remain.';
  ELSE
    RAISE WARNING 'normalize_us_state: unrecognized non-blank state values left UNTOUCHED: %', v_unrecognized;
  END IF;
END
$do$;

-- 3. D2 — enqueue path: normalize the denormalized state copy ------------------
--    add_leads_to_campaign copies leads.state -> campaign_leads.state server-side
--    (the only server writer of campaign_leads.state). Wrap that copy in the
--    canonical normalizer so the queue's denormalized geographic column stays
--    2-letter even if a legacy/unnormalized leads.state slips through. This is the
--    EXACT live body (captured via pg_get_functiondef) with ONE changed line:
--    'state' now uses public.normalize_us_state(v_lead.state).
CREATE OR REPLACE FUNCTION public.add_leads_to_campaign(p_campaign_id uuid, p_lead_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign RECORD;
  v_campaign_type TEXT;
  v_campaign_user_id UUID;
  v_lead RECORD;
  v_lead_id UUID;
  v_valid_leads JSONB := '[]'::JSONB;
  v_skipped_ids UUID[] := ARRAY[]::UUID[];
  v_added INT := 0;
  v_skipped INT := 0;
  v_already_exists BOOLEAN;
BEGIN
  -- 1. Org guard
  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND organization_id = public.get_org_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  v_campaign_type := v_campaign.type;
  v_campaign_user_id := v_campaign.user_id;

  -- 2. Loop over lead IDs
  FOREACH v_lead_id IN ARRAY p_lead_ids
  LOOP
    -- Fetch lead with org check
    SELECT * INTO v_lead
    FROM public.leads
    WHERE id = v_lead_id
      AND organization_id = public.get_org_id();

    IF NOT FOUND THEN
      v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Dedup check
    SELECT EXISTS (
      SELECT 1 FROM public.campaign_leads
      WHERE campaign_id = p_campaign_id
        AND lead_id = v_lead_id
    ) INTO v_already_exists;

    IF v_already_exists THEN
      v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Ownership validation by campaign type
    IF v_campaign_type = 'Personal' THEN
      IF v_lead.assigned_agent_id IS DISTINCT FROM v_campaign_user_id THEN
        v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

    ELSIF v_campaign_type = 'Team' THEN
      IF NOT (
        v_lead.assigned_agent_id = v_campaign_user_id
        OR public.is_ancestor_of(v_campaign_user_id, v_lead.assigned_agent_id)
      ) THEN
        v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

    ELSIF v_campaign_type IN ('Open', 'Open Pool') THEN
      -- Only org check already done above
      NULL;
    END IF;

    -- Valid lead — add to batch (state normalized to canonical 2-letter, Build 2b)
    v_valid_leads := v_valid_leads || jsonb_build_object(
      'campaign_id', p_campaign_id,
      'lead_id', v_lead_id,
      'first_name', v_lead.first_name,
      'last_name', v_lead.last_name,
      'phone', v_lead.phone,
      'email', v_lead.email,
      'state', public.normalize_us_state(v_lead.state),
      'age', v_lead.age,
      'status', 'Queued',
      'organization_id', public.get_org_id()
    );
    v_added := v_added + 1;
  END LOOP;

  -- 3. Batch insert valid leads
  IF v_added > 0 THEN
    INSERT INTO public.campaign_leads (
      campaign_id, lead_id, first_name, last_name,
      phone, email, state, age, status, organization_id
    )
    SELECT
      (el->>'campaign_id')::UUID,
      (el->>'lead_id')::UUID,
      el->>'first_name',
      el->>'last_name',
      el->>'phone',
      el->>'email',
      el->>'state',
      NULLIF(el->>'age', '')::INTEGER,
      el->>'status',
      (el->>'organization_id')::UUID
    FROM jsonb_array_elements(v_valid_leads) AS el;
  END IF;

  RETURN jsonb_build_object(
    'added', v_added,
    'skipped', v_skipped,
    'skipped_ids', to_jsonb(v_skipped_ids)
  );
END;
$function$;

-- 4. Reload PostgREST schema cache (new function in the API surface).
NOTIFY pgrst, 'reload schema';
