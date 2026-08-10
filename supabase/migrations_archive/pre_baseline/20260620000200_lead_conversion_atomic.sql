-- Migration: Contacts Build 3 — Atomic Lead-to-Client conversion + lineage/win idempotency (Checkpoint 4)
-- AUTHORED AT CHECKPOINT 4 — NOT YET APPLIED. Apply at Checkpoint 5 after the SQL suite runs on a
-- local/dev database (never production-first) and after review.
--
-- Adds: (1) clients.lead_id becomes immutable LINEAGE (FK dropped) with a partial UNIQUE index so a lead
-- converts to at most one client; (2) wins.idempotency_key + partial UNIQUE index for DB-enforced
-- conversion-win idempotency; (3) convert_lead_to_client_atomic() — one transactional SECURITY DEFINER
-- RPC that creates the client, moves the approved contact graph, preserves call/queue telemetry, and
-- deletes the lead only after every transfer succeeds.
--
-- SECURITY MODEL: a valid converter must move rows (calls/emails/appointments/tasks) RLS would hide from
-- them, so the RPC is SECURITY DEFINER (owner postgres => RLS bypassed inside). The SOLE authorization
-- boundary is explicit in-function logic: auth.uid() + public.get_org_id() (never trusted input), the lead
-- must be in the caller's home org, and the caller must be the lead owner / an unassigned-lead converter /
-- Admin / home-org Super Admin / Team-Leader-over-owner. Fixed search_path; PUBLIC/anon revoked.

