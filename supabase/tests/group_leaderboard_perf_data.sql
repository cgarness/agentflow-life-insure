-- =====================================================================================================
-- Deterministic LARGE synthetic data for the Group leaderboard index proof (runner step 7).
-- STATUS: disposable LOCAL PostgreSQL only, via scripts/run_group_leaderboard_tests.sh (AGENT_RULES #28).
-- Loaded after group_leaderboard_harness.sql + the extracted functions; synthetic tenants only.
--
-- Shape: 60 organizations, 40 profiles each (2,400); group 99999999-…-0001 has 3 ACTIVE member organizations
-- (a 120-profile roster). 600,000 appointments over two years across ALL organizations (85% self-set, 10%
-- delegated to a colleague, 5% legacy created_by NULL), realistic text widths and every status; 300,000 calls and
-- 40,000 clients. Production today holds 65 appointments; this models growth, not the present.
-- =====================================================================================================
SELECT setseed(0.4242);

INSERT INTO public.organizations (id, name)
SELECT ('10000000-0000-4000-8000-' || lpad(to_hex(o), 12, '0'))::uuid, 'Perf Org ' || o
FROM generate_series(1, 60) o;

INSERT INTO public.company_settings (organization_id, timezone)
SELECT id, CASE WHEN name = 'Perf Org 1' THEN 'America/Los_Angeles' ELSE 'UTC' END FROM public.organizations;

INSERT INTO public.agency_group_members (agency_group_id, organization_id, status)
SELECT '99999999-0000-4000-8000-000000000001', ('10000000-0000-4000-8000-' || lpad(to_hex(o), 12, '0'))::uuid, 'active'
FROM generate_series(1, 3) o;

INSERT INTO public.profiles (id, organization_id, first_name, last_name, role, status)
SELECT ('a0000000-0000-4000-8000-' || lpad(to_hex(o * 1000 + u), 12, '0'))::uuid,
       ('10000000-0000-4000-8000-' || lpad(to_hex(o), 12, '0'))::uuid,
       'First' || u, 'Last' || o,
       CASE WHEN u = 1 THEN 'Admin' WHEN u <= 4 THEN 'Team Leader' ELSE 'Agent' END,
       'Active'
FROM generate_series(1, 60) o, generate_series(1, 40) u;

CREATE TEMP TABLE perf_people AS
SELECT o, u, ('a0000000-0000-4000-8000-' || lpad(to_hex(o * 1000 + u), 12, '0'))::uuid AS id,
       ('10000000-0000-4000-8000-' || lpad(to_hex(o), 12, '0'))::uuid AS org
FROM generate_series(1, 60) o, generate_series(1, 40) u;
CREATE INDEX ON perf_people (o, u);

WITH r AS (
  SELECT g,
         1 + floor(random() * 60)::int AS o,
         1 + floor(random() * 40)::int AS u,
         1 + floor(random() * 40)::int AS other,
         random() AS kind,
         now() - (random() * interval '730 days') AS created_at,
         floor(random() * 6)::int AS st
  FROM generate_series(1, 600000) g
)
INSERT INTO public.appointments (title, contact_name, contact_id, type, status, start_time, end_time, notes,
                                 created_by, created_at, updated_at, user_id, sync_source, organization_id)
SELECT 'Policy review with contact ' || r.g,
       'Contact ' || md5(r.g::text),
       gen_random_uuid(),
       'Sales Call',
       (ARRAY['Scheduled','Confirmed','Completed','Cancelled','No Show','Rescheduled'])[r.st + 1],
       r.created_at + (random() * interval '30 days'),
       r.created_at + (random() * interval '30 days') + interval '30 minutes',
       repeat('Discussed coverage options and beneficiaries. ', 1 + (r.g % 3)),
       CASE WHEN r.kind < 0.85 THEN me.id WHEN r.kind < 0.95 THEN colleague.id ELSE NULL END,
       r.created_at, r.created_at,
       me.id,
       'internal',
       me.org
FROM r
JOIN perf_people me ON me.o = r.o AND me.u = r.u
JOIN perf_people colleague ON colleague.o = r.o AND colleague.u = r.other;

INSERT INTO public.calls (agent_id, created_at, duration)
SELECT p.id, now() - (random() * interval '730 days'), floor(random() * 600)::int
FROM generate_series(1, 300000) g
JOIN perf_people p ON p.o = 1 + (g % 60) AND p.u = 1 + ((g / 60) % 40);

INSERT INTO public.clients (assigned_agent_id, created_at)
SELECT p.id, now() - (random() * interval '730 days')
FROM generate_series(1, 40000) g
JOIN perf_people p ON p.o = 1 + (g % 60) AND p.u = 1 + ((g / 60) % 40);
