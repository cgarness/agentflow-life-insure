-- Synthetic localhost data only. Run after the existing harness, released migrations and alias migration.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- Only the carrier labels are real: all products, rates, people and amounts are existing synthetic fixtures.
UPDATE public.comp_products SET carrier = 'Fidelity Life' WHERE id IN (test_id(501), test_id(502));
SELECT pc_login(11);
DO $cases$
DECLARE
  presented jsonb := pc_slot('primary', 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400);
  policy jsonb := jsonb_build_object('agent_id', test_id(11), 'policy_type', 'Final Expense', 'carrier', 'Fidelity',
                                    'premium_snapshot', true, 'premium_amount', 30);
  grid jsonb;
  item jsonb;
  pc text;
  gc text;
  result jsonb;
BEGIN
  grid := private.policy_commission_grid_facts(test_id(11), jsonb_build_array(jsonb_build_object(
    'key', 'primary', 'product_id', test_id(502), 'age', 62, 'term', NULL)));
  item := grid->'items'->0;
  FOREACH pc IN ARRAY ARRAY['Instabrain','Fidelity','Fidelity Life'] LOOP
    FOREACH gc IN ARRAY ARRAY['Instabrain','Fidelity','Fidelity Life'] LOOP
      result := private.policy_commission_evaluate(presented,
        policy || jsonb_build_object('carrier', E' \t' || upper(pc) || E'\n '), grid,
        jsonb_set(item, '{product,carrier}', to_jsonb(E' \t' || upper(gc) || E'\n ')), 'recorded_later');
      PERFORM test_assert(result->>'ok' = 'true' AND result->>'first_year_cents' = '43200'
                          AND result->>'advance_cents' = '32400', 'all aliases normalize on both sides');
    END LOOP;
  END LOOP;
  FOREACH pc IN ARRAY ARRAY['Fidelity & Guaranty','Fidelity & Guaranty Life','Fidelity Life Extra','My Fidelity',
                            'Fidelity  Life','Fidelity-Life','Fidelit','Instabrain Life','','   ','__proto__','constructor'] LOOP
    PERFORM test_assert(private.policy_commission_evaluate(presented, policy || jsonb_build_object('carrier',pc),
      grid, item, 'recorded_later')->>'code' = 'policy_mismatch', 'unrelated policy carrier rejected');
    PERFORM test_assert(private.policy_commission_evaluate(presented, policy, grid,
      jsonb_set(item, '{product,carrier}', to_jsonb(pc)), 'recorded_later')->>'code' = 'policy_mismatch',
      'unrelated grid carrier rejected');
  END LOOP;
  PERFORM test_assert(private.policy_commission_evaluate(presented,
    policy || '{"carrier":"  FIDELITY & GUARANTY "}', grid,
    jsonb_set(item,'{product,carrier}','"Fidelity & Guaranty"'), 'recorded_later')->>'ok' = 'true',
    'unrelated carrier still matches itself');
  FOREACH pc IN ARRAY ARRAY['Term','IUL','Unknown',''] LOOP
    PERFORM test_assert(private.policy_commission_evaluate(presented, policy || jsonb_build_object('policy_type',pc),
      grid,item,'recorded_later')->>'code' = 'policy_mismatch','category restrictions unchanged');
  END LOOP;
  PERFORM test_assert(private.policy_commission_evaluate(presented,policy || '{"policy_type":"Whole Life"}',grid,item,
    'recorded_later')->>'ok' = 'true','Whole Life remains accepted');
  FOR result, pc IN SELECT * FROM (VALUES
    (presented || jsonb_build_object('credited_agent_id',test_id(12)), 'agent_changed'),
    (presented || '{"grid_revision":-1}', 'grid_changed'),
    (presented || jsonb_build_object('variant_id',test_id(511)), 'variant_changed'),
    (presented || '{"contract_level":90}', 'level_changed'),
    (presented || '{"rate_percent":"119"}', 'rate_changed'),
    (presented || '{"monthly_premium":"31"}', 'premium_mismatch'),
    (presented || '{"first_year_cents":43201}', 'amount_changed')) t(inputs,code) LOOP
    PERFORM test_assert(private.policy_commission_evaluate(result,policy,grid,item,'recorded_later')->>'code' = pc,
      'unrelated validation preserved: ' || pc);
  END LOOP;
  PERFORM test_assert(private.policy_commission_evaluate(presented,policy,grid,
    jsonb_set(item,'{product,active}','false'),'recorded_later')->>'code' = 'product_unavailable','inactive refused');
  PERFORM test_assert(private.policy_commission_evaluate(presented,policy,grid,
    jsonb_set(item,'{match,kind}','"unavailable"'),'recorded_later')->>'code' = 'not_available','eligibility refused');
