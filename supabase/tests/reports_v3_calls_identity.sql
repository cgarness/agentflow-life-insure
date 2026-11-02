-- =====================================================================================================
-- Reports v3 calls, contacted classification, identity resolution and call KPIs (plan §2.10; D3 §3.2–§3.3;
-- BC4). Disposable synthetic database only, through scripts/run_reports_v3_tests.sh. Expected values are
-- computed by hand from reports_v3_journey_fixtures.sql (organization J, October 2026 in Los Angeles).
-- =====================================================================================================

CREATE FUNCTION rt.cf(p_call text, p_from timestamptz DEFAULT '2026-10-01 07:00+00', p_to timestamptz DEFAULT '2026-11-01 07:00+00')
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(f) - 'call_id' - 'created_at' FROM private.report_v3_call_facts(rt.v3('J'), p_from, p_to) f WHERE f.call_id = rt.v3(p_call);
$$;
CREATE FUNCTION rt.cclass(p_call text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|', coalesce(rt.cf(p_call) ->> 'attempt_class', '-'), rt.cf(p_call) ->> 'is_attempt', rt.cf(p_call) ->> 'is_contacted',
                   rt.cf(p_call) ->> 'is_answered_inbound', rt.cf(p_call) ->> 'is_journey_contact');
$$;
CREATE FUNCTION rt.ccounts(p_agents uuid[]) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT private.report_v3_call_counts(rt.v3('J'), p_agents, '2026-10-01 07:00+00', '2026-11-01 07:00+00');
$$;
CREATE FUNCTION rt.ckpis(p_counts jsonb, p_policies numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(format('%s:%s', e ->> 'id', rt.svr(e)), ' ' ORDER BY o)
    FROM jsonb_array_elements(private.report_v3_call_kpis(p_counts, p_policies)) WITH ORDINALITY x(e, o);
$$;
CREATE FUNCTION rt.zero_counts() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"attempts":0,"non_attempts":0,"unverified":0,"duplicates_excluded":0,"contacted":0,"contacted_eligible":0,
           "contacted_resolved":0,"contacted_unresolved":0,"reached":0,"lead_stage_attempts":0,"lead_identities":0,
           "unresolved_attempts":0,"lead_unverified":0}'::jsonb;
$$;
CREATE TEMP TABLE v3_raw_calls AS SELECT md5(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id)) AS fp FROM public.calls c;

-- -----------------------------------------------------------------------------------------------------
-- 1. Shared rules.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('exactly 45 s does not pass the duration threshold', private.report_v3_contact_predicate(45, NULL, NULL, false), false);
SELECT rt.eq('more than 45 s qualifies', private.report_v3_contact_predicate(46, NULL, NULL, false), true);
SELECT rt.eq('No Answer is excluded before duration and disposition',
  private.report_v3_contact_predicate(100, 'No Answer', NULL, true), false);
SELECT rt.eq('No Answer on the raw name when nothing resolved', private.report_v3_contact_predicate(100, NULL, 'no answer', false), false);
SELECT rt.eq('a qualifying disposition qualifies a short call', private.report_v3_contact_predicate(10, 'Interested', NULL, true), true);
SELECT rt.eq('unknown duration and no disposition does not qualify', private.report_v3_contact_predicate(NULL, NULL, NULL, NULL), false);
SELECT rt.eq('local day start (PDT)', private.report_v3_local_day_start('2026-10-01', 'America/Los_Angeles'), '2026-10-01 07:00+00'::timestamptz);
SELECT rt.eq('local day start (PST)', private.report_v3_local_day_start('2026-11-02', 'America/Los_Angeles'), '2026-11-02 08:00+00'::timestamptz);
SELECT rt.eq('client identity key follows the root lead', private.report_v3_client_identity_key(rt.v3('J'), rt.v3('JK01')), 'lead:' || rt.v3('JL1'));
SELECT rt.eq('hand-entered client keeps its own key', private.report_v3_client_identity_key(rt.v3('J'), rt.v3('JK11')), 'client:' || rt.v3('JK11'));
SELECT rt.eq('a deleted client keeps a client key', private.report_v3_client_identity_key(rt.v3('J'), rt.v3('JDANGLE')), 'client:' || rt.v3('JDANGLE'));
SELECT rt.eq('another organization''s client is never resolved', private.report_v3_client_identity_key(rt.v3('JX'), rt.v3('JK01')),
  'client:' || rt.v3('JK01'));

