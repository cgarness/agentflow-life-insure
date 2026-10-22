-- Phase 2A §13.7 expected payment windows: business-day calendar, automatic schedules from each policy's own Effective
-- Date (never Draft Date), Edit dates, manual overrides, automatic, replacement carry, receipts, audit shape,
-- constraints, execution rights, and reads that never write. Runs on a disposable database after the harness,
-- 20261019170000 and 20261020040000. Synthetic data only.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE pc_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON pc_results TO authenticated;
CREATE FUNCTION pc_r(p_key text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT data FROM pc_results WHERE key = p_key $$;
CREATE FUNCTION pc_client_id(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.clients WHERE first_name = p_first $$;
-- The policy at position p_n (0 = primary) of a client, as the signed-in actor reads it.
CREATE FUNCTION pc_policy(p_first text, p_n integer DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT get_client_policy_commissions(pc_client_id(p_first))->'policies'->p_n $$;
CREATE FUNCTION pc_est(p_first text, p_n integer DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT pc_policy(p_first, p_n)->'estimate' $$;
CREATE FUNCTION pc_rev(p_first text) RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT (pc_est(p_first)->>'state_revision')::bigint $$;
CREATE FUNCTION pc_inst(p_first text, p_kind text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT (i->>'id')::uuid FROM jsonb_array_elements(pc_est(p_first)->'installments') i WHERE i->>'kind' = p_kind $$;
-- "kind=precision:from..until:source" for each payment, as the contact read returns it.
CREATE FUNCTION pc_dates(p_first text, p_n integer DEFAULT 0) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT string_agg(i->>'kind' || '=' || (i->>'timing_precision') || ':' || coalesce(i->>'expected_on', '-')
                       || coalesce('..' || (i->>'expected_until'), '') || ':' || (i->>'timing_source'), ' ' ORDER BY i->>'kind')
       FROM jsonb_array_elements(pc_est(p_first, p_n)->'installments') i $$;
-- "start/source/assumed/frequency/convention" of the saved schedule.
CREATE FUNCTION pc_schedule(p_first text, p_n integer DEFAULT 0) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT concat_ws('/', coalesce(e->>'schedule_start_on', '-'), coalesce(e->>'schedule_start_source', '-'), e->>'schedule_assumed',
                      coalesce(e->>'schedule_frequency', '-'), coalesce(e->>'schedule_convention', '-'))
       FROM (SELECT pc_est(p_first, p_n) AS e) x $$;
GRANT EXECUTE ON FUNCTION pc_r(text), pc_client_id(text), pc_policy(text, integer), pc_est(text, integer), pc_rev(text),
  pc_inst(text, text), pc_dates(text, integer), pc_schedule(text, integer) TO authenticated;
CREATE FUNCTION pc_slot50() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) $$;
CREATE FUNCTION pc_fe(p_slot uuid) RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT pc_slot(p_slot::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400) $$;
GRANT EXECUTE ON FUNCTION pc_slot50(), pc_fe(uuid) TO authenticated;

-- ── Calendar: Federal Reserve holidays, business days and the four windows ──────────────────────────────────
SELECT test_assert(bool_and(private.policy_commission_fed_holiday(d::date) = h), 'holiday rules: ' ||
         coalesce(string_agg(CASE WHEN private.policy_commission_fed_holiday(d::date) IS DISTINCT FROM h THEN d END, ', '), 'none'))
  FROM (VALUES ('2026-01-01', true), ('2026-01-19', true), ('2026-02-16', true), ('2026-05-25', true), ('2026-06-19', true),
               ('2026-07-03', false),                       -- Independence Day on Saturday: Friday stays open
               ('2026-09-07', true), ('2026-10-12', true), ('2026-11-11', true), ('2026-11-26', true), ('2026-12-25', true),
               ('2026-11-27', false), ('2026-10-13', false), ('2027-07-05', true),   -- Sunday July 4 observed Monday
               ('2027-12-24', false), ('2027-12-31', false), -- Christmas and New Year's Day on Saturday: not moved
               ('2023-01-02', true), ('2022-12-26', true), ('2022-06-20', true),   -- Sunday holidays observed Monday
               ('2021-06-18', false),                       -- Juneteenth was first observed by the Reserve Banks in 2022
               ('2027-05-31', true), ('2028-11-10', false), ('2027-01-18', true), ('2027-10-11', true), ('2027-11-25', true)) v(d, h);
SELECT test_assert((SELECT count(*) FROM generate_series(DATE '2026-01-01', DATE '2026-12-31', interval '1 day') g
                     WHERE extract(isodow FROM g) < 6 AND private.policy_commission_fed_holiday(g::date)) = 10
                   AND (SELECT count(*) FROM generate_series(DATE '2027-01-01', DATE '2027-12-31', interval '1 day') g
                         WHERE extract(isodow FROM g) < 6 AND private.policy_commission_fed_holiday(g::date)) = 9,
                   'weekday Federal Reserve holidays: 10 in 2026, 9 in 2027');
SELECT test_assert(bool_and(private.policy_commission_business_day_after(p::date, 1) = f::date
                            AND private.policy_commission_business_day_after(p::date, 3) = u::date), 'business-day windows: ' ||
         coalesce(string_agg(CASE WHEN private.policy_commission_business_day_after(p::date, 3) IS DISTINCT FROM u::date THEN p END, ', '), 'none'))
  FROM (VALUES ('2026-10-02', '2026-10-05', '2026-10-07'),   -- Friday premium: Monday–Wednesday
               ('2027-07-02', '2027-07-06', '2027-07-08'),   -- the observed July 5 is skipped
               ('2026-11-25', '2026-11-27', '2026-12-01'),   -- Thanksgiving, month crossing
               ('2026-12-30', '2026-12-31', '2027-01-05'),   -- New Year's Day, year crossing
               ('2027-12-23', '2027-12-24', '2027-12-28'),   -- Saturday Christmas: Friday open
               ('2026-01-16', '2026-01-20', '2026-01-22'),   -- Martin Luther King Jr. Day
               ('2022-06-17', '2022-06-21', '2022-06-23'), ('2021-06-17', '2021-06-18', '2021-06-22'),
               ('2027-05-31', '2027-06-01', '2027-06-03'),   -- the premium date itself a holiday
               ('2028-02-28', '2028-02-29', '2028-03-02')) v(p, f, u);
SELECT test_assert(private.policy_commission_expected_schedule('2026-01-31', 'monthly') =
  '{"advance": {"expected_on": "2026-02-02", "expected_until": "2026-02-04"}, "month_10": {"expected_on": "2026-11-02", "expected_until": "2026-11-04"},
    "month_11": {"expected_on": "2026-12-01", "expected_until": "2026-12-03"}, "month_12": {"expected_on": "2027-01-04", "expected_until": "2027-01-06"}}'::jsonb,
  'Jan 31 start: premiums Oct 31, Nov 30, Dec 31 (clamped, never chained)');
SELECT test_assert(private.policy_commission_expected_schedule('2027-05-31', NULL)->'month_10' =
  '{"expected_on": "2028-03-01", "expected_until": "2028-03-03"}'::jsonb, 'May 31, 2027 start: Month 10 premium Feb 29, 2028; unknown frequency is monthly');
SELECT test_assert(bool_and(private.policy_commission_expected_schedule('2026-10-02', f) =
  '{"advance": {"expected_on": "2026-10-05", "expected_until": "2026-10-07"}, "month_10": null, "month_11": null, "month_12": null}'::jsonb),
  'quarterly, semi-annual and annual premiums: only the Advance gets a window')
  FROM unnest(ARRAY['quarterly', 'semi_annual', 'annual']) f;
SELECT test_assert(private.policy_commission_expected_schedule(NULL, 'monthly') IS NULL
                   AND private.policy_commission_expected_schedule('2100-06-01', 'monthly') ?& ARRAY['advance', 'month_10']
                   AND jsonb_typeof(private.policy_commission_expected_schedule('2100-06-01', 'monthly')->'month_10') = 'null'
                   AND jsonb_typeof(private.policy_commission_expected_schedule('2100-06-01', 'monthly')->'advance') = 'object',
                   'no start means no schedule; windows past 2100 are omitted');
SELECT test_assert(bool_and(private.policy_commission_iso_date(t) IS NOT DISTINCT FROM d::date), 'untrusted policy dates')
  FROM (VALUES ('2026-11-01', '2026-11-01'), ('2024-02-29', '2024-02-29'), ('2026-02-30', NULL), ('2026-1-01', NULL),
               (' 2026-01-01', NULL), ('11/01/2026', NULL), ('1999-12-31', NULL), ('2101-01-01', NULL), ('', NULL), (NULL, NULL)) v(t, d);
-- Every premium date 2000–2100: the window starts after it, spans business days only and fits the stored check.
SELECT test_assert(bool_and(f > g AND u >= f AND u <= f + 14 AND extract(isodow FROM f) < 6 AND extract(isodow FROM u) < 6
                            AND NOT private.policy_commission_fed_holiday(f) AND NOT private.policy_commission_fed_holiday(u)),
                   'every window 2000–2100 starts after its premium date, uses business days and stays within 14 days')
  FROM (SELECT g::date AS g, private.policy_commission_business_day_after(g::date, 1) AS f,
               private.policy_commission_business_day_after(g::date, 3) AS u
          FROM generate_series(DATE '2000-01-01', DATE '2100-12-24', interval '1 day') g) x;

-- ── Automatic schedules when an estimate is saved (sale entry) ───────────────────────────────────────────
INSERT INTO role_permissions(organization_id, role, permissions) VALUES (test_id(1), 'Team Leader',
  '{"c":[{"name":"View Own Commission Percentage","teamLeader":true},{"name":"View Others'' Commission Percentage","teamLeader":true}]}');
INSERT INTO leads(id, organization_id, user_id, assigned_agent_id, first_name, last_name)
VALUES (test_id(6900), test_id(1), test_id(11), test_id(11), 'Converted', 'Synthetic');
SELECT pc_login(11);
SET ROLE authenticated;
-- Effective Sunday 2026-11-01, frequency unknown (monthly).
INSERT INTO pc_results VALUES ('auto', create_client_with_sale_handoff(test_id(6001), test_id(1), pc_client('Auto', 11, '50.00'), true, pc_payload(pc_slot50())));
SELECT test_assert(pc_schedule('Auto') = '2026-11-01/effective_date/true/-/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Auto') = 'advance=date:2026-11-02..2026-11-04:schedule_basis month_10=date:2027-08-02..2027-08-04:schedule_basis '
                                          'month_11=date:2027-09-02..2027-09-07:schedule_basis month_12=date:2027-10-04..2027-10-06:schedule_basis'
                   AND pc_rev('Auto') = 1, 'sale entry: assumed start from the effective date and four windows (Labor Day skipped)');
-- Draft Date is the next scheduled draft, never the first premium: it is ignored even when it differs.
INSERT INTO pc_results VALUES ('drafted', create_client_with_sale_handoff(test_id(6002), test_id(1),
  pc_client('Drafted', 11, '50.00') || '{"draft_date": "2026-11-20", "payment_frequency": "monthly"}', true, pc_payload(pc_slot50())));
SELECT test_assert(pc_schedule('Drafted') = '2026-11-01/effective_date/true/monthly/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Drafted') = pc_dates('Auto'), 'Draft Date is never used as the start');
INSERT INTO pc_results VALUES ('undated', create_client_with_sale_handoff(test_id(6003), test_id(1),
  pc_client('Undated', 11, '50.00') - 'effective_date' || '{"draft_date": "2026-11-20"}', true, pc_payload(pc_slot50())));
INSERT INTO pc_results VALUES ('baddate', create_client_with_sale_handoff(test_id(6004), test_id(1),
  pc_client('BadDate', 11, '50.00') || '{"effective_date": "2026-02-30"}', true, pc_payload(pc_slot50())));
INSERT INTO pc_results VALUES ('usdate', create_client_with_sale_handoff(test_id(6005), test_id(1),
  pc_client('UsDate', 11, '50.00') || '{"effective_date": "11/01/2026"}', true, pc_payload(pc_slot50())));
SELECT test_assert(bool_and(pc_policy(f)->>'state' = 'recorded' AND pc_schedule(f) = '-/-/false/-/-'
                            AND pc_dates(f) = 'advance=unknown:-:unset month_10=unknown:-:unset month_11=unknown:-:unset month_12=unknown:-:unset'),
                   'no usable effective date: the estimate is saved and every payment needs a date')
  FROM unnest(ARRAY['Undated', 'BadDate', 'UsDate']) f;
INSERT INTO pc_results VALUES ('quarterly', create_client_with_sale_handoff(test_id(6006), test_id(1),
  pc_client('Quarterly', 11, '50.00') || '{"payment_frequency": "quarterly"}', true, pc_payload(pc_slot50())));
INSERT INTO pc_results VALUES ('annual', create_client_with_sale_handoff(test_id(6007), test_id(1),
  pc_client('Annual', 11, '50.00') || '{"payment_frequency": "annual"}', true, pc_payload(pc_slot50())));
SELECT test_assert(pc_schedule('Quarterly') = '2026-11-01/effective_date/true/quarterly/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Quarterly') = 'advance=date:2026-11-02..2026-11-04:schedule_basis month_10=unknown:-:unset '
                                               'month_11=unknown:-:unset month_12=unknown:-:unset'
                   AND pc_dates('Annual') = pc_dates('Quarterly') AND pc_policy('Annual')->'basis'->>'payment_frequency' = 'annual',
                   'non-monthly premiums: only the Advance window; Months 10–12 need dates');
