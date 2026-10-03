\set ON_ERROR_STOP on
BEGIN;
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(501),p_operation_id=>test_uuid(701),p_expected_version=>0,p_release_lock=>false);
SELECT test_assert((public.check_dialer_dnc('(555) 123-4567')->>'blocked')::boolean,'DNC formatting check');
SELECT test_assert((SELECT count(*)=0 FROM public.get_personal_queue_leads(test_uuid(102))),'Personal+Personal duplicate master exclusion');
SELECT test_assert((SELECT count(*)=0 FROM public.get_next_queue_lead(test_uuid(103))),'Personal+Team exclusion');
SELECT test_assert((SELECT count(*)=0 FROM public.get_next_queue_lead(test_uuid(104))),'Personal+Open exclusion');
SELECT test_assert((SELECT available_leads=0 FROM public.get_queue_metrics(test_uuid(103))),'metrics DNC exclusion');
SELECT test_assert((public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(501),p_operation_id=>test_uuid(701),p_expected_version=>0)->>'replayed')::boolean,'duplicate save replay');
SELECT test_assert((SELECT call_attempts=1 AND status='DNC' FROM public.campaign_leads WHERE id=test_uuid(301)),'exactly one attempt');
RESET ROLE;
SELECT test_assert((SELECT count(*)=1 FROM public.dnc_list),'one suppression');
SELECT test_assert((SELECT duration=47 FROM public.calls WHERE id=test_uuid(401)),'duration remains Twilio owned');
SELECT test_assert((SELECT count(*)=5 FROM public.campaign_leads),'history intact');
SELECT test_assert((SELECT count(*)=4 FROM public.leads),'master records intact');
SELECT test_actor(21,2);
SET LOCAL ROLE authenticated;
SELECT test_assert((SELECT count(*)=1 FROM public.get_personal_queue_leads(test_uuid(105))),'other tenant unaffected');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT test_assert((public.admit_twilio_outbound(test_uuid(402),'synthetic_agent_12','+15551234567','+15559990000','CA00000000000000000000000000000001')->>'admitted')::boolean=false,'stale Open UI refused');
RESET ROLE;
ROLLBACK;

-- Configuration, rather than the display label, governs DNC.
BEGIN;
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(502),p_operation_id=>test_uuid(702),p_expected_version=>0);
SELECT test_assert((public.check_dialer_dnc('+1 555 123 4567')->>'blocked')::boolean,'configured NI adds DNC');
ROLLBACK;
BEGIN;
UPDATE public.dispositions SET dnc_auto_add=false,campaign_action='none' WHERE id=test_uuid(502);
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(502),p_operation_id=>test_uuid(703),p_expected_version=>0);
SELECT test_assert(NOT (public.check_dialer_dnc('5551234567')->>'blocked')::boolean,'NI without flag stays unsuppressed');
SELECT test_assert((SELECT status='Called' AND retry_eligible_at>now()+interval '59 minutes' FROM public.campaign_leads WHERE id=test_uuid(301)),'server retry interval');
ROLLBACK;

-- Explicit no-call disposition must not fabricate a call or an attempt.
BEGIN;
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(302),NULL,test_uuid(501),p_operation_id=>test_uuid(704),p_expected_version=>0);
SELECT test_assert((SELECT call_attempts=0 AND last_called_at IS NULL FROM public.campaign_leads WHERE id=test_uuid(302)),'no fake attempt');
RESET ROLE;
SELECT test_assert((SELECT count(*)=2 FROM public.calls),'no fake calls');
ROLLBACK;

-- Callback/appointment fields and notes remain configuration-driven.
BEGIN;
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(505),now()+interval '1 day','call back',false,test_uuid(705),'valid notes',NULL,0);
SELECT test_assert((SELECT callback_agent_id=test_uuid(11) AND callback_due_at>now() AND retry_eligible_at IS NULL FROM public.campaign_leads WHERE id=test_uuid(301)),'callback persisted');
SELECT test_assert((SELECT count(*)=0 FROM public.get_personal_queue_leads(test_uuid(101))),'future callback not selectable');
ROLLBACK;
BEGIN;
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(506),p_operation_id=>test_uuid(706),p_notes=>'valid notes',p_expected_version=>0);
SELECT test_assert((SELECT status='Called' AND retry_eligible_at IS NULL FROM public.campaign_leads WHERE id=test_uuid(301)),'appointment behavior');
ROLLBACK;

-- International ten-digit E.164 is not a US ten-digit national number.
BEGIN;
INSERT INTO public.dnc_list(organization_id,phone_number) VALUES(test_uuid(1),'+4412345678');
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT test_assert((public.check_dialer_dnc('+44 1234 5678')->>'blocked')::boolean,'international canonical match');
SELECT test_assert(NOT (public.check_dialer_dnc('4412345678')->>'blocked')::boolean,'international versus national key distinction');
ROLLBACK;

