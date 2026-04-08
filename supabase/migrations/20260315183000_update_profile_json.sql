
-- Update profiles table to support complex licensed states and carrier data
ALTER TABLE profiles 
DROP COLUMN IF EXISTS licensed_states,
ADD COLUMN IF NOT EXISTS licensed_states jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS carriers jsonb DEFAULT '[]'::jsonb;

-- Add a column for role (if not already there - it should be there from previous migrations)
-- ADD COLUMN IF NOT EXISTS role text DEFAULT 'Agent';
