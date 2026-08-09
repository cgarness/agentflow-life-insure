-- TV leaderboard: optional org-wide ticker override + Team Leader may update settings
-- (Admins retain existing company_settings_write; this adds TL UPDATE for same table.)

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS leaderboard_tv_banner_text text NULL;

COMMENT ON COLUMN public.company_settings.leaderboard_tv_banner_text IS
  'Optional scrolling TV ticker text for leaderboard display. NULL/empty = auto-generate from recent wins.';

-- Team Leaders (and legacy Team Lead role) may UPDATE their org row (e.g. banner text).
CREATE POLICY "company_settings_team_leader_update" ON public.company_settings
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND public.get_user_role() IN ('Team Leader', 'Team Lead')
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND public.get_user_role() IN ('Team Leader', 'Team Lead')
  );

NOTIFY pgrst, 'reload schema';
