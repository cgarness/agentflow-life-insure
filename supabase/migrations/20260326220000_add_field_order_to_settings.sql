-- Add field order columns to contact_management_settings
ALTER TABLE public.contact_management_settings 
ADD COLUMN IF NOT EXISTS field_order_lead JSONB DEFAULT '["firstName", "lastName", "phone", "email", "state", "leadSource", "leadScore", "age", "dateOfBirth", "spouseInfo", "assignedAgentId", "notes"]'::jsonb,
ADD COLUMN IF NOT EXISTS field_order_client JSONB DEFAULT '["firstName", "lastName", "phone", "email", "policyType", "carrier", "policyNumber", "premiumAmount", "faceAmount", "issueDate", "assignedAgentId", "notes"]'::jsonb,
ADD COLUMN IF NOT EXISTS field_order_recruit JSONB DEFAULT '["firstName", "lastName", "phone", "email", "status", "assignedAgentId", "notes"]'::jsonb;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
