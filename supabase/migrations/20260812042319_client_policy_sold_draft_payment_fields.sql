-- =====================================================================================================
-- Convert to Client — Sold Date, Draft Date, Payment Frequency (approved plan, implementation_plan.md)
-- =====================================================================================================
-- Adds the business policy-schedule fields:
--   clients.sold_date         date  — business-effective sale date of the primary policy (editable).
--   clients.draft_date        date  — next known scheduled premium draft date (a full date, never
--                                     reduced to a day-of-month; future automations anchor on it).
--   clients.payment_frequency text  — canonical draft cadence, CHECK-constrained.
--   wins.sold_date            date  — business sale date stamped at win creation.
--
-- Contracts (Chris-approved D1/D3/D4):
--   * wins.created_at remains the system-event timestamp and the ONLY reporting bucket. No reporting
--     surface reads sold_date in this build; moving reporting onto sold_date requires a separately
--     approved semantics migration.
--   * payment_frequency is draft-schedule metadata ONLY. clients.premium / wins.premium_amount stay
--     MONTHLY dollars; no ×12 annualization logic changes.
--   * clients.issue_date is retired from the default UI but PRESERVED as legacy storage — not dropped,
--     not renamed, not backfilled, not repurposed. convert_lead_to_client_atomic still accepts it.
--   * All new columns are nullable with no defaults — historical/manual records legitimately lack the
--     information; no backfill (and never derived from effective_date/issue_date).
--
-- No RLS change: the new columns inherit the existing row-level org policies on clients/wins, and both
-- tables carry table-level grants (no column-scoped ACLs to extend).

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sold_date date;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS draft_date date;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS payment_frequency text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_payment_frequency_check' AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_payment_frequency_check
      CHECK (payment_frequency IS NULL OR payment_frequency IN ('monthly', 'quarterly', 'semi_annual', 'annual'));
  END IF;
END
$$;

COMMENT ON COLUMN public.clients.sold_date IS
  'Business-effective sale date of the primary policy (agent-entered, editable for prior-date sales). Never derived from effective_date or issue_date. issue_date remains legacy storage.';
COMMENT ON COLUMN public.clients.draft_date IS
  'Next known scheduled premium draft date (full calendar date — never day-of-month only). Reliable anchor for future draft-reminder automation; no automation reads it yet.';
COMMENT ON COLUMN public.clients.payment_frequency IS
  'Premium draft cadence: monthly | quarterly | semi_annual | annual. Schedule metadata ONLY — clients.premium stays monthly dollars regardless of this value.';

ALTER TABLE public.wins ADD COLUMN IF NOT EXISTS sold_date date;

COMMENT ON COLUMN public.wins.sold_date IS
  'Business-effective sale date entered by the agent at win creation. wins.created_at remains the system-event timestamp and the reporting bucket for every current surface; do not point reporting at sold_date without a separately approved semantics migration.';

