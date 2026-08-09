-- Add campaign_id to import_history so campaign-scoped imports can be
-- filtered independently from platform-level (Contacts page) imports.
ALTER TABLE import_history
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
