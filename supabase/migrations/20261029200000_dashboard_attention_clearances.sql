-- =====================================================================================================
-- Dashboard attention clearances — per-viewer "Clear" state for Missed Calls and Callbacks (Gate G3)
-- Plan: docs/plans/2026-10-29-dashboard-polish-v2/implementation_plan.md §3.3
--
-- STATUS: PREPARED, NOT APPLIED. Schema + RLS change: requires Chris's separate, explicit G3 approval.
-- Lives in supabase/migrations/pending/ so no branch merge or preview can apply it. After an approved
-- apply, move it to supabase/migrations/<recorded version>_dashboard_attention_clearances.sql without
-- changing a byte, and reconcile the rollback, runner and CI paths with that version.
--
-- WHAT IT ADDS (nothing else is created, altered or read):
--   * public.dashboard_attention_clearances — one row per user + organization + source item + occurrence
--     that the user cleared from their own Dashboard attention queue. It is ALERT STATE ONLY. It never
--     changes a call, voicemail, recording, notification, campaign lead, callback, appointment or any
--     other CRM / telemetry record, and it is never evidence that a callback was completed.
--   * public.clear_dashboard_attention_item(...) — Clear      (SECURITY INVOKER)
--   * public.undo_dashboard_attention_clear(...) — Undo       (SECURITY INVOKER)
--   * private.dashboard_attention_clearances_guard() — stamps cleared_at; rows are immutable
--
-- SOURCES AND OCCURRENCE IDENTITY (occurrence_at is always derived from the source row, server-side)
--   source_type           source_id            occurrence_at                                  pending means
--   missed_call           calls.id             calls.created_at                               inbound AND is_missed
--   campaign_callback     campaign_leads.id    COALESCE(callback_due_at, scheduled_callback_at)  status not terminal
--   appointment_callback  appointments.id      appointments.start_time                        Follow Up / Call Back, Scheduled
--   A rescheduled callback has a new occurrence_at, so an earlier clearance no longer matches it and it
--   returns to the queue. source_id is never a contact id. There is deliberately NO foreign key to the
--   source tables: no lock is taken on live telephony / queue tables, and their deletes never cascade
--   here. A clearance whose source is gone simply never matches.
--
-- SECURITY MODEL
--   * RLS is the authority. Both RPCs are SECURITY INVOKER: they only derive identity (auth.uid(),
--     get_org_id()) and validate input; the caller's own RLS on this table AND on the source table apply.
--   * A row is visible and deletable only by its own user, inside their JWT organization.
--   * A row can only be inserted for a source the caller can SEE under the existing source RLS, in the
--     caller's organization (Agency Group peer rows are refused), that is currently pending, with an
--     occurrence_at equal to the source's current authoritative value (INSERT WITH CHECK).
--   * The Clear RPC also requires the caller's own profile to be Active in the JWT organization.
--   * anon and PUBLIC get nothing; authenticated gets SELECT/INSERT/DELETE (no UPDATE/TRUNCATE/REFERENCES/
--     TRIGGER) and EXECUTE on the two RPCs; service_role gets SELECT only. No existing policy is changed.
-- =====================================================================================================

SET lock_timeout = '2s';
SET statement_timeout = '60s';

-- ---- Preimage / replay guard -------------------------------------------------------------------------
DO $guard$
DECLARE
  v_columns integer;
