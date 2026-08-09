-- =============================================================
-- Migration 005: RLS Lockdown — Zero-Lookup Policies
-- Purpose: Drop all USING(true) policies on CRM data tables.
--          Replace with org-scoped, hierarchy-aware, JWT-based RLS.
-- =============================================================

-- =====================================================================
-- LEADS
-- =====================================================================
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.leads;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on leads" ON public.leads;

-- SELECT: User sees leads in their org if Admin, the assigned agent, or an ancestor
CREATE POLICY "leads_select_org_scoped" ON public.leads
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR assigned_agent_id = auth.uid()
      OR public.is_ancestor_of(auth.uid(), assigned_agent_id)
    )
  )
);

-- INSERT: Must match caller's org
CREATE POLICY "leads_insert_org_scoped" ON public.leads
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

-- UPDATE: Same visibility as SELECT
CREATE POLICY "leads_update_org_scoped" ON public.leads
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR assigned_agent_id = auth.uid()
      OR public.is_ancestor_of(auth.uid(), assigned_agent_id)
    )
  )
)
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

-- DELETE: Admin only within org, or super admin
CREATE POLICY "leads_delete_admin_only" ON public.leads
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
  )
);

-- =====================================================================
-- CLIENTS
-- =====================================================================
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.clients;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on clients" ON public.clients;
DROP POLICY IF EXISTS "Users can insert clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Users can view clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Users can update clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Users can delete clients in their organization" ON public.clients;

CREATE POLICY "clients_select_org_scoped" ON public.clients
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR assigned_agent_id = auth.uid()
      OR public.is_ancestor_of(auth.uid(), assigned_agent_id)
    )
  )
);

CREATE POLICY "clients_insert_org_scoped" ON public.clients
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

CREATE POLICY "clients_update_org_scoped" ON public.clients
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR assigned_agent_id = auth.uid()
      OR public.is_ancestor_of(auth.uid(), assigned_agent_id)
    )
  )
)
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

CREATE POLICY "clients_delete_admin_only" ON public.clients
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
  )
);

-- =====================================================================
-- RECRUITS
-- =====================================================================
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.recruits;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on recruits" ON public.recruits;

CREATE POLICY "recruits_select_org_scoped" ON public.recruits
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR assigned_agent_id = auth.uid()
      OR public.is_ancestor_of(auth.uid(), assigned_agent_id)
    )
  )
);

CREATE POLICY "recruits_insert_org_scoped" ON public.recruits
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

CREATE POLICY "recruits_update_org_scoped" ON public.recruits
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR assigned_agent_id = auth.uid()
      OR public.is_ancestor_of(auth.uid(), assigned_agent_id)
    )
  )
)
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

CREATE POLICY "recruits_delete_admin_only" ON public.recruits
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
  )
);

-- =====================================================================
-- CONTACT_NOTES (now has organization_id from migration 004)
-- =====================================================================
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.contact_notes;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on contact_notes" ON public.contact_notes;
DROP POLICY IF EXISTS "contact_notes_select_authenticated" ON public.contact_notes;
DROP POLICY IF EXISTS "contact_notes_insert_authenticated" ON public.contact_notes;
DROP POLICY IF EXISTS "contact_notes_update_own" ON public.contact_notes;
DROP POLICY IF EXISTS "contact_notes_delete_own" ON public.contact_notes;

CREATE POLICY "contact_notes_select_org_scoped" ON public.contact_notes
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
  OR organization_id IS NULL
);

CREATE POLICY "contact_notes_insert_org_scoped" ON public.contact_notes
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

CREATE POLICY "contact_notes_update_org_scoped" ON public.contact_notes
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (author_id = auth.uid() OR public.get_user_role() = 'Admin')
  )
);

CREATE POLICY "contact_notes_delete_org_scoped" ON public.contact_notes
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (author_id = auth.uid() OR public.get_user_role() = 'Admin')
  )
);

-- =====================================================================
-- CONTACT_ACTIVITIES (now has organization_id from migration 004)
-- =====================================================================
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.contact_activities;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on contact_activities" ON public.contact_activities;
DROP POLICY IF EXISTS "contact_activities_select_authenticated" ON public.contact_activities;
DROP POLICY IF EXISTS "contact_activities_insert_authenticated" ON public.contact_activities;

CREATE POLICY "contact_activities_select_org_scoped" ON public.contact_activities
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
  OR organization_id IS NULL
);

CREATE POLICY "contact_activities_insert_org_scoped" ON public.contact_activities
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
