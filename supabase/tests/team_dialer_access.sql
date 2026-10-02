CREATE FUNCTION team_test.details(actor int, org int, queue_id int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT team_test.run(actor,org,format('SELECT public.get_team_dialer_lead_details(%L) AS v',team_test.id(queue_id)))->'rows'->0->'v'
$$;
CREATE TABLE team_test.reader_preimage AS SELECT
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l) AS leads,
 (SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM public.dialer_lead_locks k) AS locks,
 (SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM public.campaign_leads q) AS queue;
SELECT team_test.assert(team_test.details(12,1,301)->>'id'=team_test.id(101)::text,'current Team lead display target');
SELECT team_test.assert(team_test.details(12,1,301)->'custom_fields'->'Imported score'='0'::jsonb,'custom zero preserved');
SELECT team_test.assert(team_test.details(12,1,301)->'custom_fields'->'Opted in'='false'::jsonb,'custom false preserved');
SELECT team_test.assert(team_test.details(12,1,301)->>'date_of_birth'='1960-01-01' AND team_test.details(12,1,301)->>'notes'='Synthetic private notes','full supported fields before call');
SELECT team_test.assert(NOT (team_test.details(12,1,301) ?| ARRAY['user_id','status','lead_score','updated_at','created_at','imported_by_user_id']),'DTO whitelist excludes writable master metadata');
SELECT team_test.assert(team_test.details(14,1,301)='null'::jsonb,'removed/non-participant refused');
SELECT team_test.assert(team_test.details(13,1,301)='null'::jsonb,'another participant cannot read another lock');
SELECT team_test.assert(team_test.details(21,2,301)='null'::jsonb,'foreign organization refused');
SELECT team_test.assert(team_test.details(12,2,301)='null'::jsonb,'profile/JWT org mismatch refused');
SELECT team_test.assert(team_test.details(11,1,301)='null'::jsonb,'admin has no lock/membership bypass');
SELECT team_test.assert(team_test.details(12,1,999)='null'::jsonb,'unknown ID same refusal');
SELECT team_test.assert(team_test.details(12,1,305)='null'::jsonb,'Personal never uses Team reader');
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.leads WHERE id=%L',team_test.id(101)))->'rows')='[]'::jsonb,'general Contacts SELECT still hides master');
SELECT team_test.assert((SELECT p.leads=(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l)
  AND p.locks=(SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM public.dialer_lead_locks k)
  AND p.queue=(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM public.campaign_leads q)
  FROM team_test.reader_preimage p),'reader has no ownership/lock/counter/queue writes');
SELECT team_test.assert(NOT EXISTS((SELECT policyname,cmd,roles::text,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='leads'
 EXCEPT SELECT * FROM team_test.contacts_policy_preimage) UNION ALL
 (SELECT * FROM team_test.contacts_policy_preimage EXCEPT SELECT policyname,cmd,roles::text,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='leads')),'Contacts policies byte-for-expression unchanged');
SELECT team_test.assert(has_function_privilege('authenticated','public.get_team_dialer_lead_details(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_team_dialer_lead_details(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.get_team_dialer_lead_details(uuid)','EXECUTE'),'reader explicit ACL');
SELECT team_test.assert(NOT has_function_privilege('anon','public.claim_lead(uuid,uuid,uuid)','EXECUTE'),'anonymous claim sealed');
SELECT team_test.assert(NOT has_function_privilege('authenticated','private.has_team_queue_authority(uuid,boolean)','EXECUTE'),'private authority helper unreachable');
SELECT team_test.assert((SELECT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND pg_get_userbyid(proowner)='postgres'
  FROM pg_proc WHERE oid='public.get_team_dialer_lead_details(uuid)'::regprocedure),'reader pinned owner and search path');
SELECT team_test.assert(NOT has_table_privilege('authenticated','public.campaign_leads','INSERT')
  AND NOT has_table_privilege('authenticated','public.dialer_lead_locks','TRUNCATE')
  AND NOT has_table_privilege('authenticated','public.campaign_leads','TRIGGER')
  AND NOT has_table_privilege('anon','public.dialer_lead_locks','SELECT'),'queue ACL removes policy-bypassing powers');
