-- Sold Date reporting regressions (run AFTER the fix, on the fixtures from performance_sold_date_baseline.sql).
-- Synthetic data only. Agency zone: America/Los_Angeles (org 1), America/New_York (org 2).
CREATE FUNCTION public.test_la_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date $$;
CREATE FUNCTION public.test_period_start(p_unit text) RETURNS date LANGUAGE sql STABLE AS $$ SELECT date_trunc(p_unit,public.test_la_today()::timestamp)::date $$;
CREATE FUNCTION public.test_window(p_zone text,p_period text,p_asof timestamptz) RETURNS text LANGUAGE sql AS $$
 SELECT concat_ws('|',sold_from,sold_until,previous_sold_from,previous_sold_until) FROM private.performance_sale_window(p_zone,p_period,p_asof) $$;
-- policies/annual premium/unknown premiums/recent_wins_7d for one agent's Sold Date window.
CREATE FUNCTION public.test_sold(p_agent uuid,p_from date,p_until date) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce((SELECT r.policies_sold||'/'||trim_scale(r.annualized_premium)::text||'/'||r.unknown_premiums||'/'||r.recent_wins_7d
  FROM private.performance_rows(ARRAY[public.test_id(1)],'2026-01-01T00:00:00Z','2026-01-01T00:00:01Z',p_from,p_until,ARRAY[p_agent]) r
  WHERE r.agent_id=p_agent),'none') $$;

-- 1. Agency calendar windows at fixed as-ofs: DST, zone extremes, Monday weeks, rollovers, previous periods.
SELECT test_assert(test_window('America/Los_Angeles','day','2026-10-16T20:30:00Z')='2026-10-16|2026-10-17|2026-10-15|2026-10-16','Oct 16 PDT day');
SELECT test_assert(test_window('America/Los_Angeles','today','2026-10-17T06:59:59Z')='2026-10-16|2026-10-17|2026-10-15|2026-10-16','11:59:59 PM PDT is still Oct 16, never the UTC date');
SELECT test_assert(test_window('America/Los_Angeles','week','2026-10-16T20:30:00Z')='2026-10-12|2026-10-17|2026-10-05|2026-10-12','Monday weeks');
SELECT test_assert(test_window('America/Los_Angeles','month','2026-10-16T20:30:00Z')='2026-10-01|2026-10-17|2026-09-01|2026-10-01','month to date, full previous month');
SELECT test_assert(test_window('America/Los_Angeles','year','2026-10-16T20:30:00Z')='2026-01-01|2026-10-17|2025-01-01|2026-01-01','year to date, full previous year');
SELECT test_assert(test_window('America/Los_Angeles','day','2026-11-02T07:30:00Z')='2026-11-01|2026-11-02|2026-10-31|2026-11-01','25-hour fall-back day keeps its last hour');
SELECT test_assert(test_window('America/Los_Angeles','day','2026-11-02T08:30:00Z')='2026-11-02|2026-11-03|2026-11-01|2026-11-02','first hour after the fall-back day');
SELECT test_assert(test_window('America/Los_Angeles','day','2026-03-08T07:59:00Z')='2026-03-07|2026-03-08|2026-03-06|2026-03-07','last minute before the spring-forward day');
SELECT test_assert(test_window('America/Los_Angeles','day','2026-03-08T10:30:00Z')='2026-03-08|2026-03-09|2026-03-07|2026-03-08','23-hour spring-forward day');
SELECT test_assert(test_window('America/Los_Angeles','month','2026-11-01T06:59:59Z')='2026-10-01|2026-11-01|2026-09-01|2026-10-01','month rollover at local midnight');
SELECT test_assert(test_window('America/Los_Angeles','year','2027-01-01T07:59:59Z')='2026-01-01|2027-01-01|2025-01-01|2026-01-01','year rollover at local midnight');
SELECT test_assert(test_window('America/New_York','week','2026-10-19T03:59:00Z')='2026-10-12|2026-10-19|2026-10-05|2026-10-12','Sunday 11:59 PM EDT stays in the old week');
SELECT test_assert(test_window('America/New_York','week','2026-10-19T04:00:00Z')='2026-10-19|2026-10-20|2026-10-12|2026-10-19','Monday 12:00 AM EDT starts the new week');
SELECT test_assert(test_window('Pacific/Kiritimati','day','2026-10-16T10:30:00Z')='2026-10-17|2026-10-18|2026-10-16|2026-10-17','UTC+14 is a day ahead of the UTC date');
SELECT test_assert(test_window('Pacific/Pago_Pago','day','2026-10-17T10:30:00Z')='2026-10-16|2026-10-17|2026-10-15|2026-10-16','UTC-11 is a day behind the UTC date');
SELECT test_assert(test_window('America/Havana','day','2026-11-01T04:30:00Z')='2026-11-01|2026-11-02|2026-10-31|2026-11-01','Havana first midnight hour');
SELECT test_assert(test_window('America/Havana','day','2026-11-01T05:30:00Z')='2026-11-01|2026-11-02|2026-10-31|2026-11-01','Havana repeated midnight hour stays on the same date');
SELECT test_reject($q$SELECT * FROM private.performance_sale_window('America/Los_Angeles','quarter',now())$q$,'22023');
SELECT test_reject($q$SELECT * FROM private.performance_sale_window(NULL,'month',now())$q$,'22023');
-- A missing, reversed or oversized window fails; it can never silently return zero sales.
SELECT test_reject($q$SELECT * FROM private.performance_rows(ARRAY[test_id(1)],now()-interval '1 day',now(),NULL,current_date)$q$,'22023');
SELECT test_reject($q$SELECT * FROM private.performance_rows(ARRAY[test_id(1)],now()-interval '1 day',now(),current_date,current_date-1)$q$,'22023');
SELECT test_reject($q$SELECT * FROM private.performance_rows(ARRAY[test_id(1)],now()-interval '1 day',now(),current_date-400,current_date)$q$,'22023');

