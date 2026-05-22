-- =============================================================================
-- Control Center v1
-- =============================================================================
-- Adds a platform-level role (profiles.platform_role) and four tables for the
-- internal AgentFlow Control Center experience: feature tracker, issue tracker,
-- health-check registry, and health-check run history.
--
-- Design notes:
-- * platform_role is intentionally separate from the agency role string and
--   from is_super_admin. is_super_admin = AgentFlow staff with cross-org
--   tenant power; platform_role = AgentFlow staff with internal ops visibility.
--   No automatic bridge; Chris sets platform_role manually on the few profiles
--   that need it.
-- * v1 enum: NULL or 'platform_admin'. Future migrations may extend the CHECK
--   to include platform_manager / platform_viewer.
-- * Access is gated by public.is_platform_admin() which reads profiles
--   directly (no JWT claim). This avoids reissuing every active session.
-- * organization_id is nullable on all Control Center tables. v1 records are
--   platform-global (org-null). The column is retained so future agency-scoped
--   Control Center records won't require a migration.
-- =============================================================================

-- 1. Platform role on profiles -----------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS platform_role text NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_platform_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_platform_role_check
  CHECK (platform_role IS NULL OR platform_role IN ('platform_admin'));

CREATE INDEX IF NOT EXISTS idx_profiles_platform_role
  ON public.profiles (platform_role)
  WHERE platform_role IS NOT NULL;

