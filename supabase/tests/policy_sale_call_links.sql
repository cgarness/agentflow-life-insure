-- Reports V2 PKG-C producing-call capture (D3 §3.6, §7 L1–L16). Synthetic data only, on the policy commission
-- fixture and harness (both commission migrations) after 20261105120030 and 20261105120031, run by
-- scripts/run_policy_commission_tests.sh. The production column calls.voicemail_id is added by the runner first.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE pscl_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON pscl_results TO authenticated;
CREATE FUNCTION pscl_r(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT data FROM pscl_results WHERE key = p_key $$;
CREATE FUNCTION pscl_client(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.clients WHERE first_name = p_first $$;
CREATE FUNCTION pscl_policy(p_premium numeric) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT jsonb_build_object('policy_type', 'Term', 'carrier', 'Synthetic Life', 'premium', p_premium, 'sold_date', '2026-10-02') $$;
CREATE FUNCTION pscl_link(p_key text) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT concat_ws('/', pscl_r(p_key) -> 'source_call_link' ->> 'status', pscl_r(p_key) -> 'source_call_link' ->> 'reason') $$;
CREATE FUNCTION pscl_links(p_key text) RETURNS bigint LANGUAGE sql STABLE AS
  $$ SELECT count(*) FROM private.policy_sale_call_links l
      WHERE l.win_id IN (SELECT x::uuid FROM jsonb_array_elements_text(pscl_r(p_key) -> 'win_ids') x) $$;
GRANT EXECUTE ON FUNCTION pscl_r(text), pscl_client(text), pscl_policy(numeric) TO authenticated;

-- Synthetic buyers and calls (agent test_id(11) sells; 12 is another agent; 13 an Admin; 14 a Team Leader).
INSERT INTO clients(organization_id, first_name, last_name, assigned_agent_id) VALUES
  (test_id(1), 'LinkBuyer', 'Synthetic', test_id(11)), (test_id(1), 'OtherBuyer', 'Synthetic', test_id(11)),
  (test_id(1), 'RetryBuyer', 'Synthetic', test_id(11));
INSERT INTO leads(id, organization_id, user_id, assigned_agent_id, first_name, last_name) VALUES
  (test_id(7001), test_id(1), test_id(11), test_id(11), 'LinkLead', 'Synthetic');
INSERT INTO calls(id, organization_id, agent_id, contact_id, lead_id, direction, created_at, voicemail_id) VALUES
  (test_id(7101), test_id(1), test_id(11), pscl_client('LinkBuyer'), NULL, 'outbound', now() - interval '1 hour', NULL),
  (test_id(7102), test_id(1), test_id(12), pscl_client('LinkBuyer'), NULL, 'outbound', now() - interval '1 hour', NULL),
  (test_id(7103), test_id(1), test_id(11), pscl_client('LinkBuyer'), NULL, 'outbound', now() - interval '25 hours', NULL),
  (test_id(7104), test_id(1), test_id(11), pscl_client('LinkBuyer'), NULL, 'outbound', now() + interval '1 hour', NULL),
  (test_id(7105), test_id(1), test_id(11), pscl_client('OtherBuyer'), NULL, 'outbound', now() - interval '1 hour', NULL),
  (test_id(7106), test_id(1), test_id(11), pscl_client('LinkBuyer'), NULL, 'inbound', now() - interval '30 minutes', NULL),
  (test_id(7107), test_id(1), NULL, pscl_client('LinkBuyer'), NULL, 'inbound', now() - interval '30 minutes', NULL),
  (test_id(7108), test_id(1), test_id(11), pscl_client('LinkBuyer'), NULL, 'inbound', now() - interval '30 minutes', gen_random_uuid()),
  (test_id(7109), test_id(2), test_id(11), pscl_client('LinkBuyer'), NULL, 'outbound', now() - interval '1 hour', NULL),
  (test_id(7110), test_id(1), test_id(11), test_id(7001), test_id(7001), 'outbound', now() - interval '2 hours', NULL),
  (test_id(7111), test_id(1), test_id(11), pscl_client('RetryBuyer'), NULL, 'outbound', now() - interval '1 hour', NULL),
  (test_id(7112), test_id(1), test_id(11), pscl_client('LinkBuyer'), NULL, 'outbound', now() - interval '10 minutes', NULL);

-- ── L1 / L2 / L3 / L8 / L10: record, retry, differing replay, unchanged handoff, PT409 passthrough ──────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pscl_results VALUES ('rec', record_client_policy_handoff_v2(test_id(7201), pscl_client('LinkBuyer'), pscl_policy(50), true, NULL, test_id(7101)));
INSERT INTO pscl_results VALUES ('rec_retry', record_client_policy_handoff_v2(test_id(7201), pscl_client('LinkBuyer'), pscl_policy(50), true, NULL, test_id(7101)));
INSERT INTO pscl_results VALUES ('rec_other_call', record_client_policy_handoff_v2(test_id(7201), pscl_client('LinkBuyer'), pscl_policy(50), true, NULL, test_id(7112)));
INSERT INTO pscl_results VALUES ('rec_v1', record_client_policy_handoff(test_id(7201), pscl_client('LinkBuyer'), pscl_policy(50), true, NULL));
INSERT INTO pscl_results VALUES ('rec_none', record_client_policy_handoff_v2(test_id(7202), pscl_client('LinkBuyer'), pscl_policy(51), false, NULL, NULL));
SELECT pc_reject($q$SELECT record_client_policy_handoff_v2(test_id(7201), pscl_client('LinkBuyer'), pscl_policy(99), true, NULL, test_id(7101))$q$, 'PT409');
RESET ROLE;
SELECT test_assert(pscl_link('rec') = 'linked' AND pscl_links('rec') = 1, 'L1 the producing call is linked to the sale');
SELECT test_assert((SELECT l.call_id = test_id(7101) AND l.call_direction = 'outbound' AND l.link_source = 'sale_entry' AND l.sale_kind = 'record'
                      AND l.operation_key = 'policy:' || test_id(7201) AND l.actor_id = test_id(11) AND l.client_id = pscl_client('LinkBuyer')
                      FROM private.policy_sale_call_links l WHERE l.request_id = test_id(7201)), 'L1 link row shape');
SELECT test_assert(pscl_link('rec_retry') = 'already_linked' AND (pscl_r('rec_retry') ->> 'idempotent')::boolean
                   AND (SELECT count(*) FROM private.policy_sale_call_links WHERE request_id = test_id(7201)) = 1, 'L2 an identical retry is idempotent');
SELECT test_assert(pscl_link('rec_other_call') = 'rejected/existing_link_differs' AND pscl_r('rec_other_call') -> 'win_ids' = pscl_r('rec') -> 'win_ids',
                   'L3 a replay naming another call keeps the first link and the sale result');
SELECT test_assert((pscl_r('rec_v1') - 'idempotent') = (pscl_r('rec_retry') - 'idempotent' - 'source_call_link'),
                   'L8 the _v2 result is the unchanged handoff result plus source_call_link');
SELECT test_assert(pscl_link('rec_none') = 'not_requested' AND pscl_links('rec_none') = 0, 'L8 no call id: not_requested, nothing written');
SELECT 'PASS L1-L3, L8, L10 record capture, retry, replay, unchanged handoff and PT409 passthrough' AS result;

-- ── L4 / L14: validation rejections never fail the sale ─────────────────────────────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pscl_results SELECT 'reject_' || r.k, record_client_policy_handoff_v2(test_id(7300 + r.n), pscl_client('LinkBuyer'), pscl_policy(60 + r.n), false, NULL, r.call)
  FROM (VALUES (1, 'not_found', test_id(7999)), (2, 'other_agent', test_id(7102)), (3, 'too_old', test_id(7103)), (4, 'future', test_id(7104)),
               (5, 'other_buyer', test_id(7105)), (6, 'unclaimed', test_id(7107)), (7, 'voicemail', test_id(7108)), (8, 'other_org', test_id(7109)))
       AS r(n, k, call);
INSERT INTO pscl_results VALUES ('inbound', record_client_policy_handoff_v2(test_id(7310), pscl_client('LinkBuyer'), pscl_policy(70), false, NULL, test_id(7106)));
RESET ROLE;
SELECT test_assert((SELECT string_agg(substr(key, 8) || '=' || pscl_link(key), ' ' ORDER BY key) FROM pscl_results WHERE key LIKE 'reject\_%')
  = 'future=rejected/call_too_old not_found=rejected/call_not_found other_agent=rejected/call_not_actor other_buyer=rejected/identity_mismatch '
    'other_org=rejected/call_not_found too_old=rejected/call_too_old unclaimed=rejected/call_not_actor voicemail=rejected/call_voicemail',
  'L4/L14 each invalid call is rejected with its reason');
SELECT test_assert((SELECT bool_and(jsonb_array_length(data -> 'win_ids') = 1 AND NOT (data ->> 'idempotent')::boolean) FROM pscl_results WHERE key LIKE 'reject\_%')
                   AND (SELECT count(*) FROM private.policy_sale_call_links l JOIN pscl_results r ON r.key LIKE 'reject\_%'
                         AND l.win_id = (r.data -> 'win_ids' ->> 0)::uuid) = 0
                   AND (SELECT count(*) FROM private.policy_sale_call_link_failures) = 0, 'L4 every rejected sale still saved; no link, no failure row');
SELECT test_assert(pscl_link('inbound') = 'linked' AND (SELECT call_direction FROM private.policy_sale_call_links WHERE request_id = test_id(7310)) = 'inbound',
                   'L14 an inbound call claimed by the seller links');
SELECT 'PASS L4, L14 validation rejections and tracked inbound' AS result;

-- ── L5: conversion links every win (primary and additional) through the lead lineage ───────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pscl_results VALUES ('convert', convert_lead_to_client_with_sales_handoff_v2(test_id(7401), test_id(7001), test_id(1),
  pc_client('LinkConverted', 11, '50.00') || jsonb_build_object('custom_fields', jsonb_build_object('additional_policies', jsonb_build_array(
    jsonb_build_object('policyId', test_id(7402), 'policyType', 'Term', 'carrier', 'Synthetic Life', 'premiumAmount', '30.00', 'soldDate', '2026-10-01'))))
  , NULL, NULL, test_id(7110)));
RESET ROLE;
SELECT test_assert(pscl_link('convert') = 'linked' AND jsonb_array_length(pscl_r('convert') -> 'win_ids') = 2 AND pscl_links('convert') = 2
                   AND (SELECT bool_and(sale_kind = 'convert' AND operation_key = 'conversion:' || test_id(7001)) FROM private.policy_sale_call_links
                         WHERE client_id = (pscl_r('convert') ->> 'client_id')::uuid), 'L5 conversion links all wins');
SELECT 'PASS L5 conversion capture' AS result;

-- ── L6 / L9: immutability and class W privileges ───────────────────────────────────────────────────────────────
SELECT pc_reject($q$UPDATE private.policy_sale_call_links SET link_source = 'reviewed_repair'$q$, '23514');
SELECT pc_reject($q$DELETE FROM private.policy_sale_call_links$q$, '23514');
SELECT pc_reject($q$TRUNCATE private.policy_sale_call_links$q$, '23514');
SELECT pc_reject($q$INSERT INTO private.policy_sale_call_links (organization_id, win_id, policy_id, client_id, call_id, call_direction,
  link_source, sale_kind, operation_key, actor_id, evidence_hash) SELECT organization_id, id, policy_id, contact_id, test_id(7105), 'inbound',
  'sale_entry', 'record', 'x', test_id(11), repeat('0', 64) FROM wins WHERE idempotency_key = 'policy:' || test_id(7202)$q$, '23514');
SELECT test_assert((SELECT string_agg(f || '=' || r || ':' || has_function_privilege(r, f, 'EXECUTE'), ' ' ORDER BY f, r)
                      FROM unnest(ARRAY['public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid)',
                                        'public.convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid)',
                                        'public.retry_policy_sale_call_link(uuid)', 'public.get_policy_sale_call_link_status(uuid[])']) f,
                           unnest(ARRAY['anon', 'authenticated', 'service_role']) r)
  = (SELECT string_agg(f || '=' || r || ':' || (r = 'authenticated'), ' ' ORDER BY f, r)
       FROM unnest(ARRAY['public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid)',
                         'public.convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid)',
                         'public.retry_policy_sale_call_link(uuid)', 'public.get_policy_sale_call_link_status(uuid[])']) f,
            unnest(ARRAY['anon', 'authenticated', 'service_role']) r), 'L9 class W: the four RPCs are executable by authenticated only');
SELECT test_assert(NOT has_function_privilege(r, 'private.capture_policy_sale_call_link(text,text,uuid,uuid,uuid[],uuid,uuid,timestamptz)', 'EXECUTE')
                   AND NOT has_table_privilege(r, 'private.policy_sale_call_links', 'SELECT')
                   AND NOT has_table_privilege(r, 'private.policy_sale_call_link_failures', 'SELECT'), 'L9 helper and tables sealed for ' || r)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT test_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.policy_sale_call_links'::regclass)
                   AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.policy_sale_call_link_failures'::regclass)
                   AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('private.policy_sale_call_links'::regclass,
                                                                               'private.policy_sale_call_link_failures'::regclass)),
                   'L9 RLS on with no policies');