-- Execute the actual conversion RPC, including its FK delete and history transfer.
BEGIN;
INSERT INTO public.contact_notes(contact_id,contact_type,organization_id) VALUES(test_uuid(201),'lead',test_uuid(1));
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT public.convert_lead_to_client_atomic(test_uuid(201),'{"premium":75,"custom_fields":{"kept":"yes"},"sold_date":"2026-10-03"}') AS converted \gset
RESET ROLE;
SELECT test_assert((SELECT lead_id IS NULL FROM public.campaign_leads WHERE id=test_uuid(301)),'conversion preserves membership via SET NULL');
SELECT test_assert((SELECT original_lead_id=test_uuid(201) FROM private.dialer_conversion_lineage WHERE campaign_lead_id=test_uuid(301)),'conversion captures exact lineage');
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(507),p_operation_id=>test_uuid(721),p_expected_version=>0,p_notes=>'sale note',p_converted_client_id=>(:'converted'::jsonb->>'client_id')::uuid);
RESET ROLE;
SELECT test_assert((SELECT status='Completed' AND call_attempts=1 FROM public.campaign_leads WHERE id=test_uuid(301)),'converted membership retained terminal');
SELECT test_assert((SELECT premium=75 AND custom_fields='{"kept":"yes"}'::jsonb FROM public.clients WHERE id=(:'converted'::jsonb->>'client_id')::uuid),'client not corrupted');
SELECT test_assert((SELECT contact_id=(:'converted'::jsonb->>'client_id')::uuid AND contact_type='client' AND duration=47 AND campaign_lead_id=test_uuid(301) FROM public.calls WHERE id=test_uuid(401)),'call and campaign lineage preserved');
SELECT test_assert((SELECT count(*)=1 FROM public.contact_activities WHERE activity_type='note' AND contact_id=(:'converted'::jsonb->>'client_id')::uuid),'follow-up notes on converted client');
SELECT test_assert((SELECT contact_type='client' FROM public.contact_notes),'existing notes transferred');
ROLLBACK;

-- Removing queue/campaign eligibility preserves membership history and does not imply DNC.
BEGIN;
UPDATE public.dispositions SET campaign_action='remove_from_queue' WHERE id=test_uuid(503);
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(503),p_operation_id=>test_uuid(722),p_expected_version=>0);
SELECT test_assert((SELECT status='Completed' FROM public.campaign_leads WHERE id=test_uuid(301)),'remove_from_queue terminal');
SELECT test_assert(NOT (public.check_dialer_dnc('5551234567')->>'blocked')::boolean,'remove queue does not hardcode DNC');
ROLLBACK;
BEGIN;
UPDATE public.dispositions SET campaign_action='remove_from_campaign' WHERE id=test_uuid(503);
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(503),p_operation_id=>test_uuid(723),p_expected_version=>0);
SELECT test_assert((SELECT status='Removed' FROM public.campaign_leads WHERE id=test_uuid(301)),'remove_from_campaign retains history');
ROLLBACK;

BEGIN;
UPDATE public.campaigns SET max_attempts=1 WHERE id=test_uuid(101);
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(504),p_operation_id=>test_uuid(724),p_expected_version=>0);
SELECT test_assert((SELECT status='Completed' AND call_attempts=1 FROM public.campaign_leads WHERE id=test_uuid(301)),'No Answer reaches max attempts');
SELECT test_assert((SELECT count(*)=0 FROM public.get_personal_queue_leads(test_uuid(101))),'exhausted queue empty');
ROLLBACK;

-- Team claim eligibility: retry, agent suppression, license, hard claim and callback priority.
BEGIN;
UPDATE public.campaign_leads SET retry_eligible_at=now()+interval '1 hour' WHERE id=test_uuid(303);
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT test_assert((SELECT count(*)=0 FROM public.get_next_queue_lead(test_uuid(103))),'retry window enforced');
RESET ROLE;
UPDATE public.campaign_leads SET retry_eligible_at=NULL WHERE id=test_uuid(303);
INSERT INTO public.campaign_lead_agent_suppressions VALUES(test_uuid(303),test_uuid(103),test_uuid(1),test_uuid(11),now()+interval '1 hour');
SET LOCAL ROLE authenticated;
SELECT test_assert((SELECT count(*)=0 FROM public.get_next_queue_lead(test_uuid(103))),'per-agent suppression retained');
RESET ROLE;
DELETE FROM public.campaign_lead_agent_suppressions;
UPDATE public.leads SET assigned_agent_id=test_uuid(12) WHERE id=test_uuid(202);
SET LOCAL ROLE authenticated;
SELECT test_assert((SELECT count(*)=0 FROM public.get_next_queue_lead(test_uuid(103))),'other agent hard claim excluded');
ROLLBACK;
