#!/usr/bin/env bash
# Native measured scope cases. Existing indexes only. Every book/identity is synthetic in loopback pc_test_* database.
set -euo pipefail
: "${DB_URL:?Disposable database URL required}"
python3 - "$DB_URL" <<'PY'
import sys, urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
if u.hostname not in ('localhost','127.0.0.1') or not u.path.startswith('/pc_test_'):
    raise SystemExit('REFUSING: disposable policy commission database required')
PY
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -v samples="${PC_SCOPE_SAMPLES:-7}" <<'SQL'
\pset footer off
SET statement_timeout='180s';
CREATE TABLE cs_scale_cases(n integer,org uuid,actor integer,policies integer);
INSERT INTO cs_scale_cases SELECT n,test_id(9000+n),10000+n,n*50 FROM unnest(ARRAY[1,10,100,1000]) n;
INSERT INTO organizations(id,name) SELECT org,'Synthetic scope scale '||n FROM cs_scale_cases;
INSERT INTO company_settings(organization_id,timezone) SELECT org,'America/Los_Angeles' FROM cs_scale_cases;
INSERT INTO profiles(id,organization_id,first_name,last_name,role,status,hierarchy_path)
 SELECT test_id(actor),org,'Scale','Leader','Team Leader','Active',text2ltree('scale'||n) FROM cs_scale_cases;
INSERT INTO role_permissions(organization_id,role,permissions)
 SELECT org,'Team Leader','{"c":[{"name":"View Own Commission Percentage","teamLeader":false},{"name":"View Others'' Commission Percentage","teamLeader":true}]}'::jsonb FROM cs_scale_cases;
CREATE TABLE cs_scale_members AS SELECT c.n,c.org,c.actor,seq,test_id(100000+c.n*1000+seq) agent
 FROM cs_scale_cases c CROSS JOIN LATERAL generate_series(1,c.n) seq;
INSERT INTO profiles(id,organization_id,first_name,last_name,role,status,hierarchy_path,upline_id)
 SELECT agent,org,'Synthetic '||seq,'Seller','Agent','Active',text2ltree('scale'||n||'.a'||seq),test_id(actor) FROM cs_scale_members;
-- Bulk synthetic snapshots obey all FK/CHECK constraints. Guards are disabled only for fixture seeding as postgres.
CREATE TEMP TABLE cs_seed AS SELECT m.*,g, row_number() OVER(ORDER BY n,seq,g)::integer rid
 FROM cs_scale_members m CROSS JOIN generate_series(1,50) g;
CREATE TEMP TABLE cs_t_client AS SELECT to_jsonb(c) j FROM clients c WHERE first_name='ScopedIndirect' LIMIT 1;
CREATE TEMP TABLE cs_t_win AS SELECT to_jsonb(w) j FROM wins w WHERE policy_id=ci_policy('ScopedIndirect') LIMIT 1;
CREATE TEMP TABLE cs_t_est AS SELECT to_jsonb(e) j FROM policy_commission_estimates e WHERE policy_id=ci_policy('ScopedIndirect') AND status='active' LIMIT 1;
CREATE TEMP TABLE cs_t_inst AS SELECT to_jsonb(i) j,i.sequence FROM policy_commission_installments i WHERE estimate_id=ci_est(ci_policy('ScopedIndirect'));
SET session_replication_role=replica;
INSERT INTO clients SELECT (jsonb_populate_record(NULL::clients,c.j||jsonb_build_object(
 'id',test_id(2000000+s.rid),'organization_id',s.org,'assigned_agent_id',s.agent,'primary_policy_id',test_id(3000000+s.rid),
 'first_name','Scale '||s.rid,'lead_id',NULL))).*
 FROM cs_seed s CROSS JOIN cs_t_client c;
INSERT INTO wins SELECT (jsonb_populate_record(NULL::wins,w.j||jsonb_build_object(
 'id',test_id(4000000+s.rid),'organization_id',s.org,'agent_id',s.agent,'contact_id',test_id(2000000+s.rid),
 'policy_id',test_id(3000000+s.rid),'idempotency_key',NULL,'sold_date',current_date-((s.rid%600)::integer)))).*
 FROM cs_seed s CROSS JOIN cs_t_win w;
