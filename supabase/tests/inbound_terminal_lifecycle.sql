-- =====================================================================================================
-- Terminal finalization (R17) + identity RPC matrix (R4) + compat wrapper (R5) + last-agent (R18/R10)
-- SQL tests T24/T25(RPC level) — plan rev 5 §11. Disposable LOCAL stack only.
-- Apply inbound_harness.sql → M1 → M2, then run with ON_ERROR_STOP=1. Whole file rolls back.
-- =====================================================================================================

BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Term Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Term Org B');
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a1'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a2'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Inactive','agent_i1'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Agent','Active','agent_b1');

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN NULL
         ELSE json_build_object('sub', p_uid::text)::text END, true);
END $$;

-- ── F1 (T24): finalize closes a ringing row — ended_at set, duration NEVER written ──────────────────
DO $$
DECLARE r jsonb; c public.calls%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_type, duration)
  VALUES ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing',
          'CA000000000000000000000000000000d1', NULL, 0);
  r := public.finalize_inbound_call_terminal('dddddddd-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000000a', 'completed', false);
  RESET ROLE;
  IF (r->>'updated')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'F1 expected updated=true, got %', r; END IF;
  SELECT * INTO c FROM public.calls WHERE id = 'dddddddd-0000-0000-0000-000000000001';
  IF c.status <> 'completed' OR c.ended_at IS NULL THEN RAISE EXCEPTION 'F1 not finalized'; END IF;
  IF c.duration <> 0 THEN RAISE EXCEPTION 'F1 finalize must never write duration'; END IF;
END $$;

-- ── F2 (R17): already-terminal ⇒ {updated:false, already_terminal}; row byte-identical ──────────────
DO $$
DECLARE r jsonb; snap jsonb; snap2 jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(c) INTO snap FROM public.calls c WHERE c.id = 'dddddddd-0000-0000-0000-000000000001';
  r := public.finalize_inbound_call_terminal('dddddddd-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000000a', 'no-answer', true);
  SELECT to_jsonb(c) INTO snap2 FROM public.calls c WHERE c.id = 'dddddddd-0000-0000-0000-000000000001';
  RESET ROLE;
  IF (r->>'updated')::boolean OR r->>'reason' <> 'already_terminal' THEN
    RAISE EXCEPTION 'F2 expected already_terminal, got %', r; END IF;
  IF snap <> snap2 THEN RAISE EXCEPTION 'F2 idempotent finalize mutated the row'; END IF;
END $$;

-- ── F3 (R17): wrong id / wrong org ⇒ not_found_or_mismatch (observable, distinguishable) ────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.finalize_inbound_call_terminal(gen_random_uuid(),
        'aaaaaaaa-0000-0000-0000-00000000000a', 'completed', false);
  IF (r->>'updated')::boolean OR r->>'reason' <> 'not_found_or_mismatch' THEN
    RAISE EXCEPTION 'F3 missing id expected not_found_or_mismatch, got %', r; END IF;
  r := public.finalize_inbound_call_terminal('dddddddd-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-00000000000b', 'completed', false);
  RESET ROLE;
  IF (r->>'updated')::boolean OR r->>'reason' <> 'not_found_or_mismatch' THEN
    RAISE EXCEPTION 'F3 wrong org expected not_found_or_mismatch, got %', r; END IF;
END $$;

-- ── F4: invalid p_status raises (never silently maps) ───────────────────────────────────────────────
DO $$
DECLARE v_ok boolean := false;
BEGIN
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.finalize_inbound_call_terminal('dddddddd-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-00000000000a', 'ringing', false);
  EXCEPTION WHEN OTHERS THEN v_ok := true; END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION 'F4 invalid status must raise'; END IF;
END $$;

-- ── F5: missed flag only ORs upward; finalize on live row can mark missed ───────────────────────────
DO $$
DECLARE r jsonb; c public.calls%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_type, is_missed)
  VALUES ('dddddddd-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing',
          'CA000000000000000000000000000000d2', NULL, false);
  r := public.finalize_inbound_call_terminal('dddddddd-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-00000000000a', 'no-answer', true);
  RESET ROLE;
  SELECT * INTO c FROM public.calls WHERE id = 'dddddddd-0000-0000-0000-000000000002';
  IF NOT (r->>'updated')::boolean OR c.status <> 'no-answer' OR c.is_missed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F5 missed finalize failed: % / %', r, to_jsonb(c); END IF;
END $$;

