-- Fail-closed recovery, apply as a NEW approved migration in one transaction.
-- Disable only the display reader. Never restore unsafe claim bodies, client identity writes or
-- anonymous grants. Existing campaign-copy fallback and master/edit reads keep their old permissions.
REVOKE ALL ON FUNCTION public.get_team_dialer_lead_details(uuid) FROM PUBLIC, anon, authenticated, service_role;
