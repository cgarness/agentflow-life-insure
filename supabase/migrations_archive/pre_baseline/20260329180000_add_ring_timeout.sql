-- Add ring_timeout column to phone_settings
ALTER TABLE public.phone_settings
ADD COLUMN IF NOT EXISTS ring_timeout INTEGER DEFAULT 30;

-- Update the singleton if it exists
UPDATE public.phone_settings
SET ring_timeout = 30
WHERE ring_timeout IS NULL;
