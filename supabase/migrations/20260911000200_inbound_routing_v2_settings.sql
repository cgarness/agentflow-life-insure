-- =====================================================================================================
-- Inbound Calling v2 — M5: organization routing settings for the v2 engine + explicit inbound group
-- (implementation_plan.md rev 3 §7.2; approved development-only 2026-09-10)
-- =====================================================================================================
-- FUTURE-FACING ONLY: additive columns, CHECKs, a validation trigger and two admin RPCs. NO data
-- UPDATE/backfill. Every organization stays on routing_engine='legacy' until an Admin activates v2
-- through activate_inbound_routing_v2() (production writes stay separately approved, invariant #28).
--
-- Objects:
--   inbound_routing_settings.routing_engine            'legacy' | 'v2' (P15 cutover flag)
--   inbound_routing_settings.inbound_group_agent_ids   explicit admin-selected group, 1..10 (P2; INB-D5/D10)
--   inbound_routing_settings.browser_ring_seconds      DEFAULT 20 (INB-D4; P17 calibration recorded per call)
--   inbound_routing_settings.mobile_ring_seconds       DEFAULT 20 (P5)
--   inbound_routing_settings.voicemail_retention_days  DEFAULT 30 (P13; 90-day unheard cap in M7)
--   profiles_availability_status_check                 (P14) Available | On Break | Do Not Disturb | Offline
--   private.validate_inbound_group(uuid, uuid[])       1..10 DISTINCT same-org Active identity-bearing agents
--   trg_inbound_routing_settings_validate              BEFORE INSERT/UPDATE re-validation (direct writes too)
--   public.set_inbound_group(uuid[])                   Admin/Super Admin (profiles-authoritative) RPC
--   public.set_inbound_routing_engine(text)            Admin/Super Admin RPC; 'v2' requires a valid group
-- No new RLS policies: the existing Admin-only insert/update + org select policies cover the columns.

ALTER TABLE public.inbound_routing_settings
  ADD COLUMN IF NOT EXISTS routing_engine text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS inbound_group_agent_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS browser_ring_seconds integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS mobile_ring_seconds integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS voicemail_retention_days integer NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_routing_settings_engine_check') THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_routing_settings_engine_check CHECK (routing_engine IN ('legacy','v2'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_routing_settings_browser_ring_check') THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_routing_settings_browser_ring_check CHECK (browser_ring_seconds BETWEEN 5 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_routing_settings_mobile_ring_check') THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_routing_settings_mobile_ring_check CHECK (mobile_ring_seconds BETWEEN 5 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_routing_settings_vm_retention_check') THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_routing_settings_vm_retention_check CHECK (voicemail_retention_days BETWEEN 1 AND 365);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_group_size') THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_group_size CHECK (cardinality(inbound_group_agent_ids) <= 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_v2_requires_group') THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_v2_requires_group
      CHECK (routing_engine <> 'v2' OR cardinality(inbound_group_agent_ids) >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.inbound_routing_settings.routing_engine IS
  'Inbound Calling v2 cutover flag (P15). legacy = the pre-2026-09 all-ring/assigned/round_robin engine; v2 = '
  'owner-first + explicit group engine (INB-D1..D13). Flipping back to legacy stops NEW v2 calls only; the '
  'deployed functions keep serving outstanding v2 callbacks.';
COMMENT ON COLUMN public.inbound_routing_settings.inbound_group_agent_ids IS
  'Explicit admin-selected inbound group (INB-D5/INB-D10, P2): 1..10 DISTINCT same-org Active agents with a '
  'Twilio client identity, validated by trg_inbound_routing_settings_validate. Never auto-enrolled.';
COMMENT ON COLUMN public.inbound_routing_settings.browser_ring_seconds IS
  'INB-D4: <Dial timeout> for browser stages (default 20). Twilio documents up to ~5 s of additional buffer; the '
  'value actually sent and the observed timings are recorded per call on inbound_route_attempts (P17).';
COMMENT ON COLUMN public.inbound_routing_settings.mobile_ring_seconds IS
  'P5: <Dial timeout> for the owner_mobile stage. Mobile legs are never recorded (INB-D12).';
COMMENT ON COLUMN public.inbound_routing_settings.voicemail_retention_days IS
  'P13: retention for LISTENED voicemails; unheard voicemails are kept until listened or 90 days (M7).';

-- P14: profiles.availability_status value set (live preflight 2026-09-10: only Available/Offline exist).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_availability_status_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_availability_status_check
      CHECK (availability_status IN ('Available','On Break','Do Not Disturb','Offline'));
  END IF;
END $$;

-- ── Server-side group validation (explicit; direct PostgREST writes included) ────────────────────────
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.validate_inbound_group(p_org uuid, p_ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_distinct uuid[];
  v_valid integer;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'inbound group: organization required' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'inbound group: at least one agent is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) u(id) WHERE u.id IS NULL) THEN
    RAISE EXCEPTION 'inbound group: null agent id' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT u.id ORDER BY u.id) INTO v_distinct FROM unnest(p_ids) u(id);
  IF cardinality(v_distinct) > 10 THEN
    RAISE EXCEPTION 'inbound group: at most 10 distinct agents (Twilio dials at most ten <Client> targets)'
      USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_valid
    FROM public.profiles p
   WHERE p.id = ANY (v_distinct)
     AND p.organization_id = p_org
     AND p.status = 'Active'
     AND btrim(coalesce(p.twilio_client_identity, '')) <> '';
  IF v_valid <> cardinality(v_distinct) THEN
    RAISE EXCEPTION 'inbound group: every member must be an Active agent of this organization with a phone identity'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_distinct;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_inbound_group(uuid, uuid[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.inbound_routing_settings_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.routing_engine = 'v2' OR cardinality(coalesce(NEW.inbound_group_agent_ids, '{}')) > 0 THEN
    NEW.inbound_group_agent_ids := private.validate_inbound_group(NEW.organization_id, NEW.inbound_group_agent_ids);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.inbound_routing_settings_validate() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_inbound_routing_settings_validate ON public.inbound_routing_settings;
CREATE TRIGGER trg_inbound_routing_settings_validate
  BEFORE INSERT OR UPDATE OF inbound_group_agent_ids, routing_engine ON public.inbound_routing_settings
  FOR EACH ROW EXECUTE FUNCTION private.inbound_routing_settings_validate();

-- ── 5b. Routing-engine HISTORY — durable ownership of v2 recovery work (corrective pass 5) ─────────────
-- The recovery sweep (M6 §14) may only touch calls the v2 engine owned: a call is v2-owned when a route
-- attempt exists for it OR the organization's engine was 'v2' when the call was created. The engine at a
-- point in time is read from this append-only history (written by trigger on every engine change, whatever
-- the writer), so v2 work stays recoverable after a rollback to legacy and a failure BEFORE planning is
-- covered — while calls created under legacy are never touched. No backfill: organizations without history
-- read as legacy. Service-role/definer access only; RLS enabled with no policies (the §7.7 scope is unchanged).
CREATE TABLE IF NOT EXISTS public.inbound_routing_engine_history (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engine text NOT NULL CHECK (engine IN ('legacy','v2')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz
);
CREATE INDEX IF NOT EXISTS idx_inbound_engine_history_org_from
  ON public.inbound_routing_engine_history (organization_id, effective_from DESC);
ALTER TABLE public.inbound_routing_engine_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inbound_routing_engine_history FROM PUBLIC;
REVOKE ALL ON TABLE public.inbound_routing_engine_history FROM anon;
REVOKE ALL ON TABLE public.inbound_routing_engine_history FROM authenticated;

CREATE OR REPLACE FUNCTION private.record_inbound_engine_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.routing_engine IS DISTINCT FROM OLD.routing_engine THEN
    UPDATE public.inbound_routing_engine_history
       SET effective_to = now()
     WHERE organization_id = NEW.organization_id AND effective_to IS NULL;
    INSERT INTO public.inbound_routing_engine_history (organization_id, engine)
    VALUES (NEW.organization_id, coalesce(NEW.routing_engine, 'legacy'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.record_inbound_engine_history() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_inbound_routing_engine_history ON public.inbound_routing_settings;
CREATE TRIGGER trg_inbound_routing_engine_history
  AFTER INSERT OR UPDATE OF routing_engine ON public.inbound_routing_settings
  FOR EACH ROW EXECUTE FUNCTION private.record_inbound_engine_history();

/** The organization's routing engine at `p_at` ('legacy' when no history covers it — never a guess). */
CREATE OR REPLACE FUNCTION private.inbound_engine_at(p_org uuid, p_at timestamptz) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce((SELECT h.engine FROM public.inbound_routing_engine_history h
                    WHERE h.organization_id = p_org AND h.effective_from <= p_at
                      AND (h.effective_to IS NULL OR h.effective_to > p_at)
                    ORDER BY h.effective_from DESC LIMIT 1), 'legacy');
$$;
REVOKE ALL ON FUNCTION private.inbound_engine_at(uuid, timestamptz) FROM PUBLIC;

-- Authorization for the two admin RPCs reads public.profiles for auth.uid() (never the JWT — AGENT_RULES #19/#26).
CREATE OR REPLACE FUNCTION private.assert_inbound_settings_admin() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_org uuid; v_role text; v_super boolean; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.organization_id, p.role, coalesce(p.is_super_admin, false), p.status
    INTO v_org, v_role, v_super, v_status
    FROM public.profiles p WHERE p.id = auth.uid();
  IF NOT FOUND OR v_org IS NULL OR v_status IS DISTINCT FROM 'Active'
     OR NOT (v_role = 'Admin' OR v_super) THEN
    RAISE EXCEPTION 'inbound settings: Admin of an active organization required' USING ERRCODE = '42501';
  END IF;
  RETURN v_org;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_inbound_settings_admin() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_inbound_group(p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_org uuid; v_ids uuid[];
BEGIN
  v_org := private.assert_inbound_settings_admin();
  v_ids := private.validate_inbound_group(v_org, p_ids);
  INSERT INTO public.inbound_routing_settings (organization_id, inbound_group_agent_ids)
  VALUES (v_org, v_ids)
  ON CONFLICT (organization_id) DO UPDATE
    SET inbound_group_agent_ids = EXCLUDED.inbound_group_agent_ids, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'organization_id', v_org, 'inbound_group_agent_ids', to_jsonb(v_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.set_inbound_group(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_inbound_group(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_inbound_group(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_inbound_group(uuid[]) TO service_role;

-- Returns the SQL-checkable prerequisites alongside the new engine value. 'v2' is refused unless the
-- explicit group validates and at least one fresh registration exists in the organization.
CREATE OR REPLACE FUNCTION public.set_inbound_routing_engine(p_engine text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid; v_row public.inbound_routing_settings%ROWTYPE;
  v_group_ok boolean := false; v_fresh integer := 0; v_no_mobile jsonb := '[]'::jsonb;
BEGIN
  v_org := private.assert_inbound_settings_admin();
  IF p_engine IS NULL OR p_engine NOT IN ('legacy','v2') THEN
    RAISE EXCEPTION 'routing engine must be legacy or v2' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.inbound_routing_settings WHERE organization_id = v_org;
  IF p_engine = 'v2' THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inbound routing settings row missing; configure the inbound group first' USING ERRCODE = '22023';
    END IF;
    PERFORM private.validate_inbound_group(v_org, v_row.inbound_group_agent_ids);   -- raises when invalid
    v_group_ok := true;
    SELECT count(*) INTO v_fresh
      FROM public.agent_phone_registrations r
     WHERE r.organization_id = v_org AND r.registered AND r.last_seen_at >= now() - interval '3 minutes';
    IF v_fresh = 0 THEN
      RAISE EXCEPTION 'no connected agent registration observed in the last 3 minutes; release the frontend and have an agent sign in before activating v2'
        USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(jsonb_agg(p.id), '[]'::jsonb) INTO v_no_mobile
      FROM public.profiles p
      LEFT JOIN public.agent_inbound_settings s ON s.agent_id = p.id
     WHERE p.organization_id = v_org AND p.status = 'Active'
       AND (s.mobile_forward_number IS NULL OR NOT s.mobile_forward_enabled);
  END IF;
  UPDATE public.inbound_routing_settings
     SET routing_engine = p_engine, updated_at = now()
   WHERE organization_id = v_org;
  IF NOT FOUND THEN
    INSERT INTO public.inbound_routing_settings (organization_id, routing_engine) VALUES (v_org, p_engine);
  END IF;
  RETURN jsonb_build_object('ok', true, 'organization_id', v_org, 'routing_engine', p_engine,
                            'group_valid', v_group_ok, 'fresh_registrations', v_fresh,
                            'agents_without_mobile', v_no_mobile);
END;
$$;
REVOKE ALL ON FUNCTION public.set_inbound_routing_engine(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_inbound_routing_engine(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_inbound_routing_engine(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_inbound_routing_engine(text) TO service_role;
