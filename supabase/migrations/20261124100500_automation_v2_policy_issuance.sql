-- Automations V2 policy issuance. A person confirms that one specific policy was issued. A recorded
-- sale, an effective date or the old issue-date text never counts as issuance.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.policy_issuance_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_id uuid NOT NULL,
  client_id uuid NOT NULL,
  issued_on date NOT NULL,
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id uuid NOT NULL,
  UNIQUE (organization_id,policy_id),
  UNIQUE (organization_id,request_id),
  FOREIGN KEY (organization_id,policy_id) REFERENCES private.policy_identities(organization_id,policy_id)
);
CREATE INDEX policy_issuance_confirmations_client ON public.policy_issuance_confirmations(organization_id,client_id);
ALTER TABLE public.policy_issuance_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.policy_issuance_confirmations FROM PUBLIC,anon,authenticated;
-- Read-only for people who can already see the client. The client lookup runs under the reader's own access.
GRANT SELECT ON public.policy_issuance_confirmations TO authenticated;
CREATE POLICY policy_issuance_read ON public.policy_issuance_confirmations FOR SELECT TO authenticated
  USING (organization_id=public.get_org_id() AND EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id=policy_issuance_confirmations.client_id
      AND c.organization_id=policy_issuance_confirmations.organization_id));

-- A confirmation is permanent. Corrections are a deliberate future change, not an edit.
CREATE FUNCTION private.guard_policy_issuance_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'A policy issuance confirmation cannot be changed' USING ERRCODE='23514';
END $$;
CREATE TRIGGER policy_issuance_append_only BEFORE UPDATE OR DELETE ON public.policy_issuance_confirmations
  FOR EACH ROW EXECUTE FUNCTION private.guard_policy_issuance_append_only();

-- The same people who may record a sale for the client may confirm its issuance: the client's
-- agent, an administrator, or a team leader above that agent.
CREATE FUNCTION private.policy_issuance_allowed(p_actor uuid,p_role text,p_super boolean,p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT coalesce(p_owner=p_actor OR p_role='Admin' OR p_super
    OR (p_role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(p_actor,p_owner)),false)
$$;

CREATE FUNCTION public.confirm_policy_issuance(p_request_id uuid,p_policy_id uuid,p_issued_on date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; policy private.policy_identities; holder public.clients; saved public.policy_issuance_confirmations;
BEGIN
  SELECT * INTO actor FROM private.campaign_actor();
  -- Issuance confirmation is part of the Automations pilot: only an agency with the builder visible has it.
  IF NOT private.automation_builder_visible(actor.org_id) THEN
    RAISE EXCEPTION 'Issuance confirmation is not available for this agency' USING ERRCODE='42501'; END IF;
  IF private.automation_viewing_as() THEN
    RAISE EXCEPTION 'Issuance cannot be confirmed while viewing as another person' USING ERRCODE='42501'; END IF;
  IF private.automation_mode_unverified() THEN
    RAISE EXCEPTION 'Sign in again to confirm issuance.' USING ERRCODE='42501',HINT='automation_session_reauth'; END IF;
  IF p_request_id IS NULL OR p_policy_id IS NULL OR p_issued_on IS NULL OR p_issued_on<date '1900-01-01' THEN
    RAISE EXCEPTION 'Enter the date the policy was issued' USING ERRCODE='22023'; END IF;
  -- Today anywhere in the world is acceptable. A later date is not an issued policy.
  IF p_issued_on>(clock_timestamp() AT TIME ZONE 'UTC'+interval '14 hours')::date THEN
    RAISE EXCEPTION 'The issue date cannot be in the future' USING ERRCODE='22023'; END IF;
  SELECT * INTO policy FROM private.policy_identities i WHERE i.organization_id=actor.org_id AND i.policy_id=p_policy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Policy not found' USING ERRCODE='PT404'; END IF;
  SELECT * INTO holder FROM public.clients c WHERE c.organization_id=actor.org_id AND c.id=policy.client_id;
  -- The policy must still be one of this client's stored policies.
  IF NOT FOUND OR NOT (holder.primary_policy_id IS NOT DISTINCT FROM p_policy_id OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(holder.custom_fields->'additional_policies')='array'
        THEN holder.custom_fields->'additional_policies' ELSE '[]'::jsonb END) extra
      WHERE extra->>'policyId'=p_policy_id::text)) THEN
    RAISE EXCEPTION 'Policy not found' USING ERRCODE='PT404'; END IF;
  IF NOT private.policy_issuance_allowed(actor.uid,actor.actor_role,actor.is_super,holder.assigned_agent_id) THEN
    RAISE EXCEPTION 'You cannot confirm issuance for this client' USING ERRCODE='42501'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('policy-issuance:'||actor.org_id::text||p_policy_id::text,0));
  SELECT * INTO saved FROM public.policy_issuance_confirmations x
    WHERE x.organization_id=actor.org_id AND x.policy_id=p_policy_id;
  IF FOUND THEN
    IF saved.issued_on<>p_issued_on THEN
      RAISE EXCEPTION 'This policy is already confirmed as issued on a different date' USING ERRCODE='PT409'; END IF;
    RETURN jsonb_build_object('policy_id',saved.policy_id,'issued_on',saved.issued_on,'confirmed_at',saved.confirmed_at,'idempotent',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.policy_issuance_confirmations x
      WHERE x.organization_id=actor.org_id AND x.request_id=p_request_id) THEN
    RAISE EXCEPTION 'This request was already used for another policy' USING ERRCODE='22023'; END IF;
  INSERT INTO public.policy_issuance_confirmations(organization_id,policy_id,client_id,issued_on,confirmed_by,request_id)
    VALUES(actor.org_id,p_policy_id,holder.id,p_issued_on,actor.uid,p_request_id) RETURNING * INTO saved;
  RETURN jsonb_build_object('policy_id',saved.policy_id,'issued_on',saved.issued_on,'confirmed_at',saved.confirmed_at,'idempotent',false);