-- 2. Exact Teo fixture (entered Oct 16 PDT): counts, premium and the 7-day badge follow Sold Dates.
SELECT test_assert(test_sold(test_id(31),'2026-10-16','2026-10-17')='0/0/0/5','Oct 16 (entry day) has no sales');
SELECT test_assert(test_sold(test_id(31),'2026-10-15','2026-10-16')='3/1801.08/0/5','Oct 15: three policies, cents kept');
SELECT test_assert(test_sold(test_id(31),'2026-10-14','2026-10-15')='2/660/0/3','Oct 14: two policies');
SELECT test_assert(test_sold(test_id(31),'2026-10-08','2026-10-09')='1/1200/0/1','Oct 8: one policy');
SELECT test_assert(test_sold(test_id(31),'2026-10-12','2026-10-17')='5/2461.08/0/5','week of Oct 12');
SELECT test_assert(test_sold(test_id(31),'2026-10-05','2026-10-12')='1/1200/0/1','previous week holds the Oct 8 sale');
SELECT test_assert(test_sold(test_id(31),'2026-10-01','2026-10-17')='6/3661.08/0/5','October: all six once');
SELECT test_assert((SELECT calls_made=(SELECT count(*) FROM calls WHERE organization_id=test_id(1) AND agent_id=test_id(11) AND lower(direction) IN ('outbound','outgoing')
  AND created_at>=now()-interval '2 minutes' AND created_at<now())
 FROM private.performance_rows(ARRAY[test_id(1)],now()-interval '2 minutes',now(),'2026-01-01','2026-01-02',ARRAY[test_id(11)])),'calls keep their instant window');

-- 3. Writer paths, entered now and sold before today: today's production is zero; one policy is one sale.
-- Shape: primary + two additional policies on one client (t-1, t-1, t-2) and single-policy clients (t-1, t-2, t-8).
CREATE FUNCTION public.test_rel(p_from date,p_until date) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT count(*)||'/'||coalesce(trim_scale(sum(p*12)),0)::text FROM (VALUES(1,10.0),(1,20.0),(2,25.0),(1,30.0),(2,40.0),(8,60.0)) v(o,p)
 WHERE public.test_la_today()-o>=p_from AND public.test_la_today()-o<p_until $$;
