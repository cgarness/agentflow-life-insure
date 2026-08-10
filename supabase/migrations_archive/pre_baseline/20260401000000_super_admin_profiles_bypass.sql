-- =============================================================
-- Migration: Super Admin Profiles Bypass
-- Purpose: Grant Super Admins full visibility and update access
--          to the public.profiles table via JWT custom claims.
-- =============================================================

-- 1. Ensure RLS is enabled on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing restrictive read policies if they exist (to normalize)
DROP POLICY IF EXISTS "Users can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;

-- 3. Standardized SELECT Policy: 
--    - Super Admin sees everyone
--    - Everyone else sees everyone (required for agent selection/mentions)
--    - OR: Restrict if you prefer harder multi-tenancy. For now, we align with the 
--      user's request to see all 4 users they know exist.
CREATE POLICY "profiles_select_global" ON public.profiles
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR true -- Allow global reads for now to match current app behavior
);

-- 4. Standardized UPDATE Policy:
--    - User can update their own profile
--    - Super Admin can update ANY profile
CREATE POLICY "profiles_update_super_admin" ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR auth.uid() = id
)
WITH CHECK (
  public.is_super_admin()
  OR auth.uid() = id
);

-- 5. Standardized INSERT Policy (usually handled by auth trigger, but for safety):
CREATE POLICY "profiles_insert_super_admin" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
);

-- 6. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
