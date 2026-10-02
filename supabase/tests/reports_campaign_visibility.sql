-- Campaign visibility intersects, but never changes, the caller's authorized policy/call totals.
-- Run only in the disposable localhost Reports harness. Transaction restores all test-only changes.
\set ON_ERROR_STOP on
BEGIN;
SELECT rt.reset_perms();
INSERT INTO rt.ids(name,id) VALUES
 ('V_PRIVATE','55000000-0000-0000-0000-000000000001'),
 ('V_OPEN','55000000-0000-0000-0000-000000000002'),
 ('V_TEAM','55000000-0000-0000-0000-000000000003'),
 ('V_HIDDEN_TEAM','55000000-0000-0000-0000-000000000004'),
 ('V_CLIENT','55000000-0000-0000-0000-000000000011'),
 ('V_LEAD','55000000-0000-0000-0000-000000000021');
INSERT INTO public.campaigns(id,name,type,user_id,organization_id,assigned_agent_ids) VALUES
 (rt.id('V_PRIVATE'),'Alices private December campaign','Personal',rt.id('A1'),rt.id('O1'),'[]'),
 (rt.id('V_OPEN'),'December open pool','Open Pool',rt.id('ADMIN'),rt.id('O1'),'[]'),
 (rt.id('V_TEAM'),'December authorized team','Team',rt.id('ADMIN'),rt.id('O1'),jsonb_build_array(rt.id('A2')::text)),
 (rt.id('V_HIDDEN_TEAM'),'December unjoined team','Team',rt.id('ADMIN'),rt.id('O1'),jsonb_build_array(rt.id('A1')::text));
INSERT INTO public.clients(id,first_name,last_name,carrier,sold_date,assigned_agent_id,organization_id,lead_id,custom_fields)
 VALUES(rt.id('V_CLIENT'),'Synthetic','Policy','Carrier','2026-12-05',rt.id('A1'),rt.id('O1'),rt.id('V_LEAD'),
        '{"additional_policies":[{"soldDate":"2026-12-06","policyType":"Whole Life"}]}');
INSERT INTO public.wins(id,agent_id,organization_id,contact_id,campaign_id,idempotency_key,created_at)
 VALUES('55000000-0000-0000-0000-000000000031',rt.id('A1'),rt.id('O1'),rt.id('V_CLIENT'),rt.id('V_PRIVATE'),
        'conversion:'||rt.id('V_LEAD')::text,'2026-12-05T18:00:00Z');
