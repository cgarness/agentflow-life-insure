\set ON_ERROR_STOP on
BEGIN;
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.dnc_list(organization_id,phone_number) VALUES(public.test_uuid(1),'5551234567');
    RAISE EXCEPTION 'Agent direct DNC insertion unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.calls SET disposition_id=public.test_uuid(501) WHERE id=public.test_uuid(401);
    RAISE EXCEPTION 'Direct call disposition unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.calls(organization_id,agent_id,direction,contact_phone)
    VALUES(public.test_uuid(1),public.test_uuid(11),'inbound','5551234567');
    RAISE EXCEPTION 'Browser forged a provider-owned inbound call';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.calls SET contact_id=public.test_uuid(204) WHERE id=public.test_uuid(401);
    RAISE EXCEPTION 'Browser replaced call contact lineage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.calls(organization_id,agent_id,direction,contact_phone,contact_id,contact_type)
    VALUES(public.test_uuid(1),public.test_uuid(11),'outbound','5551234567',public.test_uuid(204),'lead');
    RAISE EXCEPTION 'Browser forged cross-organization contact lineage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.campaign_leads SET status='DNC' WHERE id=public.test_uuid(301);
    RAISE EXCEPTION 'Direct membership advancement unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.campaign_leads SET lead_id=public.test_uuid(202) WHERE id=public.test_uuid(301);
    RAISE EXCEPTION 'Browser replaced disposition lineage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(401),public.test_uuid(501));
    RAISE EXCEPTION 'Legacy tab save unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.advance_campaign_lead(public.test_uuid(305),NULL,public.test_uuid(501),p_operation_id=>public.test_uuid(711),p_expected_version=>0);
    RAISE EXCEPTION 'Cross-org save unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_personal_queue_leads(public.test_uuid(105));
    RAISE EXCEPTION 'Cross-org Personal queue unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(402),public.test_uuid(501),p_operation_id=>public.test_uuid(712),p_expected_version=>0);
    RAISE EXCEPTION 'Another agent call unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(401),public.test_uuid(505),p_operation_id=>public.test_uuid(713),p_expected_version=>0);
    RAISE EXCEPTION 'Missing required notes unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(401),public.test_uuid(507),p_operation_id=>public.test_uuid(714),p_expected_version=>0,p_notes=>'sale');
    RAISE EXCEPTION 'Unconverted Sold unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT test_assert(NOT has_function_privilege('anon','public.get_next_queue_lead(uuid,jsonb)','EXECUTE'),'anon queue sealed');
SELECT test_assert(NOT has_function_privilege('authenticated','public.admit_twilio_outbound(uuid,text,text,text,text)','EXECUTE'),'webhook service only');
SELECT test_assert(NOT has_table_privilege('authenticated','public.dnc_list','TRUNCATE'),'DNC truncate sealed');
RESET ROLE;
SELECT test_assert(NOT has_schema_privilege('authenticated','private','USAGE'),'private schema hidden');
SELECT test_assert(has_function_privilege('authenticated','private.phone_digits_e164ish(text)','EXECUTE'),'index expression writer grant');
SELECT test_assert((SELECT call_attempts=0 FROM public.campaign_leads WHERE id=test_uuid(301)),'failed saves do not advance');
ROLLBACK;

-- A different operation ID cannot mutate an already-saved call or re-count A → B → A.
BEGIN;
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(504),p_operation_id=>test_uuid(730),p_expected_version=>0);
DO $$ BEGIN
  BEGIN PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(401),public.test_uuid(501),p_operation_id=>public.test_uuid(731),p_expected_version=>1);
    RAISE EXCEPTION 'Conflicting duplicate accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT test_assert((public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(504),p_operation_id=>test_uuid(732),p_expected_version=>1)->>'replayed')::boolean,'same-call replay across operation IDs');
SELECT test_assert((SELECT call_attempts=1 AND disposition='No Answer' FROM public.campaign_leads WHERE id=test_uuid(301)),'A B A never recounts or changes saved result');
ROLLBACK;

-- A trigger refusing lock deletion must roll back the call, DNC and membership together.
BEGIN;
CREATE FUNCTION public.test_release_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
CREATE TRIGGER test_release_failure BEFORE DELETE ON public.dialer_lead_locks FOR EACH ROW EXECUTE FUNCTION public.test_release_failure();
SELECT test_actor(12); SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.advance_campaign_lead(public.test_uuid(304),public.test_uuid(402),public.test_uuid(501),p_operation_id=>public.test_uuid(733),p_expected_version=>0);
    RAISE EXCEPTION 'Lock release failure ignored';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
