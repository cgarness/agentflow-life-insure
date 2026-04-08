
-- Ensure all missing profile fields exist with correct types
-- This migration consolidates everything to prevent partial failures

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'Available';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resident_state TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS commission_level TEXT DEFAULT '0%';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS upline_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS npn TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Eastern Time (US & Canada)';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS win_sound_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_items JSONB DEFAULT '[]'::jsonb;

-- Ensure JSONB columns are correctly typed and handle any legacy column issues
DO $$ 
BEGIN 
    -- Drop old text-based columns if they exist before rebuilding as jsonb
    -- licensed_states
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'licensed_states' AND data_type = 'ARRAY') THEN
        ALTER TABLE public.profiles DROP COLUMN licensed_states;
    END IF;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS licensed_states JSONB DEFAULT '[]'::jsonb;

    -- carriers
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'carriers') THEN
        ALTER TABLE public.profiles ADD COLUMN carriers JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;
