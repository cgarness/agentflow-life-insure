-- Contact history readers only. No business writes, source RLS changes or voice functions.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE FUNCTION public.contact_history_contact_visible(p_org uuid, p_id uuid, p_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT auth.uid() IS NOT NULL AND p_org = public.get_org_id() AND (
 (p_type = 'lead' AND EXISTS (SELECT 1 FROM public.leads WHERE id=p_id AND organization_id=p_org)) OR
 (p_type = 'client' AND EXISTS (SELECT 1 FROM public.clients WHERE id=p_id AND organization_id=p_org)) OR
 (p_type = 'recruit' AND EXISTS (SELECT 1 FROM public.recruits WHERE id=p_id AND organization_id=p_org)))
$$;
REVOKE ALL ON FUNCTION public.contact_history_contact_visible(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_history_contact_visible(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.contact_history_capture_info() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('captureStartedAt',NULL,'captureHasGaps',false)
$$;
REVOKE ALL ON FUNCTION public.contact_history_capture_info() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contact_history_capture_info() TO authenticated;

-- Extension point installed by the operational-capture migration. Always invoker/RLS bound.
CREATE FUNCTION public.contact_history_operational_page(p_org uuid,p_id uuid,p_type text,
 p_cutoff timestamptz,p_before timestamptz,p_key text,p_limit integer)
RETURNS TABLE(event_time timestamptz,event_key text,kind text,payload jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT NULL::timestamptz,NULL::text,NULL::text,NULL::jsonb WHERE false
$$;
REVOKE ALL ON FUNCTION public.contact_history_operational_page(uuid,uuid,text,timestamptz,timestamptz,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contact_history_operational_page(uuid,uuid,text,timestamptz,timestamptz,text,integer) TO authenticated;

CREATE FUNCTION public.get_contact_history_page(p_contact_id uuid,p_contact_type text,
 p_mode text,p_filter text DEFAULT 'all',p_cursor jsonb DEFAULT NULL,p_page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
 v_org uuid := public.get_org_id(); v_viewer uuid := auth.uid();
 v_limit integer := least(greatest(coalesce(p_page_size,30),1),100);
 v_cutoff timestamptz := statement_timestamp(); v_before timestamptz := 'infinity';
 v_key text := ''; v_alias uuid; v_rows jsonb := '[]'; v_page jsonb; v_last jsonb;
 v_more boolean; v_source record; v_sql text; v_part jsonb; v_changed boolean; v_fields text;
BEGIN
 IF p_mode NOT IN ('conversation','activity') OR p_filter NOT IN ('all','call','sms','email')
    OR p_mode IS NULL OR p_filter IS NULL OR
    NOT coalesce(public.contact_history_contact_visible(v_org,p_contact_id,p_contact_type),false) THEN
   RAISE EXCEPTION 'Contact history unavailable for this scope' USING ERRCODE='42501';
 END IF;
 IF p_contact_type='client' THEN
   SELECT lead_id INTO v_alias FROM public.clients WHERE id=p_contact_id AND organization_id=v_org;
 END IF;
 IF p_cursor IS NOT NULL THEN
   IF (p_cursor->>'version') IS DISTINCT FROM '1' OR (p_cursor->>'viewer') IS DISTINCT FROM v_viewer::text
    OR (p_cursor->>'org') IS DISTINCT FROM v_org::text OR (p_cursor->>'contact') IS DISTINCT FROM p_contact_id::text
    OR (p_cursor->>'type') IS DISTINCT FROM p_contact_type OR (p_cursor->>'mode') IS DISTINCT FROM p_mode
    OR (p_cursor->>'filter') IS DISTINCT FROM p_filter OR (p_cursor->>'alias') IS DISTINCT FROM coalesce(v_alias::text,'')
    OR p_cursor->>'cutoff' IS NULL OR p_cursor->>'time' IS NULL OR p_cursor->>'key' IS NULL THEN
    RAISE EXCEPTION 'History changed; refresh to continue' USING ERRCODE='22023';
   END IF;
   v_cutoff := (p_cursor->>'cutoff')::timestamptz;
   v_before := (p_cursor->>'time')::timestamptz; v_key := p_cursor->>'key';
   IF v_cutoff > statement_timestamp() OR v_cutoff < statement_timestamp()-interval '1 hour' THEN
    RAISE EXCEPTION 'History changed; refresh to continue' USING ERRCODE='22023';
   END IF;
 END IF;
 -- Each source is bounded BEFORE merging. One global cursor, including the source-qualified id.
 FOR v_source IN SELECT * FROM (VALUES
 ('calls','call','coalesce(s.started_at,s.created_at)',
  '(s.contact_id=$2 AND (s.contact_type=$3 OR s.contact_type IS NULL)) OR ($3=''lead'' AND s.lead_id=$2)',
  'id,direction,duration,disposition_id,disposition_name,started_at,created_at,ended_at,caller_id_used,contact_phone,status,outcome,is_missed,missed_reason,agent_id,answered_by_agent_id,routed_agent_ids,missed_for_agent_id,voicemail_id,notes,campaign_id,recording_url,recording_storage_path',true),
 ('messages','sms','coalesce(s.sent_at,s.created_at)',
  '(s.contact_id=$2 AND (s.contact_type=$3 OR s.contact_type IS NULL)) OR ($3=''lead'' AND s.contact_id IS NULL AND s.lead_id=$2)',
  'id,direction,body,sent_at,created_at,from_number,to_number,status,created_by',false),
 ('contact_emails','email','coalesce(CASE WHEN s.direction IN (''inbound'',''incoming'') THEN s.received_at ELSE s.sent_at END,s.created_at)',
  's.contact_id=$2','id,direction,subject,body_text,body_html,from_email,to_emails,cc_emails,bcc_emails,delivery_status,sent_at,received_at,created_at,owner_user_id',true),
 ('contact_activities','legacy','s.created_at','s.contact_id=$2 AND s.contact_type=$3',
  'id,created_at,activity_type,description,agent_id,metadata',false)
 ) AS spec(tab,kind,clock,relation,fields,has_updated)
 LOOP
  IF (v_source.kind='legacy' AND p_mode<>'activity') OR
     (v_source.kind<>'legacy' AND p_filter<>'all' AND p_filter<>v_source.kind) THEN CONTINUE; END IF;
  IF v_source.kind='legacy' THEN
   v_source.relation:=v_source.relation||' AND NOT (s.activity_type IN (''call'',''disposition'') AND EXISTS (SELECT 1 FROM public.calls c WHERE c.organization_id=$1 AND c.id::text=s.metadata->>''call_id'' AND c.contact_id=$2 AND (c.contact_type=$3 OR c.contact_type IS NULL)))';
  END IF;
  -- A correction to a previously available source invalidates paging, rather than skipping it.
  IF p_cursor IS NOT NULL AND v_source.has_updated THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I s WHERE s.organization_id=$1 AND (%s) AND s.created_at<=$4 AND s.updated_at>$4)',v_source.tab,v_source.relation)
    INTO v_changed USING v_org,p_contact_id,p_contact_type,v_cutoff;
   IF v_changed THEN RAISE EXCEPTION 'History changed; refresh to continue' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_mode='activity' AND v_source.kind='sms' THEN v_source.fields:='id,direction,status,created_by'; END IF;
  IF p_mode='activity' AND v_source.kind='email' THEN v_source.fields:='id,direction,delivery_status'; END IF;
  IF p_mode='activity' AND v_source.kind='call' THEN v_source.fields:='id,direction,duration,disposition_id,disposition_name,status,outcome,is_missed,missed_reason,agent_id,answered_by_agent_id,routed_agent_ids,voicemail_id'; END IF;
  SELECT string_agg(format('s.%I',k),',') INTO v_fields FROM unnest(string_to_array(v_source.fields,',')) k;
  v_sql := format('SELECT coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM (
   SELECT %s AS event_time, %L||s.id::text AS event_key,%L::text AS kind,
    (SELECT to_jsonb(projected) FROM (SELECT %s) projected) AS payload
   FROM public.%I s WHERE s.organization_id=$1 AND (%s)
    AND (s.created_at IS NULL OR s.created_at<=$4) AND coalesce(%s,''-infinity''::timestamptz)<=$4
    AND (coalesce(%s,''-infinity''::timestamptz),%L||s.id::text)<($5,$6)
   ORDER BY coalesce(%s,''-infinity''::timestamptz) DESC,(%L||s.id::text) COLLATE "C" DESC LIMIT $7) q',
   v_source.clock,v_source.kind||':',v_source.kind,v_fields,v_source.tab,v_source.relation,
   v_source.clock,v_source.clock,v_source.kind||':',v_source.clock,v_source.kind||':');
  -- First page uses a high key with infinity time; subsequent keys are source-qualified UUIDs.
  EXECUTE v_sql INTO v_part USING v_org,p_contact_id,p_contact_type,v_cutoff,v_before,v_key,v_limit+1;
  v_rows := v_rows || v_part;
 END LOOP;
 IF p_mode='activity' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]') INTO v_part FROM
   public.contact_history_operational_page(v_org,p_contact_id,p_contact_type,v_cutoff,v_before,v_key,v_limit+1) o;
  v_rows := v_rows||v_part;
 END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY coalesce((x->>'event_time')::timestamptz,'-infinity') DESC,(x->>'event_key') COLLATE "C" DESC),'[]')
 INTO v_rows FROM (SELECT value x FROM jsonb_array_elements(v_rows)
 ORDER BY coalesce((value->>'event_time')::timestamptz,'-infinity') DESC,(value->>'event_key') COLLATE "C" DESC LIMIT v_limit+1) s;
 v_more := jsonb_array_length(v_rows)>v_limit;
 SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO v_page
 FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(value,ord) WHERE ord<=v_limit;
 v_last := v_page->(jsonb_array_length(v_page)-1);
 RETURN jsonb_build_object('items',v_page,'hasMore',v_more,'nextCursor',CASE WHEN v_more THEN
 jsonb_build_object('version',1,'viewer',v_viewer,'org',v_org,'contact',p_contact_id,'type',p_contact_type,
 'mode',p_mode,'filter',p_filter,'alias',coalesce(v_alias::text,''),'cutoff',v_cutoff,
 'time',coalesce(v_last->>'event_time','-infinity'),'key',v_last->>'event_key') ELSE NULL END) || public.contact_history_capture_info();
END $$;
REVOKE ALL ON FUNCTION public.get_contact_history_page(uuid,text,text,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_contact_history_page(uuid,text,text,text,jsonb,integer) TO authenticated;
CREATE FUNCTION public.get_contact_conversation_page(p_contact_id uuid,p_contact_type text,p_filter text DEFAULT 'all',p_cursor jsonb DEFAULT NULL,p_page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT public.get_contact_history_page(p_contact_id,p_contact_type,'conversation',p_filter,p_cursor,p_page_size)
$$;
CREATE FUNCTION public.get_contact_activity_page(p_contact_id uuid,p_contact_type text,p_cursor jsonb DEFAULT NULL,p_page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT public.get_contact_history_page(p_contact_id,p_contact_type,'activity','all',p_cursor,p_page_size)
$$;
REVOKE ALL ON FUNCTION public.get_contact_conversation_page(uuid,text,text,jsonb,integer),public.get_contact_activity_page(uuid,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_contact_conversation_page(uuid,text,text,jsonb,integer),public.get_contact_activity_page(uuid,text,jsonb,integer) TO authenticated;

CREATE INDEX contact_history_calls_page ON public.calls (organization_id,contact_id,(coalesce(started_at,created_at)) DESC,id DESC);
CREATE INDEX contact_history_sms_page ON public.messages (organization_id,contact_id,(coalesce(sent_at,created_at)) DESC,id DESC);
CREATE INDEX contact_history_sms_lead_page ON public.messages (organization_id,lead_id,(coalesce(sent_at,created_at)) DESC,id DESC) WHERE contact_id IS NULL;
CREATE INDEX contact_history_email_page ON public.contact_emails (organization_id,contact_id,(coalesce(CASE WHEN direction IN ('inbound','incoming') THEN received_at ELSE sent_at END,created_at)) DESC,id DESC);
CREATE INDEX contact_history_legacy_page ON public.contact_activities (organization_id,contact_id,contact_type,created_at DESC,id DESC);
