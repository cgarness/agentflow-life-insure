-- =====================================================================================================
-- Onboarding email series — inactive foundation (plan: docs/plans/2026-10-10-onboarding-emails/).
-- STATUS: PREPARED — NOT APPLIED. Kept under supabase/migrations/pending/ (outside the CLI's
-- non-recursive migrations/*.sql glob) so no preview branch or git-driven deploy can apply it.
-- Apply ONLY with Chris's explicit approval (activation checklist §11 step 3), via MCP apply_migration
-- with these exact bytes, then git mv the file to the recorded version (invariant #25).
--
-- What this creates, and what it deliberately does NOT:
--   * Tables: onboarding_email_program (singleton flag, enabled = false, watermark NULL),
--     onboarding_email_steps (9 seeded steps), onboarding_email_enrollments, onboarding_email_deliveries,
--     onboarding_email_delivery_attempts, user_email_subscriptions (opt-out store).
--   * Worker RPCs (service_role only): enroll_due, claim, context, complete, record_opt_out. Enrollment
--     and claiming return nothing while the program flag is false or the watermark is NULL.
--   * User RPCs (authenticated): get_my_email_subscriptions, set_my_onboarding_email_opt_out.
--   * NO trigger on any existing table, NO cron job, NO pg_net call, NO backfill, NO secret.
--     The schedule lives in supabase/ops/onboarding_emails_schedule.sql and is not run.
--   * Historical users can never enroll: only users whose welcome email was sent at or after the
--     activation watermark (NULL today) are eligible.
-- The database enqueues and decides; the Edge worker sends (invariant #21: no DB-triggered delivery).
-- Rollback: supabase/migrations/rollback/20261011120000_onboarding_email_foundation.rollback.sql
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.onboarding_email_program') IS NOT NULL THEN
    RAISE EXCEPTION 'onboarding_email_program already exists; refusing replay';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.organizations') IS NULL
     OR to_regclass('public.company_settings') IS NULL OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'public.profiles, public.organizations, public.company_settings and auth.users are required';
  END IF;
  IF to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'schema private is required';
  END IF;
  IF to_regprocedure('public.get_org_id()') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'public.get_org_id() and auth.uid() are required';
  END IF;
END $guard$;

-- ── Program flag (singleton) ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.onboarding_email_program (
  id                     smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                boolean     NOT NULL DEFAULT false,
  enrollment_starts_at   timestamptz,
  pilot_organization_ids uuid[],
  send_hour_local        smallint    NOT NULL DEFAULT 10 CHECK (send_hour_local BETWEEN 0 AND 23),
  step_expiry            interval    NOT NULL DEFAULT interval '72 hours'
                                     CHECK (step_expiry >= interval '1 hour' AND step_expiry <= interval '7 days'),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,
  CONSTRAINT onboarding_email_program_enabled_requires_watermark
    CHECK (NOT enabled OR enrollment_starts_at IS NOT NULL),
  CONSTRAINT onboarding_email_program_pilot_not_empty
    CHECK (pilot_organization_ids IS NULL OR cardinality(pilot_organization_ids) > 0)
);
COMMENT ON TABLE public.onboarding_email_program IS
  'Onboarding email series switch. enabled=false (default) means zero enrollment and zero claims. '
  'Platform-global, server-only. Changed only by the approval-gated ops scripts.';
INSERT INTO public.onboarding_email_program (id) VALUES (1);

-- ── Step catalog (timing only; copy lives in _shared/onboardingEmail/templates.ts) ──────────────
CREATE TABLE public.onboarding_email_steps (
  step_key         text     PRIMARY KEY CHECK (step_key ~ '^[a-z0-9_]{1,64}$'),
  sequence_key     text     NOT NULL CHECK (sequence_key IN ('agent', 'agency_admin')),
  day_offset       integer  NOT NULL CHECK (day_offset BETWEEN 1 AND 60),
  position         integer  NOT NULL CHECK (position >= 1),
  template_version integer  NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  is_active        boolean  NOT NULL DEFAULT true,
  CONSTRAINT onboarding_email_steps_sequence_position_key UNIQUE (sequence_key, position)
);
COMMENT ON TABLE public.onboarding_email_steps IS
  'Onboarding email timing catalog. Held equal to _shared/onboardingEmail/catalog.ts by a parity test.';
INSERT INTO public.onboarding_email_steps (step_key, sequence_key, day_offset, position) VALUES
  ('agent_day01_dialer_ready',     'agent',         1, 1),
  ('agent_day03_work_leads',       'agent',         3, 2),
  ('agent_day05_campaigns',        'agent',         5, 3),
  ('agent_day08_numbers',          'agent',         8, 4),
  ('agent_day14_routine',          'agent',        14, 5),
  ('admin_day02_agency_setup',     'agency_admin',  2, 1),
  ('admin_day04_agents_dialing',   'agency_admin',  4, 2),
  ('admin_day07_team_performance', 'agency_admin',  7, 3),
  ('admin_day12_high_performing',  'agency_admin', 12, 4);

-- ── Enrollments (one per user, ever) ────────────────────────────────────────────────────────────
CREATE TABLE public.onboarding_email_enrollments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_key       text        NOT NULL CHECK (sequence_key IN ('agent', 'agency_admin')),
  role_at_enrollment text        NOT NULL,
  anchor_at          timestamptz NOT NULL,
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  cancel_reason      text        CHECK (cancel_reason IS NULL OR cancel_reason IN
                                   ('user_deleted', 'opted_out', 'role_ineligible', 'role_changed', 'organization_changed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_email_enrollments_user_key UNIQUE (user_id),
  CONSTRAINT onboarding_email_enrollments_cancel_check CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);
CREATE INDEX onboarding_email_enrollments_org_idx ON public.onboarding_email_enrollments (organization_id);

-- ── Deliveries (one per enrollment step) ────────────────────────────────────────────────────────
CREATE TABLE public.onboarding_email_deliveries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id       uuid        NOT NULL REFERENCES public.onboarding_email_enrollments(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_key            text        NOT NULL REFERENCES public.onboarding_email_steps(step_key),
  template_version    integer     NOT NULL CHECK (template_version >= 1),
  scheduled_at        timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  status              text        NOT NULL DEFAULT 'scheduled'
                                  CHECK (status IN ('scheduled', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at        timestamptz NOT NULL,
  locked_until        timestamptz,
  first_attempted_at  timestamptz,
  last_attempt_at     timestamptz,
  sent_at             timestamptz,
  provider_message_id text        CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  skip_reason         text        CHECK (skip_reason IS NULL OR skip_reason IN
                                    ('stale', 'user_deleted', 'user_inactive', 'opted_out', 'role_ineligible',
                                     'role_changed', 'organization_changed', 'organization_inactive',
                                     'email_unconfirmed', 'enrollment_closed')),
  last_error          text        CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_email_deliveries_enrollment_step_key UNIQUE (enrollment_id, step_key),
  CONSTRAINT onboarding_email_deliveries_user_step_key UNIQUE (user_id, step_key),
  CONSTRAINT onboarding_email_deliveries_first_attempt_check CHECK ((attempts = 0) = (first_attempted_at IS NULL)),
  CONSTRAINT onboarding_email_deliveries_window_check CHECK (expires_at > scheduled_at)
);
CREATE INDEX onboarding_email_deliveries_due_idx
  ON public.onboarding_email_deliveries (available_at, id) WHERE status IN ('scheduled', 'sending');
CREATE INDEX onboarding_email_deliveries_org_idx ON public.onboarding_email_deliveries (organization_id, created_at);

-- ── Attempt log (append-only) ───────────────────────────────────────────────────────────────────
CREATE TABLE public.onboarding_email_delivery_attempts (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id         uuid        NOT NULL REFERENCES public.onboarding_email_deliveries(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  attempt_number      integer     NOT NULL CHECK (attempt_number >= 0),
  outcome             text        NOT NULL CHECK (outcome IN ('sent', 'skipped', 'retry', 'failed', 'cancelled')),
  resulting_status    text        NOT NULL,
  provider_message_id text        CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  error               text        CHECK (error IS NULL OR char_length(error) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_email_delivery_attempts_delivery_idx ON public.onboarding_email_delivery_attempts (delivery_id);

-- ── Opt-out store (tenant-scoped; users read only their own row) ────────────────────────────────
CREATE TABLE public.user_email_subscriptions (
  user_id                   uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id           uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  onboarding_opted_out_at   timestamptz,
  onboarding_opt_out_source text        CHECK (onboarding_opt_out_source IS NULL OR
                                               onboarding_opt_out_source IN ('unsubscribe_link', 'settings')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_subscriptions_opt_out_source_check
    CHECK ((onboarding_opted_out_at IS NULL) = (onboarding_opt_out_source IS NULL))
);
CREATE INDEX user_email_subscriptions_org_idx ON public.user_email_subscriptions (organization_id);
COMMENT ON TABLE public.user_email_subscriptions IS
  'Per-user educational email preferences. Opting out stops onboarding tips only, never transactional or '
  'security email. Users read their own row; writes go through set_my_onboarding_email_opt_out or the '
  'service-role record_onboarding_email_opt_out RPC.';

-- ── Privileges and RLS ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.onboarding_email_program           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_email_steps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_email_enrollments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_email_deliveries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_email_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_email_subscriptions           ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.onboarding_email_program, public.onboarding_email_steps,
  public.onboarding_email_enrollments, public.onboarding_email_deliveries,
  public.onboarding_email_delivery_attempts, public.user_email_subscriptions
  FROM PUBLIC, anon, authenticated, service_role;

-- service_role reads only; every write goes through the SECURITY DEFINER RPCs below.
GRANT SELECT ON TABLE public.onboarding_email_program, public.onboarding_email_steps,
  public.onboarding_email_enrollments, public.onboarding_email_deliveries,
  public.onboarding_email_delivery_attempts, public.user_email_subscriptions
  TO service_role;

-- Correction A: an authenticated user may SELECT only their own row, in their own organization.
-- No INSERT/UPDATE/DELETE privilege or policy exists for anon or authenticated.
GRANT SELECT ON TABLE public.user_email_subscriptions TO authenticated;
CREATE POLICY user_email_subscriptions_select_own
  ON public.user_email_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = (SELECT public.get_org_id()));

-- ── Private helpers ─────────────────────────────────────────────────────────────────────────────
-- Returns the zone when PostgreSQL recognizes it as a real zone name, else NULL. Cheap (no
-- pg_timezone_names scan); pseudo-zones are refused, matching the Reports rule.
CREATE FUNCTION private.onboarding_email_valid_time_zone(p_time_zone text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_zone text := nullif(btrim(coalesce(p_time_zone, '')), '');
BEGIN
  IF v_zone IS NULL OR v_zone IN ('Factory', 'localtime', 'posixrules') OR (v_zone !~ '/' AND v_zone <> 'UTC') THEN
    RETURN NULL;
  END IF;
  PERFORM now() AT TIME ZONE v_zone;
  RETURN v_zone;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Day N at p_hour:00 on the agency's local calendar, counted from the local date of the anchor.
-- Without a valid zone it falls back to anchor + N days. DST-correct (local wall clock).
CREATE FUNCTION private.onboarding_email_slot(p_anchor timestamptz, p_day_offset integer, p_time_zone text, p_hour integer)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
           WHEN p_time_zone IS NULL THEN p_anchor + make_interval(days => p_day_offset)
           ELSE ((((p_anchor AT TIME ZONE p_time_zone)::date + p_day_offset)
                  + make_interval(hours => p_hour)) AT TIME ZONE p_time_zone)
         END;
$$;

-- Marks enrollments completed once none of their deliveries is outstanding.
CREATE FUNCTION private.onboarding_email_settle(p_enrollment_ids uuid[])
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.onboarding_email_enrollments e
     SET status = 'completed', updated_at = now()
   WHERE e.id = ANY (coalesce(p_enrollment_ids, '{}'::uuid[]))
     AND e.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_email_deliveries d
                      WHERE d.enrollment_id = e.id AND d.status IN ('scheduled', 'sending'));
$$;

-- Cancels every scheduled step of a user (opt-out). A row already 'sending' is re-checked by the worker.
CREATE FUNCTION private.onboarding_email_cancel_user(p_user_id uuid, p_reason text)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.onboarding_email_deliveries
     SET status = 'cancelled', skip_reason = p_reason, locked_until = NULL, updated_at = now()
   WHERE user_id = p_user_id AND status = 'scheduled';
  UPDATE public.onboarding_email_enrollments
     SET status = 'cancelled', cancel_reason = p_reason, updated_at = now()
   WHERE user_id = p_user_id AND status = 'active';
$$;

REVOKE ALL ON FUNCTION private.onboarding_email_valid_time_zone(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.onboarding_email_slot(timestamptz, integer, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.onboarding_email_settle(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.onboarding_email_cancel_user(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── Worker RPCs (service_role only) ─────────────────────────────────────────────────────────────
-- Enrolls eligible NEW users. Returns 0 immediately unless the program is enabled AND the watermark
-- is set. Only users whose welcome email (Day 0) was sent at or after the watermark, and whose
-- profile was created at or after it, are eligible: historical accounts are never backfilled.
CREATE FUNCTION public.onboarding_email_enroll_due(p_limit integer DEFAULT 25)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_program    public.onboarding_email_program%ROWTYPE;
  v_candidate  record;
  v_zone       text;
  v_enrollment uuid;
  v_count      integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_program FROM public.onboarding_email_program WHERE id = 1;
  IF NOT FOUND OR v_program.enabled IS NOT TRUE OR v_program.enrollment_starts_at IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_candidate IN
    SELECT p.id                     AS candidate_id,
           p.organization_id        AS candidate_org,
           p.role                   AS candidate_role,
           p.welcome_email_sent_at  AS candidate_anchor,
           CASE WHEN p.role = 'Admin' THEN 'agency_admin' ELSE 'agent' END AS candidate_sequence,
           cs.timezone              AS candidate_zone
      FROM public.profiles p
      JOIN auth.users u          ON u.id = p.id
      JOIN public.organizations o ON o.id = p.organization_id
      LEFT JOIN public.company_settings cs ON cs.organization_id = p.organization_id
     WHERE p.status = 'Active'
       AND coalesce(p.is_super_admin, false) = false
       AND p.role IN ('Agent', 'Team Leader', 'Admin')
       AND p.welcome_email_sent_at IS NOT NULL
       AND p.welcome_email_sent_at >= v_program.enrollment_starts_at
       AND p.created_at >= v_program.enrollment_starts_at
       AND u.email_confirmed_at IS NOT NULL
       AND u.deleted_at IS NULL
       AND (u.banned_until IS NULL OR u.banned_until <= now())
       AND coalesce(o.status, 'active') = 'active'
       AND (v_program.pilot_organization_ids IS NULL OR p.organization_id = ANY (v_program.pilot_organization_ids))
       AND NOT EXISTS (SELECT 1 FROM public.onboarding_email_enrollments e WHERE e.user_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM public.user_email_subscriptions s
                        WHERE s.user_id = p.id AND s.onboarding_opted_out_at IS NOT NULL)
     ORDER BY p.welcome_email_sent_at, p.id
     LIMIT p_limit
  LOOP
    v_enrollment := NULL;
    INSERT INTO public.onboarding_email_enrollments
      (user_id, organization_id, sequence_key, role_at_enrollment, anchor_at)
    VALUES
      (v_candidate.candidate_id, v_candidate.candidate_org, v_candidate.candidate_sequence,
       v_candidate.candidate_role, v_candidate.candidate_anchor)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id INTO v_enrollment;

    IF v_enrollment IS NULL THEN
      CONTINUE; -- a concurrent run enrolled this user first
    END IF;

    v_zone := private.onboarding_email_valid_time_zone(v_candidate.candidate_zone);
    INSERT INTO public.onboarding_email_deliveries
      (enrollment_id, user_id, organization_id, step_key, template_version, scheduled_at, expires_at, available_at)
    SELECT v_enrollment, v_candidate.candidate_id, v_candidate.candidate_org, s.step_key, s.template_version,
           x.slot, x.slot + v_program.step_expiry, x.slot
      FROM public.onboarding_email_steps s
      CROSS JOIN LATERAL (
        SELECT private.onboarding_email_slot(v_candidate.candidate_anchor, s.day_offset, v_zone,
                                             v_program.send_hour_local) AS slot
      ) x
     WHERE s.sequence_key = v_candidate.candidate_sequence
       AND s.is_active;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Claims due deliveries for one worker run. Returns nothing while the program is disabled.
-- Before claiming it closes rows that can no longer be sent: never-attempted rows past expiry become
-- skipped/stale; attempted rows past their window (min(expires_at, first attempt + 23 h, Resend's
-- idempotency window)) or out of attempts become failed. Every sweep uses SKIP LOCKED.
CREATE FUNCTION public.claim_onboarding_email_deliveries(p_limit integer DEFAULT 5)
RETURNS SETOF public.onboarding_email_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
  v_stale   uuid[];
  v_closed  uuid[];
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 25 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 25' USING ERRCODE = '22023';
  END IF;

  SELECT pr.enabled INTO v_enabled FROM public.onboarding_email_program pr WHERE pr.id = 1;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  WITH stale AS (
    UPDATE public.onboarding_email_deliveries d
       SET status = 'skipped', skip_reason = 'stale', locked_until = NULL, updated_at = now()
     WHERE d.id IN (SELECT c.id FROM public.onboarding_email_deliveries c
                     WHERE c.status = 'scheduled' AND c.attempts = 0 AND c.expires_at <= now()
                     ORDER BY c.id
                     FOR UPDATE SKIP LOCKED)
    RETURNING d.id, d.organization_id, d.enrollment_id
  ), logged AS (
    INSERT INTO public.onboarding_email_delivery_attempts
      (delivery_id, organization_id, attempt_number, outcome, resulting_status, error)
    SELECT st.id, st.organization_id, 0, 'skipped', 'skipped', 'stale' FROM stale st
  )
  SELECT array_agg(DISTINCT st.enrollment_id) INTO v_stale FROM stale st;

  WITH closed AS (
    UPDATE public.onboarding_email_deliveries d
       SET status = 'failed', locked_until = NULL, updated_at = now(),
           last_error = left(coalesce(d.last_error || ' | ', '') || 'Delivery window closed; review required.', 500)
     WHERE d.id IN (SELECT c.id FROM public.onboarding_email_deliveries c
                     WHERE c.attempts > 0
                       AND (c.status = 'scheduled' OR (c.status = 'sending' AND c.locked_until < now()))
                       AND (now() >= least(c.expires_at, c.first_attempted_at + interval '23 hours')
                            OR (c.status = 'sending' AND c.attempts >= 6))
                     ORDER BY c.id
                     FOR UPDATE SKIP LOCKED)
    RETURNING d.id, d.organization_id, d.enrollment_id, d.attempts
  ), logged AS (
    INSERT INTO public.onboarding_email_delivery_attempts
      (delivery_id, organization_id, attempt_number, outcome, resulting_status, error)
    SELECT cl.id, cl.organization_id, cl.attempts, 'failed', 'failed', 'Delivery window closed; review required.'
      FROM closed cl
  )
  SELECT array_agg(DISTINCT cl.enrollment_id) INTO v_closed FROM closed cl;

  PERFORM private.onboarding_email_settle(coalesce(v_stale, '{}'::uuid[]) || coalesce(v_closed, '{}'::uuid[]));

  RETURN QUERY
  UPDATE public.onboarding_email_deliveries d
     SET status = 'sending',
         attempts = d.attempts + 1,
         locked_until = now() + interval '5 minutes',
         last_attempt_at = now(),
         first_attempted_at = coalesce(d.first_attempted_at, now()),
         updated_at = now()
   WHERE d.id IN (SELECT c.id FROM public.onboarding_email_deliveries c
                   WHERE c.available_at <= now()
                     AND c.expires_at > now()
                     AND (c.status = 'scheduled' OR (c.status = 'sending' AND c.locked_until < now()))
                   ORDER BY c.available_at, c.id
                   LIMIT p_limit
                   FOR UPDATE SKIP LOCKED)
  RETURNING d.*;
END;
$$;

-- Current facts for one delivery, read at send time. Zero rows when the delivery no longer exists
-- (the user's profile was deleted and cascaded). The worker's pure eligibility function decides.
CREATE FUNCTION public.get_onboarding_email_context(p_delivery_id uuid)
RETURNS TABLE (
  delivery_id                uuid,
  delivery_status            text,
  step_key                   text,
  template_version           integer,
  sequence_key               text,
  expires_at                 timestamptz,
  enrollment_status          text,
  enrollment_organization_id uuid,
  profile_exists             boolean,
  profile_status             text,
  profile_role               text,
  profile_is_super_admin     boolean,
  profile_organization_id    uuid,
  first_name                 text,
  auth_exists                boolean,
  email                      text,
  email_confirmed            boolean,
  auth_deleted               boolean,
  auth_banned                boolean,
  organization_status        text,
  opted_out                  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT d.id, d.status, d.step_key, d.template_version, e.sequence_key, d.expires_at,
         e.status, e.organization_id,
         p.id IS NOT NULL, p.status, p.role, coalesce(p.is_super_admin, false), p.organization_id, p.first_name,
         u.id IS NOT NULL, u.email::text, u.email_confirmed_at IS NOT NULL, u.deleted_at IS NOT NULL,
         (u.banned_until IS NOT NULL AND u.banned_until > now()),
         o.status,
         coalesce(s.onboarding_opted_out_at IS NOT NULL, false)
    FROM public.onboarding_email_deliveries d
    JOIN public.onboarding_email_enrollments e ON e.id = d.enrollment_id
    LEFT JOIN public.profiles p                ON p.id = d.user_id
    LEFT JOIN auth.users u                     ON u.id = d.user_id
    LEFT JOIN public.organizations o           ON o.id = p.organization_id
    LEFT JOIN public.user_email_subscriptions s ON s.user_id = d.user_id
   WHERE d.id = p_delivery_id;
$$;

-- Records one attempt's outcome; applies only to a row still 'sending'. Returns the resulting status,
-- or NULL when nothing was applied (a stale worker whose lease was reclaimed).
--   sent      -> sent
--   skipped   -> skipped (this step only; requires p_skip_reason)
--   cancelled -> cancelled, AND every other scheduled step of the enrollment is cancelled
--   retry     -> scheduled again with backoff 1/2/5/15/30 min; failed after 6 attempts or once past
--                min(expires_at, first attempt + 23 h)
--   failed    -> failed now (non-retryable provider error)
CREATE FUNCTION public.complete_onboarding_email_delivery(
  p_id                  uuid,
  p_outcome             text,
  p_provider_message_id text DEFAULT NULL,
  p_error               text DEFAULT NULL,
  p_skip_reason         text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row      public.onboarding_email_deliveries%ROWTYPE;
  v_error    text := nullif(left(btrim(regexp_replace(coalesce(p_error, ''), '[[:cntrl:]]+', ' ', 'g')), 500), '');
  v_provider text := left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200);
  v_next     text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'skipped', 'retry', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'p_outcome must be sent, skipped, retry, failed or cancelled' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'skipped' AND (p_skip_reason IS NULL OR p_skip_reason NOT IN
       ('stale', 'user_inactive', 'organization_inactive', 'email_unconfirmed', 'enrollment_closed')) THEN
    RAISE EXCEPTION 'skipped requires a step-level skip reason' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'cancelled' AND (p_skip_reason IS NULL OR p_skip_reason NOT IN
       ('user_deleted', 'opted_out', 'role_ineligible', 'role_changed', 'organization_changed')) THEN
    RAISE EXCEPTION 'cancelled requires an enrollment-level cancel reason' USING ERRCODE = '22023';
  END IF;
  IF p_outcome NOT IN ('skipped', 'cancelled') AND p_skip_reason IS NOT NULL THEN
    RAISE EXCEPTION 'p_skip_reason is only valid for skipped or cancelled' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.onboarding_email_deliveries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'sending' THEN
    RETURN NULL;
  END IF;

  IF p_outcome = 'sent' THEN
    v_next := 'sent';
    UPDATE public.onboarding_email_deliveries
       SET status = 'sent', sent_at = now(), provider_message_id = v_provider, last_error = NULL,
           locked_until = NULL, updated_at = now()
     WHERE id = p_id;
  ELSIF p_outcome IN ('skipped', 'cancelled') THEN
    v_next := p_outcome;
    UPDATE public.onboarding_email_deliveries
       SET status = p_outcome, skip_reason = p_skip_reason, last_error = v_error,
           locked_until = NULL, updated_at = now()
     WHERE id = p_id;
  ELSIF p_outcome = 'failed' OR v_row.attempts >= 6
        OR now() >= least(v_row.expires_at, v_row.first_attempted_at + interval '23 hours') THEN
    v_next := 'failed';
    UPDATE public.onboarding_email_deliveries
       SET status = 'failed', last_error = coalesce(v_error, 'Delivery failed; review required.'),
           locked_until = NULL, updated_at = now()
     WHERE id = p_id;
  ELSE
    v_next := 'scheduled';
    UPDATE public.onboarding_email_deliveries
       SET status = 'scheduled', last_error = v_error, locked_until = NULL, updated_at = now(),
           available_at = now() + CASE v_row.attempts
                                    WHEN 1 THEN interval '1 minute'
                                    WHEN 2 THEN interval '2 minutes'
                                    WHEN 3 THEN interval '5 minutes'
                                    WHEN 4 THEN interval '15 minutes'
                                    ELSE interval '30 minutes' END
     WHERE id = p_id;
  END IF;

  INSERT INTO public.onboarding_email_delivery_attempts
    (delivery_id, organization_id, attempt_number, outcome, resulting_status, provider_message_id, error)
  VALUES (p_id, v_row.organization_id, v_row.attempts, p_outcome, v_next, v_provider, v_error);

  IF p_outcome = 'cancelled' THEN
    UPDATE public.onboarding_email_deliveries
       SET status = 'cancelled', skip_reason = p_skip_reason, locked_until = NULL, updated_at = now()
     WHERE enrollment_id = v_row.enrollment_id AND status = 'scheduled';
    UPDATE public.onboarding_email_enrollments
       SET status = 'cancelled', cancel_reason = p_skip_reason, updated_at = now()
     WHERE id = v_row.enrollment_id AND status = 'active';
  END IF;

  PERFORM private.onboarding_email_settle(ARRAY[v_row.enrollment_id]);
  RETURN v_next;
END;
$$;

-- Records an opt-out from a verified unsubscribe token (the email-unsubscribe Edge function).
-- Idempotent. Returns false when no profile exists (the caller still answers generically).
CREATE FUNCTION public.record_onboarding_email_opt_out(p_user_id uuid, p_source text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('unsubscribe_link', 'settings') THEN
    RAISE EXCEPTION 'p_source must be unsubscribe_link or settings' USING ERRCODE = '22023';
  END IF;
  SELECT organization_id INTO v_org FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_org IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_email_subscriptions AS s
    (user_id, organization_id, onboarding_opted_out_at, onboarding_opt_out_source)
  VALUES (p_user_id, v_org, now(), p_source)
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id           = EXCLUDED.organization_id,
        onboarding_opted_out_at   = coalesce(s.onboarding_opted_out_at, EXCLUDED.onboarding_opted_out_at),
        onboarding_opt_out_source = coalesce(s.onboarding_opt_out_source, EXCLUDED.onboarding_opt_out_source),
        updated_at                = now();

  PERFORM private.onboarding_email_cancel_user(p_user_id, 'opted_out');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.onboarding_email_enroll_due(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_onboarding_email_deliveries(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_onboarding_email_context(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_onboarding_email_delivery(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_onboarding_email_opt_out(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_email_enroll_due(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_onboarding_email_deliveries(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_onboarding_email_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_email_delivery(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_onboarding_email_opt_out(uuid, text) TO service_role;

-- ── User RPCs (authenticated; scope derived from auth.uid() and the database profile) ──────────
-- The caller's own preference and whether the program is live for their agency. Never another user's.
CREATE FUNCTION public.get_my_email_subscriptions()
RETURNS TABLE (onboarding_program_enabled boolean, onboarding_opted_out boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT (pr.enabled AND (pr.pilot_organization_ids IS NULL OR p.organization_id = ANY (pr.pilot_organization_ids))),
         coalesce(s.onboarding_opted_out_at IS NOT NULL, false)
    FROM public.profiles p
    CROSS JOIN public.onboarding_email_program pr
    LEFT JOIN public.user_email_subscriptions s ON s.user_id = p.id
   WHERE p.id = auth.uid()
     AND pr.id = 1;
$$;

-- Sets the caller's own opt-out. The actor is auth.uid(), read from public.profiles (never the
-- request), must be Active, and its profile organization must equal get_org_id(). Opting out cancels
-- the remaining onboarding steps; opting back in never restarts cancelled steps.
CREATE FUNCTION public.set_my_onboarding_email_opt_out(p_opted_out boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org    uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_opted_out IS NULL THEN
    RAISE EXCEPTION 'p_opted_out is required' USING ERRCODE = '22023';
  END IF;

  SELECT organization_id, status INTO v_org, v_status FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR v_org IS NULL OR v_status IS DISTINCT FROM 'Active'
     OR v_org IS DISTINCT FROM public.get_org_id() THEN
    RAISE EXCEPTION 'profile is not eligible to change this preference' USING ERRCODE = '42501';
  END IF;

  IF p_opted_out THEN
    INSERT INTO public.user_email_subscriptions AS s
      (user_id, organization_id, onboarding_opted_out_at, onboarding_opt_out_source)
    VALUES (v_uid, v_org, now(), 'settings')
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id           = EXCLUDED.organization_id,
          onboarding_opted_out_at   = coalesce(s.onboarding_opted_out_at, EXCLUDED.onboarding_opted_out_at),
          onboarding_opt_out_source = coalesce(s.onboarding_opt_out_source, EXCLUDED.onboarding_opt_out_source),
          updated_at                = now();
    PERFORM private.onboarding_email_cancel_user(v_uid, 'opted_out');
  ELSE
    INSERT INTO public.user_email_subscriptions AS s (user_id, organization_id)
    VALUES (v_uid, v_org)
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id           = EXCLUDED.organization_id,
          onboarding_opted_out_at   = NULL,
          onboarding_opt_out_source = NULL,
          updated_at                = now();
  END IF;

  RETURN p_opted_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_email_subscriptions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_my_onboarding_email_opt_out(boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_email_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_onboarding_email_opt_out(boolean) TO authenticated;

-- ── Postconditions ──────────────────────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF (SELECT enabled OR enrollment_starts_at IS NOT NULL OR pilot_organization_ids IS NOT NULL
        FROM public.onboarding_email_program WHERE id = 1) THEN
    RAISE EXCEPTION 'postcondition: the program must start disabled with no watermark and no pilot';
  END IF;
  IF (SELECT count(*) FROM public.onboarding_email_steps) <> 9 THEN
    RAISE EXCEPTION 'postcondition: exactly 9 steps must be seeded';
  END IF;
  IF EXISTS (SELECT 1 FROM public.onboarding_email_enrollments)
     OR EXISTS (SELECT 1 FROM public.onboarding_email_deliveries) THEN
    RAISE EXCEPTION 'postcondition: no enrollment or delivery may exist at creation (no backfill)';
  END IF;
END $post$;