BEGIN
  IF to_regclass('public.dashboard_attention_clearances') IS NOT NULL
     OR to_regprocedure('public.clear_dashboard_attention_item(text,uuid,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('public.undo_dashboard_attention_clear(uuid,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('private.dashboard_attention_clearances_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'dashboard_attention_clearances objects already exist; this migration must not be replayed'
      USING ERRCODE = '42P07';
  END IF;
  -- Dependencies this migration relies on, exactly as production has them.
  IF to_regclass('public.organizations') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.calls') IS NULL OR to_regclass('public.campaign_leads') IS NULL
     OR to_regclass('public.appointments') IS NULL OR to_regclass('auth.users') IS NULL
     OR to_regprocedure('public.get_org_id()') IS NULL OR to_regprocedure('auth.uid()') IS NULL
     OR to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'dashboard_attention_clearances: a required dependency is missing' USING ERRCODE = '42704';
  END IF;
  SELECT count(*) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (
      ('calls', 'id'), ('calls', 'organization_id'), ('calls', 'direction'), ('calls', 'is_missed'),
      ('calls', 'created_at'),
      ('campaign_leads', 'id'), ('campaign_leads', 'organization_id'), ('campaign_leads', 'status'),
      ('campaign_leads', 'callback_due_at'), ('campaign_leads', 'scheduled_callback_at'),
      ('appointments', 'id'), ('appointments', 'organization_id'), ('appointments', 'type'),
      ('appointments', 'status'), ('appointments', 'start_time'),
      ('profiles', 'id'), ('profiles', 'organization_id'), ('profiles', 'status'));
  IF v_columns <> 18 THEN
    RAISE EXCEPTION 'dashboard_attention_clearances: a required source column is missing (% of 18)', v_columns
      USING ERRCODE = '42703';
  END IF;
END
$guard$;

-- ---- Table ---------------------------------------------------------------------------------------------
CREATE TABLE public.dashboard_attention_clearances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type     text NOT NULL,
  source_id       uuid NOT NULL,
  occurrence_at   timestamptz NOT NULL,
  cleared_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_attention_clearances_source_type_check
    CHECK (source_type IN ('missed_call', 'campaign_callback', 'appointment_callback')),
  CONSTRAINT dashboard_attention_clearances_occurrence_key
    UNIQUE (organization_id, user_id, source_type, source_id, occurrence_at)
);

COMMENT ON TABLE public.dashboard_attention_clearances IS
  'Per-user Dashboard "Clear" state for Missed Calls and Callbacks, by organization, source item and occurrence. '
  'Alert state only: never a CRM or telemetry record, never evidence that a callback was completed. '
  'Written through clear_dashboard_attention_item / undo_dashboard_attention_clear (SECURITY INVOKER); own rows only (RLS).';

-- The Dashboard's read: own rows of the given source types in a time window (keyset by id on top).
CREATE INDEX dashboard_attention_clearances_reader_idx
  ON public.dashboard_attention_clearances (user_id, organization_id, source_type, occurrence_at);

-- ---- Row invariants on every write path ------------------------------------------------------------
CREATE FUNCTION private.dashboard_attention_clearances_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A clearance cannot be changed; undo it and clear again' USING ERRCODE = '22023';
  END IF;
  -- Undo matches on this exact value, so every clearance gets a distinct, server-side one.
  NEW.cleared_at := clock_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.dashboard_attention_clearances_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER dashboard_attention_clearances_guard
  BEFORE INSERT OR UPDATE ON public.dashboard_attention_clearances
  FOR EACH ROW EXECUTE FUNCTION private.dashboard_attention_clearances_guard();

-- ---- RLS: own rows, own organization, visible and pending sources ---------------------------------
ALTER TABLE public.dashboard_attention_clearances ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_attention_clearances_select ON public.dashboard_attention_clearances
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = (SELECT public.get_org_id()));

CREATE POLICY dashboard_attention_clearances_insert ON public.dashboard_attention_clearances
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND organization_id = (SELECT public.get_org_id())
    AND CASE dashboard_attention_clearances.source_type
      WHEN 'missed_call' THEN EXISTS (
        SELECT 1 FROM public.calls c
        WHERE c.id = dashboard_attention_clearances.source_id
          AND c.organization_id = dashboard_attention_clearances.organization_id
          AND c.direction = 'inbound'
          AND c.is_missed IS TRUE
          AND c.created_at = dashboard_attention_clearances.occurrence_at)
      WHEN 'campaign_callback' THEN EXISTS (
        SELECT 1 FROM public.campaign_leads cl
        WHERE cl.id = dashboard_attention_clearances.source_id
          AND cl.organization_id = dashboard_attention_clearances.organization_id
          AND cl.status NOT IN ('DNC', 'Completed', 'Removed', 'Failed')
          AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) = dashboard_attention_clearances.occurrence_at)
      WHEN 'appointment_callback' THEN EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.id = dashboard_attention_clearances.source_id
          AND a.organization_id = dashboard_attention_clearances.organization_id
          AND a.type IN ('Follow Up', 'Call Back')
          AND a.status = 'Scheduled'
          AND a.start_time = dashboard_attention_clearances.occurrence_at)
      ELSE false
    END);

CREATE POLICY dashboard_attention_clearances_delete ON public.dashboard_attention_clearances
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = (SELECT public.get_org_id()));

-- Supabase default privileges grant ALL on new public tables to anon/authenticated/service_role:
-- reset them to exactly what is needed. Rows are immutable, so there is no UPDATE grant or policy.
REVOKE ALL ON TABLE public.dashboard_attention_clearances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.dashboard_attention_clearances TO authenticated;
GRANT SELECT ON TABLE public.dashboard_attention_clearances TO service_role;

