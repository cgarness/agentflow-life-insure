-- =====================================================================================================
-- Reports v3 call and journey fixtures (plan D3 §7). Disposable synthetic databases only, through
-- scripts/run_reports_v3_tests.sh. Synthetic organization J ('V3 Journey Agency', America/Los_Angeles) and a
-- cross-organization JX. Every expected value in reports_v3_calls_identity.sql and reports_v3_journey.sql is
-- computed by hand from the tables below. All leads were received 2026-10-01 10:00 PDT (17:00 UTC) unless
-- stated. Agents: JA1 (personal scope), JA2 (team with JA1), JA3 (out of scope), JA4 (S1 only).
--
-- Scenarios (first journey contact = earliest contacted attempt or answered inbound contact, by any agent):
--   S1  JL1/JK1  no call at all; sold 2026-10-05 by JA4                       KPI 14 = 4 days; 38 Unclassified
--   S2  JL2      contacted Oct 3 by JA1 (JC2a); never buys                     member of 19 and 21 (non-buyer)
--   S3  JL3/JK3  No Answer Oct 2 (JC3a), contacted Oct 4 (JC3b); sold Oct 4   19 success; 21 = 2; 14 = 3; 38 Yes when linked
--   S4  JL4      unresolved No Answer 0 s to its number Oct 2 (JC4u, JA3); contacted Oct 6   21 unassessable; 19 assessable
--   S5  JL5      unresolved 90 s Interested to its number Oct 2 (JC5u, JA3); contacted Oct 7  19 and 21 unassessable
--   S6  JL6      own phone change Oct 2; contacted Oct 8                       19 and 21 unassessable (phone_changed)
--   S7  JL7      unverified linked call Oct 2 (JC7u); contacted Oct 9          21 attempt_unverified; 19 assessable
--   S8  JL8      refused admission Oct 2 (JC8n, JA2); contacted Oct 10 by JA2  21 = 1 (non-attempt not counted)
--   S9  JL9      answered inbound contact Oct 11 (JC9i, JA1)                   21 = 0; never in outbound totals
--   S10 JL10     inbound voicemail only (JC10v)                                no first contact
--   S11 JK11     hand-entered client (no lead); sold Oct 12 by JA1             14 hand_entered_client
--   S12 JK12     lead JL12 deleted, no receipt; sold Oct 13 by JA1             14 lead_receipt_unknown
--   S13 JL13/JK13 sold Oct 2 by JA1, contacted Oct 14                          prior buyer: not a 19/21 member; 14 = 1
--   S14 JL14     contacted Oct 5 by JA3                                        member at agency scope only
--   JCN          numberless unresolved outbound Oct 3 (JA3)                    agency-only history_incomplete
-- Classification calls (JA1, lead JL2, after its first contact): legacy pre-admission, failed, busy, 45 s,
-- 46 s, No Answer 100 s, Interested 10 s, and a recruit call. Resolution calls (September, JA2, No Answer):
-- campaign membership, lineage, membership without a lead, dangling contact, client pointer, converted lead
-- pointer, membership id used as contact, and a call with no link.
-- =====================================================================================================

INSERT INTO rt.v3_ids VALUES
  ('J', 'c3f00000-0000-0000-0000-000000000001'), ('JX', 'c3f00000-0000-0000-0000-000000000002'),
  ('JA1', 'c3fa0000-0000-0000-0000-000000000001'), ('JA2', 'c3fa0000-0000-0000-0000-000000000002'),
  ('JA3', 'c3fa0000-0000-0000-0000-000000000003'), ('JA4', 'c3fa0000-0000-0000-0000-000000000004'),
  ('JXA', 'c3fa0000-0000-0000-0000-000000000009'),
  ('JDNA', 'c3fd0000-0000-0000-0000-000000000001'), ('JDINT', 'c3fd0000-0000-0000-0000-000000000002'),
  ('JDLM', 'c3fd0000-0000-0000-0000-000000000003'), ('JXINT', 'c3fd0000-0000-0000-0000-000000000009'),
  ('JCMP', 'c3fe0000-0000-0000-0000-000000000001'),
  ('JCL1', 'c3fe1000-0000-0000-0000-000000000001'), ('JCL2', 'c3fe1000-0000-0000-0000-000000000002'),
  ('JCL3', 'c3fe1000-0000-0000-0000-000000000003'), ('JR1', 'c3fe2000-0000-0000-0000-000000000001'),
  ('JVM', 'c3fe3000-0000-0000-0000-000000000001'), ('JDANGLE', 'c3ffffff-0000-0000-0000-000000000099');