SELECT test_assert((SELECT proconfig @> ARRAY['lock_timeout=100ms'] AND NOT prosecdef FROM pg_proc
                     WHERE oid = 'private.capture_policy_sale_call_link(text,text,uuid,uuid,uuid[],uuid,uuid,timestamptz)'::regprocedure),
                   'the capture helper is invoker-rights with a function-level 100ms lock bound');
SELECT 'PASS L6, L9 immutability and privileges' AS result;

-- ── L7 / L15 / L16: a failed link is recorded, read as open_failure, and retried by the seller or an Admin ──────
-- A test-only trigger makes the link insert fail as a 100ms lock timeout would (55P03).
CREATE FUNCTION pscl_fail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.call_id = public.test_id(7111) THEN RAISE EXCEPTION 'simulated lock timeout' USING ERRCODE = '55P03'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pscl_fail BEFORE INSERT ON private.policy_sale_call_links FOR EACH ROW EXECUTE FUNCTION public.pscl_fail();
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pscl_results VALUES ('failed', record_client_policy_handoff_v2(test_id(7501), pscl_client('RetryBuyer'), pscl_policy(80), true, NULL, test_id(7111)));
INSERT INTO pscl_results VALUES ('status_seller', (SELECT jsonb_agg(to_jsonb(s)) FROM get_policy_sale_call_link_status(
  ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(pscl_r('failed') -> 'win_ids') x) || ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(pscl_r('rec') -> 'win_ids') x)
  || ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(pscl_r('rec_none') -> 'win_ids') x)) s));
