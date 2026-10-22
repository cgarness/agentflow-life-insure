-- Phase 2A policy commission tracking: disposable local harness (synthetic data only; never production).
-- Applied after scripts/policy_commission_fixture.py has restored the verbatim sale writers, sale identity and
-- commission grid schema, and BEFORE 20261019170000_policy_commission_tracking.sql.

-- Supabase's auth.uid(): PostgREST 12 sets only request.jwt.claims; the legacy claim GUC is kept for psql tests.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;

-- Supabase default privileges: every new public table, function and sequence created by postgres is granted to
-- all client roles. The migration must revoke these itself; this makes that proof meaningful.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Production helpers and policies used by contact reads (verbatim from the baseline schema).
CREATE OR REPLACE FUNCTION "public"."get_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$$;
CREATE OR REPLACE FUNCTION "public"."get_user_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$$;
CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'is_super_admin')::BOOLEAN,
    false
  );
$$;
CREATE OR REPLACE FUNCTION "public"."super_admin_own_org"("row_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN row_org IS NULL THEN false
    WHEN NOT public.is_super_admin() THEN false
    WHEN public.get_org_id() IS NULL THEN false
    ELSE row_org = public.get_org_id()
  END;
$$;
CREATE TABLE IF NOT EXISTS "public"."agency_group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agency_group_id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL
);
CREATE OR REPLACE FUNCTION "public"."is_agency_group_peer_organization"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agency_group_members m1
    INNER JOIN public.agency_group_members m2
      ON m1.agency_group_id = m2.agency_group_id
      AND m2.status = 'active'
    WHERE m1.organization_id = public.get_org_id()
      AND m1.status = 'active'
      AND m2.organization_id = p_org_id
  );
$$;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients Hierarchical Access" ON "public"."clients" TO "authenticated" USING ((("assigned_agent_id" = "auth"."uid"()) OR (("organization_id" IS NOT NULL) AND "public"."super_admin_own_org"("organization_id")) OR (("public"."get_user_role"() = 'Admin'::"text") AND ("organization_id" = "public"."get_org_id"())) OR (("public"."get_user_role"() = 'Team Leader'::"text") AND ("organization_id" = "public"."get_org_id"()) AND "public"."is_ancestor_of"("auth"."uid"(), "assigned_agent_id")))) WITH CHECK ((("assigned_agent_id" = "auth"."uid"()) OR (("organization_id" IS NOT NULL) AND "public"."super_admin_own_org"("organization_id")) OR (("public"."get_user_role"() = 'Admin'::"text") AND ("organization_id" = "public"."get_org_id"())) OR (("public"."get_user_role"() = 'Team Leader'::"text") AND ("organization_id" = "public"."get_org_id"()) AND "public"."is_ancestor_of"("auth"."uid"(), "assigned_agent_id"))));
CREATE POLICY "wins_select" ON "public"."wins" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."get_user_org_id"()) OR "public"."is_agency_group_peer_organization"("organization_id")));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients, public.wins TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(), public.get_user_org_id(), public.is_super_admin(),
  public.super_admin_own_org(uuid), public.is_agency_group_peer_organization(uuid), public.get_org_id(),
  public.is_ancestor_of(uuid, uuid) TO authenticated;

-- ── Synthetic agencies, people and a private comp grid ───────────────────────────────────────────────────
INSERT INTO organizations(id, name) VALUES
  (test_id(1), 'Synthetic Agency'), (test_id(2), 'Synthetic Other Agency'), (test_id(3), 'Synthetic Peer Agency');
INSERT INTO agency_group_members(agency_group_id, organization_id, status) VALUES
  (test_id(900), test_id(1), 'active'), (test_id(900), test_id(3), 'active');
INSERT INTO company_settings(organization_id, timezone) VALUES (test_id(1), 'America/Los_Angeles');
INSERT INTO profiles(id, organization_id, first_name, last_name, email, role, status, commission_level, is_super_admin, hierarchy_path) VALUES
  (test_id(11), test_id(1), 'Ava', 'Agent', 'ava@example.test', 'Agent', 'Active', '100', false, 'n14.n11'),
  (test_id(12), test_id(1), 'Ben', 'Agent', 'ben@example.test', 'Agent', 'Active', '90%', false, 'n12'),
  (test_id(13), test_id(1), 'Ada', 'Admin', 'ada@example.test', 'Admin', 'Active', '100', false, 'n13'),
  (test_id(14), test_id(1), 'Tia', 'Leader', 'tia@example.test', 'Team Leader', 'Active', '100', false, 'n14'),
  (test_id(15), test_id(1), 'Sam', 'Super', 'sam@example.test', 'Agent', 'Active', '100', true, 'n15'),
  (test_id(16), test_id(1), 'Ida', 'Inactive', 'ida@example.test', 'Agent', 'Inactive', '100', false, 'n14.n16'),
  (test_id(17), test_id(1), 'Cal', 'Malformed', 'cal@example.test', 'Agent', 'Active', 'abc', false, 'n14.n17'),
  (test_id(18), test_id(1), 'Dee', 'Offgrid', 'dee@example.test', 'Agent', 'Active', '95', false, 'n14.n18'),
  (test_id(21), test_id(2), 'Ola', 'Other', 'ola@example.test', 'Admin', 'Active', '100', false, 'n21'),
  (test_id(31), test_id(3), 'Pia', 'Peer', 'pia@example.test', 'Admin', 'Active', '100', false, 'n31');