INSERT INTO policy_commission_estimates SELECT (jsonb_populate_record(NULL::policy_commission_estimates,e.j||jsonb_build_object(
 'id',test_id(5000000+s.rid),'organization_id',s.org,'credited_agent_id',s.agent,'policy_id',test_id(3000000+s.rid),
 'win_id',test_id(4000000+s.rid),'capture_id',NULL,'capture_mode','recorded_later','recorded_by',s.agent))).*
 FROM cs_seed s CROSS JOIN cs_t_est e;
INSERT INTO policy_commission_installments SELECT (jsonb_populate_record(NULL::policy_commission_installments,i.j||jsonb_build_object(
 'id',test_id(6000000+s.rid*4+i.sequence),'organization_id',s.org,'credited_agent_id',s.agent,'policy_id',test_id(3000000+s.rid),
 'estimate_id',test_id(5000000+s.rid),'expected_on',current_date-300+(s.rid%600),'expected_until',current_date-298+(s.rid%600)))).*
 FROM cs_seed s CROSS JOIN cs_t_inst i;
INSERT INTO policy_commission_receipts(id,organization_id,installment_id,estimate_id,policy_id,credited_agent_id,request_id,payload_hash,amount_cents,received_on,recorded_by)
 SELECT test_id(7000000+s.rid),s.org,test_id(6000000+s.rid*4+1),test_id(5000000+s.rid),test_id(3000000+s.rid),s.agent,
 test_id(8000000+s.rid),repeat('0',64),20000,current_date-(s.rid%300),s.agent FROM cs_seed s WHERE s.rid%3=0;