SELECT team_test.assert(team_test.run(12,1,format('WITH x AS (INSERT INTO public.dialer_lead_locks(campaign_lead_id,campaign_id,organization_id,locked_by,expires_at,queue_issued_at) VALUES(%L,%L,%L,%L,now()+interval ''1 year'',now()) RETURNING id) SELECT id FROM x',team_test.id(305),team_test.id(33),team_test.id(1),team_test.id(12)))->>'state'='42501','forged own lock INSERT refused');
SELECT team_test.assert(team_test.run(12,1,format('WITH x AS (INSERT INTO public.campaign_leads(campaign_id,lead_id,organization_id) VALUES(%L,%L,%L) RETURNING id) SELECT id FROM x',team_test.id(31),team_test.id(106),team_test.id(1)))->>'state'='42501','forged association INSERT refused');
DO $$ DECLARE statement text; BEGIN
  FOREACH statement IN ARRAY ARRAY[
    format('WITH x AS (UPDATE public.campaign_leads SET lead_id=%L WHERE id=%L RETURNING id) SELECT id FROM x',team_test.id(106),team_test.id(301)),
    format('WITH x AS (UPDATE public.campaign_leads SET campaign_id=%L WHERE id=%L RETURNING id) SELECT id FROM x',team_test.id(32),team_test.id(301)),
    format('WITH x AS (UPDATE public.campaign_leads SET organization_id=%L WHERE id=%L RETURNING id) SELECT id FROM x',team_test.id(2),team_test.id(301)),
    format('WITH x AS (UPDATE public.campaign_leads SET id=%L WHERE id=%L RETURNING id) SELECT id FROM x',team_test.id(998),team_test.id(301))
  ] LOOP PERFORM team_test.assert(team_test.run(12,1,statement)->>'state'='42501','every client queue identity immutable'); END LOOP;
