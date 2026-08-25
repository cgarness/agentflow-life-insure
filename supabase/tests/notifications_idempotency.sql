-- =====================================================================================================
-- Notifications exactly-once + recipients + security — SQL integration tests (Notifications Build 1)
-- =====================================================================================================
-- STATUS: run ONLY on a disposable LOCAL stack — never production. Requires the harness schema
-- (organizations/profiles/leads/calls/wins/notifications + auth.uid()/get_user_org_id()/is_ancestor_of)
-- and migration 20260819163413_notifications_idempotency_recipients_security.sql applied.
-- Auth is simulated via request.jwt.claims; RLS scenarios use SET ROLE. Each scenario is an independent
-- DO block; an uncaught RAISE names the failing scenario. No assertion is weakened.
-- The true-concurrency lost-update proof for append_call_routed_agents (open transaction holding the
-- row lock while a second session appends) is orchestrated by the runner script across two psql
-- sessions; N4 here covers successive/overlapping waves in one session.
--
-- Fixtures: org A (aaaa…000A) + org B (bbbb…000B).
--   Org A: agent1 (…00a1), agent2 (…00a2), agent3 (…00a3), admin (…00ad, Admin),
--          tl (…00t1, Team Leader), inactive (…00i1, status Inactive), importer = admin.
--   Org B: badmin (…00b1, Admin).
--   Plus legacy-role TL (…00f1, 'Team Lead') — the live conversion predicate accepts both strings.
--   hierarchy: tl (d1) and legacy TL (f1) are ancestors of agent1 only (tests both TL branches).

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Notif Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Notif Org B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2'),
  ('aaaaaaaa-0000-0000-0000-0000000000a3'),
  ('aaaaaaaa-0000-0000-0000-0000000000ad'),
  ('aaaaaaaa-0000-0000-0000-0000000000d1'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1'),
  ('aaaaaaaa-0000-0000-0000-0000000000f1'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, organization_id, role, is_super_admin, first_name, last_name, status, hierarchy_path) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent',      false,'Ag','One','Active',  't1.a1'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent',      false,'Ag','Two','Active',  'a2'),
  ('aaaaaaaa-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-00000000000a','Agent',      false,'Ag','Three','Active','a3'),
  ('aaaaaaaa-0000-0000-0000-0000000000ad','aaaaaaaa-0000-0000-0000-00000000000a','Admin',      false,'Ad','Min','Active',  'ad'),
  ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000000a','Team Leader',false,'Te','Lead','Active', 't1'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-00000000000a','Agent',      false,'In','Active','Inactive','i1'),
  -- legacy role string kept alive by the live conversion predicate (role IN ('Team Leader','Team Lead'))
  ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-00000000000a','Team Lead',  false,'Le','Gacy','Active', 't1'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Admin',      false,'Bo','Admin','Active','b1')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN NULL
         ELSE json_build_object('sub', p_uid::text)::text END,
    false);
END$$;

-- ── N0: migration surface — column, arbiter index, filler default ────────────────────────────────────
DO $$
DECLARE v_key text;
BEGIN
  PERFORM pg_temp.act_as(NULL);
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='notifications'
                   AND indexname='uq_notifications_user_event_key') THEN
    RAISE EXCEPTION 'N0 unique arbiter index missing'; END IF;
  -- an insert that never mentions event_key gets a unique non-null filler
  INSERT INTO public.notifications (user_id, type, title, body, organization_id)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','system','t','b','aaaaaaaa-0000-0000-0000-00000000000a')
  RETURNING event_key INTO v_key;
  IF v_key IS NULL OR v_key = '' THEN RAISE EXCEPTION 'N0 filler event_key missing'; END IF;
  DELETE FROM public.notifications WHERE event_key = v_key;
END$$;

