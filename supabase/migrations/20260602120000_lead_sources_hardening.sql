-- Contact Flow Build 3 — Lead sources hardening + real reassignment + default seeding
--
-- Makes public.lead_sources a safe, org-scoped, seeded source of truth for
-- lead source options. Lead sources are denormalized as text on
-- leads.lead_source; rename/reassign cascades update leads by org-scoped
-- string match. Future lead_source_id normalization is deferred.
--
-- 1. Pre-flight: assert required helpers exist.
-- 2. Tighten schema: organization_id / active / sort_order SET NOT NULL.
-- 3. Indexes: org/sort, org, partial unique active name per org,
--    leads(org, lead_source).
-- 4. BEFORE UPDATE updated_at trigger.
-- 5. seed_default_lead_sources(uuid) — SECURITY DEFINER, idempotent.
-- 6. handle_new_organization_seed_lead_sources + AFTER INSERT trigger.
-- 7. Backfill: PERFORM seed_default_lead_sources(id) per organization.
-- 8. RPCs: get_lead_sources_with_usage, rename_lead_source,
--    reassign_and_delete_lead_source.
-- 9. Replace legacy RLS with helper-based, Admin/Super Admin write only.
--
-- Out of scope (deferred): lead_source_id FK normalization, custom fields,
-- duplicate detection, required fields, field layout persistence.

