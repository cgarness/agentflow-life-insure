-- Build 5 — Contact Flow completion settings
-- 1) Add recruit required-fields + agency default field-order columns to contact_management_settings.
-- 2) Add custom_fields to recruits.
-- 3) Harden contact_management_settings RLS (helper-based; super_admin_own_org for SELECT; Admin/Super Admin write).

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_org_id') THEN
    RAISE EXCEPTION 'Missing helper public.get_org_id()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_user_role') THEN
    RAISE EXCEPTION 'Missing helper public.get_user_role()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_super_admin') THEN
    RAISE EXCEPTION 'Missing helper public.is_super_admin()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='super_admin_own_org') THEN
    RAISE EXCEPTION 'Missing helper public.super_admin_own_org()';
  END IF;
END
$pre$;

-- 1) contact_management_settings columns ----------------------------------
ALTER TABLE public.contact_management_settings
  ADD COLUMN IF NOT EXISTS required_fields_recruit jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.contact_management_settings
  ADD COLUMN IF NOT EXISTS field_order_lead    jsonb;
ALTER TABLE public.contact_management_settings
  ADD COLUMN IF NOT EXISTS field_order_client  jsonb;
ALTER TABLE public.contact_management_settings
  ADD COLUMN IF NOT EXISTS field_order_recruit jsonb;

-- Lightweight type checks (idempotent).
DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cms_required_fields_recruit_is_object') THEN
    ALTER TABLE public.contact_management_settings
      ADD CONSTRAINT cms_required_fields_recruit_is_object
      CHECK (jsonb_typeof(required_fields_recruit) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cms_field_order_lead_is_array') THEN
    ALTER TABLE public.contact_management_settings
      ADD CONSTRAINT cms_field_order_lead_is_array
      CHECK (field_order_lead IS NULL OR jsonb_typeof(field_order_lead) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cms_field_order_client_is_array') THEN
    ALTER TABLE public.contact_management_settings
      ADD CONSTRAINT cms_field_order_client_is_array
      CHECK (field_order_client IS NULL OR jsonb_typeof(field_order_client) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cms_field_order_recruit_is_array') THEN
    ALTER TABLE public.contact_management_settings
      ADD CONSTRAINT cms_field_order_recruit_is_array
      CHECK (field_order_recruit IS NULL OR jsonb_typeof(field_order_recruit) = 'array');
  END IF;
END
$checks$;

-- 2) recruits.custom_fields ------------------------------------------------
ALTER TABLE public.recruits
  ADD COLUMN IF NOT EXISTS custom_fields jsonb;

-- 3) RLS rewrite on contact_management_settings ----------------------------
ALTER TABLE public.contact_management_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cms_select ON public.contact_management_settings;
DROP POLICY IF EXISTS cms_insert ON public.contact_management_settings;
DROP POLICY IF EXISTS cms_update ON public.contact_management_settings;
DROP POLICY IF EXISTS cms_delete ON public.contact_management_settings;

CREATE POLICY cms_select ON public.contact_management_settings
  FOR SELECT TO authenticated
  USING (
    public.super_admin_own_org(organization_id)
    OR organization_id = public.get_org_id()
  );

CREATE POLICY cms_insert ON public.contact_management_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

CREATE POLICY cms_update ON public.contact_management_settings
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

-- No DELETE policy: settings rows are per-org permanent records.
