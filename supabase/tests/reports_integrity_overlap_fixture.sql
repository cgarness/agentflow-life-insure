-- Synthetic fractional-second sessions for the overlap_seconds_removed correction; disposable database only.
-- Day 2026-10-02: three agents, no overlap, fractional spans, one adjacent pair and one span crossing the agency
-- midnight (clipped to 0.5 s). Day 2026-10-03: the clipped remainder. Day 2026-10-04: real overlaps (partial and an
-- exact duplicate). Day 2026-10-05: a sub-second overlap. Expected values come from an independent decimal oracle.
INSERT INTO organizations VALUES(rt.iv(80),'Synthetic overlap agency');
INSERT INTO company_settings(organization_id,timezone) VALUES(rt.iv(80),'America/Los_Angeles');
INSERT INTO profiles(id,organization_id,first_name,role) VALUES
(rt.iv(81),rt.iv(80),'Overlap admin','Admin'),(rt.iv(82),rt.iv(80),'Overlap agent one','Agent'),
(rt.iv(83),rt.iv(80),'Overlap agent two','Agent'),(rt.iv(84),rt.iv(80),'Overlap agent three','Agent');
INSERT INTO campaigns(id,organization_id,name,type,user_id) VALUES(rt.iv(85),rt.iv(80),'Overlap campaign','Open Pool',rt.iv(82));
INSERT INTO dialer_sessions(id,agent_id,organization_id,campaign_id,started_at,last_heartbeat_at,ended_at,status)
SELECT rt.iv(n),rt.iv(a),rt.iv(80),rt.iv(85),s::timestamptz,e::timestamptz,e::timestamptz,'ended' FROM (VALUES
 (200,82,'2026-10-02 08:00:00Z','2026-10-02 08:10:00.4Z'),(201,82,'2026-10-02 09:00:00Z','2026-10-02 09:00:30.4Z'),
 (202,83,'2026-10-02 08:00:00Z','2026-10-02 08:20:00.7Z'),(203,83,'2026-10-02 08:20:00.7Z','2026-10-02 08:25:00.7Z'),
 (204,84,'2026-10-02 10:00:00Z','2026-10-02 10:00:45.4Z'),(205,84,'2026-10-03 06:59:59.5Z','2026-10-03 07:30:00Z'),
 (206,82,'2026-10-04 08:00:00Z','2026-10-04 09:00:00.25Z'),(207,82,'2026-10-04 08:30:00.5Z','2026-10-04 09:15:00Z'),
 (208,83,'2026-10-04 08:00:00Z','2026-10-04 08:00:10.6Z'),(209,83,'2026-10-04 08:00:10.2Z','2026-10-04 08:00:20.9Z'),
 (210,83,'2026-10-04 08:00:00Z','2026-10-04 08:00:10.6Z'),
 (211,84,'2026-10-05 13:00:00Z','2026-10-05 13:00:09.8Z'),(212,84,'2026-10-05 13:00:09.4Z','2026-10-05 13:00:09.8Z')
) v(n,a,s,e);
CREATE FUNCTION rt.ov(p_fn text,p_start date,p_end date,p_agent uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT rt.call(rt.iv(81),rt.iv(80),format('SELECT public.%I(%L,%L,%L::uuid,''agency'')',p_fn,p_start,p_end,p_agent));
$$;
-- Every quality-bearing v2 payload across the synthetic organizations, scopes and windows.
CREATE FUNCTION rt.overlap_snapshot() RETURNS TABLE(label text,payload jsonb) LANGUAGE plpgsql AS $$
DECLARE fn text; w record; BEGIN
 FOREACH fn IN ARRAY ARRAY['get_report_call_summary_v2','get_report_call_volume_v2','get_report_disposition_breakdown_v2','get_report_campaign_performance_v2','get_report_lead_source_performance_v2'] LOOP
  FOR w IN SELECT * FROM (VALUES ('2026-10-02'::date,'2026-10-02'::date),('2026-10-03','2026-10-03'),('2026-10-04','2026-10-04'),('2026-10-05','2026-10-05'),('2026-10-02','2026-10-05')) x(s,e) LOOP
   label:=format('overlap %s %s..%s',fn,w.s,w.e); payload:=rt.ov(fn,w.s,w.e); RETURN NEXT;
  END LOOP;
  label:='overlap agent two '||fn; payload:=rt.ov(fn,'2026-10-04','2026-10-04',rt.iv(83)); RETURN NEXT;
  label:='integrity agency '||fn; payload:=rt.call(rt.iv(2),rt.iv(1),format('SELECT public.%I(''2026-10-01'',''2026-10-01'',NULL,''agency'')',fn)); RETURN NEXT;
  label:='integrity personal '||fn; payload:=rt.call(rt.iv(2),rt.iv(1),format('SELECT public.%I(''2026-10-01'',''2026-10-01'',NULL,''personal'')',fn)); RETURN NEXT;
  label:='scale agency '||fn; payload:=rt.call(rt.iv(71),rt.iv(70),format('SELECT public.%I(''2026-08-01'',''2026-08-31'',NULL,''agency'')',fn)); RETURN NEXT;
  label:='O1 admin agency '||fn; payload:=rt.v2(fn,'ADMIN','agency'); RETURN NEXT;
  label:='O1 team leader team '||fn; payload:=rt.v2(fn,'TL','team'); RETURN NEXT;
  label:='O1 agent personal '||fn; payload:=rt.v2(fn,'A1','personal'); RETURN NEXT;
 END LOOP;
END $$;
CREATE FUNCTION rt.overlap_strip(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT ((p-'as_of') #- '{quality,as_of}') #- '{quality,sessions,overlap_seconds_removed}';
$$;
CREATE TABLE rt.overlap_preimage AS SELECT * FROM rt.overlap_snapshot();
-- Compare current payloads with the preimage. p_exact=false: only overlap_seconds_removed may differ (and must
-- differ somewhere); p_exact=true: identical apart from as_of (proves an exact rollback).
CREATE FUNCTION rt.overlap_compare(p_exact boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d record; other_diffs int:=0; overlap_diffs int:=0; total int; BEGIN
 DROP TABLE IF EXISTS overlap_now; CREATE TEMP TABLE overlap_now ON COMMIT DROP AS SELECT * FROM rt.overlap_snapshot();
 SELECT count(*) INTO total FROM rt.overlap_preimage b JOIN overlap_now a USING(label);
 IF total<>(SELECT count(*) FROM rt.overlap_preimage) OR total<>(SELECT count(*) FROM overlap_now) OR total<>60 THEN
  RAISE EXCEPTION 'overlap compare FAIL: payload set changed (% matched)',total;
 END IF;
 FOR d IN SELECT b.label,b.payload->'quality'->'sessions'->'overlap_seconds_removed' before_v,a.payload->'quality'->'sessions'->'overlap_seconds_removed' after_v,
   rt.overlap_strip(b.payload)=rt.overlap_strip(a.payload) same_rest
  FROM rt.overlap_preimage b JOIN overlap_now a USING(label) ORDER BY 1 LOOP
  IF NOT d.same_rest THEN other_diffs:=other_diffs+1; RAISE NOTICE 'overlap compare: non-overlap field changed in %',d.label; END IF;
  IF d.before_v IS DISTINCT FROM d.after_v THEN overlap_diffs:=overlap_diffs+1; RAISE NOTICE 'overlap_seconds_removed % : % -> %',d.label,d.before_v,d.after_v; END IF;
 END LOOP;
 IF other_diffs<>0 THEN RAISE EXCEPTION 'overlap compare FAIL: % payloads changed outside overlap_seconds_removed',other_diffs; END IF;
 IF p_exact AND overlap_diffs<>0 THEN RAISE EXCEPTION 'overlap compare FAIL: rollback left % overlap differences',overlap_diffs; END IF;
 IF NOT p_exact AND overlap_diffs<>20 THEN RAISE EXCEPTION 'overlap compare FAIL: expected 20 corrected payloads, got %',overlap_diffs; END IF;
 RAISE NOTICE 'overlap compare: % payloads, % identical outside overlap_seconds_removed, % corrected',total,total-other_diffs,overlap_diffs;
END $$;
UPDATE rt.integrity_preimage SET fingerprint=rt.source_fingerprint();
