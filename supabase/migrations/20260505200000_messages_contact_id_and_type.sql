-- Add contact_id (no FK — same pattern as contact_emails.contact_id)
-- Allows inbound SMS from leads, clients, AND recruits to be stored.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS contact_id uuid;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS contact_type text;

-- Index for timeline queries by contact_id
CREATE INDEX IF NOT EXISTS idx_messages_contact_id ON public.messages (contact_id) WHERE contact_id IS NOT NULL;

-- Backfill existing rows: copy lead_id → contact_id, set contact_type = 'lead'
UPDATE public.messages
   SET contact_id = lead_id, contact_type = 'lead'
 WHERE lead_id IS NOT NULL AND contact_id IS NULL;

NOTIFY pgrst, 'reload schema';
