-- =====================================================================================================
-- Custom-Field Canonicalization — one logical field name per organization, enforced forward-only.
-- NOT YET APPLIED ANYWHERE. Local/dev only until a separate approval.
-- =====================================================================================================
-- WHAT THE DEFECT IS, stated precisely.
--   `public.custom_fields` has exactly two unique indexes, both partial, both keyed on
--   `lower(btrim(name))`:
--     custom_fields_agency_lower_name_unique    (organization_id, lower(btrim(name)))
--                                               WHERE created_by IS NULL  AND active IS TRUE
--     custom_fields_personal_lower_name_unique  (organization_id, created_by, lower(btrim(name)))
--                                               WHERE created_by IS NOT NULL AND active IS TRUE
--   The personal index carries `created_by` IN THE KEY. N users in one organization may therefore
--   each legally hold their own "Gender". Nothing enforces an organization-wide name namespace, and
--   production read-only audit (2026-09-19) confirms 10 normalized names across 25 active personal
--   rows in one organization, created by three different users.
--
-- WHY THIS IS A TRIGGER AND NOT A UNIQUE INDEX.
--   The required rule is ASYMMETRIC: a NEW row may not share a normalized name with ANY existing row
--   in the organization. A unique index is symmetric — it would have to hold over the 25 pre-existing
--   rows as well, and `CREATE UNIQUE INDEX` would FAIL AT BUILD TIME because those rows already
--   violate it. `CONCURRENTLY` fails the same way and leaves an invalid index behind. A partial
--   predicate cannot carve out "legacy" either, because the case that must be blocked is precisely a
--   new row colliding with a legacy row. `NOT VALID` does not exist for unique constraints. A guarded
--   BEFORE INSERT OR UPDATE trigger is the only mechanism that expresses the rule.
--
-- WHY SECURITY DEFINER IS REQUIRED, not convenience.
--   `custom_fields_select` hides another user's PERSONAL rows from a non-Admin. A guard running as
--   the invoking user would not see the very rows it must compare against — an Agent's INSERT would
--   silently pass. The function is therefore SECURITY DEFINER owned by `postgres`; because
--   `public.custom_fields` is owned by `postgres` and does NOT have FORCE ROW LEVEL SECURITY
--   (verified read-only: pg_class.relforcerowsecurity = false), the owner's read bypasses RLS and the
--   guard sees the complete organization namespace. It reads one table, takes no caller-supplied
--   identifier beyond the row being written, and cannot be invoked except as a trigger.
--
-- WHAT THIS DELIBERATELY DOES NOT DO.
--   * It performs NO INSERT, UPDATE, DELETE or backfill against `public.custom_fields`. Not one
--     existing row is read for modification, renamed, merged, deactivated or deleted. The 25 legacy
--     duplicates remain valid, readable, editable and re-activatable — see the grandfather clause.
--   * It does NOT create, alter or drop any RLS policy. Visibility is exactly what it was.
--   * It does NOT touch the two pre-existing unique indexes. They keep their own semantics.
--
-- NORMALIZATION.
--   `private.custom_field_norm` mirrors `normalizeFieldName` in src/lib/import-field-matching.ts:
--   trim -> collapse repeated internal whitespace -> lowercase, PUNCTUATION PRESERVED
--   ("Date/Time" and "Date Time" stay different fields). This is STRICTLY STRONGER than the existing
--   indexes' `lower(btrim(name))`, which does not collapse internal whitespace — so the guard is never
--   redundant with them and can never be satisfied by them.
--   KNOWN, ACCEPTED DIVERGENCE (decision D-3): JavaScript's `\s` matches Unicode whitespace including
--   U+00A0; PostgreSQL's `\s` under this locale matches ASCII whitespace. A name containing a
--   non-breaking space could therefore normalize differently on the two sides. No production name
--   contains non-ASCII whitespace (all 111 rows checked read-only), and `customFieldSchema` already
--   trims. This build documents and TESTS the ASCII contract rather than widening it; see
--   supabase/tests/custom_field_logical_name_guard.sql scenario 5.
-- =====================================================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ---------------------------------------------------------------------------------------------------
-- The normalization mirror. IMMUTABLE so it can back an index.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.custom_field_norm(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))) $$;

REVOKE ALL ON FUNCTION private.custom_field_norm(text) FROM PUBLIC;

COMMENT ON FUNCTION private.custom_field_norm(text) IS
  'Canonical custom-field name normalization: trim, collapse repeated internal whitespace, lowercase. '
  'Punctuation preserved. Mirrors normalizeFieldName() in src/lib/import-field-matching.ts.';

-- ---------------------------------------------------------------------------------------------------
-- Support index. NON-UNIQUE by design: the legacy duplicates would make a unique index unbuildable.
-- This exists purely so the guard's lookup is an index probe rather than a sequential scan.
-- ---------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS custom_fields_org_norm_active_idx
  ON public.custom_fields (organization_id, private.custom_field_norm(name))
  WHERE organization_id IS NOT NULL AND active IS TRUE;

