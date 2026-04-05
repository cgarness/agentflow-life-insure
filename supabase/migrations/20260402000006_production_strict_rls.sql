-- Migration: Production Strict RLS Lockdown
-- Date: 2026-04-02
-- Description: Enforces strict owner-only access for leads, calls, and appointments.
--              No Team Lead or Admin overrides allowed for these specific policies.

---------------------------------------
-- 1. Leads Table (assigned_agent_id)
---------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Wipe any existing policies
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'leads' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.leads', pol.policyname);
    END LOOP;
END $$;

-- Apply strict Owner-Only policy
CREATE POLICY "Strict Owner Leads" ON public.leads
FOR ALL 
TO authenticated 
USING (assigned_agent_id = auth.uid())
WITH CHECK (assigned_agent_id = auth.uid());

---------------------------------------
-- 2. Calls Table (agent_id)
---------------------------------------
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Wipe any existing policies
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'calls' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.calls', pol.policyname);
    END LOOP;
END $$;

-- Apply strict Owner-Only policy
CREATE POLICY "Strict Owner Calls" ON public.calls
FOR ALL 
TO authenticated 
USING (agent_id = auth.uid())
WITH CHECK (agent_id = auth.uid());

---------------------------------------
-- 3. Appointments Table (user_id)
---------------------------------------
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Wipe any existing policies
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'appointments' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.appointments', pol.policyname);
    END LOOP;
END $$;

-- Apply strict Owner-Only policy
CREATE POLICY "Strict Owner Appointments" ON public.appointments
FOR ALL 
TO authenticated 
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
