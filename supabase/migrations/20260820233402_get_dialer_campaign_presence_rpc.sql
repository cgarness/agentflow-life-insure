-- =====================================================================================================
-- Dialer campaign-selection presence: public.get_dialer_campaign_presence(uuid[])
-- =====================================================================================================
-- STATUS: AUTHORED for the campaign-selection table redesign (implementation_plan.md, approved for
-- LOCAL DEVELOPMENT ONLY by Chris 2026-08-20). PRODUCTION APPLY IS SEPARATELY GATED — do not apply
-- without Chris's explicit approval.
--
-- One read-only aggregate powering the "Active Agents" column, the header total, and the leadership
-- expanded-row identities on the Dialer campaign-selection screen. One call serves the whole screen
-- (no per-row N+1).
--
-- ACTIVE-AGENT DEFINITION (server-authoritative):
--   dialer_sessions.status = 'active'
--   AND campaign_id = the campaign
--   AND last_heartbeat_at >= now() - interval '3 minutes'
--   counted as COUNT(DISTINCT agent_id).
-- The 3-minute window is the exact complement of private.close_stale_dialer_sessions'
-- stale predicate (last_heartbeat_at < now() - 3 minutes => abandoned), so presence and the
-- stale-cleanup canon cannot disagree at the boundary. Stale/ended/abandoned/NULL-campaign
-- sessions never count. THIS FUNCTION IS READ-ONLY: it never mutates stale sessions (cleanup
-- stays owned by start_dialer_session / heartbeat_dialer_session).
--
-- WHY SECURITY DEFINER: dialer_sessions Agent RLS is own-row-only (dialer_sessions_agent_select),
-- so a SECURITY INVOKER aggregate run by an Agent could only ever count the caller's own session.
-- The manager SELECT policy covers Admin/'Team Leader' only, which would fork the data path by
-- role. DEFINER with explicit in-function authorization is the established pattern
-- (get_queue_metrics, get_campaign_card_stats, get_org_leaderboard_stats).
--
-- AUTHORIZATION (Chris amendment 1 — NO duplicated campaign rules):
--   * Actor resolved via private.campaign_actor(): requires auth.uid(), org context, an Active
--     profile, and profile-org == JWT-org — raises 42501 otherwise. Role comes from
--     public.profiles (DB-authoritative), never a browser flag and never the JWT role claim.
--   * The requested ids can only NARROW the caller's dialable set: each same-org candidate is
--     gated by the CANONICAL public.can_dial_campaign(c.id) (Open Pool -> all; Personal ->
--     owner ONLY, no admin/view-all escape; Team -> assigned_agent_ids membership). No second
--     implementation of those rules exists here to drift.
--   * Identity payload is returned ONLY when the DB-read role is 'Admin' / 'Team Leader' /
--     'Super Admin' or is_super_admin is true (Chris ruling D2: legacy 'Team Lead' is NOT
--     leadership). Agent callers always receive active_agents = '[]'. Identity fields are the
--     minimum the UI needs: agent_id, display_name, avatar_url, last_heartbeat_at — never
--     email, phone, or role.
--
-- INPUT SAFETY (Chris amendment 2): pg_catalog.cardinality() — TOTAL element count, so a
-- multidimensional array cannot smuggle > 200 elements past the cap. NULL/empty -> empty
-- result; > 200 total elements -> SQLSTATE 22023. Duplicate ids are deduplicated.
--
-- RESULT CONTRACT: one row per requested campaign the caller may dial — an authorized-but-idle
-- campaign returns active_agent_count = 0 (the authoritative zero). Unauthorized / cross-org /
-- unknown ids return NO row (the frontend renders an em dash, never a fabricated zero).
-- Identity ordering is deterministic (Chris amendment 3): last_heartbeat_at DESC, agent_id.
--
-- PERFORMANCE: the session aggregate is served by the existing
-- idx_dialer_sessions_org_status_heartbeat (organization_id, status, last_heartbeat_at) —
-- EXPLAIN (ANALYZE, BUFFERS) evidence in WORK_LOG. No new index. can_dial_campaign runs once
-- per requested id (each: one campaigns PK lookup + one profiles PK lookup via campaign_actor),
-- bounded by the 200-id cap; measured timings recorded in WORK_LOG.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_dialer_campaign_presence(uuid[]);
-- (No table, no index, no RLS, no trigger, no dependents; the frontend degrades to the
-- presence-unavailable "—" state by design when the function is absent.)
-- =====================================================================================================

