-- Operator-maintained evidence. A fresh installation enables no channel or recipient.
CREATE TABLE private.automation_channel_policies (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  channel text NOT NULL CHECK (channel IN ('sms','email')),
  daily_limit integer NOT NULL CHECK (daily_limit > 0),
  local_start time NOT NULL, local_end time NOT NULL CHECK (local_start <> local_end),
  reply_max_age interval NOT NULL CHECK (reply_max_age > interval '0'),
  reply_checked_at timestamptz, enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id,channel)
);
CREATE TABLE private.automation_email_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  connection_id uuid NOT NULL REFERENCES public.user_email_connections(id),
  from_email text NOT NULL CHECK (from_email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+$'),
  reply_to text NOT NULL, owner_id uuid NOT NULL,
  verified_until timestamptz NOT NULL, verification_reference text NOT NULL CHECK (btrim(verification_reference)<>''),
  enabled boolean NOT NULL DEFAULT false, UNIQUE (organization_id,id)
);
CREATE TABLE private.automation_recipient_facts (
  organization_id uuid NOT NULL, contact_id uuid NOT NULL, contact_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms')), destination text NOT NULL,
  timezone_name text NOT NULL, valid_until timestamptz NOT NULL,
  email_permission boolean NOT NULL DEFAULT false,
  evidence_reference text NOT NULL CHECK (btrim(evidence_reference)<>''),
  PRIMARY KEY (organization_id,contact_type,contact_id,channel,destination)
);
CREATE TABLE private.automation_email_suppressions (
  organization_id uuid NOT NULL, address text NOT NULL, reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,address)
);
-- SMS has its own provider dispatch ledger. This row correlates workflow history with its one SMS.
CREATE TABLE private.automation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  run_id uuid NOT NULL, node_id text NOT NULL, contact_id uuid NOT NULL, contact_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms','email')), recipient text NOT NULL, sender text NOT NULL,
  unsubscribe_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  reply_to text, connection_id uuid, owner_id uuid NOT NULL, subject text, body text NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(), provider_id text,
  state text NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown','accepted','delivered','failed')),
  provider_event_at timestamptz, projected_at timestamptz, repair_after timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,run_id,node_id),
  UNIQUE (organization_id,channel,provider_id)
);
CREATE INDEX automation_messages_quota ON private.automation_messages(organization_id,channel,authorized_at);
CREATE INDEX automation_messages_pending_projection ON private.automation_messages(repair_after,id)
  WHERE projected_at IS NULL AND provider_id IS NOT NULL;
CREATE TABLE private.automation_inbound_events (
  organization_id uuid NOT NULL, channel text NOT NULL, event_key text NOT NULL, occurred_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id,channel,event_key)
);
CREATE TABLE private.automation_reply_recovery (
 organization_id uuid NOT NULL, channel text NOT NULL, event_key text NOT NULL, data jsonb NOT NULL,
 retry_after timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,channel,event_key)
);
CREATE INDEX automation_reply_recovery_due ON private.automation_reply_recovery(retry_after);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_channel_policies','automation_email_senders','automation_recipient_facts',
    'automation_email_suppressions','automation_messages','automation_inbound_events','automation_reply_recovery'] LOOP
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);
  END LOOP;
END $$;

CREATE FUNCTION private.automation_sender_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF ROW(OLD.id,OLD.organization_id,OLD.connection_id,OLD.from_email,OLD.reply_to,OLD.owner_id) IS DISTINCT FROM
     ROW(NEW.id,NEW.organization_id,NEW.connection_id,NEW.from_email,NEW.reply_to,NEW.owner_id) THEN
    RAISE EXCEPTION 'Verify a new email sender when its identity changes.';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION private.automation_sender_bind() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  SELECT c.provider_account_email,c.user_id INTO STRICT NEW.reply_to,NEW.owner_id FROM public.user_email_connections c
    WHERE c.organization_id=NEW.organization_id AND c.id=NEW.connection_id AND c.status='connected' AND c.provider='google';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.automation_sender_bind() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER automation_sender_bind BEFORE INSERT ON private.automation_email_senders
  FOR EACH ROW EXECUTE FUNCTION private.automation_sender_bind();
REVOKE ALL ON FUNCTION private.automation_sender_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER automation_sender_immutable BEFORE UPDATE ON private.automation_email_senders
  FOR EACH ROW EXECUTE FUNCTION private.automation_sender_immutable();

