-- One-organization recovery switch. Exact production approval required.
-- New plans use existing routing; already committed attempts retain their owner.
-- Evidence, historical calls, other organizations and the DID allowlist are preserved.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $disable$
DECLARE v_org constant uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  IF to_regclass('private.recent_outbound_routing_orgs') IS NULL THEN
    RAISE EXCEPTION 'refuse: recent-outbound configuration table missing';
  END IF;
  UPDATE private.recent_outbound_routing_orgs
     SET enabled=false, unanswered_eligible=false, updated_at=now()
   WHERE organization_id=v_org AND (enabled OR unanswered_eligible);
  IF EXISTS (SELECT 1 FROM private.recent_outbound_routing_orgs
              WHERE organization_id=v_org AND (enabled OR unanswered_eligible)) THEN
    RAISE EXCEPTION 'refuse: home-organization disable postcondition failed';
  END IF;
END;
$disable$;
SELECT organization_id,enabled,unanswered_eligible,did_allowlist,updated_at
FROM private.recent_outbound_routing_orgs
WHERE organization_id='a0000000-0000-0000-0000-000000000001';
COMMIT;
