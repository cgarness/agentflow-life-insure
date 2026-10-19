-- Save-driven delivery. Preserve all existing RLS, RPC ACLs and protected exclusions.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
DO $preflight$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.finish_uv_profile_sync(uuid,uuid,uuid,bigint,jsonb,text)'::regprocedure)
    IS DISTINCT FROM '9f1f6e670dc5d07ef2d042458e1fdd73' THEN
    RAISE EXCEPTION 'uv_finish_preimage_changed';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='uv-profile-sync-every-minute'
    AND active AND schedule='* * * * *' AND username='postgres'
    AND md5(command)='00cc7e5adf58d661d709c2df08a07196')<>1 THEN
    RAISE EXCEPTION 'uv_schedule_preimage_changed';
  END IF;
END
$preflight$;

-- Called only inside privileged triggers or the existing postgres cron job.
-- pg_net sends after COMMIT; an HTTP error cannot roll back the profile save.
CREATE FUNCTION private.dispatch_uv_profile_sync() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.uv_profile_sync s
    WHERE s.next_attempt_at<=now() AND (s.lease_expires_at IS NULL OR s.lease_expires_at<=now())
      AND NOT EXISTS (SELECT 1 FROM private.uv_profile_exclusions e
        WHERE e.organization_id=s.organization_id AND e.profile_id=s.profile_id)) THEN
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/uv-profile-sync-worker',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || decrypted_secret),
    timeout_milliseconds := 55000
  ) INTO request_id FROM vault.decrypted_secrets
    WHERE name='uv_profile_worker_token' AND length(decrypted_secret)>=32;
  RETURN request_id;
