-- =====================================================================================================
-- Reports v3 performance evidence and acceptance (Batch 6 gate; Batch 7 acceptance; plan D1 §3.11, A2). Disposable
-- synthetic PostgreSQL only: no production project, credentials or data. Run by scripts/run_reports_v3_perf_acceptance.sh
-- stage by stage (setup, measure, restart, explain, finish), or, for quick local diagnostics only, embedded in
-- scripts/run_reports_v3_tests.sh (setup, measure, explain, finish; no restart round).
--
-- One synthetic organization at the required size (500,000 calls, 5,000 clients, 10,000 policy objects with one sale
-- each, 10,000 appointments; every value derived from hashes of row keys, so the fixture is deterministic) is measured
-- through the public reader paths exactly as a signed-in user calls them: role authenticated, the user's JWT claims,
-- the sealed reader. EXECUTE is granted to authenticated only while measuring and revoked afterwards; the seal is then
-- re-asserted. Every sample is its own statement under production's 8 s statement_timeout and production's session
-- planner settings (jit off, work_mem 5MB, hash_mem_multiplier 2, one parallel worker per gather, random_page_cost
-- 1.1, effective_cache_size 1536MB); nothing is relaxed to obtain a pass.
--
-- Matrix (147 combinations): the scope reader at personal, team and agency scope; every other reader at 1, 30 and
-- 366 days x personal, team and agency scope x no filter or the one-agent filter. Per combination: one warm-up round
-- (sample 0), :perf_samples measured rounds interleaved (samples 1..N), and, in acceptance runs, one
-- first-after-restart round (sample -1) after the runner restarts PostgreSQL. p95 is the nearest-rank 95th percentile
-- of the measured samples. Targets: p95 <= 2 s (scope, summary, state, sales appointments, the four call readers) and
-- <= 4 s (journey). A missing sample, any timeout (warm-up and restart included) or a p95 over target fails the
-- combination; any other error fails the run.
--
-- Modes (:perf_mode): acceptance (PostgreSQL 17.6, all 147 combinations, at least 20 samples, enforcement and the
-- restart round, or the run is not acceptance-eligible), diagnostic (report-only, never acceptance evidence) and
-- negative-control (the scope reader slowed by 2.2 s in this disposable database: the gate must fail).
-- =====================================================================================================
SET LOCAL statement_timeout = '0';
CREATE FUNCTION rt.perf_hash(k text, n integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT ((hashtextextended(k, 0) % n + n) % n)::integer $$;
CREATE FUNCTION rt.perf_id(k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(k)::uuid $$;

CREATE TABLE rt.perf_meta AS
SELECT rt.perf_id('perf-org') AS org, 'America/Los_Angeles'::text AS tz,
       ((now() AT TIME ZONE 'America/Los_Angeles')::date - 1) AS end_date;
CREATE FUNCTION rt.perf_ts(p_day_offset integer, p_seconds integer) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT ((m.end_date - p_day_offset)::timestamp + p_seconds * interval '1 second') AT TIME ZONE m.tz FROM rt.perf_meta m $$;

INSERT INTO public.organizations (id, name) SELECT org, 'Perf Scale Agency' FROM rt.perf_meta;
INSERT INTO public.company_settings (company_name, timezone, organization_id) SELECT 'Perf Scale Agency', tz, org FROM rt.perf_meta;

-- 64 people: 0 Admin; 1-5 Team Leaders; 6-55 Agents under TL1-TL5 (10 each); 56-59 Agents with no upline;
-- 60-63 Inactive agents under TL1 (historical calls only).
CREATE TABLE rt.perf_agents AS
SELECT a.n, rt.perf_id('perf-agent-' || a.n) AS id,
       CASE WHEN a.n = 0 THEN 'Admin' WHEN a.n <= 5 THEN 'Team Leader' ELSE 'Agent' END AS role,
       CASE WHEN a.n BETWEEN 6 AND 55 THEN rt.perf_id('perf-agent-' || (1 + (a.n - 6) / 10))
            WHEN a.n >= 60 THEN rt.perf_id('perf-agent-1') END AS upline,
       CASE WHEN a.n >= 60 THEN 'Inactive' ELSE 'Active' END AS status
  FROM generate_series(0, 63) a(n);
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status, upline_id)
SELECT a.id, m.org, 'Perf', 'Person ' || lpad(a.n::text, 2, '0'), 'perf' || a.n || '@perf.invalid', a.role, a.status, a.upline
  FROM rt.perf_agents a, rt.perf_meta m;
INSERT INTO public.role_permissions (organization_id, role, permissions)
SELECT m.org, r.role, rt.perm(true, true, false, 'own', true, true, true, 'team')
  FROM rt.perf_meta m, (VALUES ('Agent'), ('Team Leader')) r(role);
CREATE FUNCTION rt.perf_agent(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT rt.perf_id('perf-agent-' || p_n) $$;

INSERT INTO public.campaigns (id, organization_id, name, type, user_id, assigned_agent_ids)
SELECT rt.perf_id('perf-campaign-' || c.n), m.org, 'Perf Campaign ' || lpad(c.n::text, 2, '0'),
       CASE c.n % 3 WHEN 0 THEN 'Open Pool' WHEN 1 THEN 'Team' ELSE 'Personal' END,
       rt.perf_agent(6 + c.n % 54),
       CASE WHEN c.n % 3 = 1 THEN (SELECT jsonb_agg(a.id) FROM rt.perf_agents a WHERE a.upline = rt.perf_agent(1 + c.n % 5))
            ELSE '[]'::jsonb END
  FROM generate_series(0, 29) c(n), rt.perf_meta m;

INSERT INTO public.pipeline_stages (id, name, pipeline_type, convert_to_client, organization_id)
SELECT rt.perf_id('perf-stage-sold'), 'Sold', 'lead', true, org FROM rt.perf_meta;
CREATE TABLE rt.perf_disp (k integer PRIMARY KEY, name text, contacted boolean, callback boolean, appointment boolean, dnc boolean, stage boolean);
INSERT INTO rt.perf_disp VALUES (0, 'No Answer', false, false, false, false, false), (1, 'Busy', false, false, false, false, false),
  (2, 'Voicemail', false, false, false, false, false), (3, 'Not Interested', true, false, false, false, false),
  (4, 'Wrong Number', false, false, false, false, false), (5, 'Callback', true, true, false, false, false),
  (6, 'Interested', true, false, false, false, false), (7, 'Appointment Set', true, false, true, false, false),
  (8, 'Sold', true, false, false, false, true), (9, 'DNC', false, false, false, true, false);
INSERT INTO public.dispositions (id, name, counts_as_contacted, callback_scheduler, appointment_scheduler, dnc_auto_add,
                                 pipeline_stage_id, organization_id)
SELECT rt.perf_id('perf-disp-' || d.k), d.name, d.contacted, d.callback, d.appointment, d.dnc,
       CASE WHEN d.stage THEN rt.perf_id('perf-stage-sold') END, m.org
  FROM rt.perf_disp d, rt.perf_meta m;

-- 60,000 leads over 760 days; 900 converted leads were deleted after conversion (never inserted).
CREATE TABLE rt.perf_leads AS
SELECT l.n, rt.perf_id('perf-lead-' || l.n) AS id, rt.perf_hash('ld' || l.n, 760) AS day_off,
       '702' || lpad(l.n::text, 7, '0') AS phone,
       (ARRAY['CA','TX','FL','NV','AZ','OR','WA','NY','GA','IL','OH','PA','NC','MI','NJ','VA','CO','TN','IN','MO','',''])[1 + rt.perf_hash('ls' || l.n, 22)] AS state,
       (ARRAY['Facebook','Google','Referral','Web','Direct Mail','TV','Radio','Partner',''])[1 + rt.perf_hash('lsrc' || l.n, 9)] AS source,
       CASE WHEN rt.perf_hash('la' || l.n, 20) = 0 THEN NULL ELSE rt.perf_agent(6 + rt.perf_hash('lag' || l.n, 54)) END AS agent,
       (l.n % 13 = 0 AND l.n / 13 <= 4500 AND (l.n / 13) % 5 = 0) AS deleted
  FROM generate_series(1, 60000) l(n);
ALTER TABLE rt.perf_leads ADD PRIMARY KEY (n);
INSERT INTO public.leads (id, organization_id, first_name, last_name, phone, status, lead_source, assigned_agent_id, user_id, created_at, state)
SELECT l.id, m.org, 'Perf', 'Lead ' || l.n, l.phone, 'New', l.source, l.agent, l.agent,
       rt.perf_ts(l.day_off, 32400 + rt.perf_hash('lt' || l.n, 28800)), l.state
  FROM rt.perf_leads l, rt.perf_meta m WHERE NOT l.deleted;

-- 80,000 memberships: every lead in one campaign, leads 1-20,000 in a second one.
INSERT INTO public.campaign_leads (id, campaign_id, lead_id, status, call_attempts, organization_id, phone, state)
SELECT rt.perf_id('perf-cl-' || l.n), rt.perf_id('perf-campaign-' || (l.n % 30)), CASE WHEN l.deleted THEN NULL ELSE l.id END, 'Called', 1,
       m.org, l.phone, l.state
  FROM rt.perf_leads l, rt.perf_meta m;
INSERT INTO public.campaign_leads (id, campaign_id, lead_id, status, call_attempts, organization_id, phone, state)
SELECT rt.perf_id('perf-cl2-' || l.n), rt.perf_id('perf-campaign-' || ((l.n + 7) % 30)), CASE WHEN l.deleted THEN NULL ELSE l.id END, 'Queued', 0,
       m.org, l.phone, l.state
  FROM rt.perf_leads l, rt.perf_meta m WHERE l.n <= 20000;
INSERT INTO private.dialer_conversion_lineage (organization_id, campaign_lead_id, original_lead_id)
SELECT m.org, rt.perf_id('perf-cl-' || l.n), l.id FROM rt.perf_leads l, rt.perf_meta m WHERE l.deleted;

INSERT INTO public.recruits (id, phone, organization_id, state)
SELECT rt.perf_id('perf-recruit-' || r.n), '725' || lpad(r.n::text, 7, '0'), m.org, 'NV' FROM generate_series(1, 500) r(n), rt.perf_meta m;

-- 5,000 clients: 4,500 converted from leads 13, 26, ... (lead_id lineage), 500 hand-entered.
CREATE TABLE rt.perf_clients AS
SELECT c.n, rt.perf_id('perf-client-' || c.n) AS id,
       CASE WHEN c.n <= 4500 THEN rt.perf_id('perf-lead-' || (c.n * 13)) END AS lead_id,
       CASE WHEN c.n <= 4500 THEN (SELECT l.day_off FROM rt.perf_leads l WHERE l.n = c.n * 13) END AS lead_day_off,
       CASE WHEN c.n <= 4500 THEN greatest((SELECT l.day_off FROM rt.perf_leads l WHERE l.n = c.n * 13) - 1 - rt.perf_hash('cv' || c.n, 60), 0)
            ELSE rt.perf_hash('cvh' || c.n, 420) END AS conv_off,
       CASE WHEN c.n > 4500 OR rt.perf_hash('cp' || c.n, 10) = 0 THEN '808' || lpad(c.n::text, 7, '0')
            ELSE '702' || lpad((c.n * 13)::text, 7, '0') END AS phone,
       rt.perf_agent(6 + rt.perf_hash('cag' || c.n, 54)) AS agent
  FROM generate_series(1, 5000) c(n);
ALTER TABLE rt.perf_clients ADD PRIMARY KEY (n);
INSERT INTO public.clients (id, organization_id, first_name, last_name, premium, lead_id, assigned_agent_id, created_at, phone, state,
                            lead_conversion, primary_policy_id)
SELECT c.id, m.org, 'Perf', 'Client ' || c.n, 50 + rt.perf_hash('cprem' || c.n, 200), c.lead_id, c.agent, rt.perf_ts(c.conv_off, 50400),
       c.phone, (ARRAY['CA','TX','FL','NV','AZ','OR','WA','NY',''])[1 + rt.perf_hash('cst' || c.n, 9)],
       CASE WHEN c.lead_id IS NOT NULL THEN jsonb_build_object('converted_at', rt.perf_ts(c.conv_off, 50400),
                                                               'lead_created_at', rt.perf_ts(c.lead_day_off, 36000)) END,
       NULL
  FROM rt.perf_clients c, rt.perf_meta m;

-- 10,000 policy objects (primary and additional per client) and one sale event each.
INSERT INTO private.policy_identities (policy_id, organization_id, client_id, source, legacy, created_at)
SELECT rt.perf_id('perf-policy-' || c.n || '-' || k.k), m.org, c.id, CASE k.k WHEN 1 THEN 'primary' ELSE 'additional' END, false,
       rt.perf_ts(c.conv_off, 50400)
  FROM rt.perf_clients c, generate_series(1, 2) k(k), rt.perf_meta m;
UPDATE public.clients cl SET primary_policy_id = rt.perf_id('perf-policy-' || c.n || '-1')
  FROM rt.perf_clients c WHERE cl.id = c.id;
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, policy_id, premium_snapshot, premium_amount, idempotency_key,
                         sold_date, created_at, recorded_at, event_time_source)
SELECT rt.perf_id('perf-win-' || c.n || '-' || k.k), m.org,
       CASE WHEN rt.perf_hash('ws' || c.n || k.k, 10) < 8 THEN c.agent ELSE rt.perf_agent(6 + rt.perf_hash('wsa' || c.n || k.k, 54)) END,
       c.id, rt.perf_id('perf-policy-' || c.n || '-' || k.k), rt.perf_hash('wsn' || c.n || k.k, 10) < 9,
       CASE WHEN rt.perf_hash('wnull' || c.n || k.k, 50) = 0 THEN NULL ELSE 40 + rt.perf_hash('wamt' || c.n || k.k, 300) END,
       'perf:' || c.n || ':' || k.k,
       CASE WHEN k.k = 2 AND rt.perf_hash('wu' || c.n, 100) = 0 THEN NULL
            ELSE m.end_date - greatest(c.conv_off - (k.k - 1) * rt.perf_hash('wd' || c.n, 40), 0) END,
       rt.perf_ts(greatest(c.conv_off - (k.k - 1) * rt.perf_hash('wd' || c.n, 40), 0), 64800),
       rt.perf_ts(greatest(c.conv_off - (k.k - 1) * rt.perf_hash('wd' || c.n, 40), 0), 64800),
       CASE WHEN rt.perf_hash('wet' || c.n, 20) = 0 THEN 'sold_date_proxy' ELSE 'event' END
  FROM rt.perf_clients c, generate_series(1, 2) k(k), rt.perf_meta m;

INSERT INTO public.appointments (id, title, type, status, created_by, user_id, created_at, organization_id)
SELECT rt.perf_id('perf-appt-' || a.n), 'Appointment', 'Sales Call', 'Scheduled', rt.perf_agent(6 + rt.perf_hash('aa' || a.n, 54)),
       rt.perf_agent(6 + rt.perf_hash('aa' || a.n, 54)), rt.perf_ts(rt.perf_hash('ad' || a.n, 400), 36000), m.org
  FROM generate_series(1, 10000) a(n), rt.perf_meta m;

-- 500,000 calls over 400 days (business hours, agency zone).
CREATE TABLE rt.perf_calls AS
SELECT g, rt.perf_hash('cd' || g, 400) AS d, rt.perf_hash('ck' || g, 100) AS b, rt.perf_hash('cdur' || g, 100) AS db,
       CASE WHEN rt.perf_hash('cl' || g, 2) = 0 THEN 1 + rt.perf_hash('cl1' || g, 60000) ELSE 1 + rt.perf_hash('cl2' || g, 6000) END AS li,
       1 + rt.perf_hash('cc' || g, 5000) AS ci, rt.perf_hash('cag' || g, 100) AS ag, rt.perf_hash('cx' || g, 1000) AS x
  FROM generate_series(1, 500000) g;
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, campaign_id, campaign_lead_id,
                          created_at, started_at, duration, disposition_id, disposition_name, status, duration_source, duration_conflict,
                          answered_by_agent_id, outcome, voicemail_id, dialer_admission_required)
