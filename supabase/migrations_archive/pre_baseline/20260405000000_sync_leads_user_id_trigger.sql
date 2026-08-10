-- Migration: Add Leads user_id sync trigger and backfill
-- Date: 2026-04-05
-- Description: Automates synchronization of user_id with assigned_agent_id on the leads table.

---------------------------------------
-- 1. Create trigger function
---------------------------------------
CREATE OR REPLACE FUNCTION public.sync_leads_user_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Synchronize user_id with assigned_agent_id
  -- This ensures RLS (which depends on user_id) remains consistent
  -- when a lead is reassigned via assigned_agent_id.
  NEW.user_id := NEW.assigned_agent_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

---------------------------------------
-- 2. Create trigger
---------------------------------------
DROP TRIGGER IF EXISTS tr_sync_leads_user_id ON public.leads;
CREATE TRIGGER tr_sync_leads_user_id
BEFORE INSERT OR UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_leads_user_id();

---------------------------------------
-- 3. One-time Backfill
---------------------------------------
-- Fix any records where user_id and assigned_agent_id have diverged
UPDATE public.leads
SET user_id = assigned_agent_id
WHERE user_id IS DISTINCT FROM assigned_agent_id;

-- Notify PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
