-- =====================================================================================================
-- Reports v3 synthetic fixtures (plan D1 §9). Disposable synthetic databases only, through
-- scripts/run_reports_v3_tests.sh. Synthetic tenants, users, clients and sales; no real record. Every
-- expected value in the v3 suites is computed by hand from the tables below.
--
--   O1 'V3 Pacific Agency'      America/Los_Angeles   ADM1 (Admin), TL1 (Team Leader), A1 and A2 (Agents
--                                                     under TL1), A3 (Agent, no upline)
--   O2 'V3 Eastern Agency'      America/New_York      B1 (Agent); cross-organization rows
--   O3 'V3 Unconfigured Agency' no company settings
--   O4 'V3 Havana Agency'       America/Havana
--
-- O1 sales (wins). Premium: S = snapshot sale (premium_snapshot true), L = legacy sale event.
--   win  policy client seller snap amount  sold_date   notes                                   expected
--   W1   P1     C1     A1     S    100.00  2026-10-02  C1 now assigned to A3 (credit stays A1)  100.00 known
--   W2   P2     C2     A1     S      0     2026-10-03                                          0 known ($0)
--   W3   P3     C3     A2     S    NULL    2026-10-03                                          missing
--   W4   P4     C4     A2     S     -5     2026-10-04                                          invalid
--   W5   P5     C5     A1     L     50.25  2026-10-05                                          50.25 legacy event
--   W6   P6     C6     A3     L      0     2026-10-05  client premium 80.50                     80.50 fallback
--   W7   P7     C7     A3     L      0     2026-10-06  additional identity (client 90)          missing, none
--   W8   P8     C8     A3     L      0     2026-10-06  ':policy:2' key (client 70)              missing, none
--   W9   P9     C9     —      S     40.00  2026-10-07  unattributed (agency scope only)         40.00 known
--   W10  P10    C10    A1     S     25.00  2026-10-08  client record deleted                    25.00 known
--   W11  —      C11    A1     S     30.00  2026-10-08  no policy identity: excluded
--   W12  P12    C11    A1     S     30.00  —           undated: excluded
--   W13  P13    C13    A2     S     10.00  2026-10-09  recorded_at NULL (falls back to created_at)
--   W14  P14    C14    A2     S     20.00  2026-10-31  last day of October
--   W15  P15    C15    A2     S     15.00  2026-11-01  outside October (half-open window)
--   W16  P16    C16    A1     S     60.00  2026-10-10  recorded 2026-11-20 (after the suite's as_of)
--   W17  P17    C1     A2     S     12.34  2026-10-12  second policy for buyer C1 (additional)
--   P18 (client C18) is a stored policy identity with no sale.
-- O2: WB1 (PB1, CB1, B1, snapshot 500.00, 2026-10-02).
-- =====================================================================================================

CREATE TABLE rt.v3_ids (name text PRIMARY KEY, id uuid NOT NULL UNIQUE);
INSERT INTO rt.v3_ids VALUES
  ('O1', 'c3000000-0000-0000-0000-000000000001'), ('O2', 'c3000000-0000-0000-0000-000000000002'),
  ('O3', 'c3000000-0000-0000-0000-000000000003'), ('O4', 'c3000000-0000-0000-0000-000000000004'),
  ('ADM1', 'c3a00000-0000-0000-0000-000000000001'), ('TL1', 'c3a00000-0000-0000-0000-000000000002'),
  ('A1', 'c3a00000-0000-0000-0000-000000000003'), ('A2', 'c3a00000-0000-0000-0000-000000000004'),
  ('A3', 'c3a00000-0000-0000-0000-000000000005'), ('B1', 'c3b00000-0000-0000-0000-000000000001'),
  ('CB1', 'c3c20000-0000-0000-0000-000000000001'), ('PB1', 'c3d20000-0000-0000-0000-000000000001'),
  ('WB1', 'c3e20000-0000-0000-0000-000000000001');
INSERT INTO rt.v3_ids SELECT 'C' || n, ('c3c00000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 18) n;
INSERT INTO rt.v3_ids SELECT 'P' || n, ('c3d00000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 18) n;
INSERT INTO rt.v3_ids SELECT 'W' || n, ('c3e00000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 17) n;
CREATE FUNCTION rt.v3(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM rt.v3_ids WHERE name = p $$;

INSERT INTO public.organizations VALUES
  (rt.v3('O1'), 'V3 Pacific Agency'), (rt.v3('O2'), 'V3 Eastern Agency'),
  (rt.v3('O3'), 'V3 Unconfigured Agency'), (rt.v3('O4'), 'V3 Havana Agency');
INSERT INTO public.company_settings (company_name, timezone, organization_id) VALUES
  ('V3 Pacific Agency', 'America/Los_Angeles', rt.v3('O1')),
  ('V3 Eastern Agency', 'America/New_York', rt.v3('O2')),
  ('V3 Havana Agency', 'America/Havana', rt.v3('O4'));
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status, upline_id) VALUES
  (rt.v3('ADM1'), rt.v3('O1'), 'Vee', 'Admin', 'adm1@v3.invalid', 'Admin', 'Active', NULL),
  (rt.v3('TL1'), rt.v3('O1'), 'Vee', 'Leader', 'tl1@v3.invalid', 'Team Leader', 'Active', NULL),
  (rt.v3('A1'), rt.v3('O1'), 'Vee', 'Agent One', 'a1@v3.invalid', 'Agent', 'Active', rt.v3('TL1')),
  (rt.v3('A2'), rt.v3('O1'), 'Vee', 'Agent Two', 'a2@v3.invalid', 'Agent', 'Active', rt.v3('TL1')),
  (rt.v3('A3'), rt.v3('O1'), 'Vee', 'Agent Three', 'a3@v3.invalid', 'Agent', 'Active', NULL),
  (rt.v3('B1'), rt.v3('O2'), 'Vee', 'Eastern Agent', 'b1@v3.invalid', 'Agent', 'Active', NULL);

-- O1 clients (C10 is deliberately absent: its record was deleted after the sale; C12 and C17 are unused).
INSERT INTO public.clients (id, organization_id, premium, assigned_agent_id)
SELECT rt.v3(c.name), rt.v3('O1'), c.premium, rt.v3(c.agent)
  FROM (VALUES ('C1', 100, 'A3'), ('C2', 0, 'A1'), ('C3', 0, 'A2'), ('C4', 0, 'A2'), ('C5', 0, 'A1'),
               ('C6', 80.50, 'A3'), ('C7', 90, 'A3'), ('C8', 70, 'A3'), ('C9', 0, NULL), ('C11', 0, 'A1'),
               ('C13', 0, 'A2'), ('C14', 0, 'A2'), ('C15', 0, 'A2'), ('C16', 0, 'A1'), ('C18', 0, 'A1'))
       AS c(name, premium, agent);
INSERT INTO public.clients (id, organization_id, premium, assigned_agent_id) VALUES (rt.v3('CB1'), rt.v3('O2'), 500, rt.v3('B1'));

INSERT INTO private.policy_identities (policy_id, organization_id, client_id, source, legacy)
SELECT rt.v3(p.policy), rt.v3('O1'), rt.v3(p.client), p.source, false
  FROM (VALUES ('P1', 'C1', 'primary'), ('P2', 'C2', 'primary'), ('P3', 'C3', 'primary'), ('P4', 'C4', 'primary'),
               ('P5', 'C5', 'primary'), ('P6', 'C6', 'primary'), ('P7', 'C7', 'additional'), ('P8', 'C8', 'primary'),
               ('P9', 'C9', 'primary'), ('P10', 'C10', 'primary'), ('P12', 'C11', 'primary'), ('P13', 'C13', 'primary'),
               ('P14', 'C14', 'primary'), ('P15', 'C15', 'primary'), ('P16', 'C16', 'primary'), ('P17', 'C1', 'additional'),
               ('P18', 'C18', 'primary'))
       AS p(policy, client, source);
INSERT INTO private.policy_identities (policy_id, organization_id, client_id, source, legacy)
VALUES (rt.v3('PB1'), rt.v3('O2'), rt.v3('CB1'), 'primary', false);

INSERT INTO public.wins (id, organization_id, agent_id, contact_id, policy_id, premium_snapshot, premium_amount,
                         idempotency_key, sold_date, created_at, recorded_at)
SELECT rt.v3(w.win), rt.v3('O1'), rt.v3(w.seller), rt.v3(w.client), rt.v3(w.policy), w.snap, w.amount, w.key,
       w.sold::date, w.created::timestamptz, w.recorded::timestamptz
  FROM (VALUES
    ('W1', 'A1', 'C1', 'P1', true, 100.00, 'v3:w1', '2026-10-02', '2026-10-02 18:00+00', '2026-10-02 18:00+00'),
    ('W2', 'A1', 'C2', 'P2', true, 0, 'v3:w2', '2026-10-03', '2026-10-03 18:00+00', '2026-10-03 18:00+00'),
    ('W3', 'A2', 'C3', 'P3', true, NULL, 'v3:w3', '2026-10-03', '2026-10-03 19:00+00', '2026-10-03 19:00+00'),
    ('W4', 'A2', 'C4', 'P4', true, -5, 'v3:w4', '2026-10-04', '2026-10-04 18:00+00', '2026-10-04 18:00+00'),
    ('W5', 'A1', 'C5', 'P5', false, 50.25, 'v3:w5', '2026-10-05', '2026-10-05 18:00+00', '2026-10-05 18:00+00'),
    ('W6', 'A3', 'C6', 'P6', false, 0, 'v3:w6', '2026-10-05', '2026-10-05 19:00+00', '2026-10-05 19:00+00'),
    ('W7', 'A3', 'C7', 'P7', false, 0, 'v3:w7', '2026-10-06', '2026-10-06 18:00+00', '2026-10-06 18:00+00'),
    ('W8', 'A3', 'C8', 'P8', false, 0, 'v3:client:policy:2', '2026-10-06', '2026-10-06 19:00+00', '2026-10-06 19:00+00'),
    ('W9', NULL, 'C9', 'P9', true, 40.00, 'v3:w9', '2026-10-07', '2026-10-07 18:00+00', '2026-10-07 18:00+00'),
    ('W10', 'A1', 'C10', 'P10', true, 25.00, 'v3:w10', '2026-10-08', '2026-10-08 18:00+00', '2026-10-08 18:00+00'),
    ('W11', 'A1', 'C11', NULL, true, 30.00, 'v3:w11', '2026-10-08', '2026-10-08 19:00+00', '2026-10-08 19:00+00'),
    ('W12', 'A1', 'C11', 'P12', true, 30.00, 'v3:w12', NULL, '2026-10-08 20:00+00', '2026-10-08 20:00+00'),
    ('W13', 'A2', 'C13', 'P13', true, 10.00, 'v3:w13', '2026-10-09', '2026-10-09 15:00+00', NULL),
    ('W14', 'A2', 'C14', 'P14', true, 20.00, 'v3:w14', '2026-10-31', '2026-10-31 18:00+00', '2026-10-31 18:00+00'),
    ('W15', 'A2', 'C15', 'P15', true, 15.00, 'v3:w15', '2026-11-01', '2026-11-01 18:00+00', '2026-11-01 18:00+00'),
    ('W16', 'A1', 'C16', 'P16', true, 60.00, 'v3:w16', '2026-10-10', '2026-10-10 18:00+00', '2026-11-20 00:00+00'),
    ('W17', 'A2', 'C1', 'P17', true, 12.34, 'v3:w17', '2026-10-12', '2026-10-12 18:00+00', '2026-10-12 18:00+00'))
    AS w(win, seller, client, policy, snap, amount, key, sold, created, recorded);
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, policy_id, premium_snapshot, premium_amount,
                         idempotency_key, sold_date, created_at, recorded_at)
VALUES (rt.v3('WB1'), rt.v3('O2'), rt.v3('B1'), rt.v3('CB1'), rt.v3('PB1'), true, 500.00, 'v3:wb1', '2026-10-02',
        '2026-10-02 18:00+00', '2026-10-02 18:00+00');

-- =====================================================================================================
-- Reader fixtures (PKG-A Batch 5; plan D1 §11, D3 §7). O1 personas: ADM1 (Admin), TL1 (Team Leader; team =
-- TL1, A1, A2), A1 and A2 (Agents), A3 (Agent outside the team). Agents see their own Personal campaigns,
-- Team campaigns they are assigned to and Open campaigns; Admins and Team Leaders see every campaign.
--   campaigns  KP1 Personal (A1)   KT12 Team [A1, A2]   KO Open Pool   KH3 Personal (A3)   KT3 Team [A3]
--   leads      RL1 Facebook A1 CA    RL2 Facebook A1 TX     RL3 Referral A2 NV   RL4 (no source) A2 blank
--              RL5 Referral A3 AZ    RL6 Facebook A3 XX (Sep)   RL7 Web unassigned FL   RL8 Web A1 GA
--   RM1/RM2 put RL1 in two campaigns (KP1, KT12); RM6 is RL4 in KT3 with an OR copy (RL4 itself is blank).
-- October 2026 calls (America/Los_Angeles; PDT = UTC-7):
--   call   agent dir  contact camp  sec  outcome         class        notes
--   RC0    A2    out  RL3     KT12  10   No Answer       attempt      exactly Oct 1 00:00 PDT (window start)
--   RC0B   A2    out  RL3     KT12  10   No Answer       attempt      exactly Nov 1 00:00 PDT (outside October)
--   RC1    A1    out  RL1     KP1   60   Interested      attempt      provider
--   RC2    A1    out  RL1     KT12  20   No Answer       attempt      terminal_non_answer; RL1's second membership
--   RC3    A1    out  RL4     KT3   50   Interested      attempt      admitted; elapsed_estimate; KT3 hidden from A1
--   RC4    A1    out  —       —      0   (none)          attempt      admitted, failed, duration unknown
--   RC5    A1    out  RL2     KO     0   —               non_attempt  admission refused
--   RC6    A1    out  RL2     KO     0   —               unverified   admission required, none recorded
--   RC7    A2    out  RL3     KT12 300   Sold            attempt      provider, duration_conflict
--   RC8    A2    out  RL3     KT12  90   Not Interested  attempt      provider
--   RC9    A3    out  RL5     KH3  120   Interested      attempt      provider
--   RC10   A3    out  RR1     —     30   No Answer       attempt      a recruit
--   RC11   A2    in   RL3     —    200   —               inbound      answered by A2
--   RC12   —     in   —       —      0   —               inbound      voicemail, no agent (agency only)
--   RC13   A1    out  RL1     KP1   45   No Answer       attempt      exactly 45 s
--   RC14   A1    out  RL1     KP1   45   No Answer       duplicate    reviewed duplicate of RC13
-- DST day 2026-03-08 (spring forward at 02:00 PST): RC15 01:59 PST 30 s, RC16 03:00 PDT 70 s Interested;
-- RC15X 23:59 PST Mar 7 and RC16X 00:30 PDT Mar 9 fall outside that day.
-- Sessions: RS1A 15:30–17:30Z and RS1B 17:00–18:00Z Oct 5 (A1, overlapping: 9000 s); RS2A Sep 30 23:00Z to
-- Oct 1 09:00Z (A2: 7200 s inside October); RS2B active, stale since Oct 8 21:00Z (A2: capped, 3600 s);
-- RS3A ended 2.5 h after its last heartbeat (A3: late-ended, 10800 s); RS1C 2026-03-08 09:00–11:00Z (A1, DST
-- day: 7200 s). O2 has its own campaign, call and session, which O1 never reads.
-- =====================================================================================================
INSERT INTO rt.v3_ids VALUES
  ('KP1', 'c3a70000-0000-0000-0000-000000000001'), ('KT12', 'c3a70000-0000-0000-0000-000000000002'),
  ('KO', 'c3a70000-0000-0000-0000-000000000003'), ('KH3', 'c3a70000-0000-0000-0000-000000000004'),
  ('KT3', 'c3a70000-0000-0000-0000-000000000005'), ('KX', 'c3a70000-0000-0000-0000-000000000009'),
  ('RD_NA', 'c3a71000-0000-0000-0000-000000000001'), ('RD_INT', 'c3a71000-0000-0000-0000-000000000002'),
  ('RD_SOLD', 'c3a71000-0000-0000-0000-000000000003'), ('RD_NI', 'c3a71000-0000-0000-0000-000000000004'),
  ('RPS_WON', 'c3a71000-0000-0000-0000-000000000009'), ('RR1', 'c3a72000-0000-0000-0000-000000000001'),
  ('RXL1', 'c3a73000-0000-0000-0000-000000000099'), ('RCX1', 'c3a75000-0000-0000-0000-000000000099'),
  ('RSX1', 'c3a76000-0000-0000-0000-000000000099');
INSERT INTO rt.v3_ids SELECT 'RL' || n, ('c3a73000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 8) n;
INSERT INTO rt.v3_ids SELECT 'RM' || n, ('c3a74000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 6) n;
INSERT INTO rt.v3_ids SELECT x.name, ('c3a75000-0000-0000-0000-0000000000' || lpad(x.n::text, 2, '0'))::uuid
  FROM (VALUES (1, 'RC0'), (2, 'RC0B'), (3, 'RC1'), (4, 'RC2'), (5, 'RC3'), (6, 'RC4'), (7, 'RC5'), (8, 'RC6'), (9, 'RC7'),
               (10, 'RC8'), (11, 'RC9'), (12, 'RC10'), (13, 'RC11'), (14, 'RC12'), (15, 'RC13'), (16, 'RC14'), (17, 'RC15'),
               (18, 'RC16'), (19, 'RC15X'), (20, 'RC16X')) x(n, name);
INSERT INTO rt.v3_ids SELECT x.name, ('c3a76000-0000-0000-0000-0000000000' || lpad(x.n::text, 2, '0'))::uuid
  FROM (VALUES (1, 'RS1A'), (2, 'RS1B'), (3, 'RS2A'), (4, 'RS2B'), (5, 'RS3A'), (6, 'RS1C')) x(n, name);

-- Production-shaped Reports permissions (the v2 harness helper): Agent own only; Team Leader own and team.
INSERT INTO public.role_permissions (organization_id, role, permissions) VALUES
  (rt.v3('O1'), 'Agent', rt.perm(true, true, false, 'own', true, true, true, 'team')),
  (rt.v3('O1'), 'Team Leader', rt.perm(true, true, false, 'own', true, true, true, 'team'));

-- Recorded states of the O1 buyers (C10 has no record; C7 is blank).
UPDATE public.clients c SET state = x.state
  FROM (VALUES ('C1', 'CA'), ('C2', 'TX'), ('C3', 'California'), ('C4', 'XX'), ('C5', 'PR'), ('C6', 'NV'), ('C7', ''),
               ('C8', 'AZ'), ('C9', 'TX'), ('C13', 'FL'), ('C14', 'FL'), ('C15', 'FL'), ('C16', 'CA')) x(name, state)
 WHERE c.id = rt.v3(x.name);

INSERT INTO public.campaigns (id, name, type, user_id, assigned_agent_ids, organization_id) VALUES
  (rt.v3('KP1'), 'V3 A1 Personal', 'Personal', rt.v3('A1'), '[]', rt.v3('O1')),
  (rt.v3('KT12'), 'V3 Team One', 'Team', NULL, jsonb_build_array(rt.v3('A1'), rt.v3('A2')), rt.v3('O1')),
  (rt.v3('KO'), 'V3 Open Pool', 'Open Pool', NULL, '[]', rt.v3('O1')),
  (rt.v3('KH3'), 'V3 A3 Personal', 'Personal', rt.v3('A3'), '[]', rt.v3('O1')),
  (rt.v3('KT3'), 'V3 Team Three', 'Team', NULL, jsonb_build_array(rt.v3('A3')), rt.v3('O1')),
  (rt.v3('KX'), 'V3 Eastern Campaign', 'Open Pool', NULL, '[]', rt.v3('O2'));
INSERT INTO public.pipeline_stages (id, name, convert_to_client, organization_id) VALUES (rt.v3('RPS_WON'), 'Won', true, rt.v3('O1'));
INSERT INTO public.dispositions (id, name, color, counts_as_contacted, pipeline_stage_id, organization_id) VALUES
  (rt.v3('RD_NA'), 'No Answer', '#6B7280', false, NULL, rt.v3('O1')),
  (rt.v3('RD_INT'), 'Interested', '#10B981', true, NULL, rt.v3('O1')),
  (rt.v3('RD_SOLD'), 'Sold', '#22C55E', true, rt.v3('RPS_WON'), rt.v3('O1')),
  (rt.v3('RD_NI'), 'Not Interested', '#EF4444', false, NULL, rt.v3('O1'));
INSERT INTO public.leads (id, phone, lead_source, assigned_agent_id, created_at, state, organization_id)
SELECT rt.v3(x.name), x.phone, x.src, rt.v3(x.agent), x.at::timestamptz, x.state, rt.v3(x.org)
  FROM (VALUES ('RL1', '702-555-0101', 'Facebook', 'A1', '2026-10-02 17:00+00', 'CA', 'O1'),
               ('RL2', '702-555-0102', 'Facebook', 'A1', '2026-10-03 17:00+00', 'TX', 'O1'),
               ('RL3', '702-555-0103', 'Referral', 'A2', '2026-10-04 17:00+00', 'NV', 'O1'),
               ('RL4', '702-555-0104', '', 'A2', '2026-10-05 17:00+00', '', 'O1'),
               ('RL5', '702-555-0105', 'Referral', 'A3', '2026-10-06 17:00+00', 'AZ', 'O1'),
               ('RL6', '702-555-0106', 'Facebook', 'A3', '2026-09-20 17:00+00', 'XX', 'O1'),
               ('RL7', '702-555-0107', 'Web', NULL, '2026-10-07 17:00+00', 'FL', 'O1'),
               ('RL8', '702-555-0108', 'Web', 'A1', '2026-10-08 17:00+00', 'GA', 'O1'),
               ('RXL1', '212-555-0199', 'Facebook', 'B1', '2026-10-02 17:00+00', 'NY', 'O2')) x(name, phone, src, agent, at, state, org);
INSERT INTO public.campaign_leads (id, campaign_id, lead_id, phone, state, organization_id)
SELECT rt.v3(x.name), rt.v3(x.cmp), rt.v3(x.lead), x.phone, x.state, rt.v3('O1')
  FROM (VALUES ('RM1', 'KP1', 'RL1', '702-555-0101', 'CA'), ('RM2', 'KT12', 'RL1', '702-555-0101', 'CA'),
               ('RM3', 'KT12', 'RL3', '702-555-0103', 'NV'), ('RM4', 'KO', 'RL2', '702-555-0102', 'TX'),
               ('RM5', 'KH3', 'RL5', '702-555-0105', 'AZ'), ('RM6', 'KT3', 'RL4', '702-555-0104', 'OR')) x(name, cmp, lead, phone, state);
INSERT INTO public.recruits (id, phone, state, organization_id) VALUES (rt.v3('RR1'), '702-555-0190', 'NV', rt.v3('O1'));

INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, campaign_id,
                          campaign_lead_id, created_at, duration, disposition_id, disposition_name, status,
                          dialer_admission_required, duration_source, duration_conflict, answered_by_agent_id, voicemail_id)
SELECT rt.v3(c.name), rt.v3(c.org), rt.v3(c.agent), c.dir, rt.v3(c.contact), c.ctype, c.phone, rt.v3(c.cmp), rt.v3(c.member),
       c.at::timestamptz, c.dur, rt.v3(c.disp), d.name, c.status, c.req, c.src, c.conflict, rt.v3(c.answered),
       CASE WHEN c.vm THEN gen_random_uuid() END
  FROM (VALUES
    ('RC0', 'O1', 'A2', 'outbound', 'RL3', 'lead', '702-555-0103', 'KT12', 'RM3', '2026-10-01 07:00:00+00', 10, 'RD_NA', 'no-answer', false, 'legacy_unknown', false, NULL, false),
    ('RC0B', 'O1', 'A2', 'outbound', 'RL3', 'lead', '702-555-0103', 'KT12', 'RM3', '2026-11-01 07:00:00+00', 10, 'RD_NA', 'no-answer', false, 'legacy_unknown', false, NULL, false),
    ('RC1', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KP1', 'RM1', '2026-10-05 16:00+00', 60, 'RD_INT', 'completed', false, 'provider', false, NULL, false),
    ('RC2', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KT12', 'RM2', '2026-10-05 17:00+00', 20, 'RD_NA', 'no-answer', false, 'terminal_non_answer', false, NULL, false),
    ('RC3', 'O1', 'A1', 'outbound', 'RL4', 'lead', '702-555-0104', 'KT3', 'RM6', '2026-10-06 16:30+00', 50, 'RD_INT', 'completed', true, 'elapsed_estimate', false, NULL, false),
    ('RC4', 'O1', 'A1', 'outbound', NULL, NULL, '702-555-0177', NULL, NULL, '2026-10-06 18:00+00', NULL, NULL, 'failed', true, 'legacy_unknown', false, NULL, false),
    ('RC5', 'O1', 'A1', 'outbound', 'RL2', 'lead', '702-555-0102', 'KO', 'RM4', '2026-10-07 20:00+00', 0, NULL, 'busy', true, 'legacy_unknown', false, NULL, false),
    ('RC6', 'O1', 'A1', 'outbound', 'RL2', 'lead', '702-555-0102', 'KO', 'RM4', '2026-10-07 20:05+00', 0, NULL, 'initiated', true, 'legacy_unknown', false, NULL, false),
    ('RC7', 'O1', 'A2', 'outbound', 'RL3', 'lead', '702-555-0103', 'KT12', 'RM3', '2026-10-08 22:00+00', 300, 'RD_SOLD', 'completed', false, 'provider', true, NULL, false),
    ('RC8', 'O1', 'A2', 'outbound', 'RL3', 'lead', '702-555-0103', 'KT12', 'RM3', '2026-10-08 22:30+00', 90, 'RD_NI', 'completed', false, 'provider', false, NULL, false),
    ('RC9', 'O1', 'A3', 'outbound', 'RL5', 'lead', '702-555-0105', 'KH3', 'RM5', '2026-10-09 16:00+00', 120, 'RD_INT', 'completed', false, 'provider', false, NULL, false),
    ('RC10', 'O1', 'A3', 'outbound', 'RR1', 'recruit', '702-555-0190', NULL, NULL, '2026-10-09 17:00+00', 30, 'RD_NA', 'completed', false, 'legacy_unknown', false, NULL, false),
    ('RC11', 'O1', 'A2', 'inbound', 'RL3', 'lead', '702-555-0103', NULL, NULL, '2026-10-10 18:00+00', 200, NULL, 'completed', false, 'provider', false, 'A2', false),
    ('RC12', 'O1', NULL, 'inbound', NULL, NULL, '702-555-0166', NULL, NULL, '2026-10-10 19:00+00', 0, NULL, 'completed', false, 'legacy_unknown', false, NULL, true),
    ('RC13', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KP1', 'RM1', '2026-10-12 16:00:00+00', 45, 'RD_NA', 'completed', false, 'legacy_unknown', false, NULL, false),
    ('RC14', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KP1', 'RM1', '2026-10-12 16:00:05+00', 45, 'RD_NA', 'completed', false, 'legacy_unknown', false, NULL, false),
    ('RC15', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KP1', 'RM1', '2026-03-08 09:59+00', 30, 'RD_NA', 'completed', false, 'provider', false, NULL, false),
    ('RC16', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KP1', 'RM1', '2026-03-08 10:00+00', 70, 'RD_INT', 'completed', false, 'provider', false, NULL, false),
    ('RC15X', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KP1', 'RM1', '2026-03-08 07:59+00', 30, 'RD_NA', 'completed', false, 'provider', false, NULL, false),
    ('RC16X', 'O1', 'A1', 'outbound', 'RL1', 'lead', '702-555-0101', 'KP1', 'RM1', '2026-03-09 07:30+00', 30, 'RD_NA', 'completed', false, 'provider', false, NULL, false),
    ('RCX1', 'O2', 'B1', 'outbound', 'RXL1', 'lead', '212-555-0199', 'KX', NULL, '2026-10-05 16:00+00', 100, NULL, 'completed', false, 'provider', false, NULL, false))
    AS c(name, org, agent, dir, contact, ctype, phone, cmp, member, at, dur, disp, status, req, src, conflict, answered, vm)
  LEFT JOIN public.dispositions d ON d.id = rt.v3(c.disp);
INSERT INTO private.dialer_outbound_admissions (organization_id, call_id, parent_sid, destination, admitted, reason, created_at)
SELECT rt.v3('O1'), rt.v3(x.call), x.sid, '+17025550100', x.admitted, x.reason, x.at::timestamptz
  FROM (VALUES ('RC3', 'CAv3reader000000000000000000000003', true, NULL, '2026-10-06 16:30+00'),
               ('RC4', 'CAv3reader000000000000000000000004', true, NULL, '2026-10-06 18:00+00'),
               ('RC5', 'CAv3reader000000000000000000000005', false, 'lock_lost', '2026-10-07 20:00+00')) x(call, sid, admitted, reason, at);
INSERT INTO private.performance_duplicate_rows (organization_id, kind, duplicate_id, canonical_id, evidence_hash)
VALUES (rt.v3('O1'), 'call', rt.v3('RC14'), rt.v3('RC13'), 'v3-reader-duplicate');

INSERT INTO public.dialer_sessions (id, agent_id, campaign_id, started_at, ended_at, last_heartbeat_at, status, organization_id)
SELECT rt.v3(s.name), rt.v3(s.agent), rt.v3(s.cmp), s.started::timestamptz, s.ended::timestamptz, s.beat::timestamptz, s.status, rt.v3(s.org)
  FROM (VALUES ('RS1A', 'A1', 'KP1', '2026-10-05 15:30+00', '2026-10-05 17:30+00', '2026-10-05 17:29+00', 'ended', 'O1'),
               ('RS1B', 'A1', 'KT12', '2026-10-05 17:00+00', '2026-10-05 18:00+00', '2026-10-05 17:59+00', 'ended', 'O1'),
               ('RS2A', 'A2', 'KT12', '2026-09-30 23:00+00', '2026-10-01 09:00+00', '2026-10-01 08:59+00', 'ended', 'O1'),
               ('RS2B', 'A2', 'KT12', '2026-10-08 20:00+00', NULL, '2026-10-08 21:00+00', 'active', 'O1'),
               ('RS3A', 'A3', 'KH3', '2026-10-09 15:00+00', '2026-10-09 18:00+00', '2026-10-09 15:30+00', 'ended', 'O1'),
               ('RS1C', 'A1', 'KP1', '2026-03-08 09:00+00', '2026-03-08 11:00+00', '2026-03-08 10:59+00', 'ended', 'O1'),
               ('RSX1', 'B1', 'KX', '2026-10-05 15:00+00', '2026-10-05 19:00+00', '2026-10-05 18:59+00', 'ended', 'O2')) s(name, agent, cmp, started, ended, beat, status, org);

-- -----------------------------------------------------------------------------------------------------
-- Reader harness helpers. The readers are created sealed and no migration grants them (plan §2.8). To
-- exercise the real public boundary as an authenticated caller, rt.v3_call grants EXECUTE on the nine
-- readers to authenticated only for the duration of one call and revokes it before returning; if the call
-- fails, the error rolls the grant back with the statement or the subtransaction. Disposable harness only.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION rt.v3_reader_grants(p_on boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = ANY (rt.v3_readers()) LOOP
    EXECUTE format(CASE WHEN p_on THEN 'GRANT EXECUTE ON FUNCTION %s TO authenticated'
                        ELSE 'REVOKE EXECUTE ON FUNCTION %s FROM authenticated' END, f);
  END LOOP;
END $$;
CREATE FUNCTION rt.v3_call(p_uid uuid, p_org uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM rt.v3_reader_grants(true);
  PERFORM rt.claims(p_uid, p_org);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  PERFORM rt.v3_reader_grants(false);
  RETURN v;
END $$;
-- 'OK', or 'SQLSTATE:message'; the grant lives and dies inside the subtransaction.
CREATE FUNCTION rt.v3_err(p_uid uuid, p_org uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM rt.v3_call(p_uid, p_org, p_sql);
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ':' || SQLERRM;
  END;
END $$;
-- A persona's payload from one reader: p_reader is the reader suffix, the window is October 2026 unless given.
CREATE FUNCTION rt.v3r(p_who text, p_reader text, p_scope text DEFAULT NULL, p_agent text DEFAULT NULL,
                       p_start date DEFAULT '2026-10-01', p_end date DEFAULT '2026-10-31') RETURNS jsonb LANGUAGE sql AS $$
  SELECT rt.v3_call(rt.v3(p_who), rt.v3('O1'), CASE WHEN p_reader = 'scope'
    THEN format('SELECT public.get_report_scope_v3(%L)', p_scope)
    ELSE format('SELECT public.get_report_%s_v3(%L::date, %L::date, %L::uuid, %L)', p_reader, p_start, p_end, rt.v3(p_agent), p_scope) END);
$$;
-- Sum of the numbers a JSON path selects, and one field of one KPI envelope as JSON text ('725', 'null').
CREATE FUNCTION rt.jsum(p jsonb, p_path text) RETURNS numeric LANGUAGE sql AS $$
  SELECT coalesce(sum(v::text::numeric), 0) FROM jsonb_path_query(p, p_path::jsonpath) v;
$$;
CREATE FUNCTION rt.kpi(p jsonb, p_id int, p_field text DEFAULT 'value') RETURNS text LANGUAGE sql AS $$
  SELECT (e -> p_field)::text FROM jsonb_array_elements(p -> 'metrics') e WHERE (e ->> 'id')::int = p_id;
$$;
-- The runner's post-check for the concurrent index (D1 §3.10): exact definition, valid and ready.
CREATE FUNCTION rt.v3_index_check() RETURNS void LANGUAGE plpgsql AS $$
DECLARE i record;
BEGIN
  SELECT x.indisvalid, x.indisready, pg_get_indexdef(x.indexrelid) AS def INTO i
    FROM pg_index x WHERE x.indexrelid = to_regclass('public.report_v3_calls_org_campaign_lead');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reports v3 index: report_v3_calls_org_campaign_lead is missing';
  END IF;
  IF i.def IS DISTINCT FROM 'CREATE INDEX report_v3_calls_org_campaign_lead ON public.calls USING btree (organization_id, campaign_lead_id, created_at)' THEN
    RAISE EXCEPTION 'Reports v3 index: report_v3_calls_org_campaign_lead definition mismatch: %', i.def;
  END IF;
  IF NOT (i.indisvalid AND i.indisready) THEN
    RAISE EXCEPTION 'Reports v3 index: report_v3_calls_org_campaign_lead is not valid';
  END IF;
END $$;
