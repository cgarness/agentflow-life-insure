-- Phase 2A: saved policy commissions, expected payments and manual receipts.
-- Contract: docs/plans/2026-10-19-policy-commission-phase-2a/implementation_plan.md
-- Approved for LOCAL build and disposable-database testing only. Production application requires Chris's separate
-- Gate 3 approval. Estimates are illustrative; receipts are manually recorded. Neither is carrier-verified, earned,
-- paid, payroll or booked commission.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE policy_commission_preexisting_functions ON COMMIT DROP AS SELECT oid FROM pg_catalog.pg_proc;

-- ── 0. Preimage and replay guards ─────────────────────────────────────────────────────────────────────────────────
DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.create_client_with_sale(uuid,uuid,jsonb,boolean)', '0fd439105c6d171366f47220c63805f3'),
      ('public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)', '3d974a5c893753d5f10cacd9605c565f'),
      ('public.record_client_policy(uuid,uuid,jsonb,boolean)', 'b9ffa1e0b2b1bc9794d70a044f577544'),
      ('public.update_client_with_policy_sale(uuid,jsonb)', '96e8f6e7ecc85d0d5385bf8640a144a6'),
      ('private.insert_policy_sale(uuid,jsonb,text,uuid)', '3f600b757802c0fa8cc1e17fa5c25575'),
      ('public.convert_lead_to_client_atomic(uuid,jsonb)', '641ba66c96ca4a76f80c9c85eb9caa42'),
      ('private.campaign_actor()', 'f582e43731a968fb2e0961e80939ff7e')) v(fn, digest)
  LOOP
    IF to_regprocedure(r.fn) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'policy commission tracking: % differs from the reviewed preimage; refusing', r.fn;
    END IF;
  END LOOP;
  IF to_regclass('public.policy_commission_handoffs') IS NOT NULL
     OR to_regnamespace('policy_commission_authz') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentflow_policy_commission_writer') THEN
    RAISE EXCEPTION 'policy commission tracking is already applied; refusing replay';
  END IF;
  IF to_regclass('private.policy_identities') IS NULL OR to_regclass('private.policy_sale_receipts') IS NULL
     OR to_regclass('public.comp_grids') IS NULL OR to_regclass('public.organization_comp_settings') IS NULL
     OR to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'policy commission tracking requires the sale-identity and commission-grid schema';
  END IF;
END $guard$;

-- ── 1. Restricted writer role and the authorization schema ────────────────────────────────────────────────────────
-- Owns only the commission functions, never a table, so RLS applies to every write it makes. Only postgres is a
-- member (needed for the ownership transfers below); no client role can assume it.
CREATE ROLE agentflow_policy_commission_writer
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT agentflow_policy_commission_writer TO postgres;

CREATE SCHEMA policy_commission_authz;
REVOKE ALL ON SCHEMA policy_commission_authz FROM PUBLIC;
GRANT USAGE ON SCHEMA policy_commission_authz TO authenticated, agentflow_policy_commission_writer;
GRANT USAGE ON SCHEMA public, private TO agentflow_policy_commission_writer;

-- Lets estimates carry one composite foreign key proving organization, policy, sale and seller agree.
CREATE UNIQUE INDEX wins_commission_link_key ON public.wins (id, organization_id, policy_id, agent_id);

-- Mirrors src/hooks/usePermissions.ts (canSeeCommission + normalizePermissions) and DEFAULT_COMMISSION in
-- src/config/permissionDefaults.ts. Defaults are pinned by supabase/tests/fixtures/policy_commission/permission_defaults.json.
-- Only a JSON true grants (stricter than the browser's truthiness); a JSON null element fails closed.
CREATE FUNCTION private.policy_commission_toggle(p_org uuid, p_role text, p_full boolean, p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_key text; v_perms jsonb; v_item jsonb;
BEGIN
  IF p_full THEN RETURN true; END IF;
  v_key := CASE p_role WHEN 'Agent' THEN 'agent' WHEN 'Team Leader' THEN 'teamLeader' END;
  IF v_key IS NULL OR p_org IS NULL THEN RETURN false; END IF;
  SELECT rp.permissions INTO v_perms FROM public.role_permissions rp
   WHERE rp.organization_id = p_org AND rp.role = p_role;
  IF v_perms IS NULL OR jsonb_typeof(v_perms) <> 'object' OR jsonb_typeof(v_perms->'c') IS DISTINCT FROM 'array' THEN
    RETURN p_name = 'View Own Commission Percentage';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_perms->'c') e WHERE jsonb_typeof(e) = 'null') THEN RETURN false; END IF;
  SELECT e INTO v_item FROM jsonb_array_elements(v_perms->'c') WITH ORDINALITY a(e, n)
   WHERE jsonb_typeof(e) = 'object' AND e->>'name' = p_name ORDER BY n LIMIT 1;
  RETURN coalesce(v_item->v_key = 'true'::jsonb, false);
END $$;

-- Audit identity for RLS policies applied to the writer role (which has no USAGE on the auth schema).
CREATE FUNCTION policy_commission_authz.actor_uid()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS 'SELECT auth.uid()';

CREATE FUNCTION policy_commission_authz.actor_org()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  SELECT a.org_id INTO v_org FROM private.campaign_actor() a;
  RETURN v_org;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN NULL;
END $$;

-- 'write' | 'read' | NULL for the real signed-in actor and the credited seller. Never keyed on the client's assignee.
CREATE FUNCTION policy_commission_authz.access(p_agent uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; v_full boolean;
BEGIN
  IF p_agent IS NULL THEN RETURN NULL; END IF;
  BEGIN
    SELECT * INTO a FROM private.campaign_actor();
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN NULL;
  END;
  v_full := a.actor_role = 'Admin' OR coalesce(a.is_super, false);
  IF p_agent = a.uid THEN
    RETURN CASE WHEN private.policy_commission_toggle(a.org_id, a.actor_role, v_full, 'View Own Commission Percentage')
                THEN 'write' END;
  END IF;
  IF NOT private.policy_commission_toggle(a.org_id, a.actor_role, v_full, 'View Others'' Commission Percentage') THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_agent AND p.organization_id = a.org_id) THEN
    RETURN NULL;
  END IF;
  IF v_full THEN RETURN 'write'; END IF;
  IF a.actor_role = 'Team Leader' AND public.is_ancestor_of(a.uid, p_agent) THEN RETURN 'read'; END IF;
  RETURN NULL;
END $$;

-- ── 2. Tables (owned by postgres; RLS enabled; written only by the restricted writer role) ───────────────────────
CREATE TABLE public.policy_commission_handoffs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id),
  actor_id           uuid        NOT NULL,
  sale_kind          text        NOT NULL CHECK (sale_kind IN ('record', 'create', 'convert', 'edit')),
  sale_operation_key text        NOT NULL,
  request_id         uuid        NOT NULL,
  sale_payload_hash  text        NOT NULL CHECK (sale_payload_hash ~ '^[0-9a-f]{64}$'),
  commission_digest  text        NOT NULL CHECK (commission_digest ~ '^[0-9a-f]{64}$'),
  client_id          uuid        NOT NULL,
  credited_agent_id  uuid,
  policy_ids         uuid[]      NOT NULL DEFAULT '{}',
  win_ids            uuid[]      NOT NULL DEFAULT '{}',
  slot_outcomes      jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(slot_outcomes) = 'array'),
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT policy_commission_handoffs_operation UNIQUE (organization_id, sale_operation_key),
  CONSTRAINT policy_commission_handoffs_id_org UNIQUE (id, organization_id)
);

CREATE TABLE public.policy_commission_captures (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  handoff_id          uuid        NOT NULL,
  slot                text        NOT NULL CHECK (slot = 'primary' OR slot ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  policy_id           uuid        NOT NULL,
  win_id              uuid        NOT NULL,
  credited_agent_id   uuid        NOT NULL,
  grid_id             uuid        NOT NULL,
  grid_revision       bigint      NOT NULL CHECK (grid_revision >= 1),
  product_id          uuid        NOT NULL,
  variant_id          uuid        NOT NULL,
  insured_age         integer     NOT NULL CHECK (insured_age BETWEEN 0 AND 100),
  term_years          integer     CHECK (term_years BETWEEN 1 AND 100),
  contract_level      integer     NOT NULL CHECK (contract_level BETWEEN 1 AND 999),
  rate_percent        numeric     NOT NULL CHECK (rate_percent BETWEEN 0 AND 300 AND rate_percent = round(rate_percent, 2)),
  monthly_premium     numeric     NOT NULL CHECK (monthly_premium > 0 AND monthly_premium = round(monthly_premium, 2)),
  first_year_cents    bigint      NOT NULL CHECK (first_year_cents >= 0),
  advance_cents       bigint      NOT NULL CHECK (advance_cents >= 0),
  calculation_version text        NOT NULL CHECK (calculation_version = 'policy-commission-v1'),
  capture_hash        text        NOT NULL CHECK (capture_hash ~ '^[0-9a-f]{64}$'),
  captured_by         uuid        NOT NULL,
  captured_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  status              text        NOT NULL CHECK (status IN ('recorded', 'awaiting_confirmation', 'needs_attention', 'dismissed')),
  attention_code      text        CHECK (attention_code IS NULL OR attention_code ~ '^[a-z_]{3,40}$'),
  status_reason       text        CHECK (status_reason IS NULL OR char_length(status_reason) BETWEEN 3 AND 200),
  status_by           uuid,
  status_at           timestamptz,
  CONSTRAINT policy_commission_captures_handoff_fk FOREIGN KEY (handoff_id, organization_id)
    REFERENCES public.policy_commission_handoffs (id, organization_id),
  CONSTRAINT policy_commission_captures_win_fk FOREIGN KEY (win_id, organization_id, policy_id, credited_agent_id)
    REFERENCES public.wins (id, organization_id, policy_id, agent_id),
  CONSTRAINT policy_commission_captures_slot UNIQUE (handoff_id, slot),
  CONSTRAINT policy_commission_captures_policy UNIQUE (organization_id, policy_id),
  CONSTRAINT policy_commission_captures_link UNIQUE (id, organization_id, policy_id, credited_agent_id),
  CONSTRAINT policy_commission_captures_attention CHECK ((status = 'needs_attention') = (attention_code IS NOT NULL))
);

CREATE TABLE public.policy_commission_estimates (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  policy_id             uuid        NOT NULL,
  win_id                uuid        NOT NULL,
  credited_agent_id     uuid        NOT NULL,
  capture_id            uuid        UNIQUE,
  capture_mode          text        NOT NULL CHECK (capture_mode IN ('sale_entry', 'recorded_later')),
  grid_id               uuid        NOT NULL,
  grid_revision         bigint      NOT NULL CHECK (grid_revision >= 1),
  grid_name             text        NOT NULL,
  grid_effective_date   date        NOT NULL,
  product_id            uuid        NOT NULL,
  product_category      text        NOT NULL CHECK (product_category IN ('term', 'whole_life', 'iul')),
  product_carrier       text        NOT NULL,
  product_name          text        NOT NULL,
  variant_id            uuid        NOT NULL,
  variant_label         text        NOT NULL,
  insured_age           integer     NOT NULL CHECK (insured_age BETWEEN 0 AND 100),
  term_years            integer     CHECK (term_years BETWEEN 1 AND 100),
  contract_level        integer     NOT NULL CHECK (contract_level BETWEEN 1 AND 999),
  rate_percent          numeric     NOT NULL CHECK (rate_percent BETWEEN 0 AND 300 AND rate_percent = round(rate_percent, 2)),
  monthly_premium       numeric     NOT NULL CHECK (monthly_premium > 0 AND monthly_premium = round(monthly_premium, 2)),
  premium_source        text        NOT NULL CHECK (premium_source IN ('sale_snapshot', 'policy_record')),
  annual_premium        numeric     NOT NULL,
  first_year_exact      numeric     NOT NULL,
  advance_exact         numeric     NOT NULL,
  first_year_cents      bigint      NOT NULL,
  advance_cents         bigint      NOT NULL,
  calculation_version   text        NOT NULL CHECK (calculation_version = 'policy-commission-v1'),
  recorded_by           uuid        NOT NULL,
  recorded_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  status                text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'superseded')),
  status_reason         text        CHECK (status_reason IS NULL OR char_length(status_reason) BETWEEN 3 AND 200),
  status_by             uuid,
  status_at             timestamptz,
  superseded_by         uuid        REFERENCES public.policy_commission_estimates(id),
  schedule_start_on     date,
  schedule_start_source text        CHECK (schedule_start_source IN ('effective_date', 'manual')),
  schedule_set_by       uuid,
  schedule_set_at       timestamptz,
  state_revision        bigint      NOT NULL DEFAULT 1 CHECK (state_revision >= 1),
  CONSTRAINT policy_commission_estimates_win_fk FOREIGN KEY (win_id, organization_id, policy_id, credited_agent_id)
    REFERENCES public.wins (id, organization_id, policy_id, agent_id) ON DELETE RESTRICT,
  CONSTRAINT policy_commission_estimates_capture_fk FOREIGN KEY (capture_id, organization_id, policy_id, credited_agent_id)
    REFERENCES public.policy_commission_captures (id, organization_id, policy_id, credited_agent_id),
  CONSTRAINT policy_commission_estimates_link UNIQUE (id, organization_id, policy_id, credited_agent_id),
  CONSTRAINT policy_commission_estimates_mode CHECK ((capture_mode = 'sale_entry') = (capture_id IS NOT NULL)),
  CONSTRAINT policy_commission_estimates_annual CHECK (annual_premium = monthly_premium * 12),
  CONSTRAINT policy_commission_estimates_first_year CHECK (first_year_exact = annual_premium * rate_percent * 0.01),
  CONSTRAINT policy_commission_estimates_advance CHECK (advance_exact = first_year_exact * 0.75),
  CONSTRAINT policy_commission_estimates_cents CHECK (first_year_cents = round(first_year_exact * 100)
                                                      AND advance_cents = round(advance_exact * 100)),
  CONSTRAINT policy_commission_estimates_basis CHECK ((schedule_start_on IS NULL) = (schedule_start_source IS NULL)),
  CONSTRAINT policy_commission_estimates_hold CHECK (status <> 'on_hold' OR status_reason IS NOT NULL)
);
CREATE UNIQUE INDEX policy_commission_estimates_current
  ON public.policy_commission_estimates (organization_id, policy_id) WHERE status IN ('active', 'on_hold');

