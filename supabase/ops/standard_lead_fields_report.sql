-- =====================================================================================================
-- Standard lead fields — READ-ONLY REPORT (detects every agency that is not complete, including agencies created
-- before M2 and agencies whose automatic seed FAILED). Safe to run at any time; writes nothing.
-- Output per agency × standard name: live state (agency / personal / missing), the personal rows holding the name
-- (field id, owner id, the conversion snapshot to approve), how many leads carry each key, and the stored
-- provisioning status (status, SQLSTATE of the last failure, attempts, source, time). No lead values, no names of
-- people. Use it to prepare an exact, approved input for standard_lead_fields_apply.sql.
-- =====================================================================================================
DO $pre$
BEGIN
  IF to_regprocedure('private.provision_standard_lead_fields(uuid, text, uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION 'standard lead fields (M2) are not applied';
  END IF;
END
$pre$;

WITH cat AS (SELECT field_key, name FROM private.standard_lead_field_catalog()),
rows AS (
  SELECT o.id AS organization_id, o.name AS agency, COALESCE(o.status, 'active') AS agency_status, c.field_key, c.name AS standard_name,
         private.standard_lead_field_state(o.id, c.name) AS live_state,
         (SELECT jsonb_agg(jsonb_build_object('field_id', f.id, 'name', f.name, 'owner', f.created_by, 'type', f.type,
                                              'snapshot', private.custom_field_scope_snapshot(f.id),
                                              'leads_with_key', (SELECT count(*) FROM public.leads l
                                                                  WHERE l.organization_id = o.id AND l.custom_fields ? f.name))
                           ORDER BY f.created_at, f.id)
            FROM public.custom_fields f
           WHERE f.organization_id = o.id AND f.active AND f.created_by IS NOT NULL
             AND private.custom_field_norm(f.name) = private.custom_field_norm(c.name)) AS personal_rows
    FROM public.organizations o CROSS JOIN cat c
)
SELECT r.organization_id, r.agency, r.agency_status, r.field_key, r.standard_name, r.live_state, r.personal_rows,
       s.status AS stored_status, s.last_error, s.attempts, s.last_source, s.updated_at AS status_at
  FROM rows r LEFT JOIN private.standard_lead_field_provisioning s ON s.organization_id = r.organization_id
 WHERE r.live_state <> 'agency' OR s.status IS DISTINCT FROM 'complete'
 ORDER BY r.agency, r.organization_id, r.field_key;
