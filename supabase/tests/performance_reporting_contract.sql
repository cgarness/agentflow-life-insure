-- Run after identity tests in a new transaction: now() is one frozen as-of.
SELECT test_actor(11);
SELECT test_assert(private.performance_monthly(true,0,99)=0,'known zero cannot borrow client premium');
SELECT test_assert(private.performance_monthly(true,null,99) IS NULL,'unknown snapshot remains unknown');
SELECT test_assert(private.performance_monthly(false,0,75)=75,'legacy secured fallback');
SELECT test_assert(private.performance_monthly(true,58.45,0)*12=701.40,'premium cents retained');
SELECT test_actor(11);
SET ROLE authenticated;
SELECT test_reject($q$SELECT premium FROM clients WHERE id=test_id(20090)$q$,'42501');
INSERT INTO test_results VALUES('agent-legacy-feed',get_leaderboard_recent_wins());
RESET ROLE;
SELECT test_actor(13);
SET ROLE authenticated;
INSERT INTO test_results VALUES('admin-legacy-feed',get_leaderboard_recent_wins());
RESET ROLE;
SELECT test_assert((SELECT count(*)=2 AND bool_and((w->>'premiumSold')::numeric=900 AND (w->>'premium_known')::boolean) FROM test_results r CROSS JOIN LATERAL jsonb_array_elements(r.data) w WHERE r.key IN ('agent-legacy-feed','admin-legacy-feed') AND (w->>'id')::uuid=test_id(20091)),'Agent and Admin receive the same secured 900 legacy annual premium');
SELECT test_actor(11);
INSERT INTO public.calls(id,organization_id,agent_id,direction,duration,created_at)
 VALUES(test_id(20101),test_id(1),test_id(11),'outbound',81,now()-interval '1 minute'),
 (test_id(20102),test_id(1),test_id(11),'inbound',400,now()-interval '1 minute'),
 (test_id(20103),test_id(1),test_id(11),'outbound',29,now()-interval '1 minute'),
 (test_id(20104),test_id(1),null,'outbound',52,now()-interval '1 minute'),
 (test_id(20105),test_id(1),test_id(11),'outbound',999,now()+interval '1 day');
INSERT INTO public.appointments(id,organization_id,user_id,created_by,title,start_time,end_time,status,created_at)
 VALUES(test_id(20111),test_id(1),test_id(12),test_id(11),'Setter fixture',now()+interval '1 hour',now()+interval '2 hours','Cancelled',now()-interval '1 minute');
INSERT INTO public.agency_group_members(agency_group_id,organization_id,status)
 VALUES(test_id(20200),test_id(1),'active'),(test_id(20200),test_id(2),'active');
