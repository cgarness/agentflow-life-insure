
-- Add missing profile fields for settings persistence
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS npn TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Eastern Time (US & Canada)';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS win_sound_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT true;

-- Ensure resident_state and commission_level are there as well (safety)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resident_state TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS commission_level TEXT DEFAULT '0%';
