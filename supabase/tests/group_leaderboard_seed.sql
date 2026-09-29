-- =====================================================================================================
-- Group leaderboard fixture data (synthetic). No BEGIN/COMMIT here: group_leaderboard_rpc.sql includes it inside
-- its own transaction (so now() — and the period start — is one instant for the data and the read), and the
-- runner loads it with psql --single-transaction for the access differential.
-- =====================================================================================================
INSERT INTO public.organizations (id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Org One'),
  ('10000000-0000-4000-8000-000000000002', 'Org Two'),
  ('10000000-0000-4000-8000-000000000003', 'Org Three (invited only)'),
  ('10000000-0000-4000-8000-000000000004', 'Org Four (active in another group)'),
  ('10000000-0000-4000-8000-000000000005', 'Org Five (status spelled Active)');

INSERT INTO public.company_settings (organization_id, timezone) VALUES
  ('10000000-0000-4000-8000-000000000001', 'America/Los_Angeles'),
  ('10000000-0000-4000-8000-000000000002', 'UTC'),
  ('10000000-0000-4000-8000-000000000003', 'UTC'),
  ('10000000-0000-4000-8000-000000000004', 'UTC'),
  ('10000000-0000-4000-8000-000000000005', 'UTC');

-- Group G = 99999999-…-0001; group H = 99999999-…-0002.
INSERT INTO public.agency_group_members (agency_group_id, organization_id, status) VALUES
  ('99999999-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active'),
  ('99999999-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'active'),
  ('99999999-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'invited'),
  ('99999999-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'active'),
  ('99999999-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'Active');

-- A, B: agents in Org One. C: admin in Org Two. I: inactive in Org One. X: Org Three. D: Org Four. E: Org Five.
INSERT INTO public.profiles (id, organization_id, first_name, last_name, role, status) VALUES
  ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'Avery', 'Setter',   'Agent', 'Active'),
  ('a0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'Blake', 'Assignee', 'Agent', 'Active'),
  ('a0000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000002', 'Casey', 'Admin',    'Admin', 'Active'),
  ('a0000000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-000000000001', 'Indy',  'Inactive', 'Agent', 'Inactive'),
  ('a0000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000003', 'Xan',   'Invited',  'Agent', 'Active'),
  ('a0000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000004', 'Dana',  'OtherGrp', 'Agent', 'Active'),
  ('a0000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000005', 'Eli',   'CaseStat', 'Agent', 'Active');

CREATE TEMP TABLE period AS
  SELECT date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS ps;

INSERT INTO public.appointments (id, organization_id, created_by, user_id, status, start_time, created_at)
SELECT v.id::uuid, v.org::uuid, v.created_by::uuid, v.user_id::uuid, v.status, v.start_time, v.created_at
FROM period, LATERAL (VALUES
  -- delegated booking: A set it for B → A +1, B 0.
  ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b', 'Scheduled',   now() + interval '2 days',  now()),
  -- legacy writer gap: created_by NULL, user_id B → B +1 via the approved fallback.
  ('b0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', NULL,                                   'a0000000-0000-4000-8000-00000000000b', 'Scheduled',   now() + interval '2 days',  now()),
  -- self-booked: A for A → A +1 exactly once.
  ('b0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '3 days',  now()),
  -- later outcomes never remove booking credit.
  ('b0000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Cancelled',   now() + interval '4 days',  now()),
  ('b0000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b', 'No Show',     now() - interval '1 hour',  now()),
  ('b0000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Completed',   now() - interval '2 hours', now()),
  ('b0000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Rescheduled', now() + interval '5 days',  now()),
  -- booking time, not occurrence: booked before the period (not counted) / occurring far ahead (counted).
  ('b0000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '1 day',   ps - interval '1 second'),
  ('b0000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '60 days', now()),
  -- set by someone off the roster (inactive I) for A: credits I, so A gets nothing from it.
  ('b0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000e', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '1 day',   now()),
  -- another member organization: C for C.
  ('b0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000c', 'Scheduled',   now() + interval '1 day',   now())
) AS v(id, org, created_by, user_id, status, start_time, created_at);

-- Metrics the repair must not change: calls (no direction filter), talk time, clients-based policies_sold.
INSERT INTO public.calls (agent_id, created_at, duration) SELECT v.agent_id::uuid, v.created_at, v.duration FROM period, LATERAL (VALUES
  ('a0000000-0000-4000-8000-00000000000a', now(), 30),
  ('a0000000-0000-4000-8000-00000000000a', now(), 60),
  ('a0000000-0000-4000-8000-00000000000a', ps - interval '1 second', 999),
  ('a0000000-0000-4000-8000-00000000000b', now(), 10)
) AS v(agent_id, created_at, duration);
INSERT INTO public.clients (assigned_agent_id, created_at) VALUES ('a0000000-0000-4000-8000-00000000000a', now());
