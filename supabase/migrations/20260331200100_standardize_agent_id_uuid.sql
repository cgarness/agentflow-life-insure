-- =============================================================
-- Migration 002: Standardize assigned_agent_id to UUID
-- Purpose: Fix type mismatch — some tables had TEXT, others UUID.
--          Standardize all to UUID with proper FK references.
-- =============================================================

-- ===================== CLIENTS =====================
-- The 20260308152955 migration created assigned_agent_id as TEXT NOT NULL DEFAULT ''
-- We need to cast it to UUID. Empty strings become NULL.
ALTER TABLE public.clients
  ALTER COLUMN assigned_agent_id DROP DEFAULT;

ALTER TABLE public.clients
  ALTER COLUMN assigned_agent_id DROP NOT NULL;

-- Cast existing TEXT values to UUID (empty strings become NULL)
UPDATE public.clients
SET assigned_agent_id = NULL
WHERE assigned_agent_id = '' OR assigned_agent_id IS NULL;

-- Drop any RLS policies that reference this column before altering type
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.clients;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on clients" ON public.clients;
DROP POLICY IF EXISTS "Users can insert clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Users can view clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Users can update clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Users can delete clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "clients_select" ON public.clients;
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_update" ON public.clients;
DROP POLICY IF EXISTS "clients_delete" ON public.clients;

-- Change column type from TEXT to UUID safely
ALTER TABLE public.clients
  ALTER COLUMN assigned_agent_id TYPE UUID USING (
    CASE
      WHEN assigned_agent_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN assigned_agent_id::UUID
      ELSE NULL
    END
  );

-- Add FK reference if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'clients_assigned_agent_id_fkey'
    AND table_name = 'clients'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_assigned_agent_id_fkey
      FOREIGN KEY (assigned_agent_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ===================== RECRUITS =====================
ALTER TABLE public.recruits
  ALTER COLUMN assigned_agent_id DROP DEFAULT;

ALTER TABLE public.recruits
  ALTER COLUMN assigned_agent_id DROP NOT NULL;

UPDATE public.recruits
SET assigned_agent_id = NULL
WHERE assigned_agent_id = '' OR assigned_agent_id IS NULL;

-- Drop any RLS policies that reference this column before altering type
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.recruits;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on recruits" ON public.recruits;
DROP POLICY IF EXISTS "recruits_select" ON public.recruits;
DROP POLICY IF EXISTS "recruits_insert" ON public.recruits;
DROP POLICY IF EXISTS "recruits_update" ON public.recruits;
DROP POLICY IF EXISTS "recruits_delete" ON public.recruits;

-- Change column type from TEXT to UUID safely
ALTER TABLE public.recruits
  ALTER COLUMN assigned_agent_id TYPE UUID USING (
    CASE
      WHEN assigned_agent_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN assigned_agent_id::UUID
      ELSE NULL
    END
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'recruits_assigned_agent_id_fkey'
    AND table_name = 'recruits'
  ) THEN
    ALTER TABLE public.recruits
      ADD CONSTRAINT recruits_assigned_agent_id_fkey
      FOREIGN KEY (assigned_agent_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ===================== LEADS =====================
-- Drop any RLS policies that reference assigned_agent_id before altering type
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.leads;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on leads" ON public.leads;
DROP POLICY IF EXISTS "leads_select" ON public.leads;
DROP POLICY IF EXISTS "leads_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_update" ON public.leads;
DROP POLICY IF EXISTS "leads_delete" ON public.leads;

-- Leads may already be UUID from 20260307101000, but ensure consistency
DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'leads'
    AND column_name = 'assigned_agent_id';

  IF col_type = 'text' OR col_type = 'character varying' THEN
    -- Drop constraints first
    ALTER TABLE public.leads ALTER COLUMN assigned_agent_id DROP DEFAULT;
    ALTER TABLE public.leads ALTER COLUMN assigned_agent_id DROP NOT NULL;

    UPDATE public.leads
    SET assigned_agent_id = NULL
    WHERE assigned_agent_id = '' OR assigned_agent_id IS NULL;

-- Change column type from TEXT to UUID safely
    ALTER TABLE public.leads
      ALTER COLUMN assigned_agent_id TYPE UUID USING (
        CASE
          WHEN assigned_agent_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN assigned_agent_id::UUID
          ELSE NULL
        END
      );
  END IF;
END $$;

-- ===================== CONTACT_NOTES =====================
-- Drop policies before altering columns
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.contact_notes;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on contact_notes" ON public.contact_notes;
-- author_id is currently TEXT, standardize to UUID
DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'contact_notes'
    AND column_name = 'author_id';

  IF col_type = 'text' OR col_type = 'character varying' THEN
    UPDATE public.contact_notes
    SET author_id = NULL
    WHERE author_id = '' OR author_id IS NULL;

    ALTER TABLE public.contact_notes
      ALTER COLUMN author_id DROP DEFAULT;

-- Change column type from TEXT to UUID safely
    ALTER TABLE public.contact_notes
      ALTER COLUMN author_id TYPE UUID USING (
        CASE
          WHEN author_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN author_id::UUID
          ELSE NULL
        END
      );
  END IF;
END $$;

-- ===================== CONTACT_ACTIVITIES =====================
-- Drop policies before altering columns
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.contact_activities;
DROP POLICY IF EXISTS "Enable ALL for authenticated users on contact_activities" ON public.contact_activities;
-- agent_id is currently TEXT in some definitions, standardize to UUID
DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'contact_activities'
    AND column_name = 'agent_id';

  IF col_type = 'text' OR col_type = 'character varying' THEN
    UPDATE public.contact_activities
    SET agent_id = NULL
    WHERE agent_id = '' OR agent_id IS NULL;

    ALTER TABLE public.contact_activities
      ALTER COLUMN agent_id DROP DEFAULT;

-- Change column type from TEXT to UUID safely
    ALTER TABLE public.contact_activities
      ALTER COLUMN agent_id TYPE UUID USING (
        CASE
          WHEN agent_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN agent_id::UUID
          ELSE NULL
        END
      );
  END IF;
END $$;

-- contact_id is also TEXT, standardize to UUID
DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'contact_notes'
    AND column_name = 'contact_id';

  IF col_type = 'text' OR col_type = 'character varying' THEN
    ALTER TABLE public.contact_notes
      ALTER COLUMN contact_id DROP DEFAULT;
    ALTER TABLE public.contact_notes
      ALTER COLUMN contact_id TYPE UUID USING (
        CASE
          WHEN contact_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN contact_id::UUID
          ELSE NULL
        END
      );
  END IF;

  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'contact_activities'
    AND column_name = 'contact_id';

  IF col_type = 'text' OR col_type = 'character varying' THEN
    ALTER TABLE public.contact_activities
      ALTER COLUMN contact_id DROP DEFAULT;
    ALTER TABLE public.contact_activities
      ALTER COLUMN contact_id TYPE UUID USING (
        CASE
          WHEN contact_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN contact_id::UUID
          ELSE NULL
        END
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
