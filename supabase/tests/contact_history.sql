\if :setup
CREATE EXTENSION IF NOT EXISTS ltree;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION public.get_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.organization_id',true),'')::uuid $$;
CREATE FUNCTION public.get_user_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT public.get_org_id() $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid,role text,team_id uuid,hierarchy_path ltree,first_name text,last_name text);
CREATE TABLE public.campaigns(id uuid PRIMARY KEY,organization_id uuid,type text,name text,assigned_agent_ids jsonb);
CREATE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.get_user_role()='Super Admin' $$;
CREATE FUNCTION public.super_admin_own_org(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_super_admin() AND org=public.get_org_id() $$;
CREATE FUNCTION public.is_ancestor_of(a uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles x,public.profiles y WHERE x.id=a AND y.id=b AND y.hierarchy_path <@ x.hierarchy_path) $$;
CREATE FUNCTION public.is_agency_group_peer_organization(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT org::text=current_setting('test.peer_org',true) $$;
CREATE FUNCTION public.has_contacts_permission(permission text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.get_user_role() IN ('Admin','Super Admin') $$;
CREATE TABLE public.appointments (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "type" text,
 "notes" text,
 "title" text,
 "status" text,
 "user_id" uuid,
 "end_time" timestamptz,
 "contact_id" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "created_by" uuid,
 "start_time" timestamptz,
 "updated_at" timestamptz,
 "sync_source" text,
 "contact_name" text,
 "organization_id" uuid,
 "external_event_id" text,
 "external_provider" text,
 "external_last_synced_at" timestamptz
);
CREATE TABLE public.calls (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "mos" numeric,
 "notes" text,
 "status" text,
 "lead_id" uuid,
 "outcome" text,
 "agent_id" uuid,
 "duration" int4,
 "ended_at" timestamptz,
 "direction" text,
 "is_missed" bool,
 "amd_result" text,
 "contact_id" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "started_at" timestamptz,
 "transcript" jsonb,
 "updated_at" timestamptz,
 "campaign_id" uuid,
 "pdd_seconds" numeric,
 "shaken_stir" text,
 "contact_name" text,
 "contact_type" text,
 "voicemail_id" uuid,
 "contact_phone" text,
 "missed_reason" text,
 "recording_url" text,
 "caller_id_used" text,
 "disposition_id" uuid,
 "hangup_details" text,
 "routing_engine" text,
 "organization_id" uuid,
 "twilio_call_sid" text,
 "campaign_lead_id" uuid,
 "disposition_name" text,
 "routed_agent_ids" uuid[],
 "sip_response_code" int4,
 "missed_notified_at" timestamptz,
 "quality_percentage" numeric,
 "recording_duration" int4,
 "missed_for_agent_id" uuid,
 "missed_notify_error" text,
 "provider_error_code" text,
 "provider_session_id" text,
 "answered_by_agent_id" uuid,
 "flagged_for_coaching" bool,
 "missed_recipient_ids" uuid[],
 "recording_source_sid" text,
 "missed_notify_next_at" timestamptz,
 "missed_notify_attempts" int4,
 "recording_storage_path" text,
 "dialer_admission_required" bool
);
CREATE TABLE public.campaign_leads (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "age" int4,
 "email" text,
 "phone" text,
 "state" text,
 "source" text,
 "status" text,
 "lead_id" uuid,
 "user_id" uuid,
 "last_name" text,
 "locked_at" timestamptz,
 "locked_by" uuid,
 "claimed_at" timestamptz,
 "claimed_by" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "first_name" text,
 "sort_order" int4,
 "updated_at" timestamptz,
 "campaign_id" uuid,
 "disposition" text,
 "call_attempts" int4,
 "callback_note" text,
 "last_called_at" timestamptz,
 "callback_due_at" timestamptz,
 "organization_id" uuid,
 "callback_agent_id" uuid,
 "import_history_id" uuid,
 "retry_eligible_at" timestamptz,
 "disposition_version" int8,
 "last_advance_call_id" uuid,
 "scheduled_callback_at" timestamptz
);
CREATE TABLE public.clients (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "email" text,
 "notes" text,
 "phone" text,
 "state" text,
 "carrier" text,
 "lead_id" uuid,
 "premium" numeric,
 "last_name" text,
 "sold_date" date,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "draft_date" date,
 "first_name" text,
 "issue_date" text,
 "updated_at" timestamptz,
 "face_amount" numeric,
 "policy_type" text,
 "custom_fields" jsonb,
 "policy_number" text,
 "effective_date" text,
 "premium_amount" numeric,
 "organization_id" uuid,
 "beneficiary_name" text,
 "assigned_agent_id" uuid,
 "beneficiary_phone" text,
 "payment_frequency" text,
 "beneficiary_relationship" text
);
CREATE TABLE public.contact_activities (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "agent_id" uuid,
 "metadata" jsonb,
 "contact_id" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "description" text,
 "contact_type" text,
 "activity_type" text,
 "organization_id" uuid
);
CREATE TABLE public.contact_emails (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "sent_at" timestamptz,
 "subject" text,
 "provider" text,
 "body_html" text,
 "body_text" text,
 "cc_emails" jsonb,
 "direction" text,
 "thread_id" text,
 "to_emails" jsonb,
 "bcc_emails" jsonb,
 "contact_id" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "from_email" text,
 "updated_at" timestamptz,
 "in_reply_to" text,
 "received_at" timestamptz,
 "connection_id" uuid,
 "owner_user_id" uuid,
 "reference_ids" text,
 "provider_error" text,
 "delivery_status" text,
 "organization_id" uuid,
 "external_message_id" text,
 "internet_message_id" text
);
CREATE TABLE public.contact_notes (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "pinned" bool,
 "content" text,
 "author_id" uuid,
 "contact_id" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "contact_type" text,
 "organization_id" uuid
);
CREATE TABLE public.leads (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "age" int4,
 "email" text,
 "notes" text,
 "phone" text,
 "state" text,
 "status" text,
 "user_id" uuid,
 "last_name" text,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "first_name" text,
 "lead_score" int4,
 "updated_at" timestamptz,
 "lead_source" text,
 "spouse_info" jsonb,
 "custom_fields" jsonb,
 "date_of_birth" text,
 "organization_id" uuid,
 "assigned_agent_id" uuid,
 "best_time_to_call" text,
 "last_contacted_at" text,
 "imported_by_user_id" uuid
);
CREATE TABLE public.messages (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "body" text,
 "status" text,
 "lead_id" uuid,
 "sent_at" timestamptz,
 "direction" text,
 "to_number" text,
 "contact_id" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "created_by" uuid,
 "from_number" text,
 "contact_type" text,
 "organization_id" uuid,
 "provider_message_id" text
);
CREATE TABLE public.recruits (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "email" text,
 "notes" text,
 "phone" text,
 "state" text,
 "status" text,
 "last_name" text,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "first_name" text,
 "updated_at" timestamptz,
 "custom_fields" jsonb,
 "organization_id" uuid,
 "assigned_agent_id" uuid
);
CREATE TABLE public.tasks (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "notes" text,
 "title" text,
 "due_date" timestamptz,
 "task_type" text,
 "contact_id" uuid,
 "created_at" timestamptz DEFAULT clock_timestamp(),
 "created_by" uuid,
 "assigned_to" uuid,
 "completed_at" timestamptz,
 "contact_type" text,
 "organization_id" uuid
);
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appointments_select" ON public.appointments FOR SELECT TO authenticated USING (((organization_id = get_org_id()) AND ((user_id = auth.uid()) OR (created_by = auth.uid()) OR (get_user_role() = 'Admin'::text) OR is_super_admin() OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'Team Leader'::text) AND (p.team_id IS NOT NULL) AND (appointments.user_id IN ( SELECT profiles.id
           FROM profiles
          WHERE (profiles.team_id = p.team_id)))))))));
