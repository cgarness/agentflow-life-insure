-- Rollback for 20261020212000_policy_commission_center_reads.sql (commissions center reads).
-- Drops exactly what that migration created: five public read functions, the policy_commission_reporting schema with
-- its seven helpers and two types, and two indexes. The migration owns no data, so nothing else is touched.
-- Production use requires Chris's separate approval.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regnamespace('policy_commission_reporting') IS NULL
     OR to_regprocedure('public.get_my_commission_overview(text,date,date)') IS NULL THEN
    RAISE EXCEPTION 'commissions center reads are not installed; refusing replay';
  END IF;
END $guard$;

DROP FUNCTION public.get_my_policy_commission(uuid);
DROP FUNCTION public.get_my_commission_policies(text, text, integer, integer);
DROP FUNCTION public.get_my_commission_receipts(text, date, date, boolean, integer, integer);
DROP FUNCTION public.get_my_commission_installments(text, date, date, text, text, text, text, integer, integer);
DROP FUNCTION public.get_my_commission_overview(text, date, date);
DROP FUNCTION policy_commission_reporting.installment_json(policy_commission_reporting.installment_fact,
  policy_commission_reporting.policy_fact);
DROP FUNCTION policy_commission_reporting.iso_or_null(text);
DROP FUNCTION policy_commission_reporting.contact_json(policy_commission_reporting.policy_fact);
DROP FUNCTION policy_commission_reporting.policies(uuid, uuid, uuid);
DROP FUNCTION policy_commission_reporting.installments(uuid, uuid, date, uuid[]);
DROP FUNCTION policy_commission_reporting.period(text, date, date, date, integer);
DROP FUNCTION policy_commission_reporting.viewer();
DROP TYPE policy_commission_reporting.policy_fact;
DROP TYPE policy_commission_reporting.installment_fact;
DROP SCHEMA policy_commission_reporting;
DROP INDEX public.policy_commission_captures_agent_open;
DROP INDEX public.policy_commission_receipts_agent_received;