INSERT INTO rt.v3_ids SELECT 'JL' || n, ('c3f10000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 23) n;
INSERT INTO rt.v3_ids SELECT x.name, ('c3f2' || substr(x.name, 3) || '00-0000-0000-0000-000000000000')::uuid
  FROM (VALUES ('JK01'), ('JK03'), ('JK11'), ('JK12'), ('JK13'), ('JK23')) x(name);
INSERT INTO rt.v3_ids SELECT x.name, ('c3f3' || substr(x.name, 3) || '00-0000-0000-0000-000000000000')::uuid
  FROM (VALUES ('JP01'), ('JP03'), ('JP11'), ('JP12'), ('JP13')) x(name);
INSERT INTO rt.v3_ids SELECT x.name, ('c3f4' || substr(x.name, 3) || '00-0000-0000-0000-000000000000')::uuid
  FROM (VALUES ('JW01'), ('JW03'), ('JW11'), ('JW12'), ('JW13')) x(name);
INSERT INTO rt.v3_ids SELECT 'JC' || x.name, ('c3f50000-0000-0000-0000-0000000000' || lpad(x.n::text, 2, '0'))::uuid
  FROM (VALUES (1, '2a'), (2, '3a'), (3, '3b'), (4, '4u'), (5, '4b'), (6, '5u'), (7, '5b'), (8, '6b'), (9, '7u'), (10, '7b'),
               (11, '8n'), (12, '8b'), (13, '9i'), (14, '10v'), (15, '13b'), (16, '14b'), (17, 'N'), (18, '_LEG'), (19, '_FAIL'),
               (20, '_BUSY'), (21, '_45'), (22, '_46'), (23, '_NA100'), (24, '_Q10'), (25, '_REC'), (26, '_M1'), (27, '_M2'),
               (28, '_M3'), (29, '_D'), (30, '_CL'), (31, '_CP'), (32, '_LM'), (33, '_RAW'), (34, 'X')) x(n, name);

INSERT INTO public.organizations VALUES (rt.v3('J'), 'V3 Journey Agency'), (rt.v3('JX'), 'V3 Journey Other Agency');
INSERT INTO public.company_settings (company_name, timezone, organization_id) VALUES
  ('V3 Journey Agency', 'America/Los_Angeles', rt.v3('J')), ('V3 Journey Other Agency', 'America/Los_Angeles', rt.v3('JX'));
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status) VALUES
  (rt.v3('JA1'), rt.v3('J'), 'Jay', 'One', 'ja1@v3.invalid', 'Agent', 'Active'),
  (rt.v3('JA2'), rt.v3('J'), 'Jay', 'Two', 'ja2@v3.invalid', 'Agent', 'Active'),
  (rt.v3('JA3'), rt.v3('J'), 'Jay', 'Three', 'ja3@v3.invalid', 'Agent', 'Active'),
  (rt.v3('JA4'), rt.v3('J'), 'Jay', 'Four', 'ja4@v3.invalid', 'Agent', 'Active'),
  (rt.v3('JXA'), rt.v3('JX'), 'Jay', 'Other', 'jxa@v3.invalid', 'Agent', 'Active');
INSERT INTO public.dispositions (id, name, counts_as_contacted, organization_id) VALUES
  (rt.v3('JDNA'), 'No Answer', false, rt.v3('J')), (rt.v3('JDINT'), 'Interested', true, rt.v3('J')),
  (rt.v3('JDLM'), 'Left Message', false, rt.v3('J')), (rt.v3('JXINT'), 'Interested', true, rt.v3('JX'));