CREATE POLICY "Calls Agency Group Peer Read" ON public.calls FOR SELECT TO authenticated USING (is_agency_group_peer_organization(organization_id));
CREATE POLICY "Calls Hierarchical Select" ON public.calls FOR SELECT TO authenticated USING (((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id)) OR ((get_org_id() IS NOT NULL) AND (organization_id = get_org_id()) AND (direction = 'inbound'::text) AND (agent_id IS NULL))));
CREATE POLICY "campaign_leads_select" ON public.campaign_leads FOR SELECT TO authenticated USING ((super_admin_own_org(organization_id) OR ((organization_id = get_org_id()) AND ((get_user_role() = ANY (ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text])) OR ((get_user_role() = 'Agent'::text) AND ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = campaign_leads.campaign_id) AND (c.organization_id = get_org_id()) AND (upper(TRIM(BOTH FROM c.type)) = ANY (ARRAY['OPEN POOL'::text, 'OPEN'::text]))))) OR (EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = campaign_leads.campaign_id) AND (c.organization_id = get_org_id()) AND (upper(TRIM(BOTH FROM c.type)) = 'TEAM'::text) AND ((auth.uid())::text = ANY (ARRAY( SELECT jsonb_array_elements_text(c.assigned_agent_ids) AS jsonb_array_elements_text)))))) OR ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = campaign_leads.campaign_id) AND (c.type = 'Personal'::text) AND (c.organization_id = get_org_id())))) AND ((claimed_by = auth.uid()) OR (user_id = auth.uid())))))))));
CREATE POLICY "Clients Hierarchical Access" ON public.clients FOR SELECT TO authenticated USING (((assigned_agent_id = auth.uid()) OR ((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = 'Team Leader'::text) AND (organization_id = get_org_id()) AND is_ancestor_of(auth.uid(), assigned_agent_id))));
CREATE POLICY "contact_activities_select_org_scoped" ON public.contact_activities FOR SELECT TO authenticated USING ((super_admin_own_org(organization_id) OR (organization_id = get_org_id()) OR (organization_id IS NULL)));
CREATE POLICY "contact_emails_select" ON public.contact_emails FOR SELECT TO authenticated USING ((super_admin_own_org(organization_id) OR ((organization_id = get_org_id()) AND ((get_user_role() = ANY (ARRAY['Admin'::text, 'Super Admin'::text])) OR (owner_user_id = auth.uid()) OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND is_ancestor_of(auth.uid(), owner_user_id))))));
CREATE POLICY "contact_notes_select_org_scoped" ON public.contact_notes FOR SELECT TO authenticated USING ((super_admin_own_org(organization_id) OR (organization_id = get_org_id()) OR (organization_id IS NULL)));
CREATE POLICY "Leads Hierarchical Access" ON public.leads FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR ((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = 'Team Leader'::text) AND (organization_id = get_org_id()) AND is_ancestor_of(auth.uid(), user_id))));
CREATE POLICY "leads_select_unassigned_pool" ON public.leads FOR SELECT TO authenticated USING (((organization_id = get_org_id()) AND (user_id IS NULL) AND (assigned_agent_id IS NULL) AND has_contacts_permission('contacts.leads.view_unassigned'::text) AND (has_contacts_permission('contacts.leads.view_all'::text) OR (imported_by_user_id = auth.uid()))));
CREATE POLICY "leads_select_view_all_pool" ON public.leads FOR SELECT TO authenticated USING (((organization_id = get_org_id()) AND has_contacts_permission('contacts.leads.view_all'::text)));
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated USING ((organization_id = get_user_org_id()));
CREATE POLICY "Recruits Hierarchical Access" ON public.recruits FOR SELECT TO authenticated USING (((assigned_agent_id = auth.uid()) OR ((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = 'Team Leader'::text) AND (organization_id = get_org_id()) AND is_ancestor_of(auth.uid(), assigned_agent_id))));
CREATE POLICY "tasks_select_admin" ON public.tasks FOR SELECT TO authenticated USING (((organization_id = get_org_id()) AND (get_user_role() = 'Admin'::text)));
CREATE POLICY "tasks_select_agent" ON public.tasks FOR SELECT TO authenticated USING (((organization_id = get_org_id()) AND ((assigned_to = auth.uid()) OR (created_by = auth.uid()))));
CREATE POLICY "tasks_select_team_leader" ON public.tasks FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles viewer
  WHERE ((viewer.id = auth.uid()) AND (viewer.organization_id = tasks.organization_id) AND (viewer.role = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (EXISTS ( SELECT 1
           FROM profiles subject
          WHERE ((subject.id = tasks.assigned_to) AND (subject.hierarchy_path <@ viewer.hierarchy_path))))))));
