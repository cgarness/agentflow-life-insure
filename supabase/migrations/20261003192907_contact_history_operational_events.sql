-- Future operational changes only. No backfill; no voice/disposition/queue function replacements.
SET lock_timeout='3s';
SET statement_timeout='60s';
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.contact_history_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 contact_id uuid NOT NULL, contact_type text NOT NULL CHECK(contact_type IN ('lead','client','recruit')),
 source_table text NOT NULL, source_id uuid NOT NULL, action text NOT NULL,
 actor_id uuid, actor_kind text NOT NULL CHECK(actor_kind IN ('agent','system')),
 assignee_before uuid, assignee_after uuid, access_ids uuid[] NOT NULL DEFAULT '{}',
 before_values jsonb NOT NULL DEFAULT '{}', after_values jsonb NOT NULL DEFAULT '{}',
 changed_fields text[] NOT NULL DEFAULT '{}', recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 capture_version integer NOT NULL DEFAULT 1
);
ALTER TABLE public.contact_history_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_history_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contact_history_events TO authenticated;
CREATE INDEX contact_history_events_page ON public.contact_history_events(organization_id,contact_id,contact_type,recorded_at DESC,id DESC);
CREATE INDEX contact_history_events_source ON public.contact_history_events(organization_id,source_table,source_id,action);

CREATE TABLE public.contact_history_capture_health (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), source_table text NOT NULL,
 error_code text NOT NULL
);
ALTER TABLE public.contact_history_capture_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_history_capture_health FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contact_history_capture_health TO authenticated;
CREATE POLICY contact_history_health_select ON public.contact_history_capture_health FOR SELECT TO authenticated
 USING (organization_id=public.get_org_id());
CREATE INDEX contact_history_health_org ON public.contact_history_capture_health(organization_id);
-- Freeze the actual installation time; no historical business rows are backfilled.
DO $install$ BEGIN
 EXECUTE format($definition$
 CREATE OR REPLACE FUNCTION public.contact_history_capture_info() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $body$
 SELECT jsonb_build_object('captureStartedAt',%L::timestamptz,'captureHasGaps',
 EXISTS(SELECT 1 FROM public.contact_history_capture_health WHERE organization_id=public.get_org_id()))
 $body$ $definition$,clock_timestamp());
END $install$;


-- All source checks execute with the reader's privileges. A hidden source is never a deletion.
CREATE FUNCTION public.contact_history_event_visible(p_event public.contact_history_events)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_contact_visible boolean; v_source_visible boolean := false;
BEGIN
 IF auth.uid() IS NULL OR p_event.organization_id IS DISTINCT FROM public.get_org_id() THEN RETURN false; END IF;
 v_contact_visible := public.contact_history_contact_visible(p_event.organization_id,p_event.contact_id,p_event.contact_type);
 IF NOT v_contact_visible AND p_event.contact_type='lead' THEN
  SELECT EXISTS(SELECT 1 FROM public.clients c WHERE c.lead_id=p_event.contact_id AND c.organization_id=p_event.organization_id)
   INTO v_contact_visible;
 END IF;
 IF NOT coalesce(v_contact_visible,false) THEN RETURN false; END IF;
 -- Deleted-source history is a minimal tombstone, limited to involved users or same-org admins.
 IF p_event.action='deleted' THEN
  RETURN auth.uid()=ANY(p_event.access_ids) OR EXISTS(SELECT 1 FROM public.profiles p
   WHERE p.id=auth.uid() AND p.organization_id=p_event.organization_id AND p.role IN ('Admin','Super Admin'));
 END IF;
 CASE p_event.source_table
  WHEN 'appointments' THEN SELECT EXISTS(SELECT 1 FROM public.appointments WHERE id=p_event.source_id AND organization_id=p_event.organization_id) INTO v_source_visible;
  WHEN 'tasks' THEN SELECT EXISTS(SELECT 1 FROM public.tasks WHERE id=p_event.source_id AND organization_id=p_event.organization_id) INTO v_source_visible;
  WHEN 'contact_notes' THEN SELECT EXISTS(SELECT 1 FROM public.contact_notes WHERE id=p_event.source_id AND organization_id=p_event.organization_id) INTO v_source_visible;
  WHEN 'campaign_leads' THEN SELECT EXISTS(SELECT 1 FROM public.campaign_leads WHERE id=p_event.source_id AND organization_id=p_event.organization_id) INTO v_source_visible;
  WHEN 'leads' THEN v_source_visible := v_contact_visible;
  WHEN 'clients' THEN v_source_visible := v_contact_visible;
  WHEN 'recruits' THEN v_source_visible := v_contact_visible;
  ELSE RETURN false;
 END CASE;
 RETURN coalesce(v_source_visible,false);
