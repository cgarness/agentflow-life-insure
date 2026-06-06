-- =============================================================================
-- Control Center → Tracker (schema)
-- =============================================================================
-- Five platform-global tables backing the internal AgentFlow launch-readiness
-- Tracker at /control-center/tracker (platform-admin only).
--
-- Design notes (mirrors the existing control_center_* tables):
-- * organization_id is nullable and tracker rows are PLATFORM-GLOBAL in v1.
--   This is the intentional, approved exception to "every table scoped by
--   organization_id" — Control Center tables are platform-global (see
--   AGENT_RULES.md §3). Do NOT "fix" this to get_org_id() scoping.
-- * RLS copies the control_center_features / control_center_issues shape
--   exactly: gated on public.is_platform_admin() (reads profiles directly,
--   not the JWT). Platform admins get full CRUD; everyone else gets nothing.
-- * completion_percent is INTENTIONALLY NOT STORED — completion is derived in
--   the UI from item statuses.
-- * Status/priority/etc. are TEXT + CHECK constraints (no Postgres enums).
-- * updated_at stays fresh via the existing extensions.moddatetime() trigger
--   function (same as the other control_center_* tables).
--
-- This schema migration MUST sort BEFORE the seed migration
-- (<later-timestamp>_control_center_tracker_seed.sql) so the tables exist
-- before the seed upserts run. Column / constraint / check-value names here
-- match the seed's ON CONFLICT unique keys exactly.
-- =============================================================================

