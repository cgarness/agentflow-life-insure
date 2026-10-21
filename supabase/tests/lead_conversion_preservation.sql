-- Lead → Client conversion data preservation (20261021200000): disposable database only, synthetic data only.
-- Runs after scripts/policy_commission_fixture.py, the applied commission migrations, the contact-history migrations
-- and 20261021200000 (scripts/run_lead_conversion_preservation_tests.sh). Every conversion goes through the browser's
-- real entry point, convert_lead_to_client_with_sales_handoff, as the signed-in client role.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE lcp_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON lcp_results TO authenticated;
CREATE FUNCTION lcp_r(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT data FROM lcp_results WHERE key = p_key $$;
-- The client converted from synthetic lead n (read as postgres; RLS bypassed for assertions only).
CREATE FUNCTION lcp_c(p_lead integer) RETURNS public.clients LANGUAGE sql STABLE AS
  $$ SELECT * FROM public.clients WHERE lead_id = public.test_id(p_lead) $$;
-- A lead row with every NOT NULL column filled; p_fields overrides any column.
CREATE FUNCTION lcp_lead(p_n integer, p_fields jsonb DEFAULT '{}', p_owner integer DEFAULT 11) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.leads SELECT * FROM jsonb_populate_record(NULL::public.leads, jsonb_build_object(
    'id', public.test_id(p_n), 'organization_id', public.test_id(1), 'user_id', public.test_id(p_owner),
    'assigned_agent_id', public.test_id(p_owner), 'first_name', 'Lead' || p_n, 'last_name', 'Synthetic',
    'phone', '555010' || lpad(p_n::text, 4, '0'), 'email', 'lead' || p_n || '@example.test', 'state', '',
    'status', 'New', 'lead_source', '', 'lead_score', 5, 'created_at', '2026-09-01T12:00:00Z',
    'updated_at', '2026-09-02T12:00:00Z') || p_fields)
  RETURNING id
$$;
-- The browser's conversion payload: the agent's policy inputs plus whatever notes/custom fields that browser sends.
CREATE FUNCTION lcp_payload(p_n integer, p_notes text DEFAULT NULL, p_custom jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT public.pc_client('Payload' || p_n, 11, '50.00') || jsonb_build_object('notes', p_notes)
    || CASE WHEN p_custom IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('custom_fields', p_custom) END
$$;
CREATE FUNCTION lcp_convert(p_req integer, p_lead integer, p_payload jsonb, p_campaign uuid DEFAULT NULL,
  p_org integer DEFAULT 1, p_commission jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.convert_lead_to_client_with_sales_handoff(public.test_id(p_req), public.test_id(p_lead),
    public.test_id(p_org), p_payload, p_campaign, coalesce(p_commission, public.pc_payload()))
$$;
CREATE FUNCTION lcp_policy(p_id integer, p_type text, p_premium text, p_sold text DEFAULT '2026-10-01') RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('policyId', public.test_id(p_id), 'policyType', p_type, 'carrier', 'Synthetic Life',
    'policyNumber', 'ADD-' || p_id, 'premiumAmount', p_premium, 'faceAmount', '25000', 'soldDate', p_sold,
    'effectiveDate', '2026-11-01')
$$;
GRANT EXECUTE ON FUNCTION lcp_r(text), lcp_payload(integer, text, jsonb), lcp_convert(integer, integer, jsonb, uuid, integer, jsonb),
  lcp_policy(integer, text, text, text) TO authenticated;

-- ── P2: every standard lead field transfers exactly; an old browser's stale bag and notes copy change nothing ─────
SELECT lcp_lead(7001, jsonb_build_object('state', ' california ', 'status', 'Interested', 'lead_source', 'Facebook',
  'lead_score', 8, 'age', 64, 'date_of_birth', '1961-04-12', 'best_time_to_call', 'Morning',
  'spouse_info', jsonb_build_object('name', 'Pat', 'age', 60), 'notes', 'Lead notes A',
  'custom_fields', jsonb_build_object('Gender', 'Female', 'Tobacco', 'No'),
  'last_contacted_at', '2026-10-01T10:00:00Z', 'imported_by_user_id', test_id(13)));
SELECT pc_login(11);
SET ROLE authenticated;
-- The released browser sends the in-memory lead notes as a fallback and a stale custom-field copy.
INSERT INTO lcp_results VALUES ('p2', lcp_convert(7101, 7001,
  lcp_payload(7001, 'Lead notes A', jsonb_build_object('Gender', 'Male (stale)', 'Injected', 'x'))));
RESET ROLE;
SELECT test_assert((lcp_r('p2')->>'idempotent')::boolean IS FALSE AND (lcp_r('p2')->>'client_id')::uuid = (lcp_c(7001)).id, 'p2 converted');
SELECT test_assert((c).first_name = 'Lead7001' AND (c).last_name = 'Synthetic' AND (c).phone = '5550107001'
                   AND (c).email = 'lead7001@example.test' AND (c).assigned_agent_id = test_id(11), 'p2 identity and owner')
FROM (SELECT lcp_c(7001) c) x;
SELECT test_assert((c).state = 'CA' AND (c).date_of_birth = '1961-04-12' AND (c).age = 64 AND (c).best_time_to_call = 'Morning'
                   AND (c).spouse_info = '{"name": "Pat", "age": 60}'::jsonb, 'p2 state, DOB, age, best time and spouse transfer')
FROM (SELECT lcp_c(7001) c) x;
SELECT test_assert((c).notes = 'Lead notes A' AND (c).custom_fields = '{"Gender": "Female", "Tobacco": "No"}'::jsonb,
                   'p2 notes and custom fields come from the locked lead row, not the stale payload')
FROM (SELECT lcp_c(7001) c) x;
SELECT test_assert(h->>'version' = '1' AND h->>'lead_id' = test_id(7001)::text AND h->>'converted_by' = test_id(11)::text
                   AND h->>'lead_status' = 'Interested' AND h->>'lead_source' = 'Facebook' AND h->'lead_score' = '8'
                   AND (h->>'lead_created_at')::timestamptz = '2026-09-01T12:00:00Z'
                   AND h->>'lead_last_contacted_at' = '2026-10-01T10:00:00Z'
                   AND h->>'lead_owner_id' = test_id(11)::text AND h->>'lead_assigned_agent_id' = test_id(11)::text
                   AND h->>'lead_imported_by_user_id' = test_id(13)::text AND (h->>'converted_at')::timestamptz IS NOT NULL
                   AND NOT h ? 'lead_notes' AND NOT h ? 'preserved_custom_fields', 'p2 protected history')
FROM (SELECT (lcp_c(7001)).lead_conversion h) x;
SELECT test_assert(NOT EXISTS (SELECT 1 FROM leads WHERE id = test_id(7001)), 'p2 lead row removed as before');

-- ── P3: arbitrary custom fields survive unchanged; policies come only from the payload; multiple policies ────────
SELECT lcp_lead(7002, jsonb_build_object('custom_fields', jsonb_build_object('Gender', 'F', 'Number Field', 42,
  'Bool', false, 'Nested', jsonb_build_object('a', jsonb_build_array(1, jsonb_build_object('b', NULL))),
  ' Spaced  Key ', 'x', 'Empty', '', 'NullValue', NULL, 'Date/Time', '2026-01-02', 'Ünïcode', 'ok')));
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p3', lcp_convert(7102, 7002, lcp_payload(7002, NULL, jsonb_build_object(
    'Gender', 'M', 'Extra', 'injected', 'additional_policies', jsonb_build_array(lcp_policy(7801, 'Final Expense', '30.00'),
    lcp_policy(7802, 'Whole Life', '12.34')))), NULL, 1,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975),
             pc_slot(test_id(7801)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
RESET ROLE;
SELECT test_assert((c).custom_fields - 'additional_policies' = (SELECT jsonb_build_object('Gender', 'F', 'Number Field', 42,
  'Bool', false, 'Nested', jsonb_build_object('a', jsonb_build_array(1, jsonb_build_object('b', NULL))),
  ' Spaced  Key ', 'x', 'Empty', '', 'NullValue', NULL, 'Date/Time', '2026-01-02', 'Ünïcode', 'ok')),
  'p3 every lead custom field byte-for-structure; stale/injected payload keys ignored')
FROM (SELECT lcp_c(7002) c) x;
SELECT test_assert((c).custom_fields->'additional_policies' = jsonb_build_array(lcp_policy(7801, 'Final Expense', '30.00'),
  lcp_policy(7802, 'Whole Life', '12.34')), 'p3 additional_policies stored verbatim and in order')
FROM (SELECT lcp_c(7002) c) x;
SELECT test_assert((SELECT array_agg(w.idempotency_key || '|' || w.policy_type || '|' || coalesce(w.premium_amount::text, '-') || '|'
                      || (w.policy_id = CASE WHEN w.idempotency_key LIKE '%:policy:1' THEN test_id(7801)
                                             WHEN w.idempotency_key LIKE '%:policy:2' THEN test_id(7802)
                                             ELSE (lcp_c(7002)).primary_policy_id END)::text
                      || '|' || w.premium_snapshot::text || '|' || (w.agent_id = test_id(11))::text ORDER BY w.idempotency_key)
                    FROM wins w WHERE w.contact_id = (lcp_c(7002)).id)
  = ARRAY['conversion:' || test_id(7002) || '|Term|50.00|true|true|true',
          'conversion:' || test_id(7002) || ':policy:1|Final Expense|30.00|true|true|true',
          'conversion:' || test_id(7002) || ':policy:2|Whole Life|12.34|true|true|true'],
  'p3 three sales: correct identities, premium snapshots and seller');
SELECT test_assert((SELECT count(*) FROM private.policy_identities WHERE client_id = (lcp_c(7002)).id) = 3,
                   'p3 three stable policy identities');
SELECT test_assert((SELECT array_agg(s->>'status' ORDER BY s->>'slot' = 'primary' DESC) FROM jsonb_array_elements(lcp_r('p3')->'commission'->'slots') s)
                   = ARRAY['recorded', 'recorded'], 'p3 commission captures still bound per slot');

-- The lead's own value under the reserved key never enters the client policy namespace and is never dropped.
SELECT lcp_lead(7003, jsonb_build_object('custom_fields', jsonb_build_object('Hobby', 'golf', 'additional_policies', 'legacy text')));
-- A non-object lead bag is kept verbatim in history.
SELECT lcp_lead(7004, jsonb_build_object('custom_fields', jsonb_build_array('a', 'b')));
-- No bag and no policies stays NULL; an empty bag stays empty.
SELECT lcp_lead(7005);
SELECT lcp_lead(7006, jsonb_build_object('custom_fields', '{}'::jsonb));
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p3b', lcp_convert(7103, 7003, lcp_payload(7003, NULL, jsonb_build_object(
  'Hobby', 'golf', 'additional_policies', jsonb_build_array(lcp_policy(7803, 'Term', '20.00'))))));