-- -----------------------------------------------------------------------------------------------------
-- 2. Call facts: the pinned v2 row set, attempt classes, contacted flags, credit, identity.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('exactly the v2 report_call_facts row set',
  (SELECT array_agg(f.call_id ORDER BY f.call_id) FROM private.report_v3_call_facts(rt.v3('J'), '2026-09-01 07:00+00', '2026-11-01 07:00+00') f),
  (SELECT array_agg(v.call_id ORDER BY v.call_id) FROM private.report_call_facts(rt.v3('J'), '2026-09-01 07:00+00', '2026-11-01 07:00+00', NULL) v));
SELECT rt.eq('every carried v2 column unchanged',
  (SELECT count(*) FROM private.report_v3_call_facts(rt.v3('J'), '2026-09-01 07:00+00', '2026-11-01 07:00+00') f
     JOIN private.report_call_facts(rt.v3('J'), '2026-09-01 07:00+00', '2026-11-01 07:00+00', NULL) v ON v.call_id = f.call_id
    WHERE f.is_contacted IS DISTINCT FROM v.is_contacted OR f.disposition_key IS DISTINCT FROM v.disposition_key
       OR f.lead_source IS DISTINCT FROM v.lead_source OR f.campaign_id IS DISTINCT FROM v.campaign_id
       OR f.placing_agent_id IS DISTINCT FROM v.agent_id OR f.direction_class IS DISTINCT FROM v.direction_class
       OR f.created_at IS DISTINCT FROM v.created_at OR f.duration_seconds IS DISTINCT FROM v.duration_seconds
       OR f.lead_id IS DISTINCT FROM v.lead_id OR f.disposition_name IS DISTINCT FROM v.disposition_name
       OR f.disposition_color IS DISTINCT FROM v.disposition_color
       OR f.disp_counts_contacted IS DISTINCT FROM v.disp_counts_contacted OR f.disp_converts IS DISTINCT FROM v.disp_converts
       OR f.disp_dnc IS DISTINCT FROM v.disp_dnc OR f.disp_callback IS DISTINCT FROM v.disp_callback
       OR f.disp_appointment IS DISTINCT FROM v.disp_appointment), 0::bigint);
SELECT rt.eq('admitted attempt', rt.cclass('JC2a'), 'attempt|true|true|false|true');
SELECT rt.eq('legacy pre-admission row counts under the retained legacy rule', rt.cclass('JC_LEG'), 'attempt|true|false|false|false');
SELECT rt.eq('a genuine failed attempt remains a call', rt.cclass('JC_FAIL'), 'attempt|true|false|false|false');
SELECT rt.eq('a busy attempt remains a call', rt.cclass('JC_BUSY'), 'attempt|true|false|false|false');
SELECT rt.eq('a refused admission is a proven non-attempt', rt.cclass('JC8n'), 'non_attempt|false|false|false|false');
SELECT rt.eq('no admission row is unverified, not an attempt', rt.cclass('JC7u'), 'unverified|false|false|false|false');
SELECT rt.eq('exactly 45 s is not contacted', rt.cclass('JC_45'), 'attempt|true|false|false|false');
SELECT rt.eq('46 s is contacted', rt.cclass('JC_46'), 'attempt|true|true|false|true');
SELECT rt.eq('No Answer at 100 s is not contacted', rt.cclass('JC_NA100'), 'attempt|true|false|false|false');
SELECT rt.eq('a qualifying disposition at 10 s is contacted', rt.cclass('JC_Q10'), 'attempt|true|true|false|true');
SELECT rt.eq('answered inbound contact: journey evidence only, never an outbound attempt or contact', rt.cclass('JC9i'),
  '-|false|false|true|true');
SELECT rt.eq('inbound voicemail is not answered', rt.cclass('JC10v'), '-|false|false|false|false');
SELECT rt.eq('inbound credit falls back to the answering agent', rt.cf('JC9i') ->> 'credited_agent_id', rt.v3('JA1')::text);
SELECT rt.eq('lead identity', format('%s|%s|%s', rt.cf('JC2a') ->> 'identity_key', rt.cf('JC2a') ->> 'identity_kind', rt.cf('JC2a') ->> 'resolution'),
  format('lead:%s|lead|lead', rt.v3('JL2')));