INSERT INTO pscl_results VALUES ('retry_still_failing', retry_policy_sale_call_link((pscl_r('failed') -> 'win_ids' ->> 0)::uuid));
RESET ROLE;
SELECT test_assert(pscl_link('failed') = 'capture_failed' AND (pscl_r('failed') -> 'source_call_link' ->> 'recorded')::boolean
                   AND jsonb_array_length(pscl_r('failed') -> 'win_ids') = 1 AND pscl_links('failed') = 0, 'L7 the sale saved; the link failed and was recorded');
SELECT test_assert((SELECT sqlstate = '55P03' AND attempts = 2 AND resolved_at IS NULL AND call_id = test_id(7111) AND actor_id = test_id(11)
                     FROM private.policy_sale_call_link_failures WHERE win_id = (pscl_r('failed') -> 'win_ids' ->> 0)::uuid), 'L7 failure row (and the failed retry counted)');
SELECT test_assert(pscl_r('retry_still_failing') ->> 'status' = 'capture_failed', 'L15 a retry that still fails stays open');
SELECT test_assert((SELECT string_agg(s ->> 'status', ',' ORDER BY s ->> 'status') FROM jsonb_array_elements(pscl_r('status_seller')) s) = 'linked,not_linked,open_failure'
                   AND (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) = ARRAY['status', 'win_id']) FROM jsonb_array_elements(pscl_r('status_seller')) s),
                   'L16 the seller reads status only: linked, open_failure, not_linked');