CREATE FUNCTION public.test_rel_payload(p_offset integer,p_premium numeric) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT public.test_client_payload()||jsonb_build_object('assigned_agent_id',public.test_id(32),'premium',p_premium,
  'sold_date',(public.test_la_today()-p_offset)::text) $$;
CREATE FUNCTION public.test_rel_policy(p_offset integer,p_premium numeric) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('policy_type','Term','carrier','Test','premium',p_premium,'sold_date',(public.test_la_today()-p_offset)::text) $$;
SELECT test_actor(32);
SET ROLE authenticated;
INSERT INTO test_results VALUES('rel-1',create_client_with_sale(test_id(32101),test_id(1),test_rel_payload(1,10),true));
INSERT INTO test_results VALUES('rel-1-a',record_client_policy(test_id(32111),(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='rel-1'),test_rel_policy(1,20)));
INSERT INTO test_results VALUES('rel-1-b',record_client_policy(test_id(32112),(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='rel-1'),test_rel_policy(2,25)));
INSERT INTO test_results VALUES('rel-2',create_client_with_sale(test_id(32102),test_id(1),test_rel_payload(1,30),true));
INSERT INTO test_results VALUES('rel-3',create_client_with_sale(test_id(32103),test_id(1),test_rel_payload(2,40),true));
INSERT INTO test_results VALUES('rel-5',create_client_with_sale(test_id(32105),test_id(1),test_rel_payload(8,60),true));
INSERT INTO test_results VALUES('rel-1-retry',create_client_with_sale(test_id(32101),test_id(1),test_rel_payload(1,10),true));
INSERT INTO test_results VALUES('rel-1-a-retry',record_client_policy(test_id(32111),(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='rel-1'),test_rel_policy(1,20)));
INSERT INTO test_results VALUES('rel-today',get_leaderboard_snapshot('today'));
INSERT INTO test_results VALUES('rel-today-again',get_leaderboard_snapshot('today'));
INSERT INTO test_results VALUES('rel-day',get_performance_summary('day','own',null));
INSERT INTO test_results VALUES('rel-week',get_performance_summary('week','own',null));
INSERT INTO test_results VALUES('rel-month',get_performance_summary('month','own',null));
INSERT INTO test_results VALUES('rel-year',get_performance_summary('year','own',null));
INSERT INTO test_results VALUES('rel-details',get_performance_details('policies_sold','year','own',null,now(),0));
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT test_assert((SELECT count(*)=6 AND count(DISTINCT policy_id)=6 FROM wins WHERE agent_id=test_id(32)),'six policies, six sale events, none duplicated');
SELECT test_assert((SELECT data->'win_ids' FROM test_results WHERE key='rel-1')=(SELECT data->'win_ids' FROM test_results WHERE key='rel-1-retry')
 AND (SELECT data->'win_ids' FROM test_results WHERE key='rel-1-a')=(SELECT data->'win_ids' FROM test_results WHERE key='rel-1-a-retry'),'retries return the original sale');
SELECT test_assert((SELECT x->>'policies_sold'='0' AND x->>'recent_wins_7d'='5' FROM test_results r CROSS JOIN LATERAL jsonb_array_elements(r.data->'rows') x
 WHERE r.key='rel-today' AND (x->>'agent_id')::uuid=test_id(32)),'entered today, sold earlier: today is zero; the 7-day badge counts Sold Dates');
SELECT test_assert((SELECT data->>'policy_date_basis'='sold_date' AND (data->>'sold_date_from')::date=test_la_today() AND (data->>'sold_date_through')::date=test_la_today()
 AND (data->>'undated_policies')::int=(SELECT count(*) FROM wins WHERE organization_id=test_id(1) AND sold_date IS NULL) FROM test_results WHERE key='rel-today'),'snapshot discloses its Sold Date basis and window');
SELECT test_assert((SELECT data->'rows' FROM test_results WHERE key='rel-today')=(SELECT data->'rows' FROM test_results WHERE key='rel-today-again'),'repeated reads are stable');
SELECT test_assert((SELECT (data->'current'->>'policies')::int=0 AND (data->'previous'->>'policies')::int=3 AND (data->>'previous_sold_date_from')::date=test_la_today()-1
 AND (data->>'previous_sold_date_through')::date=test_la_today()-1 FROM test_results WHERE key='rel-day'),'today zero, yesterday three');