SELECT rt.eq('recruit identity', format('%s|%s', rt.cf('JC_REC') ->> 'identity_kind', rt.cf('JC_REC') ->> 'resolution'), 'recruit|recruit');
SELECT rt.eq('a number-matched call stays unresolved (phone never links)',
  format('%s|%s|%s', coalesce(rt.cf('JC4u') ->> 'identity_key', 'null'), rt.cf('JC4u') ->> 'resolution', rt.cf('JC4u') ->> 'phone_last10'),
  'null|unresolved_no_link|3105550104');
SELECT rt.eq('could-qualify: No Answer never could', format('%s|%s|%s', rt.cf('JC4u') ->> 'could_qualify', rt.cf('JC5u') ->> 'could_qualify',
  rt.cf('JCN') ->> 'could_qualify'), 'false|true|true');
SELECT rt.eq('lead stage ends at conversion', format('%s|%s|%s', rt.cf('JC3b') ->> 'is_lead_stage', rt.cf('JC13b') ->> 'is_lead_stage',
  rt.cf('JC_REC') ->> 'is_lead_stage'), 'true|false|false');
SELECT rt.eq('September pointer resolutions (D3 rules 2-8)',
  (SELECT string_agg(format('%s=%s/%s', i.name, coalesce(replace(replace(f.identity_key, rt.v3('JL21')::text, 'JL21'), rt.v3('JL22')::text, 'JL22'), 'null'),
                            f.resolution), ' ' ORDER BY i.name COLLATE "C")
     FROM private.report_v3_call_facts(rt.v3('J'), '2026-09-01 07:00+00', '2026-10-01 07:00+00') f JOIN rt.v3_ids i ON i.id = f.call_id
    WHERE i.name IN ('JC_M1', 'JC_M2', 'JC_M3', 'JC_D', 'JC_LM', 'JC_RAW')),
  'JC_D=null/unresolved_dangling_contact JC_LM=lead:JL21/legacy_membership_as_contact JC_M1=lead:JL21/campaign_membership '
  || 'JC_M2=lead:JL22/campaign_lineage JC_M3=null/unresolved_membership_without_lead JC_RAW=null/unresolved_no_link');
SELECT rt.eq('client pointer resolves to the root lead', rt.cf('JC_CL', '2026-09-01 07:00+00', '2026-10-01 07:00+00') ->> 'identity_key',
  'lead:' || rt.v3('JL23'));
SELECT rt.eq('converted lead pointer (lead row deleted)', format('%s|%s',
  rt.cf('JC_CP', '2026-09-01 07:00+00', '2026-10-01 07:00+00') ->> 'identity_key', rt.cf('JC_CP', '2026-09-01 07:00+00', '2026-10-01 07:00+00') ->> 'resolution'),
  format('lead:%s|converted_lead_pointer', rt.v3('JL12')));
SELECT rt.eq('organization isolation', (SELECT count(*) FROM private.report_v3_call_facts(rt.v3('J'), '2026-01-01', '2027-01-01') f
  WHERE f.call_id = rt.v3('JCX')), 0::bigint);
SELECT rt.eq('the other organization sees only its own call',
  (SELECT array_agg(f.call_id) FROM private.report_v3_call_facts(rt.v3('JX'), '2026-01-01', '2027-01-01') f), ARRAY[rt.v3('JCX')]);
SELECT rt.expect_sql_failure($$SELECT * FROM private.report_v3_call_facts(rt.v3('J'), NULL, now())$$,
  'reports v3 call facts: the organization and both bounds are required');

-- -----------------------------------------------------------------------------------------------------
-- 3. Call KPI counts per scope (outbound only; inbound journey evidence never enters these totals).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('personal counts (JA1)', rt.ccounts(ARRAY[rt.v3('JA1')]), '{"attempts":16,"non_attempts":0,"unverified":1,
  "duplicates_excluded":0,"contacted":10,"contacted_eligible":9,"contacted_resolved":9,"contacted_unresolved":0,"reached":7,
  "lead_stage_attempts":14,"lead_identities":6,"unresolved_attempts":0,"lead_unverified":1}'::jsonb);
