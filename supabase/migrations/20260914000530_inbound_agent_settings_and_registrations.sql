-- =====================================================================================================
-- Inbound Calling v2 — M4: per-agent inbound settings + per-registration phone presence
-- (implementation_plan.md rev 3 §7.1; approved development-only 2026-09-10 under #APPROVE_RLS_CHANGE
--  for exactly the policies below; NOT applied to any remote database by this authoring)
-- =====================================================================================================
-- FUTURE-FACING ONLY: new tables, functions and ACLs. NO UPDATE/DELETE/INSERT of user data — no
-- backfill, no mutation of any historical row. Authored version 20260911000100; renamed to the
-- production apply-time version on apply (repo convention, 2026-08-23).
--
-- Objects:
--   public.agent_inbound_settings          — agent-owned mobile forward destination + voicemail greeting.
--                                            RLS: self select/insert/update (org-scoped), same-org Admin
--                                            select. Loop guard trigger: the mobile number can never be
--                                            one of the organization's own Twilio numbers.
--   public.agent_phone_registrations       — ONE ROW PER DEVICE REGISTRATION (agent_id, registration_id)
--                                            with a monotonic seq (plan rev 3 §6.2 — correction C/gap 4).
--                                            RLS: self select + same-org select; NO client write policies
--                                            (writes only through the RPC below).
--   public.heartbeat_phone_registration()  — authenticated RPC; identity from auth.uid()/get_org_id();
--                                            upserts ONLY the caller's own (agent, registration) row and
--                                            ignores any write whose seq is not greater than the stored one.
--   public.is_phone_connected(uuid)        — advisory freshness predicate (3-minute window); SECURITY
--                                            INVOKER, so an authenticated caller is bound by the table's
--                                            org-scoped RLS while routing callers still see the org.
-- ACLs: every grantee is RESET (REVOKE ALL from PUBLIC, anon, authenticated, service_role) and then
--       granted exactly the contract below — this project's default privileges hand a newly created table
--       the full `arwdDxtm` set to anon/authenticated/service_role, and GRANT only adds.
--       agent_inbound_settings → authenticated: SELECT, INSERT, UPDATE · agent_phone_registrations →
--       authenticated: SELECT only · service_role: ALL on both · anon: nothing.

CREATE SCHEMA IF NOT EXISTS private;

-- ── 1. agent_inbound_settings ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_inbound_settings (
  agent_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mobile_forward_number text
    CONSTRAINT agent_inbound_settings_mobile_e164_check
    CHECK (mobile_forward_number IS NULL OR mobile_forward_number ~ '^\+[1-9][0-9]{7,14}$'),
  mobile_forward_enabled boolean NOT NULL DEFAULT true,
  voicemail_greeting_text text
    CONSTRAINT agent_inbound_settings_greeting_len_check
    CHECK (voicemail_greeting_text IS NULL OR length(voicemail_greeting_text) <= 500),
  voicemail_greeting_url text
    CONSTRAINT agent_inbound_settings_greeting_url_check
    CHECK (voicemail_greeting_url IS NULL OR (voicemail_greeting_url ~ '^https://' AND length(voicemail_greeting_url) <= 2048)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_inbound_settings IS
  'Inbound Calling v2 (INB-D3/INB-D6): the agent''s own mobile forwarding destination (E.164) and personal '
  'AgentFlow voicemail greeting. Self-owned rows; same-org Admin read only. Mobile legs are NEVER recorded '
  '(INB-D12).';

-- Loop guard: an agent may not forward to one of the organization''s own Twilio numbers (last-10 digit match).
CREATE OR REPLACE FUNCTION private.agent_inbound_settings_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_last10 text;
BEGIN
  NEW.updated_at := now();
  IF NEW.mobile_forward_number IS NOT NULL THEN
    v_last10 := right(regexp_replace(NEW.mobile_forward_number, '[^0-9]', '', 'g'), 10);
    IF EXISTS (
      SELECT 1 FROM public.phone_numbers pn
       WHERE pn.organization_id = NEW.organization_id
         AND right(regexp_replace(coalesce(pn.phone_number, ''), '[^0-9]', '', 'g'), 10) = v_last10
    ) THEN
      RAISE EXCEPTION 'mobile_forward_number cannot be one of the organization''s own phone numbers'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.agent_inbound_settings_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_agent_inbound_settings_guard ON public.agent_inbound_settings;
CREATE TRIGGER trg_agent_inbound_settings_guard
  BEFORE INSERT OR UPDATE ON public.agent_inbound_settings
  FOR EACH ROW EXECUTE FUNCTION private.agent_inbound_settings_guard();

ALTER TABLE public.agent_inbound_settings ENABLE ROW LEVEL SECURITY;
-- Corrective pass 11: this project's ALTER DEFAULT PRIVILEGES give every table created by `postgres` in
-- `public` the FULL set `arwdDxtm` to anon, authenticated AND service_role (verified read-only in
-- production: pg_default_acl for grantor postgres / schema public / objtype 'r'). A GRANT only ADDS, so
-- granting SELECT, INSERT, UPDATE would have left authenticated holding DELETE, TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN as well. TRUNCATE in particular is NOT filtered by row-level security, so an
-- authenticated caller could have emptied the table regardless of the policies below. Every grantee is
-- therefore RESET first and then given exactly what the contract states.
REVOKE ALL ON TABLE public.agent_inbound_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_inbound_settings FROM anon;
REVOKE ALL ON TABLE public.agent_inbound_settings FROM authenticated;
REVOKE ALL ON TABLE public.agent_inbound_settings FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_inbound_settings TO authenticated;
GRANT ALL ON TABLE public.agent_inbound_settings TO service_role;

DROP POLICY IF EXISTS agent_inbound_settings_self_select ON public.agent_inbound_settings;
CREATE POLICY agent_inbound_settings_self_select ON public.agent_inbound_settings
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid() AND organization_id = public.get_org_id());

DROP POLICY IF EXISTS agent_inbound_settings_self_insert ON public.agent_inbound_settings;
CREATE POLICY agent_inbound_settings_self_insert ON public.agent_inbound_settings
  FOR INSERT TO authenticated
  WITH CHECK (agent_id = auth.uid() AND organization_id = public.get_org_id());

DROP POLICY IF EXISTS agent_inbound_settings_self_update ON public.agent_inbound_settings;
CREATE POLICY agent_inbound_settings_self_update ON public.agent_inbound_settings
  FOR UPDATE TO authenticated
  USING (agent_id = auth.uid() AND organization_id = public.get_org_id())
  WITH CHECK (agent_id = auth.uid() AND organization_id = public.get_org_id());

-- Same-org Admin / Super Admin read (support visibility; no admin write — agents own their destination).
DROP POLICY IF EXISTS agent_inbound_settings_admin_select ON public.agent_inbound_settings;
CREATE POLICY agent_inbound_settings_admin_select ON public.agent_inbound_settings
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id()
         AND (public.get_user_role() = 'Admin' OR public.is_super_admin()));

