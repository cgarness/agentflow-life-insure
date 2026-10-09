-- Corrected overlap_seconds_removed: zero without overlap, exact (floored once) with overlap; totals unchanged.
CREATE FUNCTION rt.ov_sessions(p_start date,p_end date,p_agent uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT rt.ov('get_report_call_summary_v2',p_start,p_end,p_agent);
$$;
CREATE FUNCTION rt.ov_agent(p jsonb,p_agent uuid) RETURNS text LANGUAGE sql AS $$
 SELECT e->>'session_seconds' FROM jsonb_array_elements(p->'by_agent') e WHERE (e->>'agent_id')::uuid=p_agent;
$$;
DO $$ DECLARE r jsonb; n text; residue numeric; BEGIN
 -- The fixture really reproduces the old artifact: floor(raw total) minus per-agent union floors is 2 here.
 SELECT floor(sum(extract(epoch FROM f.span_end-f.span_start)))-2175 INTO residue
  FROM private.report_window(rt.iv(80),'2026-10-02','2026-10-02') w
  CROSS JOIN LATERAL private.report_session_facts(rt.iv(80),w.start_at,w.end_at,NULL) f WHERE f.span_end>f.span_start;
 PERFORM rt.eq('fixture reproduces the old two-second residue',residue,2::numeric);
 r:=rt.ov_sessions('2026-10-02','2026-10-02');
 PERFORM rt.eq('fractional no-overlap rows',r->'quality'->'sessions'->>'overlapping_rows','0');
 PERFORM rt.eq('fractional no-overlap removed',r->'quality'->'sessions'->>'overlap_seconds_removed','0');
 PERFORM rt.eq('fractional union seconds unchanged',r->'totals'->>'session_seconds','2175');
 PERFORM rt.eq('agent one floored union',rt.ov_agent(r,rt.iv(82)),'630');
 PERFORM rt.eq('agent two adjacent spans',rt.ov_agent(r,rt.iv(83)),'1500');
 PERFORM rt.eq('agent three clipped at agency midnight',rt.ov_agent(r,rt.iv(84)),'45');
 r:=rt.ov_sessions('2026-10-03','2026-10-03');
 PERFORM rt.eq('clipped remainder next day',r->'totals'->>'session_seconds','1800');
 PERFORM rt.eq('clipped remainder removed',r->'quality'->'sessions'->>'overlap_seconds_removed','0');
 r:=rt.ov_sessions('2026-10-04','2026-10-04');
 PERFORM rt.eq('overlap rows',r->'quality'->'sessions'->>'overlapping_rows','5');
 PERFORM rt.eq('exact removed floored once',r->'quality'->'sessions'->>'overlap_seconds_removed','1810');
 PERFORM rt.eq('overlap union seconds unchanged',r->'totals'->>'session_seconds','4520');
 PERFORM rt.eq('partial overlap agent union',rt.ov_agent(r,rt.iv(82)),'4500');
 PERFORM rt.eq('duplicate overlap agent union',rt.ov_agent(r,rt.iv(83)),'20');
 r:=rt.ov_sessions('2026-10-05','2026-10-05');
 PERFORM rt.eq('sub-second overlap rows',r->'quality'->'sessions'->>'overlapping_rows','2');
 PERFORM rt.eq('sub-second overlap floors to zero',r->'quality'->'sessions'->>'overlap_seconds_removed','0');
 PERFORM rt.eq('sub-second union seconds',r->'totals'->>'session_seconds','9');
 r:=rt.ov_sessions('2026-10-04','2026-10-04',rt.iv(83));
 PERFORM rt.eq('agent filter overlap rows',r->'quality'->'sessions'->>'overlapping_rows','3');
 PERFORM rt.eq('agent filter removed',r->'quality'->'sessions'->>'overlap_seconds_removed','11');
 PERFORM rt.eq('agent filter union',r->'totals'->>'session_seconds','20');
 FOREACH n IN ARRAY ARRAY['call_summary','call_volume','disposition_breakdown','campaign_performance','lead_source_performance'] LOOP
  r:=rt.ov('get_report_'||n||'_v2','2026-10-02','2026-10-05');
  PERFORM rt.eq('multi-day overlap rows '||n,r->'quality'->'sessions'->>'overlapping_rows','7');
  PERFORM rt.eq('multi-day exact removed '||n,r->'quality'->'sessions'->>'overlap_seconds_removed','1811');
 END LOOP;
 r:=rt.ov_sessions('2026-10-02','2026-10-05');
 PERFORM rt.eq('multi-day union seconds',r->'totals'->>'session_seconds','8506');
 PERFORM rt.eq('multi-day agent one',rt.ov_agent(r,rt.iv(82)),'5130');
 PERFORM rt.eq('multi-day agent two',rt.ov_agent(r,rt.iv(83)),'1521');
 PERFORM rt.eq('multi-day agent three',rt.ov_agent(r,rt.iv(84)),'1855');
END $$;
-- Negative controls: the previous expression, a per-agent-floor variant and an unclipped session end must each fail.
SELECT rt.reject_mutation('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])',
 'floor(sum(u.raw_seconds-u.union_seconds))',
 'floor(sum(u.raw_seconds))-(SELECT coalesce(sum(session_seconds),0) FROM private.report_session_seconds(p_org,p_start,p_end,p_agents))',
 $probe$SELECT rt.eq('previous-expression control',rt.ov_sessions('2026-10-02','2026-10-02')->'quality'->'sessions'->>'overlap_seconds_removed','0')$probe$,
 'previous-expression control FAIL');
SELECT rt.reject_mutation('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])',
 'floor(sum(u.raw_seconds-u.union_seconds))','sum(floor(u.raw_seconds)-floor(u.union_seconds))',
 $probe$SELECT rt.eq('per-agent-floor control',rt.ov_sessions('2026-10-02','2026-10-05')->'quality'->'sessions'->>'overlap_seconds_removed','1811')$probe$,
 'per-agent-floor control FAIL');
SELECT rt.reject_mutation('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])',
 'least(p_end,now(),','least(now(),',
 $probe$SELECT rt.eq('session-end clip control',rt.ov_sessions('2026-10-02','2026-10-02')->'totals'->>'session_seconds','2175')$probe$,
 'session-end clip control FAIL');
SELECT 'Reports overlap correction assertions and three negative controls passed' AS result;
