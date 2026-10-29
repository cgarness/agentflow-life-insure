-- =====================================================================================================
-- Dashboard Client Milestones — per-user review state (Gate G2)
-- Plan: docs/plans/2026-10-29-dashboard-premium-redesign/implementation_plan.md §9 (rev 1)
--
-- STATUS: PREPARED, NOT APPLIED. Schema + RLS change: requires Chris's separate, explicit G2 approval.
-- Lives in supabase/migrations/pending/ so no branch merge or preview can apply it. After an approved
-- apply, move it to supabase/migrations/<recorded version>_dashboard_milestone_reviews.sql without
-- changing a byte, and reconcile the rollback, runner and CI paths with that version.
--
-- WHAT IT ADDS (nothing else is created, altered or read):
--   * public.dashboard_milestone_reviews — one row per user + organization + milestone event +
--     occurrence year: "reviewed", or "snoozed until remind_at". It is ALERT STATE ONLY. It never
--     changes a client, policy, payment, task, notification or any other CRM record.
--   * public.set_dashboard_milestone_review(...)   — Mark Reviewed / Remind Later (SECURITY INVOKER)
--   * public.clear_dashboard_milestone_review(...) — Undo / Restore            (SECURITY INVOKER)
--   * private.dashboard_milestone_reviews_guard()   — row invariants on EVERY write path
--
-- SECURITY MODEL
--   * RLS is the authority. Both RPCs are SECURITY INVOKER: they only derive identity
--     (auth.uid(), get_org_id()) and validate input; the caller's own table and clients RLS apply.
--   * A row is visible and writable only by its own user, inside their JWT organization.
--   * A row can only be written for a client the caller can SEE under the existing clients RLS
--     (EXISTS subquery evaluated as the caller). No clients/profiles policy is changed.
--   * The RPC also requires the caller's own profile to be Active and in the same organization as the
--     JWT claim (database/JWT agreement, as the hierarchy invariant requires for authority).
--   * anon and PUBLIC get nothing; authenticated gets SELECT/INSERT/UPDATE/DELETE on the table (no
--     TRUNCATE/REFERENCES/TRIGGER) and EXECUTE on the two RPCs; service_role gets SELECT only.
--
-- IDENTITY
--   milestone_kind  event_key                                    occurrence_year     uniqueness
--   client_birthday 'birthday'                                    year of birthday    per year
--   policy_anniversary policy uuid (primary_policy_id / policyId)  year of anniversary per year
--                      or 'primary' for a legacy primary policy
--   first_payment   'first_payment'                               year of Draft Date  ONE per client (any year)
-- =====================================================================================================

SET lock_timeout = '2s';
SET statement_timeout = '60s';

