-- Setup for independent-connection tests in scripts/run_dialer_dnc_tests.sh.
-- No sleeps/mocks stand in for PostgreSQL row/advisory locks.
INSERT INTO public.campaign_leads(id,organization_id,campaign_id,lead_id,phone,user_id,created_at)
 VALUES(test_uuid(306),test_uuid(1),test_uuid(103),test_uuid(203),'5551234568',test_uuid(11),now()+interval '1 second');