CREATE TABLE public.policy_commission_installments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  estimate_id       uuid        NOT NULL,
  policy_id         uuid        NOT NULL,
  credited_agent_id uuid        NOT NULL,
  kind              text        NOT NULL CHECK (kind IN ('advance', 'month_10', 'month_11', 'month_12')),
  sequence          smallint    NOT NULL CHECK (sequence BETWEEN 1 AND 4),
  expected_cents    bigint      NOT NULL CHECK (expected_cents >= 0),
  timing_precision  text        NOT NULL DEFAULT 'unknown' CHECK (timing_precision IN ('unknown', 'month', 'date')),
  expected_on       date        CHECK (expected_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  timing_source     text        NOT NULL DEFAULT 'unset' CHECK (timing_source IN ('unset', 'schedule_basis', 'manual')),
  timing_set_by     uuid,
  timing_set_at     timestamptz,
  CONSTRAINT policy_commission_installments_estimate_fk FOREIGN KEY (estimate_id, organization_id, policy_id, credited_agent_id)
    REFERENCES public.policy_commission_estimates (id, organization_id, policy_id, credited_agent_id),
  CONSTRAINT policy_commission_installments_kind UNIQUE (estimate_id, kind),
  CONSTRAINT policy_commission_installments_link UNIQUE (id, estimate_id, organization_id, policy_id, credited_agent_id),
  CONSTRAINT policy_commission_installments_sequence CHECK (sequence = CASE kind WHEN 'advance' THEN 1 WHEN 'month_10' THEN 2
                                                                                WHEN 'month_11' THEN 3 ELSE 4 END),
  CONSTRAINT policy_commission_installments_timing CHECK ((timing_precision = 'unknown') = (expected_on IS NULL)
    AND (timing_precision <> 'month' OR extract(day FROM expected_on) = 1)
    AND ((timing_source = 'unset') = (timing_precision = 'unknown'))
    AND (timing_source <> 'schedule_basis' OR kind <> 'advance'))
);

CREATE TABLE public.policy_commission_receipts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  installment_id      uuid        NOT NULL,
  estimate_id         uuid        NOT NULL,
  policy_id           uuid        NOT NULL,
  credited_agent_id   uuid        NOT NULL,
  request_id          uuid        NOT NULL,
  payload_hash        text        NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  amount_cents        bigint      NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  received_on         date        NOT NULL CHECK (received_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  reference           text        CHECK (reference IS NULL OR (char_length(reference) BETWEEN 1 AND 200 AND reference = btrim(reference))),
  entry_method        text        NOT NULL DEFAULT 'manual' CHECK (entry_method = 'manual'),
  recorded_by         uuid        NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  replaces_receipt_id uuid        UNIQUE REFERENCES public.policy_commission_receipts(id),
  voided_at           timestamptz,
  voided_by           uuid,
  void_reason         text        CHECK (void_reason IS NULL OR char_length(void_reason) BETWEEN 3 AND 200),
  CONSTRAINT policy_commission_receipts_installment_fk
    FOREIGN KEY (installment_id, estimate_id, organization_id, policy_id, credited_agent_id)
    REFERENCES public.policy_commission_installments (id, estimate_id, organization_id, policy_id, credited_agent_id),
  CONSTRAINT policy_commission_receipts_request UNIQUE (organization_id, request_id),
  CONSTRAINT policy_commission_receipts_void CHECK ((voided_at IS NULL) = (voided_by IS NULL)
                                                   AND (voided_at IS NULL) = (void_reason IS NULL))
);

CREATE TABLE public.policy_commission_events (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   uuid        NOT NULL,
  estimate_id       uuid        NOT NULL,
  policy_id         uuid        NOT NULL,
  credited_agent_id uuid        NOT NULL,
  installment_id    uuid,
  receipt_id        uuid,
  event_type        text        NOT NULL CHECK (event_type IN ('estimate_recorded', 'estimate_replaced', 'schedule_basis_set',
                                  'installment_timing_set', 'hold_placed', 'hold_released', 'receipt_voided')),
  request_id        uuid,
  payload_hash      text        CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id          uuid        NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason            text        CHECK (reason IS NULL OR char_length(reason) BETWEEN 3 AND 200),
  before_state      jsonb,
  after_state       jsonb,
  result            jsonb,
  CONSTRAINT policy_commission_events_estimate_fk FOREIGN KEY (estimate_id, organization_id, policy_id, credited_agent_id)
    REFERENCES public.policy_commission_estimates (id, organization_id, policy_id, credited_agent_id),
  CONSTRAINT policy_commission_events_request CHECK ((request_id IS NULL) = (payload_hash IS NULL))
);
CREATE UNIQUE INDEX policy_commission_events_request
  ON public.policy_commission_events (organization_id, request_id) WHERE request_id IS NOT NULL;

CREATE INDEX policy_commission_handoffs_client ON public.policy_commission_handoffs (organization_id, client_id);
CREATE INDEX policy_commission_captures_handoff ON public.policy_commission_captures (handoff_id);
CREATE INDEX policy_commission_captures_win ON public.policy_commission_captures (win_id, organization_id, policy_id, credited_agent_id);
CREATE INDEX policy_commission_estimates_agent ON public.policy_commission_estimates (organization_id, credited_agent_id);
CREATE INDEX policy_commission_estimates_win ON public.policy_commission_estimates (win_id, organization_id, policy_id, credited_agent_id);
CREATE INDEX policy_commission_estimates_policy ON public.policy_commission_estimates (organization_id, policy_id);
CREATE INDEX policy_commission_estimates_capture
  ON public.policy_commission_estimates (capture_id, organization_id, policy_id, credited_agent_id);
CREATE INDEX policy_commission_estimates_superseded_by ON public.policy_commission_estimates (superseded_by);
CREATE INDEX policy_commission_installments_estimate
  ON public.policy_commission_installments (estimate_id, organization_id, policy_id, credited_agent_id);
CREATE INDEX policy_commission_receipts_installment
  ON public.policy_commission_receipts (installment_id, estimate_id, organization_id, policy_id, credited_agent_id);
CREATE INDEX policy_commission_receipts_estimate ON public.policy_commission_receipts (estimate_id);
CREATE INDEX policy_commission_events_estimate
  ON public.policy_commission_events (estimate_id, organization_id, policy_id, credited_agent_id);

-- Supabase default privileges would grant every client role ALL on new public tables; start from nothing.
DO $privileges$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policy_commission_handoffs', 'policy_commission_captures', 'policy_commission_estimates',
                           'policy_commission_installments', 'policy_commission_receipts', 'policy_commission_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO agentflow_policy_commission_writer', t);
    -- Read: same agency and commission access to the credited seller. No Agency Group peer policy.
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = '
                   '(SELECT policy_commission_authz.actor_org()) AND policy_commission_authz.access(credited_agent_id) IS NOT NULL)',
                   t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO agentflow_policy_commission_writer USING '
                   '(organization_id = (SELECT policy_commission_authz.actor_org()))', t || '_writer_select', t);
  END LOOP;
END $privileges$;
REVOKE ALL ON SEQUENCE public.policy_commission_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.policy_commission_events_id_seq TO agentflow_policy_commission_writer;

GRANT UPDATE (status, attention_code, status_reason, status_by, status_at)
  ON public.policy_commission_captures TO agentflow_policy_commission_writer;
GRANT UPDATE (status, status_reason, status_by, status_at, superseded_by, schedule_start_on, schedule_start_source,
              schedule_set_by, schedule_set_at, state_revision)
  ON public.policy_commission_estimates TO agentflow_policy_commission_writer;
GRANT UPDATE (timing_precision, expected_on, timing_source, timing_set_by, timing_set_at)
  ON public.policy_commission_installments TO agentflow_policy_commission_writer;
GRANT UPDATE (voided_at, voided_by, void_reason) ON public.policy_commission_receipts TO agentflow_policy_commission_writer;

-- Operation-specific write policies for the restricted writer; each re-resolves the real JWT/profile actor. The actor
-- lookups are wrapped in (SELECT ...) so they run once per statement (InitPlan), not once per row.
CREATE POLICY policy_commission_handoffs_writer_insert ON public.policy_commission_handoffs FOR INSERT
  TO agentflow_policy_commission_writer
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org()) AND actor_id = (SELECT policy_commission_authz.actor_uid()));
CREATE POLICY policy_commission_captures_writer_insert ON public.policy_commission_captures FOR INSERT
  TO agentflow_policy_commission_writer
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org())
              AND captured_by = (SELECT policy_commission_authz.actor_uid())
              AND policy_commission_authz.access(credited_agent_id) IS NOT NULL);
CREATE POLICY policy_commission_captures_writer_update ON public.policy_commission_captures FOR UPDATE
  TO agentflow_policy_commission_writer
  USING (organization_id = (SELECT policy_commission_authz.actor_org())
         AND (policy_commission_authz.access(credited_agent_id) = 'write' OR captured_by = (SELECT policy_commission_authz.actor_uid())))
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org())
              AND (policy_commission_authz.access(credited_agent_id) = 'write' OR captured_by = (SELECT policy_commission_authz.actor_uid())));
CREATE POLICY policy_commission_estimates_writer_insert ON public.policy_commission_estimates FOR INSERT
  TO agentflow_policy_commission_writer
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org())
              AND recorded_by = (SELECT policy_commission_authz.actor_uid())
              AND policy_commission_authz.access(credited_agent_id) = 'write');
CREATE POLICY policy_commission_estimates_writer_update ON public.policy_commission_estimates FOR UPDATE
  TO agentflow_policy_commission_writer
  USING (organization_id = (SELECT policy_commission_authz.actor_org()) AND policy_commission_authz.access(credited_agent_id) = 'write')
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org()) AND policy_commission_authz.access(credited_agent_id) = 'write');
CREATE POLICY policy_commission_installments_writer_insert ON public.policy_commission_installments FOR INSERT
  TO agentflow_policy_commission_writer
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org()) AND policy_commission_authz.access(credited_agent_id) = 'write');
CREATE POLICY policy_commission_installments_writer_update ON public.policy_commission_installments FOR UPDATE
  TO agentflow_policy_commission_writer
  USING (organization_id = (SELECT policy_commission_authz.actor_org()) AND policy_commission_authz.access(credited_agent_id) = 'write')
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org()) AND policy_commission_authz.access(credited_agent_id) = 'write');
CREATE POLICY policy_commission_receipts_writer_insert ON public.policy_commission_receipts FOR INSERT
  TO agentflow_policy_commission_writer
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org())
              AND recorded_by = (SELECT policy_commission_authz.actor_uid())
              AND policy_commission_authz.access(credited_agent_id) = 'write');
CREATE POLICY policy_commission_receipts_writer_update ON public.policy_commission_receipts FOR UPDATE
  TO agentflow_policy_commission_writer
  USING (organization_id = (SELECT policy_commission_authz.actor_org()) AND policy_commission_authz.access(credited_agent_id) = 'write')
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org())
              AND voided_by = (SELECT policy_commission_authz.actor_uid())
              AND policy_commission_authz.access(credited_agent_id) = 'write');
CREATE POLICY policy_commission_events_writer_insert ON public.policy_commission_events FOR INSERT
  TO agentflow_policy_commission_writer
  WITH CHECK (organization_id = (SELECT policy_commission_authz.actor_org())
              AND actor_id = (SELECT policy_commission_authz.actor_uid())
              AND policy_commission_authz.access(credited_agent_id) = 'write');

-- ── 3. Guards: retention, immutability and writer-only changes ───────────────────────────────────────────────────
CREATE FUNCTION private.policy_commission_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_mutable text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Commission records are retained; use a void, replacement or hold' USING ERRCODE = '23514';
  END IF;
  IF current_user <> 'agentflow_policy_commission_writer' THEN
    RAISE EXCEPTION 'Commission records change only through AgentFlow commission functions' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  v_mutable := CASE TG_TABLE_NAME
    WHEN 'policy_commission_captures' THEN ARRAY['status', 'attention_code', 'status_reason', 'status_by', 'status_at']
    WHEN 'policy_commission_estimates' THEN ARRAY['status', 'status_reason', 'status_by', 'status_at', 'superseded_by',
      'schedule_start_on', 'schedule_start_source', 'schedule_set_by', 'schedule_set_at', 'state_revision']
    WHEN 'policy_commission_installments' THEN ARRAY['timing_precision', 'expected_on', 'timing_source', 'timing_set_by', 'timing_set_at']
    WHEN 'policy_commission_receipts' THEN ARRAY['voided_at', 'voided_by', 'void_reason']
    ELSE ARRAY[]::text[] END;
  IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION '% rows are immutable apart from their audited state', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  -- Field access goes through jsonb: one trigger function serves tables with different columns.
  IF TG_TABLE_NAME = 'policy_commission_captures' AND to_jsonb(OLD)->>'status' IN ('recorded', 'dismissed') THEN
    RAISE EXCEPTION 'A recorded or dismissed capture is final' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'policy_commission_receipts' AND to_jsonb(OLD)->>'voided_at' IS NOT NULL THEN
    RAISE EXCEPTION 'A voided receipt is final' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'policy_commission_estimates' AND to_jsonb(OLD)->>'status' = 'superseded'
     AND ((to_jsonb(NEW) - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by')
          OR to_jsonb(OLD)->>'superseded_by' IS NOT NULL) THEN
    RAISE EXCEPTION 'A superseded estimate is final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $guards$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policy_commission_handoffs', 'policy_commission_captures', 'policy_commission_estimates',
                           'policy_commission_installments', 'policy_commission_receipts', 'policy_commission_events'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION private.policy_commission_guard()', t || '_guard', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT '
                   'EXECUTE FUNCTION private.policy_commission_guard()', t || '_retain', t);
  END LOOP;
