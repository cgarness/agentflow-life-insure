-- =====================================================================================================
-- ROLLBACK for 20261028040215_standard_lead_fields.sql. NOT RUN. Needs approval; apply as a migration at the time.
-- Removes the organization trigger and every function M2 added. KEEPS private.standard_lead_field_provisioning and
-- private.custom_field_scope_changes (status history and the audit trail are never destroyed), and keeps every
-- custom field the feature provisioned or converted: undoing an ownership change is a separate, approved data step
-- that uses the audit rows. Leads and lead custom_fields values are never touched. Re-applying M2 afterwards reuses
-- the kept tables.
-- =====================================================================================================
DO $pre$
BEGIN
  IF to_regprocedure('private.provision_standard_lead_fields(uuid, text, uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION 'standard lead fields are not applied';
  END IF;
END
$pre$;

DROP TRIGGER on_organization_created_seed_standard_lead_fields ON public.organizations;
DROP FUNCTION public.custom_field_make_agency_wide(uuid, text, boolean);
DROP FUNCTION public.provision_standard_lead_fields(boolean);
DROP FUNCTION private.custom_field_convert_to_agency(uuid, uuid, text, uuid, text, text, boolean);
DROP FUNCTION private.custom_field_scope_snapshot(uuid);
DROP FUNCTION private.standard_lead_fields_authority(uuid, uuid);
DROP FUNCTION private.standard_lead_fields_on_org_created();
DROP FUNCTION private.provision_standard_lead_fields(uuid, text, uuid, boolean);
DROP FUNCTION private.standard_lead_field_state(uuid, text);
DROP FUNCTION private.standard_lead_field_catalog();