SET session_replication_role=origin;
ANALYZE;
CREATE TABLE cs_scale_timing(agents integer,policies integer,read text,sample integer,ms numeric,outcome text,budget text);
CREATE TABLE cs_scale_plans(agents integer,read text,plan jsonb);
GRANT INSERT,SELECT ON cs_scale_timing,cs_scale_plans TO authenticated;
GRANT SELECT ON cs_scale_cases TO authenticated;
SQL
if [ "${PC_SCOPE_SEED_ONLY:-}" = 1 ]; then exit 0; fi
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -v samples="${PC_SCOPE_SAMPLES:-7}" <<'SQL'
\pset footer off
-- The refreshed production authenticated/authenticator statement budget is 8 seconds.
-- Three approved NEW readers configure40s; Breakdown retains20s; other readers retain8s. Each direct statement models
-- that metadata budget. The separate actualPostgREST suite proves HTTP hoisting and transaction restoration.
SET statement_timeout='8s';
CREATE FUNCTION cs_measure(p_n integer,p_label text,p_query text,p_sample integer,p_plan boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; x jsonb; p json; t timestamptz; elapsed numeric; failure text; BEGIN
 SELECT * INTO c FROM cs_scale_cases WHERE n=p_n;
 IF EXISTS(SELECT 1 FROM cs_scale_timing WHERE agents=p_n AND read=p_label AND outcome<>'ok') THEN RETURN; END IF;
 PERFORM pc_login(c.actor); EXECUTE 'SET LOCAL ROLE authenticated';
 t:=clock_timestamp();
 BEGIN
  IF p_plan THEN
   EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '||p_query INTO p;
   INSERT INTO cs_scale_plans VALUES(c.n,p_label,p::jsonb);
  ELSE
   EXECUTE p_query INTO x;
   IF p_label='policies' THEN PERFORM test_assert((x->>'total_count')::int=c.policies,'scale full-filter policy count'); END IF;
   IF p_label='roster' THEN PERFORM test_assert((x->>'available_count')::int=c.n,'scale exact authorized universe'); END IF;
  END IF;
 EXCEPTION WHEN query_canceled OR OTHERS THEN failure:=SQLSTATE||':'||SQLERRM;
 END;
 elapsed:=extract(epoch FROM clock_timestamp()-t)*1000;
 EXECUTE 'RESET ROLE';
 IF NOT p_plan OR failure IS NOT NULL THEN
  INSERT INTO cs_scale_timing VALUES(c.n,c.policies,p_label,p_sample,elapsed,coalesce(failure,'ok'),current_setting('statement_timeout'));
 END IF;
 RAISE NOTICE 'SCALE agents=% policies=% resource=% sample=% explain=% ms=% outcome=%',c.n,c.policies,p_label,p_sample,p_plan,round(elapsed,2),coalesce(failure,'ok');
END $$;
CREATE TABLE cs_scale_queries(label text,query text);
INSERT INTO cs_scale_queries VALUES
 ('roster','SELECT get_commission_agent_scope(p_limit=>50)'),
 ('overview','SELECT get_scoped_commission_overview(''all'',NULL,''this_year'')'),
 ('scheduled','SELECT get_scoped_commission_installments(''all'',NULL,p_period=>''all'',p_scope=>''any'')'),
 ('scheduled_default','SELECT get_scoped_commission_installments(''all'',NULL)'),
 ('scheduled_next90','SELECT get_scoped_commission_installments(''all'',NULL,p_scope=>''next_90'')'),
 ('months_10_12','SELECT get_scoped_commission_installments(''all'',NULL,p_period=>''next_month'',p_kind=>''later'')'),
 ('history','SELECT get_scoped_commission_receipt_list(''all'',NULL,p_period=>''all'')'),
 ('policies','SELECT get_scoped_commission_policy_list(''all'',NULL,p_period=>''all'')'),
 ('breakdown','SELECT get_scoped_commission_breakdown(''all'',NULL,''this_year'')');
SELECT format('SET statement_timeout=%L; SELECT cs_measure(%s,%L,%L,%s,%L)',
 coalesce((SELECT split_part(setting,'=',2) FROM pg_proc f JOIN pg_namespace ns ON ns.oid=f.pronamespace
 CROSS JOIN LATERAL unnest(f.proconfig) setting WHERE ns.nspname='public'
 AND f.proname=substring(q.query FROM 'SELECT ([a-z_]+)\(') AND setting LIKE 'statement_timeout=%'),'8s'),
 c.n,q.label,q.query,k,k=:'samples'::int+1)
 FROM cs_scale_cases c CROSS JOIN cs_scale_queries q CROSS JOIN generate_series(0,:'samples'::int+1) k
 ORDER BY c.n,q.label,k
\gexec
SELECT agents,policies,read,count(*) FILTER(WHERE sample>0 AND outcome='ok') samples,
 round(percentile_cont(.5) WITHIN GROUP(ORDER BY ms) FILTER(WHERE sample>0 AND outcome='ok')::numeric,2) median_ms,
 round(percentile_cont(.95) WITHIN GROUP(ORDER BY ms) FILTER(WHERE sample>0 AND outcome='ok')::numeric,2) p95_ms,
 round(max(ms),2) max_ms,string_agg(DISTINCT outcome,';') outcome FROM cs_scale_timing GROUP BY agents,policies,read ORDER BY agents,read;
SELECT jsonb_build_object('agents',agents,'read',read,'sample',sample,'ms',ms,'outcome',outcome,'budget',budget) AS raw_sample FROM cs_scale_timing ORDER BY agents,read,sample;
SELECT jsonb_build_object('agents',agents,'read',read,'plan',plan) AS query_plan FROM cs_scale_plans ORDER BY agents,read;
SQL
if [ -n "${PC_SCOPE_OUTPUT:-}" ]; then
  mkdir -p "$PC_SCOPE_OUTPUT"
  psql "$DB_URL" -tAX -v ON_ERROR_STOP=1 -c 'SELECT jsonb_agg(to_jsonb(t) ORDER BY agents,read,sample) FROM cs_scale_timing t' > "$PC_SCOPE_OUTPUT/raw-samples.json"
  psql "$DB_URL" -tAX -v ON_ERROR_STOP=1 -c 'SELECT jsonb_agg(to_jsonb(p) ORDER BY agents,read) FROM cs_scale_plans p' > "$PC_SCOPE_OUTPUT/query-plans.json"
fi
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 <<'SQL'
SELECT test_assert(NOT EXISTS(SELECT 1 FROM cs_scale_timing WHERE outcome<>'ok'),'all scoped scale requests complete within reviewed per-RPC budget (8s default; exactly three approved new readers40s and Breakdown20s)');
SELECT 'PASS scoped scale: 1/10/100/1000 authorized sellers, 50/500/5000/50000 policies; actual authenticated-role queries' AS result;
SQL
