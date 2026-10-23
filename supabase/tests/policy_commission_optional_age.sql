-- Only synthetic fixture data. Run after the existing Phase 2A and expected windows migrations,
-- then 20261023180000_policy_commission_optional_age.sql, on disposable localhost PostgreSQL.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

SELECT test_assert(
  NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid='public.policy_commission_captures'::regclass AND attname='insured_age')
  AND NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid='public.policy_commission_estimates'::regclass AND attname='insured_age'),
  'optional-age migration changes only the two insured-age nullability flags');

SELECT pc_login(11);
SET ROLE authenticated;

-- pc_slot is an existing synthetic harness helper; it inserts JSON null (not age zero) when passed NULL.
SELECT test_assert(private.policy_commission_valid_slot(
  pc_slot('primary',11,503,513,NULL,NULL,100,'100','50',60000,45000)-'slot',false),
  'record-later payload accepts a genuinely null age');
SELECT test_assert(private.policy_commission_valid_slot(
  pc_slot('primary',11,503,513,NULL,NULL,100,'100','50',60000,45000),true),
  'sale-capture payload accepts a genuinely null age');
SELECT test_assert(private.policy_commission_valid_slot(
  pc_slot('primary',11,501,511,35,20,100,'95.50','50',57300,42975)-'slot',false),
  'previous numeric-age payload remains valid');
SELECT test_assert(NOT private.policy_commission_valid_slot(
  pc_slot('primary',11,503,513,NULL,NULL,100,'100','50',60000,45000)-'slot'-'insured_age',false),
  'a missing age key is refused, rather than silently accepted');
SELECT test_assert(NOT private.policy_commission_valid_slot(
  jsonb_set(pc_slot('primary',11,503,513,NULL,NULL,100,'100','50',60000,45000)-'slot','{insured_age}','"0"'::jsonb),false),
  'the string zero is not an invented insured age');
SELECT test_assert(NOT private.policy_commission_valid_slot(
  jsonb_set(pc_slot('primary',11,503,513,NULL,NULL,100,'100','50',60000,45000)-'slot','{insured_age}','101'::jsonb),false),
  'out-of-bounds numeric age remains forbidden');
SELECT test_assert(NOT private.policy_commission_valid_slot(
  jsonb_set(pc_slot('primary',11,503,513,NULL,NULL,100,'100','50',60000,45000)-'slot','{insured_age}','1.5'::jsonb),false),
  'fractional insured age remains forbidden');

-- Existing test grid: product 503 has no age limits (inactive status deliberately does not
-- affect variant matching); products 501/502 have actual age bounds.
SELECT test_assert(
  (private.policy_commission_grid_facts(test_id(11),
    jsonb_build_array(jsonb_build_object('key','unbounded','product_id',test_id(503),'age',NULL,'term',NULL)))
    #>> '{items,0,match,kind}')='matched',
  'unknown age matches only an age-unbounded product');
SELECT test_assert(
  (private.policy_commission_grid_facts(test_id(11),
    jsonb_build_array(jsonb_build_object('key','bounded','product_id',test_id(502),'age',NULL,'term',NULL)))
    #>> '{items,0,match,kind}')='age_required',
  'unknown age is refused when the product has age limits');
SELECT test_assert(
  (private.policy_commission_grid_facts(test_id(11),
    jsonb_build_array(jsonb_build_object('key','existing','product_id',test_id(502),'age',60,'term',NULL)))
    #>> '{items,0,match,kind}')='matched',
  'existing matching of actual insured ages remains intact');
RESET ROLE;

-- RLS, function owners, execution flags and role ACLs must be checked against the pre-migration inventory in CI.
