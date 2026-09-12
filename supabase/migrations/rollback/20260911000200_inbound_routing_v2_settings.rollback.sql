-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- EXACT ROLLBACK for 20260911000200_inbound_routing_v2_settings.sql (M5)
-- Drops the admin RPCs, the validation trigger/functions, the P14 availability CHECK and the five
-- additive columns with their CHECKs. Dropping inbound_group_agent_ids discards configured groups
-- (settings data, not call data). Requires M6/M7 rolled back first (M7 reads inbound_group_agent_ids).
-- ⚠ NOT EXECUTED REMOTELY. Run inside a single transaction.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;
DROP FUNCTION IF EXISTS private.inbound_engine_at(uuid, timestamptz);
DROP TRIGGER IF EXISTS trg_inbound_routing_engine_history ON public.inbound_routing_settings;
DROP FUNCTION IF EXISTS private.record_inbound_engine_history();
DROP TABLE IF EXISTS public.inbound_routing_engine_history;
DROP FUNCTION IF EXISTS public.set_inbound_routing_engine(text);
DROP FUNCTION IF EXISTS public.set_inbound_group(uuid[]);
DROP FUNCTION IF EXISTS private.assert_inbound_settings_admin();
DROP TRIGGER IF EXISTS trg_inbound_routing_settings_validate ON public.inbound_routing_settings;
DROP FUNCTION IF EXISTS private.inbound_routing_settings_validate();
DROP FUNCTION IF EXISTS private.validate_inbound_group(uuid, uuid[]);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_availability_status_check;
ALTER TABLE public.inbound_routing_settings
  DROP CONSTRAINT IF EXISTS inbound_v2_requires_group,
  DROP CONSTRAINT IF EXISTS inbound_group_size,
  DROP CONSTRAINT IF EXISTS inbound_routing_settings_vm_retention_check,
  DROP CONSTRAINT IF EXISTS inbound_routing_settings_mobile_ring_check,
  DROP CONSTRAINT IF EXISTS inbound_routing_settings_browser_ring_check,
  DROP CONSTRAINT IF EXISTS inbound_routing_settings_engine_check;
ALTER TABLE public.inbound_routing_settings
  DROP COLUMN IF EXISTS voicemail_retention_days,
  DROP COLUMN IF EXISTS mobile_ring_seconds,
  DROP COLUMN IF EXISTS browser_ring_seconds,
  DROP COLUMN IF EXISTS inbound_group_agent_ids,
  DROP COLUMN IF EXISTS routing_engine;
COMMIT;