-- Conversion: each additional policy uses its own effective date and never the primary's dates or frequency.
INSERT INTO pc_results VALUES ('convert', convert_lead_to_client_with_sales_handoff(test_id(6008), test_id(6900), test_id(1),
  pc_client('Converted', 11, '50.00') || jsonb_build_object('payment_frequency', 'quarterly', 'custom_fields', jsonb_build_object(
    'additional_policies', jsonb_build_array(
      jsonb_build_object('policyId', test_id(6101), 'policyType', 'Final Expense', 'carrier', 'Synthetic Life', 'premiumAmount', '30.00',
                         'soldDate', '2026-10-01', 'effectiveDate', '2026-12-15'),
      jsonb_build_object('policyId', test_id(6102), 'policyType', 'Final Expense', 'carrier', 'Synthetic Life', 'premiumAmount', '30.00',
                         'soldDate', '2026-10-01')))),
  NULL, pc_payload(pc_slot50(), pc_fe(test_id(6101)), pc_fe(test_id(6102)))));
SELECT test_assert((SELECT array_agg(s->>'status') FROM jsonb_array_elements(pc_r('convert')->'commission'->'slots') s) = ARRAY['recorded', 'recorded', 'recorded'],
                   'conversion recorded three estimates');
SELECT test_assert(pc_schedule('Converted', 0) = '2026-11-01/effective_date/true/quarterly/premium_plus_1_3_fed_business_days_v1'
                   AND pc_schedule('Converted', 1) = '2026-12-15/effective_date/true/-/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Converted', 1) = 'advance=date:2026-12-16..2026-12-18:schedule_basis month_10=date:2027-09-16..2027-09-20:schedule_basis '
                                                  'month_11=date:2027-10-18..2027-10-20:schedule_basis month_12=date:2027-11-16..2027-11-18:schedule_basis'
                   AND pc_schedule('Converted', 2) = '-/-/false/-/-' AND pc_dates('Converted', 2) LIKE 'advance=unknown:-:unset%'
                   AND pc_policy('Converted', 1)->'basis'->'payment_frequency' = 'null'::jsonb,
                   'additional policies: own effective date, unknown frequency (monthly), never the primary''s dates');