-- ── 2. agent_phone_registrations (per registration; gap 4) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_phone_registrations (
  agent_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  seq bigint NOT NULL DEFAULT 0,
  registered boolean NOT NULL DEFAULT false,
  registered_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_state text NOT NULL DEFAULT 'unregistered'
    CONSTRAINT agent_phone_registrations_state_check CHECK (last_state IN ('registered','unregistered','error')),
  last_detail text
    CONSTRAINT agent_phone_registrations_detail_len_check CHECK (last_detail IS NULL OR length(last_detail) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, registration_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_phone_registrations_org_agent_fresh
  ON public.agent_phone_registrations (organization_id, agent_id, registered, last_seen_at);

COMMENT ON TABLE public.agent_phone_registrations IS
  'Inbound Calling v2 (INB-D1): ADVISORY browser reachability, one row per Twilio Voice Device registration. '
  'registration_id is minted in memory by the browser at every Device `registered` event (never persisted, so a '
  'duplicated tab or a reload starts its own row); seq is monotonic per registration and stale/reordered writes '
  'are ignored. Connected = any row with registered AND last_seen_at within 3 minutes. Never a routing proof: '
  'Twilio''s own <Dial> outcome always drives the next stage.';

ALTER TABLE public.agent_phone_registrations ENABLE ROW LEVEL SECURITY;
-- Corrective pass 11: same reset-then-grant as above. Writes to this table happen ONLY through
-- heartbeat_phone_registration(), so authenticated is left with SELECT and nothing else — in particular
-- no TRUNCATE, which row-level security would not have restrained.
REVOKE ALL ON TABLE public.agent_phone_registrations FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_phone_registrations FROM anon;
REVOKE ALL ON TABLE public.agent_phone_registrations FROM authenticated;
REVOKE ALL ON TABLE public.agent_phone_registrations FROM service_role;
GRANT SELECT ON TABLE public.agent_phone_registrations TO authenticated;
GRANT ALL ON TABLE public.agent_phone_registrations TO service_role;

DROP POLICY IF EXISTS agent_phone_registrations_self_select ON public.agent_phone_registrations;
CREATE POLICY agent_phone_registrations_self_select ON public.agent_phone_registrations
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid() AND organization_id = public.get_org_id());

DROP POLICY IF EXISTS agent_phone_registrations_org_select ON public.agent_phone_registrations;
CREATE POLICY agent_phone_registrations_org_select ON public.agent_phone_registrations
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());
-- NO INSERT/UPDATE/DELETE policies: writes happen only through heartbeat_phone_registration().