CREATE POLICY test_profiles_read ON public.profiles FOR SELECT TO authenticated USING(organization_id=public.get_org_id());
CREATE POLICY test_campaigns_read ON public.campaigns FOR SELECT TO authenticated USING(organization_id=public.get_org_id() AND (public.get_user_role() IN ('Admin','Super Admin') OR id::text=current_setting('test.visible_campaign',true)));
-- Test-only writer grants isolate capture semantics from unrelated production mutation RPCs.
CREATE POLICY test_insert ON public.appointments FOR INSERT TO authenticated WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_update ON public.appointments FOR UPDATE TO authenticated USING (organization_id=public.get_org_id()) WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_delete ON public.appointments FOR DELETE TO authenticated USING (organization_id=public.get_org_id());
CREATE POLICY test_insert ON public.tasks FOR INSERT TO authenticated WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_update ON public.tasks FOR UPDATE TO authenticated USING (organization_id=public.get_org_id()) WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_delete ON public.tasks FOR DELETE TO authenticated USING (organization_id=public.get_org_id());
CREATE POLICY test_insert ON public.contact_notes FOR INSERT TO authenticated WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_update ON public.contact_notes FOR UPDATE TO authenticated USING (organization_id=public.get_org_id()) WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_delete ON public.contact_notes FOR DELETE TO authenticated USING (organization_id=public.get_org_id());
CREATE POLICY test_insert ON public.leads FOR INSERT TO authenticated WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_update ON public.leads FOR UPDATE TO authenticated USING (organization_id=public.get_org_id()) WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_delete ON public.leads FOR DELETE TO authenticated USING (organization_id=public.get_org_id());
CREATE POLICY test_insert ON public.clients FOR INSERT TO authenticated WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_update ON public.clients FOR UPDATE TO authenticated USING (organization_id=public.get_org_id()) WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_delete ON public.clients FOR DELETE TO authenticated USING (organization_id=public.get_org_id());
CREATE POLICY test_insert ON public.recruits FOR INSERT TO authenticated WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_update ON public.recruits FOR UPDATE TO authenticated USING (organization_id=public.get_org_id()) WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_delete ON public.recruits FOR DELETE TO authenticated USING (organization_id=public.get_org_id());
CREATE POLICY test_insert ON public.campaign_leads FOR INSERT TO authenticated WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_update ON public.campaign_leads FOR UPDATE TO authenticated USING (organization_id=public.get_org_id()) WITH CHECK (organization_id=public.get_org_id());
CREATE POLICY test_delete ON public.campaign_leads FOR DELETE TO authenticated USING (organization_id=public.get_org_id());
CREATE FUNCTION public.test_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION public.test_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
CREATE FUNCTION public.test_actor(n integer,org integer DEFAULT 1) RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM set_config('request.jwt.claim.sub',public.test_id(n)::text,false);PERFORM set_config('request.jwt.claim.organization_id',public.test_id(org)::text,false);END $$;
\else
-- Synthetic fixtures, never production data. SELECT policies copied from the read-only audit.
INSERT INTO profiles(id,organization_id,role,team_id,hierarchy_path) VALUES
(test_id(11),test_id(1),'Admin',test_id(50),'root'),
(test_id(12),test_id(1),'Agent',test_id(50),'root.agent'),
(test_id(13),test_id(1),'Team Leader',test_id(50),'root'),
(test_id(14),test_id(1),'Agent',test_id(50),'other'),
(test_id(21),test_id(2),'Admin',NULL,'foreign');
INSERT INTO leads(id,organization_id,user_id,assigned_agent_id,status) VALUES
(test_id(101),test_id(1),test_id(12),test_id(12),'New'),
(test_id(102),test_id(2),test_id(21),test_id(21),'New'),
(test_id(103),test_id(1),test_id(14),test_id(14),'New');
TRUNCATE contact_history_events;
INSERT INTO calls(id,organization_id,contact_id,contact_type,agent_id,direction,duration,started_at,created_at,status)
 SELECT test_id(1000+n),test_id(1),test_id(101),NULL,test_id(12),'outbound',12,
 '2026-09-01'::timestamptz + (n/3)*interval '1 minute','2026-09-01','completed' FROM generate_series(1,355) n;
