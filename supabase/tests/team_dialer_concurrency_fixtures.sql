-- Isolated synthetic fixtures for two NATIVE PostgreSQL sessions; not a single-session simulation.
INSERT INTO public.campaigns(id,name,type,status,organization_id,user_id,assigned_agent_ids)
SELECT team_test.id(n),'Synthetic Concurrent '||n,'Team','Active',team_test.id(1),team_test.id(11),to_jsonb(ARRAY[team_test.id(12),team_test.id(13)])
FROM (VALUES(35),(36)) t(n);
INSERT INTO public.leads(id,organization_id,user_id,first_name,phone)
VALUES(team_test.id(151),team_test.id(1),team_test.id(11),'Synthetic Concurrent','+15555550151');
INSERT INTO public.campaign_leads(id,organization_id,campaign_id,lead_id,status)
VALUES(team_test.id(701),team_test.id(1),team_test.id(35),team_test.id(151),'Queued'),
      (team_test.id(702),team_test.id(1),team_test.id(36),team_test.id(151),'Queued');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(701),team_test.id(35),team_test.id(151)),'Admin')->'rows'->0->>'v')::boolean,'concurrency manifest Q701');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(702),team_test.id(36),team_test.id(151)),'Admin')->'rows'->0->>'v')::boolean,'concurrency manifest Q702');