RESET ROLE;

-- Confirmation reads the policy as it is when the estimate is saved (here the effective date changed after the sale).
SELECT pc_login(14);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('tl_sale', create_client_with_sale_handoff(test_id(6009), test_id(1), pc_client('Confirmed', 11, '50.00'), true, pc_payload(pc_slot50())));
RESET ROLE;
SELECT test_assert((SELECT status FROM policy_commission_captures WHERE policy_id = (SELECT primary_policy_id FROM clients WHERE first_name = 'Confirmed'))
                   = 'awaiting_confirmation', 'a Team Leader''s sale for an agent awaits the agent''s confirmation');
UPDATE clients SET effective_date = '2027-01-15' WHERE first_name = 'Confirmed';
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('confirm', confirm_policy_commission_capture(test_id(6010),
  (SELECT (pc_policy('Confirmed')->'capture'->>'id')::uuid)));
SELECT test_assert(pc_r('confirm')->>'status' = 'recorded'
                   AND pc_schedule('Confirmed') = '2027-01-15/effective_date/true/-/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Confirmed') LIKE 'advance=date:2027-01-19..2027-01-21:schedule_basis %',
                   'confirmation uses the effective date at confirmation (MLK Day skipped)');
-- Recorded later: automatic from the current effective date (premium on Memorial Day; Month 10 on Feb 29).
INSERT INTO pc_results VALUES ('later_sale', create_client_with_sale_handoff(test_id(6011), test_id(1),
  pc_client('Later', 11, '50.00') || '{"effective_date": "2027-05-31"}', true, pc_payload()));