CREATE FUNCTION private.automation_template_safe(p_subject text,p_body text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT regexp_replace(coalesce(p_subject,'')||' '||coalesce(p_body,''),'\{\{[[:space:]]*(first_name|last_name|email|phone)[[:space:]]*\}\}','', 'g') !~ '\{\{|\}\}'
$$;
REVOKE ALL ON FUNCTION private.automation_template_safe(text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.automation_channel_options(p_search text DEFAULT '',p_offset integer DEFAULT 0,p_sender_id uuid DEFAULT NULL,
  p_template_id uuid DEFAULT NULL,p_type text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid := public.get_org_id(); template_page jsonb; sender_page jsonb;
BEGIN
  IF (private.automation_can_author(org) AND private.automation_builder_visible(org)) IS NOT TRUE
    OR private.automation_viewer_id() IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Workflow management permission required' USING ERRCODE='42501';
  END IF;
  IF p_offset<0 OR length(p_search)>200 OR (p_type IS NOT NULL AND p_type NOT IN ('sms','email')) THEN
    RAISE EXCEPTION 'Invalid channel search.'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY name,id),'[]'::jsonb) INTO template_page FROM (
    SELECT id,name,type,subject,content,sms_purpose FROM public.message_templates WHERE organization_id=org
      AND p_sender_id IS NULL AND (p_template_id IS NULL OR id=p_template_id)
      AND (scope='agency' OR created_by=auth.uid()) AND type IN ('sms','email') AND (p_type IS NULL OR type=p_type)
      AND strpos(lower(name),lower(coalesce(p_search,'')))>0 AND private.automation_template_safe(subject,content)
      ORDER BY name,id OFFSET p_offset LIMIT 51) t;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY from_email,id),'[]'::jsonb) INTO sender_page FROM (
    SELECT e.id,e.from_email,c.provider_account_email AS reply_to FROM private.automation_email_senders e
    JOIN public.user_email_connections c ON c.id=e.connection_id AND c.organization_id=e.organization_id
    JOIN public.profiles p ON p.id=c.user_id AND p.organization_id=c.organization_id AND p.status='Active'
    WHERE e.organization_id=org AND e.enabled AND e.verified_until>now() AND c.provider='google' AND c.status='connected'
      AND c.provider_account_email=e.reply_to AND c.user_id=e.owner_id AND p_template_id IS NULL
      AND (p_sender_id IS NULL OR e.id=p_sender_id) AND p_type IS DISTINCT FROM 'sms'
      AND (strpos(lower(e.from_email),lower(coalesce(p_search,'')))>0 OR strpos(lower(e.reply_to),lower(coalesce(p_search,'')))>0)
    ORDER BY e.from_email,e.id OFFSET p_offset LIMIT 51) s;
  RETURN jsonb_build_object('templates',template_page - 50,'senders',sender_page - 50,
    'moreTemplates',jsonb_array_length(template_page)>50,'moreSenders',jsonb_array_length(sender_page)>50);
END $$;

