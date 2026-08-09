-- =============================================================
-- Migration: RLS Audit for Dialer Tables
-- Purpose: Lock down dnc_list (org-scoped) and dialer_sessions
--          (agent + org scoped). dialer_daily_stats already has
--          correct agent-scoped RLS — no changes needed there.
-- =============================================================

-- -------------------------------------------------------
-- 1. dnc_list: Add organization_id column if missing,
--    then replace wide-open policies with org-scoped ones
-- -------------------------------------------------------
ALTER TABLE public.dnc_list
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

-- Create index for org-scoped lookups
CREATE INDEX IF NOT EXISTS idx_dnc_list_org_id ON public.dnc_list(organization_id);

-- Drop the wide-open policies
DROP POLICY IF EXISTS "Allow authenticated users to view DNC list" ON public.dnc_list;
DROP POLICY IF EXISTS "Allow authenticated users to manage DNC list" ON public.dnc_list;

-- Org-scoped SELECT: users can only see DNC entries for their organization
CREATE POLICY "dnc_list_select_org" ON public.dnc_list
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Org-scoped INSERT: users can only add DNC entries for their organization
CREATE POLICY "dnc_list_insert_org" ON public.dnc_list
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Org-scoped UPDATE: users can only update DNC entries for their organization
CREATE POLICY "dnc_list_update_org" ON public.dnc_list
  FOR UPDATE TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Org-scoped DELETE: users can only delete DNC entries for their organization
CREATE POLICY "dnc_list_delete_org" ON public.dnc_list
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- -------------------------------------------------------
-- 2. dialer_sessions: Enable RLS with agent + org scoping
-- -------------------------------------------------------
ALTER TABLE public.dialer_sessions ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'dialer_sessions' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.dialer_sessions', pol.policyname);
    END LOOP;
END $$;

-- Agent can SELECT their own sessions
CREATE POLICY "dialer_sessions_select_own" ON public.dialer_sessions
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid());

-- Agent can INSERT their own sessions
CREATE POLICY "dialer_sessions_insert_own" ON public.dialer_sessions
  FOR INSERT TO authenticated
  WITH CHECK (agent_id = auth.uid());

-- Agent can UPDATE their own sessions
CREATE POLICY "dialer_sessions_update_own" ON public.dialer_sessions
  FOR UPDATE TO authenticated
  USING (agent_id = auth.uid());

-- Admin/Team Lead can view all sessions within their org (for reporting)
CREATE POLICY "dialer_sessions_admin_select" ON public.dialer_sessions
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('Admin', 'Team Lead')
    )
  );

-- -------------------------------------------------------
-- 3. Refresh PostgREST schema cache
-- -------------------------------------------------------
NOTIFY pgrst, 'reload schema';