-- ── N1: two identical missed-call fan-outs → one row per recipient (never 6/9) ───────────────────────
DO $$
DECLARE v_call uuid := gen_random_uuid(); v_cnt int;
BEGIN
  PERFORM pg_temp.act_as(NULL); -- service-role-like writer path
  FOR i IN 1..2 LOOP
    INSERT INTO public.notifications (user_id, type, title, body, organization_id, event_key)
    SELECT u, 'missed_call', 'Missed Call', 'Missed call from X',
           'aaaaaaaa-0000-0000-0000-00000000000a', 'missed_call:' || v_call::text
      FROM unnest(ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1',
                        'aaaaaaaa-0000-0000-0000-0000000000a2',
                        'aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[]) AS u
    ON CONFLICT (user_id, event_key) DO NOTHING;
  END LOOP;
  SELECT count(*) INTO v_cnt FROM public.notifications WHERE event_key = 'missed_call:' || v_call::text;
  IF v_cnt <> 3 THEN RAISE EXCEPTION 'N1 expected exactly 3 rows, got %', v_cnt; END IF;
END$$;

-- ── N2: pre-existing row for one recipient does not block the missing recipients ─────────────────────
DO $$
DECLARE v_call uuid := gen_random_uuid(); v_cnt int;
BEGIN
  PERFORM pg_temp.act_as(NULL);
  INSERT INTO public.notifications (user_id, type, title, body, organization_id, event_key)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','missed_call','Missed Call','b',
          'aaaaaaaa-0000-0000-0000-00000000000a','missed_call:' || v_call::text);
  INSERT INTO public.notifications (user_id, type, title, body, organization_id, event_key)
  SELECT u, 'missed_call', 'Missed Call', 'b', 'aaaaaaaa-0000-0000-0000-00000000000a',
         'missed_call:' || v_call::text
    FROM unnest(ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1',
                      'aaaaaaaa-0000-0000-0000-0000000000a2',
                      'aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[]) AS u
  ON CONFLICT (user_id, event_key) DO NOTHING;
  SELECT count(*) INTO v_cnt FROM public.notifications WHERE event_key = 'missed_call:' || v_call::text;
  IF v_cnt <> 3 THEN RAISE EXCEPTION 'N2 expected 3 rows (A pre-existing + B,C added), got %', v_cnt; END IF;
END$$;

-- ── N3: retry after dismissal cannot resurrect the alert ─────────────────────────────────────────────
DO $$
DECLARE v_call uuid := gen_random_uuid(); v_cnt int; v_dismissed_cnt int;
BEGIN
  PERFORM pg_temp.act_as(NULL);
  INSERT INTO public.notifications (user_id, type, title, body, organization_id, event_key)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','missed_call','Missed Call','b',
          'aaaaaaaa-0000-0000-0000-00000000000a','missed_call:' || v_call::text);
  UPDATE public.notifications SET dismissed_at = now()
   WHERE event_key = 'missed_call:' || v_call::text;
  -- retried webhook
  INSERT INTO public.notifications (user_id, type, title, body, organization_id, event_key)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','missed_call','Missed Call','b',
          'aaaaaaaa-0000-0000-0000-00000000000a','missed_call:' || v_call::text)
  ON CONFLICT (user_id, event_key) DO NOTHING;
  SELECT count(*), count(*) FILTER (WHERE dismissed_at IS NOT NULL)
    INTO v_cnt, v_dismissed_cnt
    FROM public.notifications WHERE event_key = 'missed_call:' || v_call::text;
  IF v_cnt <> 1 OR v_dismissed_cnt <> 1 THEN
    RAISE EXCEPTION 'N3 dismissed row resurrected or duplicated (rows %, dismissed %)', v_cnt, v_dismissed_cnt; END IF;
END$$;

-- ── N4: append_call_routed_agents — union semantics, org scoping, guards ─────────────────────────────
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_other uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  v_call uuid := gen_random_uuid();
  v_arr uuid[]; v_ok boolean;