INSERT INTO lcp_results VALUES ('p3c', lcp_convert(7104, 7004, lcp_payload(7004)));
INSERT INTO lcp_results VALUES ('p3d', lcp_convert(7105, 7005, lcp_payload(7005, NULL, jsonb_build_object('Stale', 'only'))));
INSERT INTO lcp_results VALUES ('p3e', lcp_convert(7106, 7006, lcp_payload(7006)));
RESET ROLE;
SELECT test_assert((lcp_c(7003)).custom_fields = jsonb_build_object('Hobby', 'golf', 'additional_policies',
                     jsonb_build_array(lcp_policy(7803, 'Term', '20.00')))
                   AND (lcp_c(7003)).lead_conversion->'preserved_custom_fields' = '{"additional_policies": "legacy text"}'
                   AND (SELECT count(*) FROM wins WHERE contact_id = (lcp_c(7003)).id) = 2,
                   'p3b reserved lead value set aside; payload policy recorded once');
SELECT test_assert((lcp_c(7004)).custom_fields IS NULL
                   AND (lcp_c(7004)).lead_conversion->'preserved_custom_fields' = '{"_value": ["a", "b"]}', 'p3c non-object bag kept in history');
SELECT test_assert((lcp_c(7005)).custom_fields IS NULL AND NOT (lcp_c(7005)).lead_conversion ? 'preserved_custom_fields',
                   'p3d no bag stays NULL; stale payload bag ignored');
