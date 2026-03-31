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

-- Change column type from TEXT to UUID
ALTER TABLE public.clients
  ALTER COLUMN assigned_agent_id TYPE UUID USING (
    CASE
      WHEN assigned_agent_id IS NOT NULL AND assigned_agent_id != ''
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

ALTER TABLE public.recruits
  ALTER COLUMN assigned_agent_id TYPE UUID USING (
    CASE
      WHEN assigned_agent_id IS NOT NULL AND assigned_agent_id != ''
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

    ALTER TABLE public.leads
      ALTER COLUMN assigned_agent_id TYPE UUID USING (
        CASE
          WHEN assigned_agent_id IS NOT NULL AND assigned_agent_id != ''
          THEN assigned_agent_id::UUID
          ELSE NULL
        END
      );
  END IF;
END $$;

-- ===================== CONTACT_NOTES =====================
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
      ALTER COLUMN author_id TYPE UUID USING (
        CASE
          WHEN author_id IS NOT NULL AND author_id != ''
          THEN author_id::UUID
          ELSE NULL
        END
      );
  END IF;
END $$;

-- ===================== CONTACT_ACTIVITIES =====================
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
      ALTER COLUMN agent_id TYPE UUID USING (
        CASE
          WHEN agent_id IS NOT NULL AND agent_id != ''
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
      ALTER COLUMN contact_id TYPE UUID USING contact_id::UUID;
  END IF;

  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'contact_activities'
    AND column_name = 'contact_id';

  IF col_type = 'text' OR col_type = 'character varying' THEN
    ALTER TABLE public.contact_activities
      ALTER COLUMN contact_id TYPE UUID USING contact_id::UUID;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
