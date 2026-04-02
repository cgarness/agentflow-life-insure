-- Migration: Hardened RLS policies overriding standard data leaks
-- Date: 2026-04-02

---------------------------------------
-- 1. Leads Table Lock-down
---------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Wipe existing loose policies
DROP POLICY IF EXISTS "Users can view leads in their organization" ON public.leads;
DROP POLICY IF EXISTS "Leads Isolation" ON public.leads;
DROP POLICY IF EXISTS "Multi-tenant isolation" ON public.leads;
DROP POLICY IF EXISTS "Leads JWT Isolation" ON public.leads;

-- Admin/TLs can map across their Organization.
-- Agents can strictly map only to what they own.
CREATE POLICY "Leads JWT Isolation" ON public.leads
FOR ALL 
TO authenticated 
USING (
  user_id = auth.uid() 
  OR 
  (public.get_user_role() IN ('Admin', 'Team Leader', 'Super Admin') AND organization_id = public.get_org_id())
)
WITH CHECK (
  user_id = auth.uid() 
  OR 
  (public.get_user_role() IN ('Admin', 'Team Leader', 'Super Admin') AND organization_id = public.get_org_id())
);

---------------------------------------
-- 2. Clients Table Lock-down
---------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Clients JWT Isolation" ON public.clients;

CREATE POLICY "Clients JWT Isolation" ON public.clients
FOR ALL 
TO authenticated 
USING (
  user_id = auth.uid() 
  OR 
  (public.get_user_role() IN ('Admin', 'Team Leader', 'Super Admin') AND organization_id = public.get_org_id())
)
WITH CHECK (
  user_id = auth.uid() 
  OR 
  (public.get_user_role() IN ('Admin', 'Team Leader', 'Super Admin') AND organization_id = public.get_org_id())
);

---------------------------------------
-- 3. Call Logs Lock-down
---------------------------------------
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Note: In the previous step, we generated simple policies for call_logs isolating down to auth.uid(). 
-- Overwriting them now to include the requested Team Leader functionality.
DROP POLICY IF EXISTS "Agents can view their own call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Agents can insert their own call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Call Logs JWT Isolation" ON public.call_logs;

-- NOTE: `call_logs` does not inherently possess an `organization_id` column currently (schema only contained `lead_id` and `user_id`).
-- If we want TLs to see all call logs for their organization, we need to add `organization_id` to `call_logs`.
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

CREATE POLICY "Call Logs JWT Isolation" ON public.call_logs
FOR ALL 
TO authenticated 
USING (
  user_id = auth.uid() 
  OR 
  (public.get_user_role() IN ('Admin', 'Team Leader', 'Super Admin') AND organization_id = public.get_org_id())
)
WITH CHECK (
  user_id = auth.uid() 
  OR 
  (public.get_user_role() IN ('Admin', 'Team Leader', 'Super Admin') AND organization_id = public.get_org_id())
);
