-- Multi-Tenant Twilio Provisioning, Phase 1
-- Adds subaccount columns on organizations, provisioning_errors audit table,
-- a private singleton config row for the Edge Function URL/service-role key,
-- a SECURITY DEFINER helper to write the Twilio auth token into Supabase Vault,
-- and an AFTER INSERT trigger that fires the provision-twilio-subaccount Edge Function via pg_net.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 1. organizations columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS twilio_subaccount_sid                  text,
  ADD COLUMN IF NOT EXISTS twilio_subaccount_auth_token_vault_key text,
  ADD COLUMN IF NOT EXISTS twilio_subaccount_status               text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS twilio_provisioned_at                  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_twilio_subaccount_sid_key'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_twilio_subaccount_sid_key UNIQUE (twilio_subaccount_sid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_twilio_subaccount_status_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_twilio_subaccount_status_check
      CHECK (twilio_subaccount_status IN ('pending','active','pending_manual','suspended','closed'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. provisioning_errors audit table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provisioning_errors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  attempt_number  smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 10),
  error_code      text,
  error_message   text NOT NULL,
  twilio_response jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provisioning_errors_org_created_idx
  ON public.provisioning_errors (organization_id, created_at DESC);

ALTER TABLE public.provisioning_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provisioning_errors_super_admin_select ON public.provisioning_errors;
CREATE POLICY provisioning_errors_super_admin_select
  ON public.provisioning_errors
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- service_role bypasses RLS, so no explicit policy is needed for the Edge Function.

-- ---------------------------------------------------------------------------
-- 3. private.twilio_provisioning_config (singleton; Chris populates via SQL Editor)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.twilio_provisioning_config (
  id                int PRIMARY KEY CHECK (id = 1),
  supabase_url      text NOT NULL DEFAULT '',
  service_role_key  text NOT NULL DEFAULT ''
);

INSERT INTO private.twilio_provisioning_config (id, supabase_url, service_role_key)
VALUES (1, '', '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.twilio_provisioning_config OWNER TO postgres;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.twilio_provisioning_config FROM PUBLIC;
REVOKE ALL ON TABLE private.twilio_provisioning_config FROM anon, authenticated, service_role;

COMMENT ON TABLE private.twilio_provisioning_config IS
  'Singleton (id=1) read by handle_new_organization_provisioning() to call provision-twilio-subaccount via pg_net. Populate once via SQL Editor: UPDATE private.twilio_provisioning_config SET supabase_url=..., service_role_key=... WHERE id=1.';

-- ---------------------------------------------------------------------------
-- 4. Vault writer helper (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- Edge Function calls this via PostgREST RPC under service_role; it stores the
-- subaccount auth token in Supabase Vault and returns the secret name. Avoids
-- exposing vault.create_secret directly to the API.
CREATE OR REPLACE FUNCTION public.set_twilio_subaccount_token(
  p_org_id uuid,
  p_token  text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_name text := 'twilio_subaccount_token_' || p_org_id::text;
  v_existing uuid;
BEGIN
  IF p_org_id IS NULL OR p_token IS NULL OR length(p_token) = 0 THEN
    RAISE EXCEPTION 'set_twilio_subaccount_token: org id and token are required';
  END IF;

  SELECT id INTO v_existing FROM vault.secrets WHERE name = v_name LIMIT 1;

  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(p_token, v_name, 'Twilio subaccount auth token for organization ' || p_org_id::text);
  ELSE
    PERFORM vault.update_secret(v_existing, p_token, v_name, 'Twilio subaccount auth token for organization ' || p_org_id::text);
  END IF;

  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION public.set_twilio_subaccount_token(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_twilio_subaccount_token(uuid, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_twilio_subaccount_token(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. AFTER INSERT trigger on organizations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_organization_provisioning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_url      text;
  v_key      text;
  v_endpoint text;
BEGIN
  -- Skip if already provisioned (idempotency for re-inserts via restore).
  IF NEW.twilio_subaccount_sid IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT supabase_url, service_role_key
  INTO v_url, v_key
  FROM private.twilio_provisioning_config
  WHERE id = 1;

  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'Twilio subaccount provisioning skipped for org %: private.twilio_provisioning_config not populated', NEW.id;
    RETURN NEW;
  END IF;

  v_endpoint := rtrim(v_url, '/') || '/functions/v1/provision-twilio-subaccount';

  BEGIN
    PERFORM
      net.http_post(
        url := v_endpoint,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('organization_id', NEW.id),
        timeout_milliseconds := 5000
      );
  EXCEPTION WHEN OTHERS THEN
    -- Never block organization insert on telephony provisioning failures.
    RAISE WARNING 'Twilio subaccount provisioning trigger failed for org %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_organization_created_provision_twilio ON public.organizations;
CREATE TRIGGER on_organization_created_provision_twilio
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_organization_provisioning();

-- ---------------------------------------------------------------------------
-- 6. PostgREST schema reload
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
