-- =====================================================================================================
-- Commission grids — schema, integrity and access (Commission Calculator + agency comp grids).
-- Plan: docs/plans/2026-10-15-commission-calculator/implementation_plan.md. Apply ONLY with Chris's
-- separate, exact approval. Contains NO compensation data.
--
-- Named exception (AGENT_RULES "Shared compensation grid exception"): AgentFlow-maintained SHARED grids
-- store organization_id = NULL on the grid and every product, variant, rate and reference row. They are
-- readable only by organizations holding an organization_comp_grids row, are never writable by any client
-- role, and are changed only by the reviewed reference-import operation or a reviewed migration. Private
-- grids, access rows and settings are ordinary tenant rows (organization_id NOT NULL, own-org RLS).
--
-- Availability (decision D5): a shared grid EXISTS for AgentFlow, is AVAILABLE to an organization only
-- through an organization_comp_grid_availability row (server-only, written by reviewed postgres-only
-- operations), and is ENABLED by that organization's admin (organization_comp_grids). Being an agency
-- admin is not availability: an access row requires an availability row (FK, ON DELETE CASCADE, and the
-- access trigger), and the catalog lists only available grids.
--
-- Scope integrity without nullable composite keys: every table carries scope_key, a STORED generated
-- column = COALESCE(organization_id, nil UUID). The nil UUID is RESERVED here (organization_id may never
-- be the nil UUID), so scope_key = nil  <=>  organization_id IS NULL. Composite FKs on
-- (parent_id, grid_id, scope_key) make every child match its parent's grid AND scope; access rows FK to
-- (grid_id, nil) and can therefore only reference shared grids.
--
-- Write contract: clients never write these tables directly. RLS write policies and an operation-context
-- trigger require the transaction-scoped setting agentflow.comp_operation = 'on', which only the
-- SECURITY INVOKER comp_* operations set (function-level SET clause, restored on exit). Inside an
-- operation the same RLS (own organization, agency admin, private rows only) still applies, and the
-- constraints/triggers below apply to every writer, privileged ones included.
--
-- Lock order (every writer): organization_comp_settings (org mutex, operations) -> comp_grids ->
-- organization_comp_grid_availability -> organization_comp_grids -> comp_products -> child rows.
-- Privileged multi-agency changes lock the referencing settings rows (ordered by organization_id) before
-- the grid.
-- Rollback: supabase/migrations/rollback/20261015120000_commission_grids_schema.rollback.sql
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $guard$
BEGIN
  IF to_regclass('public.comp_grids') IS NOT NULL OR to_regnamespace('comp_authz') IS NOT NULL THEN
    RAISE EXCEPTION 'commission grid schema already exists; refusing replay';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'public.profiles and public.organizations are required';
  END IF;
  IF to_regprocedure('private.campaign_actor()') IS NULL OR to_regprocedure('public.get_org_id()') IS NULL THEN
    RAISE EXCEPTION 'private.campaign_actor() and public.get_org_id() are required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'the nil UUID is reserved for the shared compensation scope';
  END IF;
