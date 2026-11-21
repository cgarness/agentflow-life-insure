-- Trusted Automations session state. CRM writes outside Automations do not consult this table.
CREATE SEQUENCE private.automation_session_revision;
REVOKE ALL ON SEQUENCE private.automation_session_revision FROM PUBLIC, anon, authenticated;

CREATE TABLE private.automation_sessions (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  target_id uuid,
  revision bigint NOT NULL DEFAULT nextval('private.automation_session_revision')
);
ALTER TABLE private.automation_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.automation_sessions FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.automation_session_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid uuid := nullif(auth.jwt()->>'session_id','')::uuid;
BEGIN
  IF sid IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s WHERE s.id = sid AND s.user_id = auth.uid()
      AND (s.not_after IS NULL OR s.not_after > now())
  ) THEN
    RAISE EXCEPTION 'A current signed-in session is required' USING ERRCODE='42501';
  END IF;
  RETURN sid;
END $$;

CREATE FUNCTION public.automation_session_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid uuid := private.automation_session_id();
  ctx private.automation_sessions;
BEGIN
  SELECT * INTO ctx FROM private.automation_sessions WHERE session_id=sid AND actor_id=auth.uid();
  IF FOUND THEN RETURN to_jsonb(ctx); END IF;
  INSERT INTO private.automation_sessions(session_id,actor_id) VALUES (sid,auth.uid())
    ON CONFLICT (session_id) DO NOTHING;
  SELECT * INTO STRICT ctx FROM private.automation_sessions
    WHERE session_id=sid AND actor_id=auth.uid();
  RETURN to_jsonb(ctx);
END $$;

CREATE FUNCTION public.automation_session_transition(p_expected_revision bigint,p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid uuid := private.automation_session_id();
  ctx private.automation_sessions;
BEGIN
  SELECT * INTO ctx FROM private.automation_sessions WHERE session_id=sid AND actor_id=auth.uid() FOR UPDATE;
  IF ctx.revision IS NULL OR ctx.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Session mode changed. Reopen this view.' USING ERRCODE='40001';
  END IF;
  IF p_target_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles a JOIN public.profiles t ON a.organization_id=t.organization_id
    WHERE a.id=auth.uid() AND a.status='Active' AND a.is_super_admin IS TRUE
      AND t.id=p_target_id AND t.status='Active' AND t.id<>a.id
  ) THEN
    RAISE EXCEPTION 'View As target is unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE private.automation_sessions SET target_id=p_target_id,revision=nextval('private.automation_session_revision')
    WHERE session_id=sid AND actor_id=auth.uid() RETURNING * INTO ctx;
  RETURN to_jsonb(ctx);
END $$;

CREATE FUNCTION private.automation_require_session(p_session_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx private.automation_sessions;
BEGIN
  SELECT * INTO ctx FROM private.automation_sessions
    WHERE session_id=private.automation_session_id() AND actor_id=auth.uid() FOR UPDATE;
  IF ctx.revision IS NULL OR ctx.revision IS DISTINCT FROM p_session_revision OR ctx.target_id IS NOT NULL THEN
    RAISE EXCEPTION 'Automations write denied for this session revision' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION private.automation_viewer_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx private.automation_sessions;
BEGIN
  SELECT * INTO STRICT ctx FROM private.automation_sessions
    WHERE session_id=private.automation_session_id() AND actor_id=auth.uid();
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles a JOIN public.profiles v ON v.organization_id=a.organization_id
    WHERE a.id=ctx.actor_id AND a.status='Active' AND v.id=coalesce(ctx.target_id,ctx.actor_id)
      AND v.status='Active' AND (ctx.target_id IS NULL OR a.is_super_admin IS TRUE)
  ) THEN
    RAISE EXCEPTION 'Automations viewer is unavailable' USING ERRCODE='42501';
  END IF;
  RETURN coalesce(ctx.target_id,ctx.actor_id);
END $$;

REVOKE ALL ON FUNCTION private.automation_session_id(), private.automation_viewer_id(),
  private.automation_require_session(bigint), public.automation_session_context(),
  public.automation_session_transition(bigint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_session_context(),
  public.automation_session_transition(bigint,uuid) TO authenticated;
