-- =====================================================================================================
-- Notifications: DB-enforced exactly-once creation, routed-recipient persistence, lead-assignment
-- coverage without import spam, server-authoritative win fan-out, and INSERT-policy hardening.
-- (Notifications Build 1 — plan: implementation_plan.md on branch claude/notifications-drawer-refactor-gi8cee)
--
-- STATUS: AUTHORED for local development/testing only. Production apply requires Chris's separate
-- explicit approval (D8 covers authoring + disposable-local testing only). #APPROVE_RLS_CHANGE scope
-- per ruling D8. Test suite: supabase/tests/notifications_idempotency.sql (disposable localhost only).
--
-- What this migration does:
--   1. notifications.event_key (NOT NULL, unique-filler default) + UNIQUE (user_id, event_key)
--      — the arbiter that makes every notification writer idempotent per (recipient, source event).
--      NOTE: the volatile default rewrites the notifications table (79 rows at authoring time,
--      sub-second); historical row CONTENT is unchanged. Guarantee is exactly-once during the
--      retained notification lifecycle (30-day retention cron unchanged).
--   2. notifications.dismissed_at — soft dismissal. The UI "Delete" becomes an UPDATE so the
--      event_key survives until retention deletes the row; webhook retries cannot resurrect a
--      dismissed alert.
--   3. calls.routed_agent_ids + append_call_routed_agents(): atomic, org-scoped, duplicate-free
--      array union computed inside one UPDATE (no Edge read-modify-write; overlapping ring waves
--      cannot lose updates). SECURITY INVOKER; EXECUTE granted to service_role only.
--   4. Lead-assignment notifications: replaces row-level trg_notify_lead_assigned (UPDATE-only)
--      with statement-level INSERT + UPDATE triggers using transition tables. One detailed
--      notification for a single assignment, one summary per recipient for a bulk statement
--      (CSV import inserts each set in ONE statement). Self-assignments (auth.uid()) and
--      self-imports (assigned = imported_by_user_id) are skipped. EXCEPTION-guarded so a
--      notification failure can NEVER abort a lead write. EXECUTE revoked (resolves the two
--      security-advisor WARNs on notify_lead_assigned).
--   5. notify_win(p_win_id): server-authoritative win fan-out. The authorization predicate is an
--      exact mirror of the VERIFIED live convert_lead_to_client_atomic authorization, mapped onto
--      the win the conversion produces (see the in-function branch-by-branch proof) — so no win
--      recordable through the verified creation flows can be recorded while its broadcast is
--      silently suppressed. The TL branch is fail-closed in prod while hierarchy_path is depth-1,
--      IDENTICALLY in both flows (they re-activate together when the hierarchy repair lands).
--      Content is built from DB data only; recipients are Active profiles explicitly scoped to
--      the win's organization.
--   6. notifications_insert policy: TO authenticated, non-null auth.uid(), self-user ownership,
--      org membership. Cross-user creation is server-side only (service role / DEFINER paths).
--
-- ROLLBACK (documented inverse; each step independent):
--   DROP POLICY notifications_insert + recreate baseline policy
--     (WITH CHECK (organization_id = public.get_user_org_id()));
--   DROP FUNCTION public.notify_win(uuid);
--   DROP TRIGGER trg_notify_lead_assignments_ins ON public.leads;
--   DROP TRIGGER trg_notify_lead_assignments_upd ON public.leads;
--   DROP FUNCTION public.notify_lead_assignments();
--   recreate public.notify_lead_assigned() + trg_notify_lead_assigned verbatim from baseline
--     20260806000000 L4474-4501 / L10235 with its baseline grants;
--   DROP FUNCTION public.append_call_routed_agents(uuid, uuid, uuid[]);
--   ALTER TABLE public.calls DROP COLUMN routed_agent_ids;
--   DROP INDEX uq_notifications_user_event_key;
--   ALTER TABLE public.notifications DROP COLUMN event_key;
--   ALTER TABLE public.notifications DROP COLUMN dismissed_at;
-- =====================================================================================================

