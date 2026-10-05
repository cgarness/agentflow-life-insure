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
SELECT 'Six Reports integrity negative controls passed' AS result;
