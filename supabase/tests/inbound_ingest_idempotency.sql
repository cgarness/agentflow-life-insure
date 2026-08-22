-- =====================================================================================================
-- Inbound ingest idempotency + replay safety — SQL tests T23, R6, R16, R21, R22, R9(seq) (plan rev 5)
-- =====================================================================================================
-- STATUS: disposable LOCAL stack only. Apply inbound_harness.sql → M1 → M2, then run with ON_ERROR_STOP=1.
-- The TRUE two-session advisory-lock concurrency proof for R9 is orchestrated by the runner across two
-- psql sessions; I8 here proves the sequential in-lock re-resolve form. Whole file rolls back.

BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Ingest Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Ingest Org B');

INSERT INTO public.phone_numbers (id, organization_id, phone_number) VALUES
  ('55555555-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','+15550001111'),
  ('55555555-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','+15550009999'),
  ('55555555-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-00000000000b','+15550002222');

-- unique org-A lead for the linked-ingest scenario
INSERT INTO public.leads (id, organization_id, phone, first_name, last_name) VALUES
  ('11111111-0000-0000-0000-000000000010','aaaaaaaa-0000-0000-0000-00000000000a','(209) 840-2988','Pat','Lead');
-- ambiguous pair for I7
INSERT INTO public.leads (id, organization_id, phone, first_name, last_name) VALUES
  ('11111111-0000-0000-0000-000000000011','aaaaaaaa-0000-0000-0000-00000000000a','209-555-1111','Dup','One'),
  ('11111111-0000-0000-0000-000000000012','aaaaaaaa-0000-0000-0000-00000000000a','+12095551111','Dup','Two');

CREATE OR REPLACE FUNCTION pg_temp.trigger_count(p_k text) RETURNS integer
LANGUAGE sql AS $$ SELECT n FROM public.harness_trigger_counts WHERE k = p_k $$;

-- ── I1 (R16): blank / malformed parent SIDs are rejected before any write ───────────────────────────
DO $$
DECLARE r jsonb; v_before int; s text;
BEGIN
  SET LOCAL ROLE service_role;
  v_before := pg_temp.trigger_count('calls_insert');
  FOREACH s IN ARRAY ARRAY['', '   ', 'CA123', 'XX00000000000000000000000000000000',
                           'CA0000000000000000000000000000000g',
                           'CA000000000000000000000000000000001'] LOOP
    r := public.ingest_inbound_call(s, 'aaaaaaaa-0000-0000-0000-00000000000a',
                                    '+19995550000', '+15550001111', false);
    IF r->>'error' IS NULL THEN RAISE EXCEPTION 'I1 SID % must be rejected, got %', s, r; END IF;
  END LOOP;
  RESET ROLE;
  IF pg_temp.trigger_count('calls_insert') <> v_before THEN RAISE EXCEPTION 'I1 wrote a row on invalid SID'; END IF;
END $$;