SELECT test_assert((SELECT (data->'current'->>'policies')||'/'||trim_scale((data->'current'->>'annual_premium')::numeric)::text=test_rel(test_period_start('week'),test_la_today()+1)
 AND (data->'previous'->>'policies')::int=split_part(test_rel(test_period_start('week')-7,test_period_start('week')),'/',1)::int FROM test_results WHERE key='rel-week'),'week and previous week by Sold Date');
SELECT test_assert((SELECT (data->'current'->>'policies')||'/'||trim_scale((data->'current'->>'annual_premium')::numeric)::text=test_rel(test_period_start('month'),test_la_today()+1)
 AND (data->'previous'->>'policies')::int=split_part(test_rel((test_period_start('month')-interval '1 month')::date,test_period_start('month')),'/',1)::int
 AND (data->>'sold_date_from')::date=test_period_start('month') FROM test_results WHERE key='rel-month'),'month and previous month by Sold Date');
SELECT test_assert((SELECT (data->'current'->>'policies')||'/'||trim_scale((data->'current'->>'annual_premium')::numeric)::text=test_rel(test_period_start('year'),test_la_today()+1)
 FROM test_results WHERE key='rel-year'),'year by Sold Date');
SELECT test_assert((SELECT jsonb_array_length(data->'rows')=split_part(test_rel(test_period_start('year'),test_la_today()+1),'/',1)::int
 AND data->>'policy_date_basis'='sold_date' AND (data->>'sold_date_through')::date=test_la_today()
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'rows') x WHERE (x->>'sold_date')::date>test_la_today() OR x->>'entered_at' IS NULL)
 FROM test_results WHERE key='rel-details'),'details list the same Sold Date cohort with entry time kept separately');
SELECT test_assert((SELECT array_agg((x->>'id')::uuid ORDER BY o)=(SELECT array_agg(w.id ORDER BY w.sold_date DESC,w.created_at DESC,w.id DESC) FROM wins w
  WHERE w.agent_id=test_id(32) AND w.sold_date>=test_period_start('year') AND w.sold_date<=test_la_today())
 FROM test_results r CROSS JOIN LATERAL jsonb_array_elements(r.data->'rows') WITH ORDINALITY e(x,o) WHERE r.key='rel-details'),'details ordered by Sold Date, then entry time');

-- 4. Reorder, reassignment and seller credit: ordinary edits never add, move or erase a sale.
INSERT INTO test_results SELECT 'rel-reorder-patch',jsonb_build_object('custom_fields',jsonb_set(c.custom_fields,'{additional_policies}',
 jsonb_build_array(c.custom_fields->'additional_policies'->1,c.custom_fields->'additional_policies'->0)))
 FROM clients c WHERE c.id=(SELECT (data->>'client_id')::uuid FROM test_results WHERE key='rel-1');
SELECT test_actor(32);
SET ROLE authenticated;
INSERT INTO test_results VALUES('rel-reorder',update_client_with_policy_sale((SELECT (data->>'client_id')::uuid FROM test_results WHERE key='rel-1'),
 (SELECT data FROM test_results WHERE key='rel-reorder-patch')));
RESET ROLE;
SELECT test_actor(13);
SET ROLE authenticated;
INSERT INTO test_results VALUES('rel-reassign',update_client_with_policy_sale((SELECT (data->>'client_id')::uuid FROM test_results WHERE key='rel-2'),jsonb_build_object('assigned_agent_id',test_id(33))));
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT test_assert((SELECT data->'win_ids'='[]'::jsonb FROM test_results WHERE key='rel-reorder') AND (SELECT data->'win_ids'='[]'::jsonb FROM test_results WHERE key='rel-reassign'),'edits create no sale');
SELECT test_assert((SELECT count(*)=6 FROM wins WHERE agent_id=test_id(32)) AND NOT EXISTS(SELECT 1 FROM wins WHERE agent_id=test_id(33)),'original seller keeps every sale after reassignment');
SELECT test_assert(test_sold(test_id(32),test_period_start('year'),test_la_today()+1)=split_part(test_rel(test_period_start('year'),test_la_today()+1),'/',1)||'/'
 ||split_part(test_rel(test_period_start('year'),test_la_today()+1),'/',2)||'/0/5','seller totals unchanged by reorder and reassignment');