END $guards$;

-- Immediate (never deferred): exactly four installments summing to the rounded first-year amount.
CREATE FUNCTION private.policy_commission_installments_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- UNIQUE (estimate_id, kind) means an estimate's four rows must all arrive in its first installment statement, so
  -- checking the statement's own rows is complete.
  IF EXISTS (
    SELECT 1 FROM (SELECT estimate_id, count(*) AS k, count(DISTINCT kind) AS kinds, sum(expected_cents) AS total
                     FROM new_rows GROUP BY estimate_id) n
    JOIN public.policy_commission_estimates e ON e.id = n.estimate_id
    WHERE n.k <> 4 OR n.kinds <> 4 OR n.total <> e.first_year_cents) THEN
    RAISE EXCEPTION 'An estimate needs exactly four installments that sum to its first-year amount' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER policy_commission_installments_complete AFTER INSERT ON public.policy_commission_installments
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.policy_commission_installments_complete();

-- ── 4. Read-only private helpers (postgres-owned; EXECUTE only by the writer role) ───────────────────────────────
-- Each derives the actor and organization itself and checks its own target relationships and permissions.

-- Proves the sale operation: its receipt exists for this actor, payload hash and win ids; every win belongs to the
-- receipt's client in the actor's organization and matches the operation kind.
CREATE FUNCTION private.policy_commission_operation_facts(p_kind text, p_key text, p_request_id uuid, p_sale_hash text,
                                                          p_win_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; r private.policy_sale_receipts%ROWTYPE; v_expected text; v_wins jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  v_expected := CASE p_kind
    WHEN 'record' THEN 'policy:' || p_request_id
    WHEN 'create' THEN 'manual:' || a.uid || ':' || p_request_id
    WHEN 'edit' THEN 'client-edit:' || a.uid || ':' || p_request_id
    WHEN 'convert' THEN CASE WHEN p_key ~ '^conversion:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_key END
  END;
  IF p_request_id IS NULL OR v_expected IS NULL OR v_expected <> p_key THEN
    RAISE EXCEPTION 'Sale operation key does not match' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM private.policy_sale_receipts WHERE organization_id = a.org_id AND operation_key = p_key;
  IF NOT FOUND OR r.actor_id <> a.uid OR r.payload_hash <> p_sale_hash
     OR (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(r.win_ids) x)
        IS DISTINCT FROM (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(coalesce(p_win_ids, '{}')) x) THEN
    RAISE EXCEPTION 'Sale operation evidence does not match' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'win_id', w.id, 'policy_id', w.policy_id, 'agent_id', w.agent_id,
           'role', CASE WHEN p_kind IN ('record', 'edit') OR w.idempotency_key = p_key THEN 'primary' ELSE 'additional' END)
         ORDER BY w.idempotency_key), '[]'::jsonb)
    INTO v_wins
    FROM public.wins w
    JOIN private.policy_identities pi
      ON pi.organization_id = w.organization_id AND pi.policy_id = w.policy_id AND pi.client_id = w.contact_id
   WHERE w.id = ANY (r.win_ids) AND w.organization_id = a.org_id AND w.contact_id = r.client_id
     AND CASE p_kind
           WHEN 'record' THEN w.idempotency_key = p_key AND w.policy_id = p_request_id
           WHEN 'create' THEN w.idempotency_key = p_key AND pi.source = 'primary'
           WHEN 'edit' THEN w.idempotency_key = 'policy:' || w.policy_id AND pi.source = 'primary'
           ELSE (w.idempotency_key = p_key AND pi.source = 'primary')
                OR (w.idempotency_key LIKE p_key || ':policy:%' AND pi.source = 'additional')
         END;
  IF jsonb_array_length(v_wins) <> cardinality(r.win_ids)
     OR (SELECT count(*) FROM jsonb_array_elements(v_wins) x WHERE x->>'role' = 'primary') > 1 THEN
    RAISE EXCEPTION 'Sale operation evidence does not match' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('client_id', r.client_id, 'wins', v_wins);
END $$;

-- Sale and current policy facts for policies whose seller the actor may at least read.
CREATE FUNCTION private.policy_commission_policy_facts(p_policy_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; v jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'policy_id', w.policy_id, 'win_id', w.id, 'client_id', w.contact_id, 'agent_id', w.agent_id,
           'source', pi.source, 'premium_amount', w.premium_amount, 'premium_snapshot', w.premium_snapshot,
           'policy_type', coalesce(nullif(w.policy_type, ''), CASE pi.source WHEN 'primary' THEN c.policy_type
                                                                    ELSE ap.item->>'policyType' END),
           'sold_date', w.sold_date, 'event_time_source', w.event_time_source,
           'carrier', CASE pi.source WHEN 'primary' THEN c.carrier ELSE ap.item->>'carrier' END,
           'policy_premium', CASE pi.source WHEN 'primary' THEN c.premium::text ELSE ap.item->>'premiumAmount' END,
           'effective_date', CASE pi.source WHEN 'primary' THEN c.effective_date ELSE ap.item->>'effectiveDate' END)), '[]'::jsonb)
    INTO v
    FROM public.wins w
    JOIN private.policy_identities pi
      ON pi.organization_id = w.organization_id AND pi.policy_id = w.policy_id AND pi.client_id = w.contact_id
    LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
    LEFT JOIN LATERAL (
      SELECT x AS item FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies') = 'array'
                                                      THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) x
       WHERE jsonb_typeof(x) = 'object' AND x->>'policyId' = w.policy_id::text LIMIT 1) ap ON pi.source = 'additional'
   WHERE w.organization_id = a.org_id AND w.policy_id = ANY (p_policy_ids)
     AND policy_commission_authz.access(w.agent_id) IS NOT NULL;
  RETURN v;
END $$;

-- The agency's selected active grid (read once), the seller's raw level, and per item the product, the unique variant
-- for the age/term (matching src/lib/commission/matching.ts) and the rate at the seller's strict level.
CREATE FUNCTION private.policy_commission_grid_facts(p_agent uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; g record; v_raw text; v_level integer; v_out jsonb := '[]'::jsonb; it jsonb; pr record;
  v_age integer; v_term integer; v_termed boolean; v_count integer; v_variant_id uuid; v_variant_label text; v_kind text;
  v_rate text;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF policy_commission_authz.access(p_agent) IS NULL THEN
    RAISE EXCEPTION 'Commission access denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Invalid commission items' USING ERRCODE = '22023';
  END IF;
  SELECT gr.id, gr.revision, gr.name, gr.effective_date, gr.contract_levels INTO g
    FROM public.organization_comp_settings s
    JOIN public.comp_grids gr ON gr.id = s.calculator_grid_id AND gr.is_active
   WHERE s.organization_id = a.org_id
     AND (gr.organization_id = a.org_id OR (gr.organization_id IS NULL AND EXISTS (
            SELECT 1 FROM public.organization_comp_grids x WHERE x.organization_id = a.org_id AND x.grid_id = gr.id)));
  IF NOT FOUND THEN RETURN jsonb_build_object('grid', NULL, 'items', '[]'::jsonb); END IF;
  SELECT p.commission_level INTO v_raw FROM public.profiles p WHERE p.id = p_agent AND p.organization_id = a.org_id;
  v_level := CASE WHEN v_raw ~ '^\s*\d{1,9}%?\s*$' THEN substring(v_raw FROM '\d{1,9}')::integer END;
  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_age := (it->>'age')::integer;
    v_term := (it->>'term')::integer;
    SELECT p.id, p.category, p.carrier, p.product_name, p.is_active INTO pr
      FROM public.comp_products p WHERE p.id = (it->>'product_id')::uuid AND p.grid_id = g.id;
    IF NOT FOUND THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', it->>'key', 'product', NULL));
      CONTINUE;
    END IF;
    v_termed := EXISTS (SELECT 1 FROM public.comp_product_variants v WHERE v.product_id = pr.id AND v.term_years IS NOT NULL);
    v_variant_id := NULL; v_variant_label := NULL; v_rate := NULL;
    IF v_termed AND v_term IS NULL THEN
      v_kind := 'term_required';
    ELSIF NOT v_termed AND v_term IS NOT NULL THEN
      v_kind := 'term_not_applicable';
    ELSE
      SELECT count(*) INTO v_count FROM public.comp_product_variants v
       WHERE v.product_id = pr.id
         AND (v.min_age IS NULL OR v_age >= v.min_age) AND (v.max_age IS NULL OR v_age <= v.max_age)
         AND (NOT v_termed OR v_term = ANY (v.term_years));
      IF v_count > 1 THEN
        v_kind := 'ambiguous';
      ELSIF v_count = 1 THEN
        v_kind := 'matched';
        SELECT v.id, v.label INTO v_variant_id, v_variant_label FROM public.comp_product_variants v
         WHERE v.product_id = pr.id
           AND (v.min_age IS NULL OR v_age >= v.min_age) AND (v.max_age IS NULL OR v_age <= v.max_age)
           AND (NOT v_termed OR v_term = ANY (v.term_years));
        IF v_level IS NOT NULL THEN
          SELECT r.rate_percent::text INTO v_rate FROM public.comp_rates r
           WHERE r.variant_id = v_variant_id AND r.contract_level = v_level;
        END IF;
      ELSIF v_termed AND NOT EXISTS (SELECT 1 FROM public.comp_product_variants v
                                      WHERE v.product_id = pr.id AND v_term = ANY (v.term_years)) THEN
        v_kind := 'no_term';
      ELSIF NOT EXISTS (SELECT 1 FROM public.comp_product_variants v WHERE v.product_id = pr.id
                          AND (v.min_age IS NULL OR v_age >= v.min_age) AND (v.max_age IS NULL OR v_age <= v.max_age)) THEN
        v_kind := 'no_age';
      ELSE
        v_kind := 'no_age_term_combination';
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', it->>'key',
      'product', jsonb_build_object('id', pr.id, 'category', pr.category, 'carrier', pr.carrier,
                                    'name', pr.product_name, 'active', pr.is_active),
      'match', jsonb_build_object('kind', v_kind, 'variant_id', v_variant_id, 'label', v_variant_label),
      'rate', v_rate));
  END LOOP;
  RETURN jsonb_build_object(
    'grid', jsonb_build_object('id', g.id, 'revision', g.revision, 'name', g.name, 'effective_date', g.effective_date,
                               'levels', to_jsonb(g.contract_levels)),
    'level_raw', v_raw, 'level', v_level, 'items', v_out);
END $$;

