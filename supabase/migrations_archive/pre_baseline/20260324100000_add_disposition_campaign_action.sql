-- Add campaign_action and dnc_auto_add columns to dispositions
ALTER TABLE public.dispositions
  ADD COLUMN IF NOT EXISTS campaign_action TEXT NOT NULL DEFAULT 'none'
    CHECK (campaign_action IN ('none', 'remove_from_queue', 'remove_from_campaign')),
  ADD COLUMN IF NOT EXISTS dnc_auto_add BOOLEAN NOT NULL DEFAULT false;

-- Update seed defaults for existing dispositions
UPDATE public.dispositions SET campaign_action = 'remove_from_campaign' WHERE name = 'Not Interested';
UPDATE public.dispositions SET campaign_action = 'remove_from_campaign' WHERE name = 'Sold / Policy Issued';
UPDATE public.dispositions SET campaign_action = 'remove_from_campaign', dnc_auto_add = true WHERE name = 'Wrong Number / Bad Lead';
UPDATE public.dispositions SET campaign_action = 'remove_from_campaign', dnc_auto_add = true WHERE name = 'Do Not Call';
