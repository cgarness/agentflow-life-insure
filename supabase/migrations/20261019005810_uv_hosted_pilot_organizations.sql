-- One-time organization-only setup approved by Chris, 2026-10-18 17:52 Pacific.
-- Exact reserved fixture identities, not references to generated production IDs.
-- No Auth users, sync source, publication, credentials, worker or schedule.
-- All mutations are one atomic DO statement. Any error restores triggers and rows.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;
DO $pilot$
DECLARE
  fixture_ids constant uuid[] := ARRAY['f382cd5c-48e8-4911-b915-353493e0fbc7','e7fe893d-7702-4d44-9806-748c0bb2e150']::uuid[];
  before_triggers jsonb;
  after_triggers jsonb;
  before_orgs text;
  expected_hash record;
  fixture_id uuid;
BEGIN
  -- SHARE ROW EXCLUSIVE also covers ALTER TRIGGER and excludes other org writers.
  LOCK TABLE public.organizations IN SHARE ROW EXCLUSIVE MODE;
  IF current_user <> 'postgres' OR
     (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.organizations'::regclass) <> 'postgres' THEN
    RAISE EXCEPTION 'Pilot setup requires reviewed postgres table owner';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'def',pg_get_triggerdef(oid)) ORDER BY tgname) INTO before_triggers
  FROM pg_trigger WHERE tgrelid='public.organizations'::regclass AND NOT tgisinternal;
  IF before_triggers IS DISTINCT FROM '[{"def": "CREATE TRIGGER on_organization_created_provision_twilio AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_provisioning()", "name": "on_organization_created_provision_twilio", "enabled": "O"}, {"def": "CREATE TRIGGER on_organization_created_seed_appointment_types AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_seed_appointment_types()", "name": "on_organization_created_seed_appointment_types", "enabled": "O"}, {"def": "CREATE TRIGGER on_organization_created_seed_lead_sources AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_seed_lead_sources()", "name": "on_organization_created_seed_lead_sources", "enabled": "O"}, {"def": "CREATE TRIGGER on_organization_created_seed_pipeline_stages AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_seed_pipeline_stages()", "name": "on_organization_created_seed_pipeline_stages", "enabled": "O"}, {"def": "CREATE TRIGGER trg_zz_platform_admin_notify_agency_created AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.enqueue_platform_admin_agency_created()", "name": "trg_zz_platform_admin_notify_agency_created", "enabled": "O"}]'::jsonb THEN
    RAISE EXCEPTION 'Pilot organization trigger inventory changed';
  END IF;
  FOR expected_hash IN SELECT * FROM (VALUES
    ('private.enqueue_platform_admin_agency_created()', '2252a6e8064576a1bb5b712dc6a737e6'),
    ('public.handle_new_organization_provisioning()', 'db73f7fafa3200326ffa96bea380bdeb'),
    ('public.handle_new_organization_seed_appointment_types()', '744ca3e3be0703e7dbe3e6ff9d902749'),
    ('public.handle_new_organization_seed_lead_sources()', '95ae57b7105bb860e58c5e25582cc47f'),
    ('public.handle_new_organization_seed_pipeline_stages()', '1f470290457cd20c672a7282bc3e91f4'),
    ('public.seed_default_appointment_types(uuid)', '067693c6b0031151fd7c04a5490d208a'),
    ('public.seed_default_lead_sources(uuid)', 'e96e8c6a46b4cb63428b285a4e79ac7c'),
    ('public.seed_default_pipeline_stages(uuid)', '0890ab72d518b801c22e0b76610670d6')
  ) AS expected(signature, digest) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(expected_hash.signature))) IS DISTINCT FROM expected_hash.digest THEN
      RAISE EXCEPTION 'Pilot dependency changed: %', expected_hash.signature;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.organizations
             WHERE id=ANY(fixture_ids) OR slug IN ('uv-synthetic-pilot-20261019','uv-isolation-pilot-20261019')) THEN
    RAISE EXCEPTION 'Pilot organization identity already exists; do not replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admin_notifications
      WHERE (event_type='agency_created' AND subject_id=ANY(fixture_ids))
         OR (event_type='user_registered' AND subject_id IN
             ('1721a969-5ab0-45c8-97cb-96205f26c6fe','22042dc9-efc6-4772-8ab8-2b5c201aae01'))) THEN
    RAISE EXCEPTION 'Pilot notification identity already exists';
  END IF;
  SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'[]')) INTO before_orgs FROM public.organizations o;
  INSERT INTO public.platform_admin_notifications(event_type,subject_id,organization_id,status,last_error) VALUES
    ('agency_created',fixture_ids[1],fixture_ids[1],'skipped','Synthetic UV pilot; notification intentionally suppressed'),
    ('agency_created',fixture_ids[2],fixture_ids[2],'skipped','Synthetic UV pilot; notification intentionally suppressed'),
    ('user_registered','1721a969-5ab0-45c8-97cb-96205f26c6fe',fixture_ids[1],'skipped','Synthetic UV pilot; notification intentionally suppressed'),
    ('user_registered','22042dc9-efc6-4772-8ab8-2b5c201aae01',fixture_ids[2],'skipped','Synthetic UV pilot; notification intentionally suppressed');

  ALTER TABLE public.organizations DISABLE TRIGGER on_organization_created_provision_twilio;
  INSERT INTO public.organizations(id,name,slug,status,twilio_subaccount_sid,twilio_subaccount_auth_token_vault_key) VALUES
    (fixture_ids[1],'UV Synthetic Pilot — Not a Real Agency','uv-synthetic-pilot-20261019','active',NULL,NULL),
    (fixture_ids[2],'UV Isolation Pilot — Not a Real Agency','uv-isolation-pilot-20261019','active',NULL,NULL);
  ALTER TABLE public.organizations ENABLE TRIGGER on_organization_created_provision_twilio;

  SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'def',pg_get_triggerdef(oid)) ORDER BY tgname) INTO after_triggers
  FROM pg_trigger WHERE tgrelid='public.organizations'::regclass AND NOT tgisinternal;
  IF before_triggers IS DISTINCT FROM after_triggers THEN
    RAISE EXCEPTION 'Pilot trigger restoration failed';
  END IF;
  IF (SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'[]')) FROM public.organizations o WHERE NOT(id=ANY(fixture_ids)))
      IS DISTINCT FROM before_orgs THEN
    RAISE EXCEPTION 'Existing organizations changed';
  END IF;
  IF (SELECT count(*) FROM public.organizations WHERE id=ANY(fixture_ids)
      AND twilio_subaccount_sid IS NULL AND twilio_subaccount_auth_token_vault_key IS NULL
      AND twilio_provisioned_at IS NULL AND twilio_subaccount_status='pending' AND status='active') <> 2 THEN
    RAISE EXCEPTION 'Pilot organization postcondition failed';
  END IF;
  FOREACH fixture_id IN ARRAY fixture_ids LOOP
    IF (SELECT count(*) FROM public.appointment_types WHERE organization_id=fixture_id) <> 6
       OR (SELECT count(*) FROM public.lead_sources WHERE organization_id=fixture_id) <> 8
       OR (SELECT count(*) FROM public.pipeline_stages WHERE organization_id=fixture_id) <> 11 THEN
      RAISE EXCEPTION 'Pilot default seeds incomplete';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.platform_admin_notifications
      WHERE organization_id=ANY(fixture_ids) AND status='skipped' AND attempts=0
        AND first_attempted_at IS NULL AND sent_at IS NULL AND provider_message_id IS NULL
        AND last_error='Synthetic UV pilot; notification intentionally suppressed'
        AND ((event_type='agency_created' AND subject_id=organization_id)
          OR (event_type='user_registered' AND
             ((subject_id='1721a969-5ab0-45c8-97cb-96205f26c6fe' AND organization_id=fixture_ids[1])
               OR (subject_id='22042dc9-efc6-4772-8ab8-2b5c201aae01' AND organization_id=fixture_ids[2]))))) <> 4 THEN
    RAISE EXCEPTION 'Pilot notification suppression failed';
  END IF;
END;
$pilot$;
