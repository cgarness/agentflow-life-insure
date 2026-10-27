-- =====================================================================================================
-- Standard lead fields (Address, City, ZIP Code) — M2. NOT APPLIED. Needs Chris's separate approval (release R4);
-- moved out of pending/ and re-stamped to sort after the hosted head at release time.
-- =====================================================================================================
-- WHAT IT IS
--   AgentFlow standard custom fields: Address, City and ZIP Code (Text, Leads), agency-wide (created_by NULL), so
--   every member of an agency can map, see and edit them. `leads` has no address columns; the values live in
--   leads.custom_fields keyed by the field NAME, exactly like every other custom field. Text keeps leading zeros.
--   Names are matched by the existing logical normalization (private.custom_field_norm), so an agency's existing
--   "Zip Code" IS its standard ZIP field and is never renamed.
--
-- WHAT IT ADDS (no existing row is changed by this migration)
--   1. private.standard_lead_field_catalog()         the three definitions (mirrored in src/lib/standard-lead-fields.ts)
--   2. private.standard_lead_field_provisioning     one status row per organization: complete | incomplete | failed,
--                                                    the per-name report, the SQLSTATE of the last failure, attempts
--   3. private.provision_standard_lead_fields(...)   INSERT-only and idempotent: under the logical-name guard's own
--                                                    advisory lock it creates an agency-wide row for each name that
--                                                    NO active row in the organization holds; it never updates or
--                                                    deletes a row and never creates over a personal row
--   4. trigger on public.organizations (AFTER INSERT) seeds new agencies. NON-FATAL, like the existing lead-source /
--      pipeline-stage / appointment-type seeds: a failure is recorded as status 'failed' (detectable) and raised as a
--      WARNING; organization creation is never blocked. Recovery = the authorized, idempotent retry below.
--   5. public.provision_standard_lead_fields(p_dry_run)   Admin / Super Admin of their OWN agency only (JWT role and
--      database profile must agree; Active profile; agency not suspended). The dry run reports live state.
--   6. public.custom_field_make_agency_wide(p_field, p_snapshot, p_dry_run)   converts ONE personal field to
--      agency-wide (created_by → NULL) with EXACTLY today's RLS UPDATE authority: an Admin for their OWN personal
--      field, a Super Admin for any personal field in their OWN agency. Dry run first (owner, other same-name personal
--      rows, leads carrying the key, snapshot); the apply requires the unchanged snapshot, writes an audit row and
--      never touches lead data. Refused when an active agency-wide row with the name already exists.
--   7. private.custom_field_scope_changes   append-only audit of every conversion (in-app or AgentFlow ops).
--
-- WHAT IT DOES NOT DO
--   No backfill: existing agencies are provisioned or converted only through the approved ops files
--   (supabase/ops/standard_lead_fields_report.sql / _apply.sql) or by their own Admin in-app. No RLS policy change;
--   neither public function grants authority RLS does not already grant. The custom_fields guard and indexes are
--   untouched. Rollback: rollback/20261028120100_standard_lead_fields.rollback.sql.
-- =====================================================================================================
DO $pre$
BEGIN
  IF to_regprocedure('private.custom_field_norm(text)') IS NULL OR to_regclass('public.custom_fields') IS NULL THEN
    RAISE EXCEPTION 'custom field logical-name guard (20260919052941) is not applied';
  END IF;
  IF to_regprocedure('private.provision_standard_lead_fields(uuid, text, uuid, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'standard lead fields are already applied';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------- catalog
CREATE FUNCTION private.standard_lead_field_catalog()
 RETURNS TABLE (field_key text, name text, type text, applies_to jsonb)
 LANGUAGE sql IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  VALUES ('address', 'Address', 'Text', '["Leads"]'::jsonb),
         ('city', 'City', 'Text', '["Leads"]'::jsonb),
         ('zip_code', 'ZIP Code', 'Text', '["Leads"]'::jsonb)
$$;

-- ---------------------------------------------------------------------------------------------- status + audit
-- IF NOT EXISTS: the rollback keeps both tables (status history and the audit trail), so a re-apply reuses them.
CREATE TABLE IF NOT EXISTS private.standard_lead_field_provisioning (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('complete', 'incomplete', 'failed')),
  report          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(report) = 'array'),
  last_error      text NULL CHECK (last_error IS NULL OR last_error ~ '^[0-9A-Z]{5}$'),  -- SQLSTATE only
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_source     text NOT NULL CHECK (last_source IN ('org_created', 'admin', 'ops')),
  last_actor      uuid NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.standard_lead_field_provisioning IS
  'Standard lead field provisioning per organization: complete (all agency-wide), incomplete (a personal field '
  'holds a standard name: conversion needed), failed (last attempt raised; SQLSTATE in last_error). Retry: '
  'public.provision_standard_lead_fields (agency Admin) or supabase/ops/standard_lead_fields_apply.sql.';