SELECT test_assert(test_sold(test_id(33),test_period_start('year'),test_la_today()+1)='0/0/0/0','the new owner receives no seller credit');

-- 5. Future, undated and late entries. (Helpers insert a policy and its sale together: checks stay deferred.)
SET CONSTRAINTS ALL DEFERRED;
SELECT test_sold_policy(test_id(32201),test_id(32),test_la_today()+1,now(),70);
SELECT test_sold_policy(test_id(32202),test_id(32),NULL,now(),80);
SELECT test_assert(test_sold(test_id(32),test_la_today(),test_la_today()+1) LIKE '0/%','a future Sold Date never counts today');
SELECT test_assert(test_sold(test_id(32),test_period_start('month'),test_la_today()+1)=split_part(test_rel(test_period_start('month'),test_la_today()+1),'/',1)||'/'
 ||split_part(test_rel(test_period_start('month'),test_la_today()+1),'/',2)||'/0/5','future and undated sales stay out of the month to date');
SELECT test_assert(test_sold(test_id(32),test_la_today()+1,test_la_today()+2) LIKE '1/840/%','the future sale counts on its own date');
SELECT test_assert(split_part(test_sold(test_id(32),test_la_today()-180,test_la_today()+186),'/',1)::int
 =(SELECT count(sold_date) FROM wins WHERE agent_id=test_id(32)) AND (SELECT count(*)-count(sold_date) FROM wins WHERE agent_id=test_id(32))=1,'the undated sale is never placed in any window');
SELECT test_sold_policy(test_id(32203),test_id(32),test_la_today()-1,now(),90);
SELECT test_actor(32);
SET ROLE authenticated;
INSERT INTO test_results VALUES('late-day',get_performance_summary('day','own',null));
INSERT INTO test_results VALUES('late-today',get_leaderboard_snapshot('today'));
RESET ROLE;
SELECT test_assert((SELECT (data->'current'->>'policies')::int=0 AND (data->'previous'->>'policies')::int=4 AND (data->>'undated_policies')::int=1
 FROM test_results WHERE key='late-day'),'a late entry lands on its Sold Date; undated disclosed, not counted');
SELECT test_assert((SELECT (data->>'undated_policies')::int=(SELECT count(*) FROM wins WHERE organization_id=test_id(1) AND sold_date IS NULL)
 AND (data->>'undated_policies')::int>=1 FROM test_results WHERE key='late-today'),'snapshot discloses undated sales organization-wide');

-- 6. Group uses the viewing agency's calendar; cross-tenant rows never appear without membership.
SELECT test_sold_policy(test_id(32301),test_id(21),test_la_today(),now(),15,NULL,test_id(2));
SELECT test_sold_policy(test_id(32302),test_id(21),test_la_today()+1,now(),15,NULL,test_id(2));
SELECT test_actor(11);
SET ROLE authenticated;
INSERT INTO test_results VALUES('group-today',get_leaderboard_snapshot('today',test_id(20200)));
INSERT INTO test_results VALUES('org-today',get_leaderboard_snapshot('today'));
INSERT INTO test_results VALUES('org-feed',get_leaderboard_recent_wins());
RESET ROLE;
SELECT test_assert((SELECT x->>'policies_sold'='1' FROM test_results r CROSS JOIN LATERAL jsonb_array_elements(r.data->'rows') x
 WHERE r.key='group-today' AND (x->>'agent_id')::uuid=test_id(21)),'peer sale counts once, future peer sale excluded');
SELECT test_assert((SELECT data->>'time_zone'='America/Los_Angeles' AND (data->>'sold_date_through')::date=test_la_today() FROM test_results WHERE key='group-today'),'group window uses the viewer agency calendar');
SELECT test_assert((SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'rows') x WHERE (x->>'organization_id')::uuid<>test_id(1)) FROM test_results WHERE key='org-today')
 AND (SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data) x WHERE (x->>'agent_id')::uuid=test_id(21)) FROM test_results WHERE key='org-feed'),'no cross-tenant rows');