-- 2. Helper: is_platform_admin() ---------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND platform_role = 'platform_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- 3. control_center_features --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_features (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key         text NOT NULL UNIQUE,
  name                text NOT NULL,
  category            text NOT NULL,
  description         text NULL,
  status              text NOT NULL,
  priority            text NOT NULL,
  owner               text NULL,
  is_customer_visible boolean NOT NULL DEFAULT false,
  is_internal_only    boolean NOT NULL DEFAULT true,
  is_blocked          boolean NOT NULL DEFAULT false,
  blocked_reason      text NULL,
  last_reviewed_at    timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_center_features_status_check CHECK (status IN (
    'not_started','planned','in_progress','needs_review','testing',
    'live','live_with_issues','broken','blocked','deprecated'
  )),
  CONSTRAINT control_center_features_priority_check CHECK (priority IN (
    'critical','high','medium','low','parking_lot'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_features_org           ON public.control_center_features (organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_features_status        ON public.control_center_features (status);
CREATE INDEX IF NOT EXISTS idx_cc_features_priority      ON public.control_center_features (priority);
CREATE INDEX IF NOT EXISTS idx_cc_features_category      ON public.control_center_features (category);

DROP TRIGGER IF EXISTS set_cc_features_updated_at ON public.control_center_features;
CREATE TRIGGER set_cc_features_updated_at
  BEFORE UPDATE ON public.control_center_features
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 4. control_center_issues ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_id        uuid NULL REFERENCES public.control_center_features(id) ON DELETE SET NULL,
  title             text NOT NULL,
  description       text NULL,
  severity          text NOT NULL,
  status            text NOT NULL,
  source            text NOT NULL,
  reported_by       uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to       uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NULL,
  resolved_at       timestamptz NULL,
  resolution_notes  text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_center_issues_severity_check CHECK (severity IN (
    'critical','high','medium','low','info'
  )),
  CONSTRAINT control_center_issues_status_check CHECK (status IN (
    'open','investigating','fix_in_progress','waiting_on_review','resolved','ignored'
  )),
  CONSTRAINT control_center_issues_source_check CHECK (source IN (
    'manual','system_health_check','frontend_error','edge_function_error',
    'twilio','supabase','vercel','user_report','agent_report'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_issues_org           ON public.control_center_issues (organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_issues_severity      ON public.control_center_issues (severity);
CREATE INDEX IF NOT EXISTS idx_cc_issues_status        ON public.control_center_issues (status);
CREATE INDEX IF NOT EXISTS idx_cc_issues_source        ON public.control_center_issues (source);
CREATE INDEX IF NOT EXISTS idx_cc_issues_feature       ON public.control_center_issues (feature_id);

DROP TRIGGER IF EXISTS set_cc_issues_updated_at ON public.control_center_issues;
CREATE TRIGGER set_cc_issues_updated_at
  BEFORE UPDATE ON public.control_center_issues
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 5. control_center_health_checks --------------------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_health_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key          text NOT NULL UNIQUE,
  name               text NOT NULL,
  description        text NULL,
  category           text NOT NULL,
  check_type         text NOT NULL,
  target             text NULL,
  expected_result    text NULL,
  status             text NOT NULL DEFAULT 'unknown',
  last_run_at        timestamptz NULL,
  last_success_at    timestamptz NULL,
  last_failure_at    timestamptz NULL,
  failure_count      integer NOT NULL DEFAULT 0,
  last_error         text NULL,
  is_enabled         boolean NOT NULL DEFAULT true,
  severity           text NOT NULL DEFAULT 'medium',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_center_health_checks_status_check CHECK (status IN (
    'healthy','degraded','failing','unknown','disabled'
  )),
  CONSTRAINT control_center_health_checks_severity_check CHECK (severity IN (
    'critical','high','medium','low','info'
  )),
  CONSTRAINT control_center_health_checks_type_check CHECK (check_type IN (
    'http_ping','database_query','edge_function_ping','twilio_token_test',
    'auth_test','storage_test','realtime_test','workflow_test','manual_check'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_health_status   ON public.control_center_health_checks (status);
CREATE INDEX IF NOT EXISTS idx_cc_health_enabled  ON public.control_center_health_checks (is_enabled);
CREATE INDEX IF NOT EXISTS idx_cc_health_category ON public.control_center_health_checks (category);

DROP TRIGGER IF EXISTS set_cc_health_checks_updated_at ON public.control_center_health_checks;
CREATE TRIGGER set_cc_health_checks_updated_at
  BEFORE UPDATE ON public.control_center_health_checks
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 6. control_center_health_check_runs ----------------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_health_check_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_check_id  uuid NOT NULL REFERENCES public.control_center_health_checks(id) ON DELETE CASCADE,
  status           text NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz NULL,
  duration_ms      integer NULL,
  result_summary   text NULL,
  error_message    text NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_center_health_check_runs_status_check CHECK (status IN (
    'healthy','degraded','failing','unknown','disabled'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_health_runs_check_started
  ON public.control_center_health_check_runs (health_check_id, started_at DESC);

-- 7. RLS ---------------------------------------------------------------------

ALTER TABLE public.control_center_features         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_center_issues           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_center_health_checks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_center_health_check_runs ENABLE ROW LEVEL SECURITY;

-- Features
DROP POLICY IF EXISTS cc_features_select ON public.control_center_features;
DROP POLICY IF EXISTS cc_features_insert ON public.control_center_features;
DROP POLICY IF EXISTS cc_features_update ON public.control_center_features;
DROP POLICY IF EXISTS cc_features_delete ON public.control_center_features;

CREATE POLICY cc_features_select ON public.control_center_features
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());
CREATE POLICY cc_features_insert ON public.control_center_features
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_features_update ON public.control_center_features
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_features_delete ON public.control_center_features
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- Issues
DROP POLICY IF EXISTS cc_issues_select ON public.control_center_issues;
DROP POLICY IF EXISTS cc_issues_insert ON public.control_center_issues;
DROP POLICY IF EXISTS cc_issues_update ON public.control_center_issues;
DROP POLICY IF EXISTS cc_issues_delete ON public.control_center_issues;

CREATE POLICY cc_issues_select ON public.control_center_issues
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());
CREATE POLICY cc_issues_insert ON public.control_center_issues
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_issues_update ON public.control_center_issues
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_issues_delete ON public.control_center_issues
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- Health checks
DROP POLICY IF EXISTS cc_health_select ON public.control_center_health_checks;
DROP POLICY IF EXISTS cc_health_insert ON public.control_center_health_checks;
DROP POLICY IF EXISTS cc_health_update ON public.control_center_health_checks;
DROP POLICY IF EXISTS cc_health_delete ON public.control_center_health_checks;

CREATE POLICY cc_health_select ON public.control_center_health_checks
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());
CREATE POLICY cc_health_insert ON public.control_center_health_checks
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_health_update ON public.control_center_health_checks
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_health_delete ON public.control_center_health_checks
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- Health check runs
DROP POLICY IF EXISTS cc_health_runs_select ON public.control_center_health_check_runs;
DROP POLICY IF EXISTS cc_health_runs_insert ON public.control_center_health_check_runs;
DROP POLICY IF EXISTS cc_health_runs_delete ON public.control_center_health_check_runs;

CREATE POLICY cc_health_runs_select ON public.control_center_health_check_runs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());
CREATE POLICY cc_health_runs_insert ON public.control_center_health_check_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_health_runs_delete ON public.control_center_health_check_runs
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

NOTIFY pgrst, 'reload schema';
