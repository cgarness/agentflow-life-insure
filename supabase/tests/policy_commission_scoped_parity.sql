-- Same synthetic rows, all eight legacy readers, before/after/rollback. Only volatile meta.as_of is removed.
-- psql -v capture=true writes the baseline; -v capture=false requires exact JSONB identity.
\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS cs_parity(actor uuid, label text, data jsonb, PRIMARY KEY(actor,label));
GRANT ALL ON cs_parity TO authenticated;
CREATE OR REPLACE FUNCTION cs_parity_snapshot(p_capture boolean) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; got jsonb; expected jsonb; n integer:=0; pid uuid;
BEGIN
  SELECT policy_id INTO pid FROM wins WHERE agent_id=auth.uid() AND policy_id IS NOT NULL ORDER BY policy_id LIMIT 1;
  FOR r IN SELECT * FROM (VALUES
    ('overview default','SELECT get_my_commission_overview()'),
    ('overview leap','SELECT get_my_commission_overview(''custom'',''2024-02-01'',''2024-02-29'')'),
    ('overview march','SELECT get_my_commission_overview(''custom'',''2026-03-01'',''2026-03-31'')'),
    ('installments default','SELECT get_my_commission_installments()'),
    ('installments all','SELECT get_my_commission_installments(''all'',NULL,NULL,''any'',''all'',NULL,NULL,100,0)'),
    ('installments page','SELECT get_my_commission_installments(''all'',NULL,NULL,''any'',''all'',NULL,NULL,2,2)'),
    ('receipts default','SELECT get_my_commission_receipts()'),
    ('receipts all','SELECT get_my_commission_receipts(''all'',NULL,NULL,true,100,0)'),
    ('policies default','SELECT get_my_commission_policies()'),
    ('policies page','SELECT get_my_commission_policies(''all'',NULL,2,2)'),
    ('breakdown default','SELECT get_my_commission_breakdown()'),
    ('breakdown march','SELECT get_my_commission_breakdown(''custom'',''2026-03-01'',''2026-03-31'')'),
    ('policy_list default','SELECT get_my_commission_policy_list()'),
    ('policy_list all','SELECT get_my_commission_policy_list(''all'',NULL,false,NULL,''all'',NULL,NULL,100,0)'),
    ('policy_list missing','SELECT get_my_commission_policy_list(''missing'',NULL,false,NULL,''all'',NULL,NULL,100,0)'),
    ('receipt_list default','SELECT get_my_commission_receipt_list()'),
    ('receipt_list all','SELECT get_my_commission_receipt_list(''all'',NULL,NULL,true,NULL,false,100,0)'),
    ('detail',CASE WHEN pid IS NOT NULL THEN format('SELECT get_my_policy_commission(%L)',pid) END)
  ) q(label,query) WHERE query IS NOT NULL LOOP
    EXECUTE r.query INTO got; got:=cs_clean(got);
    IF p_capture THEN INSERT INTO cs_parity VALUES(auth.uid(),r.label,got);
    ELSE
      SELECT data INTO expected FROM cs_parity WHERE actor=auth.uid() AND label=r.label;
      IF got IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL F01 legacy parity % actor %; expected %, got %',r.label,auth.uid(),expected,got; END IF;
    END IF;
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION cs_parity_snapshot(boolean) TO authenticated;
SELECT pc_login(11); SET ROLE authenticated; SELECT cs_parity_snapshot(:capture); RESET ROLE;
SELECT pc_login(12); SET ROLE authenticated; SELECT cs_parity_snapshot(:capture); RESET ROLE;
SELECT pc_login(14); SET ROLE authenticated; SELECT cs_parity_snapshot(:capture); RESET ROLE;
SELECT pc_login(42); SET ROLE authenticated; SELECT cs_parity_snapshot(:capture); RESET ROLE;
SELECT pc_login(13); SET ROLE authenticated; SELECT cs_parity_snapshot(:capture); RESET ROLE;
SELECT pc_login(15); SET ROLE authenticated; SELECT cs_parity_snapshot(:capture); RESET ROLE;
SELECT 'PASS F01 legacy eight-reader parity across six actors, defaults, pagination, filters and leap date' AS result;
