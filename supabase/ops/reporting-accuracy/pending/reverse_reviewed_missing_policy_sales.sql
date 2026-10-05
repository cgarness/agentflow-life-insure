-- Separate approval only. Exact postimages, two repair keys, retained identities/evidence.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
SET LOCAL TIME ZONE 'UTC';
DO $$
DECLARE r private.reporting_sale_repair_events; w public.wins; n integer:=0;
BEGIN
 FOR r IN SELECT * FROM private.reporting_sale_repair_events WHERE operation_key IN
  ('repair:manual-client:54d44dc5-98c8-4778-a71d-f0b1d595d992:primary','repair:manual-client:71137434-036b-4b3f-8e0a-c6e290b096ba:primary') ORDER BY client_id LOOP
  n:=n+1;
  SELECT * INTO w FROM public.wins WHERE id=r.win_id FOR UPDATE;
  IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM private.policy_sale_reversals WHERE win_id=r.win_id AND operation_key=r.operation_key AND consumed_at IS NOT NULL AND before_row=r.win_postimage) THEN CONTINUE; END IF;
   RAISE EXCEPTION 'Repair event missing without matching reversal';
  END IF;
  IF to_jsonb(w) IS DISTINCT FROM r.win_postimage THEN RAISE EXCEPTION 'Repair event changed; reversal stopped'; END IF;
  INSERT INTO private.policy_sale_reversals(win_id,operation_key,row_hash,before_row,reason)
   VALUES(w.id,r.operation_key,md5(to_jsonb(w)::text),to_jsonb(w),'Reversal of reviewed two-policy omission repair');
  DELETE FROM public.wins WHERE id=w.id;
 END LOOP;
 IF n<>2 THEN RAISE EXCEPTION 'Expected exactly two repair receipts'; END IF;
END $$;
COMMIT;