DROP TRIGGER pscl_fail ON private.policy_sale_call_links;
SELECT pc_login(12);
SET ROLE authenticated;
SELECT pc_reject($q$SELECT retry_policy_sale_call_link((pscl_r('failed') -> 'win_ids' ->> 0)::uuid)$q$, '42501');
INSERT INTO pscl_results VALUES ('status_other', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM get_policy_sale_call_link_status(
  ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(pscl_r('failed') -> 'win_ids') x)) s), '[]'));
SELECT pc_login(14);
INSERT INTO pscl_results VALUES ('status_tl', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM get_policy_sale_call_link_status(
  ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(pscl_r('failed') -> 'win_ids') x)) s), '[]'));
SELECT pc_reject($q$SELECT retry_policy_sale_call_link((pscl_r('failed') -> 'win_ids' ->> 0)::uuid)$q$, '42501');
SELECT pc_login(13);
INSERT INTO pscl_results VALUES ('status_admin', (SELECT jsonb_agg(to_jsonb(s)) FROM get_policy_sale_call_link_status(
  ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(pscl_r('failed') -> 'win_ids') x)) s));
INSERT INTO pscl_results VALUES ('retry_admin', retry_policy_sale_call_link((pscl_r('failed') -> 'win_ids' ->> 0)::uuid));
INSERT INTO pscl_results VALUES ('retry_again', retry_policy_sale_call_link((pscl_r('failed') -> 'win_ids' ->> 0)::uuid));
INSERT INTO pscl_results VALUES ('retry_none', retry_policy_sale_call_link((pscl_r('rec_none') -> 'win_ids' ->> 0)::uuid));
RESET ROLE;
SELECT test_assert(pscl_r('status_other') = '[]' AND pscl_r('status_tl') = '[]', 'L16 another agent and a Team Leader see no status');
SELECT test_assert(pscl_r('status_admin') -> 0 ->> 'status' = 'open_failure', 'L16 an Admin reads the open failure');
SELECT test_assert(pscl_r('retry_admin') ->> 'status' = 'linked' AND pscl_r('retry_again') ->> 'status' = 'already_linked'
                   AND pscl_r('retry_none') ->> 'status' = 'no_open_failure', 'L15 the Admin retry links; it is idempotent');
