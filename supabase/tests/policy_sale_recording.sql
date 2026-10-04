-- Synthetic fixtures only. Executed on disposable PostgreSQL or embedded PGlite.
INSERT INTO public.organizations(id,name) VALUES(test_id(1),'Test A'),(test_id(2),'Test B');
INSERT INTO public.profiles(id,organization_id,first_name,last_name,role,status,hierarchy_path) VALUES
(test_id(11),test_id(1),'Agent','One','Agent','Active','root.agent'),
(test_id(12),test_id(1),'Peer','Two','Agent','Active','peer'),
(test_id(13),test_id(1),'Admin','One','Admin','Active','admin'),
(test_id(14),test_id(1),'Team','Leader','Team Leader','Active','root'),
(test_id(21),test_id(2),'Other','Org','Agent','Active','other'),
(test_id(15),test_id(1),'Inactive','Agent','Agent','Inactive','inactive');
CREATE TABLE public.test_results(key text PRIMARY KEY, data jsonb);
GRANT SELECT,INSERT,UPDATE ON public.test_results TO authenticated;
CREATE FUNCTION public.test_reject(sql text, code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=code THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected %, got %: %',code,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'Expected refusal %: %',code,sql;
END $$;
CREATE FUNCTION public.test_client_payload() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
 'first_name','Sale','last_name','Client','assigned_agent_id',public.test_id(11),
 'policy_type','Term','carrier','Test Carrier','premium',100,'sold_date','2026-01-02',
 'payment_frequency','monthly','custom_fields',jsonb_build_object('customer_note','Keep me')) $$;

SELECT test_actor(11);
SET ROLE authenticated;
INSERT INTO test_results VALUES('manual',create_client_with_sale(test_id(101),test_id(1),test_client_payload(),true));
INSERT INTO test_results VALUES('retry',create_client_with_sale(test_id(101),test_id(1),test_client_payload(),true));
INSERT INTO test_results VALUES('contact-only',create_client_with_sale(test_id(102),test_id(1),test_client_payload(),false));
SELECT test_reject($q$SELECT create_client_with_sale(test_id(101),test_id(1),test_client_payload()||'{"premium":200}',true)$q$,'22023');
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(2),test_client_payload(),true)$q$,'42501');
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(1),test_client_payload()||jsonb_build_object('assigned_agent_id',test_id(12)),true)$q$,'42501');
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(1),test_client_payload()||'{"lead_id":"00000000-0000-0000-0000-000000000999"}',true)$q$,'22023');
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(1),test_client_payload()||'{"sold_date":"2026-02-30"}',true)$q$,'22008');
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(1),test_client_payload()||'{"premium":-5}',true)$q$,'22023');
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(1),test_client_payload()||'{"carrier":""}',true)$q$,'22023');
SELECT test_reject($q$SELECT * FROM private.policy_sale_receipts$q$,'42501');
SELECT test_reject($q$SELECT private.insert_policy_sale(test_id(101),'{}','bad',null)$q$,'42501');
RESET ROLE;
SELECT test_assert((SELECT data->>'client_id' FROM test_results WHERE key='manual')=(SELECT data->>'client_id' FROM test_results WHERE key='retry'),'manual retry same client');
SELECT test_assert((SELECT count(*) FROM wins)=1 AND (SELECT count(*) FROM clients)=2,'one sale plus contact-only, no partial failed clients');
SELECT test_assert((SELECT premium_snapshot AND premium_amount=100 AND sold_date='2026-01-02' AND created_at>=current_date FROM wins),'monthly snapshot and current event timestamp');
SELECT test_assert((SELECT custom_fields->>'customer_note'='Keep me' FROM clients WHERE id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='manual')),'manual custom fields preserved');
UPDATE clients SET premium=300 WHERE id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='manual');
SELECT test_assert((SELECT count(*) FROM wins)=1,'ordinary client edit adds no sales');
SELECT test_assert((SELECT annualized_premium=1200 FROM get_org_leaderboard_stats(current_date, current_date+interval '1 day') WHERE agent_id=test_id(11)),'saved sale premium never changes with client edits');