SELECT test_assert((lcp_c(7006)).custom_fields = '{}'::jsonb, 'p3e empty bag preserved');

-- ── P4: notes are never silently overwritten (agent note, lead note, both, equal, blank, stale browser copy) ──────
SELECT lcp_lead(7010 + n, jsonb_build_object('notes', v)) FROM (VALUES
  (1, 'L'), (2, 'L'), (3, NULL), (4, 'L'), (5, '  L  '), (6, 'L'), (7, 'Current DB notes'), (8, NULL), (9, '')) t(n, v);
SELECT pc_login(11);
SET ROLE authenticated;
SELECT lcp_convert(7110 + n, 7010 + n, lcp_payload(7010 + n, v)) FROM (VALUES
  (1, NULL), (2, 'Conversion note'), (3, 'Conversion note'), (4, 'L'), (5, 'L'), (6, '   '), (7, 'Stale browser copy'),
  (8, NULL), (9, 'Conversion note')) t(n, v);
RESET ROLE;
SELECT test_assert(array_agg(coalesce((c).notes, '<null>') || '|' || coalesce((c).lead_conversion->>'lead_notes', '<none>') ORDER BY n)
  = ARRAY['L|<none>', 'Conversion note|L', 'Conversion note|<none>', 'L|<none>', '  L  |<none>', 'L|<none>',
          'Stale browser copy|Current DB notes', '<null>|<none>', 'Conversion note|<none>'],
  'p4 notes matrix: database notes win unless the agent wrote a different note, and displaced notes are kept verbatim')
FROM (SELECT n, lcp_c(7010 + n) c FROM generate_series(1, 9) n) x;

-- ── P5: history is protected and read-only for every role and path ───────────────────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
SELECT pc_reject(format($q$UPDATE public.clients SET lead_conversion = '{}' WHERE id = %L$q$, (SELECT id FROM public.clients WHERE lead_id = test_id(7001))), '23514');
SELECT pc_reject(format($q$UPDATE public.clients SET lead_conversion = NULL WHERE id = %L$q$, (SELECT id FROM public.clients WHERE lead_id = test_id(7001))), '23514');
SELECT test_assert(pc_reject($q$INSERT INTO public.clients(organization_id, first_name, last_name, assigned_agent_id, lead_conversion)
  VALUES (test_id(1), 'Forged', 'History', test_id(11), '{"lead_status": "Hot"}')$q$, '42501')
  = 'Conversion history is recorded only by lead conversion', 'p5 browser insert cannot forge history');