END $cases$;
SELECT 'PASS Fidelity alias matrix, category and unrelated validation parity';

CREATE TABLE pc_alias_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON pc_alias_results TO authenticated;
CREATE FUNCTION pc_alias_client(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM clients WHERE first_name=p_name $$;
CREATE FUNCTION pc_alias_slot() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT pc_slot('primary',11,502,512,62,NULL,100,'120.00','30.00',43200,32400) $$;
GRANT EXECUTE ON FUNCTION pc_alias_client(text), pc_alias_slot() TO authenticated;

INSERT INTO pc_alias_results VALUES ('slot', pc_alias_slot()-'slot');

-- Historical alias: save an existing policy without a commission selection, then use the existing writer later.
SELECT pc_login(11); SET ROLE authenticated;
INSERT INTO pc_alias_results VALUES ('historical', create_client_with_sale_handoff(test_id(9601),test_id(1),
  pc_client('AliasHistorical',11,'30.00','Final Expense','Instabrain'),true,pc_payload()));
RESET ROLE;
CREATE TABLE pc_alias_before AS SELECT
  (SELECT to_jsonb(c) FROM clients c WHERE id=pc_alias_client('AliasHistorical')) AS client,
  (SELECT to_jsonb(w) FROM wins w WHERE contact_id=pc_alias_client('AliasHistorical')) AS sale;
SELECT test_assert((SELECT count(*) FROM policy_commission_captures)=0 AND (SELECT count(*) FROM policy_commission_estimates)=0,
  'no fabricated sale-time capture');
SELECT pc_login(11); SET ROLE authenticated;
INSERT INTO pc_alias_results VALUES ('later',record_policy_commission_estimate_later(test_id(9602),
  (SELECT policy_id FROM wins WHERE contact_id=pc_alias_client('AliasHistorical')),pc_alias_slot()-'slot'));
INSERT INTO pc_alias_results VALUES ('later_retry',record_policy_commission_estimate_later(test_id(9602),
  (SELECT policy_id FROM wins WHERE contact_id=pc_alias_client('AliasHistorical')),pc_alias_slot()-'slot'));
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L,%L,%L)',test_id(9602),
  (SELECT policy_id FROM wins WHERE contact_id=pc_alias_client('AliasHistorical')),
  (pc_alias_slot()-'slot') || '{"insured_age":63}'),'22023');
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L,%L,%L)',test_id(9603),
  (SELECT policy_id FROM wins WHERE contact_id=pc_alias_client('AliasHistorical')),pc_alias_slot()-'slot'),'22023');
RESET ROLE;
SELECT test_assert((SELECT data FROM pc_alias_results WHERE key='later')=(SELECT data FROM pc_alias_results WHERE key='later_retry')
  AND (SELECT data->>'status' FROM pc_alias_results WHERE key='later')='recorded', 'stable record-later replay');
SELECT test_assert((SELECT count(*) FROM wins)=1 AND (SELECT count(*) FROM policy_commission_captures)=0
  AND (SELECT count(*) FROM policy_commission_estimates)=1 AND (SELECT count(*) FROM policy_commission_installments)=4
  AND (SELECT count(*) FROM policy_commission_events WHERE event_type='estimate_recorded')=1,'no duplicate financial or sale rows');
SELECT test_assert((SELECT capture_mode='recorded_later' AND capture_id IS NULL AND credited_agent_id=test_id(11)
  AND monthly_premium=30 AND premium_source='sale_snapshot' AND product_id=test_id(502)
  AND first_year_cents=43200 AND advance_cents=32400 FROM policy_commission_estimates),'record-later correct seller and calculation');
SELECT test_assert((SELECT client=(SELECT to_jsonb(c) FROM clients c WHERE id=pc_alias_client('AliasHistorical'))
  AND sale=(SELECT to_jsonb(w) FROM wins w WHERE contact_id=pc_alias_client('AliasHistorical')) FROM pc_alias_before),
  'historical carrier and sale bytes unchanged');
SELECT pc_login(12); SET ROLE authenticated;
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L,%L,%L)',test_id(9604),
  (SELECT policy_id FROM wins WHERE contact_id=pc_alias_client('AliasHistorical')),pc_alias_slot()-'slot'),'PT404');
