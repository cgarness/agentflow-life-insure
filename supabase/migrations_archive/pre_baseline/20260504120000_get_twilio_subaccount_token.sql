-- Multi-Tenant Twilio Provisioning, Phase 2
-- Vault reader helper invoked by the twilio-token Edge Function (service_role) to
-- retrieve the per-organization Twilio subaccount auth token written by Phase 1's
-- public.set_twilio_subaccount_token. Returns NULL when no secret exists; the
-- caller treats NULL as a data-integrity error.

CREATE OR REPLACE FUNCTION public.get_twilio_subaccount_token(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_name  text := 'twilio_subaccount_token_' || p_org_id::text;
  v_token text;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'get_twilio_subaccount_token: org id is required';
  END IF;

  SELECT decrypted_secret
  INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = v_name
  LIMIT 1;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.get_twilio_subaccount_token(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_twilio_subaccount_token(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_twilio_subaccount_token(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
