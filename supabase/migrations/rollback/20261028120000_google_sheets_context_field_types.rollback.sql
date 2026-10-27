-- =====================================================================================================
-- ROLLBACK for 20261028120000_google_sheets_context_field_types.sql. NOT RUN. Needs approval; apply as a migration
-- at the time. Restores the EXACT foundation body of private.google_sheets_context (md5 of prosrc
-- 2aa8978ceafb8f5079317474f98d4dad, verified below) and removes the M1 comment. Signature, owner and ACL are
-- unchanged throughout. Edge code that already understands catalog_version falls back to v1 values and stops
-- advertising mapping v2; stored v2 mappings keep importing (raw values). No data is touched.
-- =====================================================================================================
DO $pre$
BEGIN
  IF to_regprocedure('private.google_sheets_context(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'google sheets foundation is not applied';
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
    'duplicate_rule', d.rule, 'duplicate_scope', d.scope, 'duplicate_action', d.action,
    'default_status', private.google_sheets_default_status(p_org),
    'lead_sources', COALESCE((SELECT jsonb_agg(ls.name ORDER BY ls.sort_order, ls.name)
                                FROM public.lead_sources ls WHERE ls.organization_id = p_org AND ls.active), '[]'::jsonb),
    'has_lead_created_workflows', EXISTS (SELECT 1 FROM public.workflows w
                                           WHERE w.organization_id = p_org AND w.trigger_type = 'lead_created'
                                             AND w.status = 'active'),
    -- Same visibility as custom_fields_select for this user (agency-wide, own personal, all for Admin).
    'custom_fields', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name,
                                       'created_by', f.created_by, 'created_at', f.created_at))
                                 FROM public.custom_fields f
                                WHERE f.organization_id = p_org AND f.active
                                  AND f.applies_to @> '["Leads"]'::jsonb
                                  AND (f.created_by IS NULL OR f.created_by = p_user OR v_admin)), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION private.google_sheets_context(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.google_sheets_context(uuid, uuid) IS NULL;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.google_sheets_context(uuid, uuid)'::regprocedure)
     <> '2aa8978ceafb8f5079317474f98d4dad' THEN
    RAISE EXCEPTION 'rollback did not restore the foundation body';
  END IF;
END
$post$;