INSERT INTO public.campaigns (id, name, type, organization_id) VALUES (rt.v3('JCMP'), 'V3 Journey Campaign', 'Personal', rt.v3('J'));

-- Leads (JL11 and JL12 have no lead row: JK11 is hand-entered, JL12 was deleted after conversion).
INSERT INTO public.leads (id, phone, lead_source, created_at, organization_id)
SELECT rt.v3('JL' || n), '310-555-01' || lpad(n::text, 2, '0'), 'V3 Source', '2026-10-01 17:00+00', rt.v3('J')
  FROM generate_series(1, 23) n WHERE n NOT IN (11, 12, 15, 16, 17, 18, 19, 20);
INSERT INTO public.clients (id, organization_id, lead_id, phone, premium, created_at) VALUES
  (rt.v3('JK01'), rt.v3('J'), rt.v3('JL1'), '310-555-0101', 0, '2026-10-05 18:00+00'),
  (rt.v3('JK03'), rt.v3('J'), rt.v3('JL3'), '310-555-0103', 0, '2026-10-04 19:00+00'),
  (rt.v3('JK11'), rt.v3('J'), NULL, '310-555-0111', 0, '2026-10-12 18:00+00'),
  (rt.v3('JK12'), rt.v3('J'), rt.v3('JL12'), '310-555-0112', 0, '2026-10-13 18:00+00'),
  (rt.v3('JK13'), rt.v3('J'), rt.v3('JL13'), '310-555-0113', 0, '2026-10-02 18:00+00'),
  (rt.v3('JK23'), rt.v3('J'), rt.v3('JL23'), '310-555-0123', 0, '2026-09-01 18:00+00');
INSERT INTO public.campaign_leads (id, campaign_id, lead_id, phone, organization_id) VALUES
  (rt.v3('JCL1'), rt.v3('JCMP'), rt.v3('JL21'), '310-555-0121', rt.v3('J')),
  (rt.v3('JCL2'), rt.v3('JCMP'), NULL, '310-555-0122', rt.v3('J')),
  (rt.v3('JCL3'), rt.v3('JCMP'), NULL, '', rt.v3('J'));
INSERT INTO private.dialer_conversion_lineage VALUES (rt.v3('J'), rt.v3('JCL2'), rt.v3('JL22'));
INSERT INTO public.recruits (id, phone, organization_id) VALUES (rt.v3('JR1'), '310-555-0190', rt.v3('J'));
-- S6: the lead's own captured phone change (only changed_fields records it; old numbers are not kept).
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           changed_fields, recorded_at)
VALUES (rt.v3('J'), rt.v3('JL6'), 'lead', 'leads', rt.v3('JL6'), 'updated', 'agent', '{phone}', '2026-10-02 18:00+00');

-- Sales (first sales): S1 by JA4, S3, S11, S12 and S13 by JA1.
INSERT INTO private.policy_identities (policy_id, organization_id, client_id, source, legacy) VALUES
  (rt.v3('JP01'), rt.v3('J'), rt.v3('JK01'), 'primary', false), (rt.v3('JP03'), rt.v3('J'), rt.v3('JK03'), 'primary', false),
  (rt.v3('JP11'), rt.v3('J'), rt.v3('JK11'), 'primary', false), (rt.v3('JP12'), rt.v3('J'), rt.v3('JK12'), 'primary', false),
  (rt.v3('JP13'), rt.v3('J'), rt.v3('JK13'), 'primary', false);
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, policy_id, premium_snapshot, premium_amount, idempotency_key,
                         sold_date, created_at, recorded_at) VALUES
  (rt.v3('JW01'), rt.v3('J'), rt.v3('JA4'), rt.v3('JK01'), rt.v3('JP01'), true, 50.00, 'v3j:w1', '2026-10-05', '2026-10-05 18:00+00', '2026-10-05 18:00+00'),
  (rt.v3('JW03'), rt.v3('J'), rt.v3('JA1'), rt.v3('JK03'), rt.v3('JP03'), true, 80.00, 'v3j:w3', '2026-10-04', '2026-10-04 19:00+00', '2026-10-04 19:00+00'),
  (rt.v3('JW11'), rt.v3('J'), rt.v3('JA1'), rt.v3('JK11'), rt.v3('JP11'), true, 60.00, 'v3j:w11', '2026-10-12', '2026-10-12 18:00+00', '2026-10-12 18:00+00'),
  (rt.v3('JW12'), rt.v3('J'), rt.v3('JA1'), rt.v3('JK12'), rt.v3('JP12'), true, 70.00, 'v3j:w12', '2026-10-13', '2026-10-13 18:00+00', '2026-10-13 18:00+00'),
  (rt.v3('JW13'), rt.v3('J'), rt.v3('JA1'), rt.v3('JK13'), rt.v3('JP13'), true, 90.00, 'v3j:w13', '2026-10-02', '2026-10-02 18:00+00', '2026-10-02 18:00+00');

