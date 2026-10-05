SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
ALTER TABLE public.calls ADD COLUMN attempt_id uuid;
ALTER TABLE public.calls ADD COLUMN duration_source text NOT NULL DEFAULT 'legacy_unknown' CHECK(duration_source IN ('legacy_unknown','provider','elapsed_estimate','terminal_non_answer'));
ALTER TABLE public.calls ADD COLUMN duration_provider_account text;
ALTER TABLE public.calls ADD COLUMN duration_provider_sid text;
ALTER TABLE public.calls ADD COLUMN duration_sequence bigint;
ALTER TABLE public.calls ADD COLUMN duration_observed_at timestamptz;
ALTER TABLE public.calls ADD COLUMN duration_conflict boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX calls_attempt_identity_once ON public.calls(organization_id,attempt_id) WHERE attempt_id IS NOT NULL;
-- Twilio SIDs identify a provider leg globally. Only new explicit attempts participate; old collisions require reviewed manifests.
CREATE UNIQUE INDEX calls_new_attempt_provider_sid_once ON public.calls(twilio_call_sid) WHERE attempt_id IS NOT NULL AND twilio_call_sid IS NOT NULL;
CREATE TABLE private.call_duration_observations(
 call_id uuid NOT NULL,organization_id uuid NOT NULL,evidence_key text NOT NULL,
 account_sid text NOT NULL,matched_sid text NOT NULL,duration_sid text NOT NULL,parent_sid text,
 source text NOT NULL,candidate integer NOT NULL,sequence_number bigint,observed_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),decision text NOT NULL,
 PRIMARY KEY(call_id,evidence_key)
);
ALTER TABLE private.call_duration_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.call_duration_observations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_call_duration_evidence(p_call_id uuid,p_account_sid text,p_matched_sid text,p_duration_sid text,p_parent_sid text,
 p_candidate integer,p_source text,p_sequence bigint DEFAULT NULL,p_observed_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.calls; evidence text; decision text:='ignored'; write_value boolean:=false; conflict boolean:=false;
BEGIN
 IF p_source NOT IN ('provider','elapsed_estimate','terminal_non_answer') OR p_source IS NULL OR p_candidate IS NULL OR p_candidate<0
  OR p_sequence<0 OR p_account_sid !~ '^AC[0-9a-fA-F]{32}$' OR p_matched_sid !~ '^CA[0-9a-fA-F]{32}$'
  OR p_duration_sid !~ '^CA[0-9a-fA-F]{32}$' OR p_account_sid IS NULL OR p_matched_sid IS NULL OR p_duration_sid IS NULL
  OR p_observed_at IS NULL THEN RAISE EXCEPTION 'Invalid duration evidence' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.calls WHERE id=p_call_id FOR UPDATE;
 IF NOT FOUND OR c.twilio_call_sid IS DISTINCT FROM p_matched_sid
  OR (p_duration_sid<>p_matched_sid AND p_parent_sid IS DISTINCT FROM p_matched_sid) THEN
  RAISE EXCEPTION 'Duration evidence does not identify this call/leg' USING ERRCODE='22023'; END IF;
 evidence:=md5(jsonb_build_array(p_account_sid,p_matched_sid,p_duration_sid,p_source,p_candidate,p_sequence)::text);
 IF EXISTS(SELECT 1 FROM private.call_duration_observations o WHERE o.call_id=c.id AND o.evidence_key=evidence) THEN
  RETURN jsonb_build_object('duration',c.duration,'source',c.duration_source,'replayed',true,'conflict',c.duration_conflict); END IF;
 IF c.duration_provider_account IS NOT NULL AND c.duration_provider_account<>p_account_sid THEN conflict:=true;
 ELSIF p_source='provider' THEN
  IF c.duration_source='provider' THEN
   -- Final evidence on another leg or a different value requires explicit review, never silent inflation.
   conflict:=c.duration_provider_sid IS DISTINCT FROM p_duration_sid OR c.duration IS DISTINCT FROM p_candidate;
  ELSIF c.duration_source='elapsed_estimate' OR c.duration IS NULL OR p_candidate>=c.duration THEN write_value:=true;
  ELSE conflict:=true; END IF;
 ELSIF c.duration_source='provider' THEN NULL;
 ELSIF p_sequence IS NOT NULL AND c.duration_sequence IS NOT NULL AND c.duration_provider_sid=p_duration_sid AND p_sequence<c.duration_sequence THEN NULL;
 ELSIF p_source='terminal_non_answer' THEN write_value:=c.duration IS NULL OR c.duration=0;
 ELSIF c.duration_source IN ('legacy_unknown','elapsed_estimate') THEN write_value:=c.duration IS NULL OR p_candidate>c.duration;
 END IF;
 IF conflict THEN decision:='conflict';
 ELSIF write_value THEN decision:='accepted'; END IF;
 INSERT INTO private.call_duration_observations(call_id,organization_id,evidence_key,account_sid,matched_sid,duration_sid,parent_sid,source,candidate,sequence_number,observed_at,decision)
 VALUES(c.id,c.organization_id,evidence,p_account_sid,p_matched_sid,p_duration_sid,p_parent_sid,p_source,p_candidate,p_sequence,p_observed_at,decision);
 IF write_value THEN
  UPDATE public.calls SET duration=p_candidate,duration_source=p_source,duration_provider_account=p_account_sid,
   duration_provider_sid=p_duration_sid,duration_sequence=p_sequence,duration_observed_at=p_observed_at,updated_at=clock_timestamp() WHERE id=c.id;
 ELSIF conflict THEN UPDATE public.calls SET duration_conflict=true WHERE id=c.id; END IF;
 RETURN jsonb_build_object('duration',CASE WHEN write_value THEN p_candidate ELSE c.duration END,'source',CASE WHEN write_value THEN p_source ELSE c.duration_source END,
  'replayed',false,'decision',decision,'conflict',conflict OR c.duration_conflict);
END $$;
REVOKE ALL ON FUNCTION public.record_call_duration_evidence(uuid,text,text,text,text,integer,text,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_call_duration_evidence(uuid,text,text,text,text,integer,text,bigint,timestamptz) TO service_role;
-- Invoker trigger: direct browser writes cannot forge authoritative duration/provenance or mutate an attempt identity.
CREATE FUNCTION private.guard_call_reporting_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN
  RAISE EXCEPTION 'Call attempt identity is immutable' USING ERRCODE='23514'; END IF;
 IF current_user NOT IN ('postgres','service_role') AND (
  (TG_OP='INSERT' AND (NEW.duration IS NOT NULL AND NEW.duration<>0 OR NEW.duration_source<>'legacy_unknown' OR NEW.duration_provider_account IS NOT NULL OR NEW.duration_provider_sid IS NOT NULL OR NEW.duration_sequence IS NOT NULL OR NEW.duration_observed_at IS NOT NULL OR NEW.duration_conflict))
  OR (TG_OP='UPDATE' AND (NEW.duration,NEW.duration_source,NEW.duration_provider_account,NEW.duration_provider_sid,NEW.duration_sequence,NEW.duration_observed_at,NEW.duration_conflict)
   IS DISTINCT FROM (OLD.duration,OLD.duration_source,OLD.duration_provider_account,OLD.duration_provider_sid,OLD.duration_sequence,OLD.duration_observed_at,OLD.duration_conflict))) THEN
  RAISE EXCEPTION 'Call duration is owned by verified voice-status processing' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_call_reporting_fields() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER calls_reporting_fields BEFORE INSERT OR UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION private.guard_call_reporting_fields();
