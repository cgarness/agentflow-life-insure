-- =============================================================
-- Super-admin: scoped to home org everywhere except Agencies console.
-- Platform owner uses day-to-day app with JWT organization_id only.
-- Agencies (/super-admin) uses SECURITY DEFINER RPCs for cross-org reads
-- plus organizations SELECT/UPDATE bypass for listings and status actions.
--
-- Adds:
--   * public.super_admin_own_org(uuid) — RLS helper
--   * public.super_admin_dashboard_snapshot() → jsonb
--   * public.super_admin_organization_detail(uuid) → jsonb
--   * public.super_admin_update_organization_status(uuid, text)
--   * organizations_update_super_admin (RLS UPDATE for any org row)
--
-- Narrows unconditional is_super_admin() on tenant rows to match get_org_id().
-- =============================================================

-- ── 1. Helper — super admin treats only JWT home org rows like full admin -----
CREATE OR REPLACE FUNCTION public.super_admin_own_org(row_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN row_org IS NULL THEN false
    WHEN NOT public.is_super_admin() THEN false
    WHEN public.get_org_id() IS NULL THEN false
    ELSE row_org = public.get_org_id()
  END;
$$;

COMMENT ON FUNCTION public.super_admin_own_org(uuid) IS
  'True when JWT super admin''s organization_id equals the row org (tenant scope).';

-- ── 2. Agencies dashboard (cross-org aggregates; super admin only) -----------
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
            'lead_count', sq.lead_count
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
            (SELECT count(*)::int FROM public.leads l WHERE l.organization_id = o.id) AS lead_count
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

-- ── 3. Agency workspace detail -------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_organization_detail(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org json;
  v_company text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN NULL::jsonb;
  END IF;

  SELECT row_to_json(o)::json INTO v_org
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF v_org IS NULL THEN
    RETURN NULL::jsonb;
  END IF;

  SELECT trim(cs.company_name) INTO v_company
  FROM public.company_settings cs
  WHERE cs.organization_id = p_organization_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'organization', to_jsonb(v_org),
    'agency_display_name', COALESCE(NULLIF(v_company, ''), v_org ->> 'name'),
    'stats', jsonb_build_object(
      'total_users',
        (SELECT count(*) FROM public.profiles p WHERE p.organization_id = p_organization_id),
      'total_leads',
        (SELECT count(*) FROM public.leads l WHERE l.organization_id = p_organization_id),
      'total_clients',
        (SELECT count(*) FROM public.clients c WHERE c.organization_id = p_organization_id),
      'total_campaigns',
        (SELECT count(*) FROM public.campaigns c WHERE c.organization_id = p_organization_id),
      'total_calls',
        (SELECT count(*) FROM public.calls c WHERE c.organization_id = p_organization_id),
      'total_appointments',
        (SELECT count(*) FROM public.appointments a WHERE a.organization_id = p_organization_id)
    ),
    'profiles',
      COALESCE(
        (
          SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC NULLS LAST)
          FROM (
            SELECT *
            FROM public.profiles pr
            WHERE pr.organization_id = p_organization_id
            ORDER BY pr.created_at DESC
            LIMIT 5000
          ) p
        ),
        '[]'::jsonb
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_organization_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_organization_detail(uuid) TO authenticated;

-- ── 4. Suspend / reactivate / archive from Agencies UI ------------------------
CREATE OR REPLACE FUNCTION public.super_admin_update_organization_status(
  p_organization_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Missing organization id' USING ERRCODE = '23502';
  END IF;
  IF p_status IS NULL OR lower(p_status) NOT IN ('active', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.organizations
  SET status = lower(p_status)
  WHERE id = p_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_update_organization_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_update_organization_status(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.super_admin_update_organization_status(uuid, text) IS
  'Super admin only — update organizations.status across tenants (Agencies UI).';

-- ── 5. Organizations: platform UPDATE (suspend/archive any agency) -------------
DROP POLICY IF EXISTS organizations_update_super_admin ON public.organizations;

CREATE POLICY organizations_update_super_admin
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ── 6. Tenant RLS — super admin gated to JWT home organization ----------------

-- Profiles (hierarchical; drop only policies we redefine)
DROP POLICY IF EXISTS profiles_select_hierarchical ON public.profiles;
DROP POLICY IF EXISTS profiles_update_hierarchical ON public.profiles;

CREATE POLICY profiles_select_hierarchical ON public.profiles FOR SELECT TO authenticated USING (
  (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR (
        public.get_user_role() = 'Team Leader'
        AND (
          id = auth.uid()
          OR public.is_ancestor_of(auth.uid(), id)
        )
      )
      OR (public.get_user_role() = 'Agent' AND id = auth.uid())
    )
  )
);

CREATE POLICY profiles_update_hierarchical ON public.profiles FOR UPDATE TO authenticated
USING (
  (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR (
        public.get_user_role() = 'Team Leader'
        AND (
          id = auth.uid()
          OR public.is_ancestor_of(auth.uid(), id)
        )
      )
      OR (public.get_user_role() = 'Agent' AND id = auth.uid())
    )
  )
)
WITH CHECK (
  (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR (
        public.get_user_role() = 'Team Leader'
        AND (
          id = auth.uid()
          OR public.is_ancestor_of(auth.uid(), id)
        )
      )
      OR (public.get_user_role() = 'Agent' AND id = auth.uid())
    )
  )
);

-- Leads / clients / recruits
DROP POLICY IF EXISTS "Leads Hierarchical Access" ON public.leads;
DROP POLICY IF EXISTS "Clients Hierarchical Access" ON public.clients;
DROP POLICY IF EXISTS "Recruits Hierarchical Access" ON public.recruits;

CREATE POLICY "Leads Hierarchical Access" ON public.leads FOR ALL TO authenticated
USING (
  (user_id = auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    public.get_user_role() = 'Admin'
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), user_id)
  )
)
WITH CHECK (
  (user_id = auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    public.get_user_role() = 'Admin'
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), user_id)
  )
);