INSERT INTO public.company_settings VALUES(test_id(2),'America/New_York') ON CONFLICT DO NOTHING;
SET ROLE authenticated;
INSERT INTO test_results VALUES('performance-snapshot',get_leaderboard_snapshot('month'));
INSERT INTO test_results VALUES('performance-feed',get_leaderboard_recent_wins());
INSERT INTO test_results VALUES('performance-summary',get_performance_summary('month','own',null));
INSERT INTO test_results VALUES('performance-detail',get_performance_details('calls_today','month','own',null,now(),0));
SELECT test_reject($q$SELECT get_leaderboard_snapshot('year')$q$,'22023');
SELECT test_reject($q$SELECT get_leaderboard_snapshot('month',test_id(20201))$q$,'42501');
SELECT test_reject($q$SELECT get_performance_summary('year','own',test_id(21))$q$,'42501');
SELECT test_reject($q$SELECT get_performance_details('calls_today','month','own',null,now()+interval '1 second',0)$q$,'22023');
RESET ROLE;
SELECT test_assert((SELECT data->>'time_zone'='America/Los_Angeles' AND (data->>'start_at')::timestamptz=date_trunc('month',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' FROM test_results WHERE key='performance-snapshot'),'server agency calendar');
SELECT test_assert((SELECT (data->'current'->>'calls')::int=(SELECT count(*) FROM calls WHERE organization_id=test_id(1) AND agent_id=test_id(11) AND direction IN ('outbound','outgoing') AND created_at>=date_trunc('month',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AND created_at<now()) FROM test_results WHERE key='performance-summary'),'summary outbound scoped parity; no future calls');
SELECT test_assert((SELECT (data->'excluded'->>'calls_made')::int>=1 FROM test_results WHERE key='performance-snapshot'),'unattributed calls disclosed');
SELECT test_assert((SELECT jsonb_array_length(data->'rows')=(SELECT count(*) FROM profiles WHERE organization_id=test_id(1) AND status='Active') FROM test_results WHERE key='performance-snapshot'),'all active roles appear');
SELECT test_assert(NOT has_function_privilege('anon','public.get_performance_summary(text,text,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','private.performance_scope(uuid,text)','EXECUTE'),'summary privileges sealed');
SELECT test_assert((SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'rows') x WHERE x->>'direction'='inbound') FROM test_results WHERE key='performance-detail'),'details match outbound contract');
-- Exact mappings preserve raw rows, cannot cross organizations or form chains.
INSERT INTO private.performance_duplicate_rows VALUES(test_id(1),'call',test_id(20103),test_id(20101),'fixture-evidence',now());
SELECT test_assert((SELECT count(*)=2 FROM calls WHERE id IN(test_id(20103),test_id(20101))),'mapping preserves history');
SELECT test_reject($q$INSERT INTO private.performance_duplicate_rows VALUES(test_id(1),'call',test_id(20101),test_id(20103),'bad',now())$q$,'23514');
SELECT test_assert((SELECT sum(calls_made) FROM private.performance_rows(ARRAY[test_id(1)],now()-interval '2 minutes',now(),ARRAY[test_id(11)]))=(SELECT count(*)-1 FROM calls WHERE organization_id=test_id(1) AND agent_id=test_id(11) AND direction='outbound' AND created_at>=now()-interval '2 minutes' AND created_at<now()),'reviewed duplicate excluded once');
DELETE FROM private.performance_duplicate_rows;
-- Missing zone must fail rather than silently using UTC/browser local.
UPDATE company_settings SET timezone='' WHERE organization_id=test_id(1);
SET ROLE authenticated;
SELECT test_reject($q$SELECT get_leaderboard_snapshot('month')$q$,'55000');
SELECT test_reject($q$SELECT get_performance_summary('year','own')$q$,'55000');
RESET ROLE;
UPDATE company_settings SET timezone='America/Los_Angeles' WHERE organization_id=test_id(1);
-- Server authorization uses actual profile authority, not a forged organization or UI filtering.
SELECT test_actor(11,2);
SET ROLE authenticated;
SELECT test_assert((get_leaderboard_snapshot('month')->>'organization_id')::uuid=test_id(1),'forged JWT org cannot select a different board');
SELECT test_reject($q$SELECT get_performance_summary('month','team')$q$,'42501');
RESET ROLE;
SELECT test_actor(14);
SET ROLE authenticated;
INSERT INTO test_results VALUES('team-scope',get_performance_summary('month','team'));
SELECT test_reject($q$SELECT get_performance_summary('month','own',test_id(12))$q$,'42501');
SELECT test_assert((get_performance_summary('month','own',test_id(11))->'agent_ids')=jsonb_build_array(test_id(11)),'Team Leader may select downline');
RESET ROLE;
SELECT test_assert((SELECT data->'agent_ids' @> jsonb_build_array(test_id(11),test_id(14)) AND NOT data->'agent_ids' @> jsonb_build_array(test_id(12)) FROM test_results WHERE key='team-scope'),'team self and downline only');
SELECT test_actor(13);
SET ROLE authenticated;
SELECT test_assert(get_performance_summary('year','team')->>'scope'='agency activity (all statuses)','Admin agency includes inactive/unattributed');
RESET ROLE;
UPDATE agency_group_members SET status='removed' WHERE agency_group_id=test_id(20200) AND organization_id=test_id(1);
SET ROLE authenticated;
SELECT test_reject($q$SELECT get_leaderboard_recent_wins(test_id(20200))$q$,'42501');
RESET ROLE;
UPDATE agency_group_members SET status='active' WHERE agency_group_id=test_id(20200) AND organization_id=test_id(1);
-- Even legacy additional snapshots cannot borrow a client's primary premium.
SELECT test_assert(private.performance_sale_monthly(jsonb_populate_record(null::public.wins,'{"premium_snapshot":false,"premium_amount":0,"idempotency_key":"conversion:fixture:policy:1"}'),75) IS NULL,'legacy additional unknown remains unknown');
-- Trusted Dialer shares canonical exclusions without changing campaign/local-day scope.
SELECT test_assert((SELECT proacl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[] FROM pg_proc WHERE oid='public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure),'approved exact ACL: owner, authenticated and service only');
SELECT test_actor(11);
SET ROLE anon;
SELECT test_reject($q$SELECT * FROM get_trusted_today_dialer_stats(test_id(301),now()-interval '2 minutes',now())$q$,'42501');
RESET ROLE;
INSERT INTO private.performance_duplicate_rows VALUES(test_id(1),'call',test_id(20103),test_id(20101),'fixture-second-proof',now());
UPDATE calls SET campaign_id=test_id(301) WHERE id IN(test_id(20101),test_id(20103));
SELECT test_actor(11);
SET ROLE authenticated;
INSERT INTO test_results VALUES('canonical-dialer',(SELECT to_jsonb(t) FROM get_trusted_today_dialer_stats(test_id(301),now()-interval '2 minutes',now()) t));
RESET ROLE;
SELECT test_assert((SELECT (data->>'calls_made')::int FROM test_results WHERE key='canonical-dialer')=(SELECT count(*)-1 FROM calls WHERE agent_id=test_id(11) AND campaign_id=test_id(301) AND organization_id=test_id(1) AND direction='outbound' AND created_at>=now()-interval '2 minutes' AND created_at<now()),'Dialer canonical count parity');
DELETE FROM private.performance_duplicate_rows;
SELECT test_actor(13);
SET ROLE authenticated;
SELECT test_assert((SELECT calls_made=0 AND total_talk_seconds=0 FROM get_trusted_today_dialer_stats(test_id(301),now()-interval '2 minutes',now())),'Admin trusted Dialer is still self-scoped');
RESET ROLE;
