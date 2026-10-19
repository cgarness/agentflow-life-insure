-- Rollback for 20261019170000_policy_commission_tracking.sql (Phase 2A saved policy commissions).
-- Non-destructive only: refuses while any commission record exists, so it can never discard an estimate, receipt,
-- void or audit event. It never touches sales, clients, wins or private.policy_sale_receipts; client-edit receipts
-- written by the first-policy edit companion stay as inert retry evidence (no reader remains after rollback).
-- The sale writers were never modified, so nothing of theirs needs restoring.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE t text; v_rows bigint;
BEGIN
  IF to_regclass('public.policy_commission_handoffs') IS NULL OR to_regnamespace('policy_commission_authz') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentflow_policy_commission_writer') THEN
    RAISE EXCEPTION 'policy commission tracking is not installed; refusing replay';
  END IF;
  FOREACH t IN ARRAY ARRAY['policy_commission_handoffs', 'policy_commission_captures', 'policy_commission_estimates',
                           'policy_commission_installments', 'policy_commission_receipts', 'policy_commission_events'] LOOP
    -- Lock first so no commission write can commit between this check and the drop.
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_rows;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'public.% holds % commission record(s); refusing to discard them', t, v_rows;
    END IF;
  END LOOP;
END $guard$;

-- Companions and reads first, so no caller can reach the internals during the drop.
DROP FUNCTION public.record_client_policy_handoff(uuid, uuid, jsonb, boolean, jsonb);
DROP FUNCTION public.create_client_with_sale_handoff(uuid, uuid, jsonb, boolean, jsonb);
DROP FUNCTION public.convert_lead_to_client_with_sales_handoff(uuid, uuid, uuid, jsonb, uuid, jsonb);
DROP FUNCTION public.update_client_with_policy_sale_handoff(uuid, uuid, jsonb, jsonb);
DROP FUNCTION public.get_client_policy_commissions(uuid);
DROP FUNCTION public.get_policy_sale_operation_status(text, uuid, uuid, jsonb);
DROP FUNCTION public.confirm_policy_commission_capture(uuid, uuid);
DROP FUNCTION public.dismiss_policy_commission_capture(uuid, uuid, text);
DROP FUNCTION public.record_policy_commission_estimate_later(uuid, uuid, jsonb, uuid, bigint, text);
DROP FUNCTION public.set_policy_commission_schedule_basis(uuid, uuid, bigint, date, text);
DROP FUNCTION public.set_policy_commission_installment_timing(uuid, uuid, bigint, text, date);
DROP FUNCTION public.set_policy_commission_hold(uuid, uuid, bigint, boolean, text);
DROP FUNCTION public.record_policy_commission_receipt(uuid, uuid, bigint, date, text);
DROP FUNCTION public.void_policy_commission_receipt(uuid, uuid, bigint, text, jsonb);
DROP FUNCTION private.policy_sale_commission_step(text, text, uuid, text, jsonb, boolean, jsonb);
DROP FUNCTION private.policy_commission_handoff(text, text, text, uuid, text, uuid, uuid[], jsonb);
DROP FUNCTION private.policy_commission_insert_estimate(uuid, uuid, jsonb, jsonb, jsonb, uuid, text, uuid, text, jsonb, text, text);
DROP FUNCTION private.policy_commission_record_event(public.policy_commission_estimates, text, uuid, text, text, jsonb, uuid, uuid, jsonb);
DROP FUNCTION private.policy_commission_insert_receipt(public.policy_commission_installments, uuid, text, bigint, date, text, uuid);
DROP FUNCTION private.policy_commission_lock_estimate(uuid, bigint, boolean);
DROP FUNCTION private.policy_commission_replay(uuid, text);
DROP FUNCTION private.policy_commission_estimate_state(uuid);
DROP FUNCTION private.policy_commission_slot_states(uuid);
DROP FUNCTION private.policy_commission_capture_presented(public.policy_commission_captures);
DROP FUNCTION private.policy_commission_evaluate(jsonb, jsonb, jsonb, jsonb, text);
DROP FUNCTION private.policy_commission_validate_payload(jsonb);
DROP FUNCTION private.policy_commission_valid_slot(jsonb, boolean);
DROP FUNCTION private.policy_commission_grid_facts(uuid, jsonb);
DROP FUNCTION private.policy_commission_policy_facts(uuid[]);
DROP FUNCTION private.policy_commission_operation_facts(text, text, uuid, text, uuid[]);

ALTER TABLE public.policy_commission_captures DROP CONSTRAINT policy_commission_captures_resolved_fk;
DROP TABLE public.policy_commission_events;
DROP TABLE public.policy_commission_receipts;
DROP TABLE public.policy_commission_installments;
DROP TABLE public.policy_commission_estimates;
DROP TABLE public.policy_commission_captures;
DROP TABLE public.policy_commission_handoffs;
DROP FUNCTION private.policy_commission_installments_complete();
DROP FUNCTION private.policy_commission_guard();
DROP INDEX public.wins_commission_link_key;

DROP FUNCTION policy_commission_authz.access(uuid);
DROP FUNCTION policy_commission_authz.actor_org();
DROP FUNCTION policy_commission_authz.actor_uid();
DROP FUNCTION private.policy_commission_toggle(uuid, text, boolean, text);
DROP SCHEMA policy_commission_authz;

REVOKE USAGE ON SCHEMA public, private FROM agentflow_policy_commission_writer;
REVOKE agentflow_policy_commission_writer FROM postgres;
DROP ROLE agentflow_policy_commission_writer;
