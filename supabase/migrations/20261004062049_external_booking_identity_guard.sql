SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
-- Legacy provider collisions remain unresolved. Enforce forward identities without rewriting them.
ALTER TABLE public.appointments ADD COLUMN external_identity_guarded boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX appointments_external_identity_once
 ON public.appointments(organization_id,user_id,external_provider,external_event_id)
 WHERE external_identity_guarded;
CREATE FUNCTION private.guard_external_booking_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.organization_id,NEW.user_id,NEW.external_provider,NEW.external_event_id)
    IS NOT DISTINCT FROM (OLD.organization_id,OLD.user_id,OLD.external_provider,OLD.external_event_id) THEN
   NEW.external_identity_guarded:=OLD.external_identity_guarded;
   RETURN NEW;
  END IF;
 END IF;
 NEW.external_identity_guarded:=false;
 IF NEW.external_event_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.organization_id IS NULL OR NEW.user_id IS NULL OR nullif(btrim(NEW.external_provider),'') IS NULL OR btrim(NEW.external_event_id)='' THEN
  RAISE EXCEPTION 'External booking requires a complete provider identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':external-booking:'||NEW.user_id||':'||NEW.external_provider||':'||NEW.external_event_id,0));
 IF EXISTS(SELECT 1 FROM public.appointments a WHERE a.organization_id=NEW.organization_id AND a.user_id=NEW.user_id
   AND a.external_provider=NEW.external_provider AND a.external_event_id=NEW.external_event_id AND a.id<>NEW.id) THEN
  RAISE EXCEPTION 'External booking already exists; reload the provider identity' USING ERRCODE='23505'; END IF;
 NEW.external_identity_guarded:=true;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_external_booking_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER appointments_external_identity BEFORE INSERT OR UPDATE ON public.appointments
 FOR EACH ROW EXECUTE FUNCTION private.guard_external_booking_identity();