BEGIN
  PERFORM pg_temp.act_as(NULL);
  INSERT INTO public.calls (id, organization_id, direction, status) VALUES (v_call, v_org, 'inbound', 'ringing');

  -- wave 1
  v_ok := public.append_call_routed_agents(v_call, v_org,
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[]);
  IF NOT v_ok THEN RAISE EXCEPTION 'N4 wave 1 reported no update'; END IF;
  -- wave 2 overlaps wave 1
  v_ok := public.append_call_routed_agents(v_call, v_org,
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[]);
  IF NOT v_ok THEN RAISE EXCEPTION 'N4 wave 2 reported no update'; END IF;

  SELECT routed_agent_ids INTO v_arr FROM public.calls WHERE id = v_call;
  IF cardinality(v_arr) <> 3
     OR NOT (v_arr @> ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1']::uuid[])
     OR NOT (v_arr @> ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[])
     OR NOT (v_arr @> ARRAY['aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[]) THEN
    RAISE EXCEPTION 'N4 union wrong: %', v_arr; END IF;

  -- wrong org → refused, array untouched
  v_ok := public.append_call_routed_agents(v_call, v_other, ARRAY['bbbbbbbb-0000-0000-0000-0000000000b1']::uuid[]);
  IF v_ok THEN RAISE EXCEPTION 'N4 cross-org append must not update'; END IF;
  SELECT routed_agent_ids INTO v_arr FROM public.calls WHERE id = v_call;
  IF cardinality(v_arr) <> 3 THEN RAISE EXCEPTION 'N4 cross-org append mutated the array: %', v_arr; END IF;

  -- null / empty guards
  IF public.append_call_routed_agents(v_call, v_org, NULL) THEN RAISE EXCEPTION 'N4 null array must be a no-op'; END IF;
  IF public.append_call_routed_agents(v_call, v_org, ARRAY[]::uuid[]) THEN RAISE EXCEPTION 'N4 empty array must be a no-op'; END IF;
  IF public.append_call_routed_agents(NULL, v_org, ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1']::uuid[]) THEN
    RAISE EXCEPTION 'N4 null call id must be a no-op'; END IF;
END$$;

-- ── N4b: append_call_routed_agents EXECUTE is service-role-only ──────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.append_call_routed_agents(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'N4b authenticated must not execute append_call_routed_agents'; END IF;
  IF has_function_privilege('anon', 'public.append_call_routed_agents(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'N4b anon must not execute append_call_routed_agents'; END IF;
  IF NOT has_function_privilege('service_role', 'public.append_call_routed_agents(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'N4b service_role must execute append_call_routed_agents'; END IF;
END$$;

-- ── N5: notify_win authorization matrix + exactly-once + Active-only org fan-out ─────────────────────
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_win uuid := gen_random_uuid();
  v_n int; v_code text;
BEGIN
  INSERT INTO public.wins (id, agent_id, agent_name, contact_name, organization_id)
  VALUES (v_win, 'aaaaaaaa-0000-0000-0000-0000000000a1', 'Ag One', 'Client X', v_org);

  -- unauthenticated → 28000
  PERFORM pg_temp.act_as(NULL);
  BEGIN
    PERFORM public.notify_win(v_win);
    RAISE EXCEPTION 'N5 unauthenticated caller must be rejected';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '28000' THEN RAISE EXCEPTION 'N5 expected 28000, got %', v_code; END IF;
  END;

  -- cross-org Admin → 42501
  PERFORM pg_temp.act_as('bbbbbbbb-0000-0000-0000-0000000000b1');
  BEGIN
    PERFORM public.notify_win(v_win);
    RAISE EXCEPTION 'N5 cross-org caller must be rejected';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'N5 expected 42501 (cross-org), got %', v_code; END IF;
  END;

  -- same-org Agent who is NOT the win's agent → 42501 (mandatory amendment 3)
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a2');
  BEGIN
    PERFORM public.notify_win(v_win);
    RAISE EXCEPTION 'N5 same-org non-owner Agent must be rejected';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'N5 expected 42501 (peer agent), got %', v_code; END IF;
  END;

  -- an INACTIVE caller who otherwise qualifies is ALLOWED — the verified conversion predicate
  -- has no caller-status gate, and a stricter gate here would record-while-suppressing.
  -- (Recipients remain Active-only regardless.)
  DECLARE v_win_inactive uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.wins (id, agent_id, agent_name, contact_name, organization_id)
    VALUES (v_win_inactive, 'aaaaaaaa-0000-0000-0000-0000000000e1', 'In Active', 'Client I', v_org);
    PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000e1');
    v_n := public.notify_win(v_win_inactive);
    IF v_n <> 6 THEN RAISE EXCEPTION 'N5 inactive self-caller fan-out expected 6, got %', v_n; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'win:' || v_win_inactive::text
                 AND user_id = 'aaaaaaaa-0000-0000-0000-0000000000e1') THEN
      RAISE EXCEPTION 'N5 inactive profile must not RECEIVE the fan-out'; END IF;
  END;

  -- Team Leader NOT over the win's agent: win by a2, tl not ancestor of a2 → 42501
  DECLARE v_win2 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.wins (id, agent_id, agent_name, contact_name, organization_id)
    VALUES (v_win2, 'aaaaaaaa-0000-0000-0000-0000000000a2', 'Ag Two', 'Client Y', v_org);
    PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000d1');
    BEGIN
      PERFORM public.notify_win(v_win2);
      RAISE EXCEPTION 'N5 TL without ancestry must be rejected';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
      IF v_code <> '42501' THEN RAISE EXCEPTION 'N5 expected 42501 (TL no ancestry), got %', v_code; END IF;
    END;
  END;

  -- self (the win's agent) → fan-out to Active org profiles only (6 Active in org A incl. the legacy-role TL), never org B, never Inactive
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a1');
  v_n := public.notify_win(v_win);
  IF v_n <> 6 THEN RAISE EXCEPTION 'N5 expected 6 Active-org recipients, got %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'win:' || v_win::text
               AND user_id IN ('aaaaaaaa-0000-0000-0000-0000000000e1','bbbbbbbb-0000-0000-0000-0000000000b1')) THEN
    RAISE EXCEPTION 'N5 inactive or cross-org recipient received a win notification'; END IF;
  -- content comes from the DB wins row
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'win:' || v_win::text
                   AND title = 'Ag One just sold a policy! 🎉' AND body = 'Sold to Client X'
                   AND organization_id = v_org) THEN
    RAISE EXCEPTION 'N5 win content not built from DB data'; END IF;

  -- retry (Admin this time, acting-for-agent) → exactly-once: zero new rows
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000ad');
  v_n := public.notify_win(v_win);
  IF v_n <> 0 THEN RAISE EXCEPTION 'N5 retry inserted % duplicate rows', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.notifications WHERE event_key = 'win:' || v_win::text;
  IF v_n <> 6 THEN RAISE EXCEPTION 'N5 expected 6 total rows after retry, got %', v_n; END IF;

  -- TL over the win's agent (tl is ancestor of a1) → authorized
  DECLARE v_win3 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.wins (id, agent_id, agent_name, contact_name, organization_id)
    VALUES (v_win3, 'aaaaaaaa-0000-0000-0000-0000000000a1', 'Ag One', 'Client Z', v_org);
    PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000d1');
    v_n := public.notify_win(v_win3);
    IF v_n <> 6 THEN RAISE EXCEPTION 'N5 TL-with-ancestry fan-out expected 6, got %', v_n; END IF;
  END;

  -- legacy 'Team Lead' role string with ancestry → authorized (the live conversion predicate
  -- accepts role IN ('Team Leader','Team Lead'); the mirror must too)
  DECLARE v_win4 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.wins (id, agent_id, agent_name, contact_name, organization_id)
    VALUES (v_win4, 'aaaaaaaa-0000-0000-0000-0000000000a1', 'Ag One', 'Client L', v_org);
    PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000f1');
    v_n := public.notify_win(v_win4);
    IF v_n <> 6 THEN RAISE EXCEPTION 'N5 legacy Team Lead fan-out expected 6, got %', v_n; END IF;
  END;

  -- a NULL-agent win (unowned-lead conversion: any same-org member could create it) → any
  -- same-org member may broadcast it; cross-org still rejected
  DECLARE v_win5 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.wins (id, agent_id, agent_name, contact_name, organization_id)
    VALUES (v_win5, NULL, 'Some Agent', 'Client N', v_org);
    PERFORM pg_temp.act_as('bbbbbbbb-0000-0000-0000-0000000000b1');
    BEGIN
      PERFORM public.notify_win(v_win5);
      RAISE EXCEPTION 'N5 cross-org caller must be rejected for a null-agent win';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
      IF v_code <> '42501' THEN RAISE EXCEPTION 'N5 expected 42501 (null-agent cross-org), got %', v_code; END IF;
    END;
    PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a2');
    v_n := public.notify_win(v_win5);
    IF v_n <> 6 THEN RAISE EXCEPTION 'N5 null-agent same-org fan-out expected 6, got %', v_n; END IF;
  END;

  -- unknown win id → P0002
  BEGIN
    PERFORM public.notify_win(gen_random_uuid());
    RAISE EXCEPTION 'N5 unknown win must be rejected';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> 'P0002' THEN RAISE EXCEPTION 'N5 expected P0002, got %', v_code; END IF;
  END;
END$$;

-- ── N6: single lead INSERT with assignment → one detailed notification; self-assign → none ───────────
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_lead uuid := gen_random_uuid();
  v_row record; v_cnt int;
BEGIN
  -- admin creates a lead for agent2
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000ad');
  INSERT INTO public.leads (id, first_name, last_name, organization_id, assigned_agent_id, user_id)
  VALUES (v_lead, 'Pat', 'Lee', v_org, 'aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000a2');
  SELECT count(*) INTO v_cnt FROM public.notifications
   WHERE type='lead_claimed' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a2'
     AND metadata->>'lead_id' = v_lead::text;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'N6 expected exactly 1 detailed notification, got %', v_cnt; END IF;
  SELECT * INTO v_row FROM public.notifications
   WHERE type='lead_claimed' AND metadata->>'lead_id' = v_lead::text;
  IF v_row.title <> 'New Lead Assigned' OR v_row.body NOT LIKE '%Pat Lee%'
     OR v_row.action_url <> '/contacts?contact=' || v_lead::text OR v_row.organization_id <> v_org THEN
    RAISE EXCEPTION 'N6 detailed notification content wrong: % / % / %', v_row.title, v_row.body, v_row.action_url; END IF;

  -- self-add: agent1 creates their own lead → no notification
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a1');
  INSERT INTO public.leads (first_name, last_name, organization_id, assigned_agent_id, user_id)
  VALUES ('Self', 'Add', v_org, 'aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1');
  IF EXISTS (SELECT 1 FROM public.notifications
              WHERE type='lead_claimed' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a1'
                AND body LIKE '%Self Add%') THEN
    RAISE EXCEPTION 'N6 self-assignment must not notify'; END IF;

  -- unassigned insert → no notification
  INSERT INTO public.leads (first_name, last_name, organization_id) VALUES ('No','Owner', v_org);
END$$;

-- ── N7: one-statement bulk import → ONE summary per recipient; self-import silent ────────────────────
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_importer uuid := 'aaaaaaaa-0000-0000-0000-0000000000ad';
  v_cnt int; v_row record;
BEGIN
  PERFORM pg_temp.act_as(NULL); -- Edge Function import runs service-role (no JWT)
  -- 300 leads round-robin a1/a2 + 5 assigned to the importer themselves, ONE statement
  INSERT INTO public.leads (first_name, last_name, organization_id, assigned_agent_id, user_id, imported_by_user_id)
  SELECT 'Imp', 'L' || g,
         v_org,
         CASE WHEN g <= 300 THEN
           CASE WHEN g % 2 = 1 THEN 'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid
                ELSE 'aaaaaaaa-0000-0000-0000-0000000000a2'::uuid END
         ELSE v_importer END,
         NULL, v_importer
    FROM generate_series(1, 305) AS g;

  SELECT count(*) INTO v_cnt FROM public.notifications
   WHERE type='lead_claimed' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a1' AND (metadata->>'count') = '150';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'N7 agent1 expected exactly 1 summary of 150, got % rows', v_cnt; END IF;
  SELECT * INTO v_row FROM public.notifications
   WHERE type='lead_claimed' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a2' AND (metadata->>'count') = '150';
  IF NOT FOUND OR v_row.title <> 'New Leads Assigned' OR v_row.body <> '150 new leads have been assigned to you' THEN
    RAISE EXCEPTION 'N7 agent2 summary wrong'; END IF;
  -- importer's own 5 leads → silent
  IF EXISTS (SELECT 1 FROM public.notifications
              WHERE type='lead_claimed' AND user_id=v_importer AND created_at > now() - interval '1 minute'
                AND (metadata ? 'count' OR body LIKE '%Imp%')) THEN
    RAISE EXCEPTION 'N7 self-import must not notify the importer'; END IF;
END$$;

-- ── N8: reassignment exactly-once; no-op UPDATE silent; bulk reassign one summary; self silent ───────
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_lead uuid := gen_random_uuid();
  v_cnt int;
BEGIN
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000ad');
  INSERT INTO public.leads (id, first_name, last_name, organization_id, assigned_agent_id)
  VALUES (v_lead, 'Re', 'Assign', v_org, 'aaaaaaaa-0000-0000-0000-0000000000a1');
  DELETE FROM public.notifications WHERE metadata->>'lead_id' = v_lead::text; -- clear the INSERT-path row

  -- reassign a1 → a2: exactly one detailed row to a2
  UPDATE public.leads SET assigned_agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a2' WHERE id = v_lead;
  SELECT count(*) INTO v_cnt FROM public.notifications
   WHERE type='lead_claimed' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a2'
     AND metadata->>'lead_id' = v_lead::text;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'N8 reassign expected 1 notification, got %', v_cnt; END IF;

  -- same-value UPDATE (retry) → no new row
  UPDATE public.leads SET assigned_agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a2' WHERE id = v_lead;
  SELECT count(*) INTO v_cnt FROM public.notifications
   WHERE type='lead_claimed' AND metadata->>'lead_id' = v_lead::text;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'N8 no-op reassign must not re-notify (got %)', v_cnt; END IF;

  -- bulk reassign 50 leads to a3 in one statement → one summary
  PERFORM pg_temp.act_as(NULL);
  INSERT INTO public.leads (first_name, last_name, organization_id, assigned_agent_id)
  SELECT 'Bulk','R'||g, v_org, 'aaaaaaaa-0000-0000-0000-0000000000a1' FROM generate_series(1,50) g;
  DELETE FROM public.notifications WHERE type='lead_claimed' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000ad');
  UPDATE public.leads SET assigned_agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a3'
   WHERE organization_id = v_org AND first_name = 'Bulk';
  SELECT count(*) INTO v_cnt FROM public.notifications
   WHERE type='lead_claimed' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a3' AND (metadata->>'count') = '50';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'N8 bulk reassign expected exactly 1 summary of 50, got %', v_cnt; END IF;

  -- self-reassign (a2 claims for themselves) → silent
  DECLARE v_lead2 uuid := gen_random_uuid();
  BEGIN
    PERFORM pg_temp.act_as(NULL);
    INSERT INTO public.leads (id, first_name, last_name, organization_id) VALUES (v_lead2,'Hard','Claim',v_org);
    PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a2');
    UPDATE public.leads SET assigned_agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a2' WHERE id = v_lead2;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE metadata->>'lead_id' = v_lead2::text) THEN
      RAISE EXCEPTION 'N8 self-claim must not notify'; END IF;
  END;
END$$;

-- ── N9: notification failure NEVER blocks the lead write ─────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_lead uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000ad');
  -- Injected failure: a NOT VALID CHECK that rejects any new lead_claimed row (existing rows untouched;
  -- immune to plan caching, unlike a table rename — same OID would still satisfy cached plans).
  ALTER TABLE public.notifications ADD CONSTRAINT tmp_n9_fail CHECK (type <> 'lead_claimed') NOT VALID;
  BEGIN
    INSERT INTO public.leads (id, first_name, last_name, organization_id, assigned_agent_id)
    VALUES (v_lead, 'Sur', 'Vives', v_org, 'aaaaaaaa-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.notifications DROP CONSTRAINT tmp_n9_fail;
    RAISE EXCEPTION 'N9 lead write aborted by notification failure: %', SQLERRM;
  END;
  ALTER TABLE public.notifications DROP CONSTRAINT tmp_n9_fail;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = v_lead) THEN
    RAISE EXCEPTION 'N9 lead write lost'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE metadata->>'lead_id' = v_lead::text) THEN
    RAISE EXCEPTION 'N9 notification unexpectedly inserted despite injected failure'; END IF;
END$$;

-- ── N10: INSERT policy — TO authenticated, self-user, org membership ─────────────────────────────────
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_code text;
BEGIN
  -- authenticated, self → allowed
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  INSERT INTO public.notifications (user_id, type, title, body, organization_id)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','system','self insert','ok', v_org);

  -- authenticated, for ANOTHER user in the same org → rejected
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, organization_id)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000a2','system','forged','no', v_org);
    RAISE EXCEPTION 'N10 cross-user insert must be rejected';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'N10 expected 42501 (cross-user), got %', v_code; END IF;
  END;

  -- wrong org on own user → rejected
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, organization_id)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','system','forged org','no',
            'bbbbbbbb-0000-0000-0000-00000000000b');
    RAISE EXCEPTION 'N10 wrong-org insert must be rejected';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'N10 expected 42501 (wrong org), got %', v_code; END IF;
  END;
  RESET ROLE;

  -- anon → no INSERT policy applies
  PERFORM pg_temp.act_as(NULL);
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, organization_id)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','system','anon','no', v_org);
    RAISE EXCEPTION 'N10 anon insert must be rejected';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'N10 expected 42501 (anon), got %', v_code; END IF;
  END;
  RESET ROLE;
END$$;

SELECT 'notifications_idempotency.sql: ALL SCENARIOS PASSED' AS result;