SELECT test_assert((SELECT count(*)=0 FROM public.dnc_list),'failed release rolls back DNC');
SELECT test_assert((SELECT disposition_id IS NULL FROM public.calls WHERE id=test_uuid(402)),'failed release rolls back call disposition');
SELECT test_assert((SELECT call_attempts=0 FROM public.campaign_leads WHERE id=test_uuid(304)),'failed release rolls back advancement');
SELECT test_assert((SELECT count(*)=1 FROM public.dialer_lead_locks WHERE campaign_lead_id=test_uuid(304)),'failed release retains lock');
ROLLBACK;

BEGIN;
-- A new browser call is not a campaign attempt until the signed webhook admits it.
SELECT test_actor(11); SET LOCAL ROLE authenticated;
INSERT INTO public.calls(id,agent_id,organization_id,campaign_id,campaign_lead_id,contact_phone,caller_id_used,direction,status,started_at)
VALUES(test_uuid(410),test_uuid(11),test_uuid(1),test_uuid(101),test_uuid(301),'5551234567','+15559990000','outbound','ringing',now());
SELECT test_assert((public.get_outbound_admission(test_uuid(410))->>'admitted') IS NULL,'missing admission is unknown');
SELECT test_assert((SELECT contact_id=test_uuid(201) AND contact_type='lead' FROM public.calls WHERE id=test_uuid(410)),'campaign contact is derived by the server');
DO $$ BEGIN
  BEGIN PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(410),public.test_uuid(504),p_operation_id=>public.test_uuid(734),p_expected_version=>0);
    RAISE EXCEPTION 'Unadmitted call counted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE public.calls SET dialer_admission_required=false WHERE id=public.test_uuid(410);
    RAISE EXCEPTION 'Browser removed admission requirement';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE; SET LOCAL ROLE service_role;
SELECT test_assert((public.admit_twilio_outbound(test_uuid(410),'synthetic_agent_11','+15551234567','+15559990000','CA00000000000000000000000000000410')->>'admitted')::boolean,'signed admission accepted');
RESET ROLE; SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(410),test_uuid(504),p_operation_id=>test_uuid(734),p_expected_version=>0);
SELECT test_assert((SELECT call_attempts=1 FROM public.campaign_leads WHERE id=test_uuid(301)),'admitted call counted exactly once');
ROLLBACK;

-- All changed public entry points have explicit actor/service ACLs and safe search paths.
SELECT test_assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('advance_campaign_lead','get_next_queue_lead','get_queue_metrics','fetch_and_lock_next_lead',
    'get_personal_queue_leads','check_dialer_dnc','admit_twilio_outbound','get_outbound_admission','claim_lead',
    'release_lead_lock','renew_lead_lock','release_all_agent_locks','force_release_campaign_lead_lock')
    AND (pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
      OR NOT ('search_path=pg_catalog, pg_temp'=ANY(p.proconfig))
      OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0))
),'changed function owner/search_path/PUBLIC/anon ACL audit');

BEGIN;
UPDATE public.leads SET custom_fields='{"private_master_detail":"sensitive"}' WHERE id=test_uuid(201);
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT test_assert((SELECT NOT (j ? 'custom_fields') FROM public.get_personal_queue_leads(test_uuid(101)) j),'Personal DEFINER does not expose master details outside RLS');
ROLLBACK;

BEGIN;
INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,campaign_lead_id,contact_id,contact_type,contact_phone,direction,status,duration)
 VALUES(test_uuid(411),test_uuid(1),test_uuid(11),test_uuid(101),test_uuid(301),test_uuid(201),'lead','5551234567','outbound','completed',35);
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(504),p_operation_id=>test_uuid(740),p_expected_version=>0);
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(411),test_uuid(505),now()+interval '1 day','later',false,test_uuid(741),'later',NULL,1);
DO $$ BEGIN
  BEGIN PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(401),public.test_uuid(504),p_operation_id=>public.test_uuid(740),p_expected_version=>0,p_release_lock=>false);
    RAISE EXCEPTION 'Old Personal receipt overwrote a newer visit';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SELECT test_assert((SELECT call_attempts=2 AND callback_due_at>now() AND disposition_version=2 FROM public.campaign_leads WHERE id=test_uuid(301)),'A B A keeps the newer server result');
