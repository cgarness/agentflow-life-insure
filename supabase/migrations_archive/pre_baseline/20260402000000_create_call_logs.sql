-- Migration: Create call_logs table for Agent-Specific Analytical Tracking

CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    duration INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    direction TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Insert (Only the exact agent can insert their own logs)
CREATE POLICY "Agents can insert their own call logs"
    ON public.call_logs
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Policy: Select (Agents can only view their own logs)
-- Important: Future "Manager/Admin" roles would need an override policy if they require viewing all logs.
CREATE POLICY "Agents can view their own call logs"
    ON public.call_logs
    FOR SELECT
    USING (user_id = auth.uid());
