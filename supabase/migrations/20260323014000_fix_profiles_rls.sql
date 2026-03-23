
-- RLS Policies for Profiles table to support Admin and Team Leader management

-- Admins can read all profiles
CREATE POLICY "Admins can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- Admins can update all profiles
CREATE POLICY "Admins can update all profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- Team Leaders can read their own team members' profiles
CREATE POLICY "Team Leaders can read their team profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Team Leader'
    ) AND (
      upline_id = auth.uid() OR id = auth.uid()
    )
  );

-- Team Leaders can update their own team members' profiles
CREATE POLICY "Team Leaders can update their team profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Team Leader'
    ) AND (
      upline_id = auth.uid()
    )
  )
  WITH CHECK (
    upline_id = auth.uid()
  );

-- Note: The existing "Users can read/update own profile" policies remain in place.