INSERT INTO comp_grids(id, organization_id, name, effective_date, is_active, contract_levels, origin)
VALUES (test_id(500), test_id(1), 'Synthetic Agency Grid', '2026-01-01', true, '{100,90}', 'blank');
INSERT INTO comp_products(id, grid_id, organization_id, category, carrier, product_name, is_active) VALUES
  (test_id(501), test_id(500), test_id(1), 'term', 'Synthetic Life', 'Synthetic Term', true),
  (test_id(502), test_id(500), test_id(1), 'whole_life', 'Synthetic Life', 'Synthetic Final Expense', true),
  (test_id(503), test_id(500), test_id(1), 'iul', 'Synthetic Life', 'Synthetic Retired IUL', false),
  (test_id(504), test_id(500), test_id(1), 'term', 'Synthetic Life', 'Synthetic Twenty Term', true);
INSERT INTO comp_product_variants(id, grid_id, product_id, organization_id, label, min_age, max_age, term_years) VALUES
  (test_id(511), test_id(500), test_id(501), test_id(1), 'Ages 18-60', 18, 60, '{10,20,30}'),
  (test_id(512), test_id(500), test_id(502), test_id(1), 'Ages 40-85', 40, 85, NULL),
  (test_id(513), test_id(500), test_id(503), test_id(1), 'All ages', NULL, NULL, NULL),
  (test_id(514), test_id(500), test_id(504), test_id(1), 'Ages 18-60', 18, 60, '{20}');
INSERT INTO comp_rates(grid_id, variant_id, organization_id, contract_level, rate_percent) VALUES
  (test_id(500), test_id(511), test_id(1), 100, 95.50), (test_id(500), test_id(511), test_id(1), 90, 85.25),
  (test_id(500), test_id(512), test_id(1), 100, 120.00), (test_id(500), test_id(512), test_id(1), 90, 110),
  (test_id(500), test_id(513), test_id(1), 100, 100), (test_id(500), test_id(514), test_id(1), 100, 90);
INSERT INTO organization_comp_settings(organization_id, calculator_grid_id) VALUES (test_id(1), test_id(500));

-- ── Test helpers ──────────────────────────────────────────────────────────────────────────────────────────
-- Signs in as profile n (claims shaped like a Supabase access token) and switches to the client role.
CREATE FUNCTION public.pc_login(n integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = public.test_id(n);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p.id, 'role', 'authenticated',
    'is_super_admin', coalesce(p.is_super_admin, false),
    'app_metadata', jsonb_build_object('organization_id', p.organization_id, 'role', p.role))::text, false);
END $$;
CREATE FUNCTION public.pc_reject(p_sql text, p_code text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'FAIL: expected % from %', p_code, p_sql;
EXCEPTION
WHEN query_canceled THEN
  IF p_code <> '57014' THEN RAISE; END IF;
  RETURN SQLERRM;
WHEN OTHERS THEN
  IF SQLSTATE = 'P0001' AND SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  IF SQLSTATE <> p_code THEN RAISE EXCEPTION 'FAIL: expected % but got % (%) from %', p_code, SQLSTATE, SQLERRM, p_sql; END IF;
  RETURN SQLERRM;
END $$;
-- The commission payload the browser would send for one slot.
CREATE FUNCTION public.pc_slot(p_slot text, p_agent integer, p_product integer, p_variant integer, p_age integer,
  p_term integer, p_level integer, p_rate text, p_premium text, p_fy bigint, p_adv bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('slot', p_slot, 'credited_agent_id', public.test_id(p_agent), 'grid_id', public.test_id(500),
    'grid_revision', (SELECT revision FROM public.comp_grids WHERE id = public.test_id(500)),
    'product_id', public.test_id(p_product), 'variant_id', public.test_id(p_variant), 'insured_age', p_age,
    'term_years', p_term, 'contract_level', p_level, 'rate_percent', p_rate, 'monthly_premium', p_premium,
    'first_year_cents', p_fy, 'advance_cents', p_adv)
$$;
CREATE FUNCTION public.pc_payload(VARIADIC p_slots jsonb[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('v', 'policy-commission-v1', 'slots', coalesce(to_jsonb(p_slots), '[]'::jsonb))
$$;
CREATE FUNCTION public.pc_payload() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"v": "policy-commission-v1", "slots": []}'::jsonb
$$;
CREATE FUNCTION public.pc_contact(p_first text, p_agent integer) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('first_name', p_first, 'last_name', 'Synthetic', 'phone', '5555550100', 'email', '',
    'assigned_agent_id', public.test_id(p_agent))
$$;
CREATE FUNCTION public.pc_client(p_first text, p_agent integer, p_premium text, p_type text DEFAULT 'Term',
  p_carrier text DEFAULT 'Synthetic Life') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('first_name', p_first, 'last_name', 'Synthetic', 'phone', '5555550100', 'email', '',
    'policy_type', p_type, 'carrier', p_carrier, 'policy_number', 'SYN-' || p_first, 'premium', p_premium::numeric,
    'face_amount', 100000, 'sold_date', '2026-10-01', 'effective_date', '2026-11-01',
    'assigned_agent_id', public.test_id(p_agent))
$$;
GRANT EXECUTE ON FUNCTION public.pc_slot(text, integer, integer, integer, integer, integer, integer, text, text, bigint, bigint),
  public.pc_payload(jsonb[]), public.pc_payload(), public.pc_contact(text, integer), public.pc_client(text, integer, text, text, text), public.test_id(integer) TO authenticated;