SELECT test_assert((SELECT call_id = test_id(7111) AND actor_id = test_id(11) AND request_id = test_id(7501)
                     FROM private.policy_sale_call_links WHERE win_id = (pscl_r('failed') -> 'win_ids' ->> 0)::uuid)
                   AND (SELECT resolution = 'linked' AND resolved_at IS NOT NULL FROM private.policy_sale_call_link_failures
                         WHERE win_id = (pscl_r('failed') -> 'win_ids' ->> 0)::uuid), 'L15 the retry used the recorded call and actor; the failure is resolved');
SELECT 'PASS L7, L15, L16 failure record, status read and retry' AS result;

-- ── L12: client lead lineage is read-only outside postgres; conversion still works (L5) ──────────────────────
CREATE ROLE pscl_lineage_editor NOLOGIN BYPASSRLS;
GRANT SELECT, UPDATE ON public.clients TO pscl_lineage_editor;
SET ROLE pscl_lineage_editor;
SELECT pc_reject($q$UPDATE public.clients SET lead_id = test_id(7001) WHERE first_name = 'OtherBuyer'$q$, '42501');
UPDATE public.clients SET last_name = 'Edited' WHERE first_name = 'OtherBuyer';
RESET ROLE;
DROP OWNED BY pscl_lineage_editor;
DROP ROLE pscl_lineage_editor;
SELECT test_assert((SELECT lead_id IS NULL AND last_name = 'Edited' FROM clients WHERE first_name = 'OtherBuyer'), 'L12 lead_id is guarded; other columns are not');
SELECT 'PASS L12 lead lineage guard' AS result;

-- ── L13: a ticketed sale reversal leaves the link inert; a link is removed only with its own ticket ─────────────
-- The owner-reviewed reversal shape: an exact-postimage ticket, the sale's policy identity retired as legacy, then
-- the delete, in one transaction (the deferred sale-completeness check runs at its end).
CREATE TEMP TABLE pscl_reversed AS SELECT id, policy_id FROM wins WHERE idempotency_key = 'policy:' || test_id(7310);
GRANT SELECT ON pscl_reversed TO authenticated;
DO $reversal$ BEGIN
  INSERT INTO private.policy_sale_reversals (win_id, operation_key, row_hash, before_row, reason)
  SELECT w.id, 'pscl-reversal', md5(to_jsonb(w)::text), to_jsonb(w), 'synthetic reversal' FROM wins w WHERE w.id = (SELECT id FROM pscl_reversed);
  UPDATE private.policy_identities SET legacy = true WHERE policy_id = (SELECT policy_id FROM pscl_reversed);
  DELETE FROM wins WHERE id = (SELECT id FROM pscl_reversed);
