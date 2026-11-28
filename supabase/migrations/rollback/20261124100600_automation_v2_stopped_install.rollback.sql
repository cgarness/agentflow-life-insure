-- Guarded back-out of an Automations V2 installation that stopped part way: files 1..k of the seven applied, 1 <= k <= 6.
-- Rehearse only on an isolated database. Production use needs its own approval.
-- Each of the seven files commits on its own, so an installation can stop between two of them. Resuming means applying
-- the remaining files in order. This file is for a stop that is not to be resumed. For a complete installation use
-- 20261124100600_automation_v2.rollback.sql. supabase/ops/automation_v2_install_state.sql reports which files are in.
-- The installation runs with enrollment, message delivery and the builder off for every agency, so nothing can have
-- used the partly installed functions. Run this the same way: psql -X -1 -v ON_ERROR_STOP=1 -f <this file>.
-- It refuses outside a transaction; when the installed files are not exactly 1..k, or when none or all seven are; while
-- any agency has enrollment, delivery or the builder on; when V2 has recorded anything (a pinned SMS purpose, an
-- event only V2 records, a task receipt, a callback, a late-answer cleanup or an issuance confirmation) or any published
-- version uses a step,
-- block version or rule only V2 runs; and when a function it replaces differs from the definition the installed files
-- give it, or, for a file not installed, from the first release.
-- It restores the first-release body of every function the installed files replaced, byte for byte, and turns the
-- observers they added into no-ops whose triggers stay attached. Every table, column, index and function they added
-- stays, unused, and no row is changed. It then records the back-out in private.automation_v2_backed_out(): the
-- install-state probe reports it, a second back-out refuses, and every V2 file refuses to install over it, because the
-- files after the ones backed out would run beside the restored first-release functions. Installing V2 afterwards is
-- a new migration, as after the full rollback.
\set ON_ERROR_STOP on
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $stopped_preimage$
DECLARE installed integer; prefix boolean; item jsonb; expected jsonb; actual jsonb; function_oid oid; recorded boolean;
BEGIN
 IF current_setting('lock_timeout') <> '3s' THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out refused: run this file as one transaction (psql -X -1 -v ON_ERROR_STOP=1 -f)';
 END IF;
 IF to_regprocedure('private.automation_v2_backed_out()') IS NOT NULL THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out refused: this installation was already backed out';
 END IF;
 IF to_regprocedure('private.automation_v2_rollback_guard()') IS NOT NULL THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out refused: Automations V2 was rolled back here';
 END IF;
 WITH files(n, present) AS (VALUES
    (1, to_regprocedure('public.automation_sms_requirements(uuid)') IS NOT NULL),
    (2, to_regprocedure('private.automation_stop_check(private.automation_runs)') IS NOT NULL),
    (3, to_regclass('private.automation_task_receipts') IS NOT NULL),
    (4, to_regprocedure('private.automation_capture_appointment_slot()') IS NOT NULL),
    (5, to_regclass('public.inbound_callbacks') IS NOT NULL),
    (6, to_regclass('public.policy_issuance_confirmations') IS NOT NULL),
    (7, to_regprocedure('public.automation_create_task(uuid,uuid,text,text,text)') IS NOT NULL))
 SELECT count(*) FILTER (WHERE present), bool_and(present = (n <= (SELECT count(*) FROM files f WHERE f.present)))
   INTO installed, prefix FROM files;
 IF NOT prefix THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out refused: the installed files are not the first ones in order';
 END IF;
 IF installed = 0 THEN RAISE EXCEPTION 'automations v2 stopped-install back-out refused: no V2 file is installed'; END IF;
 IF installed = 7 THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out refused: all seven files are installed, use 20261124100600_automation_v2.rollback.sql';
 END IF;
 -- Turning any control back on waits until this transaction ends.
 PERFORM 1 FROM private.automation_release_controls FOR SHARE;
 IF EXISTS (SELECT FROM private.automation_release_controls WHERE enrollment_enabled OR dispatch_enabled OR builder_visible) THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out refused: turn enrollment, message delivery and the builder off for every agency first';
 END IF;
 recorded := EXISTS (SELECT FROM private.automation_sms_purposes)
  OR EXISTS (SELECT FROM private.automation_events WHERE event_type NOT IN ('lead_created','campaign_membership_created'))
  OR EXISTS (SELECT FROM public.workflow_versions v
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.graph->'nodes') = 'array' THEN v.graph->'nodes' ELSE '[]'::jsonb END) step
      WHERE step->>'type' NOT IN ('lead_created','campaign_membership_created','wait','contact_has_email','send_sms','send_email') OR step->>'version' IS DISTINCT FROM '1')
  OR EXISTS (SELECT FROM public.workflow_versions v WHERE coalesce(v.graph#>>'{settings,reentry}', 'once') NOT IN ('once', 'after_completion')
      OR v.graph#>>'{settings,stop_on_booking}' = 'true' OR v.graph#>>'{settings,stop_on_contact}' = 'true');
 IF installed >= 3 THEN EXECUTE 'SELECT $1 OR EXISTS (SELECT FROM private.automation_task_receipts)' INTO recorded USING recorded; END IF;
 IF installed >= 5 THEN EXECUTE 'SELECT $1 OR EXISTS (SELECT FROM public.inbound_callbacks)
    OR EXISTS (SELECT FROM private.automation_answer_settlements)' INTO recorded USING recorded; END IF;
 IF installed >= 6 THEN EXECUTE 'SELECT $1 OR EXISTS (SELECT FROM public.policy_issuance_confirmations)' INTO recorded USING recorded; END IF;
 IF recorded THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out refused: V2 has recorded work; finish the installation and use the full rollback';
 END IF;
 -- A function a file installed has that file's definition. One whose file is not installed is still the first release's.
 FOR item IN SELECT value FROM jsonb_array_elements($plan$[{"signature":"private.automation_block_fields(text,jsonb)","file":1,"v2":{"acl":"{postgres=X/postgres}","md5":"81278817208063820207cd27b12f1d26","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_block_fields(text,jsonb)","volatility":"i","security_definer":false},"first":{"acl":"{postgres=X/postgres}","md5":"34c12888be9cae6a392af6284c7610e4","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_block_fields(text,jsonb)","volatility":"i","security_definer":false}},{"signature":"private.automation_trigger(jsonb)","file":1,"v2":{"acl":"{postgres=X/postgres}","md5":"a4655647978ad2365a8fb382031c8912","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_trigger(jsonb)","volatility":"i","security_definer":false},"first":{"acl":"{postgres=X/postgres}","md5":"c0b68408f199ecb3d8d0f5f9dfdbae1f","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_trigger(jsonb)","volatility":"i","security_definer":false}},{"signature":"private.automation_editable_graph(jsonb)","file":1,"v2":{"acl":"{postgres=X/postgres}","md5":"6d08be68ca01bcccd0d51e135362b0ea","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_editable_graph(jsonb)","volatility":"i","security_definer":false},"first":{"acl":"{postgres=X/postgres}","md5":"d288036fd0788c4b79a6813045647b5d","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_editable_graph(jsonb)","volatility":"i","security_definer":false}},{"signature":"private.automation_channel_issue(uuid,uuid,jsonb)","file":1,"v2":{"acl":"{postgres=X/postgres}","md5":"ed5464e5230a669853453e12d51d6e06","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_channel_issue(uuid,uuid,jsonb)","volatility":"s","security_definer":false},"first":{"acl":"{postgres=X/postgres}","md5":"85ea181a79a7d9e2635129023f17acec","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_channel_issue(uuid,uuid,jsonb)","volatility":"s","security_definer":false}},{"signature":"private.automation_graph_issues(uuid,text,jsonb)","file":1,"v2":{"acl":"{postgres=X/postgres}","md5":"13fae2dff2e436bb175d23eaafaef6b8","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_graph_issues(uuid,text,jsonb)","volatility":"s","security_definer":true},"first":{"acl":"{postgres=X/postgres}","md5":"4fe45060b89cd9d05d439a2ad2878890","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_graph_issues(uuid,text,jsonb)","volatility":"s","security_definer":true}},{"signature":"public.save_automation_draft(uuid,text,jsonb,bigint,bigint)","file":1,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"8e86f52e37bb4d588f9674cf9ac8400b","owner":"postgres","config":["search_path=\"\""],"signature":"public.save_automation_draft(uuid,text,jsonb,bigint,bigint)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"f7d43eeb8b55436667a287e73bfa7de2","owner":"postgres","config":["search_path=\"\""],"signature":"public.save_automation_draft(uuid,text,jsonb,bigint,bigint)","volatility":"v","security_definer":true}},{"signature":"public.publish_automation(uuid,bigint,bigint,jsonb)","file":1,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"477a9cc249ae4702ce16358ea49956bf","owner":"postgres","config":["search_path=\"\""],"signature":"public.publish_automation(uuid,bigint,bigint,jsonb)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"7832c7a9b75b96204855d5e44eb7a160","owner":"postgres","config":["search_path=\"\""],"signature":"public.publish_automation(uuid,bigint,bigint,jsonb)","volatility":"v","security_definer":true}},{"signature":"public.automation_overlap(uuid)","file":1,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"ffc7882e881ee50e5a4f3f2f05df2842","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_overlap(uuid)","volatility":"s","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"ab3e01a60653265cc0b8ee0f14bed9e0","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_overlap(uuid)","volatility":"s","security_definer":true}},{"signature":"public.automation_session_transition(bigint,uuid)","file":1,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"9b831e70951a5c1099fc9c2e3684cf94","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_session_transition(bigint,uuid)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"20796525242205a7c5bb7ac9546ac52a","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_session_transition(bigint,uuid)","volatility":"v","security_definer":true}},{"signature":"private.automation_capture_event()","file":2,"v2":{"acl":"{postgres=X/postgres}","md5":"7c6058677dc9245843919d5f76c8f15d","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_event()","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres}","md5":"0232ad190e398d825a7f727d84d41cdb","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_event()","volatility":"v","security_definer":true}},{"signature":"private.automation_admit_event(private.automation_events,uuid)","file":2,"v2":{"acl":"{postgres=X/postgres}","md5":"1f56e985155b6e25c64f99fc2ce43867","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_admit_event(private.automation_events,uuid)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres}","md5":"249940eee8c5f133cba0e0317df7343c","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_admit_event(private.automation_events,uuid)","volatility":"v","security_definer":true}},{"signature":"public.automation_process_events(integer)","file":2,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"19a97ae4ea27626bd098f7896fe3f5ba","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_process_events(integer)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"77c8785cecb0397154fe2aed750372d8","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_process_events(integer)","volatility":"v","security_definer":true}},{"signature":"public.automation_claim_work(integer)","file":7,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"656c23af008da704bb072bbfda84971f","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_claim_work(integer)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"8f6aba062b306faf4266d5106fbdd2ec","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_claim_work(integer)","volatility":"v","security_definer":true}},{"signature":"public.automation_finish_node(uuid,uuid,text,text)","file":7,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"ce176d20dc75204a8659bb000ec67c73","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_finish_node(uuid,uuid,text,text)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"2f31d70bc9b1f8d4fc0d25cab79cc2fa","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_finish_node(uuid,uuid,text,text)","volatility":"v","security_definer":true}},{"signature":"public.automation_activity(bigint,uuid,uuid,uuid,text,timestamp with time zone,uuid)","file":7,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"de664a6ba7c5e245c63e1a673ad4ada8","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_activity(bigint,uuid,uuid,uuid,text,timestamp with time zone,uuid)","volatility":"s","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"70e686f6ce72673ff26e7f39702b85bd","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_activity(bigint,uuid,uuid,uuid,text,timestamp with time zone,uuid)","volatility":"s","security_definer":true}},{"signature":"public.automation_stop_run(uuid,bigint)","file":7,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"d4fd3b3f56fb6303bbbb2bdac0473096","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_stop_run(uuid,bigint)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"34b2b134a84d5710af006378f71ecd72","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_stop_run(uuid,bigint)","volatility":"v","security_definer":true}},{"signature":"public.automation_authorize_handoff(uuid,uuid,text)","file":7,"v2":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"eae783e5ee0ef296afcd5aaf2c28b333","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_authorize_handoff(uuid,uuid,text)","volatility":"v","security_definer":true},"first":{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"ad863e11282d5c0b7414fd949b728628","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_authorize_handoff(uuid,uuid,text)","volatility":"v","security_definer":true}}]$plan$::jsonb) LOOP
  expected := CASE WHEN (item->>'file')::integer <= installed THEN item->'v2' ELSE item->'first' END;
  function_oid := to_regprocedure(expected->>'signature');
  SELECT jsonb_build_object('signature',expected->>'signature','md5',md5(pg_get_functiondef(p.oid)),
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',p.proacl::text,'volatility',p.provolatile::text)
  INTO actual FROM pg_proc p WHERE p.oid=function_oid;
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'automations v2 stopped-install back-out drift: %', expected->>'signature';
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements($watchers$[{"signature":"private.automation_capture_disposition()","file":2,"v2":{"acl":"{postgres=X/postgres}","md5":"29bfdde74a00238eeedc6e4a3b9d467e","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_disposition()","volatility":"v","security_definer":true}},{"signature":"private.automation_capture_sale()","file":2,"v2":{"acl":"{postgres=X/postgres}","md5":"b957d7891e0f88c06e29341b7e40c5d9","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_sale()","volatility":"v","security_definer":true}},{"signature":"private.automation_capture_appointment_slot()","file":4,"v2":{"acl":"{postgres=X/postgres}","md5":"0efb90c58ccfbdd2393502b0c4ba88c1","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_appointment_slot()","volatility":"v","security_definer":true}},{"signature":"private.automation_capture_appointment_outcome()","file":4,"v2":{"acl":"{postgres=X/postgres}","md5":"427f6c1151c09c0bc322064f70d643c9","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_appointment_outcome()","volatility":"v","security_definer":true}},{"signature":"private.automation_capture_missed_inbound()","file":5,"v2":{"acl":"{postgres=X/postgres}","md5":"9b753b3372dbd2cabb77e2d96e85506d","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_missed_inbound()","volatility":"v","security_definer":true}},{"signature":"private.automation_capture_issuance()","file":6,"v2":{"acl":"{postgres=X/postgres}","md5":"8b58fa9c3ec9714f770dc58bb1dbd7eb","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_issuance()","volatility":"v","security_definer":true}},{"signature":"private.automation_observe_answered_call()","file":5,"v2":{"acl":"{postgres=X/postgres}","md5":"fdd0949ae8b4ead06af6763a51970a76","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_observe_answered_call()","volatility":"v","security_definer":true}},{"signature":"private.automation_capture_appointment_reopened()","file":4,"v2":{"acl":"{postgres=X/postgres}","md5":"b70ff2fbfbe8fa4edac8fa78fe4b427c","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_appointment_reopened()","volatility":"v","security_definer":true}}]$watchers$::jsonb) LOOP
  IF (item->>'file')::integer > installed THEN
   IF to_regprocedure(item->>'signature') IS NOT NULL THEN
    RAISE EXCEPTION 'automations v2 stopped-install back-out drift: % exists although its file is not installed', item->>'signature';
   END IF;
   CONTINUE;
  END IF;
  expected := item->'v2';
  function_oid := to_regprocedure(expected->>'signature');
  SELECT jsonb_build_object('signature',expected->>'signature','md5',md5(pg_get_functiondef(p.oid)),
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',p.proacl::text,'volatility',p.provolatile::text)
  INTO actual FROM pg_proc p WHERE p.oid=function_oid;
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'automations v2 stopped-install back-out drift: %', expected->>'signature';
  END IF;
 END LOOP;
 RAISE NOTICE 'automations v2 stopped-install back-out: % of seven files were installed', installed;
END $stopped_preimage$;

-- The first-release bodies. For a function whose file was not installed this writes the definition it already has.
CREATE OR REPLACE FUNCTION private.automation_block_fields(p_type text, p_version jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_version='1'::jsonb THEN CASE p_type
    WHEN 'lead_created' THEN ARRAY['lead_source']
    WHEN 'campaign_membership_created' THEN ARRAY['campaign_id','any_campaign','lead_source']
    WHEN 'wait' THEN ARRAY['duration','unit']
    WHEN 'contact_has_email' THEN ARRAY[]::text[]
    WHEN 'send_sms' THEN ARRAY['body','purpose','template_id']
    WHEN 'send_email' THEN ARRAY['body','subject','sender_id','template_id'] END END
$function$;

CREATE OR REPLACE FUNCTION private.automation_trigger(p_graph jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_graph->'nodes')='array'
    THEN p_graph->'nodes' ELSE '[]'::jsonb END) WHERE value->>'type' IN ('lead_created','campaign_membership_created') LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.automation_editable_graph(g jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION private.automation_channel_issue(p_org uuid, p_actor uuid, p_node jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION private.automation_graph_issues(p_org uuid, p_name text, p_graph jsonb)
 RETURNS TABLE(node_id text, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.save_automation_draft(p_workflow_id uuid, p_name text, p_graph jsonb, p_expected_revision bigint, p_session_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.publish_automation(p_workflow_id uuid, p_expected_revision bigint, p_session_revision bigint, p_expected_controls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.automation_overlap(p_workflow_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.automation_session_transition(p_expected_revision bigint, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sid uuid := private.automation_session_id();
  ctx private.automation_sessions;
BEGIN
  SELECT * INTO ctx FROM private.automation_sessions WHERE session_id=sid AND actor_id=auth.uid() FOR UPDATE;
  IF ctx.revision IS NULL OR ctx.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Session mode changed. Reopen this view.' USING ERRCODE='40001';
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
END $function$;

CREATE OR REPLACE FUNCTION private.automation_capture_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  kind text := tg_argv[0];
  org uuid := new.organization_id;
  recipient uuid;
  campaign uuid;
  source text;
  occurred timestamptz;
begin
  if org is null or not exists (select 1 from private.automation_release_controls
    where organization_id=org and enrollment_enabled for share) then return new; end if;
  -- Order committed source events against publish/pause boundaries without serializing imports together.
  perform pg_advisory_xact_lock_shared(hashtextextended('automation-activation:'||org::text,0));
  occurred:=clock_timestamp();
  if kind='lead_created' then
    recipient:=new.id;
    source:=new.lead_source;
  else
    recipient:=new.lead_id;
    campaign:=new.campaign_id;
    if recipient is null then return new; end if;
    select l.lead_source into source from public.leads l
      join public.campaigns c on c.organization_id=l.organization_id and c.id=campaign
      where l.id=recipient and l.organization_id=org;
    if not found then return new; end if;
  end if;
  begin
    insert into private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,campaign_id,lead_source,occurred_at)
      values(org,kind,new.id,1,recipient,campaign,source,occurred) on conflict do nothing;
  exception when others then
    insert into private.automation_intake_recovery(organization_id,event_type,source_id,contact_id,campaign_id,lead_source,occurred_at)
      values(org,kind,new.id,recipient,campaign,source,occurred) on conflict do nothing;
  end;
  return new;
exception when others then
  raise warning 'Automation event capture requires investigation (table %, SQLSTATE %)', tg_table_name, sqlstate;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.automation_admit_event(e private.automation_events, p_interval uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare candidate record; trigger_node jsonb; first_node text; replied boolean;
begin
  select i.workflow_id,i.version_id,v.graph,v.published_by,w.status into candidate
    from public.automation_intervals i
    join public.workflow_versions v on v.id=i.version_id and v.organization_id=i.organization_id and v.workflow_id=i.workflow_id
    join public.workflows w on w.id=i.workflow_id and w.organization_id=i.organization_id
    where i.organization_id=e.organization_id and i.id=p_interval and i.starts_at<=e.occurred_at
      and (i.ends_at is null or i.ends_at>e.occurred_at)
    for share of w;
  if not found or candidate.status not in ('paused','active') then return 0; end if;
  if not private.automation_audience_allowed(e.organization_id,candidate.published_by,e.campaign_id)
    then return 0; end if;
  select n into trigger_node from jsonb_array_elements(candidate.graph->'nodes') n
    where n->>'type'=e.event_type;
  if trigger_node is null then return 0; end if;
  if nullif(trigger_node#>>'{config,lead_source}','') is not null
    and trigger_node#>>'{config,lead_source}' is distinct from e.lead_source then return 0; end if;
  if e.event_type='campaign_membership_created' and (
    coalesce(trigger_node#>>'{config,any_campaign}','false')<>'true'
    and trigger_node#>>'{config,campaign_id}' is distinct from e.campaign_id::text
  ) then return 0; end if;
  select edge->>'target' into first_node from jsonb_array_elements(candidate.graph->'edges') edge
    where edge->>'source'=trigger_node->>'id';
  if first_node is null then return 0; end if;

  if candidate.status='paused' then
    insert into private.automation_deferred_admissions(organization_id,event_id,interval_id,workflow_id)
      values(e.organization_id,e.id,p_interval,candidate.workflow_id) on conflict do nothing;
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('automation-contact:'||e.organization_id::text||'lead'||e.contact_id::text,0));
  replied:=candidate.graph#>>'{settings,stop_on_reply}'='true' and exists(
    select 1 from private.automation_reply_watermarks m where m.organization_id=e.organization_id
      and m.contact_type='lead' and m.contact_id=e.contact_id and m.latest_reply_at>=e.occurred_at
  );
  if exists(select 1 from private.automation_runs r where r.organization_id=e.organization_id
    and r.workflow_id=candidate.workflow_id and r.contact_id=e.contact_id and r.contact_type='lead'
    and (candidate.graph#>>'{settings,reentry}' is distinct from 'after_completion'
      or r.status<>'completed' or r.ended_at>e.occurred_at)) then return 0; end if;
  insert into private.automation_runs(organization_id,workflow_id,version_id,event_id,contact_id,current_node_id,status,reason,ended_at)
    values(e.organization_id,candidate.workflow_id,candidate.version_id,e.id,e.contact_id,first_node,
      case when replied then 'stopped' else 'queued' end,
      case when replied then 'Verified reply received' end,case when replied then clock_timestamp() end)
    on conflict do nothing;
  return case when found then 1 else 0 end;
end $function$;

CREATE OR REPLACE FUNCTION public.automation_process_events(p_limit integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e private.automation_events;
  candidate record;
  recovery private.automation_intake_recovery;
  visited integer;
  last_interval uuid;
  count_enrolled integer:=0;
  bounded integer:=least(25,greatest(1,coalesce(p_limit,10)));
  cutoff timestamptz:=clock_timestamp();
begin
  for recovery in select * from private.automation_intake_recovery
    where retry_at<=cutoff order by retry_at,id limit bounded for update skip locked
  loop
    begin
      insert into private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,campaign_id,lead_source,occurred_at)
        values(recovery.organization_id,recovery.event_type,recovery.source_id,1,recovery.contact_id,
          recovery.campaign_id,recovery.lead_source,recovery.occurred_at) on conflict do nothing;
      delete from private.automation_intake_recovery where id=recovery.id and organization_id=recovery.organization_id;
    exception when others then
      update private.automation_intake_recovery set attempts=attempts+1,last_sqlstate=sqlstate,
        retry_at=cutoff+interval '1 minute' where id=recovery.id and organization_id=recovery.organization_id;
      raise warning 'Automation intake repair delayed (SQLSTATE %)',sqlstate;
    end;
  end loop;

  -- A paused workflow never holds another interval behind its cursor.
  for candidate in select d.organization_id,d.event_id,d.interval_id from private.automation_deferred_admissions d
    join public.workflows w on w.id=d.workflow_id and w.organization_id=d.organization_id
    join private.automation_release_controls c on c.organization_id=w.organization_id
    where w.status<>'paused' and c.enrollment_enabled and d.retry_at<=cutoff order by d.retry_at,d.event_id,d.interval_id
    limit bounded for update of d skip locked for share of w,c
  loop
    begin
      select * into strict e from private.automation_events where id=candidate.event_id and organization_id=candidate.organization_id;
      count_enrolled:=count_enrolled+private.automation_admit_event(e,candidate.interval_id);
      delete from private.automation_deferred_admissions where event_id=e.id and interval_id=candidate.interval_id
        and organization_id=candidate.organization_id;
    exception when others then
      update private.automation_deferred_admissions set attempts=attempts+1,last_sqlstate=sqlstate,retry_at=cutoff+interval '1 minute'
        where event_id=candidate.event_id and interval_id=candidate.interval_id and organization_id=candidate.organization_id;
      raise warning 'Automation admission repair delayed (SQLSTATE %)',sqlstate;
    end;
  end loop;

  for e in select ev.* from private.automation_events ev
    join private.automation_release_controls ctl using(organization_id)
    where ev.processed_at is null and ev.available_at<=cutoff and ctl.enrollment_enabled
    order by ev.available_at,ev.id limit bounded for update of ev skip locked for share of ctl
  loop
    visited:=0;
    last_interval:=e.interval_cursor;
    for candidate in select i.id,i.workflow_id from public.automation_intervals i
      where i.organization_id=e.organization_id and i.starts_at<=e.occurred_at
        and (i.ends_at is null or i.ends_at>e.occurred_at)
        and (e.interval_cursor is null or i.id>e.interval_cursor)
      order by i.id limit 25
    loop
      visited:=visited+1;
      last_interval:=candidate.id;
      begin
        count_enrolled:=count_enrolled+private.automation_admit_event(e,candidate.id);
      exception when others then
        insert into private.automation_deferred_admissions(organization_id,event_id,interval_id,workflow_id,retry_at,attempts,last_sqlstate)
          values(e.organization_id,e.id,candidate.id,candidate.workflow_id,cutoff+interval '1 minute',1,sqlstate)
          on conflict(event_id,interval_id) do nothing;
        raise warning 'Automation admission retained for repair (SQLSTATE %)',sqlstate;
      end;
    end loop;
    update private.automation_events set processed_at=case when visited<25 then clock_timestamp() end,
      available_at=clock_timestamp(),interval_cursor=last_interval where id=e.id;
  end loop;
  return count_enrolled;
end $function$;

CREATE OR REPLACE FUNCTION public.automation_claim_work(p_limit integer DEFAULT 10)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claim record;
  token uuid;
  previous_intent text;
  cutoff timestamptz := clock_timestamp();
begin
  for claim in
    select r.*,v.graph from private.automation_runs r
    join public.workflows w on w.id=r.workflow_id and w.organization_id=r.organization_id
    join public.workflow_versions v on v.id=r.version_id and v.organization_id=r.organization_id and v.workflow_id=w.id
    where w.status='active' and not r.workflow_paused and r.status in ('queued','waiting','held')
      and greatest(r.due_at,r.leased_until)<=cutoff
    order by greatest(r.due_at,r.leased_until),r.id limit least(25,greatest(1,coalesce(p_limit,10))) for update of r skip locked
  loop
    token:=gen_random_uuid();
    update private.automation_runs set lease_token=token,leased_until=clock_timestamp()+interval '2 minutes'
      where id=claim.id;
    previous_intent:=null;
    if exists(select 1 from jsonb_array_elements(claim.graph->'nodes') n
      where n->>'id'=claim.current_node_id and n->>'type' in ('send_sms','send_email')) then
      insert into private.automation_intents(organization_id,run_id,node_id,status)
        values(claim.organization_id,claim.id,claim.current_node_id,'prepared') on conflict do nothing;
      select status into previous_intent from private.automation_intents where run_id=claim.id
        and node_id=claim.current_node_id and organization_id=claim.organization_id;
    end if;
    return next jsonb_build_object('organization_id',claim.organization_id,'workflow_id',claim.workflow_id,
      'version_id',claim.version_id,'run_id',claim.id,'contact_id',claim.contact_id,'contact_type',claim.contact_type,
      'lease_token',token,'node_id',claim.current_node_id,'status',claim.status,
      'due_lag_ms',greatest(0,round(extract(epoch from cutoff-claim.due_at)*1000)),
      'uncertain_handoff',previous_intent='handed_off','stop_on_reply',claim.graph#>'{settings,stop_on_reply}','graph',claim.graph);
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.automation_finish_node(p_run uuid, p_token uuid, p_result text, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r private.automation_runs;
  graph jsonb;
  node jsonb;
  target text;
  next_status text;
  next_due timestamptz:=clock_timestamp();
  branch text;
  kind text;
begin
  select * into r from private.automation_runs where id=p_run and lease_token=p_token for update;
  if not found or r.status not in ('queued','waiting','held') then return false; end if;
  select v.graph into graph from public.workflow_versions v where v.organization_id=r.organization_id
    and v.workflow_id=r.workflow_id and v.id=r.version_id;
  select n into strict node from jsonb_array_elements(graph->'nodes') n where n->>'id'=r.current_node_id;
  kind:=node->>'type';
  -- Worker success alone cannot establish provider acceptance. The channel receipt
  -- transaction marks its original intent before normal or recovered advancement.
  if p_result='accepted' and kind in ('send_sms','send_email') and not exists(
    select 1 from private.automation_intents i where i.organization_id=r.organization_id
      and i.run_id=r.id and i.node_id=r.current_node_id and i.status='accepted'
  ) then
    if exists(select 1 from private.automation_intents i where i.organization_id=r.organization_id
      and i.run_id=r.id and i.node_id=r.current_node_id and i.status='handed_off') then
      p_result:='unknown';
      p_reason:='Awaiting confirmation of the original provider handoff';
    else
      p_result:='held';
      p_reason:='Verified handoff and provider receipt required';
    end if;
  end if;
  if p_result in ('held','failed','unknown') then
    next_status:=p_result;
    next_due:=next_due+interval '5 minutes';
  elsif kind='wait' and p_result='wait' and r.status<>'waiting' then
    next_status:='waiting';
    next_due:=next_due+(node#>>'{config,duration}')::integer *
      case node#>>'{config,unit}' when 'minutes' then interval '1 minute' when 'hours' then interval '1 hour'
        when 'days' then interval '1 day' end;
  elsif (kind in ('send_sms','send_email') and p_result='accepted')
    or (kind='wait' and p_result='elapsed' and r.status='waiting' and r.due_at<=clock_timestamp())
    or (kind='contact_has_email' and p_result in ('yes','no')) then
    branch:=case when kind='contact_has_email' then p_result end;
    select edge->>'target' into target from jsonb_array_elements(graph->'edges') edge
      where edge->>'source'=r.current_node_id and edge->>'branch' is not distinct from branch;
    next_status:=case when target is null then 'completed' else 'queued' end;
  else raise exception 'Invalid automation node outcome'; end if;

  if kind in ('send_sms','send_email') and p_result in ('accepted','failed','unknown') then
    update private.automation_intents set status=p_result where organization_id=r.organization_id
      and run_id=p_run and node_id=r.current_node_id;
  end if;
  insert into private.automation_steps(organization_id,run_id,node_id,status,reason)
    values(r.organization_id,p_run,r.current_node_id,p_result,left(p_reason,500))
    on conflict (run_id,node_id) do update set status=excluded.status,reason=excluded.reason,updated_at=clock_timestamp();
  update private.automation_runs set current_node_id=coalesce(target,r.current_node_id),status=next_status,
    reason=left(p_reason,500),due_at=next_due,lease_token=null,leased_until=null,updated_at=clock_timestamp(),
    ended_at=case when next_status in ('completed','failed','unknown') then clock_timestamp() end
    where id=p_run;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.automation_activity(p_session_revision bigint, p_viewer_id uuid, p_workflow uuid DEFAULT NULL::uuid, p_contact uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_run uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer uuid:=private.automation_viewer_id();
  visible_org uuid;
  may_stop boolean;
  activity jsonb;
begin
  if viewer is distinct from p_viewer_id or not exists (
    select 1 from private.automation_sessions s where s.session_id=private.automation_session_id()
      and s.actor_id=auth.uid() and s.revision=p_session_revision
  ) then raise exception 'Automation activity viewer changed' using errcode='42501'; end if;
  if (p_before_at is null) <> (p_before_run is null) then
    raise exception 'Incomplete activity cursor' using errcode='22023'; end if;
  select p.organization_id into visible_org from public.profiles p join private.automation_release_controls c
    on c.organization_id=p.organization_id and c.builder_visible where p.id=viewer and p.status='Active';
  may_stop:=viewer=auth.uid() and private.automation_can_author(visible_org);
  select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc,item.run_id desc),'[]'::jsonb) into activity from (
    select r.id run_id,r.version_id,r.workflow_id,v.name workflow_name,r.contact_id,r.contact_type,
      nullif(trim(concat_ws(' ',l.first_name,l.last_name)),'') contact_name,r.current_node_id node_id,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'paused' else r.status end status,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'Workflow paused' else r.reason end reason,
      r.updated_at,
      v.revision version_revision,block.node_type,
      case block.node_type when 'send_sms' then 'Send SMS' when 'send_email' then 'Send email'
        when 'wait' then 'Wait' when 'contact_has_email' then 'Contact has email' else 'Automation step' end node_label,
      case when r.status in ('waiting','held') then r.due_at end due_at,
      private.automation_message_status(r.organization_id,r.id,r.current_node_id) message_status,last_step.reason step_reason,
      may_stop and r.status in ('queued','waiting','held','unknown') can_stop
    from private.automation_runs r
    join public.workflows w on w.organization_id=r.organization_id and w.id=r.workflow_id
    join public.leads l on l.organization_id=r.organization_id and l.id=r.contact_id and r.contact_type='lead'
    join public.workflow_versions v on v.organization_id=r.organization_id and v.workflow_id=r.workflow_id and v.id=r.version_id
    left join lateral (select n->>'type' node_type from jsonb_array_elements(v.graph->'nodes') n where n->>'id'=r.current_node_id limit 1) block on true
    left join lateral (select s.reason from private.automation_steps s where s.organization_id=r.organization_id and s.run_id=r.id
      order by s.updated_at desc limit 1) last_step on true
    where r.organization_id=visible_org and (p_contact is null or r.contact_id=p_contact)
      and (p_workflow is null or r.workflow_id=p_workflow) and (p_type is null or r.contact_type=p_type)
      and (p_before_at is null or (r.updated_at,r.id)<(p_before_at,p_before_run))
      and private.automation_visible_lead(viewer,r.organization_id,r.contact_id)
    order by r.updated_at desc,r.id desc limit 100
  ) item;
  return activity;
end $function$;

CREATE OR REPLACE FUNCTION public.automation_stop_run(p_run uuid, p_session_revision bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid:=private.automation_require_author(p_session_revision);
begin
  update private.automation_runs set status='stopped',reason='Stopped by user',ended_at=clock_timestamp(),
    updated_at=clock_timestamp(),lease_token=null,leased_until=null
    where id=p_run and organization_id=org and status in ('queued','waiting','held','unknown')
      and private.automation_visible_lead(auth.uid(),organization_id,contact_id);
  if not found then raise exception 'Running automation unavailable' using errcode='42501'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.automation_authorize_handoff(p_run uuid, p_token uuid, p_node text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare scope record;
begin
  select r.organization_id,r.workflow_id,v.published_by,e.campaign_id into scope
    from private.automation_runs r
    join public.workflows w on w.id=r.workflow_id and w.organization_id=r.organization_id
    join public.workflow_versions v on v.id=r.version_id and v.workflow_id=w.id and v.organization_id=w.organization_id
    join private.automation_events e on e.id=r.event_id and e.organization_id=r.organization_id
    join private.automation_release_controls ctl on ctl.organization_id=w.organization_id
    where r.id=p_run and r.lease_token=p_token and r.current_node_id=p_node and r.leased_until>=clock_timestamp()
      and r.status in ('queued','held','waiting') and w.status='active' and ctl.dispatch_enabled
    for update of w,r for share of ctl;
  if not found or not private.automation_audience_allowed(scope.organization_id,scope.published_by,scope.campaign_id)
    then return false; end if;
  update private.automation_intents set status='handed_off'
    where organization_id=scope.organization_id and run_id=p_run and node_id=p_node and status='prepared';
  return found;
end $function$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_capture_disposition()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_capture_disposition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_capture_sale()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_capture_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_capture_appointment_slot()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_capture_appointment_slot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_capture_appointment_outcome()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_capture_appointment_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_capture_missed_inbound()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_capture_missed_inbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_capture_issuance()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_capture_issuance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_observe_answered_call()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_observe_answered_call()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_observer$
BEGIN
 IF to_regprocedure('private.automation_capture_appointment_reopened()') IS NOT NULL THEN
  EXECUTE $observer_sql$CREATE OR REPLACE FUNCTION private.automation_capture_appointment_reopened()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $observer$
BEGIN
  -- Automations V2 was rolled back: this observer does nothing until V2 is installed again.
  RETURN NULL;
END $observer$$observer_sql$;
 END IF;
END $stopped_observer$;

DO $stopped_postimage$
DECLARE expected jsonb; actual jsonb; function_oid oid;
BEGIN
 FOR expected IN SELECT value FROM jsonb_array_elements($catalog$[{"acl":"{postgres=X/postgres}","md5":"34c12888be9cae6a392af6284c7610e4","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_block_fields(text,jsonb)","volatility":"i","security_definer":false},{"acl":"{postgres=X/postgres}","md5":"c0b68408f199ecb3d8d0f5f9dfdbae1f","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_trigger(jsonb)","volatility":"i","security_definer":false},{"acl":"{postgres=X/postgres}","md5":"d288036fd0788c4b79a6813045647b5d","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_editable_graph(jsonb)","volatility":"i","security_definer":false},{"acl":"{postgres=X/postgres}","md5":"85ea181a79a7d9e2635129023f17acec","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_channel_issue(uuid,uuid,jsonb)","volatility":"s","security_definer":false},{"acl":"{postgres=X/postgres}","md5":"4fe45060b89cd9d05d439a2ad2878890","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_graph_issues(uuid,text,jsonb)","volatility":"s","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"f7d43eeb8b55436667a287e73bfa7de2","owner":"postgres","config":["search_path=\"\""],"signature":"public.save_automation_draft(uuid,text,jsonb,bigint,bigint)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"7832c7a9b75b96204855d5e44eb7a160","owner":"postgres","config":["search_path=\"\""],"signature":"public.publish_automation(uuid,bigint,bigint,jsonb)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"ab3e01a60653265cc0b8ee0f14bed9e0","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_overlap(uuid)","volatility":"s","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"20796525242205a7c5bb7ac9546ac52a","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_session_transition(bigint,uuid)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres}","md5":"0232ad190e398d825a7f727d84d41cdb","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_capture_event()","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres}","md5":"249940eee8c5f133cba0e0317df7343c","owner":"postgres","config":["search_path=\"\""],"signature":"private.automation_admit_event(private.automation_events,uuid)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"77c8785cecb0397154fe2aed750372d8","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_process_events(integer)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"8f6aba062b306faf4266d5106fbdd2ec","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_claim_work(integer)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"2f31d70bc9b1f8d4fc0d25cab79cc2fa","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_finish_node(uuid,uuid,text,text)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"70e686f6ce72673ff26e7f39702b85bd","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_activity(bigint,uuid,uuid,uuid,text,timestamp with time zone,uuid)","volatility":"s","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","md5":"34b2b134a84d5710af006378f71ecd72","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_stop_run(uuid,bigint)","volatility":"v","security_definer":true},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"ad863e11282d5c0b7414fd949b728628","owner":"postgres","config":["search_path=\"\""],"signature":"public.automation_authorize_handoff(uuid,uuid,text)","volatility":"v","security_definer":true}]$catalog$::jsonb) LOOP
  function_oid := to_regprocedure(expected->>'signature');
  SELECT jsonb_build_object('signature',expected->>'signature','md5',md5(pg_get_functiondef(p.oid)),
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',p.proacl::text,'volatility',p.provolatile::text)
  INTO actual FROM pg_proc p WHERE p.oid=function_oid;
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'automations v2 stopped-install back-out did not restore: %', expected->>'signature';
  END IF;
 END LOOP;
 IF EXISTS (SELECT FROM unnest(ARRAY['private.automation_capture_disposition()','private.automation_capture_sale()','private.automation_capture_appointment_slot()','private.automation_capture_appointment_outcome()','private.automation_capture_missed_inbound()','private.automation_capture_issuance()','private.automation_observe_answered_call()','private.automation_capture_appointment_reopened()']) observer(signature)
   WHERE to_regprocedure(observer.signature) IS NOT NULL
     AND position('Automations V2 was rolled back' IN pg_get_functiondef(to_regprocedure(observer.signature))) = 0) THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out left an observer recording';
 END IF;
END $stopped_postimage$;

-- The durable record of this back-out: how many of the seven files had been installed.
DO $stopped_marker$
DECLARE installed integer;
BEGIN
 SELECT count(*) FILTER (WHERE present) INTO installed FROM (VALUES
    (1, to_regprocedure('public.automation_sms_requirements(uuid)') IS NOT NULL),
    (2, to_regprocedure('private.automation_stop_check(private.automation_runs)') IS NOT NULL),
    (3, to_regclass('private.automation_task_receipts') IS NOT NULL),
    (4, to_regprocedure('private.automation_capture_appointment_slot()') IS NOT NULL),
    (5, to_regclass('public.inbound_callbacks') IS NOT NULL),
    (6, to_regclass('public.policy_issuance_confirmations') IS NOT NULL),
    (7, to_regprocedure('public.automation_create_task(uuid,uuid,text,text,text)') IS NOT NULL)) files(n, present);
 EXECUTE format('CREATE FUNCTION private.automation_v2_backed_out() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO %L AS %L',
  '', 'SELECT ' || installed);
 REVOKE ALL ON FUNCTION private.automation_v2_backed_out() FROM PUBLIC, anon, authenticated;
 IF private.automation_v2_backed_out() IS DISTINCT FROM installed THEN
  RAISE EXCEPTION 'automations v2 stopped-install back-out could not record itself';
 END IF;
END $stopped_marker$;
