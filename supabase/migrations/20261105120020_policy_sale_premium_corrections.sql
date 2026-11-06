-- Reports V2 PKG-B (D2 §3.3-§3.6): audited sale premium corrections. Privilege class C: no GRANT here; every
-- function created below is revoked from PUBLIC, anon, authenticated and service_role (…21 grants the two RPCs).
--
--   private.policy_sale_premium_corrections   append-only ledger (no FK to public.wins; guarded by trigger)
--   private.guard_policy_sale_premium_correction  same-sale, chain and append-only guard (3 triggers)
--   private.policy_sale_book_monthly          exact reader of the current policy record's monthly amount
--   private.policy_sale_original_premium      the verbatim original sale-premium rule (as sold), with its source
--   private.policy_sale_effective_premium     the head correction, else the original rule
--   private.performance_sale_monthly          re-pointed at the effective reader (signature and attributes kept)
--   public.correct_policy_sale_premium        the correction RPC (Admin or Super Admin of the home organization)
--   public.get_client_policy_sale_premiums    the per-contact sale premium and history RPC
--
-- public.wins, its guard, premium_snapshot, commission rows and every edit path stay byte-identical. The ledger is
-- empty after this migration, so no number changes; that is proved for every sale before COMMIT.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
DECLARE
  v_fn regprocedure := to_regprocedure('private.performance_sale_monthly(public.wins,numeric)');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Sale premium corrections: Reports v3 must be disabled first' USING ERRCODE = '55000';
  END IF;
  IF v_fn IS NULL OR md5(pg_get_functiondef(v_fn)) <> '51e06b46a13c3a8eec4d672bec158376' THEN
    RAISE EXCEPTION 'Sale premium corrections: performance_sale_monthly preimage drift' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('private.policy_sale_premium_corrections') IS NOT NULL
     OR to_regprocedure('private.policy_sale_effective_premium(public.wins,numeric)') IS NOT NULL
     OR to_regprocedure('private.policy_sale_original_premium(public.wins,numeric)') IS NOT NULL
     OR to_regprocedure('private.policy_sale_book_monthly(jsonb,boolean)') IS NOT NULL
     OR to_regprocedure('public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.get_client_policy_sale_premiums(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Sale premium corrections: refusing replay' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- The choke point's attributes and every sale's value before the switch.
CREATE TEMP TABLE pspc_meta ON COMMIT DROP AS
  SELECT p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text AS acl, pg_get_function_result(p.oid) AS result
    FROM pg_proc p WHERE p.oid = 'private.performance_sale_monthly(public.wins,numeric)'::regprocedure;
CREATE TEMP TABLE pspc_before ON COMMIT DROP AS
  SELECT w.id, private.performance_sale_monthly(w, c.premium) AS monthly
    FROM public.wins w LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id;

CREATE TABLE private.policy_sale_premium_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  win_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_source text NOT NULL CHECK (policy_source IN ('primary','additional')),
  buyer_id uuid NOT NULL,
  seller_id uuid,
  sold_date date,
  revision integer NOT NULL CHECK (revision >= 1),
  supersedes_id uuid UNIQUE REFERENCES private.policy_sale_premium_corrections(id),
  previous_effective_monthly numeric,
  previous_source text NOT NULL
    CHECK (previous_source IN ('sale_snapshot','legacy_sale_event','legacy_record_fallback','correction','none')),
  corrected_monthly numeric CHECK (corrected_monthly IS NULL OR (corrected_monthly BETWEEN 0 AND 1000000
    AND corrected_monthly = round(corrected_monthly, 2))),
  reason_code text NOT NULL CHECK (reason_code IN ('entry_error','carrier_confirmed_amount','missing_at_entry','other')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 3 AND 500 AND note = btrim(note)),
  book_mode text NOT NULL CHECK (book_mode IN ('match_sale','keep_current')),
  book_action text NOT NULL CHECK (book_action IN ('updated','already_matched','kept_current','no_policy_record')),
  book_before jsonb,
  book_after jsonb,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pspc_request UNIQUE (organization_id, request_id),
  CONSTRAINT pspc_revision UNIQUE (organization_id, win_id, revision),
  CONSTRAINT pspc_chain CHECK ((revision = 1) = (supersedes_id IS NULL)),
  CONSTRAINT pspc_changed CHECK (corrected_monthly IS DISTINCT FROM previous_effective_monthly
    OR previous_source = 'legacy_record_fallback'),
  CONSTRAINT pspc_book CHECK ((book_action = 'updated') = (book_before IS DISTINCT FROM book_after))
);
ALTER TABLE private.policy_sale_premium_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_sale_premium_corrections FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_policy_sale_premium_correction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  w public.wins%ROWTYPE;
  head private.policy_sale_premium_corrections%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Sale premium corrections are append-only' USING ERRCODE = '23514';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Sale premium corrections are written only by the correction function' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.wins WHERE id = NEW.win_id;
  IF NOT FOUND OR w.organization_id IS DISTINCT FROM NEW.organization_id OR w.policy_id IS DISTINCT FROM NEW.policy_id
     OR w.contact_id IS DISTINCT FROM NEW.buyer_id OR w.agent_id IS DISTINCT FROM NEW.seller_id
     OR w.sold_date IS DISTINCT FROM NEW.sold_date THEN
    RAISE EXCEPTION 'A sale premium correction must match its recorded sale' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO head FROM private.policy_sale_premium_corrections
   WHERE organization_id = NEW.organization_id AND win_id = NEW.win_id ORDER BY revision DESC LIMIT 1;
  IF FOUND THEN
    IF NEW.revision <> head.revision + 1 OR NEW.supersedes_id IS DISTINCT FROM head.id
       OR NEW.previous_effective_monthly IS DISTINCT FROM head.corrected_monthly OR NEW.previous_source <> 'correction' THEN
      RAISE EXCEPTION 'A sale premium correction must extend the latest revision' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.revision <> 1 OR NEW.supersedes_id IS NOT NULL OR NEW.previous_source = 'correction' THEN
    RAISE EXCEPTION 'A sale premium correction must extend the latest revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_policy_sale_premium_correction() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER pspc_insert_guard BEFORE INSERT ON private.policy_sale_premium_corrections
  FOR EACH ROW EXECUTE FUNCTION private.guard_policy_sale_premium_correction();
