SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- =====================================================================================================
-- Reports v3 regional state suite (plan D5 §8). Disposable synthetic databases only, through
-- scripts/run_reports_v3_tests.sh. Sections 1–6 cover the …14 helpers (the classifier and the identity-state
-- resolver); section 7 covers the get_report_state_breakdown_v3 reader (…15), on O1 (reports_v3_fixtures.sql).
--
-- Synthetic organization ST ('V3 State Agency') and another tenant SX. Agents SA1, SA2 (ST) and SXA (SX).
-- Expected resolution (state | reason | basis), each computed by hand from the rows below:
--   lead:SL1   lead CA                                         CA | - | current_record
--   lead:SL2   lead 'California' + client SK2 'CA'              CA | - | current_record (one distinct code)
--   lead:SL3   lead CA + client SK3 NV                          - | source_conflict | current_record
--   lead:SL4   lead CA + client SK4 XX                          CA | - | current_record
--   lead:SL5   lead XX + membership copy CA                     - | invalid_state | current_record (no fallback)
--   client:SK6 client NULL; SA2's call through membership TX    TX | - | campaign_copy
--   lead:SL7   lead blank; membership copies TX and OK          - | source_conflict | campaign_copy
--   lead:SL8   lead blank; lineage copy 'Texas'                 TX | - | campaign_copy
--   lead:SL9   lead blank; SA2's call through membership AZ     AZ | - | campaign_copy (E4: any agent's call)
--   lead:SL10  lead blank; no copy                              - | missing_state | -
--   lead:SL11  lead blank; copies blank and PR                  - | unsupported_geography | campaign_copy
--   lead:SL12  lead 'Guam'                                      - | unsupported_geography | current_record
--   lead:SL13  lead PR + client SK13 XX                         - | unsupported_geography | current_record
--   lead:SL14  lead 'Ontario'                                   - | invalid_state | current_record
--   lead:SL15  lead blank; copies TX and XX                     TX | - | campaign_copy
--   lead:SL16  lead deleted; client SK16 FL                     FL | - | current_record
--   lead:SL17  no lead or client; a membership copy TX          - | unresolved_identity | - (no fallback)
--   client:SK18 deleted client (a sale's buyer)                 - | unresolved_identity | -
--   lead:SXL1  an SX lead NY, asked for by ST                   - | unresolved_identity | -
--   lead:SL20  lead blank; every copy source is cross-tenant    - | missing_state | -
--   lead:SL22  lead blank, same phone as SL21 (GA)              - | missing_state | - (a phone never resolves)
--   recruit:SR1 and malformed keys                              no row (the reader maps recruits to non_prospect_contact)
-- =====================================================================================================

INSERT INTO rt.v3_ids VALUES
  ('ST', 'c3f60000-0000-0000-0000-000000000001'), ('SX', 'c3f60000-0000-0000-0000-000000000002'),
  ('SA1', 'c3f6a000-0000-0000-0000-000000000001'), ('SA2', 'c3f6a000-0000-0000-0000-000000000002'),
  ('SXA', 'c3f6a000-0000-0000-0000-000000000009'),
  ('SCMP', 'c3f6e000-0000-0000-0000-000000000001'), ('SXCMP', 'c3f6e000-0000-0000-0000-000000000009'),
  ('SR1', 'c3f6d000-0000-0000-0000-000000000001'), ('SXL1', 'c3f6f000-0000-0000-0000-000000000001');
INSERT INTO rt.v3_ids SELECT 'SL' || n, ('c3f61000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 22) n;
INSERT INTO rt.v3_ids SELECT 'SK' || n, ('c3f62000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid
  FROM unnest(ARRAY[2, 3, 4, 6, 13, 16, 18]) n;
INSERT INTO rt.v3_ids SELECT x.name, ('c3f63000-0000-0000-0000-0000000000' || lpad(x.n::text, 2, '0'))::uuid
  FROM (VALUES (1, 'SCL5'), (2, 'SCL6'), (3, 'SCL7a'), (4, 'SCL7b'), (5, 'SCL8'), (6, 'SCL9'), (7, 'SCL11a'), (8, 'SCL11b'),
               (9, 'SCL15a'), (10, 'SCL15b'), (11, 'SCL17'), (12, 'SCL20'), (13, 'SCL22x'), (14, 'SXCL20a'), (15, 'SXCL20b'),
               (16, 'SXCL20c')) x(n, name);
INSERT INTO rt.v3_ids SELECT x.name, ('c3f65000-0000-0000-0000-0000000000' || lpad(x.n::text, 2, '0'))::uuid
  FROM (VALUES (1, 'SC6'), (2, 'SC9'), (3, 'SC20'), (4, 'SXC20')) x(n, name);
SELECT rt.eq('state fixture ids', (SELECT count(DISTINCT name) || '/' || count(DISTINCT id) FROM rt.v3_ids WHERE id::text LIKE 'c3f6%'), '58/58');

INSERT INTO public.organizations VALUES (rt.v3('ST'), 'V3 State Agency'), (rt.v3('SX'), 'V3 State Other Agency');
INSERT INTO public.company_settings (company_name, timezone, organization_id) VALUES
  ('V3 State Agency', 'America/Chicago', rt.v3('ST')), ('V3 State Other Agency', 'America/New_York', rt.v3('SX'));
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status) VALUES
  (rt.v3('SA1'), rt.v3('ST'), 'Sam', 'One', 'sa1@v3.invalid', 'Agent', 'Active'),
  (rt.v3('SA2'), rt.v3('ST'), 'Sam', 'Two', 'sa2@v3.invalid', 'Agent', 'Active'),
  (rt.v3('SXA'), rt.v3('SX'), 'Sam', 'Other', 'sxa@v3.invalid', 'Agent', 'Active');
INSERT INTO public.campaigns (id, name, type, organization_id) VALUES
  (rt.v3('SCMP'), 'V3 State Campaign', 'Team', rt.v3('ST')), (rt.v3('SXCMP'), 'V3 State Other Campaign', 'Team', rt.v3('SX'));

-- Leads (SL16 and SL17 have no lead row: SL16 was deleted after conversion, SL17 is an orphan pointer).
INSERT INTO public.leads (id, phone, state, organization_id)
SELECT rt.v3(x.name), x.phone, x.state, rt.v3(x.org)
  FROM (VALUES ('SL1', '214-555-0101', 'CA', 'ST'), ('SL2', '214-555-0102', 'California', 'ST'), ('SL3', '214-555-0103', 'CA', 'ST'),
               ('SL4', '214-555-0104', 'CA', 'ST'), ('SL5', '214-555-0105', 'XX', 'ST'), ('SL7', '214-555-0107', '', 'ST'),
               ('SL8', '214-555-0108', '   ', 'ST'), ('SL9', '214-555-0109', '', 'ST'), ('SL10', '214-555-0110', '', 'ST'),
               ('SL11', '214-555-0111', '', 'ST'), ('SL12', '214-555-0112', 'Guam', 'ST'), ('SL13', '214-555-0113', 'PR', 'ST'),
               ('SL14', '214-555-0114', 'Ontario', 'ST'), ('SL15', '214-555-0115', '', 'ST'), ('SL20', '214-555-0120', '', 'ST'),
               ('SL21', '415-555-0100', 'GA', 'ST'), ('SL22', '415-555-0100', '', 'ST'),
               ('SXL1', '212-555-0101', 'NY', 'SX')) x(name, phone, state, org);
INSERT INTO public.clients (id, organization_id, lead_id, phone, state)
SELECT rt.v3(x.name), rt.v3('ST'), rt.v3(x.lead), x.phone, x.state
  FROM (VALUES ('SK2', 'SL2', '214-555-0102', 'CA'), ('SK3', 'SL3', '214-555-0103', 'NV'), ('SK4', 'SL4', '214-555-0104', 'XX'),
               ('SK6', NULL, '214-555-0106', NULL), ('SK13', 'SL13', '214-555-0113', 'XX'),
               ('SK16', 'SL16', '214-555-0116', 'FL')) x(name, lead, phone, state);
INSERT INTO public.recruits (id, phone, state, organization_id) VALUES (rt.v3('SR1'), '214-555-0190', 'TX', rt.v3('ST'));

-- Campaign-membership copies. SCL6, SCL8, SCL9, SCL20 and SCL22x have no lead pointer of their own.
INSERT INTO public.campaign_leads (id, campaign_id, lead_id, phone, state, organization_id)
SELECT rt.v3(x.name), rt.v3(x.cmp), rt.v3(x.lead), x.phone, x.state, rt.v3(x.org)
  FROM (VALUES ('SCL5', 'SCMP', 'SL5', '214-555-0105', 'CA', 'ST'), ('SCL6', 'SCMP', NULL, '214-555-0106', 'TX', 'ST'),
               ('SCL7a', 'SCMP', 'SL7', '214-555-0107', 'TX', 'ST'), ('SCL7b', 'SCMP', 'SL7', '214-555-0107', 'OK', 'ST'),
               ('SCL8', 'SCMP', NULL, '214-555-0108', 'Texas', 'ST'), ('SCL9', 'SCMP', NULL, '214-555-0109', 'AZ', 'ST'),
               ('SCL11a', 'SCMP', 'SL11', '214-555-0111', '', 'ST'), ('SCL11b', 'SCMP', 'SL11', '214-555-0111', 'PR', 'ST'),
               ('SCL15a', 'SCMP', 'SL15', '214-555-0115', 'TX', 'ST'), ('SCL15b', 'SCMP', 'SL15', '214-555-0115', 'XX', 'ST'),
               ('SCL17', 'SCMP', 'SL17', '214-555-0117', 'TX', 'ST'), ('SCL20', 'SCMP', NULL, '214-555-0120', 'WA', 'ST'),
               ('SCL22x', 'SCMP', NULL, '415-555-0100', 'GA', 'ST'),
               ('SXCL20a', 'SXCMP', 'SL20', '214-555-0120', 'NY', 'SX'), ('SXCL20b', 'SXCMP', NULL, '214-555-0120', 'OR', 'SX'),
               ('SXCL20c', 'SXCMP', NULL, '214-555-0120', 'NV', 'SX')) x(name, cmp, lead, phone, state, org);
-- Lineage: SCL8 converted from SL8 (ST); SL20's only lineage rows are cross-tenant.
INSERT INTO private.dialer_conversion_lineage VALUES
  (rt.v3('ST'), rt.v3('SCL8'), rt.v3('SL8')), (rt.v3('SX'), rt.v3('SXCL20c'), rt.v3('SL20')),
  (rt.v3('ST'), rt.v3('SXCL20b'), rt.v3('SL20'));
-- Calls that reach a membership: SA2 (any agent) on SK6 and SL9; SL20's are cross-tenant either way.
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, campaign_lead_id,
                          created_at, duration, status)
SELECT rt.v3(x.name), rt.v3(x.org), rt.v3(x.agent), 'outbound', rt.v3(x.contact), x.ctype, x.phone, rt.v3(x.member),
       '2026-10-06 15:00+00', 30, 'completed'
  FROM (VALUES ('SC6', 'ST', 'SA2', 'SK6', 'client', '214-555-0106', 'SCL6'),
               ('SC9', 'ST', 'SA2', 'SL9', NULL, '214-555-0109', 'SCL9'),
               ('SC20', 'ST', 'SA1', 'SL20', 'lead', '214-555-0120', 'SXCL20b'),
               ('SXC20', 'SX', 'SXA', 'SL20', 'lead', '214-555-0120', 'SCL20')) x(name, org, agent, contact, ctype, phone, member);
-- Recorded state changes (history capture began 2026-10-03). Only same-org 'state' changes of the identity's
-- own records count: the later first_name edit, the client-typed SL1 row and the SX row are ignored.
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           changed_fields, recorded_at)
SELECT rt.v3(x.org), rt.v3(x.contact), x.ctype, x.ctype || 's', rt.v3(x.contact), 'updated', 'agent', x.fields::text[], x.at::timestamptz
  FROM (VALUES ('ST', 'SL1', 'lead', '{state}', '2026-10-05 15:00+00'), ('ST', 'SL1', 'lead', '{first_name}', '2026-10-07 15:00+00'),
               ('ST', 'SL1', 'client', '{state}', '2026-10-08 15:00+00'), ('SX', 'SL1', 'lead', '{state}', '2026-10-09 15:00+00'),
               ('ST', 'SL2', 'lead', '{state}', '2026-10-04 15:00+00'), ('ST', 'SK2', 'client', '{phone,state}', '2026-10-06 15:00+00'),
               ('ST', 'SL16', 'lead', '{state}', '2026-10-10 15:00+00')) x(org, contact, ctype, fields, at);