CREATE POLICY "Clients Hierarchical Access" ON public.clients FOR ALL TO authenticated
USING (
  (assigned_agent_id = auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    public.get_user_role() = 'Admin'
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
)
WITH CHECK (
  (assigned_agent_id = auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    public.get_user_role() = 'Admin'
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
);

CREATE POLICY "Recruits Hierarchical Access" ON public.recruits FOR ALL TO authenticated
USING (
  (assigned_agent_id = auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    public.get_user_role() = 'Admin'
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
)
WITH CHECK (
  (assigned_agent_id = auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    public.get_user_role() = 'Admin'
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
);

-- Campaigns / campaign_leads
DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
DROP POLICY IF EXISTS campaigns_insert ON public.campaigns;
DROP POLICY IF EXISTS campaigns_update ON public.campaigns;
DROP POLICY IF EXISTS campaigns_delete ON public.campaigns;
DROP POLICY IF EXISTS campaign_leads_select ON public.campaign_leads;
DROP POLICY IF EXISTS campaign_leads_insert ON public.campaign_leads;
DROP POLICY IF EXISTS campaign_leads_update ON public.campaign_leads;
DROP POLICY IF EXISTS campaign_leads_delete ON public.campaign_leads;

CREATE POLICY campaigns_select ON public.campaigns FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR user_id = auth.uid()
      OR (
        auth.uid()
      )::text = ANY (
        ARRAY (
          SELECT jsonb_array_elements_text(campaigns.assigned_agent_ids)
        )
      )
    )
  )
);

CREATE POLICY campaigns_update ON public.campaigns FOR UPDATE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR user_id = auth.uid()
    )
  )
)
WITH CHECK (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR user_id = auth.uid()
    )
  )
);

CREATE POLICY campaigns_delete ON public.campaigns FOR DELETE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR user_id = auth.uid()
    )
  )
);

