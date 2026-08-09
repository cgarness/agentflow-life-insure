-- Control Center v3A — Runtime Error Capture Lite
-- Adds the control_center_runtime_events table for tracking lightweight frontend/backend error & run events.

CREATE TABLE IF NOT EXISTS public.control_center_runtime_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_key           text NULL,
  event_type          text NOT NULL,
  severity            text NOT NULL,
  source              text NOT NULL,
  route               text NULL,
  component_name      text NULL,
  title               text NOT NULL,
  message             text NULL,
  stack               text NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  occurrence_count    integer NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'open',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_center_runtime_events_event_key_key UNIQUE (event_key),
  CONSTRAINT control_center_runtime_events_event_type_check CHECK (event_type IN (
    'frontend_error', 'frontend_unhandled_rejection', 'analysis_failure', 'auth_error', 'integration_error', 'telemetry_warning'
  )),
  CONSTRAINT control_center_runtime_events_source_check CHECK (source IN (
    'frontend', 'supabase', 'control_center'
  )),
  CONSTRAINT control_center_runtime_events_severity_check CHECK (severity IN (
    'critical', 'high', 'medium', 'low', 'info'
  )),
  CONSTRAINT control_center_runtime_events_status_check CHECK (status IN (
    'open', 'investigating', 'resolved', 'ignored'
  ))
);

-- Indexes for querying and indexing
CREATE INDEX IF NOT EXISTS idx_cc_runtime_events_org           ON public.control_center_runtime_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_runtime_events_user          ON public.control_center_runtime_events (user_id);
CREATE INDEX IF NOT EXISTS idx_cc_runtime_events_type          ON public.control_center_runtime_events (event_type);
CREATE INDEX IF NOT EXISTS idx_cc_runtime_events_severity      ON public.control_center_runtime_events (severity);
CREATE INDEX IF NOT EXISTS idx_cc_runtime_events_status        ON public.control_center_runtime_events (status);
CREATE INDEX IF NOT EXISTS idx_cc_runtime_events_last_seen     ON public.control_center_runtime_events (last_seen_at DESC);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_cc_runtime_events_updated_at ON public.control_center_runtime_events;
CREATE TRIGGER set_cc_runtime_events_updated_at
  BEFORE UPDATE ON public.control_center_runtime_events
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- RLS
ALTER TABLE public.control_center_runtime_events ENABLE ROW LEVEL SECURITY;

-- platform_admin can perform ALL operations (select, insert, update, delete)
DROP POLICY IF EXISTS cc_runtime_events_platform_admin ON public.control_center_runtime_events;
CREATE POLICY cc_runtime_events_platform_admin
  ON public.control_center_runtime_events
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Secure function to insert/update events (SECURITY DEFINER to bypass RLS for non-admins to write their own events)
CREATE OR REPLACE FUNCTION public.log_control_center_runtime_event(
  p_event_type text,
  p_severity text,
  p_source text,
  p_title text,
  p_message text,
  p_stack text,
  p_route text,
  p_component_name text,
  p_metadata jsonb,
  p_event_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_event_id uuid;
  v_scoped_key text;
BEGIN
  -- Ensure caller is authenticated
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve organization_id from profiles to prevent tenant spoofing
  SELECT organization_id INTO v_org_id
  FROM public.profiles
  WHERE id = v_user_id;

  -- Prepend the organization ID (or 'global') to the event key to ensure tenant isolation
  v_scoped_key := COALESCE(v_org_id::text, 'global') || ':' || p_event_key;

  -- Perform the upsert
  INSERT INTO public.control_center_runtime_events (
    organization_id,
    user_id,
    event_key,
    event_type,
    severity,
    source,
    route,
    component_name,
    title,
    message,
    stack,
    metadata,
    first_seen_at,
    last_seen_at,
    occurrence_count,
    status
  ) VALUES (
    v_org_id,
    v_user_id,
    v_scoped_key,
    p_event_type,
    p_severity,
    p_source,
    p_route,
    p_component_name,
    p_title,
    p_message,
    p_stack,
    p_metadata,
    now(),
    now(),
    1,
    'open'
  )
  ON CONFLICT (event_key)
  DO UPDATE SET
    occurrence_count = control_center_runtime_events.occurrence_count + 1,
    last_seen_at = now(),
    updated_at = now(),
    status = CASE
      WHEN control_center_runtime_events.status = 'resolved' THEN 'open'
      ELSE control_center_runtime_events.status
    END,
    message = EXCLUDED.message,
    stack = EXCLUDED.stack,
    metadata = EXCLUDED.metadata
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_control_center_runtime_event(text, text, text, text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_control_center_runtime_event(text, text, text, text, text, text, text, text, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
