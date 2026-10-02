-- Final release switch for Chris's home organization ONLY. Exact production approval required.
-- Includes supported unanswered attempts; never changes provider verification or routing precedence.
-- No historical-call backfill. Recovery: recent_outbound_disable_home_org.sql.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $activate$
DECLARE
  v_org constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rows integer;
  v_config private.recent_outbound_routing_orgs%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=v_org) THEN
    RAISE EXCEPTION 'refuse: home organization missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inbound_routing_settings WHERE organization_id=v_org
                 AND routing_engine='v2' AND auto_create_lead IS FALSE) THEN
    RAISE EXCEPTION 'refuse: v2 routing with auto-create off is required';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)'))
       IS DISTINCT FROM '4af4a584ff92cf902c16afef865594e9'
     OR (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('private.intended_recipients_for_call(uuid,uuid)'))
       IS DISTINCT FROM 'd74672de7b57e65c5fca97015732977a' THEN
    RAISE EXCEPTION 'refuse: recent-outbound function bodies do not match approved release';
  END IF;
  SELECT * INTO v_config FROM private.recent_outbound_routing_orgs WHERE organization_id=v_org FOR UPDATE;
  IF FOUND THEN
    IF v_config.enabled AND v_config.unanswered_eligible AND v_config.did_allowlist IS NULL THEN
      RETURN; -- Already exactly enabled: no timestamp rewrite.
    END IF;
    IF v_config.enabled OR v_config.unanswered_eligible OR v_config.did_allowlist IS NOT NULL THEN
      RAISE EXCEPTION 'refuse: unexpected existing configuration; do not overwrite';
    END IF;
    UPDATE private.recent_outbound_routing_orgs
       SET enabled=true, unanswered_eligible=true, updated_at=now()
     WHERE organization_id=v_org AND NOT enabled AND NOT unanswered_eligible AND did_allowlist IS NULL;
  ELSE
    INSERT INTO private.recent_outbound_routing_orgs(organization_id,enabled,unanswered_eligible,did_allowlist)
    VALUES(v_org,true,true,NULL);
  END IF;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 OR NOT EXISTS (SELECT 1 FROM private.recent_outbound_routing_orgs
      WHERE organization_id=v_org AND enabled AND unanswered_eligible AND did_allowlist IS NULL) THEN
    RAISE EXCEPTION 'refuse: exact one-org activation postcondition failed';
  END IF;
END;
$activate$;
SELECT organization_id,enabled,unanswered_eligible,did_allowlist,updated_at
FROM private.recent_outbound_routing_orgs
WHERE organization_id='a0000000-0000-0000-0000-000000000001';
COMMIT;