-- Structural validation of the commission payload. Raises 22023; never trims or repairs.
CREATE FUNCTION private.policy_commission_valid_slot(p jsonb, p_with_slot boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  -- Fails closed: any NULL along the way (missing key, empty object) is false, never unknown.
  SELECT coalesce(jsonb_typeof(p) = 'object'
     AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) =
         (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY['credited_agent_id', 'grid_id', 'grid_revision', 'product_id',
            'variant_id', 'insured_age', 'term_years', 'contract_level', 'rate_percent', 'monthly_premium',
            'first_year_cents', 'advance_cents'] || CASE WHEN p_with_slot THEN ARRAY['slot'] ELSE ARRAY[]::text[] END) k)
     AND (NOT p_with_slot OR (jsonb_typeof(p->'slot') = 'string'
          AND (p->>'slot' = 'primary' OR p->>'slot' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')))
     AND (SELECT bool_and(jsonb_typeof(p->k) = 'string'
                          AND p->>k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            FROM unnest(ARRAY['credited_agent_id', 'grid_id', 'product_id', 'variant_id']) k)
     AND (SELECT bool_and(jsonb_typeof(p->k) = 'number' AND (p->>k)::numeric = trunc((p->>k)::numeric)
                          AND (p->>k)::numeric BETWEEN 0 AND 1000000000000)
            FROM unnest(ARRAY['grid_revision', 'insured_age', 'contract_level', 'first_year_cents', 'advance_cents']) k)
     AND (p->>'insured_age')::numeric <= 100 AND (p->>'grid_revision')::numeric >= 1
     AND (p->>'contract_level')::numeric BETWEEN 1 AND 999
     AND (jsonb_typeof(p->'term_years') = 'null' OR (jsonb_typeof(p->'term_years') = 'number'
          AND (p->>'term_years')::numeric = trunc((p->>'term_years')::numeric) AND (p->>'term_years')::numeric BETWEEN 1 AND 100))
     AND jsonb_typeof(p->'rate_percent') = 'string' AND p->>'rate_percent' ~ '^\d{1,3}(\.\d{1,6})?$'
     AND (p->>'rate_percent')::numeric <= 300
     AND (p->>'rate_percent')::numeric = round((p->>'rate_percent')::numeric, 2)
     AND jsonb_typeof(p->'monthly_premium') = 'string' AND p->>'monthly_premium' ~ '^\d{1,9}(\.\d{1,2})?$'
     AND (p->>'monthly_premium')::numeric > 0, false)
$$;

CREATE FUNCTION private.policy_commission_validate_payload(p jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) IS DISTINCT FROM ARRAY['slots', 'v']
     OR p->>'v' IS DISTINCT FROM 'policy-commission-v1'
     OR jsonb_typeof(p->'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'slots') > 100
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'slots') s WHERE NOT private.policy_commission_valid_slot(s, true))
     OR (SELECT count(*) <> count(DISTINCT s->>'slot') FROM jsonb_array_elements(p->'slots') s) IS NOT FALSE THEN
    RAISE EXCEPTION 'Invalid commission payload' USING ERRCODE = '22023';
  END IF;
END $$;

-- The server calculator: validates presented inputs against current facts and recomputes exactly
-- (src/lib/commission/estimate.ts). Returns {ok:false, code} on any difference; never a different figure.
CREATE FUNCTION private.policy_commission_evaluate(p_presented jsonb, p_policy jsonb, p_grid jsonb, p_item jsonb, p_mode text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_cats text[]; v_level integer; v_rate numeric; v_premium numeric; v_source text; v_pp text;
  v_annual numeric; v_fy numeric; v_adv numeric; v_fyc bigint; v_advc bigint; v_r bigint; v_b bigint;
  fail CONSTANT text := '{"ok":false}';
BEGIN
  IF p_presented->>'credited_agent_id' IS DISTINCT FROM p_policy->>'agent_id' THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'agent_changed'); END IF;
  IF p_grid->'grid' IS NULL OR jsonb_typeof(p_grid->'grid') = 'null' THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'grid_unavailable'); END IF;
  IF p_grid->'grid'->>'id' IS DISTINCT FROM p_presented->>'grid_id'
     OR (p_grid->'grid'->>'revision')::bigint IS DISTINCT FROM (p_presented->>'grid_revision')::bigint THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'grid_changed'); END IF;
  IF p_item IS NULL OR jsonb_typeof(p_item->'product') IS DISTINCT FROM 'object'
     OR NOT (p_item->'product'->>'active')::boolean THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'product_unavailable'); END IF;
  v_cats := CASE p_policy->>'policy_type' WHEN 'Term' THEN ARRAY['term'] WHEN 'Whole Life' THEN ARRAY['whole_life']
                                          WHEN 'IUL' THEN ARRAY['iul'] WHEN 'Final Expense' THEN ARRAY['whole_life']
                                          ELSE ARRAY[]::text[] END;
  IF NOT (p_item->'product'->>'category' = ANY (v_cats))
     OR lower(regexp_replace(coalesce(p_item->'product'->>'carrier', ''), '^\s+|\s+$', '', 'g'))
        <> lower(regexp_replace(coalesce(p_policy->>'carrier', ''), '^\s+|\s+$', '', 'g'))
     OR btrim(coalesce(p_policy->>'carrier', '')) = '' THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'policy_mismatch'); END IF;
  IF p_item->'match'->>'kind' IS DISTINCT FROM 'matched' THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'not_available'); END IF;
  IF p_item->'match'->>'variant_id' IS DISTINCT FROM p_presented->>'variant_id' THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'variant_changed'); END IF;
  v_level := (p_grid->>'level')::integer;
  IF v_level IS NULL OR NOT (p_grid->'grid'->'levels' @> to_jsonb(v_level))
     OR v_level <> (p_presented->>'contract_level')::integer THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'level_changed'); END IF;
  IF p_item->>'rate' IS NULL THEN RETURN fail::jsonb || jsonb_build_object('code', 'not_available'); END IF;
  v_rate := (p_item->>'rate')::numeric;
  IF v_rate <> (p_presented->>'rate_percent')::numeric THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'rate_changed'); END IF;
  IF coalesce((p_policy->>'premium_snapshot')::boolean, false) AND (p_policy->>'premium_amount')::numeric > 0 THEN
    v_premium := (p_policy->>'premium_amount')::numeric; v_source := 'sale_snapshot';
  ELSIF p_mode = 'recorded_later' THEN
    v_pp := regexp_replace(coalesce(p_policy->>'policy_premium', ''), '[,$[:space:]]', '', 'g');
    IF v_pp ~ '^\d+(\.\d{1,2})?$' AND v_pp::numeric > 0 THEN v_premium := v_pp::numeric; v_source := 'policy_record'; END IF;
  END IF;
  IF v_premium IS NULL OR v_premium <> (p_presented->>'monthly_premium')::numeric THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'premium_mismatch'); END IF;
  v_annual := v_premium * 12;
  v_fy := v_annual * v_rate * 0.01;
  v_adv := v_fy * 0.75;
  v_fyc := round(v_fy * 100)::bigint;
  v_advc := round(v_adv * 100)::bigint;
  IF v_fyc <> (p_presented->>'first_year_cents')::bigint OR v_advc <> (p_presented->>'advance_cents')::bigint THEN
    RETURN fail::jsonb || jsonb_build_object('code', 'amount_changed'); END IF;
  v_r := v_fyc - v_advc;
  v_b := v_r / 3;
  RETURN jsonb_build_object('ok', true, 'premium', v_premium, 'premium_source', v_source, 'annual', v_annual,
    'first_year', v_fy, 'advance', v_adv, 'first_year_cents', v_fyc, 'advance_cents', v_advc,
    'month_10', v_b + CASE WHEN v_r - 3 * v_b >= 1 THEN 1 ELSE 0 END,
    'month_11', v_b + CASE WHEN v_r - 3 * v_b >= 2 THEN 1 ELSE 0 END,
    'month_12', v_b,
    'grid_name', p_grid->'grid'->>'name', 'grid_effective_date', p_grid->'grid'->>'effective_date',
    'product_category', p_item->'product'->>'category', 'product_carrier', p_item->'product'->>'carrier',
    'product_name', p_item->'product'->>'name', 'variant_label', coalesce(p_item->'match'->>'label', ''),
    'level', v_level, 'rate', v_rate);
END $$;

-- ── 5. Writer-owned internals: estimate insertion and slot state ──────────────────────────────────────────────────
CREATE FUNCTION private.policy_commission_insert_estimate(
  p_id uuid, p_actor uuid, p_policy jsonb, p_presented jsonb, p_eval jsonb, p_capture_id uuid, p_mode text,
  p_request_id uuid, p_request_hash text, p_carry jsonb, p_status text, p_status_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid := policy_commission_authz.actor_org(); v_est public.policy_commission_estimates%ROWTYPE; v_installments jsonb;
BEGIN
  INSERT INTO public.policy_commission_estimates (
    id, organization_id, policy_id, win_id, credited_agent_id, capture_id, capture_mode, grid_id, grid_revision, grid_name,
    grid_effective_date, product_id, product_category, product_carrier, product_name, variant_id, variant_label,
    insured_age, term_years, contract_level, rate_percent, monthly_premium, premium_source, annual_premium,
    first_year_exact, advance_exact, first_year_cents, advance_cents, calculation_version, recorded_by,
    status, status_reason, status_by, status_at, schedule_start_on, schedule_start_source, schedule_set_by, schedule_set_at)
  VALUES (
    coalesce(p_id, gen_random_uuid()), v_org, (p_policy->>'policy_id')::uuid, (p_policy->>'win_id')::uuid,
    (p_policy->>'agent_id')::uuid, p_capture_id, p_mode, (p_presented->>'grid_id')::uuid,
    (p_presented->>'grid_revision')::bigint, p_eval->>'grid_name', (p_eval->>'grid_effective_date')::date,
    (p_presented->>'product_id')::uuid, p_eval->>'product_category', p_eval->>'product_carrier', p_eval->>'product_name',
    (p_presented->>'variant_id')::uuid, p_eval->>'variant_label', (p_presented->>'insured_age')::integer,
    (p_presented->>'term_years')::integer, (p_presented->>'contract_level')::integer, (p_eval->>'rate')::numeric,
    (p_eval->>'premium')::numeric, p_eval->>'premium_source', (p_eval->>'annual')::numeric,
    (p_eval->>'first_year')::numeric, (p_eval->>'advance')::numeric, (p_eval->>'first_year_cents')::bigint,
    (p_eval->>'advance_cents')::bigint, 'policy-commission-v1', p_actor,
    coalesce(p_status, 'active'), p_status_reason,
    CASE WHEN p_status = 'on_hold' THEN p_actor END, CASE WHEN p_status = 'on_hold' THEN clock_timestamp() END,
    (p_carry->>'schedule_start_on')::date, p_carry->>'schedule_start_source',
    CASE WHEN p_carry->>'schedule_start_on' IS NOT NULL THEN p_actor END,
    CASE WHEN p_carry->>'schedule_start_on' IS NOT NULL THEN clock_timestamp() END)
  RETURNING * INTO v_est;
  WITH ins AS (
    INSERT INTO public.policy_commission_installments (organization_id, estimate_id, policy_id, credited_agent_id, kind,
      sequence, expected_cents, timing_precision, expected_on, timing_source, timing_set_by, timing_set_at)
    SELECT v_org, v_est.id, v_est.policy_id, v_est.credited_agent_id, k.kind, k.seq, k.cents,
           coalesce(t->>'timing_precision', 'unknown'), (t->>'expected_on')::date, coalesce(t->>'timing_source', 'unset'),
           CASE WHEN t IS NOT NULL AND t->>'timing_source' <> 'unset' THEN p_actor END,
           CASE WHEN t IS NOT NULL AND t->>'timing_source' <> 'unset' THEN clock_timestamp() END
      FROM (VALUES ('advance', 1, (p_eval->>'advance_cents')::bigint), ('month_10', 2, (p_eval->>'month_10')::bigint),
                   ('month_11', 3, (p_eval->>'month_11')::bigint), ('month_12', 4, (p_eval->>'month_12')::bigint)) k(kind, seq, cents)
      LEFT JOIN LATERAL (SELECT p_carry->'installments'->k.kind AS t) c ON true
    RETURNING id, kind, sequence, expected_cents, timing_precision, expected_on, timing_source)
  SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'expected_cents', expected_cents, 'timing_precision', timing_precision,
                                      'expected_on', expected_on, 'timing_source', timing_source) ORDER BY sequence)
    INTO v_installments FROM ins;
  -- Baseline audit: the same shape as policy_commission_estimate_state, built from the inserted rows.
  INSERT INTO public.policy_commission_events (organization_id, estimate_id, policy_id, credited_agent_id, event_type,
    request_id, payload_hash, actor_id, reason, after_state, result)
  VALUES (v_org, v_est.id, v_est.policy_id, v_est.credited_agent_id, 'estimate_recorded', p_request_id, p_request_hash,
          p_actor, NULL, jsonb_build_object('estimate_id', v_est.id, 'status', v_est.status, 'status_reason', v_est.status_reason,
            'capture_mode', v_est.capture_mode, 'first_year_cents', v_est.first_year_cents, 'advance_cents', v_est.advance_cents,
            'schedule_start_on', v_est.schedule_start_on, 'schedule_start_source', v_est.schedule_start_source,
            'state_revision', v_est.state_revision, 'installments', v_installments),
          jsonb_build_object('estimate_id', v_est.id, 'status', 'recorded'));
  RETURN jsonb_build_object('estimate_id', v_est.id, 'status', 'recorded');
END $$;

-- Complete auditable state of an estimate's mutable fields (no free-text references).
CREATE FUNCTION private.policy_commission_estimate_state(p_estimate_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('estimate_id', e.id, 'status', e.status, 'status_reason', e.status_reason,
    'capture_mode', e.capture_mode, 'first_year_cents', e.first_year_cents, 'advance_cents', e.advance_cents,
    'schedule_start_on', e.schedule_start_on, 'schedule_start_source', e.schedule_start_source,
    'state_revision', e.state_revision,
    'installments', (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'expected_cents', i.expected_cents,
                       'timing_precision', i.timing_precision, 'expected_on', i.expected_on, 'timing_source', i.timing_source)
                       ORDER BY i.sequence)
                       FROM public.policy_commission_installments i WHERE i.estimate_id = e.id))
  FROM public.policy_commission_estimates e WHERE e.id = p_estimate_id
$$;

CREATE FUNCTION private.policy_commission_slot_states(p_handoff_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'slot', o->>'slot', 'policy_id', o->>'policy_id',
           'status', coalesce(c.status, 'not_recorded'),
           'code', CASE WHEN c.id IS NULL THEN o->>'outcome' ELSE c.attention_code END) ORDER BY n), '[]'::jsonb)
    FROM public.policy_commission_handoffs h
    CROSS JOIN LATERAL jsonb_array_elements(h.slot_outcomes) WITH ORDINALITY s(o, n)
    LEFT JOIN public.policy_commission_captures c ON c.handoff_id = h.id AND c.slot = o->>'slot'
   WHERE h.id = p_handoff_id
$$;