-- 1. control_center_tracker_systems ------------------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_tracker_systems (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  system_key            text NOT NULL UNIQUE,
  name                  text NOT NULL,
  category              text NOT NULL,
  plain_english_summary text NULL,
  status                text NOT NULL,
  priority              text NOT NULL DEFAULT 'medium',
  marketable_status     text NOT NULL DEFAULT 'unknown',
  owner                 text NULL,
  sort_order            integer NOT NULL DEFAULT 100,
  last_reviewed_at      timestamptz NULL,
  notes                 text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_tracker_systems_status_check CHECK (status IN (
    'not_started','in_progress','needs_work','broken','complete','deferred'
  )),
  CONSTRAINT cc_tracker_systems_priority_check CHECK (priority IN (
    'critical','high','medium','low'
  )),
  CONSTRAINT cc_tracker_systems_marketable_check CHECK (marketable_status IN (
    'yes','partial','no','unknown'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_tracker_systems_org        ON public.control_center_tracker_systems (organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_systems_status     ON public.control_center_tracker_systems (status);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_systems_priority   ON public.control_center_tracker_systems (priority);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_systems_category   ON public.control_center_tracker_systems (category);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_systems_sort       ON public.control_center_tracker_systems (sort_order);

DROP TRIGGER IF EXISTS set_cc_tracker_systems_updated_at ON public.control_center_tracker_systems;
CREATE TRIGGER set_cc_tracker_systems_updated_at
  BEFORE UPDATE ON public.control_center_tracker_systems
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 2. control_center_tracker_items --------------------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_tracker_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  system_id           uuid NOT NULL REFERENCES public.control_center_tracker_systems(id) ON DELETE CASCADE,
  item_key            text NOT NULL,
  title               text NOT NULL,
  description         text NULL,
  status              text NOT NULL,
  priority            text NOT NULL DEFAULT 'medium',
  marketable_status   text NOT NULL DEFAULT 'unknown',
  production_critical boolean NOT NULL DEFAULT false,
  mobile_visible      boolean NOT NULL DEFAULT true,
  source_of_truth     text NULL,
  next_action         text NULL,
  notes               text NULL,
  sort_order          integer NOT NULL DEFAULT 100,
  last_reviewed_at    timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_tracker_items_status_check CHECK (status IN (
    'not_started','in_progress','needs_work','broken','complete','deferred'
  )),
  CONSTRAINT cc_tracker_items_priority_check CHECK (priority IN (
    'critical','high','medium','low'
  )),
  CONSTRAINT cc_tracker_items_marketable_check CHECK (marketable_status IN (
    'yes','partial','no','unknown'
  )),
  CONSTRAINT cc_tracker_items_system_item_key_unique UNIQUE (system_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_cc_tracker_items_org       ON public.control_center_tracker_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_items_system    ON public.control_center_tracker_items (system_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_items_status    ON public.control_center_tracker_items (status);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_items_priority  ON public.control_center_tracker_items (priority);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_items_prod_crit ON public.control_center_tracker_items (production_critical);

DROP TRIGGER IF EXISTS set_cc_tracker_items_updated_at ON public.control_center_tracker_items;
CREATE TRIGGER set_cc_tracker_items_updated_at
  BEFORE UPDATE ON public.control_center_tracker_items
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 3. control_center_tracker_issues -------------------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_tracker_issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  system_id         uuid NULL REFERENCES public.control_center_tracker_systems(id) ON DELETE SET NULL,
  item_id           uuid NULL REFERENCES public.control_center_tracker_items(id) ON DELETE SET NULL,
  issue_key         text NOT NULL UNIQUE,
  title             text NOT NULL,
  description       text NULL,
  severity          text NOT NULL,
  status            text NOT NULL DEFAULT 'open',
  owner             text NULL,
  next_action       text NULL,
  discovered_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz NULL,
  last_reviewed_at  timestamptz NULL,
  notes             text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_tracker_issues_severity_check CHECK (severity IN (
    'critical','high','medium','low','info'
  )),
  CONSTRAINT cc_tracker_issues_status_check CHECK (status IN (
    'open','investigating','fix_in_progress','resolved','ignored'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_tracker_issues_org      ON public.control_center_tracker_issues (organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_issues_system   ON public.control_center_tracker_issues (system_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_issues_item     ON public.control_center_tracker_issues (item_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_issues_severity ON public.control_center_tracker_issues (severity);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_issues_status   ON public.control_center_tracker_issues (status);

DROP TRIGGER IF EXISTS set_cc_tracker_issues_updated_at ON public.control_center_tracker_issues;
CREATE TRIGGER set_cc_tracker_issues_updated_at
  BEFORE UPDATE ON public.control_center_tracker_issues
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 4. control_center_tracker_marketing_claims ---------------------------------

CREATE TABLE IF NOT EXISTS public.control_center_tracker_marketing_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  system_id         uuid NULL REFERENCES public.control_center_tracker_systems(id) ON DELETE SET NULL,
  claim_key         text NOT NULL UNIQUE,
  feature_claim     text NOT NULL,
  marketed_location text NULL,
  reality_status    text NOT NULL,
  actual_status     text NULL,
  action_needed     text NOT NULL,
  priority          text NOT NULL DEFAULT 'medium',
  notes             text NULL,
  last_reviewed_at  timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_tracker_claims_reality_check CHECK (reality_status IN (
    'accurate','partial','inaccurate','not_marketed'
  )),
  CONSTRAINT cc_tracker_claims_action_check CHECK (action_needed IN (
    'keep','update_copy','remove_claim','build_feature','hide_until_ready','defer'
  )),
  CONSTRAINT cc_tracker_claims_priority_check CHECK (priority IN (
    'critical','high','medium','low'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_tracker_claims_org      ON public.control_center_tracker_marketing_claims (organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_claims_system   ON public.control_center_tracker_marketing_claims (system_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_claims_reality  ON public.control_center_tracker_marketing_claims (reality_status);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_claims_action   ON public.control_center_tracker_marketing_claims (action_needed);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_claims_priority ON public.control_center_tracker_marketing_claims (priority);

DROP TRIGGER IF EXISTS set_cc_tracker_claims_updated_at ON public.control_center_tracker_marketing_claims;
CREATE TRIGGER set_cc_tracker_claims_updated_at
  BEFORE UPDATE ON public.control_center_tracker_marketing_claims
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- 5. control_center_tracker_references ---------------------------------------
-- No organization_id and no updated_at per spec (immutable-ish reference rows).

CREATE TABLE IF NOT EXISTS public.control_center_tracker_references (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id   uuid NULL REFERENCES public.control_center_tracker_systems(id) ON DELETE SET NULL,
  item_id     uuid NULL REFERENCES public.control_center_tracker_items(id) ON DELETE SET NULL,
  ref_key     text NOT NULL UNIQUE,
  kind        text NOT NULL,
  label       text NOT NULL,
  url_or_path text NULL,
  notes       text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_tracker_references_kind_check CHECK (kind IN (
    'doc','migration','file','rpc','edge_function','deploy','url'
  ))
);

CREATE INDEX IF NOT EXISTS idx_cc_tracker_references_system ON public.control_center_tracker_references (system_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_references_item   ON public.control_center_tracker_references (item_id);
CREATE INDEX IF NOT EXISTS idx_cc_tracker_references_kind   ON public.control_center_tracker_references (kind);

-- 6. RLS — mirror the control_center_features / control_center_issues pattern --
-- Platform-global, gated on public.is_platform_admin(). Full CRUD for platform
-- admins; nothing for anyone else.

ALTER TABLE public.control_center_tracker_systems          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_center_tracker_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_center_tracker_issues           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_center_tracker_marketing_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_center_tracker_references       ENABLE ROW LEVEL SECURITY;

-- Systems
DROP POLICY IF EXISTS cc_tracker_systems_select ON public.control_center_tracker_systems;
DROP POLICY IF EXISTS cc_tracker_systems_insert ON public.control_center_tracker_systems;
DROP POLICY IF EXISTS cc_tracker_systems_update ON public.control_center_tracker_systems;
DROP POLICY IF EXISTS cc_tracker_systems_delete ON public.control_center_tracker_systems;

CREATE POLICY cc_tracker_systems_select ON public.control_center_tracker_systems
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY cc_tracker_systems_insert ON public.control_center_tracker_systems
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_systems_update ON public.control_center_tracker_systems
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_systems_delete ON public.control_center_tracker_systems
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- Items
DROP POLICY IF EXISTS cc_tracker_items_select ON public.control_center_tracker_items;
DROP POLICY IF EXISTS cc_tracker_items_insert ON public.control_center_tracker_items;
DROP POLICY IF EXISTS cc_tracker_items_update ON public.control_center_tracker_items;
DROP POLICY IF EXISTS cc_tracker_items_delete ON public.control_center_tracker_items;

CREATE POLICY cc_tracker_items_select ON public.control_center_tracker_items
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY cc_tracker_items_insert ON public.control_center_tracker_items
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_items_update ON public.control_center_tracker_items
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_items_delete ON public.control_center_tracker_items
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- Issues
DROP POLICY IF EXISTS cc_tracker_issues_select ON public.control_center_tracker_issues;
DROP POLICY IF EXISTS cc_tracker_issues_insert ON public.control_center_tracker_issues;
DROP POLICY IF EXISTS cc_tracker_issues_update ON public.control_center_tracker_issues;
DROP POLICY IF EXISTS cc_tracker_issues_delete ON public.control_center_tracker_issues;

CREATE POLICY cc_tracker_issues_select ON public.control_center_tracker_issues
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY cc_tracker_issues_insert ON public.control_center_tracker_issues
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_issues_update ON public.control_center_tracker_issues
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_issues_delete ON public.control_center_tracker_issues
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- Marketing claims
DROP POLICY IF EXISTS cc_tracker_claims_select ON public.control_center_tracker_marketing_claims;
DROP POLICY IF EXISTS cc_tracker_claims_insert ON public.control_center_tracker_marketing_claims;
DROP POLICY IF EXISTS cc_tracker_claims_update ON public.control_center_tracker_marketing_claims;
DROP POLICY IF EXISTS cc_tracker_claims_delete ON public.control_center_tracker_marketing_claims;

CREATE POLICY cc_tracker_claims_select ON public.control_center_tracker_marketing_claims
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY cc_tracker_claims_insert ON public.control_center_tracker_marketing_claims
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_claims_update ON public.control_center_tracker_marketing_claims
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_claims_delete ON public.control_center_tracker_marketing_claims
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- References
DROP POLICY IF EXISTS cc_tracker_references_select ON public.control_center_tracker_references;
DROP POLICY IF EXISTS cc_tracker_references_insert ON public.control_center_tracker_references;
DROP POLICY IF EXISTS cc_tracker_references_update ON public.control_center_tracker_references;
DROP POLICY IF EXISTS cc_tracker_references_delete ON public.control_center_tracker_references;

CREATE POLICY cc_tracker_references_select ON public.control_center_tracker_references
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY cc_tracker_references_insert ON public.control_center_tracker_references
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_references_update ON public.control_center_tracker_references
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY cc_tracker_references_delete ON public.control_center_tracker_references
  FOR DELETE TO authenticated USING (public.is_platform_admin());

NOTIFY pgrst, 'reload schema';
