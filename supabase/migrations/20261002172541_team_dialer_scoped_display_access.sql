-- P2/P3: coordinated claim/identity containment and Team display reader. CANDIDATE, NOT APPLIED.
-- Requires P1 observation and explicit manager validation of intended legacy associations.
-- NEVER use a blind backfill, clamp, forced unlock or takeover-capable rollback to unblock this gate.
-- Run in one transaction. General Contacts SELECT policies, call/save/advance/heartbeat remain unchanged.
SET LOCAL lock_timeout = '5s';
DO $preflight$
BEGIN
  IF current_user <> 'postgres' OR
     (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.claim_lead(uuid,uuid,uuid)'::regprocedure)
       IS DISTINCT FROM 'cb48194cbb7c02e85956d49f18dc4648' OR
     (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_next_queue_lead(uuid,jsonb)'::regprocedure)
       IS DISTINCT FROM '248cc87d1688947088c728213186e193' OR
     (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.attach_leads_to_campaign_core(uuid,uuid[],uuid)'::regprocedure)
       IS DISTINCT FROM '1f70b2a7a6aa5346042da52050ac4fa8' OR
     to_regclass('private.team_queue_associations') IS NULL THEN
    RAISE EXCEPTION 'Team display preimage drift or replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dialer_lead_locks WHERE expires_at > clock_timestamp() AND queue_issued_at IS NULL) THEN
    RAISE EXCEPTION 'Team P2 blocked: unproven active locks remain; observe, do not force unlock';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.campaign_leads q JOIN public.campaigns c ON c.id = q.campaign_id
    WHERE upper(btrim(c.type)) IN ('TEAM', 'OPEN', 'OPEN POOL') AND q.lead_id IS NOT NULL
      AND q.status NOT IN ('DNC', 'Completed', 'Removed', 'Failed')
      AND NOT EXISTS (SELECT 1 FROM private.team_queue_associations a
        WHERE a.campaign_lead_id = q.id AND a.campaign_id = q.campaign_id
          AND a.organization_id = q.organization_id AND a.organization_id = c.organization_id
          AND a.lead_id = q.lead_id)) THEN
    RAISE EXCEPTION 'Team P2 blocked: intended historical associations require explicit manager review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'campaign_leads'
                 AND policyname = 'campaign_leads_insert' AND cmd = 'INSERT') OR
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dialer_lead_locks'
                 AND policyname = 'dialer_lead_locks_insert' AND cmd = 'INSERT') THEN
    RAISE EXCEPTION 'Team P2 policy drift or replay';
  END IF;
END;
$preflight$;

-- INVOKER identity guard. Status/counters/snapshot/callback saves keep their existing paths.
CREATE FUNCTION private.guard_campaign_lead_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) AND
     (NEW.id, NEW.lead_id, NEW.campaign_id, NEW.organization_id)
       IS DISTINCT FROM (OLD.id, OLD.lead_id, OLD.campaign_id, OLD.organization_id) THEN
    RAISE EXCEPTION 'campaign lead identity is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.guard_campaign_lead_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_campaign_lead_identity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER campaign_leads_guard_identity BEFORE UPDATE ON public.campaign_leads
FOR EACH ROW EXECUTE FUNCTION private.guard_campaign_lead_identity();

