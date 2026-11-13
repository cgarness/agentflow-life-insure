-- Team Commissions A/F acceptance on native PostgreSQL, CURRENT hierarchy, real authenticated role + RLS.
-- All data synthetic; no credentials, business writes or production connections.
\set ON_ERROR_STOP on
SET client_min_messages=warning;
SELECT pc_login(11); SET ROLE authenticated;
SELECT test_assert((get_commission_agent_scope()->>'can_view_own')::boolean,'A01 own available');
SELECT test_assert(get_scoped_commission_overview('me',NULL)#>'{summary}'=get_my_commission_overview()#>'{summary}','A01 personal money parity');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(43)])','42501');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(12)])','42501');
SELECT 'PASS A01 A02 ordinary Agent own only despite descendants' AS result;
RESET ROLE; SELECT pc_login(14); SET ROLE authenticated;
SELECT test_assert((get_scoped_commission_policy_list('selected',ARRAY[test_id(11)],p_period=>'all')->>'total_count')::int=14,'A03 direct seller exact records');
SELECT test_assert((get_scoped_commission_policy_list('selected',ARRAY[test_id(42)],p_period=>'all')->>'total_count')::int=31,'A04 indirect seller exact records');
SELECT test_assert((get_scoped_commission_policy_list('selected',ARRAY[test_id(41)],p_period=>'all')->>'total_count')::int=0,'A04 exact agent does not include descendants');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(12)])','42501');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(13)])','42501');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(21)])','42501');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(31)])','42501');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(11),test_id(31)])','42501');
SELECT 'PASS A03 A04 A05 A06 A11 hierarchy exact selection, organization and mixed-selection refusal' AS result;
-- Input validation; PostgreSQL rejects malformed UUID prior to function execution.
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[]::uuid[])','22023');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[NULL]::uuid[])','22023');
SELECT pc_reject('SELECT get_scoped_commission_overview(''all'',ARRAY[test_id(11)])','22023');
SELECT pc_reject('SELECT get_scoped_commission_overview(''me'',ARRAY[test_id(11)])','22023');
SELECT pc_reject('SELECT get_scoped_commission_overview(''unknown'',NULL)','22023');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[''bad-id'']::uuid[])','22P02');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',NULL)','22023');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[[test_id(11)],[test_id(42)]])','22023');
SELECT pc_reject('SELECT get_scoped_policy_commission(''all'',NULL,NULL)','22023');
SELECT 'PASS A12 malformed, null, empty and contradictory scope refused' AS result;
-- Selected singleton self intentionally read-only, while explicit Me keeps existing write access.
SELECT test_assert(get_scoped_policy_commission('selected',ARRAY[test_id(14)],ci_policy('ScopedLeader'))#>>'{policy,access}'='read','A19 raw self selected read-only');
SELECT test_assert(get_scoped_policy_commission('all',NULL,ci_policy('ScopedLeader'))#>>'{policy,access}'='read','A19 All self read-only');
SELECT test_assert(get_scoped_policy_commission('me',NULL,ci_policy('ScopedLeader'))#>>'{policy,access}'='write','A19 Me write preserved');
SELECT pc_reject('SELECT get_scoped_policy_commission(''selected'',ARRAY[test_id(42)],ci_policy(''Alpha''))','PT404');
SELECT 'PASS A18 A19 selected detail boundary and non-Me self read-only' AS result;
-- Contact privacy differs legitimately from seller view; current client assignment is outside Tia's downline.
SELECT cs_put('restricted',get_scoped_policy_commission('selected',ARRAY[test_id(11)],ci_policy('Juliet')));
SELECT test_assert(cs_get('restricted')->'contact'='null'::jsonb,'A15 actual caller RLS omits hidden contact entirely');
SELECT test_assert(cs_get('restricted')#>>'{policy,estimate,product_carrier}'='Synthetic Life' AND cs_get('restricted')#>>'{policy,estimate,product_name}'='Synthetic Term','F14 permitted saved carrier/product fallback');
SELECT test_assert(cs_get('restricted')::text NOT LIKE '%Juliet Synthetic%','A15 no snapshot name fallback');
SELECT cs_put('restricted_list',get_scoped_commission_policy_list('selected',ARRAY[test_id(11)],p_period=>'all',p_limit=>100));
SELECT test_assert((SELECT r->'contact'='null'::jsonb AND r->'carrier'='null'::jsonb AND r->>'category'='unknown'
 FROM jsonb_array_elements(cs_get('restricted_list')->'rows') r WHERE r->>'policy_id'=ci_policy('India')::text),
 'F14 hidden client without saved estimate exposes no carrier/product fallback');
SELECT test_assert(cs_get('restricted_list')::text NOT LIKE '%India Synthetic%', 'F14 hidden client name absent from selected-team list');
SELECT test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(get_scoped_commission_breakdown('selected',ARRAY[test_id(11)],'custom','2026-03-01','2026-03-31')->'carriers') r
 WHERE r->'carrier'='null'::jsonb AND (r->>'policies')::int>=1), 'F14 hidden no-estimate policy remains unknown carrier breakdown');
SELECT 'PASS A15 F14 restricted client under actual caller RLS' AS result;
RESET ROLE;
-- Existing Admin and Super Admin full access is independent of Own/Others toggle rows.
INSERT INTO role_permissions(organization_id,role,permissions) VALUES(test_id(1),'Admin','{"c":[]}');
SELECT pc_login(13); SET ROLE authenticated;
SELECT test_assert((get_commission_agent_scope()->>'can_view_own')::boolean,'A07 Admin Own full-access');
SELECT test_assert((get_scoped_commission_policy_list('all',NULL,p_period=>'all')->>'total_count')::int=(SELECT count(DISTINCT policy_id) FROM wins WHERE organization_id=test_id(1) AND policy_id IS NOT NULL),'A07 Admin entire same org');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(31)])','42501');
RESET ROLE; SELECT pc_login(15); SET ROLE authenticated;
SELECT test_assert((get_commission_agent_scope()->>'can_select_others')::boolean,'A07 Super Admin home org access');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(21)])','42501');
SELECT 'PASS A07 A09 Admin/Super Admin semantics, no peer organization access' AS result;
RESET ROLE;
UPDATE role_permissions SET permissions='{"c":[{"name":"View Own Commission Percentage","teamLeader":false},{"name":"View Others'' Commission Percentage","teamLeader":true}]}' WHERE role='Team Leader';
SELECT pc_login(14); SET ROLE authenticated;
SELECT test_assert(get_commission_agent_scope()->>'default_scope'='all' AND NOT (get_commission_agent_scope()->>'can_view_own')::boolean,'A08 Others only default');
SELECT pc_reject('SELECT get_scoped_commission_overview(''me'',NULL)','42501');
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(14)])','42501');
SELECT pc_reject('SELECT get_my_commission_goal(''2026-03-01'')','42501');
SELECT test_assert((get_scoped_commission_policy_list('all',NULL,p_period=>'all')->>'total_count')::int>0,'A08 team-only financial access');
RESET ROLE;
UPDATE role_permissions SET permissions='{"c":[{"name":"View Own Commission Percentage","teamLeader":true},{"name":"View Others'' Commission Percentage","teamLeader":false}]}' WHERE role='Team Leader';
SELECT pc_login(14); SET ROLE authenticated;
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(11)])','42501');
SELECT test_assert((get_commission_agent_scope()->>'available_count')::int=1,'A09 Others off self only');
RESET ROLE;
INSERT INTO role_permissions(organization_id,role,permissions) VALUES(test_id(1),'Agent','{"c":[{"name":"View Own Commission Percentage","agent":false},{"name":"View Others'' Commission Percentage","agent":true}]}');
SELECT pc_login(11); SET ROLE authenticated;
SELECT test_assert((get_commission_agent_scope()->>'available_count')::int=0,'A13 empty ordinary Agent roster');
SELECT 'PASS A08 A09 A13 Own/Others combinations and empty authorized universe' AS result;
RESET ROLE; DELETE FROM role_permissions WHERE role IN('Agent','Admin');
UPDATE role_permissions SET permissions='{"c":[{"name":"View Own Commission Percentage","teamLeader":true},{"name":"View Others'' Commission Percentage","teamLeader":true}]}' WHERE role='Team Leader';
-- Token remains privileged while current profile is demoted, inactive, deleted, moved to another organization.
SELECT pc_login(14);
UPDATE profiles SET role='Agent' WHERE id=test_id(14);
SET ROLE authenticated;
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(11)])','42501');
SELECT test_assert(get_commission_agent_scope()->>'can_view_own'='true','A10 personal access survives demotion');
SELECT cs_put('demoted_all',get_scoped_commission_policy_list('all',NULL,p_period=>'all'));
SELECT test_assert(cs_get('demoted_all')#>'{meta,agent_scope,agent_ids}'=jsonb_build_array(test_id(14))
 AND cs_get('demoted_all')->>'total_count'='1'
 AND cs_get('demoted_all')->'totals'=get_my_commission_policy_list(p_period=>'all')->'totals',
 'A10 All recomputes to own IDs and exact personal financial totals after demotion');
