-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- EXACT ROLLBACK for 20260911000100_inbound_agent_settings_and_registrations.sql (M4)
-- Drops the two new tables, their policies, trigger and RPCs. Additive objects only — no existing
-- table, policy or row is touched by either direction. Requires M5–M7 to be rolled back first
-- (M6/M7 objects reference these tables).
-- ⚠ NOT EXECUTED REMOTELY. Local/emergency restore only; production use needs Chris's explicit approval.
-- Run inside a single transaction.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;
DROP FUNCTION IF EXISTS public.is_phone_connected(uuid);
DROP FUNCTION IF EXISTS public.heartbeat_phone_registration(uuid, bigint, boolean, text, text);
DROP TABLE IF EXISTS public.agent_phone_registrations;
DROP TRIGGER IF EXISTS trg_agent_inbound_settings_guard ON public.agent_inbound_settings;
DROP FUNCTION IF EXISTS private.agent_inbound_settings_guard();
DROP TABLE IF EXISTS public.agent_inbound_settings;
COMMIT;