SELECT rt.perf_id('perf-call-' || c.g), m.org,
       CASE WHEN c.b >= 93 AND c.ag < 30 THEN NULL
            WHEN c.ag < 90 THEN rt.perf_agent(6 + c.g % 54)
            WHEN c.ag < 95 THEN rt.perf_agent(1 + c.g % 5)
            WHEN c.d >= 200 THEN rt.perf_agent(60 + c.g % 4)
            ELSE rt.perf_agent(6 + (c.g / 7) % 54) END,
       CASE WHEN c.b >= 93 THEN 'inbound' WHEN c.x < 20 THEN 'outgoing' ELSE 'outbound' END,
       CASE WHEN c.b < 62 THEN rt.perf_id('perf-lead-' || c.li)
            WHEN c.b < 70 THEN rt.perf_id('perf-client-' || c.ci)
            WHEN c.b < 76 THEN NULL
            WHEN c.b < 80 THEN rt.perf_id('perf-cl-' || c.li)
            WHEN c.b = 80 THEN rt.perf_id('perf-recruit-' || (1 + c.g % 500))
            WHEN c.b < 83 THEN rt.perf_id('perf-dangling-' || c.g)
            WHEN c.b < 93 THEN NULL
            WHEN c.b < 97 THEN rt.perf_id('perf-lead-' || c.li)
            WHEN c.b < 99 THEN rt.perf_id('perf-client-' || c.ci)
            ELSE NULL END,
       CASE WHEN c.b < 62 AND c.x % 10 >= 7 THEN 'lead' WHEN c.b BETWEEN 62 AND 69 OR c.b BETWEEN 97 AND 98 THEN 'client'
            WHEN c.b = 80 THEN 'recruit' END,
       CASE WHEN c.b < 62 OR c.b BETWEEN 70 AND 79 OR c.b BETWEEN 93 AND 96 THEN
              CASE c.x % 3 WHEN 0 THEN '702' || lpad(c.li::text, 7, '0') WHEN 1 THEN '+1702' || lpad(c.li::text, 7, '0')
                   ELSE '(702) ' || substr(lpad(c.li::text, 7, '0'), 1, 3) || '-' || substr(lpad(c.li::text, 7, '0'), 4) END
            WHEN c.b < 70 OR c.b BETWEEN 97 AND 98 THEN (SELECT pc.phone FROM rt.perf_clients pc WHERE pc.n = c.ci)
            WHEN c.b = 80 THEN '725' || lpad((1 + c.g % 500)::text, 7, '0')
            WHEN c.b < 83 OR c.b BETWEEN 90 AND 92 THEN '909' || lpad((c.g % 9999999)::text, 7, '0')
            WHEN c.b < 85 THEN NULL
            WHEN c.b < 90 THEN '+1702' || lpad(c.li::text, 7, '0')
            ELSE NULL END,
       CASE WHEN c.b < 62 OR c.b BETWEEN 70 AND 79 THEN rt.perf_id('perf-campaign-' || (c.li % 30)) END,
       CASE WHEN c.b < 62 OR c.b BETWEEN 70 AND 79 THEN rt.perf_id('perf-cl-' || c.li) END,
       rt.perf_ts(c.d, 28800 + rt.perf_hash('cs' || c.g, 36000)), rt.perf_ts(c.d, 28800 + rt.perf_hash('cs' || c.g, 36000)),
       CASE WHEN c.db < 40 THEN 0 WHEN c.db < 65 THEN 1 + c.x % 30 WHEN c.db < 80 THEN 31 + c.x % 30
            WHEN c.db < 90 THEN 61 + c.x % 240 ELSE 301 + c.x % 1500 END,
       CASE WHEN c.x % 4 = 3 THEN NULL ELSE rt.perf_id('perf-disp-' || (
         CASE WHEN c.db < 40 THEN (ARRAY[0,0,0,0,0,0,0,1,1,2])[1 + c.x % 10] WHEN c.db < 65 THEN (ARRAY[2,3,4,9])[1 + c.x % 4]
              WHEN c.db < 80 THEN (ARRAY[3,5,6])[1 + c.x % 3] WHEN c.db < 90 THEN (ARRAY[6,5,7])[1 + c.x % 3]
              ELSE (ARRAY[6,7,8])[1 + c.x % 3] END)) END,
       CASE WHEN c.x % 4 = 3 AND c.x % 40 = 39 THEN 'Left Message' ELSE (SELECT pd.name FROM rt.perf_disp pd WHERE pd.k =
         CASE WHEN c.db < 40 THEN (ARRAY[0,0,0,0,0,0,0,1,1,2])[1 + c.x % 10] WHEN c.db < 65 THEN (ARRAY[2,3,4,9])[1 + c.x % 4]
              WHEN c.db < 80 THEN (ARRAY[3,5,6])[1 + c.x % 3] WHEN c.db < 90 THEN (ARRAY[6,5,7])[1 + c.x % 3]
              ELSE (ARRAY[6,7,8])[1 + c.x % 3] END) END,
       'completed',
       CASE WHEN c.db < 40 THEN (ARRAY['terminal_non_answer','terminal_non_answer','terminal_non_answer','provider','legacy_unknown'])[1 + c.x % 5]
            WHEN c.x = 999 THEN 'terminal_non_answer'
            ELSE (ARRAY['provider','provider','provider','elapsed_estimate','legacy_unknown'])[1 + c.x % 5] END,
       c.x BETWEEN 500 AND 504,
       CASE WHEN c.b >= 93 AND c.ag < 15 THEN rt.perf_agent(6 + c.g % 54) END,
       CASE WHEN c.b >= 93 AND c.ag BETWEEN 15 AND 22 THEN 'forwarded_answered' END,
       CASE WHEN c.b >= 93 AND c.ag BETWEEN 23 AND 29 THEN rt.perf_id('perf-vm-' || c.g) END,
       c.b < 93 AND c.d < 120
  FROM rt.perf_calls c, rt.perf_meta m;
