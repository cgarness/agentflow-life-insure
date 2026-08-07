-- ============================================================================
-- Campaign membership uniqueness + attachment core
--
-- Fixes, in one reviewable unit:
--   1. campaign_leads had NO uniqueness on (campaign_id, lead_id) — the RPC's
--      SELECT-EXISTS-then-INSERT duplicate check was a race with no backstop.
--   2. add_leads_to_campaign never wrote campaign_leads.user_id, so the column
--      DEFAULT auth.uid() recorded the OPERATOR instead of the lead's owner.
--      (Production drift at authoring time: 32/32 Open Pool rows carried the
--      importing Admin's uuid while leads.assigned_agent_id was a different agent.)
--   3. Team eligibility inferred membership from campaigns.user_id +
--      is_ancestor_of() instead of reading campaigns.assigned_agent_ids.
--   4. Unassigned leads reached Team campaigns only by accident: the old
--      predicate evaluated to NULL and PL/pgSQL treats a NULL IF as false. Now explicit.
--   5. The RPC is SECURITY DEFINER but performed no caller authorization beyond
--      "campaign is in my org" — an arbitrary-write endpoint for any org member.
--   6. import_completion_metadata was REBUILT with jsonb_build_object on every
--      batch, destroying the 'tagged'/'finalized_at' keys. Now merged.
--
-- NOT changed here: any RLS policy, any grant on a table, the Edge Function,
-- the queue-claim path, or existing rows (no UPDATE/DELETE against campaign_leads).
--
-- ROLLBACK: executable script at
--   supabase/rollback/20260807_import_campaign_attachment_rollback.sql
-- It contains the VERBATIM pre-change definition of public.add_leads_to_campaign(uuid,uuid[],uuid)
-- captured from production via pg_get_functiondef BEFORE this migration (md5-verified identical),
-- plus the DROPs for the private helpers and the unique index, plus the schema_migrations cleanup.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Uniqueness on campaign membership.
--    Guard first: ABORT on pre-existing duplicates. Never silently delete or merge.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dupes bigint;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT campaign_id, lead_id
    FROM public.campaign_leads
    WHERE lead_id IS NOT NULL
    GROUP BY campaign_id, lead_id
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'ABORT: % duplicate (campaign_id, lead_id) pair(s) exist in public.campaign_leads. '
      'This migration will not deduplicate production data. Resolve them under a separate, '
      'reviewed repair and re-run.', v_dupes
      USING ERRCODE = '23505';
  END IF;
END;
$$;

-- Name-collision guard: fail closed. An object already occupying the intended name must NOT be
-- silently accepted — it could be an unrelated or differently-defined index, which would leave the
-- ON CONFLICT insert below without the uniqueness it depends on.
DO $$
DECLARE
  v_existing text;
BEGIN
  SELECT c.relkind::text INTO v_existing
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'campaign_leads_campaign_lead_unique';

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: an object named public.campaign_leads_campaign_lead_unique already exists '
      '(relkind=%). This migration will not adopt a pre-existing object under its intended '
      'name. Inspect it, and drop or rename it under a separate reviewed change, then re-run.',
      v_existing
      USING ERRCODE = '42710';
  END IF;
END;
$$;

-- Partial: campaign_leads.lead_id is nullable and its FK is ON DELETE SET NULL, so
-- multiple orphaned (NULL lead_id) rows per campaign must remain legal.
--
-- Deliberately NOT `IF NOT EXISTS`: this must fail loudly if it cannot be created exactly as
-- designed. Combined with the duplicate guard above and the name guard immediately above, the
-- migration aborts (rolling the whole transaction back, changing nothing) when duplicates exist,
-- when the name is occupied, or when the index cannot be built as specified.
CREATE UNIQUE INDEX campaign_leads_campaign_lead_unique
  ON public.campaign_leads (campaign_id, lead_id)
  WHERE lead_id IS NOT NULL;

-- Post-create assertion: the index must be UNIQUE, on exactly (campaign_id, lead_id), and PARTIAL.
DO $$
DECLARE
  v_def text;
  v_unique boolean;
BEGIN
  SELECT pg_get_indexdef(c.oid), i.indisunique
    INTO v_def, v_unique
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
   WHERE n.nspname = 'public' AND c.relname = 'campaign_leads_campaign_lead_unique';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ABORT: campaign_leads_campaign_lead_unique was not created';
  END IF;
  IF NOT v_unique THEN
    RAISE EXCEPTION 'ABORT: campaign_leads_campaign_lead_unique is not UNIQUE (def: %)', v_def;
  END IF;
  IF v_def !~ 'campaign_id' OR v_def !~ 'lead_id' OR v_def !~ 'WHERE \(lead_id IS NOT NULL\)' THEN
    RAISE EXCEPTION 'ABORT: campaign_leads_campaign_lead_unique has an unexpected definition: %', v_def;
  END IF;
END;
$$;

COMMENT ON INDEX public.campaign_leads_campaign_lead_unique IS
  'One queue row per (campaign, lead). Backs the conflict-safe ON CONFLICT DO NOTHING '
  'insert in private.attach_leads_to_campaign_core, replacing a SELECT-then-INSERT race.';

-- ---------------------------------------------------------------------------
-- 2. Shared actor resolution.
--    D-1: role is read from public.profiles — NEVER get_user_role(), which reads only
--    the JWT app_metadata.role claim with no profiles fallback (AGENT_RULES inv. #19),
--    so a stale claim would silently demote an Admin. Also validates the profile is
--    ACTIVE and belongs to the authoritative organization (public.get_org_id()).
--    profiles is not writable by `authenticated` (SELECT-only grant), so this cannot
--    be self-escalated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.campaign_actor()
RETURNS TABLE (uid uuid, org_id uuid, actor_role text, is_super boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_p   RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no organization context' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.organization_id, COALESCE(p.is_super_admin, false) AS isa, p.status
    INTO v_p
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '42501';
  END IF;
  IF v_p.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_p.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'profile is not active' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_uid, v_org, v_p.role, v_p.isa;
END;
$$;

REVOKE ALL ON FUNCTION private.campaign_actor() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. May this actor administer this campaign (attach leads to it)?
--    Personal: owner, or same-org Admin / Super Admin, or an authorized Team Leader.
--    D-2: Team Leader authority uses public.is_ancestor_of ONLY and therefore FAILS
--    CLOSED while profiles.hierarchy_path is unrepaired. No upline_id fallback is
--    introduced here — repairing the hierarchy is a separate, required follow-up.
-- ---------------------------------------------------------------------------
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

  -- Open Pool and Team keep their established organization/participant semantics.
  IF v_type <> 'PERSONAL' THEN
    RETURN true;
  END IF;

  IF v_campaign.user_id = v_actor.uid THEN
    RETURN true;
  END IF;
  IF v_actor.actor_role = 'Admin' OR v_actor.is_super THEN
    RETURN true;
  END IF;
  IF v_actor.actor_role IN ('Team Leader', 'Team Lead')
     AND v_campaign.user_id IS NOT NULL
     AND public.is_ancestor_of(v_actor.uid, v_campaign.user_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.can_administer_campaign(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The attachment engine. Internal only — never directly callable.
--    Every public wrapper validates auth.uid(), organization, role scope, campaign
--    compatibility and provenance BEFORE delegating here.
-- ---------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION private.attach_leads_to_campaign_core(uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.attach_leads_to_campaign_core(uuid, uuid[], uuid) IS
  'Internal attachment engine. NOT directly executable by PUBLIC/anon/authenticated. '
  'Callers must authorize the actor and validate provenance first.';

-- ---------------------------------------------------------------------------
-- 5. public.add_leads_to_campaign — SAME 3-arg signature and SAME argument names.
--    Response keys added/skipped/skipped_ids are preserved and remain first, so every
--    existing caller (AddToCampaignModal, Contacts bulk add, CampaignDetail, the CSV
--    import path) keeps working unchanged. Reason-specific counts are additive.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_leads_to_campaign(
  p_campaign_id       uuid,
  p_lead_ids          uuid[],
  p_import_history_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor     RECORD;
  v_ctx       RECORD;
  v_campaign  public.campaigns%ROWTYPE;
  v_result    jsonb;
  v_attempted int := COALESCE(array_length(p_lead_ids, 1), 0);
BEGIN
  -- Caller authorization (NEW). Raises on unauthenticated / inactive / cross-org.
  SELECT * INTO v_actor FROM private.campaign_actor();

  -- Import provenance gate — behaviour preserved verbatim from the prior definition.
  IF p_import_history_id IS NOT NULL THEN
    SELECT * INTO v_ctx FROM public._import_undo_context(p_import_history_id);
    IF v_ctx.reason IS NOT NULL THEN
      RAISE EXCEPTION 'import provenance rejected: %', v_ctx.reason USING ERRCODE = '42501';
    END IF;
    IF NOT v_ctx.authorized THEN
      RAISE EXCEPTION 'not authorized for import %', p_import_history_id USING ERRCODE = '42501';
    END IF;
    IF v_ctx.already_undone THEN
      RAISE EXCEPTION 'import % already undone', p_import_history_id USING ERRCODE = '22023';
    END IF;
    IF v_ctx.campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION 'import % campaign mismatch', p_import_history_id USING ERRCODE = '22023';
    END IF;
    IF v_ctx.completion_status IS NOT NULL AND v_ctx.completion_status <> 'pending_campaign' THEN
      RAISE EXCEPTION 'import % already finalized (%)', p_import_history_id, v_ctx.completion_status
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_lead_ids) x WHERE x <> ALL (v_ctx.validated_ids)) THEN
      RAISE EXCEPTION 'lead id outside import % set', p_import_history_id USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_campaign
    FROM public.campaigns
   WHERE id = p_campaign_id
     AND organization_id = v_actor.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  IF NOT private.can_administer_campaign(p_campaign_id) THEN
    RAISE EXCEPTION 'not authorized for campaign %', p_campaign_id USING ERRCODE = '42501';
  END IF;

  v_result := private.attach_leads_to_campaign_core(p_campaign_id, p_lead_ids, p_import_history_id);

  IF p_import_history_id IS NOT NULL THEN
    -- MERGE (was: rebuilt with jsonb_build_object, which destroyed 'tagged'/'finalized_at').
    UPDATE public.import_history
       SET import_completion_metadata =
             COALESCE(import_completion_metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'attempted',       COALESCE((import_completion_metadata->>'attempted')::int, 0) + v_attempted,
                  'added',           COALESCE((import_completion_metadata->>'added')::int, 0)
                                       + (v_result->>'added')::int,
                  'skipped',         COALESCE((import_completion_metadata->>'skipped')::int, 0)
                                       + (v_result->>'skipped')::int,
                  'batches',         COALESCE((import_completion_metadata->>'batches')::int, 0) + 1,
                  'last_attempt_at', to_jsonb(now())
                )
     WHERE id = p_import_history_id;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) TO authenticated, service_role;