-- ── F6 (R4): get_inbound_call_identity authorization matrix ─────────────────────────────────────────
DO $$
DECLARE r jsonb; v_live uuid := 'dddddddd-0000-0000-0000-000000000003';
        v_stale uuid := 'dddddddd-0000-0000-0000-000000000004';
        v_empty uuid := 'dddddddd-0000-0000-0000-000000000005';
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_type,
                            contact_phone, caller_id_used, contact_name, routed_agent_ids, created_at) VALUES
    (v_live,'aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA000000000000000000000000000000d3',
     NULL,'+19995551234','+15550001111','Pat Lead',
     ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1']::uuid[], now()),
    (v_stale,'aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA000000000000000000000000000000d4',
     NULL,'+19995551234','+15550001111',NULL,
     ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1']::uuid[], now() - interval '20 minutes'),
    (v_empty,'aaaaaaaa-0000-0000-0000-00000000000a','inbound','ringing','CA000000000000000000000000000000d5',
     NULL,'+19995551234','+15550001111',NULL, NULL, now());
  RESET ROLE;

  -- routed agent on a live ring ⇒ payload with ANI + name
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.get_inbound_call_identity(v_live);
  IF r IS NULL OR r->>'contact_phone' <> '+19995551234' OR r->>'caller_id_used' <> '+15550001111' THEN
    RAISE EXCEPTION 'F6 routed agent must read live ring, got %', r; END IF;
  -- same-org NON-routed member with the row UUID ⇒ NULL
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a2');
  r := public.get_inbound_call_identity(v_live);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F6 non-routed member must get NULL, got %', r; END IF;
  -- inactive routed profile ⇒ NULL
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000e1');
  r := public.get_inbound_call_identity(v_live);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F6 inactive profile must get NULL'; END IF;
  -- cross-org ⇒ NULL
  PERFORM pg_temp.act_as('bbbbbbbb-0000-0000-0000-0000000000b1');
  r := public.get_inbound_call_identity(v_live);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F6 cross-org must get NULL'; END IF;
  -- stale (>15 min) unassigned ring ⇒ NULL even for the routed agent
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a1');
  r := public.get_inbound_call_identity(v_stale);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F6 stale ring must get NULL'; END IF;
  -- empty routed_agent_ids ⇒ NULL (fail closed, R3-consistent)
  r := public.get_inbound_call_identity(v_empty);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F6 empty-routed ring must get NULL'; END IF;
  -- unauthenticated ⇒ NULL
  PERFORM pg_temp.act_as(NULL);
  r := public.get_inbound_call_identity(v_live);
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F6 unauthenticated must get NULL'; END IF;
  RESET ROLE;

  -- assigned agent post-claim ⇒ payload (owner branch)
  SET LOCAL ROLE service_role;
  UPDATE public.calls SET agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a1', status = 'connected'
   WHERE id = v_live;
  RESET ROLE;
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.get_inbound_call_identity(v_live);
  RESET ROLE;
  PERFORM pg_temp.act_as(NULL);
  IF r IS NULL OR (r->>'agent_id')::uuid <> 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'F6 owner must read own call post-claim, got %', r; END IF;
END $$;

-- ── F7 (R5): deprecated display-name wrapper — unique-only, auth-required, org-scoped ───────────────
DO $$
DECLARE r text;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.leads (organization_id, phone, first_name, last_name) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a','(209) 840-2988','Pat','Lead'),
    ('aaaaaaaa-0000-0000-0000-00000000000a','916-555-2222','Amb','One'),
    ('aaaaaaaa-0000-0000-0000-00000000000a','+19165552222','Amb','Two');
  RESET ROLE;
  PERFORM pg_temp.act_as('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.resolve_inbound_caller_display_name('+12098402988');
  IF r IS DISTINCT FROM 'Pat Lead' THEN RAISE EXCEPTION 'F7 unique match must return name, got %', r; END IF;
  r := public.resolve_inbound_caller_display_name('+19165552222');
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F7 ambiguous must return NULL (no newest-pick), got %', r; END IF;
  RESET ROLE;
  PERFORM pg_temp.act_as(NULL);
  SET LOCAL ROLE authenticated;
  r := public.resolve_inbound_caller_display_name('+12098402988');
  RESET ROLE;
  IF r IS NOT NULL THEN RAISE EXCEPTION 'F7 unauthenticated must return NULL'; END IF;
END $$;

-- ── F8 (R18/R10): find_last_agent_for_inbound — two sequential tiers, org-scoped, no caller_id_used ─
DO $$
DECLARE v uuid; v_contact uuid := '11111111-0000-0000-0000-000000000020';
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.leads (id, organization_id, phone, first_name, last_name)
  VALUES (v_contact,'aaaaaaaa-0000-0000-0000-00000000000a','(415) 555-0000','Tier','Test');
  -- Historical outbound rows:
  --   h1: contact_id-linked, agent a2, older
  --   h2: NO contact_id, formatted contact_phone matching, agent a1, newer
  --   h3: cross-org same phone, agent b1, newest (must never win)
  --   h4: caller_id_used holds the number but contact_phone does not (must never match)
  INSERT INTO public.calls (organization_id, direction, status, contact_id, contact_phone, caller_id_used,
                            agent_id, created_at) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a','outbound','completed', v_contact, '4155550000', NULL,
     'aaaaaaaa-0000-0000-0000-0000000000a2', now() - interval '3 days'),
    ('aaaaaaaa-0000-0000-0000-00000000000a','outbound','completed', NULL, '(415) 555-0000', NULL,
     'aaaaaaaa-0000-0000-0000-0000000000a1', now() - interval '1 day'),
    ('bbbbbbbb-0000-0000-0000-00000000000b','outbound','completed', NULL, '+14155550000', NULL,
     'bbbbbbbb-0000-0000-0000-0000000000b1', now()),
    ('aaaaaaaa-0000-0000-0000-00000000000a','outbound','completed', NULL, '+19998887777', '+14155550000',
     'aaaaaaaa-0000-0000-0000-0000000000a2', now());

  -- Tier 1: contact id supplied and a linked row exists ⇒ that agent (a2), even though a1's phone row is newer
  v := public.find_last_agent_for_inbound('aaaaaaaa-0000-0000-0000-00000000000a', v_contact, '4155550000');
  IF v IS DISTINCT FROM 'aaaaaaaa-0000-0000-0000-0000000000a2' THEN
    RAISE EXCEPTION 'F8 tier-1 contact-id match must outrank phone match, got %', v; END IF;

  -- R18 core: contact id supplied but NO linked outbound row ⇒ tier 2 formatted-phone match (a1)
  DELETE FROM public.calls WHERE contact_id = v_contact;
  v := public.find_last_agent_for_inbound('aaaaaaaa-0000-0000-0000-00000000000a', v_contact, '4155550000');
  IF v IS DISTINCT FROM 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'F8 tier-2 fallback with supplied contact id failed, got %', v; END IF;

  -- caller_id_used never matches: remove the tier-2 row; only h4 (agency DID column) remains in org A
  DELETE FROM public.calls
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND contact_phone = '(415) 555-0000';
  v := public.find_last_agent_for_inbound('aaaaaaaa-0000-0000-0000-00000000000a', NULL, '4155550000');
  RESET ROLE;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'F8 caller_id_used / cross-org rows must never match, got %', v; END IF;
END $$;

ROLLBACK;

-- ═════ F9 (rev 6 C6): durable recording-cleanup key — calls.recording_source_sid exists, nullable text ═════
BEGIN;
DO $$
DECLARE
  v_nullable text;
  v_type text;
BEGIN
  SELECT is_nullable, data_type INTO v_nullable, v_type
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'recording_source_sid';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'F9: calls.recording_source_sid is missing (M3 not applied)';
  END IF;
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'F9: calls.recording_source_sid must be nullable, got %', v_nullable;
  END IF;
  IF v_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'F9: calls.recording_source_sid must be text, got %', v_type;
  END IF;
END $$;
ROLLBACK;

-- ═════ F10 (rev 6 C7): a stale non-completed finalize never marks/regresses a CLAIMED call ═════
BEGIN;
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_agent uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_row uuid;
  j jsonb;
  r public.calls%ROWTYPE;
BEGIN
  INSERT INTO public.calls (organization_id, direction, status, twilio_call_sid, agent_id,
                            provider_session_id, routed_agent_ids, caller_id_used, contact_phone)
  VALUES (v_org, 'inbound', 'connected', 'CA000000000000000000000000000000f1', v_agent,
          'CA000000000000000000000000000000f2', ARRAY[v_agent], '+15550001111', '+14155550000')
  RETURNING id INTO v_row;

  SET LOCAL ROLE service_role;
  -- Stale earlier-wave hangup action: finalize no-answer + mark-missed on the CLAIMED, live row.
  j := public.finalize_inbound_call_terminal(v_row, v_org, 'no-answer', true);
  RESET ROLE;

  IF (j->>'updated')::boolean IS DISTINCT FROM false OR j->>'reason' IS DISTINCT FROM 'claimed_active' THEN
    RAISE EXCEPTION 'F10: stale no-answer finalize on a claimed row must be refused as claimed_active, got %', j;
  END IF;

  SELECT * INTO r FROM public.calls WHERE id = v_row;
  IF r.status IS DISTINCT FROM 'connected' OR COALESCE(r.is_missed, false) OR r.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'F10: claimed row was mutated by a stale finalize (status=%, is_missed=%, ended_at=%)',
      r.status, r.is_missed, r.ended_at;
  END IF;

  -- The answered path's completed finalize still lands on the claimed row.
  SET LOCAL ROLE service_role;
  j := public.finalize_inbound_call_terminal(v_row, v_org, 'completed', false);
  RESET ROLE;
  IF (j->>'updated')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'F10: completed finalize on the claimed row must succeed, got %', j;
  END IF;
  SELECT * INTO r FROM public.calls WHERE id = v_row;
  IF r.status IS DISTINCT FROM 'completed' OR COALESCE(r.is_missed, false) THEN
    RAISE EXCEPTION 'F10: completed finalize outcome wrong (status=%, is_missed=%)', r.status, r.is_missed;
  END IF;
END $$;
ROLLBACK;