SELECT pc_reject(format($q$SELECT update_client_with_policy_sale(%L, '{"lead_conversion": {}}')$q$, (SELECT id FROM public.clients WHERE lead_id = test_id(7001))), '22023');
-- An ordinary edit of other columns leaves history untouched.
UPDATE public.clients SET notes = 'Edited by agent' WHERE lead_id = test_id(7001);
RESET ROLE;
GRANT SELECT, INSERT, UPDATE ON public.clients TO service_role;
SET ROLE service_role;
SELECT test_assert(pc_reject($q$INSERT INTO public.clients(organization_id, first_name, last_name, lead_id, lead_conversion)
  VALUES (test_id(1), 'Forged', 'Import', test_id(7998), jsonb_build_object('lead_id', test_id(7998)))$q$, '42501')
  = 'Conversion history is recorded only by lead conversion', 'p5 service role cannot forge history');
SELECT pc_reject($q$UPDATE public.clients SET lead_conversion = lead_conversion || '{"lead_status": "Hot"}' WHERE lead_id = test_id(7001)$q$, '23514');
RESET ROLE;
SELECT pc_reject($q$UPDATE public.clients SET lead_conversion = '{}' WHERE lead_id = test_id(7001)$q$, '23514');
SELECT test_assert(pc_reject($q$INSERT INTO public.clients(organization_id, first_name, last_name, lead_id, lead_conversion)
  VALUES (test_id(1), 'Mismatch', 'Lineage', test_id(7997), jsonb_build_object('lead_id', test_id(7996)))$q$, '42501')
  = 'Conversion history is recorded only by lead conversion', 'p5 history must name the client''s own lineage');
SELECT test_assert((lcp_c(7001)).notes = 'Edited by agent' AND (lcp_c(7001)).lead_conversion->>'lead_status' = 'Interested',
                   'p5 refused writes changed nothing; ordinary edits still work');

-- ── P6: nullable stays nullable; nothing is invented ──────────────────────────────────────────────────────────────
SELECT lcp_lead(7020, jsonb_build_object('state', '   ', 'last_contacted_at', ''));
SELECT lcp_lead(7021, jsonb_build_object('date_of_birth', '', 'best_time_to_call', ' '));
UPDATE leads SET spouse_info = 'null'::jsonb WHERE id = test_id(7021);  -- a stored JSON null, not SQL NULL
SELECT lcp_lead(7022, jsonb_build_object('spouse_info', to_jsonb('Jane, 58'::text), 'state', 'Atlantis', 'date_of_birth', '03/04/1960'));
SELECT pc_login(11);
SET ROLE authenticated;
SELECT lcp_convert(7120 + n, 7020 + n, lcp_payload(7020 + n)) FROM generate_series(0, 2) n;
RESET ROLE;
SELECT test_assert((c).state IS NULL AND (c).date_of_birth IS NULL AND (c).age IS NULL AND (c).best_time_to_call IS NULL
                   AND (c).spouse_info IS NULL AND (c).notes IS NULL AND (c).custom_fields IS NULL
                   AND (c).lead_conversion->'lead_source' = 'null' AND (c).lead_conversion->'lead_last_contacted_at' = 'null'
                   AND (c).lead_conversion->'lead_imported_by_user_id' = 'null' AND (c).lead_conversion->>'lead_status' = 'New',
                   'p6 blank lead values stay NULL / JSON null') FROM (SELECT lcp_c(7020) c) x;
SELECT test_assert((lcp_c(7021)).spouse_info IS NULL AND (lcp_c(7021)).date_of_birth IS NULL AND (lcp_c(7021)).best_time_to_call IS NULL,
                   'p6 JSON null spouse and blank text become NULL');
SELECT test_assert((lcp_c(7022)).spouse_info = '"Jane, 58"'::jsonb AND (lcp_c(7022)).state = 'Atlantis' AND (lcp_c(7022)).date_of_birth = '03/04/1960',
                   'p6 text spouse, unrecognized state and legacy DOB format kept verbatim');

-- ── P7: calls, SMS, emails, appointments, tasks, activities, notes and workflows move; telemetry unchanged ───────
SELECT lcp_lead(7030);
INSERT INTO campaigns(id, name, type, organization_id, user_id) VALUES (test_id(7600), 'Synthetic Team', 'Team', test_id(1), test_id(11));
INSERT INTO campaign_leads(id, campaign_id, lead_id, organization_id, status) VALUES (test_id(7610), test_id(7600), test_id(7030), test_id(1), 'Called');
INSERT INTO calls(id, organization_id, contact_id, contact_type, agent_id, campaign_id, campaign_lead_id, direction, duration,
  disposition_name, recording_url, twilio_call_sid, status) VALUES
  (test_id(7701), test_id(1), test_id(7030), 'lead', test_id(11), test_id(7600), test_id(7610), 'outbound', 73, 'Sold', 'rec-1', 'CA-syn-1', 'completed'),
  (test_id(7702), test_id(1), test_id(7030), NULL, test_id(11), test_id(7600), test_id(7610), 'outbound', 5, 'No Answer', NULL, 'CA-syn-2', 'no-answer');
