-- =============================================================
-- Migration: message_templates — Agency/Personal scope + RLS harden
-- Date: 2026-05-25
-- Audit (pre-apply, project jncvvsvckxhqgqvkppmj):
--   total rows = 0; null organization_id = 0
--   columns: scope MISSING; created_by MISSING; organization_id nullable
--   trigger: no updated_at trigger
--   policies: legacy 4 policies using get_user_org_id(), no Super Admin path
-- Purpose:
--   - Add scope ('agency'|'personal') and created_by columns
--   - Enforce organization_id NOT NULL (0 rows; safe)
--   - Personal-scoped rows require created_by
--   - Add canonical updated_at trigger
--   - Add (org), (org,scope), (org,created_by) indexes
--   - Replace RLS with Agency/Personal split + platform Super Admin path
-- Depends on: public.get_org_id(), public.get_user_role(),
--             public.is_super_admin(), public.update_updated_at()
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Add scope (default 'agency') and constrain values
-- ---------------------------------------------------------------
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'agency';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.message_templates'::regclass
      AND conname = 'message_templates_scope_check'
  ) THEN
    ALTER TABLE public.message_templates
      ADD CONSTRAINT message_templates_scope_check
      CHECK (scope IN ('agency', 'personal'));
  END IF;
END$$;

-- Defensive backfill — prod has 0 rows; idempotent no-op if scope already set.
UPDATE public.message_templates SET scope = 'agency' WHERE scope IS NULL;

-- ---------------------------------------------------------------
-- 2. Add created_by referencing auth.users
-- ---------------------------------------------------------------
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Personal-scoped rows must carry an owner
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.message_templates'::regclass
      AND conname = 'message_templates_personal_requires_owner'
  ) THEN
    ALTER TABLE public.message_templates
      ADD CONSTRAINT message_templates_personal_requires_owner
      CHECK (scope <> 'personal' OR created_by IS NOT NULL);
  END IF;
END$$;

-- ---------------------------------------------------------------
-- 3. organization_id NOT NULL (audit: 0 rows; safe)
--    Safety guard: refuse to apply if any NULLs slipped in.
-- ---------------------------------------------------------------
DO $$
DECLARE
  null_org_count integer;
BEGIN
  SELECT count(*) INTO null_org_count
  FROM public.message_templates
  WHERE organization_id IS NULL;

  IF null_org_count > 0 THEN
    RAISE EXCEPTION
      'Cannot SET NOT NULL on message_templates.organization_id: % rows have NULL organization_id. Backfill first.',
      null_org_count;
  END IF;
END$$;

ALTER TABLE public.message_templates
  ALTER COLUMN organization_id SET NOT NULL;

-- ---------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_message_templates_org
  ON public.message_templates (organization_id);

CREATE INDEX IF NOT EXISTS idx_message_templates_org_scope
  ON public.message_templates (organization_id, scope);

CREATE INDEX IF NOT EXISTS idx_message_templates_org_created_by
  ON public.message_templates (organization_id, created_by);

-- ---------------------------------------------------------------
-- 5. updated_at trigger (canonical helper)
-- ---------------------------------------------------------------
DROP TRIGGER IF EXISTS message_templates_updated_at ON public.message_templates;
CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------
-- 6. RLS — drop legacy 4, recreate with Agency/Personal split + Super Admin
-- ---------------------------------------------------------------
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_templates_select ON public.message_templates;
DROP POLICY IF EXISTS message_templates_insert ON public.message_templates;
DROP POLICY IF EXISTS message_templates_update ON public.message_templates;
DROP POLICY IF EXISTS message_templates_delete ON public.message_templates;

-- SELECT:
--   - platform Super Admin: all rows
--   - own org Agency templates
--   - own org Personal templates owned by current user
CREATE POLICY message_templates_select ON public.message_templates
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      scope = 'agency'
      OR (scope = 'personal' AND created_by = auth.uid())
    )
  )
);

-- INSERT:
--   - org_id required, scope valid
--   - Super Admin: any valid row
--   - Agency: same org + role Admin
--   - Personal: same org + created_by = auth.uid()
CREATE POLICY message_templates_insert ON public.message_templates
FOR INSERT TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND scope IN ('agency', 'personal')
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND (
        (scope = 'agency'   AND public.get_user_role() = 'Admin')
        OR (scope = 'personal' AND created_by = auth.uid())
      )
    )
  )
);

-- UPDATE:
--   USING: who can read+modify
--   WITH CHECK: post-row must be valid (org NOT NULL, scope valid,
--               personal->created_by, and same actor branches)
CREATE POLICY message_templates_update ON public.message_templates
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      (scope = 'agency'   AND public.get_user_role() = 'Admin')
      OR (scope = 'personal' AND created_by = auth.uid())
    )
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND scope IN ('agency', 'personal')
  AND (scope = 'agency' OR created_by IS NOT NULL)
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND (
        (scope = 'agency'   AND public.get_user_role() = 'Admin')
        OR (scope = 'personal' AND created_by = auth.uid())
      )
    )
  )
);

-- DELETE:
--   - Super Admin: any
--   - Agency: own org + Admin
--   - Personal: own org + owner
CREATE POLICY message_templates_delete ON public.message_templates
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      (scope = 'agency'   AND public.get_user_role() = 'Admin')
      OR (scope = 'personal' AND created_by = auth.uid())
    )
  )
);

NOTIFY pgrst, 'reload schema';
