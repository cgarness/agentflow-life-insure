-- One-organization kill switch. Exact production approval required.
-- Disables future recent-outbound planning for Chris's organization only; existing attempts remain frozen.
-- No evidence, call, contact, setting or other organization's configuration is deleted or changed.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $disable$
DECLARE
  v_org constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_rows integer;
BEGIN
  IF to_regclass('private.recent_outbound_routing_orgs') IS NULL THEN
    RAISE EXCEPTION 'recent_outbound disable org: configuration table absent; refusing';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recent_outbound_activation:' || v_org::text,0));
  UPDATE private.recent_outbound_routing_orgs cfg
    SET enabled=false,unanswered_eligible=false,updated_at=now()
    WHERE cfg.organization_id=v_org AND (cfg.enabled OR cfg.unanswered_eligible);
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows > 1 OR EXISTS (SELECT 1 FROM private.recent_outbound_routing_orgs cfg
    WHERE cfg.organization_id=v_org AND (cfg.enabled OR cfg.unanswered_eligible)) THEN
    RAISE EXCEPTION 'recent_outbound disable org: postcondition failed; rolled back';
  END IF;
END;
$disable$;
SELECT organization_id,enabled,unanswered_eligible,did_allowlist,updated_at
  FROM private.recent_outbound_routing_orgs
  WHERE organization_id='a0000000-0000-0000-0000-000000000001';
COMMIT;