CREATE TABLE IF NOT EXISTS private.custom_field_scope_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  field_id        uuid NOT NULL,
  field_name      text NOT NULL,
  previous_owner  uuid NOT NULL,
  actor           uuid NULL,
  source          text NOT NULL CHECK (source IN ('admin', 'ops')),
  approval_ref    text NULL CHECK (approval_ref IS NULL OR length(approval_ref) BETWEEN 1 AND 200),
  snapshot        text NOT NULL CHECK (snapshot ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'admin' AND actor IS NOT NULL) OR (source = 'ops' AND approval_ref IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS custom_field_scope_changes_org_idx ON private.custom_field_scope_changes (organization_id, created_at);
COMMENT ON TABLE private.custom_field_scope_changes IS
  'Append-only audit: a personal custom field made agency-wide (created_by -> NULL). Lead data is never changed.';

ALTER TABLE private.standard_lead_field_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.custom_field_scope_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.standard_lead_field_provisioning FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.custom_field_scope_changes FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------- provisioning
-- Live state of one standard name in one organization: agency | personal | missing (active rows only).
CREATE FUNCTION private.standard_lead_field_state(p_org uuid, p_name text)
 RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT CASE WHEN bool_or(f.created_by IS NULL) THEN 'agency' WHEN count(*) > 0 THEN 'personal' ELSE 'missing' END
    FROM public.custom_fields f
   WHERE f.organization_id = p_org AND f.active IS TRUE
     AND private.custom_field_norm(f.name) = private.custom_field_norm(p_name)
$$;

-- INSERT-only, idempotent. Report states: created | would_create | exists_agency | exists_personal.
CREATE FUNCTION private.provision_standard_lead_fields(p_org uuid, p_source text, p_actor uuid, p_dry_run boolean)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE r record; v_state text; v_report jsonb := '[]'::jsonb; v_status text := 'complete';
BEGIN
  IF p_source NOT IN ('org_created', 'admin', 'ops') THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  FOR r IN SELECT * FROM private.standard_lead_field_catalog() LOOP
    -- The custom_fields guard's own key: concurrent provisioning and user INSERTs of the same name serialize.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_org::text || ':' || private.custom_field_norm(r.name), 0));
    v_state := private.standard_lead_field_state(p_org, r.name);
    IF v_state = 'missing' THEN
      IF COALESCE(p_dry_run, true) THEN
        v_state := 'would_create';
      ELSE
        INSERT INTO public.custom_fields (name, type, applies_to, required, active, organization_id, created_by)
        VALUES (r.name, r.type, r.applies_to, false, true, p_org, NULL);
        v_state := 'created';
      END IF;
    ELSE
      v_state := 'exists_' || v_state;
    END IF;
    IF v_state IN ('exists_personal', 'would_create') THEN v_status := 'incomplete'; END IF;
    v_report := v_report || jsonb_build_object('key', r.field_key, 'name', r.name, 'state', v_state);
  END LOOP;
  IF NOT COALESCE(p_dry_run, true) THEN
    INSERT INTO private.standard_lead_field_provisioning AS t
      (organization_id, status, report, last_error, attempts, last_source, last_actor, updated_at)
    VALUES (p_org, v_status, v_report, NULL, 1, p_source, p_actor, now())
    ON CONFLICT (organization_id) DO UPDATE
       SET status = EXCLUDED.status, report = EXCLUDED.report, last_error = NULL, attempts = t.attempts + 1,
           last_source = EXCLUDED.last_source, last_actor = EXCLUDED.last_actor, updated_at = now();
  END IF;
  RETURN jsonb_build_object('organization_id', p_org, 'status', v_status, 'fields', v_report);
END $$;

-- Non-fatal seed for a NEW organization. Any failure rolls back only the seed's subtransaction, is recorded as
-- 'failed' with its SQLSTATE (detectable by the report and the Admin panel), and is retried by an authorized caller.
CREATE FUNCTION private.standard_lead_fields_on_org_created()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE v_state text;
BEGIN
  BEGIN
    PERFORM private.provision_standard_lead_fields(NEW.id, 'org_created', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    BEGIN
      INSERT INTO private.standard_lead_field_provisioning AS t
        (organization_id, status, report, last_error, attempts, last_source, last_actor, updated_at)
      VALUES (NEW.id, 'failed', '[]'::jsonb, v_state, 1, 'org_created', NULL, now())
      ON CONFLICT (organization_id) DO UPDATE
         SET status = 'failed', last_error = EXCLUDED.last_error, attempts = t.attempts + 1,
             last_source = 'org_created', last_actor = NULL, updated_at = now();
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- even recording must never block organization creation; the WARNING and the report still show it
    END;
    RAISE WARNING 'standard lead field provisioning failed for organization % (SQLSTATE %)', NEW.id, v_state;
  END;
  RETURN NEW;
END $$;

CREATE TRIGGER on_organization_created_seed_standard_lead_fields
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.standard_lead_fields_on_org_created();

-- ---------------------------------------------------------------------------------------------- authority
-- Admin or Super Admin of p_org: the JWT (role / is_super_admin, organization) AND the database profile must agree;
-- Active profile; agency not suspended. Returns 'admin' or 'super_admin'; raises not_permitted otherwise.
CREATE FUNCTION private.standard_lead_fields_authority(p_user uuid, p_org uuid)
 RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE v_role text; v_super boolean;
BEGIN
  IF p_user IS NULL OR p_org IS NULL OR p_org IS DISTINCT FROM public.get_org_id() THEN
    RAISE EXCEPTION 'not_permitted' USING ERRCODE = '42501';
  END IF;
  SELECT p.role, COALESCE(p.is_super_admin, false) INTO v_role, v_super
    FROM public.profiles p JOIN public.organizations o ON o.id = p.organization_id
   WHERE p.id = p_user AND p.organization_id = p_org AND p.status = 'Active' AND COALESCE(o.status, 'active') = 'active';
  IF FOUND AND v_super AND public.is_super_admin() THEN RETURN 'super_admin'; END IF;
  IF FOUND AND v_role = 'Admin' AND public.get_user_role() = 'Admin' THEN RETURN 'admin'; END IF;
  RAISE EXCEPTION 'not_permitted' USING ERRCODE = '42501';
END $$;

CREATE FUNCTION public.provision_standard_lead_fields(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid := public.get_org_id(); v_out jsonb; v_last record;
BEGIN
  PERFORM private.standard_lead_fields_authority(v_uid, v_org);
  v_out := private.provision_standard_lead_fields(v_org, 'admin', v_uid, COALESCE(p_dry_run, true));
  SELECT status, last_error, attempts, updated_at INTO v_last
    FROM private.standard_lead_field_provisioning WHERE organization_id = v_org;
  RETURN v_out || jsonb_build_object('last_attempt', CASE WHEN v_last IS NULL THEN NULL ELSE jsonb_build_object(
    'status', v_last.status, 'last_error', v_last.last_error, 'attempts', v_last.attempts, 'at', v_last.updated_at) END);
END $$;

-- ---------------------------------------------------------------------------------------------- conversion
CREATE FUNCTION private.custom_field_scope_snapshot(p_field uuid)
 RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', f.id, f.organization_id, f.name, f.type, f.created_by, f.active,
                                            f.applies_to::text, COALESCE(f.updated_at::text, '')), 'UTF8')), 'hex')
    FROM public.custom_fields f WHERE f.id = p_field
