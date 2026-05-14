-- Agency Groups: Schema foundation
-- Creates agency_groups, agency_group_members, agency_group_resources tables.
-- Adds profiles.billing_type to lay groundwork for self-pay agent model.

-- ============================================================
-- Table: agency_groups
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agency_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  master_organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agency_groups_master_organization_id
  ON public.agency_groups(master_organization_id);

ALTER TABLE public.agency_groups ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Table: agency_group_members
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agency_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_group_id UUID NOT NULL REFERENCES public.agency_groups(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'left', 'removed')),
  invite_token UUID DEFAULT gen_random_uuid(),
  invite_email TEXT,
  invite_expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One group per org: prevents an org from being in two groups simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_group_members_one_active_group
  ON public.agency_group_members(organization_id)
  WHERE status IN ('active', 'invited');

CREATE INDEX IF NOT EXISTS idx_agency_group_members_agency_group_id
  ON public.agency_group_members(agency_group_id);

CREATE INDEX IF NOT EXISTS idx_agency_group_members_invite_token
  ON public.agency_group_members(invite_token);

ALTER TABLE public.agency_group_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Table: agency_group_resources
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agency_group_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_group_id UUID NOT NULL REFERENCES public.agency_groups(id) ON DELETE CASCADE,
  uploaded_by_org_id UUID NOT NULL REFERENCES public.organizations(id),
  uploaded_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL DEFAULT 'document'
    CHECK (resource_type IN ('script', 'document', 'objection_sheet', 'training_video', 'other')),
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agency_group_resources_agency_group_id
  ON public.agency_group_resources(agency_group_id);

ALTER TABLE public.agency_group_resources ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- profiles.billing_type — groundwork for future self-pay agents
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'agency_covered'
  CHECK (billing_type IN ('agency_covered', 'self_pay'));

NOTIFY pgrst, 'reload schema';
