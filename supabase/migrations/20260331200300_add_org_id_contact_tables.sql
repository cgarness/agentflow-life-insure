-- =============================================================
-- Migration 004: Add organization_id to contact_notes & contact_activities
-- Purpose: Enable zero-lookup RLS on polymorphic contact tables
-- =============================================================

-- 1. Add organization_id column to contact_notes
ALTER TABLE public.contact_notes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2. Add organization_id column to contact_activities
ALTER TABLE public.contact_activities
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 3. Backfill contact_notes from the parent contact's org
-- contact_type can be 'lead', 'client', 'recruit', or 'agent'
UPDATE public.contact_notes cn
SET organization_id = l.organization_id
FROM public.leads l
WHERE cn.contact_type = 'lead'
  AND cn.contact_id = l.id
  AND cn.organization_id IS NULL;

UPDATE public.contact_notes cn
SET organization_id = c.organization_id
FROM public.clients c
WHERE cn.contact_type = 'client'
  AND cn.contact_id = c.id
  AND cn.organization_id IS NULL;

UPDATE public.contact_notes cn
SET organization_id = r.organization_id
FROM public.recruits r
WHERE cn.contact_type = 'recruit'
  AND cn.contact_id = r.id
  AND cn.organization_id IS NULL;

UPDATE public.contact_notes cn
SET organization_id = p.organization_id
FROM public.profiles p
WHERE cn.contact_type = 'agent'
  AND cn.contact_id = p.id
  AND cn.organization_id IS NULL;

-- 4. Backfill contact_activities from the parent contact's org
UPDATE public.contact_activities ca
SET organization_id = l.organization_id
FROM public.leads l
WHERE ca.contact_type = 'lead'
  AND ca.contact_id = l.id
  AND ca.organization_id IS NULL;

UPDATE public.contact_activities ca
SET organization_id = c.organization_id
FROM public.clients c
WHERE ca.contact_type = 'client'
  AND ca.contact_id = c.id
  AND ca.organization_id IS NULL;

UPDATE public.contact_activities ca
SET organization_id = r.organization_id
FROM public.recruits r
WHERE ca.contact_type = 'recruit'
  AND ca.contact_id = r.id
  AND ca.organization_id IS NULL;

UPDATE public.contact_activities ca
SET organization_id = p.organization_id
FROM public.profiles p
WHERE ca.contact_type = 'agent'
  AND ca.contact_id = p.id
  AND ca.organization_id IS NULL;

-- 5. Create indexes for fast org-scoped lookups
CREATE INDEX IF NOT EXISTS idx_contact_notes_org_id ON public.contact_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_activities_org_id ON public.contact_activities(organization_id);

NOTIFY pgrst, 'reload schema';