-- Imports remain ordinary client inserts and never generate policy events.
INSERT INTO clients(first_name,last_name,organization_id,assigned_agent_id,sold_date,premium) VALUES('Imported','Book',test_id(1),test_id(11),'2026-01-02',100);
SELECT test_assert((SELECT count(*) FROM wins)=1,'import does not generate sales');
SELECT test_actor(15);
SET ROLE authenticated;
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(1),test_client_payload(),true)$q$,'42501');
RESET ROLE;
SELECT test_actor(11,2);
SET ROLE authenticated;
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(2),test_client_payload(),true)$q$,'42501');
RESET ROLE;
SELECT test_actor(11);
SET ROLE anon;
SELECT test_reject($q$SELECT create_client_with_sale(test_id(103),test_id(1),test_client_payload(),true)$q$,'42501');
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(201),test_id(1),'{}',null)$q$,'42501');
RESET ROLE;
SELECT test_assert(NOT has_function_privilege('authenticated','private.insert_policy_sale(uuid,jsonb,text,uuid)','EXECUTE'),'private writer cannot be executed directly');

-- Conversion: exact original function and telemetry transfer, with three atomic policies.
INSERT INTO leads(id,organization_id,user_id,assigned_agent_id,first_name,last_name) VALUES
(test_id(201),test_id(1),test_id(11),test_id(11),'Converted','Client'),
(test_id(202),test_id(1),test_id(12),test_id(12),'Peer','Lead'),
(test_id(203),test_id(2),test_id(21),test_id(21),'Other','Lead'),
(test_id(204),test_id(1),test_id(11),test_id(11),'Rollback','Lead'),
(test_id(205),test_id(1),test_id(11),test_id(11),'Legacy','Lead'),
(test_id(206),test_id(1),null,null,'Unassigned','Lead');
INSERT INTO campaigns(id,name,organization_id) VALUES(test_id(301),'Test Campaign',test_id(1)),(test_id(302),'Other Campaign',test_id(2));
INSERT INTO campaign_leads(id,campaign_id,lead_id,organization_id) VALUES(test_id(401),test_id(301),test_id(201),test_id(1));
INSERT INTO calls(id,contact_id,contact_type,lead_id,agent_id,organization_id,direction,duration,disposition_name,campaign_id,campaign_lead_id)
 VALUES(test_id(501),test_id(201),'lead',test_id(201),test_id(11),test_id(1),'outbound',73,'Interested',test_id(301),test_id(401));
INSERT INTO contact_notes(id,contact_id,contact_type,organization_id) VALUES(test_id(601),test_id(201),'lead',test_id(1));
INSERT INTO test_results VALUES('conversion-payload',jsonb_build_object('policy_type','IUL','carrier','Test','premium',50,'sold_date','2026-01-02',
 'custom_fields',jsonb_build_object('foo','bar','additional_policies',jsonb_build_array(
 jsonb_build_object('policyType','Term','carrier','Additional','premiumAmount','$25.50','soldDate','2026-01-02','faceAmount','125000','policyNumber','P2'),
 jsonb_build_object('policyType','Whole Life','carrier','Unknown Amount','premiumAmount','','soldDate','2026-01-02')))));
