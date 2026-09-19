-- =====================================================================================================
-- Harness for the custom-field logical-name guard suite.
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28).
-- =====================================================================================================
-- Creates the minimum schema the guard migration and its suite need: `public.custom_fields` with the
-- SAME column set, CHECK constraint and TWO PARTIAL UNIQUE INDEXES as production
-- (supabase/migrations/20260806000000_baseline_production_schema.sql:7599-7614, :8906, :9327, :9343),
-- plus the `organizations` / `profiles` parents its foreign keys need, and the `anon` /
-- `authenticated` / `service_role` roles the privilege-hardening section grants to.
--
-- Deliberately NOT replayed here: RLS policies. The guard is SECURITY DEFINER and runs as the table
-- owner precisely because it must see rows RLS would hide; the suite asserts the guard's own logic,
-- and RLS behaviour is unchanged by this migration.

CREATE SCHEMA IF NOT EXISTS private;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            text,
  status          text
);

-- Column set, defaults, nullability and the type CHECK mirror baseline:7599-7614.
CREATE TABLE IF NOT EXISTS public.custom_fields (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  type             text NOT NULL,
  applies_to       jsonb NOT NULL DEFAULT '[]'::jsonb,
  required         boolean NOT NULL DEFAULT false,
  active           boolean NOT NULL DEFAULT true,
  default_value    text,
  dropdown_options jsonb DEFAULT '[]'::jsonb,
  usage_count      integer DEFAULT 0,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_fields_type_check
    CHECK (type = ANY (ARRAY['Text','Number','Date','Dropdown','Email','Phone']))
);

-- The two pre-existing partial unique indexes, verbatim from baseline:9327 and :9343. The suite
-- asserts the new guard coexists with them and is strictly stronger.
CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_agency_lower_name_unique
  ON public.custom_fields USING btree (organization_id, lower(btrim(name)))
  WHERE ((organization_id IS NOT NULL) AND (created_by IS NULL) AND (active IS TRUE));

CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_personal_lower_name_unique
  ON public.custom_fields USING btree (organization_id, created_by, lower(btrim(name)))
  WHERE ((organization_id IS NOT NULL) AND (created_by IS NOT NULL) AND (active IS TRUE));

-- Mirrors baseline's ALTER DEFAULT PRIVILEGES outcome, so the D-1 hardening has something real to
-- revoke and the suite can prove it took effect.
GRANT ALL ON TABLE public.custom_fields TO anon;
GRANT ALL ON TABLE public.custom_fields TO authenticated;
GRANT ALL ON TABLE public.custom_fields TO service_role;

-- ---- Fixtures ---------------------------------------------------------------------------------
-- Two organizations (tenant-isolation proof) and three users in org A, mirroring the real production
-- shape: one Admin and two Agents, each of whom created their own copy of the same field.
INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Guard Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Guard Org B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, organization_id, role, status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000ad','aaaaaaaa-0000-0000-0000-00000000000a','Admin','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Agent','Active')
ON CONFLICT (id) DO NOTHING;

-- LEGACY DUPLICATES, seeded BEFORE the migration is applied. Three active personal "Gender" rows
-- owned by three different users — the exact production shape. Everything the suite asserts about
-- coexistence depends on these existing first.
INSERT INTO public.custom_fields (id, name, type, applies_to, organization_id, created_by, created_at) VALUES
  ('11111111-1111-1111-1111-111111111101','Gender','Text','["Leads"]'::jsonb,
   'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000ad','2026-08-04 18:31:30+00'),
  ('11111111-1111-1111-1111-111111111102','Gender','Text','["Leads"]'::jsonb,
   'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a1','2026-08-05 16:05:05+00'),
  ('11111111-1111-1111-1111-111111111103','Gender','Text','["Leads"]'::jsonb,
   'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a2','2026-08-05 18:57:41+00')
ON CONFLICT (id) DO NOTHING;

-- A system template with a name that also exists as an org field, to prove org-NULL rows are exempt
-- and never collide with a tenant's namespace.
INSERT INTO public.custom_fields (id, name, type, applies_to, organization_id, created_by) VALUES
  ('11111111-1111-1111-1111-1111111111f0','Gender','Text','["Leads"]'::jsonb, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.custom_fields
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND name = 'Gender';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'HARNESS FAILED: expected 3 seeded legacy Gender rows, found %', v_n;
  END IF;
  RAISE NOTICE 'harness ready: 3 legacy duplicate Gender rows + 1 system template seeded';
END$$;
