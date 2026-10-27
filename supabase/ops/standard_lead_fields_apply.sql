-- =====================================================================================================
-- Standard lead fields — APPROVED APPLY (AgentFlow-operated). NOT RUN. Each run needs Chris's explicit approval of
-- its EXACT inputs, taken from a fresh standard_lead_fields_report.sql:
--   psql "$DB" -1 -v ON_ERROR_STOP=1 \
--     -v approval_ref='CHRIS-APPROVAL-YYYY-MM-DD-N' \
--     -v provision='["<organization uuid>", ...]' \
--     -v convert='[{"organization_id":"<uuid>","field_id":"<uuid>","snapshot":"<64 hex from the report>"}, ...]' \
--     -f supabase/ops/standard_lead_fields_apply.sql
-- ONE transaction (-1): any refusal rolls back everything.
--   provision: INSERT-only, idempotent retry (creates missing agency-wide standard fields; never updates or deletes;
--              never creates over a personal row). Recovers agencies whose automatic seed failed.
--   convert:   one personal field → agency-wide (created_by → NULL) per entry, refused unless the field is still
--              exactly as reported (snapshot), audited in private.custom_field_scope_changes with approval_ref.
-- Lead data is never touched. Output: the per-agency provisioning result and each conversion.
-- =====================================================================================================
CREATE TEMP TABLE slf_input AS
  SELECT NULLIF(:'approval_ref', '') AS approval_ref, :'provision'::jsonb AS provision, :'convert'::jsonb AS convert_list;

DO $apply$
DECLARE i record; e jsonb; r jsonb; o text;
BEGIN
  SELECT * INTO i FROM slf_input;
  IF to_regprocedure('private.provision_standard_lead_fields(uuid, text, uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION 'standard lead fields (M2) are not applied';
  END IF;
  IF i.approval_ref IS NULL OR length(i.approval_ref) > 200 THEN RAISE EXCEPTION 'approval_ref is required'; END IF;
  IF jsonb_typeof(i.provision) <> 'array' OR jsonb_typeof(i.convert_list) <> 'array' THEN
    RAISE EXCEPTION 'provision and convert must be JSON arrays';
  END IF;
  IF jsonb_array_length(i.provision) + jsonb_array_length(i.convert_list) = 0 THEN RAISE EXCEPTION 'nothing to apply'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(i.convert_list) LOOP
    r := private.custom_field_convert_to_agency((e->>'field_id')::uuid, (e->>'organization_id')::uuid, 'ops', NULL,
                                                e->>'snapshot', i.approval_ref, false);
    RAISE NOTICE 'converted % (%): %', e->>'field_id', e->>'organization_id', r;
  END LOOP;
  FOR o IN SELECT * FROM jsonb_array_elements_text(i.provision) LOOP
    r := private.provision_standard_lead_fields(o::uuid, 'ops', NULL, false);
    RAISE NOTICE 'provisioned %: %', o, r;
  END LOOP;
END
$apply$;