END $reversal$;
SELECT test_assert((SELECT count(*) FROM private.policy_sale_call_links WHERE win_id = (SELECT id FROM pscl_reversed)) = 1
                   AND NOT EXISTS (SELECT 1 FROM wins WHERE id = (SELECT id FROM pscl_reversed)), 'L13 the reversal succeeds; the link row stays, unjoined');
SELECT pc_login(13);
SET ROLE authenticated;
SELECT test_assert((SELECT count(*) FROM get_policy_sale_call_link_status(ARRAY(SELECT id FROM pscl_reversed))) = 0, 'L13 a reversed sale has no status');
RESET ROLE;
DO $ticket$ BEGIN
  PERFORM set_config('agentflow.sale_call_link_reversal', (SELECT id::text FROM pscl_reversed), true);
  DELETE FROM private.policy_sale_call_links WHERE win_id = (SELECT id FROM pscl_reversed);
END $ticket$;
SELECT test_assert((SELECT count(*) FROM private.policy_sale_call_links WHERE win_id = (SELECT id FROM pscl_reversed)) = 0, 'L13 a ticketed link removal');
SELECT 'PASS L13 reversal' AS result;
-- ── C-NULL-IDENTITY: missing pointers must not prove buyer identity ──────────────────────────────────────────
-- Exercise the authenticated sale APIs, not only SQL's boolean truth table. Each request must still save its sale.
INSERT INTO leads(id, organization_id, user_id, assigned_agent_id, first_name, last_name) VALUES
  (test_id(9001), test_id(1), test_id(11), test_id(11), 'NullIdentityLead', 'Synthetic'),
  (test_id(9005), test_id(1), test_id(11), test_id(11), 'RetainedLineageLead', 'Synthetic');
-- The converter deletes its lead; use a synthetic retained legacy lineage for membership-only matching.
INSERT INTO clients(organization_id, first_name, last_name, assigned_agent_id, lead_id) VALUES
  (test_id(1), 'RetainedLineageBuyer', 'Synthetic', test_id(11), test_id(9005));
INSERT INTO campaign_leads(id, campaign_id, lead_id, organization_id) VALUES
  (test_id(9002), test_id(9003), test_id(9005), test_id(1)),
  (test_id(9004), test_id(9003), test_id(9005), test_id(2));
INSERT INTO calls(id, organization_id, agent_id, contact_id, lead_id, campaign_lead_id, direction, created_at) VALUES
  (test_id(9011), test_id(1), test_id(11), NULL, NULL, NULL, 'outbound', now() - interval '1 hour'),
  (test_id(9012), test_id(1), test_id(11), pscl_client('OtherBuyer'), NULL, NULL, 'outbound', now() - interval '1 hour'),
  (test_id(9013), test_id(1), test_id(11), NULL, test_id(7001), NULL, 'outbound', now() - interval '1 hour'),
  (test_id(9014), test_id(1), test_id(11), NULL, NULL, test_id(9002), 'outbound', now() - interval '1 hour'),
  (test_id(9015), test_id(1), test_id(11), test_id(7001), NULL, NULL, 'outbound', now() - interval '1 hour'),
  (test_id(9016), test_id(1), test_id(11), NULL, NULL, test_id(9004), 'outbound', now() - interval '1 hour'),
  (test_id(9017), test_id(1), test_id(11), pscl_client('OtherBuyer'), test_id(9001), NULL, 'outbound', now() - interval '1 hour');
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pscl_results SELECT 'identity_' || r.k,
  record_client_policy_handoff_v2(test_id(9100 + r.n),
    CASE WHEN r.buyer = 'converted' THEN (pscl_r('convert') ->> 'client_id')::uuid ELSE pscl_client(r.buyer) END, pscl_policy(100 + r.n), false, NULL, test_id(r.call))
  FROM (VALUES (1, 'manual_null', 'LinkBuyer', 9011), (2, 'converted_null', 'converted', 9011),
    (3, 'converted_wrong_contact', 'converted', 9012), (4, 'direct_match', 'LinkBuyer', 7101),
    (5, 'lead_match', 'converted', 9013), (6, 'campaign_match', 'RetainedLineageBuyer', 9014),
    (7, 'contact_lead_match', 'converted', 9015), (8, 'campaign_wrong_org', 'RetainedLineageBuyer', 9016),
    (9, 'nonnull_mismatch', 'converted', 9017)) AS r(n, k, buyer, call);
