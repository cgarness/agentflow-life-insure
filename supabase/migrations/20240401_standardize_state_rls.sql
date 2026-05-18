-- 🛡️ Migration: Standardize State Column & Harden RLS
-- Description: Adds 'state' column to clients and recruits, and implements robust organization-level isolation.
-- NOTE: This file has version 20240401 which sorts BEFORE the migrations that create
-- public.clients / public.recruits / public.leads. On a fresh DB (e.g. Supabase branch replay)
-- it must no-op cleanly. Production already has this applied; subsequent migrations create the
-- same end state (state columns + RLS) so a no-op on fresh DBs is safe.

-- Step 1: Add state columns (Text) — only if the target tables already exist.
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='state') THEN
    ALTER TABLE public.clients ADD COLUMN state text;
  END IF;

  IF to_regclass('public.recruits') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='recruits' AND column_name='state') THEN
    ALTER TABLE public.recruits ADD COLUMN state text;
  END IF;
END $$;

-- Step 2: Enable RLS — only if tables exist.
DO $$
BEGIN
  IF to_regclass('public.leads')    IS NOT NULL THEN EXECUTE 'ALTER TABLE public.leads    ENABLE ROW LEVEL SECURITY'; END IF;
  IF to_regclass('public.clients')  IS NOT NULL THEN EXECUTE 'ALTER TABLE public.clients  ENABLE ROW LEVEL SECURITY'; END IF;
  IF to_regclass('public.recruits') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.recruits ENABLE ROW LEVEL SECURITY'; END IF;
END $$;

-- Step 3: Function for high-performance organization check (table-independent).
CREATE OR REPLACE FUNCTION get_user_org()
RETURNS uuid AS $$
  SELECT organization_id::uuid FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Step 4 + 5: Drop old policies and create hardened RLS — only if tables exist.
DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users can only access their organization''s data" ON public.leads';
    EXECUTE 'DROP POLICY IF EXISTS "leads_isolation_policy" ON public.leads';
    EXECUTE 'DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.leads';
    EXECUTE 'DROP POLICY IF EXISTS "leads_organization_isolation" ON public.leads';
    EXECUTE 'CREATE POLICY "leads_organization_isolation" ON public.leads
             FOR ALL TO authenticated
             USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))';
  END IF;

  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users can only access their organization''s data" ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS "clients_isolation_policy" ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS "clients_organization_isolation" ON public.clients';
    EXECUTE 'CREATE POLICY "clients_organization_isolation" ON public.clients
             FOR ALL TO authenticated
             USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))';
  END IF;

  IF to_regclass('public.recruits') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Users can only access their organization''s data" ON public.recruits';
    EXECUTE 'DROP POLICY IF EXISTS "recruits_isolation_policy" ON public.recruits';
    EXECUTE 'DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.recruits';
    EXECUTE 'DROP POLICY IF EXISTS "recruits_organization_isolation" ON public.recruits';
    EXECUTE 'CREATE POLICY "recruits_organization_isolation" ON public.recruits
             FOR ALL TO authenticated
             USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))';
  END IF;
END $$;

-- Note: 'organization_id' is populated by application logic on insert.
