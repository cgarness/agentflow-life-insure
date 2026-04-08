-- =============================================================
-- Migration 003: Ltree-based Recursive Hierarchy
-- Purpose: Enable multi-level management chains with fast
--          ancestor/descendant queries for RLS and reporting.
-- =============================================================

-- 1. Enable the ltree extension
CREATE EXTENSION IF NOT EXISTS ltree;

-- 2. Add hierarchy_path column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hierarchy_path LTREE;

-- 3. Create GiST index for fast ltree ancestor/descendant queries
CREATE INDEX IF NOT EXISTS idx_profiles_hierarchy_path
  ON public.profiles USING GIST (hierarchy_path);

-- 4. Function to compute hierarchy path by walking the upline chain
CREATE OR REPLACE FUNCTION public.compute_hierarchy_path(target_user_id UUID)
RETURNS LTREE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  path_parts TEXT[] := ARRAY[]::TEXT[];
  current_id UUID := target_user_id;
  current_upline UUID;
  max_depth INT := 20; -- Safety valve against circular references
  depth INT := 0;
BEGIN
  LOOP
    -- Prepend current user to path (replace hyphens with underscores for ltree)
    path_parts := ARRAY[REPLACE(current_id::TEXT, '-', '_')] || path_parts;

    -- Get the upline of the current user
    SELECT upline_id INTO current_upline
    FROM public.profiles WHERE id = current_id;

    -- Stop if no upline, self-reference, or max depth reached
    EXIT WHEN current_upline IS NULL OR current_upline = current_id;

    current_id := current_upline;
    depth := depth + 1;
    EXIT WHEN depth >= max_depth;
  END LOOP;

  RETURN text2ltree(array_to_string(path_parts, '.'));
END;
$$;

-- 5. Trigger function to auto-update hierarchy_path on insert or upline change
CREATE OR REPLACE FUNCTION public.update_hierarchy_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Compute this user's path
  NEW.hierarchy_path := compute_hierarchy_path(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_hierarchy_path ON public.profiles;
CREATE TRIGGER trg_update_hierarchy_path
  BEFORE INSERT OR UPDATE OF upline_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_hierarchy_path();

-- 6. Cascade function: when a user's upline changes, recompute all descendant paths
CREATE OR REPLACE FUNCTION public.cascade_hierarchy_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  descendant RECORD;
BEGIN
  -- Find all profiles whose upline_id points to the changed user
  -- and recursively update their hierarchy paths
  FOR descendant IN
    SELECT id FROM public.profiles
    WHERE upline_id = NEW.id AND id != NEW.id
  LOOP
    UPDATE public.profiles
    SET hierarchy_path = compute_hierarchy_path(descendant.id)
    WHERE id = descendant.id;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_hierarchy_update ON public.profiles;
CREATE TRIGGER trg_cascade_hierarchy_update
  AFTER UPDATE OF upline_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_hierarchy_update();

-- 7. Backfill all existing profiles with their hierarchy paths
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles ORDER BY created_at ASC LOOP
    UPDATE public.profiles
    SET hierarchy_path = compute_hierarchy_path(r.id)
    WHERE id = r.id;
  END LOOP;
END $$;

-- 8. Helper: Check if one user is an ancestor of another via ltree
CREATE OR REPLACE FUNCTION public.is_ancestor_of(ancestor_id UUID, descendant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles d
    WHERE d.id = descendant_id
    AND d.hierarchy_path <@ (
      SELECT p.hierarchy_path FROM public.profiles p WHERE p.id = ancestor_id
    )
  );
$$;

NOTIFY pgrst, 'reload schema';
