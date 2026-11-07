-- Reports V2 PKG-D (D4 §3.2): appointment-type business categories with an audited history. Privilege class C: no
-- GRANT; every function created here is revoked from PUBLIC, anon, authenticated and service_role. No RLS change.
--
--   public.appointment_types.business_category  sales | follow_up | callback | recruiting | review | service | other |
--                                                unclassified (default), plus classified_by / classified_at
--   private.appointment_type_category_events     one event per INSERT and per change of name, is_active or category
--   private.guard_appointment_type_classification  locked defaults keep their name, flags and category; the seeded
--                                                names map on insert; a custom category change is stamped
--   private.audit_appointment_type_category       writes the events (source: ops GUC, system_seed or settings)
SET LOCAL lock_timeout = '2s';

DO $guard$
BEGIN
  IF to_regclass('public.appointment_types') IS NULL THEN
    RAISE EXCEPTION 'Appointment type categories: public.appointment_types is missing' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'appointment_types'
              AND column_name IN ('business_category', 'classified_by', 'classified_at'))
     OR to_regclass('private.appointment_type_category_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Appointment type categories: refusing replay' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ALTER TABLE public.appointment_types
  ADD COLUMN business_category text NOT NULL DEFAULT 'unclassified'
    CONSTRAINT appointment_types_business_category_chk
    CHECK (business_category IN ('sales', 'follow_up', 'callback', 'recruiting', 'review', 'service', 'other', 'unclassified')),
  ADD COLUMN classified_by uuid,
  ADD COLUMN classified_at timestamptz;

-- No FK: the history survives a removed type. A type's state at an instant is the earliest event's "before" values,
-- then each event in order; with no event, the current row. Renames before this migration cannot be known.
CREATE TABLE private.appointment_type_category_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  name_before text,
  name_after text NOT NULL,
  is_active_before boolean,
  is_active_after boolean NOT NULL,
  category_before text,
  category_after text NOT NULL,
  changed_by uuid,
  source text NOT NULL CHECK (source IN ('settings', 'system_seed', 'ops_baseline', 'ops_revert')),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX appointment_type_category_events_type ON private.appointment_type_category_events (type_id, changed_at, id);
CREATE INDEX appointment_type_category_events_org ON private.appointment_type_category_events (organization_id, changed_at);
ALTER TABLE private.appointment_type_category_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.appointment_type_category_events FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_appointment_type_category_events() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Appointment type category history is append-only' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION private.guard_appointment_type_category_events() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER appointment_type_category_events_append_only BEFORE UPDATE OR DELETE ON private.appointment_type_category_events
  FOR EACH ROW EXECUTE FUNCTION private.guard_appointment_type_category_events();
CREATE TRIGGER appointment_type_category_events_no_truncate BEFORE TRUNCATE ON private.appointment_type_category_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.guard_appointment_type_category_events();

-- The seeded default names (baseline seed_default_appointment_types) and their categories.
CREATE FUNCTION private.appointment_type_seed_category(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE lower(btrim(p_name))
    WHEN 'sales call' THEN 'sales' WHEN 'follow up' THEN 'follow_up' WHEN 'recruit interview' THEN 'recruiting'
    WHEN 'policy review' THEN 'review' WHEN 'policy anniversary' THEN 'review' WHEN 'other' THEN 'other' END
$$;
REVOKE ALL ON FUNCTION private.appointment_type_seed_category(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_appointment_type_classification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
-- INVOKER (D4 §3.2): it reads nothing in schema private, so it runs for every writer, including authenticated.
DECLARE
  v_privileged boolean := current_user IN ('postgres', 'service_role');
  v_seed text := CASE lower(btrim(NEW.name))  -- the same map as private.appointment_type_seed_category
    WHEN 'sales call' THEN 'sales' WHEN 'follow up' THEN 'follow_up' WHEN 'recruit interview' THEN 'recruiting'
    WHEN 'policy review' THEN 'review' WHEN 'policy anniversary' THEN 'review' WHEN 'other' THEN 'other' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_locked AND NEW.is_default AND NEW.business_category = 'unclassified' AND v_seed IS NOT NULL THEN
      NEW.business_category := v_seed;
    ELSIF NOT v_privileged AND (NEW.is_locked OR NEW.is_default) THEN
      RAISE EXCEPTION 'Default appointment types are managed by AgentFlow' USING ERRCODE = '42501';
    END IF;
    IF NEW.business_category <> 'unclassified' AND NOT (NEW.is_locked AND NEW.is_default) THEN
      NEW.classified_by := auth.uid();
      NEW.classified_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NOT v_privileged AND OLD.is_locked
     AND (NEW.name, NEW.is_default, NEW.is_locked, NEW.is_active, NEW.business_category)
         IS DISTINCT FROM (OLD.name, OLD.is_default, OLD.is_locked, OLD.is_active, OLD.business_category) THEN
    RAISE EXCEPTION 'Default appointment types are managed by AgentFlow' USING ERRCODE = '42501';
  END IF;
  IF NOT v_privileged AND NOT OLD.is_locked AND (NEW.is_locked OR NEW.is_default) THEN
    RAISE EXCEPTION 'Default appointment types are managed by AgentFlow' USING ERRCODE = '42501';
  END IF;
  IF NEW.business_category IS DISTINCT FROM OLD.business_category THEN
    NEW.classified_by := auth.uid();
    NEW.classified_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_appointment_type_classification() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER appointment_types_classification_guard BEFORE INSERT OR UPDATE ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION private.guard_appointment_type_classification();

CREATE FUNCTION private.audit_appointment_type_category() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_source text := nullif(current_setting('agentflow.appointment_category_source', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.name, NEW.is_active, NEW.business_category)
                          IS NOT DISTINCT FROM (OLD.name, OLD.is_active, OLD.business_category) THEN
    RETURN NULL;
  END IF;
  IF v_source IS NOT NULL AND v_source NOT IN ('ops_baseline', 'ops_revert') THEN
    RAISE EXCEPTION 'Invalid appointment category source %', v_source USING ERRCODE = '22023';
  END IF;
  INSERT INTO private.appointment_type_category_events (type_id, organization_id, name_before, name_after,
    is_active_before, is_active_after, category_before, category_after, changed_by, source)
  VALUES (NEW.id, NEW.organization_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.name END, NEW.name,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.is_active END, NEW.is_active,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.business_category END, NEW.business_category,
    auth.uid(),
    coalesce(v_source, CASE WHEN TG_OP = 'INSERT' AND NEW.is_default AND NEW.is_locked THEN 'system_seed' ELSE 'settings' END));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.audit_appointment_type_category() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER appointment_types_category_audit AFTER INSERT OR UPDATE ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION private.audit_appointment_type_category();

-- A type's (name, is_active, category) at an instant, from its audited history (D4 §3.2).
CREATE FUNCTION private.appointment_type_state_at(p_type_id uuid, p_at timestamptz)
RETURNS TABLE (name text, is_active boolean, category text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH last_before AS (
    SELECT e.name_after, e.is_active_after, e.category_after FROM private.appointment_type_category_events e
     WHERE e.type_id = p_type_id AND e.changed_at <= p_at ORDER BY e.changed_at DESC, e.id DESC LIMIT 1),
  first_event AS (
    SELECT e.name_before, e.is_active_before, e.category_before, e.name_after, e.is_active_after, e.category_after
      FROM private.appointment_type_category_events e WHERE e.type_id = p_type_id ORDER BY e.changed_at, e.id LIMIT 1)
  SELECT l.name_after, l.is_active_after, l.category_after FROM last_before l
  UNION ALL
  SELECT coalesce(f.name_before, f.name_after), coalesce(f.is_active_before, f.is_active_after), coalesce(f.category_before, 'unclassified')
    FROM first_event f
   WHERE NOT EXISTS (SELECT 1 FROM last_before)
     AND f.name_before IS NOT NULL  -- the type existed before its first event (an UPDATE); an INSERT after p_at did not exist yet
  UNION ALL
  SELECT t.name, t.is_active, t.business_category FROM public.appointment_types t
   WHERE t.id = p_type_id AND NOT EXISTS (SELECT 1 FROM private.appointment_type_category_events e WHERE e.type_id = p_type_id)
$$;
REVOKE ALL ON FUNCTION private.appointment_type_state_at(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