CREATE FUNCTION rt.cls(p text) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|', coalesce(state_code, '-'), coalesce(reason, '-')) FROM private.report_v3_state_classify(p);
$$;
CREATE FUNCTION rt.skey(p_kind text, p_name text) RETURNS text LANGUAGE sql AS $$ SELECT p_kind || ':' || rt.v3(p_name) $$;
CREATE FUNCTION rt.sstate(p_org text, p_key text) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|', coalesce(state_code, '-'), coalesce(reason, '-'), coalesce(basis, '-'))
    FROM private.report_v3_identity_states(rt.v3(p_org), ARRAY[p_key]);
$$;
CREATE TEMP TABLE st_keys AS
SELECT rt.skey(split_part(x.k, ':', 1), split_part(x.k, ':', 2)) AS key, x.want
  FROM (VALUES ('lead:SL1', 'CA|-|current_record'), ('lead:SL2', 'CA|-|current_record'),
               ('lead:SL3', '-|source_conflict|current_record'), ('lead:SL4', 'CA|-|current_record'),
               ('lead:SL5', '-|invalid_state|current_record'), ('client:SK6', 'TX|-|campaign_copy'),
               ('lead:SL7', '-|source_conflict|campaign_copy'), ('lead:SL8', 'TX|-|campaign_copy'),
               ('lead:SL9', 'AZ|-|campaign_copy'), ('lead:SL10', '-|missing_state|-'),
               ('lead:SL11', '-|unsupported_geography|campaign_copy'), ('lead:SL12', '-|unsupported_geography|current_record'),
               ('lead:SL13', '-|unsupported_geography|current_record'), ('lead:SL14', '-|invalid_state|current_record'),
               ('lead:SL15', 'TX|-|campaign_copy'), ('lead:SL16', 'FL|-|current_record'),
               ('lead:SL17', '-|unresolved_identity|-'), ('client:SK18', '-|unresolved_identity|-'),
               ('lead:SXL1', '-|unresolved_identity|-'), ('lead:SL20', '-|missing_state|-'),
               ('lead:SL21', 'GA|-|current_record'), ('lead:SL22', '-|missing_state|-')) x(k, want);

-- -----------------------------------------------------------------------------------------------------
-- 1. Classifier (D5 §3.2): pre-trim, the unchanged normalize_us_state, 51 jurisdictions, explicit lists.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('classifier maps codes, names, case and trimmed whitespace',
  (SELECT array_agg(rt.cls(v) ORDER BY o) FROM unnest(ARRAY['CA', ' ca ', 'California', 'CALIFORNIA', 'ny' || chr(9),
          'New York' || chr(10), 'TX' || chr(11), chr(12) || 'wa' || chr(13), 'District of Columbia', 'dc', 'VA']) WITH ORDINALITY u(v, o)),
  ARRAY['CA|-', 'CA|-', 'CA|-', 'CA|-', 'NY|-', 'NY|-', 'TX|-', 'WA|-', 'DC|-', 'DC|-', 'VA|-']);
SELECT rt.eq('classifier marks invalid values and never echoes them',
  (SELECT array_agg(rt.cls(v) ORDER BY o) FROM unnest(ARRAY[chr(160) || 'TX', 'D.C.', 'Ontario', 'XX', 'v', 'Puerto  Rico',
          'Washington DC', 'Californ1a']) WITH ORDINALITY u(v, o)),
  ARRAY['-|invalid_state', '-|invalid_state', '-|invalid_state', '-|invalid_state', '-|invalid_state', '-|invalid_state',
        '-|invalid_state', '-|invalid_state']);
SELECT rt.eq('classifier marks blanks missing',
  (SELECT array_agg(rt.cls(v) ORDER BY o) FROM unnest(ARRAY['', '   ', NULL, chr(9) || chr(10) || ' ' || chr(13)]) WITH ORDINALITY u(v, o)),
  ARRAY['-|missing_state', '-|missing_state', '-|missing_state', '-|missing_state']);
SELECT rt.eq('classifier marks territories and military mail unsupported',
  (SELECT array_agg(rt.cls(v) ORDER BY o) FROM unnest(ARRAY['PR', 'Guam', 'AE', ' gu ', 'Virgin Islands', 'armed forces pacific',
          'AP', 'mh', 'UM', 'Federated States of Micronesia']) WITH ORDINALITY u(v, o)),
  ARRAY['-|unsupported_geography', '-|unsupported_geography', '-|unsupported_geography', '-|unsupported_geography',
        '-|unsupported_geography', '-|unsupported_geography', '-|unsupported_geography', '-|unsupported_geography',
        '-|unsupported_geography', '-|unsupported_geography']);
CREATE TEMP TABLE st_jurisdictions (code text, name text);
INSERT INTO st_jurisdictions VALUES
  ('AL', 'Alabama'), ('AK', 'Alaska'), ('AZ', 'Arizona'), ('AR', 'Arkansas'), ('CA', 'California'), ('CO', 'Colorado'),
  ('CT', 'Connecticut'), ('DE', 'Delaware'), ('FL', 'Florida'), ('GA', 'Georgia'), ('HI', 'Hawaii'), ('ID', 'Idaho'),
  ('IL', 'Illinois'), ('IN', 'Indiana'), ('IA', 'Iowa'), ('KS', 'Kansas'), ('KY', 'Kentucky'), ('LA', 'Louisiana'),
  ('ME', 'Maine'), ('MD', 'Maryland'), ('MA', 'Massachusetts'), ('MI', 'Michigan'), ('MN', 'Minnesota'), ('MS', 'Mississippi'),
  ('MO', 'Missouri'), ('MT', 'Montana'), ('NE', 'Nebraska'), ('NV', 'Nevada'), ('NH', 'New Hampshire'), ('NJ', 'New Jersey'),
  ('NM', 'New Mexico'), ('NY', 'New York'), ('NC', 'North Carolina'), ('ND', 'North Dakota'), ('OH', 'Ohio'), ('OK', 'Oklahoma'),
  ('OR', 'Oregon'), ('PA', 'Pennsylvania'), ('RI', 'Rhode Island'), ('SC', 'South Carolina'), ('SD', 'South Dakota'),
  ('TN', 'Tennessee'), ('TX', 'Texas'), ('UT', 'Utah'), ('VT', 'Vermont'), ('VA', 'Virginia'), ('WA', 'Washington'),
  ('WV', 'West Virginia'), ('WI', 'Wisconsin'), ('WY', 'Wyoming'), ('DC', 'District of Columbia');
