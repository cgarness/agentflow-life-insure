-- Each intentionally broken reader must trip an assertion, then roll back its entire subtransaction.
SELECT rt.reject_mutation('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])',
 's.last_heartbeat_at>=now()-interval ''3 minutes''','true',
 $probe$SELECT rt.eq('uncapped session control',rt.isummary('2026-10-04')->'totals'->>'session_seconds','0')$probe$,
 'uncapped session control FAIL');
SELECT rt.reject_mutation('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])',
 'AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=p_org AND d.kind=''call'' AND d.duplicate_id=c.id)','',
 $probe$SELECT rt.eq('duplicate control',rt.isummary()->'totals'->>'calls_made','5')$probe$,
 'duplicate control FAIL');
SELECT rt.reject_mutation('public.get_report_call_summary_v2(date,date,uuid,text)',
 'tstzrange(s.span_start,s.span_end,''[)'')','tstzrange(s.span_start,s.span_end,''[]'')',
 $probe$SELECT rt.eq('half-open control',rt.isummary()->'totals'->>'session_matched_calls','3')$probe$,
 'half-open control FAIL');
SELECT rt.reject_mutation('private.report_policy_value_facts(uuid,uuid[])',
 'c.premium=0 AND NOT EXISTS','false AND NOT EXISTS',
 $probe$SELECT rt.eq('legacy-zero control',rt.isummary()->'totals'->'premium'->>'ambiguous_zero_count','1')$probe$,
 'legacy-zero control FAIL');
SELECT rt.reject_mutation('private.report_premium_totals(bigint,bigint,numeric,bigint,bigint,bigint)',
 'round(p_monthly*12/p_known,2)','round(p_monthly*12/p_count,2)',
 $probe$SELECT rt.eq('known-average control',(private.report_premium_totals(2,1,10,0,0,0)->>'average_annual_premium')::numeric,120::numeric)$probe$,
 'known-average control FAIL');
SELECT rt.reject_mutation('private.report_access_v2(text,uuid)',
 'ids:=ARRAY[a.uid]','ids:=NULL',
 $probe$SELECT rt.eq('personal-scope control',rt.call(rt.iv(2),rt.iv(1),'SELECT public.get_report_call_summary_v2(''2026-10-01'',''2026-10-01'',NULL,''personal'')')->'totals'->>'calls_made','0')$probe$,
 'personal-scope control FAIL');
-- T-1..T-6 regression controls (separate synthetic organizations from reports_integrity.sql).
SELECT rt.reject_mutation('public.get_report_call_volume_v2(date,date,uuid,text)',
 '(fc.created_at AT TIME ZONE v_win.time_zone) AS local_ts','(fc.created_at AT TIME ZONE ''UTC'') AS local_ts',
 $probe$SELECT rt.eq('UTC bucketing control',rt.tb(rt.tr('call_volume',2,'2026-09-16','2026-09-16'),'by_hour'),'0=1/0,8=2/2,13=2/0,17=1/1,23=1/1')$probe$,
 'UTC bucketing control FAIL');
SELECT rt.reject_mutation('public.get_report_call_volume_v2(date,date,uuid,text)',
 'extract(hour FROM f.local_ts)::int AS hour_of_day','(floor(extract(epoch FROM f.created_at - v_win.start_at)/3600)::int % 24) AS hour_of_day',
 $probe$SELECT rt.eq('elapsed-hour control',rt.tb(rt.tr('call_volume',2,'2026-03-08','2026-03-08'),'by_hour'),'1=1/1,3=1/0,23=1/0')$probe$,
 'elapsed-hour control FAIL');
SELECT rt.reject_mutation('public.get_report_call_volume_v2(date,date,uuid,text)',
 'SELECT f.local_ts::date AS local_date','SELECT (f.created_at AT TIME ZONE ''UTC'')::date AS local_date',
 $probe$SELECT rt.eq('UTC daily bucket control',rt.tb(rt.tr('call_volume',2,'2026-09-16','2026-09-16'),'by_date'),'2026-09-16=7/4/1/215')$probe$,
 'UTC daily bucket control FAIL');
SELECT rt.reject_mutation('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])',
 'coalesce(''contact:'' || b.contact_id::text, ''campaign_lead:'' || b.campaign_lead_id::text, ''call:'' || b.id::text)','(''call:'' || b.id::text)',
 $probe$SELECT rt.eq('converted identity control',rt.tr('call_summary',2,'2026-09-16','2026-09-16')->'totals'->>'converted','1')$probe$,
 'converted identity control FAIL');
SELECT rt.reject_mutation('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])',
 'least(p_end,now(),','least(now(),',
 $probe$SELECT rt.eq('session end clip control',rt.tsec(2,'2026-09-14','2026-09-14'),'3600')$probe$,
 'session end clip control FAIL');
SELECT rt.reject_mutation('private.report_policy_value_facts(uuid,uuid[])',
 'e.entry->>''premiumAmount'',false','coalesce(e.entry->>''premiumAmount'',c.premium::text),false',
 $probe$SELECT rt.eq('additional premium control',rt.tr('call_summary',2,'2026-09-17','2026-09-17')->'totals'->'premium'->>'known_count','2')$probe$,
 'additional premium control FAIL');
SELECT rt.reject_mutation('public.get_report_call_summary_v2(date,date,uuid,text)',
 'coalesce(a.created_by, a.user_id)','coalesce(a.user_id, a.created_by)',
 $probe$SELECT rt.eq('booking credit control',rt.ta(rt.tr('call_summary',2,'2026-09-18','2026-09-18'),4,'appointments_set'),'6')$probe$,
 'booking credit control FAIL');
SELECT rt.reject_mutation('public.get_report_call_summary_v2(date,date,uuid,text)',
 'coalesce(a.created_by, a.user_id)','a.created_by',
 $probe$SELECT rt.eq('booking fallback control',rt.ta(rt.tr('call_summary',2,'2026-09-18','2026-09-18'),5,'appointments_set'),'2')$probe$,
 'booking fallback control FAIL');
SELECT rt.reject_mutation('public.get_report_call_summary_v2(date,date,uuid,text)',
 'FROM f WHERE f.direction_class = ''outbound'' AND f.disp_callback)','FROM f WHERE f.disp_callback)',
 $probe$SELECT rt.eq('outbound callback control',rt.tr('call_summary',2,'2026-09-18','2026-09-18')->'totals'->>'callback_calls','1')$probe$,
 'outbound callback control FAIL');
SELECT rt.reject_mutation('public.get_report_call_summary_v2(date,date,uuid,text)',
 'FROM f WHERE f.direction_class = ''outbound'' AND f.disp_callback)',
 'FROM public.appointments a2 WHERE a2.organization_id=v_access.org_id AND a2.booking_kind=''callback'' AND a2.created_at>=v_win.start_at AND a2.created_at<v_win.end_at)',
 $probe$SELECT rt.eq('callback independence control',rt.tr('call_summary',5,'2026-09-18','2026-09-18','personal')->'totals'->>'callback_calls','0')$probe$,
 'callback independence control FAIL');
SELECT rt.reject_mutation('private.report_visible_campaigns(uuid)',
 'v_actor.is_super','true',
 $probe$SELECT rt.eq('campaign visibility control',rt.tleaks(rt.tr('campaign_performance',7,'2026-09-22','2026-09-22','personal')),0)$probe$,
 'campaign visibility control FAIL');
SELECT 'Seventeen Reports integrity negative controls passed' AS result;