-- ---------------------------------------------------------------------------------------------------
-- The guard.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.custom_fields_logical_name_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_norm text;
BEGIN
  -- System templates live outside every tenant namespace, and the app cannot create them anyway
  -- (`custom_fields_insert` requires organization_id IS NOT NULL). They also contain their own
  -- historical duplicates, which are deliberately left alone.
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mirror the two pre-existing partial unique indexes: inactive rows are exempt. A retired field
  -- does not hold its name hostage.
  IF NEW.active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_norm := private.custom_field_norm(NEW.name);

  -- GRANDFATHER CLAUSE (decision D-2, LENIENT).
  -- On UPDATE, enforce only when the row ENTERS a different normalized name or a different
  -- organization. Editing a legacy duplicate's type / required / dropdown options, re-saving it
  -- unchanged, and RE-ACTIVATING it must all keep working: those add no new name to the namespace,
  -- and blocking them would make rows the user never created one-way deactivatable. The duplicate
  -- CREATION vectors — INSERT and rename — are both closed.
  IF TG_OP = 'UPDATE'
     AND v_norm IS NOT DISTINCT FROM private.custom_field_norm(OLD.name)
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
  THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent claims on the same (organization, normalized name). Without this, two
  -- READ COMMITTED transactions both see "no conflict" and both commit — which is exactly how the
  -- production duplicates could be recreated by two users importing at once. Released at
  -- commit/rollback; the key is tenant-scoped, so unrelated organizations never contend.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.organization_id::text || ':' || v_norm, 0));

  IF EXISTS (
    SELECT 1
      FROM public.custom_fields x
     WHERE x.organization_id = NEW.organization_id
       AND x.id <> NEW.id                       -- never conflict with the row being written
       AND x.active IS TRUE
       AND private.custom_field_norm(x.name) = v_norm
  ) THEN
    -- SQLSTATE 23505 so the existing translation layer (friendlyCustomFieldError in
    -- src/lib/supabase-settings.ts) recognises it. The message text is matched there to distinguish
    -- this ORGANIZATION-WIDE conflict from the two per-owner indexes — the client must never tell a
    -- user "you already have this" about a field that belongs to someone else and that RLS hides.
    RAISE EXCEPTION
      'A custom field named "%" already exists in this organization.', btrim(NEW.name)
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.custom_fields_logical_name_guard() FROM PUBLIC;

COMMENT ON FUNCTION private.custom_fields_logical_name_guard() IS
  'Forward-only organization-wide uniqueness of normalized custom-field names. Pre-existing duplicate '
  'rows are grandfathered: the guard only fires on INSERT and on an UPDATE that changes the normalized '
  'name or the organization. SECURITY DEFINER because custom_fields_select hides other users'' personal '
  'rows from the invoking agent.';

DROP TRIGGER IF EXISTS trg_custom_fields_logical_name_guard ON public.custom_fields;
CREATE TRIGGER trg_custom_fields_logical_name_guard
  BEFORE INSERT OR UPDATE ON public.custom_fields
  FOR EACH ROW EXECUTE FUNCTION private.custom_fields_logical_name_guard();

COMMENT ON TABLE public.custom_fields IS
  'Custom field DEFINITIONS. Within an organization, normalized names form ONE logical namespace, '
  'enforced forward-only by trg_custom_fields_logical_name_guard. Contact VALUES live in '
  'leads/clients/recruits.custom_fields as flat JSONB keyed by the field NAME, and no rename '
  'propagation exists — see AGENT_RULES.md invariants #27 and #33.';


-- =====================================================================================================
-- SEPARATELY APPROVED COMPONENT (decision D-1) — TABLE PRIVILEGE HARDENING.
-- Reversible on its own: see the matching section of the rollback file.
-- =====================================================================================================
-- `public.custom_fields` was never added to the baseline's ACL-hardening appendix, so it still carries
-- this project's ALTER DEFAULT PRIVILEGES defaults: `anon` AND `authenticated` each hold the full
-- `arwdDxt` set — DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE (verified read-only in
-- production 2026-09-19). TRUNCATE is NOT filtered by row-level security, so an authenticated caller —
-- or `anon` — could empty every organization's field definitions regardless of the four policies, and
-- TRUNCATE fires only TRUNCATE triggers, so it bypasses the guard above entirely.
--
-- Every grantee is RESET first and then given exactly what the application uses. This is the identical
-- reasoning and shape already applied to public.agent_inbound_settings in 20260914000530.
--
-- WHAT IS PRESERVED: `authenticated` keeps SELECT, INSERT, UPDATE and DELETE — the four verbs
-- customFieldsSupabaseApi.getAll/create/update/delete actually issue. RLS remains the authority over
-- WHICH rows; this changes only which VERBS exist. `service_role` is untouched.
-- WHAT IS REMOVED: TRUNCATE, TRIGGER and REFERENCES from `authenticated`; all privileges from `anon`,
-- which passes none of the four policies today and therefore loses no working access.
REVOKE ALL ON TABLE public.custom_fields FROM PUBLIC;
REVOKE ALL ON TABLE public.custom_fields FROM anon;
REVOKE ALL ON TABLE public.custom_fields FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.custom_fields TO authenticated;