-- ── 6. The handoff (writer-owned; EXECUTE only by postgres-owned sale companions) ────────────────────────────────
CREATE FUNCTION private.policy_commission_handoff(p_mode text, p_kind text, p_key text, p_request_id uuid,
  p_sale_hash text, p_client_id uuid, p_win_ids uuid[], p_commission jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_uid uuid := policy_commission_authz.actor_uid();
  v_org uuid := policy_commission_authz.actor_org();
  v_started timestamptz := clock_timestamp();
  v_payload jsonb; v_digest text; v_facts jsonb; v_h public.policy_commission_handoffs%ROWTYPE;
  v_slot jsonb; v_win jsonb; v_wins jsonb; v_outcomes jsonb := '[]'::jsonb; v_access text; v_seller uuid;
  v_cap public.policy_commission_captures%ROWTYPE;
  v_policies jsonb; v_grid jsonb; v_items jsonb; v_eval jsonb; v_policy jsonb; v_item_map jsonb; v_presented jsonb;
  v_recorded uuid[] := '{}'; v_codes jsonb := '{}';
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Commission actor unavailable' USING ERRCODE = '42501';
  END IF;
  v_payload := coalesce(p_commission, jsonb_build_object('v', 'policy-commission-v1', 'slots', '[]'::jsonb));
  v_digest := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  IF p_mode = 'replay' THEN
    SELECT * INTO v_h FROM public.policy_commission_handoffs WHERE organization_id = v_org AND sale_operation_key = p_key;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_recorded', 'reason', 'no_entry_evidence', 'slots', '[]'::jsonb);
    END IF;
    IF v_h.request_id <> p_request_id OR v_h.sale_payload_hash <> p_sale_hash OR v_h.actor_id <> v_uid THEN
      RETURN jsonb_build_object('status', 'other_operation', 'slots', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('status', CASE WHEN v_h.commission_digest = v_digest THEN 'evidence_recorded' ELSE 'already_captured' END,
                              'slots', private.policy_commission_slot_states(v_h.id));
  ELSIF p_mode IS DISTINCT FROM 'create' THEN
    RAISE EXCEPTION 'Invalid handoff mode' USING ERRCODE = '22023';
  END IF;

  PERFORM private.policy_commission_validate_payload(v_payload);
  v_facts := private.policy_commission_operation_facts(p_kind, p_key, p_request_id, p_sale_hash, p_win_ids);
  IF (v_facts->>'client_id')::uuid IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'Sale operation evidence does not match' USING ERRCODE = '22023';
  END IF;
  SELECT CASE WHEN count(DISTINCT x->>'agent_id') = 1 AND bool_and(x->>'agent_id' IS NOT NULL)
              THEN min(x->>'agent_id')::uuid END
    INTO v_seller FROM jsonb_array_elements(v_facts->'wins') x;

  -- Slot keys: 'primary' is the operation's main policy; a conversion's additional rows are keyed by their row UUID.
  SELECT coalesce(jsonb_object_agg(CASE WHEN x->>'role' = 'primary' THEN 'primary' ELSE x->>'policy_id' END, x), '{}')
    INTO v_wins FROM jsonb_array_elements(v_facts->'wins') x WHERE x->>'role' = 'primary' OR p_kind = 'convert';
  FOR v_slot IN SELECT value FROM jsonb_array_elements(v_payload->'slots') LOOP
    v_win := v_wins->(v_slot->>'slot');
    IF v_win IS NULL THEN
      RAISE EXCEPTION 'A commission slot does not match this sale' USING ERRCODE = '22023';
    END IF;
    v_access := CASE WHEN v_win->>'agent_id' IS NULL OR v_slot->>'credited_agent_id' IS DISTINCT FROM v_win->>'agent_id' THEN NULL
                     ELSE policy_commission_authz.access((v_win->>'agent_id')::uuid) END;
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
      'slot', v_slot->>'slot', 'policy_id', v_win->>'policy_id', 'win_id', v_win->>'win_id', 'access', v_access,
      'outcome', CASE WHEN v_slot->>'credited_agent_id' IS DISTINCT FROM v_win->>'agent_id' THEN 'agent_changed'
                      WHEN v_access IS NULL THEN 'not_permitted' ELSE 'captured' END,
      'presented', v_slot - 'slot'));
  END LOOP;

  INSERT INTO public.policy_commission_handoffs (organization_id, actor_id, sale_kind, sale_operation_key, request_id,
    sale_payload_hash, commission_digest, client_id, credited_agent_id, policy_ids, win_ids, slot_outcomes)
  VALUES (v_org, v_uid, p_kind, p_key, p_request_id, p_sale_hash, v_digest, p_client_id, v_seller,
    ARRAY(SELECT (x->>'policy_id')::uuid FROM jsonb_array_elements(v_facts->'wins') x),
    ARRAY(SELECT (x->>'win_id')::uuid FROM jsonb_array_elements(v_facts->'wins') x),
    (SELECT coalesce(jsonb_agg(o - 'presented' - 'access'), '[]'::jsonb) FROM jsonb_array_elements(v_outcomes) o))
  RETURNING * INTO v_h;

  INSERT INTO public.policy_commission_captures (organization_id, handoff_id, slot, policy_id, win_id, credited_agent_id,
    grid_id, grid_revision, product_id, variant_id, insured_age, term_years, contract_level, rate_percent, monthly_premium,
    first_year_cents, advance_cents, calculation_version, capture_hash, captured_by, status, attention_code)
  SELECT v_org, v_h.id, o->>'slot', (o->>'policy_id')::uuid, (o->>'win_id')::uuid, (p->>'credited_agent_id')::uuid,
         (p->>'grid_id')::uuid, (p->>'grid_revision')::bigint, (p->>'product_id')::uuid, (p->>'variant_id')::uuid,
         (p->>'insured_age')::integer, (p->>'term_years')::integer, (p->>'contract_level')::integer,
         (p->>'rate_percent')::numeric, (p->>'monthly_premium')::numeric, (p->>'first_year_cents')::bigint,
         (p->>'advance_cents')::bigint, 'policy-commission-v1', encode(sha256(convert_to(p::text, 'UTF8')), 'hex'), v_uid,
         CASE WHEN o->>'access' = 'write' THEN 'needs_attention' ELSE 'awaiting_confirmation' END,
         CASE WHEN o->>'access' = 'write' THEN 'pending_calculation' END
    FROM jsonb_array_elements(v_outcomes) o CROSS JOIN LATERAL (SELECT o->'presented' AS p) x
   WHERE o->>'outcome' = 'captured';

  -- Optional calculation under the aggregate budget. Every failure here keeps the evidence and captures. Facts are read
  -- once for all slots; each slot's estimate is written in its own savepoint; capture statuses are set afterwards in
  -- two set-based updates (fewer RLS-checked statements per slot).
  IF v_seller IS NOT NULL AND EXISTS (SELECT 1 FROM public.policy_commission_captures c
                                       WHERE c.handoff_id = v_h.id AND c.attention_code = 'pending_calculation') THEN
    BEGIN
      SELECT jsonb_agg(jsonb_build_object('key', c.slot, 'product_id', c.product_id, 'age', c.insured_age, 'term', c.term_years))
        INTO v_items FROM public.policy_commission_captures c WHERE c.handoff_id = v_h.id AND c.attention_code = 'pending_calculation';
      SELECT coalesce(jsonb_object_agg(x->>'policy_id', x), '{}') INTO v_policies
        FROM jsonb_array_elements(private.policy_commission_policy_facts(ARRAY(SELECT c.policy_id FROM public.policy_commission_captures c
               WHERE c.handoff_id = v_h.id AND c.attention_code = 'pending_calculation'))) x;
      v_grid := private.policy_commission_grid_facts(v_seller, v_items);
      SELECT coalesce(jsonb_object_agg(x->>'key', x), '{}') INTO v_item_map FROM jsonb_array_elements(v_grid->'items') x;
      FOR v_cap IN SELECT c.* FROM public.policy_commission_captures c
                    WHERE c.handoff_id = v_h.id AND c.attention_code = 'pending_calculation' ORDER BY c.slot = 'primary' DESC, c.slot LOOP
        IF clock_timestamp() - v_started > interval '250 milliseconds' THEN
          v_codes := v_codes || jsonb_build_object(v_cap.id::text, 'budget_exhausted');
          CONTINUE;
        END IF;
        v_presented := private.policy_commission_capture_presented(v_cap);
        v_policy := v_policies->(v_cap.policy_id::text);
        BEGIN
          v_eval := private.policy_commission_evaluate(v_presented, v_policy, v_grid, v_item_map->v_cap.slot, 'sale_entry');
          IF v_policy IS NOT NULL AND (v_eval->>'ok')::boolean THEN
            PERFORM private.policy_commission_insert_estimate(NULL, v_uid, v_policy, v_presented, v_eval, v_cap.id, 'sale_entry',
                                                              NULL, NULL, NULL, 'active', NULL);
            v_recorded := v_recorded || v_cap.id;
          ELSE
            v_codes := v_codes || jsonb_build_object(v_cap.id::text, coalesce(v_eval->>'code', 'policy_unavailable'));
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_codes := v_codes || jsonb_build_object(v_cap.id::text, 'calculation_failed');
        END;
      END LOOP;
      UPDATE public.policy_commission_captures SET status = 'recorded', attention_code = NULL, status_by = v_uid,
             status_at = clock_timestamp() WHERE id = ANY (v_recorded);
      UPDATE public.policy_commission_captures c SET attention_code = v_codes->>(c.id::text)
       WHERE c.id IN (SELECT k::uuid FROM jsonb_object_keys(v_codes) k);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.policy_commission_captures SET attention_code = 'calculation_failed'
       WHERE handoff_id = v_h.id AND attention_code = 'pending_calculation';
    END;
  END IF;
  UPDATE public.policy_commission_captures SET attention_code = 'calculation_failed'
   WHERE handoff_id = v_h.id AND attention_code = 'pending_calculation';
  RETURN jsonb_build_object('status', 'evidence_recorded', 'slots', private.policy_commission_slot_states(v_h.id));
END $$;

CREATE FUNCTION private.policy_commission_capture_presented(c public.policy_commission_captures)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('credited_agent_id', c.credited_agent_id, 'grid_id', c.grid_id, 'grid_revision', c.grid_revision,
    'product_id', c.product_id, 'variant_id', c.variant_id, 'insured_age', c.insured_age, 'term_years', c.term_years,
    'contract_level', c.contract_level, 'rate_percent', c.rate_percent::text, 'monthly_premium', c.monthly_premium::text,
    'first_year_cents', c.first_year_cents, 'advance_cents', c.advance_cents)
$$;

-- ── 7. Sale companions (postgres-owned sale wrappers; the writer bodies stay unchanged) ──────────────────────────
-- All optional commission work runs in one savepoint. WHEN OTHERS does not catch query_canceled, so a genuine
-- cancellation or statement timeout still aborts the whole request (the sale included); it is never swallowed.
CREATE FUNCTION private.policy_sale_commission_step(p_kind text, p_key text, p_request_id uuid, p_sale_hash text,
                                                    p_sale jsonb, p_created boolean, p_commission jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb; v_prev text := current_setting('lock_timeout');
BEGIN
  BEGIN
    PERFORM set_config('lock_timeout', '100ms', true);
    v := private.policy_commission_handoff(CASE WHEN p_created THEN 'create' ELSE 'replay' END, p_kind, p_key, p_request_id,
      p_sale_hash, (p_sale->>'client_id')::uuid,
      ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(p_sale->'win_ids', '[]'::jsonb)) x), p_commission);
    PERFORM set_config('lock_timeout', v_prev, true);
  EXCEPTION WHEN OTHERS THEN
    v := jsonb_build_object('status', CASE WHEN p_created THEN 'not_recorded' ELSE 'unavailable' END,
                            'reason', 'handoff_failed', 'slots', '[]'::jsonb);
  END;
  RETURN v;
END $$;