------------------------------------------------------------------------------------------------------
-- 1. clients.lead_id : drop the live FK, keep as immutable source-Lead LINEAGE; one client per lead.
--    (Verified: no application code reads/writes clients.lead_id as a live relationship.)
------------------------------------------------------------------------------------------------------
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_lead_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_lead_id
  ON public.clients (lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON COLUMN public.clients.lead_id IS
  'LINEAGE (not a live FK): immutable id of the source lead this client was converted from. Survives lead deletion; unique per converted lead. Used as the conversion idempotency key.';

------------------------------------------------------------------------------------------------------
-- 1b. call_logs.lead_id : preserve source-Lead lineage through conversion.
--     call_logs is separate, write-only browser telemetry (AGENT_RULES #8) linked to a contact ONLY via
--     lead_id (no contact_id/client_id). Its FK to leads is ON DELETE SET NULL, so deleting the source
--     lead on conversion would null the linkage and orphan the telemetry. Drop the FK and keep lead_id as
--     immutable source lineage; the conversion RPC never deletes/nulls/rewrites call_logs (duration/status/
--     direction/user_id/organization_id are untouched). Verified: no contact-history/reporting reader joins
--     call_logs by lead_id (only TwilioContext writes it; control-center only checks the table exists).
ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_lead_id_fkey;

CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id
  ON public.call_logs (lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON COLUMN public.call_logs.lead_id IS
  'Legacy/source LINEAGE (not a live FK): source lead id for this browser-derived call log. Survives lead deletion (conversion). call_logs is separate write-only telemetry (AGENT_RULES #8), not contact-facing history.';

------------------------------------------------------------------------------------------------------
-- 2. wins.idempotency_key : DB-enforced conversion-win idempotency (key = ''conversion:<lead-id>'').
--    Partial UNIQUE on non-null keys; future additional-policy wins use a NULL key and are unaffected.
------------------------------------------------------------------------------------------------------
ALTER TABLE public.wins ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wins_idempotency_key
  ON public.wins (idempotency_key) WHERE idempotency_key IS NOT NULL;

------------------------------------------------------------------------------------------------------
-- 3. convert_lead_to_client_atomic(p_lead_id uuid, p_client jsonb) -> jsonb
------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_lead_to_client_atomic(
  p_lead_id uuid,
  p_client  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
  v_notes int := 0; v_acts int := 0; v_appts int := 0; v_tasks int := 0;
  v_calls int := 0; v_msgs int := 0; v_msgs2 int := 0; v_emails int := 0; v_wf int := 0;
  v_campaign_rows int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_org' USING ERRCODE = '28000'; END IF;

  -- Idempotency (fast path): already converted?
  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  -- Lock the lead.
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_lead.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'cross_org' USING ERRCODE = '42501';
  END IF;

  -- Authorize the caller (home-org enforced above; Super Admin pinned to home org).
  SELECT p.role, p.organization_id, p.is_super_admin
    INTO v_prof FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND OR v_prof.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_authorized :=
       (v_lead.user_id = v_uid)
    OR (v_lead.assigned_agent_id = v_uid)
    OR (v_lead.user_id IS NULL AND v_lead.assigned_agent_id IS NULL)          -- unassigned org-pool (Dialer Open Pool)
    OR (v_prof.role = 'Admin')
    OR (COALESCE(v_prof.is_super_admin, false) AND v_prof.organization_id = v_org)
    OR (v_prof.role IN ('Team Leader','Team Lead') AND (
          public.is_ancestor_of(v_uid, v_lead.user_id)
       OR public.is_ancestor_of(v_uid, v_lead.assigned_agent_id)));
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;

  -- Re-check idempotency under the lock (concurrent convert).
  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  v_cf := CASE WHEN p_client ? 'custom_fields' AND jsonb_typeof(p_client->'custom_fields') = 'object'
               THEN p_client->'custom_fields' ELSE NULL END;

  -- Create the client with the canonical Build 1 columns (NEVER clients.premium_amount). Ownership +
  -- org are derived from the lead/JWT, not caller-supplied. lead_id = lineage.
  INSERT INTO public.clients (
    first_name, last_name, phone, email,
    policy_type, carrier, policy_number, premium, face_amount, issue_date, effective_date,
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
    NULLIF(p_client->>'beneficiary_name', ''),
    NULLIF(p_client->>'beneficiary_relationship', ''),
    NULLIF(p_client->>'beneficiary_phone', ''),
    COALESCE(NULLIF(p_client->>'notes', ''), v_lead.notes),
    v_lead.assigned_agent_id,
    v_org,
    v_cf,
    p_lead_id
  ) RETURNING id INTO v_client;

  -- Move the approved contact graph (history follows the person).
  UPDATE public.contact_notes SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  UPDATE public.contact_activities SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_acts = ROW_COUNT;

  -- appointments has contact_id only (NO contact_type column).
  UPDATE public.appointments SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_appts = ROW_COUNT;

  UPDATE public.tasks SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  -- calls: repoint the polymorphic ref only; preserve ALL telemetry (duration, recording, disposition,
  -- provider ids, campaign_id, campaign_lead_id, lead_id are untouched).
  UPDATE public.calls SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_calls = ROW_COUNT;

  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_msgs = ROW_COUNT;
  -- messages linked only by the obsolete lead_id (no contact_id): repoint to the client too.
  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE lead_id = p_lead_id AND contact_id IS NULL;
  GET DIAGNOSTICS v_msgs2 = ROW_COUNT;

  UPDATE public.contact_emails SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_emails = ROW_COUNT;

  -- workflow_executions: repoint so none orphan; automation is non-blocking (invariant #10) so we do
  -- NOT block conversion on workflow state.
  UPDATE public.workflow_executions SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  -- Campaign queue telemetry is PRESERVED (not treated like Import Undo): we do not touch campaign_leads,
  -- locks, attempts, or dispositions. The lead delete SET-NULLs campaign_leads.lead_id (existing FK) but
  -- keeps the row + denormalized data; calls keep campaign_lead_id. Count for reporting only.
  SELECT count(*) INTO v_campaign_rows FROM public.campaign_leads WHERE lead_id = p_lead_id;

  -- Delete the lead only after every transfer succeeded. clients.lead_id is FK-free now, so lineage
  -- survives. Any failure above raises and rolls the whole transaction back (lead + records intact).
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

REVOKE ALL ON FUNCTION public.convert_lead_to_client_atomic(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_lead_to_client_atomic(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_client_atomic(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
