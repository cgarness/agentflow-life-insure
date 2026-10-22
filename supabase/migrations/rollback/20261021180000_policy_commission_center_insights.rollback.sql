-- Rollback for 20261021180000_policy_commission_center_insights.sql (commissions insights and monthly goals).
-- Drops exactly what that migration created: six public functions, the policy_commission_insights schema with its six
-- helpers, and the policy_commission_goals table with its policy. Refuses while any goal exists, so no person's goal
-- is discarded. Touches nothing else. Production use requires Chris's separate approval.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regnamespace('policy_commission_insights') IS NULL OR to_regclass('public.policy_commission_goals') IS NULL
     OR to_regprocedure('public.get_my_commission_breakdown(text,date,date)') IS NULL THEN
    RAISE EXCEPTION 'commissions insights are not installed; refusing replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.policy_commission_goals) THEN
    RAISE EXCEPTION 'commission goals exist; refusing to discard them';
  END IF;
END $guard$;

DROP FUNCTION public.clear_my_commission_goal(date);
DROP FUNCTION public.set_my_commission_goal(date, bigint);
DROP FUNCTION public.get_my_commission_goal(date);
DROP FUNCTION public.get_my_commission_receipt_list(text, date, date, boolean, text, boolean, integer, integer);
DROP FUNCTION public.get_my_commission_policy_list(text, text, boolean, text, text, date, date, integer, integer);
DROP FUNCTION public.get_my_commission_breakdown(text, date, date);
DROP FUNCTION policy_commission_insights.goal_month(date);
DROP FUNCTION policy_commission_insights.comparison(date, date, date);
DROP FUNCTION policy_commission_insights.policy_carrier(policy_commission_reporting.policy_fact);
DROP FUNCTION policy_commission_insights.policy_category(policy_commission_reporting.policy_fact);
DROP FUNCTION policy_commission_insights.category(text);
DROP FUNCTION policy_commission_insights.carrier_key(text);
DROP SCHEMA policy_commission_insights;
DROP TABLE public.policy_commission_goals;