INSERT INTO messages(id, organization_id, contact_id, contact_type, direction, body, from_number, to_number, status) VALUES
  (test_id(7711), test_id(1), test_id(7030), 'lead', 'outbound', 'Synthetic hello', '+15550000001', '+15550107030', 'sent');
INSERT INTO messages(id, organization_id, lead_id, direction, body, from_number, to_number, status) VALUES
  (test_id(7712), test_id(1), test_id(7030), 'inbound', 'Synthetic reply', '+15550107030', '+15550000001', 'received');
INSERT INTO contact_emails(id, organization_id, owner_user_id, provider, direction, external_message_id, from_email, contact_id)
  VALUES (test_id(7721), test_id(1), test_id(11), 'google', 'outbound', 'syn-msg-1', 'ava@example.test', test_id(7030));
INSERT INTO appointments(id, organization_id, title, start_time, contact_id) VALUES (test_id(7731), test_id(1), 'Synthetic review', '2026-11-01T17:00:00Z', test_id(7030));
INSERT INTO tasks(id, organization_id, contact_id, contact_type, assigned_to, created_by, title, task_type, due_date) VALUES
  (test_id(7741), test_id(1), test_id(7030), 'lead', test_id(11), test_id(11), 'Synthetic follow up', 'Follow Up', '2026-11-02T17:00:00Z');
INSERT INTO contact_activities(id, organization_id, contact_id, contact_type, activity_type, description) VALUES
  (test_id(7751), test_id(1), test_id(7030), 'lead', 'note', 'Synthetic activity');
INSERT INTO contact_notes(id, organization_id, contact_id, contact_type, content) VALUES (test_id(7761), test_id(1), test_id(7030), 'lead', 'Synthetic timeline note');
INSERT INTO workflow_executions(id, workflow_id, organization_id, contact_id, contact_type, status) VALUES
  (test_id(7771), test_id(7772), test_id(1), test_id(7030), 'lead', 'running');
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p7', lcp_convert(7130, 7030, lcp_payload(7030), test_id(7600)));
RESET ROLE;
SELECT test_assert(lcp_r('p7')->'transferred' = '{"calls": 2, "tasks": 1, "notes": 1, "messages": 2, "activities": 1, "appointments": 1,
  "contact_emails": 1, "workflow_executions": 1}'::jsonb AND lcp_r('p7')->'campaign_outcome' = '{"campaign_leads_preserved": 1}',
  'p7 every history row counted as moved');
SELECT test_assert((SELECT array_agg(contact_id = (lcp_c(7030)).id AND contact_type = 'client' ORDER BY id) FROM calls WHERE id IN (test_id(7701), test_id(7702))) = ARRAY[true, true]
  AND (SELECT array_agg(duration::text || disposition_name || coalesce(recording_url, '-') || campaign_lead_id::text || campaign_id::text ORDER BY id)
       FROM calls WHERE id IN (test_id(7701), test_id(7702)))
    = ARRAY['73Soldrec-1' || test_id(7610) || test_id(7600), '5No Answer-' || test_id(7610) || test_id(7600)],
  'p7 calls move with duration, disposition, recording and campaign telemetry intact');
SELECT test_assert((SELECT bool_and(contact_id = (lcp_c(7030)).id AND contact_type = 'client') FROM messages WHERE id IN (test_id(7711), test_id(7712)))
  AND (SELECT contact_id FROM contact_emails WHERE id = test_id(7721)) = (lcp_c(7030)).id
  AND (SELECT contact_id FROM appointments WHERE id = test_id(7731)) = (lcp_c(7030)).id
  AND (SELECT contact_id = (lcp_c(7030)).id AND contact_type = 'client' FROM tasks WHERE id = test_id(7741))
  AND (SELECT contact_id = (lcp_c(7030)).id AND contact_type = 'client' FROM contact_activities WHERE id = test_id(7751))
  AND (SELECT contact_id = (lcp_c(7030)).id AND contact_type = 'client' FROM contact_notes WHERE id = test_id(7761))
  AND (SELECT contact_id = (lcp_c(7030)).id AND contact_type = 'client' FROM workflow_executions WHERE id = test_id(7771)),
  'p7 SMS, email, appointment, task, activity, note and workflow history moved');
SELECT test_assert((SELECT lead_id IS NULL AND status = 'Called' AND campaign_id = test_id(7600) FROM campaign_leads WHERE id = test_id(7610))
  AND (SELECT campaign_id = test_id(7600) AND campaign_name = 'Synthetic Team' FROM wins WHERE idempotency_key = 'conversion:' || test_id(7030)),
  'p7 campaign membership preserved; the sale carries its campaign');