INSERT INTO messages(id,organization_id,lead_id,contact_type,direction,created_at,sent_at,status)
 SELECT test_id(2000+n),test_id(1),test_id(101),'lead','outbound','2026-09-01',
 '2026-09-01'::timestamptz + (n/3)*interval '1 minute','queued' FROM generate_series(1,355)n;
INSERT INTO contact_emails(id,organization_id,contact_id,owner_user_id,direction,created_at,sent_at,delivery_status)
 SELECT test_id(3000+n),test_id(1),test_id(101),test_id(12),'outbound','2026-09-01',
 '2026-09-01'::timestamptz + (n/3)*interval '1 minute','sent' FROM generate_series(1,355)n;
INSERT INTO calls(id,organization_id,contact_id,agent_id,created_at,started_at) VALUES
(test_id(9000),test_id(2),test_id(101),test_id(12),now(),now());
INSERT INTO contact_emails(id,organization_id,contact_id,owner_user_id,created_at,subject) VALUES
(test_id(9001),test_id(1),test_id(101),test_id(14),now(),'HIDDEN');
SELECT test_actor(12);
SET ROLE authenticated;
DO $$ DECLARE page jsonb; cursor jsonb; seen text[]:='{}'; k text; BEGIN
 LOOP
  page:=get_contact_conversation_page(test_id(101),'lead','all',cursor,30);
  PERFORM test_assert(jsonb_array_length(page->'items')<=30,'bounded global page');
  FOR k IN SELECT x->>'event_key' FROM jsonb_array_elements(page->'items') x LOOP
   PERFORM test_assert(NOT k=ANY(seen),'no duplicate page boundary'); seen:=array_append(seen,k);
  END LOOP;
  EXIT WHEN NOT (page->>'hasMore')::boolean;
  cursor:=page->'nextCursor';
 END LOOP;
 PERFORM test_assert(cardinality(seen)=1065,'all >300-per-source rows reachable; foreign and restricted rows excluded');
 page:=get_contact_conversation_page(test_id(101),'lead','call',NULL,500);
 PERFORM test_assert(jsonb_array_length(page->'items')=100,'hard maximum enforced');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') x WHERE x->>'kind'<>'call'),'filter pages full source');
 BEGIN PERFORM get_contact_conversation_page(test_id(102),'lead'); RAISE EXCEPTION 'denied contact accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM get_contact_conversation_page(test_id(101),'lead','sms',page->'nextCursor'); RAISE EXCEPTION 'foreign filter cursor accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN INSERT INTO contact_history_events(organization_id,contact_id,contact_type,source_table,source_id,action,actor_kind) VALUES(test_id(1),test_id(101),'lead','leads',test_id(101),'created','agent'); RAISE EXCEPTION 'forged event accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT test_assert(NOT has_function_privilege('anon','public.get_contact_activity_page(uuid,text,jsonb,integer)','EXECUTE'),'anon reader denied');