-- ── 1. event_key + unique arbiter ────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_key text NOT NULL DEFAULT (gen_random_uuid())::text;

COMMENT ON COLUMN public.notifications.event_key IS
  'Idempotency key: one notification per (user_id, event_key). Deterministic for event-sourced rows '
  '(missed_call:<call_id>, win:<win_id>, inbound_sms:<message_sid>, inbound_email:<contact_email_id>); '
  'unique random filler otherwise. Exactly-once holds for the retained lifecycle (30-day retention).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_event_key
  ON public.notifications (user_id, event_key);

-- ── 2. soft dismissal ────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dismissed_at timestamp with time zone;

COMMENT ON COLUMN public.notifications.dismissed_at IS
  'Soft dismissal (UI "Delete"). Dismissed rows are hidden from all list/count queries but keep their '
  'event_key until the 30-day retention cron deletes them, so retried events cannot resurrect them.';

-- ── 3. routed recipients on calls + atomic union RPC ─────────────────────────────────────────────────

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS routed_agent_ids uuid[];

COMMENT ON COLUMN public.calls.routed_agent_ids IS
  'Union of agent user-ids actually rung for this inbound call (direct line, assigned, round robin, '
  'all-ring, fallback-chain waves). Written only by twilio-voice-inbound via append_call_routed_agents. '
  'Missed-call notification recipient priority reads it first.';

