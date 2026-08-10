-- Migration: Multi-Tenant JWT Security Patch & Backfill
-- Date: 2026-04-02

-- 1. Security Fix: Prevent Rogue API Privilege Escalation
-- Revokes public execution rights so only triggers running as postgres can map claims
REVOKE EXECUTE ON FUNCTION public.set_claim(uuid, text, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.set_claim(uuid, text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_claim(uuid, text, jsonb) FROM anon;

-- 2. Backfill Existing Agents
-- The trigger only fires on new profile updates. This forcefully bumps every existing profile
-- in the ecosystem so everyone gets their 'organization_id' injected into their token immediately.
UPDATE public.profiles SET updated_at = now();