SET ROLE authenticated;
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(202),test_id(1),(SELECT data FROM test_results WHERE key='conversion-payload'),null)$q$,'42501');
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(203),test_id(1),(SELECT data FROM test_results WHERE key='conversion-payload'),null)$q$,'42501');
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(201),test_id(1),(SELECT data FROM test_results WHERE key='conversion-payload'),test_id(302))$q$,'42501');
INSERT INTO test_results VALUES('conversion',convert_lead_to_client_with_sales(test_id(201),test_id(1),(SELECT data FROM test_results WHERE key='conversion-payload'),test_id(301)));
INSERT INTO test_results VALUES('conversion-retry',convert_lead_to_client_with_sales(test_id(201),test_id(1),(SELECT data FROM test_results WHERE key='conversion-payload'),test_id(301)));
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(201),test_id(1),test_client_payload(),test_id(301))$q$,'22023');
RESET ROLE;
SELECT test_assert((SELECT jsonb_array_length(data->'win_ids')=3 FROM test_results WHERE key='conversion'),'primary and every additional policy recorded');
SELECT test_assert((SELECT data->'win_ids' FROM test_results WHERE key='conversion')=(SELECT data->'win_ids' FROM test_results WHERE key='conversion-retry'),'conversion retry same policy events');
SELECT test_assert((SELECT count(*) FROM wins)=4,'no duplicate conversion events');
SELECT test_assert((SELECT custom_fields=(SELECT data->'custom_fields' FROM test_results WHERE key='conversion-payload') FROM clients WHERE lead_id=test_id(201)),'additional policy JSON preserved verbatim');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM leads WHERE id=test_id(201)) AND EXISTS(SELECT 1 FROM clients WHERE lead_id=test_id(201)),'lead removed and lineage retained');
SELECT test_assert(EXISTS(SELECT 1 FROM calls WHERE id=test_id(501) AND contact_id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='conversion') AND contact_type='client' AND duration=73 AND disposition_name='Interested' AND campaign_id=test_id(301) AND campaign_lead_id=test_id(401)),'call move preserves duration disposition and campaign IDs');
SELECT test_assert(EXISTS(SELECT 1 FROM contact_notes WHERE id=test_id(601) AND contact_type='client'),'notes transferred');
SELECT test_assert(EXISTS(SELECT 1 FROM campaign_leads WHERE id=test_id(401) AND lead_id IS NULL),'queue retained with original FK behavior');
SELECT test_assert((SELECT policies_sold=4 AND annualized_premium=2106 AND calls_made=1 AND talk_time_seconds=73 FROM get_org_leaderboard_stats(current_date,current_date+interval '1 day') WHERE agent_id=test_id(11)),'aggregate counts all policies without borrowing premium for blank additional policy');

-- A late policy validation failure rolls back original conversion AND its earlier win.
SET ROLE authenticated;
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(204),test_id(1),jsonb_set((SELECT data FROM test_results WHERE key='conversion-payload'),'{custom_fields,additional_policies,1,premiumAmount}','"invalid"'),null)$q$,'22023');
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM leads WHERE id=test_id(204)) AND NOT EXISTS(SELECT 1 FROM clients WHERE lead_id=test_id(204)) AND (SELECT count(*) FROM wins)=4,'late policy failure completely rolls back');

-- Force canonical win persistence failure independently of validation.
CREATE FUNCTION public.test_fail_win() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced win failure' USING ERRCODE='23514'; END $$;
CREATE TRIGGER test_fail_win BEFORE INSERT ON wins FOR EACH ROW EXECUTE FUNCTION public.test_fail_win();
SET ROLE authenticated;
SELECT test_reject($q$SELECT create_client_with_sale(test_id(105),test_id(1),test_client_payload(),true)$q$,'23514');
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(204),test_id(1),(SELECT data FROM test_results WHERE key='conversion-payload'),null)$q$,'23514');
RESET ROLE;
DROP TRIGGER test_fail_win ON wins;
SELECT test_assert(EXISTS(SELECT 1 FROM leads WHERE id=test_id(204)) AND NOT EXISTS(SELECT 1 FROM clients WHERE lead_id=test_id(204)),'win storage failure preserves original lead');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM private.policy_sale_receipts WHERE operation_key LIKE '%000000000105'),'failed manual transaction leaves no receipt');