SELECT rt.eq('team counts (JA1, JA2)', rt.ccounts(ARRAY[rt.v3('JA1'), rt.v3('JA2')]), '{"attempts":17,"non_attempts":1,"unverified":1,
  "duplicates_excluded":0,"contacted":11,"contacted_eligible":10,"contacted_resolved":10,"contacted_unresolved":0,"reached":8,
  "lead_stage_attempts":15,"lead_identities":7,"unresolved_attempts":0,"lead_unverified":1}'::jsonb);
SELECT rt.eq('agency counts', rt.ccounts(NULL), '{"attempts":21,"non_attempts":1,"unverified":1,"duplicates_excluded":0,
  "contacted":14,"contacted_eligible":13,"contacted_resolved":11,"contacted_unresolved":2,"reached":9,"lead_stage_attempts":16,
  "lead_identities":8,"unresolved_attempts":3,"lead_unverified":1}'::jsonb);

-- 4. Call KPI envelopes through the BC4 builders (P = policies sold: 4 by JA1, 5 at agency in October).
SELECT rt.eq('personal call KPIs', rt.ckpis(rt.ccounts(ARRAY[rt.v3('JA1')]), 4),
  '5:partial|attempt_unverified|16 6:available|-|10 7:available|-|7 8:partial|attempt_unverified|62.5 9:partial|attempt_unverified|4 '
  || '10:available|-|2.5 11:available|-|1.75 34:partial|attempt_unverified|2.333333');
SELECT rt.eq('agency call KPIs', rt.ckpis(rt.ccounts(NULL), 5),
  '5:partial|attempt_unverified|21 6:available|-|14 7:partial|unlinked_contacted_calls|9 8:partial|attempt_unverified|66.666667 '
  || '9:partial|attempt_unverified|4.2 10:available|-|2.8 11:partial|unlinked_contacted_calls|1.8 34:partial|attempt_unverified|2');
SELECT rt.eq('KPI 5 discloses the call population', private.report_v3_call_kpis(rt.ccounts(ARRAY[rt.v3('JA1'), rt.v3('JA2')]), 4) #> '{0,detail}',
  '{"call_population":{"attempts":17,"non_attempts":1,"unverified":1,"duplicates_excluded":0}}'::jsonb);
SELECT rt.eq('KPI 34 coverage carries both unknowns', private.report_v3_call_kpis(rt.ccounts(NULL), 5) #> '{7,coverage}',
  '{"eligible":20,"assessable":16,"unassessable":4,"reasons":{"attempt_unverified":1,"unlinked_calls_excluded":3}}'::jsonb);
SELECT rt.eq('BC4: complete zero activity over a positive policy denominator gives zero', rt.ckpis(rt.zero_counts(), 2),
  '5:available|-|0 6:available|-|0 7:available|-|0 8:unavailable|no_calls_made|null 9:available|-|0 10:available|-|0 '
  || '11:available|-|0 34:unavailable|no_lead_calls|null');
SELECT rt.eq('BC4: a zero policy denominator gives no ratio', rt.ckpis(rt.zero_counts() || '{"attempts":5,"lead_stage_attempts":5,
  "lead_identities":2}'::jsonb, 0),
  '5:available|-|5 6:available|-|0 7:available|-|0 8:available|-|0 9:unavailable|no_policies_sold|null '
  || '10:unavailable|no_policies_sold|null 11:unavailable|no_policies_sold|null 34:available|-|2.5');
SELECT rt.eq('BC4: unverified evidence never becomes a confident zero', rt.ckpis(rt.zero_counts() || '{"unverified":3,"lead_unverified":3}'::jsonb, 2),
  '5:unavailable|attempt_unverified|null 6:available|-|0 7:available|-|0 8:unavailable|attempt_unverified|null '
  || '9:unavailable|attempt_unverified|null 10:available|-|0 11:available|-|0 34:unavailable|attempt_unverified|null');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_call_kpis(rt.zero_counts() || '{"contacted_eligible":1}'::jsonb, 1)$$,
  'reports v3 calls: inconsistent call KPI counts');
SELECT rt.eq('raw call records are unchanged by every v3 reader', (SELECT md5(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id)) FROM public.calls c),
  (SELECT fp FROM v3_raw_calls));

-- -----------------------------------------------------------------------------------------------------
-- 5. Negative controls: each guard, edited away, makes a suite assertion fail (then is rolled back).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.reject_mutation('private.report_v3_call_facts(uuid,timestamp with time zone,timestamp with time zone)',
  'ELSE ''unverified'' END AS attempt_class', 'ELSE ''attempt'' END AS attempt_class',
  $probe$SELECT rt.eq('mutated unverified class', rt.cclass('JC7u'), 'unverified|false|false|false|false')$probe$,
  'mutated unverified class FAIL');