-- Both call-derived and policy-derived private metadata must be withheld from the new assignee.
SELECT rt.call_row(5501,'A2','outbound','2026-12-05T18:00:00Z',60,'D_INT',NULL,'V_PRIVATE',NULL,rt.id('V_CLIENT'),'client');
SELECT rt.call_row(5502,'A2','outbound','2026-12-05T19:00:00Z',60,'D_INT',NULL,'V_OPEN',NULL,NULL,NULL);
SELECT rt.call_row(5503,'A2','outbound','2026-12-05T20:00:00Z',60,'D_INT',NULL,'V_TEAM',NULL,NULL,NULL);
SELECT rt.call_row(5504,'A2','outbound','2026-12-05T21:00:00Z',60,'D_INT',NULL,'V_HIDDEN_TEAM',NULL,NULL,NULL);
SELECT rt.call_row(5505,'A2','outbound','2026-12-05T22:00:00Z',60,'D_INT',NULL,NULL,NULL,NULL,NULL);
SELECT rt.call_row(5506,'A1','outbound','2026-12-05T23:00:00Z',60,'D_INT',NULL,'V_PRIVATE',NULL,NULL,NULL);
UPDATE public.clients SET assigned_agent_id=rt.id('A2') WHERE id=rt.id('V_CLIENT');
DO $v$
DECLARE j jsonb; d jsonb; s jsonb; who text;
BEGIN
 j:=rt.rpc('get_report_campaign_performance','A2','2026-12-01','2026-12-31');
 PERFORM rt.eq('V1 private campaign id withheld',position(rt.id('V_PRIVATE')::text IN j::text),0);
 PERFORM rt.eq('V1 private campaign name withheld',position('Alices private' IN j::text),0);
 PERFORM rt.eq('V1 unjoined Team id withheld',position(rt.id('V_HIDDEN_TEAM')::text IN j::text),0);
 PERFORM rt.eq('V1 two authorized campaigns',jsonb_array_length(j->'campaigns'),2);
 PERFORM rt.eq('V1 authorized policy total retained',(j->>'policies_in_period')::int,2);
 PERFORM rt.eq('V1 private policy attribution unavailable',(j->>'policies_attribution_unavailable')::int,2);
 PERFORM rt.eq('V1 all policy attribution reconciles',
   (SELECT coalesce(sum((x->>'attributed_policies')::int),0)::int FROM jsonb_array_elements(j->'campaigns')x)
   +(j->>'policies_attribution_unavailable')::int,2);
 PERFORM rt.eq('V1 private and absent call attribution unavailable',(j->>'calls_attribution_unavailable')::int,3);
 PERFORM rt.eq('V1 calls reconcile',
   (SELECT sum((x->>'calls_made')::int)::int FROM jsonb_array_elements(j->'campaigns')x)
   +(j->>'calls_attribution_unavailable')::int,5);
 s:=rt.summary('A2','2026-12-01','2026-12-31');
 PERFORM rt.eq('V1 assignee owns both policies',(s->'totals'->>'policies_sold')::int,2);
 PERFORM rt.eq('V1 assignee calls unchanged',(s->'totals'->>'calls_made')::int,5);
 d:=rt.rpc('get_report_disposition_breakdown','A2','2026-12-01','2026-12-31');
 PERFORM rt.eq('V2 disposition private id withheld',position(rt.id('V_PRIVATE')::text IN d::text),0);
 PERFORM rt.eq('V2 disposition private name withheld',position('Alices private' IN d::text),0);
 PERFORM rt.eq('V2 disposition authorized total retained',(d->>'total_calls')::int,5);
 PERFORM rt.eq('V2 disposition breakdown reconciles',
   (SELECT sum((x->>'total')::int)::int FROM jsonb_array_elements(d->'by_campaign')x)
   +(d->>'campaign_attribution_unavailable_calls')::int,5);
 -- Actual owner sees their campaign, but reassignment does not transfer the calling agent's activity.
 j:=rt.rpc('get_report_campaign_performance','A1','2026-12-01','2026-12-31');
 PERFORM rt.eq('V3 owner sees their campaign',(j->'campaigns'->0->>'campaign_id'),rt.id('V_PRIVATE')::text);
 PERFORM rt.eq('V3 owner retains their call',(j->'campaigns'->0->>'calls_made')::int,1);
 PERFORM rt.eq('V3 reassigned policies no longer assigned to original owner',(j->>'policies_in_period')::int,0);
 FOREACH who IN ARRAY ARRAY['ADMIN','TL','SUPER','SUPER2'] LOOP
   j:=rt.rpc('get_report_campaign_performance',who,'2026-12-01','2026-12-31','A2');
   PERFORM rt.eq('V3 authorized manager '||who,jsonb_array_length(j->'campaigns'),4);
   PERFORM rt.eq('V3 manager sees both policy records',
     (SELECT (x->>'attributed_policies')::int FROM jsonb_array_elements(j->'campaigns')x
        WHERE x->>'campaign_id'=rt.id('V_PRIVATE')::text),2);
 END LOOP;
 -- Reports All does not grant another Agent's private campaign.
 UPDATE public.role_permissions SET permissions=rt.perm(true,true,true,'all',true,true,true,'team')
 WHERE organization_id=rt.id('O1') AND role='Agent';
 j:=rt.rpc('get_report_campaign_performance','A2','2026-12-01','2026-12-31');
 PERFORM rt.eq('V4 Reports All cannot expand campaign access',position(rt.id('V_PRIVATE')::text IN j::text),0);
 PERFORM rt.eq('V4 organization call population retained',
   (SELECT coalesce(sum((x->>'calls_made')::int),0)::int FROM jsonb_array_elements(j->'campaigns')x)
    +(j->>'calls_attribution_unavailable')::int,6);
 PERFORM rt.eq('V4 foreign tenant id absent',position(rt.id('CB')::text IN j::text),0);
 -- Malformed membership fails closed rather than erroring or broadening.
 UPDATE public.campaigns SET assigned_agent_ids='"broken"' WHERE id=rt.id('V_TEAM');
 j:=rt.rpc('get_report_campaign_performance','A2','2026-12-01','2026-12-31');
 PERFORM rt.eq('V5 malformed membership withheld',position(rt.id('V_TEAM')::text IN j::text),0);
 -- Unknown type is private by default; Open Pool remains visible without membership.
 UPDATE public.campaigns SET type='Unknown' WHERE id=rt.id('V_OPEN');
 j:=rt.rpc('get_report_campaign_performance','A2','2026-12-01','2026-12-31');
 PERFORM rt.eq('V5 unknown type withheld',jsonb_array_length(j->'campaigns'),0);
 PERFORM rt.eq('V5 all calls still accounted for',(j->>'calls_attribution_unavailable')::int,6);
END
$v$;
ROLLBACK;
\echo 'CAMPAIGN VISIBILITY PROOFS PASSED (V1-V5)'
