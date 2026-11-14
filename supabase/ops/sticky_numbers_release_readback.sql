-- Read-only post-release inspection. Production execution is a separately approved release step.
SELECT n.nspname AS schema,p.proname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl,
 md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='private' AND p.proname LIKE 'affinity_%')
 OR (n.nspname='public' AND p.proname IN ('preview_contact_numbers','contact_number_options','contact_number_modes','authorize_contact_call','change_contact_number','recover_contact_numbers','sticky_number_guard','sms_prepare_dispatch','sms_prepare_bound_dispatch','sms_authorize_bound_dispatch','sms_start_dispatch','sms_cancel_prepared_dispatch','sms_finish_dispatch','sms_describe_contact_sender','observe_contact_inbound_sms','reconcile_contact_number_history','set_contact_number_modes','admit_twilio_outbound','ingest_inbound_call','claim_inbound_call'))
ORDER BY n.nspname,p.proname;
SELECT c.relname,c.relrowsecurity,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname LIKE 'contact_number_%' AND c.relkind='r' ORDER BY c.relname;
SELECT rolname,rolcanlogin,rolbypassrls,rolsuper FROM pg_roles WHERE rolname='agentflow_affinity_scope';
SELECT organization_id,voice_mode,sms_mode FROM private.contact_number_settings;
SELECT organization_id,voice_ever,sms_ever FROM private.contact_number_enforcement;
SELECT organization_id,state,count(*) FROM public.sms_dispatches WHERE affinity_number_id IS NOT NULL GROUP BY organization_id,state;