EXCEPTION WHEN OTHERS THEN
  -- Keep durable work for retry; do not include error messages, payloads or secrets in logs.
  RAISE WARNING 'uv_dispatch_deferred';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.dispatch_uv_profile_sync() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.queue_uv_profile_change(p_organization_id uuid,p_profile_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.uv_profile_sync s SET revision=revision+1,next_attempt_at=now(),
    lease_token=NULL,lease_expires_at=NULL,attempts=0,last_error=NULL
    WHERE s.organization_id=p_organization_id AND (p_profile_id IS NULL OR s.profile_id=p_profile_id)
      AND (s.desired_published OR s.remote_published OR s.version>s.delivered_version OR s.revision>s.delivered_revision)
      AND NOT EXISTS (SELECT 1 FROM private.uv_profile_exclusions e
        WHERE e.organization_id=s.organization_id AND e.profile_id=s.profile_id);
END $$;
REVOKE ALL ON FUNCTION private.queue_uv_profile_change(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.wake_uv_profile_queue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.dispatch_uv_profile_sync();
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.wake_uv_profile_queue() FROM PUBLIC,anon,authenticated,service_role;
-- The preference RPC inserts a private placeholder, then updates revision on a real
-- choice. Do not dispatch that placeholder or send two workers for the first Save.
ALTER TABLE private.uv_profile_sync ALTER COLUMN next_attempt_at SET DEFAULT 'infinity'::timestamptz;
-- One wake per revision statement, including publication/contact-preference saves.
-- Claim/finish do not write revision, so they cannot cause a delivery loop.
CREATE TRIGGER uv_profile_queue_wake AFTER UPDATE OF revision ON private.uv_profile_sync
  FOR EACH STATEMENT EXECUTE FUNCTION private.wake_uv_profile_queue();

CREATE FUNCTION private.on_uv_profile_saved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.queue_uv_profile_change(OLD.organization_id,OLD.id);
  IF TG_OP='UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    PERFORM private.queue_uv_profile_change(NEW.organization_id,NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'uv_profile_event_deferred';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.on_uv_profile_saved() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER uv_profile_saved AFTER UPDATE OF first_name,last_name,phone,email,npn,avatar_url,status,organization_id
  ON public.profiles FOR EACH ROW
  WHEN (ROW(OLD.first_name,OLD.last_name,OLD.phone,OLD.email,OLD.npn,OLD.avatar_url,OLD.status,OLD.organization_id)
    IS DISTINCT FROM ROW(NEW.first_name,NEW.last_name,NEW.phone,NEW.email,NEW.npn,NEW.avatar_url,NEW.status,NEW.organization_id))
  EXECUTE FUNCTION private.on_uv_profile_saved();
CREATE TRIGGER uv_profile_deleted AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.on_uv_profile_saved();

CREATE FUNCTION private.on_uv_license_saved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN PERFORM private.queue_uv_profile_change(OLD.organization_id,OLD.agent_id); END IF;
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND ROW(NEW.organization_id,NEW.agent_id) IS DISTINCT FROM ROW(OLD.organization_id,OLD.agent_id)) THEN
    PERFORM private.queue_uv_profile_change(NEW.organization_id,NEW.agent_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'uv_license_event_deferred';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.on_uv_license_saved() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER uv_license_created_deleted AFTER INSERT OR DELETE ON public.agent_state_licenses
  FOR EACH ROW EXECUTE FUNCTION private.on_uv_license_saved();
CREATE TRIGGER uv_license_saved AFTER UPDATE OF organization_id,agent_id,state,license_number,expiration_date
  ON public.agent_state_licenses FOR EACH ROW
  WHEN (ROW(OLD.organization_id,OLD.agent_id,OLD.state,OLD.license_number,OLD.expiration_date)
    IS DISTINCT FROM ROW(NEW.organization_id,NEW.agent_id,NEW.state,NEW.license_number,NEW.expiration_date))
  EXECUTE FUNCTION private.on_uv_license_saved();

CREATE FUNCTION private.on_uv_agency_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME='organizations' THEN
    PERFORM private.queue_uv_profile_change(OLD.id);
  ELSE
    PERFORM private.queue_uv_profile_change(OLD.organization_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'uv_agency_event_deferred';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.on_uv_agency_changed() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER uv_agency_status_changed AFTER UPDATE OF status ON public.organizations
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION private.on_uv_agency_changed();
CREATE TRIGGER uv_agency_deleted AFTER DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.on_uv_agency_changed();
CREATE TRIGGER uv_source_changed AFTER UPDATE ON private.uv_profile_sources
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION private.on_uv_agency_changed();
CREATE TRIGGER uv_source_deleted AFTER DELETE ON private.uv_profile_sources
  FOR EACH ROW EXECUTE FUNCTION private.on_uv_agency_changed();

CREATE OR REPLACE FUNCTION public.finish_uv_profile_sync(p_organization_id uuid,p_profile_id uuid,p_lease_token uuid,p_version bigint,
  p_receipt jsonb DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.uv_profile_sync%ROWTYPE; success boolean; next_due timestamptz := 'infinity'::timestamptz;
BEGIN
  SELECT * INTO s FROM private.uv_profile_sync WHERE organization_id=p_organization_id AND profile_id=p_profile_id FOR UPDATE;
  IF NOT FOUND OR p_lease_token IS NULL OR s.lease_token IS DISTINCT FROM p_lease_token OR s.lease_expires_at<=now()
    OR p_version IS DISTINCT FROM s.version THEN RETURN false; END IF;
  IF p_error IS NOT NULL AND p_error NOT IN ('invalid_profile','temporarily_unavailable','link_required','configuration_required','version_conflict','invalid_receipt')
    THEN RAISE EXCEPTION 'invalid_error_code' USING ERRCODE='22023'; END IF;
  success := p_receipt IS NOT NULL;
  IF success AND (jsonb_typeof(p_receipt) IS DISTINCT FROM 'object'
    OR p_receipt->>'version' IS DISTINCT FROM s.version::text
    OR p_receipt->'published' IS DISTINCT FROM s.payload->'published'
    OR coalesce(p_receipt->>'warning','') NOT IN ('','identity_review_required')
    OR (p_receipt->>'public_url' IS NOT NULL AND p_receipt->>'public_url' !~ '^https://www[.]underwriterverified[.]com/[a-z0-9][a-z0-9-]{0,79}/[a-z0-9][a-z0-9-]{0,79}$')
    OR ((s.payload->>'published')::boolean AND p_receipt->>'public_url' IS NULL))
    THEN RAISE EXCEPTION 'invalid_receipt' USING ERRCODE='22023'; END IF;
  -- A no-op pass is successful only when this exact version was already acknowledged.
  IF NOT success AND p_error IS NULL AND s.version<>s.delivered_version
    THEN RAISE EXCEPTION 'receipt_required' USING ERRCODE='22023'; END IF;
  -- A settled profile has no periodic rescan. Only its next known license expiry
  -- can wake it without a new saved change (expiration is inclusive in UTC).
  IF p_error IS NULL AND s.desired_published AND s.payload->>'published'='true' THEN
    SELECT coalesce((min(expires_on)+1)::timestamp AT TIME ZONE 'UTC','infinity'::timestamptz)
      INTO next_due FROM (
        SELECT max(expiration_date) AS expires_on FROM public.agent_state_licenses
        WHERE organization_id=s.organization_id AND agent_id=s.profile_id
          AND expiration_date IS NOT NULL
          AND (s.payload->'state_licenses') ? (public.normalize_us_state(state)||' - #'||btrim(license_number))
        GROUP BY public.normalize_us_state(state)||' - #'||btrim(license_number)
      ) deadlines;
    -- Keep a deadline already crossed while delivery was in flight. Duplicate
    -- labels remain valid until their latest expiration, preventing a retry loop.
  END IF;
  UPDATE private.uv_profile_sync SET lease_token=NULL,lease_expires_at=NULL,
    delivered_version=CASE WHEN success THEN version ELSE delivered_version END,
    delivered_revision=CASE WHEN success OR (p_error IS NULL AND version=delivered_version) THEN revision ELSE delivered_revision END,
    remote_published=CASE WHEN success THEN (p_receipt->>'published')::boolean ELSE remote_published END,
    public_url=CASE WHEN success THEN p_receipt->>'public_url' ELSE public_url END,
    warning=CASE WHEN success THEN p_receipt->>'warning' ELSE warning END,
    last_synced_at=CASE WHEN success THEN now() ELSE last_synced_at END,
    last_error=p_error,attempts=CASE WHEN p_error IS NULL THEN 0 ELSE least(attempts+1,10) END,
    next_attempt_at=CASE WHEN p_error IS NULL THEN next_due
      ELSE now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::integer) END
    WHERE organization_id=s.organization_id AND profile_id=s.profile_id;
  RETURN true;
END $$;

-- Replace only the named UV schedule. Existing job ID, schedule and owner survive.
DO $schedule$
DECLARE uv_job bigint;
BEGIN
  SELECT jobid INTO STRICT uv_job FROM cron.job WHERE jobname='uv-profile-sync-every-minute';
  PERFORM cron.alter_job(uv_job,command := 'SELECT private.dispatch_uv_profile_sync();');
END
$schedule$;