-- ── I2: fresh ingest — exact row shape (ANI preserved, contact_type NULL, agent NULL) ───────────────
DO $$
DECLARE r jsonb; c public.calls%ROWTYPE; v_ins int;
BEGIN
  SET LOCAL ROLE service_role;
  v_ins := pg_temp.trigger_count('calls_insert');
  r := public.ingest_inbound_call('CA00000000000000000000000000000001',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+19995550000', '+15550001111', false);
  RESET ROLE;
  IF (r->>'inserted')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'I2 expected inserted=true, got %', r; END IF;
  SELECT * INTO c FROM public.calls WHERE id = (r->>'call_row_id')::uuid;
  IF c.direction <> 'inbound' OR c.status <> 'ringing' THEN RAISE EXCEPTION 'I2 wrong direction/status'; END IF;
  IF c.contact_phone <> '+19995550000' THEN RAISE EXCEPTION 'I2 ANI not preserved: %', c.contact_phone; END IF;
  IF c.caller_id_used <> '+15550001111' THEN RAISE EXCEPTION 'I2 DID wrong: %', c.caller_id_used; END IF;
  IF c.contact_type IS NOT NULL THEN RAISE EXCEPTION 'I2 contact_type must be explicit NULL, got %', c.contact_type; END IF;
  IF c.agent_id IS NOT NULL OR c.contact_id IS NOT NULL THEN RAISE EXCEPTION 'I2 must start unowned/unlinked'; END IF;
  IF (r->>'resolution') <> 'not_found' THEN RAISE EXCEPTION 'I2 unknown caller must be not_found, got %', r; END IF;
  IF pg_temp.trigger_count('calls_insert') <> v_ins + 1 THEN RAISE EXCEPTION 'I2 insert trigger must fire exactly once'; END IF;
END $$;

-- ── I3 (T23/R6): genuine retry ⇒ same row id, ZERO row mutation, zero trigger fires ─────────────────
DO $$
DECLARE r1 jsonb; r2 jsonb; snap1 jsonb; snap2 jsonb; v_ins int; v_upd int; v_leads int;
BEGIN
  SET LOCAL ROLE service_role;
  r1 := public.ingest_inbound_call('CA00000000000000000000000000000002',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+19995550001', '+15550001111', true);
  SELECT to_jsonb(c) INTO snap1 FROM public.calls c WHERE c.id = (r1->>'call_row_id')::uuid;
  SELECT count(*) INTO v_leads FROM public.leads;
  v_ins := pg_temp.trigger_count('calls_insert');
  v_upd := pg_temp.trigger_count('calls_update');
  -- Twilio retry: same SID, same org, same DID, auto_create still true
  r2 := public.ingest_inbound_call('CA00000000000000000000000000000002',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+19995550001', '+15550001111', true);
  SELECT to_jsonb(c) INTO snap2 FROM public.calls c WHERE c.id = (r1->>'call_row_id')::uuid;
  RESET ROLE;
  IF (r2->>'call_row_id') <> (r1->>'call_row_id') THEN RAISE EXCEPTION 'I3 retry must return the same row'; END IF;
  IF (r2->>'inserted')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'I3 retry must report inserted=false'; END IF;
  IF snap1 <> snap2 THEN RAISE EXCEPTION 'I3 retry mutated the row: % vs %', snap1, snap2; END IF;
  IF pg_temp.trigger_count('calls_insert') <> v_ins OR pg_temp.trigger_count('calls_update') <> v_upd THEN
    RAISE EXCEPTION 'I3 retry fired a calls trigger'; END IF;
  IF (SELECT count(*) FROM public.leads) <> v_leads THEN RAISE EXCEPTION 'I3 retry created a lead'; END IF;
END $$;

-- ── I4 (R16): same-SID cross-org replay fails closed — never returns the other org's row ────────────
DO $$
DECLARE r jsonb; v_cnt int;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.ingest_inbound_call('CA00000000000000000000000000000002',
        'bbbbbbbb-0000-0000-0000-00000000000b', '+19995550001', '+15550002222', false);
  RESET ROLE;
  IF r->>'error' IS NULL THEN RAISE EXCEPTION 'I4 cross-org replay must fail closed, got %', r; END IF;
  IF r->>'call_row_id' IS NOT NULL THEN RAISE EXCEPTION 'I4 leaked a row id: %', r; END IF;
  SELECT count(*) INTO v_cnt FROM public.calls WHERE twilio_call_sid = 'CA00000000000000000000000000000002';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'I4 replay must not create a second row (%)', v_cnt; END IF;
END $$;

-- ── I5 (R22): different-DID replays fail closed — including same-last-10 different-country-code ─────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  -- same org, different org DID
  r := public.ingest_inbound_call('CA00000000000000000000000000000002',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+19995550001', '+15550009999', false);
  IF r->>'error' IS NULL THEN RAISE EXCEPTION 'I5a different-DID replay must fail closed, got %', r; END IF;
  -- R22 core: '+445550001111' shares the trailing ten digits with the stored '+15550001111'
  r := public.ingest_inbound_call('CA00000000000000000000000000000002',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+19995550001', '+445550001111', false);
  RESET ROLE;
  IF r->>'error' IS NULL THEN
    RAISE EXCEPTION 'I5b same-last10 different-country-code DID must fail closed (exact E.164), got %', r; END IF;
END $$;

-- ── I6 (R21): invalid/anonymous ANI never auto-creates, preserves raw value, stays routable ─────────
DO $$
DECLARE r jsonb; c public.calls%ROWTYPE; v_leads int; s text; i int := 0;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_leads FROM public.leads;
  FOREACH s IN ARRAY ARRAY['anonymous', 'unknown', 'restricted', '555-1234'] LOOP
    i := i + 1;
    r := public.ingest_inbound_call(('CA0000000000000000000000000000001' || i::text),
          'aaaaaaaa-0000-0000-0000-00000000000a', s, '+15550001111', true);
    IF r->>'error' IS NOT NULL THEN RAISE EXCEPTION 'I6 % must still ingest+route, got %', s, r; END IF;
    IF (r->>'resolution') <> 'not_found' THEN RAISE EXCEPTION 'I6 % must resolve not_found', s; END IF;
    SELECT * INTO c FROM public.calls WHERE id = (r->>'call_row_id')::uuid;
    IF c.contact_phone <> s THEN RAISE EXCEPTION 'I6 raw caller value not preserved for %: %', s, c.contact_phone; END IF;
    IF c.contact_type IS NOT NULL OR c.contact_id IS NOT NULL THEN RAISE EXCEPTION 'I6 % must stay unlinked', s; END IF;
    IF c.status <> 'ringing' THEN RAISE EXCEPTION 'I6 % must remain routable (ringing)', s; END IF;
  END LOOP;
  RESET ROLE;
  IF (SELECT count(*) FROM public.leads) <> v_leads THEN RAISE EXCEPTION 'I6 created a lead for an invalid ANI'; END IF;
END $$;

-- ── I7 (T6): ambiguous caller with auto_create=true ⇒ no lead, no link ──────────────────────────────
DO $$
DECLARE r jsonb; v_leads int; c public.calls%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_leads FROM public.leads;
  r := public.ingest_inbound_call('CA00000000000000000000000000000021',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+12095551111', '+15550001111', true);
  RESET ROLE;
  IF (r->>'resolution') <> 'ambiguous' THEN RAISE EXCEPTION 'I7 expected ambiguous, got %', r; END IF;
  SELECT * INTO c FROM public.calls WHERE id = (r->>'call_row_id')::uuid;
  IF c.contact_id IS NOT NULL OR c.contact_type IS NOT NULL THEN RAISE EXCEPTION 'I7 ambiguous must stay unlinked'; END IF;
  IF (SELECT count(*) FROM public.leads) <> v_leads THEN RAISE EXCEPTION 'I7 ambiguous must not auto-create'; END IF;
END $$;

-- ── I8 (R9 sequential + T7): not_found auto-creates ONE lead; a second call re-resolves to it ───────
DO $$
DECLARE r1 jsonb; r2 jsonb; v_lead uuid; c public.calls%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  r1 := public.ingest_inbound_call('CA00000000000000000000000000000031',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+18885551000', '+15550001111', true);
  IF (r1->>'resolution') <> 'not_found' THEN RAISE EXCEPTION 'I8 first call expected not_found, got %', r1; END IF;
  SELECT id INTO v_lead FROM public.leads
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND phone = '+18885551000';
  IF v_lead IS NULL THEN RAISE EXCEPTION 'I8 auto-created lead missing'; END IF;
  SELECT * INTO c FROM public.calls WHERE id = (r1->>'call_row_id')::uuid;
  IF c.contact_id IS DISTINCT FROM v_lead OR c.contact_type <> 'lead' THEN
    RAISE EXCEPTION 'I8 first call must link the auto-created lead'; END IF;
  IF c.contact_phone <> '+18885551000' THEN RAISE EXCEPTION 'I8 ANI must stay raw on the call row'; END IF;
  -- auto-created lead shape (D2 canon)
  IF (SELECT first_name || ' ' || last_name || '|' || lead_source || '|' || COALESCE(assigned_agent_id::text,'')
        FROM public.leads WHERE id = v_lead) <> 'Inbound Caller|Inbound Call|' THEN
    RAISE EXCEPTION 'I8 auto-created lead shape wrong'; END IF;
  -- a DIFFERENT CallSid from the same number now resolves unique — exactly one lead ever
  r2 := public.ingest_inbound_call('CA00000000000000000000000000000032',
        'aaaaaaaa-0000-0000-0000-00000000000a', '+18885551000', '+15550001111', true);
  RESET ROLE;
  IF (r2->>'resolution') <> 'unique' OR (r2->>'contact_id')::uuid IS DISTINCT FROM v_lead THEN
    RAISE EXCEPTION 'I8 second call must resolve to the auto-created lead, got %', r2; END IF;
  IF (SELECT count(*) FROM public.leads WHERE phone = '+18885551000') <> 1 THEN
    RAISE EXCEPTION 'I8 duplicate auto-created lead'; END IF;
END $$;

-- ── I9: unique-index surface — arbiter exists with the R6 unbounded predicate ───────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname='public' AND indexname='uq_calls_inbound_twilio_call_sid';
  IF v_def IS NULL THEN RAISE EXCEPTION 'I9 unique arbiter index missing'; END IF;
  IF v_def !~* 'UNIQUE' OR v_def !~* 'direction[^)]*=[^)]*''inbound''' OR v_def ~* 'created_at' THEN
    RAISE EXCEPTION 'I9 index must be UNIQUE, inbound-partial, and timestamp-free: %', v_def; END IF;
END $$;

ROLLBACK;