CREATE POLICY campaigns_insert ON public.campaigns FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.get_org_id()
  AND user_id = auth.uid()
);

CREATE POLICY campaign_leads_select ON public.campaign_leads FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR (
        public.get_user_role() = 'Agent'::text
        AND (
          EXISTS (
            SELECT 1
            FROM public.campaigns c
            WHERE c.id = campaign_leads.campaign_id
              AND c.type = ANY (ARRAY['Team'::text, 'Open'::text, 'Open Pool'::text])
              AND c.organization_id = public.get_org_id()
          )
          OR (
            EXISTS (
              SELECT 1
              FROM public.campaigns c
              WHERE c.id = campaign_leads.campaign_id
                AND c.type = 'Personal'::text
                AND c.organization_id = public.get_org_id()
            )
            AND (
              campaign_leads.claimed_by = auth.uid()
              OR campaign_leads.user_id = auth.uid()
            )
          )
        )
      )
    )
  )
);

CREATE POLICY campaign_leads_update ON public.campaign_leads FOR UPDATE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR organization_id = public.get_org_id()
);

CREATE POLICY campaign_leads_delete ON public.campaign_leads FOR DELETE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR organization_id = public.get_org_id()
);

CREATE POLICY campaign_leads_insert ON public.campaign_leads FOR INSERT TO authenticated
WITH CHECK (organization_id = public.get_org_id());

-- Calls
DROP POLICY IF EXISTS "Calls Hierarchical Access" ON public.calls;

CREATE POLICY "Calls Hierarchical Access" ON public.calls FOR ALL TO authenticated
USING (
  (agent_id = auth.uid())
  OR public.super_admin_own_org(organization_id)
  OR (
    public.get_user_role() = 'Admin'::text
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = ANY (
      ARRAY['Team Leader'::text, 'Team Lead'::text]
    )
    AND organization_id = public.get_org_id()
    AND agent_id IS NOT NULL
    AND public.is_ancestor_of(auth.uid(), agent_id)
  )
  OR (
    public.get_org_id() IS NOT NULL
    AND organization_id = public.get_org_id()
    AND direction = 'inbound'::text
    AND agent_id IS NULL
  )
)
WITH CHECK (
  (agent_id = auth.uid())
  OR public.super_admin_own_org(organization_id)
  OR (
    public.get_user_role() = 'Admin'::text
    AND organization_id = public.get_org_id()
  )
  OR (
    public.get_user_role() = ANY (
      ARRAY['Team Leader'::text, 'Team Lead'::text]
    )
    AND organization_id = public.get_org_id()
    AND agent_id IS NOT NULL
    AND public.is_ancestor_of(auth.uid(), agent_id)
  )
);

-- Appointments
DROP POLICY IF EXISTS "Hierarchical Appointments Access" ON public.appointments;

CREATE POLICY "Hierarchical Appointments Access" ON public.appointments
FOR ALL
TO authenticated
USING (
  (user_id = auth.uid())
  OR (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'Team Leader'::text
        AND p.team_id IS NOT NULL
        AND appointments.user_id IN (
          SELECT id FROM public.profiles WHERE team_id = p.team_id
        )
    )
  )
  OR (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'Admin'::text
        AND p.organization_id = appointments.organization_id
    )
  )
  OR (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_super_admin = true
        AND p.organization_id = appointments.organization_id
    )
  )
)
WITH CHECK (
  (user_id = auth.uid())
  OR (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('Admin'::text, 'Team Leader'::text)
          OR (
            p.is_super_admin = true
            AND p.organization_id = appointments.organization_id
          )
        )
        AND p.organization_id = appointments.organization_id
    )
  )
);

-- Company settings (drop all variants from migration drift)
DROP POLICY IF EXISTS company_settings_insert ON public.company_settings;
DROP POLICY IF EXISTS company_settings_update ON public.company_settings;
DROP POLICY IF EXISTS company_settings_team_leader_update ON public.company_settings;
DROP POLICY IF EXISTS company_settings_select ON public.company_settings;
DROP POLICY IF EXISTS company_settings_write ON public.company_settings;