CREATE OR REPLACE FUNCTION public.append_call_routed_agents(
  p_call_id uuid,
  p_org_id uuid,
  p_agent_ids uuid[]
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF p_call_id IS NULL OR p_org_id IS NULL OR p_agent_ids IS NULL
     OR cardinality(p_agent_ids) = 0 THEN
    RETURN false;
  END IF;

  -- The union is computed inside the single UPDATE under the row lock; under READ COMMITTED a
  -- concurrent writer's committed value is re-read (EvalPlanQual), so overlapping ring waves
  -- cannot lose each other's ids. Never replaces the array wholesale.
  UPDATE public.calls c
     SET routed_agent_ids = (
           SELECT array_agg(DISTINCT u.agent_id)
             FROM unnest(COALESCE(c.routed_agent_ids, ARRAY[]::uuid[]) || p_agent_ids) AS u(agent_id)
            WHERE u.agent_id IS NOT NULL
         ),
         updated_at = now()
   WHERE c.id = p_call_id
     AND c.organization_id = p_org_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.append_call_routed_agents(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_call_routed_agents(uuid, uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.append_call_routed_agents(uuid, uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_call_routed_agents(uuid, uuid, uuid[]) TO service_role;

-- ── 4. lead-assignment notifications (statement-level, import-spam-free) ─────────────────────────────

DROP TRIGGER IF EXISTS trg_notify_lead_assigned ON public.leads;
DROP FUNCTION IF EXISTS public.notify_lead_assigned();

CREATE OR REPLACE FUNCTION public.notify_lead_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  r record;
BEGIN
  -- Notification failure must NEVER abort the lead write (same philosophy as the workflow
  -- dispatch guards): everything is inside one exception net.
  BEGIN
    IF TG_OP = 'INSERT' THEN
      FOR r IN
        SELECT n.assigned_agent_id                          AS agent_id,
               n.organization_id                            AS org_id,
               count(*)                                     AS cnt,
               (min(n.id::text))::uuid                      AS single_lead_id,
               min(btrim(COALESCE(n.first_name, '') || ' ' || COALESCE(n.last_name, ''))) AS single_lead_name
          FROM new_rows n
         WHERE n.assigned_agent_id IS NOT NULL
           AND n.organization_id IS NOT NULL
           -- self-assignment (the actor assigning to themselves) is noise, not news
           AND n.assigned_agent_id IS DISTINCT FROM auth.uid()
           -- self-import: the importer importing to themselves (service-role context, auth.uid() null)
           AND (n.imported_by_user_id IS NULL OR n.assigned_agent_id <> n.imported_by_user_id)
         GROUP BY n.assigned_agent_id, n.organization_id
      LOOP
        IF r.cnt = 1 THEN
          INSERT INTO public.notifications
            (user_id, type, title, body, action_url, action_label, metadata, organization_id)
          VALUES
            (r.agent_id, 'lead_claimed', 'New Lead Assigned',
             'A new lead has been assigned to you: ' || COALESCE(NULLIF(r.single_lead_name, ''), 'New lead'),
             '/contacts?contact=' || r.single_lead_id::text,
             'View Contact',
             jsonb_build_object('lead_id', r.single_lead_id),
             r.org_id);
        ELSE
          INSERT INTO public.notifications
            (user_id, type, title, body, action_url, action_label, metadata, organization_id)
          VALUES
            (r.agent_id, 'lead_claimed', 'New Leads Assigned',
             r.cnt::text || ' new leads have been assigned to you',
             '/contacts',
             'View Leads',
             jsonb_build_object('count', r.cnt),
             r.org_id);
        END IF;
      END LOOP;

    ELSIF TG_OP = 'UPDATE' THEN
      FOR r IN
        SELECT nr.assigned_agent_id                         AS agent_id,
               nr.organization_id                           AS org_id,
               count(*)                                     AS cnt,
               (min(nr.id::text))::uuid                     AS single_lead_id,
               min(btrim(COALESCE(nr.first_name, '') || ' ' || COALESCE(nr.last_name, ''))) AS single_lead_name
          FROM new_rows nr
          JOIN old_rows o ON o.id = nr.id
         WHERE nr.assigned_agent_id IS NOT NULL
           AND nr.organization_id IS NOT NULL
           AND nr.assigned_agent_id IS DISTINCT FROM o.assigned_agent_id
           AND nr.assigned_agent_id IS DISTINCT FROM auth.uid()
         GROUP BY nr.assigned_agent_id, nr.organization_id
      LOOP
        IF r.cnt = 1 THEN
          INSERT INTO public.notifications
            (user_id, type, title, body, action_url, action_label, metadata, organization_id)
          VALUES
            (r.agent_id, 'lead_claimed', 'New Lead Assigned',
             'A new lead has been assigned to you: ' || COALESCE(NULLIF(r.single_lead_name, ''), 'New lead'),
             '/contacts?contact=' || r.single_lead_id::text,
             'View Contact',
             jsonb_build_object('lead_id', r.single_lead_id),
             r.org_id);
        ELSE
          INSERT INTO public.notifications
            (user_id, type, title, body, action_url, action_label, metadata, organization_id)
          VALUES
            (r.agent_id, 'lead_claimed', 'New Leads Assigned',
             r.cnt::text || ' leads have been assigned to you',
             '/contacts',
             'View Leads',
             jsonb_build_object('count', r.cnt),
             r.org_id);
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_lead_assignments skipped (lead write unaffected): %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_lead_assignments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_lead_assignments() FROM anon;
REVOKE ALL ON FUNCTION public.notify_lead_assignments() FROM authenticated;

DROP TRIGGER IF EXISTS trg_notify_lead_assignments_ins ON public.leads;
CREATE TRIGGER trg_notify_lead_assignments_ins
  AFTER INSERT ON public.leads
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_lead_assignments();

-- NOTE: PostgreSQL disallows transition tables on column-filtered triggers ("transition tables cannot
-- be specified for triggers with column lists"), so this fires on every leads UPDATE statement and the
-- function filters on assigned_agent_id change. Transition tables contain only the statement's rows,
-- so the per-statement cost is proportional to the rows actually updated.
DROP TRIGGER IF EXISTS trg_notify_lead_assignments_upd ON public.leads;
CREATE TRIGGER trg_notify_lead_assignments_upd
  AFTER UPDATE ON public.leads
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_lead_assignments();

-- ── 5. server-authoritative win fan-out ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_win(p_win_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_win record;
  v_caller record;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT w.id, w.agent_id, w.agent_name, w.contact_name, w.organization_id
    INTO v_win
    FROM public.wins w
   WHERE w.id = p_win_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'win_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_win.organization_id IS NULL THEN
    -- a win with no tenant boundary must never broadcast
    RAISE EXCEPTION 'win_missing_organization' USING ERRCODE = '22004';
  END IF;

  -- Database-authoritative caller identity (never the JWT claim). The gate mirrors the VERIFIED
  -- live win-creation flow (convert_lead_to_client_atomic, reconfirmed 2026-08-18): authenticated,
  -- profile exists, same organization. Deliberately NO caller-status requirement — the conversion
  -- RPC has none, and a stricter gate here would let a win be recorded while its broadcast is
  -- silently suppressed.
  SELECT p.id, p.role, p.is_super_admin, p.organization_id
    INTO v_caller
    FROM public.profiles p
   WHERE p.id = v_uid;
  IF NOT FOUND
     OR v_caller.organization_id IS DISTINCT FROM v_win.organization_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Predicate mirror of convert_lead_to_client_atomic's v_authorized, mapped from the lead the
  -- conversion authorized on to the win it produced (wins.agent_id := lead.assigned_agent_id):
  --   * lead.assigned_agent_id = uid            → caller = win.agent_id (self branch)
  --   * lead.user_id = uid                      → collapses into self: tr_sync_leads_user_id forces
  --                                               user_id = assigned_agent_id whenever assigned is
  --                                               non-null, and when assigned is null the win's
  --                                               agent_id is null (next branch)
  --   * unowned lead (user_id + assigned null)  → any same-org member could convert → win.agent_id
  --                                               IS NULL admits the same same-org population
  --   * Admin / super admin                     → identical branches
  --   * role IN ('Team Leader','Team Lead') + is_ancestor_of over the lead's owner columns
  --                                             → same function over win.agent_id (the only owner
  --                                               column that survives into the win; both legacy
  --                                               role strings kept because conversion accepts both)
  -- Same-org membership alone is NOT sufficient for an agent-owned win: a peer Agent who could not
  -- have created it cannot broadcast it. In production hierarchy_path is depth-1 (AGENT_RULES §26),
  -- so the TL branch denies in conversion and here IDENTICALLY — the flows stay in lockstep and
  -- both activate together when the hierarchy repair lands.
  IF NOT (
       v_win.agent_id IS NULL
    OR v_caller.id = v_win.agent_id
    OR v_caller.role = 'Admin'
    OR COALESCE(v_caller.is_super_admin, false)
    OR (v_caller.role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(v_caller.id, v_win.agent_id))
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Content from DB data only; recipients explicitly org-scoped; exactly-once per (recipient, win).
  INSERT INTO public.notifications
    (user_id, type, title, body, action_url, action_label, metadata, organization_id, event_key)
  SELECT p.id,
         'win',
         COALESCE(NULLIF(btrim(v_win.agent_name), ''), 'An agent') || ' just sold a policy! 🎉',
         'Sold to ' || COALESCE(NULLIF(btrim(v_win.contact_name), ''), 'a client'),
         '/leaderboard',
         'View Leaderboard',
         jsonb_build_object('win_id', v_win.id, 'agent_id', v_win.agent_id),
         v_win.organization_id,
         'win:' || v_win.id::text
    FROM public.profiles p
   WHERE p.organization_id = v_win.organization_id
     AND p.status = 'Active'
  ON CONFLICT (user_id, event_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_win(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_win(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_win(uuid) TO authenticated;

-- ── 6. INSERT policy hardening (#APPROVE_RLS_CHANGE — ruling D8: local scope only for now) ───────────

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND organization_id = public.get_user_org_id()
  );

NOTIFY pgrst, 'reload schema';