-- -----------------------------------------------------------------------------------------------------
-- convert_lead_to_client_atomic — body restated verbatim from the baseline with EXACTLY these additions:
--   * p_client keys read: sold_date, draft_date (both NULLIF(...,'')::date) and payment_frequency
--     (normalized to lower/underscore, validated against the canonical set, invalid → error 22023).
--   * INSERT column list gains sold_date, draft_date, payment_frequency.
-- Everything else (auth, org guard, authorization, double idempotency, contact-graph transfer, lead
-- delete, return shape) is unchanged. CREATE OR REPLACE preserves owner + existing grants.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."convert_lead_to_client_atomic"("p_lead_id" "uuid", "p_client" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org    uuid := public.get_org_id();
  v_lead   public.leads%ROWTYPE;
  v_prof   RECORD;
  v_existing uuid;
  v_client uuid;
  v_authorized boolean;
  v_cf jsonb;
  v_freq text;
  v_notes int := 0; v_acts int := 0; v_appts int := 0; v_tasks int := 0;
  v_calls int := 0; v_msgs int := 0; v_msgs2 int := 0; v_emails int := 0; v_wf int := 0;
  v_campaign_rows int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_org' USING ERRCODE = '28000'; END IF;

  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_lead.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'cross_org' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.organization_id, p.is_super_admin
    INTO v_prof FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND OR v_prof.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_authorized :=
       (v_lead.user_id = v_uid)
    OR (v_lead.assigned_agent_id = v_uid)
    OR (v_lead.user_id IS NULL AND v_lead.assigned_agent_id IS NULL)
    OR (v_prof.role = 'Admin')
    OR (COALESCE(v_prof.is_super_admin, false) AND v_prof.organization_id = v_org)
    OR (v_prof.role IN ('Team Leader','Team Lead') AND (
          public.is_ancestor_of(v_uid, v_lead.user_id)
       OR public.is_ancestor_of(v_uid, v_lead.assigned_agent_id)));
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;

  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  v_cf := CASE WHEN p_client ? 'custom_fields' AND jsonb_typeof(p_client->'custom_fields') = 'object'
               THEN p_client->'custom_fields' ELSE NULL END;

  -- Canonical payment frequency: blank → NULL; normalized spelling; anything else is a caller bug.
  v_freq := lower(replace(btrim(COALESCE(p_client->>'payment_frequency', '')), '-', '_'));
  v_freq := NULLIF(replace(v_freq, ' ', '_'), '');
  IF v_freq IS NOT NULL AND v_freq NOT IN ('monthly', 'quarterly', 'semi_annual', 'annual') THEN
    RAISE EXCEPTION 'invalid_payment_frequency' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clients (
    first_name, last_name, phone, email,
    policy_type, carrier, policy_number, premium, face_amount, issue_date, effective_date,
    sold_date, draft_date, payment_frequency,
    beneficiary_name, beneficiary_relationship, beneficiary_phone, notes,
    assigned_agent_id, organization_id, custom_fields, lead_id
  ) VALUES (
    v_lead.first_name, v_lead.last_name, v_lead.phone, v_lead.email,
    COALESCE(NULLIF(p_client->>'policy_type', ''), 'Term'),
    COALESCE(p_client->>'carrier', ''),
    COALESCE(p_client->>'policy_number', ''),
    COALESCE((p_client->>'premium')::numeric, 0),
    COALESCE((p_client->>'face_amount')::numeric, 0),
    NULLIF(p_client->>'issue_date', ''),
    NULLIF(p_client->>'effective_date', ''),
    (NULLIF(p_client->>'sold_date', ''))::date,
    (NULLIF(p_client->>'draft_date', ''))::date,
    v_freq,
    NULLIF(p_client->>'beneficiary_name', ''),
    NULLIF(p_client->>'beneficiary_relationship', ''),
    NULLIF(p_client->>'beneficiary_phone', ''),
    COALESCE(NULLIF(p_client->>'notes', ''), v_lead.notes),
    v_lead.assigned_agent_id,
    v_org,
    v_cf,
    p_lead_id
  ) RETURNING id INTO v_client;

  UPDATE public.contact_notes SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  UPDATE public.contact_activities SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_acts = ROW_COUNT;

  UPDATE public.appointments SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_appts = ROW_COUNT;

  UPDATE public.tasks SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  UPDATE public.calls SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_calls = ROW_COUNT;

  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_msgs = ROW_COUNT;
  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE lead_id = p_lead_id AND contact_id IS NULL;
  GET DIAGNOSTICS v_msgs2 = ROW_COUNT;

  UPDATE public.contact_emails SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_emails = ROW_COUNT;

  UPDATE public.workflow_executions SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  SELECT count(*) INTO v_campaign_rows FROM public.campaign_leads WHERE lead_id = p_lead_id;

  DELETE FROM public.leads WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'client_id', v_client,
    'idempotent', false,
    'transferred', jsonb_build_object(
      'notes', v_notes, 'activities', v_acts, 'appointments', v_appts, 'tasks', v_tasks,
      'calls', v_calls, 'messages', v_msgs + v_msgs2, 'contact_emails', v_emails,
      'workflow_executions', v_wf),
    'campaign_outcome', jsonb_build_object('campaign_leads_preserved', v_campaign_rows)
  );
