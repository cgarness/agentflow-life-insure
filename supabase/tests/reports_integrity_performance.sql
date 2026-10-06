-- Synthetic scale check; timings are environment-specific, not a hosted capacity promise.
-- These indexes mirror the baseline production definitions, not proposed new indexes.
CREATE INDEX IF NOT EXISTS idx_calls_org_created_at ON public.calls USING btree (organization_id,created_at);
CREATE INDEX IF NOT EXISTS idx_calls_agent_id ON public.calls USING btree (agent_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON public.clients USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_dialer_sessions_org_agent_started ON public.dialer_sessions USING btree (organization_id,agent_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_organization_id ON public.appointments USING btree (organization_id);
INSERT INTO organizations VALUES(rt.iv(70),'Synthetic scale agency');
INSERT INTO company_settings(organization_id,timezone) VALUES(rt.iv(70),'America/Los_Angeles');
INSERT INTO profiles(id,organization_id,first_name,role) VALUES(rt.iv(71),rt.iv(70),'Scale admin','Admin'),(rt.iv(72),rt.iv(70),'Scale agent','Agent');
INSERT INTO campaigns(id,organization_id,name,type,user_id) VALUES(rt.iv(73),rt.iv(70),'Scale campaign','Open Pool',rt.iv(72));
INSERT INTO calls(id,organization_id,agent_id,campaign_id,created_at,duration)
 SELECT md5('scale-call-'||g)::uuid,rt.iv(70),rt.iv(72),rt.iv(73),'2026-08-01 07:00Z'::timestamptz+g*interval '10 seconds',46 FROM generate_series(0,49999) g;
INSERT INTO dialer_sessions(id,organization_id,agent_id,campaign_id,started_at,last_heartbeat_at,ended_at,status)
 SELECT md5('scale-session-'||g)::uuid,rt.iv(70),rt.iv(72),rt.iv(73),'2026-08-01 07:00Z'::timestamptz+g*interval '300 seconds',
 '2026-08-01 07:00Z'::timestamptz+(g*300+600)*interval '1 second','2026-08-01 07:00Z'::timestamptz+(g*300+600)*interval '1 second','ended' FROM generate_series(0,1999) g;
ANALYZE calls; ANALYZE dialer_sessions; ANALYZE appointments; ANALYZE clients;
-- A real window predicate should use the existing organization/date index without planner switches.
DO $$ DECLARE plan json; r jsonb; started timestamptz; BEGIN
 EXECUTE format('EXPLAIN (FORMAT JSON) SELECT id FROM calls WHERE organization_id=%L AND created_at>=%L AND created_at<%L',rt.iv(1),'2026-10-01','2026-10-02') INTO plan;
 IF position('idx_calls_org_created_at' in plan::text)=0 THEN RAISE EXCEPTION 'Selective date-window index was not used: %',plan; END IF;
 RAISE NOTICE 'Selective window plan: %',plan;
 started:=clock_timestamp();
 r:=rt.call(rt.iv(71),rt.iv(70),'SELECT public.get_report_call_summary_v2(''2026-08-01'',''2026-08-31'',NULL,''agency'')');
 PERFORM rt.eq('scale calls',r->'totals'->>'calls_made','50000');
 PERFORM rt.eq('scale session matched',r->'totals'->>'session_matched_calls','50000');
 PERFORM rt.eq('scale session union',r->'totals'->>'session_seconds','600300');
 RAISE NOTICE 'Scale summary: 50000 calls, 2000 overlapping sessions; elapsed_ms=%',extract(epoch FROM clock_timestamp()-started)*1000;
END $$;
