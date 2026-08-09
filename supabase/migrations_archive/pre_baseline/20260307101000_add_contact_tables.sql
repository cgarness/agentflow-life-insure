-- Create clients table
CREATE TABLE clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  policy_type TEXT,
  policy_number TEXT,
  carrier TEXT,
  premium NUMERIC(10, 2),
  status TEXT DEFAULT 'Active',
  assigned_agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  beneficiary_name TEXT,
  beneficiary_relationship TEXT,
  beneficiary_phone TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create recruits table
CREATE TABLE recruits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  status TEXT DEFAULT 'New',
  assigned_agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create contact_notes polymorphic table
CREATE TABLE contact_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('lead', 'client', 'recruit', 'agent')),
  author_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create contact_activities polymorphic table
CREATE TABLE contact_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('lead', 'client', 'recruit', 'agent')),
  activity_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add updated_at trigger for all tables
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
CREATE TRIGGER set_recruits_updated_at BEFORE UPDATE ON recruits FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
CREATE TRIGGER set_notes_updated_at BEFORE UPDATE ON contact_notes FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruits ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_activities ENABLE ROW LEVEL SECURITY;

-- Create generous RLS policies for initial iteration (allow all authenticated users full access)
-- Note: You can lock this down later based on assigned_agent_id
CREATE POLICY "Enable ALL for authenticated users on clients" 
  ON clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Enable ALL for authenticated users on recruits" 
  ON recruits FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Enable ALL for authenticated users on contact_notes" 
  ON contact_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Enable ALL for authenticated users on contact_activities" 
  ON contact_activities FOR ALL TO authenticated USING (true) WITH CHECK (true);