END;
$$;

-- -----------------------------------------------------------------------------------------------------
-- _contacts_filtered_clients — body restated verbatim from the baseline with EXACTLY these additions:
--   * base CTE selects c.sold_date;
--   * sort key WHEN 'sold_date' THEN b.sold_date::text (date::text is ISO YYYY-MM-DD → chronological,
--     same contract as the existing issue_date text sort; NULLS LAST via the existing window ordering).
-- issue_date stays sortable (legacy compat). search_contacts_clients / contacts_client_ids_matching
-- delegate here and return whole rows (to_jsonb), so they need no change.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."_contacts_filtered_clients"("p_filters" "jsonb") RETURNS TABLE("id" "uuid", "ord" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH base AS (
    SELECT
      c.id, c.created_at, c.first_name, c.last_name, c.phone, c.email, c.state,
      c.policy_type, c.carrier, c.premium, c.face_amount, c.issue_date, c.sold_date,
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, ''))) END AS agent_sort
    FROM public.clients c
    LEFT JOIN public.profiles pa ON pa.id = c.assigned_agent_id
    WHERE
      (
        p_filters->'assigned_agent_ids' IS NULL
        OR jsonb_typeof(p_filters->'assigned_agent_ids') <> 'array'
        OR c.assigned_agent_id = ANY (ARRAY(SELECT (jsonb_array_elements_text(p_filters->'assigned_agent_ids'))::uuid))
      )
      AND (p_filters->>'state'       IS NULL OR c.state = p_filters->>'state')
      AND (p_filters->>'policy_type' IS NULL OR c.policy_type = p_filters->>'policy_type')
      AND (
        p_filters->>'search' IS NULL
        OR c.first_name ILIKE '%' || (p_filters->>'search') || '%'
        OR c.last_name  ILIKE '%' || (p_filters->>'search') || '%'
        OR c.phone      ILIKE '%' || (p_filters->>'search') || '%'
        OR c.email      ILIKE '%' || (p_filters->>'search') || '%'
      )
  ),
  keyed AS (
    SELECT
      b.id, b.created_at,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) IN ('asc', 'desc')) AS dir_ok,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) = 'asc')            AS asc_dir,
      CASE lower(coalesce(p_filters->>'sort_column', ''))
        WHEN 'name'           THEN lower(btrim(coalesce(b.last_name, '')) || ' ' || btrim(coalesce(b.first_name, '')))
        WHEN 'phone'          THEN b.phone
        WHEN 'email'          THEN lower(btrim(coalesce(b.email, '')))
        WHEN 'state'          THEN b.state
        WHEN 'policy_type'    THEN b.policy_type
        WHEN 'carrier'        THEN lower(btrim(coalesce(b.carrier, '')))
        WHEN 'issue_date'     THEN b.issue_date
        WHEN 'sold_date'      THEN b.sold_date::text
        WHEN 'assigned_agent' THEN b.agent_sort
        ELSE NULL
      END AS text_key,
      CASE lower(coalesce(p_filters->>'sort_column', ''))
        WHEN 'premium'     THEN b.premium
        WHEN 'face_amount' THEN b.face_amount
        ELSE NULL
      END AS num_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column', '')) = 'created_at' THEN b.created_at ELSE NULL END AS ts_key
    FROM base b
  )
  SELECT
    k.id,
    row_number() OVER (
      ORDER BY
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.text_key END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.text_key END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.num_key  END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.num_key  END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.ts_key   END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.ts_key   END DESC NULLS LAST,
        k.created_at DESC, k.id DESC
    ) AS ord
  FROM keyed k;
$$;
