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