INSERT INTO pc_results VALUES ('later', record_policy_commission_estimate_later(test_id(6012), (pc_policy('Later')->>'policy_id')::uuid,
  pc_slot50() - 'slot', NULL, NULL, NULL));
SELECT test_assert(pc_r('later')->>'status' = 'recorded'
                   AND pc_schedule('Later') = '2027-05-31/effective_date/true/-/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Later') = 'advance=date:2027-06-01..2027-06-03:schedule_basis month_10=date:2028-03-01..2028-03-03:schedule_basis '
                                           'month_11=date:2028-04-03..2028-04-05:schedule_basis month_12=date:2028-05-01..2028-05-03:schedule_basis',
                   'recorded later: automatic schedule from the effective date');

-- ── Edit dates (confirmed start) and per-payment dates ──────────────────────────────────────────────────
INSERT INTO pc_results VALUES ('basis', set_policy_commission_schedule_basis(test_id(6201), (pc_est('Auto')->>'id')::uuid, 1, '2026-11-15', 'manual'));
INSERT INTO pc_results VALUES ('basis_retry', set_policy_commission_schedule_basis(test_id(6201), (pc_est('Auto')->>'id')::uuid, 1, '2026-11-15', 'manual'));
SELECT test_assert(pc_r('basis') = pc_r('basis_retry') AND pc_rev('Auto') = 2
                   AND pc_schedule('Auto') = '2026-11-15/manual/false/-/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Auto') = 'advance=date:2026-11-16..2026-11-18:schedule_basis month_10=date:2027-08-16..2027-08-18:schedule_basis '
                                          'month_11=date:2027-09-16..2027-09-20:schedule_basis month_12=date:2027-10-18..2027-10-20:schedule_basis',
                   'first premium date from Edit dates: confirmed, all four windows, replay-safe');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 1, %L, %L)', test_id(6201), pc_est('Auto')->>'id', '2026-11-16', 'manual'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 1, %L, %L)', test_id(6202), pc_est('Auto')->>'id', '2026-11-16', 'manual'), 'PT409');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 2, %L, %L)', test_id(6203), pc_est('Auto')->>'id', '2026-12-01', 'effective_date'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 2, %L, %L)', test_id(6204), pc_est('Auto')->>'id', '2026-11-01', 'draft_date'), '22023');
