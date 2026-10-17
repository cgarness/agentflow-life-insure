-- Synthetic Sold Date fixtures, plus the bug reproduced on the shipped Oct 5 readers (runs BEFORE the fix).
-- Teo-shaped evidence: six policies entered Oct 16 PDT, sold Oct 15 x3, Oct 14 x2 and Oct 8 x1. One client
-- holds three policies (primary + two additional). Rows are inserted as the fixture owner through the guarded
-- policy-identity path, so every win keeps a real stored policy identity.
INSERT INTO public.profiles(id,organization_id,first_name,last_name,role,status,hierarchy_path,is_super_admin) VALUES
(test_id(31),test_id(1),'Synthetic','Seller','Agent','Active','root.seller',false),
(test_id(32),test_id(1),'Relative','Seller','Agent','Active','root.relative',false),
(test_id(33),test_id(1),'Owner','After','Agent','Active','peer.owner',false),
(test_id(16),test_id(1),'Platform','Super','Super Admin','Active','super',true);

-- One primary policy and its win. p_sold may be NULL (an undated legacy sale).
CREATE FUNCTION public.test_sold_policy(p_client uuid,p_agent uuid,p_sold date,p_entered timestamptz,p_premium numeric,
 p_campaign uuid DEFAULT NULL,p_org uuid DEFAULT public.test_id(1)) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c public.clients%ROWTYPE; v_win uuid;
BEGIN
 INSERT INTO public.clients(id,organization_id,assigned_agent_id,first_name,last_name,policy_type,carrier,premium,sold_date)
 VALUES(p_client,p_org,p_agent,'Synthetic','Sold Date','Term','Synthetic Carrier',p_premium,p_sold) RETURNING * INTO c;
 INSERT INTO public.wins(organization_id,policy_id,agent_id,agent_name,contact_id,contact_name,campaign_id,policy_type,
  premium_amount,premium_snapshot,sold_date,idempotency_key,created_at,recorded_at,celebrated)
 VALUES(c.organization_id,c.primary_policy_id,p_agent,'Synthetic Seller',c.id,'Synthetic Sold Date',p_campaign,'Term',
  p_premium,true,p_sold,'fixture:sold-date:'||p_client,p_entered,p_entered,false) RETURNING id INTO v_win;
 RETURN v_win;
END $$;

INSERT INTO public.clients(id,organization_id,assigned_agent_id,first_name,last_name,policy_type,carrier,premium,sold_date,custom_fields)
VALUES(test_id(31001),test_id(1),test_id(31),'Synthetic','Multi Policy','Final Expense','Synthetic Carrier',58.45,'2026-10-15',
 jsonb_build_object('additional_policies',jsonb_build_array(
  jsonb_build_object('policyType','Term','carrier','Synthetic Carrier','premiumAmount',41.64,'soldDate','2026-10-15'),
  jsonb_build_object('policyType','Whole Life','carrier','Synthetic Carrier','premiumAmount',30,'soldDate','2026-10-14'))));
INSERT INTO public.wins(organization_id,policy_id,agent_id,agent_name,contact_id,contact_name,policy_type,premium_amount,
 premium_snapshot,sold_date,idempotency_key,created_at,recorded_at,celebrated)
SELECT c.organization_id,x.policy,c.assigned_agent_id,'Synthetic Seller',c.id,'Synthetic Multi Policy',x.policy_type,x.premium,
 true,x.sold,'fixture:sold-date:multi:'||x.ord,x.entered,x.entered,false
FROM public.clients c CROSS JOIN LATERAL (VALUES
 (0,c.primary_policy_id,'Final Expense',58.45::numeric,DATE '2026-10-15',TIMESTAMPTZ '2026-10-16T19:48:00Z'),
 (1,(c.custom_fields->'additional_policies'->0->>'policyId')::uuid,'Term',41.64,DATE '2026-10-15',TIMESTAMPTZ '2026-10-16T19:51:00Z'),
 (2,(c.custom_fields->'additional_policies'->1->>'policyId')::uuid,'Whole Life',30.00,DATE '2026-10-14',TIMESTAMPTZ '2026-10-16T19:53:00Z')
) x(ord,policy,policy_type,premium,sold,entered) WHERE c.id=test_id(31001);
SELECT test_sold_policy(test_id(31002),test_id(31),'2026-10-15','2026-10-16T19:50:00Z',50);
SELECT test_sold_policy(test_id(31003),test_id(31),'2026-10-14','2026-10-16T19:56:00Z',25);
SELECT test_sold_policy(test_id(31004),test_id(31),'2026-10-08','2026-10-16T20:03:00Z',100);

SELECT test_assert((SELECT count(*)=6 AND count(DISTINCT policy_id)=6 FROM wins WHERE agent_id=test_id(31)),'six policy identities, six sale events');
-- The shipped reader buckets by entry time: all six land on Oct 16 and none on their real Sold Dates.
SELECT test_assert((SELECT policies_sold=6 FROM private.performance_rows(ARRAY[test_id(1)],'2026-10-16T07:00:00Z','2026-10-16T20:30:00Z',ARRAY[test_id(31)])),
 'pre-fix reader counts six late entries on their entry day');
SELECT test_assert((SELECT policies_sold=0 FROM private.performance_rows(ARRAY[test_id(1)],'2026-10-15T07:00:00Z','2026-10-16T07:00:00Z',ARRAY[test_id(31)])),
 'pre-fix reader shows none on the real Oct 15 Sold Date');
