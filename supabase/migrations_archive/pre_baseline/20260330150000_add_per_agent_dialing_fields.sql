-- Add sip_username to profiles for individual agent WebRTC endpoints
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sip_username TEXT;

-- Add agent_id to calls to track which agent initiated the call
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES auth.users(id);

-- Add index for performance on webhook lookups
CREATE INDEX IF NOT EXISTS idx_calls_agent_id ON public.calls(agent_id);

-- Force refresh PostgREST cache
NOTIFY pgrst, 'reload schema';
