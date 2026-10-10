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

-- =====================================================================================================
-- T-1..T-6 regression coverage (2026-10-09 refresh plan §4.3). Every row below lives in SEPARATE synthetic
-- organizations (prefix f5100000): a regression agency (America/Los_Angeles), a Havana agency and a
-- foreign agency. The integrity organization above and its 2026-10-01 payloads are not touched.
-- Expected values are computed by hand from the rows' comments. Session rows use past dates because
-- spans are clipped at now(); calls may be future-dated (2026-11-01).
-- =====================================================================================================
CREATE FUNCTION rt.tv(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('f5100000-0000-0000-0000-'||lpad(p_n::text,12,'0'))::uuid $$;
-- One v2 RPC as a database-role caller of a regression organization (default: regression agency).
CREATE FUNCTION rt.tr(p_fn text,p_uid integer,p_start date,p_end date,p_scope text DEFAULT 'agency',p_agent integer DEFAULT NULL,p_org integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT rt.call(rt.tv(p_uid),rt.tv(p_org),format('SELECT public.get_report_%s_v2(%L,%L,%L::uuid,%L)',p_fn,p_start,p_end,rt.tv(p_agent),p_scope));
$$;
-- Volume buckets in server order. by_date lists every row (date=calls/contacted/inbound/talk); by_hour
-- (hour=), by_day_of_week (dow_name=) and heatmap (dow:hour=) list non-zero buckets as calls/contacted.
CREATE FUNCTION rt.tb(p jsonb,p_key text) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(CASE p_key
   WHEN 'by_date' THEN (e->>'date')||'='||(e->>'calls_made')||'/'||(e->>'contacted')||'/'||(e->>'inbound_calls')||'/'||(e->>'talk_time_seconds')
   WHEN 'by_hour' THEN (e->>'hour')||'='||(e->>'calls_made')||'/'||(e->>'contacted')
   WHEN 'by_day_of_week' THEN (e->>'dow_name')||'='||(e->>'calls_made')||'/'||(e->>'contacted')
   ELSE (e->>'dow')||':'||(e->>'hour')||'='||(e->>'calls_made')||'/'||(e->>'contacted') END,',' ORDER BY o),'')
 FROM jsonb_array_elements(p->p_key) WITH ORDINALITY x(e,o) WHERE p_key='by_date' OR (e->>'calls_made')::int>0;
$$;
-- Shape: hours/dows/cells/misplaced cells (position <> dow*24+hour)/Σhour/Σdow/Σcells/Σdate calls.
CREATE FUNCTION rt.tshape(p jsonb) RETURNS text LANGUAGE sql AS $$
 SELECT jsonb_array_length(p->'by_hour')||'/'||jsonb_array_length(p->'by_day_of_week')||'/'||jsonb_array_length(p->'heatmap')
  ||'/'||(SELECT count(*) FROM jsonb_array_elements(p->'heatmap') WITH ORDINALITY x(e,o) WHERE o-1<>(e->>'dow')::int*24+(e->>'hour')::int)
  ||'/'||(SELECT sum((e->>'calls_made')::int) FROM jsonb_array_elements(p->'by_hour') e)
  ||'/'||(SELECT sum((e->>'calls_made')::int) FROM jsonb_array_elements(p->'by_day_of_week') e)
  ||'/'||(SELECT sum((e->>'calls_made')::int) FROM jsonb_array_elements(p->'heatmap') e)
  ||'/'||(SELECT sum((e->>'calls_made')::int) FROM jsonb_array_elements(p->'by_date') e);
$$;
CREATE FUNCTION rt.twin(p jsonb) RETURNS text LANGUAGE sql AS $$ SELECT (p->'window'->>'start_at')||'/'||(p->'window'->>'end_at') $$;
CREATE FUNCTION rt.ta(p jsonb,p_n integer,p_field text) RETURNS text LANGUAGE sql AS $$
 SELECT e->>p_field FROM jsonb_array_elements(p->'by_agent') e WHERE (e->>'agent_id')::uuid=rt.tv(p_n);
$$;
CREATE FUNCTION rt.tsec(p_uid integer,p_start date,p_end date,p_org integer DEFAULT 1) RETURNS text LANGUAGE sql AS $$
 SELECT rt.tr('call_summary',p_uid,p_start,p_end,'agency',NULL,p_org)->'totals'->>'session_seconds';
$$;
-- Restricted or foreign campaign ids and names, and the foreign lead source, present in a payload's text.
CREATE FUNCTION rt.tleaks(p jsonb) RETURNS integer LANGUAGE sql AS $$
 SELECT count(*)::int FROM unnest(ARRAY[rt.tv(54)::text,rt.tv(55)::text,rt.tv(56)::text,rt.tv(57)::text,rt.tv(58)::text,rt.tv(260)::text,
   'Restricted','Foreign']) n WHERE position(n IN p::text)>0;
$$;

INSERT INTO organizations(id,name) VALUES(rt.tv(1),'Synthetic regression agency'),(rt.tv(101),'Synthetic Havana agency'),(rt.tv(201),'Synthetic foreign agency');
INSERT INTO company_settings(organization_id,timezone) VALUES(rt.tv(1),'America/Los_Angeles'),(rt.tv(101),'America/Havana'),(rt.tv(201),'America/Los_Angeles');
-- Production-shaped permissions: Agent page + own (scope own); Team Leader page + own + team (scope team).
INSERT INTO role_permissions(organization_id,role,permissions) VALUES
(rt.tv(1),'Agent',rt.perm(true,true,false,'own',true,true,true,'team')),(rt.tv(1),'Team Leader',rt.perm(true,true,false,'own',true,true,true,'team'));
INSERT INTO profiles(id,organization_id,first_name,last_name,role,status,upline_id) VALUES
(rt.tv(2),rt.tv(1),'Reg','Admin','Admin','Active',NULL),
(rt.tv(3),rt.tv(1),'Reg','Leader','Team Leader','Active',rt.tv(2)),
(rt.tv(4),rt.tv(1),'Reg','Setter','Agent','Active',rt.tv(3)),     -- S: sets bookings (T-5)
(rt.tv(5),rt.tv(1),'Reg','Assignee','Agent','Active',rt.tv(3)),   -- A: assigned (user_id) on S's bookings (T-5)
(rt.tv(6),rt.tv(1),'Reg','Caller','Agent','Active',rt.tv(2)),     -- C: bucket calls (T-1)
(rt.tv(7),rt.tv(1),'Reg','Viewer','Agent','Active',rt.tv(3)),     -- X: campaign-visibility subject (T-6)
(rt.tv(8),rt.tv(1),'Reg','Other','Agent','Active',rt.tv(3)),      -- Y: owns X's restricted campaigns
(rt.tv(9),rt.tv(1),'Reg','Seller','Agent','Active',rt.tv(2)),     -- P: policies (T-3)
(rt.tv(10),rt.tv(1),'Reg','Dialer','Agent','Active',rt.tv(2)),    -- Z: sessions (T-2)
(rt.tv(102),rt.tv(101),'Hav','Admin','Admin','Active',NULL),(rt.tv(103),rt.tv(101),'Hav','Agent','Agent','Active',rt.tv(102)),
(rt.tv(202),rt.tv(201),'For','Admin','Admin','Active',NULL);
INSERT INTO pipeline_stages(id,name,convert_to_client,organization_id) VALUES(rt.tv(25),'Won',true,rt.tv(1));
INSERT INTO dispositions(id,organization_id,name,counts_as_contacted,callback_scheduler,pipeline_stage_id) VALUES
(rt.tv(20),rt.tv(1),'No Answer',false,false,NULL),(rt.tv(21),rt.tv(1),'Interested',true,false,NULL),
(rt.tv(22),rt.tv(1),'Sold',true,false,rt.tv(25)),(rt.tv(23),rt.tv(1),'Call Back',false,true,NULL);
INSERT INTO campaigns(id,organization_id,name,type,user_id,assigned_agent_ids) VALUES
(rt.tv(50),rt.tv(1),'Regression open one','Open Pool',rt.tv(2),'[]'),
(rt.tv(51),rt.tv(1),'Regression open two',' open ',rt.tv(2),'[]'),                              -- lower case, padded: visible
(rt.tv(52),rt.tv(1),'Regression own personal','Personal',rt.tv(7),'[]'),                       -- X's own: visible
(rt.tv(53),rt.tv(1),'Regression team member','Team',rt.tv(2),jsonb_build_array(rt.tv(7)::text)),-- X is a member: visible
(rt.tv(54),rt.tv(1),'Restricted personal other','Personal',rt.tv(8),jsonb_build_array(rt.tv(7)::text)), -- restricted for X
(rt.tv(55),rt.tv(1),'Restricted team non-member','Team',rt.tv(2),jsonb_build_array(rt.tv(8)::text)),    -- restricted for X
(rt.tv(56),rt.tv(1),'Restricted team object ids','Team',rt.tv(2),jsonb_build_object('a',rt.tv(7)::text)),-- restricted (not an array)
(rt.tv(57),rt.tv(1),'Restricted custom type','Custom',rt.tv(7),jsonb_build_array(rt.tv(7)::text)),      -- restricted (unknown type)
(rt.tv(58),rt.tv(1),'Restricted personal no owner','Personal',NULL,jsonb_build_array(rt.tv(7)::text)),  -- restricted (no owner)
(rt.tv(260),rt.tv(201),'Foreign open pool','Open Pool',NULL,'[]');                              -- another organization
INSERT INTO leads(id,organization_id,lead_source,assigned_agent_id,created_at) VALUES
(rt.tv(40),rt.tv(1),'Web',rt.tv(6),'2026-09-01 12:00Z'),(rt.tv(41),rt.tv(1),'Reg Source',rt.tv(7),'2026-09-01 12:00Z'),
(rt.tv(270),rt.tv(201),'Foreign leak source',rt.tv(7),'2026-09-22 12:00Z');
INSERT INTO campaign_leads(id,organization_id,campaign_id,lead_id) VALUES
(rt.tv(45),rt.tv(1),rt.tv(50),rt.tv(40)),(rt.tv(46),rt.tv(1),rt.tv(51),rt.tv(40)),(rt.tv(47),rt.tv(1),rt.tv(55),rt.tv(41));
-- T-1 fixture day D1 = 2026-09-16 (Wednesday, PDT = UTC-7), agent C.
INSERT INTO calls(id,organization_id,agent_id,direction,created_at,duration,disposition_id,disposition_name,campaign_id,campaign_lead_id,contact_id,contact_type) VALUES
(rt.tv(37),rt.tv(1),rt.tv(6),'outbound','2026-09-16 07:10Z',0,NULL,NULL,NULL,NULL,NULL,NULL),           -- 00:10 h0
(rt.tv(30),rt.tv(1),rt.tv(6),'OUTGOING','2026-09-16 15:15Z',50,NULL,NULL,NULL,NULL,NULL,NULL),          -- 08:15 h8, contacted (>45 s)
(rt.tv(31),rt.tv(1),rt.tv(6),'Outgoing','2026-09-16 15:40Z',10,NULL,'INTERESTED',NULL,NULL,NULL,NULL),  -- 08:40 h8, name fallback -> Interested, contacted
(rt.tv(36),rt.tv(1),rt.tv(6),'Incoming','2026-09-16 16:00Z',40,NULL,NULL,NULL,NULL,NULL,NULL),          -- 09:00 inbound only
(rt.tv(32),rt.tv(1),rt.tv(6),'outbound','2026-09-16 20:05Z',100,NULL,'NO ANSWER',NULL,NULL,NULL,NULL), -- 13:05 h13, name fallback -> No Answer, not contacted
(rt.tv(33),rt.tv(1),rt.tv(6),'outbound','2026-09-16 20:30Z',5,NULL,' Mystery ',NULL,NULL,NULL,NULL),    -- 13:30 h13, unresolved name key
(rt.tv(34),rt.tv(1),rt.tv(6),'outbound','2026-09-17 00:00Z',30,rt.tv(22),NULL,rt.tv(50),rt.tv(45),rt.tv(40),'lead'), -- 17:00 h17, Sold via membership 1
(rt.tv(35),rt.tv(1),rt.tv(6),'outbound','2026-09-17 06:30Z',20,rt.tv(22),NULL,NULL,rt.tv(46),rt.tv(40),'lead'),      -- 23:30 h23, Sold, same contact via membership 2
(rt.tv(38),rt.tv(1),rt.tv(6),'outbound','2026-09-16 06:59:59Z',10,NULL,NULL,NULL,NULL,NULL,NULL),       -- 09-15 23:59:59 (Tue h23)
(rt.tv(39),rt.tv(1),rt.tv(6),'outbound','2026-09-17 07:00Z',10,NULL,NULL,NULL,NULL,NULL,NULL);          -- 09-17 00:00 (Thu h0)
-- T-1 DST days, agent C. Spring 2026-03-08 has no hour 2 (23 h); fall 2026-11-01 repeats hour 1 (25 h).
INSERT INTO calls(id,organization_id,agent_id,direction,created_at,duration) VALUES
(rt.tv(63),rt.tv(1),rt.tv(6),'outbound','2026-03-08 07:59:59Z',10),  -- 03-07 23:59:59 PST: outside
(rt.tv(60),rt.tv(1),rt.tv(6),'outbound','2026-03-08 09:30Z',50),     -- 01:30 PST h1, contacted
(rt.tv(61),rt.tv(1),rt.tv(6),'outbound','2026-03-08 10:30Z',10),     -- 03:30 PDT h3
(rt.tv(62),rt.tv(1),rt.tv(6),'outbound','2026-03-09 06:59:59Z',30),  -- 23:59:59 PDT h23
(rt.tv(64),rt.tv(1),rt.tv(6),'outbound','2026-03-09 07:00Z',10),     -- 03-09 00:00 PDT: outside
(rt.tv(69),rt.tv(1),rt.tv(6),'outbound','2026-11-01 06:59:59Z',10),  -- 10-31 23:59:59 PDT: outside
(rt.tv(65),rt.tv(1),rt.tv(6),'outbound','2026-11-01 08:30Z',60),     -- first 01:30 (PDT) h1, contacted
(rt.tv(66),rt.tv(1),rt.tv(6),'outbound','2026-11-01 09:30Z',5),      -- second 01:30 (PST) h1
(rt.tv(71),rt.tv(1),rt.tv(6),'inbound','2026-11-01 09:45Z',40),      -- 01:45 PST inbound only
(rt.tv(67),rt.tv(1),rt.tv(6),'outbound','2026-11-01 15:00Z',47),     -- 07:00 PST h7, estimate, contacted
(rt.tv(68),rt.tv(1),rt.tv(6),'outbound','2026-11-02 07:59:59Z',10),  -- 23:59:59 PST h23
(rt.tv(70),rt.tv(1),rt.tv(6),'outbound','2026-11-02 08:00Z',10);     -- 11-02 00:00 PST: outside
UPDATE calls SET duration_source='elapsed_estimate' WHERE id=rt.tv(67);
-- T-1 Havana: local midnight occurs twice on 2026-11-01 (00:00 CDT = 04:00Z, then 00:00 CST = 05:00Z).
INSERT INTO calls(id,organization_id,agent_id,direction,created_at,duration) VALUES
(rt.tv(110),rt.tv(101),rt.tv(103),'outbound','2026-11-01 03:59:59Z',10), -- 10-31 23:59:59 CDT
(rt.tv(111),rt.tv(101),rt.tv(103),'outbound','2026-11-01 04:00Z',10),    -- 11-01 00:00 CDT (first midnight)
(rt.tv(112),rt.tv(101),rt.tv(103),'outbound','2026-11-01 05:00Z',10),    -- 11-01 00:00 CST (second midnight)
(rt.tv(113),rt.tv(101),rt.tv(103),'outbound','2026-11-02 04:59:59Z',10), -- 11-01 23:59:59 CST
(rt.tv(114),rt.tv(101),rt.tv(103),'outbound','2026-11-02 05:00Z',10);    -- 11-02 00:00 CST: outside
-- T-2 sessions (past dates): Z crosses 2026-09-15 00:00 PDT with an overlapping row; C has one later span.
INSERT INTO dialer_sessions(id,agent_id,organization_id,campaign_id,started_at,last_heartbeat_at,ended_at,status) VALUES
(rt.tv(80),rt.tv(10),rt.tv(1),NULL,'2026-09-15 06:00Z','2026-09-15 08:00Z','2026-09-15 08:00Z','ended'),   -- 09-14 23:00 -> 09-15 01:00 PDT
(rt.tv(81),rt.tv(10),rt.tv(1),NULL,'2026-09-15 06:30Z','2026-09-15 07:30Z','2026-09-15 07:30Z','ended'),   -- 09-14 23:30 -> 09-15 00:30 (inside 80)
(rt.tv(82),rt.tv(6),rt.tv(1),NULL,'2026-09-16 05:00Z','2026-09-16 06:00Z','2026-09-16 06:00Z','ended'),    -- 09-15 22:00 -> 23:00 PDT
(rt.tv(83),rt.tv(10),rt.tv(1),NULL,'2026-03-08 07:00Z','2026-03-09 08:00Z','2026-03-09 08:00Z','ended'),   -- 03-07 23:00 PST -> 03-09 01:00 PDT
(rt.tv(84),rt.tv(10),rt.tv(1),NULL,'2025-11-02 06:30Z','2025-11-03 08:30Z','2025-11-03 08:30Z','ended'),   -- 2025-11-01 23:30 PDT -> 11-03 00:30 PST
(rt.tv(140),rt.tv(103),rt.tv(101),NULL,'2025-11-02 03:30Z','2025-11-02 05:30Z','2025-11-02 05:30Z','ended'); -- 11-01 23:30 CDT -> 11-02 00:30 CST
-- T-3 one client sold 2026-09-17: known primary 100/mo, an additional with NO premium, an additional with "0".
INSERT INTO clients(id,organization_id,assigned_agent_id,carrier,premium,sold_date,primary_policy_id,custom_fields) VALUES
(rt.tv(90),rt.tv(1),rt.tv(9),'Regression carrier',100,'2026-09-17',rt.tv(190),jsonb_build_object('additional_policies',jsonb_build_array(
  jsonb_build_object('soldDate','2026-09-17','policyId',rt.tv(191)::text),
  jsonb_build_object('soldDate','2026-09-17','premiumAmount','0','policyId',rt.tv(192)::text))));
-- T-5 day D5 = 2026-09-18 = [09-18 07:00Z, 09-19 07:00Z). Credit = coalesce(created_by,user_id); every status counts.
INSERT INTO calls(id,organization_id,agent_id,direction,created_at,duration,disposition_id) VALUES
(rt.tv(150),rt.tv(1),rt.tv(4),'outbound','2026-09-18 17:00Z',30,rt.tv(23)),  -- S callback disposition: callback_calls 1
(rt.tv(151),rt.tv(1),rt.tv(4),'inbound','2026-09-18 17:20Z',40,rt.tv(23)),   -- S inbound callback disposition: never counted
(rt.tv(152),rt.tv(1),rt.tv(5),'outbound','2026-09-18 18:00Z',50,NULL);       -- A, no disposition
INSERT INTO appointments(id,organization_id,created_by,user_id,created_at,status,booking_kind) VALUES
(rt.tv(160),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-18 22:00Z','Scheduled','appointment'),     -- B1  S
(rt.tv(161),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-18 22:10Z','Cancelled','appointment'),     -- B2  S, cancelled
(rt.tv(162),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-18 22:20Z','Completed',NULL),              -- B3  S, completed, unknown kind
(rt.tv(163),rt.tv(1),NULL,rt.tv(5),'2026-09-18 22:30Z','Completed','callback'),            -- B4  A by user_id fallback
(rt.tv(164),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-18 17:01Z','Scheduled','callback'),        -- B5  S, callback booking
(rt.tv(165),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-18 22:00Z','Scheduled','appointment'),     -- B6  reviewed duplicate of B1: excluded
(rt.tv(166),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-18 22:00Z','Scheduled','appointment'),     -- B7  identical look-alike, not mapped: S
(rt.tv(167),rt.tv(1),rt.tv(5),rt.tv(4),'2026-09-18 23:00Z','No Show','appointment'),       -- B8  reverse: A sets for S -> A
(rt.tv(168),rt.tv(1),NULL,NULL,'2026-09-18 23:30Z','Scheduled','appointment'),             -- B9  unattributed
(rt.tv(169),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-18 06:59:59Z','Scheduled','appointment'),  -- B10 09-17 23:59:59 PDT
(rt.tv(170),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-19 06:59:59Z','Confirmed','appointment'),  -- B11 09-18 23:59:59 PDT: S
(rt.tv(171),rt.tv(1),rt.tv(4),rt.tv(5),'2026-09-19 07:00Z','Scheduled','appointment'),     -- B12 09-19 00:00 PDT (half-open)
(rt.tv(172),rt.tv(201),rt.tv(4),rt.tv(5),'2026-09-18 22:00Z','Scheduled','appointment');   -- B13 foreign organization, same people ids
INSERT INTO private.performance_duplicate_rows(organization_id,kind,duplicate_id,canonical_id,evidence_hash) VALUES
(rt.tv(1),'appointment',rt.tv(165),rt.tv(160),'synthetic reviewed regression evidence');
-- T-6 day D6 = 2026-09-22, Agent X (personal scope).
INSERT INTO calls(id,organization_id,agent_id,direction,created_at,duration,campaign_id,campaign_lead_id,lead_id,contact_id,contact_type) VALUES
(rt.tv(300),rt.tv(1),rt.tv(7),'outbound','2026-09-22 16:00Z',60,rt.tv(50),NULL,NULL,NULL,NULL),  -- visible open pool, contacted
(rt.tv(301),rt.tv(1),rt.tv(7),'outbound','2026-09-22 16:10Z',10,rt.tv(51),NULL,NULL,NULL,NULL),  -- visible ' open '
(rt.tv(302),rt.tv(1),rt.tv(7),'outbound','2026-09-22 16:20Z',50,rt.tv(52),NULL,NULL,NULL,NULL),  -- visible own personal, contacted
(rt.tv(303),rt.tv(1),rt.tv(7),'outbound','2026-09-22 16:30Z',20,rt.tv(53),NULL,NULL,NULL,NULL),  -- visible team member
(rt.tv(304),rt.tv(1),rt.tv(7),'outbound','2026-09-22 17:00Z',70,rt.tv(54),NULL,NULL,NULL,NULL),  -- restricted
(rt.tv(305),rt.tv(1),rt.tv(7),'outbound','2026-09-22 17:10Z',10,rt.tv(55),NULL,NULL,NULL,NULL),  -- restricted
(rt.tv(306),rt.tv(1),rt.tv(7),'outbound','2026-09-22 17:20Z',10,rt.tv(56),NULL,NULL,NULL,NULL),  -- restricted
(rt.tv(307),rt.tv(1),rt.tv(7),'outbound','2026-09-22 17:30Z',10,rt.tv(57),NULL,NULL,NULL,NULL),  -- restricted
(rt.tv(308),rt.tv(1),rt.tv(7),'outbound','2026-09-22 17:40Z',10,rt.tv(58),NULL,NULL,NULL,NULL),  -- restricted
(rt.tv(309),rt.tv(1),rt.tv(7),'outbound','2026-09-22 17:50Z',10,rt.tv(260),NULL,NULL,NULL,NULL), -- foreign campaign id: no campaign
(rt.tv(310),rt.tv(1),rt.tv(7),'outbound','2026-09-22 18:00Z',46,NULL,rt.tv(47),NULL,rt.tv(41),'lead'), -- restricted through campaign_leads only
(rt.tv(311),rt.tv(1),rt.tv(7),'outbound','2026-09-22 18:10Z',10,NULL,NULL,rt.tv(270),NULL,NULL), -- foreign lead: no lead
(rt.tv(312),rt.tv(1),rt.tv(7),'inbound','2026-09-22 18:20Z',80,rt.tv(55),NULL,NULL,NULL,NULL);   -- restricted inbound

-- T-1 bucket values: agency-zone clock hours, local dates and days of week; inbound and outbound kept apart.
DO $$ DECLARE v jsonb;s jsonb;d jsonb;c jsonb;l jsonb; BEGIN
 v:=rt.tr('call_volume',2,'2026-09-16','2026-09-16');s:=rt.tr('call_summary',2,'2026-09-16','2026-09-16');
 PERFORM rt.eq('T-1 day window',rt.twin(v),'2026-09-16T07:00:00Z/2026-09-17T07:00:00Z');
 PERFORM rt.eq('T-1 day by_date',rt.tb(v,'by_date'),'2026-09-16=7/4/1/215');
 PERFORM rt.eq('T-1 day by_hour',rt.tb(v,'by_hour'),'0=1/0,8=2/2,13=2/0,17=1/1,23=1/1');
 PERFORM rt.eq('T-1 day by_day_of_week',rt.tb(v,'by_day_of_week'),'Wed=7/4');
 PERFORM rt.eq('T-1 day heatmap',rt.tb(v,'heatmap'),'3:0=1/0,3:8=2/2,3:13=2/0,3:17=1/1,3:23=1/1');
 PERFORM rt.eq('T-1 day shape',rt.tshape(v),'24/7/168/0/7/7/7/7');
 PERFORM rt.eq('T-1 summary outbound/inbound/total/contacted',concat_ws('/',s->'totals'->>'calls_made',s->'totals'->>'inbound_calls',s->'totals'->>'total_calls',s->'totals'->>'contacted'),'7/1/8/4');
 PERFORM rt.eq('T-1 summary outbound/inbound talk',(s->'totals'->>'talk_time_seconds')||'/'||(s->'totals'->>'inbound_talk_seconds'),'215/40');
 PERFORM rt.eq('T-1 converted identity: one contact, two memberships',s->'totals'->>'converted','1');
 PERFORM rt.eq('T-1 converted identity by agent',rt.ta(s,6,'converted'),'1');
 c:=rt.tr('campaign_performance',2,'2026-09-16','2026-09-16');
 PERFORM rt.eq('T-1 converted per campaign membership',(SELECT string_agg((e->>'campaign_id')||'='||(e->>'calls_made')||'/'||(e->>'contacted_calls')||'/'||(e->>'leads_dialed')||'/'||(e->>'converted_leads'),',' ORDER BY e->>'campaign_id') FROM jsonb_array_elements(c->'campaigns') e),format('%s=1/1/1/1,%s=1/1/1/1',rt.tv(50),rt.tv(51)));
 PERFORM rt.eq('T-1 campaign partition',(c->>'unattributed_calls')||'/'||(c->>'calls_attribution_unavailable'),'5/5');
 d:=rt.tr('disposition_breakdown',2,'2026-09-16','2026-09-16');
 PERFORM rt.eq('T-1 disposition keys incl. lowercased-name fallback',(SELECT string_agg((e->>'key')||'='||(e->>'name')||'/'||(e->>'calls'),',' ORDER BY e->>'key') FROM jsonb_array_elements(d->'by_disposition') e),
  format('%s=No Answer/1,%s=Interested/1,%s=Sold/2,name:mystery=Mystery/1,none=(No disposition)/2',rt.tv(20),rt.tv(21),rt.tv(22)));
 PERFORM rt.eq('T-1 disposition outbound only',d->>'total_calls','7');
 l:=rt.tr('lead_source_performance',2,'2026-09-16','2026-09-16');
 PERFORM rt.eq('T-1 lead source rows',(SELECT string_agg((e->>'lead_source')||'='||(e->>'calls_made')||'/'||(e->>'contacted_calls')||'/'||(e->>'leads_dialed')||'/'||(e->>'contacted_leads')||'/'||(e->>'new_leads'),',') FROM jsonb_array_elements(l->'sources') e),'Web=2/2/1/1/0');
 PERFORM rt.eq('T-1 lead source unattributed',l->>'unattributed_calls','5');
 -- Three local days: each edge second lands on its own local date, weekday and hour.
 v:=rt.tr('call_volume',2,'2026-09-15','2026-09-17');s:=rt.tr('call_summary',2,'2026-09-15','2026-09-17');
 PERFORM rt.eq('T-1 3-day by_date',rt.tb(v,'by_date'),'2026-09-15=1/0/0/10,2026-09-16=7/4/1/215,2026-09-17=1/0/0/10');
 PERFORM rt.eq('T-1 3-day by_day_of_week',rt.tb(v,'by_day_of_week'),'Tue=1/0,Wed=7/4,Thu=1/0');
 PERFORM rt.eq('T-1 3-day heatmap',rt.tb(v,'heatmap'),'2:23=1/0,3:0=1/0,3:8=2/2,3:13=2/0,3:17=1/1,3:23=1/1,4:0=1/0');
 PERFORM rt.eq('T-1 3-day shape',rt.tshape(v),'24/7/168/0/9/9/9/9');
 PERFORM rt.eq('T-1 3-day summary equals by_date',concat_ws('/',s->'totals'->>'calls_made',s->'totals'->>'contacted',s->'totals'->>'inbound_calls',s->'totals'->>'talk_time_seconds'),'9/4/1/235');
 -- Spring forward: 23 h day, no local hour 2.
 v:=rt.tr('call_volume',2,'2026-03-08','2026-03-08');
 PERFORM rt.eq('T-1 spring 23 h window',rt.twin(v),'2026-03-08T08:00:00Z/2026-03-09T07:00:00Z');
 PERFORM rt.eq('T-1 spring by_hour (01:30 PST h1, 03:30 PDT h3)',rt.tb(v,'by_hour'),'1=1/1,3=1/0,23=1/0');
 PERFORM rt.eq('T-1 spring hour 2 empty',v->'by_hour'->2->>'calls_made','0');
 PERFORM rt.eq('T-1 spring by_date',rt.tb(v,'by_date'),'2026-03-08=3/1/0/90');
 PERFORM rt.eq('T-1 spring Sunday heatmap',rt.tb(v,'by_day_of_week')||' '||rt.tb(v,'heatmap'),'Sun=3/1 0:1=1/1,0:3=1/0,0:23=1/0');
 PERFORM rt.eq('T-1 spring shape',rt.tshape(v),'24/7/168/0/3/3/3/3');
 -- Fall back: 25 h day, both 01:30 instants in hour 1; the inbound call stays out of the hourly buckets.
 v:=rt.tr('call_volume',2,'2026-11-01','2026-11-01');
 PERFORM rt.eq('T-1 fall 25 h window',rt.twin(v),'2026-11-01T07:00:00Z/2026-11-02T08:00:00Z');
 PERFORM rt.eq('T-1 fall by_hour (both 01:30 in h1)',rt.tb(v,'by_hour'),'1=2/1,7=1/1,23=1/0');
 PERFORM rt.eq('T-1 fall hour 2 empty',v->'by_hour'->2->>'calls_made','0');
 PERFORM rt.eq('T-1 fall by_date with inbound',rt.tb(v,'by_date'),'2026-11-01=4/2/1/122');
 PERFORM rt.eq('T-1 fall Sunday heatmap',rt.tb(v,'by_day_of_week')||' '||rt.tb(v,'heatmap'),'Sun=4/2 0:1=2/1,0:7=1/1,0:23=1/0');
 PERFORM rt.eq('T-1 fall estimate disclosed',(v->'quality'->'duration'->>'estimated_calls')||'/'||(v->'quality'->'duration'->>'outbound_calls'),'1/4');
 -- Havana: the agency day starts at the FIRST local midnight, so both midnights belong to Nov 1 hour 0.
 v:=rt.tr('call_volume',102,'2026-11-01','2026-11-01','agency',NULL,101);
 PERFORM rt.eq('T-1 Havana Nov 1 window',rt.twin(v),'2026-11-01T04:00:00Z/2026-11-02T05:00:00Z');
 PERFORM rt.eq('T-1 Havana Nov 1 buckets',rt.tb(v,'by_date')||' '||rt.tb(v,'by_hour')||' '||rt.tb(v,'by_day_of_week'),'2026-11-01=3/0/0/30 0=2/0,23=1/0 Sun=3/0');
 v:=rt.tr('call_volume',102,'2026-10-31','2026-10-31','agency',NULL,101);
 PERFORM rt.eq('T-1 Havana Oct 31 window',rt.twin(v),'2026-10-31T04:00:00Z/2026-11-01T04:00:00Z');
 PERFORM rt.eq('T-1 Havana Oct 31 buckets',rt.tb(v,'by_date')||' '||rt.tb(v,'by_hour')||' '||rt.tb(v,'by_day_of_week'),'2026-10-31=1/0/0/10 23=1/0 Sat=1/0');
END $$;
-- T-2 sessions clipped at BOTH window edges (agency midnight); per-day seconds add up to the multi-day union.
DO $$ DECLARE s jsonb; BEGIN
 s:=rt.tr('call_summary',2,'2026-09-14','2026-09-14');
 PERFORM rt.eq('T-2 day before midnight clipped at window end',concat_ws('/',s->'totals'->>'session_seconds',rt.ta(s,10,'session_seconds')),'3600/3600');
 PERFORM rt.eq('T-2 day before midnight overlap',(s->'quality'->'sessions'->>'overlapping_rows')||'/'||(s->'quality'->'sessions'->>'overlap_seconds_removed'),'2/1800');
 s:=rt.tr('call_summary',2,'2026-09-15','2026-09-15');
 PERFORM rt.eq('T-2 day after midnight clipped at window start',concat_ws('/',s->'totals'->>'session_seconds',rt.ta(s,10,'session_seconds'),rt.ta(s,6,'session_seconds')),'7200/3600/3600');
 PERFORM rt.eq('T-2 day after midnight overlap',(s->'quality'->'sessions'->>'overlapping_rows')||'/'||(s->'quality'->'sessions'->>'overlap_seconds_removed'),'2/1800');
 s:=rt.tr('call_summary',2,'2026-09-14','2026-09-15');
 PERFORM rt.eq('T-2 2-day union',concat_ws('/',s->'totals'->>'session_seconds',rt.ta(s,10,'session_seconds'),rt.ta(s,6,'session_seconds')),'10800/7200/3600');
 PERFORM rt.eq('T-2 2-day overlap removed once',(s->'quality'->'sessions'->>'overlapping_rows')||'/'||(s->'quality'->'sessions'->>'overlap_seconds_removed'),'2/3600');
 PERFORM rt.eq('T-2 agent filter',rt.tr('call_summary',2,'2026-09-14','2026-09-15','agency',10)->'totals'->>'session_seconds','7200');
 PERFORM rt.eq('T-2 spring days (end clip, 23 h, start clip, union)',concat_ws('/',rt.tsec(2,'2026-03-07','2026-03-07'),rt.tsec(2,'2026-03-08','2026-03-08'),rt.tsec(2,'2026-03-09','2026-03-09'),rt.tsec(2,'2026-03-07','2026-03-09')),'3600/82800/3600/90000');
 PERFORM rt.eq('T-2 fall-back days (end clip, 25 h, start clip, union)',concat_ws('/',rt.tsec(2,'2025-11-01','2025-11-01'),rt.tsec(2,'2025-11-02','2025-11-02'),rt.tsec(2,'2025-11-03','2025-11-03'),rt.tsec(2,'2025-11-01','2025-11-03')),'1800/90000/1800/93600');
 PERFORM rt.eq('T-2 Havana split at the first midnight',concat_ws('/',rt.tsec(102,'2025-11-01','2025-11-01',101),rt.tsec(102,'2025-11-02','2025-11-02',101),rt.tsec(102,'2025-11-01','2025-11-02',101)),'1800/5400/7200');
END $$;
-- T-3 an additional policy never borrows the primary premium; an explicit additional "0" is a known zero.
DO $$ DECLARE s jsonb;p jsonb;v jsonb;c jsonb; BEGIN
 s:=rt.tr('call_summary',2,'2026-09-17','2026-09-17');p:=s->'totals'->'premium';
 PERFORM rt.eq('T-3 policies',(s->'totals'->>'policies_sold')||'/'||(p->>'policy_count'),'3/3');
 PERFORM rt.eq('T-3 known/unknown (premium-less additional stays unknown)',(p->>'known_count')||'/'||(p->>'unknown_count'),'2/1');
 PERFORM rt.eq('T-3 monthly',(p->>'monthly_premium')::numeric,100::numeric);
 PERFORM rt.eq('T-3 annual',(p->>'annual_premium')::numeric,1200::numeric);
 PERFORM rt.eq('T-3 average over known incl. zero',(p->>'average_annual_premium')::numeric,600::numeric);
 PERFORM rt.eq('T-3 quality counts',concat_ws('/',p->>'invalid_count',p->>'ambiguous_zero_count',p->>'missing_identity_count',p->>'coverage_pct'),'0/0/0/66.7');
 PERFORM rt.eq('T-3 by agent',(SELECT (e->'premium'->>'known_count')||'/'||trim_scale((e->'premium'->>'annual_premium')::numeric)::text FROM jsonb_array_elements(s->'by_agent') e WHERE (e->>'agent_id')::uuid=rt.tv(9)),'2/1200');
 v:=rt.tr('call_volume',2,'2026-09-17','2026-09-17');
 PERFORM rt.eq('T-3 by_date premium',(v->'by_date'->0->>'policies_sold')||'/'||(v->'by_date'->0->'premium'->>'known_count')||'/'||trim_scale((v->'by_date'->0->'premium'->>'annual_premium')::numeric)::text,'3/2/1200');
 c:=rt.tr('campaign_performance',2,'2026-09-17','2026-09-17');
 PERFORM rt.eq('T-3 campaign unavailable premium',(c->'premium_attribution_unavailable'->>'known_count')||'/'||trim_scale((c->'premium_attribution_unavailable'->>'annual_premium')::numeric)::text,'2/1200');
END $$;
-- T-5 booking credit coalesce(created_by,user_id), any status, reviewed mapping only; callback_calls is separate.
DO $$ DECLARE s jsonb;q jsonb; BEGIN
 s:=rt.tr('call_summary',2,'2026-09-18','2026-09-18');q:=s->'quality';
 PERFORM rt.eq('T-5 agency bookings, all statuses',s->'totals'->>'appointments_set','9');
 PERFORM rt.eq('T-5 setter credited, not assignee',rt.ta(s,4,'appointments_set')||'/'||rt.ta(s,5,'appointments_set'),'6/2');
 PERFORM rt.eq('T-5 no-activity rows zero',concat_ws('/',rt.ta(s,2,'appointments_set'),rt.ta(s,3,'appointments_set'),rt.ta(s,7,'appointments_set')),'0/0/0');
 PERFORM rt.eq('T-5 unattributed booking',s->'unattributed'->>'appointments_set','1');
 PERFORM rt.eq('T-5 exactly one reviewed duplicate excluded',(q->'duplicates'->>'excluded_bookings')||'/'||(q->'bookings'->>'all_types'),'1/9');
 PERFORM rt.eq('T-5 kinds appointment/callback/unknown',concat_ws('/',q->'bookings'->>'appointment_kind',q->'bookings'->>'callback_kind',q->'bookings'->>'unknown_kind'),'6/2/1');
 PERFORM rt.eq('T-5 callback_calls outbound dispositions only',(s->'totals'->>'callback_calls')||'/'||(s->'totals'->>'calls_made'),'1/2');
 PERFORM rt.eq('T-5 agent filter setter',rt.tr('call_summary',2,'2026-09-18','2026-09-18','agency',4)->'totals'->>'appointments_set','6');
 s:=rt.tr('call_summary',4,'2026-09-18','2026-09-18','personal');q:=s->'quality';
 PERFORM rt.eq('T-5 setter personal',concat_ws('/',s->>'scope',s->'totals'->>'appointments_set',q->'duplicates'->>'excluded_bookings',s->'totals'->>'callback_calls'),'own/6/1/1');
 PERFORM rt.eq('T-5 setter personal kinds',concat_ws('/',q->'bookings'->>'appointment_kind',q->'bookings'->>'callback_kind',q->'bookings'->>'unknown_kind'),'4/1/1');
 s:=rt.tr('call_summary',5,'2026-09-18','2026-09-18','personal');q:=s->'quality';
 PERFORM rt.eq('T-5 assignee personal (fallback + own booking only)',concat_ws('/',s->'totals'->>'appointments_set',q->'duplicates'->>'excluded_bookings',q->'bookings'->>'callback_kind'),'2/0/1');
 PERFORM rt.eq('T-5 callback booking is not a callback call',s->'totals'->>'callback_calls','0');
 s:=rt.tr('call_summary',3,'2026-09-18','2026-09-18','team');
 PERFORM rt.eq('T-5 team excludes unattributed',(s->>'scope')||'/'||(s->'totals'->>'appointments_set'),'team/8');
 PERFORM rt.eq('T-5 local-day edges (created_at, half-open)',(rt.tr('call_summary',2,'2026-09-17','2026-09-17')->'totals'->>'appointments_set')||'/'||(rt.tr('call_summary',2,'2026-09-19','2026-09-19')->'totals'->>'appointments_set'),'1/1');
END $$;
-- T-6 Agent-caller campaign visibility on every v2 payload. Partition alone cannot detect a leak, so the
-- exact visible rows and the absence of every restricted/foreign id and name are asserted.
DO $$ DECLARE b jsonb;k text;c jsonb;d jsonb;a jsonb; BEGIN
 b:=jsonb_build_object('scope',rt.call(rt.tv(7),rt.tv(1),'SELECT public.get_report_scope_v2(''personal'')'));
 FOREACH k IN ARRAY ARRAY['call_summary','call_volume','disposition_breakdown','campaign_performance','lead_source_performance'] LOOP
  b:=b||jsonb_build_object(k,rt.tr(k,7,'2026-09-22','2026-09-22','personal'));
 END LOOP;
 FOR k IN SELECT jsonb_object_keys(b) LOOP PERFORM rt.eq('T-6 no restricted or foreign id/name in '||k,rt.tleaks(b->k),0); END LOOP;
 c:=b->'campaign_performance';d:=b->'disposition_breakdown';
 PERFORM rt.eq('T-6 exact visible rows',(SELECT string_agg((e->>'campaign_id')||'='||(e->>'calls_made')||'/'||(e->>'contacted_calls'),',' ORDER BY e->>'campaign_id') FROM jsonb_array_elements(c->'campaigns') e),
  format('%s=1/1,%s=1/0,%s=1/1,%s=1/0',rt.tv(50),rt.tv(51),rt.tv(52),rt.tv(53)));
 PERFORM rt.eq('T-6 unavailable/unattributed/outbound',concat_ws('/',c->>'calls_attribution_unavailable',c->>'unattributed_calls',b->'call_summary'->'totals'->>'calls_made'),'8/2/12');
 PERFORM rt.eq('T-6 campaign partition',(SELECT sum((e->>'calls_made')::int) FROM jsonb_array_elements(c->'campaigns') e)+(c->>'calls_attribution_unavailable')::int,12::bigint);
 PERFORM rt.eq('T-6 disposition campaigns = campaign rows',(SELECT string_agg(e->>'campaign_id',',' ORDER BY e->>'campaign_id') FROM jsonb_array_elements(d->'by_campaign') e),(SELECT string_agg(e->>'campaign_id',',' ORDER BY e->>'campaign_id') FROM jsonb_array_elements(c->'campaigns') e));
 PERFORM rt.eq('T-6 disposition partition',(SELECT sum((e->>'total')::int) FROM jsonb_array_elements(d->'by_campaign') e)||'+'||(d->>'campaign_attribution_unavailable_calls')||'='||(d->>'total_calls'),'4+8=12');
 PERFORM rt.eq('T-6 lead sources (foreign lead never resolved)',(SELECT string_agg((e->>'lead_source')||'='||(e->>'calls_made')||'/'||(e->>'contacted_calls')||'/'||(e->>'leads_dialed')||'/'||(e->>'contacted_leads')||'/'||(e->>'new_leads'),',') FROM jsonb_array_elements(b->'lead_source_performance'->'sources') e)||' '||(b->'lead_source_performance'->>'unattributed_calls'),'Reg Source=1/1/1/1/0 11');
 PERFORM rt.eq('T-6 volume counts restricted calls without campaign ids',rt.tb(b->'call_volume','by_date'),'2026-09-22=12/4/1/316');
 -- Non-vacuity: the restricted rows exist and an Admin sees them; the foreign campaign stays absent.
 a:=rt.tr('campaign_performance',2,'2026-09-22','2026-09-22');
 PERFORM rt.eq('T-6 Admin sees the restricted campaigns',(SELECT count(*) FROM jsonb_array_elements(a->'campaigns') e WHERE (e->>'campaign_id')::uuid IN (rt.tv(54),rt.tv(55),rt.tv(56),rt.tv(57),rt.tv(58)))||'/'||jsonb_array_length(a->'campaigns')||'/'||(a->>'calls_attribution_unavailable'),'5/9/2');
 PERFORM rt.eq('T-6 foreign campaign absent for Admin',position(rt.tv(260)::text IN a::text),0);
END $$;
SELECT 'Reports v2 integrity assertions passed' AS result;