INSERT INTO private.dialer_outbound_admissions (organization_id, call_id, parent_sid, destination, admitted, reason, created_at)
SELECT m.org, rt.perf_id('perf-call-' || c.g), 'CA' || md5('perf-adm-' || c.g), '+17020000000', c.x % 100 < 97,
       CASE WHEN c.x % 100 >= 97 THEN 'refused' END, rt.perf_ts(c.d, 28800)
  FROM rt.perf_calls c, rt.perf_meta m WHERE c.b < 93 AND c.d < 120 AND c.x % 100 < 98;
INSERT INTO private.performance_duplicate_rows (organization_id, kind, duplicate_id, canonical_id, evidence_hash, reviewed_at)
SELECT m.org, 'call', rt.perf_id('perf-call-' || g), rt.perf_id('perf-call-' || (g - 1)), md5('perf-dup-' || g), now()
  FROM generate_series(1667, 500000, 1667) g, rt.perf_meta m;

-- Dialer sessions: most working days per person, with stale, late-ended and overlapping sessions.
INSERT INTO public.dialer_sessions (id, organization_id, agent_id, campaign_id, started_at, ended_at, last_heartbeat_at, status)
SELECT rt.perf_id('perf-session-' || a.n || '-' || d.d), m.org, a.id, NULL,
       rt.perf_ts(d.d, 28800 + rt.perf_hash('ss' || a.n || d.d, 3600)),
       CASE WHEN rt.perf_hash('sx' || a.n || d.d, 100) = 0 THEN NULL
            ELSE rt.perf_ts(d.d, 28800 + rt.perf_hash('ss' || a.n || d.d, 3600) + 14400 + rt.perf_hash('se' || a.n || d.d, 18000)) END,
       rt.perf_ts(d.d, 28800 + rt.perf_hash('ss' || a.n || d.d, 3600) + 14400 + rt.perf_hash('se' || a.n || d.d, 18000)
                       - CASE WHEN rt.perf_hash('sl' || a.n || d.d, 100) = 0 THEN 1800 ELSE rt.perf_hash('sh' || a.n || d.d, 45) END),
       CASE WHEN rt.perf_hash('sx' || a.n || d.d, 100) = 0 THEN 'interrupted' ELSE 'ended' END
  FROM rt.perf_agents a, generate_series(0, 399) d(d), rt.perf_meta m
 WHERE a.n >= 1 AND rt.perf_hash('sd' || a.n || '-' || d.d, 10) < 7 AND (a.n < 60 OR d.d >= 200);