SELECT rt.reject_mutation('private.report_v3_call_facts(uuid,timestamp with time zone,timestamp with time zone)',
  'CASE WHEN cr.direction_class <> ''outbound'' THEN NULL', 'CASE WHEN false THEN NULL',
  $probe$SELECT rt.eq('mutated inbound attempt', rt.cclass('JC9i'), '-|false|false|true|true')$probe$,
  'mutated inbound attempt FAIL');
SELECT rt.reject_mutation('private.report_v3_contact_predicate(bigint,text,text,boolean)',
  'coalesce(p_duration_seconds, 0) > 45', 'coalesce(p_duration_seconds, 0) >= 45',
  $probe$SELECT rt.eq('mutated threshold', private.report_v3_contact_predicate(45, NULL, NULL, false), false)$probe$,
  'mutated threshold FAIL');

-- -----------------------------------------------------------------------------------------------------
-- Disposition matching (Batch 7 keyed joins): exactly the v2 precedence and cardinality. By id when the call has
-- one (only an id of this organization matches; no fallback to the name), else by lower(name) within the
-- organization. dispositions_org_lower_name_unique makes the name match unique per organization; the duplicates the
-- schema allows are names in other organizations (in any case) and names that differ by whitespace.
-- -----------------------------------------------------------------------------------------------------
INSERT INTO rt.v3_ids VALUES ('OD', 'c3d70000-0000-0000-0000-000000000001'), ('OD2', 'c3d70000-0000-0000-0000-000000000002'),
  ('ADMD', 'c3d70000-0000-0000-0000-000000000003'), ('DSTAGE', 'c3d70000-0000-0000-0000-000000000004'),
  ('D_CB', 'c3d70000-0000-0000-0000-000000000011'), ('D_INT', 'c3d70000-0000-0000-0000-000000000012'),
  ('D_SOLD', 'c3d70000-0000-0000-0000-000000000013'), ('D_GONE', 'c3d70000-0000-0000-0000-000000000014'),
  ('D2_CB', 'c3d70000-0000-0000-0000-000000000021'), ('D2_VM', 'c3d70000-0000-0000-0000-000000000022');
INSERT INTO rt.v3_ids SELECT 'DC_' || n, ('c3d70000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 11) n;
INSERT INTO public.organizations VALUES (rt.v3('OD'), 'V3 Disposition Agency'), (rt.v3('OD2'), 'V3 Other Disposition Agency');
INSERT INTO public.company_settings (company_name, timezone, organization_id) VALUES ('V3 Disposition Agency', 'America/Los_Angeles', rt.v3('OD'));
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status, upline_id)
VALUES (rt.v3('ADMD'), rt.v3('OD'), 'Vee', 'Disposition Admin', 'admd@v3.invalid', 'Admin', 'Active', NULL);
INSERT INTO public.pipeline_stages (id, name, pipeline_type, convert_to_client, organization_id)
VALUES (rt.v3('DSTAGE'), 'Sold', 'lead', true, rt.v3('OD'));
INSERT INTO public.dispositions (id, name, color, counts_as_contacted, callback_scheduler, appointment_scheduler, dnc_auto_add,
                                 pipeline_stage_id, organization_id) VALUES
  (rt.v3('D_CB'), 'Callback', '#111111', true, true, false, false, NULL, rt.v3('OD')),
  (rt.v3('D_INT'), 'Interested', '#222222', true, false, false, false, NULL, rt.v3('OD')),
  (rt.v3('D_SOLD'), 'Sold', '#333333', true, false, false, false, rt.v3('DSTAGE'), rt.v3('OD')),
  (rt.v3('D_GONE'), 'Gone Away', '#444444', false, false, false, true, NULL, rt.v3('OD')),
  (rt.v3('D2_CB'), 'callback', '#555555', false, false, true, true, NULL, rt.v3('OD2')),
  (rt.v3('D2_VM'), 'Voicemail', '#666666', false, false, false, false, NULL, rt.v3('OD2'));
INSERT INTO public.calls (id, organization_id, agent_id, direction, created_at, duration, disposition_id, disposition_name, status,
                          dialer_admission_required)
