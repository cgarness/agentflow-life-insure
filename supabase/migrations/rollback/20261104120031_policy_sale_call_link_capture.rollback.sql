-- Rollback for 20261104120031_policy_sale_call_link_capture (D3 §8). Class C: no GRANT.
-- Disables capture without breaking a sale: the _v2 handoffs stay callable and return source_call_link
-- {status: 'disabled'}; the retry RPC and the status read are sealed. Links and failure records are kept (never
-- dropped). Re-enabling is a new reviewed migration, never a replay of …31.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $rollback$
BEGIN
  IF to_regprocedure('private.capture_policy_sale_call_link(text,text,uuid,uuid,uuid[],uuid,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Sale call link capture rollback: capture is not installed' USING ERRCODE = 'P0001';
  END IF;
END $rollback$;

CREATE OR REPLACE FUNCTION private.capture_policy_sale_call_link(p_kind text, p_operation_key text, p_request_id uuid,
  p_client_id uuid, p_win_ids uuid[], p_source_call_id uuid, p_actor_id uuid, p_sale_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp SET lock_timeout = '100ms' AS $$
BEGIN
  RETURN jsonb_build_object('status', 'disabled', 'recorded', false);
END $$;
REVOKE ALL ON FUNCTION private.capture_policy_sale_call_link(text, text, uuid, uuid, uuid[], uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retry_policy_sale_call_link(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_policy_sale_call_link_status(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