ROLLBACK;

BEGIN;
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(504),p_operation_id=>test_uuid(742),p_expected_version=>0,p_release_lock=>false);
SELECT public.advance_campaign_lead(test_uuid(302),NULL,test_uuid(501),p_operation_id=>test_uuid(743),p_expected_version=>0);
SELECT test_assert((public.advance_campaign_lead(test_uuid(301),test_uuid(401),test_uuid(504),p_operation_id=>test_uuid(742),p_expected_version=>1)->>'dnc_suppressed')::boolean,'replay observes newly committed cross-campaign DNC');
ROLLBACK;

BEGIN;
SELECT test_actor(12); SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(304),test_uuid(402),test_uuid(501),p_operation_id=>test_uuid(744),p_expected_version=>0,p_release_lock=>false);
RESET ROLE;
CREATE FUNCTION public.test_release_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
CREATE TRIGGER test_release_failure BEFORE DELETE ON public.dialer_lead_locks FOR EACH ROW EXECUTE FUNCTION public.test_release_failure();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.advance_campaign_lead(public.test_uuid(304),public.test_uuid(402),public.test_uuid(501),p_operation_id=>public.test_uuid(744),p_expected_version=>1,p_release_lock=>true);
    RAISE EXCEPTION 'Replay falsely confirmed a failed lock release';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.release_lead_lock(public.test_uuid(304));
    RAISE EXCEPTION 'Skip falsely confirmed a failed lock release';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
SELECT test_assert((SELECT count(*)=1 FROM public.dialer_lead_locks WHERE campaign_lead_id=test_uuid(304)),'failed replay release retains lock');
SELECT test_assert((SELECT call_attempts=1 FROM public.campaign_leads WHERE id=test_uuid(304)),'failed replay release retains original save');
ROLLBACK;

-- Invalid/inactive profile overrides stale JWT authorization.
BEGIN;
UPDATE public.profiles SET status='Inactive' WHERE id=test_uuid(11);
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.check_dialer_dnc('5551234567'); RAISE EXCEPTION 'Inactive actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
BEGIN;
SELECT test_actor(11,2);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.check_dialer_dnc('5551234567'); RAISE EXCEPTION 'Spoofed org accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

-- Inject a real database DNC failure; the entire disposition transaction must fail.
BEGIN;
CREATE FUNCTION public.test_dnc_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic DNC outage' USING ERRCODE='P0002'; END $$;
CREATE TRIGGER test_dnc_failure BEFORE INSERT ON public.dnc_list FOR EACH ROW EXECUTE FUNCTION public.test_dnc_failure();
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.advance_campaign_lead(public.test_uuid(301),public.test_uuid(401),public.test_uuid(501),p_operation_id=>public.test_uuid(715),p_expected_version=>0);
    RAISE EXCEPTION 'DNC failure swallowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
RESET ROLE;
SELECT test_assert((SELECT disposition_id IS NULL FROM public.calls WHERE id=test_uuid(401)),'call rollback with failed DNC');
SELECT test_assert((SELECT call_attempts=0 AND status='Queued' FROM public.campaign_leads WHERE id=test_uuid(301)),'membership rollback with failed DNC');
SELECT test_assert((SELECT count(*)=0 FROM private.dialer_disposition_receipts),'no false receipt');
ROLLBACK;

-- Refusing a release is part of the transaction, not an ignored follow-up request.
BEGIN;
SELECT test_actor(12);
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(304),test_uuid(402),test_uuid(501),p_operation_id=>test_uuid(716),p_expected_version=>0,p_release_lock=>false);
RESET ROLE;
SELECT test_assert((SELECT count(*)=1 FROM public.dialer_lead_locks WHERE campaign_lead_id=test_uuid(304)),'Save Only retains lock');
SET LOCAL ROLE authenticated;
SELECT public.advance_campaign_lead(test_uuid(304),test_uuid(402),test_uuid(501),p_operation_id=>test_uuid(716),p_expected_version=>1,p_release_lock=>true);
RESET ROLE;
SELECT test_assert((SELECT count(*)=0 FROM public.dialer_lead_locks WHERE campaign_lead_id=test_uuid(304)),'Save Next releases lock after prior save');
SELECT test_assert((SELECT call_attempts=1 FROM public.campaign_leads WHERE id=test_uuid(304)),'Save Only then Next one attempt');
ROLLBACK;
