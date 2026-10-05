-- Synthetic role-executed v2 checks; no production connection or data.
SELECT rt.reset_perms();
CREATE FUNCTION rt.iv(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('f5000000-0000-0000-0000-'||lpad(p_n::text,12,'0'))::uuid $$;
CREATE FUNCTION rt.v2(p_fn text,p_who text,p_mode text,p_agent text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT rt.call(rt.id(p_who),rt.id('O1'),format('SELECT public.%I(''2026-09-01'',''2026-09-29'',%L::uuid,%L)',p_fn,rt.id(p_agent),p_mode));
$$;
DO $$ DECLARE n text;r jsonb; BEGIN
 FOREACH n IN ARRAY ARRAY['call_summary','call_volume','disposition_breakdown','campaign_performance','lead_source_performance'] LOOP
  PERFORM rt.denied('anon v2 '||n,rt.err('anon',NULL,NULL,format('SELECT public.get_report_%s_v2(''2026-09-01'',''2026-09-29'',NULL,''agency'')',n)));
  r:=rt.v2('get_report_'||n||'_v2','ADMIN','personal');
  PERFORM rt.eq('explicit personal '||n,r->>'scope','own');
  PERFORM rt.eq('basis '||n,r->>'basis_version','reports_integrity_v2');
  PERFORM rt.eq('per-response as-of '||n,r->>'as_of',r->'quality'->>'as_of');
  PERFORM rt.denied('agent agency '||n,rt.err('authenticated',rt.id('A1'),rt.id('O1'),format('SELECT public.get_report_%s_v2(''2026-09-01'',''2026-09-29'',NULL,''agency'')',n)));
  PERFORM rt.denied('personal filter escape '||n,rt.err('authenticated',rt.id('ADMIN'),rt.id('O1'),format('SELECT public.get_report_%s_v2(''2026-09-01'',''2026-09-29'',%L,''personal'')',n,rt.id('A1'))));
  PERFORM rt.denied('super foreign filter '||n,rt.err('authenticated',rt.id('SUPER'),rt.id('O1'),format('SELECT public.get_report_%s_v2(''2026-09-01'',''2026-09-29'',%L,''agency'')',n,rt.id('B1'))));
 END LOOP;
 PERFORM rt.denied('scope anon',rt.err('anon',NULL,NULL,'SELECT public.get_report_scope_v2(NULL)'));
 PERFORM rt.denied('unknown scope',rt.err('authenticated',rt.id('ADMIN'),rt.id('O1'),'SELECT public.get_report_scope_v2(''all'')'));
 PERFORM rt.denied('team outside downline',rt.err('authenticated',rt.id('TL'),rt.id('O1'),format('SELECT public.get_report_call_summary_v2(''2026-09-01'',''2026-09-29'',%L,''team'')',rt.id('A3'))));
 r:=rt.call(rt.id('A1'),rt.id('O1'),'SELECT public.get_report_scope_v2(NULL)');
 PERFORM rt.eq('Agent default personal',r->>'requested_scope','personal'); PERFORM rt.eq('Agent export false',r->>'can_export','false');
 UPDATE role_permissions SET permissions=rt.perm(true,true,true,'team',true,true,true,'team') WHERE organization_id=rt.id('O1');
 r:=rt.call(rt.id('A1'),rt.id('O1'),'SELECT public.get_report_scope_v2(''team'')');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'agents') a WHERE a->>'id'=rt.id('A1B')::text) THEN RAISE EXCEPTION 'Agent permitted downline missing'; END IF;
 UPDATE role_permissions SET permissions=jsonb_set(permissions,'{p,1,agent}','"yes"'::jsonb) WHERE organization_id=rt.id('O1');
 PERFORM rt.denied('malformed flag fails closed',rt.err('authenticated',rt.id('A1'),rt.id('O1'),'SELECT public.get_report_scope_v2(NULL)'));
 PERFORM rt.reset_perms();
 -- Source count parity with v1 over malformed/additional/undated fixtures.
 r:=rt.v2('get_report_call_summary_v2','ADMIN','agency');
 PERFORM rt.eq('same stored-policy cohort',r->'totals'->>'policies_sold',rt.summary('ADMIN','2026-09-01','2026-09-29')->'totals'->>'policies_sold');
 PERFORM rt.eq('count and premium cohort',r->'totals'->'premium'->>'policy_count',r->'totals'->>'policies_sold');
