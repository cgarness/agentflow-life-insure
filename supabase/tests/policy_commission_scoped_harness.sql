-- Synthetic current-hierarchy fixture. Called before scoped migration, after the existing insights suite.
-- The existing suite supplies holds, voids, replacements, open captures, missing/unknown dates and restricted clients.
CREATE TABLE cs_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON cs_results TO authenticated;
CREATE FUNCTION cs_put(p_key text, p_data jsonb) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO cs_results VALUES(p_key,p_data) ON CONFLICT(key) DO UPDATE SET data=excluded.data $$;
CREATE FUNCTION cs_get(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT data FROM cs_results WHERE key=p_key $$;
CREATE FUNCTION cs_clean(p_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT p_data #- '{meta,as_of}' $$;
GRANT EXECUTE ON FUNCTION cs_put(text,jsonb),cs_get(text),cs_clean(jsonb) TO authenticated;
-- Create through the existing signed-in synthetic sale handoff; no alternate financial writer in the feature.
SELECT pc_login(42);
SET ROLE authenticated;
SELECT test_assert(ci_sale('ScopedIndirect',42,'Term','Synthetic Life','50.00',ci_term(42))='recorded','indirect synthetic sale');
SELECT pc_login(43);
SELECT test_assert(ci_sale('ScopedAgentChild',43,'Term','Synthetic Life','50.00',ci_term(43))='recorded','Agent descendant synthetic sale');
SELECT pc_login(45);
SELECT test_assert(ci_sale('ScopedDeleted',45,'Term','Synthetic Life','50.00',ci_term(45))='recorded','retained deleted seller history');
SELECT pc_login(46);
SELECT test_assert(ci_sale('ScopedBridgeChild',46,'Term','Synthetic Life','50.00',ci_term(46))='recorded','deleted intermediate descendant history');
SELECT pc_login(14);
SELECT test_assert(ci_sale('ScopedLeader',14,'Term','Synthetic Life','50.00',ci_term(14))='recorded','leader personal sale');
RESET ROLE;
UPDATE profiles SET status='Active' WHERE id=test_id(16);
SELECT pc_login(16);
SET ROLE authenticated;
SELECT test_assert(ci_sale('ScopedInactive',16,'Term','Synthetic Life','50.00',ci_term(16))='recorded','inactive historical seller');
RESET ROLE;
UPDATE profiles SET status='Inactive' WHERE id IN(test_id(16),test_id(47));
UPDATE profiles SET status='Deleted' WHERE id IN(test_id(44),test_id(45));
-- More than one page, seeded through the canonical existing companion as a valid actual synthetic actor.
SELECT pc_login(42);
SET ROLE authenticated;
DO $$ BEGIN FOR n IN 1..30 LOOP
  PERFORM test_assert(ci_sale('ScopePage'||n,42,'Term','Synthetic Life','50.00',ci_term(42))='recorded','page sale');
END LOOP; END $$;
RESET ROLE;
-- Exact whole-row history digest used to prove transfers and rollback never rewrite financial history.
CREATE FUNCTION cs_history_digest() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM wins t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM policy_commission_estimates t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM policy_commission_installments t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM policy_commission_receipts t),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM policy_commission_captures t))::text)
$$;
REVOKE EXECUTE ON FUNCTION cs_history_digest() FROM PUBLIC,anon,authenticated,service_role;
SELECT cs_put('history_before',to_jsonb(cs_history_digest()));
SELECT 'PASS scoped current-hierarchy synthetic harness' AS result;
