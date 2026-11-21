-- User-authored definitions only. A fresh install has no definitions or activation intervals.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE private.automation_release_controls (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  builder_visible boolean NOT NULL DEFAULT false,
  enrollment_enabled boolean NOT NULL DEFAULT false,
  dispatch_enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE private.automation_release_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.automation_release_controls FROM PUBLIC, anon, authenticated;

ALTER TABLE public.workflows
  ADD COLUMN automation_graph jsonb,
  ADD COLUMN automation_draft_name text,
  ADD COLUMN automation_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN automation_version_id uuid,
  ADD UNIQUE (organization_id,id);

CREATE TABLE public.workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  revision bigint NOT NULL,
  name text NOT NULL,
  graph jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  published_by uuid NOT NULL,
  UNIQUE (organization_id,workflow_id,id),
  UNIQUE (organization_id,workflow_id,revision),
  FOREIGN KEY (organization_id,workflow_id) REFERENCES public.workflows(organization_id,id)
);
ALTER TABLE public.workflows ADD FOREIGN KEY (organization_id,id,automation_version_id)
  REFERENCES public.workflow_versions(organization_id,workflow_id,id);

CREATE TABLE public.automation_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  version_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz CHECK (ends_at >= starts_at),
  FOREIGN KEY (organization_id,workflow_id,version_id)
    REFERENCES public.workflow_versions(organization_id,workflow_id,id)
);
CREATE UNIQUE INDEX automation_one_open_interval ON public.automation_intervals(organization_id,workflow_id)
  WHERE ends_at IS NULL;
CREATE INDEX automation_interval_at_event ON public.automation_intervals(organization_id,starts_at,ends_at);
CREATE INDEX automation_workflow_list ON public.workflows(organization_id,updated_at DESC,id);
CREATE INDEX automation_execution_last_activity ON public.workflow_executions(organization_id,workflow_id,started_at DESC);

CREATE FUNCTION private.automation_builder_visible(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM private.automation_release_controls c
    WHERE c.organization_id=p_org AND c.builder_visible)
$$;

-- Section visibility defaults to true in older role matrices. Only a separate, explicit
-- workflow-management grant can delegate authoring. The real actor must be active at home.
CREATE FUNCTION private.automation_author_at(p_org uuid,p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=p_actor AND p.organization_id=p_org AND lower(p.status)='active'
      AND (p.role='Admin' OR p.is_super_admin OR
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.organization_id=p_org AND rp.role=p.role
            AND p.role IN ('Team Leader','Team Lead','Agent')
            AND jsonb_path_exists(rp.permissions, CASE WHEN p.role='Agent' THEN
              '$.f[*].features[*] ? (@.name == "Manage Automations" && @.agent == true)'::jsonpath
              ELSE '$.f[*].features[*] ? (@.name == "Manage Automations" && @.teamLeader == true)'::jsonpath END)
        ))
  )
