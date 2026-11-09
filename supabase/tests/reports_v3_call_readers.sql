SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- =====================================================================================================
-- Reports v3 call readers (plan D3 §3.7, §7 V1–V9; D1 §3.6). Disposable synthetic databases only, through
-- scripts/run_reports_v3_tests.sh. One REPEATABLE READ transaction, so every reader sees one snapshot and one
-- now(). Fixtures: O1 in reports_v3_fixtures.sql (October 2026, America/Los_Angeles). Readers are exercised
-- through rt.v3_call, whose EXECUTE grant never outlives the call.
-- Hand-computed October anchors (attempt rows): agency 10 (RC0, RC1–RC4, RC7–RC10, RC13), contacted 5;
-- team TL1 8; A1 5 (contacted 2); A2 3; A3 2. Excluded: RC5 non-attempt, RC6 unverified, RC14 duplicate,
-- RC11/RC12 inbound, RC0B (Nov 1 00:00 PDT, the window's end instant).
-- =====================================================================================================

-- Every Calls made and Contacted total of one scope, from all six readers that carry calls.
CREATE FUNCTION rt.v3_recon(p_who text, p_scope text DEFAULT NULL, p_agent text DEFAULT NULL,
                            p_start date DEFAULT '2026-10-01', p_end date DEFAULT '2026-10-31') RETURNS text LANGUAGE plpgsql AS $$
DECLARE s jsonb; v jsonb; d jsonb; c jsonb; l jsonb; st jsonb;
BEGIN
  s := rt.v3r(p_who, 'summary', p_scope, p_agent, p_start, p_end);
  v := rt.v3r(p_who, 'call_volume', p_scope, p_agent, p_start, p_end);
  d := rt.v3r(p_who, 'disposition_breakdown', p_scope, p_agent, p_start, p_end);
  c := rt.v3r(p_who, 'campaign_calls', p_scope, p_agent, p_start, p_end);
  l := rt.v3r(p_who, 'lead_source_calls', p_scope, p_agent, p_start, p_end);
  st := rt.v3r(p_who, 'state_breakdown', p_scope, p_agent, p_start, p_end);
  RETURN concat_ws('|', 'calls', rt.kpi(s, 5), rt.jsum(v, '$.heatmap[*].calls_made'), rt.jsum(v, '$.by_date[*].calls_made'),
           rt.jsum(v, '$.by_hour[*].calls_made'), rt.jsum(v, '$.by_weekday[*].calls_made'), rt.jsum(d, '$.by_disposition[*].calls'),
           rt.jsum(d, '$.duration_buckets[*].calls'), rt.jsum(c, '$.campaigns[*].calls_made') + (c #>> '{calls_without_campaign,calls_made}')::numeric
             + (c #>> '{other_campaigns,calls_made}')::numeric,
           rt.jsum(l, '$.sources[*].calls_made') + (l #>> '{not_linked,calls_made}')::numeric, st #> '{totals,calls_made}',
           'contacted', rt.kpi(s, 6), rt.jsum(v, '$.heatmap[*].contacted'), rt.jsum(v, '$.by_date[*].contacted'),
           rt.jsum(c, '$.campaigns[*].contacted_calls') + (c #>> '{calls_without_campaign,contacted_calls}')::numeric
             + (c #>> '{other_campaigns,contacted_calls}')::numeric,
           rt.jsum(l, '$.sources[*].contacted_calls') + (l #>> '{not_linked,contacted_calls}')::numeric, st #> '{totals,contacted_calls}',
           'population', (SELECT count(DISTINCT x) FROM unnest(ARRAY[rt.kpi(s, 5, 'detail')::jsonb -> 'call_population', s -> 'call_population',
             v -> 'call_population', d -> 'call_population', c -> 'call_population', l -> 'call_population', st -> 'call_population']) x));
END $$;

-- -----------------------------------------------------------------------------------------------------
-- V1, V2, V3: attempt rows only; every call surface reconciles to KPI 5 and KPI 6 at every scope, in one
-- snapshot; call_population is one block across the summary, the four call readers and the state reader.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('V2 agency: every call total = KPI 5 = 10, every contacted total = KPI 6 = 5, one call_population',
  rt.v3_recon('ADM1'), 'calls|10|10|10|10|10|10|10|10|10|10|contacted|5|5|5|5|5|5|population|1');
SELECT rt.eq('V2 team (TL1): 8 calls, 4 contacted', rt.v3_recon('TL1'), 'calls|8|8|8|8|8|8|8|8|8|8|contacted|4|4|4|4|4|4|population|1');
SELECT rt.eq('V2 personal (A1): 5 calls, 2 contacted', rt.v3_recon('A1'), 'calls|5|5|5|5|5|5|5|5|5|5|contacted|2|2|2|2|2|2|population|1');
SELECT rt.eq('V2 agent filter (ADM1 on A2): 3 calls, 2 contacted', rt.v3_recon('ADM1', NULL, 'A2'),
  'calls|3|3|3|3|3|3|3|3|3|3|contacted|2|2|2|2|2|2|population|1');
SELECT rt.eq('V2 team filter (TL1 on A1): 5 calls', rt.v3_recon('TL1', 'team', 'A1'), 'calls|5|5|5|5|5|5|5|5|5|5|contacted|2|2|2|2|2|2|population|1');
SELECT rt.eq('V2 empty window: every total 0', rt.v3_recon('ADM1', NULL, NULL, '2026-07-01', '2026-07-01'),
  'calls|0|0|0|0|0|0|0|0|0|0|contacted|0|0|0|0|0|0|population|1');
SELECT rt.eq('V3 agency call_population', rt.v3r('ADM1', 'call_volume') -> 'call_population',
  '{"attempts": 10, "non_attempts": 1, "unverified": 1, "duplicates_excluded": 1}'::jsonb);
SELECT rt.eq('V3 Partial cue follows unverified rows: agency and A1 partial, A2 available',
  concat_ws(' ', rt.kpi(rt.v3r('ADM1', 'summary'), 5, 'status'), rt.kpi(rt.v3r('A1', 'summary'), 5, 'status'),
            rt.kpi(rt.v3r('A2', 'summary'), 5, 'status')), '"partial" "partial" "available"');
SELECT rt.eq('V3 unverified only (A1 on Oct 7): KPI 5 unavailable/attempt_unverified, never 0',
  rt.kpi(rt.v3r('A1', 'summary', NULL, NULL, '2026-10-07', '2026-10-07'), 5, 'status') || ' '
  || rt.kpi(rt.v3r('A1', 'summary', NULL, NULL, '2026-10-07', '2026-10-07'), 5, 'reason') || ' '
  || rt.kpi(rt.v3r('A1', 'summary', NULL, NULL, '2026-10-07', '2026-10-07'), 5, 'value'),
  '"unavailable" "attempt_unverified" null');
SELECT rt.eq('V1 a genuine failed attempt stays counted (RC4: no outcome, 0 s, no campaign, no lead)',
  concat_ws(' ', (SELECT e -> 'calls' FROM jsonb_array_elements(rt.v3r('A1', 'disposition_breakdown') -> 'by_disposition') e WHERE e ->> 'key' = 'none'),
            rt.v3r('A1', 'campaign_calls') #> '{calls_without_campaign,calls_made}', rt.v3r('A1', 'lead_source_calls') #> '{not_linked,calls_made}'),
  '1 1 1');

-- -----------------------------------------------------------------------------------------------------
-- V9: v2 keeps its pinned bodies, and production v2 calls_made (PR #515) = v3 KPI 5.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('V9 v2 readers keep their pinned bodies',
  (SELECT string_agg(p.proname || ':' || md5(p.prosrc), ' ' ORDER BY p.proname COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (rt.v2_readers())),
  'get_report_call_summary_v2:23c21fa14b07edaeaa3901e76b243d66 get_report_call_volume_v2:a4a5e82f36e124fa8ee9d581229ef455 '
  || 'get_report_campaign_performance_v2:8d8bee228b2bed67076e2547f506264d get_report_disposition_breakdown_v2:ae4611201b9add696bfd92f4576fdd7b '
  || 'get_report_lead_source_performance_v2:8d85fff93300966502964b500eb46166 get_report_scope_v2:26a2d64831975668a492dfda2e369aac');
-- Production v2 since PR #515 (20261105051037) drops refused and unverified admissions, so it now equals v3 KPI 5;
-- v3 still discloses those rows as call_population coverage (independent counts: 10 attempts, 1 refused, 1 unverified).
SELECT rt.eq('V9 v2 calls_made (PR #515) = v3 KPI 5 = 10; v3 still discloses 1 non-attempt and 1 unverified',
  (rt.call(rt.v3('ADM1'), rt.v3('O1'), $q$SELECT public.get_report_call_summary_v2('2026-10-01', '2026-10-31', NULL, 'agency')$q$) #>> '{totals,calls_made}')
    || '|' || rt.kpi(rt.v3r('ADM1', 'summary'), 5) || '|' || (rt.v3r('ADM1', 'call_volume') #>> '{call_population,non_attempts}')
    || '|' || (rt.v3r('ADM1', 'call_volume') #>> '{call_population,unverified}'),
  '10|10|1|1');

-- -----------------------------------------------------------------------------------------------------
-- V4: hidden campaigns contribute only through "Other campaigns" (no id, name or type); V6 call-only
-- payloads with exact rate parts.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('V4 Admin sees every campaign: rows, no other campaigns',
  (SELECT string_agg(e ->> 'name' || '=' || (e ->> 'calls_made'), ', ' ORDER BY e ->> 'name' COLLATE "C") FROM jsonb_array_elements(rt.v3r('ADM1', 'campaign_calls') -> 'campaigns') e)
  || ' | without ' || (rt.v3r('ADM1', 'campaign_calls') #>> '{calls_without_campaign,calls_made}')
  || ' | other ' || (rt.v3r('ADM1', 'campaign_calls') #>> '{other_campaigns,calls_made}'),
  'V3 A1 Personal=2, V3 A3 Personal=1, V3 Team One=4, V3 Team Three=1 | without 2 | other 0');
SELECT rt.eq('V4 A1: KT3 is hidden and appears only as one Other campaigns call',
  (SELECT string_agg(e ->> 'name' || '=' || (e ->> 'calls_made'), ', ' ORDER BY e ->> 'name' COLLATE "C") FROM jsonb_array_elements(rt.v3r('A1', 'campaign_calls') -> 'campaigns') e)
  || ' | other ' || (rt.v3r('A1', 'campaign_calls') -> 'other_campaigns')::text,
  'V3 A1 Personal=2, V3 Team One=1 | other {"calls_made": 1, "contacted_calls": 1, "contact_rate_numerator": 1, "contact_rate_denominator": 1}');
SELECT rt.eq('V4 no hidden campaign id or name anywhere in A1''s call payloads',
  (SELECT count(*) FROM unnest(ARRAY['call_volume', 'disposition_breakdown', 'campaign_calls', 'lead_source_calls']) r
    WHERE rt.v3r('A1', r)::text ~ (rt.v3('KT3') || '|' || rt.v3('KH3') || '|V3 Team Three|V3 A3 Personal')),
  0::bigint);
SELECT rt.eq('V4 the A1 deep dive lists visible campaigns only, with the hidden call in other_campaigns',
  (SELECT string_agg(e ->> 'name', ', ' ORDER BY e ->> 'name' COLLATE "C") FROM jsonb_array_elements(rt.v3r('A1', 'disposition_breakdown') #> '{deep_dive,by_campaign}') e)
  || ' | ' || (rt.v3r('A1', 'disposition_breakdown') #>> '{deep_dive,other_campaigns,total}'),
  'V3 A1 Personal, V3 Team One | 1');
SELECT rt.eq('V6 call-only payloads: no policy, premium or v2 lead-funnel field in any call reader',
  (SELECT count(*) FROM unnest(ARRAY['call_volume', 'disposition_breakdown', 'campaign_calls', 'lead_source_calls']) r,
          jsonb_path_query(rt.v3r('ADM1', r), 'strict $.**') v
    WHERE jsonb_typeof(v) = 'object'
      AND EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE k ~ '(polic|premium|attribution_unavailable|leads_dialed|contacted_leads|converted|contact_rate_pct|avg_)')),
  0::bigint);
SELECT rt.eq('V6 exact contact-rate parts on every campaign and source row',
  (SELECT count(*) FROM (SELECT e FROM jsonb_array_elements(rt.v3r('ADM1', 'campaign_calls') -> 'campaigns') e
                         UNION ALL SELECT rt.v3r('ADM1', 'campaign_calls') -> 'calls_without_campaign'
                         UNION ALL SELECT rt.v3r('ADM1', 'campaign_calls') -> 'other_campaigns'
                         UNION ALL SELECT e FROM jsonb_array_elements(rt.v3r('ADM1', 'lead_source_calls') -> 'sources') e
                         UNION ALL SELECT rt.v3r('ADM1', 'lead_source_calls') -> 'not_linked') x(e)
    WHERE e -> 'contact_rate_numerator' IS DISTINCT FROM e -> 'contacted_calls'
       OR e -> 'contact_rate_denominator' IS DISTINCT FROM e -> 'calls_made'),
  0::bigint);
SELECT rt.eq('V6 the call readers carry v3 meta and no envelopes',
  (SELECT string_agg(r || ':' || (rt.v3r('ADM1', r) ->> 'reader') || ':' || (rt.v3r('ADM1', r) ->> 'basis_version') || ':'
                     || (rt.v3r('ADM1', r) -> 'metrics')::text, ' ' ORDER BY r COLLATE "C")
     FROM unnest(ARRAY['call_volume', 'disposition_breakdown', 'campaign_calls', 'lead_source_calls']) r),
  'call_volume:call_volume:reports_v3:[] campaign_calls:campaign_calls:reports_v3:[] '
  || 'disposition_breakdown:disposition_breakdown:reports_v3:[] lead_source_calls:lead_source_calls:reports_v3:[]');

-- -----------------------------------------------------------------------------------------------------
-- V5: lead sources and "Not linked to a current lead"; New leads by the v2 rule (created in the window,
-- currently assigned in scope).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('V5 agency sources: calls, contacted and New leads; RC4 and the recruit call are not linked',
  (SELECT string_agg(concat_ws(':', e ->> 'lead_source', e ->> 'calls_made', e ->> 'contacted_calls', e ->> 'new_leads'), ' ' ORDER BY e ->> 'lead_source' COLLATE "C")
     FROM jsonb_array_elements(rt.v3r('ADM1', 'lead_source_calls') -> 'sources') e)
  || ' | not linked ' || (rt.v3r('ADM1', 'lead_source_calls') #>> '{not_linked,calls_made}'),
  '(No source):1:1:1 Facebook:3:1:2 Referral:4:3:2 Web:0:0:2 | not linked 2');
SELECT rt.eq('V5 A1: New leads count only leads assigned to A1',
  (SELECT string_agg(concat_ws(':', e ->> 'lead_source', e ->> 'calls_made', e ->> 'new_leads'), ' ' ORDER BY e ->> 'lead_source' COLLATE "C")
     FROM jsonb_array_elements(rt.v3r('A1', 'lead_source_calls') -> 'sources') e),
  '(No source):1:0 Facebook:3:2 Web:0:1');
SELECT rt.eq('V5 repeated memberships never multiply calls (RL1 is in KP1 and KT12: 3 calls, not 6)',
  (SELECT e -> 'calls_made' FROM jsonb_array_elements(rt.v3r('ADM1', 'lead_source_calls') -> 'sources') e WHERE e ->> 'lead_source' = 'Facebook'),
  '3'::jsonb);

-- -----------------------------------------------------------------------------------------------------
-- V7: the heatmap is 168 Sunday-first cells in the agency zone; the spring-forward day has 23 hours.
-- V8: disposition key 'none', the five buckets, a scoped deep dive.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('V7 168 cells, Sunday-first, hour-ordered',
  (SELECT count(*) || ':' || bool_and((e ->> 'dow')::int * 24 + (e ->> 'hour')::int = o - 1)
     FROM jsonb_array_elements(rt.v3r('ADM1', 'call_volume') -> 'heatmap') WITH ORDINALITY x(e, o)), '168:true');
SELECT rt.eq('V7 agency-zone cells: Mon 09 (RC1, RC13), Thu 00 (RC0 at the window start), Thu 15 (RC7, RC8)',
  (SELECT string_agg(concat_ws(':', e ->> 'dow', e ->> 'hour', e ->> 'calls_made', e ->> 'contacted'), ' ' ORDER BY (e ->> 'dow')::int, (e ->> 'hour')::int)
     FROM jsonb_array_elements(rt.v3r('ADM1', 'call_volume') -> 'heatmap') e WHERE (e ->> 'calls_made')::int > 0),
  '1:9:2:1 1:10:1:0 2:9:1:1 2:11:1:0 4:0:1:0 4:15:2:2 5:9:1:1 5:10:1:0');
SELECT rt.eq('V7 spring-forward day 2026-03-08: one date, RC15 at 01:59 PST and RC16 at 03:00 PDT, no 02:00 hour',
  (SELECT string_agg(concat_ws(':', e ->> 'dow', e ->> 'hour', e ->> 'calls_made'), ' ' ORDER BY (e ->> 'hour')::int)
     FROM jsonb_array_elements(rt.v3r('A1', 'call_volume', NULL, NULL, '2026-03-08', '2026-03-08') -> 'heatmap') e WHERE (e ->> 'calls_made')::int > 0)
  || ' | ' || jsonb_array_length(rt.v3r('A1', 'call_volume', NULL, NULL, '2026-03-08', '2026-03-08') -> 'by_date'),
  '0:1:1 0:3:1 | 1');
SELECT rt.eq('V7 by_date keeps every agency date (31 in October) and inbound rows apart',
  jsonb_array_length(rt.v3r('ADM1', 'call_volume') -> 'by_date') || ' inbound ' || (rt.v3r('ADM1', 'call_volume') ->> 'inbound_calls')
  || ' A2 ' || (rt.v3r('A2', 'call_volume') ->> 'inbound_calls') || ' A1 ' || (rt.v3r('A1', 'call_volume') ->> 'inbound_calls'),
  '31 inbound 2 A2 1 A1 0');
SELECT rt.eq('V8 dispositions: no outcome is key none, named No outcome recorded',
  (SELECT string_agg(concat_ws(':', e ->> 'key', e ->> 'name', e ->> 'calls'), ' | ' ORDER BY e ->> 'name' COLLATE "C")
     FROM jsonb_array_elements(rt.v3r('ADM1', 'disposition_breakdown') -> 'by_disposition') e
    WHERE e ->> 'key' = 'none' OR e ->> 'name' IN ('No Answer', 'Interested')),
  'c3a71000-0000-0000-0000-000000000002:Interested:3 | c3a71000-0000-0000-0000-000000000001:No Answer:4 | none:No outcome recorded:1');
SELECT rt.eq('V8 the five duration buckets hold every attempt row exactly once',
  (SELECT string_agg(e ->> 'range' || '=' || (e ->> 'calls'), ' ' ORDER BY o) FROM jsonb_array_elements(rt.v3r('ADM1', 'disposition_breakdown') -> 'duration_buckets') WITH ORDINALITY x(e, o)),
  '0-30s=3 30s-1m=3 1-2m=2 2-5m=1 5m+=1');
SELECT rt.eq('V8 the deep dive is scoped: A1 sees only A1 and no unattributed bucket; agency has one',
  (SELECT string_agg(e ->> 'agent_id', ',') FROM jsonb_array_elements(rt.v3r('A1', 'disposition_breakdown') #> '{deep_dive,by_agent}') e)
  || ' | ' || coalesce(rt.v3r('A1', 'disposition_breakdown') #>> '{deep_dive,unattributed}', 'null')
  || ' | ' || (rt.v3r('ADM1', 'disposition_breakdown') #>> '{deep_dive,unattributed,total}'),
  rt.v3('A1') || ' | null | 0');

-- -----------------------------------------------------------------------------------------------------
-- KPI 24 (talk time) and KPI 25 (time in dialer): canonical durations of attempt rows with their quality
-- disclosed, never upgraded; clipped session intervals with the heartbeat cap, the preserved late-ended rule
-- and same-agent overlap union.
-- -----------------------------------------------------------------------------------------------------
-- October's attempt rows: estimate 50 s; legacy 10, 30, 45 s and one missing duration (unknown once); provider 60, 90,
-- 120 s; a conflicting provider 300 s; a non-answer recorded at 20 s (inconsistent, kpi24-quality-a1).
SELECT rt.eq('KPI 24 agency: 725 s over attempt rows; quality counts as recorded',
  rt.kpi(rt.v3r('ADM1', 'summary'), 24) || ' ' || rt.kpi(rt.v3r('ADM1', 'summary'), 24, 'status') || ' '
  || rt.kpi(rt.v3r('ADM1', 'summary'), 24, 'detail'),
  '725 "available" {"quality": {"unknown": 4, "estimated": 1, "conflicting": 1, "inconsistent": 1, "provider_confirmed": 3, "duplicates_excluded": 1}}');
SELECT rt.eq('KPI 25 agency: 9000 (A1 overlap union) + 10800 (A2 clipped + stale cap) + 10800 (A3 late-ended)',
  rt.kpi(rt.v3r('ADM1', 'summary'), 25) || ' ' || rt.kpi(rt.v3r('ADM1', 'summary'), 25, 'detail'),
  '30600 {"quality": {"late_ended": 1, "stale_capped": 1}}');
SELECT rt.eq('KPIs 24 and 25 per agent, and by_agent rows sum to the totals',
  (SELECT string_agg(concat_ws(':', e ->> 'name', (SELECT m ->> 'value' FROM jsonb_array_elements(e -> 'metrics') m WHERE (m ->> 'id')::int = 24),
                               (SELECT m ->> 'value' FROM jsonb_array_elements(e -> 'metrics') m WHERE (m ->> 'id')::int = 25)), ' ' ORDER BY e ->> 'name' COLLATE "C")
     FROM jsonb_array_elements(rt.v3r('ADM1', 'summary') -> 'by_agent') e),
  'Vee Admin:0:0 Vee Agent One:175:9000 Vee Agent Three:150:10800 Vee Agent Two:400:10800 Vee Leader:0:0');
SELECT rt.eq('KPIs 24 and 25 on the spring-forward day: 100 s talk, 7200 s in the dialer (2 real hours)',
  rt.kpi(rt.v3r('A1', 'summary', NULL, NULL, '2026-03-08', '2026-03-08'), 24) || ' '
  || rt.kpi(rt.v3r('A1', 'summary', NULL, NULL, '2026-03-08', '2026-03-08'), 25), '100 7200');
SELECT rt.eq('KPI 25 clips at both window edges (RS2A: 28800 s on Sep 30, 7200 s in October)',
  rt.kpi(rt.v3r('A2', 'summary', NULL, NULL, '2026-09-30', '2026-09-30'), 25), '28800');
SELECT rt.eq('empty window: KPIs 5, 24 and 25 are available 0 with zero quality',
  concat_ws(' ', rt.kpi(rt.v3r('ADM1', 'summary', NULL, NULL, '2026-07-01', '2026-07-01'), 5),
            rt.kpi(rt.v3r('ADM1', 'summary', NULL, NULL, '2026-07-01', '2026-07-01'), 24),
            rt.kpi(rt.v3r('ADM1', 'summary', NULL, NULL, '2026-07-01', '2026-07-01'), 25),
            rt.kpi(rt.v3r('ADM1', 'summary', NULL, NULL, '2026-07-01', '2026-07-01'), 24, 'status'),
            rt.kpi(rt.v3r('ADM1', 'summary', NULL, NULL, '2026-07-01', '2026-07-01'), 24, 'detail'),
            rt.kpi(rt.v3r('ADM1', 'summary', NULL, NULL, '2026-07-01', '2026-07-01'), 25, 'detail')),
  '0 0 0 "available" {"quality": {"unknown": 0, "estimated": 0, "conflicting": 0, "inconsistent": 0, "provider_confirmed": 0, "duplicates_excluded": 0}} '
  || '{"quality": {"late_ended": 0, "stale_capped": 0}}');
-- KPI 24 talk-time quality, one evidence state per attempt (Batch 6 review). The states are those
-- public.record_call_duration_evidence (20261005161632) can store, read here without changing the writer or its
-- guard (private.guard_call_reporting_fields: only postgres and service_role write duration fields):
--   K24_1 provider 120 s           provider evidence accepted (no earlier provider value)            measured talk
--   K24_2 terminal_non_answer 0 s  terminal evidence accepted while the duration is NULL or 0        known zero
--   K24_3 elapsed_estimate 90 s    estimate accepted over legacy/estimate when larger               estimated
--   K24_4 legacy_unknown 40 s      never upgraded by the writer                                     unknown
--   K24_5 provider 100 s conflict  differing provider evidence sets duration_conflict, keeps value  conflicting
--   K24_6 terminal_non_answer 25 s terminal evidence with a positive candidate is also accepted     inconsistent
-- Talk time is the canonical duration of attempt rows; quality is disclosed, never upgraded. Under the pre-release
-- amendment kpi24-quality-a1 (Batch 7) K24_6 is disclosed as inconsistent rather than provider-confirmed, and its 25 s
-- stay in the value as recorded.
INSERT INTO rt.v3_ids VALUES ('O24', 'c3f24000-0000-0000-0000-000000000001'), ('ADM24', 'c3f24000-0000-0000-0000-000000000002'),
                             ('A24', 'c3f24000-0000-0000-0000-000000000003'), ('B24', 'c3f24000-0000-0000-0000-000000000004');
INSERT INTO rt.v3_ids SELECT 'K24_' || n, ('c3f24000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 13) n;
INSERT INTO public.organizations VALUES (rt.v3('O24'), 'V3 Talk Quality Agency');
INSERT INTO public.company_settings (company_name, timezone, organization_id) VALUES ('V3 Talk Quality Agency', 'America/Los_Angeles', rt.v3('O24'));
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status, upline_id) VALUES
  (rt.v3('ADM24'), rt.v3('O24'), 'Vee', 'Talk Admin', 'adm24@v3.invalid', 'Admin', 'Active', NULL),
  (rt.v3('A24'), rt.v3('O24'), 'Vee', 'Talk Agent', 'a24@v3.invalid', 'Agent', 'Active', NULL),
  (rt.v3('B24'), rt.v3('O24'), 'Vee', 'Talk Agent Two', 'b24@v3.invalid', 'Agent', 'Active', NULL);
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES (rt.v3('O24'), 'Agent', rt.perm(true, true, false, 'own', true, true, true, 'team'));
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_phone, created_at, duration, disposition_name, status,
                          dialer_admission_required, duration_source, duration_conflict)
SELECT rt.v3(k.name), rt.v3('O24'), rt.v3('A24'), 'outbound', '702-555-0240', k.at::timestamptz, k.dur, k.disp, 'completed', false,
       k.src, k.conflict
  FROM (VALUES ('K24_1', '2026-06-15 16:00+00', 120, 'Interested', 'provider', false),
               ('K24_2', '2026-06-15 16:10+00', 0, 'No Answer', 'terminal_non_answer', false),
               ('K24_3', '2026-06-15 16:20+00', 90, 'Interested', 'elapsed_estimate', false),
               ('K24_4', '2026-06-15 16:30+00', 40, 'Interested', 'legacy_unknown', false),
               ('K24_5', '2026-06-15 16:40+00', 100, 'Interested', 'provider', true),
               ('K24_6', '2026-06-15 16:50+00', 25, 'No Answer', 'terminal_non_answer', false))
       AS k(name, at, dur, disp, src, conflict);
CREATE FUNCTION rt.k24(p_who text, p_scope text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT rt.v3_call(rt.v3(p_who), rt.v3('O24'),
                    format('SELECT public.get_report_summary_v3(%L::date, %L::date, NULL::uuid, %L)', '2026-06-15', '2026-06-15', p_scope));
$$;
SELECT rt.eq('KPI 24 six cases: the value is every attempt''s canonical duration (120+0+90+40+100+25 s)',
  rt.kpi(rt.k24('ADM24', 'agency'), 24) || ' ' || rt.kpi(rt.k24('ADM24', 'agency'), 24, 'status'), '375 "available"');
SELECT rt.eq('KPI 24 six cases: provider and the recorded 0 s non-answer are confirmed; the 25 s non-answer is inconsistent',
  rt.kpi(rt.k24('ADM24', 'agency'), 24, 'detail'),
  '{"quality": {"unknown": 1, "estimated": 1, "conflicting": 1, "inconsistent": 1, "provider_confirmed": 2, "duplicates_excluded": 0}}');
SELECT rt.eq('KPI 24 six cases: a provider-backed known zero adds 0 s, measured provider talk adds its seconds, a conflict keeps its value',
  (SELECT string_agg(concat_ws(':', i.name, f.duration_seconds, f.duration_source, f.duration_conflict::text, f.is_attempt::text), ' '
                     ORDER BY i.name COLLATE "C")
     FROM private.report_v3_call_facts(rt.v3('O24'), '2026-06-15 07:00+00', '2026-06-16 07:00+00') f
     JOIN rt.v3_ids i ON i.id = f.call_id),
  'K24_1:120:provider:false:true K24_2:0:terminal_non_answer:false:true K24_3:90:elapsed_estimate:false:true '
  || 'K24_4:40:legacy_unknown:false:true K24_5:100:provider:true:true K24_6:25:terminal_non_answer:false:true');
SELECT rt.eq('KPI 24 six cases: the agent''s own summary carries the same value; KPI 25 is unaffected (no sessions: 0)',
  rt.kpi(rt.k24('A24', 'personal'), 24) || ' ' || rt.kpi(rt.k24('A24', 'personal'), 25), '375 0');
-- Missing (NULL) durations, and a second agent (2026-06-16). A missing duration counts 0 s; it is unknown unless the row
-- is conflicting and never provider-confirmed, whatever its source; a recorded zero is not missing.
--   K24_7 provider NULL              unknown
--   K24_8 terminal_non_answer NULL   unknown (not inconsistent: nothing recorded)
--   K24_9 provider NULL conflict     conflicting only
--   K24_10 legacy_unknown NULL       unknown, once
--   K24_11 elapsed_estimate NULL     estimated and unknown
--   K24_12 terminal_non_answer 30 s  inconsistent (B24)
--   K24_13 provider 0 s              provider_confirmed: a recorded zero (B24)
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_phone, created_at, duration, disposition_name, status,
                          dialer_admission_required, duration_source, duration_conflict)
SELECT rt.v3(k.name), rt.v3('O24'), rt.v3(k.who), 'outbound', '702-555-0240', k.at::timestamptz, k.dur, k.disp, 'completed', false,
       k.src, k.conflict
  FROM (VALUES ('K24_7', 'A24', '2026-06-16 16:00+00', NULL::integer, 'Interested', 'provider', false),
               ('K24_8', 'A24', '2026-06-16 16:10+00', NULL, 'No Answer', 'terminal_non_answer', false),
               ('K24_9', 'A24', '2026-06-16 16:20+00', NULL, 'Interested', 'provider', true),
               ('K24_10', 'A24', '2026-06-16 16:30+00', NULL, 'Interested', 'legacy_unknown', false),
               ('K24_11', 'A24', '2026-06-16 16:40+00', NULL, 'Interested', 'elapsed_estimate', false),
               ('K24_12', 'B24', '2026-06-16 16:50+00', 30, 'No Answer', 'terminal_non_answer', false),
               ('K24_13', 'B24', '2026-06-16 17:00+00', 0, 'No Answer', 'provider', false))
       AS k(name, who, at, dur, disp, src, conflict);
CREATE FUNCTION rt.k24d(p_who text, p_scope text, p_day date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT rt.v3_call(rt.v3(p_who), rt.v3('O24'),
                    format('SELECT public.get_report_summary_v3(%L::date, %L::date, NULL::uuid, %L)', p_day, p_day, p_scope));
$$;
SELECT rt.eq('KPI 24 missing durations: 0 s; unknown unless conflicting, never confirmed; a recorded zero is confirmed',
  rt.kpi(rt.k24d('ADM24', 'agency', '2026-06-16'), 24) || ' ' || rt.kpi(rt.k24d('ADM24', 'agency', '2026-06-16'), 24, 'detail'),
  '30 {"quality": {"unknown": 4, "estimated": 1, "conflicting": 1, "inconsistent": 1, "provider_confirmed": 1, "duplicates_excluded": 0}}');
SELECT rt.eq('KPI 24 per agent: each agent''s own summary discloses only its own rows',
  rt.kpi(rt.k24d('A24', 'personal', '2026-06-16'), 24) || ' ' || rt.kpi(rt.k24d('A24', 'personal', '2026-06-16'), 24, 'detail') || ' | '
  || rt.kpi(rt.k24d('B24', 'personal', '2026-06-16'), 24) || ' ' || rt.kpi(rt.k24d('B24', 'personal', '2026-06-16'), 24, 'detail'),
  '0 {"quality": {"unknown": 4, "estimated": 1, "conflicting": 1, "inconsistent": 0, "provider_confirmed": 0, "duplicates_excluded": 0}} | '
  || '30 {"quality": {"unknown": 0, "estimated": 0, "conflicting": 0, "inconsistent": 1, "provider_confirmed": 1, "duplicates_excluded": 0}}');
SELECT rt.eq('KPI 24 scope totals: the agency quality is the sum of its agents'' (two days), and by_agent values sum to the total',
  (SELECT string_agg(k || '=' || ((rt.kpi(rt.k24d('ADM24', 'agency', d), 24, 'detail')::jsonb #>> ARRAY['quality', k])::int
                                  = (rt.kpi(rt.k24d('A24', 'personal', d), 24, 'detail')::jsonb #>> ARRAY['quality', k])::int
                                    + (rt.kpi(rt.k24d('B24', 'personal', d), 24, 'detail')::jsonb #>> ARRAY['quality', k])::int)::text,
                     ' ' ORDER BY d, k)
     FROM unnest(ARRAY['2026-06-15'::date, '2026-06-16']) d,
          unnest(ARRAY['conflicting', 'estimated', 'inconsistent', 'provider_confirmed', 'unknown']) k)
  || ' ' || (SELECT sum((SELECT (m ->> 'value')::int FROM jsonb_array_elements(e -> 'metrics') m WHERE (m ->> 'id')::int = 24))
               FROM jsonb_array_elements(rt.k24d('ADM24', 'agency', '2026-06-16') -> 'by_agent') e),
  'conflicting=true estimated=true inconsistent=true provider_confirmed=true unknown=true '
  || 'conflicting=true estimated=true inconsistent=true provider_confirmed=true unknown=true 30');
SELECT rt.eq('KPI 24 per agent through report_v3_agent_call_stats: the same parts, by agent',
  (SELECT string_agg(i.name || ':' || s.talk::text, ' ' ORDER BY i.name)
     FROM private.report_v3_agent_call_stats(rt.v3('O24'), NULL, '2026-06-16 07:00+00', '2026-06-17 07:00+00') s
     JOIN rt.v3_ids i ON i.id = s.agent_id),
  'A24:{"seconds": 0, "unknown": 4, "estimated": 1, "conflicting": 1, "inconsistent": 0, "provider_confirmed": 0, "duplicates_excluded": 0} '
  || 'B24:{"seconds": 30, "unknown": 0, "estimated": 0, "conflicting": 0, "inconsistent": 1, "provider_confirmed": 1, "duplicates_excluded": 0}');
SELECT rt.reject_mutation('public.get_report_summary_v3(date,date,uuid,text)',
  'NOT x.duration_conflict AND x.raw_duration IS NOT NULL', 'NOT x.duration_conflict',
  $probe$SELECT rt.eq('mutated missing-duration confirmation', rt.kpi(rt.k24d('ADM24', 'agency', '2026-06-16'), 24, 'detail')::jsonb #>> '{quality,provider_confirmed}', '1')$probe$,
  'mutated missing-duration confirmation FAIL');
SELECT rt.reject_mutation('public.get_report_summary_v3(date,date,uuid,text)',
  'x.duration_source = ''terminal_non_answer'' AND x.raw_duration > 0', 'x.duration_source = ''terminal_non_answer'' AND x.raw_duration >= 0',
  $probe$SELECT rt.eq('mutated recorded zero', rt.kpi(rt.k24('ADM24', 'agency'), 24, 'detail')::jsonb #>> '{quality,inconsistent}', '1')$probe$,
  'mutated recorded zero FAIL');

SELECT rt.eq('window edges: RC0 at Oct 1 00:00 PDT counts in October; RC0B at Nov 1 00:00 PDT counts on Nov 1',
  rt.kpi(rt.v3r('A2', 'summary'), 5) || ' ' || rt.kpi(rt.v3r('A2', 'summary', NULL, NULL, '2026-11-01', '2026-11-01'), 5), '3 1');

-- -----------------------------------------------------------------------------------------------------
-- Scope totals deduplicate identities: a second agent reaching RL1 adds a by_agent reach, not a total one.
-- -----------------------------------------------------------------------------------------------------
SAVEPOINT dedup;
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, campaign_id,
                          campaign_lead_id, created_at, duration, disposition_id, disposition_name, status)
VALUES (gen_random_uuid(), rt.v3('O1'), rt.v3('A2'), 'outbound', rt.v3('RL1'), 'lead', '702-555-0101', rt.v3('KT12'), rt.v3('RM2'),
        '2026-10-14 16:00+00', 80, rt.v3('RD_INT'), 'Interested', 'completed');
SELECT rt.eq('KPI 7 total stays 4 while the by_agent rows sum to 5',
  rt.kpi(rt.v3r('ADM1', 'summary'), 7) || ' ' || (SELECT sum((SELECT (m ->> 'value')::int FROM jsonb_array_elements(e -> 'metrics') m WHERE (m ->> 'id')::int = 7))
                                                    FROM jsonb_array_elements(rt.v3r('ADM1', 'summary') -> 'by_agent') e),
  '4 5');
ROLLBACK TO SAVEPOINT dedup;
SELECT rt.eq('by_agent per-agent call counts equal report_v3_call_counts for that agent alone',
  (SELECT count(*) FROM private.report_v3_agent_call_stats(rt.v3('O1'), NULL, '2026-10-01 07:00+00', '2026-11-01 07:00+00') s
    WHERE s.agent_id IS NOT NULL
      AND s.counts IS DISTINCT FROM private.report_v3_call_counts(rt.v3('O1'), ARRAY[s.agent_id], '2026-10-01 07:00+00', '2026-11-01 07:00+00')),
  0::bigint);
SELECT rt.assert_sealed_v3(true, false);