END $$;

INSERT INTO organizations VALUES(rt.iv(1),'Synthetic integrity agency');
INSERT INTO company_settings(organization_id,timezone) VALUES(rt.iv(1),'America/Los_Angeles');
INSERT INTO profiles(id,organization_id,first_name,role) VALUES(rt.iv(2),rt.iv(1),'Synthetic admin','Admin'),(rt.iv(3),rt.iv(1),'Synthetic agent','Agent');
INSERT INTO campaigns(id,organization_id,name,type,user_id) VALUES(rt.iv(4),rt.iv(1),'Synthetic one','Personal',rt.iv(3)),(rt.iv(5),rt.iv(1),'Synthetic two','Open Pool',rt.iv(3));
INSERT INTO dispositions(id,organization_id,name) VALUES(rt.iv(6),rt.iv(1),'No Answer');
INSERT INTO dialer_sessions(id,agent_id,organization_id,campaign_id,started_at,last_heartbeat_at,ended_at,status) VALUES
(rt.iv(10),rt.iv(3),rt.iv(1),rt.iv(4),'2026-10-01 08:00Z','2026-10-01 09:00Z',NULL,'active'),
(rt.iv(11),rt.iv(3),rt.iv(1),rt.iv(4),'2026-10-01 08:30Z','2026-10-01 09:30Z','2026-10-01 09:30Z','ended'),
(rt.iv(12),rt.iv(3),rt.iv(1),rt.iv(5),'2026-10-01 09:30Z','2026-10-01 10:00Z','2026-10-01 10:00Z','ended');
INSERT INTO calls(id,organization_id,agent_id,campaign_id,created_at,duration,disposition_id) VALUES
(rt.iv(20),rt.iv(1),rt.iv(3),rt.iv(4),'2026-10-01 08:00Z',46,NULL),
(rt.iv(21),rt.iv(1),rt.iv(3),rt.iv(4),'2026-10-01 09:29Z',45,NULL),
(rt.iv(22),rt.iv(1),rt.iv(3),rt.iv(4),'2026-10-01 09:30Z',10,NULL),
(rt.iv(23),rt.iv(1),rt.iv(3),rt.iv(5),'2026-10-01 09:30Z',100,rt.iv(6)),
(rt.iv(24),rt.iv(1),rt.iv(3),NULL,'2026-10-01 09:40Z',NULL,NULL),
(rt.iv(25),rt.iv(1),rt.iv(3),rt.iv(4),'2026-10-01 08:30Z',60,NULL);
UPDATE calls SET duration_source='elapsed_estimate',duration_conflict=true WHERE id=rt.iv(25);
INSERT INTO appointments(id,organization_id,created_by,user_id,created_at,status,booking_kind) VALUES
(rt.iv(30),rt.iv(1),rt.iv(3),rt.iv(2),'2026-10-01 08:00Z','Cancelled','appointment'),
(rt.iv(31),rt.iv(1),rt.iv(3),rt.iv(2),'2026-10-01 08:00Z','Scheduled',NULL),
(rt.iv(32),rt.iv(1),NULL,rt.iv(3),'2026-10-01 08:30Z','Completed','callback');
CREATE FUNCTION rt.isummary(p_day date DEFAULT '2026-10-01') RETURNS jsonb LANGUAGE sql AS $$
 SELECT rt.call(rt.iv(2),rt.iv(1),format('SELECT public.get_report_call_summary_v2(%L,%L,NULL,''agency'')',p_day,p_day));