-- ---- Preimage / replay guard -------------------------------------------------------------------------
DO $guard$
BEGIN
  IF to_regclass('public.dashboard_milestone_reviews') IS NOT NULL
     OR to_regprocedure('public.set_dashboard_milestone_review(text,uuid,text,date,text,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('public.clear_dashboard_milestone_review(uuid,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('private.dashboard_milestone_reviews_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'dashboard_milestone_reviews objects already exist; this migration must not be replayed'
      USING ERRCODE = '42P07';
  END IF;
  -- Dependencies this migration relies on, exactly as production has them.
  IF to_regclass('public.clients') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.organizations') IS NULL OR to_regclass('auth.users') IS NULL
     OR to_regprocedure('public.get_org_id()') IS NULL OR to_regprocedure('auth.uid()') IS NULL
     OR to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'dashboard_milestone_reviews: a required dependency is missing' USING ERRCODE = '42704';
  END IF;
END
$guard$;

-- ---- Table ---------------------------------------------------------------------------------------------
CREATE TABLE public.dashboard_milestone_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  milestone_kind  text NOT NULL,
  event_key       text NOT NULL,
  occurrence_year integer NOT NULL,
  occurrence_date date NOT NULL,
  state           text NOT NULL,
  remind_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_milestone_reviews_kind_check
    CHECK (milestone_kind IN ('client_birthday', 'policy_anniversary', 'first_payment')),
  CONSTRAINT dashboard_milestone_reviews_state_check CHECK (state IN ('reviewed', 'snoozed')),
  CONSTRAINT dashboard_milestone_reviews_remind_check CHECK ((state = 'snoozed') = (remind_at IS NOT NULL)),
  CONSTRAINT dashboard_milestone_reviews_event_key_check CHECK (
    CASE milestone_kind
      WHEN 'client_birthday' THEN event_key = 'birthday'
      WHEN 'first_payment' THEN event_key = 'first_payment'
      ELSE event_key = 'primary'
        OR event_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    END),
  CONSTRAINT dashboard_milestone_reviews_year_check CHECK (
    occurrence_year BETWEEN 2000 AND 2200
    AND occurrence_year = extract(year FROM occurrence_date)::integer)
);

COMMENT ON TABLE public.dashboard_milestone_reviews IS
  'Per-user Client Milestone review state (reviewed / snoozed) by organization, event and occurrence year. '
  'Alert state only: never a CRM record, never evidence that a payment happened or did not. '
  'Written through set_/clear_dashboard_milestone_review (SECURITY INVOKER); own rows only (RLS).';

-- Annual events (birthday, anniversary): one row per user, organization, event and occurrence year.
CREATE UNIQUE INDEX dashboard_milestone_reviews_annual_key
  ON public.dashboard_milestone_reviews (organization_id, user_id, milestone_kind, client_id, event_key, occurrence_year)
  WHERE milestone_kind <> 'first_payment';
-- First payment is one-time: one row per user, organization and client, whatever the year.
CREATE UNIQUE INDEX dashboard_milestone_reviews_first_payment_key
  ON public.dashboard_milestone_reviews (organization_id, user_id, client_id)
  WHERE milestone_kind = 'first_payment';
-- The Dashboard's keyset read: own rows ordered by id.
CREATE INDEX dashboard_milestone_reviews_reader_idx
  ON public.dashboard_milestone_reviews (user_id, organization_id, id);
-- Supports the client ON DELETE CASCADE.
CREATE INDEX dashboard_milestone_reviews_client_idx ON public.dashboard_milestone_reviews (client_id);

-- ---- Row invariants on every write path ------------------------------------------------------------
CREATE FUNCTION private.dashboard_milestone_reviews_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.milestone_kind IS DISTINCT FROM OLD.milestone_kind
       OR NEW.event_key IS DISTINCT FROM OLD.event_key) THEN
    RAISE EXCEPTION 'A milestone review cannot be moved to another user, client or event' USING ERRCODE = '22023';
  END IF;
  IF NEW.state = 'snoozed'
     AND (NEW.remind_at <= clock_timestamp() OR NEW.remind_at > clock_timestamp() + interval '31 days') THEN
    RAISE EXCEPTION 'A reminder must be in the future and at most 31 days ahead' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' THEN NEW.created_at := clock_timestamp(); ELSE NEW.created_at := OLD.created_at; END IF;
  -- Undo matches on this exact value, so every write gets a distinct one.
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.dashboard_milestone_reviews_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER dashboard_milestone_reviews_guard
  BEFORE INSERT OR UPDATE ON public.dashboard_milestone_reviews
  FOR EACH ROW EXECUTE FUNCTION private.dashboard_milestone_reviews_guard();

-- ---- RLS: own rows, own organization, visible clients ------------------------------------------------
ALTER TABLE public.dashboard_milestone_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_milestone_reviews_select ON public.dashboard_milestone_reviews
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = (SELECT public.get_org_id()));

CREATE POLICY dashboard_milestone_reviews_insert ON public.dashboard_milestone_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND organization_id = (SELECT public.get_org_id())
    AND EXISTS (SELECT 1 FROM public.clients c
                WHERE c.id = dashboard_milestone_reviews.client_id
                  AND c.organization_id = dashboard_milestone_reviews.organization_id));

CREATE POLICY dashboard_milestone_reviews_update ON public.dashboard_milestone_reviews
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = (SELECT public.get_org_id()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND organization_id = (SELECT public.get_org_id())
    AND EXISTS (SELECT 1 FROM public.clients c
                WHERE c.id = dashboard_milestone_reviews.client_id
                  AND c.organization_id = dashboard_milestone_reviews.organization_id));

CREATE POLICY dashboard_milestone_reviews_delete ON public.dashboard_milestone_reviews
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = (SELECT public.get_org_id()));

-- Supabase default privileges grant ALL on new public tables to anon/authenticated/service_role:
-- reset them to exactly what is needed.
REVOKE ALL ON TABLE public.dashboard_milestone_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dashboard_milestone_reviews TO authenticated;
GRANT SELECT ON TABLE public.dashboard_milestone_reviews TO service_role;

