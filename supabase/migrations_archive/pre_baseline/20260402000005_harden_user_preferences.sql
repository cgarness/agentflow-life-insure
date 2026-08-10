-- Migration: Harden User Preferences (v2 Architecture)
-- Date: 2026-04-02
-- Task: Implement per-user settings blob strictly following the requested schema.

-- 1. Drop the legacy table if it exists to ensure schema parity.
DROP TABLE IF EXISTS public.user_preferences CASCADE;

-- 2. Create the new user_preferences table
CREATE TABLE public.user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);

-- 3. Enable RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- 4. Policies: Agents only see and edit their own layout settings.
CREATE POLICY "Users can only view their own preferences"
    ON public.user_preferences
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert/update their own preferences"
    ON public.user_preferences
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 5. Trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 6. Comment for documentation
COMMENT ON TABLE public.user_preferences IS 'Stores per-user UI preferences and layout settings in a single JSONB blob.';
