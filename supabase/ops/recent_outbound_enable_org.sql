-- Recent-outbound callback routing — ENABLE for the one approved organization.
-- ⚠ Production needs Chris's separate exact approval (implementation_plan.md §A11; AGENT_RULES #28). Activation stays
--   BLOCKED until B1's repair and its separately approved production verification have passed.
-- One transaction:  psql -v ON_ERROR_STOP=1 -f supabase/ops/recent_outbound_enable_org.sql
-- Sets enabled = true for organization a0000000-0000-0000-0000-000000000001 ONLY and leaves unanswered_eligible and
-- did_allowlist unchanged (a new row gets unanswered_eligible = false, did_allowlist = NULL = every org number).
-- Refuses unless the organization exists, the configuration table exists and the organization routes on 'v2';
-- asserts that exactly this one row is enabled afterwards. Idempotent (a re-run changes nothing).
-- Recovery: supabase/ops/recent_outbound_disable.sql.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
CREATE TEMP TABLE ro_ops_result (
  organization_id uuid, changed boolean, enabled boolean, unanswered_eligible boolean, did_allowlist text[], updated_at timestamptz
) ON COMMIT DROP;
DO $ops$
DECLARE
  v_org constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_engine text; v_changed integer := 0; v_enabled integer;
BEGIN
  IF to_regclass('private.recent_outbound_routing_orgs') IS NULL THEN
    RAISE EXCEPTION 'recent_outbound enable: configuration table missing (migration 20260927052736 not applied); refusing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_org) THEN
    RAISE EXCEPTION 'recent_outbound enable: organization % not found; refusing', v_org;
  END IF;
  SELECT s.routing_engine INTO v_engine FROM public.inbound_routing_settings s WHERE s.organization_id = v_org;
  IF v_engine IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION 'recent_outbound enable: organization % routes on % (v2 required); refusing', v_org, coalesce(v_engine, 'no settings row');
  END IF;

  INSERT INTO private.recent_outbound_routing_orgs AS cfg (organization_id, enabled)
  VALUES (v_org, true)
  ON CONFLICT (organization_id) DO UPDATE SET enabled = true, updated_at = now() WHERE NOT cfg.enabled;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  SELECT count(*)::integer INTO v_enabled FROM private.recent_outbound_routing_orgs cfg WHERE cfg.enabled;
  IF v_enabled <> 1 OR NOT EXISTS (SELECT 1 FROM private.recent_outbound_routing_orgs cfg WHERE cfg.organization_id = v_org AND cfg.enabled) THEN
    RAISE EXCEPTION 'recent_outbound enable: expected exactly organization % enabled, found % enabled row(s); rolled back', v_org, v_enabled;
  END IF;
  INSERT INTO pg_temp.ro_ops_result
  SELECT cfg.organization_id, v_changed > 0, cfg.enabled, cfg.unanswered_eligible, cfg.did_allowlist, cfg.updated_at
    FROM private.recent_outbound_routing_orgs cfg WHERE cfg.organization_id = v_org;
  RAISE NOTICE 'recent_outbound enable: organization % enabled (changed: %)', v_org, v_changed > 0;
END;
$ops$;
SELECT * FROM pg_temp.ro_ops_result;
COMMIT;