END $guard$;

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.comp_grids (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        REFERENCES public.organizations(id),
  scope_key           uuid        NOT NULL GENERATED ALWAYS AS
                        (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  name                text        NOT NULL,
  effective_date      date        NOT NULL,
  is_active           boolean     NOT NULL DEFAULT true,
  contract_levels     integer[]   NOT NULL,
  revision            bigint      NOT NULL DEFAULT 1,
  origin              text        NOT NULL,
  copied_from_grid_id uuid        REFERENCES public.comp_grids(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT comp_grids_scope_reserved
    CHECK (organization_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT comp_grids_name_valid CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT comp_grids_levels_valid CHECK (
    array_ndims(contract_levels) = 1 AND cardinality(contract_levels) BETWEEN 1 AND 60
    AND array_position(contract_levels, NULL::integer) IS NULL
    AND 1 <= ALL (contract_levels) AND 999 >= ALL (contract_levels)),
  CONSTRAINT comp_grids_revision_valid CHECK (revision >= 1),
  CONSTRAINT comp_grids_origin_valid
    CHECK (origin IN ('agentflow_reference', 'blank', 'structure_copy', 'full_copy')),
  CONSTRAINT comp_grids_origin_scope CHECK ((origin = 'agentflow_reference') = (organization_id IS NULL)),
  CONSTRAINT comp_grids_copy_origin
    CHECK (copied_from_grid_id IS NULL OR origin IN ('structure_copy', 'full_copy')),
  CONSTRAINT comp_grids_id_scope UNIQUE (id, scope_key)
);

CREATE TABLE public.comp_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id         uuid        NOT NULL,
  organization_id uuid        REFERENCES public.organizations(id),
  scope_key       uuid        NOT NULL GENERATED ALWAYS AS
                    (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  category        text        NOT NULL,
  carrier         text        NOT NULL,
  product_name    text        NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT comp_products_scope_reserved
    CHECK (organization_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT comp_products_category_valid CHECK (category IN ('term', 'whole_life', 'iul')),
  CONSTRAINT comp_products_carrier_valid
    CHECK (carrier = btrim(carrier) AND char_length(carrier) BETWEEN 1 AND 120),
  CONSTRAINT comp_products_name_valid
    CHECK (product_name = btrim(product_name) AND char_length(product_name) BETWEEN 1 AND 160),
  CONSTRAINT comp_products_grid_fk FOREIGN KEY (grid_id, scope_key)
    REFERENCES public.comp_grids (id, scope_key) ON DELETE CASCADE,
  CONSTRAINT comp_products_identity UNIQUE (grid_id, category, carrier, product_name),
  CONSTRAINT comp_products_id_grid_scope UNIQUE (id, grid_id, scope_key)
);

CREATE TABLE public.comp_product_variants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id         uuid        NOT NULL,
  product_id      uuid        NOT NULL,
  organization_id uuid        REFERENCES public.organizations(id),
  scope_key       uuid        NOT NULL GENERATED ALWAYS AS
                    (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  label           text        NOT NULL DEFAULT '',
  min_age         integer,
  max_age         integer,
  term_years      integer[],
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT comp_product_variants_scope_reserved
    CHECK (organization_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT comp_product_variants_label_valid CHECK (label = btrim(label) AND char_length(label) <= 120),
  CONSTRAINT comp_product_variants_min_age_valid CHECK (min_age IS NULL OR min_age BETWEEN 0 AND 100),
  CONSTRAINT comp_product_variants_max_age_valid CHECK (max_age IS NULL OR max_age BETWEEN 0 AND 100),
  CONSTRAINT comp_product_variants_age_order CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age),
  CONSTRAINT comp_product_variants_terms_valid CHECK (term_years IS NULL OR (
    array_ndims(term_years) = 1 AND cardinality(term_years) BETWEEN 1 AND 20
    AND array_position(term_years, NULL::integer) IS NULL
    AND 1 <= ALL (term_years) AND 100 >= ALL (term_years))),
  CONSTRAINT comp_product_variants_product_fk FOREIGN KEY (product_id, grid_id, scope_key)
    REFERENCES public.comp_products (id, grid_id, scope_key) ON DELETE CASCADE,
  CONSTRAINT comp_product_variants_label_unique UNIQUE (product_id, label),
  CONSTRAINT comp_product_variants_id_grid_scope UNIQUE (id, grid_id, scope_key)
);

CREATE TABLE public.comp_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id         uuid        NOT NULL,
  variant_id      uuid        NOT NULL,
  organization_id uuid        REFERENCES public.organizations(id),
  scope_key       uuid        NOT NULL GENERATED ALWAYS AS
                    (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  contract_level  integer     NOT NULL,
  -- Unconstrained numeric ON PURPOSE: numeric(6,2) would round 87.555 to 87.56 during input coercion,
  -- before any CHECK runs. Excess precision is rejected here instead, never rounded into validity.
  rate_percent    numeric     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT comp_rates_scope_reserved
    CHECK (organization_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT comp_rates_level_valid CHECK (contract_level BETWEEN 1 AND 999),
  CONSTRAINT comp_rates_rate_valid
    CHECK (rate_percent >= 0 AND rate_percent <= 300 AND rate_percent = round(rate_percent, 2)),
  CONSTRAINT comp_rates_variant_fk FOREIGN KEY (variant_id, grid_id, scope_key)
    REFERENCES public.comp_product_variants (id, grid_id, scope_key) ON DELETE CASCADE,
  CONSTRAINT comp_rates_variant_level_unique UNIQUE (variant_id, contract_level)
);

-- Protected reference metadata (source / notes): agency admins only, never agents.
CREATE TABLE public.comp_variant_references (
  variant_id      uuid        PRIMARY KEY,
  grid_id         uuid        NOT NULL,
  organization_id uuid        REFERENCES public.organizations(id),
  scope_key       uuid        NOT NULL GENERATED ALWAYS AS
                    (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  source          text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT comp_variant_references_scope_reserved
    CHECK (organization_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT comp_variant_references_source_valid
    CHECK (source IS NULL OR char_length(source) BETWEEN 1 AND 2000),
  CONSTRAINT comp_variant_references_notes_valid
    CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 4000),
  CONSTRAINT comp_variant_references_not_empty CHECK (source IS NOT NULL OR notes IS NOT NULL),
  CONSTRAINT comp_variant_references_variant_fk FOREIGN KEY (variant_id, grid_id, scope_key)
    REFERENCES public.comp_product_variants (id, grid_id, scope_key) ON DELETE CASCADE
);

-- AgentFlow makes ONE shared grid AVAILABLE to ONE agency (decision D5). Only an available grid appears in
-- that agency's catalog and can be enabled, read or copied by it. Server-only: written by the reviewed
-- postgres-only operations, never by a client role. The FK to (grid_id, nil scope) makes a private grid
-- unreachable.
CREATE TABLE public.organization_comp_grid_availability (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id),
  grid_id         uuid        NOT NULL,
  shared_scope    uuid        NOT NULL GENERATED ALWAYS AS
                    ('00000000-0000-0000-0000-000000000000'::uuid) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text        NOT NULL DEFAULT current_user,
  PRIMARY KEY (organization_id, grid_id),
  CONSTRAINT organization_comp_grid_availability_shared_grid_fk FOREIGN KEY (grid_id, shared_scope)
    REFERENCES public.comp_grids (id, scope_key) ON DELETE CASCADE
);

-- An agency's access to a SHARED grid. The FK to (grid_id, nil scope) makes a private grid unreachable;
-- the FK to availability means access exists only while the grid is available to that agency, and goes
-- with it (the access-revoked trigger then clears that agency's selection of the grid).
CREATE TABLE public.organization_comp_grids (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id),
  grid_id         uuid        NOT NULL,
  shared_scope    uuid        NOT NULL GENERATED ALWAYS AS
                    ('00000000-0000-0000-0000-000000000000'::uuid) STORED,
  enabled_at      timestamptz NOT NULL DEFAULT now(),
  enabled_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, grid_id),
  CONSTRAINT organization_comp_grids_shared_grid_fk FOREIGN KEY (grid_id, shared_scope)
    REFERENCES public.comp_grids (id, scope_key) ON DELETE CASCADE,
  CONSTRAINT organization_comp_grids_available_fk FOREIGN KEY (organization_id, grid_id)
    REFERENCES public.organization_comp_grid_availability (organization_id, grid_id) ON DELETE CASCADE
);

-- One row per agency; calculator_grid_id NULL = calculator not configured.
CREATE TABLE public.organization_comp_settings (
  organization_id    uuid        PRIMARY KEY REFERENCES public.organizations(id),
  calculator_grid_id uuid        REFERENCES public.comp_grids(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Reference-import ledger: provenance and verification of every AgentFlow reference-data import,
-- without any compensation value. Server-only (RLS on, no policies, no client privileges).
CREATE TABLE public.comp_reference_imports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id          uuid        NOT NULL REFERENCES public.comp_grids(id) ON DELETE RESTRICT,
  importer_version text        NOT NULL CHECK (importer_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  source_sha256    text        NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_sha256  text        NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256   text        NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  counts           jsonb       NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  verification     jsonb       NOT NULL CHECK (jsonb_typeof(verification) = 'object'),
  imported_at      timestamptz NOT NULL DEFAULT now(),
  imported_by      text        NOT NULL DEFAULT current_user,
  CONSTRAINT comp_reference_imports_unique UNIQUE (grid_id, source_sha256)
);

-- ── Indexes (every FK, tenant path and calculator lookup) ─────────────────────────────────────────────
CREATE INDEX comp_grids_organization_idx       ON public.comp_grids (organization_id);
CREATE INDEX comp_grids_copied_from_idx        ON public.comp_grids (copied_from_grid_id);
CREATE INDEX comp_grids_updated_by_idx         ON public.comp_grids (updated_by);
CREATE INDEX comp_products_grid_scope_idx      ON public.comp_products (grid_id, scope_key);
CREATE INDEX comp_products_organization_idx    ON public.comp_products (organization_id);
CREATE INDEX comp_products_updated_by_idx      ON public.comp_products (updated_by);
CREATE INDEX comp_variants_product_fk_idx      ON public.comp_product_variants (product_id, grid_id, scope_key);
CREATE INDEX comp_variants_grid_idx            ON public.comp_product_variants (grid_id);
CREATE INDEX comp_variants_organization_idx    ON public.comp_product_variants (organization_id);
CREATE INDEX comp_variants_updated_by_idx      ON public.comp_product_variants (updated_by);
CREATE INDEX comp_rates_variant_fk_idx         ON public.comp_rates (variant_id, grid_id, scope_key);
CREATE INDEX comp_rates_grid_idx               ON public.comp_rates (grid_id);
CREATE INDEX comp_rates_organization_idx       ON public.comp_rates (organization_id);
CREATE INDEX comp_rates_updated_by_idx         ON public.comp_rates (updated_by);
CREATE INDEX comp_references_variant_fk_idx    ON public.comp_variant_references (variant_id, grid_id, scope_key);
CREATE INDEX comp_references_grid_idx          ON public.comp_variant_references (grid_id);
CREATE INDEX comp_references_organization_idx  ON public.comp_variant_references (organization_id);
CREATE INDEX comp_references_updated_by_idx    ON public.comp_variant_references (updated_by);
CREATE INDEX organization_comp_grid_availability_grid_idx ON public.organization_comp_grid_availability (grid_id, shared_scope);
CREATE INDEX organization_comp_grids_grid_idx  ON public.organization_comp_grids (grid_id, shared_scope);
CREATE INDEX organization_comp_grids_by_idx    ON public.organization_comp_grids (enabled_by);
CREATE INDEX organization_comp_settings_grid_idx ON public.organization_comp_settings (calculator_grid_id);
CREATE INDEX organization_comp_settings_by_idx ON public.organization_comp_settings (updated_by);
CREATE INDEX comp_reference_imports_grid_idx   ON public.comp_reference_imports (grid_id);

-- ── Actor predicates (schema comp_authz; precedent: profile_authz) ───────────────────────────────────
-- Caller-only wrappers over the canonical DB-authoritative resolver private.campaign_actor()
-- (Active profile, profile org = get_org_id()). SECURITY DEFINER only because campaign_actor is not
-- client-executable (AGENT_RULES #34: no second actor resolver). No parameters; they describe the CALLER.
CREATE SCHEMA comp_authz;
REVOKE ALL ON SCHEMA comp_authz FROM PUBLIC;
GRANT USAGE ON SCHEMA comp_authz TO authenticated, service_role;

CREATE FUNCTION comp_authz.actor_org_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT a.org_id INTO v_org FROM private.campaign_actor() a;
  RETURN v_org;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN NULL;
END $$;

-- Agency admin = Admin / Super Admin role or is_super_admin, in the caller's HOME organization only.
CREATE FUNCTION comp_authz.actor_is_admin()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_admin boolean;
BEGIN
  SELECT (a.actor_role IN ('Admin', 'Super Admin') OR coalesce(a.is_super, false))
    INTO v_admin FROM private.campaign_actor() a;
  RETURN coalesce(v_admin, false);
EXCEPTION WHEN insufficient_privilege THEN
  RETURN false;
END $$;

-- Grids whose content the caller may read: own private grids, plus shared grids the caller's
-- organization has enabled. Agents see active grids only; agency admins also see inactive ones.
CREATE FUNCTION comp_authz.readable_grid_ids()
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org   uuid;
  v_admin boolean;
  v_ids   uuid[];
BEGIN
  SELECT a.org_id, (a.actor_role IN ('Admin', 'Super Admin') OR coalesce(a.is_super, false))
    INTO v_org, v_admin FROM private.campaign_actor() a;
  SELECT coalesce(array_agg(g.id ORDER BY g.id), '{}'::uuid[]) INTO v_ids
    FROM public.comp_grids g
   WHERE (g.is_active OR v_admin)
     AND (g.organization_id = v_org
          OR (g.organization_id IS NULL AND EXISTS (
                SELECT 1 FROM public.organization_comp_grids a
                 WHERE a.organization_id = v_org AND a.grid_id = g.id)));
  RETURN v_ids;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN '{}'::uuid[];
END $$;

REVOKE ALL ON FUNCTION comp_authz.actor_org_id(), comp_authz.actor_is_admin(), comp_authz.readable_grid_ids()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION comp_authz.actor_org_id(), comp_authz.actor_is_admin(), comp_authz.readable_grid_ids()
  TO authenticated, service_role;

-- ── Trigger functions (schema private; never client-callable) ─────────────────────────────────────────
-- 00: a client write (authenticated / anon) is possible only inside a comp_* operation, only on a row of
-- the caller's own agency, and only by an agency admin — the same predicate as the RLS write policies,
-- checked here FIRST (alphabetical order) so that no later SECURITY DEFINER trigger ever runs, locks or
-- reads on behalf of a client for a row the client may not write (an INSERT's RLS check runs only after
-- the BEFORE ROW triggers). Rows of shared grids (organization_id NULL) are never client-writable.
-- SECURITY INVOKER: it must see the client role, not the owner.
CREATE FUNCTION private.comp_require_operation_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_row_org uuid;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF current_setting('agentflow.comp_operation', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Commission grid data can only be changed through AgentFlow operations'
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN v_row_org := OLD.organization_id; ELSE v_row_org := NEW.organization_id; END IF;
    IF v_row_org IS NULL OR v_row_org IS DISTINCT FROM comp_authz.actor_org_id()
       OR NOT comp_authz.actor_is_admin() THEN
      RAISE EXCEPTION 'Only an agency admin can change their own agency''s commission grids'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- 10: server-assigned audit stamps and immutable identity columns. TG_ARGV lists the immutable columns;
-- copied_from_grid_id may only become NULL (its FK is ON DELETE SET NULL).
CREATE FUNCTION private.comp_stamp_and_freeze()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_new jsonb;
  v_old jsonb;
  v_col text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    v_new := to_jsonb(NEW);
    v_old := to_jsonb(OLD);
    FOREACH v_col IN ARRAY TG_ARGV LOOP
      IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
        RAISE EXCEPTION '% is fixed once created', v_col USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF (v_new ? 'copied_from_grid_id')
       AND (v_new -> 'copied_from_grid_id') IS DISTINCT FROM (v_old -> 'copied_from_grid_id')
       AND (v_new -> 'copied_from_grid_id') <> 'null'::jsonb THEN
      RAISE EXCEPTION 'copied_from_grid_id is fixed once created' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

CREATE FUNCTION private.comp_stamp_access()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'agency grid access rows are not updatable' USING ERRCODE = '42501';
  END IF;
  NEW.enabled_at := now();
  NEW.enabled_by := auth.uid();
  RETURN NEW;
END $$;

-- 20 (comp_grids): levels strictly descending; revision bumps on every update; a level is never removed
-- while rates remain at it; a copy must name an ENABLED shared source, which is locked FOR SHARE so a
-- concurrent source edit, deactivation, deletion or access revocation waits for the copy to commit.
-- SECURITY DEFINER: the caller cannot lock (or update) a shared grid row itself.
CREATE FUNCTION private.comp_grid_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i         integer;
  v_src_org uuid;
  v_found   boolean;
BEGIN
  FOR i IN 2 .. cardinality(NEW.contract_levels) LOOP
    IF NEW.contract_levels[i] >= NEW.contract_levels[i - 1] THEN
      RAISE EXCEPTION 'Contract levels must be distinct and listed highest first' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_OP = 'INSERT' THEN
    NEW.revision := 1;
    IF NEW.copied_from_grid_id IS NOT NULL THEN
      -- Only a SHARED grid is ever looked up (and locked) here; a private grid id is "not available".
      SELECT g.organization_id, true INTO v_src_org, v_found
        FROM public.comp_grids g
       WHERE g.id = NEW.copied_from_grid_id AND g.organization_id IS NULL FOR SHARE;
      IF v_found IS NOT TRUE OR v_src_org IS NOT NULL THEN
        RAISE EXCEPTION 'That source grid is not available' USING ERRCODE = 'PT404';
      END IF;
      PERFORM 1 FROM public.organization_comp_grids a
        WHERE a.organization_id = NEW.organization_id AND a.grid_id = NEW.copied_from_grid_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Enable that AgentFlow grid for your agency before copying it' USING ERRCODE = 'PT404';
      END IF;
    END IF;
  ELSE
    NEW.revision := OLD.revision + 1;
    IF NEW.contract_levels IS DISTINCT FROM OLD.contract_levels AND EXISTS (
         SELECT 1 FROM public.comp_rates r
          WHERE r.grid_id = NEW.id AND NOT (r.contract_level = ANY (NEW.contract_levels))) THEN
      RAISE EXCEPTION 'Remove the rates at a contract level before removing the level' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 30 (comp_grids): deactivating a grid clears every calculator selection that points at it (all
-- agencies for a shared grid). Never selects a replacement.
CREATE FUNCTION private.comp_grid_deactivated()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.organization_comp_settings
     SET calculator_grid_id = NULL
   WHERE calculator_grid_id = NEW.id;
  RETURN NULL;
END $$;

-- 20 (child tables): lock the parent grid row before any child change (lock order grid -> child), and
-- enforce rate level membership against the locked grid. A rate write and a level removal therefore
-- serialize on the grid row, and whichever runs second re-reads the other's committed result. Only a
-- grid in the row's own scope is locked (a mismatched row fails its composite foreign key anyway).
CREATE FUNCTION private.comp_child_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_grid_id uuid;
  v_scope   uuid;
  v_levels  integer[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_grid_id := OLD.grid_id; v_scope := coalesce(OLD.organization_id, '00000000-0000-0000-0000-000000000000');
  ELSE
    v_grid_id := NEW.grid_id; v_scope := coalesce(NEW.organization_id, '00000000-0000-0000-0000-000000000000');
  END IF;
  SELECT g.contract_levels INTO v_levels
    FROM public.comp_grids g WHERE g.id = v_grid_id AND g.scope_key = v_scope FOR NO KEY UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grid not found' USING ERRCODE = '23503';
  END IF;
  IF TG_TABLE_NAME = 'comp_rates' THEN
    -- Nested: the rate column exists only on comp_rates (PL/pgSQL prepares this per table, lazily).
    IF NOT (NEW.contract_level = ANY (v_levels)) THEN
      RAISE EXCEPTION 'Contract level % is not on this grid', NEW.contract_level USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 40 (child tables, statement level): any content change bumps the parent grid's revision and
-- last-editor fields once per statement (the grid BEFORE UPDATE trigger does the bump and stamp).
CREATE FUNCTION private.comp_bump_grid_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comp_grids g SET updated_at = now()
     WHERE g.id IN (SELECT DISTINCT n.grid_id FROM comp_new_rows n);
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.comp_grids g SET updated_at = now()
     WHERE g.id IN (SELECT DISTINCT n.grid_id FROM comp_new_rows n);
  ELSE
    UPDATE public.comp_grids g SET updated_at = now()
     WHERE g.id IN (SELECT DISTINCT o.grid_id FROM comp_old_rows o);
  END IF;
  RETURN NULL;
END $$;

-- 50 (comp_product_variants, DEFERRED constraint trigger): per product, no two variants may match the
-- same (age, term): intersecting inclusive age ranges AND overlapping term domains (both without terms,
-- or sharing a term length). A product may not mix term and non-term variants; a blank label is allowed
-- only on a single-variant product; term lengths in a variant are distinct. The product row is locked
-- first, and the checks run in a later statement (fresh snapshot after the lock), so two concurrent
-- writers of one product cannot both pass.
CREATE FUNCTION private.comp_variant_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_has_term    boolean;
  v_has_no_term boolean;
  v_count       integer;
  v_blank       integer;
BEGIN
  PERFORM 1 FROM public.comp_products p WHERE p.id = NEW.product_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;  -- product removed later in the same transaction
  END IF;

  SELECT bool_or(v.term_years IS NOT NULL), bool_or(v.term_years IS NULL), count(*),
         count(*) FILTER (WHERE v.label = '')
    INTO v_has_term, v_has_no_term, v_count, v_blank
    FROM public.comp_product_variants v WHERE v.product_id = NEW.product_id;

  IF v_has_term AND v_has_no_term THEN
    RAISE EXCEPTION 'A product cannot mix variants with and without term lengths' USING ERRCODE = '23514';
  END IF;
  IF v_blank > 0 AND v_count > 1 THEN
    RAISE EXCEPTION 'Only a single-variant product may leave the variant label blank' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.comp_product_variants v
        WHERE v.product_id = NEW.product_id AND v.term_years IS NOT NULL
          AND (SELECT count(DISTINCT t) FROM unnest(v.term_years) t) <> cardinality(v.term_years)) THEN
    RAISE EXCEPTION 'A variant lists the same term length twice' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
       SELECT 1
         FROM public.comp_product_variants a
         JOIN public.comp_product_variants b ON b.product_id = a.product_id AND a.id < b.id
        WHERE a.product_id = NEW.product_id
          AND int4range(coalesce(a.min_age, 0), coalesce(a.max_age, 100), '[]')
              && int4range(coalesce(b.min_age, 0), coalesce(b.max_age, 100), '[]')
          AND ((a.term_years IS NULL AND b.term_years IS NULL) OR a.term_years && b.term_years)) THEN
    RAISE EXCEPTION 'Two variants of this product would match the same age and term' USING ERRCODE = '23P01';
  END IF;
  RETURN NULL;
END $$;

-- 20 (organization_comp_settings): a selected calculator grid must be ACTIVE and either the agency's
-- own private grid or a shared grid the agency has enabled. Locks the grid row and (shared) the access
-- row FOR SHARE, so a concurrent deactivation / deletion / disable waits for this commit and then clears
-- the selection, or commits first and this locking read sees it and refuses.
CREATE FUNCTION private.comp_selection_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id is fixed once created' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); ELSE NEW.created_at := OLD.created_at; END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();

  IF NEW.calculator_grid_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.calculator_grid_id IS NOT DISTINCT FROM OLD.calculator_grid_id) THEN
    RETURN NEW;
  END IF;
  -- Only a shared grid or this agency's own grid is ever looked up (and locked) here.
  SELECT g.organization_id, g.is_active INTO v_org, v_active
    FROM public.comp_grids g
   WHERE g.id = NEW.calculator_grid_id
     AND (g.organization_id IS NULL OR g.organization_id = NEW.organization_id) FOR SHARE;
  IF NOT FOUND OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'That grid is not available for the calculator' USING ERRCODE = 'PT404';
  END IF;
  IF v_org IS NULL THEN
    PERFORM 1 FROM public.organization_comp_grids a
      WHERE a.organization_id = NEW.organization_id AND a.grid_id = NEW.calculator_grid_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That grid is not available for the calculator' USING ERRCODE = 'PT404';
    END IF;
  ELSIF v_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'That grid is not available for the calculator' USING ERRCODE = 'PT404';
  END IF;
  RETURN NEW;
END $$;

-- 20 (organization_comp_grids): only an ACTIVE shared grid that AgentFlow has made AVAILABLE to this
-- agency can be enabled (decision D5; the FKs already force shared and available). The grid row and the
-- availability row are locked FOR SHARE, so a concurrent deactivation or availability removal serializes
-- with the enable. A missing grid and an unavailable one give the same answer.
CREATE FUNCTION private.comp_access_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_active boolean;
  v_found  boolean;
BEGIN
  SELECT g.organization_id, g.is_active, true INTO v_org, v_active, v_found
    FROM public.comp_grids g WHERE g.id = NEW.grid_id AND g.organization_id IS NULL FOR SHARE;
  IF v_found IS NOT TRUE OR v_org IS NOT NULL OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'That AgentFlow grid is not available' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM public.organization_comp_grid_availability v
    WHERE v.organization_id = NEW.organization_id AND v.grid_id = NEW.grid_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That AgentFlow grid is not available' USING ERRCODE = 'PT404';
  END IF;
  RETURN NEW;
END $$;

-- 30 (organization_comp_grids): disabling a shared grid clears that agency's selection only when it
-- points at that grid. Private copies are untouched; no replacement is selected.
CREATE FUNCTION private.comp_access_revoked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.organization_comp_settings
     SET calculator_grid_id = NULL
   WHERE organization_id = OLD.organization_id AND calculator_grid_id = OLD.grid_id;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION
  private.comp_require_operation_context(), private.comp_stamp_and_freeze(), private.comp_stamp_access(),
  private.comp_grid_rules(), private.comp_grid_deactivated(), private.comp_child_rules(),
  private.comp_bump_grid_revision(), private.comp_variant_rules(), private.comp_selection_rules(),
  private.comp_access_rules(), private.comp_access_revoked()
FROM PUBLIC, anon, authenticated;

-- ── Triggers ─────────────────────────────────────────────────────────────────────────────────────────
-- comp_grids
CREATE TRIGGER comp_00_operation_context BEFORE INSERT OR UPDATE OR DELETE ON public.comp_grids
  FOR EACH ROW EXECUTE FUNCTION private.comp_require_operation_context();
CREATE TRIGGER comp_10_stamp BEFORE INSERT OR UPDATE ON public.comp_grids
  FOR EACH ROW EXECUTE FUNCTION private.comp_stamp_and_freeze('id', 'organization_id', 'origin');
CREATE TRIGGER comp_20_grid_rules BEFORE INSERT OR UPDATE ON public.comp_grids
  FOR EACH ROW EXECUTE FUNCTION private.comp_grid_rules();
CREATE TRIGGER comp_30_grid_deactivated AFTER UPDATE OF is_active ON public.comp_grids
  FOR EACH ROW WHEN (OLD.is_active AND NOT NEW.is_active)
  EXECUTE FUNCTION private.comp_grid_deactivated();

-- comp_products
CREATE TRIGGER comp_00_operation_context BEFORE INSERT OR UPDATE OR DELETE ON public.comp_products
  FOR EACH ROW EXECUTE FUNCTION private.comp_require_operation_context();
CREATE TRIGGER comp_10_stamp BEFORE INSERT OR UPDATE ON public.comp_products
  FOR EACH ROW EXECUTE FUNCTION private.comp_stamp_and_freeze('id', 'grid_id', 'organization_id');
CREATE TRIGGER comp_20_lock_grid BEFORE INSERT OR UPDATE OR DELETE ON public.comp_products
  FOR EACH ROW EXECUTE FUNCTION private.comp_child_rules();
CREATE TRIGGER comp_40_revision_ins AFTER INSERT ON public.comp_products
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_upd AFTER UPDATE ON public.comp_products
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_del AFTER DELETE ON public.comp_products
  REFERENCING OLD TABLE AS comp_old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();

-- comp_product_variants
CREATE TRIGGER comp_00_operation_context BEFORE INSERT OR UPDATE OR DELETE ON public.comp_product_variants
  FOR EACH ROW EXECUTE FUNCTION private.comp_require_operation_context();
CREATE TRIGGER comp_10_stamp BEFORE INSERT OR UPDATE ON public.comp_product_variants
  FOR EACH ROW EXECUTE FUNCTION private.comp_stamp_and_freeze('id', 'grid_id', 'product_id', 'organization_id');
CREATE TRIGGER comp_20_lock_grid BEFORE INSERT OR UPDATE OR DELETE ON public.comp_product_variants
  FOR EACH ROW EXECUTE FUNCTION private.comp_child_rules();
CREATE TRIGGER comp_40_revision_ins AFTER INSERT ON public.comp_product_variants
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_upd AFTER UPDATE ON public.comp_product_variants
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_del AFTER DELETE ON public.comp_product_variants
  REFERENCING OLD TABLE AS comp_old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE CONSTRAINT TRIGGER comp_50_variant_rules AFTER INSERT OR UPDATE ON public.comp_product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.comp_variant_rules();

-- comp_rates
CREATE TRIGGER comp_00_operation_context BEFORE INSERT OR UPDATE OR DELETE ON public.comp_rates
  FOR EACH ROW EXECUTE FUNCTION private.comp_require_operation_context();
CREATE TRIGGER comp_10_stamp BEFORE INSERT OR UPDATE ON public.comp_rates
  FOR EACH ROW EXECUTE FUNCTION private.comp_stamp_and_freeze('id', 'grid_id', 'variant_id', 'organization_id', 'contract_level');
CREATE TRIGGER comp_20_lock_grid BEFORE INSERT OR UPDATE OR DELETE ON public.comp_rates
  FOR EACH ROW EXECUTE FUNCTION private.comp_child_rules();
CREATE TRIGGER comp_40_revision_ins AFTER INSERT ON public.comp_rates
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_upd AFTER UPDATE ON public.comp_rates
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_del AFTER DELETE ON public.comp_rates
  REFERENCING OLD TABLE AS comp_old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();

-- comp_variant_references
CREATE TRIGGER comp_00_operation_context BEFORE INSERT OR UPDATE OR DELETE ON public.comp_variant_references
  FOR EACH ROW EXECUTE FUNCTION private.comp_require_operation_context();
CREATE TRIGGER comp_10_stamp BEFORE INSERT OR UPDATE ON public.comp_variant_references
  FOR EACH ROW EXECUTE FUNCTION private.comp_stamp_and_freeze('variant_id', 'grid_id', 'organization_id');
CREATE TRIGGER comp_20_lock_grid BEFORE INSERT OR UPDATE OR DELETE ON public.comp_variant_references
  FOR EACH ROW EXECUTE FUNCTION private.comp_child_rules();
CREATE TRIGGER comp_40_revision_ins AFTER INSERT ON public.comp_variant_references
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_upd AFTER UPDATE ON public.comp_variant_references
  REFERENCING NEW TABLE AS comp_new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();
CREATE TRIGGER comp_40_revision_del AFTER DELETE ON public.comp_variant_references
  REFERENCING OLD TABLE AS comp_old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.comp_bump_grid_revision();

-- organization_comp_grids
CREATE TRIGGER comp_00_operation_context BEFORE INSERT OR UPDATE OR DELETE ON public.organization_comp_grids
  FOR EACH ROW EXECUTE FUNCTION private.comp_require_operation_context();
CREATE TRIGGER comp_10_stamp BEFORE INSERT OR UPDATE ON public.organization_comp_grids
  FOR EACH ROW EXECUTE FUNCTION private.comp_stamp_access();
CREATE TRIGGER comp_20_access_rules BEFORE INSERT ON public.organization_comp_grids
  FOR EACH ROW EXECUTE FUNCTION private.comp_access_rules();
CREATE TRIGGER comp_30_access_revoked AFTER DELETE ON public.organization_comp_grids
  FOR EACH ROW EXECUTE FUNCTION private.comp_access_revoked();

-- organization_comp_settings
CREATE TRIGGER comp_00_operation_context BEFORE INSERT OR UPDATE OR DELETE ON public.organization_comp_settings
  FOR EACH ROW EXECUTE FUNCTION private.comp_require_operation_context();
CREATE TRIGGER comp_20_selection_rules BEFORE INSERT OR UPDATE ON public.organization_comp_settings
  FOR EACH ROW EXECUTE FUNCTION private.comp_selection_rules();

-- ── Row-level security ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.comp_grids                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comp_products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comp_product_variants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comp_rates                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comp_variant_references    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_comp_grids    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_comp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comp_reference_imports     ENABLE ROW LEVEL SECURITY;  -- no policies: server-only
ALTER TABLE public.organization_comp_grid_availability ENABLE ROW LEVEL SECURITY;  -- no policies: server-only

-- Reads: readable grids only. Agents see active products only (and therefore only their variants and
-- rates); agency admins also see inactive content and the protected references.
CREATE POLICY comp_grids_select ON public.comp_grids FOR SELECT TO authenticated
  USING (id = ANY ((SELECT comp_authz.readable_grid_ids())::uuid[]));
CREATE POLICY comp_products_select ON public.comp_products FOR SELECT TO authenticated
  USING (grid_id = ANY ((SELECT comp_authz.readable_grid_ids())::uuid[])
         AND (is_active OR (SELECT comp_authz.actor_is_admin())));
CREATE POLICY comp_product_variants_select ON public.comp_product_variants FOR SELECT TO authenticated
  USING (grid_id = ANY ((SELECT comp_authz.readable_grid_ids())::uuid[])
         AND product_id IN (SELECT p.id FROM public.comp_products p));
CREATE POLICY comp_rates_select ON public.comp_rates FOR SELECT TO authenticated
  USING (grid_id = ANY ((SELECT comp_authz.readable_grid_ids())::uuid[])
         AND variant_id IN (SELECT v.id FROM public.comp_product_variants v));
CREATE POLICY comp_variant_references_select ON public.comp_variant_references FOR SELECT TO authenticated
  USING (grid_id = ANY ((SELECT comp_authz.readable_grid_ids())::uuid[]) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY organization_comp_grids_select ON public.organization_comp_grids FOR SELECT TO authenticated
  USING (organization_id = (SELECT comp_authz.actor_org_id()));
CREATE POLICY organization_comp_settings_select ON public.organization_comp_settings FOR SELECT TO authenticated
  USING (organization_id = (SELECT comp_authz.actor_org_id()));

-- Writes: inside a comp_* operation only, by an agency admin, on rows of the admin's own organization.
-- organization_id = <actor org> can never match a shared (NULL) row, so shared content is not writable.
CREATE POLICY comp_grids_insert ON public.comp_grids FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_grids_update ON public.comp_grids FOR UPDATE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_grids_delete ON public.comp_grids FOR DELETE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

CREATE POLICY comp_products_insert ON public.comp_products FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_products_update ON public.comp_products FOR UPDATE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_products_delete ON public.comp_products FOR DELETE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

CREATE POLICY comp_product_variants_insert ON public.comp_product_variants FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_product_variants_update ON public.comp_product_variants FOR UPDATE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_product_variants_delete ON public.comp_product_variants FOR DELETE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

CREATE POLICY comp_rates_insert ON public.comp_rates FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_rates_update ON public.comp_rates FOR UPDATE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_rates_delete ON public.comp_rates FOR DELETE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

CREATE POLICY comp_variant_references_insert ON public.comp_variant_references FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_variant_references_update ON public.comp_variant_references FOR UPDATE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY comp_variant_references_delete ON public.comp_variant_references FOR DELETE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

CREATE POLICY organization_comp_grids_insert ON public.organization_comp_grids FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY organization_comp_grids_delete ON public.organization_comp_grids FOR DELETE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

CREATE POLICY organization_comp_settings_insert ON public.organization_comp_settings FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));
CREATE POLICY organization_comp_settings_update ON public.organization_comp_settings FOR UPDATE TO authenticated
  USING ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
         AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()))
  WITH CHECK ((SELECT current_setting('agentflow.comp_operation', true)) = 'on'
              AND organization_id = (SELECT comp_authz.actor_org_id()) AND (SELECT comp_authz.actor_is_admin()));

-- ── Privileges ──────────────────────────────────────────────────────────────────────────────────────
-- Supabase's default privileges grant every new public table to anon/authenticated/service_role; reset
-- them and grant exactly what the security-invoker operations need. Audit, revision, scope and id
-- columns are never client-writable (server-generated ids and stamps).
REVOKE ALL ON TABLE public.comp_grids, public.comp_products, public.comp_product_variants, public.comp_rates,
  public.comp_variant_references, public.organization_comp_grids, public.organization_comp_settings,
  public.comp_reference_imports, public.organization_comp_grid_availability
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.comp_grids, public.comp_products, public.comp_product_variants, public.comp_rates,
  public.comp_variant_references, public.organization_comp_grids, public.organization_comp_settings
  TO authenticated;

-- comp_grids.id is insertable so an operation can create the grid with an id it generated itself:
-- INSERT ... RETURNING would have to pass the SELECT policy, whose readable-grid list is computed before
-- the row exists. Clients still cannot insert directly (operation-context gate).
GRANT INSERT (id, organization_id, name, effective_date, is_active, contract_levels, origin, copied_from_grid_id)
  ON public.comp_grids TO authenticated;
GRANT UPDATE (name, effective_date, is_active, contract_levels) ON public.comp_grids TO authenticated;
GRANT DELETE ON public.comp_grids TO authenticated;

GRANT INSERT (grid_id, organization_id, category, carrier, product_name, is_active)
  ON public.comp_products TO authenticated;
GRANT UPDATE (category, carrier, product_name, is_active) ON public.comp_products TO authenticated;
GRANT DELETE ON public.comp_products TO authenticated;

GRANT INSERT (grid_id, product_id, organization_id, label, min_age, max_age, term_years)
  ON public.comp_product_variants TO authenticated;
GRANT UPDATE (label, min_age, max_age, term_years) ON public.comp_product_variants TO authenticated;
GRANT DELETE ON public.comp_product_variants TO authenticated;

GRANT INSERT (grid_id, variant_id, organization_id, contract_level, rate_percent)
  ON public.comp_rates TO authenticated;
GRANT UPDATE (rate_percent) ON public.comp_rates TO authenticated;
GRANT DELETE ON public.comp_rates TO authenticated;

GRANT INSERT (variant_id, grid_id, organization_id, source, notes) ON public.comp_variant_references TO authenticated;
GRANT UPDATE (source, notes) ON public.comp_variant_references TO authenticated;
GRANT DELETE ON public.comp_variant_references TO authenticated;

GRANT INSERT (organization_id, grid_id) ON public.organization_comp_grids TO authenticated;
GRANT DELETE ON public.organization_comp_grids TO authenticated;

GRANT INSERT (organization_id, calculator_grid_id) ON public.organization_comp_settings TO authenticated;
GRANT UPDATE (calculator_grid_id) ON public.organization_comp_settings TO authenticated;

-- service_role (server tooling, BYPASSRLS): read-only. Shared grids change only through the postgres-only
-- reference-import functions or a reviewed migration, and agency data only through the client operations,
-- so no server key can write commission data directly.
GRANT SELECT ON TABLE public.comp_grids, public.comp_products, public.comp_product_variants, public.comp_rates,
  public.comp_variant_references, public.organization_comp_grids, public.organization_comp_settings,
  public.comp_reference_imports, public.organization_comp_grid_availability
  TO service_role;

-- No peer-agency (Agency Group) read, no platform-role branch, no is_super_admin() cross-tenant branch.
-- Availability rows have no client privilege at all: an agency learns what is available to it only
-- through the catalog operation, and only for its own organization.