END $$;
REVOKE ALL ON FUNCTION public.contact_history_event_visible(public.contact_history_events) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contact_history_event_visible(public.contact_history_events) TO authenticated;
CREATE POLICY contact_history_events_select ON public.contact_history_events FOR SELECT TO authenticated
 USING (public.contact_history_event_visible(contact_history_events));

-- Private capture authority only, never a reader or RPC. Business operations must still succeed
-- if capture fails. No business-row locks, network calls, telephony writes, or owner changes.
CREATE FUNCTION private.capture_contact_history_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 n jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 o jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 org uuid; cid uuid; ct text; actor uuid; before_owner uuid; after_owner uuid;
 source_id uuid; action_name text; keys text[]; changed text[] := '{}';
 visible_keys text[]; bv jsonb := '{}'; av jsonb := '{}'; k text;
BEGIN
 BEGIN
  org := (n->>'organization_id')::uuid; source_id := (n->>'id')::uuid;
  IF org IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
  -- A service process has no human actor. Never substitute creator or assigned user.
  actor := auth.uid();
  CASE TG_TABLE_NAME
   WHEN 'leads','clients','recruits' THEN
    cid:=source_id; ct:=CASE TG_TABLE_NAME WHEN 'leads' THEN 'lead' WHEN 'clients' THEN 'client' ELSE 'recruit' END;
    keys:=ARRAY['assigned_agent_id','status','first_name','last_name','phone','email','state','date_of_birth','age','lead_source','custom_fields','notes','best_time_to_call','carrier','policy_type','premium','face_amount','issue_date','effective_date','sold_date'];
    visible_keys:=ARRAY['assigned_agent_id','status','lead_source'];
    before_owner:=(o->>'assigned_agent_id')::uuid; after_owner:=(n->>'assigned_agent_id')::uuid;
    IF TG_OP='DELETE' AND TG_TABLE_NAME='leads' AND EXISTS(SELECT 1 FROM public.clients WHERE lead_id=cid AND organization_id=org) THEN RETURN OLD; END IF;
   WHEN 'campaign_leads' THEN
    cid:=coalesce((n->>'lead_id')::uuid,(o->>'lead_id')::uuid); ct:='lead';
    IF cid IS NULL THEN SELECT e.contact_id INTO cid FROM public.contact_history_events e
     WHERE e.organization_id=org AND e.source_table='campaign_leads' AND e.source_id=(n->>'id')::uuid AND e.contact_type='lead'
     ORDER BY e.recorded_at DESC LIMIT 1; END IF;
    keys:=ARRAY['status','claimed_by','user_id','callback_due_at','scheduled_callback_at','callback_agent_id','callback_note'];
    visible_keys:=ARRAY['status','claimed_by','user_id','callback_due_at','scheduled_callback_at','callback_agent_id','campaign_id'];
    before_owner:=coalesce((o->>'callback_agent_id')::uuid,(o->>'claimed_by')::uuid);
    after_owner:=coalesce((n->>'callback_agent_id')::uuid,(n->>'claimed_by')::uuid);
   WHEN 'appointments' THEN
    cid:=(n->>'contact_id')::uuid;
    -- Appointments have no contact_type: resolve only an exact same-org identity.
    SELECT t INTO ct FROM (SELECT 'lead' t FROM public.leads WHERE id=cid AND organization_id=org
     UNION ALL SELECT 'client' FROM public.clients WHERE id=cid AND organization_id=org
     UNION ALL SELECT 'recruit' FROM public.recruits WHERE id=cid AND organization_id=org) q LIMIT 1;
    keys:=ARRAY['user_id','start_time','end_time','status','title','type','notes'];
    visible_keys:=ARRAY['user_id','start_time','end_time','status','title','type'];
    before_owner:=coalesce((o->>'user_id')::uuid,(o->>'created_by')::uuid);
    after_owner:=coalesce((n->>'user_id')::uuid,(n->>'created_by')::uuid);
   WHEN 'tasks' THEN
    cid:=(n->>'contact_id')::uuid; ct:=n->>'contact_type';
    keys:=ARRAY['assigned_to','title','task_type','due_date','completed_at','notes'];
    visible_keys:=ARRAY['assigned_to','title','task_type','due_date','completed_at'];
    before_owner:=(o->>'assigned_to')::uuid; after_owner:=(n->>'assigned_to')::uuid;
   WHEN 'contact_notes' THEN
    cid:=(n->>'contact_id')::uuid; ct:=n->>'contact_type';
    keys:=ARRAY['content','pinned']; visible_keys:=ARRAY['pinned'];
   ELSE RETURN coalesce(NEW,OLD);
  END CASE;
  IF cid IS NULL OR ct IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
  IF TG_OP='UPDATE' THEN
   FOREACH k IN ARRAY keys LOOP
    IF (n->k) IS DISTINCT FROM (o->k) THEN changed:=array_append(changed,k); END IF;
   END LOOP;
   IF cardinality(changed)=0 THEN RETURN NEW; END IF;
  END IF;
  action_name:=CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END;
  IF TG_OP='INSERT' AND TG_TABLE_NAME='clients' AND n->>'lead_id' IS NOT NULL THEN action_name:='converted'; END IF;
  IF TG_OP='INSERT' AND TG_TABLE_NAME='leads' AND n->>'imported_by_user_id' IS NOT NULL THEN action_name:='imported'; END IF;
  IF TG_OP<>'DELETE' THEN
   FOREACH k IN ARRAY visible_keys LOOP
    IF TG_OP='INSERT' OR k=ANY(changed) THEN
     IF TG_OP<>'INSERT' THEN bv:=bv||jsonb_build_object(k,o->k); END IF;
     av:=av||jsonb_build_object(k,n->k);
    END IF;
   END LOOP;
   -- Campaign name resolution uses a visible current campaign id, never raw id presentation.
   IF TG_TABLE_NAME='campaign_leads' THEN
    av:=av||jsonb_build_object('campaign_id',n->'campaign_id');
    IF 'callback_due_at'=ANY(changed) OR 'scheduled_callback_at'=ANY(changed) THEN
     bv:=bv||jsonb_build_object('callback_due_at',o->'callback_due_at','scheduled_callback_at',o->'scheduled_callback_at');
     av:=av||jsonb_build_object('callback_due_at',n->'callback_due_at','scheduled_callback_at',n->'scheduled_callback_at');
    END IF;
   END IF;
  ELSE
   -- A deleted row never leaves its sensitive title/content/time in the retained tombstone.
   changed:='{}'; before_owner:=NULL; after_owner:=NULL;
  END IF;
  LOCK TABLE public.contact_history_events IN ROW EXCLUSIVE MODE NOWAIT;
  INSERT INTO public.contact_history_events(organization_id,contact_id,contact_type,source_table,source_id,
   action,actor_id,actor_kind,assignee_before,assignee_after,access_ids,before_values,after_values,changed_fields)
  VALUES(org,cid,ct,TG_TABLE_NAME,source_id,action_name,actor,CASE WHEN actor IS NULL THEN 'system' ELSE 'agent' END,
   before_owner,after_owner,array_remove(ARRAY[actor,(n->>'created_by')::uuid,(n->>'author_id')::uuid,
   (n->>'user_id')::uuid,(n->>'assigned_to')::uuid,(n->>'assigned_agent_id')::uuid],NULL),bv,av,changed);
 EXCEPTION WHEN OTHERS THEN
  -- Do not persist error messages containing row values. Nested isolation protects the source save.
  RAISE WARNING 'Contact history capture failed for %, SQLSTATE %',TG_TABLE_NAME,SQLSTATE;
  BEGIN
   IF org IS NOT NULL THEN
    LOCK TABLE public.contact_history_capture_health IN ROW EXCLUSIVE MODE NOWAIT;
    INSERT INTO public.contact_history_capture_health(organization_id,source_table,error_code) VALUES(org,TG_TABLE_NAME,SQLSTATE); END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
 END;
 RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION private.capture_contact_history_event() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['appointments','tasks','contact_notes','leads','clients','recruits','campaign_leads'] LOOP
  EXECUTE format('CREATE TRIGGER contact_history_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.capture_contact_history_event()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.contact_history_operational_page(p_org uuid,p_id uuid,p_type text,
 p_cutoff timestamptz,p_before timestamptz,p_key text,p_limit integer)