CREATE FUNCTION public.record_client_policy_handoff(p_request_id uuid, p_client_id uuid, p_policy jsonb,
  p_primary boolean DEFAULT false, p_commission jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_sale jsonb;
BEGIN
  BEGIN
    v_sale := public.record_client_policy(p_request_id, p_client_id, p_policy, p_primary);
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM = 'Policy request already saved different details' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = SQLERRM, DETAIL = 'sale_operation_conflict';
    END IF;
    RAISE;
  END;
  RETURN v_sale || jsonb_build_object('commission', private.policy_sale_commission_step('record', 'policy:' || p_request_id,
    p_request_id, encode(sha256(convert_to(jsonb_build_array(p_client_id, p_policy, p_primary)::text, 'UTF8')), 'hex'),
    v_sale, NOT coalesce((v_sale->>'idempotent')::boolean, false), p_commission));
END $$;

CREATE FUNCTION public.create_client_with_sale_handoff(p_request_id uuid, p_expected_org uuid, p_client jsonb,
  p_record_sale boolean, p_commission jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_sale jsonb; v_uid uuid;
BEGIN
  BEGIN
    v_sale := public.create_client_with_sale(p_request_id, p_expected_org, p_client, p_record_sale);
  EXCEPTION WHEN invalid_parameter_value OR insufficient_privilege THEN
    IF SQLERRM IN ('This request already saved different details; refresh the client before editing',
                   'Previously saved client is no longer available') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = SQLERRM, DETAIL = 'sale_operation_conflict';
    END IF;
    RAISE;
  END;
  IF NOT coalesce(p_record_sale, false) THEN
    RETURN v_sale || jsonb_build_object('commission', jsonb_build_object('status', 'not_applicable', 'slots', '[]'::jsonb));
  END IF;
  SELECT a.uid INTO v_uid FROM private.campaign_actor() a;
  RETURN v_sale || jsonb_build_object('commission', private.policy_sale_commission_step('create',
    'manual:' || v_uid || ':' || p_request_id, p_request_id,
    encode(sha256(convert_to(jsonb_build_array(p_client, p_record_sale)::text, 'UTF8')), 'hex'),
    v_sale, NOT coalesce((v_sale->>'idempotent')::boolean, false), p_commission));
END $$;

CREATE FUNCTION public.convert_lead_to_client_with_sales_handoff(p_request_id uuid, p_lead_id uuid, p_expected_org uuid,
  p_client jsonb, p_campaign_id uuid DEFAULT NULL, p_commission jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_sale jsonb;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing conversion request' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_sale := public.convert_lead_to_client_with_sales(p_lead_id, p_expected_org, p_client, p_campaign_id);
  EXCEPTION
    WHEN invalid_parameter_value OR insufficient_privilege OR serialization_failure THEN
      IF SQLERRM IN ('This lead is already converted; refresh the client before editing',
                     'Conversion retry belongs to another actor', 'Previously converted client is no longer available',
                     'Lead was converted concurrently; refresh before retrying') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = SQLERRM, DETAIL = 'sale_operation_conflict';
      END IF;
      RAISE;
  END;
  RETURN v_sale || jsonb_build_object('commission', private.policy_sale_commission_step('convert', 'conversion:' || p_lead_id,
    p_request_id, encode(sha256(convert_to(jsonb_build_array(p_client, p_campaign_id)::text, 'UTF8')), 'hex'),
    v_sale, NOT coalesce((v_sale->>'idempotent')::boolean, false), p_commission));
END $$;

-- D7: receipt-bearing first-policy edit; delegates to the unchanged update_client_with_policy_sale.
CREATE FUNCTION public.update_client_with_policy_sale_handoff(p_request_id uuid, p_client_id uuid, p_patch jsonb,
  p_commission jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; v_key text; v_patch jsonb; v_hash text; r private.policy_sale_receipts%ROWTYPE; c public.clients%ROWTYPE;
  v_sale jsonb; v_created boolean;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF p_request_id IS NULL OR p_client_id IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid client edit' USING ERRCODE = '22023';
  END IF;
  v_patch := p_patch - 'updated_at';
  v_key := 'client-edit:' || a.uid || ':' || p_request_id;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_client_id, v_patch)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(a.org_id || ':' || v_key, 0));
  SELECT * INTO r FROM private.policy_sale_receipts WHERE organization_id = a.org_id AND operation_key = v_key;
  IF FOUND THEN
    IF r.actor_id <> a.uid OR r.payload_hash <> v_hash OR r.client_id <> p_client_id THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'This edit request already saved different details',
        DETAIL = 'sale_operation_conflict';
    END IF;
    SELECT * INTO c FROM public.clients WHERE id = r.client_id AND organization_id = a.org_id;
    IF NOT FOUND OR NOT coalesce(c.assigned_agent_id = a.uid OR a.actor_role = 'Admin' OR a.is_super
        OR (a.actor_role IN ('Team Leader', 'Team Lead') AND public.is_ancestor_of(a.uid, c.assigned_agent_id)), false) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Previously saved client is no longer available',
        DETAIL = 'sale_operation_conflict';
    END IF;
    v_sale := jsonb_build_object('client', to_jsonb(c), 'client_id', c.id, 'win_ids', to_jsonb(r.win_ids), 'idempotent', true);
    v_created := false;
  ELSE
    v_sale := public.update_client_with_policy_sale(p_client_id, v_patch);
    INSERT INTO private.policy_sale_receipts (organization_id, operation_key, actor_id, payload_hash, client_id, win_ids)
    VALUES (a.org_id, v_key, a.uid, v_hash, p_client_id,
            ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(v_sale->'win_ids', '[]'::jsonb)) x));
    v_sale := v_sale || jsonb_build_object('idempotent', false);
    v_created := true;
  END IF;
  IF jsonb_array_length(coalesce(v_sale->'win_ids', '[]'::jsonb)) = 0 THEN
    RETURN v_sale || jsonb_build_object('commission', jsonb_build_object('status', 'no_new_policy', 'slots', '[]'::jsonb));
  END IF;
  RETURN v_sale || jsonb_build_object('commission', private.policy_sale_commission_step('edit', v_key, p_request_id, v_hash,
    v_sale, v_created, p_commission));
END $$;