INSERT INTO pc_results VALUES ('m12_month', set_policy_commission_installment_timing(test_id(6205), pc_inst('Auto', 'month_12'), 2, 'month', '2027-12-01'));
INSERT INTO pc_results VALUES ('adv_needed', set_policy_commission_installment_timing(test_id(6206), pc_inst('Auto', 'advance'), 3, 'unknown', NULL));
INSERT INTO pc_results VALUES ('basis_effective', set_policy_commission_schedule_basis(test_id(6207), (pc_est('Auto')->>'id')::uuid, 4, '2026-11-01', 'effective_date'));
SELECT test_assert(pc_rev('Auto') = 5 AND pc_schedule('Auto') = '2026-11-01/effective_date/false/-/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Auto') = 'advance=unknown:-:manual month_10=date:2027-08-02..2027-08-04:schedule_basis '
                                          'month_11=date:2027-09-02..2027-09-07:schedule_basis month_12=month:2027-12-01:manual',
                   'Use effective date in Edit dates is confirmed; manual Date needed and month survive the change');
INSERT INTO pc_results VALUES ('adv_auto', set_policy_commission_installment_timing(test_id(6208), pc_inst('Auto', 'advance'), 5, 'automatic', NULL));
SELECT test_assert(pc_dates('Auto') LIKE 'advance=date:2026-11-02..2026-11-04:schedule_basis %', 'automatic returns a payment to the schedule');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 6, %L, %L)', test_id(6209), pc_inst('Auto', 'month_10'), 'automatic', '2027-08-02'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 6, %L, NULL)', test_id(6210), pc_inst('Auto', 'month_10'), 'date'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 6, %L, %L)', test_id(6211), pc_inst('Auto', 'month_10'), 'unknown', '2027-08-02'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 6, %L, NULL)', test_id(6212), pc_inst('Auto', 'month_10'), 'window'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 6, NULL, NULL)', test_id(6213), pc_inst('Auto', 'month_10')), '22023');
INSERT INTO pc_results VALUES ('m11_date', set_policy_commission_installment_timing(test_id(6214), pc_inst('Auto', 'month_11'), 6, 'date', '2027-09-10'));
-- Edit dates re-reads the policy's current payment frequency.
RESET ROLE;
UPDATE clients SET payment_frequency = 'annual' WHERE first_name = 'Auto';
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('basis_annual', set_policy_commission_schedule_basis(test_id(6215), (pc_est('Auto')->>'id')::uuid, 7, '2026-11-15', 'manual'));
SELECT test_assert(pc_schedule('Auto') = '2026-11-15/manual/false/annual/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Auto') = 'advance=date:2026-11-16..2026-11-18:schedule_basis month_10=unknown:-:unset '
                                          'month_11=date:2027-09-10:manual month_12=month:2027-12-01:manual',
                   'annual premiums at Edit dates: Advance window only; manual dates kept');
