-- Reports V2 PKG-C (D3 §3.6): producing-call links for sales. Privilege class C: no GRANT; every object below is
-- revoked from PUBLIC, anon, authenticated and service_role.
--
--   private.guard_client_lead_id        clients.lead_id becomes read-only outside postgres (R14, A-591). It runs first:
--                                       conversion inserts lead_id as postgres, and clientToRow never writes it.
--   private.policy_sale_call_links      one producing call per sale (win). No FK to wins or calls (ON DELETE SET NULL
--                                       collides with the sale guard; RESTRICT would block reversal tickets); readers
--                                       join the tables. wins.call_id is never written.
--   private.guard_policy_sale_call_link INSERT needs a same-org sale (id, policy, buyer) and a same-org call in the
--                                       stated direction and forces captured_at; UPDATE and TRUNCATE raise; DELETE only
--                                       for postgres holding the agentflow.sale_call_link_reversal ticket for that win.
-- Nothing writes a link until …31 installs the capture.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
DECLARE c text;
BEGIN
  IF to_regclass('private.policy_sale_call_links') IS NOT NULL
     OR to_regprocedure('private.guard_client_lead_id()') IS NOT NULL
     OR to_regprocedure('private.guard_policy_sale_call_link()') IS NOT NULL THEN
    RAISE EXCEPTION 'Sale call links: refusing replay' USING ERRCODE = 'P0001';
  END IF;
  FOR c IN SELECT * FROM unnest(ARRAY['public.clients.lead_id', 'public.clients.organization_id', 'public.wins.id',
      'public.wins.organization_id', 'public.wins.policy_id', 'public.wins.contact_id', 'public.calls.id',
      'public.calls.organization_id', 'public.calls.direction']) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = split_part(c, '.', 1)
                    AND table_name = split_part(c, '.', 2) AND column_name = split_part(c, '.', 3)) THEN
      RAISE EXCEPTION 'Sale call links: dependency column missing: %', c USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guard$;

-- 1. Lead lineage is read-only for everyone but postgres (the conversion writer).
CREATE FUNCTION private.guard_client_lead_id() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Client lead lineage is read-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_client_lead_id() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER clients_lead_id_guard BEFORE UPDATE OF lead_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION private.guard_client_lead_id();

-- 2. The link table.
CREATE TABLE private.policy_sale_call_links (
  organization_id uuid NOT NULL,
  win_id uuid NOT NULL UNIQUE,
  policy_id uuid NOT NULL,
  client_id uuid NOT NULL,
  call_id uuid NOT NULL,
  call_direction text NOT NULL,
  link_source text NOT NULL,
  sale_kind text NOT NULL,
  operation_key text NOT NULL,
  request_id uuid,
  actor_id uuid NOT NULL,
  evidence_hash text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, win_id),
  CONSTRAINT pscl_shape CHECK (call_direction IN ('outbound', 'inbound') AND link_source IN ('sale_entry', 'reviewed_repair')
    AND sale_kind IN ('record', 'convert') AND evidence_hash ~ '^[0-9a-f]{64}$' AND length(operation_key) BETWEEN 1 AND 200)
);
CREATE INDEX policy_sale_call_links_org_call ON private.policy_sale_call_links (organization_id, call_id);
ALTER TABLE private.policy_sale_call_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_sale_call_links FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_policy_sale_call_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.wins w WHERE w.id = NEW.win_id AND w.organization_id = NEW.organization_id
                    AND w.policy_id = NEW.policy_id AND w.contact_id = NEW.client_id)
       OR NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = NEW.call_id AND c.organization_id = NEW.organization_id
                       AND CASE WHEN lower(c.direction) = 'inbound' THEN 'inbound'
                                WHEN lower(c.direction) IN ('outbound', 'outgoing') THEN 'outbound' END = NEW.call_direction) THEN
      RAISE EXCEPTION 'A sale call link must match a recorded sale and call of the organization' USING ERRCODE = '23514';
    END IF;
    NEW.captured_at := clock_timestamp();
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF current_user = 'postgres' AND current_setting('agentflow.sale_call_link_reversal', true) = OLD.win_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Sale call links are removed only by a ticketed reversal' USING ERRCODE = '23514';
  END IF;
  RAISE EXCEPTION 'Sale call links are immutable' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION private.guard_policy_sale_call_link() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER pscl_guard BEFORE INSERT OR UPDATE OR DELETE ON private.policy_sale_call_links
  FOR EACH ROW EXECUTE FUNCTION private.guard_policy_sale_call_link();
CREATE TRIGGER pscl_no_truncate BEFORE TRUNCATE ON private.policy_sale_call_links
  FOR EACH STATEMENT EXECUTE FUNCTION private.guard_policy_sale_call_link();
