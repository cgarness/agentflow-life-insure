
-- Update profiles RLS to be more resilient and handle case-insensitive roles
-- This ensures that 'Admin' and 'admin' are treated equally for security policies

-- 1. Admins can read all profiles
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND LOWER(role) = 'admin'
    )
  );

-- 2. Admins can update all profiles
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND LOWER(role) = 'admin'
    )
  );

-- 3. Team Leaders can read their own team members' profiles
DROP POLICY IF EXISTS "Team Leaders can read their team profiles" ON public.profiles;
CREATE POLICY "Team Leaders can read their team profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND LOWER(role) = 'team leader'
    ) AND (
      upline_id = auth.uid() OR id = auth.uid()
    )
  );

-- 4. Team Leaders can update their own team members' profiles
DROP POLICY IF EXISTS "Team Leaders can update their team profiles" ON public.profiles;
CREATE POLICY "Team Leaders can update their team profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND LOWER(role) = 'team leader'
    ) AND (
      upline_id = auth.uid()
    )
  )
  WITH CHECK (
    upline_id = auth.uid()
  );

-- Note: The existing "Users can read/update own profile" policies remain in place.