-- ---- Clear ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.clear_dashboard_attention_item(
  p_source_type text,
  p_source_id uuid,
  p_expected_occurrence_at timestamptz
) RETURNS public.dashboard_attention_clearances
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_profile_org uuid;
  v_profile_status text;
  v_current timestamptz;
  v_row public.dashboard_attention_clearances;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Sign in to clear Dashboard items' USING ERRCODE = '42501';
  END IF;
  SELECT p.organization_id, p.status INTO v_profile_org, v_profile_status
  FROM public.profiles p WHERE p.id = v_uid;
  IF v_profile_org IS DISTINCT FROM v_org OR v_profile_status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'Your profile is not active in this agency' USING ERRCODE = '42501';
  END IF;

  IF p_source_type IS NULL OR p_source_type NOT IN ('missed_call', 'campaign_callback', 'appointment_callback') THEN
    RAISE EXCEPTION 'Unknown Dashboard item type' USING ERRCODE = '22023';
  END IF;
  IF p_source_id IS NULL OR p_expected_occurrence_at IS NULL THEN
    RAISE EXCEPTION 'A Dashboard item needs a source and the time it was shown for' USING ERRCODE = '22023';
  END IF;

  -- The source's CURRENT occurrence, read under the caller's own RLS in the caller's organization.
  IF p_source_type = 'missed_call' THEN
    SELECT c.created_at INTO v_current
    FROM public.calls c
    WHERE c.id = p_source_id AND c.organization_id = v_org
      AND c.direction = 'inbound' AND c.is_missed IS TRUE;
  ELSIF p_source_type = 'campaign_callback' THEN
    SELECT COALESCE(cl.callback_due_at, cl.scheduled_callback_at) INTO v_current
    FROM public.campaign_leads cl
    WHERE cl.id = p_source_id AND cl.organization_id = v_org
      AND cl.status NOT IN ('DNC', 'Completed', 'Removed', 'Failed');
  ELSE
    SELECT a.start_time INTO v_current
    FROM public.appointments a
    WHERE a.id = p_source_id AND a.organization_id = v_org
      AND a.type IN ('Follow Up', 'Call Back') AND a.status = 'Scheduled';
  END IF;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'This item is no longer pending' USING ERRCODE = 'PT404';
  END IF;
  -- Never clear an occurrence the caller has not seen (e.g. a callback rescheduled since the page loaded).
  IF v_current <> p_expected_occurrence_at THEN
    RAISE EXCEPTION 'This item changed since it was shown' USING ERRCODE = 'PT409';
  END IF;

  -- Retention: the caller's own clearances far outside every Dashboard window can never match again.
  DELETE FROM public.dashboard_attention_clearances r
  WHERE r.user_id = v_uid AND r.organization_id = v_org
    AND r.occurrence_at < clock_timestamp() - interval '90 days';

  INSERT INTO public.dashboard_attention_clearances AS r
    (organization_id, user_id, source_type, source_id, occurrence_at)
  VALUES (v_org, v_uid, p_source_type, p_source_id, v_current)
  ON CONFLICT ON CONSTRAINT dashboard_attention_clearances_occurrence_key DO NOTHING
  RETURNING r.* INTO v_row;

  -- Already cleared (another tab, a double click): the existing row, unchanged.
  IF v_row.id IS NULL THEN
    SELECT r.* INTO v_row
    FROM public.dashboard_attention_clearances r
    WHERE r.organization_id = v_org AND r.user_id = v_uid AND r.source_type = p_source_type
      AND r.source_id = p_source_id AND r.occurrence_at = v_current;
  END IF;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'The item was not cleared' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row;
END $$;

-- ---- Undo ----------------------------------------------------------------------------------------------
CREATE FUNCTION public.undo_dashboard_attention_clear(p_id uuid, p_expected_cleared_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to update Dashboard items' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_expected_cleared_at IS NULL THEN
    RAISE EXCEPTION 'Undo needs the clearance and the time it was made' USING ERRCODE = '22023';
  END IF;
  -- Only the caller's own row, and only the exact clearance being undone.
  DELETE FROM public.dashboard_attention_clearances r
  WHERE r.id = p_id
    AND r.user_id = auth.uid()
    AND r.organization_id = public.get_org_id()
    AND r.cleared_at = p_expected_cleared_at;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END $$;

REVOKE ALL ON FUNCTION public.clear_dashboard_attention_item(text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.undo_dashboard_attention_clear(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_dashboard_attention_item(text, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_dashboard_attention_clear(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.clear_dashboard_attention_item(text, uuid, timestamptz) IS
  'Clear one Missed Call or Callback occurrence from the caller''s own Dashboard. SECURITY INVOKER: identity from '
  'auth.uid()/get_org_id(), Active same-org profile required, source must be visible and pending under its own RLS, '
  'and its current occurrence must equal the expected one (PT404 not pending, PT409 changed). Never writes a source row.';
COMMENT ON FUNCTION public.undo_dashboard_attention_clear(uuid, timestamptz) IS
  'Undo: deletes the caller''s own clearance only when its cleared_at still equals the expected value.';