RESET ROLE; UPDATE profiles SET role='Team Leader',status='Inactive' WHERE id=test_id(14);
SET ROLE authenticated; SELECT pc_reject('SELECT get_commission_agent_scope()','42501'); RESET ROLE;
UPDATE profiles SET status='Active',organization_id=test_id(2) WHERE id=test_id(14);
SET ROLE authenticated; SELECT pc_reject('SELECT get_scoped_commission_overview(''all'',NULL)','42501'); RESET ROLE;
UPDATE profiles SET organization_id=test_id(1) WHERE id=test_id(14);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000009999","role":"authenticated","app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000001","role":"Admin"}}',false);
SET ROLE authenticated; SELECT pc_reject('SELECT get_commission_agent_scope()','42501'); RESET ROLE;
SELECT 'PASS A10 stale demotion/deactivation/org mismatch and missing actor fail closed' AS result;
-- Transfer changes authorized historical visibility only; retained deleted bridge does not sever descendant.
SELECT pc_login(14); SET ROLE authenticated;
SELECT test_assert((get_scoped_commission_policy_list('selected',ARRAY[test_id(16),test_id(45),test_id(46)],p_period=>'all')->>'total_count')::int=3,'F13 inactive/deleted seller and bridge');
SELECT cs_put('revision_before',get_commission_agent_scope()->'scope_revision');
SELECT cs_put('transfer_all_before',get_scoped_commission_policy_list('all',NULL,p_period=>'all'));
SELECT cs_put('transfer_seller_before',get_scoped_commission_policy_list('selected',ARRAY[test_id(42)],p_period=>'all'));
RESET ROLE; UPDATE profiles SET upline_id=test_id(12),hierarchy_path='n12.n41.n42' WHERE id=test_id(42);
SET ROLE authenticated;
SELECT pc_reject('SELECT get_scoped_commission_overview(''selected'',ARRAY[test_id(42)])','42501');
SELECT test_assert(get_commission_agent_scope()->'scope_revision' IS DISTINCT FROM cs_get('revision_before'),'F12 authorization revision changed');
SELECT cs_put('transfer_all_after',get_scoped_commission_policy_list('all',NULL,p_period=>'all'));
SELECT test_assert(NOT (cs_get('transfer_all_after')#>'{meta,agent_scope,agent_ids}' ? test_id(42)::text)
 AND (cs_get('transfer_all_after')->>'total_count')::int=(cs_get('transfer_all_before')->>'total_count')::int-31,
 'F12 All removes transferred seller ID and all31 historical policies');
DO $$ DECLARE k text; BEGIN
 FOR k IN SELECT jsonb_object_keys(cs_get('transfer_all_before')->'totals') LOOP
  IF jsonb_typeof(cs_get('transfer_all_before')#>ARRAY['totals',k])='number' THEN
   PERFORM test_assert((cs_get('transfer_all_after')#>>ARRAY['totals',k])::numeric=
    (cs_get('transfer_all_before')#>>ARRAY['totals',k])::numeric-(cs_get('transfer_seller_before')#>>ARRAY['totals',k])::numeric,
    'F12 All removes transferred seller financial total '||k);
  END IF;
 END LOOP;
END $$;
RESET ROLE;
SELECT test_assert(to_jsonb(cs_history_digest())=cs_get('history_before'),'F12 transfer preserves all history bytes');
UPDATE profiles SET upline_id=test_id(41),hierarchy_path='n14.n41.n42' WHERE id=test_id(42);
SELECT 'PASS F12 F13 current hierarchy transfer, inactive/deleted history and deleted intermediate' AS result;
-- Roster paging/search never changes All membership or total amounts.
SELECT pc_login(14); SET ROLE authenticated;
SELECT cs_put('roster_all',get_commission_agent_scope());
SELECT test_assert((get_commission_agent_scope('Indirect',1,0)->>'available_count')::int=(cs_get('roster_all')->>'available_count')::int,'U17 available universe independent of search');
SELECT test_assert(get_commission_agent_scope('Indirect',1,0)->'scope_revision'=cs_get('roster_all')->'scope_revision','U17 revision independent of picker search');
SELECT test_assert((get_commission_agent_scope('zzzz no match',1,0)->>'total_count')::int=0,'U17 empty search');
SELECT 'PASS U17 all independently resolves full universe despite picker search and paging' AS result;
RESET ROLE;
-- A16: every directly callable data helper validates the caller/scope itself, including presentation switches.
SELECT pc_login(14); SET ROLE authenticated;
SELECT pc_reject('SELECT * FROM policy_commission_scoped.resolve_scope(''selected'',ARRAY[test_id(31)])','42501');
SELECT pc_reject('SELECT * FROM policy_commission_scoped.viewer(''selected'',ARRAY[test_id(31)])','42501');
SELECT pc_reject('SELECT * FROM policy_commission_scoped.policies(''selected'',ARRAY[test_id(31)])','42501');
SELECT pc_reject('SELECT * FROM policy_commission_scoped.installments(''selected'',ARRAY[test_id(31)],current_date)','42501');
SELECT pc_reject('SELECT * FROM policy_commission_scoped.installments(''selected'',ARRAY[test_id(11)],current_date,p_kind=>''not-a-kind'')','22023');
SELECT pc_reject('SELECT * FROM policy_commission_scoped.installments(''selected'',ARRAY[test_id(11)],current_date,p_include_undated=>NULL)','22023');
SELECT pc_reject('SELECT * FROM policy_commission_scoped.installments(''selected'',ARRAY[test_id(11)],current_date,p_window_from=>''2026-04-01'',p_window_to=>''2026-03-01'')','22023');
SELECT pc_reject('SELECT * FROM policy_commission_scoped.installments(''selected'',ARRAY[test_id(11)],current_date,p_window_to=>''2199-01-01'')','22023');
-- Create an explicit unknown-date synthetic installment through the existing personal writer, then undo it.
RESET ROLE; BEGIN;
SELECT pc_login(11); SET LOCAL ROLE authenticated;
SELECT set_policy_commission_installment_timing(gen_random_uuid(),ci_inst(ci_policy('Alpha'),'advance'),ci_rev(ci_policy('Alpha')),'unknown',NULL);
RESET ROLE; SELECT pc_login(14); SET LOCAL ROLE authenticated;
SELECT test_assert(EXISTS(SELECT 1 FROM policy_commission_scoped.installments('selected',ARRAY[test_id(11)],current_date) WHERE expected_on IS NULL),
 'A16 default fact inputs preserve undated installments');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM policy_commission_scoped.installments('selected',ARRAY[test_id(11)],current_date,
 p_window_from=>'2026-03-01',p_window_to=>'2026-03-31') WHERE expected_on IS NULL)
 AND EXISTS(SELECT 1 FROM policy_commission_scoped.installments('selected',ARRAY[test_id(11)],current_date,
 p_window_from=>'2026-03-01',p_window_to=>'2026-03-31',p_include_undated=>true) WHERE expected_on IS NULL),
 'A16 date narrowing and explicit undated inclusion do not broaden seller authority');
ROLLBACK; SELECT pc_login(14); SET ROLE authenticated;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['read_overview','read_installments','read_receipts','read_policies','read_breakdown','read_policy_list','read_receipt_list'] LOOP
    PERFORM pc_reject(format('SELECT policy_commission_scoped.%I(''selected'',ARRAY[test_id(31)],p_legacy=>true)',fn),'42501');
  END LOOP;
END $$;
SELECT pc_reject('SELECT policy_commission_scoped.read_policy_detail(''selected'',ARRAY[test_id(31)],ci_policy(''Alpha''),true)','42501');
SELECT test_assert((SELECT count(*) FROM policy_commission_reporting.policies(test_id(11),test_id(1)))=0,'A16 legacy policy helper self-only');
SELECT test_assert((SELECT count(*) FROM policy_commission_reporting.installments(test_id(11),test_id(1),current_date))=0,'A16 legacy installment helper self-only');
SELECT 'PASS A16 direct granted helper validation and legacy self-only helper boundaries' AS result;
RESET ROLE;
SELECT test_assert(bool_and(NOT p.prosecdef AND p.provolatile='s' AND p.proconfig=CASE WHEN n.nspname='public' AND p.proname IN ('get_scoped_commission_overview','get_scoped_commission_installments','get_scoped_commission_policy_list') THEN ARRAY['search_path=pg_catalog, pg_temp','statement_timeout=40s'] WHEN n.nspname='public' AND p.proname='get_scoped_commission_breakdown' THEN ARRAY['search_path=pg_catalog, pg_temp','statement_timeout=20s'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
  AND pg_get_userbyid(p.proowner)='postgres' AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0)),
  'A17 new functions stable invoker fixed search path authenticated-only')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='policy_commission_scoped' OR n.nspname='public' AND (p.proname LIKE 'get_scoped_%commission%' OR p.proname='get_commission_agent_scope');
SELECT test_assert(bool_and(p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']), 'A17 legacy reader/helper timeout metadata remains unchanged')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('get_my_commission_overview','get_my_commission_installments','get_my_commission_receipts','get_my_commission_policies','get_my_policy_commission','get_my_commission_breakdown','get_my_commission_policy_list','get_my_commission_receipt_list')
 OR n.nspname='policy_commission_reporting' AND p.proname IN ('policies','installments');
SELECT test_assert(NOT has_schema_privilege('authenticated','policy_commission_scoped','CREATE'),'A17 helper schema no CREATE');
SET ROLE anon; SELECT pc_reject('SELECT get_commission_agent_scope()','42501'); RESET ROLE;
SET ROLE service_role; SELECT pc_reject('SELECT get_commission_agent_scope()','42501'); RESET ROLE;
SELECT 'PASS A17 EXECUTE ACLs and schema boundary' AS result;
-- F02/F03/F04/F05/F06: sums independently reconcile to ledger and same-caller individual selections.
SELECT pc_login(14); SET ROLE authenticated;
SELECT cs_put('a',get_scoped_commission_overview('selected',ARRAY[test_id(11)],'custom','2026-01-01','2027-12-31'));
SELECT cs_put('b',get_scoped_commission_overview('selected',ARRAY[test_id(42)],'custom','2026-01-01','2027-12-31'));
SELECT cs_put('ab',get_scoped_commission_overview('selected',ARRAY[test_id(11),test_id(42)],'custom','2026-01-01','2027-12-31'));
DO $$ DECLARE k text; BEGIN
 FOR k IN SELECT jsonb_object_keys(cs_get('a')->'summary') LOOP
  IF jsonb_typeof(cs_get('a')#>ARRAY['summary',k])='number' THEN
   PERFORM test_assert((cs_get('ab')#>>ARRAY['summary',k])::numeric=(cs_get('a')#>>ARRAY['summary',k])::numeric+(cs_get('b')#>>ARRAY['summary',k])::numeric,'F02 combined summary '||k);
  END IF;
 END LOOP;
END $$;
SELECT cs_put('breakdown',get_scoped_commission_breakdown('selected',ARRAY[test_id(11),test_id(42)],'custom','2026-01-01','2027-12-31'));
SELECT test_assert((cs_get('breakdown')#>>'{sold,estimate_cents}')::bigint=(
 SELECT sum(e.first_year_cents) FROM policy_commission_estimates e JOIN wins w ON w.id=e.win_id
 WHERE e.organization_id=test_id(1) AND e.credited_agent_id IN(test_id(11),test_id(42)) AND e.status='active' AND w.sold_date BETWEEN '2026-01-01' AND '2027-12-31'), 'F03 F06 distinct active snapshot sum; hold/superseded/capture excluded');
SELECT test_assert((cs_get('ab')#>>'{summary,received_cents}')::bigint=(SELECT sum(amount_cents) FROM policy_commission_receipts
 WHERE organization_id=test_id(1) AND credited_agent_id IN(test_id(11),test_id(42)) AND voided_at IS NULL AND received_on BETWEEN '2026-01-01' AND '2027-12-31'),'F04 valid receipts sum only once');
SELECT test_assert((SELECT excess_cents>0 FROM policy_commission_scoped.installments('selected',ARRAY[test_id(11)],current_date) WHERE policy_id=ci_policy('Kilo') AND kind='advance'),'F05 advance excess remains separate');
SELECT test_assert((SELECT remaining_cents=expected_cents FROM policy_commission_scoped.installments('selected',ARRAY[test_id(11)],current_date) WHERE policy_id=ci_policy('Kilo') AND kind='month_11'),'F05 Advance overpayment never settles Month 11');
SELECT test_assert((SELECT count(*) FROM policy_commission_scoped.policies('selected',ARRAY[test_id(11),test_id(42)]))=45,'F03 each policy exactly once');
SELECT cs_put('walk',ci_walk('SELECT get_scoped_commission_policy_list(''selected'',ARRAY[test_id(11),test_id(42)],p_period=>''all'',p_limit=>%s,p_offset=>%s)','policy_id',25));
SELECT test_assert((cs_get('walk')->>'count')::int=45 AND cs_get('walk')->>'count'=cs_get('walk')->>'distinct' AND (cs_get('walk')->>'total_count')::int=45,'F07 full totals beyond 25-row page');
SELECT 'PASS F02 F03 F04 F05 F06 F07 combined ledger reconciliation, no join multiplication, holds/voids/excess and pagination' AS result;
-- F10/F11: every carrier and category drilldown returns its full set, and comparisons use combined values/counts.
-- Transactional synthetic cohorts provide unequal, nonzero values for BOTH sellers in BOTH periods.
RESET ROLE; BEGIN; SET LOCAL session_replication_role=replica;
UPDATE wins w SET sold_date=CASE WHEN c.first_name IN ('ScopePage1','ScopePage2','ScopePage3','ScopePage4','ScopePage5','ScopePage6','ScopePage7')
 THEN DATE '2026-02-16' ELSE DATE '2026-03-04' END FROM clients c WHERE c.id=w.contact_id AND w.agent_id=test_id(42);
SET LOCAL session_replication_role=origin;
SELECT pc_login(42); SET LOCAL ROLE authenticated;
SELECT ci_pay(99201,ci_policy('ScopedIndirect'),'advance',303,DATE '2026-03-09');
SELECT ci_pay(99202,ci_policy('ScopedIndirect'),'advance',101,DATE '2026-02-17');
RESET ROLE; SELECT pc_login(14); SET LOCAL ROLE authenticated;
DO $$ DECLARE g jsonb; l jsonb; field text; a jsonb; b jsonb; ab jsonb; win text; BEGIN
 FOR g IN SELECT * FROM jsonb_array_elements(cs_get('breakdown')->'carriers') LOOP
  l:=get_scoped_commission_policy_list('selected',ARRAY[test_id(11),test_id(42)],p_carrier=>g->>'carrier',p_carrier_unknown=>(g->>'carrier' IS NULL),p_period=>'custom',p_from=>'2026-01-01',p_to=>'2027-12-31');
  PERFORM test_assert(l#>>'{totals,policies}'=g->>'policies' AND l#>>'{totals,estimate_cents}'=g->>'estimate_cents','F10 carrier drilldown');
 END LOOP;
 FOR g IN SELECT * FROM jsonb_array_elements(cs_get('breakdown')->'products') LOOP
  l:=get_scoped_commission_policy_list('selected',ARRAY[test_id(11),test_id(42)],p_category=>g->>'category',p_period=>'custom',p_from=>'2026-01-01',p_to=>'2027-12-31');
  PERFORM test_assert(l#>>'{totals,policies}'=g->>'policies' AND l#>>'{totals,estimate_cents}'=g->>'estimate_cents','F10 product drilldown');
 END LOOP;
 a:=get_scoped_commission_breakdown('selected',ARRAY[test_id(11)],'custom','2026-03-01','2026-03-31');
 b:=get_scoped_commission_breakdown('selected',ARRAY[test_id(42)],'custom','2026-03-01','2026-03-31');
 ab:=get_scoped_commission_breakdown('selected',ARRAY[test_id(11),test_id(42)],'custom','2026-03-01','2026-03-31');
 FOREACH win IN ARRAY ARRAY['current','previous'] LOOP
  PERFORM test_assert((a#>>ARRAY['comparison',win,'with_estimate_count'])::int>0
   AND (b#>>ARRAY['comparison',win,'with_estimate_count'])::int>0
   AND (a#>>ARRAY['comparison',win,'with_estimate_count'])::int<>(b#>>ARRAY['comparison',win,'with_estimate_count'])::int
   AND (a#>>ARRAY['comparison',win,'received_cents'])::int>0 AND (b#>>ARRAY['comparison',win,'received_cents'])::int>0,
   'F11 unequal nonzero cohort counts and receipts for both sellers in '||win);
  FOREACH field IN ARRAY ARRAY['policies','with_estimate_count','estimate_cents','received_cents','receipt_count'] LOOP
   PERFORM test_assert((ab#>>ARRAY['comparison',win,field])::numeric=(a#>>ARRAY['comparison',win,field])::numeric+(b#>>ARRAY['comparison',win,field])::numeric,'F11 combined underlying value '||win||field);
  END LOOP;
 END LOOP;
END $$;
ROLLBACK; SELECT pc_login(14); SET ROLE authenticated;
SELECT test_assert((cs_get('breakdown')#>>'{sold,undated_count}')::int=1,'F09 missing Sold Date remains disclosed, no fabricated date');
SELECT 'PASS F09 F10 F11 exact group drilldowns, separate dates and combined comparison numerators/counts' AS result;
RESET ROLE;
-- F08: agency timezone is checked on every financial read; calendar boundary periods remain exact.
SELECT pc_login(14); SET ROLE authenticated;
SELECT test_assert(get_scoped_commission_overview('selected',ARRAY[test_id(11)],'custom','2024-02-01','2024-02-29')#>>'{meta,to}'='2024-02-29','F08 leap month');
SELECT test_assert(get_scoped_commission_overview('selected',ARRAY[test_id(11)],'custom','2026-03-08','2026-03-08')#>>'{meta,from}'='2026-03-08','F08 daylight saving date');
SELECT test_assert(get_scoped_commission_overview('all',NULL)#>>'{meta,today}'=(now() AT TIME ZONE 'America/Los_Angeles')::date::text,'F08 agency date');
RESET ROLE;
BEGIN;
UPDATE company_settings SET timezone=NULL WHERE organization_id=test_id(1);
SET LOCAL ROLE authenticated; SELECT pc_reject('SELECT get_scoped_commission_overview(''all'',NULL)','55000');
ROLLBACK;
BEGIN;
UPDATE company_settings SET timezone='Invalid/Zone' WHERE organization_id=test_id(1);
SET LOCAL ROLE authenticated; SELECT pc_reject('SELECT get_scoped_commission_overview(''all'',NULL)','55000');
ROLLBACK;
SELECT 'PASS F08 timezone fail-closed and leap/DST boundaries' AS result;
SELECT 'PASS scoped native authorization and reconciliation acceptance' AS result;

-- F08/F09 date membership uses recorded DATE fields, including leap/month/DST boundaries.
BEGIN;
SELECT pc_login(42); SET LOCAL ROLE authenticated;
SELECT ci_date(ci_policy('ScopedIndirect'),'advance','2024-02-29');
SELECT ci_date(ci_policy('ScopedIndirect'),'month_10','2024-03-01');
SELECT ci_date(ci_policy('ScopedIndirect'),'month_11','2026-03-08');
SELECT ci_pay(94001,ci_policy('ScopedIndirect'),'advance',101,'2024-02-29');
SELECT ci_pay(94002,ci_policy('ScopedIndirect'),'month_10',202,'2024-03-01');
SELECT ci_pay(94003,ci_policy('ScopedIndirect'),'month_11',303,'2026-03-08');
SELECT test_assert(get_scoped_commission_overview('me',NULL,'custom','2024-02-01','2024-02-29')#>>'{summary,expected_cents}'='42975'
 AND get_scoped_commission_overview('me',NULL,'custom','2024-02-01','2024-02-29')#>>'{summary,received_cents}'='101',
 'F08 leap month includes February 29 only, excludes March 1');
SELECT test_assert(get_scoped_commission_overview('me',NULL,'custom','2024-03-01','2024-03-01')#>>'{summary,expected_cents}'='4775'
 AND get_scoped_commission_overview('me',NULL,'custom','2024-03-01','2024-03-01')#>>'{summary,received_cents}'='202',
 'F08 next month includes March 1 only, excludes leap day');
SELECT test_assert(get_scoped_commission_overview('me',NULL,'custom','2026-03-08','2026-03-08')#>>'{summary,expected_cents}'='4775'
 AND get_scoped_commission_overview('me',NULL,'custom','2026-03-08','2026-03-08')#>>'{summary,received_cents}'='303',
 'F08 DST-boundary calendar day includes own saved installment and receipt');
SELECT set_policy_commission_installment_timing(gen_random_uuid(),ci_inst(ci_policy('ScopedIndirect'),'advance'),ci_rev(ci_policy('ScopedIndirect')),'unknown',NULL);
SELECT test_assert((SELECT expected_on IS NULL AND window_start IS NULL FROM policy_commission_scoped.installments('me',NULL,current_date)
 WHERE policy_id=ci_policy('ScopedIndirect') AND kind='advance'),'F09 missing expected date stays NULL');
SELECT test_assert(get_scoped_commission_overview('me',NULL,'custom','2024-02-01','2024-02-29')#>>'{summary,expected_cents}'='0',
 'F09 removed expected date excluded from forecast');
SELECT test_assert((get_scoped_commission_installments('me',NULL,p_period=>'all',p_scope=>'any',p_status=>'date_needed')->>'total_count')::int>=1,
 'F09 unknown expected date appears in review');
ROLLBACK;
SELECT 'PASS F08 F09 actual leap/month/DST membership and unknown-date review/forecast exclusion' AS result;