-- Calls. adm: 't' admitted, 'f' refused (non-attempt), NULL no admission row. req: dialer_admission_required.
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, campaign_lead_id,
                          created_at, duration, disposition_id, disposition_name, status, dialer_admission_required, voicemail_id)
SELECT rt.v3(c.name), rt.v3(c.org), rt.v3(c.agent), c.dir, rt.v3(c.contact), c.ctype, c.phone, rt.v3(c.member),
       c.at::timestamptz, c.dur, rt.v3(c.disp), d.name, c.status, c.req, rt.v3(c.vm)
  FROM (VALUES
    ('JC2a', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-03 18:00+00', 120, 'JDINT', 'completed', true, NULL),
    ('JC3a', 'J', 'JA1', 'outbound', 'JL3', 'lead', '310-555-0103', NULL, '2026-10-02 18:00+00', 20, 'JDNA', 'no-answer', true, NULL),
    ('JC3b', 'J', 'JA1', 'outbound', 'JL3', 'lead', '310-555-0103', NULL, '2026-10-04 18:00+00', 300, 'JDINT', 'completed', true, NULL),
    ('JC4u', 'J', 'JA3', 'outbound', NULL, NULL, '(310) 555-0104', NULL, '2026-10-02 18:00+00', 0, 'JDNA', 'no-answer', true, NULL),
    ('JC4b', 'J', 'JA1', 'outbound', 'JL4', 'lead', '310-555-0104', NULL, '2026-10-06 18:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JC5u', 'J', 'JA3', 'outbound', NULL, NULL, '310.555.0105', NULL, '2026-10-02 19:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JC5b', 'J', 'JA1', 'outbound', 'JL5', 'lead', '310-555-0105', NULL, '2026-10-07 18:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JC6b', 'J', 'JA1', 'outbound', 'JL6', 'lead', '310-555-0106', NULL, '2026-10-08 18:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JC7u', 'J', 'JA1', 'outbound', 'JL7', 'lead', '310-555-0107', NULL, '2026-10-02 20:00+00', 0, NULL, NULL, true, NULL),
    ('JC7b', 'J', 'JA1', 'outbound', 'JL7', 'lead', '310-555-0107', NULL, '2026-10-09 18:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JC8n', 'J', 'JA2', 'outbound', 'JL8', 'lead', '310-555-0108', NULL, '2026-10-02 21:00+00', 0, NULL, NULL, true, NULL),
    ('JC8b', 'J', 'JA2', 'outbound', 'JL8', 'lead', '310-555-0108', NULL, '2026-10-10 18:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JC9i', 'J', 'JA1', 'inbound', 'JL9', 'lead', '310-555-0109', NULL, '2026-10-11 18:00+00', 120, 'JDINT', 'completed', false, NULL),
    ('JC10v', 'J', NULL, 'inbound', 'JL10', 'lead', '310-555-0110', NULL, '2026-10-12 18:00+00', 30, NULL, 'completed', false, 'JVM'),
    ('JC13b', 'J', 'JA1', 'outbound', 'JL13', 'lead', '310-555-0113', NULL, '2026-10-14 18:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JC14b', 'J', 'JA3', 'outbound', 'JL14', 'lead', '310-555-0114', NULL, '2026-10-05 18:00+00', 90, 'JDINT', 'completed', true, NULL),
    ('JCN', 'J', 'JA3', 'outbound', NULL, NULL, NULL, NULL, '2026-10-03 19:00+00', 60, 'JDINT', 'completed', true, NULL),
    ('JC_LEG', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-15 18:00+00', 30, 'JDLM', 'completed', false, NULL),
    ('JC_FAIL', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-16 18:00+00', 0, NULL, 'failed', true, NULL),
    ('JC_BUSY', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-16 19:00+00', 0, NULL, 'busy', true, NULL),
    ('JC_45', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-17 18:00+00', 45, NULL, 'completed', true, NULL),
    ('JC_46', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-17 19:00+00', 46, NULL, 'completed', true, NULL),
    ('JC_NA100', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-17 20:00+00', 100, 'JDNA', 'completed', true, NULL),
    ('JC_Q10', 'J', 'JA1', 'outbound', 'JL2', 'lead', '310-555-0102', NULL, '2026-10-17 21:00+00', 10, 'JDINT', 'completed', true, NULL),
    ('JC_REC', 'J', 'JA1', 'outbound', 'JR1', 'recruit', '310-555-0190', NULL, '2026-10-18 18:00+00', 120, 'JDINT', 'completed', true, NULL),
    ('JC_M1', 'J', 'JA2', 'outbound', NULL, NULL, '310-555-0121', 'JCL1', '2026-09-10 18:00+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JC_M2', 'J', 'JA2', 'outbound', NULL, NULL, '310-555-0122', 'JCL2', '2026-09-10 18:10+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JC_M3', 'J', 'JA2', 'outbound', NULL, NULL, '310-555-0124', 'JCL3', '2026-09-10 18:20+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JC_D', 'J', 'JA2', 'outbound', 'JDANGLE', 'lead', '310-555-0198', NULL, '2026-09-10 18:30+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JC_CL', 'J', 'JA2', 'outbound', 'JK23', 'client', '310-555-0123', NULL, '2026-09-10 18:40+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JC_CP', 'J', 'JA2', 'outbound', 'JL12', 'lead', '310-555-0112', NULL, '2026-09-10 18:50+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JC_LM', 'J', 'JA2', 'outbound', 'JCL1', NULL, '310-555-0121', NULL, '2026-09-10 19:00+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JC_RAW', 'J', 'JA2', 'outbound', NULL, NULL, '310-555-0199', NULL, '2026-09-10 19:10+00', 10, 'JDNA', 'no-answer', false, NULL),
    ('JCX', 'JX', 'JXA', 'outbound', NULL, NULL, '310-555-0102', NULL, '2026-10-03 18:00+00', 90, 'JXINT', 'completed', false, NULL))
    AS c(name, org, agent, dir, contact, ctype, phone, member, at, dur, disp, status, req, vm)
  LEFT JOIN public.dispositions d ON d.id = rt.v3(c.disp);
INSERT INTO private.dialer_outbound_admissions (organization_id, call_id, parent_sid, destination, admitted, reason)
SELECT rt.v3('J'), rt.v3(a.name), 'PS-' || a.name, '+13105550000', a.admitted, CASE WHEN NOT a.admitted THEN 'dnc' END
  FROM (VALUES ('JC2a', true), ('JC3a', true), ('JC3b', true), ('JC4u', true), ('JC4b', true), ('JC5u', true), ('JC5b', true),
               ('JC6b', true), ('JC7b', true), ('JC8n', false), ('JC8b', true), ('JC13b', true), ('JC14b', true), ('JCN', true),
               ('JC_FAIL', true), ('JC_BUSY', true), ('JC_45', true), ('JC_46', true), ('JC_NA100', true), ('JC_Q10', true),
               ('JC_REC', true)) AS a(name, admitted);