INSERT INTO public.dialer_sessions (id, organization_id, agent_id, campaign_id, started_at, ended_at, last_heartbeat_at, status)
SELECT rt.perf_id('perf-session-b-' || s.id), s.organization_id, s.agent_id, NULL, s.started_at + interval '1 hour',
       s.ended_at - interval '1 hour', s.last_heartbeat_at - interval '1 hour', 'ended'
  FROM public.dialer_sessions s, rt.perf_meta m
 WHERE s.organization_id = m.org AND s.ended_at IS NOT NULL AND rt.perf_hash('so' || s.id, 50) = 0;

-- Contact history: creation and import receipts, phone and state changes.
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind, recorded_at)
SELECT m.org, l.id, 'lead', 'leads', l.id, CASE WHEN l.n % 10 = 0 THEN 'imported' ELSE 'created' END, 'system',
       rt.perf_ts(l.day_off, 32400 + rt.perf_hash('lt' || l.n, 28800))
  FROM rt.perf_leads l, rt.perf_meta m WHERE NOT l.deleted;
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           changed_fields, recorded_at)
SELECT m.org, l.id, 'lead', 'leads', l.id, 'updated', 'agent', CASE WHEN l.n % 40 = 1 THEN '{phone}'::text[] ELSE '{state}'::text[] END,
       rt.perf_ts(greatest(l.day_off - 30, 0), 43200)
  FROM rt.perf_leads l, rt.perf_meta m WHERE NOT l.deleted AND (l.n % 40 = 1 OR l.n % 30 = 2);
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           changed_fields, recorded_at)
SELECT m.org, c.id, 'client', 'clients', c.id, 'updated', 'agent', '{phone}', rt.perf_ts(greatest(c.conv_off - 10, 0), 43200)
  FROM rt.perf_clients c, rt.perf_meta m WHERE c.n % 10 = 3;
INSERT INTO public.import_history (id, imported_lead_ids, created_at, organization_id, import_completion_status, undo_status)
SELECT rt.perf_id('perf-import-' || k), (SELECT jsonb_agg(l.id) FROM rt.perf_leads l WHERE l.n BETWEEN k * 300 + 1 AND k * 300 + 300),
       rt.perf_ts((SELECT max(l.day_off) FROM rt.perf_leads l WHERE l.n BETWEEN k * 300 + 1 AND k * 300 + 300), 30000), m.org, 'completed',
       CASE WHEN k % 30 = 7 THEN 'undone' END
  FROM generate_series(0, 149) k, rt.perf_meta m;
INSERT INTO private.google_sheets_receipts (organization_id, user_id, spreadsheet_id, sheet_id, receipt_key, outcome, lead_id, fingerprint,
                                            row_number, created_at)
SELECT m.org, rt.perf_agent(6), 'perf-sheet', 1, 'perf-receipt-' || l.n, 'imported', l.id, md5('perf-fp-' || l.n), l.n,
       rt.perf_ts(l.day_off, 30000)
  FROM rt.perf_leads l, rt.perf_meta m WHERE l.n BETWEEN 45001 AND 48000 AND NOT l.deleted;


-- -----------------------------------------------------------------------------------------------------
-- Measurement harness: combinations, the run's plan, samples, one measured call, verdicts, controls and the gate.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE rt.perf_combos (ord serial, reader text, combo text, persona integer, days integer, filter_agent integer,
                             scope text, target_ms integer, sql text, PRIMARY KEY (reader, combo));
-- Personas: 7 (an agent; personal scope), 1 (the team leader whose downline includes agent 7; team scope) and 0 (the
-- admin; agency scope). The one-agent filter is agent 7 at every scope.
INSERT INTO rt.perf_combos (reader, combo, persona, days, filter_agent, scope, target_ms)
SELECT 'scope', v.combo, v.persona, NULL, NULL, v.scope, 2000
  FROM (VALUES ('personal', 7, 'personal'), ('team', 1, 'team'), ('agency', 0, 'agency')) v(combo, persona, scope);