-- ---------------------------------------------------------------------------
-- 1. Pre-flight
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='get_org_id')
  THEN missing := missing || 'public.get_org_id()'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='get_user_role')
  THEN missing := missing || 'public.get_user_role()'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='is_super_admin')
  THEN missing := missing || 'public.is_super_admin()'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='update_updated_at')
  THEN missing := missing || 'public.update_updated_at()'; END IF;

  IF array_length(missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'lead_sources_hardening: required helper(s) missing: %', missing;
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 2. Tighten schema
-- ---------------------------------------------------------------------------
DO $tighten$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lead_sources WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'lead_sources_hardening: cannot set organization_id NOT NULL — % NULL row(s)',
      (SELECT count(*) FROM public.lead_sources WHERE organization_id IS NULL);
  END IF;
END
$tighten$;

UPDATE public.lead_sources SET active = true WHERE active IS NULL;
UPDATE public.lead_sources SET sort_order = 0 WHERE sort_order IS NULL;

ALTER TABLE public.lead_sources
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN active          SET NOT NULL,
  ALTER COLUMN sort_order      SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS lead_sources_org_sort_idx
  ON public.lead_sources (organization_id, sort_order);

CREATE INDEX IF NOT EXISTS lead_sources_org_idx
  ON public.lead_sources (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS lead_sources_org_lower_name_active_unique
  ON public.lead_sources (organization_id, lower(btrim(name)))
  WHERE active = true;

CREATE INDEX IF NOT EXISTS leads_org_lead_source_idx
  ON public.leads (organization_id, lead_source);

-- ---------------------------------------------------------------------------
-- 4. updated_at trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS lead_sources_updated_at ON public.lead_sources;
CREATE TRIGGER lead_sources_updated_at
  BEFORE UPDATE ON public.lead_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Seed function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_lead_sources(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'seed_default_lead_sources: organization_id required';
  END IF;

  INSERT INTO public.lead_sources (organization_id, name, color, active, sort_order)
  SELECT p_organization_id, d.name, d.color, true, d.sort_order
  FROM (VALUES
    ('Final Expense (Direct Mail)', '#3B82F6', 0),
    ('Mortgage Protection',         '#10B981', 1),
    ('Aged Leads',                  '#F59E0B', 2),
    ('Live Transfer',               '#8B5CF6', 3),
    ('Referral',                    '#22C55E', 4),
    ('Facebook / Social',           '#EC4899', 5),
    ('Existing Client',             '#14B8A6', 6),
    ('Other',                       '#64748B', 7)
  ) AS d(name, color, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lead_sources ls
    WHERE ls.organization_id = p_organization_id
      AND lower(btrim(ls.name)) = lower(btrim(d.name))
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.seed_default_lead_sources(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 6. New-org trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_organization_seed_lead_sources()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  BEGIN
    PERFORM public.seed_default_lead_sources(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_default_lead_sources failed for org %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS on_organization_created_seed_lead_sources ON public.organizations;
CREATE TRIGGER on_organization_created_seed_lead_sources
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization_seed_lead_sources();

-- ---------------------------------------------------------------------------
-- 7. Backfill existing orgs
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  o record;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_lead_sources(o.id);
  END LOOP;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------------

-- 8a. Real usage counts per source for the caller's org.
CREATE OR REPLACE FUNCTION public.get_lead_sources_with_usage()
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  name text,
  color text,
  active boolean,
  sort_order integer,
  usage_count integer,
  real_usage_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    ls.id,
    ls.organization_id,
    ls.name,
    ls.color,
    ls.active,
    ls.sort_order,
    ls.usage_count,
    COALESCE(u.cnt, 0)::bigint AS real_usage_count,
    ls.created_at,
    ls.updated_at
  FROM public.lead_sources ls
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS cnt
    FROM public.leads l
    WHERE l.organization_id = ls.organization_id
      AND l.lead_source = ls.name
  ) u ON true
  WHERE ls.organization_id = public.get_org_id()
  ORDER BY ls.sort_order ASC, ls.created_at ASC;
$fn$;

REVOKE ALL ON FUNCTION public.get_lead_sources_with_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lead_sources_with_usage() TO authenticated;

-- 8b. Rename a source and cascade matching leads in the same transaction.
CREATE OR REPLACE FUNCTION public.rename_lead_source(
  p_source_id uuid,
  p_new_name  text,
  p_color     text DEFAULT NULL
)
RETURNS TABLE (
  source_id uuid,
  new_name  text,
  color     text,
  reassigned_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id      uuid := public.get_org_id();
  v_role        text := public.get_user_role();
  v_is_super    boolean := public.is_super_admin();
  v_source      public.lead_sources%ROWTYPE;
  v_old_name    text;
  v_new_name    text := btrim(p_new_name);
  v_new_color   text;
  v_dupes       integer;
  v_affected    bigint := 0;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'rename_lead_source: no organization context';
  END IF;
  IF NOT (v_role = 'Admin' OR v_is_super) THEN
    RAISE EXCEPTION 'rename_lead_source: insufficient permissions';
  END IF;
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'rename_lead_source: source id required';
  END IF;
  IF v_new_name IS NULL OR length(v_new_name) = 0 THEN
    RAISE EXCEPTION 'rename_lead_source: name required';
  END IF;
  IF length(v_new_name) > 30 THEN
    RAISE EXCEPTION 'rename_lead_source: name must be 30 characters or less';
  END IF;

  SELECT * INTO v_source
  FROM public.lead_sources
  WHERE id = p_source_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rename_lead_source: source not found in current org';
  END IF;

  v_old_name := v_source.name;

  -- Duplicate guard (case-insensitive, active rows, excluding self).
  SELECT count(*) INTO v_dupes
  FROM public.lead_sources
  WHERE organization_id = v_org_id
    AND id <> p_source_id
    AND active = true
    AND lower(btrim(name)) = lower(v_new_name);

  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'rename_lead_source: a source with this name already exists'
      USING ERRCODE = 'unique_violation';
  END IF;

  v_new_color := COALESCE(NULLIF(btrim(p_color), ''), v_source.color);

  UPDATE public.lead_sources
  SET name = v_new_name,
      color = v_new_color
  WHERE id = p_source_id AND organization_id = v_org_id;

  -- Cascade rename to denormalized leads.lead_source by org-scoped string match.
  IF v_old_name IS DISTINCT FROM v_new_name THEN
    UPDATE public.leads
    SET lead_source = v_new_name
    WHERE organization_id = v_org_id
      AND lead_source = v_old_name;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  END IF;

  source_id := p_source_id;
  new_name  := v_new_name;
  color     := v_new_color;
  reassigned_count := v_affected;
  RETURN NEXT;
END
$fn$;

REVOKE ALL ON FUNCTION public.rename_lead_source(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_lead_source(uuid, text, text) TO authenticated;

-- 8c. Reassign all leads from one source to another, then hard-delete the old source.
CREATE OR REPLACE FUNCTION public.reassign_and_delete_lead_source(
  p_source_id     uuid,
  p_new_source_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id    uuid := public.get_org_id();
  v_role      text := public.get_user_role();
  v_is_super  boolean := public.is_super_admin();
  v_old       public.lead_sources%ROWTYPE;
  v_new       public.lead_sources%ROWTYPE;
  v_reassigned bigint := 0;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'reassign_and_delete_lead_source: no organization context';
  END IF;
  IF NOT (v_role = 'Admin' OR v_is_super) THEN
    RAISE EXCEPTION 'reassign_and_delete_lead_source: insufficient permissions';
  END IF;
  IF p_source_id IS NULL OR p_new_source_id IS NULL THEN
    RAISE EXCEPTION 'reassign_and_delete_lead_source: both source ids required';
  END IF;
  IF p_source_id = p_new_source_id THEN
    RAISE EXCEPTION 'reassign_and_delete_lead_source: source and replacement must differ';
  END IF;

  SELECT * INTO v_old
  FROM public.lead_sources
  WHERE id = p_source_id AND organization_id = v_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reassign_and_delete_lead_source: source not found in current org';
  END IF;

  SELECT * INTO v_new
  FROM public.lead_sources
  WHERE id = p_new_source_id AND organization_id = v_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reassign_and_delete_lead_source: replacement not found in current org';
  END IF;
  IF v_new.active IS NOT TRUE THEN
    RAISE EXCEPTION 'reassign_and_delete_lead_source: replacement must be active';
  END IF;

  UPDATE public.leads
  SET lead_source = v_new.name
  WHERE organization_id = v_org_id
    AND lead_source = v_old.name;
  GET DIAGNOSTICS v_reassigned = ROW_COUNT;

  DELETE FROM public.lead_sources
  WHERE id = p_source_id AND organization_id = v_org_id;

  RETURN v_reassigned;
END
$fn$;

REVOKE ALL ON FUNCTION public.reassign_and_delete_lead_source(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_and_delete_lead_source(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. RLS — helper-based, Admin/Super Admin writes only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage their organization's lead sources" ON public.lead_sources;
DROP POLICY IF EXISTS "Users can view their organization's lead sources"   ON public.lead_sources;
DROP POLICY IF EXISTS lead_sources_select ON public.lead_sources;
DROP POLICY IF EXISTS lead_sources_insert ON public.lead_sources;
DROP POLICY IF EXISTS lead_sources_update ON public.lead_sources;
DROP POLICY IF EXISTS lead_sources_delete ON public.lead_sources;

CREATE POLICY lead_sources_select
  ON public.lead_sources
  FOR SELECT
  USING (organization_id = public.get_org_id());

CREATE POLICY lead_sources_insert
  ON public.lead_sources
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

CREATE POLICY lead_sources_update
  ON public.lead_sources
  FOR UPDATE
  USING (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

CREATE POLICY lead_sources_delete
  ON public.lead_sources
  FOR DELETE
  USING (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );
