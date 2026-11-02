-- =====================================================================================================
-- Reports v3 regional state suite (plan D5 §8). Disposable synthetic databases only, through
-- scripts/run_reports_v3_tests.sh. PKG-A Batch 4 covers the …14 helpers: the classifier and the
-- identity-state resolver. Batch 5 adds the get_report_state_breakdown_v3 reader cases to this file.
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