-- Existing legacy conversion never acquires newly dated sales during a retry.
SET ROLE authenticated;
INSERT INTO test_results VALUES('legacy',convert_lead_to_client_atomic(test_id(205),test_client_payload()));
INSERT INTO test_results VALUES('legacy-retry',convert_lead_to_client_with_sales(test_id(205),test_id(1),test_client_payload(),null));
RESET ROLE;
SELECT test_assert((SELECT data->'win_ids'='[]'::jsonb FROM test_results WHERE key='legacy-retry') AND (SELECT count(*) FROM wins)=4,'legacy replay does not backfill');
SELECT test_actor(12);
SET ROLE authenticated;
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(205),test_id(1),test_client_payload(),null)$q$,'42501');
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(201),test_id(1),(SELECT data FROM test_results WHERE key='conversion-payload'),test_id(301))$q$,'42501');
RESET ROLE;
-- Admin retains conversion rights, credit follows existing assignment.
SELECT test_actor(13);
SET ROLE authenticated;
INSERT INTO test_results VALUES('admin-conversion',convert_lead_to_client_with_sales(test_id(202),test_id(1),test_client_payload(),null));
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM wins WHERE contact_id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='admin-conversion') AND agent_id=test_id(12)),'Admin conversion preserves peer attribution');
SELECT test_actor(11);
SET ROLE authenticated;
INSERT INTO test_results VALUES('unassigned',convert_lead_to_client_with_sales(test_id(206),test_id(1),test_client_payload(),null));
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM wins WHERE contact_id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='unassigned') AND agent_id IS NULL),'unassigned conversion is not silently credited to actor');
-- Receipt tombstone prevents deleted-client resurrection.
DELETE FROM clients WHERE id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='contact-only');
SET ROLE authenticated;
SELECT test_reject($q$SELECT create_client_with_sale(test_id(102),test_id(1),test_client_payload(),false)$q$,'42501');
RESET ROLE;
SELECT test_assert(md5(pg_get_functiondef('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure))='641ba66c96ca4a76f80c9c85eb9caa42','original converter bytes remain intact');
SELECT 'PASS sale transaction, retry, snapshot, rollback, legacy, telemetry and authorization assertions' AS result;
-- NULL ownership must not turn an ordinary peer into an authorized converter.
INSERT INTO leads(id,organization_id,user_id,assigned_agent_id,first_name,last_name) VALUES
(test_id(207),test_id(1),test_id(12),null,'Peer','Nullable Assignee'),
(test_id(208),test_id(1),null,test_id(12),'Peer','Nullable Owner'),
(test_id(209),test_id(1),test_id(11),test_id(11),'Downline','Agent');
SELECT test_actor(11);
SET ROLE authenticated;
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(207),test_id(1),test_client_payload(),null)$q$,'42501');
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(208),test_id(1),test_client_payload(),null)$q$,'42501');
RESET ROLE;
-- Authorized manual View As writes preserve the target owner, with server-side org checks.
SELECT test_actor(13);
SET ROLE authenticated;
INSERT INTO test_results VALUES('manual-admin',create_client_with_sale(test_id(110),test_id(1),test_client_payload(),true));
SELECT test_reject($q$SELECT create_client_with_sale(test_id(111),test_id(1),test_client_payload()||jsonb_build_object('assigned_agent_id',test_id(21)),true)$q$,'42501');
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM wins WHERE contact_id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='manual-admin') AND agent_id=test_id(11)),'Admin View As retains effective agent attribution');
SELECT test_actor(14);
SET ROLE authenticated;
INSERT INTO test_results VALUES('manual-tl',create_client_with_sale(test_id(112),test_id(1),test_client_payload(),true));
INSERT INTO test_results VALUES('conversion-tl',convert_lead_to_client_with_sales(test_id(209),test_id(1),test_client_payload(),null));
SELECT test_reject($q$SELECT create_client_with_sale(test_id(113),test_id(1),test_client_payload()||jsonb_build_object('assigned_agent_id',test_id(12)),true)$q$,'42501');
RESET ROLE;
SELECT test_assert(EXISTS(SELECT 1 FROM wins WHERE contact_id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='conversion-tl') AND agent_id=test_id(11)),'TL downline conversion preserves attribution');
SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE authenticated;
SELECT test_reject($q$SELECT create_client_with_sale(test_id(114),test_id(1),test_client_payload(),true)$q$,'42501');
SELECT test_reject($q$SELECT convert_lead_to_client_with_sales(test_id(207),test_id(1),test_client_payload(),null)$q$,'42501');
RESET ROLE;
SELECT test_assert((SELECT relrowsecurity FROM pg_class WHERE oid='private.policy_sale_receipts'::regclass),'receipt RLS enabled');
SELECT 'PASS View As, NULL ownership, Team Leader and missing-session assertions' AS result;