CREATE OR REPLACE FUNCTION public.get_dialer_campaign_presence(p_campaign_ids uuid[])
RETURNS TABLE(campaign_id uuid, active_agent_count integer, active_agents jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor  RECORD;
  v_leader boolean;
BEGIN
  -- Explicit auth: raises 42501 for unauthenticated / no org context / profile missing /
  -- org mismatch / non-Active profile. DB-authoritative role, never the JWT role claim.
  SELECT * INTO v_actor FROM private.campaign_actor();

  -- Amendment 2: TOTAL cardinality (not first-dimension array_length) for both checks.
  IF p_campaign_ids IS NULL OR pg_catalog.cardinality(p_campaign_ids) = 0 THEN
    RETURN;  -- empty input -> empty result, no error
  END IF;
  IF pg_catalog.cardinality(p_campaign_ids) > 200 THEN
    RAISE EXCEPTION 'too many campaign ids (max 200)' USING ERRCODE = '22023';
  END IF;

  -- D2: exact 'Team Leader' only — legacy 'Team Lead' is deliberately NOT leadership
  -- (matches dialer_sessions_manager_select and the profiles role CHECK).
  v_leader := v_actor.is_super
           OR v_actor.actor_role IN ('Admin', 'Team Leader', 'Super Admin');

  RETURN QUERY
  WITH req AS (  -- dedupe caller-supplied ids (unnest flattens any array shape)
    SELECT DISTINCT u.id FROM pg_catalog.unnest(p_campaign_ids) AS u(id)
  ),
  camp AS (
    -- AUTHORIZATION BOUNDARY (amendment 1): the input only narrows the caller's DIALABLE
    -- set, decided by the CANONICAL function. The org filter is a cheap same-tenant
    -- narrowing; can_dial_campaign independently enforces org + type rules and fails closed.
    SELECT c.id
    FROM public.campaigns c
    JOIN req ON req.id = c.id
    WHERE c.organization_id = v_actor.org_id
      AND public.can_dial_campaign(c.id)
  ),
  fresh AS (
    -- ACTIVE = active status + heartbeat inside 3 minutes. NULL-campaign sessions can
    -- never join; the (organization_id, status, last_heartbeat_at) index serves this.
    SELECT ds.campaign_id AS cid,
           ds.agent_id,
           pg_catalog.max(ds.last_heartbeat_at) AS last_heartbeat_at
    FROM public.dialer_sessions ds
    JOIN camp ON camp.id = ds.campaign_id
    WHERE ds.organization_id = v_actor.org_id
      AND ds.status = 'active'
      AND ds.last_heartbeat_at >= pg_catalog.now() - interval '3 minutes'
    GROUP BY ds.campaign_id, ds.agent_id
  ),
  counts AS (
    SELECT f.cid, pg_catalog.count(DISTINCT f.agent_id)::integer AS cnt
    FROM fresh f
    GROUP BY f.cid
  ),
  idents AS (
    -- Built ONLY for leadership callers; minimal identity fields, deterministic order.
    SELECT f.cid,
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'agent_id',          f.agent_id,
               'display_name',      NULLIF(pg_catalog.btrim(
                                      COALESCE(p.first_name, '') || ' ' ||
                                      COALESCE(p.last_name, '')), ''),
               'avatar_url',        NULLIF(p.avatar_url, ''),
               'last_heartbeat_at', f.last_heartbeat_at
             ) ORDER BY f.last_heartbeat_at DESC, f.agent_id  -- amendment 3
           ) AS agents
    FROM fresh f
    LEFT JOIN public.profiles p
      ON p.id = f.agent_id AND p.organization_id = v_actor.org_id
    WHERE v_leader
    GROUP BY f.cid
  )
  SELECT camp.id,
         COALESCE(counts.cnt, 0),
         CASE WHEN v_leader THEN COALESCE(idents.agents, '[]'::jsonb)
              ELSE '[]'::jsonb END
  FROM camp
  LEFT JOIN counts ON counts.cid = camp.id
  LEFT JOIN idents ON idents.cid = camp.id;
END;
$$;

COMMENT ON FUNCTION public.get_dialer_campaign_presence(uuid[]) IS
  'Dialer selection-screen presence: per-campaign COUNT(DISTINCT agent_id) of active dialer sessions with a heartbeat inside 3 minutes (the stale-session complement). Requested ids only narrow the caller''s dialable scope via the canonical public.can_dial_campaign. Identity details (agent_id, display_name, avatar_url, last_heartbeat_at only) are returned solely to DB-verified Admin / Team Leader / Super Admin callers; Agent callers get counts with an empty identity array. Read-only; never mutates stale sessions.';

-- Functions created in an exposed schema receive PUBLIC/anon EXECUTE by default, and
-- CREATE OR REPLACE never resets an ACL — revoke both explicitly (house standard,
-- 20260807165620 precedent), then grant only what the app needs.
REVOKE ALL ON FUNCTION public.get_dialer_campaign_presence(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dialer_campaign_presence(uuid[]) TO authenticated, service_role;