$$;

-- Core conversion (in-app and ops). p_authority: 'admin' (own personal field only), 'super_admin' or 'ops' (any
-- personal field in p_org). Errors: not_found | not_personal | inactive | not_permitted | agency_field_exists |
-- field_changed. Dry run returns the impact and the snapshot the apply must present.
CREATE FUNCTION private.custom_field_convert_to_agency(p_field uuid, p_org uuid, p_authority text, p_actor uuid,
  p_snapshot text, p_approval_ref text, p_dry_run boolean)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE f public.custom_fields; v_snap text; v_owner jsonb; v_others integer; v_leads integer;
BEGIN
  IF p_authority NOT IN ('admin', 'super_admin', 'ops') THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.custom_fields WHERE id = p_field AND organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF f.created_by IS NULL THEN RAISE EXCEPTION 'not_personal' USING ERRCODE = 'P0001'; END IF;
  IF f.active IS NOT TRUE THEN RAISE EXCEPTION 'inactive' USING ERRCODE = 'P0001'; END IF;
  IF p_authority = 'admin' AND f.created_by IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'not_permitted' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text || ':' || private.custom_field_norm(f.name), 0));
  IF EXISTS (SELECT 1 FROM public.custom_fields x
              WHERE x.organization_id = p_org AND x.id <> f.id AND x.active IS TRUE AND x.created_by IS NULL
                AND private.custom_field_norm(x.name) = private.custom_field_norm(f.name)) THEN
    RAISE EXCEPTION 'agency_field_exists' USING ERRCODE = 'P0001';
  END IF;
  v_snap := private.custom_field_scope_snapshot(f.id);
  IF COALESCE(p_dry_run, true) THEN
    SELECT jsonb_build_object('id', p.id, 'name', btrim(concat_ws(' ', NULLIF(p.first_name, ''), NULLIF(p.last_name, ''))))
      INTO v_owner FROM public.profiles p WHERE p.id = f.created_by;
    SELECT count(*) INTO v_others FROM public.custom_fields x
     WHERE x.organization_id = p_org AND x.id <> f.id AND x.active IS TRUE AND x.created_by IS NOT NULL
       AND private.custom_field_norm(x.name) = private.custom_field_norm(f.name);
    SELECT count(*) INTO v_leads FROM public.leads l WHERE l.organization_id = p_org AND l.custom_fields ? f.name;
    RETURN jsonb_build_object('field', jsonb_build_object('id', f.id, 'name', f.name, 'type', f.type, 'applies_to', f.applies_to),
      'owner', COALESCE(v_owner, jsonb_build_object('id', f.created_by, 'name', '')), 'other_personal_rows', v_others,
      'leads_with_key', v_leads, 'snapshot', v_snap, 'applied', false);
  END IF;
  IF p_snapshot IS DISTINCT FROM v_snap THEN RAISE EXCEPTION 'field_changed' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.custom_fields SET created_by = NULL WHERE id = f.id;
  INSERT INTO private.custom_field_scope_changes (organization_id, field_id, field_name, previous_owner, actor, source,
                                                  approval_ref, snapshot)
  VALUES (p_org, f.id, f.name, f.created_by, p_actor, CASE WHEN p_authority = 'ops' THEN 'ops' ELSE 'admin' END,
          p_approval_ref, v_snap);
  -- A standard name may now be complete: refresh the agency's provisioning status (never inserts here).
  IF EXISTS (SELECT 1 FROM private.standard_lead_field_catalog() c
              WHERE private.custom_field_norm(c.name) = private.custom_field_norm(f.name))
     AND EXISTS (SELECT 1 FROM private.standard_lead_field_provisioning s WHERE s.organization_id = p_org) THEN
    UPDATE private.standard_lead_field_provisioning s
       SET status = CASE WHEN (SELECT bool_and(private.standard_lead_field_state(p_org, c.name) = 'agency')
                                 FROM private.standard_lead_field_catalog() c) THEN 'complete' ELSE s.status END,
           updated_at = now()
     WHERE s.organization_id = p_org AND s.status = 'incomplete';
  END IF;
  RETURN jsonb_build_object('field', jsonb_build_object('id', f.id, 'name', f.name), 'snapshot', v_snap, 'applied', true);