UPDATE agency_group_members SET status='removed' WHERE agency_group_id=test_id(20200) AND organization_id=test_id(1);
SET ROLE authenticated;
SELECT test_reject($q$SELECT get_leaderboard_snapshot('today',test_id(20200))$q$,'42501');
RESET ROLE;
UPDATE agency_group_members SET status='active' WHERE agency_group_id=test_id(20200) AND organization_id=test_id(1);

-- 7. Recent Wins: unchanged latest-entry order, with Sold Date and true entry time on every item.
SELECT test_assert((SELECT array_agg((x->>'id')::uuid ORDER BY o)=(SELECT array_agg(w.id ORDER BY w.created_at DESC,w.id) FROM (SELECT id,created_at FROM wins
  WHERE organization_id=test_id(1) AND created_at<now() ORDER BY created_at DESC,id LIMIT 20) w)
 FROM test_results r CROSS JOIN LATERAL jsonb_array_elements(r.data) WITH ORDINALITY e(x,o) WHERE r.key='org-feed'),'feed order unchanged');
SELECT test_assert((SELECT bool_and(x ? 'sold_date' AND (x->>'entered_at')::timestamptz=coalesce(w.recorded_at,w.created_at))
 FROM test_results r CROSS JOIN LATERAL jsonb_array_elements(r.data) x JOIN wins w ON w.id=(x->>'id')::uuid WHERE r.key='org-feed'),'each item carries Sold Date and true entry time');

-- 8. Scope, roles and grants (no RLS change).
SELECT test_actor(32);
SET ROLE authenticated;
SELECT test_reject($q$SELECT get_performance_summary('month','own',test_id(31))$q$,'42501');
SELECT test_reject($q$SELECT get_performance_summary('month','team')$q$,'42501');
SELECT test_reject($q$SELECT * FROM private.performance_sale_window('America/Los_Angeles','month',now())$q$,'42501');
SELECT test_reject($q$SELECT * FROM private.performance_rows(ARRAY[test_id(1)],now()-interval '1 day',now(),current_date,current_date+1)$q$,'42501');
RESET ROLE;
SELECT test_actor(14);
SET ROLE authenticated;
INSERT INTO test_results VALUES('tl-team',get_performance_summary('month','team'));
INSERT INTO test_results VALUES('tl-downline',get_performance_summary('month','own',test_id(31)));
RESET ROLE;
SELECT test_assert((SELECT data->'agent_ids' @> jsonb_build_array(test_id(31),test_id(32),test_id(14)) AND NOT data->'agent_ids' @> jsonb_build_array(test_id(33))
 AND NOT data->'agent_ids' @> jsonb_build_array(test_id(12)) FROM test_results WHERE key='tl-team'),'team leader: self and downline only');
SELECT test_assert((SELECT data->'agent_ids'=jsonb_build_array(test_id(31)) FROM test_results WHERE key='tl-downline'),'team leader may select a downline agent');
SELECT test_actor(13);
SET ROLE authenticated;
INSERT INTO test_results VALUES('admin-month',get_performance_summary('month','team'));
INSERT INTO test_results VALUES('admin-snapshot',get_leaderboard_snapshot('month'));
RESET ROLE;
SELECT test_assert((SELECT (data->'current'->>'policies')::int=(SELECT count(*) FROM wins WHERE organization_id=test_id(1)
  AND sold_date>=test_period_start('month') AND sold_date<=test_la_today()) FROM test_results WHERE key='admin-month'),'admin agency month equals every org sale by Sold Date');
SELECT test_assert((SELECT (SELECT coalesce(sum((x->>'policies_sold')::int),0) FROM jsonb_array_elements(data->'rows') x)+(data->'excluded'->>'policies_sold')::int
 =(SELECT count(*) FROM wins WHERE organization_id=test_id(1) AND sold_date>=test_period_start('month') AND sold_date<=test_la_today())
 FROM test_results WHERE key='admin-snapshot'),'board plus disclosed outside-roster sales reconcile to the org total');
