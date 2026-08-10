-- Phase 2a: Number Groups schema — campaign-scoped outbound number pools and agent direct lines.
-- Creates number_groups and number_group_members tables, plus three new columns on existing tables:
--   phone_numbers.is_direct_line, phone_numbers.voicemail_greeting_url, campaigns.number_group_id.
-- All RLS is org-scoped via public.get_org_id(); writes restricted to Admin / Team Leader (super admins bypass).

-- =====================================================================
-- PART 1: number_groups
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.number_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'number_groups_organization_id_name_key'
      AND conrelid = 'public.number_groups'::regclass
  ) THEN
    ALTER TABLE public.number_groups
      ADD CONSTRAINT number_groups_organization_id_name_key UNIQUE (organization_id, name);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_number_groups_organization_id
  ON public.number_groups(organization_id);

ALTER TABLE public.number_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS number_groups_select ON public.number_groups;
CREATE POLICY number_groups_select ON public.number_groups
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS number_groups_insert ON public.number_groups;
CREATE POLICY number_groups_insert ON public.number_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS number_groups_update ON public.number_groups;
CREATE POLICY number_groups_update ON public.number_groups
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS number_groups_delete ON public.number_groups;
CREATE POLICY number_groups_delete ON public.number_groups
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- =====================================================================
-- PART 2: number_group_members (junction; a phone number may belong to multiple groups)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.number_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number_group_id uuid NOT NULL REFERENCES public.number_groups(id) ON DELETE CASCADE,
  phone_number_id uuid NOT NULL REFERENCES public.phone_numbers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'number_group_members_group_phone_key'
      AND conrelid = 'public.number_group_members'::regclass
  ) THEN
    ALTER TABLE public.number_group_members
      ADD CONSTRAINT number_group_members_group_phone_key UNIQUE (number_group_id, phone_number_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_number_group_members_number_group_id
  ON public.number_group_members(number_group_id);

CREATE INDEX IF NOT EXISTS idx_number_group_members_phone_number_id
  ON public.number_group_members(phone_number_id);

ALTER TABLE public.number_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS number_group_members_select ON public.number_group_members;
CREATE POLICY number_group_members_select ON public.number_group_members
  FOR SELECT TO authenticated
  USING (
    number_group_id IN (
      SELECT id FROM public.number_groups WHERE organization_id = public.get_org_id()
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS number_group_members_insert ON public.number_group_members;
CREATE POLICY number_group_members_insert ON public.number_group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    number_group_id IN (
      SELECT id FROM public.number_groups WHERE organization_id = public.get_org_id()
    )
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS number_group_members_update ON public.number_group_members;
CREATE POLICY number_group_members_update ON public.number_group_members
  FOR UPDATE TO authenticated
  USING (
    number_group_id IN (
      SELECT id FROM public.number_groups WHERE organization_id = public.get_org_id()
    )
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    number_group_id IN (
      SELECT id FROM public.number_groups WHERE organization_id = public.get_org_id()
    )
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS number_group_members_delete ON public.number_group_members;
CREATE POLICY number_group_members_delete ON public.number_group_members
  FOR DELETE TO authenticated
  USING (
    number_group_id IN (
      SELECT id FROM public.number_groups WHERE organization_id = public.get_org_id()
    )
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- =====================================================================
-- PART 3: phone_numbers.is_direct_line
-- =====================================================================

ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS is_direct_line boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.phone_numbers.is_direct_line IS
  'When true, this number is an agent''s personal direct line. It is excluded from all number group pools and the dialer never uses it for outbound. Inbound calls ring only the assigned_to agent.';

-- =====================================================================
-- PART 4: phone_numbers.voicemail_greeting_url
-- =====================================================================

ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS voicemail_greeting_url text;

COMMENT ON COLUMN public.phone_numbers.voicemail_greeting_url IS
  'URL to a custom voicemail greeting audio file for this specific number. Overrides the org-level voicemail_greeting_url when set.';

-- =====================================================================
-- PART 5: campaigns.number_group_id
-- =====================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS number_group_id uuid REFERENCES public.number_groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.campaigns.number_group_id IS
  'The number group (pool of phone numbers) used for outbound dialing on this campaign. When NULL, the dialer uses all active non-direct-line org numbers.';

CREATE INDEX IF NOT EXISTS idx_campaigns_number_group_id
  ON public.campaigns(number_group_id);

-- =====================================================================
-- PART 7: Reload PostgREST schema cache
-- =====================================================================

NOTIFY pgrst, 'reload schema';