-- ── 8. Tracking write functions (writer-owned; EXECUTE authenticated) ────────────────────────────────────────────
-- Shared request idempotency: returns the stored result for the same request and payload, refuses a changed one.
CREATE FUNCTION private.policy_commission_replay(p_request_id uuid, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid := policy_commission_authz.actor_org(); ev public.policy_commission_events%ROWTYPE;
BEGIN
  IF v_org IS NULL OR policy_commission_authz.actor_uid() IS NULL THEN
    RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing request id' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org || ':policy-commission:' || p_request_id, 0));
  SELECT * INTO ev FROM public.policy_commission_events WHERE organization_id = v_org AND request_id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF ev.payload_hash <> p_hash OR ev.actor_id <> policy_commission_authz.actor_uid() THEN
    RAISE EXCEPTION 'This request already saved different details' USING ERRCODE = '22023';
  END IF;
  RETURN ev.result;
END $$;

CREATE FUNCTION private.policy_commission_lock_estimate(p_estimate_id uuid, p_expected_revision bigint, p_allow_superseded boolean)
RETURNS public.policy_commission_estimates LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE e public.policy_commission_estimates%ROWTYPE;
BEGIN
  -- Authorize on a plain read first: a read-only viewer's FOR UPDATE would be filtered by the writer's UPDATE
  -- policy and misreport "not found".
  SELECT * INTO e FROM public.policy_commission_estimates
   WHERE id = p_estimate_id AND organization_id = policy_commission_authz.actor_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission estimate not found' USING ERRCODE = 'PT404'; END IF;
  IF policy_commission_authz.access(e.credited_agent_id) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Not authorized to change this commission' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.policy_commission_estimates WHERE id = p_estimate_id FOR UPDATE;
  IF e.status = 'superseded' AND NOT p_allow_superseded THEN
    RAISE EXCEPTION 'This estimate was replaced' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NOT NULL AND e.state_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Commission changed elsewhere; refresh and try again' USING ERRCODE = 'PT409', DETAIL = 'stale_revision';
  END IF;
  RETURN e;
END $$;

-- Bumps the revision and writes the audit event whose result is what a replay of the same request returns.
CREATE FUNCTION private.policy_commission_record_event(e public.policy_commission_estimates, p_type text, p_request_id uuid,
  p_hash text, p_reason text, p_before jsonb, p_installment uuid, p_receipt uuid, p_extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  UPDATE public.policy_commission_estimates SET state_revision = state_revision + 1 WHERE id = e.id;
  v_result := jsonb_build_object('estimate_id', e.id, 'state_revision', e.state_revision + 1, 'status', 'ok') || p_extra;
  INSERT INTO public.policy_commission_events (organization_id, estimate_id, policy_id, credited_agent_id, installment_id,
    receipt_id, event_type, request_id, payload_hash, actor_id, reason, before_state, after_state, result)
  VALUES (e.organization_id, e.id, e.policy_id, e.credited_agent_id, p_installment, p_receipt, p_type, p_request_id, p_hash,
          policy_commission_authz.actor_uid(), p_reason, p_before, private.policy_commission_estimate_state(e.id), v_result);
  RETURN v_result;
END $$;

CREATE FUNCTION public.confirm_policy_commission_capture(p_request_id uuid, p_capture_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_hash text := encode(sha256(convert_to(jsonb_build_array('confirm', p_capture_id)::text, 'UTF8')), 'hex');
  v_prior jsonb; c public.policy_commission_captures%ROWTYPE; v_policy jsonb; v_grid jsonb; v_eval jsonb; v_presented jsonb;
  v_res jsonb; v_uid uuid := policy_commission_authz.actor_uid();
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT * INTO c FROM public.policy_commission_captures
   WHERE id = p_capture_id AND organization_id = policy_commission_authz.actor_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission capture not found' USING ERRCODE = 'PT404'; END IF;
  IF policy_commission_authz.access(c.credited_agent_id) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Not authorized to confirm this commission' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.policy_commission_captures WHERE id = p_capture_id FOR UPDATE;
  IF c.status NOT IN ('awaiting_confirmation', 'needs_attention') THEN
    RAISE EXCEPTION 'This capture is no longer open' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.policy_commission_estimates e WHERE e.organization_id = c.organization_id
               AND e.policy_id = c.policy_id AND e.status IN ('active', 'on_hold')) THEN
    RAISE EXCEPTION 'A commission estimate is already recorded for this policy' USING ERRCODE = '22023';
  END IF;
  v_presented := private.policy_commission_capture_presented(c);
  SELECT x INTO v_policy FROM jsonb_array_elements(private.policy_commission_policy_facts(ARRAY[c.policy_id])) x;
  v_grid := private.policy_commission_grid_facts(c.credited_agent_id, jsonb_build_array(jsonb_build_object(
    'key', c.slot, 'product_id', c.product_id, 'age', c.insured_age, 'term', c.term_years)));
  v_eval := private.policy_commission_evaluate(v_presented, v_policy, v_grid, v_grid->'items'->0, 'sale_entry');
  IF v_policy IS NULL OR NOT (v_eval->>'ok')::boolean THEN
    UPDATE public.policy_commission_captures SET status = 'needs_attention',
           attention_code = coalesce(v_eval->>'code', 'policy_unavailable') WHERE id = c.id;
    RETURN jsonb_build_object('status', 'needs_attention', 'code', coalesce(v_eval->>'code', 'policy_unavailable'));
  END IF;
  v_res := private.policy_commission_insert_estimate(NULL, v_uid, v_policy, v_presented, v_eval, c.id, 'sale_entry',
                                                     p_request_id, v_hash, NULL, 'active', NULL);
  UPDATE public.policy_commission_captures SET status = 'recorded', attention_code = NULL, status_by = v_uid,
         status_at = clock_timestamp() WHERE id = c.id;
  RETURN v_res;
END $$;

CREATE FUNCTION public.dismiss_policy_commission_capture(p_request_id uuid, p_capture_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c public.policy_commission_captures%ROWTYPE; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF policy_commission_authz.actor_org() IS NULL THEN
    RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'A dismissal needs a reason of 3 to 200 characters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.policy_commission_captures
   WHERE id = p_capture_id AND organization_id = policy_commission_authz.actor_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission capture not found' USING ERRCODE = 'PT404'; END IF;
  IF policy_commission_authz.access(c.credited_agent_id) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Not authorized to dismiss this commission' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.policy_commission_captures WHERE id = p_capture_id FOR UPDATE;
  IF c.status = 'dismissed' AND c.status_by = policy_commission_authz.actor_uid() AND c.status_reason = v_reason THEN
    RETURN jsonb_build_object('status', 'dismissed', 'capture_id', c.id);
  END IF;
  IF c.status NOT IN ('awaiting_confirmation', 'needs_attention') THEN
    RAISE EXCEPTION 'This capture is no longer open' USING ERRCODE = '22023';
  END IF;
  UPDATE public.policy_commission_captures SET status = 'dismissed', attention_code = NULL, status_reason = v_reason,
         status_by = policy_commission_authz.actor_uid(), status_at = clock_timestamp() WHERE id = c.id;
  RETURN jsonb_build_object('status', 'dismissed', 'capture_id', c.id);
END $$;

-- Re-entry ("recorded later", current rates) and D4 replacement of a current estimate without active receipts.
CREATE FUNCTION public.record_policy_commission_estimate_later(p_request_id uuid, p_policy_id uuid, p_inputs jsonb,
  p_replace_estimate_id uuid DEFAULT NULL, p_expected_revision bigint DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_hash text := encode(sha256(convert_to(jsonb_build_array('later', p_policy_id, p_inputs, p_replace_estimate_id,
          p_expected_revision, p_reason)::text, 'UTF8')), 'hex');
  v_prior jsonb; v_policy jsonb; v_grid jsonb; v_eval jsonb; old public.policy_commission_estimates%ROWTYPE;
  v_new uuid := gen_random_uuid(); v_carry jsonb; v_res jsonb; v_uid uuid := policy_commission_authz.actor_uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_before jsonb;
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT private.policy_commission_valid_slot(p_inputs, false) THEN
    RAISE EXCEPTION 'Invalid commission inputs' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_policy FROM jsonb_array_elements(private.policy_commission_policy_facts(ARRAY[p_policy_id])) x;
  IF v_policy IS NULL THEN RAISE EXCEPTION 'Policy sale not found' USING ERRCODE = 'PT404'; END IF;
  IF policy_commission_authz.access((v_policy->>'agent_id')::uuid) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Not authorized to record this commission' USING ERRCODE = '42501';
  END IF;
  IF p_replace_estimate_id IS NOT NULL THEN
    old := private.policy_commission_lock_estimate(p_replace_estimate_id, p_expected_revision, false);
    IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Replacement needs the loaded revision' USING ERRCODE = '22023'; END IF;
    IF old.policy_id <> p_policy_id THEN RAISE EXCEPTION 'Estimate belongs to another policy' USING ERRCODE = '22023'; END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200 THEN
      RAISE EXCEPTION 'A replacement needs a reason of 3 to 200 characters' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.policy_commission_receipts r WHERE r.estimate_id = old.id AND r.voided_at IS NULL) THEN
      RAISE EXCEPTION 'Void the recorded payments before replacing this estimate' USING ERRCODE = '22023';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.policy_commission_estimates e WHERE e.organization_id = policy_commission_authz.actor_org()
                  AND e.policy_id = p_policy_id AND e.status IN ('active', 'on_hold')) THEN
    RAISE EXCEPTION 'A commission estimate is already recorded for this policy' USING ERRCODE = '22023';
  END IF;
  v_grid := private.policy_commission_grid_facts((v_policy->>'agent_id')::uuid, jsonb_build_array(jsonb_build_object(
    'key', 'later', 'product_id', p_inputs->>'product_id', 'age', (p_inputs->>'insured_age')::integer,
    'term', (p_inputs->>'term_years')::integer)));
  v_eval := private.policy_commission_evaluate(p_inputs, v_policy, v_grid, v_grid->'items'->0, 'recorded_later');
  IF NOT (v_eval->>'ok')::boolean THEN
    RETURN jsonb_build_object('status', 'changed', 'code', v_eval->>'code');
  END IF;
  IF p_replace_estimate_id IS NOT NULL THEN
    v_before := private.policy_commission_estimate_state(old.id);
    v_carry := jsonb_build_object('schedule_start_on', old.schedule_start_on, 'schedule_start_source', old.schedule_start_source,
      'installments', (SELECT jsonb_object_agg(i.kind, jsonb_build_object('timing_precision', i.timing_precision,
                         'expected_on', i.expected_on, 'timing_source', i.timing_source))
                         FROM public.policy_commission_installments i WHERE i.estimate_id = old.id));
    UPDATE public.policy_commission_estimates SET status = 'superseded', status_reason = v_reason, status_by = v_uid,
           status_at = clock_timestamp(), state_revision = state_revision + 1 WHERE id = old.id;
  END IF;
  v_res := private.policy_commission_insert_estimate(v_new, v_uid, v_policy, p_inputs, v_eval, NULL, 'recorded_later',
             p_request_id, v_hash, v_carry, CASE WHEN old.status = 'on_hold' THEN 'on_hold' ELSE 'active' END,
             CASE WHEN old.status = 'on_hold' THEN old.status_reason END);
  IF p_replace_estimate_id IS NOT NULL THEN
    UPDATE public.policy_commission_estimates SET superseded_by = v_new WHERE id = old.id;
    INSERT INTO public.policy_commission_events (organization_id, estimate_id, policy_id, credited_agent_id, event_type,
      actor_id, reason, before_state, after_state, result)
    VALUES (old.organization_id, old.id, old.policy_id, old.credited_agent_id, 'estimate_replaced', v_uid, v_reason,
            v_before, private.policy_commission_estimate_state(old.id), jsonb_build_object('replacement_id', v_new));
  END IF;
  RETURN v_res;
END $$;

CREATE FUNCTION public.set_policy_commission_schedule_basis(p_request_id uuid, p_estimate_id uuid, p_expected_revision bigint,
  p_start_on date, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_hash text := encode(sha256(convert_to(jsonb_build_array('basis', p_estimate_id, p_expected_revision, p_start_on,
          p_source)::text, 'UTF8')), 'hex');
  v_prior jsonb; e public.policy_commission_estimates%ROWTYPE; v_before jsonb; v_policy jsonb; v_uid uuid := policy_commission_authz.actor_uid();
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  e := private.policy_commission_lock_estimate(p_estimate_id, p_expected_revision, false);
  IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Missing revision' USING ERRCODE = '22023'; END IF;
  IF (p_start_on IS NULL) <> (p_source IS NULL) OR (p_source IS NOT NULL AND p_source NOT IN ('effective_date', 'manual'))
     OR p_start_on NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Invalid schedule basis' USING ERRCODE = '22023';
  END IF;
  IF p_source = 'effective_date' THEN
    SELECT x INTO v_policy FROM jsonb_array_elements(private.policy_commission_policy_facts(ARRAY[e.policy_id])) x;
    IF v_policy->>'effective_date' IS DISTINCT FROM p_start_on::text THEN
      RAISE EXCEPTION 'The policy effective date changed; refresh and try again' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_before := private.policy_commission_estimate_state(e.id);
  UPDATE public.policy_commission_estimates SET schedule_start_on = p_start_on, schedule_start_source = p_source,
         schedule_set_by = v_uid, schedule_set_at = clock_timestamp() WHERE id = e.id;
  UPDATE public.policy_commission_installments i
     SET timing_precision = CASE WHEN p_start_on IS NULL THEN 'unknown' ELSE 'month' END,
         expected_on = CASE WHEN p_start_on IS NULL THEN NULL
                            ELSE (date_trunc('month', p_start_on) + make_interval(months => i.sequence + 7))::date END,
         timing_source = CASE WHEN p_start_on IS NULL THEN 'unset' ELSE 'schedule_basis' END,
         timing_set_by = v_uid, timing_set_at = clock_timestamp()
   WHERE i.estimate_id = e.id AND i.kind <> 'advance' AND i.timing_source IN ('unset', 'schedule_basis');
  RETURN private.policy_commission_record_event(e, 'schedule_basis_set', p_request_id, v_hash, NULL, v_before, NULL, NULL);
END $$;

CREATE FUNCTION public.set_policy_commission_installment_timing(p_request_id uuid, p_installment_id uuid,
  p_expected_revision bigint, p_precision text, p_expected_on date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_hash text := encode(sha256(convert_to(jsonb_build_array('timing', p_installment_id, p_expected_revision, p_precision,
          p_expected_on)::text, 'UTF8')), 'hex');
  v_prior jsonb; i public.policy_commission_installments%ROWTYPE; e public.policy_commission_estimates%ROWTYPE; v_before jsonb;
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT * INTO i FROM public.policy_commission_installments
   WHERE id = p_installment_id AND organization_id = policy_commission_authz.actor_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found' USING ERRCODE = 'PT404'; END IF;
  e := private.policy_commission_lock_estimate(i.estimate_id, p_expected_revision, false);
  IF p_expected_revision IS NULL OR p_precision NOT IN ('unknown', 'month', 'date')
     OR (p_precision = 'unknown') <> (p_expected_on IS NULL)
     OR (p_precision = 'month' AND p_expected_on <> date_trunc('month', p_expected_on)::date)
     OR p_expected_on NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Invalid payment timing' USING ERRCODE = '22023';
  END IF;
  v_before := private.policy_commission_estimate_state(e.id);
  UPDATE public.policy_commission_installments SET timing_precision = p_precision, expected_on = p_expected_on,
         timing_source = CASE WHEN p_precision = 'unknown' THEN 'unset' ELSE 'manual' END,
         timing_set_by = policy_commission_authz.actor_uid(), timing_set_at = clock_timestamp()
   WHERE id = i.id;
  RETURN private.policy_commission_record_event(e, 'installment_timing_set', p_request_id, v_hash, NULL, v_before, i.id, NULL);
END $$;

CREATE FUNCTION public.set_policy_commission_hold(p_request_id uuid, p_estimate_id uuid, p_expected_revision bigint,
  p_on_hold boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hash text := encode(sha256(convert_to(jsonb_build_array('hold', p_estimate_id, p_expected_revision, p_on_hold,
          v_reason)::text, 'UTF8')), 'hex');
  v_prior jsonb; e public.policy_commission_estimates%ROWTYPE; v_before jsonb;
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  e := private.policy_commission_lock_estimate(p_estimate_id, p_expected_revision, false);
  IF p_expected_revision IS NULL OR p_on_hold IS NULL
     OR (v_reason IS NOT NULL AND char_length(v_reason) NOT BETWEEN 3 AND 200)
     OR (p_on_hold AND v_reason IS NULL) OR (p_on_hold = (e.status = 'on_hold')) THEN
    RAISE EXCEPTION 'Invalid hold change' USING ERRCODE = '22023';
  END IF;
  v_before := private.policy_commission_estimate_state(e.id);
  UPDATE public.policy_commission_estimates SET status = CASE WHEN p_on_hold THEN 'on_hold' ELSE 'active' END,
         status_reason = CASE WHEN p_on_hold THEN v_reason END, status_by = policy_commission_authz.actor_uid(),
         status_at = clock_timestamp() WHERE id = e.id;
  RETURN private.policy_commission_record_event(e, CASE WHEN p_on_hold THEN 'hold_placed' ELSE 'hold_released' END,
                                                p_request_id, v_hash, v_reason, v_before, NULL, NULL);
END $$;

CREATE FUNCTION private.policy_commission_insert_receipt(i public.policy_commission_installments, p_request_id uuid,
  p_hash text, p_amount_cents bigint, p_received_on date, p_reference text, p_replaces uuid)
RETURNS public.policy_commission_receipts LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_ref text := nullif(btrim(coalesce(p_reference, '')), ''); r public.policy_commission_receipts%ROWTYPE;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 100000000 OR p_received_on IS NULL
     OR p_received_on < DATE '2000-01-01' OR p_received_on > (now() AT TIME ZONE 'UTC')::date + 1
     OR char_length(v_ref) > 200 THEN
    RAISE EXCEPTION 'Enter an amount above $0.00, a received date that is not in the future and a reference of up to 200 characters'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.policy_commission_receipts (organization_id, installment_id, estimate_id, policy_id, credited_agent_id,
    request_id, payload_hash, amount_cents, received_on, reference, recorded_by, replaces_receipt_id)
  VALUES (i.organization_id, i.id, i.estimate_id, i.policy_id, i.credited_agent_id, p_request_id, p_hash, p_amount_cents,
          p_received_on, v_ref, policy_commission_authz.actor_uid(), p_replaces)
  RETURNING * INTO r;
  RETURN r;
END $$;

CREATE FUNCTION public.record_policy_commission_receipt(p_request_id uuid, p_installment_id uuid, p_amount_cents bigint,
  p_received_on date, p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid := policy_commission_authz.actor_org();
  v_hash text := encode(sha256(convert_to(jsonb_build_array(p_installment_id, p_amount_cents, p_received_on,
          nullif(btrim(coalesce(p_reference, '')), ''))::text, 'UTF8')), 'hex');
  r public.policy_commission_receipts%ROWTYPE; i public.policy_commission_installments%ROWTYPE;
  e public.policy_commission_estimates%ROWTYPE;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing request id' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org || ':policy-commission:' || p_request_id, 0));
  SELECT * INTO r FROM public.policy_commission_receipts WHERE organization_id = v_org AND request_id = p_request_id;
  IF FOUND THEN
    IF r.payload_hash <> v_hash OR r.recorded_by <> policy_commission_authz.actor_uid() THEN
      RAISE EXCEPTION 'This payment request already saved different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('receipt_id', r.id, 'status', 'recorded', 'idempotent', true);
  END IF;
  SELECT * INTO i FROM public.policy_commission_installments WHERE id = p_installment_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found' USING ERRCODE = 'PT404'; END IF;
  e := private.policy_commission_lock_estimate(i.estimate_id, NULL, false);
  r := private.policy_commission_insert_receipt(i, p_request_id, v_hash, p_amount_cents, p_received_on, p_reference, NULL);
  UPDATE public.policy_commission_estimates SET state_revision = state_revision + 1 WHERE id = e.id;
  RETURN jsonb_build_object('receipt_id', r.id, 'status', 'recorded', 'idempotent', false);
END $$;

CREATE FUNCTION public.void_policy_commission_receipt(p_request_id uuid, p_receipt_id uuid, p_expected_revision bigint,
  p_reason text, p_replacement jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hash text := encode(sha256(convert_to(jsonb_build_array('void', p_receipt_id, p_expected_revision, v_reason,
          p_replacement)::text, 'UTF8')), 'hex');
  v_prior jsonb; r public.policy_commission_receipts%ROWTYPE; e public.policy_commission_estimates%ROWTYPE;
  i public.policy_commission_installments%ROWTYPE; v_new public.policy_commission_receipts%ROWTYPE; v_before jsonb;
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT * INTO r FROM public.policy_commission_receipts
   WHERE id = p_receipt_id AND organization_id = policy_commission_authz.actor_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found' USING ERRCODE = 'PT404'; END IF;
  e := private.policy_commission_lock_estimate(r.estimate_id, p_expected_revision, false);
  SELECT * INTO r FROM public.policy_commission_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF p_expected_revision IS NULL OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'A void needs the loaded revision and a reason of 3 to 200 characters' USING ERRCODE = '22023';
  END IF;
  IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'This receipt is already voided' USING ERRCODE = '22023'; END IF;
  v_before := private.policy_commission_estimate_state(e.id) || jsonb_build_object('receipt', jsonb_build_object(
    'id', r.id, 'installment_id', r.installment_id, 'amount_cents', r.amount_cents, 'received_on', r.received_on));
  UPDATE public.policy_commission_receipts SET voided_at = clock_timestamp(), voided_by = policy_commission_authz.actor_uid(),
         void_reason = v_reason WHERE id = r.id;
  IF p_replacement IS NOT NULL THEN
    IF jsonb_typeof(p_replacement) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_replacement) k)
          IS DISTINCT FROM ARRAY['amount_cents', 'installment_id', 'received_on', 'reference'] THEN
      RAISE EXCEPTION 'Invalid replacement receipt' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO i FROM public.policy_commission_installments
     WHERE id = (p_replacement->>'installment_id')::uuid AND estimate_id = e.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'The replacement must belong to the same estimate' USING ERRCODE = '22023'; END IF;
    v_new := private.policy_commission_insert_receipt(i, p_request_id,
               encode(sha256(convert_to(p_replacement::text, 'UTF8')), 'hex'), (p_replacement->>'amount_cents')::bigint,
               (p_replacement->>'received_on')::date, p_replacement->>'reference', r.id);
  END IF;
  RETURN private.policy_commission_record_event(e, 'receipt_voided', p_request_id, v_hash, v_reason, v_before,
                                                r.installment_id, r.id, jsonb_build_object('replacement_receipt_id', v_new.id));
END $$;

-- ── 9. Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER: the client must be visible under clients RLS and every commission row under commission RLS.
CREATE FUNCTION public.get_client_policy_commissions(p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid := policy_commission_authz.actor_org(); c record; p record; w record; v_access text; v_out jsonb := '[]'::jsonb;
  v_est jsonb; v_cap jsonb; v_state text; v_basis jsonb; v_pp text; v_eff text;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT cl.id, cl.primary_policy_id, cl.carrier, cl.policy_type, cl.premium, cl.effective_date, cl.custom_fields INTO c
    FROM public.clients cl WHERE cl.id = p_client_id AND cl.organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found' USING ERRCODE = 'PT404'; END IF;
  FOR p IN
    SELECT q.* FROM (
      SELECT 0::bigint AS ord, c.primary_policy_id AS policy_id, 'primary'::text AS source, c.carrier::text AS carrier,
             c.policy_type::text AS policy_type, c.premium::text AS premium_text, c.effective_date::text AS effective_date
       WHERE c.primary_policy_id IS NOT NULL
      UNION ALL
      SELECT a.n, (a.x->>'policyId')::uuid, 'additional', a.x->>'carrier', a.x->>'policyType', a.x->>'premiumAmount',
             a.x->>'effectiveDate'
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies') = 'array'
                                       THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) WITH ORDINALITY a(x, n)
       WHERE jsonb_typeof(a.x) = 'object'
         AND a.x->>'policyId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') q
    ORDER BY q.ord
  LOOP
    SELECT wn.id, wn.agent_id, wn.premium_amount, wn.premium_snapshot, wn.policy_type INTO w FROM public.wins wn
     WHERE wn.organization_id = v_org AND wn.policy_id = p.policy_id AND wn.contact_id = c.id;
    IF NOT FOUND THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('policy_id', p.policy_id, 'source', p.source, 'state', 'unavailable'));
      CONTINUE;
    END IF;
    v_access := policy_commission_authz.access(w.agent_id);
    IF v_access IS NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('policy_id', p.policy_id, 'source', p.source, 'state', 'hidden'));
      CONTINUE;
    END IF;
    v_eff := CASE WHEN p.effective_date ~ '^\d{4}-\d{2}-\d{2}$' THEN p.effective_date END;
    SELECT jsonb_build_object('id', e.id, 'status', e.status, 'status_reason', e.status_reason, 'capture_mode', e.capture_mode,
             'captured_by', cp.captured_by, 'recorded_by', e.recorded_by, 'recorded_at', e.recorded_at,
             'grid_name', e.grid_name, 'grid_revision', e.grid_revision, 'grid_effective_date', e.grid_effective_date,
             'product_name', e.product_name, 'product_carrier', e.product_carrier, 'variant_label', e.variant_label,
             'insured_age', e.insured_age, 'term_years', e.term_years, 'contract_level', e.contract_level,
             'rate_percent', e.rate_percent::text, 'monthly_premium', e.monthly_premium::text, 'premium_source', e.premium_source,
             'first_year_cents', e.first_year_cents, 'advance_cents', e.advance_cents,
             'schedule_start_on', e.schedule_start_on, 'schedule_start_source', e.schedule_start_source,
             'state_revision', e.state_revision,
             'installments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind,
                 'expected_cents', i.expected_cents, 'timing_precision', i.timing_precision, 'expected_on', i.expected_on,
                 'timing_source', i.timing_source,
                 'receipts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount_cents', r.amount_cents,
                     'received_on', r.received_on, 'reference', r.reference, 'recorded_by', r.recorded_by,
                     'recorded_at', r.recorded_at, 'replaces_receipt_id', r.replaces_receipt_id, 'voided_at', r.voided_at,
                     'void_reason', r.void_reason) ORDER BY r.recorded_at, r.id), '[]'::jsonb)
                   FROM public.policy_commission_receipts r WHERE r.installment_id = i.id)) ORDER BY i.sequence), '[]'::jsonb)
               FROM public.policy_commission_installments i WHERE i.estimate_id = e.id))
      INTO v_est
      FROM public.policy_commission_estimates e
      LEFT JOIN public.policy_commission_captures cp ON cp.id = e.capture_id
     WHERE e.organization_id = v_org AND e.policy_id = p.policy_id AND e.status IN ('active', 'on_hold');
    SELECT jsonb_build_object('id', cp.id, 'status', cp.status, 'attention_code', cp.attention_code,
             'first_year_cents', cp.first_year_cents, 'advance_cents', cp.advance_cents, 'captured_by', cp.captured_by,
             'captured_at', cp.captured_at, 'product_id', cp.product_id, 'insured_age', cp.insured_age,
             'term_years', cp.term_years)
      INTO v_cap
      FROM public.policy_commission_captures cp
     WHERE cp.organization_id = v_org AND cp.policy_id = p.policy_id AND cp.status IN ('awaiting_confirmation', 'needs_attention');
    v_state := CASE WHEN v_est IS NOT NULL THEN 'recorded'
                    WHEN v_cap->>'status' = 'awaiting_confirmation' THEN 'awaiting_confirmation'
                    WHEN v_cap->>'status' = 'needs_attention' THEN 'needs_attention'
                    ELSE 'not_recorded' END;
    v_pp := regexp_replace(coalesce(p.premium_text, ''), '[,$[:space:]]', '', 'g');
    v_basis := jsonb_build_object('policy_type', coalesce(w.policy_type, p.policy_type), 'carrier', p.carrier,
      'monthly_premium', CASE WHEN w.premium_snapshot AND w.premium_amount > 0 THEN w.premium_amount::text
                              WHEN v_pp ~ '^\d+(\.\d{1,2})?$' AND v_pp::numeric > 0 THEN v_pp END,
      'premium_source', CASE WHEN w.premium_snapshot AND w.premium_amount > 0 THEN 'sale_snapshot'
                             WHEN v_pp ~ '^\d+(\.\d{1,2})?$' AND v_pp::numeric > 0 THEN 'policy_record' END,
      'effective_date', v_eff);
    v_out := v_out || jsonb_build_array(jsonb_build_object('policy_id', p.policy_id, 'source', p.source, 'state', v_state,
      'access', v_access, 'credited_agent_id', w.agent_id, 'win_id', w.id, 'basis', v_basis,
      'estimate', v_est, 'capture', v_cap));
  END LOOP;
  RETURN jsonb_build_object('client_id', c.id, 'policies', v_out);