SELECT rt.v3(k.name), rt.v3('OD'), rt.v3('ADMD'), 'outbound', k.at::timestamptz, 30, k.disp, k.disp_name, 'completed', false
  FROM (VALUES ('DC_1', '2026-10-05 16:00+00', rt.v3('D_CB'), 'Interested'),   -- id wins over a disagreeing name
               ('DC_2', '2026-10-05 16:01+00', rt.v3('D2_CB'), 'Callback'),    -- another organization's id: no match, no name fallback
               ('DC_3', '2026-10-05 16:02+00', NULL, 'CALLBACK'),              -- by name, case-insensitive
               ('DC_4', '2026-10-05 16:03+00', NULL, 'Callback '),             -- a trailing space is another name: no match
               ('DC_5', '2026-10-05 16:04+00', NULL, 'Voicemail'),             -- the name exists only in another organization
               ('DC_6', '2026-10-05 16:05+00', rt.v3('D_GONE'), 'Gone Away'),  -- its disposition is deleted below: a dangling id
               ('DC_7', '2026-10-05 16:06+00', NULL, NULL),                    -- no disposition at all
               ('DC_8', '2026-10-05 16:07+00', rt.v3('D_SOLD'), NULL),          -- a converting stage, by id
               ('DC_9', '2026-10-05 16:08+00', NULL, 'sold'),                  -- the same converting stage, by name
               ('DC_10', '2026-10-05 16:09+00', NULL, '  '),                   -- a blank name
               ('DC_11', '2026-10-05 16:10+00', NULL, 'Gone Away'))            -- production's state after the delete (FK SET NULL)
       AS k(name, at, disp, disp_name);
DELETE FROM public.dispositions WHERE id = rt.v3('D_GONE');
CREATE FUNCTION rt.dmatch(p_call text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|', f.disposition_key, f.disposition_name, f.disposition_color, f.disp_counts_contacted, f.disp_converts,
                   f.disp_dnc, f.disp_callback, f.disp_appointment)
    FROM private.report_v3_call_facts(rt.v3('OD'), '2026-10-05 07:00+00', '2026-10-06 07:00+00') f WHERE f.call_id = rt.v3(p_call);
$$;
SELECT rt.eq('disposition matching: one row per call, exactly the v2 row set',
  (SELECT count(*) || '|' || count(DISTINCT f.call_id) FROM private.report_v3_call_facts(rt.v3('OD'), '2026-10-05 07:00+00', '2026-10-06 07:00+00') f),
  (SELECT count(*) || '|' || count(DISTINCT v.call_id) FROM private.report_call_facts(rt.v3('OD'), '2026-10-05 07:00+00', '2026-10-06 07:00+00', NULL) v));
SELECT rt.eq('disposition matching: every carried v2 column equal',
  (SELECT count(*) FROM private.report_v3_call_facts(rt.v3('OD'), '2026-10-05 07:00+00', '2026-10-06 07:00+00') f
     JOIN private.report_call_facts(rt.v3('OD'), '2026-10-05 07:00+00', '2026-10-06 07:00+00', NULL) v ON v.call_id = f.call_id
    WHERE f.disposition_key IS NOT DISTINCT FROM v.disposition_key AND f.disposition_name IS NOT DISTINCT FROM v.disposition_name
      AND f.disposition_color IS NOT DISTINCT FROM v.disposition_color AND f.is_contacted IS NOT DISTINCT FROM v.is_contacted
      AND f.disp_counts_contacted IS NOT DISTINCT FROM v.disp_counts_contacted AND f.disp_converts IS NOT DISTINCT FROM v.disp_converts
      AND f.disp_dnc IS NOT DISTINCT FROM v.disp_dnc AND f.disp_callback IS NOT DISTINCT FROM v.disp_callback
      AND f.disp_appointment IS NOT DISTINCT FROM v.disp_appointment), 11::bigint);
SELECT rt.eq('disposition matching: the id wins over a disagreeing name', rt.dmatch('DC_1'),
  rt.v3('D_CB') || '|Callback|#111111|t|f|f|t|f');
SELECT rt.eq('disposition matching: another organization''s id matches nothing, and the name is not tried', rt.dmatch('DC_2'),
  'name:callback|Callback|#6B7280|f|f|f|f|f');
