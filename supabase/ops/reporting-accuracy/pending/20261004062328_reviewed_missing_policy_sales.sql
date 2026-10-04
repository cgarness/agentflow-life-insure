-- QUARANTINED: separate production approval/release checkpoint. NOT an automatic schema migration.
-- CLI-generated migration, moved here before any application. Exact two historical omissions only.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
SET LOCAL TIME ZONE 'UTC';
CREATE TABLE IF NOT EXISTS private.reporting_sale_repair_events(
 operation_key text PRIMARY KEY,client_id uuid NOT NULL,win_id uuid NOT NULL UNIQUE,
 source_hash text NOT NULL,win_postimage jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.reporting_sale_repair_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.reporting_sale_repair_events FROM PUBLIC,anon,authenticated,service_role;
DO $repair$
DECLARE target record;c public.clients;w public.wins;receipt private.reporting_sale_repair_events;source_hash text;key text;
 org constant uuid:='a0000000-0000-0000-0000-000000000001';
BEGIN
 FOR target IN SELECT * FROM (VALUES
  ('54d44dc5-98c8-4778-a71d-f0b1d595d992'::uuid,'0471dcab2957ea2dc0dd89c8491fb653'::text),
  ('71137434-036b-4b3f-8e0a-c6e290b096ba'::uuid,'05481dc8103dcf099597e5d62f8904a3'::text)
 ) x(client_id,expected_hash) ORDER BY client_id LOOP
  SELECT * INTO c FROM public.clients WHERE id=target.client_id AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repair client missing: %',target.client_id; END IF;
  source_hash:=md5(jsonb_build_object('owner',c.assigned_agent_id,'policy_type',c.policy_type,'carrier',c.carrier,'premium',c.premium,'sold_date',c.sold_date,'created_at',c.created_at,'additional_policies',c.custom_fields->'additional_policies')::text);
  IF source_hash<>target.expected_hash THEN RAISE EXCEPTION 'Repair source drift: %',c.id; END IF;
  key:='repair:manual-client:'||c.id||':primary';
  SELECT * INTO receipt FROM private.reporting_sale_repair_events WHERE operation_key=key;
  IF FOUND THEN
   SELECT * INTO w FROM public.wins WHERE id=receipt.win_id AND organization_id=org;
   IF NOT FOUND OR to_jsonb(w) IS DISTINCT FROM receipt.win_postimage OR receipt.source_hash<>source_hash THEN
    RAISE EXCEPTION 'Repair postimage drift: %',c.id; END IF;
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM public.wins WHERE organization_id=org AND contact_id=c.id)
    OR EXISTS(SELECT 1 FROM public.wins WHERE idempotency_key=key) THEN RAISE EXCEPTION 'Sale already exists for repair client: %',c.id; END IF;
  IF c.primary_policy_id IS NULL THEN
   UPDATE public.clients SET primary_policy_id=gen_random_uuid() WHERE id=c.id RETURNING * INTO c;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM private.policy_identities p WHERE p.policy_id=c.primary_policy_id AND p.organization_id=org AND p.client_id=c.id AND p.legacy) THEN
   RAISE EXCEPTION 'Repair identity is not an established legacy policy: %',c.id; END IF;
  INSERT INTO public.wins(organization_id,policy_id,agent_id,agent_name,contact_id,contact_name,policy_type,
    premium_amount,premium_snapshot,sold_date,idempotency_key,created_at,celebrated,event_time_source,campaign_id,call_id)
  SELECT org,c.primary_policy_id,c.assigned_agent_id,concat_ws(' ',p.first_name,p.last_name),c.id,
    concat_ws(' ',c.first_name,c.last_name),c.policy_type,c.premium,true,c.sold_date,key,c.created_at,true,'client_creation_proxy',null,null
  FROM public.profiles p WHERE p.id=c.assigned_agent_id AND p.organization_id=org RETURNING * INTO w;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repair seller not in organization: %',c.id; END IF;
  INSERT INTO private.reporting_sale_repair_events(operation_key,client_id,win_id,source_hash,win_postimage)
    VALUES(key,c.id,w.id,source_hash,to_jsonb(w));
 END LOOP;
 IF (SELECT count(*) FROM private.reporting_sale_repair_events WHERE operation_key IN
  ('repair:manual-client:54d44dc5-98c8-4778-a71d-f0b1d595d992:primary','repair:manual-client:71137434-036b-4b3f-8e0a-c6e290b096ba:primary'))<>2 THEN
  RAISE EXCEPTION 'Exact repair receipt count failed'; END IF;
END $repair$;
COMMIT;