-- ---- Mark Reviewed / Remind Later --------------------------------------------------------------------
CREATE FUNCTION public.set_dashboard_milestone_review(
  p_kind text,
  p_client_id uuid,
  p_event_key text,
  p_occurrence_date date,
  p_state text,
  p_remind_at timestamptz DEFAULT NULL
) RETURNS public.dashboard_milestone_reviews
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_profile_org uuid;
  v_profile_status text;
  v_row public.dashboard_milestone_reviews;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Sign in to update reminders' USING ERRCODE = '42501';
  END IF;
  SELECT p.organization_id, p.status INTO v_profile_org, v_profile_status
  FROM public.profiles p WHERE p.id = v_uid;
  IF v_profile_org IS DISTINCT FROM v_org OR v_profile_status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'Your profile is not active in this agency' USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('client_birthday', 'policy_anniversary', 'first_payment') THEN
    RAISE EXCEPTION 'Unknown milestone type' USING ERRCODE = '22023';
  END IF;
  IF p_client_id IS NULL OR p_occurrence_date IS NULL OR p_event_key IS NULL
     OR char_length(p_event_key) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'A milestone needs a client, an event and a date' USING ERRCODE = '22023';
  END IF;
  IF (p_kind = 'client_birthday' AND p_event_key <> 'birthday')
     OR (p_kind = 'first_payment' AND p_event_key <> 'first_payment')
     OR (p_kind = 'policy_anniversary' AND p_event_key <> 'primary'
         AND p_event_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'This milestone has no valid identity' USING ERRCODE = '22023';
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('reviewed', 'snoozed') THEN
    RAISE EXCEPTION 'Unknown review state' USING ERRCODE = '22023';
  END IF;
  IF (p_state = 'snoozed') <> (p_remind_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A reminder time is required only for Remind Later' USING ERRCODE = '22023';
  END IF;
  IF p_state = 'snoozed'
     AND (p_remind_at <= clock_timestamp() OR p_remind_at > clock_timestamp() + interval '31 days') THEN
    RAISE EXCEPTION 'A reminder must be in the future and at most 31 days ahead' USING ERRCODE = '22023';
  END IF;
  -- Visible to the caller under the existing clients RLS, in the caller's organization.
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id AND c.organization_id = v_org) THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'PT404';
  END IF;

  IF p_kind = 'first_payment' THEN
    INSERT INTO public.dashboard_milestone_reviews AS r
      (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state, remind_at)
    VALUES (v_org, v_uid, p_client_id, p_kind, p_event_key,
            extract(year FROM p_occurrence_date)::integer, p_occurrence_date, p_state, p_remind_at)
    ON CONFLICT (organization_id, user_id, client_id) WHERE milestone_kind = 'first_payment'
    DO UPDATE SET occurrence_year = EXCLUDED.occurrence_year, occurrence_date = EXCLUDED.occurrence_date,
                  state = EXCLUDED.state, remind_at = EXCLUDED.remind_at
    RETURNING r.* INTO v_row;
  ELSE
    INSERT INTO public.dashboard_milestone_reviews AS r
      (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state, remind_at)
    VALUES (v_org, v_uid, p_client_id, p_kind, p_event_key,
            extract(year FROM p_occurrence_date)::integer, p_occurrence_date, p_state, p_remind_at)
    ON CONFLICT (organization_id, user_id, milestone_kind, client_id, event_key, occurrence_year)
      WHERE milestone_kind <> 'first_payment'
    DO UPDATE SET occurrence_date = EXCLUDED.occurrence_date, state = EXCLUDED.state, remind_at = EXCLUDED.remind_at
    RETURNING r.* INTO v_row;
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'The reminder was not stored' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row;
END $$;

-- ---- Undo / Restore ----------------------------------------------------------------------------------
CREATE FUNCTION public.clear_dashboard_milestone_review(p_id uuid, p_expected_updated_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to update reminders' USING ERRCODE = '42501';
  END IF;
  -- Only the caller's own row, and only if nothing changed it since the action being undone.
  DELETE FROM public.dashboard_milestone_reviews r
  WHERE r.id = p_id
    AND r.user_id = auth.uid()
    AND r.organization_id = public.get_org_id()
    AND r.updated_at = p_expected_updated_at;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END $$;

REVOKE ALL ON FUNCTION public.set_dashboard_milestone_review(text, uuid, text, date, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_dashboard_milestone_review(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_dashboard_milestone_review(text, uuid, text, date, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_dashboard_milestone_review(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.set_dashboard_milestone_review(text, uuid, text, date, text, timestamptz) IS
  'Mark Reviewed / Remind Later for one Client Milestone occurrence of the caller. SECURITY INVOKER: '
  'identity from auth.uid()/get_org_id(), Active same-org profile required, client must be visible under clients RLS.';
COMMENT ON FUNCTION public.clear_dashboard_milestone_review(uuid, timestamptz) IS
  'Undo: deletes the caller''s own review row only when its updated_at still equals the expected value.';
