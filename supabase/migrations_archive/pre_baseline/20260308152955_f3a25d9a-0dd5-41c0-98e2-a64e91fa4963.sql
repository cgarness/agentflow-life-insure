
-- Create clients table (may already exist from 20260307101000 on fresh local DB)
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  policy_type TEXT NOT NULL DEFAULT 'Term',
  carrier TEXT DEFAULT '',
  policy_number TEXT DEFAULT '',
  premium NUMERIC DEFAULT 0,
  beneficiary_name TEXT DEFAULT '',
  beneficiary_relationship TEXT DEFAULT '',
  beneficiary_phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  assigned_agent_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.clients;
CREATE POLICY "Allow all for authenticated users" ON public.clients
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create recruits table
CREATE TABLE IF NOT EXISTS public.recruits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  notes TEXT DEFAULT '',
  assigned_agent_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recruits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.recruits;
CREATE POLICY "Allow all for authenticated users" ON public.recruits
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create contact_notes table
CREATE TABLE IF NOT EXISTS public.contact_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id TEXT NOT NULL,
  contact_type TEXT NOT NULL DEFAULT 'lead',
  content TEXT NOT NULL DEFAULT '',
  author_id TEXT DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.contact_notes;
CREATE POLICY "Allow all for authenticated users" ON public.contact_notes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create contact_activities table
CREATE TABLE IF NOT EXISTS public.contact_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id TEXT NOT NULL,
  contact_type TEXT NOT NULL DEFAULT 'lead',
  activity_type TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  agent_id TEXT DEFAULT '',
  metadata JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.contact_activities;
CREATE POLICY "Allow all for authenticated users" ON public.contact_activities
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