DROP POLICY campaign_leads_insert ON public.campaign_leads;
DROP POLICY dialer_lead_locks_insert ON public.dialer_lead_locks;
-- Production grants included TRUNCATE/TRIGGER/REFERENCES (and MAINTAIN on PG17). RLS does not
-- constrain TRUNCATE. Reset these two queue-table ACLs to the client operations that remain legitimate.
REVOKE ALL ON public.campaign_leads, public.dialer_lead_locks FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.campaign_leads, public.dialer_lead_locks TO authenticated;
DROP POLICY dialer_lead_locks_delete ON public.dialer_lead_locks;
CREATE POLICY dialer_lead_locks_delete ON public.dialer_lead_locks FOR DELETE TO authenticated
USING (organization_id = public.get_org_id() AND
  (locked_by = auth.uid() OR public.get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')));

CREATE FUNCTION private.has_team_queue_authority(p_campaign_lead_id uuid, p_team_only boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.campaign_leads q
    JOIN public.campaigns c ON c.id = q.campaign_id AND c.organization_id = q.organization_id
    JOIN public.leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id
    JOIN private.team_queue_associations a ON a.campaign_lead_id = q.id
      AND a.campaign_id = q.campaign_id AND a.organization_id = q.organization_id AND a.lead_id = q.lead_id
    JOIN public.dialer_lead_locks k ON k.campaign_lead_id = q.id
      AND k.campaign_id = q.campaign_id AND k.organization_id = q.organization_id
    WHERE q.id = p_campaign_lead_id AND q.organization_id = public.get_org_id()
      AND k.locked_by = auth.uid() AND k.expires_at > clock_timestamp() AND k.queue_issued_at IS NOT NULL
      AND upper(btrim(c.type)) = ANY (CASE WHEN p_team_only THEN ARRAY['TEAM'] ELSE ARRAY['TEAM','OPEN','OPEN POOL'] END)
      AND public.can_dial_campaign(c.id)
      AND (l.assigned_agent_id IS NULL OR l.assigned_agent_id = auth.uid())
      AND (q.callback_agent_id IS NULL OR q.callback_agent_id = auth.uid())
  );
$$;
ALTER FUNCTION private.has_team_queue_authority(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.has_team_queue_authority(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Same legacy payload/signature; target binding and guarded UPDATE prevent a takeover.
CREATE OR REPLACE FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  PERFORM 1 FROM public.campaign_leads q JOIN public.leads l ON l.id = q.lead_id
    WHERE q.id = p_campaign_lead_id AND q.campaign_id = p_campaign_id AND q.lead_id = p_lead_id
      AND q.organization_id = a.org_id AND l.organization_id = a.org_id
    FOR UPDATE OF q, l;
  IF NOT FOUND OR NOT private.has_team_queue_authority(p_campaign_lead_id, false) THEN
    RAISE EXCEPTION 'not_eligible' USING ERRCODE = '42501';
  END IF;
  UPDATE public.leads SET assigned_agent_id = a.uid, updated_at = now()
    WHERE id = p_lead_id AND organization_id = a.org_id
      AND (assigned_agent_id IS NULL OR assigned_agent_id = a.uid);
  IF NOT FOUND THEN RAISE EXCEPTION 'already_claimed' USING ERRCODE = '42501'; END IF;
END;
$$;
ALTER FUNCTION public.claim_lead(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_lead(uuid,uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_lead(uuid,uuid,uuid) TO authenticated;

-- Display-only DTO. Never supplies a writable master, history, arbitrary columns or queue inventory.
-- NULL is the same outcome for foreign, removed, unknown, expired, unproven and otherwise refused IDs.
CREATE FUNCTION public.get_team_dialer_lead_details(p_campaign_lead_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'campaign_lead_id', q.id, 'campaign_id', q.campaign_id, 'organization_id', q.organization_id,
    'id', l.id, 'first_name', l.first_name, 'last_name', l.last_name,
    'phone', l.phone, 'email', l.email, 'state', l.state, 'lead_source', l.lead_source,
    'age', l.age, 'date_of_birth', l.date_of_birth, 'best_time_to_call', l.best_time_to_call,
    'spouse_info', l.spouse_info, 'notes', l.notes, 'assigned_agent_id', l.assigned_agent_id,
    'custom_fields', l.custom_fields)
  FROM public.campaign_leads q JOIN public.leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id
  WHERE q.id = p_campaign_lead_id AND private.has_team_queue_authority(q.id, true);
$$;
ALTER FUNCTION public.get_team_dialer_lead_details(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_team_dialer_lead_details(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_dialer_lead_details(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_team_dialer_lead_details(uuid) IS
  'Read-only Team display DTO under current active membership, proven association and own queue-issued live lock. No Contacts access expansion.';
