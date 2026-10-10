-- =====================================================================================================
-- Reports data-quality correction: quality.sessions.overlap_seconds_removed. Apply as a NEW migration only
-- with Chris's exact approval, inside the Reports-only disabled window (AGENT_RULES #41):
--   1. *_reports_overlap_release_disable.sql  (exact bytes of supabase/ops/reports_disable.sql)
--   2. this file
--   3. *_reports_overlap_release_enable.sql   (exact bytes of supabase/ops/reports_integrity_enable.sql)
-- Replaces ONLY private.report_integrity_quality. Signature, jsonb result, LANGUAGE sql, STABLE, SECURITY
-- INVOKER, owner, pinned search_path and ACL stay unchanged (CREATE OR REPLACE keeps owner and ACL; the
-- postcondition proves it). report_session_facts and report_session_seconds, and therefore every session
-- total, are untouched. Reads and writes no table data; no RLS, grant, writer or frontend change.
-- Previous value: floor(sum of every agent's raw spans) - sum(per-agent floor(union)) reported 0..(agents-1)
-- seconds of rounding residue when no span overlapped. New value: the exact per-agent raw-minus-union
-- difference, summed over agents and floored once; zero overlapping rows give exactly 0.
-- Refuses replay, preimage/dependency/authorization drift, and an enabled Reports surface.
-- Recovery: supabase/migrations/rollback/*_reports_integrity_quality_overlap_seconds.rollback.sql (disabled window only).
-- =====================================================================================================
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';
DO $guard$ DECLARE f record; BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])') AND md5(prosrc)='c1355d551fba0cc2217150f5531d1b31') THEN
  RAISE EXCEPTION 'Reports overlap correction: refusing replay';
 END IF;
 FOR f IN SELECT * FROM (VALUES
  ('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])','d330c5bea75fb160a0f55e72ed2fe191',false),
  ('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])','245c7ce4f7bf47f6347595822f70a947',false),
  ('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])','3d33b720751a1913c81ad284ae6ffd43',true)
 ) AS expected(signature,body_md5,is_definer) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(f.signature) AND md5(prosrc)=f.body_md5
   AND proowner='postgres'::regrole AND prosecdef=f.is_definer AND provolatile='s'
   AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND proacl='{postgres=X/postgres}'::aclitem[]) THEN
   RAISE EXCEPTION 'Reports overlap correction: preimage or authorization drift: %',f.signature;
  END IF;
 END LOOP;
 -- Reports-only disabled window: no Reports reader or legacy RPC may be client-executable.
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE ((n.nspname='private' AND p.proname LIKE 'report\_%')
      OR (n.nspname='public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')))
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'Reports overlap correction: Reports must be disabled first (supabase/ops/reports_disable.sql); refusing';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION private.report_integrity_quality(p_org uuid,p_start timestamptz,p_end timestamptz,p_agents uuid[])
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH c AS MATERIALIZED (
  SELECT c.id,c.duration,c.duration_source,c.duration_conflict FROM public.calls c WHERE c.organization_id=p_org AND c.created_at>=p_start AND c.created_at<p_end
    AND (p_agents IS NULL OR c.agent_id=ANY(p_agents)) AND lower(coalesce(c.direction,'')) IN ('outbound','outgoing')
 ), calls AS (
  SELECT c.* FROM c WHERE NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=p_org AND d.kind='call' AND d.duplicate_id=c.id)
 ), a AS MATERIALIZED (
  SELECT a.id,a.booking_kind FROM public.appointments a WHERE a.organization_id=p_org AND a.created_at>=p_start AND a.created_at<p_end
    AND (p_agents IS NULL OR coalesce(a.created_by,a.user_id)=ANY(p_agents))
 ), bookings AS (
  SELECT a.* FROM a WHERE NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=p_org AND d.kind='appointment' AND d.duplicate_id=a.id)
 ), s AS MATERIALIZED (SELECT * FROM private.report_session_facts(p_org,p_start,p_end,p_agents))
 SELECT jsonb_build_object(
  'basis','reports_integrity_v2','as_of',now(),
  'duration',jsonb_build_object('outbound_calls',(SELECT count(*) FROM calls),
    'estimated_calls',(SELECT count(*) FROM calls WHERE duration_source='elapsed_estimate'),
    'unknown_calls',(SELECT count(*) FROM calls WHERE duration_source='legacy_unknown' OR duration IS NULL),
    'conflicting_calls',(SELECT count(*) FROM calls WHERE duration_conflict)),
  'duplicates',jsonb_build_object('excluded_outbound_calls',(SELECT count(*) FROM c)-(SELECT count(*) FROM calls),
    'excluded_bookings',(SELECT count(*) FROM a)-(SELECT count(*) FROM bookings),'basis','reviewed_mappings_only'),
  'bookings',jsonb_build_object('all_types',(SELECT count(*) FROM bookings),
    'appointment_kind',(SELECT count(*) FROM bookings WHERE booking_kind='appointment'),
    'callback_kind',(SELECT count(*) FROM bookings WHERE booking_kind='callback'),
    'unknown_kind',(SELECT count(*) FROM bookings WHERE booking_kind IS NULL OR booking_kind NOT IN ('appointment','callback'))),
  'sessions',jsonb_build_object('stale_capped',(SELECT count(*) FROM s WHERE stale_capped),
    'missing_evidence',(SELECT count(*) FROM s WHERE missing_evidence),
    'overlapping_rows',(SELECT count(*) FROM s WHERE s.span_end>s.span_start AND EXISTS(
      SELECT 1 FROM s other WHERE other.session_id<>s.session_id AND other.agent_id=s.agent_id
       AND other.span_end>other.span_start AND other.span_start<s.span_end AND other.span_end>s.span_start)),
    'overlap_seconds_removed',greatest(0,(SELECT coalesce(floor(sum(u.raw_seconds-u.union_seconds)),0) FROM (
      SELECT g.raw_seconds,(SELECT sum(extract(epoch FROM upper(r)-lower(r))) FROM unnest(g.spans) r) union_seconds
      FROM (SELECT sum(extract(epoch FROM s.span_end-s.span_start)) raw_seconds,range_agg(tstzrange(s.span_start,s.span_end,'[)')) spans
            FROM s WHERE s.span_end>s.span_start GROUP BY s.agent_id) g) u))));
$$;
DO $post$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])') AND md5(prosrc)='c1355d551fba0cc2217150f5531d1b31'
  AND proowner='postgres'::regrole AND prosecdef=false AND provolatile='s' AND prorettype='jsonb'::regtype
  AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND proacl='{postgres=X/postgres}'::aclitem[]
  AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
  AND NOT has_function_privilege('service_role',oid,'EXECUTE')) THEN
  RAISE EXCEPTION 'Reports overlap correction: postcondition failed for private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])';
 END IF;
END $post$;