INSERT INTO rt.perf_combos (reader, combo, persona, days, filter_agent, scope, target_ms)
SELECT r.reader, s.scope || '-' || d.days || CASE WHEN f.agent IS NOT NULL THEN '-one-agent' ELSE '' END, s.persona, d.days,
       f.agent, s.scope, CASE WHEN r.reader = 'journey' THEN 4000 ELSE 2000 END
  FROM (VALUES (1, 'summary'), (2, 'state_breakdown'), (3, 'sales_appointments'), (4, 'call_volume'), (5, 'disposition_breakdown'),
               (6, 'campaign_calls'), (7, 'lead_source_calls'), (8, 'journey')) r(r_ord, reader)
 CROSS JOIN (VALUES (1), (30), (366)) d(days)
 CROSS JOIN (VALUES (1, 'personal', 7), (2, 'team', 1), (3, 'agency', 0)) s(s_ord, scope, persona)
 CROSS JOIN (VALUES (NULL::integer), (7)) f(agent)
 ORDER BY r.r_ord, d.days, s.s_ord, f.agent NULLS FIRST;
UPDATE rt.perf_combos c SET sql = CASE WHEN c.reader = 'scope' THEN format('SELECT public.get_report_scope_v3(%L)', c.scope)
  ELSE format('SELECT public.get_report_%s_v3(%L::date, %L::date, %L::uuid, %L)', c.reader, m.end_date - (c.days - 1), m.end_date,
              CASE WHEN c.filter_agent IS NOT NULL THEN rt.perf_agent(c.filter_agent) END, c.scope) END
  FROM rt.perf_meta m;
-- The combinations this run measures, and how the run was prepared.
CREATE TABLE rt.perf_plan (reader text, combo text, PRIMARY KEY (reader, combo), FOREIGN KEY (reader, combo) REFERENCES rt.perf_combos);
CREATE TABLE rt.perf_run (mode text NOT NULL, injected_delay_ms integer, prepared_at timestamptz NOT NULL DEFAULT clock_timestamp());

-- Sample -1 is the first-after-restart round, 0 the warm-up, 1..N the measured rounds.
CREATE TABLE rt.perf_samples (reader text, combo text, sample integer, ms numeric, completed boolean, payload_bytes integer,
                              PRIMARY KEY (reader, combo, sample));