SELECT rt.eq('exactly 51 supported jurisdictions, DC included', (SELECT count(DISTINCT code) FROM st_jurisdictions), 51::bigint);
SELECT rt.eq('every jurisdiction code and name maps to itself',
  (SELECT count(*) FROM st_jurisdictions j
    WHERE rt.cls(j.code) = j.code || '|-' AND rt.cls(lower(j.code)) = j.code || '|-' AND rt.cls(j.name) = j.code || '|-'
      AND rt.cls(upper(j.name)) = j.code || '|-'),
  51::bigint);
SELECT rt.eq('the classifier only ever emits a supported code or one of the three value reasons',
  (SELECT count(*) FROM unnest(ARRAY['CA', 'XX', '', NULL, 'PR', 'Guam', 'Ontario', 'District of Columbia']) v,
          private.report_v3_state_classify(v) s
    WHERE NOT ((s.state_code IN (SELECT code FROM st_jurisdictions) AND s.reason IS NULL)
               OR (s.state_code IS NULL AND s.reason IN ('missing_state', 'invalid_state', 'unsupported_geography')))),
  0::bigint);
SELECT rt.eq('classifier metadata: sql, immutable, parallel safe, invoker, pinned search_path',
  (SELECT concat_ws('|', l.lanname, p.provolatile, p.proparallel, p.prosecdef::text, array_to_string(p.proconfig, ';'),
                    pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid))
     FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'private.report_v3_state_classify(text)'::regprocedure),
  'sql|i|s|false|search_path=pg_catalog, pg_temp|p_raw text, OUT state_code text, OUT reason text|record');

-- -----------------------------------------------------------------------------------------------------
-- 2. Identity resolution (D5 §3.3): the current record, then the narrowed campaign copy; conflicts explicit.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('each identity resolves to its hand-computed state, reason and basis',
  (SELECT string_agg(k.key || '=' || coalesce(rt.sstate('ST', k.key), 'NO ROW'), ' ' ORDER BY k.key) FROM st_keys k),
  (SELECT string_agg(k.key || '=' || k.want, ' ' ORDER BY k.key) FROM st_keys k));
SELECT rt.eq('one batch equals the identities asked for one by one',
  (SELECT string_agg(s.identity_key || '=' || concat_ws('|', coalesce(s.state_code, '-'), coalesce(s.reason, '-'), coalesce(s.basis, '-')),
                     ' ' ORDER BY s.identity_key)
     FROM private.report_v3_identity_states(rt.v3('ST'), (SELECT array_agg(key) FROM st_keys)) s),
  (SELECT string_agg(k.key || '=' || k.want, ' ' ORDER BY k.key) FROM st_keys k));
SELECT rt.eq('the resolver emits exactly the five helper-level unmapped reasons (the reader adds non_prospect_contact)',
  (SELECT array_agg(DISTINCT s.reason ORDER BY s.reason)
     FROM private.report_v3_identity_states(rt.v3('ST'), (SELECT array_agg(key) FROM st_keys)) s WHERE s.reason IS NOT NULL),
  ARRAY['invalid_state', 'missing_state', 'source_conflict', 'unresolved_identity', 'unsupported_geography']);
SELECT rt.eq('malformed, recruit, NULL and repeated keys: one row per distinct well-formed key',
  (SELECT array_agg(s.identity_key ORDER BY s.identity_key)
     FROM private.report_v3_identity_states(rt.v3('ST'), ARRAY[rt.skey('lead', 'SL1'), rt.skey('lead', 'SL1'), rt.skey('recruit', 'SR1'),
          NULL, '', 'lead:', 'lead:not-a-uuid', 'LEAD:' || rt.v3('SL1'), 'lead:' || upper(rt.v3('SL1')::text), rt.skey('lead', 'SL1') || ' ',
          'client:' || rt.v3('SL1') || ':x', rt.skey('client', 'SK6')]) s),
  ARRAY[rt.skey('client', 'SK6'), rt.skey('lead', 'SL1')]);
SELECT rt.eq('a NULL organization or no keys resolves nothing',
  (SELECT count(*) FROM private.report_v3_identity_states(NULL, ARRAY[rt.skey('lead', 'SL1')]))
  + (SELECT count(*) FROM private.report_v3_identity_states(rt.v3('ST'), NULL))
  + (SELECT count(*) FROM private.report_v3_identity_states(rt.v3('ST'), '{}')), 0::bigint);
