-- Disposable synthetic database only. Proves the actual patched call reader and trigger body.
BEGIN;
CREATE TEMP TABLE cleanup_cases(id uuid, expected text);
DO $tests$
DECLARE source_call public.calls; candidate public.calls; cid uuid; spec record; actual text;
BEGIN
 SELECT * INTO STRICT source_call FROM public.calls WHERE lower(direction) IN ('outbound','outgoing') LIMIT 1;
 FOR spec IN SELECT * FROM (VALUES
   (NULL::text, true, NULL::boolean, 'attempt'), ('unconfirmed',true,NULL,'attempt'),
   (NULL,true,NULL,'attempt'), -- An intentional repeat attempt counts independently.
   ('not_sent',true,NULL,'non_attempt'), (NULL::text,false,NULL,'unverified'),
   (NULL,true,false,'non_attempt'), ('not_sent',true,true,'attempt')) AS x(dispatch,has_id,admitted,expected)
 LOOP
   cid:=gen_random_uuid();
   candidate:=jsonb_populate_record(NULL::public.calls,to_jsonb(source_call)||jsonb_build_object(
     'id',cid,'attempt_id',CASE WHEN spec.has_id THEN cid ELSE NULL END,
     'dialer_admission_required',true,'dialer_dispatch_error',spec.dispatch));
   INSERT INTO public.calls SELECT (candidate).*;
   IF spec.admitted IS NOT NULL THEN
     INSERT INTO private.dialer_outbound_admissions(organization_id,call_id,parent_sid,destination,admitted,reason)
       VALUES(source_call.organization_id,cid,'cleanup-'||cid,'+13105550000',spec.admitted,CASE WHEN NOT spec.admitted THEN 'dnc' END);
   END IF;
   INSERT INTO cleanup_cases VALUES(cid,spec.expected);
 END LOOP;
 IF (SELECT count(*) FROM private.report_v3_call_facts(source_call.organization_id,
     source_call.created_at-interval '1 second',source_call.created_at+interval '1 second') f
     JOIN cleanup_cases c ON c.id=f.call_id WHERE f.attempt_class='attempt')<>4 THEN
   RAISE EXCEPTION 'Intentional attempts were lost or excluded records were counted';
 END IF;
 FOR spec IN SELECT * FROM cleanup_cases LOOP
   SELECT attempt_class INTO STRICT actual FROM private.report_v3_call_facts(source_call.organization_id,
     source_call.created_at-interval '1 second',source_call.created_at+interval '1 second') WHERE call_id=spec.id;
   IF actual IS DISTINCT FROM spec.expected THEN RAISE EXCEPTION 'Attempt classification mismatch: % vs %',actual,spec.expected; END IF;
 END LOOP;
END $tests$;
-- Exercise the real trigger on a disposable table with the same premium column type,
-- avoiding unrelated policy identity prerequisites in this focused validation.
CREATE TEMP TABLE premium_probe(premium_amount numeric);
CREATE TRIGGER premium_probe_guard BEFORE INSERT ON premium_probe FOR EACH ROW EXECUTE FUNCTION private.require_new_policy_sale_premium();
DO $tests$
DECLARE amount numeric; rejected boolean;
BEGIN
 FOREACH amount IN ARRAY ARRAY[NULL::numeric,0,-1,'NaN'::numeric,'Infinity'::numeric] LOOP
   rejected:=false;
   BEGIN INSERT INTO premium_probe VALUES(amount); EXCEPTION WHEN check_violation THEN rejected:=true; END;
   IF NOT rejected THEN RAISE EXCEPTION 'Invalid premium accepted: %',amount; END IF;
 END LOOP;
 INSERT INTO premium_probe VALUES(0.01),(100.50);
 IF (SELECT count(*) FROM premium_probe)<>2 THEN RAISE EXCEPTION 'Valid premiums rejected'; END IF;
END $tests$;
ROLLBACK;