CREATE TRIGGER pspc_append_only BEFORE UPDATE OR DELETE ON private.policy_sale_premium_corrections
  FOR EACH ROW EXECUTE FUNCTION private.guard_policy_sale_premium_correction();
CREATE TRIGGER pspc_no_truncate BEFORE TRUNCATE ON private.policy_sale_premium_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION private.guard_policy_sale_premium_correction();

-- The current policy record's monthly amount, read exactly: a JSON number as is; a string in the currency grammar
-- of the v2 book readers (dollars, commas, spaces, optional /mo or /month). A primary 0 is unknown (#34).
-- Negative, unparseable and absent values are NULL. Not report-prefixed: a v3 rollback never touches it.
CREATE FUNCTION private.policy_sale_book_monthly(p_raw jsonb, p_primary boolean) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE t text; n numeric;
BEGIN
  IF jsonb_typeof(p_raw) = 'number' THEN
    n := (p_raw #>> '{}')::numeric;
  ELSIF jsonb_typeof(p_raw) = 'string' THEN
    t := regexp_replace(btrim(p_raw #>> '{}'), '[[:space:]]', '', 'g');
    IF length(t) > 80 OR t !~* '^\$?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]+)?(/mo(nth)?)?$' THEN RETURN NULL; END IF;
    t := regexp_replace(t, '(/mo(nth)?)$', '', 'i');
    n := replace(replace(t, '$', ''), ',', '')::numeric;
  ELSE
    RETURN NULL;
  END IF;
  IF n < 0 OR n > 999999999999 OR (p_primary AND n = 0) THEN RETURN NULL; END IF;
  RETURN n;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.policy_sale_book_monthly(jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- The verbatim original rule (as sold): private.performance_monthly with the legacy fallback for primary policies
-- only, and the same source/state classification as the PKG-A report_v3_sale_premium stub.
CREATE FUNCTION private.policy_sale_original_premium(p_win public.wins, p_client numeric)
RETURNS TABLE (monthly numeric, source text, state text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT private.performance_monthly(p_win.premium_snapshot, p_win.premium_amount, f.client),
         CASE WHEN p_win.premium_snapshot THEN 'sale_snapshot'
              WHEN nullif(p_win.premium_amount, 0) IS NOT NULL THEN 'legacy_sale_event'
              WHEN nullif(f.client, 0) IS NOT NULL THEN 'legacy_record_fallback'
              ELSE 'none' END,
         CASE WHEN private.performance_monthly(p_win.premium_snapshot, p_win.premium_amount, f.client) IS NOT NULL THEN 'known'
              WHEN (CASE WHEN p_win.premium_snapshot THEN p_win.premium_amount
                         ELSE coalesce(nullif(p_win.premium_amount, 0), nullif(f.client, 0)) END) < 0 THEN 'invalid'
              ELSE 'missing' END
    FROM (SELECT CASE WHEN p_win.idempotency_key ~ ':policy:[0-9]+$'
                        OR EXISTS (SELECT 1 FROM private.policy_identities i
                                    WHERE i.policy_id = p_win.policy_id AND i.organization_id = p_win.organization_id
                                      AND i.source = 'additional')
                      THEN NULL ELSE p_client END AS client) f
$$;
REVOKE ALL ON FUNCTION private.policy_sale_original_premium(public.wins, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- The head correction (the latest revision) if any, else the original rule (revision 0). A correction to unknown
-- is 'missing'. It never calls performance_sale_monthly.
CREATE FUNCTION private.policy_sale_effective_premium(p_win public.wins, p_client numeric)
RETURNS TABLE (monthly numeric, source text, state text, revision integer)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH head AS (
    SELECT c.corrected_monthly, c.revision FROM private.policy_sale_premium_corrections c
     WHERE c.organization_id = p_win.organization_id AND c.win_id = p_win.id
     ORDER BY c.revision DESC LIMIT 1)
  SELECT h.corrected_monthly, 'correction'::text,
         CASE WHEN h.corrected_monthly IS NULL THEN 'missing' ELSE 'known' END, h.revision
    FROM head h
  UNION ALL
  SELECT o.monthly, o.source, o.state, 0
    FROM private.policy_sale_original_premium(p_win, p_client) o
   WHERE NOT EXISTS (SELECT 1 FROM head)
$$;
REVOKE ALL ON FUNCTION private.policy_sale_effective_premium(public.wins, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- The one switch (D2-7): every consumer behind performance_sale_monthly now reads the effective premium. The body
-- is one scalar expression (the head correction when one exists, else the verbatim original rule) rather than a
-- call of the set-returning effective reader: that call re-initializes two nested SQL functions for every sale and
-- timed out the 50,000-sale performance test. Equality with policy_sale_effective_premium is proved for every sale.
CREATE OR REPLACE FUNCTION private.performance_sale_monthly(p_win public.wins, p_client numeric) RETURNS numeric
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE WHEN EXISTS (SELECT 1 FROM private.policy_sale_premium_corrections h
                           WHERE h.organization_id = p_win.organization_id AND h.win_id = p_win.id)
   THEN (SELECT h.corrected_monthly FROM private.policy_sale_premium_corrections h
          WHERE h.organization_id = p_win.organization_id AND h.win_id = p_win.id ORDER BY h.revision DESC LIMIT 1)
   ELSE private.performance_monthly(p_win.premium_snapshot,p_win.premium_amount,
  CASE WHEN p_win.idempotency_key ~ ':policy:[0-9]+$' OR EXISTS(SELECT 1 FROM private.policy_identities i WHERE i.policy_id=p_win.policy_id AND i.organization_id=p_win.organization_id AND i.source='additional')
   THEN NULL ELSE p_client END) END
$$;

DO $identity$
BEGIN
  IF EXISTS (SELECT 1 FROM pspc_meta m, pg_proc p
              WHERE p.oid = 'private.performance_sale_monthly(public.wins,numeric)'::regprocedure
                AND (p.proowner, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text, pg_get_function_result(p.oid))
                    IS DISTINCT FROM (m.proowner, m.prosecdef, m.provolatile, m.proconfig, m.acl, m.result)) THEN
    RAISE EXCEPTION 'Sale premium corrections: performance_sale_monthly attributes changed' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pspc_before) <> (SELECT count(*) FROM public.wins) OR EXISTS (
       SELECT 1 FROM pspc_before b JOIN public.wins w ON w.id = b.id
         LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
        WHERE private.performance_sale_monthly(w, c.premium) IS DISTINCT FROM b.monthly
           OR private.performance_sale_monthly(w, c.premium)
              IS DISTINCT FROM (SELECT e.monthly FROM private.policy_sale_effective_premium(w, c.premium) e)) THEN
    RAISE EXCEPTION 'Sale premium corrections: a sale premium changed at the switch' USING ERRCODE = 'P0001';
  END IF;
END $identity$;

-- The correction RPC (D2 §3.5). Errors: 42501 denied; 22023 invalid input, no_change, book_diverged,
-- book_zero_unsupported, no_policy_record; PT404 sale_not_found; PT409 stale_revision, policy_changed,
-- request_conflict. Writes one ledger row and, with match_sale, the current policy record; never public.wins.
CREATE FUNCTION public.correct_policy_sale_premium(p_request_id uuid, p_policy_id uuid, p_expected_revision integer,
  p_expected_effective_monthly numeric, p_expected_book_amount jsonb, p_corrected_monthly numeric,
  p_reason_code text, p_note text, p_book_mode text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '2s' AS $$
DECLARE
  a record; v_hash text; v_prior private.policy_sale_premium_corrections%ROWTYPE; w public.wins%ROWTYPE;
  c public.clients%ROWTYPE; v_client boolean; v_source text; e record; v_head uuid;
  v_primary boolean; v_present boolean := false; v_idx integer; v_raw jsonb; v_after jsonb; v_book numeric;
  v_action text; v_freeze boolean := false; v_at timestamptz := clock_timestamp(); v_result jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF NOT coalesce(a.actor_role IN ('Admin', 'Super Admin') OR a.is_super, false) THEN
    RAISE EXCEPTION 'Only an Admin can correct a sale premium' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL OR p_policy_id IS NULL THEN
    RAISE EXCEPTION 'Invalid correction request' USING ERRCODE = '22023', DETAIL = 'invalid_request';
  ELSIF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid expected revision' USING ERRCODE = '22023', DETAIL = 'invalid_revision';
  ELSIF p_corrected_monthly IS NOT NULL AND (p_corrected_monthly < 0 OR p_corrected_monthly > 1000000
        OR p_corrected_monthly <> round(p_corrected_monthly, 2)) THEN
    RAISE EXCEPTION 'The corrected premium must be 0 to 1,000,000 with at most two decimals'
      USING ERRCODE = '22023', DETAIL = 'invalid_amount';
  ELSIF p_reason_code IS NULL OR p_reason_code NOT IN ('entry_error', 'carrier_confirmed_amount', 'missing_at_entry', 'other') THEN
    RAISE EXCEPTION 'Invalid correction reason' USING ERRCODE = '22023', DETAIL = 'invalid_reason';
  ELSIF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'The note must be 3 to 500 characters' USING ERRCODE = '22023', DETAIL = 'invalid_note';
  ELSIF p_book_mode IS NULL OR p_book_mode NOT IN ('match_sale', 'keep_current') THEN
    RAISE EXCEPTION 'Invalid policy record choice' USING ERRCODE = '22023', DETAIL = 'invalid_book_mode';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_array(p_policy_id, p_expected_revision, p_expected_effective_monthly,
    p_expected_book_amount, p_corrected_monthly, p_reason_code, btrim(p_note), p_book_mode)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(a.org_id || ':sale-premium-correction:request:' || p_request_id, 0));
  SELECT * INTO v_prior FROM private.policy_sale_premium_corrections
   WHERE organization_id = a.org_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.actor_id = a.uid AND v_prior.payload_hash = v_hash THEN
      RETURN v_prior.result || jsonb_build_object('idempotent', true);
    END IF;
    RAISE EXCEPTION 'This request was already used for a different correction' USING ERRCODE = 'PT409', DETAIL = 'request_conflict';
  END IF;

  SELECT * INTO w FROM public.wins WHERE organization_id = a.org_id AND policy_id = p_policy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = 'PT404', DETAIL = 'sale_not_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.org_id || ':sale-premium-correction:policy:' || p_policy_id, 0));
  SELECT * INTO c FROM public.clients WHERE id = w.contact_id AND organization_id = a.org_id FOR UPDATE;
  v_client := FOUND;
  SELECT i.source INTO v_source FROM private.policy_identities i WHERE i.organization_id = a.org_id AND i.policy_id = p_policy_id;
  v_primary := coalesce(v_source, 'primary') = 'primary';

  SELECT * INTO e FROM private.policy_sale_effective_premium(w, CASE WHEN v_client THEN c.premium END);
  IF e.revision <> p_expected_revision OR e.monthly IS DISTINCT FROM p_expected_effective_monthly THEN
    RAISE EXCEPTION 'The sale premium changed; reload and try again' USING ERRCODE = 'PT409', DETAIL = 'stale_revision';
  END IF;

  IF v_client THEN
    IF v_primary AND c.primary_policy_id IS NOT DISTINCT FROM p_policy_id THEN
      v_present := true; v_raw := coalesce(to_jsonb(c.premium), 'null'::jsonb);
    ELSIF NOT v_primary AND jsonb_typeof(c.custom_fields -> 'additional_policies') = 'array' THEN
      SELECT min(x.i - 1)::integer, count(*) = 1 INTO v_idx, v_present
        FROM jsonb_array_elements(c.custom_fields -> 'additional_policies') WITH ORDINALITY AS x(item, i)
       WHERE x.item ->> 'policyId' = p_policy_id::text;
      v_present := coalesce(v_present, false);
      IF v_present THEN v_raw := coalesce(c.custom_fields -> 'additional_policies' -> v_idx -> 'premiumAmount', 'null'::jsonb); END IF;
    END IF;
  END IF;
  IF (CASE WHEN v_present THEN v_raw ELSE 'null'::jsonb END) IS DISTINCT FROM coalesce(p_expected_book_amount, 'null'::jsonb) THEN
    RAISE EXCEPTION 'The policy record changed; reload and try again' USING ERRCODE = 'PT409', DETAIL = 'policy_changed';
  END IF;

  IF p_corrected_monthly IS NOT DISTINCT FROM e.monthly THEN
    IF e.source = 'legacy_record_fallback' THEN
      v_freeze := true;
    ELSE
      RAISE EXCEPTION 'The corrected premium equals the current sale premium' USING ERRCODE = '22023', DETAIL = 'no_change';
    END IF;
  END IF;

  v_after := v_raw;
  IF p_book_mode = 'keep_current' THEN
    v_action := CASE WHEN v_present THEN 'kept_current' ELSE 'no_policy_record' END;
  ELSIF NOT v_present THEN
    RAISE EXCEPTION 'There is no policy record to update' USING ERRCODE = '22023', DETAIL = 'no_policy_record';
  ELSE
    v_book := private.policy_sale_book_monthly(v_raw, v_primary);
    IF v_book IS NOT DISTINCT FROM p_corrected_monthly THEN
      v_action := 'already_matched';
    ELSIF v_book IS NOT DISTINCT FROM e.monthly THEN
      IF v_primary AND p_corrected_monthly = 0 THEN
        RAISE EXCEPTION 'A primary policy premium of 0 cannot be stored; keep the current record'
          USING ERRCODE = '22023', DETAIL = 'book_zero_unsupported';
      END IF;
      v_after := coalesce(to_jsonb(p_corrected_monthly), 'null'::jsonb);
      IF v_primary THEN
        UPDATE public.clients SET premium = p_corrected_monthly, updated_at = now() WHERE id = c.id;
      ELSE
        UPDATE public.clients
           SET custom_fields = jsonb_set(c.custom_fields, ARRAY['additional_policies', v_idx::text, 'premiumAmount'], v_after),
               updated_at = now()
         WHERE id = c.id;
      END IF;
      v_action := 'updated';
    ELSE
      RAISE EXCEPTION 'The policy record no longer matches the sale; keep the current record'
        USING ERRCODE = '22023', DETAIL = 'book_diverged';
    END IF;
  END IF;

  SELECT h.id INTO v_head FROM private.policy_sale_premium_corrections h
   WHERE h.organization_id = a.org_id AND h.win_id = w.id ORDER BY h.revision DESC LIMIT 1;
  v_result := jsonb_build_object('policy_id', p_policy_id, 'win_id', w.id, 'request_id', p_request_id,
    'revision', e.revision + 1, 'previous_effective_monthly', e.monthly, 'corrected_monthly', p_corrected_monthly,
    'effective_annual', p_corrected_monthly * 12, 'book_action', v_action, 'freeze', v_freeze,
    'sold_date', w.sold_date, 'seller_id', w.agent_id, 'corrected_at', v_at, 'idempotent', false);
  INSERT INTO private.policy_sale_premium_corrections (organization_id, win_id, policy_id, policy_source, buyer_id,
    seller_id, sold_date, revision, supersedes_id, previous_effective_monthly, previous_source, corrected_monthly,
    reason_code, note, book_mode, book_action, book_before, book_after, actor_id, actor_role, request_id,
    payload_hash, result, created_at)
  VALUES (a.org_id, w.id, p_policy_id, CASE WHEN v_primary THEN 'primary' ELSE 'additional' END, w.contact_id,
    w.agent_id, w.sold_date, e.revision + 1, v_head, e.monthly, e.source, p_corrected_monthly,
    p_reason_code, btrim(p_note), p_book_mode, v_action, CASE WHEN v_present THEN v_raw END,
    CASE WHEN v_present THEN v_after END, a.uid, CASE WHEN a.is_super THEN 'Super Admin' ELSE a.actor_role END,
    p_request_id, v_hash, v_result, v_at);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.correct_policy_sale_premium(uuid, uuid, integer, numeric, jsonb, numeric, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Per-contact sale premiums and history (D2 §3.6, D2-16). Visible sales: Admin/Super Admin, the original seller,
-- or a Team Leader ancestor of the seller. The book, request ids and can_correct are for Admin/Super Admin only.
CREATE FUNCTION public.get_client_policy_sale_premiums(p_client_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; v_admin boolean; c public.clients%ROWTYPE; v_client boolean; v_policies jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  v_admin := coalesce(a.actor_role IN ('Admin', 'Super Admin') OR a.is_super, false);
  SELECT * INTO c FROM public.clients WHERE id = p_client_id AND organization_id = a.org_id;
  v_client := FOUND;
  SELECT coalesce(jsonb_agg(p ORDER BY p ->> 'sold_date', p ->> 'policy_id'), '[]'::jsonb) INTO v_policies
    FROM (
      SELECT jsonb_build_object(
        'policy_id', w.policy_id, 'win_id', w.id, 'policy_source', coalesce(i.source, 'primary'),
        'sold_date', w.sold_date, 'seller_id', w.agent_id,
        'seller_name', (SELECT nullif(concat_ws(' ', s.first_name, s.last_name), '') FROM public.profiles s
                         WHERE s.id = w.agent_id AND s.organization_id = a.org_id),
        'original', jsonb_build_object('monthly', o.monthly, 'state', o.state, 'source', o.source),
        'effective', jsonb_build_object('monthly', e.monthly, 'annual', e.monthly * 12, 'source', e.source,
                                        'state', e.state, 'revision', e.revision),
        'book', CASE WHEN v_admin AND b.present THEN jsonb_build_object('raw', b.raw,
                       'monthly', private.policy_sale_book_monthly(b.raw, coalesce(i.source, 'primary') = 'primary'),
                       'present', true,
                       'matches_sale', private.policy_sale_book_monthly(b.raw, coalesce(i.source, 'primary') = 'primary')
                                       IS NOT DISTINCT FROM e.monthly)
                     WHEN v_admin THEN jsonb_build_object('raw', NULL, 'monthly', NULL, 'present', false, 'matches_sale', false)
                END,
        'history', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'revision', h.revision, 'created_at', h.created_at,
                       'actor_name', (SELECT nullif(concat_ws(' ', u.first_name, u.last_name), '') FROM public.profiles u
                                       WHERE u.id = h.actor_id),
                       'previous_effective_monthly', h.previous_effective_monthly, 'corrected_monthly', h.corrected_monthly,
                       'reason_code', h.reason_code, 'note', h.note, 'book_mode', h.book_mode, 'book_action', h.book_action,
                       'request_id', CASE WHEN v_admin THEN h.request_id END) ORDER BY h.revision), '[]'::jsonb)
                      FROM private.policy_sale_premium_corrections h
                     WHERE h.organization_id = a.org_id AND h.win_id = w.id)) AS p
        FROM public.wins w
        LEFT JOIN private.policy_identities i ON i.organization_id = w.organization_id AND i.policy_id = w.policy_id
       CROSS JOIN LATERAL private.policy_sale_original_premium(w, CASE WHEN v_client THEN c.premium END) o
       CROSS JOIN LATERAL private.policy_sale_effective_premium(w, CASE WHEN v_client THEN c.premium END) e
       CROSS JOIN LATERAL (
         SELECT CASE WHEN NOT v_client THEN false
                     WHEN coalesce(i.source, 'primary') = 'primary' THEN c.primary_policy_id IS NOT DISTINCT FROM w.policy_id
                     ELSE (SELECT count(*) = 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields -> 'additional_policies') = 'array'
                                                 THEN c.custom_fields -> 'additional_policies' ELSE '[]'::jsonb END) x
                            WHERE x ->> 'policyId' = w.policy_id::text) END AS present,
                CASE WHEN NOT v_client THEN NULL
                     WHEN coalesce(i.source, 'primary') = 'primary' THEN coalesce(to_jsonb(c.premium), 'null'::jsonb)
                     ELSE (SELECT coalesce(x -> 'premiumAmount', 'null'::jsonb)
                             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields -> 'additional_policies') = 'array'
                                                       THEN c.custom_fields -> 'additional_policies' ELSE '[]'::jsonb END) x
                            WHERE x ->> 'policyId' = w.policy_id::text LIMIT 1) END AS raw) b
       WHERE w.organization_id = a.org_id AND w.contact_id = p_client_id AND w.policy_id IS NOT NULL
         AND (v_admin OR w.agent_id = a.uid
              OR (a.actor_role IN ('Team Leader', 'Team Lead') AND coalesce(public.is_ancestor_of(a.uid, w.agent_id), false)))
    ) s(p);
  RETURN jsonb_build_object('client_id', p_client_id, 'can_correct', v_admin, 'policies', v_policies);
END $$;
REVOKE ALL ON FUNCTION public.get_client_policy_sale_premiums(uuid) FROM PUBLIC, anon, authenticated, service_role;