SELECT test_assert(EXISTS (SELECT 1 FROM contact_history_events WHERE source_table = 'clients' AND action = 'converted'
                             AND contact_id = (lcp_c(7030)).id AND contact_type = 'client')
                   AND NOT EXISTS (SELECT 1 FROM contact_history_events WHERE source_table = 'leads' AND action = 'deleted' AND contact_id = test_id(7030))
                   AND NOT EXISTS (SELECT 1 FROM contact_history_capture_health), 'p7 contact history records the conversion with no capture gap');

-- ── P9: a failure after the client insert rolls everything back ──────────────────────────────────────────────────
SELECT lcp_lead(7040, jsonb_build_object('notes', 'Keep me', 'state', 'TX'));
INSERT INTO calls(id, organization_id, contact_id, contact_type, direction, duration, status) VALUES
  (test_id(7781), test_id(1), test_id(7040), 'lead', 'outbound', 61, 'completed');
SELECT pc_login(11);
SET ROLE authenticated;
-- Second additional policy has an invalid sold date: the sale writer fails after the client row, the graph move and the lead delete.
SELECT pc_reject($q$SELECT lcp_convert(7140, 7040, lcp_payload(7040, 'Agent note', jsonb_build_object('additional_policies',
  jsonb_build_array(lcp_policy(7804, 'Term', '10.00'), lcp_policy(7805, 'Term', '11.00', 'not-a-date')))))$q$, '22023');
SELECT pc_reject($q$SELECT lcp_convert(7141, 7040, lcp_payload(7040) || '{"payment_frequency": "weekly"}')$q$, '22023');
RESET ROLE;
SELECT test_assert(EXISTS (SELECT 1 FROM leads WHERE id = test_id(7040) AND notes = 'Keep me' AND state = 'TX')
                   AND lcp_c(7040) IS NULL AND (SELECT contact_id FROM calls WHERE id = test_id(7781)) = test_id(7040)
                   AND NOT EXISTS (SELECT 1 FROM wins WHERE idempotency_key LIKE 'conversion:' || test_id(7040) || '%')
                   AND NOT EXISTS (SELECT 1 FROM private.policy_sale_receipts WHERE operation_key = 'conversion:' || test_id(7040))
                   AND NOT EXISTS (SELECT 1 FROM policy_commission_handoffs WHERE request_id IN (test_id(7140), test_id(7141))),
                   'p9 failed conversions leave the lead, its history and every sale table exactly as before');
-- The same lead then converts cleanly.
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p9_retry', lcp_convert(7142, 7040, lcp_payload(7040, 'Agent note')));
RESET ROLE;
SELECT test_assert((lcp_c(7040)).notes = 'Agent note' AND (lcp_c(7040)).lead_conversion->>'lead_notes' = 'Keep me'
                   AND (lcp_c(7040)).state = 'TX' AND (SELECT contact_id FROM calls WHERE id = test_id(7781)) = (lcp_c(7040)).id,
                   'p9 a later valid conversion preserves everything');

-- ── P10: duplicate submissions stay idempotent ───────────────────────────────────────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p10_replay', lcp_convert(7142, 7040, lcp_payload(7040, 'Agent note')));
SELECT pc_reject($q$SELECT lcp_convert(7143, 7040, lcp_payload(7040, 'A different note'))$q$, 'PT409');
INSERT INTO lcp_results VALUES ('p10_other_request', lcp_convert(7144, 7040, lcp_payload(7040, 'Agent note')));
RESET ROLE;
SELECT test_assert(lcp_r('p10_replay')->>'client_id' = lcp_r('p9_retry')->>'client_id'
                   AND lcp_r('p10_other_request')->>'client_id' = lcp_r('p9_retry')->>'client_id'
                   AND (SELECT count(*) FROM clients WHERE lead_id = test_id(7040)) = 1
                   AND (SELECT count(*) FROM wins WHERE idempotency_key LIKE 'conversion:' || test_id(7040) || '%') = 1
                   AND (lcp_c(7040)).notes = 'Agent note', 'p10 replays return the one client; a changed payload is a conflict');