INSERT INTO pscl_results VALUES ('identity_conversion_null', convert_lead_to_client_with_sales_handoff_v2(
  test_id(9120), test_id(9001), test_id(1), pc_client('NullIdentityConverted', 11, '50.00'), NULL, NULL, test_id(9011)));
INSERT INTO pscl_results VALUES ('identity_manual_retry', record_client_policy_handoff_v2(
  test_id(9101), pscl_client('LinkBuyer'), pscl_policy(101), false, NULL, test_id(9011)));
RESET ROLE;
SELECT test_assert(pscl_link('identity_' || k) = 'rejected/identity_mismatch' AND pscl_links('identity_' || k) = 0,
  'C-NULL-IDENTITY rejects ' || k)
  FROM unnest(ARRAY['manual_null', 'converted_null', 'converted_wrong_contact', 'campaign_wrong_org',
    'nonnull_mismatch', 'conversion_null', 'manual_retry']) k;
SELECT test_assert(pscl_link('identity_' || k) = 'linked' AND pscl_links('identity_' || k) = 1,
  'C-NULL-IDENTITY retains valid ' || k)
  FROM unnest(ARRAY['direct_match', 'lead_match', 'campaign_match', 'contact_lead_match']) k;
SELECT test_assert((SELECT bool_and(jsonb_array_length(data -> 'win_ids') = 1 AND EXISTS (
    SELECT 1 FROM wins w WHERE w.id = (r.data -> 'win_ids' ->> 0)::uuid AND w.organization_id = test_id(1)))
    FROM pscl_results r WHERE key LIKE 'identity\_%')
  AND NOT EXISTS (SELECT 1 FROM private.policy_sale_call_link_failures f JOIN pscl_results r
    ON r.key LIKE 'identity\_%' AND f.win_id = (r.data -> 'win_ids' ->> 0)::uuid),
  'C-NULL-IDENTITY every sale persists without a capture failure');
SELECT test_assert((pscl_r('identity_manual_retry') ->> 'idempotent')::boolean
  AND pscl_r('identity_manual_retry') -> 'win_ids' = pscl_r('identity_manual_null') -> 'win_ids'
  AND (SELECT count(*) FROM wins WHERE idempotency_key = 'policy:' || test_id(9101)) = 1,
  'C-NULL-IDENTITY rejected call retry keeps one sale');
SELECT 'PASS C-NULL-IDENTITY authenticated record/conversion rejection, valid lineage, sale persistence and retry' AS result;

SELECT 'PASS policy sale call links' AS result;

-- @@v3@@
-- =====================================================================================================
-- Reports v3 on captured links (…32, D3 §3.6, §7 J4/J14/J17/J19). Run only by scripts/reports_v3_fixture.py (which sets
-- pscl_v3) after …30 and …32, on the PKG-A journey organization J (reports_v3_journey_fixtures.sql), inside a
-- savepoint that is rolled back. Links are written as the table owner through the link guard (…31 needs the sale
-- handoffs, which the v3 fixture does not have; its paths are proven above on the commission fixture).
-- =====================================================================================================
\if :{?pscl_v3}
SAVEPOINT pscl_v3;
SELECT rt.eq('…32: basis flags 3.2.0 with captured links', private.report_v3_basis_flags(),
  '{"contract_version":"3.2.0","corrections":"audited_ledger","sale_call_links":"installed","appointment_evidence":"not_installed"}'::jsonb);