INSERT INTO pc_results VALUES ('m10_auto_annual', set_policy_commission_installment_timing(test_id(6216), pc_inst('Auto', 'month_10'), 8, 'automatic', NULL));
SELECT test_assert(pc_dates('Auto') LIKE '% month_10=unknown:-:unset %' AND pc_rev('Auto') = 9, 'automatic without a window needs a date');
INSERT INTO pc_results VALUES ('basis_clear', set_policy_commission_schedule_basis(test_id(6217), (pc_est('Auto')->>'id')::uuid, 9, NULL, NULL));
SELECT test_assert(pc_schedule('Auto') = '-/-/false/-/-'
                   AND pc_dates('Auto') = 'advance=unknown:-:unset month_10=unknown:-:unset month_11=date:2027-09-10:manual month_12=month:2027-12-01:manual',
                   'clearing the start clears only scheduled dates');
INSERT INTO pc_results VALUES ('m10_auto_none', set_policy_commission_installment_timing(test_id(6218), pc_inst('Auto', 'month_10'), 10, 'automatic', NULL));
SELECT test_assert(pc_dates('Auto') LIKE '% month_10=unknown:-:unset %', 'automatic without a start date needs a date');
RESET ROLE;
-- Read-only access and other agencies cannot edit dates.
SELECT pc_login(14);
SET ROLE authenticated;
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 11, %L, %L)', test_id(6219), pc_est('Auto')->>'id', '2026-11-15', 'manual'), '42501');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 11, %L, NULL)', test_id(6220), pc_inst('Auto', 'advance'), 'automatic'), '42501');
RESET ROLE;
SELECT pc_login(21);
SET ROLE authenticated;
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 11, %L, %L)', test_id(6221),
  (SELECT id FROM pc_results, LATERAL (SELECT (data->>'estimate_id')::uuid AS id) x WHERE key = 'later'), '2026-11-15', 'manual'), 'PT404');
RESET ROLE;