$$;
DO $$ DECLARE r jsonb; BEGIN
 r:=rt.isummary();
 PERFORM rt.eq('no-map calls',r->'totals'->>'calls_made','6');
 PERFORM rt.eq('estimate disclosed',r->'quality'->'duration'->>'estimated_calls','1');
 PERFORM rt.eq('conflict disclosed',r->'quality'->'duration'->>'conflicting_calls','1');
 PERFORM rt.eq('no-map bookings all status',r->'totals'->>'appointments_set','3');
 PERFORM rt.eq('overlap union seconds',r->'totals'->>'session_seconds','7200');
 PERFORM rt.eq('overlap removed',r->'quality'->'sessions'->>'overlap_seconds_removed','1800');
 PERFORM rt.eq('yesterday stale zero',rt.isummary('2026-10-04')->'totals'->>'session_seconds','0');
END $$;
INSERT INTO private.performance_duplicate_rows(organization_id,kind,duplicate_id,canonical_id,evidence_hash) VALUES
(rt.iv(1),'call',rt.iv(25),rt.iv(20),'synthetic reviewed evidence'),(rt.iv(1),'appointment',rt.iv(31),rt.iv(30),'synthetic reviewed evidence');
DO $$ DECLARE r jsonb;n text; BEGIN
 BEGIN INSERT INTO private.performance_duplicate_rows(organization_id,kind,duplicate_id,canonical_id,evidence_hash) VALUES(rt.id('O1'),'call',rt.iv(25),rt.iv(20),'invalid'); RAISE EXCEPTION 'cross-org mapping accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 r:=rt.isummary();
 PERFORM rt.eq('mapped calls',r->'totals'->>'calls_made','5');
 PERFORM rt.eq('matched same campaign half-open calls',r->'totals'->>'session_matched_calls','3');
 PERFORM rt.eq('unmatched retained',r->'totals'->>'session_unmatched_calls','2');
 PERFORM rt.eq('matched talk',r->'totals'->>'session_matched_talk_seconds','191');
 PERFORM rt.eq('No Answer and 45s excluded',r->'totals'->>'contacted','1');
 PERFORM rt.eq('bookings setter, cancelled and completed',r->'totals'->>'appointments_set','2');
 PERFORM rt.eq('legacy source preserved',(SELECT count(*)::text FROM calls WHERE organization_id=rt.iv(1)),'6');
 FOREACH n IN ARRAY ARRAY['call_volume','disposition_breakdown','campaign_performance','lead_source_performance'] LOOP
  r:=rt.call(rt.iv(2),rt.iv(1),format('SELECT public.get_report_%s_v2(''2026-10-01'',''2026-10-01'',NULL,''agency'')',n));
  PERFORM rt.eq('mapped shared facts '||n,r->'quality'->'duration'->>'outbound_calls','5');
 END LOOP;
