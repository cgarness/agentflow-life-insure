-- Bounded index build; failure aborts this additive migration without altering data.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='25s';
CREATE INDEX performance_calls_org_agent_date ON public.calls(organization_id,agent_id,created_at);
CREATE INDEX performance_wins_org_agent_date ON public.wins(organization_id,agent_id,created_at);
CREATE INDEX performance_appointments_org_setter_date ON public.appointments(organization_id,(coalesce(created_by,user_id)),created_at);
CREATE INDEX performance_appointments_org_date ON public.appointments(organization_id,created_at);
CREATE INDEX performance_calls_org_date ON public.calls(organization_id,created_at);
CREATE INDEX performance_wins_org_date ON public.wins(organization_id,created_at);

-- After provenance columns exist, aggregate typed fields without serializing the entire call row.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('private.performance_rows(uuid[],timestamptz,timestamptz,uuid[])'::regprocedure) INTO definition;
 IF position('to_jsonb(c)->>''duration_source''' IN definition)=0 OR position('to_jsonb(c)->>''duration_conflict''' IN definition)=0 THEN
  RAISE EXCEPTION 'Performance provenance reader changed'; END IF;
 definition:=replace(definition,'to_jsonb(c)->>''duration_source''','c.duration_source');
 definition:=replace(definition,'to_jsonb(c)->>''duration_conflict''=''true''','c.duration_conflict');
 EXECUTE definition;
END $$;