SELECT test_actor(16);
SET ROLE authenticated;
SELECT test_assert((get_performance_summary('month','team')->>'organization_id')::uuid=test_id(1),'super admin stays in the home organization');
RESET ROLE;
SELECT test_actor(16,2);
SET ROLE authenticated;
SELECT test_reject($q$SELECT get_performance_summary('month','team')$q$,'42501');
SELECT test_assert((get_leaderboard_snapshot('month')->>'organization_id')::uuid=test_id(1),'a forged organization claim cannot select another board');
RESET ROLE;
SET ROLE anon;
SELECT test_reject($q$SELECT get_leaderboard_snapshot('month')$q$,'42501');
SELECT test_reject($q$SELECT get_leaderboard_recent_wins()$q$,'42501');
SELECT test_reject($q$SELECT get_performance_summary('month','own',null)$q$,'42501');
SELECT test_reject($q$SELECT get_performance_details('policies_sold','month','own',null,now(),0)$q$,'42501');
SELECT test_reject($q$SELECT * FROM get_org_leaderboard_stats(now()-interval '1 day',now())$q$,'42501');
SELECT test_reject($q$SELECT * FROM get_trusted_today_dialer_stats_v2(test_id(32401),now()-interval '12 hours',now()+interval '12 hours',current_date)$q$,'42501');
RESET ROLE;
SELECT test_assert((SELECT bool_and(proacl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[] AND prosecdef AND proowner='postgres'::regrole)
 FROM pg_proc WHERE oid IN('public.get_leaderboard_snapshot(text,uuid)'::regprocedure,'public.get_leaderboard_recent_wins(uuid)'::regprocedure,
  'public.get_performance_summary(text,text,uuid)'::regprocedure,'public.get_performance_details(text,text,text,uuid,timestamptz,integer)'::regprocedure,
  'public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure,'public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure,
  'public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date)'::regprocedure)),'exact public ACLs');
SELECT test_assert((SELECT bool_and(proacl='{postgres=X/postgres}'::aclitem[] AND NOT prosecdef) FROM pg_proc WHERE oid IN(
  'private.performance_rows(uuid[],timestamptz,timestamptz,date,date,uuid[])'::regprocedure,'private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz,date,date)'::regprocedure,
  'private.performance_sale_window(text,text,timestamptz)'::regprocedure,'private.performance_require_sale_window(date,date)'::regprocedure,
  'private.dialer_sale_day_check(timestamptz,timestamptz,date)'::regprocedure)),'private helpers stay unexposed');

-- 9. Legacy organization endpoint (no current caller) agrees with the Sold Date summary.
SELECT test_actor(32);
SET ROLE authenticated;
INSERT INTO test_results VALUES('legacy-org',(SELECT jsonb_agg(to_jsonb(t)) FROM get_org_leaderboard_stats(
 test_period_start('month')::timestamp AT TIME ZONE 'America/Los_Angeles',now()) t));
INSERT INTO test_results VALUES('own-month-after',get_performance_summary('month','own',null));
RESET ROLE;
SELECT test_assert((SELECT x->>'policies_sold' FROM test_results r CROSS JOIN LATERAL jsonb_array_elements(r.data) x WHERE r.key='legacy-org' AND (x->>'agent_id')::uuid=test_id(32))
 =(SELECT data->'current'->>'policies' FROM test_results WHERE key='own-month-after'),'legacy endpoint and summary agree on Sold Date totals');

-- 10. Dialer v2: agent-local day (New York agent, Los Angeles agency) and campaign scope; legacy unchanged.
CREATE TABLE public.test_dialer_day AS SELECT d,(d::timestamp AT TIME ZONE 'America/New_York') s,((d+1)::timestamp AT TIME ZONE 'America/New_York') e
 FROM (SELECT (now() AT TIME ZONE 'America/New_York')::date d) x;