SELECT rt.eq('the last recorded state change: same-org state edits of the identity''s own records',
  (SELECT array_agg(coalesce(to_char(s.last_state_change_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'), '-') ORDER BY s.identity_key)
     FROM private.report_v3_identity_states(rt.v3('ST'), ARRAY[rt.skey('lead', 'SL1'), rt.skey('lead', 'SL2'), rt.skey('lead', 'SL16'),
          rt.skey('lead', 'SL3')]) s),
  ARRAY['10-05 15:00', '10-06 15:00', '-', '10-10 15:00']);

-- -----------------------------------------------------------------------------------------------------
-- 3. Tenant isolation: every lookup is same-org; another tenant's rows never decide a state.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('another tenant''s lead resolves only inside its own organization',
  rt.sstate('ST', rt.skey('lead', 'SXL1')) || ' / ' || rt.sstate('SX', rt.skey('lead', 'SXL1')),
  '-|unresolved_identity|- / NY|-|current_record');
SELECT rt.eq('an ST identity asked for by SX resolves to nothing', rt.sstate('SX', rt.skey('lead', 'SL1')), '-|unresolved_identity|-');
SELECT rt.eq('cross-tenant memberships, calls and lineage never supply a copy', rt.sstate('ST', rt.skey('lead', 'SL20')), '-|missing_state|-');
CREATE FUNCTION rt.st_snapshot() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(s.identity_key || '=' || concat_ws('|', coalesce(s.state_code, '-'), coalesce(s.reason, '-'), coalesce(s.basis, '-'),
                    coalesce(s.last_state_change_at::text, '-')), ' ' ORDER BY s.identity_key)
    FROM private.report_v3_identity_states(rt.v3('ST'), (SELECT array_agg(key) FROM st_keys)) s;
$$;
CREATE TEMP TABLE st_before AS SELECT rt.st_snapshot() AS v;
SAVEPOINT st_isolation;
-- The other tenant edits its own lead and memberships, records a state change against an ST id, calls an
-- ST lead through an ST membership, and links an ST membership to an ST lead in its own lineage.
UPDATE public.leads SET state = 'Oregon' WHERE id = rt.v3('SXL1');
UPDATE public.campaign_leads SET state = 'Utah' WHERE organization_id = rt.v3('SX');
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           changed_fields, recorded_at)
VALUES (rt.v3('SX'), rt.v3('SL2'), 'lead', 'leads', rt.v3('SL2'), 'updated', 'agent', '{state}', '2026-10-30 15:00+00');
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, campaign_lead_id, created_at, duration, status)
VALUES (gen_random_uuid(), rt.v3('SX'), rt.v3('SXA'), 'outbound', rt.v3('SL10'), 'lead', rt.v3('SCL6'), '2026-10-07 15:00+00', 50, 'completed');
INSERT INTO private.dialer_conversion_lineage VALUES (rt.v3('SX'), rt.v3('SCL9'), rt.v3('SL10'));
SELECT rt.eq('changing the other tenant changes nothing in ST', rt.st_snapshot(), (SELECT v FROM st_before));
ROLLBACK TO SAVEPOINT st_isolation;

-- -----------------------------------------------------------------------------------------------------
-- 4. Phone numbers never resolve an identity, and nothing beyond the asked-for key leaves the helper.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('a shared phone number never lends a state', rt.sstate('ST', rt.skey('lead', 'SL22')), '-|missing_state|-');
SELECT rt.eq('results carry no record id, phone number or name, only the asked-for keys',
  (SELECT count(*) FROM private.report_v3_identity_states(rt.v3('ST'), (SELECT array_agg(key) FROM st_keys)) s
    WHERE s.identity_key NOT IN (SELECT key FROM st_keys)
       OR row_to_json(s)::text ~ ('(' || rt.v3('SK2') || '|' || rt.v3('SCL7a') || '|' || rt.v3('SC9') || '|555-01|Sam)')),
  0::bigint);
SELECT rt.eq('the helpers read no phone column',
  (SELECT count(*) FROM pg_proc WHERE oid IN ('private.report_v3_state_classify(text)'::regprocedure,
          'private.report_v3_identity_states(uuid,text[])'::regprocedure) AND prosrc ~* 'phone'), 0::bigint);

-- -----------------------------------------------------------------------------------------------------
-- 5. The seal, the unchanged normalizer and the private lineage index.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('identity resolver metadata: sql, stable, invoker, pinned search_path',
  (SELECT concat_ws('|', l.lanname, p.provolatile, p.prosecdef::text, array_to_string(p.proconfig, ';'),
                    pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid))
     FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'private.report_v3_identity_states(uuid,text[])'::regprocedure),
  'sql|s|false|search_path=pg_catalog, pg_temp|p_org uuid, p_identity_keys text[]|'
  || 'TABLE(identity_key text, state_code text, reason text, basis text, last_state_change_at timestamp with time zone)');
SELECT rt.eq('no client role can execute either state helper',
  (SELECT array_agg(has_function_privilege(r, f, 'EXECUTE') ORDER BY f, r)
     FROM unnest(ARRAY['private.report_v3_identity_states(uuid,text[])', 'private.report_v3_state_classify(text)']) f,
          unnest(ARRAY['anon', 'authenticated', 'reports_v3_inherits_authenticated', 'reports_v3_public_only', 'service_role']) r),
  array_fill(false, ARRAY[10]));
SELECT rt.eq('exactly the two state helpers exist, owned by postgres',
  (SELECT string_agg(p.proname || ':' || pg_get_userbyid(p.proowner), ' ' ORDER BY p.proname)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname IN ('report_v3_state_classify', 'report_v3_identity_states')),
  'report_v3_identity_states:postgres report_v3_state_classify:postgres');
SELECT rt.eq('normalize_us_state is unchanged: body, flags, owner and privileges',
  (SELECT concat_ws('|', md5(p.prosrc), p.provolatile, p.prosecdef::text, array_to_string(p.proconfig, ';'), p.proacl::text,
                    pg_get_userbyid(p.proowner))
     FROM pg_proc p WHERE p.oid = 'public.normalize_us_state(text)'::regprocedure),
  (SELECT concat_ws('|', prosrc_md5, provolatile, prosecdef::text, array_to_string(proconfig, ';'), acl, owner)
     FROM rt.state_normalizer_preimage));
SELECT rt.eq('the private lineage index: exact, valid and ready',
  (SELECT pg_get_indexdef(i.indexrelid) || ' valid=' || i.indisvalid || ' ready=' || i.indisready
     FROM pg_index i WHERE i.indexrelid = to_regclass('private.report_v3_lineage_original_lead')),
  'CREATE INDEX report_v3_lineage_original_lead ON private.dialer_conversion_lineage USING btree (organization_id, original_lead_id)'
  || ' valid=true ready=true');
