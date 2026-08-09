-- =====================================================
-- MIGRATION: add_auto_dialer_support
-- Description: Add auto-dial preferences, call tracking,
--              area code mapping, and business hours tables
-- =====================================================

-- A. Add columns to existing tables

-- dialer_sessions: auto-dial session preferences
ALTER TABLE dialer_sessions
ADD COLUMN IF NOT EXISTS auto_dial_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS dial_delay_seconds INTEGER DEFAULT 2;

-- campaigns: campaign-level auto-dial settings
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS auto_dial_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS dial_delay_seconds INTEGER DEFAULT 2,
ADD COLUMN IF NOT EXISTS local_presence_enabled BOOLEAN DEFAULT true;

-- phone_settings: global phone system toggles
ALTER TABLE phone_settings
ADD COLUMN IF NOT EXISTS amd_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS recording_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS transcription_enabled BOOLEAN DEFAULT false;

-- phone_numbers: daily call limits and tracking
ALTER TABLE phone_numbers
ADD COLUMN IF NOT EXISTS daily_call_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS daily_call_limit INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS limit_reset_at TIMESTAMPTZ DEFAULT (CURRENT_DATE + INTERVAL '1 day');

-- profiles: agent-level preferences
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS auto_dial_preference BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS local_presence_enabled BOOLEAN DEFAULT true;

-- calls: real-time status tracking and metadata
ALTER TABLE calls
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed' CHECK (status IN ('ringing', 'connected', 'completed', 'failed', 'no-answer')),
ADD COLUMN IF NOT EXISTS caller_id_used TEXT,
ADD COLUMN IF NOT EXISTS amd_result TEXT CHECK (amd_result IN ('human', 'machine', 'unknown')),
ADD COLUMN IF NOT EXISTS telnyx_call_id TEXT,
ADD COLUMN IF NOT EXISTS transcript JSONB;

-- B. Create new tables

-- area_code_mapping: for near-local caller ID fallback
CREATE TABLE IF NOT EXISTS area_code_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_code TEXT NOT NULL,
  state TEXT NOT NULL,
  city TEXT,
  timezone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_area_code ON area_code_mapping(area_code);
CREATE INDEX IF NOT EXISTS idx_state ON area_code_mapping(state);

-- Enable RLS
ALTER TABLE area_code_mapping ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anyone can read (no auth required for area code lookups)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'area_code_mapping' AND policyname = 'Anyone can read area codes'
  ) THEN
    CREATE POLICY "Anyone can read area codes"
      ON area_code_mapping FOR SELECT
      USING (true);
  END IF;
END $$;

-- business_hours: for inbound call routing
CREATE TABLE IF NOT EXISTS business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  is_open BOOLEAN DEFAULT true,
  open_time TIME,
  close_time TIME,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anyone authenticated can read
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'business_hours' AND policyname = 'Authenticated users can read business hours'
  ) THEN
    CREATE POLICY "Authenticated users can read business hours"
      ON business_hours FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- RLS Policy: Only admins can modify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'business_hours' AND policyname = 'Admins can modify business hours'
  ) THEN
    CREATE POLICY "Admins can modify business hours"
      ON business_hours FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role = 'Admin'
        )
      );
  END IF;
END $$;
