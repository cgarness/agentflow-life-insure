-- Automations V2 authoring. Adds optional step details, new block definitions and a server-resolved
-- SMS purpose that is pinned at publish. Installs no definitions, versions, enrollments or sends.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Never installed over a database where Automations V2 was rolled back, or where a stopped installation was backed
-- out: the files after a back-out would run beside restored first-release functions. That takes a new migration.
DO $v2_guard$ BEGIN
  IF to_regprocedure('private.automation_v2_rollback_guard()') IS NOT NULL
      OR to_regprocedure('private.automation_v2_backed_out()') IS NOT NULL THEN
    RAISE EXCEPTION 'Automations V2 was rolled back or backed out on this database. Installing it again takes a new migration.';
  END IF;
END $v2_guard$;

CREATE FUNCTION private.automation_block_category(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_type IN ('lead_created','campaign_membership_created','disposition_recorded','appointment_booked',
      'appointment_outcome_recorded','inbound_call_missed','sale_recorded','policy_issuance_confirmed') THEN 'trigger'
    WHEN p_type IN ('send_sms','send_email','create_task') THEN 'action'
    WHEN p_type IN ('wait','wait_until_before_appointment') THEN 'wait'
    WHEN p_type = 'contact_has_email' THEN 'condition' END
$$;

-- Steps a trigger can run. Messages and the email condition use the lead delivery path; the appointment
-- wait needs a booked occurrence to anchor to.
CREATE FUNCTION private.automation_block_available(p_type text,p_trigger text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_type IN ('send_sms','send_email','contact_has_email') THEN coalesce(p_trigger IN ('lead_created',
      'campaign_membership_created','disposition_recorded','appointment_booked','appointment_outcome_recorded'),false)
    WHEN p_type = 'wait_until_before_appointment' THEN coalesce(p_trigger = 'appointment_booked',false)
    ELSE true END
$$;

CREATE OR REPLACE FUNCTION private.automation_block_fields(p_type text,p_version jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_version='1'::jsonb THEN CASE p_type
    WHEN 'lead_created' THEN ARRAY['lead_source']
    WHEN 'campaign_membership_created' THEN ARRAY['campaign_id','any_campaign','lead_source']
    WHEN 'disposition_recorded' THEN ARRAY['disposition_ids']
    WHEN 'appointment_booked' THEN ARRAY[]::text[]
    WHEN 'appointment_outcome_recorded' THEN ARRAY['outcomes']
    WHEN 'inbound_call_missed' THEN ARRAY[]::text[]
    WHEN 'sale_recorded' THEN ARRAY[]::text[]
    WHEN 'policy_issuance_confirmed' THEN ARRAY[]::text[]
    WHEN 'wait' THEN ARRAY['duration','unit']
    WHEN 'wait_until_before_appointment' THEN ARRAY['amount','unit','late']
    WHEN 'contact_has_email' THEN ARRAY[]::text[]
    WHEN 'send_sms' THEN ARRAY['body','purpose','template_id']
    WHEN 'send_email' THEN ARRAY['body','subject','sender_id','template_id']
    WHEN 'create_task' THEN ARRAY['title','task_type','notes','due_amount','due_unit'] END
  WHEN p_version='2'::jsonb THEN CASE p_type
    WHEN 'send_sms' THEN ARRAY['body','template_id'] END END
$$;

CREATE OR REPLACE FUNCTION private.automation_trigger(p_graph jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_graph->'nodes')='array'
    THEN p_graph->'nodes' ELSE '[]'::jsonb END)
  WHERE private.automation_block_category(value->>'type')='trigger' LIMIT 1
$$;

-- Optional author notes on a step. Bounded plain text, never part of execution configuration.
-- Control characters are an explicit range, the same one the shared TypeScript graph rule uses:
-- U+0001-U+001F and U+007F-U+009F. A description may keep tabs and line breaks; a name may not,
-- nor a line or paragraph separator. Lengths count characters, as the TypeScript rule does.
CREATE FUNCTION private.automation_step_meta_valid(p_meta jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_meta IS NULL OR (
    jsonb_typeof(p_meta)='object' AND p_meta-ARRAY['name','description']='{}'::jsonb
    AND (NOT p_meta ? 'name' OR (jsonb_typeof(p_meta->'name')='string' AND length(p_meta->>'name')<=80
      AND (p_meta->>'name') !~ '[\x01-\x1F\x7F-\x9F\u2028\u2029]'))
    AND (NOT p_meta ? 'description' OR (jsonb_typeof(p_meta->'description')='string'
      AND length(p_meta->>'description')<=500 AND (p_meta->>'description') !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]')))
$$;

-- Mirror of the shared field catalog (supabase/functions/_shared/automations/fields.ts).
CREATE FUNCTION private.automation_fields_valid(p_text text,p_trigger text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT regexp_replace(coalesce(p_text,''),
    CASE WHEN p_trigger IN ('appointment_booked','appointment_outcome_recorded')
      THEN '\{\{[[:space:]]*(first_name|last_name|email|phone|appointment_date|appointment_time)[[:space:]]*\}\}'
      ELSE '\{\{[[:space:]]*(first_name|last_name|email|phone)[[:space:]]*\}\}' END,'','g') !~ '\{\{|\}\}'
$$;

-- The rewrite the builder applies when an author picks a saved message. Same five tokens, spaces and tabs only.
CREATE FUNCTION private.automation_saved_message_text(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p_text,''),
    '\{\{[ \t]*contact_first_name[ \t]*\}\}','{{first_name}}','g'),
    '\{\{[ \t]*contact_last_name[ \t]*\}\}','{{last_name}}','g'),
    '\{\{[ \t]*contact_full_name[ \t]*\}\}','{{first_name}} {{last_name}}','g'),
    '\{\{[ \t]*contact_phone[ \t]*\}\}','{{phone}}','g'),
    '\{\{[ \t]*contact_email[ \t]*\}\}','{{email}}','g')
$$;

-- An unchanged agency saved message keeps the purpose recorded on it. Every other wording requires
-- marketing consent. A purpose supplied by the author can tighten this result and can never relax it.
CREATE FUNCTION private.automation_sms_resolution(p_org uuid,p_node jsonb)
RETURNS TABLE(purpose text,basis text,template_id uuid,template_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jsonb:=p_node->'config'; chosen text:=nullif(cfg->>'template_id','');
  authored boolean:=coalesce(p_node->'version','1'::jsonb)='1'::jsonb AND cfg->>'purpose'='marketing'; saved record;
BEGIN
  IF chosen ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT t.id,t.sms_purpose,md5(t.content) AS content_hash INTO saved FROM public.message_templates t
      WHERE t.organization_id=p_org AND t.id=chosen::uuid AND t.type='sms' AND t.scope='agency'
        AND t.sms_purpose IS NOT NULL AND private.automation_saved_message_text(t.content)=cfg->>'body';
    IF FOUND THEN
      RETURN QUERY SELECT CASE WHEN authored THEN 'marketing' ELSE saved.sms_purpose END,
        CASE WHEN authored AND saved.sms_purpose<>'marketing' THEN 'author' ELSE 'saved_message' END,saved.id,saved.content_hash;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT 'marketing'::text,CASE WHEN authored THEN 'author' ELSE 'custom' END,NULL::uuid,NULL::text;
END $$;

CREATE TABLE private.automation_sms_purposes (
  organization_id uuid NOT NULL,
  version_id uuid NOT NULL REFERENCES public.workflow_versions(id),
  node_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('informational','marketing')),
  basis text NOT NULL CHECK (basis IN ('saved_message','custom','author')),
  template_id uuid,
  template_hash text,
  resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (version_id,node_id)
);
ALTER TABLE private.automation_sms_purposes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.automation_sms_purposes FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION private.automation_block_category(text),private.automation_block_available(text,text),
  private.automation_step_meta_valid(jsonb),private.automation_fields_valid(text,text),
  private.automation_saved_message_text(text),private.automation_sms_resolution(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.automation_editable_graph(g jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE part jsonb; allowed text[]; ids text[]:='{}'; uuid_pattern CONSTANT text :=
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR g->'format' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(g->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(g->'edges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(g->'settings') IS DISTINCT FROM 'object' OR octet_length(g::text)>512000 THEN RETURN false; END IF;
  IF g-ARRAY['format','nodes','edges','settings']<>'{}'
    OR (g->'settings')-ARRAY['reentry','stop_on_reply','stop_on_booking','stop_on_contact']<>'{}'
    OR coalesce(g#>>'{settings,reentry}','') NOT IN ('once','after_completion','after_end')
    OR jsonb_typeof(g#>'{settings,stop_on_reply}') IS DISTINCT FROM 'boolean'
    OR (g->'settings' ? 'stop_on_booking' AND jsonb_typeof(g#>'{settings,stop_on_booking}')<>'boolean')
    OR (g->'settings' ? 'stop_on_contact' AND jsonb_typeof(g#>'{settings,stop_on_contact}')<>'boolean')
    OR jsonb_array_length(g->'nodes')>100 OR jsonb_array_length(g->'edges')>200 THEN RETURN false; END IF;
  FOR part IN SELECT value FROM jsonb_array_elements(g->'nodes') LOOP
    IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR jsonb_typeof(part->'config') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    allowed:=private.automation_block_fields(part->>'type',part->'version');
    IF allowed IS NULL OR (part->'config')-allowed<>'{}' OR part-ARRAY['id','type','version','config','meta']<>'{}'
      OR (part ? 'meta' AND NOT private.automation_step_meta_valid(part->'meta'))
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

-- A version 1 SMS step keeps its original template rule. Newer steps treat a saved message as a
-- starting point for wording only: the purpose is resolved from the wording when the version is published.
CREATE OR REPLACE FUNCTION private.automation_channel_issue(p_org uuid,p_actor uuid,p_node jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE cfg jsonb:=p_node->'config'; channel text;
BEGIN
  IF p_node->>'type'='send_email' THEN channel:='email';
  ELSIF p_node->>'type'='send_sms' THEN channel:='sms';
  ELSE RETURN NULL; END IF;
  IF channel='sms' AND coalesce(p_node->'version','1'::jsonb)='1'::jsonb AND nullif(cfg->>'template_id','') IS NOT NULL AND NOT EXISTS (
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

CREATE OR REPLACE FUNCTION private.automation_graph_issues(p_org uuid,p_name text,p_graph jsonb)
RETURNS TABLE(node_id text,message text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE n jsonb; c jsonb; k text; e jsonb; keys text[]; seen text[]:='{}'; node_ids text[]:='{}';
  edge_ids text[]:='{}'; start_id text; starts int:=0; actions int:=0; reached int; reason text; trig text;
  agency_wide boolean; kind text;
  uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF nullif(btrim(p_name),'') IS NULL THEN RETURN QUERY SELECT NULL::text,'Enter an automation name'; END IF;
  IF jsonb_typeof(p_graph) IS DISTINCT FROM 'object' OR p_graph->'format' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p_graph->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(p_graph->'edges') IS DISTINCT FROM 'array' THEN
    RETURN QUERY SELECT NULL::text,'Unsupported graph format'; RETURN;
  END IF;
  IF p_graph - ARRAY['format','nodes','edges','settings'] <> '{}' OR jsonb_typeof(p_graph->'settings') IS DISTINCT FROM 'object'
    OR coalesce(p_graph#>>'{settings,reentry}','') NOT IN ('once','after_completion','after_end')
    OR jsonb_typeof(p_graph#>'{settings,stop_on_reply}') IS DISTINCT FROM 'boolean'
    OR (p_graph->'settings' ? 'stop_on_booking' AND jsonb_typeof(p_graph#>'{settings,stop_on_booking}')<>'boolean')
    OR (p_graph->'settings' ? 'stop_on_contact' AND jsonb_typeof(p_graph#>'{settings,stop_on_contact}')<>'boolean')
    OR (p_graph->'settings') - ARRAY['reentry','stop_on_reply','stop_on_booking','stop_on_contact'] <> '{}' THEN
    RETURN QUERY SELECT NULL::text,'Review the workflow settings';
  END IF;
  trig:=private.automation_trigger(p_graph)->>'type';
  agency_wide:=private.automation_audience_allowed(p_org,auth.uid(),NULL);
  FOR n IN SELECT value FROM jsonb_array_elements(p_graph->'nodes') LOOP
    node_id:=n->>'id'; k:=n->>'type'; c:=n->'config'; reason:=NULL;
    keys:=CASE WHEN jsonb_typeof(n)='object' THEN private.automation_block_fields(k,n->'version') END;
    IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR coalesce(node_id,'') !~ uuid_pattern
      OR node_id=ANY(node_ids) OR jsonb_typeof(c) IS DISTINCT FROM 'object'
      OR n - ARRAY['id','type','version','config','meta'] <> '{}' THEN
      message:='Invalid block ID, version or configuration'; RETURN NEXT; CONTINUE;
    END IF;
    node_ids:=array_append(node_ids,node_id);
    kind:=private.automation_block_category(k);
    IF keys IS NULL OR kind IS NULL THEN
      message:='Unsupported block or version'; RETURN NEXT; CONTINUE;
    END IF;
    IF kind='trigger' THEN start_id:=node_id; starts:=starts+1; END IF;
    IF kind='action' THEN actions:=actions+1; END IF;
    CASE k
      WHEN 'lead_created','campaign_membership_created' THEN
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
        IF k='lead_created' AND NOT agency_wide THEN
          reason:='Agency-wide lead creation requires agency management authority';
        ELSIF k='campaign_membership_created' AND c->'any_campaign'='true' AND NOT EXISTS (
          SELECT 1 FROM public.campaigns ac WHERE ac.organization_id=p_org AND private.can_administer_campaign(ac.id)
        ) THEN reason:='No campaigns available within your management scope'; END IF;
      WHEN 'disposition_recorded' THEN
        IF jsonb_typeof(c->'disposition_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'disposition_ids') NOT BETWEEN 1 AND 20 THEN
          reason:='Choose at least one disposition';
        ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c->'disposition_ids')='array'
            THEN c->'disposition_ids' ELSE '[]'::jsonb END) chosen
          WHERE jsonb_typeof(chosen.value)<>'string' OR (chosen.value#>>'{}') !~ uuid_pattern OR NOT EXISTS (
            SELECT 1 FROM public.dispositions d WHERE d.organization_id=p_org AND d.id::text=chosen.value#>>'{}')) THEN
          reason:='Select dispositions that still exist in this agency';
        END IF;
      WHEN 'appointment_outcome_recorded' THEN
        IF jsonb_typeof(c->'outcomes') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'outcomes') NOT BETWEEN 1 AND 2
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c->'outcomes')='array'
            THEN c->'outcomes' ELSE '[]'::jsonb END) chosen
            WHERE jsonb_typeof(chosen.value)<>'string' OR (chosen.value#>>'{}') NOT IN ('no_show','held')) THEN
          reason:='Choose at least one appointment outcome';
        END IF;
      WHEN 'appointment_booked','inbound_call_missed','sale_recorded','policy_issuance_confirmed' THEN NULL;
      WHEN 'wait' THEN
        IF jsonb_typeof(c->'duration') IS DISTINCT FROM 'number' OR coalesce(c->>'duration','') !~ '^[1-9][0-9]{0,4}$'
          OR coalesce(c->>'unit','') NOT IN ('minutes','hours','days') THEN reason:='Choose a positive delay and unit'; END IF;
      WHEN 'wait_until_before_appointment' THEN
        IF jsonb_typeof(c->'amount') IS DISTINCT FROM 'number' OR coalesce(c->>'amount','') !~ '^[1-9][0-9]{0,4}$'
          OR coalesce(c->>'unit','') NOT IN ('minutes','hours','days')
          OR (c ? 'late' AND coalesce(c->>'late','') NOT IN ('skip','continue')) THEN
          reason:='Choose how long before the appointment';
        END IF;
      WHEN 'contact_has_email' THEN NULL;
      WHEN 'create_task' THEN
        IF jsonb_typeof(c->'title') IS DISTINCT FROM 'string' OR nullif(btrim(c->>'title'),'') IS NULL OR length(c->>'title')>200 THEN
          reason:='Enter a task title';
        ELSIF coalesce(c->>'task_type','') NOT IN ('Send Quote','Follow Up','Check Application','Policy Review','General') THEN
          reason:='Choose a task type';
        ELSIF jsonb_typeof(c->'due_amount') IS DISTINCT FROM 'number' OR coalesce(c->>'due_amount','') !~ '^(0|[1-9][0-9]{0,4})$'
          OR coalesce(c->>'due_unit','') NOT IN ('minutes','hours','days') THEN reason:='Choose when the task is due';
        ELSIF c ? 'notes' AND (jsonb_typeof(c->'notes')<>'string' OR length(c->>'notes')>2000) THEN reason:='Shorten the task notes';
        ELSIF NOT private.automation_fields_valid(c->>'title',trig) OR NOT private.automation_fields_valid(c->>'notes',trig) THEN
          reason:='Unsupported field in the task text';
        END IF;
      WHEN 'send_sms','send_email' THEN
        IF jsonb_typeof(c->'body') IS DISTINCT FROM 'string' OR nullif(btrim(c->>'body'),'') IS NULL
            OR length(c->>'body')>(CASE WHEN k='send_sms' THEN 1600 ELSE 20000 END) THEN
          reason:='Enter a message body within the channel limit';
        ELSIF k='send_sms' AND n->'version'='1'::jsonb AND coalesce(c->>'purpose','') NOT IN ('informational','marketing') THEN
          reason:='Choose the SMS purpose';
        ELSIF k='send_email' AND (jsonb_typeof(c->'subject') IS DISTINCT FROM 'string' OR nullif(btrim(c->>'subject'),'') IS NULL
            OR length(c->>'subject')>200 OR coalesce(c->>'sender_id','') !~ uuid_pattern) THEN reason:='Enter the subject and choose an authorized sender';
        ELSIF c ? 'template_id' AND nullif(c->>'template_id','') IS NOT NULL AND (c->>'template_id') !~ uuid_pattern THEN
          reason:='Choose an eligible template';
        ELSIF NOT private.automation_fields_valid(c->>'body',trig) OR NOT private.automation_fields_valid(c->>'subject',trig) THEN
          reason:='Unsupported merge field';
        ELSIF to_regprocedure('private.automation_channel_issue(uuid,uuid,jsonb)') IS NULL THEN reason:='Channel configuration is unavailable';
        ELSE reason:=private.automation_channel_issue(p_org,auth.uid(),n); END IF;
      ELSE reason:='Unsupported block';
    END CASE;
    IF kind='trigger' AND k NOT IN ('lead_created','campaign_membership_created') AND NOT agency_wide THEN
      reason:='This trigger requires agency management authority';
    END IF;
    IF kind<>'trigger' AND trig IS NOT NULL AND NOT private.automation_block_available(k,trig) THEN
      reason:='This step is not available after the selected trigger';
    END IF;
    IF c - keys <> '{}' THEN reason:='Unsupported block configuration'; END IF;
    IF n ? 'meta' AND NOT private.automation_step_meta_valid(n->'meta') THEN reason:='Step details are not valid'; END IF;
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
      SELECT private.automation_block_category(nodes.value->>'type') INTO kind
        FROM jsonb_array_elements(p_graph->'nodes') nodes WHERE nodes.value->>'id'=node_id;
      IF (kind='condition' AND coalesce(e->>'branch','') NOT IN ('yes','no')) OR (kind IS DISTINCT FROM 'condition' AND e->>'branch' IS NOT NULL)
        OR concat(node_id,'/',e->>'branch')=ANY(seen) THEN reason:='Invalid or duplicate exit'; END IF;
    END IF;
    edge_ids:=array_append(edge_ids,e->>'id'); seen:=array_append(seen,concat(node_id,'/',e->>'branch'));
    IF reason IS NOT NULL THEN message:=reason; RETURN NEXT; END IF;
  END LOOP;
  -- UNION deduplicates (source,target) pairs so even adversarial cyclic graphs terminate.
  IF starts=1 THEN
    WITH RECURSIVE edges(a,b) AS (SELECT value->>'source',value->>'target' FROM jsonb_array_elements(p_graph->'edges')),
      paths(a,b) AS (SELECT a,b FROM edges UNION SELECT p.a,e2.b FROM paths p JOIN edges e2 ON e2.a=p.b)
    SELECT (SELECT count(*) FROM paths WHERE a=start_id)+1,
      (SELECT a FROM paths WHERE a=b LIMIT 1) INTO reached,node_id;
    IF node_id IS NOT NULL THEN message:='Remove the cycle'; RETURN NEXT; END IF;
    IF reached <> cardinality(node_ids) THEN RETURN QUERY SELECT NULL::text,'Connect every block to the trigger'; END IF;
  END IF;
END $$;

-- A stale revision is a conflict the author must resolve, never a transient failure. The API layer
-- retries serialization failures without limit, so these three refusals answer with a plain conflict.
CREATE OR REPLACE FUNCTION public.save_automation_draft(p_workflow_id uuid,p_name text,p_graph jsonb,p_expected_revision bigint,p_session_revision bigint)
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
  IF rev IS NULL THEN RAISE EXCEPTION 'Draft changed or unavailable; reopen the editor' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('id',p_workflow_id,'revision',rev);
END $$;

CREATE OR REPLACE FUNCTION public.automation_session_transition(p_expected_revision bigint,p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid uuid := private.automation_session_id();
  ctx private.automation_sessions;
BEGIN
  SELECT * INTO ctx FROM private.automation_sessions WHERE session_id=sid AND actor_id=auth.uid() FOR UPDATE;
  IF ctx.revision IS NULL OR ctx.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Session mode changed. Reopen this view.' USING ERRCODE='PT409';
  END IF;
  IF p_target_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles a JOIN public.profiles t ON a.organization_id=t.organization_id
    WHERE a.id=auth.uid() AND a.status='Active' AND a.is_super_admin IS TRUE
      AND t.id=p_target_id AND t.status='Active' AND t.id<>a.id
  ) THEN
    RAISE EXCEPTION 'View As target is unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE private.automation_sessions SET target_id=p_target_id,revision=nextval('private.automation_session_revision')
    WHERE session_id=sid AND actor_id=auth.uid() RETURNING * INTO ctx;
  RETURN to_jsonb(ctx);
END $$;

-- Publishing pins the graph and, for every SMS step, the purpose the server resolved for its wording.
CREATE OR REPLACE FUNCTION public.publish_automation(p_workflow_id uuid,p_expected_revision bigint,p_session_revision bigint,p_expected_controls jsonb)
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
  IF w.automation_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Draft changed; reopen the editor' USING ERRCODE='PT409'; END IF;
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
  -- Publishing the live graph again changes nothing, unless an SMS step would now be pinned differently
  -- (its saved message changed, or the live version predates pinning). Then it publishes a new version.
  IF EXISTS (SELECT 1 FROM public.workflow_versions v WHERE (v.organization_id,v.workflow_id,v.id)=(org,w.id,w.automation_version_id)
      AND v.name=w.automation_draft_name AND v.graph=w.automation_graph AND v.published_by=auth.uid())
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(w.automation_graph->'nodes') step
      CROSS JOIN LATERAL private.automation_sms_resolution(org,step.value) resolved
      WHERE step.value->>'type'='send_sms' AND NOT EXISTS (SELECT 1 FROM private.automation_sms_purposes pinned
        WHERE pinned.organization_id=org AND pinned.version_id=w.automation_version_id AND pinned.node_id=step.value->>'id'
          AND (pinned.purpose,pinned.basis,pinned.template_id,pinned.template_hash)
            IS NOT DISTINCT FROM (resolved.purpose,resolved.basis,resolved.template_id,resolved.template_hash))) THEN
    RETURN jsonb_build_object('id',w.id,'version_id',w.automation_version_id,'revision',w.automation_revision,
      'status',w.status,'trigger_type',private.automation_trigger(w.automation_graph)->>'type','release_controls',controls);
  END IF;
  boundary:=clock_timestamp();
  INSERT INTO public.workflow_versions(organization_id,workflow_id,revision,name,graph,published_at,published_by)
  VALUES (org,w.id,w.automation_revision,w.automation_draft_name,w.automation_graph,boundary,auth.uid()) RETURNING id INTO version_id;
  INSERT INTO private.automation_sms_purposes(organization_id,version_id,node_id,purpose,basis,template_id,template_hash)
    SELECT org,version_id,step.value->>'id',resolved.purpose,resolved.basis,resolved.template_id,resolved.template_hash
    FROM jsonb_array_elements(w.automation_graph->'nodes') step
    CROSS JOIN LATERAL private.automation_sms_resolution(org,step.value) resolved
    WHERE step.value->>'type'='send_sms';
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

-- What publishing would pin for each SMS step of the saved draft. Read-only review aid.
CREATE FUNCTION public.automation_sms_requirements(p_workflow_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.workflows;
BEGIN
  SELECT * INTO w FROM public.workflows WHERE id=p_workflow_id AND organization_id=public.get_org_id()
    AND private.automation_workflow_access(organization_id,id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Automation unavailable' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('node_id',step.value->>'id','purpose',resolved.purpose,'basis',resolved.basis)),'[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.automation_graph->'nodes')='array' THEN w.automation_graph->'nodes' ELSE '[]'::jsonb END) step
    CROSS JOIN LATERAL private.automation_sms_resolution(w.organization_id,step.value) resolved
    WHERE step.value->>'type'='send_sms' AND jsonb_typeof(step.value->'config')='object');
END $$;

CREATE FUNCTION public.automation_disposition_options()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=public.get_org_id();
BEGIN
  IF (private.automation_can_author(org) AND private.automation_builder_visible(org)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Automation management unavailable' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'color',d.color) ORDER BY d.sort_order,d.name,d.id),'[]'::jsonb)
    FROM public.dispositions d WHERE d.organization_id=org);
END $$;

-- Saved messages the author can read for one channel. Wording is copied into the step by the builder.
CREATE FUNCTION public.automation_saved_messages(p_type text,p_search text DEFAULT '',p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid:=public.get_org_id(); page jsonb;
BEGIN
  IF (private.automation_can_author(org) AND private.automation_builder_visible(org)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Automation management unavailable' USING ERRCODE='42501';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('sms','email') OR coalesce(p_offset,0)<0 OR length(coalesce(p_search,''))>200 THEN
    RAISE EXCEPTION 'Invalid saved message search' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.name,t.id),'[]'::jsonb) INTO page FROM (
    SELECT m.id,m.name,m.type,m.subject,m.content,m.scope,m.sms_purpose FROM public.message_templates m
    WHERE m.organization_id=org AND m.type=p_type AND (m.scope='agency' OR m.created_by=auth.uid())
      AND strpos(lower(m.name),lower(coalesce(p_search,'')))>0
    ORDER BY m.name,m.id OFFSET coalesce(p_offset,0) LIMIT 51) t;
  RETURN jsonb_build_object('items',page - 50,'more',jsonb_array_length(page)>50);
END $$;

-- Two active workflows overlap when the same kind of event can start both for the same audience.
CREATE OR REPLACE FUNCTION public.automation_overlap(p_workflow_id uuid)
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
      AND CASE WHEN d.t->>'type' IN ('lead_created','campaign_membership_created')
        THEN active.t->>'type' IN ('lead_created','campaign_membership_created')
          AND (nullif(active.t#>>'{config,lead_source}','') IS NULL OR nullif(d.t#>>'{config,lead_source}','') IS NULL
            OR active.t#>>'{config,lead_source}'=d.t#>>'{config,lead_source}')
        WHEN d.t->>'type'='disposition_recorded'
        THEN active.t->>'type'='disposition_recorded' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.t#>'{config,disposition_ids}')='array'
            THEN d.t#>'{config,disposition_ids}' ELSE '[]'::jsonb END) mine
          WHERE active.t#>'{config,disposition_ids}' ? mine.value)
        WHEN d.t->>'type'='appointment_outcome_recorded'
        THEN active.t->>'type'='appointment_outcome_recorded' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.t#>'{config,outcomes}')='array'
            THEN d.t#>'{config,outcomes}' ELSE '[]'::jsonb END) mine
          WHERE active.t#>'{config,outcomes}' ? mine.value)
        ELSE active.t->>'type'=d.t->>'type' END
    ORDER BY w.name,w.id LIMIT 50
  ) q
$$;

REVOKE ALL ON FUNCTION public.automation_sms_requirements(uuid),public.automation_disposition_options(),
  public.automation_saved_messages(text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_sms_requirements(uuid),public.automation_disposition_options(),
  public.automation_saved_messages(text,text,integer) TO authenticated;
COMMIT;