RESET ROLE;
SELECT pc_login(21); SET ROLE authenticated;
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L,%L,%L)',test_id(9604),
  (SELECT (sale->>'policy_id')::uuid FROM pc_alias_before),(SELECT data FROM pc_alias_results WHERE key='slot')),'PT404');
RESET ROLE;
SELECT 'PASS Fidelity existing-policy record-later, permissions and retry idempotency';

-- Four canonical sale companions: explicit product selection, exact retry and unchanged calculations.
INSERT INTO leads(id,organization_id,user_id,assigned_agent_id,first_name,last_name)
VALUES(test_id(9700),test_id(1),test_id(11),test_id(11),'AliasLead','Synthetic');
SELECT pc_login(11); SET ROLE authenticated;
INSERT INTO pc_alias_results VALUES ('create',create_client_with_sale_handoff(test_id(9701),test_id(1),
  pc_client('AliasCreate',11,'30.00','Whole Life','Fidelity'),true,pc_payload(pc_alias_slot())));
INSERT INTO pc_alias_results VALUES ('create_retry',create_client_with_sale_handoff(test_id(9701),test_id(1),
  pc_client('AliasCreate',11,'30.00','Whole Life','Fidelity'),true,pc_payload(pc_alias_slot())));
INSERT INTO pc_alias_results VALUES ('convert',convert_lead_to_client_with_sales_handoff(test_id(9702),test_id(9700),test_id(1),
  pc_client('AliasConvert',11,'30.00','Final Expense','Instabrain'),NULL,pc_payload(pc_alias_slot())));
INSERT INTO pc_alias_results VALUES ('convert_retry',convert_lead_to_client_with_sales_handoff(test_id(9702),test_id(9700),test_id(1),
  pc_client('AliasConvert',11,'30.00','Final Expense','Instabrain'),NULL,pc_payload(pc_alias_slot())));
INSERT INTO pc_alias_results VALUES ('record',record_client_policy_handoff(test_id(9703),pc_alias_client('AliasCreate'),
  '{"policy_type":"Final Expense","carrier":"FIDELITY LIFE","premium":"30.00","sold_date":"2026-10-02"}',false,pc_payload(pc_alias_slot())));
INSERT INTO pc_alias_results VALUES ('record_retry',record_client_policy_handoff(test_id(9703),pc_alias_client('AliasCreate'),
  '{"policy_type":"Final Expense","carrier":"FIDELITY LIFE","premium":"30.00","sold_date":"2026-10-02"}',false,pc_payload(pc_alias_slot())));
INSERT INTO pc_alias_results VALUES ('contact',create_client_with_sale_handoff(test_id(9704),test_id(1),pc_contact('AliasEdit',11),false,NULL));
INSERT INTO pc_alias_results VALUES ('edit',update_client_with_policy_sale_handoff(test_id(9705),pc_alias_client('AliasEdit'),
  '{"policy_type":"Final Expense","carrier":"Fidelity","premium":30,"sold_date":"2026-10-02"}',pc_payload(pc_alias_slot())));
INSERT INTO pc_alias_results VALUES ('edit_retry',update_client_with_policy_sale_handoff(test_id(9705),pc_alias_client('AliasEdit'),
  '{"policy_type":"Final Expense","carrier":"Fidelity","premium":30,"sold_date":"2026-10-02"}',pc_payload(pc_alias_slot())));
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM pc_alias_results a JOIN pc_alias_results b ON b.key=a.key||'_retry'
  WHERE a.key IN ('create','convert','record','edit') AND
    (a.data->'commission'->'slots'->0->>'status' IS DISTINCT FROM 'recorded' OR
     a.data->'commission' IS DISTINCT FROM b.data->'commission')), 'all companion retries keep original commission');
SELECT test_assert((SELECT count(*) FROM wins)=5 AND (SELECT count(*) FROM policy_commission_estimates)=5
  AND (SELECT count(*) FROM policy_commission_captures)=4 AND (SELECT count(*) FROM policy_commission_installments)=20
  AND (SELECT count(*) FROM policy_commission_events WHERE event_type='estimate_recorded')=5,
  'one sale and estimate per selected policy across all four companions');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM policy_commission_estimates WHERE monthly_premium<>30
  OR credited_agent_id<>test_id(11) OR product_id<>test_id(502) OR first_year_cents<>43200 OR advance_cents<>32400),
  'all selected alias products use the unchanged calculation');
SELECT 'PASS Fidelity new-sale companions and stable retries';