CREATE POLICY company_settings_select ON public.company_settings FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR organization_id = public.get_org_id()
);

CREATE POLICY company_settings_write ON public.company_settings FOR ALL TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'::text
  )
)
WITH CHECK (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'::text
  )
);

CREATE POLICY company_settings_team_leader_update ON public.company_settings FOR UPDATE TO authenticated
USING (
  organization_id = public.get_org_id()
  AND public.get_user_role() IN ('Team Leader'::text, 'Team Lead'::text)
)
WITH CHECK (
  organization_id = public.get_org_id()
  AND public.get_user_role() IN ('Team Leader'::text, 'Team Lead'::text)
);

-- Custom fields (org-scoped definitions)
DROP POLICY IF EXISTS custom_fields_select ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_insert ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_update ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_delete ON public.custom_fields;

CREATE POLICY custom_fields_select ON public.custom_fields FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id IS NOT NULL
    AND organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR created_by IS NULL
      OR created_by = auth.uid()
    )
  )
);

CREATE POLICY custom_fields_insert ON public.custom_fields FOR INSERT TO authenticated
WITH CHECK (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id IS NOT NULL
    AND organization_id = public.get_org_id()
    AND (
      created_by = auth.uid()
      OR (
        created_by IS NULL
        AND public.get_user_role() = ANY (
          ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
        )
      )
    )
  )
);

CREATE POLICY custom_fields_update ON public.custom_fields FOR UPDATE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id IS NOT NULL
    AND organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR created_by = auth.uid()
    )
  )
)
WITH CHECK (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id IS NOT NULL
    AND organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR created_by = auth.uid()
    )
  )
);

CREATE POLICY custom_fields_delete ON public.custom_fields FOR DELETE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id IS NOT NULL
    AND organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR created_by = auth.uid()
    )
  )
);

-- Contact notes / activities — drop legacy + org-scoped, then recreate org-scoped only
DROP POLICY IF EXISTS contact_notes_delete ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_insert ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_select ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_update ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_select_org_scoped ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_insert_org_scoped ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_update_org_scoped ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_delete_org_scoped ON public.contact_notes;
DROP POLICY IF EXISTS contact_activities_insert ON public.contact_activities;
DROP POLICY IF EXISTS contact_activities_select ON public.contact_activities;
DROP POLICY IF EXISTS contact_activities_select_org_scoped ON public.contact_activities;
DROP POLICY IF EXISTS contact_activities_insert_org_scoped ON public.contact_activities;

CREATE POLICY contact_notes_select_org_scoped ON public.contact_notes FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR organization_id = public.get_org_id()
  OR organization_id IS NULL
);

CREATE POLICY contact_notes_insert_org_scoped ON public.contact_notes FOR INSERT TO authenticated
WITH CHECK (
  public.super_admin_own_org(organization_id)
  OR organization_id = public.get_org_id()
);

CREATE POLICY contact_notes_update_org_scoped ON public.contact_notes FOR UPDATE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      author_id = auth.uid()
      OR public.get_user_role() = 'Admin'::text
    )
  )
);

CREATE POLICY contact_notes_delete_org_scoped ON public.contact_notes FOR DELETE TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      author_id = auth.uid()
      OR public.get_user_role() = 'Admin'::text
    )
  )
);

CREATE POLICY contact_activities_select_org_scoped ON public.contact_activities FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR organization_id = public.get_org_id()
  OR organization_id IS NULL
);

CREATE POLICY contact_activities_insert_org_scoped ON public.contact_activities FOR INSERT TO authenticated
WITH CHECK (
  public.super_admin_own_org(organization_id)
  OR organization_id = public.get_org_id()
);

-- Contact emails / email sync / user_email_connections
DROP POLICY IF EXISTS contact_emails_select ON public.contact_emails;
DROP POLICY IF EXISTS email_sync_cursors_select ON public.email_sync_cursors;
DROP POLICY IF EXISTS user_email_connections_select ON public.user_email_connections;