END $$;

CREATE FUNCTION public.custom_field_make_agency_wide(p_field uuid, p_snapshot text DEFAULT NULL, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid := public.get_org_id();
BEGIN
  RETURN private.custom_field_convert_to_agency(p_field, v_org, private.standard_lead_fields_authority(v_uid, v_org), v_uid,
                                                p_snapshot, NULL, COALESCE(p_dry_run, true));
END $$;

-- ---------------------------------------------------------------------------------------------- privileges
DO $acl$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private'
               AND p.proname IN ('standard_lead_field_catalog', 'standard_lead_field_state', 'provision_standard_lead_fields',
                                 'standard_lead_fields_on_org_created', 'standard_lead_fields_authority',
                                 'custom_field_scope_snapshot', 'custom_field_convert_to_agency') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
END
$acl$;
REVOKE ALL ON FUNCTION public.provision_standard_lead_fields(boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.custom_field_make_agency_wide(uuid, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.provision_standard_lead_fields(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custom_field_make_agency_wide(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.provision_standard_lead_fields(boolean) IS
  'Agency Admin / Super Admin (own agency): live state of the standard lead fields (dry run, default) or an '
  'idempotent, INSERT-only retry that creates the missing agency-wide ones. Never changes an existing field.';
COMMENT ON FUNCTION public.custom_field_make_agency_wide(uuid, text, boolean) IS
  'Converts one personal custom field to agency-wide with today''s RLS UPDATE authority (Admin: own field; Super '
  'Admin: own agency). Dry run first; apply requires the snapshot; audited; lead data untouched.';