SELECT rt.eq('disposition matching: by name, case-insensitive', rt.dmatch('DC_3'),
  rt.v3('D_CB') || '|Callback|#111111|t|f|f|t|f');
SELECT rt.eq('disposition matching: a trailing space is another name', rt.dmatch('DC_4'),
  'name:callback|Callback|#6B7280|f|f|f|f|f');
SELECT rt.eq('disposition matching: a name only another organization has matches nothing', rt.dmatch('DC_5'),
  'name:voicemail|Voicemail|#6B7280|f|f|f|f|f');
SELECT rt.eq('disposition matching: a deleted disposition matches nothing, by its dangling id or (after the FK sets it NULL) by its name',
  rt.dmatch('DC_6') || ' ' || rt.dmatch('DC_11'),
  'name:gone away|Gone Away|#6B7280|f|f|f|f|f name:gone away|Gone Away|#6B7280|f|f|f|f|f');
SELECT rt.eq('disposition matching: no disposition', rt.dmatch('DC_7'), 'none|(No disposition)|#6B7280|f|f|f|f|f');
SELECT rt.eq('disposition matching: the converting stage by id and by name', rt.dmatch('DC_8') || ' ' || rt.dmatch('DC_9'),
  rt.v3('D_SOLD') || '|Sold|#333333|t|t|f|f|f ' || rt.v3('D_SOLD') || '|Sold|#333333|t|t|f|f|f');
SELECT rt.eq('disposition matching: a blank name is no disposition', rt.dmatch('DC_10'), 'none|(No disposition)|#6B7280|f|f|f|f|f');

-- Direction classes (Batch 7 exact-value fast path): exactly v2's lower(coalesce(direction, '')) classes, case-
-- insensitive, with no trimming; anything else is other. DIR_14's capital dotted I lowers differently by locale, so
-- it is compared with v2 only (both classify through lower()).
INSERT INTO rt.v3_ids SELECT 'DIR_' || n, ('c3d70000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 14) n;
INSERT INTO public.calls (id, organization_id, agent_id, direction, created_at, duration, disposition_id, disposition_name, status,
                          dialer_admission_required)
SELECT rt.v3('DIR_' || k.n), rt.v3('OD'), rt.v3('ADMD'), k.direction, '2026-10-06 16:00+00'::timestamptz + k.n * interval '1 minute',
       50, NULL, NULL, 'completed', false
  FROM (VALUES (1, 'outbound'), (2, 'outgoing'), (3, 'OUTBOUND'), (4, 'Outgoing'), (5, 'inbound'), (6, 'incoming'),
               (7, 'Inbound'), (8, 'INCOMING'), (9, NULL), (10, ''), (11, ' outbound'), (12, 'outbound '), (13, 'inbound_calls'),
               (14, U&'\0130NBOUND')) AS k(n, direction);
SELECT rt.eq('direction classes: one row per call, each class and every carried v2 column equal to v2',
  (SELECT count(*) FILTER (WHERE f.direction_class IS NOT DISTINCT FROM v.direction_class AND f.is_contacted IS NOT DISTINCT FROM v.is_contacted
                             AND f.placing_agent_id IS NOT DISTINCT FROM v.agent_id AND f.disposition_key IS NOT DISTINCT FROM v.disposition_key)
          || '|' || count(*)
     FROM private.report_v3_call_facts(rt.v3('OD'), '2026-10-06 07:00+00', '2026-10-07 07:00+00') f
     FULL JOIN private.report_call_facts(rt.v3('OD'), '2026-10-06 07:00+00', '2026-10-07 07:00+00', NULL) v ON v.call_id = f.call_id),
  '14|14');
SELECT rt.eq('direction classes: case-insensitive v2 classes, untrimmed, else other',
  (SELECT string_agg(f.direction_class || ':' || coalesce(f.attempt_class, '-') || ':' || f.is_contacted, ' ' ORDER BY f.created_at)
     FROM private.report_v3_call_facts(rt.v3('OD'), '2026-10-06 07:00+00', '2026-10-07 07:00+00') f WHERE f.call_id <> rt.v3('DIR_14')),
  'outbound:attempt:true outbound:attempt:true outbound:attempt:true outbound:attempt:true inbound:-:false inbound:-:false '
  || 'inbound:-:false inbound:-:false other:-:false other:-:false other:-:false other:-:false other:-:false');
