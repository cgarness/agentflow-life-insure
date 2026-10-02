-- P1B: verified associations and trusted attachment writers. BRANCH CANDIDATE, NOT APPLIED.
-- No automatic validation/backfill of historical rows. No business-row updates, ownership change,
-- lock release, TTL clamp or renewal cap. A manager validates ONE explicit current association.
-- Apply in one transaction after P1. Production application/validation targets need exact approval.
SET LOCAL lock_timeout = '5s';
DO $preflight$
BEGIN
  IF current_user <> 'postgres' OR
     (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.attach_leads_to_campaign_core(uuid,uuid[],uuid)'::regprocedure)
       IS DISTINCT FROM 'b9dc1a7bf0744b9c9b4543fb3a807c7b' OR
     (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.can_administer_campaign(uuid)'::regprocedure)
       IS DISTINCT FROM '45b2251c6f32d305ac3b8cad7010ea51' THEN
    RAISE EXCEPTION 'Team association preimage drift or replay';
  END IF;
  IF to_regclass('private.team_queue_associations') IS NOT NULL OR
     NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.dialer_lead_locks'::regclass
                 AND attname = 'queue_issued_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Team association replay or missing P1';
  END IF;
END;
$preflight$;

CREATE TABLE private.team_queue_associations (
  campaign_lead_id uuid PRIMARY KEY REFERENCES public.campaign_leads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  validated_at timestamptz NOT NULL DEFAULT now(),
  validated_by uuid NOT NULL,
  validation_source text NOT NULL CHECK (validation_source IN ('attachment', 'manager_review'))
);
ALTER TABLE private.team_queue_associations OWNER TO postgres;
ALTER TABLE private.team_queue_associations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.team_queue_associations FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private.team_queue_associations IS
  'Exact association explicitly authorized against both campaign and source lead. No legacy backfill.';

CREATE FUNCTION private.invalidate_team_queue_association() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.campaign_id, NEW.organization_id, NEW.lead_id)
      IS DISTINCT FROM (OLD.id, OLD.campaign_id, OLD.organization_id, OLD.lead_id) THEN
    DELETE FROM private.team_queue_associations WHERE campaign_lead_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.invalidate_team_queue_association() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.invalidate_team_queue_association() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER campaign_leads_invalidate_team_association AFTER UPDATE
ON public.campaign_leads FOR EACH ROW EXECUTE FUNCTION private.invalidate_team_queue_association();

-- Existing Contacts read authority, plus campaign administration and type/owner compatibility.
-- No current lock, queue snapshot, JWT role or client association establishes source authority.
CREATE FUNCTION private.can_authorize_campaign_lead(p_campaign_id uuid, p_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  c public.campaigns%ROWTYPE;
  l public.leads%ROWTYPE;
  t text;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  SELECT * INTO c FROM public.campaigns WHERE id = p_campaign_id AND organization_id = a.org_id;
  IF NOT FOUND OR NOT private.can_administer_campaign(p_campaign_id) THEN RETURN false; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead_id AND organization_id = a.org_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT COALESCE(
    l.user_id = a.uid OR a.actor_role = 'Admin' OR a.is_super OR
    (a.actor_role IN ('Team Leader', 'Team Lead') AND public.is_ancestor_of(a.uid, l.user_id)) OR
    public.has_contacts_permission('contacts.leads.view_all') OR
    (l.user_id IS NULL AND l.assigned_agent_id IS NULL AND
      public.has_contacts_permission('contacts.leads.view_unassigned') AND l.imported_by_user_id = a.uid),
    false) THEN RETURN false; END IF;
  t := upper(btrim(c.type));
  IF t = 'PERSONAL' THEN RETURN l.assigned_agent_id IS NOT DISTINCT FROM c.user_id; END IF;
  IF t = 'TEAM' THEN
    RETURN l.assigned_agent_id IS NULL OR l.assigned_agent_id::text IN
      (SELECT jsonb_array_elements_text(COALESCE(c.assigned_agent_ids, '[]'::jsonb)));
  END IF;
  RETURN t IN ('OPEN', 'OPEN POOL');
END;
$$;
ALTER FUNCTION private.can_authorize_campaign_lead(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.can_authorize_campaign_lead(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Consent is a manager's explicit validation of ONE current association, never an inferred bulk mark.
CREATE FUNCTION public.validate_team_queue_association(p_campaign_lead_id uuid, p_campaign_id uuid, p_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  q public.campaign_leads%ROWTYPE;
  c public.campaigns%ROWTYPE;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF NOT (a.is_super OR a.actor_role IN ('Admin', 'Team Leader', 'Team Lead')) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT cl.* INTO q FROM public.campaign_leads cl
    WHERE cl.id = p_campaign_lead_id AND cl.organization_id = a.org_id
      AND cl.campaign_id = p_campaign_id AND cl.lead_id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not eligible' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.campaigns WHERE id = q.campaign_id AND organization_id = a.org_id FOR SHARE;
  IF NOT FOUND OR upper(btrim(c.type)) NOT IN ('TEAM', 'OPEN', 'OPEN POOL') OR
      NOT private.can_authorize_campaign_lead(q.campaign_id, q.lead_id) THEN
    RAISE EXCEPTION 'not eligible' USING ERRCODE = '42501';
  END IF;
  -- Source authorization remains true through commit (no concurrent ownership/tenant change).
  PERFORM 1 FROM public.leads WHERE id = q.lead_id AND organization_id = a.org_id FOR SHARE;
  IF NOT FOUND OR NOT private.can_authorize_campaign_lead(q.campaign_id, q.lead_id) THEN
    RAISE EXCEPTION 'not eligible' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.team_queue_associations
    (campaign_lead_id, organization_id, campaign_id, lead_id, validated_by, validation_source)
  VALUES (q.id, q.organization_id, q.campaign_id, q.lead_id, a.uid, 'manager_review')
  ON CONFLICT (campaign_lead_id) DO NOTHING;
  RETURN true;
END;
$$;
ALTER FUNCTION public.validate_team_queue_association(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_team_queue_association(uuid,uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.validate_team_queue_association(uuid,uuid,uuid) TO authenticated;

-- F3: narrow Open Pool attachment administration; old signatures and counts remain.
CREATE OR REPLACE FUNCTION private.can_administer_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor    RECORD;
  v_campaign public.campaigns%ROWTYPE;
  v_type     text;
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();

  SELECT * INTO v_campaign
    FROM public.campaigns
   WHERE id = p_campaign_id
     AND organization_id = v_actor.org_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_type := upper(btrim(COALESCE(v_campaign.type, '')));

  -- OPEN POOL: established organization-wide behaviour. Same-org membership (already proven by
  -- the org-scoped lookup above) is the rule.
  -- Open Pool now uses owner/Admin/hierarchy authority, not every same-org Agent.

  -- Campaign owner, in every type.
  IF v_campaign.user_id = v_actor.uid THEN
    RETURN true;
  END IF;

  -- Same-organization Admin / Super Admin manage every campaign in their organization.
  IF v_actor.actor_role = 'Admin' OR v_actor.is_super THEN
    RETURN true;
  END IF;

  -- Authorized Team Leader, via the canonical hierarchy helper only.
  -- D-2: public.is_ancestor_of currently returns false for every pair (all profiles.hierarchy_path
  -- values are depth-1 self-labels), so this branch FAILS CLOSED until the hierarchy is repaired.
  -- No upline_id fallback is introduced here.
  IF v_actor.actor_role IN ('Team Leader', 'Team Lead')
     AND v_campaign.user_id IS NOT NULL
     AND public.is_ancestor_of(v_actor.uid, v_campaign.user_id) THEN
    RETURN true;
  END IF;

  -- TEAM: a listed participant may manage the campaign they participate in.
  --
  -- This branch previously did not exist: the function returned true for EVERY non-Personal
  -- campaign after only checking organization membership, which left add_leads_to_campaign as a
  -- same-organization arbitrary-write endpoint — a non-participant Agent could attach leads
  -- (including unassigned ones) to a Team campaign they neither own nor participate in.
  IF v_type = 'TEAM'
     AND v_actor.uid::text IN (
           SELECT jsonb_array_elements_text(COALESCE(v_campaign.assigned_agent_ids, '[]'::jsonb))
         ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
CREATE OR REPLACE FUNCTION private.attach_leads_to_campaign_core(
  p_campaign_id       uuid,
  p_lead_ids          uuid[],
  p_import_history_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_campaign      public.campaigns%ROWTYPE;
  v_type          text;
  v_org           uuid;
  v_requested     uuid[];
  v_eligible_ids  uuid[] := ARRAY[]::uuid[];
  v_already_ids   uuid[] := ARRAY[]::uuid[];
  v_ineligible_ids uuid[] := ARRAY[]::uuid[];
  v_not_found_ids uuid[] := ARRAY[]::uuid[];
  v_added_ids     uuid[] := ARRAY[]::uuid[];
  v_added         int := 0;
  v_raced         int := 0;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found' USING ERRCODE = '22023';
  END IF;

  v_type := upper(btrim(COALESCE(v_campaign.type, '')));
  v_org  := v_campaign.organization_id;

  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[])
    INTO v_requested
    FROM unnest(COALESCE(p_lead_ids, ARRAY[]::uuid[])) AS x;

  -- Classify every requested lead exactly once.
  WITH resolved AS (
    SELECT r.lead_id,
           l.id                AS found_id,
           l.assigned_agent_id AS owner_id
      FROM unnest(v_requested) AS r(lead_id)
      LEFT JOIN public.leads l
        ON l.id = r.lead_id
       AND l.organization_id = v_org
  ),
  classified AS (
    SELECT rs.lead_id,
           CASE
             WHEN rs.found_id IS NULL THEN 'not_found'
             WHEN NOT private.can_authorize_campaign_lead(p_campaign_id, rs.lead_id) THEN 'ineligible'
             WHEN EXISTS (
                    SELECT 1 FROM public.campaign_leads cl
                     WHERE cl.campaign_id = p_campaign_id
                       AND cl.lead_id = rs.lead_id
                  ) THEN 'already'
             -- PERSONAL: the lead must be owned by the campaign owner.
             -- IS NOT DISTINCT FROM is NULL-safe: an unassigned lead is ineligible.
             WHEN v_type = 'PERSONAL' THEN
               CASE WHEN rs.owner_id IS NOT DISTINCT FROM v_campaign.user_id
                    THEN 'eligible' ELSE 'ineligible' END
             -- TEAM: participants come from assigned_agent_ids. Unassigned leads are
             -- explicitly eligible and remain unassigned (no premature claim).
             WHEN v_type = 'TEAM' THEN
               CASE
                 WHEN rs.owner_id IS NULL THEN 'eligible'
                 WHEN rs.owner_id::text IN (
                        SELECT jsonb_array_elements_text(
                                 COALESCE(v_campaign.assigned_agent_ids, '[]'::jsonb))
                      ) THEN 'eligible'
                 ELSE 'ineligible'
               END
             -- OPEN POOL: organization-wide.
             WHEN v_type IN ('OPEN POOL', 'OPEN') THEN 'eligible'
             ELSE 'ineligible'
           END AS verdict
      FROM resolved rs
  )
  SELECT COALESCE(array_agg(lead_id) FILTER (WHERE verdict = 'eligible'),   ARRAY[]::uuid[]),
         COALESCE(array_agg(lead_id) FILTER (WHERE verdict = 'already'),    ARRAY[]::uuid[]),
         COALESCE(array_agg(lead_id) FILTER (WHERE verdict = 'ineligible'), ARRAY[]::uuid[]),
         COALESCE(array_agg(lead_id) FILTER (WHERE verdict = 'not_found'),  ARRAY[]::uuid[])
    INTO v_eligible_ids, v_already_ids, v_ineligible_ids, v_not_found_ids
    FROM classified;

  -- Atomic, conflict-safe insert. ORDER BY gives a deterministic lock order so two
  -- concurrent retries cannot deadlock; ON CONFLICT makes a double-click a no-op.
  WITH ins AS (
    INSERT INTO public.campaign_leads (
      campaign_id, lead_id, first_name, last_name, phone, email, state, age,
      status, organization_id, user_id, import_history_id
    )
    SELECT p_campaign_id,
           l.id,
           l.first_name,
           l.last_name,
           l.phone,
           l.email,
           public.normalize_us_state(l.state),
           l.age,
           'Queued',
           v_org,
           l.assigned_agent_id,   -- EXPLICIT owner. Never the auth.uid() default.
           p_import_history_id
      FROM public.leads l
     WHERE l.id = ANY (v_eligible_ids)
       AND l.organization_id = v_org
     ORDER BY l.id
    ON CONFLICT (campaign_id, lead_id) WHERE lead_id IS NOT NULL DO NOTHING
    RETURNING lead_id
  )
  SELECT COALESCE(array_agg(lead_id), ARRAY[]::uuid[]) INTO v_added_ids FROM ins;

  v_added := COALESCE(array_length(v_added_ids, 1), 0);
  -- Eligible rows that lost the race to a concurrent caller are already-present, not failures.
  v_raced := COALESCE(array_length(v_eligible_ids, 1), 0) - v_added;

  -- Category invariant for THIS call (non-overlapping, exhaustive over the distinct request):
  --   requested = added + already_present(+raced) + ineligible + not_found
  IF COALESCE(array_length(v_requested, 1), 0) <> v_added
       + COALESCE(array_length(v_already_ids, 1), 0) + v_raced
       + COALESCE(array_length(v_ineligible_ids, 1), 0)
       + COALESCE(array_length(v_not_found_ids, 1), 0) THEN
    RAISE EXCEPTION 'attachment category partition is inconsistent (requested=%, added=%, '
      'already=%, raced=%, ineligible=%, not_found=%)',
      COALESCE(array_length(v_requested, 1), 0), v_added,
      COALESCE(array_length(v_already_ids, 1), 0), v_raced,
      COALESCE(array_length(v_ineligible_ids, 1), 0),
      COALESCE(array_length(v_not_found_ids, 1), 0);
  END IF;

  -- Only newly inserted, explicitly authorized associations are proven. Existing rows are NOT backfilled.
  INSERT INTO private.team_queue_associations
    (campaign_lead_id, organization_id, campaign_id, lead_id, validated_by, validation_source)
  SELECT cl.id, cl.organization_id, cl.campaign_id, cl.lead_id, auth.uid(), 'attachment'
    FROM public.campaign_leads cl
   WHERE cl.campaign_id = p_campaign_id AND cl.organization_id = v_org
     AND cl.lead_id = ANY (v_added_ids)
     AND upper(btrim(v_campaign.type)) IN ('TEAM', 'OPEN', 'OPEN POOL');

  RETURN jsonb_build_object(
    'added',                   v_added,
    'added_ids',               to_jsonb(v_added_ids),
    'skipped',                 COALESCE(array_length(v_requested, 1), 0) - v_added,
    'skipped_ids',             to_jsonb(
                                 ARRAY(SELECT unnest(v_requested)
                                       EXCEPT SELECT unnest(v_added_ids))),
    'skipped_already_present', COALESCE(array_length(v_already_ids, 1), 0) + v_raced,
    'skipped_ineligible',      COALESCE(array_length(v_ineligible_ids, 1), 0),
    'skipped_not_found',       COALESCE(array_length(v_not_found_ids, 1), 0),
    'already_present_ids',     to_jsonb(v_already_ids),
    'ineligible_ids',          to_jsonb(v_ineligible_ids)
  );
END;
$$;