CREATE OR REPLACE FUNCTION public.heartbeat_phone_registration(
  p_registration_id uuid,
  p_seq bigint,
  p_registered boolean,
  p_state text,
  p_detail text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_agent uuid := auth.uid();
  v_org uuid;
  v_rows integer := 0;
  v_detail text := NULLIF(left(btrim(coalesce(p_detail, '')), 64), '');
BEGIN
  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'heartbeat_phone_registration: not authenticated' USING ERRCODE = '42501';
  END IF;
  v_org := public.get_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'heartbeat_phone_registration: no organization' USING ERRCODE = '42501';
  END IF;
  IF p_registration_id IS NULL OR p_seq IS NULL OR p_seq < 0 THEN
    RAISE EXCEPTION 'heartbeat_phone_registration: invalid registration/seq' USING ERRCODE = '22023';
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('registered','unregistered','error') THEN
    RAISE EXCEPTION 'heartbeat_phone_registration: invalid state %', p_state USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agent_phone_registrations AS r
    (agent_id, registration_id, organization_id, seq, registered, registered_at, last_seen_at, last_state, last_detail)
  VALUES
    (v_agent, p_registration_id, v_org, p_seq, coalesce(p_registered, false),
     CASE WHEN coalesce(p_registered, false) THEN now() END, now(), p_state, v_detail)
  ON CONFLICT (agent_id, registration_id) DO UPDATE SET
    seq           = EXCLUDED.seq,
    registered    = EXCLUDED.registered,
    registered_at = CASE WHEN EXCLUDED.registered AND NOT r.registered THEN now() ELSE r.registered_at END,
    last_seen_at  = now(),
    last_state    = EXCLUDED.last_state,
    last_detail   = EXCLUDED.last_detail,
    updated_at    = now()
  WHERE r.organization_id = v_org
    AND EXCLUDED.seq > r.seq;               -- stale / reordered writes are ignored (gap 4)
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Housekeeping limited to the caller''s own registrations.
  DELETE FROM public.agent_phone_registrations
   WHERE agent_id = v_agent AND last_seen_at < now() - interval '24 hours';

  RETURN jsonb_build_object('applied', v_rows > 0,
                            'reason', CASE WHEN v_rows > 0 THEN 'ok' ELSE 'stale_seq' END);
END;
$$;

COMMENT ON FUNCTION public.heartbeat_phone_registration(uuid, bigint, boolean, text, text) IS
  'Inbound Calling v2 presence heartbeat. Writes ONLY the caller''s own (auth.uid(), registration_id) row; a write '
  'whose seq is not greater than the stored seq is ignored (applied:false, stale_seq). Never touches '
  'profiles.availability_status.';

REVOKE ALL ON FUNCTION public.heartbeat_phone_registration(uuid, bigint, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heartbeat_phone_registration(uuid, bigint, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_phone_registration(uuid, bigint, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_phone_registration(uuid, bigint, boolean, text, text) TO service_role;

-- SECURITY INVOKER, deliberately (corrective pass 10). As SECURITY DEFINER this predicate ran with the
-- owner's privileges; the owner is `postgres`, which both owns `agent_phone_registrations` and carries
-- BYPASSRLS, so the table's org-scoped SELECT policies did NOT apply inside it and an authenticated caller
-- in one organization could read another organization's connection status through it. PostgreSQL's
-- row-security documentation is explicit that table owners bypass RLS unless FORCE ROW LEVEL SECURITY is
-- set, and that a SECURITY DEFINER function runs as its owner.
--
-- INVOKER preserves every intended caller without widening anything:
--   • authenticated — already holds GRANT SELECT on the table, so the SAME rows the two org-scoped
--     policies allow are the rows this predicate can see. Cross-organization reads become false.
--   • service_role (the Edge routing handlers) — BYPASSRLS, so routing still sees every registration.
--   • the M6 planners (`plan_inbound_route`) — SECURITY DEFINER functions owned by `postgres`, so the
--     effective user inside them is the owner and RLS does not restrict this predicate there either.
--   • anon — EXECUTE stays revoked below, as before.
-- No table policy, grant or RLS setting is changed by this correction.
CREATE OR REPLACE FUNCTION public.is_phone_connected(p_agent_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_phone_registrations r
     WHERE r.agent_id = p_agent_id
       AND r.registered
       AND r.last_seen_at >= now() - interval '3 minutes'
  );
$$;

COMMENT ON FUNCTION public.is_phone_connected(uuid) IS
  'Inbound Calling v2 (INB-D1): advisory browser-reachability predicate — any registration row for the agent '
  'that is registered and seen within 3 minutes. SECURITY INVOKER on purpose: an authenticated caller sees '
  'only what the org-scoped RLS policies on agent_phone_registrations allow, while service_role and the '
  'definer-owned M6 planners still evaluate it across the organization. Never a routing proof.';
REVOKE ALL ON FUNCTION public.is_phone_connected(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_phone_connected(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_phone_connected(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_phone_connected(uuid) TO service_role;
