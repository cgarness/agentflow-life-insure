-- Reports v2 recovery: apply transactionally as a NEW migration only after release approval.
-- Disable-only is the emergency response. Re-enable only these exact reviewed bodies.
-- Keeps v1 disabled and legacy rpc_report_* sealed. No data, RLS or writer changes.
SET LOCAL lock_timeout='5s';
DO $enable$ DECLARE f record; sig text; client_role text; expected_execute boolean; BEGIN
 FOR f IN SELECT * FROM (VALUES
  ('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])','245c7ce4f7bf47f6347595822f70a947',false,'s'),
  ('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])','3d33b720751a1913c81ad284ae6ffd43',true,'s'),
  ('private.report_call_facts(uuid,timestamp with time zone,timestamp with time zone,uuid[])','bacbfd0629221957cae28ba28728c8bd',true,'s'),
  ('public.get_report_call_summary(date,date,uuid)','34cdfab92f6acaa5a383c743088c1720',true,'s'),
  ('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])','c1355d551fba0cc2217150f5531d1b31',false,'s'),
  ('private.report_access_v2(text,uuid)','a221335ae305cee01097bc796d5e7cdd',true,'s'),
  ('private.report_monthly_amount(text)','405647c4982f4b9475f834efa6f2beee',false,'i'),
  ('private.report_policy_value_facts(uuid,uuid[])','f543eeb4ee5aa7906e3225527d873935',false,'s'),
  ('private.report_premium_totals(bigint,bigint,numeric,bigint,bigint,bigint)','31dcd20548aea901f074a5fd9526518c',false,'i'),
  ('public.get_report_scope_v2(text)','26a2d64831975668a492dfda2e369aac',true,'s'),
  ('public.get_report_call_summary_v2(date,date,uuid,text)','23c21fa14b07edaeaa3901e76b243d66',true,'s'),
  ('public.get_report_call_volume_v2(date,date,uuid,text)','a4a5e82f36e124fa8ee9d581229ef455',true,'s'),
  ('public.get_report_disposition_breakdown_v2(date,date,uuid,text)','ae4611201b9add696bfd92f4576fdd7b',true,'s'),
  ('public.get_report_campaign_performance_v2(date,date,uuid,text)','8d8bee228b2bed67076e2547f506264d',true,'s'),
  ('public.get_report_lead_source_performance_v2(date,date,uuid,text)','8d85fff93300966502964b500eb46166',true,'s')
 ) AS expected(signature,body_md5,is_definer,volatility) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f.signature)
   AND md5(prosrc)=f.body_md5 AND proowner='postgres'::regrole AND prosecdef=f.is_definer
   AND provolatile::text=f.volatility AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']) THEN
   RAISE EXCEPTION 'Reports integrity enable: unverified body or authorization metadata: %',f.signature;
  END IF;
 END LOOP;
 -- Seal every report helper and old public version before restoring only v2 browser access.
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname LIKE 'report\_%')
     OR (n.nspname='public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.oid::regprocedure);
 END LOOP;
 FOREACH sig IN ARRAY ARRAY[
  'public.get_report_scope_v2(text)',
  'public.get_report_call_summary_v2(date,date,uuid,text)',
  'public.get_report_call_volume_v2(date,date,uuid,text)',
  'public.get_report_disposition_breakdown_v2(date,date,uuid,text)',
  'public.get_report_campaign_performance_v2(date,date,uuid,text)',
  'public.get_report_lead_source_performance_v2(date,date,uuid,text)'
 ] LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',to_regprocedure(sig));
 END LOOP;
 -- Effective privileges include inherited grants; never silently commit a broken seal.
 FOR f IN SELECT p.oid,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname LIKE 'report\_%')
     OR (n.nspname='public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   expected_execute:=client_role<>'anon' AND f.nspname='public' AND f.proname IN
    ('get_report_scope_v2','get_report_call_summary_v2','get_report_call_volume_v2','get_report_disposition_breakdown_v2','get_report_campaign_performance_v2','get_report_lead_source_performance_v2');
   IF has_function_privilege(client_role,f.oid,'EXECUTE') IS DISTINCT FROM expected_execute THEN
    RAISE EXCEPTION 'Reports integrity enable: effective privilege mismatch for % on %',client_role,f.oid::regprocedure;
   END IF;
  END LOOP;
 END LOOP;
END $enable$;
NOTIFY pgrst,'reload schema';