END $$;
SELECT team_test.assert((team_test.run(12,1,format('WITH x AS (UPDATE public.campaign_leads SET phone=''+15555550111'',callback_note=''Synthetic save'' WHERE id=%L RETURNING phone) SELECT phone FROM x',team_test.id(301)))->'rows'->0->>'phone')='+15555550111','old snapshot/callback save payload still writes');
-- Proven lock without validated association is insufficient, including a formerly repointed legacy row.
CREATE TABLE team_test.proof_copy AS SELECT * FROM private.team_queue_associations WHERE campaign_lead_id=team_test.id(301);
DELETE FROM private.team_queue_associations WHERE campaign_lead_id=team_test.id(301);
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'unproven legacy association refused');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'state'='42501','unproven association cannot claim to gain general access');
INSERT INTO private.team_queue_associations SELECT * FROM team_test.proof_copy;
-- Unproven old lock may renew but never authorizes display or claim until a fresh canonical selection.
UPDATE public.dialer_lead_locks SET queue_issued_at=NULL WHERE campaign_lead_id=team_test.id(301);
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'unproven lock refused');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.renew_lead_lock(%L) AS v',team_test.id(301)))->'rows'->0->>'v')::boolean,'old renewal remains compatible');
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'renewal cannot mint display authority');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'state'='42501','unproven lock cannot claim');
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(31)))->'rows'->0->>'id')=team_test.id(301)::text,'fresh own queue fetch restores legitimate authority');
UPDATE public.dialer_lead_locks SET expires_at=now()-interval '1 second' WHERE campaign_lead_id=team_test.id(301);
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'expired lock refused');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'state'='42501','expired claim refused');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.renew_lead_lock(%L) AS v',team_test.id(301)))->'rows'->0->>'v')::boolean,'existing renewal semantics unchanged');
SELECT team_test.assert(team_test.details(12,1,301)->>'id'=team_test.id(101)::text,'same proven renewed lock readable');
UPDATE public.campaigns SET assigned_agent_ids=to_jsonb(ARRAY[team_test.id(13)]) WHERE id=team_test.id(31);
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'current membership removal immediately refused by server');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'state'='42501','removed participant cannot claim');
UPDATE public.campaigns SET assigned_agent_ids=to_jsonb(ARRAY[team_test.id(12),team_test.id(13),team_test.id(15)]) WHERE id=team_test.id(31);
UPDATE public.profiles SET status='Inactive' WHERE id=team_test.id(12);
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'inactive actor refused');
UPDATE public.profiles SET status='Active' WHERE id=team_test.id(12);
UPDATE public.leads SET assigned_agent_id=team_test.id(13) WHERE id=team_test.id(101);
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'ownership changed after issue cannot expose another private book');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'state'='42501','old own lock cannot take over changed owner');
UPDATE public.leads SET assigned_agent_id=NULL WHERE id=team_test.id(101);
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(106),team_test.id(31)))->>'state'='42501','claim cannot select a different unassigned master');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(103),team_test.id(31)))->>'state'='42501','claim cannot select a different private master');
SELECT team_test.assert((SELECT assigned_agent_id=team_test.id(13) FROM public.leads WHERE id=team_test.id(103)),'private owner unchanged');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'ok')::boolean,'normal hard claim succeeds');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'ok')::boolean,'same-owner retry idempotent');
SELECT team_test.assert(team_test.run(13,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'state'='42501','another agent cannot take over claimed lead');
SELECT team_test.assert((team_test.run(13,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(31)))->'rows'->0->>'id')=team_test.id(303)::text,'owned due callback preserves waterfall priority');
SELECT team_test.assert(team_test.details(12,1,303)='null'::jsonb,'another agent callback/private book refused');
SELECT team_test.assert(team_test.details(13,1,303)->>'id'=team_test.id(103)::text,'own callback readable');
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(32)))->'rows'->0->>'id')=team_test.id(304)::text,'old Open Pool queue signature still works');
SELECT team_test.assert(team_test.details(12,1,304)='null'::jsonb,'Open Pool visibility not expanded');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(304),team_test.id(102),team_test.id(32)))->>'ok')::boolean,'Open Pool normal claim preserved');
SELECT team_test.assert((team_test.run(21,2,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(34)))->'rows'->0->>'id')=team_test.id(401)::text,'foreign synthetic actor acquires own queue');
SELECT team_test.assert((team_test.run(11,1,format('WITH x AS (DELETE FROM public.dialer_lead_locks WHERE campaign_lead_id=%L RETURNING id) SELECT id FROM x',team_test.id(401)),'Admin')->'rows')='[]'::jsonb,'Admin lock DELETE org-scoped');
-- Exact unchanged advance implementation: Save Only keeps lock, replay keeps attempts, Save & Next releases.
INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,campaign_lead_id,contact_id,started_at,status)
VALUES(team_test.id(501),team_test.id(1),team_test.id(12),team_test.id(31),team_test.id(301),team_test.id(101),now(),'completed');
SELECT team_test.assert((team_test.run(12,1,format('SELECT (public.advance_campaign_lead(%L,%L,NULL,NULL,NULL,false)).call_attempts AS n',team_test.id(301),team_test.id(501)))->'rows'->0->>'n')::int=1,'old Save Only advances once');
SELECT team_test.assert(EXISTS(SELECT FROM public.dialer_lead_locks WHERE campaign_lead_id=team_test.id(301) AND locked_by=team_test.id(12)),'Save Only retains lock');
SELECT team_test.assert((team_test.run(12,1,format('SELECT (public.advance_campaign_lead(%L,%L,NULL,NULL,NULL,true)).call_attempts AS n',team_test.id(301),team_test.id(501)))->'rows'->0->>'n')::int=1,'same call replay does not increment twice');
SELECT team_test.assert(NOT EXISTS(SELECT FROM public.dialer_lead_locks WHERE campaign_lead_id=team_test.id(301)),'Save & Next releases same lock');
SELECT team_test.assert(team_test.details(12,1,301)='null'::jsonb,'released lead immediately refused');
SELECT team_test.assert((SELECT leads_called=1 FROM public.campaigns WHERE id=team_test.id(31)),'existing campaign counter triggers preserved');
-- Failed save stays inside a subtransaction: no advance or release can commit.
SELECT team_test.assert((team_test.run(12,1,'SELECT 1/0')->>'ok')::boolean=false,'failed write path modeled as failure');
SELECT team_test.assert(EXISTS(SELECT FROM public.dialer_lead_locks WHERE campaign_lead_id=team_test.id(304)),'failed save retains current other lock');
-- Conversion/contact deletion must retain the real FK SET NULL and cascade behavior.
INSERT INTO public.leads(id,organization_id,user_id,assigned_agent_id,first_name)
VALUES(team_test.id(107),team_test.id(1),team_test.id(12),team_test.id(12),'Synthetic conversion FK');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.add_leads_to_campaign(%L,ARRAY[%L]::uuid[],NULL)',team_test.id(31),team_test.id(107)))->>'ok')::boolean,'own source attaches before conversion');
CREATE TABLE team_test.conversion_queue AS SELECT id FROM public.campaign_leads WHERE campaign_id=team_test.id(31) AND lead_id=team_test.id(107);
SELECT team_test.assert((team_test.run(12,1,format('DELETE FROM public.leads WHERE id=%L RETURNING id',team_test.id(107)))->'rows'->0->>'id')=team_test.id(107)::text,'authorized source deletion succeeds through identity guard');
SELECT team_test.assert((SELECT lead_id IS NULL FROM public.campaign_leads WHERE id=(SELECT id FROM team_test.conversion_queue)),'conversion FK clears source reference');
SELECT team_test.assert(NOT EXISTS(SELECT FROM private.team_queue_associations WHERE campaign_lead_id=(SELECT id FROM team_test.conversion_queue)),'conversion cascade removes proof');
SELECT 'PASS Team display/claim authority, forged paths, RLS, ACL and old-client lifecycle' AS result;
