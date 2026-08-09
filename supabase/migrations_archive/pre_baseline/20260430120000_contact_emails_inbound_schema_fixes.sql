-- Inbound Gmail sync schema fixes for public.contact_emails.
-- =====================================================================
-- Context: the prior 20260429143000 migration created contact_emails
-- with contact_id NOT NULL and no in_reply_to / reference_ids columns.
-- The Gmail History API pull in email-sync-incremental needs to:
--   * Insert inbound rows even when no lead/client/recruit matches the
--     From address (contact_id NULL).
--   * Persist RFC 2822 threading headers for future thread-stitching UI.
--
-- The (organization_id, provider, external_message_id) UNIQUE constraint
-- and the external_message_id column already exist on production (verified
-- via information_schema before authoring this migration). The IF NOT
-- EXISTS guards below are defensive — running this on a fresh environment
-- where those don't exist will heal them.

-- 1. Allow inbound rows with no contact match.
ALTER TABLE public.contact_emails
  ALTER COLUMN contact_id DROP NOT NULL;

-- 2. Defensive: ensure external_message_id column exists.
ALTER TABLE public.contact_emails
  ADD COLUMN IF NOT EXISTS external_message_id TEXT;

-- 3. Threading headers from RFC 2822 (named reference_ids to avoid the
--    SQL `references` keyword and the readability drag of quoting it).
ALTER TABLE public.contact_emails
  ADD COLUMN IF NOT EXISTS in_reply_to TEXT;

ALTER TABLE public.contact_emails
  ADD COLUMN IF NOT EXISTS reference_ids TEXT;

-- 4. Defensive: ensure the idempotency key exists.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.contact_emails'::regclass
      AND conname  = 'contact_emails_organization_id_provider_external_message_id_key'
  ) THEN
    ALTER TABLE public.contact_emails
      ADD CONSTRAINT contact_emails_organization_id_provider_external_message_id_key
      UNIQUE (organization_id, provider, external_message_id);
  END IF;
END
$constraint$;

NOTIFY pgrst, 'reload schema';