RETURNS TABLE(event_time timestamptz,event_key text,kind text,payload jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_alias uuid; v_limit integer:=least(greatest(coalesce(p_limit,31),1),101);
BEGIN
 IF NOT coalesce(public.contact_history_contact_visible(p_org,p_id,p_type),false) THEN
  RAISE EXCEPTION 'Contact history unavailable for this scope' USING ERRCODE='42501';
 END IF;
 IF p_type='client' THEN SELECT lead_id INTO v_alias FROM public.clients WHERE id=p_id AND organization_id=p_org; END IF;
 RETURN QUERY
 WITH events AS (
  SELECT e.recorded_at t,'event:'||e.id k,'operation'::text kind,
   jsonb_build_object('id',e.id,'source_table',e.source_table,'source_id',e.source_id,'action',e.action,
   'actor_id',e.actor_id,'actor_kind',e.actor_kind,'assignee_before',e.assignee_before,'assignee_after',e.assignee_after,
   'before_values',e.before_values,'after_values',e.after_values,'changed_fields',e.changed_fields) body
  FROM public.contact_history_events e WHERE e.organization_id=p_org AND
   ((e.contact_id=p_id AND e.contact_type=p_type) OR (e.contact_id=v_alias AND e.contact_type='lead'))
   AND e.recorded_at<=p_cutoff AND (e.recorded_at,'event:'||e.id)<(p_before,p_key)
  ORDER BY e.recorded_at DESC,e.id DESC LIMIT v_limit
 ), baseline AS (
  -- Current-state legacy evidence is explicitly a recorded snapshot, not a fabricated change log.
  (SELECT a.created_at t,'appointment:'||a.id k,'snapshot'::text kind,
   jsonb_build_object('id',a.id,'source_table','appointments','source_id',a.id,'action','recorded',
    'actor_id',a.created_by,'assignee_after',coalesce(a.user_id,a.created_by),
    'after_values',jsonb_build_object('title',a.title,'status',a.status,'start_time',a.start_time,'end_time',a.end_time,'type',a.type)) body
   FROM public.appointments a WHERE a.organization_id=p_org AND a.contact_id=p_id
   AND NOT EXISTS(SELECT 1 FROM public.contact_history_events e WHERE e.organization_id=p_org AND e.source_table='appointments' AND e.source_id=a.id AND e.action='created')
   AND coalesce(a.created_at,'-infinity')<=p_cutoff AND (coalesce(a.created_at,'-infinity'),'appointment:'||a.id)<(p_before,p_key)
   ORDER BY a.created_at DESC NULLS LAST,a.id DESC LIMIT v_limit)
  UNION ALL
  (SELECT t.created_at,'task:'||t.id,'snapshot',jsonb_build_object('id',t.id,'source_table','tasks','source_id',t.id,
   'action','recorded','actor_id',NULL,'assignee_after',t.assigned_to,
   'after_values',jsonb_build_object('title',t.title,'due_date',t.due_date,'completed_at',t.completed_at))
   FROM public.tasks t WHERE t.organization_id=p_org AND t.contact_id=p_id AND t.contact_type=p_type
   AND NOT EXISTS(SELECT 1 FROM public.contact_history_events e WHERE e.organization_id=p_org AND e.source_table='tasks' AND e.source_id=t.id AND e.action='created')
   AND coalesce(t.created_at,'-infinity')<=p_cutoff AND (coalesce(t.created_at,'-infinity'),'task:'||t.id)<(p_before,p_key)
   ORDER BY t.created_at DESC NULLS LAST,t.id DESC LIMIT v_limit)
  UNION ALL
  (SELECT n.created_at,'note:'||n.id,'snapshot',jsonb_build_object('id',n.id,'source_table','contact_notes','source_id',n.id,'action','recorded','actor_id',n.author_id,'after_values',jsonb_build_object('pinned',n.pinned))
   FROM public.contact_notes n WHERE n.organization_id=p_org AND n.contact_id=p_id AND n.contact_type=p_type
   AND NOT EXISTS(SELECT 1 FROM public.contact_history_events e WHERE e.organization_id=p_org AND e.source_table='contact_notes' AND e.source_id=n.id AND e.action='created')
   AND coalesce(n.created_at,'-infinity')<=p_cutoff AND (coalesce(n.created_at,'-infinity'),'note:'||n.id)<(p_before,p_key)
   ORDER BY n.created_at DESC NULLS LAST,n.id DESC LIMIT v_limit)
  UNION ALL
  (SELECT m.created_at,'membership:'||m.id,'snapshot',jsonb_build_object('id',m.id,'source_table','campaign_leads','source_id',m.id,
   'action','recorded','actor_id',NULL,'assignee_after',m.callback_agent_id,
   'after_values',jsonb_build_object('campaign_id',m.campaign_id,'status',m.status,'callback_due_at',coalesce(m.callback_due_at,m.scheduled_callback_at)))
   FROM public.campaign_leads m WHERE m.organization_id=p_org AND
    ((p_type='lead' AND m.lead_id=p_id) OR (p_type='client' AND EXISTS(SELECT 1 FROM public.calls c WHERE c.organization_id=p_org AND c.contact_id=p_id AND c.contact_type='client' AND c.campaign_lead_id=m.id)))
   AND NOT EXISTS(SELECT 1 FROM public.contact_history_events e WHERE e.organization_id=p_org AND e.source_table='campaign_leads' AND e.source_id=m.id AND e.action='created')
   AND coalesce(m.created_at,'-infinity')<=p_cutoff AND (coalesce(m.created_at,'-infinity'),'membership:'||m.id)<(p_before,p_key)
   ORDER BY m.created_at DESC NULLS LAST,m.id DESC LIMIT v_limit)
  UNION ALL
  (SELECT c.created_at,'contact:'||c.id,'snapshot',jsonb_build_object('id',c.id,'source_table',c.source_table,'source_id',c.id,
   'action',CASE WHEN c.lead_id IS NOT NULL THEN 'conversion_recorded' ELSE 'created' END,'actor_id',NULL,'after_values','{}'::jsonb)
   FROM (SELECT id,created_at,'leads' source_table,NULL::uuid lead_id FROM public.leads WHERE organization_id=p_org AND id=p_id AND p_type='lead'
   UNION ALL SELECT id,created_at,'clients',lead_id FROM public.clients WHERE organization_id=p_org AND id=p_id AND p_type='client'
   UNION ALL SELECT id,created_at,'recruits',NULL::uuid FROM public.recruits WHERE organization_id=p_org AND id=p_id AND p_type='recruit') c
   WHERE NOT EXISTS(SELECT 1 FROM public.contact_history_events e WHERE e.organization_id=p_org AND e.source_table=c.source_table AND e.source_id=c.id AND e.action IN ('created','converted','imported'))
   AND coalesce(c.created_at,'-infinity')<=p_cutoff AND (coalesce(c.created_at,'-infinity'),'contact:'||c.id)<(p_before,p_key))
 )
 SELECT x.t,x.k,x.kind,x.body FROM (SELECT * FROM events UNION ALL SELECT * FROM baseline) x
 ORDER BY coalesce(x.t,'-infinity') DESC,x.k COLLATE "C" DESC LIMIT v_limit;
END $$;
