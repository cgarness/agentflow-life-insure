-- Regression on the unchanged server queue/advance paths. All rows and calls are synthetic.
UPDATE public.campaign_leads SET retry_eligible_at=NULL,status='Queued',call_attempts=0 WHERE id=team_test.id(301);
-- The recent canonical call still prevents resurfacing even though the browser's retry write is absent.
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(31)))->'rows'->0->>'id') IS DISTINCT FROM team_test.id(301)::text,'September recent-call fallback preserved');
-- Skip is an own-agent suppression and release, without incrementing attempts or setting global retry.
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(35)))->'rows'->0->>'id')=team_test.id(701)::text,'synthetic Skip gets own lead');
INSERT INTO public.campaign_lead_agent_suppressions(organization_id,campaign_id,campaign_lead_id,agent_id,suppressed_until,reason)
VALUES(team_test.id(1),team_test.id(35),team_test.id(701),team_test.id(12),now()+interval '2 hours','skip');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.release_lead_lock(%L)',team_test.id(701)))->>'ok')::boolean,'Skip old release payload');
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(35)))->'rows')='[]'::jsonb,'Skip suppresses only the skipper');
SELECT team_test.assert((team_test.run(13,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(35)))->'rows'->0->>'id')=team_test.id(701)::text,'Skip leaves lead available to other agent');
SELECT team_test.assert((SELECT call_attempts=0 AND retry_eligible_at IS NULL FROM public.campaign_leads WHERE id=team_test.id(701)),'Skip never changes attempts/global retry');
SELECT team_test.assert((team_test.run(13,1,format('SELECT public.release_lead_lock(%L)',team_test.id(701)))->>'ok')::boolean,'synthetic lock release');
DELETE FROM public.campaign_lead_agent_suppressions WHERE campaign_lead_id=team_test.id(701); -- synthetic fixture reset
-- Same callback-scheduler payload and due-within-five-minutes priority; other agents cannot take it.
INSERT INTO public.dispositions(id,organization_id,name,callback_scheduler)
VALUES(team_test.id(601),team_test.id(1),'Synthetic Callback',true);
SELECT team_test.assert((team_test.run(12,1,format('SELECT (public.advance_campaign_lead(%L,NULL,%L,now()+interval ''4 minutes'',''Synthetic callback'',false)).callback_agent_id AS v',team_test.id(302),team_test.id(601)))->'rows'->0->>'v')=team_test.id(12)::text,'old callback advance payload');
UPDATE public.leads SET assigned_agent_id=NULL WHERE id=team_test.id(102); -- synthetic unassigned callback fixture
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(31)))->'rows'->0->>'id')=team_test.id(302)::text,'own due callback first');
SELECT team_test.assert((team_test.run(13,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(31)))->'rows'->0->>'id') IS DISTINCT FROM team_test.id(302)::text,'other agent callback stays reserved');
SELECT 'PASS queue retry/callback/Skip compatibility' AS result;