CREATE POLICY contact_emails_select ON public.contact_emails FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (ARRAY['Admin'::text, 'Super Admin'::text])
      OR owner_user_id = auth.uid()
      OR (
        public.get_user_role() = ANY (
          ARRAY['Team Leader'::text, 'Team Lead'::text]
        )
        AND public.is_ancestor_of(auth.uid(), owner_user_id)
      )
    )
  )
);

CREATE POLICY email_sync_cursors_select ON public.email_sync_cursors FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_email_connections c
      WHERE c.id = email_sync_cursors.connection_id
        AND c.organization_id = public.get_org_id()
        AND (
          c.user_id = auth.uid()
          OR public.get_user_role() = ANY (
            ARRAY['Admin'::text, 'Super Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
          )
        )
    )
  )
);

CREATE POLICY user_email_connections_select ON public.user_email_connections FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Super Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
    )
  )
);

-- Invitations
DROP POLICY IF EXISTS invitations_org_admin_manage ON public.invitations;
DROP POLICY IF EXISTS invitations_insert ON public.invitations;
DROP POLICY IF EXISTS invitations_select ON public.invitations;

CREATE POLICY invitations_org_admin_manage ON public.invitations FOR ALL TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = (
      SELECT profiles.organization_id
      FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
    AND (
      SELECT profiles.role
      FROM public.profiles
      WHERE profiles.id = auth.uid()
    ) = ANY (
      ARRAY['Admin'::text, 'Team Leader'::text]
    )
  )
)
WITH CHECK (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = (
      SELECT profiles.organization_id
      FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
    AND (
      SELECT profiles.role
      FROM public.profiles
      WHERE profiles.id = auth.uid()
    ) = ANY (
      ARRAY['Admin'::text, 'Team Leader'::text]
    )
  )
);

CREATE POLICY invitations_insert ON public.invitations FOR INSERT TO authenticated
WITH CHECK (
  (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = ANY (
      ARRAY['Admin'::text, 'Super Admin'::text]
    )
  )
);

CREATE POLICY invitations_select ON public.invitations FOR SELECT TO authenticated
USING (
  (
    organization_id IS NOT NULL
    AND public.super_admin_own_org(organization_id)
  )
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = ANY (
      ARRAY['Admin'::text, 'Super Admin'::text]
    )
  )
);

-- Lead sources (profiles.is_super_admin must not widen past row org)
DROP POLICY IF EXISTS "Admins can manage their organization's lead sources" ON public.lead_sources;
DROP POLICY IF EXISTS "Users can view their organization's lead sources" ON public.lead_sources;

CREATE POLICY "Admins can manage their organization's lead sources" ON public.lead_sources FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.id = auth.uid()
      AND pr.organization_id = lead_sources.organization_id
      AND (
        lower(pr.role) = ANY (
          ARRAY[
            'admin'::text,
            'super admin'::text,
            'superadmin'::text,
            'team leader'::text,
            'team lead'::text
          ]
        )
        OR (
          pr.is_super_admin IS TRUE
          AND pr.organization_id = lead_sources.organization_id
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.id = auth.uid()
      AND pr.organization_id = lead_sources.organization_id
      AND (
        lower(pr.role) = ANY (
          ARRAY[
            'admin'::text,
            'super admin'::text,
            'superadmin'::text,
            'team leader'::text,
            'team lead'::text
          ]
        )
        OR (
          pr.is_super_admin IS TRUE
          AND pr.organization_id = lead_sources.organization_id
        )
      )
  )
);

CREATE POLICY "Users can view their organization's lead sources" ON public.lead_sources FOR SELECT TO authenticated
USING (
  organization_id IS NULL
  OR EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.id = auth.uid()
      AND pr.organization_id = lead_sources.organization_id
  )
);

NOTIFY pgrst, 'reload schema';
