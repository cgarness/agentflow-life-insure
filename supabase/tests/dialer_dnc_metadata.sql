-- Definition/ACL fingerprint manifest; no operational data or credentials.
SELECT jsonb_pretty(jsonb_agg(jsonb_build_object(
  'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
  'security_definer',p.prosecdef,'search_path',p.proconfig,'acl',p.proacl::text,
  'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY n.nspname,p.proname))
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='private' AND p.proname IN ('phone_digits_e164ish','dnc_phone_lock_key','is_dnc_phone',
  'guard_dnc_phone','try_queue_phone','guard_dialer_core_write','capture_dialer_conversion_lineage'))
 OR (n.nspname='public' AND p.proname IN ('advance_campaign_lead','get_next_queue_lead','get_queue_metrics',
  'fetch_and_lock_next_lead','get_personal_queue_leads','check_dialer_dnc','admit_twilio_outbound','get_outbound_admission',
  'claim_lead','release_lead_lock','renew_lead_lock','release_all_agent_locks','force_release_campaign_lead_lock'));