END $$;

-- Authoritative, caller-scoped reconciliation of a save operation (read-only). The sale hash is recomputed here.
CREATE FUNCTION public.get_policy_sale_operation_status(p_kind text, p_request_id uuid, p_lead_id uuid DEFAULT NULL,
  p_sale_args jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; v_key text; v_hash text; r private.policy_sale_receipts%ROWTYPE; h public.policy_commission_handoffs%ROWTYPE;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF p_request_id IS NULL OR p_kind NOT IN ('record', 'create', 'convert', 'edit') OR (p_kind = 'convert' AND p_lead_id IS NULL)
     OR (p_sale_args IS NOT NULL AND jsonb_typeof(p_sale_args) <> 'object') THEN
    RAISE EXCEPTION 'Invalid status request' USING ERRCODE = '22023';
  END IF;
  v_key := CASE p_kind WHEN 'record' THEN 'policy:' || p_request_id WHEN 'create' THEN 'manual:' || a.uid || ':' || p_request_id
                       WHEN 'edit' THEN 'client-edit:' || a.uid || ':' || p_request_id ELSE 'conversion:' || p_lead_id END;
  v_hash := CASE p_kind
    WHEN 'record' THEN encode(sha256(convert_to(jsonb_build_array(p_sale_args->'p_client_id', p_sale_args->'p_policy',
                         p_sale_args->'p_primary')::text, 'UTF8')), 'hex')
    WHEN 'create' THEN encode(sha256(convert_to(jsonb_build_array(p_sale_args->'p_client', p_sale_args->'p_record_sale')::text,
                         'UTF8')), 'hex')
    WHEN 'convert' THEN encode(sha256(convert_to(jsonb_build_array(p_sale_args->'p_client', p_sale_args->'p_campaign_id')::text,
                          'UTF8')), 'hex')
    ELSE encode(sha256(convert_to(jsonb_build_array(p_sale_args->'p_client_id', (p_sale_args->'p_patch') - 'updated_at')::text,
                'UTF8')), 'hex') END;
  SELECT * INTO r FROM private.policy_sale_receipts WHERE organization_id = a.org_id AND operation_key = v_key;
  IF NOT FOUND THEN
    IF p_kind = 'convert' AND EXISTS (SELECT 1 FROM public.clients WHERE lead_id = p_lead_id AND organization_id = a.org_id) THEN
      RETURN jsonb_build_object('state', 'committed_without_receipt');
    END IF;
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  IF r.actor_id <> a.uid THEN RETURN jsonb_build_object('state', 'committed_by_another_user'); END IF;
  SELECT * INTO h FROM public.policy_commission_handoffs WHERE organization_id = a.org_id AND sale_operation_key = v_key;
  RETURN jsonb_build_object('state', 'committed', 'same_payload', p_sale_args IS NOT NULL AND v_hash = r.payload_hash,
    'this_request', CASE WHEN h.id IS NULL THEN NULL ELSE h.request_id = p_request_id END,
    'client_id', r.client_id, 'win_ids', to_jsonb(r.win_ids),
    'commission', CASE WHEN h.id IS NULL THEN 'not_recorded' ELSE 'evidence_recorded' END);
END $$;

-- ── 10. Ownership and execution rights ───────────────────────────────────────────────────────────────────────────
-- CREATE on the two schemas is temporary and exists only so PostgreSQL permits ALTER FUNCTION ... OWNER below.
GRANT CREATE ON SCHEMA public, private TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_insert_estimate(uuid, uuid, jsonb, jsonb, jsonb, uuid, text, uuid, text, jsonb, text, text)
  OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_estimate_state(uuid) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_slot_states(uuid) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_capture_presented(public.policy_commission_captures) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_handoff(text, text, text, uuid, text, uuid, uuid[], jsonb)
  OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_replay(uuid, text) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_lock_estimate(uuid, bigint, boolean) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_record_event(public.policy_commission_estimates, text, uuid, text, text, jsonb, uuid, uuid, jsonb)
  OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION private.policy_commission_insert_receipt(public.policy_commission_installments, uuid, text, bigint, date, text, uuid)
  OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.confirm_policy_commission_capture(uuid, uuid) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.dismiss_policy_commission_capture(uuid, uuid, text) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.record_policy_commission_estimate_later(uuid, uuid, jsonb, uuid, bigint, text)
  OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.set_policy_commission_schedule_basis(uuid, uuid, bigint, date, text) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.set_policy_commission_installment_timing(uuid, uuid, bigint, text, date)
  OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.set_policy_commission_hold(uuid, uuid, bigint, boolean, text) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.record_policy_commission_receipt(uuid, uuid, bigint, date, text) OWNER TO agentflow_policy_commission_writer;
ALTER FUNCTION public.void_policy_commission_receipt(uuid, uuid, bigint, text, jsonb) OWNER TO agentflow_policy_commission_writer;
REVOKE CREATE ON SCHEMA public, private FROM agentflow_policy_commission_writer;

DO $acl$
DECLARE f regprocedure;
BEGIN
  -- Every function this migration created (Supabase default privileges grant EXECUTE to all client roles).
  FOR f IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p
            WHERE p.oid NOT IN (SELECT oid FROM policy_commission_preexisting_functions)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $acl$;

GRANT EXECUTE ON FUNCTION policy_commission_authz.actor_uid() TO agentflow_policy_commission_writer;
GRANT EXECUTE ON FUNCTION policy_commission_authz.actor_org(), policy_commission_authz.access(uuid)
  TO authenticated, agentflow_policy_commission_writer;
GRANT EXECUTE ON FUNCTION private.policy_commission_operation_facts(text, text, uuid, text, uuid[]),
  private.policy_commission_policy_facts(uuid[]), private.policy_commission_grid_facts(uuid, jsonb),
  private.policy_commission_valid_slot(jsonb, boolean), private.policy_commission_validate_payload(jsonb),
  private.policy_commission_evaluate(jsonb, jsonb, jsonb, jsonb, text)
  TO agentflow_policy_commission_writer;
GRANT EXECUTE ON FUNCTION private.policy_commission_handoff(text, text, text, uuid, text, uuid, uuid[], jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION
  public.record_client_policy_handoff(uuid, uuid, jsonb, boolean, jsonb),
  public.create_client_with_sale_handoff(uuid, uuid, jsonb, boolean, jsonb),
  public.convert_lead_to_client_with_sales_handoff(uuid, uuid, uuid, jsonb, uuid, jsonb),
  public.update_client_with_policy_sale_handoff(uuid, uuid, jsonb, jsonb),
  public.confirm_policy_commission_capture(uuid, uuid),
  public.dismiss_policy_commission_capture(uuid, uuid, text),
  public.record_policy_commission_estimate_later(uuid, uuid, jsonb, uuid, bigint, text),
  public.set_policy_commission_schedule_basis(uuid, uuid, bigint, date, text),
  public.set_policy_commission_installment_timing(uuid, uuid, bigint, text, date),
  public.set_policy_commission_hold(uuid, uuid, bigint, boolean, text),
  public.record_policy_commission_receipt(uuid, uuid, bigint, date, text),
  public.void_policy_commission_receipt(uuid, uuid, bigint, text, jsonb),
  public.get_client_policy_commissions(uuid),
  public.get_policy_sale_operation_status(text, uuid, uuid, jsonb)
TO authenticated;

COMMENT ON TABLE public.policy_commission_estimates IS
  'Illustrative per-policy commission estimate (Phase 2A). Never carrier-verified, guaranteed, earned, paid, payroll or booked commission.';
COMMENT ON TABLE public.policy_commission_receipts IS
  'Manually recorded receipts entered by the agent or an admin. Not a carrier reconciliation; corrections are voids with a reason.';
COMMENT ON TABLE public.policy_commission_handoffs IS
  'Server-held evidence binding a committed sale operation to the commission inputs submitted with it.';
