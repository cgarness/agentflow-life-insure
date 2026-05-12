-- HOTFIX: Drop legacy permissive RLS policies that expose settings tables across all orgs
-- Audit finding: phone_settings, inbound_routing_settings, and contact_management_settings
-- had policies with qual: true or auth.role() = 'authenticated', allowing cross-org data access.

-- 1. phone_settings: drop the wide-open legacy policy (3 scoped policies remain)
DROP POLICY IF EXISTS "Authenticated users can manage phone settings" ON public.phone_settings;

-- 2. inbound_routing_settings: drop the wide-open legacy policy (3 scoped policies remain)
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.inbound_routing_settings;

-- 3. contact_management_settings: drop both broken policies (qual: true)
DROP POLICY IF EXISTS "Admins can update their organization's settings" ON public.contact_management_settings;
DROP POLICY IF EXISTS "Users can view their organization's settings" ON public.contact_management_settings;

-- 3b. contact_management_settings: create properly scoped replacements
CREATE POLICY "cms_select" ON public.contact_management_settings
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "cms_insert" ON public.contact_management_settings
  FOR INSERT WITH CHECK (organization_id = get_user_org_id() AND get_user_role() = 'Admin');

CREATE POLICY "cms_update" ON public.contact_management_settings
  FOR UPDATE USING (organization_id = get_user_org_id() AND get_user_role() = 'Admin');