-- ── P11: authorization and tenant isolation are unchanged ────────────────────────────────────────────────────────
SELECT lcp_lead(7050 + n, '{}', o) FROM (VALUES (0, 11), (1, 11), (2, 11), (3, 11), (4, 12), (5, 11), (6, 11)) t(n, o);
UPDATE leads SET user_id = NULL, assigned_agent_id = NULL WHERE id = test_id(7056);
SELECT pc_login(21);  -- another agency's admin
SET ROLE authenticated;
SELECT pc_reject($q$SELECT lcp_convert(7150, 7050, lcp_payload(7050), NULL, 2)$q$, '42501');
SELECT pc_reject($q$SELECT lcp_convert(7150, 7050, lcp_payload(7050), NULL, 1)$q$, '42501');
RESET ROLE;
SELECT pc_login(12);  -- a peer agent who does not own the lead
SET ROLE authenticated;
SELECT pc_reject($q$SELECT lcp_convert(7151, 7051, lcp_payload(7051))$q$, '42501');
RESET ROLE;
SELECT pc_login(14);  -- Team Leader: the lead's owner is in the downline; agent 12 is not
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p11_tl', lcp_convert(7152, 7052, lcp_payload(7052)));
SELECT pc_reject($q$SELECT lcp_convert(7154, 7054, lcp_payload(7054))$q$, '42501');
RESET ROLE;
SELECT pc_login(13);  -- Admin
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p11_admin', lcp_convert(7153, 7053, lcp_payload(7053)));
RESET ROLE;
SELECT pc_login(15);  -- Super admin, home organization only
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p11_super', lcp_convert(7155, 7055, lcp_payload(7055)));
RESET ROLE;
SELECT pc_login(12);  -- an unassigned lead may be converted by any agent in the organization
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p11_unassigned', lcp_convert(7156, 7056, lcp_payload(7056)));
RESET ROLE;
SELECT test_assert(EXISTS (SELECT 1 FROM leads WHERE id = test_id(7050)) AND EXISTS (SELECT 1 FROM leads WHERE id = test_id(7051))
                   AND EXISTS (SELECT 1 FROM leads WHERE id = test_id(7054))
                   AND (lcp_c(7052)).lead_conversion->>'converted_by' = test_id(14)::text
                   AND (lcp_c(7053)).lead_conversion->>'converted_by' = test_id(13)::text
                   AND (lcp_c(7055)).lead_conversion->>'converted_by' = test_id(15)::text
                   AND (lcp_c(7056)).assigned_agent_id IS NULL AND (lcp_c(7056)).lead_conversion->'lead_owner_id' = 'null'
                   AND (SELECT count(*) FROM clients WHERE organization_id = test_id(2)) = 0,
                   'p11 refusals unchanged, authorized roles convert, nothing crosses organizations');

-- ── P12: Personal, Team and Open Pool dialer campaigns, and the Floating Dialer (no campaign) ────────────────────
INSERT INTO campaigns(id, name, type, organization_id, user_id) VALUES
  (test_id(7601), 'Synthetic Personal', 'Personal', test_id(1), test_id(11)),
  (test_id(7602), 'Synthetic Open', 'Open Pool', test_id(1), test_id(13));
SELECT lcp_lead(7060 + n, jsonb_build_object('state', 'Florida', 'notes', 'Dialer lead ' || n, 'age', 70 + n,
  'custom_fields', jsonb_build_object('Source Detail', 'campaign ' || n))) FROM generate_series(1, 4) n;
INSERT INTO campaign_leads(id, campaign_id, lead_id, organization_id, status, source, age, state) VALUES
  (test_id(7621), test_id(7601), test_id(7061), test_id(1), 'Queued', 'stale campaign source', NULL, 'FL'),
  (test_id(7622), test_id(7600), test_id(7062), test_id(1), 'Queued', 'stale campaign source', NULL, 'FL'),
  (test_id(7623), test_id(7602), test_id(7063), test_id(1), 'Queued', 'stale campaign source', NULL, 'FL');
SELECT pc_login(11);
SET ROLE authenticated;
-- Each browser shape sends a stale snapshot: the campaign row's age/source and an outdated custom bag.
SELECT lcp_convert(7160 + n, 7060 + n, lcp_payload(7060 + n, NULL, jsonb_build_object('Source Detail', 'stale')),
  CASE n WHEN 1 THEN test_id(7601) WHEN 2 THEN test_id(7600) WHEN 3 THEN test_id(7602) END) FROM generate_series(1, 4) n;
SELECT pc_reject($q$SELECT lcp_convert(7165, 7050, lcp_payload(7050), test_id(7601))$q$, '42501');
RESET ROLE;
SELECT test_assert(array_agg(coalesce(w.campaign_id::text, 'none') || '|' || (c).state || '|' || (c).age || '|' || (c).notes || '|'
                             || ((c).custom_fields->>'Source Detail') ORDER BY n)
  = ARRAY[test_id(7601) || '|FL|71|Dialer lead 1|campaign 1', test_id(7600) || '|FL|72|Dialer lead 2|campaign 2',
          test_id(7602) || '|FL|73|Dialer lead 3|campaign 3', 'none|FL|74|Dialer lead 4|campaign 4'],
  'p12 every dialer path preserves the database lead; sales carry their campaign (none for the Floating Dialer)')
FROM (SELECT n, lcp_c(7060 + n) c FROM generate_series(1, 4) n) x
JOIN wins w ON w.contact_id = (x.c).id AND w.idempotency_key = 'conversion:' || test_id(7060 + x.n);
SELECT test_assert((SELECT count(*) FROM campaign_leads WHERE id IN (test_id(7621), test_id(7622), test_id(7623)) AND lead_id IS NULL) = 3,
                   'p12 campaign rows preserved');