END $$;

-- Whether the signed-in person may confirm issuance for this client right now. Outside the Automations pilot, never.
CREATE FUNCTION public.can_confirm_policy_issuance(p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT private.automation_viewing_as() AND NOT private.automation_mode_unverified() AND EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.clients c ON c.organization_id=p.organization_id AND c.id=p_client_id
    WHERE p.id=auth.uid() AND p.status='Active' AND p.organization_id=public.get_org_id()
      AND private.automation_builder_visible(p.organization_id)
      AND private.policy_issuance_allowed(p.id,p.role,coalesce(p.is_super_admin,false),c.assigned_agent_id))
$$;

-- Whether the signed-in person's agency has issuance confirmation, which is part of the Automations pilot. The list
-- below runs with the reader's own access, which cannot read the pilot setting itself.
CREATE FUNCTION public.policy_issuance_available()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(private.automation_builder_visible(public.get_org_id()),false)
$$;

-- One entry per stored policy of a client the reader can see. The client and the confirmations are
-- read under the reader's own access, so this shows nothing the reader could not already open. An agency outside
-- the Automations pilot gets an empty list, so its client screens show no issuance at all.
CREATE FUNCTION public.get_policy_issuance(p_client_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  WITH holder AS (
    SELECT c.id,c.organization_id,c.primary_policy_id,c.custom_fields,public.can_confirm_policy_issuance(c.id) AS may_confirm
    FROM public.clients c WHERE c.id=p_client_id AND c.organization_id=public.get_org_id()
      AND public.policy_issuance_available()
  ), stored AS (
    SELECT holder.primary_policy_id::text AS policy_id,0 AS position FROM holder WHERE holder.primary_policy_id IS NOT NULL
    UNION ALL
    SELECT extra.value->>'policyId',extra.ordinality::integer FROM holder,
      jsonb_array_elements(CASE WHEN jsonb_typeof(holder.custom_fields->'additional_policies')='array'
        THEN holder.custom_fields->'additional_policies' ELSE '[]'::jsonb END) WITH ORDINALITY extra
    WHERE extra.value->>'policyId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'policy_id',stored.policy_id,'issued_on',x.issued_on,'confirmed_at',x.confirmed_at,
      'confirmed_by_name',nullif(btrim(concat_ws(' ',by_whom.first_name,by_whom.last_name)),''),
      'can_confirm',x.id IS NULL AND holder.may_confirm)
    ORDER BY stored.position),'[]'::jsonb)
  FROM stored CROSS JOIN holder
  LEFT JOIN public.policy_issuance_confirmations x
    ON x.organization_id=holder.organization_id AND x.policy_id::text=stored.policy_id
  LEFT JOIN public.profiles by_whom ON by_whom.id=x.confirmed_by AND by_whom.organization_id=holder.organization_id
$$;

-- A confirmed issuance starts follow-up only for a policy whose sale was recorded live. Policies
-- that were entered as history, repaired or predate policy identities stay quiet.
CREATE FUNCTION private.automation_capture_issuance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT private.automation_enrolling(NEW.organization_id) THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.policy_identities i JOIN public.wins w
      ON w.organization_id=i.organization_id AND w.policy_id=i.policy_id AND w.event_time_source='event'
    WHERE i.organization_id=NEW.organization_id AND i.policy_id=NEW.policy_id AND NOT i.legacy) THEN RETURN NEW; END IF;
  PERFORM private.automation_record_event(NEW.organization_id,'policy_issuance_confirmed',NEW.id,NEW.client_id,'client',
    jsonb_build_object('policy_id',NEW.policy_id,'confirmation_id',NEW.id,'issued_on',NEW.issued_on,'confirmed_by',NEW.confirmed_by),
    'issuance:'||NEW.policy_id::text,interval '0');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation issuance capture requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_capture_issuance AFTER INSERT ON public.policy_issuance_confirmations
  FOR EACH ROW EXECUTE FUNCTION private.automation_capture_issuance();

REVOKE ALL ON FUNCTION private.guard_policy_issuance_append_only(),private.automation_capture_issuance(),
  private.policy_issuance_allowed(uuid,text,boolean,uuid),public.confirm_policy_issuance(uuid,uuid,date),
  public.get_policy_issuance(uuid),public.can_confirm_policy_issuance(uuid),public.policy_issuance_available()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_policy_issuance(uuid,uuid,date),public.get_policy_issuance(uuid),
  public.can_confirm_policy_issuance(uuid),public.policy_issuance_available() TO authenticated;
COMMIT;