RESET ROLE;
SELECT test_assert(NOT has_function_privilege('authenticated','private.capture_contact_history_event()','EXECUTE'),'capture not callable');
SET ROLE authenticated;
INSERT INTO appointments(id,organization_id,contact_id,created_by,user_id,start_time,end_time,status,title)
 VALUES(test_id(4001),test_id(1),test_id(101),test_id(12),test_id(14),'2026-10-04 12:00Z','2026-10-04 13:00Z','Scheduled','Private title');
SELECT test_assert((SELECT actor_id=test_id(12) AND assignee_after=test_id(14) FROM contact_history_events WHERE source_id=test_id(4001)),'actor and assignee distinct');
UPDATE appointments SET start_time='2026-10-05 12:00Z',end_time='2026-10-05 13:00Z' WHERE id=test_id(4001);
SELECT test_assert((SELECT count(*)=2 FROM contact_history_events WHERE source_id=test_id(4001)),'one event per appointment transition');
UPDATE appointments SET updated_at=now() WHERE id=test_id(4001);
SELECT test_assert((SELECT count(*)=2 FROM contact_history_events WHERE source_id=test_id(4001)),'heartbeat/no-op ignored');
SELECT test_assert((SELECT before_values->>'start_time' IS NOT NULL AND after_values->>'start_time' IS NOT NULL FROM contact_history_events WHERE source_id=test_id(4001) AND action='changed'),'reschedule old/new retained');
INSERT INTO tasks(id,organization_id,contact_id,contact_type,created_by,assigned_to,title) VALUES(test_id(5001),test_id(1),test_id(101),'lead',test_id(12),test_id(12),'Task');
UPDATE tasks SET completed_at=now() WHERE id=test_id(5001);
UPDATE tasks SET completed_at=NULL WHERE id=test_id(5001);
SELECT test_assert((SELECT count(*)=3 FROM contact_history_events WHERE source_id=test_id(5001)),'task created/completed/reopened');
INSERT INTO contact_notes(id,organization_id,contact_id,contact_type,author_id,content,pinned) VALUES(test_id(6001),test_id(1),test_id(101),'lead',test_id(12),'Never copy this note',false);
UPDATE contact_notes SET pinned=true,content='Edited private content' WHERE id=test_id(6001);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM contact_history_events WHERE source_id=test_id(6001) AND (after_values ? 'content' OR before_values ? 'content')),'note body not copied');
DELETE FROM appointments WHERE id=test_id(4001);
SELECT test_assert((SELECT before_values='{}' AND after_values='{}' AND assignee_after IS NULL FROM contact_history_events WHERE source_id=test_id(4001) AND action='deleted'),'minimal deleted tombstone');
SELECT test_assert((SELECT count(*)=1 FROM contact_history_events WHERE source_id=test_id(4001)),'only tombstone visible once restricted source deleted');
RESET ROLE;
INSERT INTO appointments(id,organization_id,contact_id,created_by,user_id,title) VALUES(test_id(4002),test_id(1),test_id(101),test_id(14),test_id(14),'HIDDEN appointment');
SET ROLE authenticated;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM contact_history_events WHERE source_id=test_id(4002)),'contact visibility does not grant appointment history');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_contact_activity_page(test_id(101),'lead',NULL,100)->'items') x WHERE x->'payload'->>'source_id'=test_id(4002)::text),'activity reader retains source RLS');
SELECT test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(get_contact_activity_page(test_id(101),'lead',NULL,100)->'items') x WHERE x->>'kind'='operation'),'operational reader executable');
RESET ROLE;
-- Appointment status/campaign callback transitions preserve real values; no disposition writer is changed.
SELECT test_actor(12);
SET ROLE authenticated;
UPDATE appointments SET status='No Show' WHERE id=test_id(4002); -- hidden source: zero-row update, no event
RESET ROLE;
INSERT INTO campaigns(id,organization_id,type,name) VALUES(test_id(7001),test_id(1),'Open Pool','Synthetic campaign');
INSERT INTO campaign_leads(id,organization_id,lead_id,campaign_id,status) VALUES(test_id(7101),test_id(1),test_id(101),test_id(7001),'New');
UPDATE campaign_leads SET callback_due_at='2026-10-06 10:00Z',callback_agent_id=test_id(12) WHERE id=test_id(7101);
UPDATE campaign_leads SET callback_due_at='2026-10-07 10:00Z' WHERE id=test_id(7101);
UPDATE campaign_leads SET callback_due_at=NULL,status='Removed' WHERE id=test_id(7101);
SELECT test_assert((SELECT count(*)=4 FROM contact_history_events WHERE source_id=test_id(7101)),'campaign callback lifecycle recorded once per change');
UPDATE campaign_leads SET locked_at=now(),locked_by=test_id(12),call_attempts=4,retry_eligible_at=now() WHERE id=test_id(7101);
SELECT test_assert((SELECT count(*)=4 FROM contact_history_events WHERE source_id=test_id(7101)),'queue lock/counter noise ignored');
-- Compatibility due time survives canonical-null changes without a false cleared classification.
UPDATE campaign_leads SET callback_due_at='2026-10-08 10:00Z',scheduled_callback_at='2026-10-09 10:00Z' WHERE id=test_id(7101);
UPDATE campaign_leads SET callback_due_at=NULL WHERE id=test_id(7101);
SELECT test_assert(EXISTS(SELECT 1 FROM contact_history_events WHERE source_id=test_id(7101) AND after_values->>'callback_due_at' IS NULL AND after_values->>'scheduled_callback_at' IS NOT NULL),'callback event retains legacy due-time fallback');
-- Missing timestamps remain in a deterministic null bucket.
INSERT INTO calls(id,organization_id,contact_id,agent_id,direction,created_at) VALUES(test_id(9100),test_id(1),test_id(101),test_id(12),'outbound',NULL);
SELECT test_actor(12);
SET ROLE authenticated;
DO $$ DECLARE page jsonb; cursor jsonb; found boolean:=false; BEGIN
 LOOP
  page:=get_contact_conversation_page(test_id(101),'lead','call',cursor,100);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') x WHERE x->'payload'->>'id'=test_id(9100)::text AND x->>'event_time' IS NULL) THEN found:=true; END IF;
  EXIT WHEN NOT (page->>'hasMore')::boolean; cursor:=page->'nextCursor';
 END LOOP;
 PERFORM test_assert(found,'null timestamp row reachable without an invented date');