END $$;
-- Stable identity, explicit zero, additional currency strings, malformed/negative/unknown values.
INSERT INTO clients(id,organization_id,assigned_agent_id,carrier,premium,sold_date,primary_policy_id,custom_fields) VALUES
(rt.iv(40),rt.iv(1),rt.iv(3),'Synthetic carrier',10.01,'2026-10-01',rt.iv(140),'{}'),
(rt.iv(41),rt.iv(1),rt.iv(3),'Synthetic carrier',0,'2026-10-01',rt.iv(141),'{}'),
(rt.iv(42),rt.iv(1),rt.iv(3),'Synthetic carrier',0,'2026-10-01',rt.iv(142),'{}'),
(rt.iv(43),rt.iv(1),rt.iv(3),'Synthetic carrier',NULL,'2026-10-01',rt.iv(143),'{"additional_policies":[{"soldDate":"2026-10-01","premiumAmount":"$1,200.50/mo","policyId":"f5000000-0000-0000-0000-000000000144"},{"issueDate":"2026-10-01","premiumAmount":"0"},{"soldDate":"2026-10-01","premiumAmount":"-5"},{"soldDate":"2026-10-01","premiumAmount":"junk"}]}');
INSERT INTO wins(id,organization_id,agent_id,contact_id,policy_id,premium_amount,premium_snapshot) VALUES(rt.iv(50),rt.iv(1),rt.iv(2),rt.iv(42),rt.iv(142),0,true);
DO $$ DECLARE r jsonb;p jsonb; BEGIN
 r:=rt.isummary();p:=r->'totals'->'premium';
 PERFORM rt.eq('8 stored policies',r->'totals'->>'policies_sold','8');
 PERFORM rt.eq('same premium count',p->>'policy_count','8');
 PERFORM rt.eq('4 known including two genuine zeros',p->>'known_count','4');
 PERFORM rt.eq('4 unknown',p->>'unknown_count','4');
 PERFORM rt.eq('currency tolerant annual',(p->>'annual_premium')::numeric,14526.12::numeric);
 PERFORM rt.eq('average known cohort',(p->>'average_annual_premium')::numeric,3631.53::numeric);
 PERFORM rt.eq('ambiguous primary zero',p->>'ambiguous_zero_count','1');
 PERFORM rt.eq('negative/malformed unknown',p->>'invalid_count','2');
 r:=rt.call(rt.iv(2),rt.iv(1),'SELECT public.get_report_campaign_performance_v2(''2026-10-01'',''2026-10-01'',NULL,''agency'')');
 PERFORM rt.eq('campaign unknown subset',r->'premium_attribution_unavailable'->>'policy_count','8');
 PERFORM rt.eq('campaign premium reconciliation',(r->'premium_attribution_unavailable'->>'annual_premium')::numeric,14526.12::numeric);
 PERFORM rt.eq('empty premium zero',rt.isummary('2026-10-04')->'totals'->'premium'->>'annual_premium','0');
 UPDATE clients SET assigned_agent_id=rt.iv(2),premium=NULL WHERE id=rt.iv(40);
 r:=rt.call(rt.iv(2),rt.iv(1),'SELECT public.get_report_call_summary_v2(''2026-10-01'',''2026-10-01'',NULL,''personal'')');
 PERFORM rt.eq('reassignment count',r->'totals'->>'policies_sold','1');
 PERFORM rt.eq('all-unknown unavailable',r->'totals'->'premium'->'annual_premium','null'::jsonb);
 PERFORM rt.eq('all-unknown coverage',r->'totals'->'premium'->>'known_count','0');
END $$;
-- Fresh liveness, missing heartbeat, clipping and DST are exercised against explicit timestamps.
ALTER TABLE dialer_sessions ALTER COLUMN last_heartbeat_at DROP NOT NULL;
INSERT INTO dialer_sessions(id,agent_id,organization_id,campaign_id,started_at,last_heartbeat_at,status) VALUES
(rt.iv(60),rt.iv(2),rt.iv(1),rt.iv(4),now()-interval '100 seconds',now()-interval '10 seconds','active'),
(rt.iv(61),rt.iv(2),rt.iv(1),rt.iv(4),now()-interval '1 hour',NULL,'active');
DO $$ DECLARE n bigint;r jsonb; BEGIN
 SELECT session_seconds INTO n FROM private.report_session_seconds(rt.iv(1),now()-interval '1 day',now()+interval '1 day',ARRAY[rt.iv(2)]);
 PERFORM rt.eq('fresh active bounded at as-of',n,100::bigint);
 r:=private.report_integrity_quality(rt.iv(1),now()-interval '1 day',now()+interval '1 day',ARRAY[rt.iv(2)]);
 PERFORM rt.eq('missing heartbeat disclosed',r->'sessions'->>'missing_evidence','1');
 PERFORM rt.eq('spring DST hours',(SELECT extract(epoch FROM end_at-start_at)/3600 FROM private.report_window(rt.iv(1),'2026-03-08','2026-03-08')),23::numeric);
 PERFORM rt.eq('fall DST hours',(SELECT extract(epoch FROM end_at-start_at)/3600 FROM private.report_window(rt.iv(1),'2026-11-01','2026-11-01')),25::numeric);
END $$;
SELECT 'Reports v2 integrity assertions passed' AS result;
