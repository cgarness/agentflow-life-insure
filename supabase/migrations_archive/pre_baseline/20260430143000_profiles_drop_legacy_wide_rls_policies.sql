-- Drop legacy permissive profiles policies from 20260323014000_fix_profiles_rls.sql.
-- They OR with profiles_select_hierarchical / profiles_update_hierarchical (20260401000100)
-- and allow any Admin / Team Leader to read or update profiles across all organizations.

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Team Leaders can read their team profiles" ON public.profiles;
DROP POLICY IF EXISTS "Team Leaders can update their team profiles" ON public.profiles;

NOTIFY pgrst, 'reload schema';