-- ── Replacement carries the saved schedule exactly; an undated one gets the automatic schedule ────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('carry_sale', create_client_with_sale_handoff(test_id(6301), test_id(1), pc_client('Carry', 11, '50.00'), true, pc_payload(pc_slot50())));
INSERT INTO pc_results VALUES ('carry_m12', set_policy_commission_installment_timing(test_id(6302), pc_inst('Carry', 'month_12'), 1, 'date', '2027-12-10'));
INSERT INTO pc_results VALUES ('carry_before', jsonb_build_object('dates', pc_dates('Carry'), 'schedule', pc_schedule('Carry'), 'id', pc_est('Carry')->>'id'));
RESET ROLE;
UPDATE clients SET effective_date = '2027-02-01' WHERE first_name = 'Carry';
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('carry', record_policy_commission_estimate_later(test_id(6303), (pc_policy('Carry')->>'policy_id')::uuid,
  pc_slot50() - 'slot', (pc_r('carry_before')->>'id')::uuid, 2, 'Synthetic replacement'));
SELECT test_assert(pc_est('Carry')->>'id' = pc_r('carry')->>'estimate_id' AND pc_est('Carry')->>'id' <> pc_r('carry_before')->>'id'
                   AND pc_schedule('Carry') = pc_r('carry_before')->>'schedule' AND pc_dates('Carry') = pc_r('carry_before')->>'dates'
                   AND pc_dates('Carry') LIKE '% month_12=date:2027-12-10:manual'
                   AND pc_schedule('Carry') LIKE '2026-11-01/effective_date/true/%',
                   'replacement carries the assumed schedule, windows and manual date unchanged (no silent recalculation)');
INSERT INTO pc_results VALUES ('undated_m10', set_policy_commission_installment_timing(test_id(6304), pc_inst('Undated', 'month_10'), 1, 'month', '2027-09-01'));
RESET ROLE;
UPDATE clients SET effective_date = '2026-11-01' WHERE first_name = 'Undated';
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('undated_replace', record_policy_commission_estimate_later(test_id(6305), (pc_policy('Undated')->>'policy_id')::uuid,
  pc_slot50() - 'slot', (pc_est('Undated')->>'id')::uuid, 2, 'Synthetic replacement'));
SELECT test_assert(pc_schedule('Undated') = '2026-11-01/effective_date/true/-/premium_plus_1_3_fed_business_days_v1'
                   AND pc_dates('Undated') = 'advance=date:2026-11-02..2026-11-04:schedule_basis month_10=month:2027-09-01:manual '
                                             'month_11=date:2027-09-02..2027-09-07:schedule_basis month_12=date:2027-10-04..2027-10-06:schedule_basis',
                   'replacing an undated estimate: automatic schedule, manual date kept');

-- ── Receipts and voids leave expected dates alone ───────────────────────────────────────────────────────
INSERT INTO pc_results VALUES ('drafted_dates', to_jsonb(pc_dates('Drafted')));
INSERT INTO pc_results VALUES ('receipt', record_policy_commission_receipt(test_id(6401), pc_inst('Drafted', 'advance'), 10000, current_date, 'SYN-1'));
INSERT INTO pc_results VALUES ('void', void_policy_commission_receipt(test_id(6402), (pc_r('receipt')->>'receipt_id')::uuid, pc_rev('Drafted'),
  'Synthetic correction', NULL));
SELECT test_assert(pc_r('void')->>'status' = 'ok' AND to_jsonb(pc_dates('Drafted')) = pc_r('drafted_dates'),
                   'a receipt and its void do not change expected dates');

-- ── Reads never write ───────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT count(*) FROM (SELECT get_client_policy_commissions(pc_client_id(f)) FROM unnest(ARRAY['Auto', 'Drafted', 'Undated', 'BadDate',
  'Quarterly', 'Converted', 'Confirmed', 'Later', 'Carry']) f) x;
SELECT test_assert(txid_current_if_assigned() IS NULL, 'contact reads assign no transaction id (they write nothing)');
COMMIT;
INSERT INTO pc_results VALUES ('drafted_ids', jsonb_build_object('advance', pc_inst('Drafted', 'advance'), 'month_10', pc_inst('Drafted', 'month_10'),
  'estimate', pc_est('Drafted')->>'id'));
