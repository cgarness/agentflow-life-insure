-- Allow authenticated users to read all profiles (needed for agent selection in campaigns)
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);