-- One call as the persona: claims, role authenticated, the reader's own SQL. A statement_timeout is recorded as an
-- over-budget sample (the statement's 8 s budget is spent); any other error fails the run.
CREATE FUNCTION rt.perf_measure(p_reader text, p_combo text, p_sample integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c rt.perf_combos; t0 timestamptz; v jsonb; ms numeric; done boolean := true;
BEGIN
  SELECT * INTO STRICT c FROM rt.perf_combos WHERE reader = p_reader AND combo = p_combo;
  BEGIN
    PERFORM rt.claims(rt.perf_agent(c.persona), (SELECT m.org FROM rt.perf_meta m));
    EXECUTE 'SET LOCAL ROLE authenticated';
    t0 := clock_timestamp();
    EXECUTE c.sql INTO v;
    ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
    EXECUTE 'RESET ROLE';
    IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN
      RAISE EXCEPTION 'performance sample %/%: the reader returned no payload', p_reader, p_combo;
    END IF;
  EXCEPTION WHEN query_canceled THEN
    ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
    done := false;
  END;
  INSERT INTO rt.perf_samples VALUES (p_reader, p_combo, p_sample, round(ms, 1), done, length(v::text));
END $$;

-- The same call once more, for the logged EXPLAIN (ANALYZE, BUFFERS) evidence (never a sample).
CREATE FUNCTION rt.perf_explain(p_reader text, p_combo text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c rt.perf_combos; v jsonb;
BEGIN
  SELECT * INTO STRICT c FROM rt.perf_combos WHERE reader = p_reader AND combo = p_combo;
  PERFORM rt.claims(rt.perf_agent(c.persona), (SELECT m.org FROM rt.perf_meta m));
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE c.sql INTO v;
  EXECUTE 'RESET ROLE';
  RETURN p_reader || '/' || p_combo || ': ' || length(v::text) || ' bytes';
END $$;

-- The run's plan. acceptance and diagnostic: every combination. negative-control: the three scope combinations, with
-- the scope reader slowed by 2.2 s in this disposable database, so their p95 must miss the 2 s target.
CREATE FUNCTION rt.perf_prepare(p_mode text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE def text;
BEGIN
  IF p_mode NOT IN ('acceptance', 'diagnostic', 'negative-control') THEN
    RAISE EXCEPTION 'performance: unknown mode %', p_mode;
  END IF;
  IF EXISTS (SELECT 1 FROM rt.perf_run) THEN
    RAISE EXCEPTION 'performance: this database was already prepared for a run';
  END IF;
  INSERT INTO rt.perf_plan SELECT c.reader, c.combo FROM rt.perf_combos c WHERE p_mode <> 'negative-control' OR c.reader = 'scope';
  IF p_mode = 'negative-control' THEN
    def := pg_get_functiondef('public.get_report_scope_v3(text)'::regprocedure);
    IF position('SELECT * INTO a FROM private.report_access_v2(p_requested_scope, NULL);' IN def) = 0 THEN
      RAISE EXCEPTION 'performance negative control: the scope reader injection point is missing';
    END IF;
    EXECUTE replace(def, 'SELECT * INTO a FROM private.report_access_v2(p_requested_scope, NULL);',
                    'PERFORM pg_sleep(2.2); SELECT * INTO a FROM private.report_access_v2(p_requested_scope, NULL);');
  END IF;
  INSERT INTO rt.perf_run (mode, injected_delay_ms) VALUES (p_mode, CASE WHEN p_mode = 'negative-control' THEN 2200 END);
  RETURN p_mode || ': ' || (SELECT count(*) FROM rt.perf_plan) || ' planned combinations';
END $$;

-- Every planned combination's samples and statistics; the warm-up and the restart round are reported, never counted
-- in the p95.
CREATE VIEW rt.perf_results AS
SELECT c.ord, c.reader, c.combo, c.scope, c.days AS window_days, c.filter_agent, c.target_ms,
       count(s.ms) FILTER (WHERE s.sample > 0) AS samples,
       min(s.ms) FILTER (WHERE s.sample > 0) AS min_ms,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY s.ms) FILTER (WHERE s.sample > 0) AS median_ms,
       (array_agg(s.ms ORDER BY s.ms) FILTER (WHERE s.sample > 0))[ceil(0.95 * count(s.ms) FILTER (WHERE s.sample > 0))::int] AS p95_ms,
       max(s.ms) FILTER (WHERE s.sample > 0) AS max_ms,
       count(*) FILTER (WHERE s.sample > 0 AND NOT s.completed) AS timeouts,
       max(s.ms) FILTER (WHERE s.sample = 0) AS warmup_ms, bool_and(s.completed) FILTER (WHERE s.sample = 0) AS warmup_completed,
       max(s.ms) FILTER (WHERE s.sample = -1) AS restart_ms, bool_and(s.completed) FILTER (WHERE s.sample = -1) AS restart_completed
  FROM rt.perf_plan p
  JOIN rt.perf_combos c ON c.reader = p.reader AND c.combo = p.combo
  LEFT JOIN rt.perf_samples s ON s.reader = c.reader AND s.combo = c.combo
 GROUP BY c.ord, c.reader, c.combo, c.scope, c.days, c.filter_agent, c.target_ms;

-- Each planned combination's verdict, with the first reason it fails.
CREATE FUNCTION rt.perf_verdicts(p_samples integer, p_restart boolean)
RETURNS TABLE (ord integer, reader text, combo text, scope text, window_days integer, filter_agent integer, target_ms integer,
               samples bigint, min_ms numeric, median_ms numeric, p95_ms numeric, max_ms numeric, timeouts bigint, warmup_ms numeric,
               warmup_completed boolean, restart_ms numeric, restart_completed boolean, verdict text, reason text)
LANGUAGE sql AS $$
  SELECT r.ord, r.reader, r.combo, r.scope, r.window_days, r.filter_agent, r.target_ms, r.samples, r.min_ms, r.median_ms, r.p95_ms,
         r.max_ms, r.timeouts, r.warmup_ms, r.warmup_completed, r.restart_ms, r.restart_completed,
         CASE WHEN x.reason IS NULL THEN 'PASS' ELSE 'FAIL' END, x.reason
    FROM rt.perf_results r
   CROSS JOIN LATERAL (SELECT CASE
           WHEN r.samples <> p_samples THEN 'missing samples (' || r.samples || ' of ' || p_samples || ')'
           WHEN r.warmup_ms IS NULL THEN 'warm-up missing'
           WHEN NOT r.warmup_completed THEN 'warm-up timeout'
           WHEN p_restart AND r.restart_ms IS NULL THEN 'restart round missing'
           WHEN p_restart AND NOT r.restart_completed THEN 'first-after-restart timeout'
           WHEN r.timeouts > 0 THEN r.timeouts || ' measured timeout(s)'
           WHEN r.p95_ms > r.target_ms THEN 'p95 over target'
         END AS reason) x;
$$;

-- Acceptance evidence only from an enforced acceptance run on PostgreSQL 17.6 over all 147 combinations with at least
-- 20 measured samples and the restart round. A diagnostic or report-only run is never eligible.
CREATE FUNCTION rt.perf_acceptance_eligible(p_samples integer, p_mode text, p_enforce boolean, p_restart boolean)
RETURNS boolean LANGUAGE sql AS $$
  SELECT p_mode = 'acceptance' AND p_enforce AND p_restart AND p_samples >= 20
     AND current_setting('server_version_num')::integer = 170006
     AND (SELECT count(*) FROM rt.perf_combos) = 147
     AND (SELECT count(*) FROM rt.perf_plan) = 147
     AND (SELECT count(*) FROM rt.perf_run WHERE mode = 'acceptance' AND injected_delay_ms IS NULL) = 1;
$$;

CREATE FUNCTION rt.perf_gate(p_samples integer, p_mode text, p_enforce boolean, p_restart boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE planned int; n int; miss int; over int; msg text; eligible boolean;
BEGIN
  SELECT count(*) INTO planned FROM rt.perf_plan;
  SELECT count(*), count(*) FILTER (WHERE v.verdict <> 'PASS'),
         count(*) FILTER (WHERE v.timeouts > 0 OR NOT v.warmup_completed OR (p_restart AND NOT v.restart_completed))
    INTO n, miss, over FROM rt.perf_verdicts(p_samples, p_restart) v;
  IF planned = 0 OR n <> planned THEN
    RAISE EXCEPTION 'performance gate: % of % planned combinations measured', n, planned;
  END IF;
  eligible := rt.perf_acceptance_eligible(p_samples, p_mode, p_enforce, p_restart);
  msg := format('%s: %s of %s combinations meet their p95 target; %s with a timeout%s%s',
                CASE WHEN eligible THEN 'performance gate (ACCEPTANCE)'
                     WHEN p_mode = 'acceptance' THEN 'performance gate (acceptance mode, NOT acceptance-eligible)'
                     WHEN p_mode = 'negative-control' THEN 'performance gate (NEGATIVE CONTROL: the scope reader is slowed, this run must fail)'
                     ELSE 'performance gate (DIAGNOSTIC, ' || CASE WHEN p_enforce THEN 'enforced' ELSE 'report-only' END
                          || ', never acceptance evidence)' END,
                n - miss, n, over,
                CASE WHEN miss > 0 THEN ' (misses: ' || (SELECT string_agg(v.reader || '/' || v.combo || ' [' || v.reason || ']', ', ' ORDER BY v.ord)
                                                         FROM rt.perf_verdicts(p_samples, p_restart) v WHERE v.verdict <> 'PASS') || ')' ELSE '' END,
                CASE WHEN p_mode = 'acceptance' AND NOT eligible THEN ' (not acceptance-eligible: PostgreSQL 17.6, all 147 combinations, '
                     || 'at least 20 samples, enforcement and the restart round are all required)' ELSE '' END);
  IF p_enforce AND (miss > 0 OR (p_mode = 'acceptance' AND NOT eligible)) THEN
    RAISE EXCEPTION '%', msg;
  END IF;
  RETURN msg;
END $$;

-- SQL-level controls: the gate itself bites. Each runs on a synthetic one- or two-combination plan inside a
-- rolled-back subtransaction (the real plan and samples are untouched) and must fail for its own reason.
CREATE TABLE rt.perf_controls (control text PRIMARY KEY, outcome text NOT NULL);
CREATE FUNCTION rt.perf_control(p_control text, p_setup text, p_message text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE base text := 'DELETE FROM rt.perf_samples; DELETE FROM rt.perf_plan; '
  || 'INSERT INTO rt.perf_plan VALUES (''scope'', ''agency''); '
  || 'INSERT INTO rt.perf_samples SELECT ''scope'', ''agency'', s, 100, true, 1 FROM generate_series(-1, 20) s; ';
BEGIN
  IF p_message IS NULL THEN
    -- The positive control: the synthetic plan passes an enforced gate.
    BEGIN
      EXECUTE base || p_setup || ' SELECT rt.perf_gate(20, ''diagnostic'', true, true);';
      RAISE EXCEPTION 'performance control passed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'performance control passed' THEN RAISE EXCEPTION 'performance control %: unexpected failure: %', p_control, SQLERRM; END IF;
    END;
  ELSE
    PERFORM rt.expect_sql_failure(base || p_setup || ' SELECT rt.perf_gate(20, ''diagnostic'', true, true);', p_message);
  END IF;
  INSERT INTO rt.perf_controls VALUES (p_control, CASE WHEN p_message IS NULL THEN 'passed an enforced gate'
                                                      ELSE 'failed the enforced gate: ' || p_message END);
END $$;

ANALYZE public.organizations, public.company_settings, public.profiles, public.role_permissions, public.campaigns,
        public.pipeline_stages, public.dispositions, public.leads, public.campaign_leads, private.dialer_conversion_lineage,
        public.recruits, public.clients, private.policy_identities, public.wins, public.appointments, public.calls,
        private.dialer_outbound_admissions, private.performance_duplicate_rows, public.dialer_sessions,
        public.contact_history_events, public.import_history, private.google_sheets_receipts;

-- The fixture at the required size, and the environment the numbers come from.
CREATE FUNCTION rt.perf_fixture() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'calls', (SELECT count(*) FROM public.calls WHERE organization_id = m.org),
    'clients', (SELECT count(*) FROM public.clients WHERE organization_id = m.org),
    'policy_objects', (SELECT count(*) FROM private.policy_identities WHERE organization_id = m.org),
    'sale_events', (SELECT count(*) FROM public.wins WHERE organization_id = m.org),
    'buyers', (SELECT count(DISTINCT contact_id) FROM public.wins WHERE organization_id = m.org),
    'appointments', (SELECT count(*) FROM public.appointments WHERE organization_id = m.org),
    'leads', (SELECT count(*) FROM public.leads WHERE organization_id = m.org),
    'memberships', (SELECT count(*) FROM public.campaign_leads WHERE organization_id = m.org),
    'history_events', (SELECT count(*) FROM public.contact_history_events WHERE organization_id = m.org),
    'sessions', (SELECT count(*) FROM public.dialer_sessions WHERE organization_id = m.org))
    FROM rt.perf_meta m;
$$;
SELECT rt.eq('performance fixture: 500,000 calls, 5,000 clients, 10,000 policy objects, 10,000 sale events (5,000 buyers) and 10,000 appointments',
  (SELECT concat_ws('|', f ->> 'calls', f ->> 'clients', f ->> 'policy_objects', f ->> 'sale_events', f ->> 'buyers', f ->> 'appointments')
     FROM rt.perf_fixture() f),
  '500000|5000|10000|10000|5000|10000');
SELECT rt.eq('performance matrix: 147 combinations', (SELECT count(*) FROM rt.perf_combos), 147::bigint);
SELECT 'performance fixture' AS evidence, version() AS server, rt.perf_fixture() AS sizes, current_setting('shared_buffers') AS shared_buffers;

-- @@performance-measure@@
-- One warm-up round, then :perf_samples measured rounds, interleaved over the run's plan. Each sample autocommits as
-- its own statement under the production session settings and the 8 s statement_timeout.
\if :{?perf_samples}
\else
\set perf_samples 5
\endif
\if :{?perf_mode}
\else
\set perf_mode diagnostic
\endif
\if :{?perf_enforce}
\else
\set perf_enforce false
\endif
SELECT rt.perf_prepare(:'perf_mode') AS performance_run;
SET jit = off;
SET work_mem = '5MB';
SET hash_mem_multiplier = 2;
SET max_parallel_workers_per_gather = 1;
SET max_parallel_workers = 2;
SET random_page_cost = 1.1;
SET effective_cache_size = '1536MB';
SELECT rt.v3_reader_grants(true);
SET statement_timeout = '8s';
\o /dev/null
SELECT format('SELECT rt.perf_measure(%L, %L, %s);', c.reader, c.combo, s.n)
  FROM rt.perf_plan p JOIN rt.perf_combos c ON c.reader = p.reader AND c.combo = p.combo
 CROSS JOIN generate_series(0, :perf_samples) AS s(n)
 ORDER BY s.n, c.ord \gexec
\o
RESET statement_timeout;
SELECT rt.v3_reader_grants(false);
RESET jit; RESET work_mem; RESET hash_mem_multiplier; RESET max_parallel_workers_per_gather; RESET max_parallel_workers;
RESET random_page_cost; RESET effective_cache_size;
SELECT 'performance parameters' AS evidence, :perf_samples AS samples_per_combination, 1 AS warm_up_rounds,
       (SELECT count(*) FROM rt.perf_plan) AS planned_combinations, :'perf_mode' AS mode,
       'nearest-rank p95 of the measured samples' AS statistic, '8s' AS statement_timeout,
       'jit off, work_mem 5MB, hash_mem_multiplier 2, max_parallel_workers_per_gather 1, '
       || 'max_parallel_workers 2, random_page_cost 1.1, effective_cache_size 1536MB' AS session_settings;

-- @@performance-restart@@
-- After the runner restarts PostgreSQL: shared buffers are empty, but the operating system's page cache may still
-- hold the data files, so this round is first-after-restart evidence, not a cold-cache measurement. One sample per
-- planned combination (sample -1), each its own statement under the same settings and timeout.
SET jit = off;
SET work_mem = '5MB';
SET hash_mem_multiplier = 2;
SET max_parallel_workers_per_gather = 1;
SET max_parallel_workers = 2;
SET random_page_cost = 1.1;
SET effective_cache_size = '1536MB';
SELECT rt.v3_reader_grants(true);
SET statement_timeout = '8s';
\o /dev/null
SELECT format('SELECT rt.perf_measure(%L, %L, -1);', c.reader, c.combo)
  FROM rt.perf_plan p JOIN rt.perf_combos c ON c.reader = p.reader AND c.combo = p.combo
 ORDER BY c.ord \gexec
\o
RESET statement_timeout;
SELECT rt.v3_reader_grants(false);
RESET jit; RESET work_mem; RESET hash_mem_multiplier; RESET max_parallel_workers_per_gather; RESET max_parallel_workers;
RESET random_page_cost; RESET effective_cache_size;
SELECT 'first-after-restart round' AS evidence, count(*) AS samples, count(*) FILTER (WHERE NOT completed) AS timeouts
  FROM rt.perf_samples WHERE sample = -1;

-- @@performance-explain@@
-- EXPLAIN (ANALYZE, BUFFERS) of each reader's 366-day agency path (agency scope for the scope reader) and of every
-- combination that failed: every statement of at least 100 ms, nested ones included, with its plan. Evidence only,
-- never a sample: instrumented timing is slower, so this step runs without the samples' statement_timeout. Bound
-- parameter values are not logged (an identity-key array alone runs to megabytes), and the plans go to this session's
-- client only (the runner writes them to their own file), not to the server log.
\if :{?perf_samples}
\else
\set perf_samples 5
\endif
\if :{?perf_restart}
\else
\set perf_restart false
\endif
LOAD 'auto_explain';
SET auto_explain.log_min_duration = '100ms';
SET auto_explain.log_analyze = on;
SET auto_explain.log_buffers = on;
SET auto_explain.log_timing = on;
SET auto_explain.log_nested_statements = on;
SET auto_explain.log_format = 'text';
SET auto_explain.log_parameter_max_length = 0;
SET log_min_messages = fatal;
SET client_min_messages = log;
SET jit = off;
SET work_mem = '5MB';
SET hash_mem_multiplier = 2;
SET max_parallel_workers_per_gather = 1;
SET max_parallel_workers = 2;
SET random_page_cost = 1.1;
SET effective_cache_size = '1536MB';
SELECT rt.v3_reader_grants(true);
SELECT format('SELECT rt.perf_explain(%L, %L);', c.reader, c.combo)
  FROM rt.perf_plan p JOIN rt.perf_combos c ON c.reader = p.reader AND c.combo = p.combo
 WHERE c.combo IN ('agency-366', 'agency')
    OR (c.reader, c.combo) IN (SELECT v.reader, v.combo FROM rt.perf_verdicts(:perf_samples, :perf_restart) v WHERE v.verdict <> 'PASS')
 ORDER BY c.ord \gexec
SET client_min_messages = notice;
SET auto_explain.log_min_duration = -1;
RESET log_min_messages;
SELECT rt.v3_reader_grants(false);
RESET jit; RESET work_mem; RESET hash_mem_multiplier; RESET max_parallel_workers_per_gather; RESET max_parallel_workers;
RESET random_page_cost; RESET effective_cache_size;

-- @@performance-finish@@
-- The temporary grants are gone and the creation-migration seal holds; the gate's own controls; the verdicts (written
-- before the gate can raise); then the gate.
\if :{?perf_samples}
\else
\set perf_samples 5
\endif
\if :{?perf_mode}
\else
\set perf_mode diagnostic
\endif
\if :{?perf_enforce}
\else
\set perf_enforce false
\endif
\if :{?perf_restart}
\else
\set perf_restart false
\endif
\if :{?perf_verdicts}
\else
\set perf_verdicts /dev/null
\endif
SELECT rt.v3_reader_grants(false);
SELECT rt.assert_sealed_v3(true, false);
SELECT rt.perf_control('passing synthetic plan', '', NULL);
SELECT rt.perf_control('p95 over target', 'UPDATE rt.perf_samples SET ms = 2500 WHERE sample > 0;', 'p95 over target');
SELECT rt.perf_control('missing measured sample', 'DELETE FROM rt.perf_samples WHERE sample = 7;', 'missing samples (19 of 20)');
SELECT rt.perf_control('measured timeout', 'UPDATE rt.perf_samples SET completed = false WHERE sample = 3;', '1 measured timeout(s)');
SELECT rt.perf_control('warm-up timeout', 'UPDATE rt.perf_samples SET completed = false WHERE sample = 0;', 'warm-up timeout');
SELECT rt.perf_control('first-after-restart timeout', 'UPDATE rt.perf_samples SET completed = false WHERE sample = -1;',
                       'first-after-restart timeout');
SELECT rt.perf_control('missing combination', 'INSERT INTO rt.perf_plan VALUES (''scope'', ''team'');', 'missing samples (0 of 20)');
SELECT rt.perf_control('missing warm-up', 'DELETE FROM rt.perf_samples WHERE sample = 0;', 'warm-up missing');
SELECT rt.perf_control('missing restart round', 'DELETE FROM rt.perf_samples WHERE sample = -1;', 'restart round missing');
-- An unexpected reader error is never recorded as a sample: it fails the run.
SELECT rt.expect_sql_failure(
  'SELECT rt.v3_reader_grants(true); '
  || replace(pg_get_functiondef('public.get_report_scope_v3(text)'::regprocedure), 'SELECT * INTO a FROM private.report_access_v2(p_requested_scope, NULL);',
             'RAISE EXCEPTION ''planted reader error''; SELECT * INTO a FROM private.report_access_v2(p_requested_scope, NULL);')
  || '; SELECT rt.perf_measure(''scope'', ''agency'', 99);', 'planted reader error');
INSERT INTO rt.perf_controls VALUES ('unexpected reader error', 'failed the run: planted reader error');
SELECT rt.eq('performance controls: no control left a sample behind',
  (SELECT count(*) FROM rt.perf_samples WHERE sample = 99), 0::bigint);
SELECT rt.eq('performance controls: a diagnostic, report-only, short, restart-less or non-17.6 run is never acceptance-eligible',
  rt.perf_acceptance_eligible(20, 'diagnostic', true, true) OR rt.perf_acceptance_eligible(20, 'acceptance', false, true)
  OR rt.perf_acceptance_eligible(19, 'acceptance', true, true) OR rt.perf_acceptance_eligible(20, 'acceptance', true, false)
  OR (current_setting('server_version_num')::integer <> 170006 AND rt.perf_acceptance_eligible(20, 'acceptance', true, true)), false);
INSERT INTO rt.perf_controls VALUES ('acceptance eligibility', 'diagnostic, report-only, short, restart-less and non-17.6 runs are not eligible');
SELECT rt.assert_sealed_v3(true, false);
\pset tuples_only on
\pset format unaligned
\o :perf_verdicts
SELECT jsonb_pretty(jsonb_build_object(
  'schema', 'reports-v3-performance-verdict/1',
  'mode', :'perf_mode',
  'acceptance_eligible', rt.perf_acceptance_eligible(:perf_samples, :'perf_mode', :perf_enforce, :perf_restart),
  'enforce', :perf_enforce,
  'server', jsonb_build_object('version', version(), 'server_version_num', current_setting('server_version_num')::integer,
                               'shared_buffers', current_setting('shared_buffers'), 'max_connections', current_setting('max_connections')),
  'session_settings', jsonb_build_object('jit', 'off', 'work_mem', '5MB', 'hash_mem_multiplier', 2, 'max_parallel_workers_per_gather', 1,
                                         'max_parallel_workers', 2, 'random_page_cost', 1.1, 'effective_cache_size', '1536MB'),
  'statement_timeout', '8s',
  'fixture', rt.perf_fixture(),
  'parameters', jsonb_build_object('samples', :perf_samples, 'warm_up_rounds', 1,
                                   'restart_round', CASE WHEN :perf_restart THEN 'first-after-restart' ELSE 'not run' END,
                                   'statistic', 'nearest-rank p95 of the measured samples',
                                   'planned_combinations', (SELECT count(*) FROM rt.perf_plan),
                                   'injected_delay_ms', (SELECT injected_delay_ms FROM rt.perf_run)),
  'combinations', (SELECT jsonb_agg(to_jsonb(v) - 'ord' ORDER BY v.ord) FROM rt.perf_verdicts(:perf_samples, :perf_restart) v),
  'totals', (SELECT jsonb_build_object('combinations', count(*), 'pass', count(*) FILTER (WHERE v.verdict = 'PASS'),
                                       'fail', count(*) FILTER (WHERE v.verdict <> 'PASS'),
                                       'with_timeout', count(*) FILTER (WHERE v.timeouts > 0 OR NOT v.warmup_completed
                                                                          OR (:perf_restart AND NOT v.restart_completed)))
               FROM rt.perf_verdicts(:perf_samples, :perf_restart) v),
  'controls', (SELECT jsonb_object_agg(control, outcome) FROM rt.perf_controls),
  'seal', 'verified',
  'verdict', CASE WHEN (SELECT count(*) FILTER (WHERE v.verdict <> 'PASS') FROM rt.perf_verdicts(:perf_samples, :perf_restart) v) = 0
                   AND (:'perf_mode' <> 'acceptance' OR rt.perf_acceptance_eligible(:perf_samples, :'perf_mode', :perf_enforce, :perf_restart))
                  THEN 'PASS' ELSE 'FAIL' END));
\o
\pset tuples_only off
\pset format aligned
SELECT reader, combo, samples, p95_ms, target_ms, warmup_ms, restart_ms, verdict, reason
  FROM rt.perf_verdicts(:perf_samples, :perf_restart) ORDER BY ord;
SELECT rt.perf_gate(:perf_samples, :'perf_mode', :perf_enforce, :perf_restart);
