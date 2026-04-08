
-- Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role text NOT NULL,
    permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(role)
);

-- Enable RLS
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow authenticated read" ON role_permissions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow admin managed" ON role_permissions
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'Admin')
    );

-- Trigger for updated_at
CREATE TRIGGER update_role_permissions_updated_at
    BEFORE UPDATE ON role_permissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed roles
INSERT INTO role_permissions (role, permissions)
VALUES 
('Agent', '{}'),
('Team Leader', '{}')
ON CONFLICT (role) DO NOTHING;
