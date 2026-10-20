-- Commissions center: disposable harness additions (synthetic data only; never production). Applied after the
-- Phase 2A harness and both applied migrations, before 20261020180000_policy_commission_center_reads.sql.
-- company_settings with the production read policy (baseline schema, verbatim), so the agency time zone is read
-- under the caller's own RLS exactly as in production.
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_settings_select" ON "public"."company_settings" FOR SELECT TO "authenticated" USING (("public"."super_admin_own_org"("organization_id") OR ("organization_id" = "public"."get_org_id"())));
GRANT SELECT ON public.company_settings TO authenticated;
INSERT INTO public.company_settings(organization_id, timezone) VALUES (public.test_id(2), 'America/New_York'), (public.test_id(3), 'America/Chicago')
  ON CONFLICT (organization_id) DO NOTHING;
