-- Migration: Add custom_fields to leads and clients
-- Date: 2026-04-03
-- Description: Adds a JSONB column to the leads and clients tables to support arbitrary custom fields without schema changes.

-- 1. Add custom_fields to leads
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

-- 2. Add custom_fields to clients
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

-- 3. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
