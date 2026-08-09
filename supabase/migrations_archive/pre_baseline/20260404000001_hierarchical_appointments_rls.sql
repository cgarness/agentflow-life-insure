-- Set up Strict 3-Tier Hierarchical RLS for Appointments
-- Tier 1: Agent (Own Only)
-- Tier 2: Team Leader (Same Team)
-- Tier 3: Admin (Same Org)

-- First, drop the excessively strict owner-only policy
DROP POLICY IF EXISTS "Strict Owner Appointments" ON public.appointments;

-- Create the new Hierarchical Policy
CREATE POLICY "Hierarchical Appointments Access" ON public.appointments
FOR ALL 
TO authenticated 
USING (
  -- 1. Direct Ownership (Always allowed)
  (user_id = auth.uid())
  OR
  -- 2. Team Leader Scope (Can see their team's appointments)
  (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.role = 'Team Leader'
      AND p.team_id IS NOT NULL
      AND appointments.user_id IN (
        SELECT id FROM public.profiles WHERE team_id = p.team_id
      )
    )
  )
  OR
  -- 3. Admin Scope (Can see agency-wide appointments)
  (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.role = 'Admin'
      AND p.organization_id = appointments.organization_id
    )
  )
  OR
  -- 4. Super Admin Emergency Access
  (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.is_super_admin = true
    )
  )
)
WITH CHECK (
  -- Validation logic for insertions and updates
  (user_id = auth.uid())
  OR
  -- Admins and Team Leaders can assign appointments correctly
  (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND (p.role = 'Admin' OR p.role = 'Team Leader' OR p.is_super_admin = true)
      AND p.organization_id = appointments.organization_id
    )
  )
);

-- Ensure index exists for performance on RLS checks
CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON public.appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_organization_id ON public.appointments(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_team_id ON public.profiles(team_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