-- ── P14: the client editor saves the four person fields and nothing protected ────────────────────────────────────
INSERT INTO lcp_results VALUES ('p14_history_before', (lcp_c(7022)).lead_conversion);
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p14', update_client_with_policy_sale((SELECT id FROM clients WHERE lead_id = test_id(7022)),
  '{"date_of_birth": "1970-01-02", "age": 55, "best_time_to_call": "Evening", "spouse_info": "Jamie", "notes": "Edited"}'));
SELECT pc_reject(format($q$SELECT update_client_with_policy_sale(%L, '{"lead_source": "Edited"}')$q$, (SELECT id FROM clients WHERE lead_id = test_id(7022))), '22023');
SELECT pc_reject(format($q$SELECT update_client_with_policy_sale(%L, '{"age": "abc"}')$q$, (SELECT id FROM clients WHERE lead_id = test_id(7022))), '22P02');
INSERT INTO lcp_results VALUES ('p14_clear', update_client_with_policy_sale((SELECT id FROM clients WHERE lead_id = test_id(7021)),
  '{"date_of_birth": null, "age": null, "best_time_to_call": null, "spouse_info": null}'));
-- A manual client's first policy through the D7 companion still records exactly one sale with the person fields.
INSERT INTO lcp_results VALUES ('p14_manual', create_client_with_sale_handoff(test_id(7170), test_id(1), pc_contact('ManualPerson', 11), false, NULL));
INSERT INTO lcp_results VALUES ('p14_first_policy', update_client_with_policy_sale_handoff(test_id(7171),
  (lcp_r('p14_manual')->>'client_id')::uuid, '{"policy_type": "Term", "carrier": "Synthetic Life", "policy_number": "SYN-MP",
   "premium": 40, "sold_date": "2026-10-03", "age": 47, "date_of_birth": "1979-05-06"}', pc_payload()));
RESET ROLE;
SELECT test_assert((c).date_of_birth = '1970-01-02' AND (c).age = 55 AND (c).best_time_to_call = 'Evening'
                   AND (c).spouse_info = '"Jamie"' AND (c).notes = 'Edited' AND (c).state = 'Atlantis'
                   AND (c).lead_conversion = lcp_r('p14_history_before')
                   AND lcp_r('p14')->'client'->>'age' = '55', 'p14 person fields saved; history untouched; returned row complete')
FROM (SELECT lcp_c(7022) c) x;
SELECT test_assert((SELECT changed_fields @> ARRAY['date_of_birth', 'age', 'best_time_to_call'] FROM contact_history_events
                     WHERE source_table = 'clients' AND action = 'changed' AND source_id = (lcp_c(7022)).id ORDER BY recorded_at DESC LIMIT 1),
                   'p14 contact history records the edited person fields by name');
SELECT test_assert((lcp_c(7021)).date_of_birth IS NULL AND (lcp_c(7021)).age IS NULL AND (lcp_c(7021)).spouse_info IS NULL,
                   'p14 person fields can be cleared');
SELECT test_assert((SELECT age = 47 AND date_of_birth = '1979-05-06' FROM clients WHERE id = (lcp_r('p14_manual')->>'client_id')::uuid)
                   AND jsonb_array_length(lcp_r('p14_first_policy')->'win_ids') = 1
                   AND (SELECT count(*) FROM wins WHERE contact_id = (lcp_r('p14_manual')->>'client_id')::uuid) = 1,
                   'p14 first-policy edit companion records one sale alongside the person fields');

-- ── P15: mixed versions — an older browser's client edit sends only the old keys and the whole custom-field bag ──
INSERT INTO lcp_results VALUES ('p15_before', to_jsonb(lcp_c(7002)));
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO lcp_results VALUES ('p15', update_client_with_policy_sale((SELECT id FROM clients WHERE lead_id = test_id(7002)),
  jsonb_build_object('first_name', 'Lead7002', 'last_name', 'Synthetic', 'phone', '5550107002', 'email', 'lead7002@example.test',
    'state', 'NV', 'notes', 'Old browser edit', 'custom_fields', (SELECT custom_fields FROM clients WHERE lead_id = test_id(7002)),
    'updated_at', now())));
RESET ROLE;
SELECT test_assert(to_jsonb(lcp_c(7002)) - ARRAY['state', 'notes', 'updated_at'] = lcp_r('p15_before') - ARRAY['state', 'notes', 'updated_at']
                   AND (lcp_c(7002)).state = 'NV' AND (lcp_c(7002)).notes = 'Old browser edit',
                   'p15 an old-browser edit changes only what it sent; person fields, history and policies are untouched');
SELECT test_assert((SELECT count(*) FROM wins WHERE contact_id = (lcp_c(7002)).id) = 3, 'p15 no sale added or removed');

SELECT 'PASS lead conversion preservation' AS result;
