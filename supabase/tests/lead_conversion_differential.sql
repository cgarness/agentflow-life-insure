-- Lead → Client conversion differential (20261021200000): the SAME conversions run on a database WITHOUT and WITH the
-- migration must produce byte-identical sales, policy identities, receipts, commission captures/estimates/installments,
-- moved history, refusals and results. Excluded, because they are the intended changes the preservation suite asserts:
-- the new columns, clients.state (now populated from the lead; P2) and clients.notes (an older browser's distinct notes
-- text no longer replaces the lead notes; P4). Payloads are older-browser shaped (`notes`), the only shape the database
-- without the migration understands. Disposable database only, synthetic data only. Prints one canonical JSON
-- document; scripts/run_lead_conversion_preservation_tests.sh diffs the two outputs.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
\o /dev/null

CREATE TABLE lcd_out(key text PRIMARY KEY, data jsonb);
GRANT ALL ON lcd_out TO authenticated;
-- Stable names for values that are random per database (row ids); test ids are already stable.
CREATE FUNCTION lcd_map(u uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE t text;
BEGIN
  IF u::text LIKE '00000000-0000-0000-0000-%' THEN RETURN u::text; END IF;
  SELECT 'client:' || coalesce(lead_id::text, first_name) INTO t FROM public.clients WHERE id = u; IF FOUND THEN RETURN t; END IF;
  SELECT 'primary-policy:' || coalesce(lead_id::text, first_name) INTO t FROM public.clients WHERE primary_policy_id = u; IF FOUND THEN RETURN t; END IF;
  SELECT 'win:' || idempotency_key INTO t FROM public.wins WHERE id = u; IF FOUND THEN RETURN t; END IF;
  SELECT 'handoff:' || request_id INTO t FROM public.policy_commission_handoffs WHERE id = u; IF FOUND THEN RETURN t; END IF;
  SELECT 'capture:' || lcd_map(policy_id) || ':' || slot INTO t FROM public.policy_commission_captures WHERE id = u; IF FOUND THEN RETURN t; END IF;
  SELECT 'estimate:' || lcd_map(policy_id) || ':' || status INTO t FROM public.policy_commission_estimates WHERE id = u; IF FOUND THEN RETURN t; END IF;
  SELECT 'installment:' || lcd_map(policy_id) || ':' || sequence INTO t FROM public.policy_commission_installments WHERE id = u; IF FOUND THEN RETURN t; END IF;
  RETURN 'unmapped';
END $$;
-- Canonical JSON: random ids mapped, every *_at timestamp key dropped (event times differ between runs).
CREATE FUNCTION lcd_canon(j jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE r jsonb := '{}'; k text; v jsonb;
BEGIN
  CASE jsonb_typeof(j)
    WHEN 'object' THEN
      FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
        CONTINUE WHEN k ~ '_at$';
        r := r || jsonb_build_object(k, lcd_canon(v));
      END LOOP;
      RETURN r;
    WHEN 'array' THEN
      RETURN coalesce((SELECT jsonb_agg(lcd_canon(e) ORDER BY o) FROM jsonb_array_elements(j) WITH ORDINALITY x(e, o)), '[]');
    WHEN 'string' THEN
      IF (j #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN to_jsonb(lcd_map((j #>> '{}')::uuid));
      END IF;
      RETURN j;
    ELSE RETURN j;
  END CASE;
END $$;
CREATE FUNCTION lcd_lead(p_n integer, p_fields jsonb DEFAULT '{}', p_owner integer DEFAULT 11) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.leads SELECT * FROM jsonb_populate_record(NULL::public.leads, jsonb_build_object(
    'id', public.test_id(p_n), 'organization_id', public.test_id(1), 'user_id', public.test_id(p_owner),
    'assigned_agent_id', public.test_id(p_owner), 'first_name', 'Diff' || p_n, 'last_name', 'Synthetic',
    'phone', '555020' || lpad(p_n::text, 4, '0'), 'email', 'diff' || p_n || '@example.test', 'state', 'CA',
    'status', 'Interested', 'lead_source', 'Referral', 'lead_score', 7, 'created_at', '2026-09-01T12:00:00Z',
    'updated_at', '2026-09-02T12:00:00Z') || p_fields)
  RETURNING id
$$;
-- A fresh browser (mergeCustomFieldsOnConversion): the lead's custom fields plus the agent's additional policies,
-- or null when that bag is empty.
CREATE FUNCTION lcd_payload(p_n integer, p_notes text, p_custom jsonb, p_policies jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT public.pc_client('Diff' || p_n, 11, '50.00') || jsonb_build_object('notes', p_notes, 'custom_fields',
    nullif(coalesce(p_custom, '{}'::jsonb) || CASE WHEN p_policies IS NULL THEN '{}'::jsonb
                                                    ELSE jsonb_build_object('additional_policies', p_policies) END, '{}'::jsonb))
$$;
CREATE FUNCTION lcd_policy(p_id integer, p_type text, p_premium text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('policyId', public.test_id(p_id), 'policyType', p_type, 'carrier', 'Synthetic Life',
    'policyNumber', 'DADD-' || p_id, 'premiumAmount', p_premium, 'faceAmount', '25000', 'soldDate', '2026-10-01',
    'effectiveDate', '2026-11-01')
$$;
CREATE FUNCTION lcd_convert(p_req integer, p_lead integer, p_payload jsonb, p_campaign uuid DEFAULT NULL,
  p_commission jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.convert_lead_to_client_with_sales_handoff(public.test_id(p_req), public.test_id(p_lead), public.test_id(1),
    p_payload, p_campaign, coalesce(p_commission, public.pc_payload()))
$$;
GRANT EXECUTE ON FUNCTION lcd_payload(integer, text, jsonb, jsonb), lcd_policy(integer, text, text),
  lcd_convert(integer, integer, jsonb, uuid, jsonb) TO authenticated;

INSERT INTO campaigns(id, name, type, organization_id, user_id) VALUES
  (test_id(8600), 'Diff Team', 'Team', test_id(1), test_id(11)),
  (test_id(8601), 'Diff Personal', 'Personal', test_id(1), test_id(11)),
  (test_id(8602), 'Diff Open', 'Open Pool', test_id(1), test_id(13));
SELECT lcd_lead(8001, '{"custom_fields": {"Gender": "F"}, "notes": "Lead note 1"}');
SELECT lcd_lead(8002, '{"custom_fields": {"Tobacco": "No", "Height": 70}, "notes": "Lead note 2"}');
SELECT lcd_lead(8003, '{"notes": "Lead note 3"}');
SELECT lcd_lead(8004, '{"custom_fields": {"Beneficiary Count": 2}}');
SELECT lcd_lead(8005, '{}', 12);
SELECT lcd_lead(8006);
UPDATE leads SET user_id = NULL, assigned_agent_id = NULL WHERE id = test_id(8006);
SELECT lcd_lead(8007, '{"notes": "Lead note 7"}');
SELECT lcd_lead(8008, '{"custom_fields": {"Hobby": "chess"}}');
INSERT INTO campaign_leads(id, campaign_id, lead_id, organization_id, status) VALUES
  (test_id(8610), test_id(8600), test_id(8002), test_id(1), 'Called'),
  (test_id(8611), test_id(8601), test_id(8003), test_id(1), 'Queued'),
  (test_id(8612), test_id(8602), test_id(8004), test_id(1), 'Queued');
INSERT INTO calls(id, organization_id, contact_id, contact_type, agent_id, campaign_id, campaign_lead_id, direction, duration, disposition_name, status) VALUES
  (test_id(8701), test_id(1), test_id(8002), 'lead', test_id(11), test_id(8600), test_id(8610), 'outbound', 88, 'Sold', 'completed'),
  (test_id(8702), test_id(1), test_id(8002), NULL, test_id(11), test_id(8600), test_id(8610), 'outbound', 0, 'No Answer', 'no-answer');
INSERT INTO messages(id, organization_id, contact_id, contact_type, direction, body, from_number, to_number, status) VALUES
  (test_id(8711), test_id(1), test_id(8002), 'lead', 'outbound', 'Diff hello', '+15550000001', '+15550208002', 'sent');
INSERT INTO contact_notes(id, organization_id, contact_id, contact_type, content) VALUES (test_id(8721), test_id(1), test_id(8002), 'lead', 'Diff timeline note');
INSERT INTO appointments(id, organization_id, title, start_time, contact_id) VALUES (test_id(8731), test_id(1), 'Diff review', '2026-11-01T17:00:00Z', test_id(8002));

SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcd_out VALUES ('8001', lcd_convert(8101, 8001, lcd_payload(8001, NULL, '{"Gender": "F"}')));
INSERT INTO lcd_out VALUES ('8002', lcd_convert(8102, 8002, lcd_payload(8002, 'Agent conversion note', '{"Tobacco": "No", "Height": 70}',
  jsonb_build_array(lcd_policy(8801, 'Final Expense', '30.00'), lcd_policy(8802, 'Whole Life', '12.34'))), test_id(8600),
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975),
             pc_slot(test_id(8801)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
INSERT INTO lcd_out VALUES ('8002_replay', lcd_convert(8102, 8002, lcd_payload(8002, 'Agent conversion note', '{"Tobacco": "No", "Height": 70}',
  jsonb_build_array(lcd_policy(8801, 'Final Expense', '30.00'), lcd_policy(8802, 'Whole Life', '12.34'))), test_id(8600),
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975),
             pc_slot(test_id(8801)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
INSERT INTO lcd_out VALUES ('8002_conflict', to_jsonb(pc_reject($q$SELECT lcd_convert(8103, 8002, lcd_payload(8002, 'Changed', NULL))$q$, 'PT409')));
INSERT INTO lcd_out VALUES ('8005_refused', to_jsonb(pc_reject($q$SELECT lcd_convert(8105, 8005, lcd_payload(8005, NULL, NULL))$q$, '42501')));
INSERT INTO lcd_out VALUES ('8007_invalid', to_jsonb(pc_reject($q$SELECT lcd_convert(8107, 8007, lcd_payload(8007, NULL, NULL) || '{"payment_frequency": "weekly"}')$q$, '22023')));
INSERT INTO lcd_out VALUES ('8007', lcd_convert(8108, 8007, lcd_payload(8007, NULL, NULL) || '{"payment_frequency": "Semi-Annual", "draft_date": "2026-11-15"}'));
INSERT INTO lcd_out VALUES ('8008', lcd_convert(8109, 8008, lcd_payload(8008, 'Note 8', '{"Hobby": "chess"}', jsonb_build_array(lcd_policy(8803, 'Term', '22.00')))));
RESET ROLE;
SELECT pc_login(13);
SET ROLE authenticated;
INSERT INTO lcd_out VALUES ('8003', lcd_convert(8110, 8003, lcd_payload(8003, NULL, NULL), test_id(8601)));
RESET ROLE;
SELECT pc_login(14);
SET ROLE authenticated;
INSERT INTO lcd_out VALUES ('8004', lcd_convert(8111, 8004, lcd_payload(8004, 'TL note', '{"Beneficiary Count": 2}'), test_id(8602)));
RESET ROLE;
SELECT pc_login(12);
SET ROLE authenticated;
INSERT INTO lcd_out VALUES ('8006', lcd_convert(8112, 8006, lcd_payload(8006, NULL, NULL)));
RESET ROLE;

\o
\pset tuples_only on
\pset format unaligned
WITH scenario_clients AS (
  SELECT c.* FROM public.clients c WHERE c.lead_id::text LIKE '00000000-0000-0000-0000-0000000080%'
), policies AS (
  SELECT p.* FROM private.policy_identities p JOIN scenario_clients c ON c.id = p.client_id
)
SELECT jsonb_pretty(lcd_canon(jsonb_build_object(
  'results', (SELECT jsonb_object_agg(key, data) FROM lcd_out),
  'leads_remaining', (SELECT jsonb_agg(id ORDER BY id) FROM public.leads WHERE id::text LIKE '00000000-0000-0000-0000-0000000080%'),
  'clients', (SELECT jsonb_agg(to_jsonb(c) - ARRAY['state', 'notes', 'date_of_birth', 'age', 'best_time_to_call', 'spouse_info', 'lead_conversion']
                               ORDER BY c.lead_id) FROM scenario_clients c),
  'wins', (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.idempotency_key) FROM public.wins w JOIN scenario_clients c ON c.id = w.contact_id),
  'policy_identities', (SELECT jsonb_agg(to_jsonb(p) ORDER BY lcd_map(p.policy_id)) FROM policies p),
  'receipts', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.operation_key) FROM private.policy_sale_receipts r JOIN scenario_clients c ON c.id = r.client_id),
  'handoffs', (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.request_id) FROM public.policy_commission_handoffs h
               WHERE h.request_id::text LIKE '00000000-0000-0000-0000-0000000081%'),
  'captures', (SELECT jsonb_agg(to_jsonb(x) ORDER BY lcd_map(x.policy_id), x.slot) FROM public.policy_commission_captures x JOIN policies p USING (policy_id)),
  'estimates', (SELECT jsonb_agg(to_jsonb(x) ORDER BY lcd_map(x.policy_id)) FROM public.policy_commission_estimates x JOIN policies p USING (policy_id)),
  'installments', (SELECT jsonb_agg(to_jsonb(x) ORDER BY lcd_map(x.policy_id), x.sequence) FROM public.policy_commission_installments x JOIN policies p USING (policy_id)),
  'calls', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.calls x WHERE x.id::text LIKE '00000000-0000-0000-0000-0000000087%'),
  'messages', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.messages x WHERE x.id::text LIKE '00000000-0000-0000-0000-0000000087%'),
  'contact_notes', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.contact_notes x WHERE x.id::text LIKE '00000000-0000-0000-0000-0000000087%'),
  'appointments', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.appointments x WHERE x.id::text LIKE '00000000-0000-0000-0000-0000000087%'),
  'campaign_leads', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.campaign_leads x WHERE x.id::text LIKE '00000000-0000-0000-0000-0000000086%'),
  'history_events', (SELECT jsonb_agg(jsonb_build_object('source', e.source_table, 'action', e.action, 'type', e.contact_type,
                       'contact', e.contact_id, 'fields', e.changed_fields, 'after', e.after_values) ORDER BY e.source_table, e.action, lcd_map(e.contact_id), e.source_id)
                     FROM public.contact_history_events e
                     WHERE lcd_map(e.contact_id) LIKE 'client:00000000-0000-0000-0000-0000000080%' OR e.contact_id::text LIKE '00000000-0000-0000-0000-0000000080%'),
  'capture_health', (SELECT count(*) FROM public.contact_history_capture_health)
)));
