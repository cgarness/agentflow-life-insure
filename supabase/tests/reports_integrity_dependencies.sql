-- Isolated synthetic dependency schema matching the October 5 applied columns.
ALTER TABLE calls ADD COLUMN duration_source text NOT NULL DEFAULT 'legacy_unknown',ADD COLUMN duration_conflict boolean NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN booking_kind text;
ALTER TABLE clients ADD COLUMN primary_policy_id uuid;
ALTER TABLE wins ADD COLUMN policy_id uuid, ADD COLUMN premium_snapshot boolean NOT NULL DEFAULT false;
CREATE TABLE private.performance_duplicate_rows(
 organization_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('call','appointment')),
 duplicate_id uuid NOT NULL,
 canonical_id uuid NOT NULL,
 evidence_hash text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,kind,duplicate_id),
 CHECK(duplicate_id<>canonical_id)
);
ALTER TABLE private.performance_duplicate_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.performance_duplicate_rows FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.check_performance_duplicate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE valid boolean;
BEGIN
 IF NEW.kind='call' THEN
  SELECT count(*)=2 INTO valid FROM public.calls WHERE organization_id=NEW.organization_id AND id=ANY(ARRAY[NEW.duplicate_id,NEW.canonical_id]);
 ELSE
  SELECT count(*)=2 INTO valid FROM public.appointments WHERE organization_id=NEW.organization_id AND id=ANY(ARRAY[NEW.duplicate_id,NEW.canonical_id]);
 END IF;
 IF NOT valid OR EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=NEW.organization_id AND d.kind=NEW.kind
  AND (d.duplicate_id=NEW.canonical_id OR d.canonical_id=NEW.duplicate_id)) THEN
  RAISE EXCEPTION 'Invalid canonical mapping; targets must be same-org and mappings cannot chain' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.check_performance_duplicate() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER performance_duplicate_guard BEFORE INSERT OR UPDATE ON private.performance_duplicate_rows
FOR EACH ROW EXECUTE FUNCTION private.check_performance_duplicate();
