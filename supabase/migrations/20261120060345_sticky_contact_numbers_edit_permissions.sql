-- Require the existing Contacts edit capabilities for deliberate number changes.
-- The four earlier sticky migrations remain immutable; this replaces two definitions only.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preimage$
BEGIN
 IF md5(pg_get_functiondef('private.affinity_all_editable(uuid,text,uuid)'::regprocedure))
  IS DISTINCT FROM 'ebe5be1b352d3958f2fa61f3fdb37bef'
 THEN RAISE EXCEPTION 'sticky preimage mismatch: affinity_all_editable';END IF;
 IF md5(pg_get_functiondef('public.change_contact_number(uuid,text,text,uuid,bigint,text)'::regprocedure))
  IS DISTINCT FROM '3e8ca8b4cb94418be1222220a19f5cba'
 THEN RAISE EXCEPTION 'sticky preimage mismatch: change_contact_number';END IF;
END $preimage$;

-- This helper remains private and runs only inside the authenticated definer RPC.
-- Keep each shared row's contact type: lead edit authority cannot authorize client/recruit edits.
CREATE OR REPLACE FUNCTION private.affinity_all_editable(p_org uuid,p_phone text,p_actor uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE role_name text; contact_row record;
BEGIN
 IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR p_org IS DISTINCT FROM public.get_org_id()
 THEN RETURN false;END IF;
 SELECT role INTO role_name FROM public.profiles WHERE id=p_actor AND organization_id=p_org AND status='Active';
 IF role_name IS NULL OR role_name IS DISTINCT FROM public.get_user_role() THEN RETURN false;END IF;
 FOR contact_row IN
  SELECT user_id AS owner_id,'contacts.leads.edit'::text AS permission_key
   FROM public.leads WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)
  UNION ALL SELECT assigned_agent_id,'contacts.clients.edit'::text
   FROM public.clients WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)
  UNION ALL SELECT assigned_agent_id,'contacts.recruits.edit'::text
   FROM public.recruits WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)
 LOOP
  IF public.has_contacts_permission(contact_row.permission_key) IS NOT TRUE THEN RETURN false;END IF;
  IF (role_name='Admin' OR contact_row.owner_id=p_actor OR
   (role_name='Team Leader' AND contact_row.owner_id IS NOT NULL AND public.is_ancestor_of(p_actor,contact_row.owner_id))) IS NOT TRUE
  THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.change_contact_number(p_contact uuid,p_type text,p_channel text,p_number uuid,p_generation bigint,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; scope jsonb; a private.contact_number_affinities; number text;
 reason text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND status='Active';scope:=private.affinity_assert_contact(org,p_contact,p_type);
 IF p_channel IS NULL OR p_channel NOT IN ('voice','sms','both') OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 200
 THEN RAISE EXCEPTION 'affinity_change_invalid';END IF;
 IF public.has_contacts_permission(CASE p_type WHEN 'lead' THEN 'contacts.leads.edit' WHEN 'client' THEN 'contacts.clients.edit' WHEN 'recruit' THEN 'contacts.recruits.edit' END) IS NOT TRUE
 THEN RAISE EXCEPTION 'affinity_edit_permission' USING ERRCODE='42501';END IF;
 PERFORM private.affinity_ensure(org,scope->>'phone');SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=org AND phone_e164=scope->>'phone' FOR UPDATE;
 IF private.affinity_all_editable(org,a.phone_e164,auth.uid()) IS NOT TRUE THEN RAISE EXCEPTION 'affinity_admin_resolution' USING ERRCODE='42501';END IF;
 IF a.generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'affinity_stale';END IF;
 IF private.affinity_unresolved(org,a.phone_e164) THEN RAISE EXCEPTION 'affinity_send_unresolved';END IF;
 IF p_number IS NOT NULL THEN
  IF p_channel IN ('voice','both') AND private.affinity_number(org,p_number,'voice',auth.uid(),false)->>'readiness'<>'ready' THEN RAISE EXCEPTION 'affinity_sender_unready';END IF;
  IF p_channel IN ('sms','both') AND private.affinity_number(org,p_number,'sms',auth.uid(),false)->>'readiness'<>'ready' THEN RAISE EXCEPTION 'affinity_sender_unready';END IF;
  SELECT phone_number INTO number FROM public.phone_numbers WHERE id=p_number AND organization_id=org;
 END IF;
 UPDATE private.contact_number_affinities SET generation=generation+1,history_state='reconciled',
 voice_number_id=CASE WHEN p_channel IN ('voice','both') THEN p_number ELSE voice_number_id END,
 voice_number=CASE WHEN p_channel IN ('voice','both') THEN number ELSE voice_number END,
 voice_state=CASE WHEN p_channel IN ('voice','both') THEN CASE WHEN p_number IS NULL THEN 'needs_review' ELSE 'established' END ELSE voice_state END,
 voice_version=voice_version+CASE WHEN p_channel IN ('voice','both') THEN 1 ELSE 0 END,
 voice_source=CASE WHEN p_channel IN ('voice','both') THEN 'deliberate' ELSE voice_source END,
 sms_number_id=CASE WHEN p_channel IN ('sms','both') THEN p_number ELSE sms_number_id END,
 sms_number=CASE WHEN p_channel IN ('sms','both') THEN number ELSE sms_number END,
 sms_state=CASE WHEN p_channel IN ('sms','both') THEN CASE WHEN p_number IS NULL THEN 'needs_review' ELSE 'established' END ELSE sms_state END,
 sms_version=sms_version+CASE WHEN p_channel IN ('sms','both') THEN 1 ELSE 0 END,
 sms_source=CASE WHEN p_channel IN ('sms','both') THEN 'deliberate' ELSE sms_source END,updated_at=clock_timestamp()
 WHERE organization_id=org AND phone_e164=a.phone_e164;
 PERFORM private.affinity_event(org,a.phone_e164,p_channel,CASE WHEN p_number IS NULL THEN 'reset_review' ELSE 'reassigned' END,auth.uid(),p_number,number,NULL,jsonb_build_object('reason',reason));
 RETURN private.affinity_view(org,a.phone_e164,auth.uid());
END $$;

-- CREATE OR REPLACE retains the reviewed postgres owners and existing ACLs.
-- The helper stays postgres-only; the public RPC stays authenticated-only (besides its owner).
