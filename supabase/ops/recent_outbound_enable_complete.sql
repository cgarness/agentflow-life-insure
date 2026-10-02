-- Final recent-outbound activation for Chris's ONE organization; exact production approval required.
-- Enables supported unanswered attempts as well as answered calls. No data backfill or lead assignment.
-- Preconditions: the separately approved migration/package release and its read-back are complete.
-- Recovery: recent_outbound_disable_org.sql. Existing committed attempts keep their decision.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $activation$
DECLARE
  v_org constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_engine text; v_auto boolean; v_enabled boolean; v_unanswered boolean; v_dids text[];
  v_exists boolean; v_rows integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=v_org) THEN
    RAISE EXCEPTION 'recent_outbound complete: organization missing; refusing';
  END IF;
  IF to_regclass('private.recent_outbound_routing_orgs') IS NULL OR to_regclass('private.outbound_dial_evidence') IS NULL THEN
    RAISE EXCEPTION 'recent_outbound complete: migration missing; refusing';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)')) IS DISTINCT FROM '4af4a584ff92cf902c16afef865594e9' THEN
    RAISE EXCEPTION 'recent_outbound complete: function drift or missing public.plan_inbound_route; refusing';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('private.intended_recipients_for_call(uuid,uuid)')) IS DISTINCT FROM 'd74672de7b57e65c5fca97015732977a' THEN
    RAISE EXCEPTION 'recent_outbound complete: function drift or missing private.intended_recipients_for_call; refusing';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('private.recent_outbound_route_candidate(uuid,uuid,boolean)')) IS DISTINCT FROM '2ba817a8cb950b43644b0cde248c42ca' THEN
    RAISE EXCEPTION 'recent_outbound complete: function drift or missing private.recent_outbound_route_candidate; refusing';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)')) IS DISTINCT FROM 'cc69b1fe2a97765254b9502b6a19d915' THEN
    RAISE EXCEPTION 'recent_outbound complete: function drift or missing public.record_outbound_dial_evidence; refusing';
  END IF;
  IF has_schema_privilege('anon','private','USAGE') OR has_schema_privilege('authenticated','private','USAGE')
     OR has_schema_privilege('service_role','private','USAGE') THEN
    RAISE EXCEPTION 'recent_outbound complete: private-schema grant drift; refusing';
  END IF;
  SELECT s.routing_engine,s.auto_create_lead INTO v_engine,v_auto
    FROM public.inbound_routing_settings s WHERE s.organization_id=v_org FOR SHARE;
  IF v_engine IS DISTINCT FROM 'v2' OR v_auto IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'recent_outbound complete: v2 and Auto-Create Leads off required; refusing';
  END IF;
  -- Serializes only this organization, including its initially absent configuration row.
  PERFORM pg_advisory_xact_lock(hashtextextended('recent_outbound_activation:' || v_org::text,0));
  SELECT cfg.enabled,cfg.unanswered_eligible,cfg.did_allowlist INTO v_enabled,v_unanswered,v_dids
    FROM private.recent_outbound_routing_orgs cfg WHERE cfg.organization_id=v_org FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND v_enabled AND v_unanswered AND v_dids IS NULL THEN
    RETURN; -- Exact already-enabled state: no timestamp or other write.
  END IF;
  IF v_exists AND (v_enabled OR v_unanswered OR v_dids IS NOT NULL) THEN
    RAISE EXCEPTION 'recent_outbound complete: unexpected configuration prestate; refusing';
  END IF;
  INSERT INTO private.recent_outbound_routing_orgs AS cfg
    (organization_id,enabled,unanswered_eligible,did_allowlist)
    VALUES (v_org,true,true,NULL)
    ON CONFLICT (organization_id) DO UPDATE
      SET enabled=true,unanswered_eligible=true,did_allowlist=NULL,updated_at=now()
      WHERE NOT cfg.enabled AND NOT cfg.unanswered_eligible AND cfg.did_allowlist IS NULL;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows <> 1 OR NOT EXISTS (
    SELECT 1 FROM private.recent_outbound_routing_orgs cfg
    WHERE cfg.organization_id=v_org AND cfg.enabled AND cfg.unanswered_eligible AND cfg.did_allowlist IS NULL
  ) THEN
    RAISE EXCEPTION 'recent_outbound complete: one-org postcondition failed; rolled back';
  END IF;
END;
$activation$;
SELECT organization_id,enabled,unanswered_eligible,did_allowlist,updated_at
  FROM private.recent_outbound_routing_orgs
  WHERE organization_id='a0000000-0000-0000-0000-000000000001';
COMMIT;