END $$;
RESET ROLE;
-- Conversion graph simulation: no modification to the real conversion RPC is introduced.
SELECT test_actor(12);
INSERT INTO clients(id,organization_id,lead_id,assigned_agent_id) VALUES(test_id(104),test_id(1),test_id(101),test_id(12));
UPDATE tasks SET contact_id=test_id(104),contact_type='client' WHERE contact_id=test_id(101);
UPDATE contact_notes SET contact_id=test_id(104),contact_type='client' WHERE contact_id=test_id(101);
UPDATE calls SET contact_id=test_id(104),contact_type='client' WHERE contact_id=test_id(101) AND organization_id=test_id(1);
UPDATE campaign_leads SET lead_id=NULL WHERE lead_id=test_id(101);
DELETE FROM leads WHERE id=test_id(101);
UPDATE campaign_leads SET status='DNC' WHERE id=test_id(7101);
SELECT test_assert((SELECT count(*)=7 FROM contact_history_events WHERE source_id=test_id(7101)),'post-conversion campaign update keeps exact captured lineage');
SET ROLE authenticated;
SELECT test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(get_contact_activity_page(test_id(104),'client',NULL,100)->'items') x WHERE x->'payload'->>'source_id'=test_id(5001)::text),'lead event survives conversion via exact lineage');
SELECT test_assert((SELECT count(*)=3 FROM contact_history_events WHERE source_id=test_id(5001)),'graph move emits no fake task changes');
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM contact_history_events WHERE source_id=test_id(101) AND action='deleted'),'conversion is not a lead deletion event');
-- Failure containment: an event insert failure cannot roll back a source write.
ALTER TABLE contact_history_events ADD CONSTRAINT test_failure CHECK(action='impossible') NOT VALID;
UPDATE clients SET first_name='Saved despite capture failure' WHERE id=test_id(104);
SELECT test_assert((SELECT first_name='Saved despite capture failure' FROM clients WHERE id=test_id(104)),'core write survived recorder failure');
SELECT test_assert(EXISTS(SELECT 1 FROM public.contact_history_capture_health WHERE organization_id=test_id(1)),'capture failure health recorded without row content');
ALTER TABLE contact_history_events DROP CONSTRAINT test_failure;
SET ROLE authenticated;
SELECT test_assert((contact_history_capture_info()->>'captureHasGaps')::boolean,'readers disclose capture gaps');
SELECT test_assert(contact_history_capture_info()->>'captureStartedAt' IS NOT NULL,'capture start is explicit');
RESET ROLE;
-- A service actor has no attributed human, even when the row has an owner/creator.
SELECT set_config('request.jwt.claim.sub','',false);
UPDATE clients SET first_name='System write' WHERE id=test_id(104);
SELECT test_assert(EXISTS(SELECT 1 FROM contact_history_events WHERE source_id=test_id(104) AND actor_id IS NULL AND actor_kind='system'),'no inferred system actor');
SELECT test_actor(11);
SET ROLE authenticated;
SELECT test_assert(EXISTS(SELECT 1 FROM contact_history_events WHERE source_id=test_id(4002)),'same-org admin source access retained');
SELECT test_actor(21,2);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM contact_history_events),'foreign organization sees no events');
RESET ROLE;

\endif