SELECT rt.eq('RLS stays on, with no policies, for the lineage and history tables',
  (SELECT string_agg(c.relname || ':' || c.relrowsecurity::text || ':'
                     || (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::text, ' ' ORDER BY c.relname)
     FROM pg_class c WHERE c.oid IN ('private.dialer_conversion_lineage'::regclass, 'public.contact_history_events'::regclass)),
  'contact_history_events:true:0 dialer_conversion_lineage:true:0');
SELECT rt.assert_v3_helper_shape();
SELECT rt.assert_sealed_v3(true, false);

-- -----------------------------------------------------------------------------------------------------
-- 6. Negative controls (D5 §8): the suite must reject a missing pre-trim, a fallback after an invalid
--    value, a collapsed conflict and a cross-tenant join.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.reject_mutation('private.report_v3_state_classify(text)',
  'btrim(coalesce(p_raw, ''''), '' '' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))', 'btrim(coalesce(p_raw, ''''))',
  $probe$SELECT rt.eq('mutated pre-trim', rt.cls('ny' || chr(9)), 'NY|-')$probe$,
  'mutated pre-trim FAIL');
SELECT rt.reject_mutation('private.report_v3_identity_states(uuid,text[])',
  '(s.reason IS DISTINCT FROM ''missing_state'') AS recorded',
  '(s.reason IS DISTINCT FROM ''missing_state'' AND s.reason IS DISTINCT FROM ''invalid_state'') AS recorded',
  $probe$SELECT rt.eq('mutated invalid fallback', rt.sstate('ST', rt.skey('lead', 'SL5')), '-|invalid_state|current_record')$probe$,
  'mutated invalid fallback FAIL');
SELECT rt.reject_mutation('private.report_v3_identity_states(uuid,text[])',
  'count(DISTINCT v.state_code) AS valid_codes', 'least(count(DISTINCT v.state_code), 1) AS valid_codes',
  $probe$SELECT rt.eq('mutated conflict', rt.sstate('ST', rt.skey('lead', 'SL3')), '-|source_conflict|current_record')$probe$,
  'mutated conflict FAIL');
SELECT rt.reject_mutation('private.report_v3_identity_states(uuid,text[])',
  'cl.id = ca.campaign_lead_id AND cl.organization_id = p_org', 'cl.id = ca.campaign_lead_id',
  $probe$SELECT rt.eq('mutated cross-tenant membership', rt.sstate('ST', rt.skey('lead', 'SL20')), '-|missing_state|-')$probe$,
  'mutated cross-tenant membership FAIL');
SELECT rt.reject_mutation('private.report_v3_identity_states(uuid,text[])',
  'ca.organization_id = p_org', 'true',
  $probe$SELECT rt.eq('mutated cross-tenant call', rt.sstate('ST', rt.skey('lead', 'SL20')), '-|missing_state|-')$probe$,
  'mutated cross-tenant call FAIL');

-- -----------------------------------------------------------------------------------------------------
-- 7. The state reader (D5 §3.4–§3.7). It splits KPIs 5, 6, 2 and 1 by each identity's current recorded
--    state (never event-time residence). O1 October anchors: calls CA 3, NV 3, AZ 1, OR 1 (RL4 blank: its
--    KT3 membership copy), unresolved 1 (RC4), recruit 1 (RC10); policies CA 3, TX 2, FL 2, NV 1, AZ 1, and
--    unmapped invalid (W4, C4 'XX'), unsupported (W5, C5 'PR'), missing (W7, C7 blank), unresolved (W10, deleted
--    client). W16 (CA, recorded 2026-11-20) joins once its recorded time has passed.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION rt.st(p_who text, p_scope text DEFAULT NULL, p_agent text DEFAULT NULL, p_start date DEFAULT '2026-10-01',
                      p_end date DEFAULT '2026-10-31') RETURNS jsonb LANGUAGE sql AS $$
  SELECT rt.v3r(p_who, 'state_breakdown', p_scope, p_agent, p_start, p_end);
$$;
-- 'ok', or every reconciliation that failed: Σ51 + Σ6 = totals = the summary KPIs, AP to the cent, modes and
-- call_population equal to KPI 5, 6, 2 and 1 of the same window and scope.
CREATE FUNCTION rt.st_recon(p_who text, p_scope text DEFAULT NULL, p_agent text DEFAULT NULL, p_start date DEFAULT '2026-10-01',
                            p_end date DEFAULT '2026-10-31') RETURNS text LANGUAGE plpgsql AS $$
DECLARE st jsonb := rt.st(p_who, p_scope, p_agent, p_start, p_end);
        su jsonb := rt.v3r(p_who, 'summary', p_scope, p_agent, p_start, p_end);
        bad text[] := '{}';
        k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['calls_made', 'contacted_calls', 'policies_sold'] LOOP
    IF rt.jsum(st, '$.jurisdictions[*].' || k) + rt.jsum(st, '$.unmapped.reasons[*].' || k) <> (st #>> ARRAY['totals', k])::numeric
       OR rt.jsum(st, '$.unmapped.reasons[*].' || k) <> (st #>> ARRAY['unmapped', k])::numeric THEN
      bad := bad || k;
    END IF;
  END LOOP;
  IF rt.jsum(st, '$.jurisdictions[*].premium.annual_premium ? (@ != null)') + rt.jsum(st, '$.unmapped.reasons[*].premium.annual_premium ? (@ != null)')
     <> coalesce((st #>> '{totals,premium,annual_premium}')::numeric, 0) THEN bad := bad || 'ap_sum'::text; END IF;
  IF (st #>> '{totals,calls_made}') IS DISTINCT FROM rt.kpi(su, 5) THEN bad := bad || 'kpi5'::text; END IF;
  IF (st #>> '{totals,contacted_calls}') IS DISTINCT FROM rt.kpi(su, 6) THEN bad := bad || 'kpi6'::text; END IF;
  IF (st #>> '{totals,policies_sold}') IS DISTINCT FROM rt.kpi(su, 2) THEN bad := bad || 'kpi2'::text; END IF;
  IF (st #>> '{totals,premium,annual_premium}')::numeric IS DISTINCT FROM (CASE WHEN rt.kpi(su, 1) = 'null' THEN NULL ELSE rt.kpi(su, 1)::numeric END)
     AND NOT ((st #>> '{totals,policies_sold}')::int = 0 AND rt.kpi(su, 1)::numeric = 0) THEN bad := bad || 'kpi1'::text; END IF;
  IF st #> '{modes,calls_made}' IS DISTINCT FROM jsonb_build_object('metric_id', 5, 'status', rt.kpi(su, 5, 'status')::jsonb, 'reason', rt.kpi(su, 5, 'reason')::jsonb)
     OR st #> '{modes,contacted_calls}' IS DISTINCT FROM jsonb_build_object('metric_id', 6, 'status', rt.kpi(su, 6, 'status')::jsonb, 'reason', rt.kpi(su, 6, 'reason')::jsonb)
     OR st #> '{modes,policies_sold}' IS DISTINCT FROM jsonb_build_object('metric_id', 2, 'status', rt.kpi(su, 2, 'status')::jsonb, 'reason', rt.kpi(su, 2, 'reason')::jsonb)
     OR st #> '{modes,ap}' IS DISTINCT FROM jsonb_build_object('metric_id', 1, 'status', rt.kpi(su, 1, 'status')::jsonb, 'reason', rt.kpi(su, 1, 'reason')::jsonb) THEN
    bad := bad || 'modes'::text;
  END IF;
  IF st -> 'call_population' IS DISTINCT FROM rt.kpi(su, 5, 'detail')::jsonb -> 'call_population' THEN bad := bad || 'population'::text; END IF;
  RETURN CASE WHEN cardinality(bad) = 0 THEN 'ok' ELSE array_to_string(bad, ',') END;
END $$;
CREATE FUNCTION rt.st_rows(p jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(concat_ws(':', x.k, x.v ->> 'calls_made', x.v ->> 'contacted_calls', x.v ->> 'policies_sold',
                              coalesce(x.v #>> '{premium,annual_premium}', 'null')), ' ' ORDER BY x.o)
    FROM (SELECT j ->> 'state' AS k, j AS v, o FROM jsonb_array_elements(p -> 'jurisdictions') WITH ORDINALITY y(j, o)
           WHERE (j ->> 'calls_made')::int + (j ->> 'policies_sold')::int > 0
          UNION ALL
          SELECT r ->> 'reason', r, 100 + o FROM jsonb_array_elements(p #> '{unmapped,reasons}') WITH ORDINALITY y(r, o)
           WHERE (r ->> 'calls_made')::int + (r ->> 'policies_sold')::int > 0) x;
$$;

SELECT rt.eq('reader shape: 51 sorted jurisdictions (AK, HI, DC zero), 6 unmapped reasons in order, no envelopes',
  (SELECT count(*) || ':' || bool_and(j ->> 'state' = (SELECT array_agg(c ORDER BY c COLLATE "C") FROM unnest(ARRAY(SELECT code FROM st_jurisdictions)) c)[o])
     FROM jsonb_array_elements(rt.st('ADM1') -> 'jurisdictions') WITH ORDINALITY x(j, o))
  || ' | ' || (SELECT string_agg(j ->> 'calls_made' || '/' || (j ->> 'policies_sold'), ',' ORDER BY j ->> 'state' COLLATE "C")
                 FROM jsonb_array_elements(rt.st('ADM1') -> 'jurisdictions') j WHERE j ->> 'state' IN ('AK', 'HI', 'DC'))
  || ' | ' || (SELECT string_agg(r ->> 'reason', ',' ORDER BY o) FROM jsonb_array_elements(rt.st('ADM1') #> '{unmapped,reasons}') WITH ORDINALITY x(r, o))
  || ' | ' || (rt.st('ADM1') -> 'metrics')::text,
  '51:true | 0/0,0/0,0/0 | missing_state,invalid_state,unresolved_identity,source_conflict,unsupported_geography,non_prospect_contact | []');
SELECT rt.eq('reader meta: reader, contract 3.0.0, basis, policy_basis keys, state_basis; no top-level time_zone or period',
  concat_ws(' | ', rt.st('A1') ->> 'reader', rt.st('A1') ->> 'contract_version', rt.st('A1') #>> '{basis,corrections}',
            (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(rt.st('A1') -> 'policy_basis') k),
            (rt.st('A1') -> 'state_basis')::text, (rt.st('A1') ? 'time_zone')::text, (rt.st('A1') ? 'period')::text,
            (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(rt.st('A1') -> 'call_population') k)),
  'state_breakdown | 3.0.0 | not_installed | credit,date,premium,source | '
  || '{"version": "state_v1", "priority": ["event_snapshot", "current_record", "campaign_copy"], "classifier": "report_v3_state_classify_v1", '
  || '"normalizer": "public.normalize_us_state", "history_capture_since": "2026-10-03", "campaign_copy_fallback": true, '
  || '"event_snapshot_available": false} | false | false | attempts,duplicates_excluded,non_attempts,unverified');
SELECT rt.eq('agency October groups (state:calls:contacted:policies:AP), recorded state only',
  rt.st_rows(rt.st('ADM1')),
  CASE WHEN now() >= '2026-11-20 00:00+00' THEN 'AZ:1:1:1:null CA:3:1:4:2068.08 ' ELSE 'AZ:1:1:1:null CA:3:1:3:1348.08 ' END
  || 'FL:0:0:2:360.00 NV:3:2:1:966.00 OR:1:1:0:0 TX:0:0:2:480.00 missing_state:0:0:1:null invalid_state:0:0:1:null '
  || 'unresolved_identity:1:0:1:300.00 unsupported_geography:0:0:1:603.00 non_prospect_contact:1:0:0:0');
SELECT rt.eq('basis: OR comes from the campaign copy, the others from the current record',
  (SELECT string_agg(concat_ws(':', j ->> 'state', j #>> '{basis,calls,current_record}', j #>> '{basis,calls,campaign_copy}',
                               j #>> '{basis,calls,event_snapshot}'), ' ' ORDER BY j ->> 'state' COLLATE "C")
     FROM jsonb_array_elements(rt.st('ADM1') -> 'jurisdictions') j WHERE (j ->> 'calls_made')::int > 0),
  'AZ:1:0:0 CA:3:0:0 NV:3:0:0 OR:0:1:0');
SELECT rt.eq('reconciliation at agency, team, personal and filter scope: Σ51 + Σ6 = totals = KPIs 5, 6, 2, 1; AP to the cent',
  concat_ws(' ', rt.st_recon('ADM1'), rt.st_recon('TL1'), rt.st_recon('A1'), rt.st_recon('A2'), rt.st_recon('A3'),
            rt.st_recon('ADM1', NULL, 'A2'), rt.st_recon('TL1', 'team', 'A1'), rt.st_recon('ADM1', NULL, NULL, '2026-07-01', '2026-07-01'),
            rt.st_recon('A1', NULL, NULL, '2026-03-08', '2026-03-08')),
  'ok ok ok ok ok ok ok ok ok');
SELECT rt.eq('premium matrix (RL-11) through the reader''s AP mode',
  concat_ws(' | ',
    (rt.st('A1') #>> '{modes,ap,status}') || '/' || coalesce(rt.st('A1') #>> '{modes,ap,reason}', '-'),
    (rt.st('A2') #>> '{modes,ap,status}') || '/' || (rt.st('A2') #>> '{modes,ap,reason}'),
    (rt.st('A3') #>> '{modes,ap,status}') || '/' || (rt.st('A3') #>> '{modes,ap,reason}'),
    (rt.st('A2', NULL, NULL, '2026-10-03', '2026-10-03') #>> '{modes,ap,status}') || '/' || (rt.st('A2', NULL, NULL, '2026-10-03', '2026-10-03') #>> '{modes,ap,reason}')
      || '/' || coalesce(rt.st('A2', NULL, NULL, '2026-10-03', '2026-10-03') #>> '{totals,premium,annual_premium}', 'null'),
    (rt.st('A2', NULL, NULL, '2026-10-04', '2026-10-04') #>> '{modes,ap,status}') || '/' || (rt.st('A2', NULL, NULL, '2026-10-04', '2026-10-04') #>> '{modes,ap,reason}'),
    (rt.st('A2', NULL, NULL, '2026-10-03', '2026-10-04') #>> '{modes,ap,status}') || '/' || (rt.st('A2', NULL, NULL, '2026-10-03', '2026-10-04') #>> '{modes,ap,reason}'),
    (rt.st('A2', NULL, NULL, '2026-10-01', '2026-10-01') #>> '{modes,ap,status}') || '/' || (rt.st('A2', NULL, NULL, '2026-10-01', '2026-10-01') #>> '{totals,premium,annual_premium}')),
  'available/- | partial/premium_invalid | partial/premium_missing | unavailable/premium_not_entered/null | unavailable/premium_invalid | '
  || 'unavailable/premium_invalid | available/0');
SELECT rt.eq('unverified calls: agency partial, A1 on Oct 7 unavailable (no attempts), A2 available',
  concat_ws(' ', rt.st('ADM1') #>> '{modes,calls_made,status}', rt.st('ADM1') #>> '{modes,calls_made,reason}',
            rt.st('A1', NULL, NULL, '2026-10-07', '2026-10-07') #>> '{modes,calls_made,status}',
            rt.st('A1', NULL, NULL, '2026-10-07', '2026-10-07') #>> '{totals,calls_made}', rt.st('A2') #>> '{modes,calls_made,status}'),
  'partial attempt_unverified unavailable 0 available');
SELECT rt.eq('an identity''s state is the same in any window (RL1''s March calls are CA too)',
  rt.st_rows(rt.st('A1', NULL, NULL, '2026-03-08', '2026-03-08')), 'CA:2:1:0:0');
SELECT rt.eq('a future Sold Date counts once its date arrives (W15, Nov 1, FL)',
  rt.st_rows(rt.st('A2', NULL, NULL, '2026-11-01', '2026-11-01')), 'FL:0:0:1:180.00 NV:1:0:0:0');
SELECT rt.eq('the state payload carries no prospect, client or call identity and no phone number',
  (SELECT count(*) FROM unnest(ARRAY['ADM1', 'TL1', 'A1']) w WHERE rt.st(w)::text ~ ('c3a73000|c3a75000|c3c00000|c3a72000|555-0')), 0::bigint);
SAVEPOINT st_reader;
-- Cardinality: two A1 calls on client C1 (two policies, W1 and W17) add two CA calls and no policy.
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, created_at, duration, status)
SELECT gen_random_uuid(), rt.v3('O1'), rt.v3('A1'), 'outbound', rt.v3('C1'), 'client', '702-555-0141', '2026-10-15 16:00+00'::timestamptz + n * interval '1 hour',
       30, 'completed' FROM generate_series(1, 2) n;
-- A source conflict: RL3 (NV) gains a converted client record in CA.
INSERT INTO public.clients (id, organization_id, lead_id, phone, state) VALUES (gen_random_uuid(), rt.v3('O1'), rt.v3('RL3'), '702-555-0103', 'CA');
-- A recorded state change of RL1 after its first call.
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           changed_fields, recorded_at)
VALUES (rt.v3('O1'), rt.v3('RL1'), 'lead', 'leads', rt.v3('RL1'), 'updated', 'agent', '{state}', '2026-10-05 16:30+00');
SELECT rt.eq('cardinality, conflict and drift: CA +2 calls (policies unchanged), RL3''s calls become source_conflict, RC1 changed after its call',
  rt.st_rows(rt.st('ADM1')) || ' | CA changed after ' || (SELECT j #>> '{basis,calls_changed_after_event}' FROM jsonb_array_elements(rt.st('ADM1') -> 'jurisdictions') j WHERE j ->> 'state' = 'CA')
  || ' | ' || rt.st_recon('ADM1'),
  CASE WHEN now() >= '2026-11-20 00:00+00' THEN 'AZ:1:1:1:null CA:5:1:4:2068.08 ' ELSE 'AZ:1:1:1:null CA:5:1:3:1348.08 ' END
  || 'FL:0:0:2:360.00 NV:0:0:1:966.00 OR:1:1:0:0 TX:0:0:2:480.00 missing_state:0:0:1:null invalid_state:0:0:1:null '
  || 'unresolved_identity:1:0:1:300.00 source_conflict:3:2:0:0 unsupported_geography:0:0:1:603.00 non_prospect_contact:1:0:0:0 | CA changed after 1 | ok');
ROLLBACK TO SAVEPOINT st_reader;
SELECT rt.eq('no state reader raises on an empty, open or spring-forward window',
  (SELECT count(*) FROM (VALUES ('2026-07-01'::date, '2026-07-01'::date), ((now() AT TIME ZONE 'America/Los_Angeles')::date, (now() AT TIME ZONE 'America/Los_Angeles')::date),
                                ('2026-03-08', '2026-03-08')) v(a, b)
    WHERE rt.st('ADM1', NULL, NULL, v.a, v.b) ->> 'reader' = 'state_breakdown'), 3::bigint);
SELECT rt.assert_sealed_v3(true, false);