GRANT SELECT ON public.test_dialer_day TO authenticated,anon;
-- Entered today (strictly inside the agent-local day, before now) or the day before; sold on the dates shown.
SELECT test_sold_policy(test_id(32501),test_id(32),(SELECT d FROM test_dialer_day),(SELECT s+(now()-s)/2 FROM test_dialer_day),11,test_id(32401));
SELECT test_sold_policy(test_id(32502),test_id(32),(SELECT d-1 FROM test_dialer_day),(SELECT s+(now()-s)/2 FROM test_dialer_day),12,test_id(32401));
SELECT test_sold_policy(test_id(32503),test_id(32),(SELECT d FROM test_dialer_day),now()-interval '26 hours',13,test_id(32401));
SELECT test_sold_policy(test_id(32504),test_id(32),(SELECT d-3 FROM test_dialer_day),(SELECT s+(now()-s)/2 FROM test_dialer_day),14,test_id(32401));
-- The call too sits strictly inside the agent-local day: a fixed offset like "now() - 1 minute" falls on the previous
-- day when the suite runs in the first minute after New York midnight.
INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,direction,duration,created_at)
 VALUES(test_id(32601),test_id(1),test_id(32),test_id(32401),'outbound',60,(SELECT s+(now()-s)/2 FROM test_dialer_day));
SELECT test_actor(32);
SET ROLE authenticated;
INSERT INTO test_results VALUES('dialer-v2',(SELECT to_jsonb(t) FROM test_dialer_day x,get_trusted_today_dialer_stats_v2(test_id(32401),x.s,x.e,x.d) t));
INSERT INTO test_results VALUES('dialer-legacy',(SELECT to_jsonb(t) FROM test_dialer_day x,get_trusted_today_dialer_stats(test_id(32401),x.s,x.e) t));
SELECT test_reject($q$SELECT * FROM test_dialer_day x,get_trusted_today_dialer_stats_v2(test_id(32401),x.s,x.e,x.d+2)$q$,'22023');
SELECT test_reject($q$SELECT * FROM test_dialer_day x,get_trusted_today_dialer_stats_v2(test_id(32401),x.s,x.e+interval '1 day',x.d)$q$,'22023');
SELECT test_reject($q$SELECT * FROM test_dialer_day x,get_trusted_today_dialer_stats_v2(test_id(32401),x.s,x.e,NULL)$q$,'22023');
SELECT test_reject($q$SELECT * FROM test_dialer_day x,get_trusted_today_dialer_stats_v2(test_id(32401),x.s+interval '3 days',x.e+interval '3 days',x.d+3)$q$,'22023');
RESET ROLE;
SELECT test_assert((SELECT (data->>'policies_sold')::int=2 AND data->>'policy_date_basis'='sold_date' AND (data->>'policy_sale_date')::date=(SELECT d FROM test_dialer_day)
 FROM test_results WHERE key='dialer-v2'),'v2 counts campaign sales on the agent-local Sold Date and echoes its basis');
SELECT test_assert((SELECT (data->>'policies_sold')::int=3 FROM test_results WHERE key='dialer-legacy'),'legacy reader keeps entry-time semantics for pre-release tabs');
SELECT test_assert((SELECT v.data-ARRAY['policies_sold','policy_date_basis','policy_sale_date']=l.data-'policies_sold' AND (v.data->>'calls_made')::int=1
 AND (v.data->>'contacted_calls')::int=1 AND (v.data->>'total_talk_seconds')::int=60 FROM test_results v,test_results l
 WHERE v.key='dialer-v2' AND l.key='dialer-legacy'),'calls, contacted, talk time and sessions are unchanged in v2');
SELECT test_actor(13);
SET ROLE authenticated;
SELECT test_assert((SELECT policies_sold=0 FROM test_dialer_day x,get_trusted_today_dialer_stats_v2(test_id(32401),x.s,x.e,x.d)),'v2 stays self-scoped for an Admin');
RESET ROLE;
SELECT test_assert(md5(pg_get_functiondef('public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure))='c6cddd40cb7e85a1fab4ac565a3c7949'
 AND obj_description('public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure,'pg_proc') LIKE 'Legacy compatibility%','legacy Dialer reader byte-identical and labelled');
DROP TABLE public.test_dialer_day;
