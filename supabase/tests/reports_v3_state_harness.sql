-- =====================================================================================================
-- Reports v3 state harness (plan D5 §6, §8). Disposable synthetic databases only, through
-- scripts/run_reports_v3_tests.sh. Adds what the …14 state helpers read, with production names and types:
--   leads.state           text NOT NULL DEFAULT ''   (baseline 20260806000000)
--   clients.state         text                       (baseline)
--   campaign_leads.state  text DEFAULT ''            (baseline)
--   recruits.state        text                       (baseline; never used to map a state, D5-3)
--   contact_history_calls_page, the same-org calls-by-contact index (20261003192857:135)
-- recruits, private.dialer_conversion_lineage and public.contact_history_events (RLS on, no policies) come
-- from reports_v3_dependencies.sql. public.normalize_us_state is extracted verbatim from the baseline, with
-- its production privilege lines, by scripts/reports_v3_fixture.py.
-- =====================================================================================================
ALTER TABLE public.leads ADD COLUMN state text NOT NULL DEFAULT '';
ALTER TABLE public.clients ADD COLUMN state text;
ALTER TABLE public.campaign_leads ADD COLUMN state text DEFAULT '';
ALTER TABLE public.recruits ADD COLUMN state text;
CREATE INDEX contact_history_calls_page ON public.calls (organization_id, contact_id, (coalesce(started_at, created_at)) DESC, id DESC);

-- RLS stays on, with no policies, for the private lineage and the history events, as in production.
SELECT rt.eq('state harness: RLS on the lineage and history tables, no policies',
  (SELECT string_agg(c.relname || ':' || c.relrowsecurity::text || ':'
                     || (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::text, ' ' ORDER BY c.relname)
     FROM pg_class c WHERE c.oid IN ('private.dialer_conversion_lineage'::regclass, 'public.contact_history_events'::regclass)),
  'contact_history_events:true:0 dialer_conversion_lineage:true:0');

-- The verbatim normalizer carries the pinned production fingerprint and flags (D5 §3.1), and the
-- production grants. The privilege snapshot lets the state suite prove that …14 leaves it unchanged.
SELECT rt.eq('state harness: normalize_us_state is the verbatim baseline body',
  (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.normalize_us_state(text)'::regprocedure), 'c80ff9ad87445693d84d0276c872ba83');
SELECT rt.eq('state harness: normalize_us_state is immutable, invoker, with a pinned search_path',
  (SELECT concat_ws('|', provolatile, prosecdef::text, array_to_string(proconfig, ';'))
     FROM pg_proc WHERE oid = 'public.normalize_us_state(text)'::regprocedure),
  'i|false|search_path=pg_catalog, pg_temp');
SELECT rt.eq('state harness: normalize_us_state keeps its production grants',
  (SELECT array_agg(has_function_privilege(r, 'public.normalize_us_state(text)', 'EXECUTE') ORDER BY r)
     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r),
  ARRAY[true, true, true]);
CREATE TABLE rt.state_normalizer_preimage AS
SELECT md5(prosrc) AS prosrc_md5, provolatile, prosecdef, proconfig, proacl::text AS acl, pg_get_userbyid(proowner) AS owner
  FROM pg_proc WHERE oid = 'public.normalize_us_state(text)'::regprocedure;
