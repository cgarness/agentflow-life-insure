-- Atomic create_agency_group RPC.
-- Why: the frontend was inserting agency_groups then agency_group_members in
-- two separate statements. Because agency_groups SELECT requires an existing
-- agency_group_members row for the caller's org, the frontend could be unable
-- to read the new group back reliably, and a failed member insert would leave
-- an orphan group row. This RPC does both inside one SECURITY DEFINER
-- transaction. It also re-checks role/org server-side because SECURITY DEFINER
-- bypasses RLS.

CREATE OR REPLACE FUNCTION public.create_agency_group(p_name text)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_is_super boolean;
  v_clean text;
  v_existing int;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT organization_id, role, is_super_admin
    INTO v_org, v_role, v_is_super
  FROM public.profiles
  WHERE id = v_uid;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Caller has no organization' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_is_super = true OR v_role = 'Admin') THEN
    RAISE EXCEPTION 'Only Admins can create an Agency Group' USING ERRCODE = '42501';
  END IF;

  v_clean := btrim(coalesce(p_name, ''));
  IF char_length(v_clean) < 2 OR char_length(v_clean) > 80 THEN
    RAISE EXCEPTION 'Group name must be between 2 and 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Block if caller org already has an active or invited membership anywhere.
  -- This matches idx_agency_group_members_one_active_group; an explicit error
  -- wins over a raw unique-violation surfaced through PostgREST.
  SELECT count(*) INTO v_existing
  FROM public.agency_group_members
  WHERE organization_id = v_org
    AND status IN ('active', 'invited');

  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Your organization already has an Agency Group membership or pending invite'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.agency_groups (name, master_organization_id, created_by)
  VALUES (v_clean, v_org, v_uid)
  RETURNING agency_groups.id INTO v_new_id;

  INSERT INTO public.agency_group_members (
    agency_group_id, organization_id, role, status, joined_at, invited_by
  ) VALUES (
    v_new_id, v_org, 'leader', 'active', now(), v_uid
  );

  RETURN QUERY SELECT v_new_id AS id, v_clean AS name;
END;
$$;

REVOKE ALL ON FUNCTION public.create_agency_group(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_agency_group(text) TO authenticated;

COMMENT ON FUNCTION public.create_agency_group(text) IS
  'Atomically creates an agency_groups row and its leader agency_group_members '
  'row in a single SECURITY DEFINER transaction. Replaces the broken two-step '
  'frontend insert that could deadlock on the agency_groups SELECT RLS '
  'predicate (which requires a matching agency_group_members row) and could '
  'leave orphan groups if the second insert failed. Re-checks role/org '
  'server-side because SECURITY DEFINER bypasses RLS; does not trust any '
  'frontend-provided organization id.';

NOTIFY pgrst, 'reload schema';
