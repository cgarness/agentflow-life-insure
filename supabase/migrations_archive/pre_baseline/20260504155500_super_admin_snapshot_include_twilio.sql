-- =============================================================
-- Super-admin: Include Twilio provisioning in dashboard snapshot.
-- Redefines public.super_admin_dashboard_snapshot() to return
-- Twilio-related columns for each organization.
-- =============================================================

CREATE OR REPLACE FUNCTION public.super_admin_dashboard_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'organizations',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', sq.id,
            'name', sq.name,
            'slug', sq.slug,
            'logo_url', sq.logo_url,
            'created_at', sq.created_at,
            'status', COALESCE(sq.status::text, 'active'),
            'display_name', sq.display_name,
            'user_count', sq.user_count,
            'lead_count', sq.lead_count,
            'twilio_subaccount_sid', sq.twilio_subaccount_sid,
            'twilio_subaccount_status', sq.twilio_subaccount_status,
            'twilio_provisioned_at', sq.twilio_provisioned_at
          )
          ORDER BY sq.created_at DESC NULLS LAST
        )
        FROM (
          SELECT
            o.id,
            o.name,
            o.slug,
            o.logo_url,
            o.created_at,
            o.status,
            COALESCE(NULLIF(trim(cs.company_name), ''), NULLIF(trim(o.name::text), ''), 'Agency') AS display_name,
            (SELECT count(*)::int FROM public.profiles p WHERE p.organization_id = o.id) AS user_count,
            (SELECT count(*)::int FROM public.leads l WHERE l.organization_id = o.id) AS lead_count,
            o.twilio_subaccount_sid,
            o.twilio_subaccount_status,
            o.twilio_provisioned_at
          FROM public.organizations o
          LEFT JOIN public.company_settings cs ON cs.organization_id = o.id
        ) sq
      ),
      '[]'::jsonb
    ),
    'total_users', (SELECT count(*)::int FROM public.profiles),
    'total_leads', (SELECT count(*)::int FROM public.leads),
    'active_calls', (
      SELECT count(*)::int
      FROM public.calls c
      WHERE c.status = 'in-progress'
    )
  )
  INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_dashboard_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_dashboard_snapshot() TO authenticated;
