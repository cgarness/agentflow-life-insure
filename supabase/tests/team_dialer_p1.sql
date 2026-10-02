SELECT team_test.assert((SELECT count(*)=2 AND bool_and(queue_issued_at IS NULL) FROM public.dialer_lead_locks),'old locks stay unproven');
SELECT team_test.assert(NOT EXISTS(SELECT 1 FROM public.dialer_lead_locks k JOIN team_test.preimage p USING(id)
  WHERE k.expires_at<>p.expires_at OR k.locked_at<>p.locked_at),'P1 preserves every old lock timestamp');
-- Renewal must preserve NULL, not mint authority. The old claim payload still works at P1.
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.renew_lead_lock(%L) AS v',team_test.id(301)))->'rows'->0->>'v')::boolean,'old heartbeat renews');
SELECT team_test.assert((SELECT queue_issued_at IS NULL FROM public.dialer_lead_locks WHERE campaign_lead_id=team_test.id(301)),'renewal never marks');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(101),team_test.id(31)))->>'ok')::boolean,'old active claim succeeds during P1');
UPDATE public.leads SET assigned_agent_id=NULL WHERE id=team_test.id(101); -- synthetic reset only
SELECT team_test.assert((team_test.run(12,1,format('SELECT id FROM public.get_next_queue_lead(%L,''{}'')',team_test.id(31)))->'rows'->0->>'id')=team_test.id(301)::text,'canonical queue re-selects own eligible lead');
SELECT team_test.assert((SELECT queue_issued_at IS NOT NULL AND expires_at BETWEEN now()+interval '4 minutes' AND now()+interval '6 minutes'
  FROM public.dialer_lead_locks WHERE campaign_lead_id=team_test.id(301)),'fresh selection marks with canonical five-minute TTL');
SELECT team_test.assert((SELECT k.expires_at=p.expires_at AND k.locked_at=p.locked_at AND k.queue_issued_at IS NULL
  FROM public.dialer_lead_locks k JOIN team_test.preimage p USING(id) WHERE k.campaign_lead_id=team_test.id(302)),'another owner far-future lock untouched');
SELECT team_test.assert((team_test.run(12,1,format('WITH x AS (INSERT INTO public.dialer_lead_locks(campaign_lead_id,campaign_id,organization_id,locked_by,expires_at,queue_issued_at) VALUES (%L,%L,%L,%L,now()+interval ''1 hour'',now()) RETURNING queue_issued_at) SELECT queue_issued_at FROM x',team_test.id(304),team_test.id(32),team_test.id(1),team_test.id(12)))->'rows'->0->'queue_issued_at')='null'::jsonb,'authenticated fake mark stripped on INSERT');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.renew_lead_lock(%L) AS v',team_test.id(304)))->'rows'->0->>'v')::boolean,'forged own lock can renew operationally during P1');
SELECT team_test.assert((SELECT queue_issued_at IS NULL FROM public.dialer_lead_locks WHERE campaign_lead_id=team_test.id(304)),'forged lock renewal still unproven');
-- Current production has no client UPDATE policy. Assert both RLS and the trigger under a hypothetical grant.
CREATE POLICY synthetic_lock_update ON public.dialer_lead_locks FOR UPDATE TO authenticated USING(locked_by=auth.uid()) WITH CHECK(locked_by=auth.uid());
SELECT team_test.assert((team_test.run(12,1,format('WITH x AS (UPDATE public.dialer_lead_locks SET queue_issued_at=now() WHERE campaign_lead_id=%L RETURNING queue_issued_at) SELECT queue_issued_at FROM x',team_test.id(304)))->'rows'->0->'queue_issued_at')='null'::jsonb,'client UPDATE cannot add mark');
SELECT team_test.assert(team_test.run(12,1,format('WITH x AS (UPDATE public.dialer_lead_locks SET campaign_id=%L WHERE campaign_lead_id=%L RETURNING id) SELECT id FROM x',team_test.id(31),team_test.id(304)))->>'state'='42501','client UPDATE cannot preserve a mark under another identity');
DROP POLICY synthetic_lock_update ON public.dialer_lead_locks;
SELECT 'PASS Team P1 provenance and old-tab compatibility' AS result;
