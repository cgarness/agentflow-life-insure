-- Synthetic fixtures only. Runner constructs a disposable database and never accepts hosted URLs.
CREATE SCHEMA team_test;
CREATE FUNCTION team_test.id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION team_test.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL [%]', label; END IF; END $$;
-- One statement under the real authenticated role, RLS, ACL and PostgREST-shaped JWT claims.
-- Invoker only; never installed in a hosted database. Call ONLY from the test session owner.
CREATE FUNCTION team_test.run(actor int, org int, statement text, jwt_role text DEFAULT 'Agent')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb := '[]'; r record; prior_role text := current_user; prior_claims text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',team_test.id(actor),'role','authenticated',
    'app_metadata',jsonb_build_object('organization_id',team_test.id(org),'role',jwt_role))::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    FOR r IN EXECUTE statement LOOP result := result || jsonb_build_array(to_jsonb(r)); END LOOP;
    result := jsonb_build_object('ok',true,'rows',result);
  EXCEPTION WHEN OTHERS THEN
    result := jsonb_build_object('ok',false,'state',SQLSTATE,'message',SQLERRM);
  END;
  EXECUTE format('SET LOCAL ROLE %I',prior_role);
  PERFORM set_config('request.jwt.claims',coalesce(prior_claims,''),true);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION team_test.run(int,int,text,text) FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.profiles(id,organization_id,role,status,hierarchy_path) VALUES
 (team_test.id(11),team_test.id(1),'Admin','Active','root.admin'),
 (team_test.id(12),team_test.id(1),'Agent','Active','root.tl.a'),
 (team_test.id(13),team_test.id(1),'Agent','Active','root.b'),
 (team_test.id(14),team_test.id(1),'Agent','Active','root.nonmember'),
 (team_test.id(15),team_test.id(1),'Team Leader','Active','root.tl'),
 (team_test.id(21),team_test.id(2),'Agent','Active','foreign.agent');
INSERT INTO public.role_permissions(organization_id,role,permissions) VALUES
 (team_test.id(1),'Agent','{"contacts":{"contacts.leads.view_all":false,"contacts.leads.view_unassigned":false}}'),
 (team_test.id(1),'Team Leader','{"contacts":{"contacts.leads.view_all":false,"contacts.leads.view_unassigned":false}}');
INSERT INTO public.campaigns(id,name,type,status,organization_id,user_id,assigned_agent_ids,retry_interval_minutes) VALUES
 (team_test.id(31),'Synthetic Team','Team','Active',team_test.id(1),team_test.id(11),to_jsonb(ARRAY[team_test.id(12),team_test.id(13),team_test.id(15)]),120),
 (team_test.id(32),'Synthetic Open','Open Pool','Active',team_test.id(1),team_test.id(11),'[]',120),
 (team_test.id(33),'Synthetic Personal','Personal','Active',team_test.id(1),team_test.id(12),'[]',120),
 (team_test.id(34),'Synthetic Foreign','Team','Active',team_test.id(2),team_test.id(21),to_jsonb(ARRAY[team_test.id(21)]),120);
INSERT INTO public.leads(id,organization_id,user_id,assigned_agent_id,first_name,phone,date_of_birth,best_time_to_call,notes,custom_fields) VALUES
 (team_test.id(101),team_test.id(1),team_test.id(11),NULL,'Synthetic First','+15555550101','1960-01-01','Afternoon','Synthetic private notes','{"Imported score":0,"Opted in":false,"Coverage":"25000","Blank":"","__agentflow":"internal"}'),
 (team_test.id(102),team_test.id(1),team_test.id(11),NULL,'Synthetic Second','+15555550102',NULL,NULL,NULL,'{"Import":"two"}'),
 (team_test.id(103),team_test.id(1),team_test.id(13),team_test.id(13),'Synthetic B owned','+15555550103',NULL,NULL,NULL,'{"Private":"B"}'),
 (team_test.id(104),team_test.id(1),team_test.id(12),team_test.id(12),'Synthetic A owned','+15555550104',NULL,NULL,NULL,'{}'),
 (team_test.id(105),team_test.id(1),team_test.id(11),NULL,'Synthetic New','+15555550105',NULL,NULL,NULL,'{}'),
 (team_test.id(201),team_test.id(2),team_test.id(21),NULL,'Synthetic Foreign','+15555550201',NULL,NULL,NULL,'{"Private":"foreign"}');
INSERT INTO public.campaign_leads(id,campaign_id,organization_id,lead_id,first_name,phone,created_at,callback_agent_id,callback_due_at) VALUES
 (team_test.id(301),team_test.id(31),team_test.id(1),team_test.id(101),'Snapshot First','+15555550101',now()-interval '1 day',NULL,NULL),
 (team_test.id(302),team_test.id(31),team_test.id(1),team_test.id(102),'Snapshot Second','+15555550102',now(),NULL,NULL),
 (team_test.id(303),team_test.id(31),team_test.id(1),team_test.id(103),'Snapshot B','+15555550103',now(),team_test.id(13),now()),
 (team_test.id(304),team_test.id(32),team_test.id(1),team_test.id(102),'Snapshot Open','+15555550102',now(),NULL,NULL),
 (team_test.id(305),team_test.id(33),team_test.id(1),team_test.id(104),'Snapshot Personal','+15555550104',now(),NULL,NULL),
 (team_test.id(401),team_test.id(34),team_test.id(2),team_test.id(201),'Snapshot Foreign','+15555550201',now(),NULL,NULL);
-- Pre-P1 locks deliberately include far-future expiries. P1 must not touch them just by installing.
INSERT INTO public.dialer_lead_locks(campaign_lead_id,campaign_id,organization_id,locked_by,locked_at,expires_at) VALUES
 (team_test.id(301),team_test.id(31),team_test.id(1),team_test.id(12),now()-interval '1 day',now()+interval '365 days'),
 (team_test.id(302),team_test.id(31),team_test.id(1),team_test.id(13),now()-interval '2 days',now()+interval '365 days');
CREATE TABLE team_test.preimage AS SELECT * FROM public.dialer_lead_locks;
CREATE TABLE team_test.contacts_policy_preimage AS SELECT policyname,cmd,roles::text,qual,with_check
  FROM pg_policies WHERE schemaname='public' AND tablename='leads';
SELECT 'Synthetic Team fixtures ready' AS result;
