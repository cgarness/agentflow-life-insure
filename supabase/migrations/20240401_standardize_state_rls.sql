-- 🛡️ Migration: Standardize State Column & Harden RLS
-- Description: Adds 'state' column to clients and recruits, and implements robust organization-level isolation.

-- Step 1: Add state columns (Text)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='state') THEN
    ALTER TABLE public.clients ADD COLUMN state text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recruits' AND column_name='state') THEN
    ALTER TABLE public.recruits ADD COLUMN state text;
  END IF;
END $$;

-- Step 2: Enable RLS on all three tables
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruits ENABLE ROW LEVEL SECURITY;

-- Step 3: Function for high-performance organization check (optional, but cleaner)
CREATE OR REPLACE FUNCTION get_user_org() 
RETURNS uuid AS $$
  SELECT organization_id::uuid FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Step 4: Drop old policies (Common names from standard Supabase or previous configs)
DROP POLICY IF EXISTS "Users can only access their organization's data" ON public.leads;
DROP POLICY IF EXISTS "leads_isolation_policy" ON public.leads;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.leads;
DROP POLICY IF EXISTS "leads_organization_isolation" ON public.leads;

DROP POLICY IF EXISTS "Users can only access their organization's data" ON public.clients;
DROP POLICY IF EXISTS "clients_isolation_policy" ON public.clients;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.clients;
DROP POLICY IF EXISTS "clients_organization_isolation" ON public.clients;

DROP POLICY IF EXISTS "Users can only access their organization's data" ON public.recruits;
DROP POLICY IF EXISTS "recruits_isolation_policy" ON public.recruits;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.recruits;
DROP POLICY IF EXISTS "recruits_organization_isolation" ON public.recruits;

-- Step 5: Create Hardened RLS Policies
-- Every row in these tables has an 'organization_id' (string or uuid)
-- Every user profile has an 'organization_id'
-- We verify the match on every operation

-- LEADS
CREATE POLICY "leads_organization_isolation" ON public.leads
FOR ALL 
TO authenticated
USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- CLIENTS
CREATE POLICY "clients_organization_isolation" ON public.clients
FOR ALL 
TO authenticated
USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- RECRUITS
CREATE POLICY "recruits_organization_isolation" ON public.recruits
FOR ALL 
TO authenticated
USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- Note: Ensure 'organization_id' column is populated. New records will inherit it via application logic.