SELECT rt.eq('…32: payloads carry 3.2.0 / installed (X13)',
  (SELECT string_agg(concat_ws('/', p ->> 'contract_version', p #>> '{basis,sale_call_links}'), ',')
     FROM (VALUES (rt.v3r('ADM1', 'journey')), (rt.v3r('ADM1', 'summary'))) x(p)), '3.2.0/installed,3.2.0/installed');
SELECT rt.eq('J17: with no captured link a buyer is Unclassified (sale_call_link_missing), never No',
  rt.jmember(38, rt.jkey('JL1')), '-|sale_call_link_missing|false|-|-|unclassified');
SELECT rt.eq('J14: KPI 38 is no longer "not captured" once the flag is installed',
  (SELECT e ->> 'reason' FROM jsonb_array_elements(rt.jkpis(NULL, '2026-12-15 00:00+00')) e WHERE (e ->> 'id')::int = 38) IS DISTINCT FROM 'sale_call_link_not_captured', true);

-- The BC2 buyer JL2 (as reports_v3_journey.sql §5), then real links for JL3, JL12 and JL2.
INSERT INTO public.clients (id, organization_id, lead_id, phone, premium, created_at)
VALUES ('c3f20200-0000-0000-0000-000000000000', rt.v3('J'), rt.v3('JL2'), '310-555-0102', 0, '2026-10-17 22:00+00');
INSERT INTO private.policy_identities (policy_id, organization_id, client_id, source, legacy)
VALUES ('c3f30200-0000-0000-0000-000000000000', rt.v3('J'), 'c3f20200-0000-0000-0000-000000000000', 'primary', false);
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, policy_id, premium_snapshot, premium_amount, idempotency_key,
                         sold_date, created_at, recorded_at)
VALUES ('c3f40200-0000-0000-0000-000000000000', rt.v3('J'), rt.v3('JA1'), 'c3f20200-0000-0000-0000-000000000000',
        'c3f30200-0000-0000-0000-000000000000', true, 40.00, 'v3j:w2', '2026-10-17', '2026-10-17 22:00+00', '2026-10-17 22:00+00');
INSERT INTO private.policy_sale_call_links (organization_id, win_id, policy_id, client_id, call_id, call_direction, link_source,
  sale_kind, operation_key, request_id, actor_id, evidence_hash)
SELECT w.organization_id, w.id, w.policy_id, w.contact_id, c.id,
       CASE WHEN lower(c.direction) = 'inbound' THEN 'inbound' ELSE 'outbound' END, 'sale_entry', 'record', 'v3:' || w.id, NULL,
       coalesce(w.agent_id, rt.v3('JA1')), repeat('0', 64)
  FROM (VALUES ('c3f40300-0000-0000-0000-000000000000'::uuid, 'c3f50000-0000-0000-0000-000000000003'::uuid),
               ('c3f41200-0000-0000-0000-000000000000'::uuid, 'c3f50000-0000-0000-0000-000000000031'::uuid),
               ('c3f40200-0000-0000-0000-000000000000'::uuid, 'c3f50000-0000-0000-0000-000000000022'::uuid)) l(w, c)
  JOIN public.wins w ON w.id = l.w JOIN public.calls c ON c.id = l.c;
SELECT rt.eq('the link reader returns the captured links (same-org sale and call)',
  (SELECT count(*) FROM private.report_v3_sale_call_links(rt.v3('J'), clock_timestamp() + interval '1 day')), 3::bigint);
SELECT rt.eq('a link captured after as_of is not read', (SELECT count(*) FROM private.report_v3_sale_call_links(rt.v3('J'), '2026-11-01 00:00+00')), 0::bigint);
SELECT rt.eq('organization isolation', (SELECT count(*) FROM private.report_v3_sale_call_links(rt.v3('O1'), clock_timestamp() + interval '1 day')), 0::bigint);
SELECT rt.eq('J19: a confirmed earlier unanswered attempt does not invalidate a verified 1 Call Close', rt.jmember(38, rt.jkey('JL3')),
  '-|-|true|-|-|yes');
SELECT rt.eq('J4: a link to a call that was not a qualifying contact stays Unclassified, never No', rt.jmember(38, rt.jkey('JL12')),
  '-|sale_call_link_missing|false|-|-|unclassified');
SELECT rt.eq('J4: an earlier confirmed contact makes it No', rt.jmember(38, rt.jkey('JL2')), '-|-|true|-|-|no');
SELECT rt.expect_sql_failure($q$UPDATE private.policy_sale_call_links SET link_source = 'reviewed_repair'$q$, 'immutable');
ROLLBACK TO SAVEPOINT pscl_v3;
SELECT rt.eq('the v3 section leaves no link', (SELECT count(*) FROM private.policy_sale_call_links), 0::bigint);
\endif
