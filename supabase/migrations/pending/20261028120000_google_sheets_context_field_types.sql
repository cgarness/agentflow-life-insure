-- =====================================================================================================
-- Google Sheets mapping v2 — M1: typed field catalog. NOT APPLIED. Needs Chris's separate approval (release R3);
-- moved out of pending/ and re-stamped to sort after the hosted head at release time.
-- =====================================================================================================
-- ONE function body changes: private.google_sheets_context keeps its signature, owner, ACL and EXACT visibility
-- predicate (organization, active, applies to Leads, and agency-wide OR the owner's own personal field OR every
-- field for an Admin / Super Admin). It only adds, per field: type, required, dropdown_options, scope ('agency' |
-- 'personal') and own (created by the caller); plus the top-level catalog_version = 2, which is how the Edge code
-- knows typed mapping v2 is supported (the compatibility half of the frontend feature gate).
--
-- No table, column, index, policy, grant or data change. The public wrapper is untouched; CREATE OR REPLACE keeps
-- privileges, and the REVOKE below restates the foundation ACL. The Sheets function inventory stays 44 + 31 = 75.
-- Backward compatible: the deployed Edge code ignores the new keys. Rollback:
-- rollback/20261028120000_google_sheets_context_field_types.rollback.sql (restores the exact previous body).
-- =====================================================================================================
DO $pre$
BEGIN
  IF to_regprocedure('private.google_sheets_context(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'google sheets foundation is not applied';
  END IF;
  -- Applied once, over the foundation body only (md5 of prosrc, verified against production on 2026-10-27).
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.google_sheets_context(uuid, uuid)'::regprocedure)
     <> '2aa8978ceafb8f5079317474f98d4dad' THEN
    RAISE EXCEPTION 'private.google_sheets_context is not the foundation body; refusing to replace it';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION private.google_sheets_context(p_user uuid, p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE d record; v_admin boolean;
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  SELECT * INTO d FROM private.google_sheets_dup_settings(p_org);
  SELECT (p.role = 'Admin' OR COALESCE(p.is_super_admin, false)) INTO v_admin FROM public.profiles p WHERE p.id = p_user;
  RETURN jsonb_build_object(
    'catalog_version', 2,
    'duplicate_rule', d.rule, 'duplicate_scope', d.scope, 'duplicate_action', d.action,
    'default_status', private.google_sheets_default_status(p_org),
    'lead_sources', COALESCE((SELECT jsonb_agg(ls.name ORDER BY ls.sort_order, ls.name)
                                FROM public.lead_sources ls WHERE ls.organization_id = p_org AND ls.active), '[]'::jsonb),
    'has_lead_created_workflows', EXISTS (SELECT 1 FROM public.workflows w
                                           WHERE w.organization_id = p_org AND w.trigger_type = 'lead_created'
                                             AND w.status = 'active'),
    -- Same visibility as custom_fields_select for this user (agency-wide, own personal, all for Admin).
    'custom_fields', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name,
                                       'created_by', f.created_by, 'created_at', f.created_at,
                                       'type', f.type, 'required', f.required, 'dropdown_options', f.dropdown_options,
                                       'scope', CASE WHEN f.created_by IS NULL THEN 'agency' ELSE 'personal' END,
                                       'own', f.created_by IS NOT DISTINCT FROM p_user))
                                 FROM public.custom_fields f
                                WHERE f.organization_id = p_org AND f.active
                                  AND f.applies_to @> '["Leads"]'::jsonb
                                  AND (f.created_by IS NULL OR f.created_by = p_user OR v_admin)), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION private.google_sheets_context(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.google_sheets_context(uuid, uuid) IS
  'Google Sheets mapping catalog for the owner (catalog_version 2: typed fields). Visibility mirrors custom_fields_select.';