CREATE FUNCTION private.automation_channel_issue(p_org uuid,p_actor uuid,p_node jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE cfg jsonb:=p_node->'config'; channel text;
BEGIN
  IF p_node->>'type'='send_email' THEN channel:='email';
  ELSIF p_node->>'type'='send_sms' THEN channel:='sms';
  ELSE RETURN NULL; END IF;
  IF nullif(cfg->>'template_id','') IS NOT NULL AND NOT EXISTS (
    SELECT FROM public.message_templates WHERE organization_id=p_org AND id::text=cfg->>'template_id'
      AND type=channel AND (scope='agency' OR created_by=p_actor)
      AND private.automation_template_safe(subject,content)
      AND (sms_purpose IS DISTINCT FROM 'marketing' OR cfg->>'purpose'='marketing')
  ) THEN RETURN 'Choose an accessible template for this channel.'; END IF;
  IF channel='email' AND NOT EXISTS (
    SELECT FROM private.automation_email_senders e JOIN public.user_email_connections c
      ON c.organization_id=e.organization_id AND c.id=e.connection_id
    JOIN public.profiles p ON p.id=c.user_id AND p.organization_id=c.organization_id AND p.status='Active'
    WHERE e.id::text=cfg->>'sender_id' AND e.organization_id=p_org AND e.enabled AND e.verified_until>now()
      AND c.status='connected' AND c.provider='google' AND c.provider_account_email=e.reply_to AND c.user_id=e.owner_id
  ) THEN RETURN 'Choose a verified agency sender with a connected reply inbox.'; END IF;
  RETURN NULL;
END $$;

-- Preserve confirmation jobs and old-format executions. Only the new prefix enters this branch.
ALTER FUNCTION private.affinity_automation_scope(uuid,text,text,uuid,text,uuid) RENAME TO affinity_legacy_automation_scope;
CREATE FUNCTION private.affinity_automation_scope(p_org uuid,p_key text,p_phone text,p_contact uuid,p_type text,p_confirmation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE owner_id uuid;
BEGIN
  IF p_key NOT LIKE 'automation:%' THEN
    RETURN private.affinity_legacy_automation_scope(p_org,p_key,p_phone,p_contact,p_type,p_confirmation);
  END IF;
  SELECT l.user_id INTO owner_id FROM private.automation_runs r
  JOIN private.automation_intents i ON i.organization_id=r.organization_id AND i.run_id=r.id
  JOIN public.leads l ON l.id=r.contact_id AND l.organization_id=r.organization_id
  WHERE p_confirmation IS NULL AND r.organization_id=p_org AND r.contact_id=p_contact
    AND r.contact_type=p_type AND p_type='lead' AND private.affinity_phone(l.phone)=p_phone
    AND p_key='automation:'||r.id::text||':'||i.node_id AND r.current_node_id=i.node_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Automation SMS scope changed.'; END IF;
  RETURN jsonb_build_object('actor',owner_id,'contact',p_contact,'type',p_type);
END $$;
REVOKE ALL ON FUNCTION private.affinity_automation_scope(uuid,text,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated;

-- Capture exactly the configuration/content and payer/recipient authorized for this attempt.
CREATE FUNCTION public.automation_begin_message(p_run uuid,p_token uuid,p_node text,p_channel text,p_recipient text,
  p_subject text,p_body text,p_sender_id text,p_sms_from text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; v public.workflow_versions; policy private.automation_channel_policies;
 facts private.automation_recipient_facts; lead public.leads; sender record; msg private.automation_messages;
 local_time time; destination text; from_addr text; reply text; inbox uuid; owner_id uuid; node jsonb;
BEGIN
  SELECT * INTO STRICT r FROM private.automation_runs WHERE id=p_run;
  SELECT * INTO STRICT v FROM public.workflow_versions WHERE organization_id=r.organization_id AND id=r.version_id AND workflow_id=r.workflow_id;
  SELECT item INTO node FROM jsonb_array_elements(v.graph->'nodes') item WHERE item->>'id'=p_node;
  IF p_channel IS NULL OR p_channel NOT IN ('sms','email') OR node->>'type' IS DISTINCT FROM 'send_'||p_channel OR p_body IS NULL OR btrim(p_body)='' THEN
    RAISE EXCEPTION 'Published message step changed.'; END IF;
  SELECT * INTO STRICT lead FROM public.leads WHERE r.contact_type='lead' AND id=r.contact_id AND organization_id=r.organization_id FOR SHARE;
  IF EXISTS (SELECT FROM public.clients WHERE organization_id=r.organization_id AND lead_id=r.contact_id) THEN
    RAISE EXCEPTION 'Converted contact needs review.'; END IF;
  IF NOT EXISTS (SELECT FROM private.automation_events e WHERE e.organization_id=r.organization_id AND e.id=r.event_id
    AND private.automation_audience_allowed(r.organization_id,v.published_by,e.campaign_id)) THEN
    RAISE EXCEPTION 'Publisher no longer has authority over this audience.'; END IF;
  destination:=CASE WHEN p_channel='email' THEN lower(trim(lead.email)) ELSE private.affinity_phone(lead.phone) END;
  IF nullif(destination,'') IS NULL OR destination IS DISTINCT FROM p_recipient THEN RAISE EXCEPTION 'Contact destination changed.'; END IF;
  SELECT * INTO policy FROM private.automation_channel_policies
    WHERE organization_id=r.organization_id AND channel=p_channel AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agency sending limits and local sending hours require verification.'; END IF;
  SELECT * INTO facts FROM private.automation_recipient_facts WHERE organization_id=r.organization_id AND contact_id=r.contact_id
    AND contact_type=r.contact_type AND channel=p_channel AND private.automation_recipient_facts.destination=p_recipient AND valid_until>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current recipient eligibility or verified timezone is missing.'; END IF;
  local_time:=(clock_timestamp() AT TIME ZONE facts.timezone_name)::time;
  IF (policy.local_start<policy.local_end AND (local_time<policy.local_start OR local_time>=policy.local_end))
     OR (policy.local_start>policy.local_end AND local_time>=policy.local_end AND local_time<policy.local_start) THEN
    RAISE EXCEPTION 'Outside the recipient local sending window.'; END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM private.automation_messages WHERE organization_id=r.organization_id AND channel=p_channel
    AND authorized_at>clock_timestamp()-interval '24 hours' LIMIT policy.daily_limit) used)>=policy.daily_limit THEN
    RAISE EXCEPTION 'Agency sending limit reached.'; END IF;
  IF p_channel='email' THEN
    IF NOT facts.email_permission OR EXISTS (SELECT FROM private.automation_email_suppressions WHERE organization_id=r.organization_id AND address=p_recipient)
      THEN RAISE EXCEPTION 'Email permission is missing or suppressed.'; END IF;
    SELECT e.from_email,c.id,c.provider_account_email,c.last_sync_at,c.user_id INTO sender
    FROM private.automation_email_senders e JOIN public.user_email_connections c ON c.id=e.connection_id AND c.organization_id=e.organization_id
    JOIN public.profiles p ON p.id=c.user_id AND p.organization_id=e.organization_id AND p.status='Active'
    WHERE e.organization_id=r.organization_id AND e.id::text=p_sender_id AND e.enabled AND e.verified_until>clock_timestamp()
      AND c.status='connected' AND c.provider='google' AND c.provider_account_email=e.reply_to AND c.user_id=e.owner_id AND p_sender_id=node->'config'->>'sender_id' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Verified agency email identity is unavailable.'; END IF;
    IF sender.last_sync_at IS NULL OR sender.last_sync_at < clock_timestamp()-policy.reply_max_age THEN
      RAISE EXCEPTION 'Reply inbox sync is stale.'; END IF;
    from_addr:=sender.from_email; reply:=sender.provider_account_email; inbox:=sender.id; owner_id:=sender.user_id;
  ELSE
    IF nullif(p_sms_from,'') IS NULL THEN RAISE EXCEPTION 'SMS sender is unavailable.'; END IF;
    from_addr:=p_sms_from; owner_id:=v.published_by;
  END IF;
  IF coalesce((v.graph->'settings'->>'stop_on_reply')::boolean,false) AND (
     policy.reply_checked_at IS NULL OR policy.reply_checked_at<clock_timestamp()-policy.reply_max_age OR
     EXISTS(SELECT FROM private.automation_reply_recovery WHERE organization_id=r.organization_id) OR
     EXISTS(SELECT FROM private.automation_messages prior
       LEFT JOIN private.automation_channel_policies old_policy ON old_policy.organization_id=prior.organization_id AND old_policy.channel=prior.channel
       LEFT JOIN public.user_email_connections old_inbox ON old_inbox.organization_id=prior.organization_id AND old_inbox.id=prior.connection_id
       WHERE prior.organization_id=r.organization_id AND prior.run_id=r.id AND
         (old_policy.reply_checked_at IS NULL OR old_policy.reply_checked_at<clock_timestamp()-old_policy.reply_max_age
          OR (prior.channel='email' AND (old_inbox.status IS DISTINCT FROM 'connected' OR old_inbox.last_sync_at IS NULL
              OR old_inbox.last_sync_at<clock_timestamp()-old_policy.reply_max_age))))) THEN
    RAISE EXCEPTION 'Required reply feed is stale.'; END IF;
  IF public.automation_authorize_handoff(p_run,p_token,p_node) IS NOT TRUE THEN RAISE EXCEPTION 'Run no longer permits a provider handoff.'; END IF;
  IF p_channel='sms' AND public.sms_start_dispatch(r.organization_id,'automation:'||r.id||':'||p_node) IS NOT TRUE THEN
    RAISE EXCEPTION 'SMS dispatch is already in progress or no longer eligible.';
  END IF;
  INSERT INTO private.automation_messages(organization_id,run_id,node_id,contact_id,contact_type,channel,recipient,sender,reply_to,connection_id,owner_id,subject,body)
    VALUES(r.organization_id,r.id,p_node,r.contact_id,r.contact_type,p_channel,destination,from_addr,reply,inbox,owner_id,p_subject,p_body)
    RETURNING * INTO msg;
  RETURN jsonb_build_object('id',msg.id,'from_email',msg.sender,'reply_to',msg.reply_to,'unsubscribe_token',msg.unsubscribe_token);
END $$;

ALTER TABLE public.messages ADD COLUMN automation_message_id uuid UNIQUE REFERENCES private.automation_messages(id);
ALTER TABLE public.contact_emails ADD COLUMN automation_message_id uuid UNIQUE REFERENCES private.automation_messages(id);
ALTER TABLE public.contact_emails DROP CONSTRAINT contact_emails_provider_check,
  ADD CONSTRAINT contact_emails_provider_check CHECK ((provider IN ('google','microsoft') AND automation_message_id IS NULL)
    OR (provider='resend' AND automation_message_id IS NOT NULL));
-- Existing permissive mailbox/history policies still control ordinary messages.
CREATE POLICY automation_email_provenance_insert ON public.contact_emails AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (automation_message_id IS NULL);
CREATE POLICY automation_email_provenance_update ON public.contact_emails AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (automation_message_id IS NULL) WITH CHECK (automation_message_id IS NULL);
CREATE POLICY automation_email_provenance_delete ON public.contact_emails AS RESTRICTIVE FOR DELETE TO authenticated USING (automation_message_id IS NULL);
CREATE POLICY automation_sms_provenance_insert ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (automation_message_id IS NULL);
CREATE POLICY automation_sms_provenance_update ON public.messages AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (automation_message_id IS NULL) WITH CHECK (automation_message_id IS NULL);
CREATE POLICY automation_sms_provenance_delete ON public.messages AS RESTRICTIVE FOR DELETE TO authenticated USING (automation_message_id IS NULL);
CREATE FUNCTION private.automation_history_visible(p_org uuid,p_contact uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN private.automation_visible_lead(private.automation_viewer_id(),p_org,p_contact);
EXCEPTION WHEN no_data_found OR insufficient_privilege THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION private.automation_history_visible(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.automation_history_visible(uuid,uuid) TO authenticated;
CREATE POLICY automation_sms_contact_scope ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (automation_message_id IS NULL OR private.automation_history_visible(organization_id,contact_id));
CREATE POLICY automation_email_contact_viewer ON public.contact_emails FOR SELECT TO authenticated
  USING (automation_message_id IS NOT NULL AND private.automation_history_visible(organization_id,contact_id));
CREATE POLICY automation_email_contact_scope ON public.contact_emails AS RESTRICTIVE FOR SELECT TO authenticated
  USING (automation_message_id IS NULL OR private.automation_history_visible(organization_id,contact_id));

CREATE FUNCTION public.automation_record_receipt(p_message uuid,p_channel text,p_provider text,p_state text,p_at timestamptz,
 p_suppression text DEFAULT NULL,p_org uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m private.automation_messages;
BEGIN
  SELECT * INTO m FROM private.automation_messages WHERE id=p_message AND channel=p_channel FOR UPDATE;
  IF NOT FOUND OR (p_org IS NOT NULL AND p_org<>m.organization_id) OR nullif(p_provider,'') IS NULL
    OR (m.provider_id IS NOT NULL AND m.provider_id<>p_provider) THEN RAISE EXCEPTION 'Receipt identity mismatch.'; END IF;
  IF p_suppression IS NOT NULL AND p_channel='email' AND p_suppression IN ('complaint','bounce','unsubscribe','suppression') THEN
    PERFORM 1 FROM private.automation_channel_policies WHERE organization_id=m.organization_id AND channel='email' FOR UPDATE;
    INSERT INTO private.automation_email_suppressions(organization_id,address,reason)
      VALUES(m.organization_id,m.recipient,p_suppression) ON CONFLICT DO NOTHING;
  END IF;
  IF p_state NOT IN ('accepted','delivered','failed') THEN RAISE EXCEPTION 'Unknown receipt state.'; END IF;
  -- A repeated or delayed acceptance cannot demote a terminal provider outcome.
  IF m.state='delivered' OR (m.state='failed' AND p_state<>'delivered') THEN RETURN; END IF;
  UPDATE private.automation_messages SET provider_id=p_provider,state=p_state,provider_event_at=p_at,projected_at=NULL,repair_after=now()
    WHERE id=m.id AND (state<>p_state OR provider_id IS NULL);
  PERFORM private.automation_apply_receipt(m.organization_id,m.run_id,m.node_id,p_state);
END $$;

CREATE FUNCTION private.automation_project_message(m private.automation_messages) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE sms public.sms_dispatches; mailbox_status text := CASE m.state WHEN 'accepted' THEN 'sent' ELSE m.state END;
BEGIN
  IF m.channel='email' THEN
    INSERT INTO public.contact_emails(organization_id,contact_id,owner_user_id,connection_id,provider,direction,
      external_message_id,internet_message_id,from_email,to_emails,subject,body_text,sent_at,delivery_status,automation_message_id)
    VALUES(m.organization_id,m.contact_id,m.owner_id,m.connection_id,'resend','outbound',m.provider_id,
      '<'||m.id::text||'@'||split_part(m.sender,'@',2)||'>',m.sender,jsonb_build_array(m.recipient),m.subject,m.body,m.authorized_at,mailbox_status,m.id)
    ON CONFLICT(automation_message_id) DO UPDATE SET delivery_status=excluded.delivery_status;
  ELSE
    SELECT * INTO sms FROM public.sms_dispatches WHERE organization_id=m.organization_id AND request_key='automation:'||m.run_id||':'||m.node_id;
    IF sms.message_id IS NULL AND sms.state IN ('attempting','uncertain') THEN
      -- A signed callback or the transport already established this SID. Finish history only.
      PERFORM public.sms_finish_dispatch(m.organization_id,sms.request_key,'accepted',m.provider_id,m.state,NULL);
      SELECT * INTO sms FROM public.sms_dispatches WHERE organization_id=m.organization_id AND request_key=sms.request_key;
    END IF;
    IF sms.message_id IS NULL THEN RETURN false; END IF;
    UPDATE public.messages SET automation_message_id=m.id,status=CASE WHEN m.state='accepted' THEN coalesce(sms.provider_status,'accepted') ELSE m.state END
      WHERE organization_id=m.organization_id AND id=sms.message_id AND provider_message_id=m.provider_id;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  UPDATE private.automation_messages SET projected_at=clock_timestamp() WHERE id=m.id;
  RETURN true;
END $$;
CREATE FUNCTION public.automation_repair_messages(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m private.automation_messages; n integer:=0;
BEGIN
  FOR m IN SELECT * FROM private.automation_messages WHERE projected_at IS NULL AND provider_id IS NOT NULL AND repair_after<=now()
    ORDER BY repair_after,id LIMIT greatest(1,least(100,p_limit)) FOR UPDATE SKIP LOCKED LOOP
    UPDATE private.automation_messages SET repair_after=clock_timestamp()+interval '1 minute' WHERE id=m.id;
    BEGIN
      IF private.automation_project_message(m) THEN n:=n+1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'Automation history projection % needs repair, SQLSTATE %',m.id,SQLSTATE;
    END;
  END LOOP;
  PERFORM private.automation_repair_replies(p_limit);
  RETURN n;
END $$;

-- A verified inbound SMS has to resolve to exactly one typed current recipient and to the same organization.
CREATE FUNCTION public.automation_observe_sms_reply(p_org uuid,p_sid text,p_from text,p_to text,p_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id_ uuid; type_ text; n integer; endpoint text:=private.phone_digits_e164ish(p_from);
BEGIN
  IF p_sid !~ '^SM[[:xdigit:]]{32}$' OR endpoint IS NULL OR NOT EXISTS(SELECT FROM public.phone_numbers
    WHERE organization_id=p_org AND private.phone_digits_e164ish(phone_number)=private.phone_digits_e164ish(p_to)) THEN RETURN; END IF;
  IF NOT EXISTS(SELECT FROM private.automation_channel_policies WHERE organization_id=p_org AND enabled) THEN RETURN; END IF;
  SELECT count(*),min(t.id::text)::uuid,min(t.kind) INTO n,id_,type_ FROM (
    SELECT id,'lead' kind FROM public.leads WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=endpoint
    UNION ALL SELECT id,'client' FROM public.clients WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=endpoint
    UNION ALL SELECT id,'recruit' FROM public.recruits WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=endpoint LIMIT 2
  ) t;
  IF n<>1 THEN RETURN; END IF;
  INSERT INTO private.automation_inbound_events VALUES(p_org,'sms',p_sid,p_at) ON CONFLICT DO NOTHING;
  IF FOUND THEN PERFORM private.automation_cancel_reply(p_org,id_,type_,p_at); END IF;
END $$;

-- Only the mailbox sync worker may originate evidence. Client-created inbound rows lack that provenance.
CREATE FUNCTION private.automation_process_email_reply(incoming public.contact_emails)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target uuid; kind text; n integer;
BEGIN
  IF incoming.direction<>'inbound' OR incoming.provider<>'google' OR incoming.connection_id IS NULL
     OR incoming.in_reply_to IS NULL OR incoming.received_at IS NULL THEN RETURN; END IF;
  SELECT count(*),min(m.contact_id::text)::uuid,min(m.contact_type) INTO n,target,kind
  FROM private.automation_messages m
  WHERE m.organization_id=incoming.organization_id AND m.connection_id=incoming.connection_id AND m.channel='email'
    AND '<'||m.id::text||'@'||split_part(m.sender,'@',2)||'>'=incoming.in_reply_to AND m.recipient=lower(trim(incoming.from_email))
    AND m.contact_id=incoming.contact_id AND incoming.received_at>=m.authorized_at
    AND incoming.to_emails @> jsonb_build_array(m.reply_to);
  IF n=1 THEN
    INSERT INTO private.automation_inbound_events VALUES(incoming.organization_id,'email',incoming.external_message_id,incoming.received_at)
      ON CONFLICT DO NOTHING;
    IF FOUND THEN PERFORM private.automation_cancel_reply(incoming.organization_id,target,kind,incoming.received_at); END IF;
  END IF;
END $$;
CREATE FUNCTION private.automation_email_reply() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN NEW; END IF;
  PERFORM private.automation_process_email_reply(NEW);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO private.automation_reply_recovery(organization_id,channel,event_key,data)
      VALUES(NEW.organization_id,'email',NEW.external_message_id,jsonb_build_object('id',NEW.id,'organization_id',NEW.organization_id,'contact_id',NEW.contact_id,
        'provider',NEW.provider,'direction',NEW.direction,'external_message_id',NEW.external_message_id,'connection_id',NEW.connection_id,
        'received_at',NEW.received_at,'in_reply_to',NEW.in_reply_to,'from_email',NEW.from_email,'to_emails',NEW.to_emails)) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE LOG 'Automation email recovery capture failed, SQLSTATE %', SQLSTATE;
  END;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_email_reply AFTER INSERT ON public.contact_emails FOR EACH ROW
  WHEN (NEW.direction='inbound' AND NEW.provider='google') EXECUTE FUNCTION private.automation_email_reply();

REVOKE ALL ON FUNCTION public.automation_channel_options(text,integer,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.automation_channel_options(text,integer,uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION private.automation_channel_issue(uuid,uuid,jsonb),
 private.automation_project_message(private.automation_messages), private.automation_email_reply() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_begin_message(uuid,uuid,text,text,text,text,text,text,text),
 public.automation_record_receipt(uuid,text,text,text,timestamptz,text,uuid),
 public.automation_repair_messages(integer),public.automation_observe_sms_reply(uuid,text,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_begin_message(uuid,uuid,text,text,text,text,text,text,text),
 public.automation_record_receipt(uuid,text,text,text,timestamptz,text,uuid),
 public.automation_repair_messages(integer),public.automation_observe_sms_reply(uuid,text,text,text,timestamptz)
 TO service_role;

-- Mark the SMS row in the very transaction that records acceptance, including a repaired receipt.
CREATE FUNCTION private.automation_sms_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m private.automation_messages;
BEGIN
  SELECT * INTO m FROM private.automation_messages WHERE organization_id=NEW.organization_id
    AND run_id=split_part(NEW.request_key,':',2)::uuid AND node_id=split_part(NEW.request_key,':',3) AND channel='sms';
  IF FOUND THEN
    UPDATE public.messages SET automation_message_id=m.id
      WHERE id=NEW.message_id AND organization_id=m.organization_id AND provider_message_id=NEW.provider_sid;
    UPDATE private.automation_messages SET provider_id=NEW.provider_sid,state=CASE WHEN state='unknown' THEN 'accepted' ELSE state END
      WHERE id=m.id AND (provider_id IS NULL OR provider_id=NEW.provider_sid);
    IF FOUND THEN PERFORM private.automation_apply_receipt(m.organization_id,m.run_id,m.node_id,'accepted'); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_sms_link AFTER UPDATE OF message_id ON public.sms_dispatches FOR EACH ROW
  WHEN (NEW.request_key LIKE 'automation:%' AND NEW.message_id IS NOT NULL)
  EXECUTE FUNCTION private.automation_sms_link();
REVOKE ALL ON FUNCTION private.automation_sms_link() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.automation_unsubscribe(p_token uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m private.automation_messages;
BEGIN
  SELECT * INTO m FROM private.automation_messages WHERE channel='email' AND unsubscribe_token=p_token;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM private.automation_channel_policies WHERE organization_id=m.organization_id AND channel='email' FOR UPDATE;
  INSERT INTO private.automation_email_suppressions(organization_id,address,reason)
    VALUES(m.organization_id,m.recipient,'unsubscribe') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.automation_unsubscribe(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_unsubscribe(uuid) TO service_role;

CREATE FUNCTION public.automation_callback_scope(p_message uuid,p_sender text,p_recipient text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT organization_id FROM private.automation_messages WHERE id=p_message AND channel='sms'
    AND sender=p_sender AND recipient=p_recipient
$$;
REVOKE ALL ON FUNCTION public.automation_callback_scope(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_callback_scope(uuid,text,text) TO service_role;

-- This table receives signed, account-scoped inbound provenance from the deployed SMS webhook.
CREATE FUNCTION private.automation_verified_sms_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.automation_observe_sms_reply(NEW.organization_id,NEW.provider_sid,NEW.phone_e164,NEW.number_snapshot,NEW.observed_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO private.automation_reply_recovery(organization_id,channel,event_key,data)
      VALUES(NEW.organization_id,'sms',NEW.provider_sid,jsonb_build_object('from',NEW.phone_e164,'to',NEW.number_snapshot,'at',NEW.observed_at))
      ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE LOG 'Automation SMS recovery capture failed, SQLSTATE %', SQLSTATE;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.automation_verified_sms_reply() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER automation_verified_sms_reply AFTER INSERT ON private.contact_number_inbound_sms FOR EACH ROW
  WHEN (NEW.ordinary AND NOT NEW.one_off_reply) EXECUTE FUNCTION private.automation_verified_sms_reply();

CREATE FUNCTION private.automation_repair_replies(p_limit integer) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE pending private.automation_reply_recovery; email public.contact_emails;
BEGIN
  FOR pending IN SELECT * FROM private.automation_reply_recovery WHERE retry_after<=clock_timestamp()
    ORDER BY retry_after,event_key LIMIT greatest(1,least(100,p_limit)) FOR UPDATE SKIP LOCKED LOOP
    UPDATE private.automation_reply_recovery SET retry_after=clock_timestamp()+interval '1 minute'
      WHERE organization_id=pending.organization_id AND channel=pending.channel AND event_key=pending.event_key;
    BEGIN
      IF pending.channel='email' THEN
        SELECT * INTO email FROM jsonb_populate_record(NULL::public.contact_emails,pending.data);
        PERFORM private.automation_process_email_reply(email);
      ELSE
        PERFORM public.automation_observe_sms_reply(pending.organization_id,pending.event_key,pending.data->>'from',
          pending.data->>'to',(pending.data->>'at')::timestamptz);
      END IF;
      DELETE FROM private.automation_reply_recovery WHERE organization_id=pending.organization_id AND channel=pending.channel AND event_key=pending.event_key;
    EXCEPTION WHEN OTHERS THEN RAISE LOG 'Automation reply recovery deferred, SQLSTATE %', SQLSTATE;
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.automation_process_email_reply(public.contact_emails),private.automation_repair_replies(integer) FROM PUBLIC,anon,authenticated;
CREATE INDEX automation_messages_run_activity ON private.automation_messages(organization_id,run_id,authorized_at DESC,id DESC);
CREATE OR REPLACE FUNCTION private.automation_message_status(p_org uuid,p_run uuid,p_node text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.state FROM private.automation_messages m WHERE m.organization_id=p_org AND m.run_id=p_run
 ORDER BY (m.node_id=p_node) DESC,m.authorized_at DESC,m.id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.automation_message_status(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE INDEX automation_messages_provider_lookup ON private.automation_messages(channel,provider_id) WHERE provider_id IS NOT NULL;
CREATE FUNCTION public.automation_email_receipt_scope(p_message uuid,p_provider text,p_sender text,p_recipient text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(to_jsonb(m))->0) END FROM (
   SELECT id,organization_id FROM private.automation_messages WHERE channel='email' AND lower(sender)=p_sender AND recipient=p_recipient
     AND ((p_message IS NOT NULL AND id=p_message AND (provider_id IS NULL OR provider_id=p_provider))
       OR (p_message IS NULL AND provider_id=p_provider)) LIMIT 2) m
$$;
REVOKE ALL ON FUNCTION public.automation_email_receipt_scope(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_email_receipt_scope(uuid,text,text,text) TO service_role;