$$;
CREATE FUNCTION private.automation_can_author(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p_org=public.get_org_id() AND auth.uid()=private.automation_viewer_id()
    AND private.automation_author_at(p_org,auth.uid())
$$;

-- Unattended work has no interactive auth.uid(). Recheck the stored publisher against
-- current campaign authority, preserving the same owner, administration, hierarchy and Team rules.
CREATE FUNCTION private.automation_audience_allowed(p_org uuid,p_actor uuid,p_campaign uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.automation_author_at(p_org,p_actor) AND EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN public.campaigns c ON c.id=p_campaign AND c.organization_id=p.organization_id
    WHERE p.id=p_actor AND p.organization_id=p_org AND (p_campaign IS NULL OR c.id IS NOT NULL)
      AND (p.role='Admin' OR p.is_super_admin OR c.user_id=p_actor
           OR (p.role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(p.id,c.user_id))
           OR (upper(btrim(c.type))='TEAM' AND c.assigned_agent_ids ? p_actor::text)))
$$;
REVOKE ALL ON FUNCTION private.automation_author_at(uuid,uuid), private.automation_audience_allowed(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.automation_can_author(uuid), private.automation_builder_visible(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.automation_can_author(uuid), private.automation_builder_visible(uuid)
  TO authenticated;

CREATE FUNCTION private.automation_require_author(p_session_revision bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid := public.get_org_id();
BEGIN
  PERFORM private.automation_require_session(p_session_revision);
  IF NOT (private.automation_can_author(org) AND private.automation_builder_visible(org)) THEN
    RAISE EXCEPTION 'Automation management unavailable' USING ERRCODE='42501';
  END IF;
  RETURN org;
END $$;
REVOKE ALL ON FUNCTION private.automation_require_author(bigint) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.automation_trigger(p_graph jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_graph->'nodes')='array'
    THEN p_graph->'nodes' ELSE '[]'::jsonb END) WHERE value->>'type' IN ('lead_created','campaign_membership_created') LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.automation_trigger(jsonb) FROM PUBLIC,anon,authenticated;

-- A delegation covers its holder's drafts and specifically managed campaign audiences.
-- A shared draft and its live version must both be within scope before another author edits it.
CREATE FUNCTION private.automation_graph_in_scope(p_org uuid,p_graph jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE start_node jsonb:=private.automation_trigger(p_graph); chosen text:=start_node#>>'{config,campaign_id}';
BEGIN
  IF private.automation_audience_allowed(p_org,auth.uid(),NULL) THEN RETURN true; END IF;
  IF start_node->>'type' IS DISTINCT FROM 'campaign_membership_created' OR start_node#>'{config,any_campaign}'='true'
    OR coalesce(chosen,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN private.can_administer_campaign(chosen::uuid);
END $$;

CREATE FUNCTION private.automation_workflow_access(p_org uuid,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.automation_builder_visible(p_org) AND private.automation_can_author(p_org) AND EXISTS (
    SELECT 1 FROM public.workflows w LEFT JOIN public.workflow_versions v
      ON (v.organization_id,v.workflow_id,v.id)=(w.organization_id,w.id,w.automation_version_id)
    WHERE w.organization_id=p_org AND w.id=p_id AND (
      private.automation_audience_allowed(p_org,auth.uid(),NULL)
      OR (w.created_by=auth.uid() AND w.automation_version_id IS NULL)
      OR (w.automation_graph IS NOT NULL AND
          (w.created_by=auth.uid() OR private.automation_graph_in_scope(p_org,w.automation_graph)) AND
          (v.id IS NULL OR private.automation_graph_in_scope(p_org,v.graph) OR
             (w.created_by=auth.uid() AND v.published_by=auth.uid()
              AND private.automation_trigger(v.graph)#>'{config,any_campaign}'='true')))))
$$;
REVOKE ALL ON FUNCTION private.automation_graph_in_scope(uuid,jsonb), private.automation_workflow_access(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.automation_workflow_access(uuid,uuid), private.automation_graph_in_scope(uuid,jsonb) TO authenticated;

-- Report switches from the same agency as the verified viewer. A management read may
-- include the pinned trigger, even while a different trigger is being edited.
CREATE FUNCTION public.automation_access(p_workflow_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH agency AS (
    SELECT p.organization_id AS org, coalesce(c.builder_visible,false) AS visible,
      coalesce(c.builder_visible,false) AND private.automation_can_author(p.organization_id) AS author,
      c.enrollment_enabled,c.dispatch_enabled
    FROM public.profiles p LEFT JOIN private.automation_release_controls c ON c.organization_id=p.organization_id
    WHERE p.id=private.automation_viewer_id() AND lower(p.status)='active'
  )
  SELECT jsonb_build_object('visible',a.visible,'can_author',a.author) ||
    CASE WHEN a.author THEN jsonb_build_object('release_controls',jsonb_build_object(
      'enrollment_enabled',a.enrollment_enabled,'dispatch_enabled',a.dispatch_enabled)) ELSE '{}' END ||
    CASE WHEN w.id IS NOT NULL THEN jsonb_build_object('workflow',jsonb_build_object(
      'id',w.id,'status',w.status,'revision',w.automation_revision,
      'trigger_type',private.automation_trigger(v.graph)->>'type')) ELSE '{}' END
  FROM agency a LEFT JOIN public.workflows w ON a.author AND w.organization_id=a.org AND w.id=p_workflow_id
    AND w.automation_graph IS NOT NULL AND private.automation_workflow_access(a.org,w.id)
  LEFT JOIN public.workflow_versions v ON (v.organization_id,v.workflow_id,v.id)=(a.org,w.id,w.automation_version_id)
$$;

CREATE FUNCTION private.automation_history_contact_visible(p_org uuid,p_contact uuid,p_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.automation_builder_visible(p_org) AND EXISTS (
    SELECT 1 FROM public.profiles actor JOIN LATERAL (
      SELECT l.user_id AS owner_id FROM public.leads l WHERE p_type='lead' AND l.organization_id=p_org AND l.id=p_contact
      UNION ALL SELECT c.assigned_agent_id FROM public.clients c WHERE p_type='client' AND c.organization_id=p_org AND c.id=p_contact
      UNION ALL SELECT r.assigned_agent_id FROM public.recruits r WHERE p_type='recruit' AND r.organization_id=p_org AND r.id=p_contact
    ) contact ON true
    WHERE actor.id=private.automation_viewer_id() AND actor.organization_id=p_org AND actor.status='Active'
      AND (actor.is_super_admin OR actor.role='Admin' OR contact.owner_id=actor.id OR
        (actor.role IN ('Team Leader','Team Lead') AND contact.owner_id IN (
          SELECT agent_id FROM private.resolve_downline_ids(actor.id,p_org)))))
$$;
REVOKE ALL ON FUNCTION private.automation_history_contact_visible(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.automation_history_contact_visible(uuid,uuid,text) TO authenticated;

-- The baseline grants both table DML and worker RPC EXECUTE to browser roles.
-- Drop permissive policies before installing scoped replacements; permissive policies OR together.
DO $$
DECLARE t text; p record; predicate text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflows','workflow_nodes','workflow_edges','workflow_folders',
      'workflow_executions','workflow_execution_steps','workflow_versions','automation_intervals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
    END LOOP;
    predicate:=CASE t
      WHEN 'workflows' THEN 'private.automation_workflow_access(organization_id,id)'
      WHEN 'workflow_nodes' THEN 'private.automation_workflow_access(organization_id,workflow_id)'
      WHEN 'workflow_edges' THEN 'private.automation_workflow_access(organization_id,workflow_id)'
      WHEN 'workflow_versions' THEN 'private.automation_workflow_access(organization_id,workflow_id) AND (published_by=auth.uid() OR private.automation_graph_in_scope(organization_id,graph))'
      WHEN 'workflow_folders' THEN 'private.automation_can_author(organization_id) AND private.automation_builder_visible(organization_id)'
      WHEN 'workflow_executions' THEN 'private.automation_history_contact_visible(organization_id,contact_id,contact_type)'
      WHEN 'workflow_execution_steps' THEN 'EXISTS (SELECT 1 FROM public.workflow_executions e WHERE e.organization_id=workflow_execution_steps.organization_id AND e.id=workflow_execution_steps.execution_id)'
    END;
    IF predicate IS NOT NULL THEN
      EXECUTE format('CREATE POLICY automation_scoped_read ON public.%I FOR SELECT TO authenticated USING (%s)',t,predicate);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON public.workflow_versions,public.automation_intervals FROM service_role;
GRANT SELECT ON public.workflow_versions,public.automation_intervals TO service_role;

CREATE OR REPLACE FUNCTION public.get_active_workflows_for_trigger(p_org_id uuid,p_trigger_type text,p_trigger_key text DEFAULT NULL)
RETURNS SETOF public.workflows LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT w.* FROM public.workflows w
  WHERE w.organization_id=p_org_id AND w.status='active' AND w.automation_graph IS NULL AND w.trigger_type=p_trigger_type
    AND (p_trigger_key IS NULL OR w.trigger_config->>'disposition_id'=p_trigger_key
      OR w.trigger_config->>'to_stage_id'=p_trigger_key OR w.trigger_config->>'tag'=p_trigger_key
      OR w.trigger_config->>'field_name'=p_trigger_key OR w.trigger_config->>'appointment_type'=p_trigger_key
      OR (p_trigger_type='sms_received' AND (coalesce(w.trigger_config->>'keyword_filter','')=''
          OR p_trigger_key ILIKE '%' || (w.trigger_config->>'keyword_filter') || '%')))
$$;
REVOKE ALL ON FUNCTION public.get_active_workflows_for_trigger(uuid,text,text),
  public.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_workflows_for_trigger(uuid,text,text) TO service_role;

-- Page an indexed, fixed-size tenant window before evaluating row management authority.
-- The opaque continuation avoids exposing IDs or names from inaccessible campaigns.
CREATE INDEX automation_campaign_picker ON public.campaigns(organization_id,(md5(id::text) COLLATE "C"));
CREATE INDEX automation_source_picker ON public.lead_sources(organization_id,name) WHERE active;
CREATE FUNCTION public.automation_campaign_options(p_after text DEFAULT '',p_selected uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=public.get_org_id(); page jsonb;
BEGIN
  IF NOT (private.automation_can_author(org) AND private.automation_builder_visible(org)) THEN
    RAISE EXCEPTION 'Automation management unavailable' USING ERRCODE='42501';
  END IF;
  IF coalesce(p_after,'') !~ '^([0-9a-f]{32})?$' THEN RAISE EXCEPTION 'Invalid campaign cursor' USING ERRCODE='22023'; END IF;
  WITH candidates AS MATERIALIZED (
    SELECT c.id,c.name,md5(c.id::text) COLLATE "C" AS pos FROM public.campaigns c
    WHERE c.organization_id=org AND md5(c.id::text) COLLATE "C">coalesce(p_after,'')
    ORDER BY pos LIMIT 51
  ), window_rows AS MATERIALIZED (SELECT * FROM candidates ORDER BY pos LIMIT 50)
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id)
            FROM window_rows WHERE private.can_administer_campaign(id)),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>50 THEN (SELECT max(pos) FROM window_rows) END,
    'selected',(SELECT jsonb_build_object('id',c.id,'name',c.name) FROM public.campaigns c
             WHERE c.organization_id=org AND c.id=p_selected AND private.can_administer_campaign(c.id))) INTO page;
  RETURN page;
END $$;
CREATE FUNCTION public.automation_sources(p_after text DEFAULT '')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.name),'[]') FROM (
    SELECT DISTINCT name FROM public.lead_sources WHERE organization_id=public.get_org_id() AND active
      AND private.automation_can_author(organization_id) AND private.automation_builder_visible(organization_id)
      AND name>coalesce(p_after,'')
    ORDER BY name LIMIT 50) s
$$;

-- Configuration can be incomplete. Structure and version must be understood before the editor can replace a graph.
CREATE FUNCTION private.automation_block_fields(p_type text,p_version jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_version='1'::jsonb THEN CASE p_type
    WHEN 'lead_created' THEN ARRAY['lead_source']
    WHEN 'campaign_membership_created' THEN ARRAY['campaign_id','any_campaign','lead_source']
    WHEN 'wait' THEN ARRAY['duration','unit']
    WHEN 'contact_has_email' THEN ARRAY[]::text[]
    WHEN 'send_sms' THEN ARRAY['body','purpose','template_id']
    WHEN 'send_email' THEN ARRAY['body','subject','sender_id','template_id'] END END
$$;

CREATE FUNCTION private.automation_editable_graph(g jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE part jsonb; allowed text[]; ids text[]:='{}'; uuid_pattern CONSTANT text :=
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR g->'format' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(g->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(g->'edges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(g->'settings') IS DISTINCT FROM 'object' OR octet_length(g::text)>512000 THEN RETURN false; END IF;
  IF g-ARRAY['format','nodes','edges','settings']<>'{}' OR (g->'settings')-ARRAY['reentry','stop_on_reply']<>'{}'
    OR coalesce(g#>>'{settings,reentry}','') NOT IN ('once','after_completion')
    OR jsonb_typeof(g#>'{settings,stop_on_reply}') IS DISTINCT FROM 'boolean'
    OR jsonb_array_length(g->'nodes')>100 OR jsonb_array_length(g->'edges')>200 THEN RETURN false; END IF;
  FOR part IN SELECT value FROM jsonb_array_elements(g->'nodes') LOOP
    IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR jsonb_typeof(part->'config') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    allowed:=private.automation_block_fields(part->>'type',part->'version');
    IF allowed IS NULL OR (part->'config')-allowed<>'{}' OR part-ARRAY['id','type','version','config']<>'{}'
      OR coalesce(part->>'id','') !~ uuid_pattern OR part->>'id'=ANY(ids) THEN RETURN false; END IF;
    ids:=array_append(ids,part->>'id');
  END LOOP;
  ids:='{}';
  FOR part IN SELECT value FROM jsonb_array_elements(g->'edges') LOOP
    IF jsonb_typeof(part) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF part-ARRAY['id','source','target','branch']<>'{}' OR coalesce(part->>'id','') !~ uuid_pattern
      OR part->>'id'=ANY(ids) OR coalesce(part->>'source','') !~ uuid_pattern OR coalesce(part->>'target','') !~ uuid_pattern
      OR (part->>'branch' IS NOT NULL AND part->>'branch' NOT IN ('yes','no')) THEN RETURN false; END IF;
    ids:=array_append(ids,part->>'id');
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.automation_editable_graph(jsonb),private.automation_block_fields(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_automation_draft(p_workflow_id uuid,p_name text,p_graph jsonb,p_expected_revision bigint,p_session_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid := private.automation_require_author(p_session_revision); rev bigint;
BEGIN
  IF p_workflow_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR length(coalesce(p_name,''))>100
    OR NOT private.automation_editable_graph(p_graph) THEN
    RAISE EXCEPTION 'Unsupported or malformed automation draft' USING ERRCODE='22023';
  END IF;
  IF p_expected_revision=0 THEN
    INSERT INTO public.workflows(id,organization_id,name,trigger_type,created_by,automation_draft_name,automation_graph,automation_revision)
      VALUES (p_workflow_id,org,coalesce(nullif(btrim(p_name),''),'Untitled automation'),'manual',auth.uid(),coalesce(p_name,''),p_graph,1)
      ON CONFLICT (id) DO NOTHING RETURNING automation_revision INTO rev;
  ELSE
    UPDATE public.workflows SET automation_graph=p_graph, automation_revision=automation_revision+1,
      automation_draft_name=coalesce(p_name,''), name=CASE WHEN automation_version_id IS NULL
        THEN coalesce(nullif(btrim(p_name),''),'Untitled automation') ELSE name END
    WHERE id=p_workflow_id AND organization_id=org AND private.automation_editable_graph(automation_graph)
      AND private.automation_workflow_access(org,id) AND (created_by=auth.uid() OR private.automation_graph_in_scope(org,p_graph))
      AND automation_revision=p_expected_revision AND status<>'archived' RETURNING automation_revision INTO rev;
  END IF;
  IF rev IS NULL THEN RAISE EXCEPTION 'Draft changed or unavailable; reopen the editor' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('id',p_workflow_id,'revision',rev);
END $$;

CREATE FUNCTION private.automation_graph_issues(p_org uuid,p_name text,p_graph jsonb)
RETURNS TABLE(node_id text,message text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE n jsonb; c jsonb; k text; e jsonb; keys text[]; seen text[]:='{}'; node_ids text[]:='{}';
  edge_ids text[]:='{}'; start_id text; starts int:=0; actions int:=0; reached int; copy text; reason text;
  uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF nullif(btrim(p_name),'') IS NULL THEN RETURN QUERY SELECT NULL::text,'Enter an automation name'; END IF;
  IF jsonb_typeof(p_graph) IS DISTINCT FROM 'object' OR p_graph->'format' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p_graph->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(p_graph->'edges') IS DISTINCT FROM 'array' THEN
    RETURN QUERY SELECT NULL::text,'Unsupported graph format'; RETURN;
  END IF;
  IF p_graph - ARRAY['format','nodes','edges','settings'] <> '{}' OR jsonb_typeof(p_graph->'settings') IS DISTINCT FROM 'object'
    OR coalesce(p_graph#>>'{settings,reentry}','') NOT IN ('once','after_completion')
    OR jsonb_typeof(p_graph#>'{settings,stop_on_reply}') IS DISTINCT FROM 'boolean'
    OR (p_graph->'settings') - ARRAY['reentry','stop_on_reply'] <> '{}' THEN
    RETURN QUERY SELECT NULL::text,'Review the workflow settings';
  END IF;
  FOR n IN SELECT value FROM jsonb_array_elements(p_graph->'nodes') LOOP
    node_id:=n->>'id'; k:=n->>'type'; c:=n->'config'; reason:=NULL;
    IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR coalesce(node_id,'') !~ uuid_pattern
      OR node_id=ANY(node_ids) OR n->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(c) IS DISTINCT FROM 'object'
      OR n - ARRAY['id','type','version','config'] <> '{}' THEN
      message:='Invalid block ID, version or configuration'; RETURN NEXT; CONTINUE;
    END IF;
    node_ids:=array_append(node_ids,node_id);
    keys:=private.automation_block_fields(k,n->'version');
    CASE k
      WHEN 'lead_created','campaign_membership_created' THEN
        start_id:=node_id; starts:=starts+1;
        IF c ? 'lead_source' AND coalesce(c->>'lead_source','')<>'' AND NOT EXISTS (
            SELECT 1 FROM public.lead_sources s WHERE s.organization_id=p_org AND s.active AND s.name=c->>'lead_source') THEN
          reason:='Select an available lead source';
        ELSIF k='campaign_membership_created' THEN
          IF (c->'any_campaign'='true' AND nullif(c->>'campaign_id','') IS NOT NULL)
            OR (c ? 'any_campaign' AND jsonb_typeof(c->'any_campaign')<>'boolean') THEN
            reason:='Choose one campaign scope';
          ELSIF c->'any_campaign' IS DISTINCT FROM 'true'::jsonb THEN
            IF coalesce(c->>'campaign_id','') !~ uuid_pattern THEN reason:='Select a campaign';
            ELSIF NOT private.can_administer_campaign((c->>'campaign_id')::uuid) THEN reason:='Campaign outside your management scope'; END IF;
          END IF;
        END IF;
        IF k='lead_created' AND NOT private.automation_audience_allowed(p_org,auth.uid(),NULL) THEN
          reason:='Agency-wide lead creation requires agency management authority';
        ELSIF k='campaign_membership_created' AND c->'any_campaign'='true' AND NOT EXISTS (
          SELECT 1 FROM public.campaigns ac WHERE ac.organization_id=p_org AND private.can_administer_campaign(ac.id)
        ) THEN reason:='No campaigns available within your management scope'; END IF;
      WHEN 'wait' THEN
        IF jsonb_typeof(c->'duration') IS DISTINCT FROM 'number' OR coalesce(c->>'duration','') !~ '^[1-9][0-9]{0,4}$'
          OR coalesce(c->>'unit','') NOT IN ('minutes','hours','days') THEN reason:='Choose a positive delay and unit'; END IF;
      WHEN 'contact_has_email' THEN NULL;
      WHEN 'send_sms','send_email' THEN
        actions:=actions+1;
        IF jsonb_typeof(c->'body') IS DISTINCT FROM 'string' OR nullif(btrim(c->>'body'),'') IS NULL
            OR length(c->>'body')>(CASE WHEN k='send_sms' THEN 1600 ELSE 20000 END) THEN
          reason:='Enter a message body within the channel limit';
        ELSIF k='send_sms' AND coalesce(c->>'purpose','') NOT IN ('informational','marketing') THEN reason:='Choose the SMS purpose';
        ELSIF k='send_email' AND (jsonb_typeof(c->'subject') IS DISTINCT FROM 'string' OR nullif(btrim(c->>'subject'),'') IS NULL
            OR length(c->>'subject')>200 OR coalesce(c->>'sender_id','') !~ uuid_pattern) THEN reason:='Enter the subject and choose an authorized sender';
        ELSIF c ? 'template_id' AND nullif(c->>'template_id','') IS NOT NULL AND (c->>'template_id') !~ uuid_pattern THEN
          reason:='Choose an eligible template';
        ELSE
          copy:=regexp_replace(concat(c->>'body',' ',c->>'subject'),'\{\{[[:space:]]*(first_name|last_name|email|phone)[[:space:]]*\}\}','','g');
          IF position('{{' IN copy)>0 OR position('}}' IN copy)>0 THEN reason:='Unsupported merge field';
          ELSIF to_regprocedure('private.automation_channel_issue(uuid,uuid,jsonb)') IS NULL THEN reason:='Channel configuration is unavailable';
          ELSE reason:=private.automation_channel_issue(p_org,auth.uid(),n); END IF;
        END IF;
      ELSE reason:='Unsupported block';
    END CASE;
    IF c - keys <> '{}' THEN reason:='Unsupported block configuration'; END IF;
    IF reason IS NOT NULL THEN message:=reason; RETURN NEXT; END IF;
  END LOOP;
  IF starts<>1 THEN RETURN QUERY SELECT NULL::text,'Choose exactly one trigger'; END IF;
  IF actions=0 THEN RETURN QUERY SELECT NULL::text,'Add at least one executable action'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_graph->'edges') LOOP
    node_id:=e->>'source'; reason:=NULL;
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR coalesce(e->>'id','') !~ uuid_pattern OR (e->>'id')=ANY(edge_ids)
      OR e - ARRAY['id','source','target','branch'] <> '{}' OR NOT (coalesce(node_id,'')=ANY(node_ids))
      OR NOT (coalesce(e->>'target','')=ANY(node_ids)) OR e->>'target'=start_id THEN
      reason:='Connection has an invalid ID or endpoint';
    ELSE
      SELECT value->>'type' INTO k FROM jsonb_array_elements(p_graph->'nodes') WHERE value->>'id'=node_id;
      IF (k='contact_has_email' AND coalesce(e->>'branch','') NOT IN ('yes','no')) OR (k<>'contact_has_email' AND e->>'branch' IS NOT NULL)
        OR concat(node_id,'/',e->>'branch')=ANY(seen) THEN reason:='Invalid or duplicate exit'; END IF;
    END IF;
    edge_ids:=array_append(edge_ids,e->>'id'); seen:=array_append(seen,concat(node_id,'/',e->>'branch'));
    IF reason IS NOT NULL THEN message:=reason; RETURN NEXT; END IF;
  END LOOP;
  -- UNION deduplicates (source,target) pairs so even adversarial cyclic graphs terminate.
  IF starts=1 THEN
    WITH RECURSIVE edges(a,b) AS (SELECT value->>'source',value->>'target' FROM jsonb_array_elements(p_graph->'edges')),
      paths(a,b) AS (SELECT a,b FROM edges UNION SELECT p.a,e.b FROM paths p JOIN edges e ON e.a=p.b)
    SELECT (SELECT count(*) FROM paths WHERE a=start_id)+1,
      (SELECT a FROM paths WHERE a=b LIMIT 1) INTO reached,node_id;
    IF node_id IS NOT NULL THEN message:='Remove the cycle'; RETURN NEXT; END IF;
    IF reached <> cardinality(node_ids) THEN RETURN QUERY SELECT NULL::text,'Connect every block to the trigger'; END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.automation_graph_issues(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.validate_automation_draft(p_workflow_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.workflows;
BEGIN
  SELECT * INTO w FROM public.workflows WHERE id=p_workflow_id AND organization_id=public.get_org_id()
    AND private.automation_workflow_access(organization_id,id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Automation unavailable' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM private.automation_graph_issues(w.organization_id,w.automation_draft_name,w.automation_graph) i);
END $$;

CREATE FUNCTION public.publish_automation(p_workflow_id uuid,p_expected_revision bigint,p_session_revision bigint,p_expected_controls jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=private.automation_require_author(p_session_revision); w public.workflows;
  version_id uuid; boundary timestamptz; issues jsonb; controls jsonb;
BEGIN
  -- Commit-order serialization with event capture's shared lock; concurrent intakes remain compatible.
  PERFORM pg_advisory_xact_lock(hashtextextended('automation-activation:'||org::text,0));
  SELECT * INTO w FROM public.workflows WHERE organization_id=org AND id=p_workflow_id AND private.automation_workflow_access(org,id) FOR UPDATE;
  IF NOT FOUND OR w.automation_graph IS NULL OR w.status='archived' THEN
    RAISE EXCEPTION 'Automation unavailable' USING ERRCODE='42501';
  END IF;
  IF w.automation_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Draft changed; reopen the editor' USING ERRCODE='40001'; END IF;
  -- Publish under the exact switch state reviewed by the author. An operator changing a
  -- switch waits for this transaction (or commits first and invalidates the review).
  SELECT jsonb_build_object('enrollment_enabled',enrollment_enabled,'dispatch_enabled',dispatch_enabled)
    INTO controls FROM private.automation_release_controls WHERE organization_id=org AND builder_visible FOR SHARE;
  IF controls IS NULL THEN RAISE EXCEPTION 'Agency controls unavailable' USING ERRCODE='42501'; END IF;
  IF p_expected_controls IS DISTINCT FROM controls THEN
    -- A changed review requires an author decision. A serialization failure lets PostgREST retry it.
    RAISE EXCEPTION 'Agency controls changed. Review the current settings before publishing.' USING ERRCODE='PT409';
  END IF;
  SELECT jsonb_agg(to_jsonb(i)) INTO issues FROM private.automation_graph_issues(org,w.automation_draft_name,w.automation_graph) i;
  IF issues IS NOT NULL THEN RAISE EXCEPTION 'Fix the indicated blocks before publishing' USING ERRCODE='22023', DETAIL=issues::text; END IF;
  IF EXISTS (SELECT 1 FROM public.workflow_versions v WHERE (v.organization_id,v.workflow_id,v.id)=(org,w.id,w.automation_version_id)
      AND v.name=w.automation_draft_name AND v.graph=w.automation_graph AND v.published_by=auth.uid()) THEN
    RETURN jsonb_build_object('id',w.id,'version_id',w.automation_version_id,'revision',w.automation_revision,
      'status',w.status,'trigger_type',private.automation_trigger(w.automation_graph)->>'type','release_controls',controls);
  END IF;
  boundary:=clock_timestamp();
  INSERT INTO public.workflow_versions(organization_id,workflow_id,revision,name,graph,published_at,published_by)
  VALUES (org,w.id,w.automation_revision,w.automation_draft_name,w.automation_graph,boundary,auth.uid()) RETURNING id INTO version_id;
  UPDATE public.automation_intervals SET ends_at=boundary WHERE organization_id=org AND workflow_id=w.id AND ends_at IS NULL;
  -- Publishing an edit to a paused workflow preserves the author's pause.
  IF w.status<>'paused' THEN
    INSERT INTO public.automation_intervals(organization_id,workflow_id,version_id,starts_at) VALUES (org,w.id,version_id,boundary);
  END IF;
  UPDATE public.workflows SET automation_version_id=version_id, automation_revision=w.automation_revision+1,
    status=CASE WHEN w.status='paused' THEN 'paused' ELSE 'active' END,name=w.automation_draft_name,
    -- Legacy Sheets warnings read the header. The legacy evaluator explicitly excludes versioned graphs.
    trigger_type=CASE WHEN private.automation_trigger(w.automation_graph)->>'type'='lead_created' THEN 'lead_created' ELSE 'manual' END
    WHERE organization_id=org AND id=w.id;
  RETURN jsonb_build_object('id',w.id,'version_id',version_id,'revision',w.automation_revision+1,
    'status',CASE WHEN w.status='paused' THEN 'paused' ELSE 'active' END,
    'trigger_type',private.automation_trigger(w.automation_graph)->>'type','release_controls',controls);
END $$;

CREATE FUNCTION public.automation_lifecycle(p_workflow_id uuid,p_operation text,p_session_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=private.automation_require_author(p_session_revision); w public.workflows;
  next_status text; boundary timestamptz;
BEGIN
  -- Commit-order serialization with event capture's shared lock; concurrent intakes remain compatible.
  PERFORM pg_advisory_xact_lock(hashtextextended('automation-activation:'||org::text,0));
  SELECT * INTO w FROM public.workflows WHERE organization_id=org AND id=p_workflow_id AND private.automation_workflow_access(org,id) FOR UPDATE;
  IF NOT FOUND OR w.automation_graph IS NULL OR w.status='archived' THEN RAISE EXCEPTION 'Automation unavailable' USING ERRCODE='42501'; END IF;
  next_status:=CASE WHEN p_operation='archive' THEN 'archived' WHEN p_operation='pause' AND w.status='active' THEN 'paused'
    WHEN p_operation='resume' AND w.status='paused' THEN 'active' END;
  IF next_status IS NULL THEN RAISE EXCEPTION 'Invalid status transition' USING ERRCODE='22023'; END IF;
  boundary:=clock_timestamp();
  UPDATE public.automation_intervals SET ends_at=boundary WHERE organization_id=org AND workflow_id=w.id AND ends_at IS NULL;
  IF next_status='active' AND w.automation_version_id IS NOT NULL THEN
    INSERT INTO public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
      VALUES (org,w.id,w.automation_version_id,boundary);
  END IF;
  UPDATE public.workflows SET status=next_status, automation_revision=automation_revision+1
    WHERE organization_id=org AND id=w.id;
END $$;

CREATE FUNCTION public.automation_folder(p_operation text,p_folder_id uuid,p_values jsonb,p_session_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=private.automation_require_author(p_session_revision); f public.workflow_folders;
BEGIN
  IF p_operation='move' THEN
    IF p_folder_id IS NOT NULL THEN
      PERFORM 1 FROM public.workflow_folders WHERE id=p_folder_id AND organization_id=org FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Folder unavailable' USING ERRCODE='42501'; END IF;
    END IF;
    UPDATE public.workflows SET folder_id=p_folder_id WHERE id=(p_values->>'workflow_id')::uuid AND organization_id=org AND private.automation_workflow_access(org,id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Automation unavailable' USING ERRCODE='42501'; END IF;
    RETURN '{}'::jsonb;
  END IF;
  IF p_operation IN ('update','delete') AND EXISTS (SELECT 1 FROM public.workflows
      WHERE organization_id=org AND folder_id=p_folder_id AND NOT private.automation_workflow_access(org,id)) THEN
    RAISE EXCEPTION 'Folder contains automations outside your scope' USING ERRCODE='42501';
  END IF;
  IF p_operation='delete' THEN
    DELETE FROM public.workflow_folders WHERE id=p_folder_id AND organization_id=org RETURNING * INTO f;
  ELSIF p_operation IN ('create','update') THEN
    IF (p_values ? 'name' AND length(btrim(coalesce(p_values->>'name',''))) NOT BETWEEN 1 AND 50)
      OR (p_operation='create' AND NOT p_values ? 'name')
      OR (p_values ? 'color' AND coalesce(p_values->>'color','') !~ '^#[a-fA-F0-9]{6}$')
      OR (p_values - ARRAY['name','color','sort_order']) <> '{}' THEN
      RAISE EXCEPTION 'Invalid folder settings' USING ERRCODE='22023';
    END IF;
    IF p_operation='create' THEN
      INSERT INTO public.workflow_folders(id,organization_id,name,color,sort_order)
      VALUES (coalesce(p_folder_id,gen_random_uuid()),org,btrim(p_values->>'name'),p_values->>'color',coalesce((p_values->>'sort_order')::int,0))
      RETURNING * INTO f;
    ELSE
      UPDATE public.workflow_folders SET name=coalesce(btrim(p_values->>'name'),name),color=coalesce(p_values->>'color',color),
        sort_order=coalesce((p_values->>'sort_order')::int,sort_order) WHERE id=p_folder_id AND organization_id=org RETURNING * INTO f;
    END IF;
  ELSE RAISE EXCEPTION 'Unknown folder operation' USING ERRCODE='22023';
  END IF;
  IF f.id IS NULL THEN RAISE EXCEPTION 'Folder unavailable' USING ERRCODE='42501'; END IF;
  RETURN to_jsonb(f);
END $$;

CREATE FUNCTION public.automation_overlap(p_workflow_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH current_draft AS (
    SELECT w.id,w.organization_id,private.automation_trigger(w.automation_graph) t FROM public.workflows w
    WHERE w.id=p_workflow_id AND w.organization_id=public.get_org_id() AND private.automation_can_author(w.organization_id)
      AND private.automation_workflow_access(w.organization_id,w.id)
  )
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (
    SELECT w.id,w.name FROM current_draft d JOIN public.workflows w ON w.organization_id=d.organization_id AND w.id<>d.id
    JOIN public.workflow_versions v ON v.organization_id=w.organization_id AND v.workflow_id=w.id AND v.id=w.automation_version_id
    CROSS JOIN LATERAL (SELECT private.automation_trigger(v.graph) t) active
    WHERE w.status='active' AND private.automation_workflow_access(w.organization_id,w.id) AND d.t IS NOT NULL
      AND (nullif(active.t#>>'{config,lead_source}','') IS NULL OR nullif(d.t#>>'{config,lead_source}','') IS NULL
        OR active.t#>>'{config,lead_source}'=d.t#>>'{config,lead_source}')
    ORDER BY w.name,w.id LIMIT 50
  ) q
$$;

CREATE FUNCTION public.automation_list(p_offset integer DEFAULT 0,p_campaign_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=public.get_org_id(); result jsonb;
BEGIN
  IF NOT (private.automation_can_author(org) AND private.automation_builder_visible(org)) THEN RETURN '[]'; END IF;
  IF p_campaign_id IS NOT NULL AND NOT private.can_administer_campaign(p_campaign_id) THEN RETURN '[]'; END IF;
  WITH page AS MATERIALIZED (
    SELECT w.*,private.automation_trigger(coalesce(v.graph,w.automation_graph)) AS start_node
    FROM public.workflows w LEFT JOIN public.workflow_versions v ON v.id=w.automation_version_id AND v.organization_id=w.organization_id AND v.workflow_id=w.id
    WHERE w.organization_id=org AND private.automation_workflow_access(org,w.id) AND (p_campaign_id IS NULL OR EXISTS (
      SELECT 1 FROM (SELECT private.automation_trigger(coalesce(v.graph,w.automation_graph)) n) scoped WHERE n->>'type'='campaign_membership_created'
        AND (n#>>'{config,campaign_id}'=p_campaign_id::text OR n#>'{config,any_campaign}'='true'::jsonb)))
    ORDER BY w.updated_at DESC,w.id LIMIT 50 OFFSET greatest(coalesce(p_offset,0),0)
  )
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.updated_at DESC,q.id),'[]') INTO result FROM (
    SELECT w.id,w.name,w.status,w.updated_at,CASE WHEN w.automation_graph IS NULL THEN w.trigger_type ELSE w.start_node->>'type' END AS trigger_type,
      w.folder_id,w.automation_revision,w.automation_version_id,w.automation_graph IS NULL AS is_legacy,
      jsonb_build_object('enrollment_enabled',c.enrollment_enabled,'dispatch_enabled',c.dispatch_enabled) AS release_controls,
      greatest(legacy.started_at, activity.updated_at) AS last_activity_at
    FROM page w JOIN private.automation_release_controls c ON c.organization_id=w.organization_id
    LEFT JOIN LATERAL (SELECT e.started_at FROM public.workflow_executions e WHERE e.organization_id=org AND e.workflow_id=w.id
      AND private.automation_history_contact_visible(org,e.contact_id,e.contact_type) ORDER BY e.started_at DESC LIMIT 1) legacy ON true
    LEFT JOIN LATERAL (SELECT r.updated_at FROM private.automation_runs r WHERE r.organization_id=org AND r.workflow_id=w.id
      AND private.automation_history_contact_visible(org,r.contact_id,r.contact_type) ORDER BY r.updated_at DESC LIMIT 1) activity ON true
  ) q;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.automation_access(uuid),public.automation_campaign_options(text,uuid),public.automation_sources(text),
  public.save_automation_draft(uuid,text,jsonb,bigint,bigint),public.publish_automation(uuid,bigint,bigint,jsonb),
  public.validate_automation_draft(uuid),public.automation_overlap(uuid),public.automation_list(integer,uuid),
  public.automation_lifecycle(uuid,text,bigint),public.automation_folder(text,uuid,jsonb,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_access(uuid),public.automation_campaign_options(text,uuid),public.automation_sources(text),
  public.save_automation_draft(uuid,text,jsonb,bigint,bigint),public.publish_automation(uuid,bigint,bigint,jsonb),
  public.validate_automation_draft(uuid),public.automation_overlap(uuid),public.automation_list(integer,uuid),
  public.automation_lifecycle(uuid,text,bigint),public.automation_folder(text,uuid,jsonb,bigint)
  TO authenticated;
COMMIT;