RESET ROLE;
SELECT test_assert((SELECT draft_date FROM clients WHERE first_name = 'Drafted') = '2026-11-20', 'the ignored Draft Date was saved on the client');

-- ── Audit shape, constraints and execution rights ───────────────────────────────────────────────────────
SELECT test_assert(bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(ev.after_state) k)
                            = (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(private.policy_commission_estimate_state(ev.estimate_id)) k)
                            AND ev.after_state->'installments'->0 ?& ARRAY['expected_on', 'expected_until', 'timing_source']
                            AND ev.after_state ?& ARRAY['schedule_assumed', 'schedule_frequency', 'schedule_convention']),
                   'estimate_recorded audit has the same shape as the estimate state, including the schedule fields')
  FROM policy_commission_events ev WHERE ev.event_type = 'estimate_recorded';
SELECT test_assert((SELECT after_state->>'schedule_assumed' FROM policy_commission_events
                     WHERE event_type = 'schedule_basis_set' AND request_id = test_id(6207)) = 'false',
                   'Edit dates audit records the confirmed start');
SELECT pc_login(11);
SET ROLE agentflow_policy_commission_writer;
SELECT test_assert(pc_reject(format('UPDATE policy_commission_installments SET expected_until = expected_on + 15 WHERE id = %L', pc_r('drafted_ids')->>'month_10'),
                   '23514') LIKE '%policy_commission_installments_timing%', 'a window is at most 14 days');
SELECT test_assert(pc_reject(format('UPDATE policy_commission_installments SET timing_source = %L WHERE id = %L', 'manual', pc_r('drafted_ids')->>'month_10'),
                   '23514') LIKE '%policy_commission_installments_timing%', 'only the schedule sets a window end');
SELECT test_assert(pc_reject(format($q$UPDATE policy_commission_installments SET timing_precision = 'month', expected_on = '2026-11-01',
                   expected_until = NULL WHERE id = %L$q$, pc_r('drafted_ids')->>'advance'), '23514') LIKE '%policy_commission_installments_timing%',
                   'the Advance is scheduled only as a window');
SELECT test_assert(pc_reject(format($q$UPDATE policy_commission_estimates SET schedule_start_source = 'manual' WHERE id = %L$q$,
                   pc_r('drafted_ids')->>'estimate'), '23514') LIKE '%policy_commission_estimates_schedule%', 'an assumed start is only ever the effective date');
SELECT test_assert(pc_reject(format($q$UPDATE policy_commission_estimates SET schedule_frequency = 'weekly' WHERE id = %L$q$,
                   pc_r('drafted_ids')->>'estimate'), '23514') LIKE '%policy_commission_estimates_schedule%', 'frequency comes from the fixed list');
SELECT test_assert(pc_reject(format($q$UPDATE policy_commission_estimates SET schedule_convention = 'carrier_rule' WHERE id = %L$q$,
                   pc_r('drafted_ids')->>'estimate'), '23514') LIKE '%policy_commission_estimates_schedule%', 'only the reviewed convention');
RESET ROLE;
SELECT test_assert(bool_and(NOT has_function_privilege(r, f, 'EXECUTE')) AND bool_and(has_function_privilege('agentflow_policy_commission_writer', f, 'EXECUTE'))
                   AND bool_and(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = f::regprocedure AND a.grantee = 0)),
                   'calendar helpers: writer only (no PUBLIC, anon, authenticated or service_role)')
  FROM unnest(ARRAY['private.policy_commission_iso_date(text)', 'private.policy_commission_fed_holiday(date)',
                    'private.policy_commission_business_day_after(date,integer)', 'private.policy_commission_expected_schedule(date,text)']) f,
       unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT test_assert(NOT has_schema_privilege('agentflow_policy_commission_writer', 'public', 'CREATE')
                   AND NOT has_schema_privilege('agentflow_policy_commission_writer', 'private', 'CREATE'),
                   'the writer keeps no CREATE on public or private');

SELECT 'PASS policy commission expected windows' AS result;
