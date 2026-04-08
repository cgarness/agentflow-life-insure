
-- Add conversion trigger to pipeline_stages
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS convert_to_client BOOLEAN DEFAULT false;

-- Add missing policy details to clients
-- Note: 'premium' already exists in the standard schema, but 'face_amount' and 'issue_date' often don't.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS face_amount NUMERIC(15, 2);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS issue_date DATE;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS effective_date DATE;
